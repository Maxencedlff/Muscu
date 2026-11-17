// ═══════════════════════════════════════════════════════════
//  Réactions (social) : sur une carte du fil, le cœur (un toucher : ❤️ « J'aime » ou le retirer ; appui
//  long : les autres) et « + » à côté (les autres réactions, sans geste caché : 🔥 💪 🏆 👏 😮, ma
//  réaction s'il y en a une autre que ❤️) ; double toucher sur le résumé de la séance (muscles et
//  chiffres) : ❤️ avec un cœur qui apparaît puis s'efface ; bulle de choix façon iMessage, rangée des six
//  sur la séance d'un ami, résumé « ❤️🔥 3 », liste « qui a réagi » de mes séances, et ce que
//  l'Historique en montre (« ❤️ 3 · 🔥 1 » dans la liste, la liste des personnes dans le détail).
//  Données : js/data/social.js (REACTIONS, socialSetReaction, myReactions, sessionWho). Contrat :
//  docs/SOCIAL_V1.md. Liste fermée, sans texte libre : rien à modérer.
//  Un seul tap : rien ne se passe au pointerdown, il arme seulement le minuteur de l'appui long ; le
//  clic qui suit un appui long est avalé. Le double toucher n'écoute que les « click » du résumé, qui
//  n'ouvre rien : le reste de la carte s'ouvre toujours au premier toucher, sans attente. VoiceOver :
//  le cœur et « + » sont des boutons (le double toucher du résumé n'est pas un geste VoiceOver) ; la
//  séance d'un ami a aussi la rangée complète.
// ═══════════════════════════════════════════════════════════
'use strict';

const REACT_HOLD_MS = 420;      // appui long (iOS : ~0,5 s pour un menu contextuel ; un peu moins, c'est plus vif)
const REACT_MOVE_PX = 10;       // au-delà, c'est un défilement : pas d'appui long

// ── Gabarits ────────────────────────────────────────────────

// Résumé des réactions reçues : « 🔥👏 3 » (rien sans réaction), annoncé en entier par VoiceOver
function reactionsSummaryHtml(counts, cls = 'react__count') {
  const txt = reactionsSummary(counts);
  return txt ? `<span class="${cls} num" role="img" aria-label="${esc(reactionsSpoken(counts))}">${esc(txt)}</span>` : `<span class="${cls}"></span>`;
}

// Boutons du fil : le cœur, emoji seul (plein à la teinte quand ❤️ est ma réaction), puis « + » (ou ma
// réaction si c'en est une autre, pleine à la teinte), puis le résumé. Noms pour VoiceOver : « J'aime »
// (bouton bascule) et « Autres réactions » (« Autres réactions, la tienne : Chaud »).
function reactionBarHtml(row) {
  const liked = row.my === REACTION_DEFAULT;
  const other = liked ? null : reactionOf(row.my);
  const ids = `data-owner="${esc(row.owner)}" data-id="${esc(row.id)}"`;
  return `<span class="react-pair">
      <button class="react ${liked ? 'react--on' : ''}" data-action="social-react" ${ids}
        aria-pressed="${liked}" aria-label="${esc(reactionOf(REACTION_DEFAULT).label)}" aria-describedby="reactHint">
        <span class="react__emoji" aria-hidden="true">${reactionOf(REACTION_DEFAULT).emoji}</span>
      </button>
      <button class="react react--more ${other ? 'react--on' : ''}" data-action="social-react-more" ${ids} aria-haspopup="menu"
        aria-label="${esc(other ? `Autres réactions, la tienne : ${other.label}` : 'Autres réactions')}">
        ${other ? `<span class="react__emoji" aria-hidden="true">${other.emoji}</span>` : icon('plus', 18)}
      </button>
    </span>
    ${reactionsSummaryHtml(row.reactions)}`;
}
// Consigne lue par VoiceOver après le nom du cœur (une seule par écran)
function reactHintHtml() {
  return '<span id="reactHint" hidden>Touche pour aimer ou ne plus aimer. Maintiens, ou touche Autres réactions, pour en choisir une autre.</span>';
}

