// ═══════════════════════════════════════════════════════════
//  Navigation : onglets, piles, historique du navigateur, rendu
// ═══════════════════════════════════════════════════════════
'use strict';

let view = 'dashboard';
let renderedView = null;   // dernier écran dessiné par paint()

// Racine de chaque onglet : les fonctions renderXxx gardent leur nom de vue historique
const TABS = {
  train:    { root: 'dashboard', label: 'Entraînement', icon: 'dumbbell',      action: 'go-home' },
  history:  { root: 'history',   label: 'Historique',   icon: 'clock.history', action: 'go-history' },
  progress: { root: 'stats',     label: 'Progrès',      icon: 'chart',         action: 'go-stats' },
  program:  { root: 'programmes', label: 'Programme',    icon: 'list.bullet',   action: 'go-program' },
};
const TAB_OF_ROOT = Object.fromEntries(Object.entries(TABS).map(([t, v]) => [v.root, t]));

let nav = { tab: 'train', stacks: { train: ['dashboard'], history: ['history'], progress: ['stats'], program: ['programmes'] } };
let navIndex   = 0;     // position dans l'historique du navigateur
let navHist    = [];    // copie des états poussés, pour savoir si history.back() mène au bon écran
let navDup     = [];    // entrées poussées à l'ouverture d'une feuille (même écran que la précédente)
let ignorePop  = 0;     // popstate provoqués par l'app elle-même
let shownKey   = null;  // clé du dernier écran affiché par show()
let skipTransition = false;
const scrollMem = {};   // défilement par écran (clé = onglet + pile)
const snapMem   = {};   // dernier rendu de chaque écran, montré sous le geste de retour
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// Le défilement de chaque écran est géré par l'app, pas par le navigateur
try { history.scrollRestoration = 'manual'; } catch {}
// Navigateur piloté par les tests : pas de transitions, sauf demande explicite (window.__pplTransitions)
const transitionsOff = () => navigator.webdriver && !window.__pplTransitions;

function currentRoute(n = nav) { const s = n.stacks[n.tab]; return s[s.length - 1]; }
function navKey(n = nav) { return n.tab + '/' + n.stacks[n.tab].join('/'); }
function navClone(n) { return { tab: n.tab, stacks: Object.fromEntries(Object.entries(n.stacks).map(([k, v]) => [k, v.slice()])) }; }
function navSame(a, b) { return !!a && !!b && JSON.stringify(a) === JSON.stringify(b); }
// Transitions : la séance monte depuis le bas et redescend, les autres écrans glissent
function pushDir(route) { return route === 'session' ? 'up' : 'push'; }
function popDir(n = nav) { return currentRoute(n) === 'session' ? 'down' : 'pop'; }
function navHash(n) { const s = n.stacks[n.tab]; return '#' + n.tab + (s.length > 1 ? '/' + s.slice(1).join('/') : ''); }

// Retire les écrans qui n'ont plus de sens (séance terminée entre-temps)
function navSanitize(n) {
  const out = navClone(n);
  if (!TABS[out.tab]) out.tab = 'train';
  for (const t of Object.keys(TABS)) {
    let s = Array.isArray(out.stacks[t]) ? out.stacks[t] : [];
    s = s.filter((r, i) => i === 0 || (r !== TABS[t].root && (r !== 'session' || activeSession)
      && (r !== 'summary' || (t === 'train' && lastSummary))));
    if (s[0] !== TABS[t].root) s.unshift(TABS[t].root);
    out.stacks[t] = s;
  }
  return out;
}

function navWrite(mode) {
  const st = { idx: navIndex, nav: navClone(nav) };
  try {
    if (mode === 'push') history.pushState(st, '', navHash(nav));
    else history.replaceState(st, '', navHash(nav));
  } catch {}
  navHist[navIndex] = navClone(nav);
  navDup[navIndex] = false;
  if (mode === 'push') navDup.length = navIndex + 1;
}

// Feuille ou dialogue ouvert : une entrée d'historique en plus, que le retour système consomme
// pour fermer la feuille au lieu de quitter l'écran (ou l'app, à la racine d'un onglet)
const OPEN_MODAL_SEL = '.ios-dialog:not(.ios-dialog--out), .sheet-root:not(.sheet-root--out), .sess-sheet:not(.sess-sheet--out)';
new MutationObserver(() => {
  if (navDup[navIndex] || !document.querySelector(OPEN_MODAL_SEL)) return;
  navIndex++;
  navHist.length = navIndex;
  navHist[navIndex] = navClone(nav);
  try { history.pushState({ idx: navIndex, nav: navClone(nav), modal: true }, '', navHash(nav)); } catch {}
  navDup.length = navIndex;
  navDup[navIndex] = true;
}).observe(document.body, { childList: true });

