import Foundation
import Capacitor
import WidgetKit

/// Widget « Prochaine séance / Cette semaine » : l'app laisse un instantané JSON dans le trousseau partagé,
/// l'extension RestActivity le lit pour dessiner le widget (ios/App/Widgets/NextSessionWidget.swift).
/// Côté web : Capacitor.registerPlugin('MdlfWidget') (js/platform/native.js), appelé par js/features/home-widget.js.
/// Cible App, enregistré dans MainViewController (docs/WATCH_WIDGETS.md).
///
/// Apple (WidgetKit, « Keeping a widget up to date ») : l'app demande à iOS de recharger la frise du
/// widget quand ses données changent (WidgetCenter.reloadTimelines) ; le JS n'appelle ce module que si
/// l'instantané a changé, ce qui ménage le budget de rechargements accordé par iOS.
@objc(WidgetPlugin)
public final class WidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetPlugin"
    public let jsName = "MdlfWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSnapshot", returnType: CAPPluginReturnPromise),
    ]

    /// snapshot : JSON de widgetSnapshot, vérifié (lisible, bonne version, léger) avant d'être écrit
    @objc func setSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("snapshot"), json.utf8.count <= 8_192,
              WidgetSnapshot.decode(json) != nil else {
            call.reject("Instantané du widget invalide"); return
        }
        // Trousseau partagé refusé (droit absent de la cible) : rien n'est rechargé, sans erreur
        guard SharedKeychain.write(json, for: Companion.widgetSnapshotKey) else {
            call.resolve(["saved": false]); return
        }
        WidgetCenter.shared.reloadTimelines(ofKind: Companion.widgetKind)
        call.resolve(["saved": true])
    }
}
