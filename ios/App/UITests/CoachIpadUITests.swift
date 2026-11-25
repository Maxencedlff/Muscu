import XCTest

/// Mode coach grand écran sur iPad, dans la VRAIE vue web de l'app (WKWebView, capacitor://localhost) : docs/COACH_IPAD.md,
/// « Test dans la vraie vue web ». Lancé par ios.yml sur un iPad Pro 13 pouces virtuel ; cible ajoutée au projet le temps
/// du test par scripts/ios/add-ui-tests.rb (jamais dans le projet commité, jamais dans une build TestFlight).
///
/// L'app est lancée avec « -mdlfE2E 1 » : la build Debug injecte les faux serveurs de tests/ios_e2e_fixtures.py (aucun
/// réseau, aucun vrai compte, jetons factices) et une ligne d'état « E2E … » que ce test lit dans l'arbre
/// d'accessibilité : ce que voient la fenêtre de l'app et le cadre isolé (origine, session reçue par message, accès à la
/// fenêtre de l'app refusé, CSP, erreurs). Une capture à chaque étape (XCTAttachment), gardée dans le résultat.
final class CoachIpadUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app = XCUIApplication(bundleIdentifier: "com.mdlf.training")
        app.launchArguments = ["-mdlfE2E", "1"]
    }

    private func shot(_ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    private var status: XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'E2E '")).firstMatch
    }

    /// Attend que la ligne d'état contienne `part` ; sinon échoue en citant la ligne entière
    private func expect(_ part: String, timeout: TimeInterval = 20, _ why: String) {
        let e = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
        if !e.waitForExistence(timeout: timeout) {
            shot("échec \(part)")
            XCTFail("\(why) : « \(part) » absent de la ligne d'état « \(status.exists ? status.label : "absente") »")
        }
    }

    /// Touche l'élément de libellé exact `label` : bouton, puis onglet (role="tab" des barres d'onglets), puis lien,
    /// puis n'importe quel élément
    private func tap(_ label: String, timeout: TimeInterval = 15) {
        let p = NSPredicate(format: "label == %@", label)
        let queries = [app.buttons, app.tabs, app.links, app.descendants(matching: .any)]
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            for q in queries {
                let e = q.matching(p).firstMatch
                if e.exists && e.isHittable { e.tap(); return }
            }
            usleep(300_000)
        } while Date() < deadline
        shot("absent \(label)")
        XCTFail("« \(label) » introuvable ou pas touchable")
    }

    func testModeCoachGrandEcran() {
        app.launch()
        expect("prêt=1", timeout: 60, "l'app démarre, le coach de démonstration est connecté")
        shot("1 lancement")

        // Onglet Coach, carte « Ouvrir le mode grand écran »
        tap("Coach")
        let open = app.buttons["Ouvrir le mode grand écran"]
        XCTAssertTrue(open.waitForExistence(timeout: 20), "carte du mode grand écran dans l'onglet Coach")
        shot("2 onglet Coach")
        open.tap()

        // Cadre isolé sous capacitor:// : coach-web chargé, session reçue par message, fenêtre de l'app inaccessible
        expect("mode=1", "mode grand écran ouvert")
        expect("élèves=2", timeout: 30, "coach-web chargé dans le cadre isolé, avec les élèves de la session de l'app")
        expect("session=1", "session de l'app reçue par postMessage")
        expect("cadre=null", "origine opaque du cadre (sandbox sans allow-same-origin)")
        expect("parentCapacitor=bloqué", "parent.Capacitor inaccessible depuis le cadre")
        expect("parentCoffre=bloqué", "parent.cphCoachUnlock inaccessible depuis le cadre")
        // Canal natif de Capacitor depuis le cadre : appel de plugin envoyé (ou canal absent), aucune réponse du natif
        let ch = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'appelCadre=envoyé' OR label CONTAINS 'appelCadre=aucun' OR label CONTAINS 'appelCadre=refusé'")).firstMatch
        XCTAssertTrue(ch.waitForExistence(timeout: 15), "appel de plugin tenté depuis le cadre : \(status.label)")
        sleep(3)
        expect("réponseNative=0", "aucun plugin ne répond à un appel venu du cadre")
        // Pour ios.yml : si l'appel est parti, le natif doit l'avoir signalé ignoré dans le journal du simulateur
        print("E2E-STATUT-CANAL: \(status.label)")
        shot("3 mode grand écran")

        // Fiche d'un élève, puis un autre onglet de la fiche
        let lea = app.links.matching(NSPredicate(format: "label CONTAINS 'lea'")).firstMatch
        XCTAssertTrue(lea.waitForExistence(timeout: 15), "Léa dans la liste de l'appli web")
        lea.tap()
        expect("fiche=1", "fiche de Léa (semaines)")
        shot("4 fiche")
        tap("Bilans")
        expect("onglet=bilans", "onglet Bilans de la fiche")
        shot("5 onglet Bilans")

        // Rotation : paysage puis portrait, le mode reste ouvert
        XCUIDevice.shared.orientation = .landscapeLeft
        expect("paysage=1", "rotation en paysage")
        expect("mode=1", "mode toujours ouvert en paysage")
        shot("6 paysage")
        XCUIDevice.shared.orientation = .portrait
        expect("paysage=0", "retour en portrait")

        // Arrière-plan puis retour : le mode est toujours là, la session aussi
        XCUIDevice.shared.press(.home)
        sleep(3)
        app.activate()
        expect("mode=1", "mode grand écran après le retour au premier plan")
        expect("onglet=bilans", "appli web toujours sur la fiche de Léa après le retour")
        expect("session=1", "session toujours là après le retour")
        shot("7 retour au premier plan")

        // « Revenir à l'appli » (bouton de l'appli web du coach, ou barre de l'hôte)
        tap("Revenir à l'appli")
        expect("mode=0", "retour à l'app")
        shot("8 retour à l'app")

        // CSP : rien de bloqué dans l'app ni dans le cadre
        expect("cspApp=0", "aucune violation de CSP dans l'app")
        let line = status.label
        XCTAssertFalse(line.contains("cspCadre=") && !line.contains("cspCadre=0"), "violation de CSP dans le cadre : \(line)")

        // Déconnexion depuis l'app : Réglages › compte › Se déconnecter
        tap("Entraînement")
        tap("Réglages")
        let account = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Compte et sauvegarde'")).firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 15), "cellule du compte dans Réglages")
        account.tap()
        tap("Se déconnecter")
        let confirm = app.buttons.matching(NSPredicate(format: "label == 'Se déconnecter'"))
        XCTAssertTrue(confirm.element(boundBy: max(0, confirm.count - 1)).waitForExistence(timeout: 10), "confirmation de la déconnexion")
        confirm.element(boundBy: max(0, confirm.count - 1)).tap()
        expect("connecté=0", "déconnecté")
        shot("9 déconnecté")
        let errors = status.label
        XCTContext.runActivity(named: "Ligne d'état finale : \(errors)") { _ in }
    }
}
