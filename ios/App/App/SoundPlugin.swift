import AVFoundation
import Capacitor

/// Bips de l'app (fin de repos, série validée, record) joués par iOS plutôt que par la vue web.
/// Côté web : Capacitor.registerPlugin('MdlfSound') (js/platform/native.js, Native.sound), appelé
/// par js/core/haptics-audio.js ; sans ce module (build plus ancienne), les bips restent en Web Audio.
///
/// Pourquoi natif : le Web Audio d'une vue web suit la session audio « ambiante » d'iOS, coupée par le
/// bouton silencieux. Ici la session est en lecture (.playback, audible en silencieux) avec .mixWithOthers :
/// la musique (Apple Music, Spotify…) n'est jamais arrêtée ni baissée, le bip s'y ajoute.
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
    ]

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    private var attached = false
    private var sessionActive = false   // évite de réactiver la session (appel bloquant) à chaque bip

    // Tout le travail audio (session, moteur, tampons) se fait sur cette file, jamais sur le fil principal
    private let audioQueue = DispatchQueue(label: "mdlf.sound", qos: .userInitiated)
    private static let IDLE_RELEASE: TimeInterval = 90
    private var releaseWork: DispatchWorkItem?

    /// { notes: [{ freq, start, dur, vol? }] } : start et dur en secondes depuis le début de la mélodie
    @objc func play(_ call: CAPPluginCall) {
        let notes = (call.getArray("notes") as? [JSObject] ?? []).compactMap { n -> (Double, Double, Double, Double)? in
            guard let f = n["freq"] as? Double, let s = n["start"] as? Double, let d = n["dur"] as? Double,
                  f > 20, f < 20_000, s >= 0, s < 5, d > 0, d < 2 else { return nil }
            return (f, s, d, min(max(n["vol"] as? Double ?? 0.35, 0), 1))
        }
        guard !notes.isEmpty else { call.reject("Aucune note"); return }
        // Réponse immédiate au JS : le son se prépare et se joue hors du fil principal
        call.resolve()
        audioQueue.async {
            do {
                try self.start()
                self.player.scheduleBuffer(self.render(notes), at: nil, options: .interrupts, completionHandler: nil)
                if !self.player.isPlaying { self.player.play() }
                self.scheduleRelease()
            } catch {
                CAPLog.print("MdlfSound : son indisponible", error.localizedDescription)
            }
        }
    }

    /// Session rendue après un long silence (sur la file audio) ; repoussée à chaque bip
    private func scheduleRelease() {
        releaseWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.engine.pause()
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            self.sessionActive = false
        }
        releaseWork = work
        audioQueue.asyncAfter(deadline: .now() + Self.IDLE_RELEASE, execute: work)
    }

    private func start() throws {
        let session = AVAudioSession.sharedInstance()
        // Catégorie et activation seulement si nécessaire : la session reste active entre les bips
        if session.category != .playback || !session.categoryOptions.contains(.mixWithOthers) || session.categoryOptions.contains(.duckOthers) {
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        }
        // Moteur arrêté par iOS (appel, autre app) : la session a pu être coupée, on la réactive
        if !sessionActive || !engine.isRunning {
            try session.setActive(true)
            sessionActive = true
        }
        if !attached {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            attached = true
        }
        // Moteur arrêté par iOS (appel, autre app) : relancé à la demande
        if !engine.isRunning { try engine.start() }
    }

    /// Somme des notes dans un seul tampon : sinus à attaque courte (sans clic) puis décroissance
    /// exponentielle jusqu'à 0,001 sur la durée de la note, comme exponentialRampToValueAtTime côté web.
    private func render(_ notes: [(Double, Double, Double, Double)]) -> AVAudioPCMBuffer {
        let rate = format.sampleRate
        let total = notes.map { $0.1 + $0.2 }.max()! + 0.05
        let frames = AVAudioFrameCount(total * rate)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let out = buffer.floatChannelData![0]
        for i in 0..<Int(frames) { out[i] = 0 }
        for (freq, start, dur, vol) in notes {
            let first = Int(start * rate), count = Int(dur * rate)
            let decay = log(0.001) / Double(count)
            let attack = Int(0.004 * rate)
            for k in 0..<count where first + k < Int(frames) {
                let env = vol * exp(decay * Double(k)) * min(1, Double(k) / Double(attack))
                out[first + k] += Float(env * sin(2 * .pi * freq * Double(k) / rate))
            }
        }
        for i in 0..<Int(frames) { out[i] = max(-1, min(1, out[i])) }
        return buffer
    }
}
