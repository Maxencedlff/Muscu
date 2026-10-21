import AVFoundation
import Capacitor

/// Bips de l'app (fin de repos, série validée, record) joués par iOS plutôt que par la vue web.
/// Côté web : Capacitor.registerPlugin('MdlfSound') (js/platform/native.js, Native.sound), appelé
/// par js/core/haptics-audio.js ; sans ce module (build plus ancienne), les bips restent en Web Audio.
///
/// Pourquoi natif : le Web Audio d'une vue web suit la session audio « ambiante » d'iOS, coupée par le
/// bouton silencieux. Ici la session est en lecture (.playback), donc audible en silencieux, et :
///  - .mixWithOthers : la musique (Apple Music, Spotify…) n'est jamais arrêtée ;
///  - .duckOthers    : elle baisse le temps du bip, puis remonte (désactivation avec notifyOthersOnDeactivation).
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
    /// Incrémenté à chaque mélodie : seule la dernière programmée rend la main à la musique
    private var generation = 0

    /// { notes: [{ freq, start, dur, vol? }] } : start et dur en secondes depuis le début de la mélodie
    @objc func play(_ call: CAPPluginCall) {
        let notes = (call.getArray("notes") as? [JSObject] ?? []).compactMap { n -> (Double, Double, Double, Double)? in
            guard let f = n["freq"] as? Double, let s = n["start"] as? Double, let d = n["dur"] as? Double,
                  f > 20, f < 20_000, s >= 0, s < 5, d > 0, d < 2 else { return nil }
            return (f, s, d, min(max(n["vol"] as? Double ?? 0.35, 0), 1))
        }
        guard !notes.isEmpty else { call.reject("Aucune note"); return }
        DispatchQueue.main.async {
            do {
                try self.start()
                let buffer = self.render(notes)
                self.generation += 1
                let gen = self.generation
                self.player.scheduleBuffer(buffer, at: nil, options: .interrupts) {
                    // Fin de la mélodie : la musique des autres apps reprend son volume
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                        guard gen == self.generation else { return }
                        // Moteur en pause d'abord : iOS refuse de désactiver une session aux E/S actives
                        self.engine.pause()
                        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                    }
                }
                if !self.player.isPlaying { self.player.play() }
                call.resolve()
            } catch {
                call.reject("Son indisponible : \(error.localizedDescription)", "FAILED", error)
            }
        }
    }

    private func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [.mixWithOthers, .duckOthers])
        try session.setActive(true)
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
