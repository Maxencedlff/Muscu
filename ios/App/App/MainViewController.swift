import UIKit
import Capacitor

/// Contrôleur principal de l'app : la vue web Capacitor, plus les modules natifs propres à l'app
/// (Santé, Apple Music, Live Activity du repos, icône de l'app, copie iCloud, bips, compte, notifications push, Apple Watch, widget, Siri, coffre à photos), enregistrés ici car ils ne viennent
/// pas d'un paquet npm. Un module absent de cette liste n'existe pas côté JS.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthPlugin())
        bridge?.registerPluginInstance(MusicPlugin())
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(AppIconPlugin())
        bridge?.registerPluginInstance(CloudBackupPlugin())
        bridge?.registerPluginInstance(SoundPlugin())
        bridge?.registerPluginInstance(AccountPlugin())
        bridge?.registerPluginInstance(PushPlugin())
        bridge?.registerPluginInstance(WatchPlugin())
        bridge?.registerPluginInstance(WidgetPlugin())
        bridge?.registerPluginInstance(ShortcutsPlugin())
        bridge?.registerPluginInstance(VaultPlugin())
    }
}
