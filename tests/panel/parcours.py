"""Parcours déclarés pour capture_parcours.py : un parcours = une fonction décorée par @parcours.

Écrire un parcours :

    @parcours('nutrition', 'Nutrition : journal du jour', 'pratiquant')
    def p_nutrition(r):
        '''Phrase lue par le panel en tête de section dans index.md.'''
        r.lancer(REALISTE)                                   # données de 6 mois, horloge figée
        with r.etape('ouvrir', 'Onglet Nutrition', cle='Ouvrir la nutrition'):
            r.toucher('.tabbar [data-tab="nutrition"]', 'onglet Nutrition')   # absent → « ∅ absent », on continue
        with r.etape('ajouter', 'Ajouter un repas'):
            r.toucher('[data-action="meal-add"]', 'Ajouter un repas')

Chaque `with r.etape(...)` capture l'écran à sa sortie (même si un élément manquait), compte les
touchers faits dans le bloc et relève les contrôles automatiques. Gestes : toucher, choisir (bouton
d'un dialogue), onglet, retour, saisir (toucher le champ + taper), defiler (noté, pas compté),
raccourci (état préparé par JS, noté « préparé », jamais compté), attendre, present.
Les parcours tournent dans l'ordre de ce fichier, chacun dans un contexte neuf (stockage vide).
"""
import json
import os
import sys
from dataclasses import dataclass
from collections.abc import Callable

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fixtures import PARIS, days_back_ms  # noqa: E402
from donnees_realistes import six_mois_json  # noqa: E402
from commun import NOW, Absent  # noqa: E402

def _realiste():
    """6 mois d'entraînement (tests/donnees_realistes.py) et quelques mensurations hebdomadaires."""
    d = json.loads(six_mois_json(now_ms=NOW))
    sem = range(0, 10)
    d['bodyMeasures'] = {'waist': [{'date': days_back_ms(NOW, 7 * i + 1, 9, tz=PARIS), 'cm': round(82 + 0.4 * i, 1)} for i in sem],
                         'chest': [{'date': days_back_ms(NOW, 14 * i + 1, 9, tz=PARIS), 'cm': round(101 - 0.5 * i, 1)} for i in range(5)],
                         'armR': [{'date': days_back_ms(NOW, 14 * i + 1, 9, tz=PARIS), 'cm': round(36.5 - 0.3 * i, 1)} for i in range(5)]}
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


REALISTE = _realiste()


@dataclass
class Parcours:
    nom: str
    titre: str
    role: str
    fn: Callable
    doc: str


PARCOURS = []


def parcours(nom, titre, role):
    def deco(fn):
        PARCOURS.append(Parcours(nom, titre, role, fn, ' '.join((fn.__doc__ or '').split())))
        return fn
    return deco


# ─────────────────────────────────────────────────────────────
#  Outils communs
# ─────────────────────────────────────────────────────────────
def menu_ex(r, ei, nom_ex=''):
    nom_ex = nom_ex or f"l'exercice {ei + 1}"
    r.toucher(f'.view.session [data-action="ex-menu"][data-ei="{ei}"]', f'⋯ de {nom_ex}')


def choisir_ou_absent(r, libelle, absent):
    """Bouton d'un menu ouvert ; s'il n'existe pas sur cette version, menu refermé et étape « absent »."""
    if r.present('.ios-dialog__btn', libelle, timeout=600):
        r.choisir(libelle)
        return
    # Réglage rare : dans « Plus d'options… » du menu ⋯ (vague 3)
    if r.present('.ios-dialog__btn', "Plus d'options", timeout=300):
        r.choisir("Plus d'options")
        if r.present('.ios-dialog__btn', libelle, timeout=600):
            r.choisir(libelle)
            return
    if r.present('.ios-dialog__btn', 'Annuler'):
        r.page.locator('.ios-dialog__btn', has_text='Annuler').first.click()
        r.page.wait_for_timeout(300)
    raise Absent(absent)


def ex_index(r, nom):
    return r.page.evaluate("n => (activeSession?.exercises || []).findIndex(e => e.name === n)", nom)


def passer_repos(r):
    # Feuille du repos ouverte : son bouton (celui de la mini-barre est dessous)
    for sel in ('.sess-sheet--rest [data-action="skip-rest"]', '.rest-mini [data-action="skip-rest"]'):
        if r.present(sel):
            r.toucher(sel, 'Passer (repos)')
            return True
    return False


def fermer_feuille(r):
    for sel, quoi in (('.sess-sheet [data-action="sheet-done"]', 'OK / Annuler de la feuille'), ('.sheet__btn--cancel', 'Fermer la feuille')):
        if r.present(sel):
            r.toucher(sel, quoi)
            return


def reglages(r):
    """Réglages depuis l'accueil (bouton de la barre de navigation)."""
    r.toucher('.view.dashboard [data-action="go-settings"]', 'Réglages (roue ou avatar de l\'accueil)')
    r.attendre('.settings-view', 'écran Réglages')


# ─────────────────────────────────────────────────────────────
#  Pratiquant
# ─────────────────────────────────────────────────────────────
@parcours('premier-lancement', 'Premier lancement complet', 'pratiquant')
def p_premier_lancement(r):
    """App toute neuve (aucune donnée) : Bienvenue, « Commencer sans compte », les trois questions
    (salle, 3 fois, déjà entraîné), le programme conseillé, puis l'accueil vide."""
    r.lancer(None, bienvenue_vue=False)
    cle = 'Premier lancement → accueil'
    with r.etape('bienvenue', 'Écran Bienvenue (ouverture de l\'app)', cle=cle):
        r.attendre('.auth', 'écran Bienvenue')
    with r.etape('sans-compte', '« Commencer sans compte » : 1re question', cle=cle):
        r.toucher('[data-action="auth-skip"]', 'Commencer sans compte')
        r.attendre('.onb', 'questions du premier lancement')
    with r.etape('frequence', 'Lieu choisi (salle) : fréquence', cle=cle):
        r.toucher('[data-action="onb-place"][data-val="salle"]', 'En salle')
    with r.etape('niveau', 'Fréquence choisie (3 fois) : niveau', cle=cle):
        r.toucher('[data-action="onb-freq"][data-val="3"]', '3 fois')
    with r.etape('programme-conseille', 'Niveau choisi : programme conseillé', cle=cle):
        r.toucher('[data-action="onb-level"][data-val="confirme"]', 'Déjà entraîné')
    with r.etape('accueil-neuf', '« Commencer » : accueil du nouvel utilisateur', cle=cle):
        r.toucher('[data-action="onb-start"]', 'Commencer')
        r.attendre('.view.dashboard', 'accueil')


@parcours('accueil', 'Accueil (6 mois d\'historique)', 'pratiquant')
def p_accueil(r):
    """Pratiquant régulier depuis 6 mois (PPL, 3 à 4 séances par semaine) qui ouvre l'app un mercredi soir."""
    r.lancer(REALISTE)
    with r.etape('accueil', 'Accueil, haut de l\'écran'):
        r.attendre('.view.dashboard', 'accueil')
    with r.etape('accueil-bas', 'Accueil, bas de l\'écran'):
        r.bas('bas de l\'accueil')


@parcours('seance', 'Séance complète', 'pratiquant')
def p_seance(r):
    """Séance du jour de bout en bout : démarrer, noter, valider et corriger une série, repos, ajouter,
    remplacer, faire plus tard, superset, échauffement, disques, terminer, bilan et aperçu de la story."""
    r.lancer(REALISTE)
    with r.etape('demarrer', 'Démarrer la séance du jour', cle='Démarrer la séance du jour'):
        r.toucher('.view.dashboard [data-action="start-session"]', 'Démarrer (carte de la prochaine séance)')
        r.attendre('.view.session', 'écran de séance')
    with r.etape('noter-serie', 'Noter la 1re série (reps changées)', cle='Noter et valider une série'):
        r.saisir('.view.session [data-action="set-reps"][data-ei="0"][data-si="0"]', 8, 'reps de la série 1')
    with r.etape('valider-serie', 'Valider la série : le repos démarre', cle='Noter et valider une série'):
        r.toucher('.view.session [data-action="validate-set"][data-ei="0"][data-si="0"]', 'valider la série 1')
    with r.etape('repos', 'Repos en cours (minuteur)'):
        if r.present('[data-action="expand-rest"]'):
            r.toucher('[data-action="expand-rest"]', 'agrandir le repos')
        elif not r.present('.rest-mini, .rest-overlay'):
            raise Absent('pas de repos affiché après la validation')
    with r.etape('passer-repos', 'Repos passé : série suivante'):
        if not passer_repos(r):
            raise Absent('pas de bouton pour passer le repos')
    with r.etape('corriger-ouvrir', 'Corriger la série validée : toucher la série', cle='Corriger une série validée'):
        r.toucher('.view.session [data-action="edit-set"][data-ei="0"][data-si="0"] .set-val', 'série 1 validée (sa charge)')
    with r.etape('corriger-enregistrer', 'Corriger : nouvelles reps enregistrées', cle='Corriger une série validée'):
        r.saisir('#editSetReps', 10, 'reps corrigées')
        r.toucher('.view.session [data-action="save-edit-set"]', 'enregistrer la correction')
        passer_repos(r)

    # Notes : case « Avant » de la série suivante (à faire), puis « Note » au pied de la carte
    with r.etape('note-serie-ouvrir', 'Note de série : toucher la case « Avant » de la série 2', cle='Noter une série'):
        r.toucher('.view.session .session-set[data-ei="0"][data-si="1"] .set-note-btn', 'case « Avant » de la série 2')
        r.attendre('.ios-dialog__input', 'alerte de la note')
    with r.etape('note-serie-ecrite', 'Note de série enregistrée : lue sous la ligne', cle='Noter une série'):
        r.saisir('.ios-dialog__input', 'épaule gauche sensible', 'note')
        r.choisir('Enregistrer')
        r.defiler('.view.session .session-set[data-ei="0"][data-si="1"]', 'la série notée')
    r.raccourci("""() => { const s = activeSession.exercises[0].sets[3]; if (s.prev) s.prev.note = 'dernière rep aidée'; render(); }""",
                'note « dernière rep aidée » sur la série 4 la dernière fois')
    with r.etape('note-derniere-fois', 'Série 4 à faire : rappel « La dernière fois : … » sous la ligne'):
        r.defiler('.view.session .session-set[data-ei="0"][data-si="3"] .set-note-prev', 'le rappel de la dernière fois')
    with r.etape('note-exercice', 'Note d\'exercice : lien « Note » au pied de la carte', cle='Noter un exercice'):
        r.toucher('.view.session .ex-card[data-ei="0"] .ex-foot-note', '« Note » au pied de la carte')
        r.attendre('.ios-dialog__input', 'alerte de la note')
    with r.etape('note-exercice-ecrite', 'Note d\'exercice enregistrée : lue sous le nom', cle='Noter un exercice'):
        r.saisir('.ios-dialog__input', 'siège cran 4', 'note')
        r.choisir('Enregistrer')
        r.defiler('.view.session .ex-card[data-ei="0"] .ex-note', 'la note sous le nom')

    # Ajouter un exercice : filtres explorés, puis recherche et choix
    with r.etape('ajouter-feuille', 'Feuille « Ajouter un exercice »', cle='Ajouter un exercice (recherche)'):
        r.toucher('.view.session [data-action="add-session-ex"]', 'Ajouter un exercice')
        r.attendre('.sess-sheet--addex', 'feuille d\'ajout')
    with r.etape('ajouter-filtres', 'Filtres : matériel et groupe de muscles'):
        r.toucher('.sess-sheet--addex [data-action="ax-equip"]', 'filtre de matériel (2e pastille)', nth=1)
        r.toucher('.sess-sheet--addex [data-action="ax-muscle"][data-group]:not([data-group=""])', 'groupe de muscles (1re pastille)')
    with r.etape('ajouter-filtres-annuler', 'Filtres remis à zéro'):
        r.toucher('.sess-sheet--addex [data-action="ax-equip"][data-equip="all"]', 'matériel : Tout')
        r.toucher('.sess-sheet--addex [data-action="ax-muscle"][data-group=""]', 'Tous les muscles')
    with r.etape('ajouter-recherche', 'Recherche « soulevé »', cle='Ajouter un exercice (recherche)'):
        r.saisir('#axSearch', 'soulevé', 'recherche')
    with r.etape('ajouter-choisi', 'Soulevé de terre ajouté à la séance', cle='Ajouter un exercice (recherche)'):
        # « À la fin » : la suite du parcours remplace le 2e exercice (par défaut, « Ensuite » y mettrait le soulevé)
        if r.present('.sess-sheet--addex [data-action="ax-place"][data-place="end"]'):
            r.toucher('.sess-sheet--addex [data-action="ax-place"][data-place="end"]', 'Placer : À la fin')
        sel = '.sess-sheet--addex [data-action="ax-pick"]'
        if r.present(sel + '[data-name="Soulevé de terre"]'):
            r.toucher(sel + '[data-name="Soulevé de terre"]', 'Soulevé de terre')
        else:
            r.toucher(sel, '1er résultat')
        ei = ex_index(r, 'Soulevé de terre')
        if ei >= 0:
            r.defiler(f'.view.session [data-action="ex-menu"][data-ei="{ei}"]', 'la carte ajoutée')

    with r.etape('remplacer-menu', 'Menu ⋯ du 2e exercice', cle='Remplacer un exercice'):
        menu_ex(r, 1)
    with r.etape('remplacer-feuille', 'Feuille « Remplacer l\'exercice »', cle='Remplacer un exercice'):
        r.choisir('Remplacer', '« Remplacer l\'exercice »')
        r.attendre('.sess-sheet--addex', 'feuille de remplacement')
    with r.etape('remplacer-choisi', 'Remplaçant choisi', cle='Remplacer un exercice'):
        r.toucher('.sess-sheet--addex [data-action="ax-pick"]', '1re suggestion')
        r.defiler('.view.session [data-action="ex-menu"][data-ei="1"]', 'l\'exercice remplacé')

    with r.etape('plus-tard', 'Faire l\'exercice en cours plus tard (lien en bas de sa carte)', cle='Faire un exercice plus tard'):
        r.toucher('.view.session [data-action="ex-later"]', '« Plus tard » de l\'exercice en cours')
    with r.etape('faire-maintenant', 'Faire un autre exercice maintenant (lien en bas de sa carte)', cle='Changer l\'ordre de la séance'):
        r.defiler('.view.session [data-action="ex-now"]', '« Faire maintenant » d\'un autre exercice')
        r.toucher('.view.session [data-action="ex-now"]', '« Faire maintenant »')

    with r.etape('superset-choix', 'Superset : choisir le partenaire', cle='Créer un superset'):
        menu_ex(r, 0)
        choisir_ou_absent(r, 'Superset', 'pas d\'action « Superset avec » dans le menu ⋯')
        r.attendre('.ssp', 'feuille du superset')
    with r.etape('superset-carte', 'Superset créé (carte A1 / A2)', cle='Créer un superset'):
        r.toucher('.ssp .mpick__row', 'exercice partenaire (2e de la liste)', nth=1)
        r.toucher('.sheet__btn--confirm', 'OK')

    # Échauffement et disques sur le soulevé de terre (barre) : charge de travail notée d'abord
    with r.etape('echauffement-feuille', 'Échauffement du soulevé de terre (100 kg)', cle='Ajouter un échauffement'):
        ei = ex_index(r, 'Soulevé de terre')
        if ei < 0:
            raise Absent('soulevé de terre pas dans la séance (ajout raté)')
        r.saisir(f'.view.session [data-action="set-weight"][data-ei="{ei}"][data-si="0"]', 100, 'charge du soulevé de terre')
        menu_ex(r, ei, 'Soulevé de terre')
        choisir_ou_absent(r, 'échauffement', 'pas d\'action « Ajouter un échauffement »')
    with r.etape('echauffement-ajoute', 'Séries d\'échauffement ajoutées', cle='Ajouter un échauffement'):
        r.toucher('[data-action="wu-add"]', 'Ajouter l\'échauffement')
    with r.etape('disques', 'Disques à charger (soulevé de terre)', cle='Voir les disques'):
        ei = ex_index(r, 'Soulevé de terre')
        if ei < 0:
            raise Absent('soulevé de terre pas dans la séance')
        menu_ex(r, ei, 'Soulevé de terre')
        choisir_ou_absent(r, 'Disques', 'pas d\'action « Disques »')
        r.attendre('.sess-sheet--plates', 'feuille des disques')
    with r.etape('disques-fermes', 'Feuille des disques fermée'):
        fermer_feuille(r)

    r.raccourci("""() => { activeSession.startedAt = Date.now() - 52 * 60000;
        activeSession.exercises.forEach(ex => ex.sets.forEach(s => {
          if (s.done || s.warmup) return;
          if (String(s.reps ?? '').trim() === '') s.reps = String(setGoal(ex, s));
          if (String(s.weight ?? '').trim() !== '') s.done = true; }));
        persistSession(); render(); }""", 'séries chargées toutes faites, 52 min écoulées')
    with r.etape('terminer', 'Terminer la séance : confirmation', cle='Terminer et voir le bilan'):
        r.toucher('.view.session [data-action="finish-session"]', 'Terminer')
    with r.etape('bilan', 'Bilan de la séance', cle='Terminer et voir le bilan'):
        r.choisir('Enregistrer', '« Enregistrer la séance »')
        r.attendre('.view.summary', 'bilan')
    with r.etape('bilan-bas', 'Bilan, bas de l\'écran'):
        r.bas('bas du bilan')
    with r.etape('partage-apercu', 'Partager la séance : aperçu de la story', cle='Partager la séance en story'):
        r.toucher('[data-action="share-story"]', 'Partager la séance')
        r.attendre('.share-preview', 'aperçu de la story')
        r.page.wait_for_timeout(600)   # image dessinée dans le canvas
    with r.etape('bilan-termine', 'Aperçu fermé, « Terminé » : accueil'):
        fermer_feuille(r)
        r.toucher('[data-action="summary-done"]', 'Terminé')


@parcours('historique', 'Historique et détail d\'une séance', 'pratiquant')
def p_historique(r):
    """Liste des séances passées, puis la plus récente en détail."""
    r.lancer(REALISTE)
    with r.etape('liste', 'Onglet Historique', cle='Revoir sa dernière séance'):
        r.onglet('history', 'Historique')
        r.attendre('.view.history .hcell--card', 'Historique en cartes illustrées')
    with r.etape('calendrier', 'Calendrier du mois (bouton de la barre)', cle='Revoir ses séances sur un calendrier'):
        r.toucher('.view.history .navbar [data-action="hcal-toggle"]', 'Calendrier')
        r.attendre('.view.history .hcal .cal__grid', 'calendrier du mois')
    with r.etape('calendrier-jour', 'Séances d\'un jour touché', cle='Revoir ses séances sur un calendrier'):
        r.toucher('.view.history .hcal [data-action="hcal-day"]', 'un jour avec séance')
        r.attendre('.view.history .hcal-day .hcell', 'séances du jour')
    with r.etape('detail', 'Détail de la dernière séance', cle='Revoir sa dernière séance'):
        r.toucher('.view.history .hcell--card[data-action="open-history"]', 'la séance la plus récente')
        r.attendre('.view.history-detail .hdhead', 'détail de séance (en-tête illustré)')
    with r.etape('detail-bas', 'Détail, bas de l\'écran'):
        r.bas('bas du détail')


@parcours('progres', 'Progrès', 'pratiquant')
def p_progres(r):
    """Onglet Progrès : silhouette des muscles, courbe d'un exercice et son record, vue d'ensemble
    (records de la semaine), mesures du corps, coffre à photos (présentation avant sa création : module du coffre
    simulé, sinon le navigateur afficherait « Coffre indisponible », faux pour l'app iPhone)."""
    from fake_account import FAKE_VAULT
    r.page.add_init_script(FAKE_VAULT)
    r.lancer(REALISTE)
    with r.etape('progres', 'Onglet Progrès'):
        r.onglet('progress', 'Progrès')
        r.attendre('.view.stats', 'Progrès')
    with r.etape('silhouette', 'Carte Muscles (silhouette de la semaine)'):
        r.defiler('.mcard', 'carte Muscles')
    # Personnage détaillé de Progrès : un sous-muscle touché (séries de la période, 3 exercices), puis la vue agrandie
    with r.etape('silhouette-nom', 'Carte Muscles : toucher le muscle le plus travaillé (séries, exercices)', cle='Voir ses muscles travaillés'):
        part = r.page.evaluate("""() => Object.entries(partLoad(muscleSpan).sets).filter(([id]) => !ATLAS_SIMPLE_MUSCLES.has(atlasPart(id).parent) && !atlasPart(id).deep)
            .sort((a, b) => b[1] - a[1])[0]?.[0]""")
        xy = part and r.page.evaluate("""id => { const l = document.querySelector(`.mcard__map [data-part="${id}"]`); if (!l) return null;
            const b = l.getBoundingClientRect(); return [b.left + b.width * 0.3, b.top + b.height * 0.5]; }""", part)
        if not xy:
            raise Absent('introuvable : muscle travaillé sur la carte')
        r.page.mouse.click(*xy)
        r._note('muscle le plus travaillé')
        r.page.wait_for_timeout(700)
    with r.etape('silhouette-zoom', 'Carte Muscles : toucher deux fois, vue agrandie'):
        r.page.evaluate('closeBodyTip()')
        r.page.locator('.mcard__map').evaluate("e => e.scrollIntoView({ block: 'center' })")
        r.page.wait_for_timeout(300)
        xy = r.page.evaluate("""id => { const l = document.querySelector(`.mcard__map [data-part="${id}"]`);
            const b = l.getBoundingClientRect(); return [b.left + b.width * 0.3, b.top + b.height * 0.5]; }""", part)
        r.page.mouse.dblclick(*xy)
        r._note('deux touchers : vue agrandie')
        r.attendre('.azoom', 'vue agrandie')
        # Capture une fois la haute résolution affichée (en t3, prise avant : personnage crénelé sur iPhone SE)
        try:
            r.page.wait_for_function("() => atlasViewerState()?.hi", timeout=8000)
        except Exception:
            pass
        r.page.wait_for_timeout(600)
    with r.etape('silhouette-fermer', 'Vue agrandie : OK'):
        r.toucher('.sheet-root--atlas .sheet__btn--confirm', 'OK')
    with r.etape('progres-bas', 'Progrès, bas de l\'écran (liste des exercices)'):
        r.bas()
    with r.etape('detail-groupe', 'Détail d\'un groupe (Pectoraux : force, exercices, séries par semaine)', cle='Voir la force d\'un groupe'):
        r.page.evaluate('scrollTo(0, 0)')
        r.toucher('.view.stats .pgrp[data-group="pectoraux"]', 'carte Pectoraux')
        r.attendre('.view.stats-group', 'détail du groupe')
    with r.etape('detail-groupe-bas', 'Détail d\'un groupe, bas de l\'écran'):
        r.bas()
    with r.etape('series-par-muscle', 'Séries par muscle', cle='Voir ses muscles travaillés'):
        r.toucher('.view.stats-group [data-action="go-stats-muscles"]', 'Tous les muscles')
        r.attendre('.view.stats-muscles', 'Séries par muscle')
    with r.etape('courbe-exercice', 'Courbe d\'un exercice et son record', cle='Voir la progression d\'un exercice'):
        r.retour()
        r.retour()
        r.toucher('.view.stats [data-action="open-stats-ex"]', '1er exercice de la liste')
        r.attendre('.view.stats-ex', 'écran de l\'exercice')
    with r.etape('courbe-bas', 'Exercice, bas de l\'écran (records, séances)'):
        r.bas()
    with r.etape('vue-ensemble', 'Vue d\'ensemble (records de la semaine, calendrier)'):
        r.retour()
        r.toucher('[data-action="go-stats-overview"]', 'Vue d\'ensemble')
    with r.etape('mesures', 'Mensurations', cle='Ouvrir ses mensurations'):
        r.retour()
        r.defiler('[data-action="go-body-measures"]', 'groupe Mensurations')
        r.toucher('[data-action="go-body-measures"]', 'Mensurations')
        r.attendre('.view.body-measures', 'Mensurations')
    with r.etape('photos', 'Photos de progression (coffre : présentation, « Créer le coffre »)'):
        r.toucher('[data-action="go-photo-vault"]', 'Photos')
        r.attendre('.view.photo-vault', 'coffre à photos')


