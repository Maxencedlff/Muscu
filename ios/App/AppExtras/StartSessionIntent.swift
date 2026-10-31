import AppIntents

/// « Démarrer ma séance » : Siri, Spotlight, l'app Raccourcis et le bouton Action.
/// L'intent ouvre l'app et lui laisse la demande (ShortcutInbox) ; la séance démarre ensuite dans le JS
/// exactement comme par le bouton de l'accueil (js/features/siri.js : séance en cours reprise,
/// séance vide refusée, rien pendant Bienvenue ou un dialogue ouvert).
/// À ajouter à la cible App (docs/WATCH_WIDGETS.md). iOS 16 et suivants, comme l'app (16.4).
///
/// Apple (App Intents, « App Shortcuts ») : un AppShortcutsProvider dans la cible de l'app rend le
/// raccourci disponible dès l'installation, sans réglage ; chaque phrase doit contenir le nom de l'app
/// (\(.applicationName)). Les phrases sont en français, langue de développement de l'app
/// (CFBundleDevelopmentRegion = fr).
///
/// NON COMPILÉ au moment de l'écriture (pas de Xcode sur la machine de développement).
struct StartSessionIntent: AppIntent {
    static let title: LocalizedStringResource = "Démarrer ma séance"
    static let description = IntentDescription("Ouvre MDLF Training sur la prochaine séance de ton programme, ou sur la séance en cours.")
    /// L'app s'ouvre : la séance se fait à l'écran (iOS 26 propose aussi supportedModes, pas avant)
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ShortcutInbox.post(action: "startSession")
        return .result()
    }
}

struct MDLFShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartSessionIntent(),
            phrases: [
                "Démarrer ma séance dans \(.applicationName)",
                "Démarre ma séance \(.applicationName)",
                "Lance ma séance \(.applicationName)",
                "Commencer l'entraînement avec \(.applicationName)",
            ],
            shortTitle: "Démarrer ma séance",
            systemImageName: "figure.strengthtraining.traditional")
    }
}
