import AVFoundation
import UIKit
import Capacitor

/// Lecture du code-barres d'un produit alimentaire (EAN-13, EAN-8, UPC-A, UPC-E) par l'appareil photo.
/// Côté web : Capacitor.registerPlugin('MdlfScanner') (js/platform/native.js, Native.scanner), appelé par
/// js/features/food-scan-ui.js ; la recherche du produit (Open Food Facts) et son analyse sont en JS
/// (js/data/food-scan.js).
///
/// Pourquoi un module maison plutôt qu'un paquet npm : AVFoundation (AVCaptureMetadataOutput) lit ces codes
/// sur tous les iPhone de l'app (iOS 16.4 et plus), sans SDK tiers ni collecte (rien à ajouter au manifeste
/// de confidentialité) et sans dépendance à suivre. Les images de la caméra ne quittent jamais l'iPhone : seul
/// le numéro lu est rendu au JS. UPC-A arrive d'iOS en EAN-13 précédé d'un 0 ; UPC-E est rendu tel quel avec
/// son type, le JS le déplie.
///
/// scan() → { code, type: "ean13" | "ean8" | "upce" } ; rejet avec le code CANCELED (fermé sans lire),
/// DENIED (accès à la caméra refusé), UNAVAILABLE (pas de caméra, simulateur) ou FAILED.
@objc(ScannerPlugin)
public class ScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScannerPlugin"
    public let jsName = "MdlfScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
    ]

    private weak var current: ScannerViewController?

    @objc func scan(_ call: CAPPluginCall) {
        guard AVCaptureDevice.default(for: .video) != nil else {
            call.reject("Pas de caméra", "UNAVAILABLE")
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            presentScanner(call)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in
                DispatchQueue.main.async {
                    if ok { self.presentScanner(call) } else { call.reject("Caméra refusée", "DENIED") }
                }
            }
        default:
            call.reject("Caméra refusée", "DENIED")
        }
    }

    private func presentScanner(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.current == nil, let host = self.bridge?.viewController else {
                call.reject("Lecteur déjà ouvert", "FAILED")
                return
            }
            let vc = ScannerViewController { result in
                switch result {
                case .found(let code, let type): call.resolve(["code": code, "type": type])
                case .canceled: call.reject("Annulé", "CANCELED")
                case .failed: call.reject("Caméra indisponible", "FAILED")
                }
            }
            vc.modalPresentationStyle = .fullScreen
            self.current = vc
            // Au-dessus de ce qui est déjà présenté (feuille de partage, etc.)
            var top = host
            while let p = top.presentedViewController { top = p }
            top.present(vc, animated: true)
        }
    }
}

