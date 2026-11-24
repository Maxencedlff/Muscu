// ═══════════════════════════════════════════════════════════
//  Programme › Exercice › Intensification : la technique prescrite et la ou les séries qui la portent
//  (« Sur quelle série : Dernière · Première · Toutes · Série 2 · Plusieurs séries »). Envoyée à l'élève avec le
//  programme d'un coach. Logique : js/data/intensif.js (intensFieldsFor, cleanIntensOn) ;
//  décisions : docs/INTENSIFICATION.md, « Sur quelle série »
// ═══════════════════════════════════════════════════════════
'use strict';

// Techniques du choix « Technique » (top set et back-off ensemble : « 1re série lourde, puis allégées »)
const INTENS_TECH_PICK = ['drop', 'rp', 'cluster', 'topback'];
function intensTechName(tech) { return tech === 'topback' ? INTENS_PLANS.topback.label : TECHS[tech]?.label || ''; }

// Champs du brouillon de Programme › Exercice (exDraftFor, js/features/programme-editor.js) : intensTech, intensWhere
// ('last', 'all' ou des numéros, gardés tels quels jusqu'à OK) et intensMulti (cases « Plusieurs séries » affichées)
function intensDraftOf(ex) {
  const tech = ex && canTech(ex) ? intensTechOf(ex) : null, where = ex ? intensWhereOf(ex) : null;
  return { intensTech: tech, intensWhere: where || 'last', intensMulti: Array.isArray(where) && where.length > 1 };
}
// Brouillon enregistré dans l'exercice du programme (OK) : la forme la plus simple pour ses séries (intensFieldsFor)
function applyDraftIntens(ex, d) {
  const f = d?.intensTech && canTech(ex) ? intensFieldsFor(d.intensTech, d.intensWhere, ex.sets) : {};
  if (f.intens) ex.intens = f.intens; else delete ex.intens;
  if (f.intensOn) ex.intensOn = f.intensOn; else delete ex.intensOn;
}
// Séries visées du brouillon, bornées à ses séries (le nombre de séries a pu baisser depuis le choix)
function draftWhere(d) {
  const w = d.intensWhere;
  if (!Array.isArray(w)) return w === 'all' ? 'all' : 'last';
  const sets = w.filter(n => n <= d.sets);
  return sets.length ? sets : 'last';
}

function exIntensHtml(d) {
  if (measureOf({ name: d.name, ...(d.measure ? { measure: d.measure } : {}) }) !== 'reps') return '';
  const sub = !!TECHS[d.intensTech]?.sub, where = draftWhere(d);
  // Plusieurs séries : cases à cocher, comme « Répéter » d'une alarme iOS
  const checks = sub && d.intensMulti ? Array.from({ length: d.sets }, (_, i) => {
    const on = Array.isArray(where) ? where.includes(i + 1) : where === 'all' || i === d.sets - 1;
    return `
          <button class="cell cell--pick" data-action="ex-intens-set" data-n="${i + 1}" role="checkbox" aria-checked="${on}">
            <span class="cell__body"><span class="cell__title">Série ${i + 1}</span></span>
            <span class="cell__check">${on ? icon('checkmark', 20) : ''}</span>
          </button>`;
  }).join('') : '';
  return `
        <div class="group-title">Intensification</div>
        <div class="group">
          <button class="cell cell--nav" data-action="ex-intens">
            <span class="cell__body"><span class="cell__title">Technique</span><span class="cell__sub">${esc(intensTechName(d.intensTech) || 'Aucune')}</span></span>
            ${icon('chevron.right', 16)}
          </button>${sub ? `
          <button class="cell cell--nav" data-action="ex-intens-where">
            <span class="cell__body"><span class="cell__title">Sur quelle série</span><span class="cell__sub">${esc(d.intensMulti ? 'Plusieurs séries' : intensWhereText(where))}</span></span>
            ${icon('chevron.right', 16)}
          </button>${checks}` : ''}
        </div>
        <div class="group-foot">Ajoutée aux séries à chaque séance. Un élève la reçoit avec le programme.</div>`;
}
function refreshExIntens() {
  const box = $('#exIntens');
  if (box && exDraft) box.innerHTML = exIntensHtml(exDraft);
}

registerActions({
  'ex-intens': async () => {
    if (!exDraft) return;
    const cur = exDraft.intensTech;
    const v = await dialog({ type: 'sheet', title: 'Technique d\'intensification', message: 'Ajoutée aux séries de l\'exercice à chaque séance. La série se choisit ensuite.', actions: [
      ...INTENS_TECH_PICK.map(k => ({ label: `${cur === k ? '✓ ' : ''}${intensTechName(k)}`, value: k })),
      ...(cur ? [{ label: 'Aucune', value: 'none', style: 'destructive' }] : []),
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (!v || !exDraft) return;
    exDraft.intensTech = v === 'none' ? null : v;   // les séries choisies restent (une autre technique, mêmes séries)
    refreshExIntens();
  },
  // Dernière (par défaut) · Première · Toutes · Série 2… · Plusieurs séries (3 séries et plus)
  'ex-intens-where': async () => {
    if (!exDraft || !TECHS[exDraft.intensTech]?.sub) return;
    const n = exDraft.sets, w = draftWhere(exDraft), multi = exDraft.intensMulti;
    const is = k => !multi && (k === 'last' ? w === 'last' || (Array.isArray(w) && w.length === 1 && w[0] === n)
      : k === 'all' ? w === 'all' : Array.isArray(w) && w.length === 1 && w[0] === k && (k !== n));
    const opt = (label, value, on) => ({ label: `${on ? '✓ ' : ''}${label}`, value });
    const v = await dialog({ type: 'sheet', title: 'Sur quelle série ?', actions: [
      opt('Dernière (par défaut)', 'last', is('last')),
      ...(n > 1 ? [opt('Première', 1, is(1)), opt('Toutes', 'all', is('all'))] : []),
      ...Array.from({ length: Math.max(0, n - 2) }, (_, i) => opt(`Série ${i + 2}`, i + 2, is(i + 2))),
      ...(n > 2 ? [opt('Plusieurs séries…', 'multi', multi)] : []),
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (v == null || !exDraft) return;
    if (v === 'multi') {
      // Cases cochées d'après le choix d'avant (dernière, toutes ou les séries choisies)
      exDraft.intensWhere = w === 'all' ? Array.from({ length: n }, (_, i) => i + 1) : Array.isArray(w) ? w : [n];
      exDraft.intensMulti = true;
    } else {
      exDraft.intensWhere = Number.isInteger(v) ? [v] : v;
      exDraft.intensMulti = false;
    }
    refreshExIntens();
    haptic();
  },
  // Case d'une série (Plusieurs séries) : jamais aucune cochée
  'ex-intens-set': (e, el) => {
    if (!exDraft) return;
    const k = parseInt(el.dataset.n), w = draftWhere(exDraft);
    const cur = Array.isArray(w) ? w : w === 'all' ? Array.from({ length: exDraft.sets }, (_, i) => i + 1) : [exDraft.sets];
    const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k].sort((a, b) => a - b);
    if (!next.length) { showToast('Garde au moins une série'); return; }
    exDraft.intensWhere = next;
    refreshExIntens();
    $(`[data-action="ex-intens-set"][data-n="${k}"]`)?.focus();   // VoiceOver reste sur la case touchée
    haptic();
  },
});