@parcours('programme', 'Programme', 'pratiquant')
def p_programme(r):
    """Onglet Programme : la liste Programmes, la page du programme actif (séances en cartes illustrées), une séance
    (exercices avec leur vignette), la fiche d'un exercice, puis retour à la liste."""
    r.lancer(REALISTE)
    with r.etape('programmes', 'Onglet Programme : la liste Programmes'):
        r.onglet('program', 'Programme')
        r.attendre('.view.my-programmes', 'liste Programmes')
    with r.etape('liste', 'Page du programme actif : séances en cartes illustrées'):
        r.toucher('.view.my-programmes [data-action="open-my-prog"]', 'programme actif')
        r.attendre('.view.programmes .ps-list .pcard', 'cartes des séances')
    with r.etape('seance', 'Une séance du programme', cle='Modifier un exercice du programme'):
        r.toucher('.view.programmes [data-action="open-prog-session"]', '1re séance')
        r.attendre('.view.editor', 'séance du programme')
    # Retour de Maxence (16/11) : « Ajouter un exercice » ouvre la Bibliothèque illustrée, puis le réglage tout de suite
    cle = 'Ajouter un exercice au programme'
    with r.etape('ajout-biblio', 'Ajouter un exercice : la Bibliothèque en mode choix', cle=cle):
        r.defiler('.view.editor [data-action="add-ex"]', 'Ajouter un exercice')
        r.toucher('.view.editor [data-action="add-ex"]', 'Ajouter un exercice')
        r.attendre('.view.library--pick', 'Bibliothèque en mode choix')
    with r.etape('ajout-groupe', 'Ajouter : exercices du groupe Pectoraux', cle=cle):
        r.toucher('.library--pick .mgcs .mgc[data-group="pectoraux"]', 'groupe Pectoraux')
        r.attendre('#libList .mgc--ex', 'exercices illustrés')
    with r.etape('ajout-reglage', 'Exercice touché : son réglage s\'ouvre, valeurs par défaut remplies', cle=cle):
        r.toucher('.library--pick [data-action="lib-pick"]:not([aria-disabled])', '1er exercice pas encore dans la séance')
        r.attendre('.view.ex-edit', 'réglage de l\'exercice')
    with r.etape('ajout-ok', 'OK : l\'exercice rejoint la séance', cle=cle):
        r.toucher('[data-action="save-ex"]', 'OK')
        r.attendre('.view.editor', 'séance du programme')
    cle = 'Ajouter plusieurs exercices au programme'
    with r.etape('ajout-multiple', 'Sélectionner : deux exercices du groupe Bras cochés', cle=cle):
        r.defiler('.view.editor [data-action="add-ex"]', 'Ajouter un exercice')
        r.toucher('.view.editor [data-action="add-ex"]', 'Ajouter un exercice')
        r.toucher('.library--pick [data-action="lib-pick-multi"]', 'Sélectionner')
        r.toucher('.library--pick .mgcs .mgc[data-group="bras"]', 'groupe Bras')
        r.toucher('.library--pick [data-action="lib-pick"][role="checkbox"]', '1er exercice')
        r.toucher('.library--pick [data-action="lib-pick"][role="checkbox"]', '2e exercice', nth=1)
    with r.etape('ajout-multiple-reglage', 'Ajouter (2) : réglage « 1 sur 2 », puis Suivant', cle=cle):
        r.toucher('.library--pick [data-action="lib-pick-add"]', 'Ajouter (2)')
        r.attendre('.view.ex-edit', 'réglage 1 sur 2')
    with r.etape('ajout-multiple-fin', 'Réglage « 2 sur 2 », puis OK : retour à la séance', cle=cle):
        r.toucher('[data-action="save-ex"]', 'Suivant')
        r.attendre('.view.ex-edit', 'réglage 2 sur 2')
        r.toucher('[data-action="save-ex"]', 'OK')
        r.attendre('.view.editor', 'séance du programme')
    with r.etape('fiche-exercice', 'Fiche d\'un exercice (séries, repos, reps)', cle='Modifier un exercice du programme'):
        r.toucher('.view.editor [data-action="edit-ex"]', '1er exercice')
        r.attendre('.view.ex-edit', 'fiche de l\'exercice')
    # Vague 4 : reps fixes (« 4 × 12 ») à la place de la fourchette
    with r.etape('reps-fixes', 'Fiche de l\'exercice : reps « Fixe » (4 × 12) au lieu de la fourchette', cle='Modifier un exercice du programme'):
        r.defiler('[data-action="ex-rep-mode"]', 'choix Fourchette / Fixe')
        r.toucher('[data-action="ex-rep-mode"][data-fixed="true"]', 'Fixe')
    with r.etape('mes-programmes', 'Retour à la liste Programmes'):
        r.toucher('[data-action="cancel-ex"]', 'Annuler (fiche de l\'exercice)')
        r.retour()
        r.retour()
        r.attendre('.view.my-programmes', 'liste Programmes')
    with r.etape('tous-programmes', 'Ajouter un programme (catalogue)'):
        r.toucher('[data-action="go-prog-add"]', 'Ajouter un programme')


def _split_seq():
    """Programme créé « Split séquentiel » (Pecs, Dos, Jambes, Épaules, Bras), le cas de Maxence du 19/11 : Pecs fait
    mardi soir, Jambes mercredi soir (finie par une planche), Dos, Épaules et Bras jamais faits ; PPL gardé dans la liste."""
    d = json.loads(REALISTE)
    pid = 'u_split'
    sess = [('pecs', 'Pecs', ['Développé couché', 'Développé incliné haltères', 'Écarté poulie', 'Vacuum']),
            ('dos', 'Dos', ['Tractions pronation', 'Rowing barre', 'Tirage horizontal', 'Dead bug']),
            ('jambes', 'Jambes', ['Squat barre', 'Presse à cuisses', 'Leg curl', 'Gainage (planche)']),
            ('epaules', 'Épaules', ['Développé militaire barre', 'Élévations latérales', 'Oiseau', 'Gainage latéral']),
            ('bras', 'Bras', ['Curl biceps haltères', 'Extension triceps poulie', 'Curl marteau', 'Dead bug'])]
    d['userProgrammes'] = {**d.get('userProgrammes', {}), pid: {'name': 'Split séquentiel', 'archived': False, 'order': [k for k, _, _ in sess],
                           'sessions': {k: {'label': lab, 'icon': '', 'desc': '', 'color': '#FF9500'} for k, lab, _ in sess}}}
    d['programmes'][pid] = {'exercises': {k: [{'id': f'{k}{i}', 'name': n, 'sets': 3} for i, n in enumerate(ex)] for k, _, ex in sess},
                            'timers': {k: None for k, _, _ in sess}, 'cooldowns': {k: 72 for k, _, _ in sess}}
    for k, heures in (('pecs', 44), ('jambes', 20)):
        ex = dict((a, c) for a, _, c in sess)[k]
        date = NOW - heures * 3600_000
        d['history'].insert(0, {'id': 'split' + k, 'programme': pid, 'category': k, 'date': date, 'duration': 55 * 60000, 'notes': '',
                                'exercises': [{'name': n, 'sets': [{'weight': '40', 'reps': '10'}] * 3} for n in ex]})
        d['programmes'][pid]['timers'][k] = date
    d['history'].sort(key=lambda h: -h['date'])
    d['activeProgramme'] = pid
    d['myProgrammes'] = [pid] + [x for x in d.get('myProgrammes', ['ppl']) if x != pid]
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


@parcours('page-programme', 'Ordre des séances : la file de l\'accueil, la page du programme, changer de programme', 'pratiquant')
def p_page_programme(r):
    """Pratiquant qui suit son propre split dans l'ordre (Pecs, Dos, Jambes, Épaules, Bras) : il a fait Pecs puis Jambes.
    L'accueil propose Dos (tête de file), « Ensuite » montre la file ; « Changer l'ordre » ouvre la page du programme ; il
    déplace une séance ; puis il passe sur un autre programme depuis la liste Programmes."""
    r.lancer(_split_seq())
    with r.etape('accueil', 'Accueil : Dos proposée, puis Épaules, Bras, Pecs, Jambes'):
        r.attendre('.view.dashboard .hero__name', 'carte de la prochaine séance')
    with r.etape('ensuite', 'Accueil : « Ensuite » et « Changer l\'ordre »'):
        r.defiler('#homeNext', 'Ensuite')
    cle = 'Changer l\'ordre des séances'
    with r.etape('ordre', '« Changer l\'ordre » : la page du programme en mode ordre', cle=cle):
        r.toucher('[data-action="open-session-order"]', 'Changer l\'ordre')
        r.attendre('.view.programmes .ps-handle', 'poignées ≡')
    with r.etape('ordre-menu', 'Toucher la poignée de Bras : Monter / Descendre (sans glisser)', cle=cle):
        r.toucher('.ps-handle', 'poignée de Bras', nth=4)
    with r.etape('ordre-monte', 'Monter : Bras passe avant Épaules', cle=cle):
        r.choisir('Monter')
    with r.etape('accueil-apres', 'OK : retour à l\'accueil, à jour (Dos, puis Bras avant Épaules)', cle=cle):
        r.toucher('[data-action="toggle-prog-order"]', 'OK')
        r.attendre('.view.dashboard', 'accueil')
        r.defiler('#homeNext', 'Ensuite')
    with r.etape('page', 'Onglet Programme : la page du programme, séances dans l\'ordre choisi'):
        r.onglet('program', 'Programme')
        r.attendre('.view.programmes [data-action="open-prog-session"]', 'séances')
    with r.etape('page-bas', 'Page du programme, bas : Envoyer, Renommer, Supprimer'):
        r.bas('bas de la page')
    cle = 'Passer sur un autre programme'
    with r.etape('page-accueil', 'Accueil › « Programme Split séquentiel › » : la page du programme', cle=cle):
        r.onglet('train', 'Entraînement')
        r.toucher('.view.dashboard .navbar__sub', 'Programme Split séquentiel')
        r.attendre('.view.programmes', 'page du programme')
    with r.etape('liste', '‹ Programmes : la liste de tes programmes', cle=cle):
        r.retour()
        r.attendre('.view.my-programmes', 'liste Programmes')
    with r.etape('fiche', 'Toucher PPL : sa fiche et « Utiliser ce programme »', cle=cle):
        r.toucher('.view.my-programmes [data-action="open-my-prog"]', 'PPL', nth=1)
        r.attendre('[data-action="prog-info-use"]', 'Utiliser ce programme')
    with r.etape('utilise', '« Utiliser ce programme » : la page de PPL', cle=cle):
        r.toucher('[data-action="prog-info-use"]', 'Utiliser ce programme')
        r.attendre('.view.programmes', 'page du programme')


def _split_recup():
    """Même split, mais Dos (tête de file) attend son grand dorsal : un rowing en séance libre il y a 10 h."""
    d = json.loads(_split_seq())
    date = NOW - 10 * 3600_000
    d['history'].insert(0, {'id': 'libre-rowing', 'programme': 'free', 'category': 'free', 'date': date, 'duration': 30 * 60000, 'notes': '',
                            'exercises': [{'name': 'Rowing barre', 'sets': [{'weight': '50', 'reps': '10'}] * 3}]})
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


@parcours('file-recuperation', 'Ordre des séances : séance proposée encore en récupération', 'pratiquant')
def p_file_recuperation(r):
    """Le même pratiquant a fait un rowing hier soir en séance libre : Dos, en tête de file, attend son grand dorsal.
    L'accueil la propose quand même (l'ordre ne change pas), avec l'avertissement ; Démarrer reste le bouton plein ;
    « Ensuite » dit quel muscle récupère ; une séance d'« Ensuite » touchée propose Démarrer."""
    r.lancer(_split_recup())
    cle = 'Démarrer une séance pas encore récupérée'
    with r.etape('accueil', 'Accueil : Dos proposée, « Attention : il reste … de récupération (grand dorsal) »', cle=cle):
        r.attendre('.view.dashboard .hero__wait', 'avertissement')
    with r.etape('ensuite', 'Ensuite : « Prête dans … (muscle) » sur chaque séance qui attend'):
        r.defiler('#homeNext', 'Ensuite')
    with r.etape('feuille', 'Toucher Épaules dans « Ensuite » : Démarrer proposé, la récupération dite', cle=cle):
        r.toucher('.view.dashboard .home-cell[data-action="session-actions"]', '1re séance d\'Ensuite')
        r.attendre('.ios-dialog--sheet', 'feuille de la séance')


@parcours('generateur', 'Programme sur mesure (générateur)', 'pratiquant')
def p_generateur(r):
    """Pratiquant régulier qui crée un programme sur mesure : Programme › Ajouter › « Créer mon programme
    sur mesure », profil repris des Réglages, prise de muscle, intermédiaire, 4 jours, 75 min, salle complète, fessiers en
    priorité, douleur d'épaule, puis l'aperçu et « Utiliser ce programme »."""
    r.lancer(REALISTE)
    cle = 'Créer un programme sur mesure'
    with r.etape('ajouter', 'Ajouter un programme : « sur mesure » en première ligne', cle=cle):
        r.onglet('program', 'Programme')
        r.toucher('[data-action="go-prog-add"]', 'Ajouter un programme')
    with r.etape('profil', 'Profil repris des Réglages', cle=cle):
        r.toucher('[data-action="go-prog-gen"]', 'Programme sur mesure')
        r.attendre('.view.prog-gen', 'générateur')
    with r.etape('objectif', 'Objectif', cle=cle):
        r.toucher('[data-action="gen-next"][data-step="toi"]', 'Commencer')
    with r.etape('niveau', 'Niveau', cle=cle):
        r.toucher('[data-action="gen-set"][data-val="muscle"]', 'Prendre du muscle')
    with r.etape('jours', 'Jours par semaine', cle=cle):
        r.toucher('[data-action="gen-set"][data-val="intermediaire"]', 'Intermédiaire')
    with r.etape('duree', 'Temps par séance', cle=cle):
        r.toucher('[data-action="gen-set"][data-val="4"]', '4 jours')
    with r.etape('materiel', 'Matériel', cle=cle):
        r.toucher('[data-action="gen-set"][data-val="75"]', '75 min')
    with r.etape('options', 'Priorités et limites', cle=cle):
        r.toucher('[data-action="gen-next"][data-step="materiel"]', 'Suivant')
        r.toucher('[data-action="gen-zone"][data-val="fessiers"]', 'Fessiers')
        r.toucher('[data-action="gen-limit"][data-val="epaule"]', 'Épaule')
    with r.etape('apercu', 'Aperçu du programme', cle=cle):
        r.toucher('[data-action="gen-next"][data-step="options"]', 'Voir le programme')
        r.attendre('[data-action="gen-use"]', 'aperçu')
    with r.etape('apercu-bas', 'Aperçu, bas de l\'écran (séances, boutons)', cle=cle):
        r.bas('bas de l\'aperçu')
    with r.etape('confirmer', '« Utiliser ce programme » : confirmation', cle=cle):
        r.toucher('[data-action="gen-use"]', 'Utiliser ce programme')
    with r.etape('programme', 'Programme créé et actif', cle=cle):
        r.choisir('Utiliser ce programme')
        r.attendre('.view.programmes .pcard', 'séances du programme')


@parcours('bibliotheque', 'Bibliothèque d\'exercices', 'pratiquant')
def p_bibliotheque(r):
    """Bibliothèque depuis l'onglet Programme, puis la fiche d'un exercice (comment faire)."""
    r.lancer(REALISTE)
    with r.etape('bibliotheque', 'Bibliothèque', cle='Ouvrir la fiche d\'un exercice de la bibliothèque'):
        r.onglet('program', 'Programme')
        r.defiler('[data-action="go-library"]', 'liste sous les cartes')
        r.toucher('[data-action="go-library"]', 'Bibliothèque')
        r.attendre('.view.library', 'Bibliothèque')
    # Exercices d'un groupe : une ligne illustrée par exercice (personnage 3D, muscle principal en rouge)
    with r.etape('groupe', 'Exercices du groupe Jambes', cle='Choisir un exercice par muscle'):
        r.toucher('.library .mgcs .mgc[data-group="jambes"]', 'groupe Jambes')
        r.attendre('#libList .mgc--ex', 'exercices illustrés')
    with r.etape('groupe-suite', 'Exercices du groupe Jambes, plus bas'):
        r.defiler('#libList .mgc--ex >> nth=6', 'exercices plus bas')
    with r.etape('fiche', 'Fiche d\'un exercice', cle='Ouvrir la fiche d\'un exercice de la bibliothèque'):
        r.toucher('.view.library [data-action="open-library-ex"]', '1er exercice')
        r.attendre('.view.library-ex', 'fiche de la bibliothèque')
    with r.etape('fiche-bas', 'Fiche, bas de l\'écran'):
        r.bas('bas de la fiche')
    # Vague 4 : animation 3D du personnage maison (sans vidéo de coach), fiche du squat barre
    with r.etape('anim-3d', 'Comment faire du squat barre : animation 3D', cle='Voir l\'animation 3D d\'un exercice'):
        r.retour()
        r.saisir('#libSearch', 'Squat barre', 'recherche')
        r.toucher('[data-action="open-library-ex"][data-name="Squat barre"]', 'Squat barre')
        r.attendre('.library-ex .exvideo--3d', 'animation 3D')
        r.defiler('.library-ex .exvideo--3d', 'animation 3D')
        r.page.wait_for_timeout(800)   # première image de la vidéo



def _defiler_fiche(r):
    """Personnage de la fiche à l'écran ; plus haut que l'écran (texte très grand), le panneau commence sous la barre
    du titre au lieu d'y passer à moitié (panel t12 : « Haut des pectoraux » à moitié caché)."""
    r.defiler('.library-ex .mpanel--atlas', 'personnage')
    r.page.evaluate("""() => { const p = document.querySelector('.library-ex .mpanel--atlas'), bar = document.querySelector('.view.library-ex .navbar');
        const g = p.closest('.group'), head = g?.querySelector('.mline2') || p;   // texte très grand : la ligne « Muscle ciblé », au-dessus du dessin, sous la barre (le haut du dessin reste à l'écran sur iPhone SE)
        const top = head.getBoundingClientRect().top, under = bar ? bar.getBoundingClientRect().bottom + 8 : 8;
        if (top < under && document.documentElement.classList.contains("type-xl")) scrollBy(0, top - under); }""")
    r.page.wait_for_timeout(200)


def _toucher_sous_muscle(r, racine, part, quoi, double=False):
    """Toucher (compté) au milieu d'un sous-muscle coloré de l'atlas : un doigt, pas un clic DOM."""
    # Sous-muscle caché par la barre d'onglets ou la barre du titre (texte très grand, iPhone SE) : amené au centre d'abord
    xy = r.page.evaluate("""([racine, part]) => { const l = document.querySelector(`${racine} .body-map__front [data-part="${part}"]`);
        if (!l) return null; let b = l.getBoundingClientRect();
        const tab = document.querySelector('.tabbar')?.getBoundingClientRect().top ?? innerHeight, nav = document.querySelector('.view:not([hidden]) .navbar')?.getBoundingClientRect().bottom ?? 0;
        const y = b.top + b.height * 0.5;
        if (!l.closest('.azoom') && (y > tab - 8 || y < nav + 8)) { scrollBy(0, y - innerHeight / 2); b = l.getBoundingClientRect(); }
        return [b.left + b.width * 0.3, b.top + b.height * 0.5]; }""", [racine, part])
    if not xy:
        raise Absent(f'introuvable : {quoi}')
    if double:   # deux clics rapprochés (une machine chargée espacerait deux clics séparés au-delà du double toucher)
        r.page.mouse.dblclick(*xy)
    else:
        r.page.mouse.click(*xy)   # click, comme un toucher sur iPhone (touchscreen.tap n'en tire pas sous WebKit)
    r._note(quoi)
    r.page.wait_for_timeout(900)   # bulle, ou ouverture de la vue agrandie et images 3× décodées


@parcours('atlas', 'Fiche exercice : sous-muscles détaillés, nom au toucher, vue agrandie', 'pratiquant')
def p_atlas(r):
    """Fiche du développé incliné barre : le personnage montre les sous-muscles (pectoral claviculaire en rouge plein,
    sterno-costal et deltoïde antérieur en rouge atténué, triceps en soutien). Un toucher donne le nom de salle et le
    nom officiel ; toucher deux fois (ou pincer) ouvre la vue agrandie, zoomée là où le doigt a touché."""
    r.lancer(REALISTE)
    with r.etape('fiche', 'Fiche du développé incliné barre : personnage détaillé', cle='Voir les muscles d\'un exercice en détail'):
        r.onglet('program', 'Programme')
        r.defiler('[data-action="go-library"]', 'liste sous les cartes')
        r.toucher('[data-action="go-library"]', 'Bibliothèque')
        r.attendre('.view.library', 'Bibliothèque')
        r.saisir('#libSearch', 'Développé incliné barre', 'recherche')
        r.toucher('[data-action="open-library-ex"][data-name="Développé incliné barre"]', 'Développé incliné barre')
        r.attendre('.view.library-ex .mpanel--atlas', 'personnage détaillé')
        _defiler_fiche(r)
    with r.etape('nom', 'Toucher le haut des pectoraux : nom de salle et nom officiel', cle='Voir les muscles d\'un exercice en détail'):
        _toucher_sous_muscle(r, '.mpanel__map', 'chest_clavicular', 'haut des pectoraux')
        r.attendre('.atlas-info', 'carte d\'info du muscle')
    with r.etape('aident', 'Toucher « Muscles qui aident » : seuls ces muscles restent sur le personnage', cle='Voir les muscles d\'un exercice en détail'):
        r.page.evaluate('closeBodyTip()')
        r.toucher('.library-ex .mline2[data-level="1"] .cell__sub', 'ligne « Muscles qui aident »')
    with r.etape('isoler', 'Toucher « Triceps » : ce seul muscle sur le personnage'):
        # Texte très grand : un nom par ligne, « + N autres » montre les suivants
        if not r.page.locator('.library-ex .mline2[data-level="1"] .mline2__name[data-label="Triceps"]').count():
            r.defiler('.library-ex .mline2[data-level="1"]', 'ligne « Muscles qui aident »')
            r.toucher('.library-ex .mline2[data-level="1"] .mline2__more', '« + N autres »')
        r.defiler('.library-ex .mline2[data-level="1"]', 'ligne « Muscles qui aident »')
        r.toucher('.library-ex .mline2[data-level="1"] .mline2__name[data-label="Triceps"]', 'nom « Triceps »')
    with r.etape('tout', 'Toucher de nouveau : tous les muscles reviennent'):
        r.toucher('.library-ex .mline2[data-level="1"] .mline2__name[data-label="Triceps"]', 'nom « Triceps »')
        _defiler_fiche(r)
    with r.etape('zoom', 'Toucher deux fois : vue agrandie, le personnage entier (face et dos)', cle='Voir les muscles d\'un exercice en détail'):
        _toucher_sous_muscle(r, '.mpanel__map', 'chest_clavicular', 'deux touchers sur la poitrine', double=True)
        r.attendre('.azoom', 'vue agrandie')
        r.page.wait_for_timeout(600)
    with r.etape('zoom-nom', 'Vue agrandie : toucher un muscle', cle='Voir les muscles d\'un exercice en détail'):
        _toucher_sous_muscle(r, '.azoom', 'chest_clavicular', 'haut des pectoraux, vue agrandie')
        r.attendre('.atlas-info', 'carte d\'info du muscle')
    with r.etape('vue-entiere', 'Vue agrandie : toucher deux fois pour agrandir la poitrine'):
        r.page.evaluate('closeBodyTip()')
        _toucher_sous_muscle(r, '.azoom', 'chest_clavicular', 'deux touchers sur la poitrine', double=True)
        try:
            r.page.wait_for_function("() => atlasViewerState()?.hi === 'front'", timeout=8000)
        except Exception:
            pass
        r.page.wait_for_timeout(600)
    with r.etape('fermer', 'OK : retour à la fiche'):
        r.toucher('.sheet-root--atlas .sheet__btn--confirm', 'OK')
        r.page.wait_for_timeout(400)
    # Bas du corps (sans vidéo ni secondaire : avant le tour 1, aucun personnage) et dos
    for nom, slug, part in [('Abducteurs machine', 'abducteurs', 'glute_med'), ('Tractions pronation', 'tractions', 'lats')]:
        with r.etape(f'fiche-{slug}', f'Fiche {nom} : personnage cadré, pastilles du dessin', cle='Voir les muscles d\'un exercice en détail'):
            r.retour()
            r.saisir('#libSearch', nom, 'recherche')
            r.toucher(f'[data-action="open-library-ex"][data-name="{nom}"]', nom)
            r.attendre('.view.library-ex .mpanel--atlas', 'personnage détaillé')
            _defiler_fiche(r)
        with r.etape(f'nom-{slug}', f'Fiche {nom} : toucher le muscle principal'):
            xy = r.page.evaluate("""part => { const l = document.querySelector(`.mpanel__map .body-map__back [data-part="${part}"]`);
                if (!l) return null; const b = l.getBoundingClientRect(); return [b.left + b.width * 0.15, b.top + b.height * 0.5]; }""", part)
            if not xy:
                raise Absent(f'introuvable : {part}')
            r.page.mouse.click(*xy)
            r._note(f'{nom} : muscle principal')
            r.page.wait_for_timeout(700)
    # Silhouette femme (panel t2) : la fiche du développé incliné, les abducteurs (cadrage) et le nom sur les tractions
    r.raccourci("() => { data.silhouette = 'female'; save(); navigate(makeRoute('library-ex', 'Développé incliné barre')); }", 'silhouette femme (Réglages)')
    with r.etape('fiche-femme', 'Silhouette femme : fiche du développé incliné barre'):
        r.attendre('.view.library-ex .mpanel--atlas .body-map[data-body="female"]', 'personnage femme')
        _defiler_fiche(r)
    # Développé couché (panel de l'affiche) : le pectoral se colore autour du sein, le sein reste au gris du corps
    r.raccourci("() => navigate(makeRoute('library-ex', 'Développé couché barre'))", 'fiche Développé couché barre')
    with r.etape('fiche-couche-femme', 'Silhouette femme : fiche du développé couché barre (pectoraux autour du sein)'):
        r.attendre('.view.library-ex .mpanel--atlas .body-map[data-body="female"]', 'personnage femme')
        _defiler_fiche(r)
    r.raccourci("() => navigate(makeRoute('library-ex', 'Abducteurs machine'))", 'fiche Abducteurs machine')
    with r.etape('fiche-abducteurs-femme', 'Silhouette femme : fiche Abducteurs machine, cadrage'):
        r.attendre('.view.library-ex .mpanel--atlas', 'personnage détaillé')
        _defiler_fiche(r)
    r.raccourci("() => navigate(makeRoute('library-ex', 'Tractions pronation'))", 'fiche Tractions pronation')
    with r.etape('nom-tractions-femme', 'Silhouette femme : Tractions pronation, toucher le grand dorsal'):
        r.attendre('.view.library-ex .mpanel--atlas', 'personnage détaillé')
        _defiler_fiche(r)
        xy = r.page.evaluate("""() => { const l = document.querySelector('.mpanel__map .body-map__back [data-part="lats"]');
            if (!l) return null; const b = l.getBoundingClientRect(); return [b.left + b.width * 0.15, b.top + b.height * 0.5]; }""")
        if not xy:
            raise Absent('introuvable : grand dorsal')
        r.page.mouse.click(*xy)
        r._note('Tractions pronation : grand dorsal')
        r.page.wait_for_timeout(700)



