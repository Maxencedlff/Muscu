import SwiftUI
import WidgetKit

/// Extension RestActivity : la Live Activity du repos et le widget « Prochaine séance / Cette semaine »
/// (écran d'accueil et écran verrouillé, Widgets/NextSessionWidget.swift).
/// Apple : WidgetKit › WidgetBundle ; une Live Activity se déclare comme un widget de l'extension.
@main
struct RestActivityBundle: WidgetBundle {
    var body: some Widget {
        RestLiveActivity()
        NextSessionWidget()
    }
}
