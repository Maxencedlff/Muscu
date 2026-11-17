import XCTest

/// Tests d'interface de l'app Apple Watch, lancés par la CI seulement (.github/workflows/montre.yml).
/// La cible MDLFWatchUITests n'est PAS dans le projet commité : scripts/ios/add-watch-uitests.rb l'ajoute
/// le temps du workflow. Ce Swift ne compte donc pas dans l'empreinte de la build (runtime).
///
/// - testLibellesVoiceOver : chaque écran (mode démonstration `-MDLFWatchDemo`, Debug seulement) ;
///   les libellés lus par VoiceOver sont écrits dans le journal (« MDLF-AX| ») et vérifiés : présents,
///   non vides, en français (aucun mot anglais ni nom de symbole SF qui fuit).
/// - testAllerRetourAvecIPhone : montre appairée, app iPhone lancée avec `-MDLFWatchCI` (séance Push
///   démarrée) : la séance arrive au poignet, « Valider » coche la série sur l'iPhone et ouvre le repos,
///   « Passer » revient à la série suivante. Chaque étape est confirmée par l'iPhone (la montre ne devine
///   rien) : voir ce changement d'écran prouve donc l'aller-retour WatchConnectivity.
final class WatchUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    /// Mots anglais qui trahiraient un libellé non traduit (système ou oubli)
    private static let english = ["validate", "skip", "send", "rest ", "remaining", "seconds", "next",
                                  "done", "start", "session", "out of range", "try again", "minus", "plus 15 seconds"]

    private struct Entry {
        let type: String
        let label: String
        let enabled: Bool
    }

    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments + ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR"]
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "l'app de la montre ne s'ouvre pas")
        return app
    }

    private func element(_ app: XCUIApplication, containing text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func entries(_ app: XCUIApplication) -> [Entry] {
        app.descendants(matching: .any).allElementsBoundByIndex.compactMap { e in
            guard e.exists else { return nil }
            return Entry(type: Self.kind(e.elementType), label: e.label, enabled: e.isEnabled)
        }
    }

    private static func kind(_ type: XCUIElement.ElementType) -> String {
        switch type {
        case .button: return "bouton"
        case .staticText: return "texte"
        case .image: return "image"
        case .progressIndicator: return "progression"
        case .navigationBar: return "barre"
        case .scrollView: return "défilement"
        case .other: return "autre"
        default: return "type \(type.rawValue)"
        }
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    func testLibellesVoiceOver() {
        let cases: [(state: String, expected: [String])] = [
            ("aucune", ["Démarre ta séance sur l'iPhone", "Prochaine séance"]),
            ("serie", ["Développé couché", "Série 2 sur 4", "80 kg × 8", "Valider", "5 séries sur 18"]),
            ("repos", ["Repos restant", "Moins 15 secondes", "Plus 15 secondes", "Passer", "Ensuite : Développé couché"]),
            ("duree", ["Gainage", "Série à saisir sur l'iPhone"]),
            ("fini", ["Toutes les séries sont faites", "Termine la séance sur l'iPhone"]),
            ("long", ["Développé incliné haltères", "Valider"]),
            ("horsportee", ["iPhone hors de portée", "Valider"]),
        ]
        for (state, expected) in cases {
            let app = launch(["-MDLFWatchDemo", state])
            XCTAssertTrue(element(app, containing: expected[0]).waitForExistence(timeout: 20),
                          "\(state) : « \(expected[0]) » absent\n\(app.debugDescription)")
            let found = entries(app)
            for e in found where !e.label.isEmpty {
                print("MDLF-AX|\(state)|\(e.type)|\(e.label)|\(e.enabled ? "actif" : "inactif")")
            }
            for text in expected {
                XCTAssertTrue(found.contains { $0.label.contains(text) }, "\(state) : libellé « \(text) » absent")
            }
            for e in found where e.type == "bouton" {
                XCTAssertFalse(e.label.trimmingCharacters(in: .whitespaces).isEmpty, "\(state) : bouton sans libellé")
            }
            for e in found where !e.label.isEmpty {
                let lower = e.label.lowercased()
                for word in Self.english where lower.contains(word) {
                    XCTFail("\(state) : libellé en anglais ? « \(e.label) » (\(word))")
                }
                // Nom de symbole SF lu tel quel (« checkmark », « iphone.slash »)
                if lower.range(of: #"^[a-z]+(\.[a-z]+)+$"#, options: .regularExpression) != nil || lower == "checkmark" {
                    XCTFail("\(state) : nom d'icône lu par VoiceOver « \(e.label) »")
                }
            }
            attach("ax-\(state)")
            app.terminate()
        }
    }

    func testAllerRetourAvecIPhone() {
        let app = launch([])
        let valider = app.buttons["Valider"]
        guard valider.waitForExistence(timeout: 120) else {
            attach("aller-retour-0-rien-recu")
            XCTFail("la séance démarrée sur l'iPhone n'est pas arrivée sur la montre\n\(app.debugDescription)")
            return
        }
        let enabled = expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: valider)
        if XCTWaiter().wait(for: [enabled], timeout: 60) != .completed {
            attach("aller-retour-0-iphone-injoignable")
            XCTFail("« Valider » reste grisé : iPhone injoignable (isReachable faux)\n\(app.debugDescription)")
            return
        }
        print("MDLF-RT|séance reçue|\(entries(app).map(\.label).filter { !$0.isEmpty }.joined(separator: " / "))")
        attach("aller-retour-1-seance-recue")
        valider.tap()

        let passer = app.buttons["Passer"]
        guard passer.waitForExistence(timeout: 30) else {
            attach("aller-retour-2-pas-de-repos")
            XCTFail("« Valider » n'a pas ouvert le repos (l'iPhone n'a pas confirmé)\n\(app.debugDescription)")
            return
        }
        print("MDLF-RT|repos reçu|\(entries(app).map(\.label).filter { !$0.isEmpty }.joined(separator: " / "))")
        attach("aller-retour-2-repos")

        let plus = app.buttons["Plus 15 secondes"]
        if plus.waitForExistence(timeout: 5) && plus.isEnabled {
            plus.tap()
            sleep(3)
            attach("aller-retour-3-repos-plus-15")
        }
        let passerActif = expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: passer)
        _ = XCTWaiter().wait(for: [passerActif], timeout: 10)
        passer.tap()
        let suivante = element(app, containing: "Série 2 sur")
        XCTAssertTrue(suivante.waitForExistence(timeout: 30),
                      "« Passer » n'a pas ramené la série suivante\n\(app.debugDescription)")
        print("MDLF-RT|série suivante|\(entries(app).map(\.label).filter { !$0.isEmpty }.joined(separator: " / "))")
        attach("aller-retour-4-serie-suivante")
    }
}