# Bas du corps (atlas, 21/11) : exercice, sous-muscle principal touché (vue de face ou de dos)
# dernier champ : abscisse du toucher dans la boîte du calque, qui couvre les DEUX jambes (0 = bord gauche de
# l'image) : il faut viser la jambe de gauche, côté du muscle (dehors ou dedans)
JAMBES = [('Squat barre', 'squat', 'front', 'vastus_lateralis', 0.08),
          ('Soulevé de terre roumain', 'sdt-roumain', 'back', 'semitendinosus', 0.33),
          ('Abducteurs machine', 'abducteurs', 'back', 'glute_med', 0.12),
          ('Mollets debout', 'mollets', 'back', 'gastro_medial', 0.33)]


@parcours('atlas-jambes', 'Fiche exercice, bas du corps : sous-muscles des jambes, homme et femme', 'pratiquant')
def p_atlas_jambes(r):
    """Fiches de 4 exercices de jambes (squat, soulevé de terre roumain, abducteurs, mollets) : personnage cadré sur le
    bas du corps, sous-muscles colorés, nom au toucher du muscle principal ; puis les mêmes en silhouette femme."""
    r.lancer(REALISTE)
    r.onglet('program', 'Programme')
    r.defiler('[data-action="go-library"]', 'liste sous les cartes')
    r.toucher('[data-action="go-library"]', 'Bibliothèque')
    r.attendre('.view.library', 'Bibliothèque')
    for sexe in ('male', 'female'):
        if sexe == 'female':
            r.raccourci("() => { data.silhouette = 'female'; save(); }", 'silhouette femme (Réglages)')
        for nom, slug, vue, part, fx in JAMBES:
            suf = '' if sexe == 'male' else '-femme'
            with r.etape(f'fiche-{slug}{suf}', f'Fiche {nom}{" (femme)" if suf else ""} : personnage cadré sur les jambes',
                         cle='Voir les muscles d\'un exercice en détail'):
                r.raccourci(f"() => navigate(makeRoute('library-ex', {nom!r}))", f'fiche {nom}')
                r.attendre('.view.library-ex .mpanel--atlas', 'personnage détaillé')
                r.defiler('.library-ex .mpanel--atlas', 'personnage')
            with r.etape(f'nom-{slug}{suf}', f'Fiche {nom}{" (femme)" if suf else ""} : toucher le muscle principal'):
                xy = r.page.evaluate("""([v, part, fx]) => { const l = document.querySelector(`.mpanel__map .body-map__${v} [data-part="${part}"]`);
                    if (!l) return null; const b = l.getBoundingClientRect(); return [b.left + b.width * fx, b.top + b.height * 0.5]; }""", [vue, part, fx])
                if not xy:
                    raise Absent(f'introuvable : {part}')
                r.page.mouse.click(*xy)
                r._note(f'{nom} : muscle principal')
                r.page.wait_for_timeout(700)

def _avec_vacuum():
    """Données réalistes, plus du vacuum en fin de séance Jambes : une séance d'avant en séries × reps (ancienne
    version), deux en secondes (maintiens)."""
    d = json.loads(REALISTE)
    d['programmes']['ppl']['exercises']['legs'].append({'id': 'vacuum01', 'name': 'Vacuum', 'sets': 5, 'lastWeight': '',
                                                         'lastReps': '', 'pr': None, 'est1RM': None, 'target': None})
    def seance(i, jours, series, mesure=None):
        ex = {'exId': 'vacuum01', 'name': 'Vacuum', 'sets': [{'weight': '', 'reps': str(r)} for r in series]}
        if mesure:
            ex['measure'] = mesure
        return {'id': f'hvac{i}', 'programme': 'ppl', 'category': 'legs', 'date': days_back_ms(NOW, jours, 18, tz=PARIS),
                'duration': 20 * 60_000, 'notes': '', 'exercises': [ex]}
    d['history'] += [seance(0, 9, [12, 12, 12]), seance(1, 5, [10] * 5, 'time'), seance(2, 2, [15, 15, 12, 12, 12], 'time')]
    d['history'].sort(key=lambda h: -h['date'])
    return json.dumps(d, ensure_ascii=False, separators=(',', ':'))


@parcours('vacuum', 'Vacuum : fiche, maintiens chronométrés guidés, records en secondes', 'pratiquant')
def p_vacuum(r):
    """Vacuum abdominal (docs/VACUUM.md) : fiche de la Bibliothèque (personnage sans rouge, transverse), carte de
    séance en maintiens sans colonne de charge, chrono guidé, maintien validé, Progrès en secondes."""
    r.lancer(_avec_vacuum())
    with r.etape('fiche', 'Fiche du vacuum : personnage sans rouge, « Transverse, muscle profond »', cle='Ouvrir la fiche du vacuum'):
        r.onglet('program', 'Programme')
        r.defiler('[data-action="go-library"]', 'liste sous les cartes')
        r.toucher('[data-action="go-library"]', 'Bibliothèque')
        r.attendre('.view.library', 'Bibliothèque')
        r.saisir('#libSearch', 'Vacuum', 'recherche')
        r.toucher('[data-action="open-library-ex"][data-name="Vacuum"]', 'Vacuum')
        r.attendre('.view.library-ex', 'fiche du vacuum')
    with r.etape('fiche-consignes', 'Fiche du vacuum : consignes'):
        r.defiler('.library-ex .howto__cues', 'consignes')
    r.raccourci("""() => { startSession('legs'); const ei = activeSession.exercises.findIndex(e => e.name === 'Vacuum');
        activeSession.exercises.forEach((e, i) => { if (i !== ei) e.sets.forEach(s => { s.done = true; s.reps = s.reps || '10'; }); });
        persistSession(); render(); }""", 'séance Jambes, exercices avant le vacuum faits')
    with r.etape('seance-carte', 'Carte du vacuum : N°, Avant, Durée, sans colonne de charge', cle='Faire un maintien guidé'):
        r.defiler('.view.session .ex-card:has(.sets--noload)', 'carte du vacuum')
    with r.etape('chrono-prep', 'Chrono guidé : préparation « Expire tout ton air »', cle='Faire un maintien guidé'):
        r.toucher('.view.session .sets--noload .set-play', '▶ du maintien')
        r.attendre('.rs--effort', 'chrono')
    with r.etape('chrono-maintien', 'Chrono guidé : pendant le maintien « Respire petit, dos immobile »'):
        r.raccourci("() => { activeSession.effort.start -= 7000; updateEffortUI(); }", '2 s dans le maintien')
    with r.etape('maintien-valide', 'Maintien validé en secondes, repos de 15 s', cle='Faire un maintien guidé'):
        r.raccourci("() => { activeSession.effort.start -= 20000; updateEffortUI(); }", 'fin du maintien')
        r.page.wait_for_timeout(400)
        passer_repos(r)
        r.defiler('.view.session .ex-card:has(.sets--noload)', 'carte du vacuum')
    r.raccourci("() => navigate(makeRoute('stats-ex', 'vacuum01'))", 'Progrès › Vacuum')
    with r.etape('progres', 'Progrès › Vacuum : plus long maintien, temps total sous tension'):
        r.attendre('.view.stats-ex', 'Progrès › Vacuum')

def coller(r, sel, texte, quoi):
    """Collage comme sur iPhone : le champ touché, puis le texte coupé par le maxlength et un événement input de type
    insertFromPaste SANS data (ce que fait Safari iOS), précédé de beforeinput et de paste."""
    r.toucher(sel, quoi)
    r.raccourci("""([s, t]) => { const e = document.querySelector(s); e.dispatchEvent(new Event('paste', { bubbles: true }));
        e.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertFromPaste' }));
        e.value = e.maxLength > 0 ? t.slice(0, e.maxLength) : t;
        e.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' })); }""", f'{quoi} : texte collé', [sel, texte])


@parcours('champs-limites', 'Champs de saisie : limites, collages trop longs et messages de refus', 'pratiquant')
def p_champs_limites(r):
    """Le « pire testeur » : un nom d'exercice et un nom de séance collés trop longs (coupés à 80 et 40 caractères),
    un nom fait d'espaces invisibles, un objectif de 0 kg, un âge de 300 ans, une taille « 175,5 » (arrondie), un poids du
    corps « 72,5 », une note de bilan collée trop longue, un aliment sans nom, un commentaire au-delà de 500 caractères, un numéro
    de carte pro refusé puis « 04/912 ED.0123 » accepté."""
    r.lancer(REALISTE)
    long = 'Développé couché prise serrée avec pause en bas et tempo lent sur barre, banc incliné à trente degrés'
    with r.etape('exercice-nom-long', 'Fiche exercice : nom collé de 100 caractères, coupé à 80', cle='Nom d\'exercice trop long'):
        r.raccourci("exDraft = null; navigate(makeRoute('ex-edit', 'push', 0))", 'fiche du 1er exercice ouverte')
        r.attendre('#exName', 'nom de l\'exercice')
        coller(r, '#exName', long, 'nom de l\'exercice')
    with r.etape('objectif-zero', 'Objectif de 0 kg : message de refus', cle='Objectif de charge refusé'):
        r.saisir('#exTarget', '0', 'objectif')
        r.toucher('[data-action="save-ex"]', 'OK')
    with r.etape('seance-nom-invisible', 'Nouvelle séance : nom fait d\'espaces invisibles, refusé', cle='Nom de séance'):
        r.raccourci('void openNewSession()', 'écran « Nouvelle séance » ouvert')
        r.attendre('#csName', 'nom de la séance')
        r.saisir('#csName', '\u200b\u200b ', 'nom de la séance')
        r.toucher('[data-action="save-cs-modal"]', 'OK')
    with r.etape('seance-nom-long', 'Nom de séance collé trop long : coupé à 40', cle='Nom de séance'):
        coller(r, '#csName', 'Haut du corps lourd, épaules et bras, version longue du lundi', 'nom de la séance')
    with r.etape('age-refuse', 'Âge « 300 » : fenêtre ouverte, valeur gardée, message sous le champ', cle='Taille et poids'):
        r.raccourci("routeTo('dashboard')", 'retour à l\'accueil')
        reglages(r)
        r.raccourci("void handleAction(new Event('click'), document.body, 'set-profile-age')", 'Réglages › Âge')
        r.attendre('.ios-dialog__input', 'champ de l\'âge')
        r.saisir('.ios-dialog__input', '300', 'âge')
        r.choisir('OK')
    with r.etape('taille-decimale', 'Taille « 175,5 » : arrondie à 176 cm', cle='Taille et poids'):
        r.choisir('Annuler')
        r.raccourci("void handleAction(new Event('click'), document.body, 'set-profile-height')", 'Réglages › Taille')
        r.attendre('.ios-dialog__input', 'champ de la taille')
        r.saisir('.ios-dialog__input', '175,5', 'taille')
        r.choisir('OK')
    with r.etape('poids-virgule', 'Poids du corps « 72,5 » avec la virgule', cle='Taille et poids'):
        r.raccourci("void handleAction(new Event('click'), document.body, 'set-body-weight')", 'Réglages › Poids du corps')
        r.attendre('.ios-dialog__input', 'champ du poids')
        r.saisir('.ios-dialog__input', '72,5', 'poids du corps')
    with r.etape('poids-enregistre', 'Poids enregistré', cle='Taille et poids'):
        r.choisir('OK')
    with r.etape('aliment-sans-nom', 'Nouvel aliment sans nom : message dans la feuille', cle='Nutrition'):
        r.raccourci('void dietNewFood()', 'feuille « Nouvel aliment » ouverte')
        r.attendre('#dietFoodName', 'nom de l\'aliment')
        r.saisir('#dietFoodK', '120', 'énergie')
        r.toucher('.sheet__btn--confirm', 'OK')
    with r.etape('bilan-note-longue', 'Bilan : note de 2 100 caractères collée, coupée à 2 000 et dit', cle='Notes de séance'):
        r.raccourci("document.querySelectorAll('.sheet-root').forEach(s => s._close ? s._close() : s.remove()); "
                    "lastSummary = buildSummary(data.history[data.history.length - 1]); routeTo('summary')", 'bilan de la dernière séance')
        r.attendre('#summaryNotes', 'notes du bilan')
        coller(r, '#summaryNotes', ('Bonne séance, épaule gauche un peu sensible sur le développé, à surveiller. ' * 30)[:2100], 'notes du bilan')
    with r.etape('commentaire-trop-long', 'Commentaire au-delà de 500 caractères : compteur rouge, Envoyer grisé', cle='Commentaires'):
        r.connecter('max', amis=True)
        r.raccourci("""() => { const now = Date.now();
            const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', sessions: [{ id: 'l01', date: now - 86400e3, duration: 3e6,
              programme: 'ppl', category: 'push', label: 'Push', exercises: [{ name: 'Développé couché', sets: [{ weight: '80', reps: '8' }] }] }] });
            const me = __sb.meId(); __sb.follow(me, lea); __sb.follow(lea, me); }""", 'Léa, amie qui s\'entraîne')
        r.raccourci("routeTo('friends')", 'onglet Amis')
        r.toucher('.feed-card .feed-card__main', 'séance de Léa')
        r.attendre('#commentInput', 'champ du commentaire')
        r.raccourci("() => { const t = document.querySelector('#commentInput'); t.value = 'Belle séance ! '.repeat(34); "
                    "t.dispatchEvent(new Event('input', { bubbles: true })); }", 'commentaire de 510 caractères collé')
        r.defiler('.comment-compose', 'champ du commentaire et son compteur')
    with r.etape('carte-refusee', 'Demande de coach : numéro de carte « 12 » refusé, avec son message', cle='Carte pro'):
        r.raccourci("navigate('coach-request')", 'Réglages › Devenir coach')
        r.attendre('#coachReqName', 'formulaire de la demande')
        r.saisir('#coachReqName', 'Jean Dupont', 'nom sur la carte')
        r.saisir('#coachReqCard', '12', 'numéro de carte')
        r.raccourci("() => { const s = document.querySelector('#coachReqDiploma'); s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); }", 'diplôme choisi')
        r.toucher('[data-action="coach-request-send"]', 'Envoyer ma demande')
    with r.etape('carte-acceptee', 'Numéro « 04/912 ED.0123 » accepté (points, barres et espaces ignorés comme par le serveur)', cle='Carte pro'):
        r.saisir('#coachReqCard', '04/912 ED.0123', 'numéro de carte')
        r.toucher('[data-action="coach-request-send"]', 'Envoyer ma demande')


@parcours('reglages', 'Réglages (chaque groupe)', 'pratiquant')
def p_reglages(r):
    """Réglages ouverts depuis l'accueil, puis chaque groupe amené en haut de l'écran."""
    r.lancer(REALISTE)
    with r.etape('haut', 'Réglages, haut de l\'écran', cle='Ouvrir les réglages'):
        reglages(r)
    titres = r.page.evaluate("[...document.querySelectorAll('.settings-view .group-title')].map(e => e.textContent.trim())")
    for i, t in enumerate(titres[1:], 1):
        with r.etape(f'groupe-{t}', f'Groupe « {t} »'):
            r.defiler(f'.settings-view .group-title >> nth={i}', f'« {t} »')
    # Connecté : carte du compte (avatar, pseudo) et Abonnement en tête, groupe Social et coach complet
    r.connecter('max', amis=True)
    with r.etape('connecte-haut', 'Connecté : carte du compte et Abonnement'):
        r.page.evaluate("() => { render(); document.querySelectorAll('#app .scr').forEach(e => { e.scrollTop = 0; }); scrollTo(0, 0); }")
        r.attendre('.settings-view [data-action="go-account"]', 'carte du compte')
    with r.etape('connecte-social', 'Connecté : groupe « Social et coach »'):
        r.defiler('.settings-view [data-action="coach-open-settings"]', '« Social et coach »')


# Coquille iOS factice de la build 68 : le module de sons publie sa méthode diagnostics (Capacitor.PluginHeaders),
# signe que la coquille sait baisser la musique (Native.sound.canDuck) ; tous les autres modules répondent vide
COQUILLE_SONS_68 = """
window.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'ios',
  isPluginAvailable: n => n === 'MdlfSound',
  PluginHeaders: [{ name: 'MdlfSound', methods: [{ name: 'play' }, { name: 'diagnostics' }] }],
  registerPlugin: name => name === 'App' ? { addListener: async () => ({ remove() {} }), getInfo: async () => ({ build: '68', version: '1.3' }) }
    : new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) }),
};
"""


@parcours('reglages-sons', 'Réglages : sons et « Baisser la musique » (app iOS, build 68)', 'pratiquant')
def p_reglages_sons(r):
    """App iOS à jour (build 68) : Réglages, groupe des sons ; « Baisser la musique » pendant le décompte de fin
    de repos, activé d'office, puis coupé. Coquille iOS simulée."""
    r.coquille_native(COQUILLE_SONS_68)
    r.lancer(REALISTE)
    cle = 'Régler « Baisser la musique »'
    with r.etape('sons', 'Réglages, groupe des sons : « Baisser la musique »', cle=cle):
        reglages(r)
        r.defiler('[data-action="setting-duck"]', '« Baisser la musique »')
    with r.etape('sons-coupe', '« Baisser la musique » coupé', cle=cle):
        r.toucher('[data-action="setting-duck"]', 'Baisser la musique')


@parcours('guide', 'Guide', 'pratiquant')
def p_guide(r):
    """Guide d'utilisation depuis les Réglages, puis un sujet."""
    r.lancer(REALISTE)
    with r.etape('guide', 'Guide (Réglages › Guide)', cle='Trouver de l\'aide dans le guide'):
        reglages(r)
        r.defiler('[data-action="go-guide"]', 'Guide')
        r.toucher('[data-action="go-guide"]', 'Guide')
        r.attendre('.guide-view', 'Guide')
    with r.etape('sujet', 'Un sujet du guide', cle='Trouver de l\'aide dans le guide'):
        r.toucher('[data-action="open-guide-topic"]', '1er sujet')


@parcours('social', 'Social V2 : fil, carte de séance, commenter, recherche, Mon profil', 'pratiquant')
def p_social(r):
    """Onglet Social (docs/SOCIAL_V2.md) sans compte (invitation à se connecter), puis connecté : activation, fil vide
    (« Aucune personne suivie », Inviter un ami, champ de recherche), recherche d'un pseudo, fil avec une amie qui
    s'entraîne (carte de séance : chiffres, record, muscles), sa séance, « Commenter » et un commentaire envoyé,
    puis Mon profil."""
    r.lancer(REALISTE)
    with r.etape('sans-compte', 'Onglet Social sans compte'):
        r.onglet('friends', 'Social')
    with r.etape('connexion', '« Se connecter » : écran de compte'):
        r.toucher('[data-action="social-sign-in"]', 'Se connecter')
    r.connecter('max')
    with r.etape('activer', 'Connecté : retour à Social, carte d\'activation', cle='Activer Social'):
        r.retour()
        r.attendre('[data-action="social-enable"]', 'carte d\'activation')
    with r.etape('fil-vide', 'Social activé, fil vide : « Aucune personne suivie », Inviter un ami, champ de recherche au-dessus', cle='Activer Social'):
        r.toucher('[data-action="social-age"]', 'J\'ai 15 ans ou plus')
        r.toucher('[data-action="social-enable"]', 'Activer')
        r.attendre('#friendsBody [data-action="social-invite"]', 'fil vide avec « Inviter un ami »')
    # Léa (suivie, 3 séances, un record) et Tom (demande reçue) arrivent sur le serveur ; le fil n'est relu qu'après
    r.raccourci("""async (s) => { const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', sessions: s });
        const tom = __sb.addPerson({ username: 'tom', avatar: '🐻' });
        __sb.follow(__sb.meId(), lea, 'accepted'); __sb.follow(tom, __sb.meId(), 'pending'); }""",
                'Léa (suivie, 3 séances dont un record) et une demande de Tom sur le serveur', seances_amie())
    with r.etape('recherche', 'Rechercher un pseudo : « tom »', cle='Trouver un ami par son pseudo'):
        r.saisir('#socialSearch', 'tom', 'champ « Rechercher un pseudo »')
        r.page.wait_for_timeout(600)   # recherche lancée 250 ms après la frappe
    r.raccourci("""async () => { socialQuery = ''; socialResults = null; document.activeElement?.blur?.();
        await socialRefresh(); await socialLoadFeed(''); render(); }""", 'recherche effacée, fil relu')
    with r.etape('fil', 'Fil : carte de séance de Léa et demande de Tom'):
        r.attendre('.feed-card', 'carte du fil')
    # Réactions (17/11) : le cœur, « + » pour les autres, double toucher sur le résumé d'une carte
    with r.etape('jaime', 'Un toucher sur le cœur : ❤️ « J\'aime »', cle='Aimer la séance d\'une amie'):
        r.toucher('.feed-card [data-action="social-react"]', 'cœur')
    with r.etape('autres-reactions', '« + » à côté du cœur : 🔥 💪 🏆 👏 😮', cle='Choisir une autre réaction'):
        r.toucher('.feed-card [data-action="social-react-more"]', 'Autres réactions')
    with r.etape('double-toucher', 'Double toucher sur le résumé de la 2e carte (muscles, chiffres) : ❤️ et cœur animé', cle='Aimer la séance d\'une amie'):
        r.page.keyboard.press('Escape')
        r.page.locator('.feed-card').nth(1).locator('[data-like-zone]').scroll_into_view_if_needed()
        r.page.locator('.feed-card').nth(1).locator('[data-like-zone]').dblclick()
        r.page.wait_for_timeout(150)
    with r.etape('seance-amie', 'Séance d\'une amie', cle='Voir la séance d\'une amie'):
        r.toucher('.feed-card [data-action="social-open-session"]', 'carte de Léa')
    with r.etape('commenter', '« Commenter » : la séance s\'ouvre sur ses commentaires', cle='Commenter la séance d\'une amie'):
        r.retour()
        r.toucher('.feed-card [data-action="social-open-comments"]', 'Commenter')
        r.saisir('#commentInput', 'Bravo pour le squat !', 'commentaire')
    with r.etape('commentaire-envoye', 'Commentaire envoyé', cle='Commenter la séance d\'une amie'):
        r.toucher('[data-action="comment-send"]', 'Envoyer')
    with r.etape('mon-profil', 'Mon profil : Modifier, Inviter un ami', cle='Ouvrir Mon profil'):
        r.retour()
        r.toucher('.navbar [data-action="social-me"]', 'Mon profil (avatar de la barre)')
        r.attendre('.social-me-view', 'Mon profil')


