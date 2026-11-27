// ═══════════════════════════════════════════════════════════
//  Coach : charge et reps prescrites à un élève, exercice par exercice, depuis l'écran Envoyer
//  (`coach-presc:UID:PROG:CAT:EXID`). Facultatif : sans rien, le programme part comme avant.
//  Logique et format : js/data/coach-presc.js ; contrat : docs/COACH_V1.md, « Charge prescrite ».
//  - Reps : Fourchette ou Fixe, comme Programme › Exercice (repris du programme, changeables pour cet élève).
//  - Charge : une pour toutes les séries, puis série par série si besoin (top set, back-off) ; « Reprendre sa
//    dernière fois » quand ses séances sont chargées. Clavier numérique, de 0 à 500 kg par demi-kilo.
//  Rien n'est envoyé ici : « OK » range la prescription dans le brouillon de l'écran Envoyer (coachSendDraft).
// ═══════════════════════════════════════════════════════════
'use strict';

let coachPrescDraft = null;   // { route, load, loads: [texte], fixed, min, max } : textes saisis, unité affichée

// Exercice de mon programme visé par la route, et ses repères
function coachPrescCtx(route) {
  const [uid, progId, cat, exId] = routeParams(route);
  const e = (data.programmes[progId]?.exercises?.[cat] || []).find(x => x.id === exId) || null;
  return { uid, progId, cat, exId, e };
}
const prescUnitMax = () => (data.unit === 'lbs' ? Math.floor(PRESC_KG_MAX * KG_TO_LBS) : PRESC_KG_MAX);
const prescKgTxt = kg => (kg === null || kg === undefined ? '' : fmtW(kg, { plain: true }));

function coachPrescDraftFor(route) {
  if (coachPrescDraft?.route === route) return coachPrescDraft;
  const { cat, exId, e } = coachPrescCtx(route);
  const p = coachSendDraft?.presc?.[cat]?.[exId] || {};
  const reps = p.reps || { fixed: e?.repFixed === true || !!fixedReps(e), max: fixedReps(e) || e?.repMax || 12, min: e?.repMin || null };
  const n = e?.sets || 3;
  coachPrescDraft = { route, load: prescKgTxt(cleanPrescKg(p.load)),
    loads: Array.from({ length: n }, (_, i) => prescKgTxt(Array.isArray(p.loads) ? cleanPrescKg(p.loads[i]) : null)),
    // Bas de la fourchette écrit en vrai chiffre, jamais en texte d'exemple gris (retours de Sophie du 26/11 : « 8 » gris
    // à côté de « 12 » blanc) : sans bas réglé, celui que l'app applique (4 sous le haut, repSpanOf)
    fixed: reps.fixed === true, max: String(reps.max ?? 12), min: reps.min ? String(reps.min) : prescLowText(reps.max ?? 12) };
  return coachPrescDraft;
}


// Bas de fourchette appliqué quand rien n'est réglé (4 sous le haut, comme repSpanOf), en texte ; '' si aucun
function prescLowText(max) {
  const hi = parseInt(max) || 12, lo = Math.max(1, hi - 4);
  return lo < hi ? String(lo) : '';
}