/// Plein écran noir : l'image de la caméra, un cadre de visée, une consigne et « Annuler ».
/// Un code lu une fois ferme le lecteur (vibration de succès) ; VoiceOver annonce l'ouverture.
final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    enum Result { case found(String, String), canceled, failed }

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "mdlf.scanner", qos: .userInitiated)
    private var preview: AVCaptureVideoPreviewLayer?
    private let frameView = UIView()
    private var done = false
    private var configured = false
    private let finish: (Result) -> Void

    init(finish: @escaping (Result) -> Void) {
        self.finish = finish
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) non utilisé") }

    override var prefersStatusBarHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        configured = configure()
        guard configured else { return }   // fermé dans viewDidAppear, une fois la présentation finie
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        preview = layer

        frameView.layer.borderColor = UIColor.white.cgColor
        frameView.layer.borderWidth = 3
        frameView.layer.cornerRadius = 16
        frameView.isAccessibilityElement = false
        view.addSubview(frameView)

        let hint = UILabel()
        hint.text = "Vise le code-barres, à une vingtaine de centimètres"
        hint.textColor = .white
        hint.font = UIFont.preferredFont(forTextStyle: .headline)
        hint.adjustsFontForContentSizeCategory = true
        hint.numberOfLines = 0
        hint.textAlignment = .center
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)

        var cfg = UIButton.Configuration.filled()
        cfg.title = "Annuler"
        cfg.baseBackgroundColor = UIColor(white: 0.17, alpha: 1)
        cfg.baseForegroundColor = .white
        cfg.cornerStyle = .capsule
        cfg.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 28, bottom: 14, trailing: 28)
        cfg.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var out = incoming
            out.font = UIFont.preferredFont(forTextStyle: .headline)
            return out
        }
        let cancel = UIButton(configuration: cfg)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.addAction(UIAction { [weak self] _ in self?.close(.canceled) }, for: .touchUpInside)
        view.addSubview(cancel)

        NSLayoutConstraint.activate([
            hint.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            hint.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            hint.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cancel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            cancel.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
        let w = min(view.bounds.width - 48, 360)
        frameView.frame = CGRect(x: (view.bounds.width - w) / 2, y: view.bounds.midY - w * 0.3, width: w, height: w * 0.6)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard configured else { close(.failed); return }
        sessionQueue.async { if !self.session.isRunning { self.session.startRunning() } }
        UIAccessibility.post(notification: .screenChanged, argument: "Lecteur de code-barres. Vise le code-barres, à une vingtaine de centimètres.")
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { if self.session.isRunning { self.session.stopRunning() } }
    }

    // Geste d'échappement de VoiceOver (deux doigts en Z) : comme « Annuler »
    override func accessibilityPerformEscape() -> Bool { close(.canceled); return true }

    private func configure() -> Bool {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                ?? AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return false }
        session.beginConfiguration()
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { session.commitConfiguration(); return false }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        let wanted: [AVMetadataObject.ObjectType] = [.ean13, .ean8, .upce]
        output.metadataObjectTypes = wanted.filter { output.availableMetadataObjectTypes.contains($0) }
        session.commitConfiguration()
        // Mise au point rapprochée (un paquet tenu à 10 cm)
        if (try? device.lockForConfiguration()) != nil {
            if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
            if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
            // iPhone 13 Pro et suivants : l'objectif grand-angle ne fait pas la mise au point sous ~20 cm, un
            // code-barres tenu près reste flou et n'est jamais lu (vu sur un pot de whey, 10/11/2026). Méthode
            // d'Apple (exemple AVCamBarcode, WWDC21) : zoomer juste assez pour qu'un code de 20 mm remplisse la
            // moitié de la largeur de l'image à la distance minimale de mise au point.
            device.videoZoomFactor = Self.zoomForMinimumFocus(device)
            device.unlockForConfiguration()
        }
        return true
    }

    private static func zoomForMinimumFocus(_ device: AVCaptureDevice) -> CGFloat {
        let minFocus = Float(device.minimumFocusDistance)   // millimètres ; -1 si inconnu
        guard minFocus > 0 else { return 1 }
        let fov = device.activeFormat.videoFieldOfView      // degrés, sur la largeur
        // Code EAN-13 standard : 37 mm de large ; il occupe environ un tiers de la largeur de l'image. (Avec 20 mm
        // et la moitié de l'image, le zoom montait à x3,5 : trop serré pour viser, signalé le 12/11/2026.)
        let codeSize: Float = 37, fill: Float = 0.35
        let distance = (codeSize / fill) / tan((fov / 2) * .pi / 180)
        guard distance > 0, distance < minFocus else { return 1 }
        let zoom = CGFloat(minFocus / distance)
        return max(1, min(zoom, device.activeFormat.videoMaxZoomFactor, 2))
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !done, let obj = objects.first as? AVMetadataMachineReadableCodeObject, let value = obj.stringValue,
              value.allSatisfy(\.isNumber), (6...14).contains(value.count) else { return }
        let type: String
        switch obj.type {
        case .ean8: type = "ean8"
        case .upce: type = "upce"
        default: type = "ean13"
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        close(.found(value, type))
    }

    private func close(_ result: Result) {
        guard !done else { return }
        done = true
        sessionQueue.async { if self.session.isRunning { self.session.stopRunning() } }
        dismiss(animated: true) { self.finish(result) }
    }
}
