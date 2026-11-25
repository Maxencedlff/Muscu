// ═══════════════════════════════════════════════════════════
//  Visite de l'accueil, logique pure (l'écran est dans js/features/tour.js)
//
//  Demande d'un coach partenaire (25/11) : au premier lancement, l'app s'assombrit et une bulle montre un vrai
//  élément de l'accueil avec une flèche : « si tu appuies là, ça fait ça ». Quatre ou cinq étapes au plus.
//
//  État sur l'appareil seulement (data.tour, SYNC_LOCAL_ONLY de js/data/sync.js) :
//    absent  : rien à montrer (utilisateur d'avant la visite, compte retrouvé sur un nouvel iPhone) ;
//    'due'   : posé à la fin des questions du premier lancement, la visite part à la première arrivée sur l'accueil ;
//    'seen'  : montrée une fois, elle ne revient plus d'elle-même (Réglages › Aide › Revoir la visite).
//  Rien ici ne touche à l'écran : les sélecteurs sont des chaînes, l'écran les cherche et saute une étape
//  dont l'élément n'existe pas (la visite ne bloque jamais l'app).
// ═══════════════════════════════════════════════════════════
'use strict';

const TOUR_STATES = ['due', 'seen'];

// Fin des questions du premier lancement : la visite est à faire, sauf si elle a déjà été vue sur cet appareil
function tourMarkDue(d) {
  if (d.tour !== 'seen') d.tour = 'due';
}
function tourIsDue(d) { return d.tour === 'due'; }

// Étapes, dans l'ordre de l'écran (de haut en bas, puis la barre d'onglets). ctx :
//   live  : une séance est en cours (visite revue) : « Reprendre » à la place de Démarrer, sans les cibles ;
//   beat  : « À battre aujourd'hui » affiché (déjà une séance faite), sinon « Au programme » ;
//   coach : 'student' (élève qui a un coach), 'coach' (compte coach) ou rien. Mots accordés au coach de l'élève
//   (myCoachWord, js/data/coach-form.js : « Ma coach », « ta coach »).
// sel : élément à découper (fixed : dans la barre d'onglets, jamais de défilement) ; title : le libellé visible de cet élément, mot pour mot (un mot = un sens).
function tourSteps(ctx = {}) {
  const steps = [
    ctx.live
      ? { id: 'start', sel: '.hero [data-action="resume-session"]', title: 'Reprendre',
        text: 'Rouvre ta séance en cours. Touche le rond à droite d\'une série pour la noter.' }
      : { id: 'start', sel: '.hero [data-action="start-session"]', title: 'Démarrer',
        text: 'Lance la séance du jour. En séance, touche le rond à droite d\'une série pour la noter.' },
    ctx.beat
      ? { id: 'targets', sel: '.hero .targets', title: 'À battre aujourd\'hui',
        text: 'Ta dernière performance sur chaque exercice. Fais un peu mieux : une rep ou un peu plus de charge.' }
      : { id: 'targets', sel: '.hero .targets', title: 'Au programme',
        text: 'Les exercices du jour. Après ta première séance, tu verras ici ce qu\'il faut battre.' },
    { id: 'program', fixed: true, sel: '.tabbar [data-tab="program"]', title: 'Programme',
      text: 'Tes séances et leurs exercices. Tu peux tout modifier ou changer de programme.' },
    { id: 'progress', fixed: true, sel: '.tabbar [data-tab="progress"]', title: 'Progrès',
      text: 'Tes records et le personnage qui montre les muscles travaillés cette semaine.' },
  ];
  if (ctx.coach === 'student') {
    steps.push({ id: 'coach', fixed: true, sel: '.tabbar [data-tab="friends"]', title: 'Social',
      text: `Touche «\u00a0${myCoachWord('Mon')}\u00a0» en haut de Social : messages et programmes de ${myCoachWord('ton')}.` });
  } else if (ctx.coach === 'coach') {
    steps.push({ id: 'coach', fixed: true, sel: '.tabbar [data-tab="friends"]', title: 'Coach',
      text: 'Tes élèves : leurs séances, leurs progrès et leurs messages.' });
  }
  return steps;
}

// « Étape 2 sur 5 » : affiché et lu par VoiceOver avec le titre de la bulle
function tourCountLabel(i, n) { return `Étape ${i + 1} sur ${n}`; }