function renderCoachPresc(uid) {
  const route = currentRoute();
  const { e, progId, cat } = coachPrescCtx(route);
  if (!e) return `<div class="view view--grouped">${navBar({ title: 'Charge et reps' })}<div class="scr"><div class="empty-note">Cet exercice n'est plus dans ton programme.</div></div></div>`;
  const d = coachPrescDraftFor(route), who = esc(personName(coachStudent(uid))), u = unitLbl();
  const inKg = (id, value, label, ph = '—', attrs = '') => `
            <span class="field-suffix">
              <input type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" class="field field--num presc-in" id="${id}" ${attrs}
                     value="${esc(value)}" placeholder="${esc(ph)}" aria-label="${esc(label)}">
              <span aria-hidden="true">${u}</span>
            </span>`;
  const modes = [[false, 'Fourchette'], [true, 'Fixe']].map(([f, label]) =>
    `<button class="segmented__btn ${d.fixed === f ? 'segmented__btn--active' : ''}" aria-pressed="${d.fixed === f}" data-action="coach-presc-mode" data-fixed="${f}">${label}</button>`).join('');
  const repIn = (id, value, label, ph = '') => `
            <span class="field-suffix">
              <input type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" class="field field--num presc-in" id="${id}"
                     value="${esc(value)}" placeholder="${esc(ph)}" aria-label="${esc(label)}">
              <span aria-hidden="true">reps</span>
            </span>`;
  const repsFields = d.fixed ? `
          <label class="cell cell--ctl"><span class="cell__body"><span class="cell__title">Reps par série</span></span>${repIn('cpMax', d.max, 'Reps par série')}</label>`
    : `
          <label class="cell cell--ctl"><span class="cell__body"><span class="cell__title">Bas de fourchette</span></span>${repIn('cpMin', d.min, 'Bas de fourchette de reps', String(Math.max(1, (num(d.max, 1, 100, true) ?? 12) - 4)))}</label>
          <label class="cell cell--ctl"><span class="cell__body"><span class="cell__title">Haut de fourchette</span></span>${repIn('cpMax', d.max, 'Haut de fourchette de reps')}</label>`;
  // Sa dernière fois, d'après ses séances que j'ai chargées (écran de l'élève) : rien si je ne la vois pas
  const last = blockRole(e) ? null : studentLastLoads(coachSessions(uid).rows, e.name);   // pré-fatigue : rien à reprendre
  const lastTxt = last ? `${last.kg.map((kg, i) => `${fmtW(kg)} ${u} × ${last.reps[i]}`).slice(0, 3).join(', ')}${last.kg.length > 3 ? '…' : ''}` : '';
  const lastCell = last ? `
          <button class="cell cell--action presc-last" data-action="coach-presc-last">
            <span class="cell__body"><span class="cell__title">Reprendre sa dernière fois</span><span class="cell__sub num">${esc(lastTxt)} · ${esc(fmtDate(last.doneAt, 'short'))}</span></span>
          </button>` : '';
  const sets = e.sets || 3;
  const perSet = sets > 1 ? `
        <div class="group-title">Série par série</div>
        <div class="group">${d.loads.map((v, i) => {
          const tag = prescSetTag(e, i);
          return `
          <label class="cell cell--ctl"><span class="cell__body"><span class="cell__title">Série ${i + 1}</span>${tag ? `<span class="cell__sub">${esc(tag)}</span>` : ''}</span>${inKg(`cpSet${i}`, v, `Charge de la série ${i + 1}${tag ? `, ${tag}` : ''}, en ${u === 'kg' ? 'kilos' : 'livres'}`, d.load || '—', `data-i="${i}"`)}</label>`;
        }).join('')}
        </div>
        <div class="group-foot">Laisse vide pour la même charge sur toutes les séries. Utile pour un top set plus lourd suivi de back-off allégés.</div>` : '';
  return `
    <div class="view view--grouped coach-presc-view">
      ${navBar({ title: 'Charge et reps', large: false,
          left: '<button class="navbar__text" data-action="coach-presc-cancel">Annuler</button>',
          right: '<button class="navbar__text navbar__text--bold" data-action="coach-presc-ok">OK</button>' })}
      <div class="scr">
        <h1 class="scr-title">${esc(blockName(e, data.programmes[progId]?.exercises?.[cat]))}</h1>
        <p class="scr-sub">Pour ${who} · ${plural(sets, 'série', 'séries')}</p>
        <div class="group-title">Reps</div>
        <div class="group">
          <div class="cell cell--ctl cell--wrap"><div class="segmented seg-full" role="group" aria-label="Répétitions">${modes}</div></div>${repsFields}
        </div>
        <div class="group-foot">${d.fixed ? 'Le même nombre à chaque série.' : 'Ton élève vise le haut de la fourchette. L\'app ne monte jamais la charge à ta place.'}</div>
        <div class="group-title">Charge</div>
        <div class="group">
          <label class="cell cell--ctl"><span class="cell__body"><span class="cell__title">Toutes les séries</span></span>${inKg('cpLoad', d.load, `Charge de toutes les séries, en ${u === 'kg' ? 'kilos' : 'livres'}`)}</label>${lastCell}
        </div>
        <div class="group-foot">Facultatif. Sans charge, ${who} reprend celle de la dernière fois. De 0 à ${prescUnitMax()} ${u}, ${u === 'kg' ? 'demi-kilos' : 'demi-livres'} acceptés. Si ${who} soulève autre chose, tu verras l'écart dans ses séances.</div>
        ${perSet}
      </div>
    </div>`;
}
SCREENS.set('coach-presc', { render: uid => renderCoachPresc(uid) });