def seances_amie():
    out = []
    for i, (lab, cat, exs) in enumerate([('Push', 'push', [('Développé couché', '45', '8'), ('Élévations latérales', '8', '12')]),
                                         ('Legs', 'legs', [('Squat barre', '70', '6'), ('Presse à cuisses', '140', '10')]),
                                         ('Pull', 'pull', [('Tirage vertical', '45', '10'), ('Curl biceps', '12', '10')])]):
        out.append({'id': f'lea{i}', 'date': days_back_ms(NOW, i + 1, 9, tz=PARIS), 'duration': 55 * 60_000, 'programme': 'ppl',
                    'category': cat, 'label': lab,
                    'exercises': [{'name': n, 'sets': [{'weight': w, 'reps': rp}] * 3} for n, w, rp in exs]})
    return out


@parcours('hors-ligne', 'Hors ligne', 'pratiquant')
def p_hors_ligne(r):
    """Connecté, Social activé, puis plus de réseau (salle en sous-sol) : onglet Social, compte, une séance qui démarre quand même."""
    r.lancer(REALISTE)
    r.connecter('max', amis=True)
    r.page.context.set_offline(True)
    r.raccourci("() => { __sb.fail.social = 'offline'; __sb.fail.coach = 'offline'; __sb.fail.chat = 'offline'; window.dispatchEvent(new Event('offline')); }",
                'réseau coupé (navigateur et faux serveur)')
    with r.etape('social', 'Onglet Social hors ligne'):
        r.onglet('friends', 'Social')
    with r.etape('seance', 'Séance démarrée hors ligne'):
        r.onglet('train', 'Entraînement')
        r.toucher('.view.dashboard [data-action="start-session"]', 'Démarrer')
        r.attendre('.view.session', 'séance')
    r.page.context.set_offline(False)


# ─────────────────────────────────────────────────────────────
#  Coach (faux serveur : tests/fake_account.py)
# ─────────────────────────────────────────────────────────────
COACH_PROG = {
    'name': 'Force', 'consigne': 'Trois séances par semaine, un jour de repos entre deux.',
    'sessions': [
        {'key': 'sA', 'label': 'Haut', 'color': '#FF9500', 'exercises': [
            {'name': 'Développé couché', 'sets': 4, 'rest': 120, 'tempo': '3-1-1-0', 'consigne': 'Coudes serrés, descends en 3 secondes.'},
            {'name': 'Rowing haltère unilatéral', 'sets': 4, 'ss': 'g1'},
            {'name': 'Pompes', 'sets': 3, 'ss': 'g1', 'consigne': 'Gainage serré.'}]},
        {'key': 'sB', 'label': 'Bas', 'color': '#34C759', 'exercises': [
            {'name': 'Squat barre', 'sets': 5, 'repMin': 3, 'repMax': 5, 'intens': 'topback'},
            # Charge prescrite par le coach (js/data/coach-presc.js) : « Coach : 120 kg × 10 »
            {'name': 'Presse à cuisses', 'sets': 3, 'repMax': 10, 'repFixed': True, 'load': 120}]},
    ],
}


def seances_eleve(n=12):
    """Séances de Léa vues par son coach (une par jour à 10 h, la plus récente hier), comme tests/test_coach.py."""
    out = []
    for i in range(n):
        push = i % 2 == 0
        out.append({'id': f'l{i:02d}', 'date': days_back_ms(NOW, i + 1, 10, tz=PARIS), 'duration': 50 * 60_000, 'programme': 'ppl',
                    'category': 'push' if push else 'legs', 'label': 'Push' if push else 'Legs',
                    'notes': 'Épaule un peu raide' if i == 0 else '',
                    'exercises': [{'name': 'Développé couché', 'sets': [{'weight': '40', 'reps': '8'}, {'weight': '40', 'reps': '7'}]},
                                  {'name': 'Rowing', 'ss': 'g1', 'sets': [{'weight': '20', 'reps': '10'}]},
                                  {'name': 'Pompes', 'ss': 'g1', 'sets': [{'weight': '', 'reps': '15'}]}] if push else
                                 [{'name': 'Squat barre', 'sets': [{'weight': '60', 'reps': '6'}] * 3},
                                  {'name': 'Presse à cuisses', 'sets': [{'weight': '120', 'reps': '10'}] * 3}]})
    out[0].update({'programme': 'u_c00000000_u_force', 'category': 'sA', 'label': 'Haut'})
    return out


PREPARE_COACH = """([s, seen]) => {
    const me = __sb.meId();
    __sb.makeCoach(me);
    const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false, sessions: s });
    const tom = __sb.addPerson({ username: 'tom' });
    __sb.link(me, lea, Date.now() - 20 * 86400000);
    __sb.link(me, tom);
    __sb.co.links.find(l => l.student === lea).seen = seen;
    __sb.msg(lea, false, "J'ai senti mon épaule sur le développé, je baisse la charge ?", Date.now() - 3 * 3600e3);
    data.userProgrammes.u_force = { name: 'Force', archived: false, sessions: {
      sA: { label: 'Haut', icon: '', desc: '', color: '#FF9500' }, sB: { label: 'Bas', icon: '', desc: '', color: '#34C759' } } };
    data.programmes.u_force = { timers: {}, cooldowns: {}, exercises: {
      sA: [{ id: 'e1', name: 'Développé couché', sets: 4, rest: 120, lastWeight: '80' }, { id: 'e2', name: 'Rowing', sets: 4, ss: 'g1' }, { id: 'e3', name: 'Pompes', sets: 3, ss: 'g1' }],
      sB: [{ id: 'e4', name: 'Squat barre', sets: 5 }] } };
    data.myProgrammes.push('u_force'); save();
    return coachRefresh();
}"""


@parcours('coach', 'Coach : élèves, séance, commentaire, programme, messages', 'coach')
def p_coach(r):
    """Coach validé (max) avec deux élèves : Léa (12 séances, un message non lu) et Tom (aucune séance).
    Il ouvre Léa, une séance, la commente, lui envoie son programme « Force » avec une consigne, puis lui répond."""
    r.lancer(REALISTE)
    r.connecter('max')
    r.raccourci(PREPARE_COACH, 'rôle coach validé, élèves Léa et Tom, programme « Force », message de Léa',
                [seances_eleve(), days_back_ms(NOW, 3, 9, tz=PARIS)])
    with r.etape('mes-eleves', 'Onglet Coach : segment Élèves (docs/SOCIAL_V2.md)', cle='Ouvrir la dernière séance d\'un élève'):
        r.onglet('friends', 'Coach')
        r.attendre('.coach-team .coach-student-row', 'Élèves')
    with r.etape('segment-social', 'Onglet Coach : segment Social (amis et fil du coach)', cle='Voir son fil d\'amis (coach)'):
        r.toucher('.social-seg [data-seg="friends"]', 'segment Social')
    with r.etape('segment-eleves', 'Retour au segment Élèves', cle='Ouvrir la dernière séance d\'un élève'):
        r.toucher('.social-seg [data-seg="students"]', 'segment Élèves')
        r.attendre('.coach-team .coach-student-row', 'Élèves')
    with r.etape('eleve', 'Fiche de Léa (séances, messages, envoyer)', cle='Ouvrir la dernière séance d\'un élève'):
        r.toucher('.coach-student-row', 'Léa', texte='lea')
        r.attendre('.coach-student-view', 'fiche de l\'élève')
    with r.etape('seance-eleve', 'Une séance de Léa', cle='Ouvrir la dernière séance d\'un élève'):
        r.toucher('.coach-sess', 'séance la plus récente')
        r.attendre('.coach-session-view', 'séance de l\'élève')
    with r.etape('commenter', 'Commenter la séance (feuille)', cle='Commenter une séance'):
        r.toucher('[data-action="coach-comment"]', 'Commenter')
        r.saisir('#coachSheetText', 'Belle séance, garde 2 minutes de repos sur le développé.', 'commentaire')
    with r.etape('commentaire-envoye', 'Commentaire enregistré', cle='Commenter une séance'):
        r.toucher('.sheet__btn--confirm', 'Enregistrer')
    with r.etape('envoyer-choix', 'Envoyer un programme : choix du programme', cle='Envoyer un programme à un élève'):
        r.retour()
        r.toucher('[data-action="coach-send"]', 'Envoyer un programme')
    with r.etape('envoyer-consignes', 'Consignes du programme à envoyer', cle='Envoyer un programme à un élève'):
        r.choisir('Force')
        r.attendre('.coach-send-view', 'écran d\'envoi')
        r.saisir('.coach-textarea[data-prog]', 'Trois séances par semaine.', 'consigne générale')
    with r.etape('programme-envoye', 'Programme envoyé : retour à la fiche', cle='Envoyer un programme à un élève'):
        r.toucher('[data-action="coach-send-go"]', 'Envoyer')
    with r.etape('messages', 'Messages avec Léa', cle='Répondre à un élève'):
        r.toucher('.chat-cell', 'Messages')
        r.attendre('.coach-chat-view', 'conversation')
    with r.etape('message-envoye', 'Réponse envoyée', cle='Répondre à un élève'):
        r.saisir('#chatInput', 'Oui, baisse de 10 % et garde 3 secondes à la descente.', 'message')
        r.toucher('.chat-compose .comment-compose__send', 'Envoyer')


PREPARE_BOITE = """(n) => {
    const me = __sb.meId(); __sb.makeCoach(me); __sb.setTier(me, 'com.mdlf.training.coachmax.yearly');
    const now = Date.now(), noms = ['lea', 'tom', 'ines', 'hugo', 'jade', 'noah', 'lina', 'adam', 'chloe', 'enzo'], ids = [];
    for (let i = 0; i < n; i++) {
      const s = i < 6 ? [{ id: 's' + i, date: now - (i + 1) * 3600e3, duration: 3000e3, programme: 'ppl', category: 'push', label: 'Push', exercises: [] }] : [];
      const id = __sb.addPerson({ username: noms[i % 10] + (i >= 10 ? String(i) : ''), avatar: ['🦊', '🐻', '🦁', '🐼'][i % 4], social: false, sessions: s });
      __sb.link(me, id, now - 40 * 86400e3); ids.push(id);
      if (i % 3 === 0) { __sb.push.devices['e'.repeat(60) + String(i).padStart(4, '0')] = id; __sb.push.prefs[id] = { messages: true }; }
    }
    const txt = ["J'ai senti mon épaule sur le développé, je baisse la charge ?", 'Séance faite, 4 x 8 au squat', 'Merci pour le programme !',
      'Je pars en vacances la semaine prochaine', 'Top, on garde ça', 'Pense à noter ton RIR sur chaque série'];
    for (let i = 0; i < 12; i++) __sb.msg(ids[i], i % 4 === 3, txt[i % 6], now - (i * 5 + 1) * 3600e3);
    __sb.co.links.forEach(l => { if (l.coach === me) l.seen = new Date(now - 30 * 3600e3).toISOString(); });
    return coachRefresh();
}"""


@parcours('boite-coach', 'Coach de 30 élèves : filtres, Messages, envoi à plusieurs', 'coach')
def p_boite_coach(r):
    """Coach de 30 élèves : 12 conversations (des non-lues), 6 élèves avec une nouvelle séance, un sur trois avec
    les notifications. Filtres de Mes élèves, segment Messages, une conversation, puis envoi d'un programme à plusieurs."""
    r.lancer(REALISTE)
    r.connecter('max')
    r.raccourci(PREPARE_BOITE, 'coach de 30 élèves, 12 conversations, 6 nouvelles séances', 30)
    with r.etape('eleves-filtres', 'Onglet Coach : Élèves, filtres et compteurs', cle='Trouver les élèves à relancer'):
        r.onglet('friends', 'Coach')
        r.attendre('.coach-team .coach-student-row', 'Élèves')
    with r.etape('filtre-nouveautes', 'Filtre Nouveautés', cle='Trouver les élèves à relancer'):
        r.toucher('.coach-filter[data-filter="fresh"]', 'Nouveautés')
    with r.etape('messages', 'Segment Messages : toutes les conversations', cle='Répondre à un élève'):
        r.toucher('.social-seg [data-seg="messages"]', 'Messages')
        r.attendre('#chatRows .chat-row', 'conversations')
    with r.etape('conversation', 'Une conversation ouverte d\'un toucher', cle='Répondre à un élève'):
        r.toucher('#chatRows .chat-row', 'la première conversation')
        r.attendre('.coach-chat-view', 'conversation')
    with r.etape('retour-messages', 'Retour sur Messages (conversation lue)', cle='Répondre à un élève'):
        r.retour()
        r.attendre('#chatRows', 'Messages')
    with r.etape('envoyer', 'Fiche d\'un élève : Envoyer un programme', cle='Envoyer un programme à plusieurs élèves'):
        r.toucher('.social-seg [data-seg="students"]', 'Élèves')
        r.toucher('.coach-filter[data-filter="all"]', 'Tous')
        r.toucher('.coach-student-row', 'premier élève')
        r.attendre('.coach-student-view', 'fiche')
        r.toucher('[data-action="coach-send"]', 'Envoyer un programme')
        r.toucher('.ios-dialog__btn', 'premier programme de la feuille')
    with r.etape('plusieurs', 'Envoyer à plusieurs élèves : Tous', cle='Envoyer un programme à plusieurs élèves'):
        r.toucher('[data-action="coach-send-many"]', 'Envoyer à plusieurs élèves')
        r.attendre('.coach-send-many-view', 'cases à cocher')
        r.toucher('[data-action="coach-many-all"]', 'Tous')


@parcours('devenir-coach', 'Demande « Devenir coach »', 'coach')
def p_devenir_coach(r):
    """Éducateur sportif connecté, pas encore coach : Réglages › Coach › Devenir coach, formulaire (nom, carte
    professionnelle, diplôme), demande envoyée."""
    r.lancer(REALISTE)
    r.connecter('max')
    cle = 'Envoyer une demande « Devenir coach »'
    with r.etape('reglages-coach', 'Réglages › Coach', cle=cle):
        reglages(r)
        r.defiler('[data-action="coach-open-settings"]', 'cellule Coach')
        r.toucher('[data-action="coach-open-settings"]', 'Coach')
    with r.etape('formulaire', 'Formulaire « Devenir coach »', cle=cle):
        r.toucher('[data-action="coach-request-open"]', 'Devenir coach')
        r.attendre('.coach-req-view', 'demande')
    with r.etape('formulaire-rempli', 'Formulaire rempli', cle=cle):
        r.saisir('#coachReqName', 'Camille Martin', 'nom')
        r.saisir('#coachReqCard', '049 12 ED 0123', 'numéro de carte professionnelle')
        r.page.select_option('#coachReqDiploma', 'BPJEPS')
        r._note('diplôme : BPJEPS (liste)')
    with r.etape('demande-envoyee', 'Demande envoyée : en cours de vérification', cle=cle):
        r.toucher('[data-action="coach-request-send"]', 'Envoyer la demande')


PREPARE_ELEVE = """([prog]) => {
    const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false });
    __sb.makeCoach(max);
    __sb.co.invites.push({ code: 'K7M2QX9P', coach: max, expires: Date.now() + 7 * 86400000 });
    window.__coachMax = max;
    return max;
}"""


@parcours('rejoindre-coach', 'Élève : rejoindre un coach avec son code', 'coach')
def p_rejoindre(r):
    """Léa a reçu le code K7M2QX9P de son coach : onglet Social › Rejoindre un coach, code, aperçu de ce que
    le coach verra, case d'âge, Accepter."""
    r.lancer(REALISTE)
    r.connecter('lea')
    r.raccourci(PREPARE_ELEVE, 'max est coach avec un code d\'invitation', [COACH_PROG])
    cle = 'Rejoindre un coach avec un code'
    with r.etape('social', 'Onglet Social : « Rejoindre un coach »', cle=cle):
        r.onglet('friends', 'Social')
    with r.etape('code', 'Saisie du code', cle=cle):
        r.toucher('[data-action="coach-join-start"]', 'Rejoindre un coach')
        r.saisir('#coachCode', 'K7M2QX9P', 'code')
    with r.etape('apercu', 'Aperçu du coach et de ce qu\'il verra', cle=cle):
        r.toucher('.sheet__btn--confirm', 'Suivant')
        r.attendre('.coach-join-view', 'aperçu')
    with r.etape('accepte', 'Âge déclaré, « Accepter »', cle=cle):
        r.toucher('[data-action="coach-age"]', 'J\'ai 15 ans ou plus')
        r.toucher('[data-action="coach-accept"]', 'Accepter')
    with r.etape('bienvenue-coach', 'Suivi commencé'):
        if r.present('.ios-dialog__btn', 'OK'):
            r.choisir('OK')


@parcours('eleve-coach', 'Élève suivi : programme reçu, coach visible', 'coach')
def p_eleve(r):
    """Léa est suivie par max, qui lui a envoyé « Force », commenté sa dernière séance et écrit un message :
    accueil, Mon coach, aperçu et ajout du programme, Programme, commentaire dans l'Historique, séance avec consignes."""
    r.lancer(REALISTE)
    r.connecter('lea')
    r.raccourci("""async ([prog]) => {
        const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false });
        __sb.makeCoach(max); __sb.link(max, __sb.meId(), Date.now() - 10 * 86400000);
        await syncNow();
        const sid = data.history.slice().sort((a, b) => b.date - a.date)[0].id;
        __sb.co.progs.push({ coach: max, student: __sb.meId(), id: 'u_force', data: prog, sent_at: new Date().toISOString(), seen: false });
        __sb.co.notes.push({ coach: max, student: __sb.meId(), sid, text: 'Belle séance, garde ce rythme.', updated_at: new Date().toISOString(), seen: false });
        __sb.msg(__sb.meId(), true, 'Salut Léa ! Je t\\'ai envoyé ton nouveau programme.', Date.now() - 2 * 3600e3);
        await coachRefresh(); render();
    }""", 'coach max relié, programme « Force » envoyé, commentaire et message', [COACH_PROG])
    with r.etape('accueil', 'Accueil : carte du coach'):
        r.attendre('.view.dashboard', 'accueil')
    with r.etape('social', 'Onglet Social : Mon coach (pastille)', cle='Ajouter le programme reçu du coach'):
        r.onglet('friends', 'Social')
    with r.etape('mon-coach', 'Mon coach : programme reçu, messages', cle='Ajouter le programme reçu du coach'):
        r.toucher('[data-action="coach-open-mine"]', 'Mon coach')
        r.attendre('.coach-mine-view', 'Mon coach')
    with r.etape('apercu-programme', 'Aperçu des exercices du programme'):
        r.toucher('[data-action="coach-prog-toggle"]', 'Voir les exercices')
    with r.etape('programme-ajoute', 'Programme ajouté : passer à ce programme ?', cle='Ajouter le programme reçu du coach'):
        r.toucher('.coach-prog [data-action="coach-add-prog"]', 'Ajouter à mes programmes')
    with r.etape('programme-actif', 'Programme du coach actif', cle='Ajouter le programme reçu du coach'):
        r.choisir('Passer', '« Passer à ce programme »')
    with r.etape('messages', 'Messages du coach'):
        r.toucher('.chat-cell', 'Messages')
        r.attendre('.coach-chat-view', 'conversation')
    with r.etape('accueil-programme', 'Accueil : « De ton coach max »'):
        r.onglet('train', 'Entraînement')
    with r.etape('programme', 'Onglet Programme : programme reçu'):
        r.onglet('program', 'Programme')
    with r.etape('historique-commentaire', 'Historique : séance commentée par le coach', cle='Lire le commentaire du coach'):
        r.onglet('history', 'Historique')
        r.toucher('.view.history [data-action="open-history"]', 'séance la plus récente (marque du coach)')
        r.defiler('.coach-note', 'commentaire du coach')
    with r.etape('seance-consignes', 'Séance du coach : consignes affichées'):
        r.onglet('train', 'Entraînement')
        r.toucher('.view.dashboard [data-action="start-session"]', 'Démarrer')
        r.attendre('.view.session', 'séance')
    cle = 'Suivre la prescription du coach en séance'
    with r.etape('seance-fourchette', 'Squat du coach (3 à 5 reps) : reps dans la fourchette, top set puis back-off allégés', cle=cle):
        r.defiler('.ex-card .tech-pill', 'étiquette « Top set » de la série 1')
    with r.etape('seance-charge-coach', 'Presse à cuisses : « Coach : 120 kg × 10 », cases pré-remplies', cle=cle):
        r.defiler('.ex-goal--coach', 'prescription du coach')


# ─────────────────────────────────────────────────────────────
#  Nouveautés de la vague 1 : nutrition, intensification, prises, outils de séance, suivi du coach
# ─────────────────────────────────────────────────────────────
with open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'data', 'foods.json'),
          encoding='utf-8') as _fh:
    _FOODS = {f[0]: f for f in json.load(_fh)['foods']}


def aliment(code, g, iid):
    """Aliment d'un plan de nutrition (table Ciqual de data/foods.json), comme tests/test_nutrition.py."""
    f = _FOODS[code]
    return {'id': iid, 'name': f[1], 'food': code, 'fam': f[2], 'g': g, 'per': {'k': f[3], 'p': f[4], 'c': f[5], 'f': f[6]}}


RIZ, POULET, OEUF, BANANE, HUILE = 9104, 36018, 22010, 13005, 17270
PLAN_DIETE = {'name': 'Sèche Léa', 'consigne': 'Bois 2 L d\'eau par jour.', 'targets': {'kcal': 2000, 'p': 150}, 'meals': [
    {'id': 'm1', 'name': 'Petit-déjeuner', 'items': [aliment(OEUF, 150, 'i1'), aliment(BANANE, 120, 'i2')]},
    {'id': 'm2', 'name': 'Déjeuner', 'note': 'Pèse le riz cuit.', 'items': [aliment(RIZ, 200, 'i3'), aliment(POULET, 150, 'i4'), aliment(HUILE, 10, 'i5')]},
    {'id': 'm3', 'name': 'Collation', 'items': [aliment(BANANE, 120, 'i6')]},
    {'id': 'm4', 'name': 'Dîner', 'items': [aliment(RIZ, 150, 'i7'), aliment(POULET, 120, 'i8')]},
]}


def fermer_dialogue(r, *libelles):
    """Dialogue ouvert par l'app sans geste de l'utilisateur (accord, rappel) : le premier bouton trouvé est touché (compté)."""
    for lib in libelles:
        if r.present('.ios-dialog__btn', lib, timeout=700):
            r.choisir(lib)
            return True
    return False


