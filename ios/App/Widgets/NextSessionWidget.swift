import SwiftUI
import WidgetKit

/// Widget « Prochaine séance · Cette semaine » : écran d'accueil (petit, moyen) et écran verrouillé
/// (rectangulaire, circulaire). Il ne calcule rien : il dessine l'instantané laissé par l'app
/// (WidgetSnapshot, js/features/home-widget.js) et ne fait que deux choses avec l'heure :
/// « prête » quand les muscles sont reposés, semaine remise à zéro le lundi.
///
/// Cible RestActivity (l'extension WidgetKit existante, qui dessine déjà la Live
/// Activity du repos), déclaré dans RestActivityBundle (docs/WATCH_WIDGETS.md). Il réutilise
/// RestTint et MDLFBrand de RestActivityViews.swift. Toucher le widget ouvre l'app.
///
/// Apple (WidgetKit) : TimelineProvider fournit des entrées datées ; iOS les affiche à leur heure,
/// puis redemande une frise selon la politique (.after). containerBackground est exigé à partir
/// d'iOS 17 (sinon le widget s'affiche en « adopte containerBackground ») : il est appliqué via
/// widgetBackground() selon la version.
struct NextSessionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Companion.widgetKind, provider: NextSessionProvider()) { entry in
            NextSessionWidgetView(entry: entry)
        }
        .configurationDisplayName("Prochaine séance")
        .description("Ta prochaine séance et ta régularité de la semaine.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular])
    }
}

// MARK: - Frise

struct NextSessionEntry: TimelineEntry {
    let date: Date
    /// nil : l'app n'a encore rien laissé (jamais ouverte, ou trousseau partagé illisible)
    let snapshot: WidgetSnapshot?

    /// Semaine de l'instantané terminée : on repart de zéro sans attendre l'app
    var weekOver: Bool { snapshot.map { date >= $0.week.endDate } ?? false }
    var weekCount: Int { weekOver ? 0 : (snapshot?.week.count ?? 0) }
    var weekGoal: Int { max(1, snapshot?.week.goal ?? 3) }
    var weekDays: [String?] { weekOver ? Array(repeating: nil, count: 7) : (snapshot?.week.days ?? Array(repeating: nil, count: 7)) }
    var isReady: Bool { snapshot?.next?.readyDate.map { date >= $0 } ?? true }
}

struct NextSessionProvider: TimelineProvider {
    /// Aperçu de la galerie des widgets : des valeurs d'exemple, jamais les données de l'utilisateur
    static let sample = WidgetSnapshot(
        v: Companion.widgetSnapshotVersion, at: 0,
        next: .init(title: "Push", tint: "orange", exercises: 6, readyAt: 0),
        week: .init(count: 2, goal: 4, days: ["orange", nil, "teal", nil, nil, nil, nil], start: 0, end: .greatestFiniteMagnitude),
        active: nil)

    func placeholder(in context: Context) -> NextSessionEntry {
        NextSessionEntry(date: Date(), snapshot: Self.sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (NextSessionEntry) -> Void) {
        completion(NextSessionEntry(date: Date(), snapshot: context.isPreview ? Self.sample : WidgetSnapshot.load() ?? Self.sample))
    }

    /// Une entrée maintenant, une à l'heure où la séance sera prête, une au lundi suivant ; ensuite
    /// iOS redemande une frise (l'app la fait aussi recharger dès que l'instantané change)
    func getTimeline(in context: Context, completion: @escaping (Timeline<NextSessionEntry>) -> Void) {
        let now = Date(), snap = WidgetSnapshot.load()
        var dates = [now]
        if let ready = snap?.next?.readyDate, ready > now { dates.append(ready) }
        if let end = snap?.week.endDate, end > now { dates.append(end) }
        let entries = dates.sorted().map { NextSessionEntry(date: $0, snapshot: snap) }
        let refresh = Calendar.current.date(byAdding: .hour, value: 6, to: dates.max() ?? now) ?? now
        completion(Timeline(entries: entries, policy: .after(refresh)))
    }
}

// MARK: - Dessin

struct NextSessionWidgetView: View {
    let entry: NextSessionEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCircular:    circular
        case .accessoryRectangular: rectangular
        case .systemMedium:         medium
        default:                    small
        }
    }

    // ── Écran d'accueil ──

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            MDLFBrand(height: 11)
            Spacer(minLength: 0)
            SessionLine(entry: entry)
            WeekDots(days: entry.weekDays, size: 9)
            Text("\(entry.weekCount) sur \(entry.weekGoal) cette semaine")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetBackground()
    }

    private var medium: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                MDLFBrand(height: 12)
                Spacer(minLength: 0)
                SessionLine(entry: entry)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 8) {
                WeekRing(count: entry.weekCount, goal: entry.weekGoal, size: 64)
                WeekDots(days: entry.weekDays, size: 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetBackground()
    }

    // ── Écran verrouillé (monochrome : le système teinte) ──

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(entry.snapshot?.active != nil ? "Séance en cours" : "Prochaine séance")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(entry.snapshot?.active?.title ?? entry.snapshot?.next?.title ?? "MDLF Training")
                .font(.headline)
                .lineLimit(1)
            Text("\(entry.weekCount)/\(entry.weekGoal) cette semaine")
                .font(.caption2)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessoryBackground(circular: false)
    }

    private var circular: some View {
        Gauge(value: Double(min(entry.weekCount, entry.weekGoal)), in: 0...Double(entry.weekGoal)) {
            Image(systemName: "figure.strengthtraining.traditional")
        } currentValueLabel: {
            Text("\(entry.weekCount)")
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .accessibilityLabel("\(entry.weekCount) séances sur \(entry.weekGoal) cette semaine")
        .accessoryBackground(circular: true)
    }
}