// Charge saisie (unité affichée) → kg, null si vide ; false si invalide (hors bornes, pas un demi)
function prescParseKg(raw) {
  const t = String(raw ?? '').trim();
  if (t === '') return null;
  const v = num(t, 0, prescUnitMax());
  if (v === null || Math.round(v * 2) !== v * 2) return false;
  return cleanPrescKg(storeW(String(v)));
}

// Champs saisis recopiés dans le brouillon, sans redessiner (un nouveau rendu les reprend)
document.addEventListener('input', ev => {
  const t = ev.target;
  if (!t.matches?.('.coach-presc-view .presc-in') || !coachPrescDraft) return;
  t.classList.remove('set-input--error'); t.removeAttribute('aria-invalid');
  if (t.id === 'cpLoad') coachPrescDraft.load = t.value;
  else if (t.id === 'cpMin') coachPrescDraft.min = t.value;
  else if (t.id === 'cpMax') coachPrescDraft.max = t.value;
  else if (t.dataset.i !== undefined) {
    coachPrescDraft.loads[+t.dataset.i] = t.value;
  }
  // Placeholder des séries : la charge de toutes les séries, à jour pendant la frappe
  if (t.id === 'cpLoad') document.querySelectorAll('.coach-presc-view [data-i]').forEach(x => { x.placeholder = t.value.trim() || '—'; });
});

registerActions({
  'coach-presc-open': (e, el) => {
    coachPrescDraft = null;
    navigate(makeRoute('coach-presc', el.dataset.uid, el.dataset.prog, el.dataset.cat, el.dataset.ex));
  },
  'coach-presc-mode': (e, el) => {
    if (!coachPrescDraft) return;
    const fixed = el.dataset.fixed === 'true';
    if (coachPrescDraft.fixed === fixed) return;
    coachPrescDraft.fixed = fixed;
    haptic();
    render();
  },
  'coach-presc-last': () => {
    const { uid, e } = coachPrescCtx(currentRoute());
    const last = e && !blockRole(e) && studentLastLoads(coachSessions(uid).rows, e.name);
    if (!last || !coachPrescDraft) return;
    const first = last.kg[0];
    coachPrescDraft.load = prescKgTxt(first);
    coachPrescDraft.loads = coachPrescDraft.loads.map((_, i) => (last.kg[i] !== undefined && last.kg[i] !== first ? prescKgTxt(last.kg[i]) : ''));
    haptic();
    render();
    announce(`Charge reprise : ${fmtW(first)} ${unitLbl()}`);
  },
  'coach-presc-cancel': () => { coachPrescDraft = null; goBack(); },
  'coach-presc-ok': () => {
    const { cat, exId, e } = coachPrescCtx(currentRoute());
    const d = coachPrescDraft;
    if (!e || !d || !coachSendDraft) { goBack(); return; }
    const unitMsg = `Charge de 0 à ${prescUnitMax()} ${unitLbl()}, par ${data.unit === 'lbs' ? 'demi-livre' : 'demi-kilo'}`;
    const load = prescParseKg(d.load);
    if (load === false) { flagInvalid($('#cpLoad'), unitMsg); return; }
    const loads = [];
    for (let i = 0; i < d.loads.length; i++) {
      const v = prescParseKg(d.loads[i]);
      if (v === false) { flagInvalid($(`#cpSet${i}`), unitMsg); return; }
      loads.push(v);
    }
    const max = num(d.max, 1, 100, true);
    if (max === null) { flagInvalid($('#cpMax'), 'Reps de 1 à 100'); return; }
    let min = null;
    if (!d.fixed && String(d.min).trim() !== '') {
      min = num(d.min, 1, 99, true);
      if (min === null || min >= max) { flagInvalid($('#cpMin'), 'Le bas doit être sous le haut'); return; }
    }
    // Reps : gardées seulement si elles changent celles du programme (le programme modifié ensuite fait foi sinon)
    const same = d.fixed ? fixedReps(e) === max : !fixedReps(e) && (e.repMax ?? 12) === max && (repSpanOf(e)?.[0] ?? null) === (min ?? repSpanOf({ ...e, repMax: max, repMin: null })?.[0] ?? null);
    const p = cleanCoachPresc({ load, loads, ...(same ? {} : { reps: { fixed: d.fixed, max, ...(min ? { min } : {}) } }) }, e.sets);
    const all = (coachSendDraft.presc ||= {});
    if (p) (all[cat] ||= {})[exId] = p; else if (all[cat]) delete all[cat][exId];
    coachSaveSendDraft();
    coachPrescDraft = null;
    haptic();
    goBack();
  },
});
