// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : écran « Plans diète » (#/plans-diete ; docs/COACH_WEB.md, « Plans diète »)
//
//  Mes plans (gardés sur mon compte, les mêmes que dans l'app), « Créer un plan », « Dupliquer », et Mes aliments
//  (« 37 sur 200 », Retirer). L'éditeur d'un plan : js/desk/diet-editor.js (état dt).
// ═══════════════════════════════════════════════════════════
'use strict';

// Écran « Plans diète » : mes plans et Mes aliments
function deskDtLibHtml(route) {
  if (route.id) return deskDtFrameHtml(null);
  const acc = dt.acc;
  const head = `<div class="head"><div class="grow"><h1 class="title">Plans de nutrition</h1><div class="sub">Tes plans, gardés sur ton compte : les mêmes que dans l'app (Programme › Plans de nutrition).</div></div>
    <button type="button" class="btn fill" data-dt="new" ${!acc || dt.busy ? 'disabled' : ''}>${deskIcon('plus', 'sm')}Créer un plan</button></div>`;
  if (!acc) {
    return head + (dt.accKind ? `<div class="empty" role="alert">${esc(deskErrorText(dt.accKind))}<br><button type="button" class="btn tint" data-dt="reload">Réessayer</button></div>`
      : '<div class="empty" role="status">Chargement de tes plans…</div>');
  }
  const ids = deskDtPlanIds(acc);
  const why = !acc.consent ? (acc.synced ? DESK_DT_ERRORS.no_consent : DESK_DT_ERRORS.no_doc) : deskDtOldPhone() ? DESK_DT_ERRORS.old_phone : '';
  const consent = why ? `<p class="dt-note" role="note">${deskIcon('phone', 'sm')}<span>${esc(why)}</span></p>` : '';
  const row = id => {
    const p = acc.dietPlans[id], t = dietPlanMacros(p);
    const sub = [deskDtDaysWord(p), plural(dietShownMeals(p).length, 'repas', 'repas'), `${dtN(t.kcal)} kcal${p.days ? ' le 1er jour' : ''}`, p.updatedAt ? `modifié le ${fmtDate(p.updatedAt, 'short')}` : ''].filter(Boolean).join(' · ');
    return `<li><div class="row dt-pl"><a class="grow dt-pl-a" href="#/plans-diete/${encodeURIComponent(id)}"><b>${esc(p.name)}</b><span class="t2 blk">${esc(sub)}</span></a>
      <button type="button" class="btn link" data-dt="dup" data-id="${esc(id)}" ${deskDtCanSave() ? '' : 'disabled'}>${deskIcon('copy', 'sm')}Dupliquer<span class="sr">${esc(` ${p.name}`)}</span></button>
      <a class="btn link ic" href="#/plans-diete/${encodeURIComponent(id)}" aria-hidden="true" tabindex="-1">${deskIcon('chevron', 'sm')}</a></div></li>`;
  };
  const plans = `<section aria-labelledby="h-dt-plans"><h2 class="gh" id="h-dt-plans">Mes plans <span class="r">${esc(`${ids.length} sur ${DIET_PLAN_MAX_COACH}`)}</span></h2>
    ${ids.length ? `<ul class="group" aria-labelledby="h-dt-plans">${ids.map(row).join('')}</ul>` : `<div class="empty">Aucun plan pour l'instant. « Créer un plan » en prépare un avec 4 repas, que tu remplis avec la table Ciqual.</div>`}
    <div class="gfoot">Un plan s'envoie depuis l'éditeur, à un ou plusieurs élèves, ou depuis l'onglet Nutrition d'un élève.</div></section>`;
  const foods = acc.dietFoods;
  const frow = f => `<li><div class="row"><span class="grow"><b>${esc(foodName(f.name))}</b><span class="t2 blk num">${esc(`${f.src === 'off' ? 'Code-barres' : 'Créé'} · 100 g : ${f.per.k} kcal · ${dtMacros(f.per)}`)}</span></span>
    <button type="button" class="btn link danger" data-dt="food-rm" data-id="${esc(f.id)}" ${deskDtCanSave() ? '' : 'disabled'}>Retirer<span class="sr">${esc(` ${f.name}`)}</span></button></div></li>`;
  const mine = `<section aria-labelledby="h-dt-foods"><h2 class="gh" id="h-dt-foods">Mes aliments <span class="r">${esc(`${foods.length} sur ${DIET_FOODS_MAX}`)}</span></h2>
    ${foods.length ? `<ul class="group dt-foods" aria-labelledby="h-dt-foods">${foods.map(frow).join('')}</ul>` : '<div class="empty">Aucun aliment perso. Tu en crées un depuis la recherche d\'un aliment (« Créer un aliment »), ou avec son code-barres.</div>'}
    <div class="gfoot">Les aliments absents de la table Ciqual (skyr, whey, produits de marque). Les retirer ne change aucun plan.</div></section>`;
  return `${head}${consent}<div class="cols dtl">${plans}${mine}</div><p class="gfoot dt-src">${esc(DESK_DT_SOURCES)}</p>`;
}

async function deskDtNewPlan() {
  const acc = dt.acc || await deskDtLoadAcc();
  const n = deskDtNew(acc || { dietPlans: {} }, 'Plan de nutrition');
  if (n.kind) { deskToast(deskDtErr(n.kind)); return; }
  deskDtUse({ key: `lib:${n.id}`, ctx: { kind: 'lib' }, id: n.id, plan: n.plan, fresh: true, src: 'new' });
  location.hash = `#/plans-diete/${n.id}`;
  setTimeout(() => { const i = document.getElementById('dt-name'); if (i) { i.focus(); i.select(); } }, 0);
}
async function deskDtDuplicateFrom(id) {
  const acc = dt.acc;
  const c = deskDtDuplicate(acc, id);
  if (c.kind) { deskToast(deskDtErr(c.kind)); return; }
  dt.busy = true; deskRender();
  const r = await deskWriteDiet(deskDtOpSave(c.id, c.plan));
  dt.busy = false;
  if (!r.ok) { deskToast(deskDtErr(r.kind)); deskRender(); return; }
  Object.assign(dt, { acc: r.acc, accAt: Date.now() });
  deskDocCache.at = 0;
  deskToast(`Copie enregistrée : « ${c.plan.name} »`);
  location.hash = `#/plans-diete/${c.id}`;
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-dt]');
  if (!el || el.getAttribute('aria-disabled') === 'true') return;
  const a = el.dataset.dt;
  if (a === 'reload') { deskDtLoadAcc({ force: true }).then(() => deskRender()); return; }
  if (a === 'new') { deskDtNewPlan(); return; }
  if (a === 'dup') { deskDtDuplicateFrom(el.dataset.id); return; }
  if (a === 'food-rm') {
    const f = dt.acc?.dietFoods.find(x => x.id === el.dataset.id);
    if (!f || !(await deskConfirm({ title: `Retirer ${foodName(f.name)} de Mes aliments ?`, text: 'Les plans qui l\'utilisent gardent ses valeurs.', ok: 'Retirer', danger: true }))) return;
    const r = await deskWriteDiet(deskDtOpRemoveFood(f.id));
    if (!r.ok) { deskToast(deskDtErr(r.kind)); return; }
    Object.assign(dt, { acc: r.acc, accAt: Date.now() });
    deskRender(); deskToast(`${foodName(f.name)} retiré de Mes aliments`);
    return;
  }
});
