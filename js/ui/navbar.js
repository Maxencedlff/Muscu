// ═══════════════════════════════════════════════════════════
//  Tab bar, mini-barre de séance et barre de navigation
// ═══════════════════════════════════════════════════════════
'use strict';

function ensureChrome() {
  if ($('.tabbar')) return;
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Sections');
  bar.innerHTML = Object.entries(TABS).map(([t, v]) => `
    <button class="tabbar__btn" role="tab" data-action="${v.action}" data-tab="${t}" aria-selected="false">
      ${icon(v.icon, 25)}<span class="tabbar__label">${v.label}</span>
    </button>`).join('');
  const live = document.createElement('button');
  live.className = 'livebar';
  live.dataset.action = 'resume-session';
  live.hidden = true;
  document.body.append(live, bar);
}

function sessionCounts(sess = activeSession) {
  const total = sess.exercises.reduce((a, ex) => a + ex.sets.length, 0);
  const done  = sess.exercises.reduce((a, ex) => a + ex.sets.filter(st => st.done).length, 0);
  return { total, done };
}

function updateChrome() {
  ensureChrome();
  const route = currentRoute();
  const inSession = route === 'session' && !!activeSession;
  // Séance et bilan en plein écran, sans tab bar
  const full = inSession || route === 'summary';
  const bar = $('.tabbar');
  bar.hidden = full;
  bar.querySelectorAll('.tabbar__btn').forEach(b => {
    const on = b.dataset.tab === nav.tab;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.classList.toggle('tabbar__btn--active', on);
  });
  const live = $('.livebar');
  const showLive = !!activeSession && !inSession;
  live.hidden = !showLive;
  document.body.classList.toggle('has-tabbar', !full);
  document.body.classList.toggle('has-livebar', showLive);
  if (showLive) {
    const lm = sessionMeta(activeSession.category, activeSession.programme);
    const { total, done } = sessionCounts();
    live.style.setProperty('--cat-color', lm.color);
    live.setAttribute('aria-label', `Séance ${rawLabel(activeSession.category, activeSession.programme)} en cours, ${done} séries sur ${total}. Ouvrir la séance`);
    live.innerHTML = `
      <span class="livebar__dot" aria-hidden="true"></span>
      <span class="livebar__title">${lm.label} · <span class="num">${done}/${total}</span></span>
      <span class="livebar__time num" id="livebar-elapsed">${fmtClock(Date.now() - activeSession.startedAt)}</span>
      <span class="livebar__rest num" id="livebar-rest" ${restActive ? '' : 'hidden'}>${fmtRest(restTimeLeft)}</span>
      <span class="livebar__chev" aria-hidden="true">${icon('chevron.right', 16)}</span>`;
  }
}

// ── Barre de navigation ──
// title : titre ; large : grand titre (racine d'onglet) ; back : libellé du retour (auto) ;
// left / right : HTML des actions ; sub : ligne sous le grand titre
function navBar({ title = '', large, back, left = '', right = '', sub = '', extra = '' } = {}) {
  const s = nav.stacks[nav.tab];
  const isRoot = s.length < 2;
  if (large === undefined) large = isRoot;
  if (back === undefined && !isRoot && !left) back = routeTitle(s[s.length - 2], s.length - 2 === 0);
  const backBtn = back ? `
    <button class="navbar__back" data-action="back" aria-label="Retour : ${esc(back)}">
      ${icon('chevron.left', 22)}<span class="navbar__back-label">${esc(back)}</span>
    </button>` : left;
  return `
    <header class="navbar ${large ? 'navbar--large' : 'navbar--compact'}">
      <div class="navbar__bar">
        <div class="navbar__side navbar__side--left">${backBtn}</div>
        <div class="navbar__title" ${large ? 'aria-hidden="true"' : ''}>${title}</div>
        <div class="navbar__side navbar__side--right">${right}</div>
      </div>
      ${extra}
    </header>
    ${large ? `<div class="navbar__largewrap"><h1 class="t-large navbar__large">${title}</h1>${sub}</div>` : ''}`;
}

// Libellé du bouton retour vers une route de la pile
function routeTitle(route, isRoot) {
  if (isRoot && TAB_OF_ROOT[route]) return TABS[TAB_OF_ROOT[route]].label;
  const name = routeName(route);
  if (name === 'editor') { const cat = editorCatOf(route); return cat ? rawLabel(cat) : 'Séance'; }
  return {
    dashboard: 'Entraînement', history: 'Historique', stats: 'Progrès',
    programmes: 'Programme', settings: 'Réglages', session: 'Séance', summary: 'Bilan',
    'history-detail': 'Séance', 'stats-ex': 'Exercice', 'stats-overview': 'Vue d\'ensemble',
    'prog-picker': 'Programme actif', 'ex-edit': 'Exercice', 'cs-edit': 'Séance perso',
    'add-session': editSessionId ? 'Modifier la séance' : 'Séance passée',
  }[name] || 'Retour';
}

// Grand titre : quand il sort de l'écran, le titre compact et le filet apparaissent
let largeObserver = null;
function observeLargeTitle() {
  largeObserver?.disconnect();
  const h1 = $('.navbar__large');
  const bar = $('.navbar');
  if (!h1 || !bar || !('IntersectionObserver' in window)) return;
  const top = bar.getBoundingClientRect().height;
  largeObserver = new IntersectionObserver(([en]) => {
    bar.classList.toggle('navbar--collapsed', !en.isIntersecting);
  }, { rootMargin: `-${Math.round(top)}px 0px 0px 0px`, threshold: 0 });
  largeObserver.observe(h1);
}
