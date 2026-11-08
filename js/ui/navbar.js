// ═══════════════════════════════════════════════════════════
//  Tab bar, mini-barre de séance et barre de navigation
// ═══════════════════════════════════════════════════════════
'use strict';

// Libellé et icône d'un onglet : ceux de TABS, sauf le 5e, « Social » ou « Coach » pour un compte coach
// (friendsTabMeta, js/features/social-ui.js ; docs/SOCIAL_V2.md)
function tabMeta(t) {
  return t === 'friends' && typeof friendsTabMeta === 'function' ? { ...TABS[t], ...friendsTabMeta() } : TABS[t];
}
function tabBtnInner(t) { const v = tabMeta(t); return `${icon(v.icon, 25)}<span class="tabbar__label">${v.label}</span>`; }
// Rôle connu ou changé (coach validé, déconnexion) : le 5e onglet suit, son badge est remis par updateTabBadge
function syncTabMeta() {
  const btn = $('.tabbar [data-tab="friends"]');
  if (!btn || btn.dataset.label === tabMeta('friends').label) return;
  const badge = btn.querySelector('.tabbar__badge');
  btn.innerHTML = tabBtnInner('friends');
  btn.dataset.label = tabMeta('friends').label;
  if (badge) btn.append(badge);
}

function ensureChrome() {
  if ($('.tabbar')) return;
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Sections');
  bar.innerHTML = Object.entries(TABS).map(([t, v]) => `
    <button class="tabbar__btn" role="tab" data-action="${v.action}" data-tab="${t}" data-label="${tabMeta(t).label}" aria-selected="false">
      ${tabBtnInner(t)}
    </button>`).join('');
  const live = document.createElement('button');
  live.className = 'livebar';
  live.dataset.action = 'resume-session';
  live.hidden = true;
  document.body.append(live, bar);
}

