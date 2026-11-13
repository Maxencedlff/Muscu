import SwiftUI

/// Couleur de la séance sur la montre : l'orange MDLF, un seul (direction « sobre », comme RestTint sur l'iPhone),
/// #FF7A1A car la montre est toujours sur fond noir. La valeur reçue (restActivityTint, js/features/rest-activity.js,
/// ou un ancien nom de couleur) est ignorée : plus d'orange système, de violet ni d'indigo.
enum WatchTint {
    static let brand = Color(red: 1, green: 0x7A / 255, blue: 0x1A / 255)

    static func color(_ value: String?) -> Color { brand }
}
