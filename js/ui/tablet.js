// ═══════════════════════════════════════════════════════════
//  Tablette : classe `tablet` sur <html> pour la mise en page iPad (css/tablet.css, docs/IPAD.md)
//
//  Toute la mise en page tablette est derrière cette classe : un iPhone ne la prend jamais, même l'iPhone Duo ouvert
//  (plus large qu'un iPad mini en paysage), et rien ne change pour lui. La largeur (portrait, paysage, Split View) est
//  ensuite lue par les media queries de css/tablet.css, qui suivent la rotation et le redimensionnement sans script.
//  - iPad : user agent « iPad » (vue web en mode « mobile », MainViewController), ou « Macintosh » avec un écran
//    tactile (iPadOS en mode ordinateur, comme coachDeskEligible de js/data/coach-desk.js) ;
//  - tablette Android : « Android » sans « Mobile » (les téléphones Android le disent tous) ;
//  - jamais un iPhone ni un iPod, jamais un ordinateur sans écran tactile.
// ═══════════════════════════════════════════════════════════
'use strict';

// { ua, touchPoints } → bool (sans DOM : testé par tests/unit/tablet.mjs)
function tabletDevice({ ua = '', touchPoints = 0 } = {}) {
  if (/iPhone|iPod/.test(ua)) return false;
  if (/iPad/.test(ua)) return true;
  if (/Macintosh/.test(ua)) return touchPoints > 1;
  return /Android/.test(ua) && !/Mobile/.test(ua);
}

function applyTabletClass() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  document.documentElement.classList.toggle('tablet', tabletDevice({ ua: nav.userAgent || '', touchPoints: nav.maxTouchPoints || 0 }));
}
applyTabletClass();   // avant le premier dessin (scripts chargés en fin de <body>, avant js/app/init.js)

// Écrans en deux colonnes (css/tablet.css) : un titre de groupe et le bloc qu'il annonce (avec la note de pied qui suit)
// sont posés ensemble dans un .tablet-keep, jamais coupé entre deux colonnes. CSS seul ne suffit pas : WebKit ignore
// break-after: avoid dans les colonnes (vu le 26/11 : « Apparence » seul en bas de la colonne de gauche des Réglages).
// Sur iPad seulement (le HTML d'un iPhone ne change jamais) ; hors deux colonnes, .tablet-keep est display: contents.
const TABLET_COLS = '.view:is(.stats, .settings-view, .programmes) > .scr';
function tabletAfterRender(root = document) {
  if (typeof document === 'undefined' || !document.documentElement.classList.contains('tablet')) return;
  for (const scr of root.querySelectorAll(TABLET_COLS)) {
    for (const title of [...scr.children]) {
      if (!title.matches('.group-title, h2, h3') || !title.nextElementSibling || title.parentElement !== scr) continue;
      const keep = document.createElement('div');
      keep.className = 'tablet-keep';
      const parts = [title, title.nextElementSibling];
      for (let n = parts[1].nextElementSibling; n && n.matches('.group-foot'); n = n.nextElementSibling) parts.push(n);
      title.before(keep);
      keep.append(...parts);
    }
  }
}
