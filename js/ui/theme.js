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
  Native.statusBar(!light);
}
// Classe du design sur body (css/theme-sobre.css ; design choisi : currentDesignAccent, js/data/design.js) ; appelée au
// démarrage et à chaque dessin d'écran (js/ui/router.js) : un choix reçu d'un autre appareil s'applique au premier redessin
function applyDesign() {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.classList.toggle('design-bleu', currentDesignAccent() === 'bleu');
}
applyTheme(themePref());
applyDesign();   // Réglages › Apparence › Design (js/data/design.js), avant le premier dessin

// Dynamic Type : au-delà de 1,3 × la taille par défaut (17 px), les séries passent sur 2 lignes
// L'accueil se redessine quand la classe change : Démarrer y passe avant les cibles dans le HTML (heroBtnSpot)
function checkTypeSize() {
  const html = document.documentElement;
  const was = html.classList.contains('type-xl');
  const fs = parseFloat(getComputedStyle(html).fontSize);
  const xl = html.classList.toggle('type-xl', fs > 17 * 1.3);
  html.classList.toggle('type-xxl', fs > 17 * 1.6);   // tailles d'accessibilité les plus grandes (AX33 : 33 px)
  return xl !== was;
}
checkTypeSize();
const onTypeSize = () => { if (checkTypeSize() && currentView() === 'dashboard') render(); };
window.addEventListener('resize', onTypeSize);
document.addEventListener('visibilitychange', onTypeSize);

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
