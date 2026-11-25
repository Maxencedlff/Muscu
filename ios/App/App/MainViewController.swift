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
}
