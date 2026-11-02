import UIKit
import Capacitor
import GoogleSignIn

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // MainViewController (et non CAPBridgeViewController) : il enregistre les modules natifs
        // propres à l'app (Santé, Apple Music). Le storyboard Main n'est pas utilisé ici.
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        // Notifications de la scène plutôt que les méthodes du délégué : rien à relayer à Capacitor.
        let center = NotificationCenter.default
        center.addObserver(forName: UIScene.didEnterBackgroundNotification, object: scene, queue: .main) { [weak self] _ in
            self?.shareSheetLeft = self?.presentedShareSheet() != nil
        }
        center.addObserver(forName: UIScene.didActivateNotification, object: scene, queue: .main) { [weak self] _ in
            self?.closeShareSheetAfterLeaving()
        }
    }

    // Feuille de partage d'iOS (UIActivityViewController, présentée par @capacitor/share) restée
    // ouverte pendant un départ vers une autre app : Instagram « Story » ouvre Instagram sans
    // prévenir la feuille, qu'on retrouvait affichée au retour. Elle est refermée quand l'app
    // redevient active, et le partage est rapporté comme fait au module (completed = true), qui
    // répond 'shared' au JS. Le passage en arrière-plan seul compte : une demande d'autorisation
    // (« Enregistrer l'image ») rend l'app inactive sans la mettre en arrière-plan.
    private var shareSheetLeft = false

    private func presentedShareSheet() -> UIActivityViewController? {
        var vc = window?.rootViewController
        while let presented = vc?.presentedViewController {
            if let sheet = presented as? UIActivityViewController { return sheet }
            vc = presented
        }
        return nil
    }

    private func closeShareSheetAfterLeaving() {
        guard shareSheetLeft else { return }
        shareSheetLeft = false
        guard let sheet = presentedShareSheet(), sheet.presentedViewController == nil else { return }
        let done = sheet.completionWithItemsHandler
        sheet.completionWithItemsHandler = nil
        sheet.dismiss(animated: true) { done?(nil, true, nil, nil) }
    }

    // L'app a une scène (UIApplicationSceneManifest) : iOS remet les URL ouvertes ici, jamais à
    // AppDelegate.application(_:open:options:). Retour de la fenêtre Google d'abord (schéma
    // com.googleusercontent.apps.…), le reste à Capacitor.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        let others = URLContexts.filter { !GIDSignIn.sharedInstance.handle($0.url) }
        if !others.isEmpty { SceneDelegateProxy.shared.scene(scene, openURLContexts: others) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
