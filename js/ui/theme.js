// ═══════════════════════════════════════════════════════════
//  Thème clair / sombre et Dynamic Type
// ═══════════════════════════════════════════════════════════
'use strict';

const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

function themePref() {
  try { return localStorage.getItem('ppl_theme') || 'auto'; } catch { return 'auto'; }
}

function applyTheme(theme) {
  try { localStorage.setItem('ppl_theme', theme); } catch {}
  const light = theme === 'light' || (theme === 'auto' && !darkMQ.matches);
  document.body.classList.toggle('light', light);
  const meta = document.querySelector('meta[name="theme-color"]');
  // Couleur de la barre du navigateur = fond de l'app (token --bg du thème appliqué)
  if (meta) meta.content = getComputedStyle(document.body).getPropertyValue('--bg').trim() || meta.content;
  const bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (bar) bar.content = light ? 'default' : 'black-translucent';
}
applyTheme(themePref());

// Dynamic Type : au-delà de 1,3 × la taille par défaut (17 px), les séries passent sur 2 lignes
function checkTypeSize() {
  const html = document.documentElement;
  html.classList.toggle('type-xl', parseFloat(getComputedStyle(html).fontSize) > 17 * 1.3);
}
checkTypeSize();
window.addEventListener('resize', checkTypeSize);
document.addEventListener('visibilitychange', checkTypeSize);

// Mode Auto : pas de bascule de thème en pleine séance, on attend la fin de la séance
let themePending = false;
darkMQ.addEventListener?.('change', () => {
  if (themePref() !== 'auto') return;
  if (activeSession) { themePending = true; return; }
  applyTheme('auto'); if (currentView() === 'stats') render();
});
function applyPendingTheme() { if (themePending) { themePending = false; applyTheme(themePref()); } }

// Choix du thème dans les Réglages : iOS ne relit la couleur de la barre d'état qu'au lancement
function setThemePref(theme) {
  const bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  const before = bar?.content;
  applyTheme(theme);
  let told = false;
  try { told = localStorage.getItem('ppl_statusbar_hint') === '1'; } catch {}
  if (bar && bar.content !== before && !told) {
    try { localStorage.setItem('ppl_statusbar_hint', '1'); } catch {}
    showToast('La barre d\'état s\'adaptera au prochain lancement', { duration: 3500 });
  }
}