// Résumé de la séance sur une carte du fil (muscles et chiffres, js/features/social-ui.js) : zone du double
// toucher, qui n'ouvre rien. Seulement sur la séance d'un autre (pas de réaction sur les miennes).
function likeZoneAttrs(row, mine) {
  return mine ? '' : ` data-like-zone data-owner="${esc(row.owner)}" data-id="${esc(row.id)}"`;
}

// Séance d'un ami : les six réactions côte à côte, la mienne entourée ; nom de la mienne dessous
function reactionRowHtml(row) {
  const my = reactionOf(row.my);
  return `
        <div class="react-row" role="group" aria-label="Réagir à cette séance">
          ${REACTIONS.map(r => `<button class="react-row__btn ${row.my === r.kind ? 'react-row__btn--on' : ''}" data-action="social-react-pick"
            data-owner="${esc(row.owner)}" data-id="${esc(row.id)}" data-kind="${r.kind}" aria-pressed="${row.my === r.kind}" aria-label="${esc(r.label)}">${r.emoji}</button>`).join('')}
        </div>
        <div class="react-row__foot">
          <span class="react-row__mine">${my ? `Ta réaction : ${esc(my.label)}` : 'Choisis une réaction'}</span>
          ${reactionsSummaryHtml(row.reactions, 'react-row__count')}
        </div>`;
}

// Qui a réagi à MA séance : avatar, pseudo, depuis quand, et sa réaction à droite. Seulement les
// personnes que j'ai acceptées (filtré par le serveur). total : réactions connues (my_reactions).
function whoListHtml(sessionId, total = 0) {
  const w = sessionWho(sessionId);
  const rows = w?.rows || [];
  if (!rows.length) {
    if (!total) return '';
    if (w?.error) return `<div class="cell"><span class="cell__sub">${esc(w.error === 'offline' ? 'Pas d\'Internet : réactions pas à jour.' : socialErrorText(w.error))}</span></div>`;
    return '<div class="cell"><span class="cell__sub">Chargement…</span></div>';
  }
  return rows.map(p => personRowHtml(p,
    `<span class="who__emoji" role="img" aria-label="${esc(reactionOf(p.kind).label)}">${reactionOf(p.kind).emoji}</span>`,
    p.at ? fmtAgo(p.at) : '')).join('');
}

// ── Historique ──────────────────────────────────────────────

// Liste : « ❤️ 3 · 🔥 1 » (chaque sorte reçue, la plus fréquente d'abord, trois au plus) sur une séance qui
// en a reçu ; VoiceOver lit le total et le détail
function historyReactionsMark(h) {
  const r = socialEnabled() ? myReactions(h.id) : null;
  if (!r) return '';
  return `<span class="react-mark num" role="img" aria-label="${esc(reactionsSpoken(r.counts))}">${esc(reactionsCountsText(r.counts))}</span>`;
}
// Détail : qui a réagi (cellules ajoutées au groupe Social de js/features/social-ui.js)
function historyWhoHtml(h) {
  const r = myReactions(h.id);
  const list = whoListHtml(h.id, r?.total || 0);
  if (!list) return '';
  const n = sessionWho(h.id)?.rows.length || r?.total || 0;
  return `<div class="group-title">Réactions${n ? ` (${n})` : ''}${h.hidden === true ? ' · reçues avant de la masquer' : ''}</div>
        <div class="group who-list">${list}</div>`;
}
// Ouverture du détail : réactions relues (30 s au plus), puis qui a réagi s'il y en a
async function historyReactionsMount(id) {
  if (!socialEnabled()) return;
  await socialLoadMyReactions({ minAge: SOCIAL_REFRESH_MS });
  if (myReactions(id) || sessionWho(id)?.rows.length) socialLoadWho(id, { minAge: SOCIAL_REFRESH_MS });
}

// ── Bulle de choix (appui long) ─────────────────────────────

let reactPicker = null;   // { root, owner, id, back } bulle ouverte

function closeReactionPicker({ focus = true } = {}) {
  if (!reactPicker) return;
  const { root, back } = reactPicker;
  reactPicker = null;
  root.remove();
  back?.removeAttribute('aria-expanded');
  if (focus && back?.isConnected) back.focus({ preventScroll: true });
}

