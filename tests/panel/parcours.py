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
        r.toucher('.view.session [data-action="edit-set"][data-ei="0"][data-si="0"]', 'série 1 validée')
    with r.etape('corriger-enregistrer', 'Corriger : nouvelles reps enregistrées', cle='Corriger une série validée'):
        r.saisir('#editSetReps', 10, 'reps corrigées')
        r.toucher('.view.session [data-action="save-edit-set"]', 'enregistrer la correction')
        passer_repos(r)

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

    with r.etape('plus-tard', 'Faire un exercice plus tard (menu ⋯ du 3e)', cle='Faire un exercice plus tard'):
        menu_ex(r, 2)
        choisir_ou_absent(r, 'plus tard', 'pas d\'action « plus tard » dans le menu ⋯ (seulement Monter / Descendre)')

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
        activeSession.exercises.slice(0, 3).forEach(ex => ex.sets.forEach(s => {
          if (s.done || s.warmup) return;
          if (String(s.reps ?? '').trim() === '') s.reps = String(setGoal(ex, s));
          if (String(s.weight ?? '').trim() !== '') s.done = true; }));
        persistSession(); render(); }""", 'séries des 3 premiers exercices faites, 52 min écoulées')
    with r.etape('terminer', 'Terminer la séance : confirmation', cle='Terminer et voir le bilan'):
        r.toucher('.view.session [data-action="finish-session"]', 'Terminer')
    with r.etape('bilan', 'Bilan de la séance', cle='Terminer et voir le bilan'):
        r.choisir('Enregistrer', '« Enregistrer la séance »')
        r.attendre('.view.summary', 'bilan')
    with r.etape('bilan-bas', 'Bilan, bas de l\'écran'):
        r.bas('bas du bilan')
    with r.etape('partage-apercu', 'Partager ma séance : aperçu de la story', cle='Partager la séance en story'):
        r.toucher('[data-action="share-story"]', 'Partager ma séance')
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
        r.attendre('.view.history', 'Historique')
    with r.etape('detail', 'Détail de la dernière séance', cle='Revoir sa dernière séance'):
        r.toucher('[data-action="open-history"]', 'la séance la plus récente')
        r.attendre('.view.history-detail', 'détail de séance')
    with r.etape('detail-bas', 'Détail, bas de l\'écran'):
        r.bas('bas du détail')


@parcours('progres', 'Progrès', 'pratiquant')
def p_progres(r):
    """Onglet Progrès : silhouette des muscles, courbe d'un exercice et son record, vue d'ensemble
    (records de la semaine), mesures du corps, coffre à photos (verrouillé)."""
    r.lancer(REALISTE)
    with r.etape('progres', 'Onglet Progrès'):
        r.onglet('progress', 'Progrès')
        r.attendre('.view.stats', 'Progrès')
    with r.etape('silhouette', 'Carte Muscles (silhouette de la semaine)'):
        r.defiler('[data-action="go-stats-muscles"]', 'carte Muscles')
    with r.etape('series-par-muscle', 'Séries par muscle', cle='Voir ses muscles travaillés'):
        r.toucher('[data-action="go-stats-muscles"]', 'carte Muscles')
    with r.etape('courbe-exercice', 'Courbe d\'un exercice et son record', cle='Voir la progression d\'un exercice'):
        r.retour()
        r.toucher('.view.stats [data-action="open-stats-ex"]', '1er exercice de la liste')
        r.attendre('.view.stats-ex', 'écran de l\'exercice')
    with r.etape('courbe-bas', 'Exercice, bas de l\'écran (records, séances)'):
        r.bas()
    with r.etape('vue-ensemble', 'Vue d\'ensemble (records de la semaine, calendrier)'):
        r.retour()
        r.toucher('[data-action="go-stats-overview"]', 'Vue d\'ensemble')
    with r.etape('mesures', 'Mesures du corps', cle='Ouvrir ses mesures'):
        r.retour()
        r.defiler('[data-action="go-body-measures"]', 'groupe Mesures')
        r.toucher('[data-action="go-body-measures"]', 'Mesures')
        r.attendre('.view.body-measures', 'Mesures')
    with r.etape('photos', 'Photos de progression (coffre verrouillé)'):
        r.toucher('[data-action="go-photo-vault"]', 'Photos')
        r.attendre('.view.photo-vault', 'coffre à photos')


@parcours('programme', 'Programme', 'pratiquant')
def p_programme(r):
    """Onglet Programme : la liste des séances, une séance, la fiche d'un exercice, Mes programmes."""
    r.lancer(REALISTE)
    with r.etape('liste', 'Onglet Programme'):
        r.onglet('program', 'Programme')
        r.attendre('.view.programmes', 'Programme')
    with r.etape('seance', 'Une séance du programme', cle='Modifier un exercice du programme'):
        r.toucher('.view.programmes [data-action="open-prog-session"]', '1re séance')
        r.attendre('.view.editor', 'séance du programme')
    with r.etape('fiche-exercice', 'Fiche d\'un exercice (séries, repos, reps)', cle='Modifier un exercice du programme'):
        r.toucher('.view.editor [data-action="edit-ex"]', '1er exercice')
        r.attendre('.view.ex-edit', 'fiche de l\'exercice')
    with r.etape('mes-programmes', 'Mes programmes'):
        r.toucher('[data-action="cancel-ex"]', 'Annuler (fiche de l\'exercice)')
        r.retour()
        r.toucher('.view.programmes [data-action="go-my-programmes"]', 'Mes programmes')
        r.attendre('.view.my-programmes', 'Mes programmes')
    with r.etape('tous-programmes', 'Ajouter un programme (catalogue)'):
        r.toucher('[data-action="go-prog-add"]', 'Ajouter un programme')


