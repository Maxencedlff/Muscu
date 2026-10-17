import SwiftUI
import UIKit
import WidgetKit

// Briques communes de la Live Activity du repos : couleur de séance, anneau, compte à rebours,
// série suivante, marque de l'app, et la présentation de l'écran verrouillé.
// Le temps n'est jamais calculé ici : Text(timerInterval:) et ProgressView(timerInterval:) sont
// animés par le système à partir de l'heure de fin (WidgetKit, « Displaying dynamic dates »).

/// Couleur de la séance : couleur système (claire ou sombre selon l'écran) ou « #RRGGBB »
enum RestTint {
    static func color(_ value: String) -> Color {
        switch value {
        case "orange": return Color(uiColor: .systemOrange)
        case "red":    return Color(uiColor: .systemRed)
        case "yellow": return Color(uiColor: .systemYellow)
        case "green":  return Color(uiColor: .systemGreen)
        case "teal":   return Color(uiColor: .systemTeal)
        case "blue":   return Color(uiColor: .systemBlue)
        case "purple": return Color(uiColor: .systemPurple)
        case "pink":   return Color(uiColor: .systemPink)
        case "indigo": return Color(uiColor: .systemIndigo)
        default:
            guard value.count == 7, value.hasPrefix("#"), let rgb = UInt32(value.dropFirst(), radix: 16) else {
                return Color(uiColor: .systemIndigo)
            }
            return Color(red: Double((rgb >> 16) & 0xFF) / 255,
                         green: Double((rgb >> 8) & 0xFF) / 255,
                         blue: Double(rgb & 0xFF) / 255)
        }
    }
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

/// « Ensuite : Développé couché · série 3 · 80 kg × 8 » (« Maintenant » une fois le repos fini)
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
        [next.exercise, "série \(next.set)", next.load].filter { !$0.isEmpty }.joined(separator: " · ")
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
                    Text(isStale ? "Repos terminé" : "Repos")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    if isStale {
                        Text("C'est reparti")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundStyle(tint)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    } else {
                        RestCountdown(state: state)
                            .font(.system(size: 40, weight: .semibold, design: .rounded))
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if !isStale {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text("Reprise")
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