// Bulle des autres réactions (🔥 💪 🏆 👏 😮), au-dessus du bouton (dessous s'il n'y a pas la place), dans
// l'écran, sur un voile transparent qui la ferme. Échap la ferme aussi ; le focus va à la réaction actuelle
// (ou la première). Ouverte par « + » ou l'appui long sur le cœur ; retoucher la mienne la retire.
function openReactionPicker(btn) {
  const owner = btn.dataset.owner, id = btn.dataset.id;
  const row = socialSessionOf(owner, id);
  if (!row) return;
  closeReactionPicker({ focus: false });
  haptic();
  const root = document.createElement('div');
  root.className = 'react-layer';
  root.innerHTML = `
    <button class="react-layer__dim" type="button" aria-label="Fermer" tabindex="-1"></button>
    <div class="react-picker" role="menu" aria-label="Autres réactions">
      ${REACTIONS_MORE.map(r => `<button class="react-picker__btn ${row.my === r.kind ? 'react-picker__btn--on' : ''}" type="button" role="menuitemradio"
        aria-checked="${row.my === r.kind}" aria-label="${esc(r.label)}" data-kind="${r.kind}"><span aria-hidden="true">${r.emoji}</span></button>`).join('')}
    </div>`;
  document.body.append(root);
  const pick = root.querySelector('.react-picker');
  const b = btn.getBoundingClientRect(), w = pick.offsetWidth, hgt = pick.offsetHeight;
  // Jamais sous la barre de navigation (encoche comprise) : sinon dessous
  const minTop = ($('.navbar')?.getBoundingClientRect().bottom || 0) + 8;
  let top = b.top - hgt - 8;
  if (top < minTop) top = b.bottom + 8;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, b.left + b.width / 2 - w / 2));
  pick.style.top = `${Math.round(top)}px`;
  pick.style.left = `${Math.round(left)}px`;
  reactPicker = { root, owner, id, back: btn };
  btn.setAttribute('aria-expanded', 'true');
  root.querySelector('.react-layer__dim').addEventListener('click', () => closeReactionPicker());
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeReactionPicker(); return; }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const all = [...root.querySelectorAll('.react-picker__btn')];
    const i = all.indexOf(document.activeElement);
    all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length]?.focus();
    e.preventDefault();
  });
  pick.addEventListener('click', async e => {
    const k = e.target.closest('.react-picker__btn')?.dataset.kind;
    if (!k) return;
    const cur = socialSessionOf(owner, id);
    closeReactionPicker();
    await reactTo(owner, id, cur?.my === k ? null : k);
  });
  (root.querySelector('.react-picker__btn--on') || root.querySelector('.react-picker__btn')).focus({ preventScroll: true });
  announce('Autres réactions');
}

async function reactTo(owner, id, kind) {
  haptic();
  const r = await socialSetReaction(owner, id, kind);
  if (!r.ok) { showToast(socialErrorText(r.kind), { error: true }); return; }
  const k = reactionOf(kind);
  announce(k ? `Réaction : ${k.label}` : 'Réaction retirée');
}

// ── Appui long ──────────────────────────────────────────────
// pointerdown arme le minuteur (aucun changement visible) ; un déplacement ou le lever l'annule. Après
// un appui long, le clic qui suit est avalé (le toucher ne pose pas en plus un ❤️). contextmenu (clic
// droit, appui long d'Android) ouvre la bulle aussi.
let reactPress = null;   // { el, x, y, id, timer, fired }
function cancelReactPress() { if (reactPress) clearTimeout(reactPress.timer); }
document.addEventListener('pointerdown', e => {
  const el = e.target.closest?.('[data-action="social-react"]');
  cancelReactPress();
  reactPress = null;
  if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const press = { el, x: e.clientX, y: e.clientY, id: e.pointerId, fired: false };
  press.timer = setTimeout(() => { press.fired = true; openReactionPicker(el); }, REACT_HOLD_MS);
  reactPress = press;
}, { passive: true });
document.addEventListener('pointermove', e => {
  if (!reactPress || reactPress.fired || e.pointerId !== reactPress.id) return;
  if (Math.hypot(e.clientX - reactPress.x, e.clientY - reactPress.y) > REACT_MOVE_PX) { cancelReactPress(); reactPress = null; }
}, { passive: true });
document.addEventListener('pointerup', cancelReactPress, { passive: true });
document.addEventListener('pointercancel', () => { cancelReactPress(); if (!reactPress?.fired) reactPress = null; }, { passive: true });
document.addEventListener('click', e => {
  if (!reactPress?.fired) return;
  const el = reactPress.el;
  reactPress = null;
  if (e.target.closest?.('[data-action="social-react"]') === el) { e.stopImmediatePropagation(); e.preventDefault(); }
}, true);
document.addEventListener('contextmenu', e => {
  const el = e.target.closest?.('[data-action="social-react"]');
  if (!el) return;
  e.preventDefault();
  if (reactPress?.fired) return;   // l'appui long l'a déjà ouverte
  cancelReactPress();
  reactPress = { el, fired: true };
  openReactionPicker(el);
});