def demarrer(r, cat, nom):
    """Démarrer la séance `cat` depuis l'accueil : bouton de la carte du jour, sinon la séance dans « Ensuite »."""
    if r.present(f'.view.dashboard [data-action="start-session"][data-cat="{cat}"]'):
        r.toucher(f'.view.dashboard [data-action="start-session"][data-cat="{cat}"]', f'Démarrer ({nom}, carte du jour)')
    else:
        r.toucher(f'.view.dashboard [data-action="session-actions"][data-cat="{cat}"]', f'séance {nom} (Ensuite)')
        r.choisir('Démarrer')
    fermer_dialogue(r, 'Démarrer quand même', 'Démarrer')
    r.attendre('.view.session', 'écran de séance')


@parcours('nutrition', 'Nutrition : créer son plan, journal du jour, plan du coach', 'pratiquant')
def p_nutrition(r):
    """Pratiquant sans plan de nutrition : Programme › Plans de nutrition, « Créer un plan », un aliment cherché (riz cuit, 150 g),
    puis l'accueil et l'écran Nutrition du jour (anneau des calories, macros, repas à cocher, remplacer un aliment).
    Ensuite connecté (Léa) et suivie par le coach max, qui lui envoie le plan « Sèche Léa » : accord, « Suivre »,
    Nutrition avec le plan du coach."""
    r.lancer(REALISTE)
    cle = 'Créer son plan de nutrition avec un aliment'
    with r.etape('plans', 'Programme › Plans de nutrition', cle=cle):
        r.onglet('program', 'Programme')
        r.defiler('[data-action="go-diet-plans"]', 'liste sous les cartes')
        r.toucher('[data-action="go-diet-plans"]', 'Plans de nutrition')
        r.attendre('.diet-plans-view', 'Plans de nutrition')
    with r.etape('nouveau-plan', '« Créer un plan » : nom du plan', cle=cle):
        r.toucher('[data-action="diet-new-plan"]', 'Créer un plan')
        r.saisir('.ios-dialog__input', 'Ma prise de masse', 'nom du plan')
    with r.etape('plan-cree', 'Plan créé : objectifs du jour, repas types facultatifs (cachés)', cle=cle):
        r.choisir('Créer')
        r.attendre('.diet-plan-view', 'plan de nutrition')
    with r.etape('repas-types', '« Ajouter des repas types » : quatre repas à remplir', cle=cle):
        r.toucher('[data-action="diet-compose"]', 'Ajouter des repas types')
    with r.etape('recherche-aliment', 'Ajouter un aliment : recherche « riz blanc cuit »', cle=cle):
        r.toucher('[data-action="diet-add-food"]', 'Ajouter un aliment (Petit-déjeuner)')
        r.attendre('#dietFoodSearch', 'feuille de recherche')
        r.saisir('#dietFoodSearch', 'riz blanc cuit', 'recherche')   # le riz blanc existe cru et cuit (« riz cuit » : le thaï, sans version crue)
        r.attendre('#dietFoodList .diet-cand', 'résultats')
    # Riz cuit cherché « cuit » : version voulue, pas de rappel « Pesé cru ? » (panel vague 4)
    alerte = False
    with r.etape('quantite', 'Aliment choisi : quantité en grammes', cle=cle):
        r.toucher('#dietFoodList .diet-cand', '1er résultat')
        # Sans unité ni rappel cru / cuit, la quantité se saisit dans l'alerte à champ (dietAskGrams), sinon dans la feuille
        alerte = r.present('.ios-dialog__input', timeout=1500)
        r.saisir('.ios-dialog__input' if alerte else '.sheet-root:not(.sheet-root--out) #qtyVal', 150, 'quantité')
    with r.etape('aliment-ajoute', 'Aliment ajouté au repas (macros calculées)', cle=cle):
        if alerte:
            r.choisir('OK')
        else:
            r.toucher('.sheet-root:not(.sheet-root--out) .sheet__btn--confirm', 'OK')
    # Objectifs du jour (retour du 16/11 : « je peux pas modifier les kcal ? ») : saisie, protéines en g/kg, proposition
    cle = 'Fixer ses objectifs du jour'
    feuille = '.sheet-root:not(.sheet-root--out)'
    with r.etape('objectifs', 'Objectifs du jour : Calories, Protéines, Glucides, Lipides (« Aucun » si vide)', cle=cle):
        r.toucher('[data-action="diet-targets"]', 'Objectifs du jour')
        r.attendre(f'{feuille} #dietT_kcal', 'feuille des objectifs')
    with r.etape('objectifs-kcal', 'Calories : 2 900 kcal tapées', cle=cle):
        r.saisir(f'{feuille} #dietT_kcal', 2900, 'calories')
    with r.etape('objectifs-gkg', 'Protéines en g/kg : 1,9 g/kg, grammes calculés avec le poids des Réglages', cle=cle):
        r.toucher(f'{feuille} [data-tunit]', 'unité g → g/kg')
        r.saisir(f'{feuille} #dietT_p', '1,9', 'protéines en g/kg')
    with r.etape('objectifs-enregistres', 'Objectifs enregistrés : écart des repas prévus en calories et en protéines', cle=cle):
        r.toucher(f'{feuille} .sheet__btn--confirm', 'OK')
    cle = 'Se faire proposer des objectifs'
    with r.etape('proposer', 'Carte « Proposition » : il manque ton sexe, ton âge et ta taille, « Compléter »', cle=cle):
        r.toucher('[data-action="diet-targets"]', 'Objectifs du jour')
        r.attendre(f'{feuille} #dietTCard', 'carte Proposition')
    with r.etape('proposer-reponses', 'Compléter mes infos : prise de masse, 3 à 5 séances, homme, 25 ans, 180 cm (gardés dans Réglages)', cle=cle):
        r.toucher(f'{feuille} [data-tcomplete]', 'Compléter')
        r.toucher(f'{feuille} [data-tseg="goal"][data-v="gain"]', 'Prise de masse')
        r.toucher(f'{feuille} [data-tseg="sex"][data-v="male"]', 'Homme')
        r.saisir(f'{feuille} #dietEAge', 25, 'âge')
        r.saisir(f'{feuille} #dietECm', 180, 'taille')
    with r.etape('proposition', 'Carte « Proposition » : 2 980 kcal · Prot. 134 · Gluc. 460 · Lip. 67, explication, « Appliquer » ou « Ajuster »', cle=cle):
        r.toucher(f'{feuille} [data-tcalc]', 'Enregistrer')
        r.attendre(f'{feuille} [data-tapply]', 'Appliquer')
    with r.etape('proposition-utilisee', '« Appliquer » : objectifs enregistrés sur le plan', cle=cle):
        r.toucher(f'{feuille} [data-tapply]', 'Appliquer')
    cle = 'Ranger ses repas types'
    with r.etape('deplacer', 'Aliment du petit-déjeuner : « Déplacer vers… »', cle=cle):
        r.toucher('[data-action="diet-item-menu"]', 'riz du petit-déjeuner')
        r.choisir('Déplacer vers…')
    with r.etape('deplace', 'Déplacé vers Déjeuner (Annuler dans le message)', cle=cle):
        r.choisir('Déjeuner')
    with r.etape('deplace-annule', '« Annuler » : le riz revient au petit-déjeuner', cle=cle):
        r.toucher('.toast__action', 'Annuler')
    with r.etape('masquer', 'Dîner : « Masquer ce repas » (un repas de base ne se supprime pas)', cle=cle):
        r.toucher('[data-action="diet-meal-menu"]', 'Modifier (dîner)', nth=3)
    with r.etape('masque', 'Dîner masqué : « Repas masqués › Réafficher Dîner » en pied du plan', cle=cle):
        r.choisir('Masquer ce repas')
        r.defiler('[data-action="diet-meal-show"]', 'Réafficher')
    with r.etape('reaffiche', 'Dîner réaffiché à sa place', cle=cle):
        r.toucher('[data-action="diet-meal-show"]', 'Réafficher Dîner')
    with r.etape('accueil-carte', 'Accueil : carte Nutrition du jour'):
        r.onglet('train', 'Entraînement')
        r.defiler('.diet-home', 'carte Nutrition')
    with r.etape('journal', 'Nutrition : journal du jour (anneau, macros, repas)', cle='Ouvrir le journal du jour'):
        r.toucher('.diet-home__open', 'carte Nutrition')
        r.attendre('.nutrition-view', 'écran Nutrition')
    # Plan perso : jours vides par défaut (on note ce qu'on mange) ; « Copier le plan de ce repas » le remplit, à cocher ensuite
    with r.etape('repas-copie', 'Jour vide : « Copier le plan de ce repas » (aliments du plan, pastilles de famille)'):
        if r.present('.nutrition-view [data-action="diet-meal-back"][data-op="copy"]', timeout=1500):
            r.toucher('.nutrition-view [data-action="diet-meal-back"][data-op="copy"]', 'Copier le repas type')
        r.attendre('.nutrition-view .diet-meal [data-action="diet-check"]', 'rond à cocher')
    with r.etape('repas-coche', 'Petit-déjeuner coché : les macros montent', cle='Cocher un repas'):
        r.toucher('.nutrition-view .diet-meal [data-action="diet-check"]', 'cocher le petit-déjeuner')
        r.defiler('.diet-sum', 'bilan du jour')
    with r.etape('remplacer', 'Remplacer un aliment pour la journée (équivalents)', cle='Remplacer un aliment'):
        r.toucher('[data-action="diet-meal-open"]', 'déplier le petit-déjeuner coché')
        r.toucher('.nutrition-view .diet-item', 'riz cuit')
        r.attendre('.diet-swap', 'feuille des équivalents')
    with r.etape('remplace', 'Équivalent choisi : macros recalculées'):
        if r.present('.diet-cands .diet-cand'):
            r.toucher('.diet-cands .diet-cand', '1er équivalent')
        else:
            fermer_feuille(r)
            raise Absent('aucun équivalent proposé pour le riz cuit')
    with r.etape('repas-aliments', 'Repas en carte : barre de composition, aliments avec leur famille'):
        r.defiler('.nutrition-view .diet-meal', 'carte du petit-déjeuner')

    # Plan envoyé par le coach : Léa connectée, coach max relié, plan « Sèche Léa » déposé sur le faux serveur
    r.connecter('lea')
    r.raccourci("""async (plan) => {
        const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false });
        __sb.makeCoach(max); __sb.link(max, __sb.meId(), Date.now() - 10 * 86400000);
        __sb.co.progs.push({ coach: max, student: __sb.meId(), id: 'diet_lea00001', data: { kind: 'diet', v: 1, diet: plan },
          sent_at: new Date().toISOString(), seen: false });
        await coachRefresh(); switchTab('train', { reset: true }); render();
    }""", 'Léa connectée, suivie par max, qui lui a envoyé le plan « Sèche Léa »', PLAN_DIETE)
    cle = 'Suivre le plan de nutrition du coach'
    with r.etape('coach-accueil', 'Accueil : « max veut t\'envoyer un plan de nutrition »', cle=cle):
        fermer_dialogue(r, 'Garder sur cet iPhone')
        r.attendre('.coach-home', 'carte du plan de nutrition du coach')
    # Un seul geste (vague 4) : « Recevoir » demande l'accord puis prend le plan
    with r.etape('coach-accord', 'Recevoir : accord pour les plans du coach, plan pris dans la foulée', cle=cle):
        r.toucher('.coach-home [data-action="diet-take"]', 'Recevoir (carte de l\'accueil)')
        fermer_dialogue(r, 'Accepter')
    with r.etape('coach-suivi', 'Plan du coach suivi', cle=cle):
        if r.present('.coach-home [data-action="diet-take"]'):
            r.toucher('.coach-home [data-action="diet-take"]', 'Utiliser')
    with r.etape('coach-nutrition', 'Nutrition avec le plan du coach (consigne, repas)', cle=cle):
        r.toucher('.diet-home__open', 'carte Nutrition')
        fermer_dialogue(r, 'Garder sur cet iPhone')
        r.attendre('.nutrition-view', 'écran Nutrition')
    with r.etape('coach-nutrition-bas', 'Nutrition, bas de l\'écran (repas, source, aide)'):
        r.bas('bas de Nutrition')


# Scanner un aliment : coquille iOS factice (seul le lecteur MdlfScanner répond, window.__scan règle la prochaine
# lecture) et Open Food Facts simulé, comme tests/test_scan_aliment.py ; aucune requête ne sort
COQUILLE_SCAN = """
window.__scan = { code: null, type: 'ean13' };
const scanner = { scan: async () => ({ code: window.__scan.code, type: window.__scan.type }) };
window.Capacitor = {
  isNativePlatform: () => true,
  getPlatform: () => 'ios',
  isPluginAvailable: n => n === 'MdlfScanner',
  registerPlugin: name => name === 'MdlfScanner' ? scanner
    : name === 'App' ? { addListener: async () => ({ remove() {} }), getInfo: async () => ({ build: '41', version: '1.2' }) }
    : new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : async () => ({})) }),
};
"""
PATES, INCONNU = '8076800195057', '96385074'
OFF_PATES = {'status': 1, 'code': PATES, 'product': {'product_name_fr': 'Spaghetti n° 5', 'brands': 'Marque Test', 'quantity': '500 g',
             'nutriments': {'energy-kcal_100g': 359, 'proteins_100g': 12, 'carbohydrates_100g': 71, 'fat_100g': 2, 'salt_100g': 0.01}}}
PLAN_SCAN = {'name': 'Mon plan', 'meals': [{'id': 'm1', 'name': 'Déjeuner', 'items': []}, {'id': 'm2', 'name': 'Dîner', 'items': []}]}


@parcours('scan', 'Nutrition : scanner un code-barres', 'pratiquant')
def p_scan(r):
    """Plan diète ouvert, « Ajouter un aliment » : recherche en tête, « Produit de marque ? Scanner » ensuite. Un paquet de pâtes est trouvé
    sur Open Food Facts (12 g de protéines pour 100 g) : fiche, 80 g, ajouté au déjeuner. Le même paquet scanné pour
    le dîner, sans réseau : retrouvé dans Mes aliments. Un code inconnu : « Produit introuvable », puis « Créer
    l'aliment » avec le code gardé et le nom à écrire. Lecteur natif et Open Food Facts simulés."""
    etat = {'reseau': True}

    def off(route):
        code = route.request.url.split('/product/')[1].split('.json')[0]
        if not etat['reseau']:
            return route.abort('internetdisconnected')
        corps = OFF_PATES if code == PATES else {'status': 0, 'status_verbose': 'product not found', 'code': code}
        route.fulfill(status=200 if code == PATES else 404, content_type='application/json',
                      headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(corps))
    r.coquille_native(COQUILLE_SCAN)
    r.simuler(r'^https://world\.openfoodfacts\.org/', off)
    d = json.loads(REALISTE)
    d['dietPlans'] = {'d_scan01': PLAN_SCAN}
    d['dietEmptyDays'] = False   # mode pré-rempli (son propre plan commence vide par défaut depuis le 13/11)
    d['dietActive'] = 'd_scan01'
    r.lancer(json.dumps(d, ensure_ascii=False, separators=(',', ':')))
    r.raccourci("navigate(makeRoute('diet-plan', 'd_scan01')); dietComposing.add('d_scan01'); render()", 'plan de nutrition « Mon plan » ouvert, repas types affichés (Programme › Plans de nutrition)')
    cle = 'Scanner un produit et l\'ajouter'
    with r.etape('feuille', 'Ajouter un aliment : recherche en tête, « Produit de marque ? Scanner » ensuite', cle=cle):
        r.toucher('[data-action="diet-add-food"][data-meal="m1"]', 'Ajouter un aliment (Déjeuner)')
        r.attendre('.diet-cand--scan', 'bouton Scanner')
        r.page.evaluate('document.activeElement && document.activeElement.blur()')   # clavier de la recherche refermé pour la capture
    r.raccourci(f"() => {{ window.__scan = {{ code: '{PATES}', type: 'ean13' }}; }}", f'le lecteur lira le paquet de pâtes ({PATES})')
    with r.etape('trouve', 'Produit trouvé sur Open Food Facts : fiche pour 100 g', cle=cle):
        r.toucher('.diet-cand--scan', 'Produit de marque ? Scanner')
        r.attendre('.fscan__name', 'fiche du produit')
    with r.etape('grammes', 'Quantité : 80 g, kcal et macros recalculées', cle=cle):
        r.saisir('#fscanG', 80, 'quantité')
        r.page.focus('.fscan__name')
    with r.etape('ajoute', 'Pâtes ajoutées au déjeuner', cle=cle):
        r.toucher('.sheet-root .sheet__btn--confirm', 'Ajouter')
        r.attendre('.diet-plan-view', 'plan de nutrition')
    etat['reseau'] = False
    r.raccourci('() => {}', 'réseau coupé (Open Food Facts injoignable)')
    cle = 'Rescanner sans réseau'
    with r.etape('sans-reseau', 'Même paquet pour le dîner, sans réseau : retrouvé dans Mes aliments', cle=cle):
        r.toucher('[data-action="diet-add-food"][data-meal="m2"]', 'Ajouter un aliment (Dîner)')
        r.toucher('.diet-cand--scan', 'Produit de marque ? Scanner')
        r.attendre('.fscan__name', 'fiche du produit')
    with r.etape('sans-reseau-ajoute', 'Ajouté au dîner (100 g d\'office)', cle=cle):
        r.toucher('.sheet-root .sheet__btn--confirm', 'Ajouter')
    etat['reseau'] = True
    r.raccourci(f"() => {{ window.__scan = {{ code: '{INCONNU}', type: 'ean8' }}; }}", f'réseau revenu ; le lecteur lira un code inconnu ({INCONNU})')
    cle = 'Code introuvable : créer l\'aliment'
    with r.etape('introuvable', 'Code inconnu : « Produit introuvable »', cle=cle):
        r.toucher('[data-action="diet-add-food"][data-meal="m2"]', 'Ajouter un aliment (Dîner)')
        r.toucher('.diet-cand--scan', 'Produit de marque ? Scanner')
        r.attendre('[data-fscan="create"]', 'Créer l\'aliment')
    with r.etape('creer', '« Créer l\'aliment » : code gardé, nom à écrire', cle=cle):
        r.toucher('[data-fscan="create"]', 'Créer l\'aliment')
        r.attendre('#dietFoodName', 'formulaire Nouvel aliment')
        r.page.evaluate('document.activeElement && document.activeElement.blur()')
    # Vague 4 : Mes aliments (Réglages de la nutrition), le paquet scanné y est gardé
    cle = 'Retrouver ses aliments scannés'
    with r.etape('mes-aliments', 'Réglages de la nutrition › Mes aliments : le paquet scanné', cle=cle):
        for _ in range(3):   # feuilles empilées (Nouvel aliment sur la recherche) : Annuler, de la plus haute à la plus basse
            r.page.evaluate("() => [...document.querySelectorAll('.sheet-root:not(.sheet-root--out) .sheet__btn--cancel')].pop()?.click()")
            r.page.wait_for_timeout(450)
        r.raccourci("() => navigate('diet-settings')", 'feuilles refermées, Réglages de la nutrition ouverts (Nutrition › Réglages)')
        r.toucher('[data-action="go-diet-foods"]', 'Mes aliments')
        r.attendre('.diet-foods-view', 'Mes aliments')


@parcours('intensif', 'Séance : technique d\'intensification (rest-pause)', 'pratiquant')
def p_intensif(r):
    """En séance : toucher le numéro d'une série, choisir rest-pause, noter les reps de la reprise sous la série,
    valider la série (pause de 15 s avec « Ensuite : … reprise 1 »), puis valider la reprise."""
    r.lancer(REALISTE)
    with r.etape('demarrer', 'Séance du jour démarrée'):
        r.toucher('.view.dashboard [data-action="start-session"]', 'Démarrer (carte de la prochaine séance)')
        r.attendre('.view.session', 'écran de séance')
    cle = 'Poser une technique d\'intensification'
    sel = '.view.session [data-action="tech-set"]'
    pos = {}
    with r.etape('techniques', 'Numéro de la série touché : les cinq techniques', cle=cle):
        if not r.present(sel):
            raise Absent('aucun numéro de série touchable (technique d\'intensification)')
        loc = r._loc(sel)
        pos.update(ei=int(loc.get_attribute('data-ei')), si=int(loc.get_attribute('data-si')))
        r.toucher(sel, f'numéro de la série {pos["si"] + 1} (exercice {pos["ei"] + 1})')
        r.attendre('.ios-dialog__btn', 'feuille des techniques')
    if not pos:
        return
    ei, si = pos['ei'], pos['si']
    with r.etape('rest-pause', 'Rest-pause choisi : ligne « Reprise 1 » sous la série', cle=cle):
        r.choisir('Rest-pause')
        r.defiler('.view.session .tech', 'bloc Rest-pause')
    with r.etape('sous-serie', 'Reps de la reprise notées', cle='Noter une sous-série'):
        r.saisir(f'.view.session [data-action="sub-reps"][data-ei="{ei}"][data-si="{si}"][data-k="0"]', 4, 'reps de la reprise 1')
    with r.etape('pause-ensuite', 'Série validée : pause de 15 s, barre « Ensuite : reprise 1 »', cle='Noter une sous-série'):
        for s in range(si):   # séries d'avant, dans l'ordre (repos passés)
            r.toucher(f'.view.session [data-action="validate-set"][data-ei="{ei}"][data-si="{s}"]', f'valider la série {s + 1}')
            passer_repos(r)
        r.toucher(f'.view.session [data-action="validate-set"][data-ei="{ei}"][data-si="{si}"]', f'valider la série {si + 1}')
        r.attendre('.rest-mini__next', 'barre de repos avec « Ensuite »')
    with r.etape('reprise-validee', 'Reprise validée'):
        r.toucher(f'.view.session [data-action="sub-validate"][data-ei="{ei}"][data-si="{si}"][data-k="0"]', 'valider la reprise 1')


# Curl concentration en tête de la séance Pull, fait la dernière fois en séries ordinaires (14 kg × 10, 10, 9)
CURL_CONCENTRATION_JS = """() => {
  const p = data.programmes[data.activeProgramme], xs = p?.exercises?.pull;
  if (!xs) return 'pas de séance Pull';
  xs.unshift({ id: 'cc1curlc', name: 'Curl concentration', sets: 3 });
  const h = data.history.filter(h => h.category === 'pull').sort((a, b) => b.date - a.date)[0];
  if (h) h.exercises.unshift({ exId: 'cc1curlc', name: 'Curl concentration', sets: [{ weight: '14', reps: '10' }, { weight: '14', reps: '10' }, { weight: '14', reps: '9' }] });
  save(); render(); return 'ok';
}"""


