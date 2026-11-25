import UIKit
import Capacitor
import WebKit

/// Contrôleur principal de l'app : la vue web Capacitor, plus les modules natifs propres à l'app
/// (Santé, Apple Music, Live Activity du repos, icône de l'app, copie iCloud, bips, compte, abonnement, notifications push, Apple Watch, widget, Siri, coffre à photos, tranche d'âge, lecteur de code-barres), enregistrés ici car ils ne viennent
/// pas d'un paquet npm. Un module absent de cette liste n'existe pas côté JS.
class MainViewController: CAPBridgeViewController {
    /// iPad (docs/COACH_IPAD.md) : la vue web d'iPadOS se présente par défaut comme Safari sur Mac (« Macintosh »,
    /// mise en page d'ordinateur). Contenu « mobile » : même vue web que sur iPhone, l'app décide seule de sa mise
    /// en page selon la largeur. Posé ici plutôt que dans capacitor.config.json (ios.preferredContentMode) : ce
    /// fichier entre aussi dans l'empreinte Android (scripts/runtime-version.mjs), qui gèlerait ses mises à jour.
    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        return configuration
    }

    override open func capacitorDidLoad() {
        mainFrameOnlyBridge()
        #if DEBUG
        e2eFixtures()
        #endif
        bridge?.registerPluginInstance(HealthPlugin())
        bridge?.registerPluginInstance(MusicPlugin())
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(AppIconPlugin())
        bridge?.registerPluginInstance(CloudBackupPlugin())
        bridge?.registerPluginInstance(SoundPlugin())
        bridge?.registerPluginInstance(AccountPlugin())
        // StorePlugin : son load() démarre l'écouteur Transaction.updates, donc dès le lancement
        bridge?.registerPluginInstance(StorePlugin())
        bridge?.registerPluginInstance(PushPlugin())
        bridge?.registerPluginInstance(WatchPlugin())
        bridge?.registerPluginInstance(WidgetPlugin())
        bridge?.registerPluginInstance(ShortcutsPlugin())
        bridge?.registerPluginInstance(VaultPlugin())
        bridge?.registerPluginInstance(AgeRangePlugin())
        bridge?.registerPluginInstance(ScannerPlugin())
    }

    /// Canal natif de Capacitor (« bridge ») réservé à la fenêtre principale (docs/COACH_IPAD.md, audit M1) : Capacitor
    /// n'injecte son JavaScript que dans la fenêtre principale, mais son canal WKScriptMessageHandler reste joignable
    /// depuis tout cadre (window.webkit.messageHandlers.bridge) et WebViewDelegationHandler ne regarde pas d'où vient
    /// le message. Le canal est réenregistré derrière un filtre qui ignore tout message d'un cadre (le mode coach grand
    /// écran est un iframe isolé). Sans toucher au paquet Capacitor : le délégué est créé dans loadView, privé.
    private func mainFrameOnlyBridge() {
        guard let handler = (bridge as? CapacitorBridge)?.webViewDelegationHandler else { return }
        let controller = handler.contentController
        controller.removeScriptMessageHandler(forName: "bridge")
        controller.add(MainFrameOnlyMessageHandler(inner: handler), name: "bridge")
    }
    #if DEBUG
    /// Test d'interface iPad (ios/UITests, docs/COACH_IPAD.md) : lancée avec « -mdlfE2E 1 », une build Debug injecte les
    /// faux serveurs écrits par tests/ios_e2e_fixtures.py (public/e2e/main.js dans la fenêtre de l'app, frame.js dans
    /// tous les cadres). Absent d'une build Release (#if DEBUG) : une build TestFlight ignore l'argument, et ios.yml
    /// vérifie que public/e2e/ n'est pas dans l'archive.
    private func e2eFixtures() {
        guard UserDefaults.standard.string(forKey: "mdlfE2E") == "1",
              let controller = (bridge as? CapacitorBridge)?.webViewDelegationHandler.contentController else { return }
        for (name, mainFrameOnly) in [("main", true), ("frame", false)] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "js", subdirectory: "public/e2e"),
                  let source = try? String(contentsOf: url, encoding: .utf8) else { continue }
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: mainFrameOnly))
        }
    }
    #endif
}

/// Transmet au délégué de Capacitor les seuls messages de la fenêtre principale
final class MainFrameOnlyMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var inner: WKScriptMessageHandler?
    init(inner: WKScriptMessageHandler) { self.inner = inner }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame else { return }
        inner?.userContentController(userContentController, didReceive: message)
    }
}
