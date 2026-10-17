import Foundation
import UIKit
import Capacitor

/// Icône de l'app au choix (Réglages › Icône de l'app) : icônes alternatives d'iOS.
/// Côté web : Capacitor.registerPlugin('MdlfAppIcon') (js/platform/native.js, Native.appIcon).
///
/// Les jeux d'icônes (AppIcon-Rouille, AppIcon-Craie…) sont dans Assets.xcassets et déclarés par
/// ASSETCATALOG_COMPILER_ALTERNATE_APP_ICON_NAMES (project.pbxproj) ; tout est généré par
/// scripts/brand-icons.py depuis js/data/app-icons.js. Le nom natif nil désigne l'icône par défaut.
/// Après un changement, iOS affiche lui-même une alerte « Vous avez changé l'icône » : c'est voulu.
@objc(AppIconPlugin)
public class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIconPlugin"
    public let jsName = "MdlfAppIcon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getName", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "change", returnType: CAPPluginReturnPromise),
    ]

    /// { supported, name? } : name absent pour l'icône par défaut
    @objc func getName(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let app = UIApplication.shared
            var out: [String: Any] = ["supported": app.supportsAlternateIcons]
            if let name = app.alternateIconName { out["name"] = name }
            call.resolve(out)
        }
    }

    /// { name } : nom d'un jeu d'icônes alternatif, absent ou null pour revenir à l'icône par défaut
    @objc func change(_ call: CAPPluginCall) {
        let name: String? = call.getString("name")
        var result: [String: Any] = [:]
        if let name = name { result["name"] = name }
        let out = result
        DispatchQueue.main.async {
            let app = UIApplication.shared
            guard app.supportsAlternateIcons else {
                call.unavailable("Icônes alternatives non prises en charge")
                return
            }
            // Déjà en place : rien à faire (évite une alerte d'iOS inutile)
            if app.alternateIconName == name {
                call.resolve(out)
                return
            }
            app.setAlternateIconName(name) { error in
                if let error = error {
                    call.reject("Changement d'icône impossible : \(error.localizedDescription)", "FAILED", error)
                } else {
                    call.resolve(out)
                }
            }
        }
    }
}