// Place de la bulle face à l'élément découpé (rectangles en px de la fenêtre, comme getBoundingClientRect).
//   target : { top, left, width, height } de l'élément ; view : { width, height, top, bottom } (marges sûres en haut
//   et en bas : barre d'état, barre d'accueil) ; bubble : { width, height } mesurés ; pad : marge du découpage ;
//   stops : bas des lignes de l'élément (une liste), pour rogner le trou entre deux lignes plutôt qu'au milieu d'un nom.
// Renvoie le trou (élément agrandi de pad, rogné à la fenêtre ; rogné aussi en hauteur pour laisser la place à la
// bulle quand l'élément est très haut), le côté de la bulle ('below' ou 'above'), sa position, et l'abscisse de la
// flèche dans la bulle (toujours face à l'élément, jamais sur un coin arrondi) ; maxHeight : hauteur plafonnée de la
// bulle quand elle ne tient pas entière (null sinon).
const TOUR_GAP = 12;      // entre le trou et la pointe de la flèche
const TOUR_ARROW = 10;    // hauteur de la flèche
const TOUR_EDGE = 12;     // marge de la bulle aux bords de l'écran
function tourPlace(target, view, bubble, pad = 6, stops = []) {
  const vTop = view.top || 0, vBottom = view.height - (view.bottom || 0);
  const need = TOUR_GAP + TOUR_ARROW + bubble.height;
  let hole = {
    top: Math.max(vTop, target.top - pad),
    left: Math.max(0, target.left - pad),
    right: Math.min(view.width, target.left + target.width + pad),
    bottom: Math.min(vBottom, target.top + target.height + pad),
  };
  const roomBelow = vBottom - hole.bottom, roomAbove = hole.top - vTop;
  let side;
  if (roomBelow >= need) side = 'below';
  else if (roomAbove >= need) side = 'above';
  else if (hole.bottom - hole.top > (vBottom - vTop) * 0.4) {
    // Ni dessus ni dessous, élément très haut (liste) : le trou est rogné par le bas, entre deux lignes, pour laisser
    // à la bulle au moins 55 % de l'écran (texte agrandi : elle défile au-delà)
    side = 'below';
    const room = TOUR_GAP + TOUR_ARROW + Math.min(bubble.height, (vBottom - vTop) * 0.55);
    const max = Math.max(hole.top + Math.min(44, target.height), vBottom - room);
    // Dernière ligne entière qui tient ; aucune : rogné à la place de la bulle, qui reste entière (texte agrandi)
    const stop = stops.filter(y => y + pad <= max && y > hole.top + 30).sort((a, b) => b - a)[0];
    hole.bottom = stop !== undefined ? stop + pad : max;
  } else {
    // Petit élément mais bulle trop haute (texte agrandi) : du côté le plus grand, la bulle défile, l'élément reste entier
    side = roomBelow >= roomAbove ? 'below' : 'above';
  }
  hole = { ...hole, width: Math.max(0, hole.right - hole.left), height: Math.max(0, hole.bottom - hole.top) };
  // Hauteur laissée à la bulle de ce côté : au-delà, son contenu défile (Passer et Suivant restent collés en bas)
  const room = (side === 'below' ? vBottom - hole.bottom : hole.top - vTop) - TOUR_GAP - TOUR_ARROW;
  const maxHeight = bubble.height > room ? Math.max(0, Math.floor(room)) : null;
  const height = maxHeight === null ? bubble.height : maxHeight;
  const width = Math.min(bubble.width, view.width - 2 * TOUR_EDGE);
  const center = (hole.left + hole.right) / 2;
  const left = Math.round(Math.min(Math.max(TOUR_EDGE, center - width / 2), view.width - TOUR_EDGE - width));
  const top = Math.round(side === 'below'
    ? Math.min(hole.bottom + TOUR_GAP + TOUR_ARROW, vBottom - height)
    : Math.max(vTop, hole.top - TOUR_GAP - TOUR_ARROW - height));
  const corner = 22;   // flèche hors des coins arrondis de la bulle
  const arrowX = Math.round(Math.min(Math.max(corner, center - left), width - corner));
  return { hole, side, top, left, width, arrowX, maxHeight };
}

// Défilement qui amène l'élément dans l'écran avant de le découper : renvoie le défilement voulu (scrollY), ou
// null s'il n'y a rien à faire (élément fixe, ou déjà visible avec la place de la bulle). Élément en haut de la zone
// utile (sous la barre de navigation : view.top), pour laisser la bulle dessous.
function tourScrollTarget(target, view, bubbleHeight, scrollY, maxScroll) {
  const vTop = view.top || 0, vBottom = view.height - (view.bottom || 0);
  const need = TOUR_GAP + TOUR_ARROW + bubbleHeight;
  const fitsBelow = target.top >= vTop && target.top + target.height + need <= vBottom;
  const fitsAbove = target.top - need >= vTop && target.top + target.height <= vBottom;
  if (fitsBelow || fitsAbove) return null;
  const want = Math.max(0, Math.min(maxScroll, Math.round(scrollY + target.top - vTop - 8)));
  return want === Math.round(scrollY) ? null : want;
}