// Badge de l'onglet Social (ou Coach) : demandes reçues en attente et nouveautés de l'activité (socialBadge,
// js/data/social.js : réactions à mes séances, demandes acceptées), annoncé par VoiceOver avec le nom de l'onglet
function updateTabBadge() {
  syncTabMeta();
  const btn = $('.tabbar [data-tab="friends"]');
  if (!btn) return;
  // Demandes reçues (Social) + nouveautés du coach (js/data/coach.js : nouvelles séances, programmes, commentaires)
  // + messages non lus (js/data/coach-chat.js)
  const social = socialBadge(), fromCoach = coachBadge() + chatUnreadTotal(), n = social + fromCoach;
  let badge = btn.querySelector('.tabbar__badge');
  if (!n) { badge?.remove(); btn.removeAttribute('aria-label'); return; }
  if (!badge) { badge = document.createElement('span'); badge.className = 'tabbar__badge num'; badge.setAttribute('aria-hidden', 'true'); btn.append(badge); }
  badge.textContent = n > 99 ? '99+' : String(n);
  btn.setAttribute('aria-label', `${tabMeta('friends').label}, ${fromCoach || socialActivityNew() ? plural(n, 'nouveauté', 'nouveautés') : plural(n, 'demande', 'demandes')}`);
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
  // Séance, bilan et récap (story) en plein écran, sans tab bar
  const full = inSession || route === 'summary' || routeName(route) === 'recap';
  const bar = $('.tabbar');
  bar.hidden = full;
  bar.querySelectorAll('.tabbar__btn').forEach(b => {
    const on = b.dataset.tab === nav.tab;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.classList.toggle('tabbar__btn--active', on);
  });
  updateTabBadge();
  const live = $('.livebar');
  const showLive = !!activeSession && !inSession;
  live.hidden = !showLive;
  document.body.classList.toggle('has-tabbar', !full);
  document.body.classList.toggle('has-livebar', showLive);
  if (showLive) {
    const lm = sessionMeta(activeSession.category, activeSession.programme);
    const { total, done } = sessionCounts();
    live.style.setProperty('--cat-color', lm.color);
    live.setAttribute('aria-label', `Séance ${rawLabel(activeSession.category, activeSession.programme)} en cours, ${done} sur ${plural(total, 'série', 'séries')} faites. Ouvrir la séance`);
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
// left / right : HTML des actions ; sub : ligne sous le grand titre ;
// largeTitle : contenu du grand titre s'il diffère du titre compact (accueil : la date)
function navBar({ title = '', large, back, left = '', right = '', sub = '', extra = '', largeTitle = title } = {}) {
  const s = nav.stacks[nav.tab];
  const isRoot = s.length < 2;
  if (large === undefined) large = isRoot;
  if (back === undefined && !isRoot && !left) back = routeTitle(s[s.length - 2], s.length - 2 === 0);
  const backBtn = back ? `
    <button class="navbar__back" data-action="back" aria-label="Retour : ${esc(back)}">
      ${icon('chevron.left', 22)}<span class="navbar__back-label" data-full="${esc(back)}">${esc(back)}</span>
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
    ${large ? `<div class="navbar__largewrap"><h1 class="t-large navbar__large">${largeTitle}</h1>${sub}</div>` : ''}`;
}

// Bouton retour : une seule règle partout (barres de l'app, parcours de connexion js/features/auth-flow.js),
// celle de la barre de navigation d'iOS. Titre de l'écran précédent s'il tient en entier ET laisse au
// moins BACK_LABEL_GAP pt avant le titre centré ; sinon « Retour » ; sinon chevron seul (iPhone SE étroit).
// L'aria-label du bouton garde le nom de l'écran. Barre sans titre (connexion) : le libellé reste.
// Comme iOS, le titre quitte le centre de la barre (centré entre le retour et les boutons de droite, classe
// navbar__bar--wide-back) plutôt que de raccourcir le retour, s'il tient ainsi en entier : sur un iPhone 13,
// « ‹ Entraînement » au-dessus de « Réglages » devenait « ‹ Retour » alors que la droite était vide (panel Apple du
// 08/11). Écart minimal : 8 pt.
// Mesure refaite après la mise en page (image suivante), au changement de taille et une fois les
// polices chargées : une mesure prise trop tôt (boîtes vides) donnait le chevron seul à tort.
const BACK_LABEL_GAP = 8;
const BACK_FALLBACK = 'Retour';
function backLabelFits(btn, label) {
  if (label.scrollWidth > label.clientWidth + 1) return false;
  const title = btn.closest('.navbar__bar, .auth__bar')?.querySelector('.navbar__title');
  if (!title?.textContent.trim()) return true;
  if (title.scrollWidth > title.clientWidth + 1) return false;   // titre coupé : le retour prend trop de place
  // Bord gauche du texte du titre (pas de sa boîte) ; bord droit du libellé en entier
  const range = document.createRange();
  range.selectNodeContents(title);
  return range.getBoundingClientRect().left - (label.getBoundingClientRect().left + label.scrollWidth) >= BACK_LABEL_GAP;
}
function fitBackLabelNow(scope = document) {
  scope.querySelectorAll('.navbar__back').forEach(btn => {
    const label = btn.querySelector('.navbar__back-label');
    if (!label) return;
    // Bouton hors de la page affichée (calque fermé, écran en train de partir) : rien à mesurer
    if (!btn.getClientRects().length) return;
    btn.classList.remove('navbar__back--icon');
    const bar = btn.closest('.navbar__bar');
    const full = label.dataset.full || label.textContent;
    for (const text of full === BACK_FALLBACK ? [full] : [full, BACK_FALLBACK]) {
      if (label.textContent !== text) label.textContent = text;
      bar?.classList.remove('navbar__bar--wide-back');
      if (backLabelFits(btn, label)) return;
      // Titre centré entre le retour et la droite au lieu du centre de la barre
      if (bar) { bar.classList.add('navbar__bar--wide-back'); if (backLabelFits(btn, label)) return; bar.classList.remove('navbar__bar--wide-back'); }
    }
    btn.classList.add('navbar__back--icon');
  });
}
let backFitFrame = 0;
function fitBackLabel(scope = document) {
  fitBackLabelNow(scope);
  cancelAnimationFrame(backFitFrame);
  backFitFrame = requestAnimationFrame(() => fitBackLabelNow());   // toute la page (app et calque)
}
window.addEventListener('resize', () => fitBackLabel());
document.fonts?.ready.then(() => fitBackLabel());

// Libellé du bouton retour vers une route de la pile
function routeTitle(route, isRoot) {
  if (isRoot && TAB_OF_ROOT[route]) return tabMeta(TAB_OF_ROOT[route]).label;
  const name = routeName(route);
  if (name === 'editor') { const cat = editorCatOf(route); return cat ? rawLabel(cat) : 'Séance'; }
  if (name.startsWith('coach')) return coachRouteTitle(route) || 'Retour';
  return {
    dashboard: 'Entraînement', history: 'Historique', stats: 'Progrès',
    programmes: 'Programme', settings: 'Réglages', guide: 'Guide', account: 'Compte', session: 'Séance', summary: 'Bilan',
    'history-detail': 'Séance', 'stats-ex': 'Exercice', 'stats-overview': 'Vue d\'ensemble', recaps: 'Récaps', recap: 'Récap',
    'body-measures': 'Mesures', 'photo-vault': 'Coffre', 'body-measure': bodyMeasureLabel(routeParams(route)[0]) || 'Mesure',
    'my-programmes': 'Mes programmes', 'prog-add': 'Ajouter', 'prog-info': 'Programme', 'ex-edit': 'Exercice', 'cs-edit': 'Séance perso',
    friends: tabMeta('friends').label, 'social-profile': socialPerson(routeParams(route)[0])?.username || 'Profil',
    'social-session': 'Séance', 'social-manage': 'Gérer', 'social-rules': 'Règles', 'social-me': 'Mon profil', strava: 'Strava',
    notifications: 'Notifications',
    'social-people': routeParams(route)[0] === 'followers' ? 'Te suivent' : 'Suivis',
    'add-session': editSessionId ? 'Modifier la séance' : 'Séance passée',
    paywall: 'Abonnement', subscription: 'Abonnement',
    nutrition: 'Nutrition', 'diet-plans': 'Plans diète', 'diet-settings': 'Réglages', 'diet-plan': data.dietPlans?.[routeParams(route)[0]]?.name || 'Plan',
  }[name] || 'Retour';
}

// Grand titre : quand il sort de l'écran, le titre compact et le filet apparaissent.
// Écran dont le titre est posé dans le contenu (h1.scr-title ou h1.pv-title : coffre, photos de bilan, séance d'une
// amie, séance de l'historique…) sous une barre sans titre : la barre reprend ce titre quand il sort de l'écran, comme
// le grand titre d'iOS (panel Apple du 08/11 : barre restée vide au défilement). Le titre du contenu reste celui que
// lit VoiceOver ; la copie de la barre lui est cachée. data-bar-title : version courte pour la barre.
let largeObserver = null;
function observeLargeTitle() {
  largeObserver?.disconnect();
  const bar = $('#app .navbar');
  if (!bar) return;
  let h1 = bar.parentElement?.querySelector('.navbar__large');
  if (!h1) {
    const title = bar.querySelector('.navbar__title');
    h1 = bar.parentElement?.querySelector('.scr h1.scr-title, .scr h1.pv-title');
    if (!h1 || !title || title.textContent.trim()) return;   // barre qui a déjà son titre : rien à reprendre
    title.textContent = h1.dataset.barTitle || h1.textContent.trim();   // titre court si le long ne tient pas (« Coffre »)
    title.setAttribute('aria-hidden', 'true');
    bar.classList.add('navbar--echo');
  }
  if (!('IntersectionObserver' in window)) return;
  const top = bar.getBoundingClientRect().height;
  largeObserver = new IntersectionObserver(([en]) => {
    bar.classList.toggle('navbar--collapsed', !en.isIntersecting);
  }, { rootMargin: `-${Math.round(top)}px 0px 0px 0px`, threshold: 0 });
  largeObserver.observe(h1);
}
