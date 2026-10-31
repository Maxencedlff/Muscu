import SwiftUI

/// Couleur de la séance sur la montre : mêmes noms que l'iPhone (restActivityTint, js/features/rest-activity.js),
/// couleurs système de SwiftUI (watchOS n'a pas les couleurs système d'UIKit), ou « #RRGGBB ».
enum WatchTint {
    static func color(_ value: String?) -> Color {
        switch value ?? "indigo" {
        case "orange": return .orange
        case "red":    return .red
        case "yellow": return .yellow
        case "green":  return .green
        case "teal":   return .teal
        case "blue":   return .blue
        case "purple": return .purple
        case "pink":   return .pink
        case "indigo": return .indigo
        case let hex:
            guard hex.count == 7, hex.hasPrefix("#"), let rgb = UInt32(hex.dropFirst(), radix: 16) else { return .indigo }
            return Color(red: Double((rgb >> 16) & 0xFF) / 255,
                         green: Double((rgb >> 8) & 0xFF) / 255,
                         blue: Double(rgb & 0xFF) / 255)
        }
    }
}
