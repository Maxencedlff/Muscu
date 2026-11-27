// ═══════════════════════════════════════════════════════════
//  Transcription des dictées du corpus réel par SFSpeechRecognizer, sur macOS (tests/fixtures/plans/reels/SOURCES.md).
//  Vraie reconnaissance vocale sur un vrai son (voix de synthèse de macOS, `say`).
//
//  Mêmes réglages que ios/App/App/PlanDictationPlugin.swift : fr-FR, taskHint .dictation, addsPunctuation,
//  contextualStrings = planDictationWords('tout') (300 au plus), sur l'appareil dès que supportsOnDeviceRecognition.
//  Différence : le son vient d'un fichier (SFSpeechURLRecognitionRequest) et non du micro.
//
//  Construction (la reconnaissance vocale exige une description d'usage, mise dans le binaire) :
//    swiftc -O tools/plan-corpus/speech-transcribe.swift -o speech-transcribe \
//      -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker tools/plan-corpus/speech-Info.plist
//  ./speech-transcribe [--words mots.json] [--out dossier] [--allow-server] [--status] audio.wav …
//    --status        : rend seulement l'état (autorisation, hors ligne possible) en JSON, code 0 si utilisable
//    --allow-server  : accepte la reconnaissance par les serveurs d'Apple quand l'appareil ne sait pas le faire
//                      hors ligne (sinon refus OFFLINE_UNAVAILABLE, comme le plugin)
//  Un fichier <nom>.stt.json par audio : { id, tool, os, onDevice, text, segments, error, ms }
// ═══════════════════════════════════════════════════════════
import Foundation
import Speech

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

var args = Array(CommandLine.arguments.dropFirst())
var outDir = "."
var phrases: [String] = []
var allowServer = false
var statusOnly = false
var inputs: [String] = []
func nextArg(_ msg: String) -> String {
    guard !args.isEmpty else { fail(msg) }
    return args.removeFirst()
}
while !args.isEmpty {
    let a = args.removeFirst()
    switch a {
    case "--out": outDir = nextArg("--out sans dossier")
    case "--allow-server": allowServer = true
    case "--status": statusOnly = true
    case "--words":
        let p = nextArg("--words sans fichier")
        guard let d = FileManager.default.contents(atPath: p), let list = try? JSONSerialization.jsonObject(with: d) as? [String] else { fail("mots illisibles : \(p)") }
        var seen = Set<String>()
        for s in list {
            let w = s.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !w.isEmpty, w.count <= 60, seen.insert(w.lowercased()).inserted else { continue }
            phrases.append(w)
            if phrases.count == 300 { break }
        }
    default: inputs.append(a)
    }
}

/// Fait tourner la boucle principale (les réponses de Speech y arrivent) jusqu'à done() ou la limite
func spin(seconds: Double, until done: () -> Bool) {
    let end = Date().addingTimeInterval(seconds)
    while !done() && Date() < end { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
}

func statusName(_ s: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch s {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "notDetermined"
    }
}

// ── Autorisation (sans fenêtre possible en CI : accordée d'avance dans la base TCC, voir corpus-reel.yml) ──
var auth = SFSpeechRecognizer.authorizationStatus()
if auth == .notDetermined {
    var answered = false
    SFSpeechRecognizer.requestAuthorization { s in auth = s; answered = true }
    spin(seconds: 20) { answered }
}
let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "fr-FR"))
let onDeviceSupported = recognizer?.supportsOnDeviceRecognition ?? false
let osVersion = ProcessInfo.processInfo.operatingSystemVersionString
let status: [String: Any] = ["authorization": statusName(auth), "recognizer": recognizer != nil, "available": recognizer?.isAvailable ?? false,
                             "supportsOnDeviceRecognition": onDeviceSupported, "os": osVersion, "contextualStrings": phrases.count]
if statusOnly || inputs.isEmpty {
    print(String(data: try! JSONSerialization.data(withJSONObject: status, options: [.sortedKeys]), encoding: .utf8)!)
    exit(auth == .authorized && recognizer != nil && (onDeviceSupported || allowServer) ? 0 : 2)
}
guard auth == .authorized else { fail("Reconnaissance vocale non autorisée (\(statusName(auth)))") }
guard let rec = recognizer else { fail("Pas de reconnaissance fr-FR sur cette machine") }
guard onDeviceSupported || allowServer else { fail("OFFLINE_UNAVAILABLE : Dictée hors ligne indisponible sur cette machine") }
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

var failures = 0
for path in inputs {
    let url = URL(fileURLWithPath: path)
    let id = url.deletingPathExtension().lastPathComponent
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.requiresOnDeviceRecognition = onDeviceSupported
    request.shouldReportPartialResults = false
    request.taskHint = .dictation
    request.contextualStrings = phrases
    request.addsPunctuation = true
    let t0 = Date()
    var finished = false, text = "", segments: [[String: Any]] = [], errorText: String? = nil
    let task = rec.recognitionTask(with: request) { result, error in
        if let result {
            text = result.bestTranscription.formattedString
            segments = result.bestTranscription.segments.map {
                ["text": $0.substring, "confidence": (Double($0.confidence) * 1000).rounded() / 1000,
                 "timestamp": (Double($0.timestamp) * 100).rounded() / 100, "duration": (Double($0.duration) * 100).rounded() / 100]
            }
            if result.isFinal { finished = true }
        }
        if let error { errorText = error.localizedDescription; finished = true }
    }
    spin(seconds: 180) { finished }
    if !finished { task.cancel(); errorText = errorText ?? "délai dépassé" }
    if text.isEmpty { failures += 1 }
    let out: [String: Any] = ["id": id, "tool": "SFSpeechRecognizer fr-FR (SFSpeechURLRecognitionRequest, taskHint .dictation, addsPunctuation)",
                              "os": osVersion, "onDevice": onDeviceSupported, "contextualStrings": phrases.count, "text": text,
                              "segments": segments, "error": errorText.map { $0 as Any } ?? NSNull(), "ms": Int(Date().timeIntervalSince(t0) * 1000)]
    let data = try! JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
    FileManager.default.createFile(atPath: (outDir as NSString).appendingPathComponent("\(id).stt.json"), contents: data)
    print("\(id) : \(onDeviceSupported ? "sur la machine" : "serveurs Apple"), \(text.count) caractères\(errorText.map { ", erreur : \($0)" } ?? "")")
}
exit(failures == inputs.count ? 1 : 0)