// Bilan d'une séance terminée : toujours dans l'onglet Entraînement (#train/summary), à la place de la séance
function openSummary() {
  const next = navClone(nav);
  next.tab = 'train';
  next.stacks.train = ['dashboard', 'summary'];
  navCommit(next, 'push', 'replace');
}

// Change d'état de navigation. mode : 'push' (nouvelle entrée), 'replace', 'back' (retour d'un cran)
function navCommit(next, dir, mode = 'push') {
  saveScroll();
  next = navSanitize(next);
  // Entrée d'une feuille fermée : le nouvel écran la remplace, et le retour la saute
  if (mode === 'push' && navDup[navIndex]) mode = 'replace';
  const k = navIndex - (navDup[navIndex] ? 2 : 1);
  if (mode === 'back' && k >= 0 && navSame(navHist[k], next)) {
    // Le retour système et le bouton retour restent synchronisés : on recule vraiment dans l'historique
    ignorePop++;
    const d = k - navIndex;
    navIndex = k;
    nav = next;
    history.go(d);
  } else if (mode === 'push') {
    navIndex++;
    navHist.length = navIndex;
    nav = next;
    navWrite('push');
  } else {
    nav = next;
    navWrite('replace');
  }
  show(dir);
}

function navigate(route, { replace = false } = {}) {
  const next = navClone(nav);
  const s = next.stacks[next.tab];
  if (replace) s[s.length - 1] = route; else s.push(route);
  navCommit(next, pushDir(route), replace ? 'replace' : 'push');
}

function goBack() {
  const s = nav.stacks[nav.tab];
  if (s.length < 2) return;
  const next = navClone(nav);
  next.stacks[next.tab].pop();
  navCommit(next, popDir(), 'back');
}

// Revient à un écran déjà dans la pile, sinon à la racine d'un onglet, sinon empile
function routeTo(route) {
  const s = nav.stacks[nav.tab];
  const i = s.lastIndexOf(route);
  if (i >= 0) {
    if (i === s.length - 1) { show('none'); return; }
    const next = navClone(nav);
    next.stacks[next.tab] = s.slice(0, i + 1);
    navCommit(next, popDir(), i === s.length - 2 ? 'back' : 'replace');
    return;
  }
  const tab = TAB_OF_ROOT[route];
  if (tab) { switchTab(tab, { reset: true, mode: nav.stacks[nav.tab].includes('session') ? 'replace' : 'push' }); return; }
  navigate(route);
}

function switchTab(tab, { reset = false, mode = 'push' } = {}) {
  const next = navClone(nav);
  if (tab === nav.tab) {
    // Toucher l'onglet actif : retour à la racine, puis en haut de page
    if (next.stacks[tab].length > 1) {
      next.stacks[tab] = [TABS[tab].root];
      navCommit(next, 'pop', 'replace');
    }
    window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    return;
  }
  next.tab = tab;
  if (reset) next.stacks[tab] = [TABS[tab].root];
  navCommit(next, 'fade', mode);
}

window.addEventListener('popstate', e => {
  if (ignorePop > 0) { ignorePop--; return; }
  const st = e.state;
  if (!st || !st.nav) return;
  const fromDup  = !!navDup[navIndex];
  const hadModal = !!document.querySelector(OPEN_MODAL_SEL);
  const backward = (st.idx || 0) < navIndex;
  saveScroll();
  const prev = nav;
  nav = navSanitize(st.nav);
  navIndex = st.idx || 0;
  navHist[navIndex] = navClone(nav);
  navDup[navIndex] = !!st.modal;
  // Écran devenu invalide (séance terminée) : on corrige l'entrée courante
  if (!navSame(nav, st.nav)) navWrite('replace');
  if (navSame(prev, nav)) {
    // Même écran : ce retour ferme la feuille ouverte ; si elle était déjà fermée, on recule encore
    closeTransientUI();
    if (backward && fromDup && !hadModal) history.back();
    return;
  }
  const dir = prev.tab !== nav.tab ? 'fade'
    : nav.stacks[nav.tab].length < prev.stacks[prev.tab].length ? popDir(prev)
    : nav.stacks[nav.tab].length > prev.stacks[prev.tab].length ? pushDir(currentRoute()) : 'none';
  closeTransientUI();
  show(dir);
});