@parcours('unilateral', 'Séance : drop set sur un exercice à un bras (curl concentration, bras gauche puis droit)', 'pratiquant')
def p_unilateral(r):
    """Curl concentration : drop set sur la dernière série, tout l'exercice passe par bras. Bras gauche lourd puis
    allégé, bras droit lourd puis allégé : le bras droit et son drop sont pré-remplis avec ce que le bras gauche vient
    de faire, et le repos ne part qu'après le drop du bras droit."""
    r.lancer(REALISTE)
    r.raccourci(CURL_CONCENTRATION_JS, 'Curl concentration ajouté en tête de la séance Pull (dernière fois : 14 kg × 10, 10, 9)')
    with r.etape('demarrer', 'Séance Pull démarrée, Curl concentration en tête'):
        demarrer(r, 'pull', 'Pull')
    cle = 'Drop set des deux bras'
    with r.etape('drop-pose', 'Numéro de la série 3 › Drop set : un drop de chaque côté', cle=cle):
        r.toucher('.view.session [data-action="tech-set"][data-ei="0"][data-si="2"]', 'numéro de la série 3')
        r.choisir('Drop set')
        r.defiler('.view.session .ex-card[data-ei="0"] .tech', 'bloc Drop set')
    with r.etape('bras-gauche', 'Bras gauche lourd puis allégé : le bras droit suit, pré-rempli, sans repos', cle=cle):
        for s in range(2):
            r.toucher(f'.view.session [data-action="validate-set"][data-ei="0"][data-si="{s}"]', f'valider la série {s + 1} (bras gauche)')
            if s == 0:   # le bras droit fait une rep de plus à la série 1 : record du meilleur bras au bilan
                r.saisir('.view.session [data-action="side-reps"][data-ei="0"][data-si="0"]', 11, 'reps du bras droit, série 1')
            r.toucher(f'.view.session [data-action="side-validate"][data-ei="0"][data-si="{s}"]', f'valider la série {s + 1} (bras droit)')
            passer_repos(r)
        r.toucher('.view.session [data-action="validate-set"][data-ei="0"][data-si="2"]', 'valider la série 3 (bras gauche)')
        r.saisir('.view.session [data-action="sub-reps"][data-ei="0"][data-si="2"][data-k="0"]:not([data-side])', 6, 'reps du drop, bras gauche')
        r.toucher('.view.session [data-action="sub-validate"][data-ei="0"][data-si="2"][data-k="0"]:not([data-side])', 'valider le drop du bras gauche')
    with r.etape('bras-droit', 'Bras droit validé tel que pré-rempli : son drop suit, pré-rempli', cle=cle):
        r.toucher('.view.session [data-action="side-validate"][data-ei="0"][data-si="2"]', 'valider le bras droit')
    with r.etape('repos', 'Drop du bras droit validé : le repos part', cle=cle):
        r.saisir('.view.session [data-action="sub-reps"][data-ei="0"][data-si="2"][data-k="0"][data-side="2"]', 5, 'reps du drop, bras droit')
        r.toucher('.view.session [data-action="sub-validate"][data-ei="0"][data-si="2"][data-k="0"][data-side="2"]', 'valider le drop du bras droit')
        r.attendre('.rest-mini', 'barre de repos')
    with r.etape('bilan', 'Séance terminée : bilan, volume du curl (deux bras additionnés) et record du meilleur bras', cle=cle):
        passer_repos(r)
        r.toucher('.view.session [data-action="finish-session"]', 'Terminer')
        fermer_dialogue(r, 'Enregistrer la séance')
        r.attendre('.view.summary', 'bilan')


@parcours('unilateral-bras', 'Séance : « Noter chaque bras à part » sur un exercice à un bras', 'pratiquant')
def p_unilateral_bras(r):
    """Curl concentration sans technique : ⋯ › Plus d'options › « Noter chaque bras à part ». Chaque série a une
    ligne « Bras droit » pré-remplie ; le repos part après le bras droit."""
    r.lancer(REALISTE)
    r.raccourci(CURL_CONCENTRATION_JS, 'Curl concentration ajouté en tête de la séance Pull (dernière fois : 14 kg × 10, 10, 9)')
    with r.etape('demarrer', 'Séance Pull démarrée'):
        demarrer(r, 'pull', 'Pull')
    with r.etape('choix', '⋯ › Plus d\'options › Noter chaque bras à part', cle='Noter chaque bras à part'):
        menu_ex(r, 0, 'Curl concentration')
        choisir_ou_absent(r, 'Noter chaque bras à part', 'choix « Noter chaque bras à part »')
    with r.etape('premier-droit', '« Commencer par le bras droit » : chaque série dans l\'ordre Droit puis Gauche', cle='Noter chaque bras à part'):
        r.toucher('.view.session [data-action="side-first"][data-ei="0"]', 'Commencer par le bras droit')
    with r.etape('serie-1', 'Série 1 (bras droit) validée : le bras gauche suit, sans repos', cle='Noter chaque bras à part'):
        r.toucher('.view.session [data-action="validate-set"][data-ei="0"][data-si="0"]', 'valider la série 1 (bras droit)')
    with r.etape('bras-droit', 'Bras gauche validé : « Série 1 validée », le repos part'):
        r.toucher('.view.session [data-action="side-validate"][data-ei="0"][data-si="0"]', 'valider le bras gauche')
        r.attendre('.rest-mini', 'barre de repos')


@parcours('prise', 'Prise d\'un exercice : programme, séance', 'pratiquant')
def p_prise(r):
    """Programme › Pull › Tirage vertical prise large : prise en supination (seuls pronation et supination sont proposés,
    jamais une prise contraire au nom), enregistrée ; affichée sous le nom dans la séance, puis changée en séance
    (pronation) par la feuille Prise."""
    r.lancer(REALISTE)
    cle = 'Choisir la prise d\'un exercice'
    with r.etape('seance-pull', 'Programme › séance Pull', cle=cle):
        r.onglet('program', 'Programme')
        r.toucher('.view.my-programmes [data-action="open-my-prog"]', 'programme actif')
        r.toucher('.view.programmes [data-action="open-prog-session"][data-cat="pull"]', 'séance Pull')
        r.attendre('.view.editor', 'séance du programme')
    with r.etape('fiche', 'Fiche du tirage vertical : rubrique Prise', cle=cle):
        r.toucher('.view.editor [data-action="edit-ex"]', 'Tirage vertical prise large', texte='Tirage vertical')
        r.attendre('.view.ex-edit', 'fiche de l\'exercice')
        r.defiler('#exGrip .grip__chip', 'rubrique Prise')
    with r.etape('prise-choisie', 'Prise en supination', cle=cle):
        r.toucher('#exGrip [data-dim="hand"][data-v="supination"]', 'Supination')
    with r.etape('seance-programme', 'Enregistrée : la prise sous le nom (séance du programme)', cle=cle):
        r.toucher('[data-action="save-ex"]', 'OK')
        r.attendre('.view.editor', 'séance du programme')
        r.defiler('.view.editor .grip-sub', 'prise sous le nom')
    with r.etape('seance', 'Séance Pull : la prise sous le nom de l\'exercice'):
        r.onglet('train', 'Entraînement')
        demarrer(r, 'pull', 'Pull')
        r.defiler('.view.session .ex-grip', 'ligne de la prise')
    with r.etape('feuille-prise', 'Feuille « Prise » en séance', cle='Changer la prise en séance'):
        r.toucher('.view.session .ex-grip', 'ligne de la prise')
        r.attendre('.sess-sheet--grip', 'feuille Prise')
    with r.etape('prise-changee', 'Prise changée (pronation) : ligne mise à jour', cle='Changer la prise en séance'):
        r.toucher('.sess-sheet--grip [data-dim="hand"][data-v="pronation"]', 'Pronation')
        r.toucher('.sess-sheet--grip [data-action="sheet-done"]', 'OK')
        r.defiler('.view.session .ex-grip', 'ligne de la prise')


@parcours('seance-outils', 'Séance : fourchette de reps, filtre par muscle, élastique, volume des bips', 'pratiquant')
def p_seance_outils(r):
    """Fourchette de 8 à 12 reps réglée sur le 1er exercice de Push, visible en séance avec l'objectif de la série ;
    feuille d'ajout filtrée sur les dorsaux, « Tractions avec élastique » ajoutées et l'élastique choisi ;
    Réglages › Sons : volume des bips."""
    r.lancer(REALISTE)
    cle = 'Régler une fourchette de reps'
    with r.etape('fiche', 'Programme › Push › 1er exercice : fourchette', cle=cle):
        r.onglet('program', 'Programme')
        r.toucher('.view.my-programmes [data-action="open-my-prog"]', 'programme actif')
        r.toucher('.view.programmes [data-action="open-prog-session"][data-cat="push"]', 'séance Push')
        r.toucher('.view.editor [data-action="edit-ex"]', '1er exercice')
        r.attendre('.view.ex-edit', 'fiche de l\'exercice')
        r.defiler('[data-action="ex-rep-mode"]', 'rubrique Progression')
    with r.etape('fourchette', 'Fourchette 8 à 12 saisie', cle=cle):
        # Vague 4 : un haut réglé seul (10 reps dans ces données) se lit en reps fixes ; « Fourchette » d'abord
        if not r.present('#exRepMin', timeout=300):
            r.toucher('[data-action="ex-rep-mode"][data-fixed="false"]', 'Fourchette')
        r.saisir('#exRepMin', 8, 'bas de fourchette')
        r.saisir('#exRepMax', 12, 'haut de fourchette')
    with r.etape('fourchette-ok', 'Fiche enregistrée', cle=cle):
        r.toucher('[data-action="save-ex"]', 'OK')
        r.attendre('.view.editor', 'séance du programme')
    with r.etape('seance-fourchette', 'Séance Push : « 8–12 reps » et objectif des séries', cle='Voir la fourchette en séance'):
        r.onglet('train', 'Entraînement')
        demarrer(r, 'push', 'Push')
        if not r.present('.view.session .ex-card', '8–12 reps'):
            raise Absent('fourchette « 8–12 reps » pas affichée sur la carte')
    with r.etape('note-serie', 'Note de la série 1 depuis sa case « Avant »', cle='Noter une série'):
        r.toucher('.view.session .session-set[data-ei="0"][data-si="0"] .set-note-btn', 'case « Avant » de la série 1')
        r.saisir('.ios-dialog__input', 'prise un peu plus large', 'note')
        r.choisir('Enregistrer')

    cle = 'Ajouter un exercice filtré par muscle'
    with r.etape('ajout-filtre', 'Feuille d\'ajout : filtre Dos', cle=cle):
        r.toucher('.view.session [data-action="add-session-ex"]', 'Ajouter un exercice')
        r.attendre('.sess-sheet--addex', 'feuille d\'ajout')
        r.toucher('.sess-sheet--addex [data-action="ax-muscle"][data-group="dos"]:not([data-muscle])', 'Dos')
    with r.etape('ajout-filtre-muscle', 'Filtre affiné : dorsaux', cle=cle):
        r.toucher('.sess-sheet--addex [data-action="ax-muscle"][data-muscle="lats"]', 'Dorsaux')
    with r.etape('ajout-elastique', 'Recherche « élastique » dans les dorsaux', cle=cle):
        r.saisir('#axSearch', 'élastique', 'recherche')
    with r.etape('elastique-carte', 'Tractions avec élastique ajoutées : choix de l\'élastique', cle='Choisir l\'élastique d\'assistance'):
        r.toucher('.sess-sheet--addex [data-action="ax-pick"][data-name="Tractions avec élastique"]', 'Tractions avec élastique')
        r.defiler('.view.session .band-pick', 'pastilles des élastiques')
    with r.etape('elastique-choisi', 'Élastique choisi : aide notée dans les séries', cle='Choisir l\'élastique d\'assistance'):
        r.toucher('.view.session .band-pick__btn', 'élastique (2e pastille)', nth=1)
        r.defiler('.view.session .band-pick', 'pastilles des élastiques')

    r.page.evaluate("() => { try { stopRest(); } catch {} }")
    with r.etape('bips', 'Réglages › Sons : volume des bips', cle='Régler le volume des bips'):
        r.toucher('.view.session .navbar [data-action="back"]', 'réduire la séance (retour à l\'accueil)')
        reglages(r)
        r.defiler('[data-action="setting-sound-level"]', 'groupe Sons et vibrations')
    with r.etape('bips-fort', 'Volume « Fort » choisi', cle='Régler le volume des bips'):
        r.toucher('[data-action="setting-sound-level"][data-val="fort"]', 'Fort')


def seances_eleve_records():
    """Séances de Léa avec deux records cette semaine (signal vert de Mes élèves, « Cette semaine » de sa fiche)."""
    out = seances_eleve()
    out[0]['records'] = [{'ex': 'Développé couché', 'kind': 'charge', 'before': 40, 'after': 42.5}]
    out[2]['records'] = [{'ex': 'Développé couché', 'kind': 'reps', 'before': 7, 'after': 9, 'weight': 40}]
    for s in out[1:]:
        s.setdefault('records', [])
    return out


PREPARE_SUIVI = """(plan) => {
    const me = __sb.meId(), lea = __sb.co.links.find(l => l.coach === me && __sb.profiles[l.student]?.username === 'lea')?.student
      || Object.keys(__sb.profiles).find(id => __sb.profiles[id].username === 'lea');
    const tom = Object.keys(__sb.profiles).find(id => __sb.profiles[id].username === 'tom');
    __sb.addPhase(lea, { goal: 'comeback', name: 'Reprise', start: '2026-10-26', weeks: 2 });
    __sb.addPhase(lea, { goal: 'mini_cut', name: 'Mini cut', start: '2026-11-09', weeks: 6, prog_name: 'Force' });
    if (tom) __sb.addPhase(tom, { goal: 'bulk', name: 'Prise de masse', start: '2026-10-12', weeks: 10 });
    __sb.co.shares.push({ student: lea, coach: me, kind: 'diet', granted_at: new Date().toISOString() });
    const ex = data.programmes.u_force.exercises;
    Object.assign(ex.sA[0], { repMin: 6, repMax: 10, intens: 'drop-last', grip: { width: 'serree' } });
    Object.assign(ex.sA[1], { repMin: 8, repMax: 12, grip: { hand: 'neutre' } });
    Object.assign(ex.sB[0], { repMin: 3, repMax: 5, intens: 'topback' });
    data.dietPlans = Object.assign(data.dietPlans || {}, { d_lea00001: plan });
    save();
    return coachRefresh();
}"""


@parcours('coach-suivi', 'Coach : planning, progression, envoi avec fourchette et technique, plan de nutrition', 'coach')
def p_coach_suivi(r):
    """Coach max avec Léa (12 séances, 2 records cette semaine, reprise puis mini cut planifiés) et Tom : planning des
    élèves, fiche de Léa (« Cette semaine »), envoi du programme « Force » (fourchettes, drop set, top set, prises) puis
    du plan de nutrition « Sèche Léa » (Léa a donné son accord)."""
    r.lancer(REALISTE)
    r.connecter('max')
    r.raccourci(PREPARE_COACH, 'rôle coach validé, élèves Léa et Tom, programme « Force », message de Léa',
                [seances_eleve_records(), days_back_ms(NOW, 3, 9, tz=PARIS)])
    r.raccourci(PREPARE_SUIVI, 'phases de Léa et Tom, fourchettes, techniques et prises dans « Force », plan de nutrition « Sèche Léa », accord diète de Léa',
                PLAN_DIETE)
    cle = 'Voir le planning des élèves'
    with r.etape('mes-eleves', 'Onglet Coach, Élèves : signal de progression et phase', cle=cle):
        r.onglet('friends', 'Coach')
        r.attendre('.coach-team .coach-student-row', 'Élèves')
    with r.etape('planning', 'Planning : 16 semaines, une ligne par élève', cle=cle):
        r.toucher('[data-action="plan-overview"]', 'Planning')
        r.attendre('.plan-gantt__row', 'planning')
    with r.etape('plan-eleve', 'Planning de Léa (phases)'):
        r.toucher('.plan-gantt__row', 'ligne de Léa', texte='lea')
    cle = 'Voir la progression d\'un élève'
    with r.etape('fiche-eleve', 'Fiche de Léa : « Cette semaine » (séances, records)', cle=cle):
        r.retour()
        r.retour()
        r.toucher('.coach-student-row', 'Léa', texte='lea')
        r.attendre('.coach-student-view', 'fiche de l\'élève')
    with r.etape('fiche-eleve-bas', 'Fiche de Léa, bas de l\'écran (programme, plan de nutrition)'):
        r.bas('bas de la fiche')
    cle = 'Envoyer un programme à un élève'
    with r.etape('envoyer-ecran', 'Envoyer « Force » : fourchettes, techniques et prises affichées', cle=cle):
        r.toucher('[data-action="coach-send"]', 'Envoyer un programme')
        r.choisir('Force')
        r.attendre('.coach-send-view', 'écran Envoyer')
    cle = 'Prescrire une charge à un élève'
    with r.etape('prescrire-ouvrir', 'Squat barre : « Prescrire une charge » (charge et reps pour Léa)', cle=cle):
        r.defiler('.coach-presc-btn[data-ex="e4"]', 'Prescrire une charge (Squat barre)')
        r.toucher('.coach-presc-btn[data-ex="e4"]', 'Prescrire une charge')
        r.attendre('.coach-presc-view', 'Charge et reps')
    with r.etape('prescrire-saisie', 'Charge : 90 kg pour toutes les séries, top set à 100 kg', cle=cle):
        r.saisir('#cpLoad', '90', 'charge de toutes les séries')
        r.saisir('#cpSet0', '100', 'charge de la série 1 (top set)')
    with r.etape('prescrire-ok', 'Prescription gardée : « Charge : 100 kg puis 90 kg × 3–5 »', cle=cle):
        r.toucher('[data-action="coach-presc-ok"]', 'OK')
        r.attendre('.coach-send-view', 'écran Envoyer')
        r.defiler('.coach-presc-btn[data-ex="e4"]', 'prescription du squat')
    cle = 'Envoyer un programme à un élève'
    with r.etape('envoyer-bas', 'Écran Envoyer, bas (séance Bas, bouton Envoyer)', cle=cle):
        r.defiler('[data-action="coach-send-go"]', 'bouton Envoyer')
    with r.etape('programme-envoye', 'Programme envoyé : retour à la fiche', cle=cle):
        r.toucher('[data-action="coach-send-go"]', 'Envoyer à Léa')
    cle = 'Envoyer un plan de nutrition à un élève'
    with r.etape('diete-choix', 'Envoyer un plan de nutrition : choix du plan', cle=cle):
        r.defiler('[data-action="coach-send-diet"]', 'Envoyer un plan de nutrition')
        r.toucher('[data-action="coach-send-diet"]', 'Envoyer un plan de nutrition')
        r.attendre('.ios-dialog__btn', 'liste des plans')
    # 18/11 : aperçu jour par jour, Léa cochée d'office, puis confirmation qui la nomme
    with r.etape('diete-relecture', 'Plan diète : aperçu avant l\'envoi (jour par jour, Léa cochée)', cle=cle):
        r.choisir('Sèche Léa')
        r.attendre('.diet-send-view', 'aperçu du plan')
    with r.etape('diete-confirmation', 'Envoyer : confirmation qui nomme l\'élève', cle=cle):
        r.toucher('#dietSendGo', 'Envoyer')
        r.attendre('.ios-dialog', 'confirmation')
    with r.etape('diete-envoyee', 'Plan diète envoyé : « Pas encore ouvert »', cle=cle):
        r.choisir('Envoyer')
        r.attendre('.coach-student-view', 'fiche de l\'élève')
        r.defiler('.coach-sent[data-diet]', 'plan envoyé')


# ─────────────────────────────────────────────────────────────
#  Nutrition des coachs (18/11) et suivi de la diète par le coach (branche nutri-suivi-coach)
# ─────────────────────────────────────────────────────────────
def _ciq(iid, code, g, s):
    """Aliment Ciqual de data/foods.json avec son sel pour 100 g (11e colonne)."""
    x = aliment(code, g, iid)
    x['per']['s'] = s
    return x


def plan_seche():
    """Plan réaliste du coach (valeurs Ciqual 2025, comme tests/test_nutri_coachs.py) : 2 232 kcal prévues pour 2 300,
    eau de 3 à 5 L, sel de 3 à 5 g."""
    return {'name': 'Sèche semaine 1', 'targets': {'kcal': 2300, 'p': 150, 'c': 270, 'f': 55, 'water': 5, 'waterMin': 3, 'saltMin': 3, 'saltMax': 5},
            'meals': [
                # Dans l'ordre de la journée, comme le rangerait un coach (panel nutri-final t1 : l'ordre des tests troublait)
                {'id': 'm3', 'name': 'Petit-déjeuner', 'items': [_ciq('i7', 32140, 80, 0.01), _ciq('i8', 19644, 250, 0.09), _ciq('i9', 13005, 120, 0)]},
                {'id': 'm1', 'name': 'Déjeuner', 'items': [_ciq('i1', 4003, 350, 0.05), _ciq('i2', 36018, 180, 0.2), _ciq('i4', 17270, 15, 0)]},
                {'id': 'm4', 'name': 'Collation', 'items': [_ciq('i10', 15041, 30, 0.05)]},
                {'id': 'm2', 'name': 'Dîner', 'items': [_ciq('i3', 7001, 80, 1.25), _ciq('i5', 9104, 250, 0.05), _ciq('i6', 6251, 150, 0.16)]}]}


def plan_seche_eleve(mode='session'):
    """Le même plan reçu par l'élève : jour d'entraînement et jour de repos (moins de féculents, 2 000 kcal), ou une
    semaine de 7 jours (mardi, samedi et dimanche de repos ; mercredi 4/11, jour de l'horloge, de repos)."""
    p = plan_seche()
    rest = json.loads(json.dumps({'meals': p['meals'], 'targets': {**p['targets'], 'kcal': 2000, 'c': 200}}))
    repas = {m['id']: m for m in rest['meals']}
    repas['m1']['items'][0]['g'] = 250
    repas['m2']['items'][0]['g'] = 50
    repas['m2']['items'][1]['g'] = 120
    if mode == 'session':
        p['days'] = {'mode': 'session', 'more': [rest]}
    else:
        kinds = ['t', 'r', 'r', 't', 't', 'r', 'r']
        p['days'] = {'mode': 'week', 'kinds': kinds, 'more': [json.loads(json.dumps(rest if k == 'r' else {'meals': p['meals'], 'targets': p['targets']})) for k in kinds[1:]]}
    p['fromCoach'] = {'coachId': 'c1', 'name': 'max', 'sentAt': 1}
    return p


def _sans_seance_du_jour(d):
    """Pas de séance aujourd'hui : l'app pose « Séance aujourd'hui ? » (jour d'entraînement ou de repos)."""
    debut = days_back_ms(NOW, 0, 0, tz=PARIS)
    d['history'] = [h for h in d['history'] if h['date'] < debut]
    return d


