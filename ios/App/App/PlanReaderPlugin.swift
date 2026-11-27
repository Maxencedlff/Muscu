import AVFoundation
import Capacitor
import PDFKit
import PhotosUI
import UIKit
import UniformTypeIdentifiers
import Vision
import VisionKit

/// Lecture d'un programme d'entraînement sur papier, en photo, en capture d'écran ou en PDF scanné, entièrement sur
/// l'iPhone (Apple Vision, VNRecognizeTextRequest) : aucune image ni aucun texte ne quitte l'appareil, aucun service
/// payant. Côté web : js/platform/plan-reader.js (PlanReader), qui rend le texte au moteur d'analyse
/// (js/data/plan-parser.js) ; contrat complet dans IOS.md, « Import d'un programme ».
///
/// Pourquoi Vision plutôt qu'un paquet npm ou un service en ligne : gratuit, hors ligne, imprimé et manuscrit dans le
/// même mode « précis », français et anglais, et des boîtes par ligne et par mot qui permettent au JS de reconstruire
/// les colonnes d'un tableau (exercice | séries | répétitions | repos).
///
/// Méthodes (toutes rendent une ou plusieurs « pages ») :
///   sources()                       → { photos, camera, scan } : ce que l'appareil sait ouvrir (simulateur : photos seul)
///   pick({ source, limit?, customWords? })
///                                   → { source, pages } ; source "photos" (PHPicker, sans autorisation, 1 à 10 images),
///                                     "camera" (appareil photo) ou "scan" (outil de numérisation d'iOS,
///                                     VNDocumentCameraViewController : feuille détourée et redressée, plusieurs pages)
///   readImage({ path | base64, customWords? })   → { pages: [page] }
///   readPdfScan({ path | base64, maxPages?, customWords? })
///                                   → { pages, pageCount, truncated, hasTextLayer } : chaque page rendue en image (PDFKit)
///                                     puis lue par Vision ; hasTextLayer dit que le PDF contenait déjà du texte
/// page = { width, height, text, lines: [{ text, confidence, box, words: [{ text, box }] }] } ; box = { x, y, w, h }
/// normalisée de 0 à 1, origine EN HAUT à gauche (comme le web ; Vision compte depuis le bas, converti ici). width et
/// height en pixels de l'image lue, à l'endroit. customWords : noms d'exercices qui aident la correction linguistique.
/// Rejets : CANCELED (fermé sans rien choisir), DENIED (appareil photo refusé), UNAVAILABLE (source absente, simulateur),
/// BUSY (un choix déjà ouvert), INVALID (entrée illisible ou hors de l'app), LOCKED (PDF protégé), FAILED (le reste).
@objc(PlanReaderPlugin)
public class PlanReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PlanReaderPlugin"
    public let jsName = "MdlfPlanReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sources", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readPdfScan", returnType: CAPPluginReturnPromise),
    ]

    /// Lecture hors du fil principal, une à la fois (Vision en mode précis prend 0,5 à 2 s par page)
    private let queue = DispatchQueue(label: "mdlf.planreader", qos: .userInitiated)
    /// Choix d'image en cours (retenu tant que la fenêtre d'iOS est ouverte)
    private var picker: PlanPicker?

    static let maxPhotos = 10
    static let maxScanPages = 30
    static let maxPdfPages = 50
    static let maxInputBytes = 40 * 1024 * 1024

    @objc func sources(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve([
                "photos": true,
                "camera": UIImagePickerController.isSourceTypeAvailable(.camera),
                "scan": VNDocumentCameraViewController.isSupported,
            ])
        }
    }

    @objc func pick(_ call: CAPPluginCall) {
        let source = call.getString("source") ?? ""
        let words = PlanReaderPlugin.customWords(call)
        let limit = max(1, min(call.getInt("limit") ?? 5, PlanReaderPlugin.maxPhotos))
        guard ["photos", "camera", "scan"].contains(source) else {
            call.reject("Source inconnue", "INVALID")
            return
        }
        DispatchQueue.main.async {
            guard self.picker == nil, let host = self.bridge?.viewController else {
                call.reject("Un choix est déjà ouvert", "BUSY")
                return
            }
            if source == "camera" && !UIImagePickerController.isSourceTypeAvailable(.camera) {
                call.reject("Pas d'appareil photo", "UNAVAILABLE")
                return
            }
            if source == "scan" && !VNDocumentCameraViewController.isSupported {
                call.reject("Numérisation indisponible sur cet appareil", "UNAVAILABLE")
                return
            }
            let present: () -> Void = {
                var top = host
                while let p = top.presentedViewController { top = p }
                let picker = PlanPicker(source: source, limit: limit) { [weak self] outcome in
                    self?.picker = nil
                    switch outcome {
                    case .canceled: call.reject("Annulé", "CANCELED")
                    case .failed: call.reject("Image illisible", "FAILED")
                    case .images(let images):
                        self?.queue.async {
                            let pages = images.prefix(PlanReaderPlugin.maxScanPages).compactMap { image -> [String: Any]? in
                                autoreleasepool { PlanReaderPlugin.upright(image).flatMap { try? PlanReaderPlugin.recognize($0, customWords: words) } }
                            }
                            if pages.isEmpty { call.reject("Image illisible", "FAILED") } else { call.resolve(["source": source, "pages": pages]) }
                        }
                    }
                }
                self.picker = picker
                picker.present(on: top)
            }
            // Photos : PHPicker tourne hors de l'app, aucune autorisation. Appareil photo et numérisation : celle de la caméra.
            guard source != "photos" else { present(); return }
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: present()
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { ok in
                    DispatchQueue.main.async { if ok { present() } else { call.reject("Appareil photo refusé", "DENIED") } }
                }
            default: call.reject("Appareil photo refusé", "DENIED")
            }
        }
    }

    @objc func readImage(_ call: CAPPluginCall) {
        let words = PlanReaderPlugin.customWords(call)
        guard let data = input(call) else { return }
        queue.async {
            guard let image = UIImage(data: data), let cg = PlanReaderPlugin.upright(image) else {
                call.reject("Image illisible", "INVALID")
                return
            }
            do { call.resolve(["pages": [try PlanReaderPlugin.recognize(cg, customWords: words)]]) } catch { call.reject("Lecture impossible", "FAILED") }
        }
    }

    @objc func readPdfScan(_ call: CAPPluginCall) {
        let words = PlanReaderPlugin.customWords(call)
        let maxPages = max(1, min(call.getInt("maxPages") ?? 20, PlanReaderPlugin.maxPdfPages))
        guard let data = input(call) else { return }
        queue.async {
            guard let doc = PDFDocument(data: data) else {
                call.reject("PDF illisible", "INVALID")
                return
            }
            guard !doc.isLocked else {
                call.reject("PDF protégé par un mot de passe", "LOCKED")
                return
            }
            let count = doc.pageCount
            guard count > 0 else {
                call.reject("PDF vide", "INVALID")
                return
            }
            let hasTextLayer = !(doc.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            var pages: [[String: Any]] = []
            for i in 0..<min(count, maxPages) {
                autoreleasepool {
                    guard let page = doc.page(at: i), let cg = PlanReaderPlugin.render(page) else { return }
                    if let read = try? PlanReaderPlugin.recognize(cg, customWords: words) { pages.append(read) }
                }
            }
            if pages.isEmpty { call.reject("Lecture impossible", "FAILED"); return }
            call.resolve(["pages": pages, "pageCount": count, "truncated": count > maxPages, "hasTextLayer": hasTextLayer])
        }
    }

    // MARK: - Entrées

    /// Octets de l'image ou du PDF : base64 (data URL acceptée) ou chemin d'un fichier DE L'APP (jamais ailleurs :
    /// une mise à jour à chaud compromise ne doit pas pouvoir lire un autre fichier que ceux du conteneur de l'app).
    /// Rejette l'appel et rend nil si l'entrée ne convient pas.
    private func input(_ call: CAPPluginCall) -> Data? {
        if var b64 = call.getString("base64"), !b64.isEmpty {
            if b64.hasPrefix("data:"), let comma = b64.firstIndex(of: ",") { b64 = String(b64[b64.index(after: comma)...]) }
            guard b64.count <= PlanReaderPlugin.maxInputBytes / 3 * 4 + 4,
                  let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters), !data.isEmpty else {
                call.reject("Fichier illisible ou trop gros", "INVALID")
                return nil
            }
            return data
        }
        guard let raw = call.getString("path"), !raw.isEmpty, let url = PlanReaderPlugin.appFileURL(raw) else {
            call.reject("Fichier introuvable", "INVALID")
            return nil
        }
        // Lu par un FileHandle borné : aucune lecture des attributs du fichier (API à motif déclaré du manifeste de confidentialité)
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            call.reject("Fichier introuvable", "INVALID")
            return nil
        }
        defer { try? handle.close() }
        guard let data = try? handle.read(upToCount: PlanReaderPlugin.maxInputBytes + 1),
              !data.isEmpty, data.count <= PlanReaderPlugin.maxInputBytes else {
            call.reject("Fichier illisible ou trop gros", "INVALID")
            return nil
        }
        return data
    }

    /// Chemin brut, URL file:// ou adresse web d'un fichier local (capacitor://localhost/_capacitor_file_/…), ramené à
    /// un fichier du conteneur de l'app ; nil sinon
    static func appFileURL(_ raw: String) -> URL? {
        var path = raw
        if let r = raw.range(of: "/_capacitor_file_") { path = String(raw[r.upperBound...]) }
        else if raw.hasPrefix("file://") { path = URL(string: raw)?.path ?? "" }
        path = path.removingPercentEncoding ?? path
        guard path.hasPrefix("/") else { return nil }
        let url = URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath()
        let home = URL(fileURLWithPath: NSHomeDirectory()).standardizedFileURL.resolvingSymlinksInPath().path
        guard url.path.hasPrefix(home + "/") else { return nil }
        return url
    }

    /// Noms d'exercices transmis par le JS (vocabulaire de la correction linguistique) : 300 au plus, 60 caractères
    static func customWords(_ call: CAPPluginCall) -> [String] {
        let raw = (call.options["customWords"] as? [Any]) ?? []
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

    // MARK: - Images

    /// Image à l'endroit (orientation EXIF appliquée), sur fond blanc (un PNG transparent ne devient pas noir sur noir),
    /// 4 096 pixels au plus sur le grand côté
    static func upright(_ image: UIImage, maxSide: CGFloat = 4096) -> CGImage? {
        let w = image.size.width * image.scale, h = image.size.height * image.scale
        guard w >= 1, h >= 1 else { return nil }
        let f = min(1, maxSide / max(w, h))
        let size = CGSize(width: max(1, (w * f).rounded()), height: max(1, (h * f).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let out = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return out.cgImage
    }

    /// Page de PDF rendue à environ 300 points par pouce (A4 : 2 480 × 3 508), rotation de la page comprise
    static func render(_ page: PDFPage) -> CGImage? {
        let bounds = page.bounds(for: .cropBox)
        let turned = page.rotation % 180 != 0
        let pw = turned ? bounds.height : bounds.width, ph = turned ? bounds.width : bounds.height
        guard pw > 0, ph > 0 else { return nil }
        let scale = min(300.0 / 72.0, 3508 / max(pw, ph))
        let thumb = page.thumbnail(of: CGSize(width: pw * scale, height: ph * scale), for: .cropBox)
        return upright(thumb)
    }

    // MARK: - Vision

    /// Texte de l'image : lignes (texte, confiance, boîte) et mots (texte, boîte), boîtes à l'origine en haut à gauche
    static func recognize(_ image: CGImage, customWords: [String]) throws -> [String: Any] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate          // imprimé ET manuscrit (le mode rapide ne lit pas l'écriture)
        request.usesLanguageCorrection = true
        request.automaticallyDetectsLanguage = false
        let wanted = ["fr-FR", "en-US"]
        let supported = (try? request.supportedRecognitionLanguages()) ?? wanted
        let languages = wanted.filter { supported.contains($0) }
        request.recognitionLanguages = languages.isEmpty ? wanted : languages
        request.customWords = customWords
        try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])

        var lines: [[String: Any]] = []
        for observation in request.results ?? [] {
            guard let best = observation.topCandidates(1).first else { continue }
            let text = best.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            lines.append([
                "text": text,
                "confidence": round4(Double(best.confidence)),
                "box": box(observation.boundingBox),
                "words": words(of: best),
            ])
        }
        return [
            "width": image.width,
            "height": image.height,
            "text": lines.compactMap { $0["text"] as? String }.joined(separator: "\n"),
            "lines": lines,
        ]
    }

    /// Mots de la ligne : suites de caractères sans espace (« 4x10 », « 12-10-8 » et « 90s » restent entiers)
    static func words(of candidate: VNRecognizedText) -> [[String: Any]] {
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

    /// Boîte de Vision (origine en bas à gauche) → origine en haut à gauche, bornée à [0, 1]
    static func box(_ r: CGRect) -> [String: Double] {
        let x = max(0, min(1, Double(r.minX))), y = max(0, min(1, Double(1 - r.maxY)))
        return [
            "x": round4(x),
            "y": round4(y),
            "w": round4(max(0, min(1 - x, Double(r.width)))),
            "h": round4(max(0, min(1 - y, Double(r.height)))),
        ]
    }

    static func round4(_ v: Double) -> Double { (v * 10_000).rounded() / 10_000 }
}

