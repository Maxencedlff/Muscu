import SwiftUI
import WatchKit

/// Écrans de la montre : rien en cours, série à faire, repos. Grandes cibles (un seul geste par
/// bouton), textes courts, couleur de la séance comme accent, fond noir du système.
/// Le compte à rebours est dessiné par le système à partir de l'heure de fin (Text(timerInterval:),
/// ProgressView(timerInterval:)) : rien n'est recalculé chaque seconde.
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
        // ScrollView : sur la 42 mm, la phrase tenait sur une ligne coupée (« …sur l'iPh… »)
        ScrollView {
            VStack(spacing: 8) {
                Image(systemName: "figure.strengthtraining.traditional")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(WatchTint.color(next?.tint))
                    .accessibilityHidden(true)
                VStack(spacing: 4) {
                    if let next {
                        Text("Prochaine séance").font(.footnote).foregroundStyle(.secondary)
                        Text(next.title).font(.headline).multilineTextAlignment(.center)
                    }
                    Text("Démarre ta séance sur l'iPhone")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }
            .frame(maxWidth: .infinity)
        }
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
                // −15 et +15 de part et d'autre du compte à rebours : « Passer », le geste principal,
                // reste visible sans défiler sur la 42 mm (avant, il tombait sous le bord de l'écran)
                HStack(spacing: 4) {
                    Button { model.adjustRest(-15) } label: { Text("−15") }
                        .accessibilityLabel("Moins 15 secondes")
                    RestRing(rest: rest, tint: WatchTint.color(state.tint))
                    Button { model.adjustRest(15) } label: { Text("+15") }
                        .accessibilityLabel("Plus 15 secondes")
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.circle)
                .font(.footnote.weight(.semibold).monospacedDigit())
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

/// Anneau du repos et temps restant. L'anneau est dessiné ici (Circle tronqué, redessiné une fois par
/// seconde par TimelineView) : la ProgressView circulaire du système garde sa petite taille fixe sur la
/// montre, et le texte du compte à rebours débordait sur l'anneau. Le texte reste Text(timerInterval:),
/// tenu à jour par le système.
private struct RestRing: View {
    let rest: WatchSessionState.Rest
    let tint: Color
    private let size: CGFloat = 78
    private let line: CGFloat = 6

    var body: some View {
        ZStack {
            Circle().stroke(Color(white: 0.2), lineWidth: line)
            TimelineView(.periodic(from: rest.startDate, by: 1)) { context in
                Circle()
                    .trim(from: 0, to: remaining(at: context.date))
                    .stroke(tint, style: StrokeStyle(lineWidth: line, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            .accessibilityHidden(true)
            Text(timerInterval: rest.interval, countsDown: true)
                .font(.system(.title3, design: .rounded).weight(.semibold).monospacedDigit())
                .minimumScaleFactor(0.7)
                .lineLimit(1)
                .padding(.horizontal, line + 4)
                .accessibilityLabel("Repos restant")
        }
        .frame(width: size, height: size)
    }

    private func remaining(at date: Date) -> CGFloat {
        let total = rest.endDate.timeIntervalSince(rest.startDate)
        guard total > 0 else { return 0 }
        return CGFloat(min(1, max(0, rest.endDate.timeIntervalSince(date) / total)))
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
                .foregroundStyle(WatchTint.brand)   // l'orange de l'app, pas l'orange système
        }
    }
}
