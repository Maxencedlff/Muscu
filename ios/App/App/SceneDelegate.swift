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
