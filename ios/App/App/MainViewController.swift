import UIKit
import Capacitor

/// Contrôleur principal de l'app : la vue web Capacitor, plus les modules natifs propres à l'app
/// (Santé et Apple Music), enregistrés ici car ils ne viennent pas d'un paquet npm.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthPlugin())
        bridge?.registerPluginInstance(MusicPlugin())
    }
}
