import Foundation
import Capacitor
import WidgetKit

/// Widget « Prochaine séance / Cette semaine » : l'app laisse un instantané JSON dans l'App Group,
/// l'extension RestActivity le lit pour dessiner le widget (ios/App/Widgets/NextSessionWidget.swift).
/// Côté web : Capacitor.registerPlugin('MdlfWidget') (js/platform/native.js), appelé par js/features/home-widget.js.
/// À ajouter à la cible App, puis à enregistrer dans MainViewController (docs/WATCH_WIDGETS.md).
///
/// Apple (WidgetKit, « Keeping a widget up to date ») : l'app demande à iOS de recharger la frise du
/// widget quand ses données changent (WidgetCenter.reloadTimelines) ; le JS n'appelle ce module que si
/// l'instantané a changé, ce qui ménage le budget de rechargements accordé par iOS.
///
/// NON COMPILÉ au moment de l'écriture (pas de Xcode sur la machine de développement).
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
        // App Group absent (capacité pas encore ajoutée à la cible) : rien n'est écrit, sans erreur
        guard let shared = UserDefaults(suiteName: Companion.appGroup) else {
            call.resolve(["saved": false]); return
        }
        shared.set(json, forKey: Companion.widgetSnapshotKey)
        WidgetCenter.shared.reloadTimelines(ofKind: Companion.widgetKind)
        call.resolve(["saved": true])
    }
}