/// Fenêtres d'iOS qui fournissent les images : PHPicker (photothèque), appareil photo, numérisation de documents.
/// Rend une seule issue, une seule fois, même si la fenêtre est refermée d'un glissement.
final class PlanPicker: NSObject, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate,
                        VNDocumentCameraViewControllerDelegate, UIAdaptivePresentationControllerDelegate {
    enum Outcome { case images([UIImage]), canceled, failed }

    private let source: String
    private let limit: Int
    private let finish: (Outcome) -> Void
    private var done = false

    init(source: String, limit: Int, finish: @escaping (Outcome) -> Void) {
        self.source = source
        self.limit = limit
        self.finish = finish
    }

    func present(on host: UIViewController) {
        let vc: UIViewController
        switch source {
        case "camera":
            let camera = UIImagePickerController()
            camera.sourceType = .camera
            camera.mediaTypes = [UTType.image.identifier]
            camera.delegate = self
            vc = camera
        case "scan":
            let scanner = VNDocumentCameraViewController()
            scanner.delegate = self
            vc = scanner
        default:
            var config = PHPickerConfiguration()
            config.filter = .images
            config.selectionLimit = limit
            config.preferredAssetRepresentationMode = .current
            let photos = PHPickerViewController(configuration: config)
            photos.delegate = self
            vc = photos
        }
        if source != "photos" { vc.modalPresentationStyle = .fullScreen }
        host.present(vc, animated: true) { vc.presentationController?.delegate = self }
    }

    private func end(_ vc: UIViewController?, _ outcome: Outcome) {
        guard !done else { return }
        done = true
        if let vc = vc, vc.presentingViewController != nil {
            vc.dismiss(animated: true) { self.finish(outcome) }
        } else {
            finish(outcome)
        }
    }

    // Fenêtre refermée d'un glissement vers le bas
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { end(nil, .canceled) }

    // MARK: Photothèque

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        guard !results.isEmpty else { end(picker, .canceled); return }
        var images = [UIImage?](repeating: nil, count: results.count)
        let group = DispatchGroup()
        for (i, result) in results.enumerated() where result.itemProvider.canLoadObject(ofClass: UIImage.self) {
            group.enter()
            result.itemProvider.loadObject(ofClass: UIImage.self) { object, _ in
                DispatchQueue.main.async {
                    images[i] = object as? UIImage
                    group.leave()
                }
            }
        }
        group.notify(queue: .main) {
            let found = images.compactMap { $0 }
            self.end(picker, found.isEmpty ? .failed : .images(found))
        }
    }

    // MARK: Appareil photo

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        if let image = info[.originalImage] as? UIImage { end(picker, .images([image])) } else { end(picker, .failed) }
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { end(picker, .canceled) }

    // MARK: Numérisation de documents

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        let images = (0..<min(scan.pageCount, PlanReaderPlugin.maxScanPages)).map { scan.imageOfPage(at: $0) }
        end(controller, images.isEmpty ? .canceled : .images(images))
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { end(controller, .canceled) }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { end(controller, .failed) }
}
