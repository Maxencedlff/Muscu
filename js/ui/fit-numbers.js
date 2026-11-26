// ═══════════════════════════════════════════════════════════
//  Chiffres en gros des tuiles (bilan de l'historique, séance d'un ami, Mon profil, vue d'ensemble) : réduits juste
//  ce qu'il faut pour tenir entiers dans leur case, jamais coupés par « … »
//
//  Depuis le 26/11 le volume s'écrit en kg entiers (« 10 888 kg », plus « 10,9 t » qu'une débutante ne lisait pas,
//  js/data/accessors.js fmtVolume) : dans une case d'un quart d'écran, il dépassait. La taille revient à celle du
//  thème à chaque dessin, puis descend au plus à FIT_NUM_MIN de sa taille ; texte agrandi : les cases sont sur une
//  ligne chacune (CSS), rien à réduire. Aucun effet au toucher : seulement après le dessin et au redimensionnement.
// ═══════════════════════════════════════════════════════════
'use strict';

// Cases connues, plus tout chiffre (.num) qui finit par un volume (« 5 515 kg ») : relevé du coach, listes du Social
const FIT_NUM_SEL = '.tile__val, .feed-card__stat-val, .last__fact-val, .num';
const FIT_NUM_VOL = /\d[\s\u00a0\u202f]?(?:kg|lbs)$/;
const FIT_NUM_MIN = 0.6;

function fitNumbersNow(scope = document) {
  scope.querySelectorAll(FIT_NUM_SEL).forEach(el => {
    if (el.matches('.num') && !el.matches('.tile__val, .feed-card__stat-val, .last__fact-val') && !FIT_NUM_VOL.test(el.textContent.trim())) return;
    if (el.style.fontSize) el.style.fontSize = '';
    if (!el.getClientRects().length || el.scrollWidth <= el.clientWidth + 1) return;
    const size = parseFloat(getComputedStyle(el).fontSize);
    const k = Math.max(FIT_NUM_MIN, (el.clientWidth - 1) / el.scrollWidth);
    el.style.fontSize = `${Math.floor(size * k * 10) / 10}px`;
  });
}
// Une seule passe, au dessin (après la typographie, router.js) : une seconde passe à l'image suivante changeait le style
// après coup, et un écran déjà affiché ne doit plus bouger sans geste (test « rien au pointerdown »). Polices chargées
// ou écran redimensionné : nouvelle passe
function fitNumbers(scope = document) {
  fitNumbersNow(scope);
}
window.addEventListener('resize', () => fitNumbers());
document.fonts?.ready.then(() => fitNumbers());