/// « Prochaine séance · Push » (ou la séance en cours), avec « prête » ou l'heure de reprise
private struct SessionLine: View {
    let entry: NextSessionEntry

    var body: some View {
        if let active = entry.snapshot?.active {
            VStack(alignment: .leading, spacing: 1) {
                Text("En cours").font(.caption.weight(.semibold)).foregroundStyle(RestTint.color(active.tint))
                Text(active.title).font(.headline).lineLimit(1)
                Text(Date(timeIntervalSince1970: active.startedAt / 1000), style: .timer)
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        } else if let next = entry.snapshot?.next {
            VStack(alignment: .leading, spacing: 1) {
                Text("Prochaine séance").font(.caption.weight(.semibold)).foregroundStyle(RestTint.color(next.tint))
                Text(next.title).font(.headline).lineLimit(1).minimumScaleFactor(0.8)
                readiness(next).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            .accessibilityElement(children: .combine)
        } else {
            Text("Ouvre l'app pour voir ta prochaine séance")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func readiness(_ next: WidgetSnapshot.Next) -> some View {
        if let ready = next.readyDate, !entry.isReady {
            Text("Prête \(ready, style: .relative)")
        } else {
            Text(next.exercises > 1 ? "Prête · \(next.exercises) exercices" : "Prête")
        }
    }
}

/// Une pastille par jour, lundi → dimanche, de la couleur de la séance faite ce jour-là
private struct WeekDots: View {
    let days: [String?]
    let size: CGFloat
    private static let letters = ["L", "M", "M", "J", "V", "S", "D"]
    private static let names = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]

    var body: some View {
        HStack(spacing: size * 0.45) {
            ForEach(0..<7, id: \.self) { i in
                let tint = i < days.count ? days[i] : nil
                Circle()
                    .fill(tint.map { RestTint.color($0) } ?? Color(uiColor: .tertiarySystemFill))
                    .frame(width: size, height: size)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    private var label: String {
        let done = days.indices.filter { days[$0] != nil }.map { Self.names[$0] }
        return done.isEmpty ? "Aucune séance cette semaine" : "Séances : " + done.joined(separator: ", ")
    }
}

/// Anneau des séances de la semaine face à l'objectif (comme l'anneau de l'accueil de l'app)
private struct WeekRing: View {
    let count: Int
    let goal: Int
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle().stroke(Color(uiColor: .tertiarySystemFill), lineWidth: 7)
            Circle()
                .trim(from: 0, to: min(1, Double(count) / Double(max(1, goal))))
                .stroke(Color(uiColor: .systemGreen), style: StrokeStyle(lineWidth: 7, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(count)/\(goal)")
                .font(.system(.callout, design: .rounded).weight(.semibold).monospacedDigit())
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count) séances sur \(goal) cette semaine")
    }
}

private extension View {
    /// Fond du widget : noir pur en sombre, blanc en clair (systemBackground) ; containerBackground dès iOS 17
    @ViewBuilder func widgetBackground() -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
        } else {
            padding().background(Color(uiColor: .systemBackground))
        }
    }

    /// Écran verrouillé : le système dessine et teinte ; fond discret pour le cercle, aucun sinon
    /// (Apple HIG, Widgets : « accessory widgets »)
    @ViewBuilder func accessoryBackground(circular: Bool) -> some View {
        if #available(iOS 17.0, *) {
            containerBackground(for: .widget) {
                if circular { AccessoryWidgetBackground() } else { Color.clear }
            }
        } else {
            self
        }
    }
}
