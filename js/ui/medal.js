// ═══════════════════════════════════════════════════════════
//  Médaille de record : icône SVG et tracés partagés
// ═══════════════════════════════════════════════════════════
'use strict';

// Dessinée au trait sur une grille de 24 : ruban, disque, étoile. Les tracés servent à l'icône des écrans
// (medalSvg) et à l'image partagée (share-canvas.js, drawMedal) : Path2D accepte la syntaxe des
// chemins SVG (MDN, « Path2D() constructor »).
const MEDAL_PATHS = {
  ribbon: 'M8 2.75 10.6 9M16 2.75 13.4 9',
  star:   'm12 12.1.9 1.8 2 .3-1.45 1.4.35 2L12 16.65l-1.8.95.35-2-1.45-1.4 2-.3z',
};

function medalSvg(size = 20) {
  // Au trait, comme le reste du jeu d'icônes (sprite d'index.html) ; l'or vient de la couleur du texte (--medal)
  return `<svg class="medal" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="${MEDAL_PATHS.ribbon}"/>
    <circle cx="12" cy="15" r="6"/>
    <path d="${MEDAL_PATHS.star}" stroke-width="1.3"/>
  </svg>`;
}

// Cellule d'un record noté (js/data/records.js) : médaille, exercice, type (et l'ancienne valeur si
// before et si elle est connue : jamais pour la séance d'un ami), nouvelle valeur. Historique › Séance,
// séance d'un ami, séance d'un élève. Textes échappés : le nom d'exercice d'un autre vient du serveur.
function notedRecordCell(r, { before = true } = {}) {
  return `
          <div class="cell review-rec">${medalSvg(22)}
            <span class="cell__body"><span class="cell__title">${esc(r.ex)}</span><span class="cell__sub num">${esc(notedLabel(r))}${before && r.before != null ? ` · avant ${esc(notedValueTxt(r, 'before'))}` : ''}</span></span>
            <span class="review-rec__val num">${esc(notedValueTxt(r))}</span>
          </div>`;
}

// Lignes de records récents (recentRecords, js/data/records.js) : exercice, date et gain à gauche, valeur à
// droite. Progrès › Derniers records (js/features/progress.js) et Mon profil (js/features/social-me-ui.js)
function recordRowsHtml(recs) {
  return recs.map(({ ex, date, r }) => {
    const gain = recordGainTxt(r);
    return `
      <div class="cell rec-row">
        <span class="cell__body"><span class="cell__title">${esc(ex)}</span>
          <span class="cell__sub num">${esc(fmtDate(date))}${gain ? ` · ${icon('arrow.up', 11)}${esc(gain)}<span class="sr-text"> de plus</span>` : ''}</span></span>
        <span class="rec-row__val num">${esc(notedValueTxt(r))}</span>
      </div>`;
  }).join('');
}
