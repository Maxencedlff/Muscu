import SwiftUI
import WatchKit

/// Écrans de la montre : rien en cours, série à faire, repos. Grandes cibles (un seul geste par
/// bouton), textes courts, couleur de la séance comme accent, fond noir du système.
/// Le compte à rebours est dessiné par le système à partir de l'heure de fin (Text(timerInterval:),
/// ProgressView(timerInterval:)) : rien n'est recalculé chaque seconde.
///
/// NON COMPILÉ au moment de l'écriture (pas de Xcode sur la machine de développement).
struct WatchRootView: View {
    @EnvironmentObject private var model: WatchSessionModel
    /// Heure du dernier dessin : avancée à la fin du repos pour revenir à la série sans attendre l'iPhone
    @State private var now = Date()

    var body: some View {
        NavigationStack {
            Group {
                if let state = model.state, state.active {
                    if let rest = state.rest, rest.endDate > now {
                        RestView(state: state, rest: rest)
                    } else {
                        SetView(state: state)
                    }
                } else {
                    IdleView(next: model.state?.next)
                }
            }
            .navigationTitle(model.state?.active == true ? (model.state?.title ?? "Séance") : "MDLF")
        }
        .task(id: model.state?.rest?.endTime) {
            now = Date()
            guard let end = model.state?.rest?.endDate, end > now else { return }
            try? await Task.sleep(nanoseconds: UInt64(end.timeIntervalSinceNow * 1_000_000_000))
            guard !Task.isCancelled else { return }
            now = Date()
            // App ouverte au poignet ; sinon c'est la notification de fin de repos de l'iPhone qui
            // arrive sur la montre (iOS relaie les notifications quand l'iPhone est verrouillé)
            WKInterfaceDevice.current().play(.notification)
        }
    }
}

/// Aucune séance en cours : la séance se démarre sur l'iPhone
private struct IdleView: View {
    let next: WatchSessionState.NextSession?

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "figure.strengthtraining.traditional")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(WatchTint.color(next?.tint))
                .accessibilityHidden(true)
            if let next {
                Text("Prochaine séance").font(.footnote).foregroundStyle(.secondary)
                Text(next.title).font(.headline).multilineTextAlignment(.center)
            }
            Text("Démarre ta séance sur l'iPhone")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Série en cours : exercice, numéro de série, charge prévue, bouton Valider
private struct SetView: View {
    @EnvironmentObject private var model: WatchSessionModel
    let state: WatchSessionState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                if let exercise = state.exercise, !exercise.isEmpty {
                    Text(exercise)
                        .font(.headline)
                        .lineLimit(3)
                    Text("Série \(state.setNo ?? 1) sur \(state.setCount ?? 1)")
                        .font(.footnote)
                        .foregroundStyle(WatchTint.color(state.tint))
                    if let load = state.load, !load.isEmpty {
                        Text(load)
                            .font(.system(.title3, design: .rounded).weight(.semibold).monospacedDigit())
                    }
                    if state.canValidate == true {
                        Button(action: model.validate) {
                            Label(model.pending ? "Envoi…" : "Valider", systemImage: "checkmark")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(WatchTint.color(state.tint))
                        .disabled(model.pending || !model.reachable)
                        .accessibilityHint("Valide la série avec la charge et les répétitions prévues")
                    } else if let blocked = state.blocked, !blocked.isEmpty {
                        Text(blocked).font(.footnote).foregroundStyle(.secondary)
                    }
                } else {
                    Text("Toutes les séries sont faites").font(.headline)
                    Text("Termine la séance sur l'iPhone").font(.footnote).foregroundStyle(.secondary)
                }
                SetsProgress(done: state.done ?? 0, total: state.total ?? 0)
                ConnectionNote()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Repos : compte à rebours, anneau, −15 / +15 s, Passer, série suivante
private struct RestView: View {
    @EnvironmentObject private var model: WatchSessionModel
    let state: WatchSessionState
    let rest: WatchSessionState.Rest

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                ZStack {
                    ProgressView(timerInterval: rest.interval, countsDown: true) {
                        EmptyView()
                    } currentValueLabel: {
                        EmptyView()
                    }
                    .progressViewStyle(.circular)
                    .tint(WatchTint.color(state.tint))
                    .accessibilityHidden(true)
                    Text(timerInterval: rest.interval, countsDown: true)
                        .font(.system(.title2, design: .rounded).weight(.semibold).monospacedDigit())
                        .accessibilityLabel("Repos restant")
                }
                .frame(width: 96, height: 96)
                HStack(spacing: 6) {
                    Button { model.adjustRest(-15) } label: { Text("−15") }
                        .accessibilityLabel("Moins 15 secondes")
                    Button { model.adjustRest(15) } label: { Text("+15") }
                        .accessibilityLabel("Plus 15 secondes")
                }
                .font(.body.monospacedDigit())
                .disabled(model.pending || !model.reachable)
                Button("Passer", action: model.skipRest)
                    .buttonStyle(.borderedProminent)
                    .tint(WatchTint.color(state.tint))
                    .disabled(model.pending || !model.reachable)
                    .accessibilityHint("Arrête le repos")
                if let exercise = state.exercise, !exercise.isEmpty {
                    Text("Ensuite : \(exercise) · série \(state.setNo ?? 1)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                ConnectionNote()
            }
        }
    }
}

/// « 5 séries sur 18 »
private struct SetsProgress: View {
    let done: Int
    let total: Int

    var body: some View {
        if total > 0 {
            Text("\(done) séries sur \(total)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

/// iPhone injoignable ou geste non arrivé : dit, plutôt qu'un bouton qui ne fait rien
private struct ConnectionNote: View {
    @EnvironmentObject private var model: WatchSessionModel

    var body: some View {
        if !model.reachable {
            Label("iPhone hors de portée", systemImage: "iphone.slash")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else if model.failed {
            Label("Pas arrivé, réessaie", systemImage: "exclamationmark.triangle")
                .font(.footnote)
                .foregroundStyle(.orange)
        }
    }
}
