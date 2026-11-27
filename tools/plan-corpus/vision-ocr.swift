// ═══════════════════════════════════════════════════════════
//  Lecture Apple Vision des documents du corpus réel, sur macOS (tests/fixtures/plans/reels/SOURCES.md)
//
//  Mêmes réglages que ios/App/App/PlanReaderPlugin.swift (VNRecognizeTextRequest) :
//    .accurate, usesLanguageCorrection, recognitionLanguages fr-FR puis en-US, customWords = noms d'exercices
//    (planDictationWords('exercice'), 300 au plus), image à l'endroit sur fond blanc, 4 096 px au plus,
//    page de PDF rendue à ~300 points par pouce (A4 : 2 480 × 3 508).
//  Même sortie qu'une page du plugin : { width, height, text, lines: [{ text, confidence, box, words: [{ text, box }] }] },
//  boîtes de 0 à 1, origine EN HAUT à gauche.
//
//  swiftc -O tools/plan-corpus/vision-ocr.swift -o vision-ocr
//  ./vision-ocr --words mots.json --out sorties/ fichier.jpg fichier.pdf[:1,2] ...
//    (pages d'un PDF après « : », 1 = première ; sans liste : 20 pages au plus, comme readPdfScan)
//  Un fichier <nom>.ocr.json par entrée : { id, tool, os, languages, customWords, pages, ms }
// ═══════════════════════════════════════════════════════════
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import Vision

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

// ── Arguments ───────────────────────────────────────────────
var args = Array(CommandLine.arguments.dropFirst())
var outDir = "."
var customWords: [String] = []
var inputs: [String] = []
func nextArg(_ msg: String) -> String {
    guard !args.isEmpty else { fail(msg) }
    return args.removeFirst()
}
while !args.isEmpty {
    let a = args.removeFirst()
    switch a {
    case "--out": outDir = nextArg("--out sans dossier")
    case "--words":
        let p = nextArg("--words sans fichier")
        guard let d = FileManager.default.contents(atPath: p), let list = try? JSONSerialization.jsonObject(with: d) as? [String] else { fail("mots illisibles : \(p)") }
        // Même filtre que PlanReaderPlugin.customWords : 300 au plus, 60 caractères, sans doublon
        var seen = Set<String>()
        for s in list {
            let w = s.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !w.isEmpty, w.count <= 60, seen.insert(w.lowercased()).inserted else { continue }
            customWords.append(w)
            if customWords.count == 300 { break }
        }
    default: inputs.append(a)
    }
}
if inputs.isEmpty { fail("usage : vision-ocr [--words mots.json] [--out dossier] fichier.jpg fichier.pdf[:1,2] …") }
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

// ── Images (comme PlanReaderPlugin.upright et .render) ──────
/// Image à l'endroit (orientation EXIF appliquée par ImageIO), sur fond blanc, 4 096 px au plus sur le grand côté
func upright(_ src: CGImage, maxSide: Int = 4096) -> CGImage? {
    let f = min(1.0, Double(maxSide) / Double(max(src.width, src.height)))
    let w = max(1, Int((Double(src.width) * f).rounded())), h = max(1, Int((Double(src.height) * f).rounded()))
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.interpolationQuality = .high
    ctx.draw(src, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage()
}

func loadImage(_ url: URL) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let pw = props?[kCGImagePropertyPixelWidth] as? Int ?? 4096, ph = props?[kCGImagePropertyPixelHeight] as? Int ?? 4096
    // Vignette pleine taille avec la rotation EXIF appliquée (UIImage le fait sur l'iPhone)
    let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
                                 kCGImageSourceThumbnailMaxPixelSize: min(4096, max(pw, ph))]
    guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, opts as CFDictionary) else { return nil }
    return upright(cg)
}

/// Page de PDF rendue à environ 300 points par pouce, rotation de la page comprise (PDFPage.thumbnail, comme sur l'iPhone)
func render(_ page: PDFPage) -> CGImage? {
    let bounds = page.bounds(for: .cropBox)
    let turned = page.rotation % 180 != 0
    let pw = turned ? bounds.height : bounds.width, ph = turned ? bounds.width : bounds.height
    guard pw > 0, ph > 0 else { return nil }
    let scale = min(300.0 / 72.0, 3508 / max(pw, ph))
    let thumb = page.thumbnail(of: NSSize(width: pw * scale, height: ph * scale), for: .cropBox)
    var rect = NSRect(origin: .zero, size: thumb.size)
    guard let cg = thumb.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { return nil }
    return upright(cg)
}

