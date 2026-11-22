import AudioToolbox
import AVFoundation
import Capacitor

/// Bips de l'app (fin de repos, série validée, record) joués par iOS plutôt que par la vue web.
/// Côté web : Capacitor.registerPlugin('MdlfSound') (js/platform/native.js, Native.sound), appelé
/// par js/core/haptics-audio.js ; sans ce module (build plus ancienne), les bips restent en Web Audio.
///
/// Pourquoi natif : le Web Audio d'une vue web suit la session audio « ambiante » d'iOS, coupée par le
/// bouton silencieux. Ici la session est en lecture (.playback, audible en silencieux) avec .mixWithOthers :
/// la musique (Apple Music, Spotify…) n'est jamais arrêtée, le bip s'y ajoute.
///
/// Une seule catégorie depuis la build 68 : .playback + .mixWithOthers, fixée au premier son et plus
/// jamais changée. La build 67 basculait .ambient / .playback selon le son : chaque bascule arrêtait le
/// moteur et l'app restait parfois muette (12/11/2026). Le paramètre « alert » des JS plus anciens est
/// donc ignoré. Seule exception, voulue (feuille de route, 04/11) : « duck » (décompte et GO de fin de
/// repos) ajoute .duckOthers, la musique baisse le temps des bips, puis la session est rendue
/// (notifyOthersOnDeactivation) DUCK_HOLD secondes après la fin réelle du dernier bip baissé, et la
/// catégorie revient sans .duckOthers. Piège connu (Strava, NRC…) : une musique qui reste baissée ;
/// d'où le retour programmé à l'heure de fin du son, et repris à chaque interruption.
///
/// Robustesse : iOS peut couper la session (appel, Siri, alarme : interruptionNotification), changer la
/// sortie (écouteurs débranchés : routeChange, AVAudioEngineConfigurationChange, moteur arrêté) ou
/// relancer tout son service audio (mediaServicesWereReset : moteur et nœuds deviennent inutilisables).
/// Depuis la build du 21/11/2026 : moteur arrêté par une reconfiguration → moteur et lecteur recréés au format de
/// sortie actuel et relancés tout de suite (son coupé rejoué) ; fin d'interruption → session réactivée et moteur
/// relancé sans attendre ; chaque son attend la confirmation d'iOS qu'il est sorti (.dataPlayedBack), sinon il est
/// rejoué par AVAudioPlayer (repli) et noté « pas joué » (lastPlay). Le troisième cas reconstruit moteur et lecteur. Chaque incident est noté dans un petit journal (console
/// Xcode, et `Capacitor.Plugins.MdlfSound.diagnostics()` depuis l'inspecteur web de Safari).
///
/// Réactivité : activer une session audio est bloquant (Apple le déconseille sur le fil principal) et
/// le faire à chaque bip ralentissait la validation d'une série. Tout le travail audio passe donc sur une
/// file dédiée, et la session reste active entre les bips ; elle n'est rendue qu'après IDLE_RELEASE
/// secondes de silence (fin de séance, app en pause), sans gêner les autres apps puisqu'elle se mélange.
/// Les notes sont synthétisées à la volée (sinus avec décroissance), comme le faisait le Web Audio :
/// les mélodies restent définies côté JS.
///
/// Diagnostic (build du 21/11/2026, Réglages › Sons › « Diagnostic du son ») : selfTest() relève la sortie audio,
/// le volume, la session et le dernier incident, estime le mode silencieux, puis joue un FICHIER embarqué
/// (mdlf-test-go.caf : le GO de fin de repos déjà rendu, lu par AVAudioPlayer) et les vrais sons de fin
/// de repos (synthèse, chemin réel de play), en mesurant le niveau qui sort réellement de l'app :
/// compteurs d'AVAudioPlayer pour le fichier, prise d'écoute (tap) sur le mélangeur du moteur pour la
/// synthèse. Niveau mesuré mais rien entendu : l'app joue, c'est la sortie de l'iPhone qui coupe.
/// Le haut-parleur lui-même n'est pas mesurable : la mesure s'arrête à ce que l'app remet à iOS.
@objc(SoundPlugin)
public class SoundPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SoundPlugin"
    public let jsName = "MdlfSound"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        // Sa présence dit aussi au JS que « duck » est compris (js/platform/native.js, canDuck)
        CAPPluginMethod(name: "diagnostics", returnType: CAPPluginReturnPromise),
        // Sa présence dit au JS que « reset » (remise en état sans duck) est compris (build du 21/11/2026)
        CAPPluginMethod(name: "selfTest", returnType: CAPPluginReturnPromise),
    ]

    /// Une note : fréquence (Hz), début et durée (s depuis le début de la mélodie), amplitude 0…1
    private struct Note {
        let freq: Double
        let start: Double
        let dur: Double
        let vol: Double
    }

    private enum SoundError: Error {
        case buffer
        case engineStopped   // moteur toujours à l'arrêt après la relance
    }

    /// Un son du diagnostic : joué à « at » secondes du début du test, par le chemin réel (playNow)
    private struct TestStep {
        let name: String
        let at: Double
        let notes: [Note]
        let duck: Bool
    }

    /// Niveau mesuré d'un son du diagnostic (prise d'écoute du mélangeur), linéaire 0…1
    private struct StepMeter {
        var peak: Float = 0
        var rms: Float = 0       // RMS du tampon le plus fort (≈ averagePower d'AVAudioPlayer)
        var buffers: Int = 0     // tampons rendus par le moteur pendant ce son (0 : moteur à l'arrêt)
    }

    // Moteur et lecteur en var : reconstruits après mediaServicesWereReset
    private var engine: AVAudioEngine = AVAudioEngine()
    private var player: AVAudioPlayerNode = AVAudioPlayerNode()
    private let format: AVAudioFormat = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    private var attached: Bool = false
    private var categorySet: Bool = false   // catégorie fixée (une fois, ou à nouveau après une remise à zéro)
    private var ducking: Bool = false       // catégorie actuelle avec .duckOthers
    private var sessionActive: Bool = false // évite de réactiver la session (appel bloquant) à chaque bip
    private var journal: [String] = []
    private var observers: [NSObjectProtocol] = []
    private var lastIncident: [String: Any]?   // dernière interruption, sortie changée, reconfiguration…

    // Dernier son programmé, rejoué si une reconfiguration d'iOS arrête le moteur pendant qu'il joue
    private var lastBuffer: AVAudioPCMBuffer?
    private var lastBufferEnd: Date = .distantPast

    // Diagnostic : mesure du niveau réel. meterSteps et meterStep sont écrits par la file audio et lus
    // par le fil de rendu de la prise d'écoute : protégés par meterLock.
    private let meterLock: NSLock = NSLock()
    private var meterSteps: [StepMeter] = []
    private var meterStep: Int = -1
    private var meterOn: Bool = false              // file audio : prise d'écoute à poser au prochain son
    private var meterEngine: AVAudioEngine?        // moteur qui porte la prise d'écoute
    private var filePlayer: AVAudioPlayer?         // gardé pendant la lecture du fichier
    private var selfTestRunning: Bool = false

    // Lecture confirmée (diagnostic de la build 91, 22/11/2026 : moteur arrêté par une reconfiguration à
    // 15:03:03, relancé au son de 15:03:06 qui n'est jamais sorti, alors que tout l'état relu disait « joué »).
    // Chaque son attend la confirmation d'iOS (scheduleBuffer, .dataPlayedBack : données réellement remises à la
    // sortie). Sans elle à temps, ou coupé avant sa fin : son rejoué par AVAudioPlayer (repli), graphe du moteur
    // recréé au son suivant, et lastPlay dit « pas joué ». Le JS ne dit plus « joué » sans cette confirmation.
    private var playSeq: Int = 0                    // numéro du dernier son lancé ; les confirmations plus anciennes sont ignorées
    private var lastPlay: [String: Any]?            // { at, via, played (absent tant qu'iOS n'a pas répondu), detail? }
    private var graphStale: Bool = false            // moteur et lecteur à recréer avant le prochain son
    private var fallbackPlayer: AVAudioPlayer?
    private var activeBeforeInterruption: Bool = false
    private var stepPlays: [Int: [String: Any]] = [:]   // diagnostic : dernier état de lecture de chaque son testé
    private static let PLAY_CONFIRM_SLACK: TimeInterval = 0.8   // latence de sortie (Bluetooth compris) avant de conclure

    // Tout le travail audio (session, moteur, tampons, état ci-dessus) se fait sur cette file, jamais
    // sur le fil principal ; les notifications d'iOS y sont renvoyées.
    private let audioQueue: DispatchQueue = DispatchQueue(label: "mdlf.sound", qos: .userInitiated)
    private static let IDLE_RELEASE: TimeInterval = 90
    private static let DUCK_HOLD: TimeInterval = 1.2   // entre deux bips du décompte (1 s), la musique reste baissée
    private static let JOURNAL_MAX: Int = 30
    private var releaseWork: DispatchWorkItem?
    private var unduckWork: DispatchWorkItem?

    override public func load() {
        observeSystem()
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    // MARK: - Appels du JS

    /// { notes: [{ freq, start, dur, vol? }], duck? } : start et dur en secondes depuis le début de la
    /// mélodie ; duck (faux par défaut) : musique des autres apps baissée le temps du son.
    /// « alert » (JS des builds 67 et avant) est accepté et ignoré : tout joue en .playback.
    /// reset (build du 21/11/2026) : remise en état demandée par le JS après une panne relue (session réactivée,
    /// moteur relancé, catégorie refixée si besoin) SANS passer par le duck, dont le changement de
    /// catégorie peut lui-même faire arrêter le moteur par iOS (voir configurationChanged).
    @objc func play(_ call: CAPPluginCall) {
        let notes: [Note] = Self.parseNotes(call.getArray("notes") as? [JSObject] ?? [])
        guard !notes.isEmpty else { call.reject("Aucune note"); return }
        let duck: Bool = call.getBool("duck") ?? false
        let reset: Bool = call.getBool("reset") ?? false
        // Réponse immédiate au JS : le son se prépare et se joue hors du fil principal
        call.resolve()
        audioQueue.async { [weak self] () -> Void in
            guard let self = self else { return }
            if reset { self.forceReset() }
            self.playNow(notes, duck: duck)
        }
    }

    /// Notes reçues du JS, bornées (start < 5 s, dur < 2 s, 20 Hz–20 kHz) ; les autres sont ignorées
    private static func parseNotes(_ raw: [JSObject]) -> [Note] {
        return raw.compactMap { (n: JSObject) -> Note? in
            guard let f = n["freq"] as? Double, let s = n["start"] as? Double, let d = n["dur"] as? Double,
                  f > 20, f < 20_000, s >= 0, s < 5, d > 0, d < 2 else { return nil }
            let vol: Double = min(max(n["vol"] as? Double ?? 0.35, 0), 1)
            return Note(freq: f, start: s, dur: d, vol: vol)
        }
    }

    /// État du module et derniers incidents (inspecteur web de Safari : diagnostic d'un iPhone muet)
    @objc func diagnostics(_ call: CAPPluginCall) {
        audioQueue.async { [weak self] () -> Void in
            guard let self = self else { call.resolve([:]); return }
            call.resolve(self.stateSnapshot())
        }
    }

    /// Diagnostic complet (Réglages › Sons › « Diagnostic du son ») : { steps: [{ name, at, notes, duck }] },
    /// les sons de fin de repos tels que le JS les joue. Résout { before, silentMode, silentMs, file,
    /// steps, after } : état avant et après, mode silencieux estimé, niveau mesuré du fichier embarqué
    /// puis de chaque son synthétisé.
    @objc func selfTest(_ call: CAPPluginCall) {
        let raw: [JSObject] = call.getArray("steps") as? [JSObject] ?? []
        var steps: [TestStep] = []
        for s in raw.prefix(8) {
            let notes: [Note] = Self.parseNotes(s["notes"] as? [JSObject] ?? [])
            guard !notes.isEmpty, let at = s["at"] as? Double, at >= 0, at <= 10 else { continue }
            steps.append(TestStep(name: s["name"] as? String ?? "son", at: at, notes: notes, duck: s["duck"] as? Bool ?? false))
        }
        audioQueue.async { [weak self] () -> Void in
            guard let self = self else { call.resolve([:]); return }
            guard !self.selfTestRunning else { call.reject("Diagnostic déjà en cours"); return }
            self.selfTestRunning = true
            let before: [String: Any] = self.stateSnapshot()
            self.detectSilentMode { [weak self] (silent: String, ms: Double) -> Void in
                guard let self = self else { return }
                self.testFile { [weak self] (file: [String: Any]) -> Void in
                    guard let self = self else { return }
                    self.testSteps(steps) { [weak self] (results: [[String: Any]]) -> Void in
                        guard let self = self else { return }
                        self.selfTestRunning = false
                        self.remember("diagnostic du son fait")
                        call.resolve([
                            "before": before,
                            "silentMode": silent,
                            "silentMs": ms,
                            "file": file,
                            "steps": results,
                            "after": self.stateSnapshot(),
                        ])
                    }
                }
            }
        }
    }

    // MARK: - Lecture (file audio)

    private func playNow(_ notes: [Note], duck: Bool) {
        let buffer: AVAudioPCMBuffer
        do {
            buffer = try render(notes)
        } catch {
            logError("lecture", error)
            return
        }
        let duration: TimeInterval = Double(buffer.frameLength) / format.sampleRate
        do {
            try prepare(duck: duck)
            if meterOn { installMeterTap() }
            startPlayback(buffer, duration: duration)
        } catch {
            logError("lecture", error)
            // Session réactivée et moteur recréé au son suivant ; celui-ci part par le repli, tout de suite
            sessionActive = false
            graphStale = true
            playFallback(buffer, reason: "moteur indisponible")
        }
        // Tout son joué pendant un duck repousse le retour de la musique après sa propre fin
        // (.interrupts : le dernier son programmé est celui qui finit le dernier)
        lastBuffer = buffer
        lastBufferEnd = Date().addingTimeInterval(duration)
        if ducking { scheduleUnduck(after: duration + Self.DUCK_HOLD) }
        scheduleRelease()
    }

    /// Son programmé sur le moteur (qui tourne : vérifié par startEngine) et attente de la confirmation d'iOS
    private func startPlayback(_ buffer: AVAudioPCMBuffer, duration: TimeInterval) {
        playSeq += 1
        let id: Int = playSeq
        let started: Date = Date()
        setLastPlay(["at": ISO8601DateFormatter().string(from: started), "via": "moteur"])
        player.scheduleBuffer(buffer, at: nil, options: .interrupts, completionCallbackType: .dataPlayedBack) {
            [weak self] (_: AVAudioPlayerNodeCompletionCallbackType) -> Void in
            guard let self = self else { return }
            self.audioQueue.async { [weak self] () -> Void in
                guard let self = self else { return }
                self.playFinished(id, buffer: buffer, started: started, duration: duration, timedOut: false)
            }
        }
        // Sans effet si le lecteur joue déjà ; indispensable après un moteur relancé
        player.play()
        audioQueue.asyncAfter(deadline: .now() + duration + Self.PLAY_CONFIRM_SLACK) { [weak self] () -> Void in
            guard let self = self else { return }
            self.playFinished(id, buffer: buffer, started: started, duration: duration, timedOut: true)
        }
    }

    /// Confirmation d'iOS, ou délai dépassé. Joué seulement si le moteur tourne encore et que le son est allé à
    /// son terme (un lecteur arrêté rend aussi la main, mais trop tôt) ; sinon repli et graphe à recréer.
    private func playFinished(_ id: Int, buffer: AVAudioPCMBuffer, started: Date, duration: TimeInterval, timedOut: Bool) {
        // Son remplacé par un plus récent (.interrupts), ou déjà conclu
        guard id == playSeq, var play = lastPlay, play["played"] == nil else { return }
        let elapsed: TimeInterval = Date().timeIntervalSince(started)
        let played: Bool = !timedOut && engine.isRunning && elapsed >= duration * 0.8
        play["played"] = played
        if !played {
            let why: String = timedOut ? "sortie muette (aucune confirmation d'iOS)" : "son coupé, moteur arrêté"
            play["detail"] = why
            remember("échec lecture : \(why)")
            graphStale = true
        }
        setLastPlay(play)
        if !played { playFallback(buffer, reason: timedOut ? "sortie muette" : "son coupé") }
    }

    /// Repli : le même son, rendu en WAV et lu par AVAudioPlayer (chemin indépendant du moteur), sinon un son
    /// système. lastPlay le dit (via « repli » ou « son système »).
    private func playFallback(_ buffer: AVAudioPCMBuffer, reason: String) {
        playSeq += 1   // toute confirmation encore attendue du moteur est caduque
        var play: [String: Any] = ["at": ISO8601DateFormatter().string(from: Date()), "via": "repli", "detail": reason]
        if let data = wavData(buffer), let p = try? AVAudioPlayer(data: data), p.prepareToPlay(), p.play() {
            fallbackPlayer = p
            play["played"] = true
            remember("repli AVAudioPlayer (\(reason))")
        } else {
            // Son système : obéit au bouton silencieux, mieux que rien
            AudioServicesPlaySystemSound(1_007)
            play["via"] = "son système"
            remember("repli son système (\(reason)) : AVAudioPlayer refusé")
        }
        setLastPlay(play)
    }

    /// État de lecture du dernier son, noté aussi pour le son du diagnostic en cours
    private func setLastPlay(_ play: [String: Any]) {
        lastPlay = play
        guard meterOn else { return }
        meterLock.lock()
        let i: Int = meterStep
        meterLock.unlock()
        if i >= 0 { stepPlays[i] = play }
    }

    /// Tampon mono flottant → WAV PCM 16 bits (AVAudioPlayer(data:) lit le WAV en mémoire)
    private func wavData(_ buffer: AVAudioPCMBuffer) -> Data? {
        guard let channels = buffer.floatChannelData else { return nil }
        let n: Int = Int(buffer.frameLength)
        let rate: UInt32 = UInt32(format.sampleRate)
        var d: Data = Data()
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { (b: UnsafeRawBufferPointer) -> Void in d.append(contentsOf: b) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { (b: UnsafeRawBufferPointer) -> Void in d.append(contentsOf: b) } }
        d.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + n * 2))
        d.append(contentsOf: Array("WAVEfmt ".utf8)); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
        d.append(contentsOf: Array("data".utf8)); u32(UInt32(n * 2))
        let out: UnsafeMutablePointer<Float> = channels[0]
        for i in 0..<n { u16(UInt16(bitPattern: Int16(max(-1, min(1, out[i])) * 32_767))) }
        return d
    }

    /// Catégorie, session et moteur prêts à jouer. Le moteur arrêté par iOS (interruption, autre sortie
    /// audio) est relancé ici, au son suivant.
    private func prepare(duck: Bool) throws {
        let session: AVAudioSession = AVAudioSession.sharedInstance()
        // Passage en .duckOthers : la musique ne baisse qu'à l'activation de la session (AVAudioSession,
        // « duckOthers »), d'où la session rendue puis réactivée. Le retour sans duck se fait seulement
        // dans restoreMix (programmé) : un son ordinaire pendant le décompte joue sans rien changer.
        let wantsDuck: Bool = duck && !ducking
        // Catégorie changée par un autre (vue web qui lit une vidéo, autre module) : refixée ici, sinon les
        // sons suivants suivraient une catégorie coupée par le bouton silencieux (build 69)
        if categorySet && session.category != .playback {
            remember("catégorie trouvée en \(session.category.rawValue) : refixée en lecture")
            categorySet = false
            sessionActive = false
        }
        if !categorySet || wantsDuck {
            if wantsDuck && sessionActive { deactivate() }
            var options: AVAudioSession.CategoryOptions = [.mixWithOthers]
            if duck { options.insert(.duckOthers) }
            try session.setCategory(.playback, mode: .default, options: options)
            categorySet = true
            ducking = duck
        }
        if !sessionActive || !engine.isRunning {
            try session.setActive(true)
            sessionActive = true
        }
        try startEngine()
    }

    /// Moteur prêt à rendre : graphe recréé s'il est périmé (format de sortie changé par iOS : relancer l'ancien
    /// moteur peut réussir sans que rien ne sorte), lecteur branché, moteur démarré
    private func startEngine() throws {
        if graphStale { resetGraph() }
        if !attached {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            attached = true
        }
        if !engine.isRunning {
            engine.prepare()
            try engine.start()
        }
        guard engine.isRunning else { throw SoundError.engineStopped }
    }

    /// Moteur et lecteur neufs, branchés au format de sortie actuel (la prise d'écoute du diagnostic part avec
    /// l'ancien moteur et se repose au son suivant)
    private func resetGraph() {
        if meterEngine === engine { meterEngine?.mainMixerNode.removeTap(onBus: 0); meterEngine = nil }
        if engine.isRunning { engine.stop() }
        engine = AVAudioEngine()
        player = AVAudioPlayerNode()
        attached = false
        graphStale = false
        remember("moteur audio recréé")
    }

    /// Remise en état demandée par le JS (play, reset) : moteur arrêté, session à réactiver, catégorie
    /// refixée seulement si un autre l'a changée (refixer la même déclencherait une reconfiguration)
    private func forceReset() {
        remember("remise en état demandée par l'app")
        if engine.isRunning { engine.stop() }
        if AVAudioSession.sharedInstance().category != .playback { categorySet = false }
        sessionActive = false
    }

    /// Session rendue : moteur arrêté d'abord (iOS refuse de rendre une session dont l'audio tourne)
    private func deactivate() {
        if engine.isRunning { engine.stop() }
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            logError("session rendue", error)
        }
        sessionActive = false
    }

    /// Fin du duck : session rendue (la musique remonte) et catégorie sans .duckOthers
    private func restoreMix() {
        unduckWork?.cancel()
        unduckWork = nil
        guard ducking else { return }
        if sessionActive { deactivate() }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        } catch {
            logError("retour sans duck", error)
            categorySet = false   // refixée (sans duck) au prochain son
        }
        ducking = false
    }

    /// Musique rendue DUCK_HOLD s après la fin du dernier son : chaque son annule le retour prévu par
    /// le précédent. Pas d'horloge système (ProcessInfo.systemUptime serait une API « à raison
    /// déclarée » du manifeste de confidentialité) : seulement des délais de la file audio.
    private func scheduleUnduck(after delay: TimeInterval) {
        unduckWork?.cancel()
        let work: DispatchWorkItem = DispatchWorkItem(block: { [weak self] () -> Void in
            guard let self = self else { return }
            self.restoreMix()
        })
        unduckWork = work
        audioQueue.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// Session rendue après un long silence ; repoussée à chaque bip
    private func scheduleRelease() {
        releaseWork?.cancel()
        let work: DispatchWorkItem = DispatchWorkItem(block: { [weak self] () -> Void in
            guard let self = self else { return }
            if self.ducking {
                self.restoreMix()
            } else if self.sessionActive {
                self.deactivate()
            }
        })
        releaseWork = work
        audioQueue.asyncAfter(deadline: .now() + Self.IDLE_RELEASE, execute: work)
    }

    // MARK: - Événements d'iOS

    /// Notifications reçues sur n'importe quel fil (queue: nil) : seules des valeurs simples en sont
    /// extraites, puis le travail passe sur la file audio.
    private func observeSystem() {
        let center: NotificationCenter = NotificationCenter.default
        let session: AVAudioSession = AVAudioSession.sharedInstance()

        observers.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification, object: session, queue: nil
        ) { [weak self] (note: Notification) -> Void in
            let type: UInt = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue ?? 0
            // Raison (iOS 14.5+) : 1 = app suspendue par iOS (arrière-plan), signalée au retour
            let reason: UInt = (note.userInfo?[AVAudioSessionInterruptionReasonKey] as? NSNumber)?.uintValue ?? 0
            guard let self = self else { return }
            self.audioQueue.async { [weak self] () -> Void in
                guard let self = self else { return }
                self.interrupted(rawType: type, rawReason: reason)
            }
        })

        observers.append(center.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: session, queue: nil
        ) { [weak self] (note: Notification) -> Void in
            let reason: UInt = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue ?? 0
            guard let self = self else { return }
            self.audioQueue.async { [weak self] () -> Void in
                guard let self = self else { return }
                self.routeChanged(rawReason: reason)
            }
        })

        observers.append(center.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: nil
        ) { [weak self] (_: Notification) -> Void in
            guard let self = self else { return }
            self.audioQueue.async { [weak self] () -> Void in
                guard let self = self else { return }
                self.rebuildEngine()
            }
        })

        // Sortie audio ou format changé : iOS arrête le moteur (AVAudioEngine, « configuration change »).
        // object: nil, car le moteur peut être reconstruit ; relancé au son suivant (prepare).
        observers.append(center.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: nil, queue: nil
        ) { [weak self] (_: Notification) -> Void in
            guard let self = self else { return }
            self.audioQueue.async { [weak self] () -> Void in
                guard let self = self else { return }
                self.configurationChanged()
            }
        })
    }

    /// Appel, Siri, alarme… : iOS a coupé la session et arrêté le moteur. Tout est réactivé au son
    /// suivant ; un duck en cours est annulé tout de suite (la musique ne doit pas rester baissée).
    private func interrupted(rawType: UInt, rawReason: UInt) {
        let began: Bool = AVAudioSession.InterruptionType(rawValue: rawType) == .began
        let why: String = rawReason == 1 ? ", app suspendue par iOS" : rawReason == 3 ? ", sortie déconnectée" : ""
        remember(began ? "interruption (début\(why))" : "interruption (fin)")
        if began { noteIncident("interruption", "Interruption (appel, Siri, alarme…\(why))") }
        if began {
            activeBeforeInterruption = sessionActive
            sessionActive = false
            if ducking { restoreMix() }
            // Moteur arrêté nous-mêmes (Apple, « Handling audio interruptions ») : isRunning dit vrai, et
            // prepare le relance proprement au son suivant au lieu de croire qu'il tourne encore
            if engine.isRunning { engine.stop() }
            return
        }
        // Fin : session réactivée et moteur (recréé) relancé tout de suite si la séance jouait des sons avant,
        // au lieu d'attendre le son suivant ; un échec est repris par prepare au son suivant
        sessionActive = false
        guard activeBeforeInterruption else { return }
        activeBeforeInterruption = false
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            sessionActive = true
            graphStale = true
            try startEngine()
            scheduleRelease()
        } catch {
            logError("relance après interruption", error)
            sessionActive = false
            graphStale = true
        }
    }

    /// Écouteurs branchés ou débranchés, AirPods, CarPlay… : noté ; le moteur arrêté est relancé au son suivant
    private func routeChanged(rawReason: UInt) {
        let reason: AVAudioSession.RouteChangeReason = AVAudioSession.RouteChangeReason(rawValue: rawReason) ?? .unknown
        if reason == .newDeviceAvailable || reason == .oldDeviceUnavailable {
            remember("sortie audio changée (raison \(rawReason))")
        }
        // Les changements de catégorie du duck (les nôtres) ne sont pas des incidents
        if reason != .categoryChange || AVAudioSession.sharedInstance().category != .playback {
            noteIncident("sortie", "Sortie audio changée (\(Self.routeReasonName(reason))) : \(Self.outputsText())")
        }
        // .categoryChange : le duck de chaque fin de repos en produit deux (notre propre catégorie, rien à
        // faire) ; une catégorie posée par un autre est notée et refixée au son suivant (build 69)
        if reason == .categoryChange && categorySet && AVAudioSession.sharedInstance().category != .playback {
            remember("catégorie changée par un autre : \(AVAudioSession.sharedInstance().category.rawValue)")
            categorySet = false
        }
    }

    /// Sortie ou format changé (y compris par nos propres changements de catégorie du duck) : iOS a
    /// arrêté le moteur, peut-être au milieu d'un bip programmé juste avant. Avant la build du 21/11/2026 le moteur
    /// n'était relancé qu'au son suivant et ce bip-là était perdu en silence (diagnostic « joué »).
    /// Session toujours active : moteur relancé tout de suite, et le dernier son rejoué s'il n'avait pas
    /// fini (Apple, AVAudioEngineConfigurationChange : l'app doit relancer le moteur elle-même).
    private func configurationChanged() {
        let running: Bool = engine.isRunning
        remember("moteur reconfiguré par iOS (en marche : \(running))")
        guard !running else { return }
        // Moteur arrêté : son graphe suit l'ancien format de sortie, il est recréé (tout de suite si la session
        // est active, sinon au son suivant). Un son coupé en route est rejoué, avec sa confirmation.
        graphStale = true
        guard sessionActive else { return }
        noteIncident("reconfiguration", "Moteur audio arrêté par iOS (reconfiguration), relancé")
        do {
            try startEngine()
            if let buffer = lastBuffer, Date() < lastBufferEnd {
                let duration: TimeInterval = Double(buffer.frameLength) / format.sampleRate
                lastBufferEnd = Date().addingTimeInterval(duration)
                remember("son coupé par la reconfiguration : rejoué")
                startPlayback(buffer, duration: duration)
            }
        } catch {
            logError("relance après reconfiguration", error)
            sessionActive = false   // tout est repris au son suivant
            graphStale = true
        }
    }

    /// Service audio d'iOS relancé : moteur et lecteur inutilisables, tout est recréé au son suivant
    /// (Apple, « Responding to audio session interruptions » : mediaServicesWereReset)
    private func rebuildEngine() {
        remember("service audio d'iOS relancé : moteur reconstruit")
        noteIncident("service", "Service audio d'iOS relancé")
        meterEngine = nil   // la prise d'écoute part avec l'ancien moteur
        lastBuffer = nil
        releaseWork?.cancel()
        unduckWork?.cancel()
        releaseWork = nil
        unduckWork = nil
        engine = AVAudioEngine()
        player = AVAudioPlayerNode()
        attached = false
        graphStale = false
        playSeq += 1
        categorySet = false
        ducking = false
        sessionActive = false
    }

    // MARK: - État (diagnostics)

    /// Session, sortie et module, en valeurs simples pour le JS (diagnostics et selfTest)
    private func stateSnapshot() -> [String: Any] {
        let session: AVAudioSession = AVAudioSession.sharedInstance()
        let outputs: [[String: Any]] = session.currentRoute.outputs.map { (o: AVAudioSessionPortDescription) -> [String: Any] in
            return ["type": o.portType.rawValue, "name": o.portName]
        }
        var state: [String: Any] = [
            "journal": journal,
            "category": session.category.rawValue,
            "mode": session.mode.rawValue,
            "categoryOptions": Self.optionNames(session.categoryOptions),
            "duckOthers": session.categoryOptions.contains(.duckOthers),
            "ducking": ducking,
            "sessionActive": sessionActive,
            "engineRunning": engine.isRunning,
            "otherAudioPlaying": session.isOtherAudioPlaying,
            "secondaryAudioShouldBeSilencedHint": session.secondaryAudioShouldBeSilencedHint,
            "outputs": outputs,
            // Volume du système (0…1), celui des boutons latéraux ; exact quand la session est active
            "outputVolume": Double(session.outputVolume),
            "sampleRate": session.sampleRate,
        ]
        if let play = lastPlay { state["lastPlay"] = play }
        if let incident = lastIncident { state["lastIncident"] = incident }
        return state
    }

    private static func optionNames(_ o: AVAudioSession.CategoryOptions) -> [String] {
        var names: [String] = []
        if o.contains(.mixWithOthers) { names.append("mixWithOthers") }
        if o.contains(.duckOthers) { names.append("duckOthers") }
        if o.contains(.interruptSpokenAudioAndMixWithOthers) { names.append("interruptSpokenAudioAndMixWithOthers") }
        if o.contains(.defaultToSpeaker) { names.append("defaultToSpeaker") }
        if o.contains(.allowAirPlay) { names.append("allowAirPlay") }
        return names
    }

    private static func routeReasonName(_ r: AVAudioSession.RouteChangeReason) -> String {
        switch r {
        case .newDeviceAvailable: return "nouvelle sortie branchée"
        case .oldDeviceUnavailable: return "sortie débranchée"
        case .categoryChange: return "catégorie changée"
        case .override: return "sortie forcée"
        case .wakeFromSleep: return "réveil"
        case .noSuitableRouteForCategory: return "aucune sortie possible"
        case .routeConfigurationChange: return "configuration changée"
        default: return "raison \(r.rawValue)"
        }
    }

    private static func outputsText() -> String {
        let names: [String] = AVAudioSession.sharedInstance().currentRoute.outputs.map { (o: AVAudioSessionPortDescription) -> String in
            return o.portName
        }
        return names.isEmpty ? "aucune" : names.joined(separator: ", ")
    }

    private func noteIncident(_ kind: String, _ detail: String) {
        lastIncident = ["kind": kind, "detail": detail, "at": ISO8601DateFormatter().string(from: Date())]
    }

    // MARK: - Diagnostic (selfTest)

    /// Mode silencieux : iOS ne le publie pas. Estimation connue : un son système (qui, lui, obéit au
    /// bouton silencieux) d'une demi-seconde de silence se termine presque aussitôt en mode silencieux.
    /// « on », « off » ou « unknown » (fichier absent, délai ambigu, pas de réponse en 1,5 s).
    private func detectSilentMode(_ done: @escaping (String, Double) -> Void) {
        guard let url = Bundle.main.url(forResource: "mdlf-silence", withExtension: "caf") else { done("unknown", -1); return }
        var soundID: SystemSoundID = 0
        guard AudioServicesCreateSystemSoundID(url as CFURL, &soundID) == noErr else { done("unknown", -1); return }
        let started: Date = Date()
        var finished: Bool = false   // lu et écrit sur la file audio seulement
        let finish: (Bool) -> Void = { [weak self] (timedOut: Bool) -> Void in
            guard let self = self else { return }
            self.audioQueue.async { () -> Void in
                guard !finished else { return }
                finished = true
                AudioServicesDisposeSystemSoundID(soundID)
                let ms: Double = Date().timeIntervalSince(started) * 1000
                if timedOut { done("unknown", ms) } else if ms < 100 { done("on", ms) } else if ms >= 350 { done("off", ms) } else { done("unknown", ms) }
            }
        }
        AudioServicesPlaySystemSoundWithCompletion(soundID) { () -> Void in finish(false) }
        audioQueue.asyncAfter(deadline: .now() + 1.5) { () -> Void in finish(true) }
    }

    /// Fichier embarqué lu par AVAudioPlayer, compteurs relevés toutes les 25 ms : prouve que la sortie
    /// marche indépendamment de la synthèse. { played, peakDb, avgDb, ms, error? }
    private func testFile(_ done: @escaping ([String: Any]) -> Void) {
        guard let url = Bundle.main.url(forResource: "mdlf-test-go", withExtension: "caf") else {
            done(["played": false, "error": "fichier absent de l'app"]); return
        }
        do {
            try prepare(duck: false)   // même session que les bips
            let p: AVAudioPlayer = try AVAudioPlayer(contentsOf: url)
            p.isMeteringEnabled = true
            p.volume = 1
            filePlayer = p
            guard p.prepareToPlay(), p.play() else {
                filePlayer = nil
                done(["played": false, "error": "lecture refusée par iOS"]); return
            }
            pollFile(p, peak: -160, avg: -160, ticks: 0, started: Date(), done: done)
        } catch {
            let ns: NSError = error as NSError
            done(["played": false, "error": "\(ns.localizedDescription) (\(ns.domain) \(ns.code))"])
        }
    }

    private func pollFile(_ p: AVAudioPlayer, peak: Float, avg: Float, ticks: Int, started: Date,
                          done: @escaping ([String: Any]) -> Void) {
        p.updateMeters()
        let pk: Float = max(peak, p.peakPower(forChannel: 0))
        let av: Float = max(avg, p.averagePower(forChannel: 0))
        if p.isPlaying && ticks < 120 {
            audioQueue.asyncAfter(deadline: .now() + 0.025) { [weak self] () -> Void in
                guard let self = self else { return }
                self.pollFile(p, peak: pk, avg: av, ticks: ticks + 1, started: started, done: done)
            }
            return
        }
        p.stop()
        filePlayer = nil
        done(["played": true, "peakDb": Self.clampDb(pk), "avgDb": Self.clampDb(av),
              "ms": Date().timeIntervalSince(started) * 1000])
    }

    /// Sons de fin de repos joués par le chemin réel (playNow), niveau relevé par une prise d'écoute
    /// sur le mélangeur principal : ce que le moteur remet réellement à iOS, son par son.
    private func testSteps(_ steps: [TestStep], _ done: @escaping ([[String: Any]]) -> Void) {
        guard !steps.isEmpty else { done([]); return }
        meterLock.lock()
        meterSteps = Array(repeating: StepMeter(), count: steps.count)
        meterStep = -1
        meterLock.unlock()
        meterOn = true
        stepPlays = [:]
        var ducked: [Bool] = Array(repeating: false, count: steps.count)   // file audio seulement
        var running: [Bool] = Array(repeating: false, count: steps.count)
        for (i, step) in steps.enumerated() {
            audioQueue.asyncAfter(deadline: .now() + step.at) { [weak self] () -> Void in
                guard let self = self else { return }
                self.meterLock.lock()
                self.meterStep = i
                self.meterLock.unlock()
                self.playNow(step.notes, duck: step.duck)
                ducked[i] = self.ducking
                running[i] = self.engine.isRunning
            }
        }
        let end: Double = steps.map { (s: TestStep) -> Double in
            s.at + (s.notes.map { (n: Note) -> Double in n.start + n.dur }.max() ?? 0)
        }.max() ?? 0
        // Après la confirmation d'iOS du dernier son (PLAY_CONFIRM_SLACK) et son éventuel repli
        audioQueue.asyncAfter(deadline: .now() + end + Self.PLAY_CONFIRM_SLACK + 0.4) { [weak self] () -> Void in
            guard let self = self else { return }
            self.meterOn = false
            self.meterEngine?.mainMixerNode.removeTap(onBus: 0)
            self.meterEngine = nil
            self.meterLock.lock()
            let meters: [StepMeter] = self.meterSteps
            self.meterStep = -1
            self.meterLock.unlock()
            var results: [[String: Any]] = []
            for (i, step) in steps.enumerated() {
                let m: StepMeter = i < meters.count ? meters[i] : StepMeter()
                var entry: [String: Any] = [
                    "name": step.name,
                    "peakDb": Self.clampDb(Self.toDb(m.peak)),
                    "rmsDb": Self.clampDb(Self.toDb(m.rms)),
                    "buffers": m.buffers,
                    "ducking": ducked[i],
                    "engineRunning": running[i],
                    // Chemin pris (moteur, repli, son système) et confirmation d'iOS (absente : pas de réponse)
                    "via": self.stepPlays[i]?["via"] as? String ?? "moteur",
                ]
                if let played = self.stepPlays[i]?["played"] as? Bool { entry["played"] = played }
                results.append(entry)
            }
            done(results)
        }
    }

    /// Prise d'écoute posée sur le moteur actuel (une seule par moteur : en poser deux fait planter)
    private func installMeterTap() {
        if meterEngine === engine { return }
        meterEngine?.mainMixerNode.removeTap(onBus: 0)
        engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] (buffer: AVAudioPCMBuffer, _: AVAudioTime) -> Void in
            self?.meterFeed(buffer)
        }
        meterEngine = engine
    }

    /// Fil de rendu : pic et RMS du tampon, ajoutés au son en cours
    private func meterFeed(_ buffer: AVAudioPCMBuffer) {
        guard let channels = buffer.floatChannelData else { return }
        let n: Int = Int(buffer.frameLength)
        guard n > 0 else { return }
        let data: UnsafeMutablePointer<Float> = channels[0]
        var peak: Float = 0
        var sum: Double = 0
        for i in 0..<n {
            let v: Float = abs(data[i])
            if v > peak { peak = v }
            sum += Double(v) * Double(v)
        }
        let rms: Float = Float((sum / Double(n)).squareRoot())
        meterLock.lock()
        let i: Int = meterStep
        if i >= 0 && i < meterSteps.count {
            meterSteps[i].peak = max(meterSteps[i].peak, peak)
            meterSteps[i].rms = max(meterSteps[i].rms, rms)
            meterSteps[i].buffers += 1
        }
        meterLock.unlock()
    }

    private static func toDb(_ linear: Float) -> Float {
        return linear > 0.000_01 ? 20 * log10(linear) : -160
    }

    /// dBFS bornés à [-160, 0] et arrondis au dixième (JSON : jamais d'infini)
    private static func clampDb(_ db: Float) -> Double {
        guard db.isFinite else { return -160 }
        return (Double(min(max(db, -160), 0)) * 10).rounded() / 10
    }

    // MARK: - Journal

    private func logError(_ step: String, _ error: Error) {
        let ns: NSError = error as NSError
        remember("échec \(step) : \(ns.localizedDescription) (\(ns.domain) \(ns.code))")
    }

    private func remember(_ text: String) {
        let line: String = "\(ISO8601DateFormatter().string(from: Date())) \(text)"
        CAPLog.print("MdlfSound :", line)
        journal.append(line)
        if journal.count > Self.JOURNAL_MAX { journal.removeFirst(journal.count - Self.JOURNAL_MAX) }
    }

    // MARK: - Synthèse

    /// Somme des notes dans un seul tampon : sinus à attaque courte (sans clic) puis décroissance
    /// exponentielle jusqu'à 0,001 sur la durée de la note, comme exponentialRampToValueAtTime côté web.
    private func render(_ notes: [Note]) throws -> AVAudioPCMBuffer {
        let rate: Double = format.sampleRate
        let end: Double = notes.map { (n: Note) -> Double in n.start + n.dur }.max() ?? 0
        let frames: AVAudioFrameCount = AVAudioFrameCount((end + 0.05) * rate)
        guard frames > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
              let channels = buffer.floatChannelData else { throw SoundError.buffer }
        buffer.frameLength = frames
        let out: UnsafeMutablePointer<Float> = channels[0]
        let total: Int = Int(frames)
        for i in 0..<total { out[i] = 0 }
        let attack: Int = Int(0.004 * rate)
        for n in notes {
            let first: Int = Int(n.start * rate)
            let count: Int = Int(n.dur * rate)
            guard count > 0 else { continue }
            let decay: Double = log(0.001) / Double(count)
            for k in 0..<count where first + k < total {
                let env: Double = n.vol * exp(decay * Double(k)) * min(1, Double(k) / Double(attack))
                out[first + k] += Float(env * sin(2 * .pi * n.freq * Double(k) / rate))
            }
        }
        for i in 0..<total { out[i] = max(-1, min(1, out[i])) }
        return buffer
    }
}