@parcours('nutri-coach-plan', 'Coach : plan sur 7 jours, copies de repas, eau et sel, aperçu et envoi', 'coach')
def p_nutri_coach_plan(r):
    """Coach max (élèves Léa et Tom, qui acceptent ses plans) : son plan « Sèche semaine 1 » passe en semaine de 7 jours,
    « Crème de riz » cherchée et ajoutée au petit-déjeuner du lundi, copié vers mardi et jeudi, « Mettre pareil sur les 7 jours »
    puis Annuler, lundi en jour de repos copié vers les autres jours de repos, objectifs d'eau et de sel (repère de l'OMS
    au-dessus de 5 g), aperçu jour par jour et envoi aux deux élèves."""
    d = json.loads(REALISTE)
    d['dietPlans'] = {'d_seche001': plan_seche()}
    d['dietConsent'] = {'on': True, 'at': '2026-11-01T10:00:00.000Z'}
    d['dietConsentAsked'] = True
    r.lancer(json.dumps(d, ensure_ascii=False, separators=(',', ':')))
    r.connecter('max')
    r.raccourci("""() => { const me = __sb.meId(); __sb.makeCoach(me);
        for (const [u, av] of [['lea', '🦊'], ['tom', '🐼']]) { const id = __sb.addPerson({ username: u, avatar: av, social: false }); __sb.link(me, id);
          __sb.co.shares.push({ student: id, coach: me, kind: 'diet', granted_at: new Date().toISOString() }); }
        return coachRefresh(); }""", 'rôle coach validé, élèves Léa et Tom, qui acceptent les plans de nutrition')
    cle = 'Coach : passer un plan sur 7 jours'
    with r.etape('mes-dietes', 'Programme › Plans de nutrition : « Mes diètes »', cle=cle):
        r.onglet('program', 'Programme')
        r.defiler('[data-action="go-diet-plans"]', 'liste sous les cartes')
        r.toucher('[data-action="go-diet-plans"]', 'Plans de nutrition')
        r.attendre('.diet-plans-view', 'Mes diètes')
    with r.etape('plan', 'Plan « Sèche semaine 1 » : Jours, Consigne, objectifs, repas', cle=cle):
        r.toucher('[data-action="diet-open-plan"][data-id="d_seche001"]', 'Sèche semaine 1')
        r.attendre('[data-action="diet-days-mode"]', 'cellule Jours')
    with r.etape('jours-choix', 'Jours : tous pareils, entraînement et repos, semaine', cle=cle):
        r.toucher('[data-action="diet-days-mode"]', 'Jours')
        r.attendre('.ios-dialog__btn', 'choix des jours')
    with r.etape('semaine', 'Semaine choisie : 7 jours, copies du premier jour (Annuler dans le message)', cle=cle):
        r.choisir('Semaine (lundi à dimanche)')
        r.attendre('.diet-dayrow', 'vue des jours')
    r.raccourci("""() => { const p = data.dietPlans.d_seche001; p.days.kinds = ['t', 'r', 't', 't', 't', 'r', 'r'];
        for (const i of [0, 4, 5]) { const o = p.days.more[i]; o.targets = { ...o.targets, kcal: 2000, c: 200 };
          const m = id => o.meals.find(x => x.id === id); m('m2').items[0].g = 50; m('m2').items[1].g = 120; m('m1').items[0].g = 250; } save(); render(); }""",
                'semaine réaliste : mardi, samedi et dimanche de repos (2 000 kcal, moins de féculents)')
    with r.etape('semaine-vue', 'Vue des 7 jours : type, repas, kcal et macros de chaque jour', cle=cle):
        r.defiler('.diet-dayrow[data-dayi="6"]', 'dimanche')
    with r.etape('lundi', 'Lundi ouvert : bande des 7 jours, Entraînement | Repos, repas du jour', cle=cle):
        r.toucher('.diet-dayrow[data-dayi="0"]', 'Lundi')
        r.attendre('.diet-dayswipe', 'écran du lundi')
    cle = 'Coach : ajouter un aliment par la recherche'
    with r.etape('recherche', 'Petit-déjeuner, ajouter un aliment : recherche en tête, « crème de riz » (valeurs Ciqual dites)', cle=cle):
        r.toucher('[data-action="diet-add-food"]', 'Ajouter un aliment (Petit-déjeuner)')
        r.attendre('#dietFoodSearch', 'feuille de recherche')
        r.saisir('#dietFoodSearch', 'crème de riz', 'recherche')
        r.attendre('.sheet .diet-pick__list .diet-cand', 'résultats')
    with r.etape('quantite', 'Crème de riz choisie : 60 g', cle=cle):
        r.toucher('.sheet .diet-pick__list .diet-cand', 'Crème de riz')
        alerte = r.present('.ios-dialog__input', timeout=1500)
        r.saisir('.ios-dialog__input' if alerte else '.sheet-root:not(.sheet-root--out) #qtyVal', 60, 'quantité')
    with r.etape('ajoute', '« Ajouté : Crème de riz » avec Annuler', cle=cle):
        if r.present('.ios-dialog__input'):
            r.choisir('OK')
        else:
            r.toucher('.sheet-root:not(.sheet-root--out) .sheet__btn--confirm', 'OK')
    cle = 'Coach : copier un repas vers d\'autres jours'
    with r.etape('copier-repas', 'Petit-déjeuner : « Copier vers d\'autres jours… », mardi et jeudi cochés', cle=cle):
        r.toucher('[data-action="diet-meal-menu"]', 'Modifier (petit-déjeuner)')
        r.choisir('Copier vers d\'autres jours')
        r.attendre('.sheet .diet-dpick', 'jours à cocher')
        r.toucher('.sheet [data-dpick="1"]', 'Mardi')
        r.toucher('.sheet [data-dpick="3"]', 'Jeudi')
    with r.etape('repas-copie', 'Petit-déjeuner copié vers mardi et jeudi', cle=cle):
        r.toucher('.sheet__btn--confirm', 'Copier')
    cle = 'Coach : mettre un jour sur toute la semaine'
    with r.etape('sept-jours', '« Mettre pareil sur les 7 jours » : confirmation', cle=cle):
        r.defiler('[data-action="diet-day-all"]', 'Mettre pareil sur les 7 jours')
        r.toucher('[data-action="diet-day-all"]', 'Mettre pareil sur les 7 jours')
        r.attendre('.ios-dialog', 'confirmation')
    with r.etape('sept-jours-remplaces', '« Remplacer » : 7 jours pareils, Annuler dans le message', cle=cle):
        r.choisir('Remplacer')
    with r.etape('sept-jours-annule', '« Annuler » : la semaine revient comme avant', cle=cle):
        r.toucher('.toast__action', 'Annuler')
    cle = 'Coach : jours de repos'
    with r.etape('repos', 'Lundi passé en Repos : « Copier vers les autres jours de repos »', cle=cle):
        r.toucher('[data-action="diet-day-set-kind"][data-k="r"]', 'Repos')
        r.defiler('[data-action="diet-day-same"]', 'Copier vers les autres jours de repos')
    with r.etape('repos-copie', 'Copie vers les jours de repos : confirmation', cle=cle):
        r.toucher('[data-action="diet-day-same"]', 'Copier vers les autres jours de repos')
        r.attendre('.ios-dialog', 'confirmation')
    with r.etape('repos-copie-ok', 'Lundi copié sur les jours de repos (Annuler dans le message)', cle=cle):
        r.choisir('Copier')
    # Lundi remis en jour d'entraînement pour la suite (préparé) : la copie est annulée
    if r.present('.toast__action'):
        r.page.locator('.toast__action').first.click()
        r.page.wait_for_timeout(300)
    if r.present('[data-action="diet-day-set-kind"][data-k="t"]'):
        r.page.locator('[data-action="diet-day-set-kind"][data-k="t"]').first.click()
        r.page.wait_for_timeout(300)
    cle = 'Coach : objectifs d\'eau et de sel'
    with r.etape('objectifs', 'Objectifs du jour : calories, macros, eau de 3 à 5 L, sel de 3 à 5 g', cle=cle):
        r.toucher('[data-action="diet-targets"]', 'Objectifs du jour')
        r.attendre('#dietT_saltMax', 'feuille des objectifs')
        r.defiler('#dietT_saltMax', 'champs Eau et Sel')
    with r.etape('objectifs-sel', 'Sel au plus 7 g : repère de l\'OMS dit au coach, rien de bloqué', cle=cle):
        r.saisir('#dietT_saltMax', '7', 'sel au plus')
        r.defiler('#dietTSaltNote', 'repère de l\'OMS')
    with r.etape('objectifs-ok', 'Objectifs enregistrés', cle=cle):
        r.toucher('.sheet__btn--confirm', 'OK')
    cle = 'Coach : envoyer un plan à plusieurs élèves'
    with r.etape('apercu', 'Aperçu et envoi : une ligne par jour (kcal, macros, eau, sel, écart)', cle=cle):
        r.retour()
        r.attendre('[data-action="diet-send-student"]', 'Aperçu et envoi')
        r.toucher('[data-action="diet-send-student"]', 'Aperçu et envoi')
        r.attendre('.diet-send-view', 'aperçu')
    with r.etape('apercu-eleves', 'Élèves à cocher : Tous', cle=cle):
        r.toucher('[data-action="diet-send-all"]', 'Tous')
    with r.etape('confirmation', 'Envoyer : élèves nommés, jours loin de l\'objectif dits, « Revoir les jours »', cle=cle):
        r.toucher('#dietSendGo', 'Envoyer à 2 élèves')
        r.attendre('.ios-dialog', 'confirmation')
    with r.etape('envoye', 'Plan envoyé aux deux élèves, gardé dans Mes diètes', cle=cle):
        r.choisir('Envoyer')


@parcours('nutri-eleve-jours', 'Élève : jour d\'entraînement ou de repos, Remplacer, eau en verres, sel, semaine', 'pratiquant')
def p_nutri_eleve_jours(r):
    """Élève qui suit « Sèche semaine 1 » de son coach (jour d'entraînement à 2 300 kcal, jour de repos à 2 000 kcal),
    sans séance aujourd'hui : « Séance aujourd'hui ? » sur l'accueil et en haut de Nutrition, « Non » (repos), « Changer »
    (entraînement), « Remplacer » la pomme de terre (175 g de riz cuit), verres d'eau (3 à 5 L), sel (pincée, cuillère à
    café). Puis le même plan en semaine de 7 jours : « Mercredi · Repos », la semaine s'ouvre, jour suivant."""
    d = _sans_seance_du_jour(json.loads(REALISTE))
    d['dietPlans'] = {'dc_c1_seche': plan_seche_eleve('session')}
    d['dietActive'] = 'dc_c1_seche'
    d['dietEmptyDays'] = False
    r.lancer(json.dumps(d, ensure_ascii=False, separators=(',', ':')))
    cle = 'Élève : dire si on s\'entraîne aujourd\'hui'
    with r.etape('accueil-question', 'Accueil : « Séance aujourd\'hui ? » sur la carte Nutrition', cle=cle):
        r.defiler('.diet-home', 'carte Nutrition')
    with r.etape('nutrition-question', 'Nutrition : la question en haut, menu du jour d\'entraînement en attendant', cle=cle):
        r.toucher('.diet-home__open', 'carte Nutrition')
        r.attendre('.nutrition-view .diet-dayask', 'question du jour')
    with r.etape('repos', '« Non » : jour de repos, 2 000 kcal (« Changer » à côté)', cle=cle):
        r.toucher('.nutrition-view .diet-dayask [data-v="r"]', 'Non')
        r.attendre('.nutrition-view .diet-dayline', 'ligne du jour')
    with r.etape('entrainement', '« Changer » : jour d\'entraînement, 2 300 kcal', cle=cle):
        r.toucher('[data-action="diet-day-kind"]', 'Changer')
    cle = 'Élève : remplacer un aliment'
    with r.etape('remplacer', 'Pomme de terre : « Remplacer » (équivalents, quantité calculée)', cle=cle):
        r.toucher('.diet-item[data-item="i1"]', 'Pomme de terre (Remplacer)')
        r.attendre('.sheet .diet-cands', 'équivalents')
    with r.etape('remplace', 'Riz blanc cuit choisi : 175 g pour la journée', cle=cle):
        r.toucher('.sheet .diet-cand[data-swap]', 'Riz blanc, cuit', texte='Riz blanc, cuit')
    cle = 'Élève : noter son eau'
    with r.etape('eau', 'Carte Eau : objectif 3 à 5 L, cases de 1 L', cle=cle):
        r.defiler('.water-card', 'carte Eau')
    with r.etape('eau-verre', 'Une case touchée : 1 L noté', cle=cle):
        r.toucher('.water-cup', 'première case')
    cle = 'Élève : noter son sel'
    with r.etape('sel', 'Bilan : « Sel … objectif 3 à 5 g », « + Pincée 0,4 g »', cle=cle):
        r.defiler('.diet-salt', 'ligne Sel')
    with r.etape('sel-pincee', 'Pincée ajoutée d\'un toucher (Annuler dans le message)', cle=cle):
        r.toucher('.diet-salt__add', '+ Pincée')
    with r.etape('sel-feuille', 'Feuille Sel : sel des aliments, sel ajouté, pincée, cuillère à café, autre', cle=cle):
        r.toucher('.diet-salt__open', 'ligne Sel')
        r.attendre('.sheet .diet-saltsheet', 'feuille Sel')
    with r.etape('sel-cuillere', 'Cuillère à café ajoutée : 6 g de plus', cle=cle):
        r.toucher('.sheet [data-salt="6"]', 'Cuillère à café')
    with r.etape('sel-ferme', 'Feuille fermée : bilan du jour à jour', cle=cle):
        r.toucher('.sheet__btn--confirm', 'OK')
        r.defiler('.diet-salt', 'ligne Sel')
    r.raccourci("""p => { data.dietPlans = { dc_c1_sem: p }; data.dietActive = 'dc_c1_sem'; save(); switchTab('train', { reset: true }); navigate('nutrition'); render(); }""",
                'le coach a envoyé la version de 7 jours du plan (mardi, mercredi, samedi et dimanche de repos)', plan_seche_eleve('week'))
    cle = 'Élève : voir la semaine du plan'
    with r.etape('semaine-ligne', 'Nutrition : « Mercredi · Repos » sous la frise', cle=cle):
        r.attendre('.diet-dayline', 'ligne du jour')
    with r.etape('semaine-jour', 'La semaine s\'ouvre sur mercredi', cle=cle):
        r.toucher('.diet-dayline [data-action="diet-open-day"]', 'Voir la semaine')
        r.attendre('.diet-dayswipe', 'jour du plan')
    with r.etape('semaine-suivant', 'Jour suivant : jeudi, jour d\'entraînement', cle=cle):
        r.toucher('.diet-daynav__btn--next', 'Jeudi')


def _jour_partage(n, kcal, faits, kind='t', water=2500, salt=4.2):
    """Un jour envoyé par l'élève (dietShareDay), n jours avant l'horloge (mercredi 4/11/2026)."""
    import datetime
    noms = ['Petit-déjeuner', 'Déjeuner', 'Collation', 'Dîner']
    jour = (datetime.date(2026, 11, 4) - datetime.timedelta(days=n)).isoformat()
    return {'day': jour, 'plan': 'd_seche001', 'name': 'Sèche semaine 1', 'kind': kind,
            'meals': [{'n': m, 'ok': i < faits} for i, m in enumerate(noms)], 'kcal': kcal, 'p': round(kcal * 0.065), 'c': round(kcal * 0.11),
            'f': round(kcal * 0.024), 'goal': {'kcal': 2000, 'p': 150, 'c': 200, 'f': 55} if kind == 'r' else {'kcal': 2300, 'p': 150, 'c': 270, 'f': 55}, 'water': water, 'waterGoal': 5000, 'waterMin': 3000,
            'salt': salt, 'saltMin': 3, 'saltMax': 5}


# Léa : semaine réaliste (suivie, partielle, un jour sans rien, aujourd'hui en cours) ; Zoé : 3 jours à côté
JOURS_LEA = [_jour_partage(0, 1120, 2), _jour_partage(1, 2240, 4), _jour_partage(2, 1980, 3, 'r'), _jour_partage(4, 2310, 4),
             _jour_partage(5, 1500, 2, 'r'), _jour_partage(6, 2190, 4), _jour_partage(9, 2300, 4)]
JOURS_ZOE = [_jour_partage(1, 600, 1), _jour_partage(2, 450, 1), _jour_partage(3, 900, 1), _jour_partage(5, 2300, 4)]


@parcours('suivi-diete-eleve', 'Élève : partager le suivi de sa diète avec son coach (case à part)', 'coach')
def p_suivi_diete_eleve(r):
    """Léa, suivie par max, suit « Sèche semaine 1 » (2 repas cochés, 1,5 L d'eau aujourd'hui). Réglages › Social et coach ›
    Partager avec mon coach : « Suivi de ma diète » décochée par défaut, séparée de l'accord des plans, ce que le coach
    verra (jamais les aliments ni les heures, 90 jours au plus), cocher (Annuler dans le message), décocher."""
    d = json.loads(REALISTE)
    d['dietPlans'] = {'dc_c1_sem': plan_seche_eleve('session')}
    d['dietActive'] = 'dc_c1_sem'
    d['dietEmptyDays'] = False
    auj = '2026-11-04'
    d['dietLog'] = {auj: {'plan': 'dc_c1_sem', 'done': ['m3', 'm1'], 'swaps': {}, 'meals': ['m1', 'm2', 'm3', 'm4'], 'kind': 't'}}
    d['waterLog'] = {auj: [{'id': 'w1', 'ml': 1000, 'at': NOW - 3600_000}, {'id': 'w2', 'ml': 500, 'at': NOW - 60_000}]}
    r.lancer(json.dumps(d, ensure_ascii=False, separators=(',', ':')))
    r.connecter('lea')
    r.raccourci("""() => { const max = __sb.addPerson({ username: 'max', avatar: '🦁', social: false }); __sb.makeCoach(max);
        __sb.link(max, __sb.meId(), Date.now() - 20 * 86400000); return coachRefresh(); }""", 'Léa suivie par le coach max depuis 20 jours')
    cle = 'Élève : partager le suivi de sa diète'
    with r.etape('partage', 'Partager avec mon coach : « Suivi de ma diète » décochée, ce que max verra', cle=cle):
        reglages(r)
        r.defiler('[data-action="coach-open-share"]', 'Partager avec mon coach')
        r.toucher('[data-action="coach-open-share"]', 'Partager avec mon coach')
        r.attendre('[data-action="coach-share-toggle"][data-kind="diet_log"]', 'case Suivi de ma diète')
    with r.etape('partage-bas', 'Bas de l\'écran : voit, jamais, arrêter, « En savoir plus »'):
        r.bas('bas du partage')
    with r.etape('partage-coche', '« Suivi de ma diète » cochée : « Diète partagée avec ton coach » (Annuler)', cle=cle):
        r.toucher('[data-action="coach-share-toggle"][data-kind="diet_log"]', 'Suivi de ma diète')
    with r.etape('partage-arret', 'Désactiver : confirmation « Arrêter le partage de ta diète ? »', cle=cle):
        r.page.wait_for_timeout(2500)   # message du partage donné parti
        r.toucher('[data-action="coach-share-toggle"][data-kind="diet_log"]', 'Suivi de ma diète')
        r.attendre('.ios-dialog', 'confirmation')
    with r.etape('partage-decoche', '« Arrêter » : « Partage arrêté, journées supprimées du serveur »', cle=cle):
        r.choisir('Arrêter')


@parcours('suivi-diete-coach', 'Coach : carte Diète de l\'élève, Mes élèves, à relancer', 'coach')
def p_suivi_diete_coach(r):
    """Coach max, trois élèves : Léa partage sa diète (semaine suivie en partie, aujourd'hui en cours), Zoé la partage et
    l'a manquée 3 jours, Tom ne la partage pas. Mes élèves (7 pastilles, « Diète pas suivie 3 jours »), fiche de Zoé et
    « Écrire à zoe » (message prêt, jamais envoyé seul), fiche de Léa (carte Diète, un jour touché, règle, semaine d'avant),
    fiche de Tom (« Diète non partagée »)."""
    r.lancer(REALISTE)
    r.connecter('max')
    r.raccourci("""([lea, zoe]) => { const me = __sb.meId(); __sb.makeCoach(me);
        const ids = {};
        for (const [name, av] of [['lea', '🦊'], ['tom', '🐼'], ['zoe', '🦉']]) { ids[name] = __sb.addPerson({ username: name, avatar: av, social: false, sessions: [
          { id: 'h1', date: Date.now() - 86400000, duration: 3600000, programme: 'ppl', category: 'push', label: 'Push', exercises: [{ name: 'Développé couché', sets: [{ weight: '60', reps: '8' }] }] }] });
          __sb.link(me, ids[name], Date.now() - 60 * 86400000); }
        __sb.shareDiet(ids.lea, lea); __sb.shareDiet(ids.zoe, zoe);
        return coachRefresh(); }""", 'rôle coach validé ; Léa et Zoé partagent leur diète, Tom non', [JOURS_LEA, JOURS_ZOE])
    cle = 'Coach : voir qui suit sa diète'
    with r.etape('mes-eleves', 'Onglet Coach, Élèves : ligne Diète (7 pastilles), « Diète pas suivie 3 jours »', cle=cle):
        r.onglet('friends', 'Coach')
        r.attendre('.coach-team .coach-student-row', 'Élèves')
    with r.etape('fiche-zoe', 'Fiche de Zoé : « zoe n\'a pas suivi sa diète ces 3 derniers jours », « Écrire à zoe »', cle='Coach : relancer un élève sur sa diète'):
        r.toucher('.coach-student-row', 'Zoé', texte='zoe')
        r.attendre('.cdiet', 'carte Diète')
        r.defiler('.cdiet__warn', 'carte Diète')
    with r.etape('ecrire', '« Écrire à zoe » : message déjà écrit, à relire, pas envoyé', cle='Coach : relancer un élève sur sa diète'):
        r.toucher('.cdiet__write', 'Écrire à zoe')
        r.attendre('#chatInput', 'conversation')
    with r.etape('fiche-lea', 'Fiche de Léa : carte Diète, 7 jours, hier choisi d\'office', cle=cle):
        r.retour()
        r.retour()
        r.attendre('.coach-team .coach-student-row', 'Élèves')
        r.toucher('.coach-student-row', 'Léa', texte='lea')
        r.attendre('.cdiet__days', 'carte Diète')
        r.defiler('.cdiet', 'carte Diète')
    with r.etape('detail-jour', 'Lundi touché (partiel) : repas cochés, calories, macros, eau, sel', cle=cle):
        r.toucher('.cdiet__day', 'Lundi', nth=4)
        r.defiler('.cdiet__group', 'détail du jour')
    with r.etape('regle', '« Comment c\'est compté » : seuils de Suivi et de Partiel'):
        r.toucher('.cdiet__rule summary', 'Comment c\'est compté')
    with r.etape('semaine-avant', 'Semaine d\'avant', cle=cle):
        r.toucher('[data-action="coach-diet-week"][data-dir="1"]', 'Semaine d\'avant')
        r.defiler('.cdiet', 'carte Diète')
    with r.etape('non-partage', 'Fiche de Tom : « Diète non partagée » et où l\'activer, aucun chiffre'):
        r.retour()
        r.attendre('.coach-team .coach-student-row', 'Élèves')
        r.toucher('.coach-student-row', 'Tom', texte='tom')
        r.attendre('.cdiet-off', 'carte Diète non partagée')
        r.defiler('.cdiet-off', 'carte Diète')


if __name__ == '__main__':
    print('\n'.join(f'{p.nom:20} {p.role:11} {p.titre}' for p in PARCOURS))
    print(json.dumps(len(PARCOURS)))


# ─────────────────────────────────────────────────────────────
#  Photos de bilan (docs/PHOTOS_BILAN.md) : deux téléphones, le coach et son élève
# ─────────────────────────────────────────────────────────────
_IMAGES = {}


def image_bilan(nom, rgb, bande):
    """JPEG de test (aplat à bandes, aucune personne), fait une fois par passe."""
    if nom not in _IMAGES:
        import tempfile
        from PIL import Image, ImageDraw
        dossier = _IMAGES.setdefault('_dossier', tempfile.mkdtemp(prefix='panel-bilan-'))
        img = Image.new('RGB', (1200, 1600), rgb)
        d = ImageDraw.Draw(img)
        for y in range(0, 1600, 120):
            d.rectangle([0, y, 1200, y + 50], fill=bande)
        _IMAGES[nom] = os.path.join(dossier, nom)
        img.save(_IMAGES[nom], quality=85)
    return _IMAGES[nom]


def photo_au_coffre(r, chemin, pose, jours):
    """Photo ajoutée au coffre ouvert (sélecteur de fichier, pose, date) : préparé, jamais compté."""
    p = r.page
    p.set_input_files('#photoFile', chemin)
    p.wait_for_selector('.sheet .pnew__img')
    p.click(f'.sheet [data-action="photo-pose"][data-pose="{pose}"]')
    p.fill('#phDate', p.evaluate('d => localISO(Date.now() - d * 86400000)', jours))
    p.click('.sheet .sheet__btn--confirm')
    p.wait_for_function('() => !document.querySelector(".sheet .pnew__img")')
    p.wait_for_timeout(400)


SERVEUR_PHOTOS = "() => JSON.stringify({ pkeys: __sb.co.pkeys, photos: __sb.co.photos, objs: __sb.objs, trash: __sb.trash })"
RECOPIER_PHOTOS = "s => { const o = JSON.parse(s); __sb.co.pkeys = o.pkeys; __sb.co.photos = o.photos; __sb.objs = o.objs; __sb.trash = o.trash; }"


def recopier_serveur(r, de, vers):
    """Le faux serveur vit dans chaque page : ce qu'il garde des photos passe d'un téléphone à l'autre."""
    vers.evaluate(RECOPIER_PHOTOS, de.evaluate(SERVEUR_PHOTOS))