@parcours('bibliotheque', 'Bibliothèque d\'exercices', 'pratiquant')
def p_bibliotheque(r):
    """Bibliothèque depuis l'onglet Programme, puis la fiche d'un exercice (comment faire)."""
    r.lancer(REALISTE)
    with r.etape('bibliotheque', 'Bibliothèque', cle='Ouvrir la fiche d\'un exercice de la bibliothèque'):
        r.onglet('program', 'Programme')
        r.toucher('[data-action="go-library"]', 'Bibliothèque')
        r.attendre('.view.library', 'Bibliothèque')
    with r.etape('fiche', 'Fiche d\'un exercice', cle='Ouvrir la fiche d\'un exercice de la bibliothèque'):
        r.toucher('.view.library [data-action="open-library-ex"]', '1er exercice')
        r.attendre('.view.library-ex', 'fiche de la bibliothèque')
    with r.etape('fiche-bas', 'Fiche, bas de l\'écran'):
        r.bas('bas de la fiche')


@parcours('reglages', 'Réglages (chaque groupe)', 'pratiquant')
def p_reglages(r):
    """Réglages ouverts depuis l'accueil, puis chaque groupe amené en haut de l'écran."""
    r.lancer(REALISTE)
    with r.etape('haut', 'Réglages, haut de l\'écran', cle='Ouvrir les réglages'):
        reglages(r)
    titres = r.page.evaluate("[...document.querySelectorAll('.view.settings .group-title')].map(e => e.textContent.trim())")
    for i, t in enumerate(titres[1:], 1):
        with r.etape(f'groupe-{t}', f'Groupe « {t} »'):
            r.defiler(f'.view.settings .group-title >> nth={i}', f'« {t} »')


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


@parcours('amis', 'Amis : sans compte, puis avec compte', 'pratiquant')
def p_amis(r):
    """Onglet Amis sans compte (invitation à se connecter), puis connecté : activation, fil avec une amie
    qui s'entraîne, une de ses séances."""
    r.lancer(REALISTE)
    with r.etape('sans-compte', 'Onglet Amis sans compte'):
        r.onglet('friends', 'Amis')
    with r.etape('connexion', '« Se connecter » : écran de compte'):
        r.toucher('[data-action="social-sign-in"]', 'Se connecter')
    r.connecter('max')
    with r.etape('activer', 'Connecté : retour à Amis, carte d\'activation', cle='Activer Amis'):
        r.retour()
        r.attendre('[data-action="social-enable"]', 'carte d\'activation')
    with r.etape('active', 'Âge déclaré, Amis activé', cle='Activer Amis'):
        r.toucher('[data-action="social-age"]', 'J\'ai 15 ans ou plus')
        r.toucher('[data-action="social-enable"]', 'Activer')
    r.raccourci("""async (s) => { const lea = __sb.addPerson({ username: 'lea', avatar: '🦊', sessions: s });
        const tom = __sb.addPerson({ username: 'tom', avatar: '🐻' });
        __sb.follow(__sb.meId(), lea, 'accepted'); __sb.follow(tom, __sb.meId(), 'pending');
        await socialRefresh(); await socialLoadFeed(''); render(); }""",
                'Léa (suivie, 3 séances) et une demande de Tom', seances_amie())
    with r.etape('fil', 'Fil des amis et demande reçue'):
        r.attendre('.feed-card', 'carte du fil')
    with r.etape('seance-amie', 'Séance d\'une amie', cle='Voir la séance d\'une amie'):
        r.toucher('.feed-card [data-action="social-open-session"], .feed-card', 'carte de Léa')


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
    """Connecté, Amis activé, puis plus de réseau (salle en sous-sol) : onglet Amis, compte, une séance qui démarre quand même."""
    r.lancer(REALISTE)
    r.connecter('max', amis=True)
    r.page.context.set_offline(True)
    r.raccourci("() => { __sb.fail.social = 'offline'; __sb.fail.coach = 'offline'; __sb.fail.chat = 'offline'; window.dispatchEvent(new Event('offline')); }",
                'réseau coupé (navigateur et faux serveur)')
    with r.etape('amis', 'Onglet Amis hors ligne'):
        r.onglet('friends', 'Amis')
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
            {'name': 'Squat barre', 'sets': 5, 'repMax': 5}]},
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
    with r.etape('amis', 'Onglet Amis : cellule Mes élèves', cle='Ouvrir la dernière séance d\'un élève'):
        r.onglet('friends', 'Amis')
        r.attendre('[data-action="coach-open-students"]', 'cellule Mes élèves')
    with r.etape('mes-eleves', 'Mes élèves', cle='Ouvrir la dernière séance d\'un élève'):
        r.toucher('[data-action="coach-open-students"]', 'Mes élèves')
        r.attendre('.coach-students-view', 'Mes élèves')
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
    """Léa a reçu le code K7M2QX9P de son coach : onglet Amis › Rejoindre un coach, code, aperçu de ce que
    le coach verra, case d'âge, Accepter."""
    r.lancer(REALISTE)
    r.connecter('lea')
    r.raccourci(PREPARE_ELEVE, 'max est coach avec un code d\'invitation', [COACH_PROG])
    cle = 'Rejoindre un coach avec un code'
    with r.etape('amis', 'Onglet Amis : « Rejoindre un coach »', cle=cle):
        r.onglet('friends', 'Amis')
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
    with r.etape('amis', 'Onglet Amis : Mon coach (pastille)', cle='Ajouter le programme reçu du coach'):
        r.onglet('friends', 'Amis')
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


if __name__ == '__main__':
    print('\n'.join(f'{p.nom:20} {p.role:11} {p.titre}' for p in PARCOURS))
    print(json.dumps(len(PARCOURS)))