// ── Double toucher sur le résumé d'une carte ───────────────
// Deux « click » sur le résumé de la même séance à moins de LIKE_TAP_MS et LIKE_TAP_PX : ❤️ (si je n'ai pas
// encore réagi ; une réaction choisie n'est jamais remplacée ni retirée), et un cœur qui apparaît puis
// s'efface au-dessus du résumé. Le résumé n'ouvre rien : le reste de la carte s'ouvre au premier toucher.
// Clavier ou VoiceOver (detail 0) : ignoré, le cœur est là pour ça.
const LIKE_TAP_MS = 350;
const LIKE_TAP_PX = 30;
let likeTap = null;   // { key, at, x, y } premier toucher
document.addEventListener('click', e => {
  const zone = e.target.closest?.('[data-like-zone]');
  if (!zone || e.detail === 0) { likeTap = null; return; }
  const key = `${zone.dataset.owner}/${zone.dataset.id}`;
  const first = likeTap;
  likeTap = { key, at: e.timeStamp, x: e.clientX, y: e.clientY };
  if (!first || first.key !== key || e.timeStamp - first.at > LIKE_TAP_MS || Math.hypot(e.clientX - first.x, e.clientY - first.y) > LIKE_TAP_PX) return;
  likeTap = null;
  doubleTapLike(zone);
});

async function doubleTapLike(zone) {
  const row = socialSessionOf(zone.dataset.owner, zone.dataset.id);
  if (!row) return;
  const kind = doubleTapReaction(row.my);
  likeBurst(zone, reactionOf(kind || row.my));
  if (kind) await reactTo(row.owner, row.id, kind);
}

// Cœur (ou ma réaction déjà posée) au centre du résumé : apparaît, puis s'efface (0,8 s). Calque fixe hors
// de la carte : le rendu qui suit la réaction ne l'efface pas en route. Réduire les animations : il apparaît
// et s'efface sans grossir (css/social.css).
function likeBurst(zone, r) {
  const b = zone.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'like-burst';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = r.emoji;
  el.style.left = `${Math.round(b.left + b.width / 2)}px`;
  el.style.top = `${Math.round(b.top + b.height / 2)}px`;
  document.body.append(el);
  const done = () => el.remove();
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, 1200);   // filet : animation coupée (onglet en arrière-plan)
}

registerActions({
  // Un toucher sur le cœur : ❤️, ou le retirer (une autre réaction est remplacée par ❤️)
  'social-react': async (e, el) => {
    const row = socialSessionOf(el.dataset.owner, el.dataset.id);
    if (!row) return;
    await reactTo(row.owner, row.id, tapReaction(row.my));
  },
  // « + » : la bulle des autres réactions
  'social-react-more': (e, el) => {
    closeReactionPicker({ focus: false });
    openReactionPicker(el);
  },
  // Rangée de la séance d'un ami : la réaction touchée, ou retirée si c'était déjà la mienne
  'social-react-pick': async (e, el) => {
    const row = socialSessionOf(el.dataset.owner, el.dataset.id);
    if (!row) return;
    await reactTo(row.owner, row.id, row.my === el.dataset.kind ? null : el.dataset.kind);
  },
});

// Changement d'écran ou de taille : la bulle ne reste pas en l'air
window.addEventListener('resize', () => closeReactionPicker({ focus: false }));
window.addEventListener('popstate', () => closeReactionPicker({ focus: false }));
