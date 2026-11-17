import UIKit
import Capacitor
import WebKit

/// Contrôleur principal de l'app : la vue web Capacitor, plus les modules natifs propres à l'app
/// (Santé, Apple Music, Live Activity du repos, icône de l'app, copie iCloud, bips, compte, abonnement, notifications push, Apple Watch, widget, Siri, coffre à photos, tranche d'âge, lecteur de code-barres), enregistrés ici car ils ne viennent
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
        // StorePlugin : son load() démarre l'écouteur Transaction.updates, donc dès le lancement
        bridge?.registerPluginInstance(StorePlugin())
        bridge?.registerPluginInstance(PushPlugin())
        bridge?.registerPluginInstance(WatchPlugin())
        bridge?.registerPluginInstance(WidgetPlugin())
        bridge?.registerPluginInstance(ShortcutsPlugin())
        bridge?.registerPluginInstance(VaultPlugin())
        bridge?.registerPluginInstance(AgeRangePlugin())
        bridge?.registerPluginInstance(ScannerPlugin())
        #if DEBUG
        startWatchRoundTripIfRequested()
        #endif
    }

    #if DEBUG
    /// `-MDLFWatchCI` au lancement (Debug seulement, .github/workflows/montre.yml) : démarre une séance
    /// Push quelques secondes après le chargement, comme un toucher sur « Démarrer », puis écrit l'état
    /// des séries dans le journal toutes les 2 s. La CI vérifie ainsi l'aller-retour réel avec la montre
    /// appairée : la séance part vers la montre, « Valider » au poignet coche la série ici.
    private func startWatchRoundTripIfRequested() {
        guard ProcessInfo.processInfo.arguments.contains("-MDLFWatchCI") else { return }
        let js = """
        window.addEventListener('load', function () {
          setTimeout(function () {
            try {
              if (!activeSession) startSession('push');
              console.log('MDLF-CI séance démarrée ' + JSON.stringify(currentWatchState()));
            } catch (e) { console.log('MDLF-CI erreur ' + e); }
            setInterval(function () {
              try {
                console.log('MDLF-CI état ' + JSON.stringify({
                  series: activeSession ? activeSession.exercises[0].sets.map(function (s) { return !!s.done; }) : null,
                  repos: !!restActive }));
              } catch (e) { console.log('MDLF-CI erreur ' + e); }
            }, 2000);
          }, 6000);
        });
        """
        webView?.configuration.userContentController.addUserScript(
            WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }
    #endif
}
