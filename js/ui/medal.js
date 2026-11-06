// ═══════════════════════════════════════════════════════════
//  Médaille de record : icône SVG et tracés partagés
// ═══════════════════════════════════════════════════════════
'use strict';

// Dessinée sur une grille de 24 : ruban, disque, étoile. Les tracés servent à l'icône des écrans
// (medalSvg) et à l'image partagée (share-canvas.js, drawMedal) : Path2D accepte la syntaxe des
// chemins SVG (MDN, « Path2D() constructor »).
const MEDAL_PATHS = {
  ribbon: 'M7.5 2h3l1.5 4.5L13.5 2h3l-2.6 7.2A6 6 0 1 1 10.1 9.2z',
  star:   'M12 11.8l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z',
};

function medalSvg(size = 20) {
  return `<svg class="medal" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="${MEDAL_PATHS.ribbon}" fill="currentColor" opacity=".55"/>
    <circle cx="12" cy="15" r="6" fill="currentColor"/>
    <path d="${MEDAL_PATHS.star}" fill="var(--cell, #1c1c1e)"/>
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
