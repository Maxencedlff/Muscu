// ═══════════════════════════════════════════════════════════
//  Limites et exceptions du contrôle d'architecture (tools/archi/check.mjs)
//
//  Une exception = une violation connue, gardée exprès parce que la corriger n'est ni simple ni sûre aujourd'hui.
//  Chacune dit pourquoi et depuis quand. Une exception qui ne couvre plus rien fait échouer le contrôle (à retirer).
//  Champs : regle, fichier, cible (nom, usage du DOM… ; absente = tout le fichier), page (ordre-chargement),
//  plafond (taille : lignes à ne pas dépasser), raison, date (AAAA-MM-JJ).
// ═══════════════════════════════════════════════════════════

export const LIMITES = {
  // Un fichier au-delà se lit mal en revue et mélange en général plusieurs responsabilités. Seuil choisi le
  // 25/11/2026 : 95 % des fichiers JS de l'app sont en dessous (médiane : ~220 lignes) ; 400 lignes pour les fichiers que
  // les tests bornent déjà (test_intensif.py, test_unilateral.py, test_muscles.py : « 400 au plus »).
  js: 800,
  css: 800,
  strictes: Object.fromEntries([
    'js/data/intensif.js', 'js/features/session-intensif.js', 'js/data/unilateral.js', 'js/features/session-unilateral.js',
    'js/data/muscles.js', 'js/data/exercise-catalogue.js', 'js/data/muscle-load.js', 'js/ui/body-map.js', 'js/ui/body-tip.js',
    'js/features/muscles.js', 'js/features/muscle-tip.js', 'css/muscles.css', 'css/atlas-zoom.css', 'css/progress-atlas.css',
  ].map(f => [f, 400])),
};

// Fichiers trop longs déjà là le 25/11/2026 : plafond = taille du jour + 10 % (arrondi à 50). Au-delà, découper le
// fichier par responsabilité, ou relever le plafond ici en disant pourquoi.
const TROP_LONGS = [
  ['js/features/coach-ui.js', 1750, 'écrans du coach dans l\'app (cellule, élèves, consignes, codes) : découpage prévu avec le passage aux modules ES'],
  ['js/features/session.js', 1500, 'séance active : rendu, saisie et validation des séries liés à l\'état partagé activeSession (ARCHITECTURE.md, « Suite prévue »)'],
  ['js/data/nutrition.js', 1250, 'nettoyage, calculs et plans de la nutrition V1 : un seul contrat de données (docs/NUTRITION_V1.md), découpage à faire par domaine'],
  ['js/features/nutrition-ui.js', 1200, 'écrans de la nutrition (jour, repas, feuilles) : déjà en partie découpé (diet-editor, diet-week, diet-qty)'],
  ['js/features/diet-editor.js', 1050, 'éditeur de plan diète : un seul écran à état local, à découper avec la nutrition'],
  ['js/data/account.js', 1050, 'synchro du compte (Trousseau, copies sur l\'appareil, envoi des séances) : code sensible, découpage seulement avec ses tests de synchro'],
  ['js/platform/native.js', 1000, 'pont natif unique par choix (ARCHITECTURE.md, « Coquilles natives ») : un objet Native par module natif'],
  ['js/features/social-ui.js', 950, 'écrans du Social (fil, personnes, profil) : déjà en partie découpé (reactions-ui, comments-ui, social-me-ui)'],
  ['js/data/coach.js', 950, 'contrat Coach V1 (appels RPC et nettoyage) : déjà en partie découpé (coach-*.js), le reste partage un état'],
  ['js/data/recap.js', 900, 'récaps : calculs de toutes les périodes sur la même lecture de l\'historique'],
  ['css/session.css', 1150, 'styles de la séance active, découpés avec session.js'],
  ['css/screens.css', 1100, 'composant de liste groupée unique (.group / .cell) et ses variantes : seul composant de liste, voulu en un fichier'],
];

export const EXCEPTIONS = [
  ...TROP_LONGS.map(([fichier, plafond, raison]) => ({ regle: 'taille', fichier, plafond, raison, date: '2026-11-25' })),

  // ── Couches : js/data qui touche à l'écran ──
  { regle: 'couche-dom', fichier: 'js/data/backup.js', raison: 'downloadBlob : remise d\'un fichier au navigateur (lien <a download> temporaire), repli de la feuille de partage de l\'export ; aucun écran dessiné', date: '2026-11-25' },
  { regle: 'couche-dom', fichier: 'js/data/profile-photo.js', raison: 'pphPaint / pphPaintAll posent la photo reçue sur les avatars déjà à l\'écran sans tout redessiner (lecture asynchrone) ; à déplacer dans js/features/profile-photo-ui.js avec un rappel', date: '2026-11-25' },

  // ── Couches : lecture d'une couche plus haute ──
  { regle: 'couche-dependance', fichier: 'js/data/atlas.js', cible: 'bodyKind', raison: 'personnage par défaut de atlasPills, lu dans BODY_IMG (images, js/ui/body-map.js) ; à déplacer avec la liste des personnages', date: '2026-11-25' },
  { regle: 'couche-dependance', fichier: 'js/data/measures.js', cible: 'lastBodyMassKg', raison: 'dernière pesée de Santé, cache de js/features/apple-services.js, lue sous garde typeof (absente dans les tests et l\'appli web)', date: '2026-11-25' },
  { regle: 'couche-dependance', fichier: 'js/core/dialogs.js', cible: 'sessionNotice', raison: 'showToast cède la place à la confirmation en ligne de la séance (js/features/session.js), sous garde typeof : crochet voulu', date: '2026-11-25' },
  { regle: 'couche-dependance', fichier: 'js/core/haptics-audio.js', cible: 'data', raison: 'haptic lit le réglage data.vibrateOn à l\'appel (jamais au chargement) ; un paramètre changerait les ~240 appels', date: '2026-11-25' },

  // ── Appli web du coach : remplaçants voulus de js/data/account.js et age-range.js (docs/COACH_WEB.md, « Réutilisation ») ──
  ...['sb', 'account', 'onAccountChange', 'chatHiddenByAge'].map(cible => ({
    regle: 'desk-reutilise', fichier: 'coach-web/js/desk/env.js', cible,
    raison: 'env.js remplace js/data/account.js et age-range.js, non chargés sur l\'ordinateur (docs/COACH_WEB.md, « Réutilisation de js/data/ »)', date: '2026-11-25',
  })),

  // ── Ordre de chargement ──
  { regle: 'ordre-chargement', page: 'coach-web/index.html', fichier: 'js/data/store.js', cible: 'STRENGTH_SEXES', raison: 'sanitizeData ne le lit que si ppl_v2 contient strengthSex : jamais écrit sur le site du coach (autre origine, rien de gardé), et loadData est sous try (store.js)', date: '2026-11-25' },
];
