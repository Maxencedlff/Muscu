import SwiftUI

/// App Apple Watch compagnon de MDLF Training : la séance en cours, au poignet.
/// Elle n'a aucune donnée à elle : l'iPhone envoie l'état de la séance (WatchSessionState) et
/// reçoit les gestes (WatchAction). Cible « MDLFWatch » à créer dans Xcode (docs/WATCH_WIDGETS.md),
/// avec ce dossier et ios/App/Shared/CompanionShared.swift. watchOS 10 et suivants.
///
/// NON COMPILÉ au moment de l'écriture (pas de Xcode sur la machine de développement).
@main
struct MDLFWatchApp: App {
    @StateObject private var model = WatchSessionModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environmentObject(model)
        }
        .onChange(of: scenePhase) { _, phase in
            // App rouverte au poignet : on redemande l'état (un envoi a pu se perdre)
            if phase == .active { model.requestState() }
        }
    }
}
