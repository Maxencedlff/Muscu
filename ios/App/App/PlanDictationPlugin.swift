import AVFoundation
import Capacitor
import Speech
import UIKit

/// Dictée d'un programme d'entraînement en français, reconnue SUR L'IPHONE (SFSpeechRecognizer fr-FR,
/// requiresOnDeviceRecognition) : la voix ne quitte pas l'appareil. Côté web : js/platform/plan-reader.js
/// (PlanReader.dictation), qui rend le texte au moteur d'analyse (js/data/plan-parser.js) ; contrat dans IOS.md,
/// « Import d'un programme ».
///
/// Jamais de bascule silencieuse vers les serveurs d'Apple : un iPhone qui ne sait pas reconnaître le français hors
/// ligne refuse avec OFFLINE_UNAVAILABLE (« Dictée hors ligne indisponible sur cet appareil »). La reconnaissance en
/// ligne n'est possible qu'avec allowServer: true, que le JS n'envoie qu'après un accord explicite de l'utilisateur.
///
/// Méthodes :
///   status()     → { available, onDevice, locale, speech, microphone } sans rien demander ; speech et microphone :
///                  "authorized" | "denied" | "restricted" | "notDetermined"
///   authorize()  → mêmes champs, après les fenêtres d'iOS (reconnaissance vocale, puis micro)
///   start({ contextualStrings?, allowServer?, partial?, punctuation?, maxSeconds? })
///                → { started: true, onDevice } une fois le micro ouvert
///   stop()       → { text, segments, onDevice } : fin de la parole, attend le texte définitif (3 s au plus)
///   cancel()     → {} : tout est jeté, aucun événement final
/// Événements : "partial" { text }, "final" { text, segments: [{ text, confidence, timestamp, duration }], onDevice },
/// "error" { code, message } (la dictée est alors finie).
/// Rejets de start : OFFLINE_UNAVAILABLE, DENIED (micro ou reconnaissance refusés), UNAVAILABLE (pas de micro,
/// reconnaissance momentanément indisponible), BUSY (dictée déjà en cours), FAILED.
@objc(PlanDictationPlugin)
public class PlanDictationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PlanDictationPlugin"
    public let jsName = "MdlfPlanDictation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    static let offlineMessage = "Dictée hors ligne indisponible sur cet appareil"
    static let locale = "fr-FR"

    private lazy var recognizer: SFSpeechRecognizer? = {
        let r = SFSpeechRecognizer(locale: Locale(identifier: PlanDictationPlugin.locale))
        r?.queue = .main   // résultats sur le fil principal, comme tout l'état ci-dessous
        return r
    }()

    // État d'une dictée, lu et écrit sur le fil principal seulement
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var onDevice = false
    /// Numéro de la dictée : un résultat tardif d'une dictée annulée n'est jamais pris pour celui de la suivante
    private var generation = 0
    private var lastText = ""
    private var stopCalls: [CAPPluginCall] = []
    private var stopTimer: Timer?
    private var limitTimer: Timer?
    private var observers: [NSObjectProtocol] = []
    private var savedAudio: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?

    // MARK: - Autorisations

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.statusPayload()) }
    }

    @objc func authorize(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { _ in
            PlanDictationPlugin.requestMicrophone { _ in
                DispatchQueue.main.async { call.resolve(self.statusPayload()) }
            }
        }
    }

    private func statusPayload() -> [String: Any] {
        [
            "available": recognizer?.isAvailable ?? false,
            "onDevice": recognizer?.supportsOnDeviceRecognition ?? false,
            "locale": PlanDictationPlugin.locale,
            "speech": PlanDictationPlugin.speechStatus(),
            "microphone": PlanDictationPlugin.microphoneStatus(),
        ]
    }

    static func speechStatus() -> String {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        default: return "notDetermined"
        }
    }

    static func microphoneStatus() -> String {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: return "authorized"
            case .denied: return "denied"
            default: return "notDetermined"
            }
        }
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return "authorized"
        case .denied: return "denied"
        default: return "notDetermined"
        }
    }

    static func requestMicrophone(_ done: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: done)
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission(done)
        }
    }

    /// Demande ce qui n'a jamais été demandé, puis rend nil si tout est accordé, sinon le code de rejet
    private func ensureAuthorized(_ done: @escaping (String?) -> Void) {
        let afterSpeech = {
            switch PlanDictationPlugin.microphoneStatus() {
            case "authorized": done(nil)
            case "notDetermined": PlanDictationPlugin.requestMicrophone { ok in DispatchQueue.main.async { done(ok ? nil : "DENIED") } }
            default: done("DENIED")
            }
        }
        switch PlanDictationPlugin.speechStatus() {
        case "authorized": afterSpeech()
        case "notDetermined":
            SFSpeechRecognizer.requestAuthorization { s in
                DispatchQueue.main.async { if s == .authorized { afterSpeech() } else { done("DENIED") } }
            }
        default: done("DENIED")
        }
    }

    // MARK: - Dictée

    @objc func start(_ call: CAPPluginCall) {
        // Seul un true explicite autorise les serveurs d'Apple (accord donné dans l'app) ; absent, faux ou autre : non
        let allowServer = call.getBool("allowServer") == true
        let partial = call.getBool("partial") ?? true
        let punctuation = call.getBool("punctuation") ?? true
        let maxSeconds = Double(max(10, min(call.getInt("maxSeconds") ?? 300, 900)))
        let phrases = PlanDictationPlugin.contextualStrings(call)
        DispatchQueue.main.async {
            guard self.task == nil else { call.reject("Dictée déjà en cours", "BUSY"); return }
            guard let recognizer = self.recognizer else { call.reject("Dictée indisponible", "UNAVAILABLE"); return }
            let local = recognizer.supportsOnDeviceRecognition
            guard local || allowServer else { call.reject(PlanDictationPlugin.offlineMessage, "OFFLINE_UNAVAILABLE"); return }
            self.ensureAuthorized { refused in
                if let code = refused { call.reject("Micro ou reconnaissance vocale refusés", code); return }
                guard self.task == nil else { call.reject("Dictée déjà en cours", "BUSY"); return }
                guard recognizer.isAvailable else { call.reject("Dictée momentanément indisponible", "UNAVAILABLE"); return }
                do {
                    try self.begin(recognizer, onDevice: local, partial: partial, punctuation: punctuation, phrases: phrases)
                } catch let code as DictationError {
                    self.teardown()
                    call.reject(code.message, code.code)
                    return
                } catch {
                    self.teardown()
                    call.reject("Micro indisponible", "FAILED")
                    return
                }
                self.limitTimer = Timer.scheduledTimer(withTimeInterval: maxSeconds, repeats: false) { [weak self] _ in self?.endAudio() }
                call.resolve(["started": true, "onDevice": local])
            }
        }
    }

    struct DictationError: Error { let code: String; let message: String }

    private func begin(_ recognizer: SFSpeechRecognizer, onDevice local: Bool, partial: Bool, punctuation: Bool, phrases: [String]) throws {
        let session = AVAudioSession.sharedInstance()
        savedAudio = (session.category, session.mode, session.categoryOptions)
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        // Sur l'iPhone dès qu'il en est capable, même si l'utilisateur a accepté les serveurs
        request.requiresOnDeviceRecognition = local
        request.shouldReportPartialResults = partial
        request.taskHint = .dictation
        request.contextualStrings = phrases
        request.addsPunctuation = punctuation

        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw DictationError(code: "UNAVAILABLE", message: "Pas de micro") }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        engine.prepare()
        try engine.start()

        self.engine = engine
        self.request = request
        self.onDevice = local
        self.lastText = ""
        generation += 1
        let current = generation
        self.task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async { self?.handle(result, error, generation: current) }
        }
        let center = NotificationCenter.default
        // Appel, Siri, alarme ou app en arrière-plan : la dictée s'arrête et rend ce qui a été dit
        observers = [
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
                let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                if raw == AVAudioSession.InterruptionType.began.rawValue { self?.endAudio() }
            },
            center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                self?.endAudio()
            },
        ]
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.task != nil else { call.resolve(["text": "", "segments": [], "onDevice": self.onDevice]); return }
            self.stopCalls.append(call)
            self.endAudio()
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.task?.cancel()
            let waiting = self.stopCalls
            self.stopCalls = []
            self.teardown()
            for c in waiting { c.reject("Dictée annulée", "CANCELED") }
            call.resolve()
        }
    }

    /// Fin de la parole : le micro se ferme, la reconnaissance rend son texte définitif (ou, faute de réponse en 3 s,
    /// le dernier texte partiel)
    private func endAudio() {
        guard task != nil, stopTimer == nil else { return }
        engine?.stop()
        engine?.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        stopTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            self.finish(["text": self.lastText, "segments": [], "onDevice": self.onDevice])
        }
    }

    private func handle(_ result: SFSpeechRecognitionResult?, _ error: Error?, generation current: Int) {
        guard task != nil, current == generation else { return }
        if let result = result {
            lastText = result.bestTranscription.formattedString
            if result.isFinal {
                let segments: [[String: Any]] = result.bestTranscription.segments.map {
                    ["text": $0.substring, "confidence": Double($0.confidence), "timestamp": $0.timestamp, "duration": $0.duration]
                }
                finish(["text": lastText, "segments": segments, "onDevice": onDevice])
                return
            }
            notifyListeners("partial", data: ["text": lastText])
        }
        guard let error = error as NSError? else { return }
        // Arrêt demandé, ou rien entendu (kAFAssistantErrorDomain 1110) : fin normale avec ce qui a été compris
        if stopTimer != nil || (error.domain == "kAFAssistantErrorDomain" && error.code == 1110) {
            finish(["text": lastText, "segments": [], "onDevice": onDevice])
            return
        }
        let waiting = stopCalls
        stopCalls = []
        teardown()
        notifyListeners("error", data: ["code": "FAILED", "message": "La dictée s'est arrêtée"])
        for c in waiting { c.resolve(["text": lastText, "segments": [], "onDevice": onDevice]) }
    }

    private func finish(_ payload: [String: Any]) {
        guard task != nil else { return }
        let waiting = stopCalls
        stopCalls = []
        teardown()
        notifyListeners("final", data: payload)
        for c in waiting { c.resolve(payload) }
    }

    /// Micro fermé, reconnaissance arrêtée, session audio rendue telle qu'elle était (les sons de fin de repos de
    /// SoundPlugin.swift reprennent leur catégorie .playback)
    private func teardown() {
        stopTimer?.invalidate()
        stopTimer = nil
        limitTimer?.invalidate()
        limitTimer = nil
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers = []
        if let engine = engine {
            if engine.isRunning { engine.stop() }
            engine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.finish()
        task = nil
        request = nil
        engine = nil
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        if let saved = savedAudio { try? session.setCategory(saved.0, mode: saved.1, options: saved.2) }
        savedAudio = nil
    }

    /// Noms et alias des exercices de la bibliothèque, envoyés par le JS : 300 au plus (Apple conseille une liste
    /// courte), 60 caractères chacun, sans doublon
    static func contextualStrings(_ call: CAPPluginCall) -> [String] {
        let raw = (call.options["contextualStrings"] as? [Any]) ?? []
        var seen = Set<String>()
        var out: [String] = []
        for case let s as String in raw {
            let w = s.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !w.isEmpty, w.count <= 60, seen.insert(w.lowercased()).inserted else { continue }
            out.append(w)
            if out.count == 300 { break }
        }
        return out
    }
}
