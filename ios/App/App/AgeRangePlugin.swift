import Foundation
import UIKit
import Capacitor
#if canImport(DeclaredAgeRange)
import DeclaredAgeRange
#endif

/// Tranche d'âge partagée par l'utilisateur ou son parent (framework DeclaredAgeRange, iOS 26).
/// Côté web : Capacitor.registerPlugin('MdlfAgeRange') (js/platform/native.js, Native.ageRange) ;
/// décisions dans js/data/age-range.js (onglet Amis masqué sous 15 ans, prudence de 15 à 17 ans).
///
/// API Apple : AgeRangeService.shared.requestAgeRange(ageGates:_:_:in:) présente la fenêtre d'iOS et répond
/// .sharing(range:) (lowerBound / upperBound, activeParentalControls) ou .declinedSharing ; erreurs
/// AgeRangeService.Error (notAvailable, invalidRequest…). Seuils : au plus trois, tranches de deux ans au
/// moins ; la région peut imposer les siens. Entitlement com.apple.developer.declared-age-range (App.entitlements).
///
/// Prudence de compilation : protégé par canImport (SDK sans le framework) et #available(iOS 26.0) (l'app
/// vise iOS 16.4). Seuls des membres d'iOS 26.0 sont utilisés (pas isEligibleForAgeFeatures, iOS 26.2).
/// Ne rejette jamais : toute erreur devient { status: "unavailable" }, l'app garde alors son comportement.
@objc(AgeRangePlugin)
public class AgeRangePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AgeRangePlugin"
    public let jsName = "MdlfAgeRange"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
    ]

    /// { status: "sharing", lowerBound?, upperBound?, communicationLimits } ou { status: "declined" | "unavailable" }
    @objc func request(_ call: CAPPluginCall) {
        #if canImport(DeclaredAgeRange)
        if #available(iOS 26.0, *) {
            Task { @MainActor in
                guard let controller = self.bridge?.viewController else {
                    call.resolve(["status": "unavailable"])
                    return
                }
                do {
                    let response = try await AgeRangeService.shared.requestAgeRange(ageGates: 13, 15, 18, in: controller)
                    call.resolve(AgeRangePlugin.payload(response))
                } catch {
                    call.resolve(["status": "unavailable", "reason": String(describing: error)])
                }
            }
            return
        }
        #endif
        call.resolve(["status": "unavailable"])
    }

    #if canImport(DeclaredAgeRange)
    @available(iOS 26.0, *)
    private static func payload(_ response: AgeRangeService.Response) -> [String: Any] {
        switch response {
        case .sharing(let range):
            var out: [String: Any] = [
                "status": "sharing",
                "communicationLimits": range.activeParentalControls.contains(.communicationLimits),
            ]
            if let lower = range.lowerBound { out["lowerBound"] = lower }
            if let upper = range.upperBound { out["upperBound"] = upper }
            return out
        case .declinedSharing:
            return ["status": "declined"]
        @unknown default:
            return ["status": "unavailable"]
        }
    }
    #endif
}
