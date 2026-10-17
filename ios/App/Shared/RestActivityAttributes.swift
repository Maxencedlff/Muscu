import Foundation
import ActivityKit

/// Live Activity du repos, partagée entre l'app (qui la démarre, la met à jour et la termine)
/// et l'extension RestActivity (qui la dessine). Ce fichier appartient aux deux cibles.
///
/// Données fixes : la séance. Données variables (ContentState) : l'heure de fin, la durée totale
/// et la série suivante. Le compte à rebours n'est jamais envoyé : l'extension le dessine à partir
/// de l'heure de fin (Text(timerInterval:)), sans mise à jour chaque seconde.
/// Apple : ActivityKit › ActivityAttributes ; données fixes et variables limitées à 4 Ko en tout.
struct RestActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Heure de fin du repos
        var endDate: Date
        /// Durée totale du repos en secondes (anneau de progression), ajustée par ±15 s
        var totalSeconds: Int
        /// Série qui suit le repos, absente quand toutes les séries sont faites
        var next: NextSet?

        /// Début théorique du repos : fin moins la durée totale (borné pour rester un intervalle valide)
        var startDate: Date { endDate.addingTimeInterval(-Double(max(1, totalSeconds))) }
        var interval: ClosedRange<Date> { startDate...max(endDate, startDate) }
    }

    /// « Ensuite : Squat · série 3 · 80 kg × 8 » ; la charge est déjà mise en forme par l'app
    /// (unité, virgule décimale), vide quand aucune répétition n'est prévue.
    struct NextSet: Codable, Hashable {
        var exercise: String
        var set: Int
        var load: String
    }

    /// Nom de la séance (« Push », « Haut du corps »…)
    var sessionTitle: String
    /// Couleur de la séance : nom de couleur système (« orange », « indigo »…) ou « #RRGGBB »
    var tint: String
}
