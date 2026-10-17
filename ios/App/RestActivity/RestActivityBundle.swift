import SwiftUI
import WidgetKit

/// Extension RestActivity : ne contient que la Live Activity du repos (aucun widget d'écran d'accueil).
/// Apple : WidgetKit › WidgetBundle ; une Live Activity se déclare comme un widget de l'extension.
@main
struct RestActivityBundle: WidgetBundle {
    var body: some Widget {
        RestLiveActivity()
    }
}
