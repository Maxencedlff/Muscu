import ActivityKit
import SwiftUI
import WidgetKit

/// Live Activity du repos : écran verrouillé et les trois présentations de la Dynamic Island.
/// Apple : WidgetKit › ActivityConfiguration, DynamicIsland ; HIG › Live Activities.
/// Le contenu reste le même d'une présentation à l'autre (anneau à gauche, temps à droite)
/// pour que le passage compacte → étendue → écran verrouillé reste cohérent.
struct RestLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestActivityAttributes.self) { context in
            RestLockScreenView(attributes: context.attributes, state: context.state, isStale: context.isStale)
                .activitySystemActionForegroundColor(RestTint.color(context.attributes.tint))
        } dynamicIsland: { context in
            let tint = RestTint.color(context.attributes.tint)
            let state = context.state
            let isStale = context.isStale

            return DynamicIsland {
                // Étendue (appui long) : contenu serré autour de la caméra, série suivante en bas
                DynamicIslandExpandedRegion(.leading) {
                    RestRing(state: state, isStale: isStale, tint: tint, symbolSize: 17)
                        .frame(width: 46, height: 46)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(context.attributes.sessionTitle)
                            .font(.headline)
                            .foregroundStyle(tint)
                            .lineLimit(1)
                        Text(isStale ? "Repos terminé" : "Repos")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Group {
                        if isStale {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(tint)
                                .accessibilityLabel("Repos terminé")
                        } else {
                            RestCountdown(state: state)
                        }
                    }
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 96, alignment: .trailing)
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // Série suivante sur toute la largeur (sinon tronquée), marque en dessous
                    VStack(alignment: .leading, spacing: 6) {
                        if let next = state.next {
                            RestNextLine(next: next, isStale: isStale, tint: tint)
                                .font(.subheadline)
                        }
                        MDLFBrand(height: 11)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                    .padding(.top, 4)
                }
            } compactLeading: {
                // Compacte : anneau + temps, lus comme une seule information, serrés contre la caméra
                RestRing(state: state, isStale: isStale, tint: tint)
                    .frame(width: 20, height: 20)
            } compactTrailing: {
                Group {
                    if isStale {
                        Image(systemName: "figure.strengthtraining.traditional")
                            .accessibilityLabel("Repos terminé")
                    } else {
                        RestCountdown(state: state)
                    }
                }
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(tint)
                .multilineTextAlignment(.trailing)
                // Text(timerInterval:) prend toute la largeur proposée : bornée pour rester serrée
                .frame(maxWidth: 44, alignment: .trailing)
            } minimal: {
                // Minimale (plusieurs Live Activities) : le temps restant sous forme d'anneau
                RestRing(state: state, isStale: isStale, tint: tint)
                    .frame(width: 20, height: 20)
            }
            .keylineTint(tint)
        }
    }
}