// Une feuille ou un dialogue ouvert ne doit pas survivre à un changement d'écran
function closeTransientUI() {
  document.querySelectorAll('.sheet-root').forEach(el => el._close?.(null));
  document.querySelectorAll('.sess-sheet').forEach(el => el._close?.());
  document.querySelectorAll('.ios-dialog').forEach(el => el._close?.());
}

function saveScroll() { scrollMem[navKey()] = window.scrollY; }

// ── Rendu ───────────────────────────────────────────────────

// render() garde son rôle historique : réafficher l'écran courant en gardant le défilement.
// Si du code a changé `view` directement, on traduit ce changement en navigation.
function render() {
  if (view !== currentRoute()) { routeTo(view); return; }
  paint();
}

// Gabarit de chaque écran (route inconnue : l'accueil). Les fonctions de rendu sont définies
// par les fichiers chargés après celui-ci : elles ne sont résolues qu'à l'appel.
const SCREENS = new Map([
  ['dashboard',      () => renderDashboard()],
  ['programmes',     () => renderProgrammes()],
  ['session',        () => activeSession ? renderSession() : renderDashboard()],
  ['editor',         () => renderEditor()],
  ['history',        () => renderHistory()],
  ['stats',          () => renderStats()],
  ['settings',       () => renderSettings()],
  ['add-session',    () => renderAddSession()],
  ['summary',        () => renderSummary()],          // Entraînement › Bilan
  ['history-detail', () => renderHistoryDetail()],
  ['stats-ex',       () => renderStatsExercise()],
  ['stats-overview', () => renderStatsOverview()],
  ['prog-picker',    () => renderProgPicker()],
  ['ex-edit',        () => renderExEdit()],
  ['cs-edit',        () => renderCsEdit()],
]);

function paint(scrollY = window.scrollY) {
  view = currentRoute();
  $('#app').innerHTML = (SCREENS.get(view) || SCREENS.get('dashboard'))();
  if (view === 'stats-ex') drawCharts();
  if (view === 'settings') fillAppVersion();
  updateChrome();
  observeLargeTitle();
  window.scrollTo(0, scrollY);
  // Entrée dans la séance : centre la série courante
  if (view === 'session' && activeSession) afterSessionRender(renderedView !== 'session');
  renderedView = view;
}

// Affiche l'écran courant après un changement de navigation, avec la transition qui va avec
function show(dir = 'none') {
  if (shownKey && dir === 'push') snapMem[shownKey] = $('#app').innerHTML;
  const key = navKey();
  shownKey = key;
  const target = (dir === 'pop' || dir === 'down' || dir === 'fade') ? (scrollMem[key] || 0) : 0;
  const route = currentRoute();

  if (route === 'add-session' && (dir === 'push' || dir === 'up')) addSnapshot = addState();
  if (route !== 'add-session') { addSnapshot = null; try { sessionStorage.removeItem(ADD_DRAFT_KEY); } catch {} }
  if (route === 'session') requestWakeLock(); else releaseWakeLock();

  const update = () => { paint(target); startTicker(); };
  const animate = dir !== 'none' && !skipTransition && !transitionsOff() && !reduceMotion.matches && typeof document.startViewTransition === 'function' && !document.hidden;
  if (!animate) { update(); return; }
  document.documentElement.dataset.navDir = dir;
  try {
    const vt = document.startViewTransition(update);
    vt.finished.finally(() => { delete document.documentElement.dataset.navDir; });
  } catch { update(); }
}

// Démarrage : #train, ou #train/session (avec l'accueil dessous) si une séance est restaurée
function navBoot(sessionRestored) {
  navIndex = 0; navHist = []; navDup = [];
  navWrite('replace');
  let draft = false;
  if (sessionRestored) {
    nav.stacks.train.push('session');
  } else if (restoreAddDraft()) {
    draft = true;
    nav.tab = 'history';
    navWrite('replace');
    nav.stacks.history.push('add-session');
  }
  if (nav.stacks[nav.tab].length > 1) { navIndex = 1; navWrite('push'); }
  show('none');
  if (draft) addSnapshot = '';  // brouillon repris : toute sortie demande confirmation
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  // Retour : la séance reste en cours, joignable par la mini-barre
  'back': () => {
    exDraft = null; // brouillon de Programme › Exercice abandonné
    goBack();
  },
  // Onglets (tab bar) et écrans empilés dans l'onglet courant
  'go-home': () => {
    switchTab('train');
  },
});
