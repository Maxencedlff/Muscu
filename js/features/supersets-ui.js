// ═══════════════════════════════════════════════════════════
//  Supersets : choix des exercices enchaînés (séance en cours et Programme › Séance)
// ═══════════════════════════════════════════════════════════
// Logique des groupes : js/data/supersets.js. Affichage par tour dans la séance : js/features/session.js.
'use strict';

// Feuille à cocher : items [{ k, name, sub }], checked (Set de k). Renvoie la liste des k cochés, ou null.
// Au plus SS_MAX exercices en tout, `anchor` compris quand il est donné (déjà dans le groupe, non affiché).
function pickSupersetSheet({ title, intro, items, checked, anchor = true }) {
  const max = SS_MAX - (anchor ? 1 : 0);
  return sheet({ title, body: `
    <p class="mpick__intro">${intro}</p>
    <div class="mpick ssp" role="group" aria-label="${esc(title)}" data-max="${max}">
      ${items.map(it => `
      <button class="mpick__row" role="checkbox" aria-checked="${checked.has(it.k)}" data-action="ss-toggle" data-k="${it.k}">
        <span class="ssp__body"><span>${esc(it.name)}</span>${it.sub ? `<span class="ssp__sub">${esc(it.sub)}</span>` : ''}</span>${icon('checkmark', 18)}
      </button>`).join('')}
    </div>
    <p class="mpick__foot">Enchaînés sans repos, tour par tour. Le repos part à la fin de chaque tour. ${SS_MAX} exercices au plus.</p>`,
    onConfirm: panel => [...panel.querySelectorAll('.ssp .mpick__row[aria-checked="true"]')].map(b => parseInt(b.dataset.k)),
  });
}

// Sous-titre d'un exercice déjà dans un autre groupe : « Dans le superset B »
function ssOtherSub(xs, k, tags, mine) {
  const g = ssGroupOf(xs, k);
  return g && !g.includes(mine) ? `Dans le ${ssKind(g.length).toLowerCase()} ${tags[k][0]}` : '';
}

// Pastille « A1 » devant un exercice d'un superset (Historique, Amis, Programme), avec son nom pour VoiceOver
function ssTagHtml(xs, i) {
  const g = ssGroupOf(xs, i);
  if (!g) return '';
  const tag = ssTags(xs)[i];
  return `<span class="ss-tag ss-tag--sm" aria-hidden="true">${tag}</span><span class="visually-hidden">${ssKind(g.length)} ${tag[0]}, </span>`;
}

// ── Séance en cours ──
// Menu ⋯ › « Superset avec… » : le groupe change dans la séance, et dans le programme quand tous
// ses exercices en viennent (il revient alors aux séances suivantes, comme le repos réglé ici).
async function sessionSupersetPick(ei) {
  const xs = activeSession?.exercises, ex = xs?.[ei];
  if (!ex) return;
  const tags  = ssTags(xs);
  const group = ssGroupOf(xs, ei) || [ei];
  const items = xs.map((e, k) => ({ k, name: e.name, sub: ssOtherSub(xs, k, tags, ei) })).filter(it => it.k !== ei);
  const picked = await pickSupersetSheet({
    title: 'Superset', intro: `Exercices à enchaîner avec ${esc(ex.name)}`,
    items, checked: new Set(group.filter(k => k !== ei)),
  });
  if (!picked || !activeSession || activeSession.exercises[ei] !== ex) return;
  applySessionSuperset(ei, picked);
}

// Retirer l'exercice ei de son groupe (menu ⋯)
function sessionSupersetLeave(ei) {
  const xs = activeSession?.exercises;
  if (xs && ssGroupOf(xs, ei)) applySessionSuperset(ei, null);
}

// others : exercices à enchaîner avec ei, ou null pour l'en retirer (ssLeave)
function applySessionSuperset(ei, others) {
  if (others && others.length >= SS_MAX) { showToast(`${SS_MAX} exercices au plus`); return; }
  cancelEffort();   // positions des séries modifiées
  editingSet = null;
  const xs = activeSession.exercises, ex = xs[ei];
  const chosen = (others || []).map(k => xs[k]);
  activeSession.exercises = others ? ssRegroup(xs, ei, others) : ssLeave(xs, ei);
  activeSession.lastEi = null;

  // Programme : mêmes exercices regroupés (par identifiant), si tous en viennent
  const plist = sessProg().exercises[activeSession.category] || [];
  const pIdx  = e => (e.exId ? plist.findIndex(p => p.id === e.exId) : -1);
  const pi = pIdx(ex), pothers = chosen.map(pIdx);
  const inProg = pi >= 0 && pothers.every(k => k >= 0);
  if (inProg) {
    sessProg().exercises[activeSession.category] = others ? ssRegroup(plist, pi, pothers) : ssLeave(plist, pi);
    save();
  }
  const g = ssGroupOf(activeSession.exercises, activeSession.exercises.indexOf(ex));
  haptic();
  persistSession();
  render();
  showToast(!g ? 'Retiré du superset'
    : inProg ? `${ssKind(g.length)} enregistré` : `${ssKind(g.length)} pour cette séance`);
  setTimeout(() => document.querySelector(`.ex-card[data-ei="${activeSession?.exercises.indexOf(ex)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

// ── Programme › Séance ──
// « Créer un superset » : on coche de 2 à SS_MAX exercices de la séance du programme
async function editorSupersetCreate(cat) {
  const list = prog().exercises[cat] || [];
  if (list.length < 2) { showToast('Ajoute d\'abord au moins deux exercices'); return; }
  const tags = ssTags(list);
  const picked = await pickSupersetSheet({
    title: 'Superset', intro: 'Coche les exercices à enchaîner, de 2 à 5.', anchor: false,
    items: list.map((e, k) => ({ k, name: e.name, sub: ssOtherSub(list, k, tags, -1) })), checked: new Set(),
  });
  if (!picked) return;
  if (picked.length < 2) { showToast('Coche au moins deux exercices'); return; }
  prog().exercises[cat] = ssRegroup(list, picked[0], picked.slice(1));
  save();
  haptic();
  render();
  showToast(`${ssKind(picked.length)} créé`);
}

// Programme › Exercice : « Retirer du superset » (l'exercice passe juste après le groupe)
function editorSupersetLeave(cat, i) {
  const list = prog().exercises[cat] || [];
  if (!ssGroupOf(list, i)) return false;
  prog().exercises[cat] = ssLeave(list, i);
  save();
  return true;
}

registerActions({
  // Case de la feuille : au plus data-max cochées
  'ss-toggle': (e, el) => {
    const box = el.closest('.ssp');
    const on  = el.getAttribute('aria-checked') !== 'true';
    if (on && box.querySelectorAll('[aria-checked="true"]').length >= parseInt(box.dataset.max)) {
      showToast(`${SS_MAX} exercices au plus`);
      return;
    }
    el.setAttribute('aria-checked', String(on));
    haptic();
  },
});
