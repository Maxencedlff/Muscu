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
/// Les deux premiers cas sont rattrapés au son suivant (session réactivée, moteur relancé) ; le
/// troisième reconstruit moteur et lecteur. Chaque incident est noté dans un petit journal (console
/// Xcode, et `Capacitor.Plugins.MdlfSound.diagnostics()` depuis l'inspecteur web de Safari).
///
/// Réactivité : activer une session audio est bloquant (Apple le déconseille sur le fil principal) et
/// le faire à chaque bip ralentissait la validation d'une série. Tout le travail audio passe donc sur une
/// file dédiée, et la session reste active entre les bips ; elle n'est rendue qu'après IDLE_RELEASE
/// secondes de silence (fin de séance, app en pause), sans gêner les autres apps puisqu'elle se mélange.
/// Les notes sont synthétisées à la volée (sinus avec décroissance), comme le faisait le Web Audio :
/// aucun fichier son à embarquer, les mélodies restent définies côté JS.
@objc(SoundPlugin)
public class SoundPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SoundPlugin"
    public let jsName = "MdlfSound"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        // Sa présence dit aussi au JS que « duck » est compris (js/platform/native.js, canDuck)
        CAPPluginMethod(name: "diagnostics", returnType: CAPPluginReturnPromise),
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
    @objc func play(_ call: CAPPluginCall) {
        let raw: [JSObject] = call.getArray("notes") as? [JSObject] ?? []
        let notes: [Note] = raw.compactMap { (n: JSObject) -> Note? in
            guard let f = n["freq"] as? Double, let s = n["start"] as? Double, let d = n["dur"] as? Double,
                  f > 20, f < 20_000, s >= 0, s < 5, d > 0, d < 2 else { return nil }
            let vol: Double = min(max(n["vol"] as? Double ?? 0.35, 0), 1)
            return Note(freq: f, start: s, dur: d, vol: vol)
        }
        guard !notes.isEmpty else { call.reject("Aucune note"); return }
        let duck: Bool = call.getBool("duck") ?? false
        // Réponse immédiate au JS : le son se prépare et se joue hors du fil principal
        call.resolve()
        audioQueue.async { [weak self] () -> Void in
            guard let self = self else { return }
            self.playNow(notes, duck: duck)
        }
    }

    /// État du module et derniers incidents (inspecteur web de Safari : diagnostic d'un iPhone muet)
    @objc func diagnostics(_ call: CAPPluginCall) {
        audioQueue.async { [weak self] () -> Void in
            guard let self = self else { call.resolve([:]); return }
            let session: AVAudioSession = AVAudioSession.sharedInstance()
            call.resolve([
                "journal": self.journal,
                "category": session.category.rawValue,
                "duckOthers": session.categoryOptions.contains(.duckOthers),
                "ducking": self.ducking,
                "sessionActive": self.sessionActive,
                "engineRunning": self.engine.isRunning,
                "otherAudioPlaying": session.isOtherAudioPlaying,
            ])
        }
    }

    // MARK: - Lecture (file audio)

    private func playNow(_ notes: [Note], duck: Bool) {
        do {
            try prepare(duck: duck)
            let buffer: AVAudioPCMBuffer = try render(notes)
            player.scheduleBuffer(buffer, at: nil, options: .interrupts, completionHandler: nil)
            // Sans effet si le lecteur joue déjà ; indispensable après un moteur relancé
            player.play()
            // Tout son joué pendant un duck repousse le retour de la musique après sa propre fin
            // (.interrupts : le dernier son programmé est celui qui finit le dernier)
            let duration: TimeInterval = Double(buffer.frameLength) / format.sampleRate
            if ducking { scheduleUnduck(after: duration + Self.DUCK_HOLD) }
            scheduleRelease()
        } catch {
            logError("lecture", error)
            // Tout est repris au son suivant : session réactivée, moteur relancé, musique rendue
            sessionActive = false
            if ducking { restoreMix() }
        }
    }

    /// Catégorie, session et moteur prêts à jouer. Le moteur arrêté par iOS (interruption, autre sortie
    /// audio) est relancé ici, au son suivant.
    private func prepare(duck: Bool) throws {
        let session: AVAudioSession = AVAudioSession.sharedInstance()
        // Passage en .duckOthers : la musique ne baisse qu'à l'activation de la session (AVAudioSession,
        // « duckOthers »), d'où la session rendue puis réactivée. Le retour sans duck se fait seulement
        // dans restoreMix (programmé) : un son ordinaire pendant le décompte joue sans rien changer.
        let wantsDuck: Bool = duck && !ducking
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
        if !attached {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            attached = true
        }
        if !engine.isRunning {
            engine.prepare()
            try engine.start()
        }
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
            guard let self = self else { return }
            self.audioQueue.async { [weak self] () -> Void in
                guard let self = self else { return }
                self.interrupted(rawType: type)
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
                self.remember("moteur reconfiguré par iOS (en marche : \(self.engine.isRunning))")
            }
        })
    }

    /// Appel, Siri, alarme… : iOS a coupé la session et arrêté le moteur. Tout est réactivé au son
    /// suivant ; un duck en cours est annulé tout de suite (la musique ne doit pas rester baissée).
    private func interrupted(rawType: UInt) {
        let began: Bool = AVAudioSession.InterruptionType(rawValue: rawType) == .began
        remember(began ? "interruption (début)" : "interruption (fin)")
        sessionActive = false
        if began && ducking { restoreMix() }
    }

    /// Écouteurs branchés ou débranchés, AirPods, CarPlay… : noté ; le moteur arrêté est relancé au son suivant
    private func routeChanged(rawReason: UInt) {
        let reason: AVAudioSession.RouteChangeReason = AVAudioSession.RouteChangeReason(rawValue: rawReason) ?? .unknown
        // .categoryChange n'est pas noté : le duck de chaque fin de repos en produirait deux
        if reason == .newDeviceAvailable || reason == .oldDeviceUnavailable {
            remember("sortie audio changée (raison \(rawReason))")
        }
    }

    /// Service audio d'iOS relancé : moteur et lecteur inutilisables, tout est recréé au son suivant
    /// (Apple, « Responding to audio session interruptions » : mediaServicesWereReset)
    private func rebuildEngine() {
        remember("service audio d'iOS relancé : moteur reconstruit")
        releaseWork?.cancel()
        unduckWork?.cancel()
        releaseWork = nil
        unduckWork = nil
        engine = AVAudioEngine()
        player = AVAudioPlayerNode()
        attached = false
        categorySet = false
        ducking = false
        sessionActive = false
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