// ── Vision (comme PlanReaderPlugin.recognize) ───────────────
func round4(_ v: Double) -> Double { (v * 10_000).rounded() / 10_000 }

func box(_ r: CGRect) -> [String: Double] {
    let x = max(0, min(1, Double(r.minX))), y = max(0, min(1, Double(1 - r.maxY)))
    return ["x": round4(x), "y": round4(y), "w": round4(max(0, min(1 - x, Double(r.width)))), "h": round4(max(0, min(1 - y, Double(r.height))))]
}

func words(of candidate: VNRecognizedText) -> [[String: Any]] {
    let s = candidate.string
    var out: [[String: Any]] = []
    var start: String.Index?
    func add(_ range: Range<String.Index>) {
        guard let rect = try? candidate.boundingBox(for: range)?.boundingBox else { return }
        out.append(["text": String(s[range]), "box": box(rect)])
    }
    var i = s.startIndex
    while i < s.endIndex {
        if s[i].isWhitespace {
            if let st = start { add(st..<i); start = nil }
        } else if start == nil {
            start = i
        }
        i = s.index(after: i)
    }
    if let st = start { add(st..<s.endIndex) }
    return out
}

var usedLanguages: [String] = []
func recognize(_ image: CGImage) throws -> [String: Any] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = false
    let wanted = ["fr-FR", "en-US"]
    let supported = (try? request.supportedRecognitionLanguages()) ?? wanted
    let languages = wanted.filter { supported.contains($0) }
    request.recognitionLanguages = languages.isEmpty ? wanted : languages
    usedLanguages = request.recognitionLanguages
    request.customWords = customWords
    try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])
    var lines: [[String: Any]] = []
    for observation in request.results ?? [] {
        guard let best = observation.topCandidates(1).first else { continue }
        let text = best.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { continue }
        lines.append(["text": text, "confidence": round4(Double(best.confidence)), "box": box(observation.boundingBox), "words": words(of: best)])
    }
    return ["width": image.width, "height": image.height, "text": lines.compactMap { $0["text"] as? String }.joined(separator: "\n"), "lines": lines]
}

// ── Boucle sur les fichiers ─────────────────────────────────
let osVersion = ProcessInfo.processInfo.operatingSystemVersionString
var failures = 0
for raw in inputs {
    var path = raw, wantedPages: [Int]? = nil
    if let colon = raw.range(of: ":", options: .backwards), raw.lowercased().contains(".pdf:") {
        path = String(raw[..<colon.lowerBound])
        wantedPages = raw[colon.upperBound...].split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
    }
    let url = URL(fileURLWithPath: path)
    let id = url.deletingPathExtension().lastPathComponent
    let t0 = Date()
    var pages: [[String: Any]] = []
    var extra: [String: Any] = [:]
    do {
        if url.pathExtension.lowercased() == "pdf" {
            guard let doc = PDFDocument(url: url), !doc.isLocked, doc.pageCount > 0 else { throw NSError(domain: "pdf", code: 1) }
            let list = wantedPages ?? Array(1...min(doc.pageCount, 20))
            extra["pageCount"] = doc.pageCount
            extra["pdfPages"] = list
            extra["hasTextLayer"] = !(doc.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            for n in list where n >= 1 && n <= doc.pageCount {
                try autoreleasepool {
                    guard let page = doc.page(at: n - 1), let cg = render(page) else { return }
                    pages.append(try recognize(cg))
                }
            }
        } else {
            guard let cg = loadImage(url) else { throw NSError(domain: "image", code: 1) }
            pages.append(try recognize(cg))
        }
    } catch {
        failures += 1
        FileHandle.standardError.write("\(id) : lecture impossible (\(error))\n".data(using: .utf8)!)
        continue
    }
    var out: [String: Any] = ["id": id, "tool": "Apple Vision VNRecognizeTextRequest (.accurate, usesLanguageCorrection)", "os": osVersion,
                              "languages": usedLanguages, "customWords": customWords.count, "pages": pages,
                              "ms": Int(Date().timeIntervalSince(t0) * 1000)]
    extra.forEach { out[$0.key] = $0.value }
    let data = try! JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
    FileManager.default.createFile(atPath: (outDir as NSString).appendingPathComponent("\(id).ocr.json"), contents: data)
    let n = pages.reduce(0) { $0 + (($1["lines"] as? [Any])?.count ?? 0) }
    print("\(id) : \(pages.count) page(s), \(n) lignes, \(out["ms"]!) ms")
}
exit(failures == inputs.count ? 1 : 0)
