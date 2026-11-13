import SwiftUI
import UIKit
import WidgetKit

// Briques communes de la Live Activity du repos : couleur de séance, anneau, compte à rebours,
// série suivante, marque de l'app, et la présentation de l'écran verrouillé.
// Le temps n'est jamais calculé ici : Text(timerInterval:) et ProgressView(timerInterval:) sont
// animés par le système à partir de l'heure de fin (WidgetKit, « Displaying dynamic dates »).

/// Couleur de la Live Activity et des widgets : l'orange MDLF, un seul (direction « sobre »), quelle que soit la
/// séance. Deux variantes, comme dans l'app : vif sur fond sombre (#FF7A1A), foncé sur fond clair (#C64000,
/// texte blanc 5,1:1 ; css/theme-sobre.css --tint-fill). La valeur reçue (« #FF7A1A » de restActivityTint,
/// js/features/rest-activity.js, ou un ancien nom de couleur d'une Live Activity déjà lancée) est ignorée :
/// plus d'orange système, de violet ni d'indigo.
enum RestTint {
    static let brandHex = "#FF7A1A"
    static let brand = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .light
            ? UIColor(red: 0xC6 / 255, green: 0x40 / 255, blue: 0x00 / 255, alpha: 1)
            : UIColor(red: 0xFF / 255, green: 0x7A / 255, blue: 0x1A / 255, alpha: 1)
    })

    static func color(_ value: String) -> Color { brand }
}

/// Anneau qui se vide jusqu'à la fin du repos ; plein (et coché) une fois le repos terminé
struct RestRing: View {
    let state: RestActivityAttributes.ContentState
    let isStale: Bool
    let tint: Color
    var symbolSize: CGFloat = 0   // 0 : anneau seul (Dynamic Island compacte et minimale)

    var body: some View {
        ZStack {
            if isStale {
                Circle().stroke(tint, lineWidth: 3)
            } else {
                ProgressView(timerInterval: state.interval, countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .progressViewStyle(.circular)
                .tint(tint)
            }
            if symbolSize > 0 {
                Image(systemName: isStale ? "checkmark" : "figure.strengthtraining.traditional")
                    .font(.system(size: symbolSize, weight: .semibold))
                    .foregroundStyle(tint)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Compte à rebours dessiné par le système (aucune mise à jour envoyée chaque seconde)
struct RestCountdown: View {
    let state: RestActivityAttributes.ContentState

    var body: some View {
        Text(timerInterval: state.interval, countsDown: true)
            .monospacedDigit()
    }
}

/// « Ensuite : Développé couché · série 3/4 · 80 kg × 8 » (« Maintenant » une fois le repos fini)
struct RestNextLine: View {
    let next: RestActivityAttributes.NextSet
    let isStale: Bool
    let tint: Color

    var body: some View {
        HStack(spacing: 5) {
            Text(isStale ? "Maintenant :" : "Ensuite :")
                .fontWeight(.semibold)
                .foregroundStyle(tint)
                .layoutPriority(1)
            Text(detail)
                .foregroundStyle(.primary)
        }
        .lineLimit(1)
        .accessibilityElement(children: .combine)
    }

    private var detail: String {
        [next.exercise, next.setText, next.load].filter { (part: String) -> Bool in !part.isEmpty }.joined(separator: " · ")
    }
}

/// Marque de l'app, sans conteneur (Apple HIG, Live Activities : « display it without a container »)
struct MDLFBrand: View {
    var height: CGFloat = 13

    var body: some View {
        HStack(spacing: 5) {
            Image("MDLFMark")
                .resizable()
                .scaledToFit()
                .frame(height: height)
            Text("MDLF Training")
                .font(.caption2.weight(.semibold))
        }
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("MDLF Training")
    }
}

/// Écran verrouillé (et bannière des appareils sans Dynamic Island). Marge standard de 14 pt,
/// hauteur bien en dessous des 160 pt au-delà desquels iOS tronque (Apple HIG, Live Activities).
struct RestLockScreenView: View {
    let attributes: RestActivityAttributes
    let state: RestActivityAttributes.ContentState
    let isStale: Bool

    private var tint: Color { RestTint.color(attributes.tint) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                MDLFBrand()
                Spacer(minLength: 8)
                Circle().fill(tint).frame(width: 7, height: 7).accessibilityHidden(true)
                Text(attributes.sessionTitle)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tint)
                    .lineLimit(1)
            }

            HStack(alignment: .center, spacing: 14) {
                RestRing(state: state, isStale: isStale, tint: tint, symbolSize: 19)
                    .frame(width: 54, height: 54)

                VStack(alignment: .leading, spacing: 0) {
                    Text(state.title(stale: isStale))
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    if isStale {
                        Text(state.isEffort ? "Repos" : "C'est reparti")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundStyle(tint)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        // Reste vrai même affiché longtemps (app tuée par le système pendant le repos) :
                        // le système fait avancer cette durée seul (WidgetKit, « Displaying dynamic dates »)
                        Text("Fini depuis \(state.endDate, style: .relative)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                            .lineLimit(1)
                    } else {
                        RestCountdown(state: state)
                            .font(.system(size: 40, weight: .semibold, design: .rounded))
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if !isStale {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(state.isEffort ? "Fin" : "Reprise")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                        Text(state.endDate, style: .time)
                            .font(.headline)
                            .monospacedDigit()
                    }
                    .fixedSize()
                    .accessibilityElement(children: .combine)
                }
            }
            .accessibilityElement(children: .combine)

            if let next = state.next {
                RestNextLine(next: next, isStale: isStale, tint: tint)
                    .font(.subheadline)
            }
        }
        .padding(14)
    }
}