@parcours('photos-bilan', 'Photos de bilan : l\'élève les envoie, le coach les compare', 'coach')
def p_photos_bilan(r):
    """Deux téléphones. Le coach max active « Recevoir les photos de bilan » sous la liste de Coach › Élèves (Face ID
    simulé, une fois pour tous ses élèves). Léa ouvre son coffre (Progrès › Mensurations › Photos, Face ID), y a trois photos sur deux jours,
    touche « Envoyer à mon coach » sous un jour, coche une photo (accord affiché sous la photo), l'envoie (18 ans ou
    plus, déclaré une fois), puis envoie seule la photo d'il y a deux semaines ; elle les retrouve dans Social › Mon
    coach › Photos de bilan. Le coach les ouvre (Face ID) et compare les deux dates côte à côte ; Léa en retire une."""
    from fake_account import FAKE_VAULT
    # ── Téléphone du coach : max (…0002), élève lea (…0004), mêmes identifiants que celui de Léa ──
    r.page.add_init_script(FAKE_VAULT)
    r.lancer(REALISTE)
    r.connecter('max')
    r.raccourci("""async () => { const me = __sb.meId(); __sb.makeCoach(me);
        __sb.addPerson({ username: 'tom', avatar: '🐼', social: false });
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', social: false });
        __sb.link(me, lea, Date.now() - 40 * 86400000); await coachRefresh(); }""", 'rôle coach validé, élève Léa')
    coach = r.page
    with r.etape('coach-recevoir', 'Coach › Élèves : « Recevoir les photos de bilan », sous la liste', cle='Coach : recevoir les photos de bilan'):
        r.onglet('friends', 'Coach')
        r.attendre('.coach-team [data-action="cph-setup"]', '« Recevoir les photos de bilan » sous la liste des élèves')
        r.defiler('.coach-team [data-action="cph-setup"]', '« Recevoir les photos de bilan »')
        r.toucher('.coach-team [data-action="cph-setup"]', 'Recevoir les photos de bilan (Face ID simulé)')
        r.page.wait_for_function("() => !document.querySelector('.coach-team [data-action=\"cph-setup\"]')", timeout=5000)

    # ── Téléphone de Léa ──
    eleve = r.autre_telephone(FAKE_VAULT, opts={'uidStart': 1})
    with r.sur(eleve):
        r.lancer(REALISTE)
        mx = eleve.evaluate("() => __sb.addPerson({ username: 'max', avatar: '🦁', social: false })")
        r.connecter('lea')
        recopier_serveur(r, coach, eleve)
        r.raccourci("""async mx => { const me = __sb.meId(); __sb.makeCoach(mx); __sb.link(mx, me, Date.now() - 40 * 86400000);
            await coachRefresh(); }""", 'Léa suivie par max, qui reçoit les photos', mx)
        with r.etape('coffre', 'Élève : Progrès › Mensurations › Photos, coffre créé avec Face ID', cle='Élève : envoyer une photo de bilan'):
            r.onglet('progress', 'Progrès')
            r.defiler('[data-action="go-body-measures"]', 'groupe Mensurations')
            r.toucher('[data-action="go-body-measures"]', 'Mensurations')
            r.toucher('[data-action="go-photo-vault"]', 'Photos')
            r.toucher('[data-action="pv-start"]', 'Créer le coffre (Face ID simulé)')
            r.attendre('.view.photo-vault [data-action="photo-add"]', 'coffre ouvert')
        photo_au_coffre(r, image_bilan('face.jpg', (190, 120, 80), (60, 90, 160)), 'face', 0)
        photo_au_coffre(r, image_bilan('dos.jpg', (120, 160, 90), (40, 40, 40)), 'back', 0)
        photo_au_coffre(r, image_bilan('ancienne.jpg', (200, 200, 120), (150, 60, 60)), 'face', 14)
        with r.etape('coffre-photos', 'Coffre : trois photos, « Envoyer à mon coach » sous chaque jour'):
            r.attendre('[data-action="cph-send-day"]', '« Envoyer à mon coach »')
        with r.etape('envoyer', '« Envoyer à mon coach » : chaque photo à cocher, rien de coché', cle='Élève : envoyer une photo de bilan'):
            r.toucher('[data-action="cph-send-day"]', 'Envoyer à mon coach (aujourd\'hui)')
            r.attendre('.sheet .cphs__item', 'photos à cocher')
        with r.etape('cocher', 'Photo de face cochée : « Ton coach la verra… »', cle='Élève : envoyer une photo de bilan'):
            r.toucher('.sheet .cphs__item', 'photo de face', texte='Face')
        with r.etape('age', 'Premier envoi : 18 ans ou plus', cle='Élève : envoyer une photo de bilan'):
            r.toucher('.sheet .cphs__go', 'Envoyer')
            r.attendre('.ios-dialog', 'question sur l\'âge')
        with r.etape('envoyee', 'Photo envoyée', cle='Élève : envoyer une photo de bilan'):
            r.choisir('J\'ai 18 ans ou plus')
            eleve.wait_for_function('() => !document.querySelector(".sheet .cphs__list")', timeout=15000)
        with r.etape('envoyer-une', 'Photo d\'il y a deux semaines, seule : « Envoyer cette photo »'):
            r.toucher('[data-action="cph-send-day"]', 'Envoyer à mon coach (il y a deux semaines)', nth=1)
            r.attendre('.sheet .cphs__one', 'photo seule')
            r.toucher('.sheet [data-action="cph-send-go"]', 'Envoyer cette photo')
            eleve.wait_for_function('() => !document.querySelector(".sheet .cphs__one")', timeout=15000)
        with r.etape('mon-coach', 'Social › Mon coach : cellule « Photos de bilan »', cle='Élève : voir et retirer ses photos de bilan'):
            r.onglet('friends', 'Social')
            r.toucher('[data-action="coach-open-mine"]', 'Mon coach')
            r.defiler('[data-action="cph-open-mine"]', 'Photos de bilan')
        with r.etape('photos-envoyees', 'Mon coach › Photos de bilan : ce qui est parti', cle='Élève : voir et retirer ses photos de bilan'):
            r.toucher('[data-action="cph-open-mine"]', 'Photos de bilan')
            r.attendre('.coach-photos-mine-view .cph-row', 'photos envoyées')

    # ── Téléphone du coach : ouvrir, comparer ──
    recopier_serveur(r, eleve, coach)
    with r.etape('coach-ouvrir', 'Coach : fiche de Léa › Photos de bilan, ouvertes avec Face ID', cle='Coach : comparer deux bilans'):
        r.toucher('.coach-student-row', 'Léa', texte='lea')
        r.attendre('.coach-student-view', 'fiche de l\'élève')
        r.defiler('[data-action="cph-open"]', 'Photos de bilan')
        r.toucher('[data-action="cph-open"]', 'Photos de bilan (Face ID simulé)')
        coach.wait_for_function("() => document.querySelectorAll('.coach-photos-view .pgal__item img[src^=\"blob:\"]').length === 2", timeout=20000)
    with r.etape('coach-comparer', 'Coach : deux dates côte à côte (Avant, Après, écart en jours)', cle='Coach : comparer deux bilans'):
        r.defiler('.cph-pair', 'comparaison')

    # ── Téléphone de Léa : retirer ──
    with r.sur(eleve):
        with r.etape('verifier-cle', 'Élève : « Vérifier le code avec ton coach » déplié'):
            r.toucher('[data-action="cph-verify"]', 'Vérifier le code avec ton coach')
            r.attendre('.coach-photos-mine-view .cph-code', 'code de la clé')
        with r.etape('retirer', 'Élève : « Retirer » une photo', cle='Élève : voir et retirer ses photos de bilan'):
            r.toucher('.cph-row [data-action="cph-remove"]', 'Retirer')
            r.choisir('Retirer')
            eleve.wait_for_function("() => document.querySelectorAll('.cph-row').length === 1", timeout=10000)


# ─────────────────────────────────────────────────────────────
#  Payant (verrou allumé simulé), élèves offerts par leur coach, photo de profil (branche serveur-1711)
# ─────────────────────────────────────────────────────────────
def _coquille_payante(r):
    """Faux StoreKit (tests/fake_store.py, les dix formules) et verrou payant allumé : à appeler avant lancer()."""
    from fake_store import FAKE_STORE
    r.coquille_native('window.__stOpts = { paywallOn: true };\n' + FAKE_STORE)


def _abonnement(r):
    """Réglages › Abonnement depuis l'accueil."""
    reglages(r)
    r.defiler('.settings-view [data-action="access-open-settings"]', 'cellule Abonnement')
    r.toucher('.settings-view [data-action="access-open-settings"]', 'Abonnement')
    r.attendre('.pay-settings-view', 'Réglages › Abonnement')


@parcours('abonnement', 'Abonnement d\'un particulier (verrou payant allumé)', 'pratiquant')
def p_abonnement(r):
    """Max, sans abonnement, verrou payant allumé (simulé : il est éteint en vrai) : Réglages › Abonnement, puis
    les formules (essai de 3 mois, mensuel, annuel « soit 8,5 mois »), mentions d'Apple sous les boutons."""
    _coquille_payante(r)
    r.lancer(REALISTE)
    r.connecter('max')
    cle = 'Voir les formules d\'abonnement'
    with r.etape('reglages-abonnement', 'Réglages › Abonnement : état, « Voir les formules »', cle=cle):
        _abonnement(r)
    with r.etape('formules', 'Formules : essai de 3 mois, mensuel, annuel', cle=cle):
        r.toucher('.pay-settings-view [data-action="pay-open"]', 'Voir les formules')
        r.attendre('.pay-view', 'écran d\'abonnement')
    with r.etape('mentions', 'Bas de l\'écran : mentions d\'Apple, codes, conditions'):
        r.defiler('.pay-view [data-action="pay-terms"]', 'conditions')


@parcours('eleve-offert', 'Élève d\'un coach abonné : « Offert par ton coach »', 'coach')
def p_eleve_offert(r):
    """Léa est l'élève de lucas, coach abonné (palier 10 élèves) : elle n'a rien à payer. Réglages › Abonnement
    dit « Offert par ton coach lucas », l'écran d'abonnement ne propose aucune formule ; puis lucas arrête son
    abonnement : 7 jours de grâce, bandeau daté sur l'accueil."""
    _coquille_payante(r)
    r.lancer(REALISTE)
    r.connecter('lea')
    r.raccourci("""async () => { const c = __sb.addPerson({ username: 'lucas', avatar: '🦁', social: false }); __sb.makeCoach(c);
        __sb.link(c, __sb.meId(), Date.now() - 20 * 86400000); __st.setCover('active'); await coachRefresh();
        access.loadedAt = 0; await accessRefresh(); render(); }""", 'coach lucas abonné, Léa dans son palier')
    cle = 'Savoir que son coach offre l\'accès'
    with r.etape('reglages-abonnement', 'Réglages › Abonnement : « Offert par ton coach lucas », rien à payer', cle=cle):
        _abonnement(r)
    with r.etape('ecran-abonnement', 'Écran d\'abonnement : rien à acheter', cle=cle):
        r.raccourci("navigate(makeRoute('paywall', 'offer'))", 'écran d\'abonnement ouvert (lien de l\'accueil verrou allumé)')
        r.attendre('.pay-view', 'écran d\'abonnement')
    with r.etape('grace-accueil', 'Coach qui a arrêté : bandeau « Offert par ton coach jusqu\'au … »'):
        r.raccourci("async () => { __st.setCover('grace', { days: 5 }); access.loadedAt = 0; await accessRefresh(); }",
                    'lucas a arrêté son abonnement coach il y a 2 jours')
        r.onglet('train', 'Entraînement')
    with r.etape('grace-reglages', 'Réglages › Abonnement pendant la grâce : date de fin'):
        r.toucher('.pay-banner', 'bandeau')
        r.attendre('.pay-settings-view', 'Réglages › Abonnement')


@parcours('abonnement-coach', 'Coach : forfait selon ses élèves, « Tes élèves n\'ont rien à payer »', 'coach')
def p_abonnement_coach(r):
    """Max est coach validé (palier 10 élèves) et suit 12 élèves : Réglages › Abonnement, formules coach (« Tes
    élèves n'ont rien à payer »), puis Élèves : bandeau des 2 élèves au-delà de sa formule, palier 20 conseillé."""
    _coquille_payante(r)
    r.lancer(REALISTE)
    r.connecter('max')
    r.raccourci("""async () => { const me = __sb.meId(); __sb.makeCoach(me); __sb.setTier(me, 'com.mdlf.training.coach10.monthly');
        for (let i = 0; i < 12; i++) __sb.link(me, __sb.addPerson({ username: 'eleve' + (i + 1), social: false }), Date.now() - (30 - i) * 86400000);
        __st.subscribe('com.mdlf.training.coach10.monthly', 30, {});
        await coachRefresh(); coachPro.loadedAt = 0; await coachProRefresh(); access.loadedAt = 0; await accessRefresh(); render(); }""",
                'max coach validé, abonné au palier 10 élèves (achat simulé), 12 élèves')
    cle = 'Choisir son forfait coach'
    with r.etape('reglages-abonnement', 'Réglages › Abonnement du coach', cle=cle):
        _abonnement(r)
    with r.etape('formules-coach', 'Formules coach : « Tes élèves n\'ont rien à payer », 4 paliers', cle=cle):
        r.toucher('.pay-settings-view [data-action="pay-open"][data-tab="coach"]', 'Changer de palier coach')
        r.attendre('.pay-view', 'écran d\'abonnement')
    with r.etape('eleves-au-dela', 'Élèves : bandeau « 2 élèves au-delà de ton palier »', cle='Voir les élèves non couverts'):
        r.onglet('friends', 'Coach')
        r.raccourci("navigate('coach-students')", 'liste complète des élèves')
        r.attendre('.coach-tier-banner', 'bandeau du palier')
    with r.etape('palier-conseille', 'Palier 25 élèves conseillé', cle='Voir les élèves non couverts'):
        r.toucher('.coach-tier-banner', 'bandeau du palier')
        r.attendre('.pay-view', 'écran d\'abonnement')


_PHOTO_B64 = {}


def _photo_ami_b64():
    """Photo de profil d'un ami : anneaux de couleur (aucune personne), JPEG 512 px en base64."""
    if 'ami' not in _PHOTO_B64:
        import base64
        import io
        from PIL import Image, ImageDraw
        img = Image.new('RGB', (512, 512), (40, 110, 90))
        d = ImageDraw.Draw(img)
        for i, rr in enumerate(range(240, 0, -60)):
            d.ellipse([256 - rr, 256 - rr, 256 + rr, 256 + rr], fill=(235, 225, 210) if i % 2 == 0 else (40, 110, 90))
        buf = io.BytesIO()
        img.save(buf, 'JPEG', quality=80)
        _PHOTO_B64['ami'] = base64.b64encode(buf.getvalue()).decode()
    return _PHOTO_B64['ami']


@parcours('photo-profil', 'Photo de profil : choisir, aperçu, vue par un ami', 'pratiquant')
def p_photo_profil(r):
    """Max, abonné (photo comprise dans MDLF Pro) : Réglages › Compte › Photo de profil, feuille, choix d'une image
    (sélecteur d'iOS), aperçu recadré, « Utiliser cette photo » ; puis le profil de Léa, une amie qui a une photo."""
    r.lancer(REALISTE)
    r.raccourci("""async (b64) => { await accountSignInWith('apple', async () => 'add');
        await accountSaveProfile({ username: 'max', avatar: '🦁' }); await socialEnable(true);
        const lea = __sb.addPerson({ username: 'lea', avatar: '🦊' }); __sb.follow(__sb.meId(), lea);
        __sb.setPhoto(lea, b64, 'image/jpeg'); window.__lea = lea; await socialRefresh(); }""",
                'connecté (max), Social activé, amie Léa avec une photo', _photo_ami_b64())
    cle = 'Mettre une photo de profil'
    with r.etape('compte', 'Réglages › Compte : cellule « Photo de profil »', cle=cle):
        reglages(r)
        r.toucher('.settings-view [data-action="go-account"]', 'Compte')
        r.attendre('[data-action="pph-open"]', 'cellule Photo de profil')
    with r.etape('feuille', 'Feuille « Photo de profil » : qui la voit, choisir', cle=cle):
        r.toucher('[data-action="pph-open"]', 'Photo de profil')
        r.attendre('.sheet .pph-sheet', 'feuille')
    with r.etape('apercu', 'Aperçu du carré recadré', cle=cle):
        with r.page.expect_file_chooser() as fc:
            r.toucher('.sheet [data-action="pph-pick"]', 'Choisir une photo (sélecteur d\'iOS)')
        fc.value.set_files(image_bilan('profil.jpg', (40, 70, 120), (230, 140, 60)))
        r.attendre('.sheet .pph-preview__img', 'aperçu')
    with r.etape('enregistree', 'Photo posée sur l\'avatar du compte', cle=cle):
        r.toucher('.sheet [data-action="pph-use"]', 'Utiliser cette photo')
        r.page.wait_for_function("() => !document.querySelector('.sheet .pph-sheet')", timeout=10000)
    with r.etape('profil-amie', 'Profil de Léa : sa photo, « Signaler la photo »'):
        r.raccourci("navigate(makeRoute('social-profile', window.__lea))", 'profil de Léa ouvert depuis le fil')
        r.attendre('.social-profile-view .account-hero', 'profil')


@parcours('eleve-abonne-couvert', 'Élève déjà abonné que son coach couvre : « Tu peux résilier ton abonnement »', 'coach')
def p_eleve_abonne_couvert(r):
    """Léa avait son propre abonnement mensuel (essai d'Apple en cours) avant de rejoindre lucas, coach abonné : son coach
    couvre maintenant son accès. Réglages › Abonnement le lui dit avec la date où l'essai deviendrait payant et
    « Gérer mon abonnement » ; jamais de remboursement promis. Puis elle a résilié chez Apple : la carte disparaît."""
    _coquille_payante(r)
    r.lancer(REALISTE)
    r.connecter('lea')
    r.raccourci("""async () => { const c = __sb.addPerson({ username: 'lucas', avatar: '🦁', social: false }); __sb.makeCoach(c);
        __sb.link(c, __sb.meId(), Date.now() - 2 * 86400000); __st.setCover('active');
        __st.subscribe('com.mdlf.training.pro.monthly', 40, { intro: true });
        __st.owned = { productId: 'com.mdlf.training.pro.monthly', originalId: 'apple-lea', transactionId: 'tx-lea', expiresAt: Date.now() + 40 * 86400000 };
        await coachRefresh(); access.loadedAt = 0; await accessRefresh(); render(); }""",
                'Léa en essai d\'Apple sur la formule mensuelle, puis reliée à lucas (coach abonné)')
    cle = 'Savoir qu\'on peut résilier son propre abonnement'
    with r.etape('reglages-abonnement', 'Réglages › Abonnement : « Ton coach couvre ton accès », date de l\'essai, « Gérer mon abonnement »', cle=cle):
        _abonnement(r)
        r.attendre('.pay-double', 'carte')
    with r.etape('resilie', 'Abonnement résilié chez Apple : plus de carte'):
        r.raccourci("async () => { __st.owned.willAutoRenew = false; await accessLoadCurrentPlan(); render(); }", 'résilié dans les réglages d\'Apple')


@parcours('affiche-coach', 'Coach : « Mon affiche de coach » (photo ronde, silhouette, photo de l\'affiche, nom, carré, partage)', 'coach')
def p_affiche_coach(r):
    """Camille, coach validée, carte pro déclarée, sans photo : Mes élèves › Invitations › Mon affiche de coach ;
    aperçu (initiales dans le rond), photo de l'affiche choisie (gardée sur l'iPhone), son nom, silhouette femme
    (« Nouvelle coach »), format carré, puis Partager (feuille d'iOS). Docs/AFFICHE_COACH.md."""
    r.lancer(REALISTE)
    r.connecter('camille_coach')
    r.raccourci("""async () => { __sb.makeCoach(__sb.meId()); await coachRefresh(); await coachProRefresh({ minAge: 0 });
        await coachCardDeclare('04912ED0123'); window.__shared = [];
        Native.shareImage = async (d, n) => { window.__shared.push(n); return 'shared'; }; }""",
                'rôle coach validé, code permanent, carte pro déclarée ; feuille de partage d\'iOS simulée')
    cle = 'Créer et partager son affiche de coach'
    with r.etape('mes-eleves', 'Mes élèves › Invitations : « Mon affiche de coach »', cle=cle):
        r.onglet('friends', 'Coach')
        r.raccourci("navigate('coach-students')", 'liste complète des élèves')
        r.defiler('[data-action="coach-poster-open"]', 'cellule Mon affiche de coach')
    with r.etape('apercu-sans-photo', 'Aperçu sans photo : le personnage aux muscles rouges', cle=cle):
        r.toucher('[data-action="coach-poster-open"]', 'Mon affiche de coach')
        r.attendre('.sheet .cposter-form', 'aperçu')
        r.page.wait_for_function("() => !!(shareState && shareState.blob)", timeout=8000)   # Partager reste grisé sans nom
    with r.etape('photo', 'Photo de l\'affiche choisie (gardée sur l\'iPhone)', cle=cle):
        with r.page.expect_file_chooser() as fc:
            r.toucher('.sheet [data-action="coach-poster-photo"]', 'Photo (sélecteur d\'iOS)')
        fc.value.set_files(image_bilan('portrait.jpg', (52, 78, 110), (226, 196, 160)))
        r.page.wait_for_function("() => !!(cposter && cposter.photo)", timeout=8000)
    with r.etape('nom', 'Nom écrit sur l\'affiche (« Partager » s\'active)', cle=cle):
        r.saisir('#cposterName', 'Camille Martin', 'nom')
        r.page.wait_for_timeout(600)
    with r.etape('specialite', 'Spécialité facultative, sous le nom', cle=cle):
        r.saisir('#cposterSpecialty', 'Force · Perte de poids', 'spécialité')
        r.page.wait_for_timeout(600)
    with r.etape('femme', 'Silhouette femme : « Nouvelle coach », personnage femme', cle=cle):
        r.toucher('.sheet [data-action="coach-poster-silhouette"][data-v="female"]', 'Femme')
    with r.etape('carre', 'Format carré', cle=cle):
        r.toucher('.sheet [data-action="share-format"][data-f="square"]', 'Carré')
    with r.etape('partage', 'Partager : feuille de partage d\'iOS, aperçu refermé', cle=cle):
        r.toucher('.sheet [data-action="share-story-send"]', 'Partager')
    with r.etape('reglages-coach', 'Réglages › Coach : la même entrée sous « Ton code coach »'):
        r.raccourci("navigate('coach')", 'Réglages › Coach')
        r.defiler('[data-action="coach-poster-open"]', 'cellule Mon affiche de coach')


@parcours('photo-eleve-couvert', 'Élève couvert par son coach : photo de profil offerte, photo du coach dans Mon coach', 'coach')
def p_photo_eleve_couvert(r):
    """Léa, élève de Camille (coach abonnée qui couvre son accès), verrou payant allumé : Réglages › Compte › Photo de profil
    (« Offerte par ton coach »), choix et envoi ; puis Mon coach, avec la photo de Camille."""
    _coquille_payante(r)
    r.lancer(REALISTE)
    r.connecter('lea')
    r.raccourci("""async b64 => { const c = __sb.addPerson({ username: 'camille_coach', avatar: '🦁', social: false }); __sb.makeCoach(c);
        __sb.link(c, __sb.meId(), Date.now() - 5 * 86400000); __sb.setPhoto(c, b64, 'image/jpeg'); __st.setCover('active', { coach: c });
        (__sb.co.posterNames ||= {})[c] = 'Camille Martin';
        access.loadedAt = 0; await accessRefresh(); await coachRefresh(); }""", 'Léa reliée à Camille, qui couvre son accès, a une photo et a partagé son affiche (nom « Camille Martin »)',
                _photo_ami_b64())
    cle = 'Mettre une photo de profil (élève couvert)'
    with r.etape('compte', 'Réglages › Compte : « Photo de profil » sans mention Pro', cle=cle):
        reglages(r)
        r.toucher('.settings-view [data-action="go-account"]', 'Compte')
        r.attendre('[data-action="pph-open"]', 'cellule Photo de profil')
    with r.etape('feuille', 'Feuille : « Offerte par ton coach »', cle=cle):
        r.toucher('[data-action="pph-open"]', 'Photo de profil')
        r.attendre('.sheet .pph-sheet', 'feuille')
    with r.etape('enregistree', 'Photo choisie et enregistrée', cle=cle):
        with r.page.expect_file_chooser() as fc:
            r.toucher('.sheet [data-action="pph-pick"]', 'Choisir une photo (sélecteur d\'iOS)')
        fc.value.set_files(image_bilan('profil-lea.jpg', (60, 100, 80), (230, 200, 170)))
        r.attendre('.sheet .pph-preview__img', 'aperçu')
        r.toucher('.sheet [data-action="pph-use"]', 'Utiliser cette photo')
        r.page.wait_for_function("() => !document.querySelector('.sheet .pph-sheet')", timeout=10000)
    with r.etape('mon-coach', 'Mon coach : la photo de Camille, le nom de son affiche, @camille_coach dessous'):
        r.raccourci("routeTo('friends'); navigate('coach-mine')", 'Mon coach')
        r.attendre('.coach-mine-view', 'Mon coach')
        r.page.wait_for_function("() => !!document.querySelector('.coach-mine__handle')", timeout=8000)
