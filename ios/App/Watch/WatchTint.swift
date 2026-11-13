import SwiftUI

/// Couleur de la séance sur la montre : mêmes noms que l'iPhone (restActivityTint, js/features/rest-activity.js),
/// couleurs système de SwiftUI (watchOS n'a pas les couleurs système d'UIKit), ou « #RRGGBB ».
/// Par défaut et à la place de l'ancien indigo : l'orange MDLF (#FF7A1A, la montre est toujours sur fond noir).
enum WatchTint {
    static let brand = Color(red: 1, green: 0x7A / 255, blue: 0x1A / 255)

    static func color(_ value: String?) -> Color {
        switch value ?? "#FF7A1A" {
        case "orange": return .orange
        case "red":    return .red
        case "yellow": return .yellow
        case "green":  return .green
        case "teal":   return .teal
        case "blue":   return .blue
        case "purple": return .purple
        case "pink":   return .pink
        case "indigo": return brand
        case let hex:
            guard hex.count == 7, hex.hasPrefix("#"), let rgb = UInt32(hex.dropFirst(), radix: 16) else { return brand }
            return Color(red: Double((rgb >> 16) & 0xFF) / 255,
                         green: Double((rgb >> 8) & 0xFF) / 255,
                         blue: Double(rgb & 0xFF) / 255)
        }
    }
}
