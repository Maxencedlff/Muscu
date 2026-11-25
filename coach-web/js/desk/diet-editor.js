// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : plans diète en grand écran (docs/COACH_WEB.md, « Plans diète »)
//
//  - « Plans diète » (#/plans-diete) : mes plans et Mes aliments, gardés sur mon compte (les mêmes que dans l'app,
//    Nutrition › Mes diètes) ; créer, dupliquer, ouvrir un plan (#/plans-diete/<plan>).
//  - Onglet Nutrition d'un élève : modifier le plan qu'il a reçu (#/eleve/<id>/nutrition/edit), en créer un
//    (…/nutrition/new) ou ouvrir un des miens (…/nutrition/<plan>), puis l'envoyer.
//  - Éditeur : repas (renommer, consigne, dupliquer, copier vers d'autres jours, masquer ou supprimer, ordre par
//    glisser-déposer à la poignée ou aux flèches), aliments (recherche Ciqual, aliments perso, code-barres saisi →
//    Open Food Facts), quantité en grammes ou à l'unité, équivalences, objectifs (kcal, macros, eau, sel), jours
//    d'entraînement et de repos ou semaine. Macros recalculées à chaque frappe. Annuler / Rétablir (Ctrl ou ⌘ + Z).
//  - Logique et format : js/desk/diet-edit-model.js, sur les fonctions de js/data/ (aucune copie) ; envoi au format
//    exact de l'app (coachDietPayload), à un ou plusieurs élèves (coachSendQueue).
// ═══════════════════════════════════════════════════════════
'use strict';

// Base Ciqual vue de la page (le site construit la sert à côté, le dépôt un dossier plus haut : balise de index.html)
const DESK_FOODS_URL = document.querySelector?.('meta[name="mdlf-foods"]')?.content || 'data/foods.json';
const dt = { acc: null, accAt: 0, accKind: null, accLoading: false,
  key: null, ctx: null, id: null, draft: null, saved: '', fresh: false, src: null, sentAt: 0,
  day: 0, hist: deskDtHistory(), open: null, busy: false, foods: 'idle', err: null };

const deskDtDirty = () => !!dt.draft && (dt.fresh || deskDtSnap(dt.draft) !== dt.saved);
const deskDtDayObj = () => dietDayObj(dt.draft, dt.day);
const deskDtErr = kind => DESK_DT_ERRORS[kind] || (COACH_ERROR_TEXT[kind] ? coachErrorText(kind) : deskErrorText(kind));
function deskDtReset() { Object.assign(dt, { key: null, ctx: null, id: null, draft: null, saved: '', fresh: false, src: null, day: 0, hist: deskDtHistory(), open: null, err: null }); }
async function deskDtLeaveOk() {
  if (!deskDtDirty()) return true;
  return deskConfirm({ title: 'Quitter sans enregistrer le plan ?', text: 'Tes changements seront perdus. Touche « Enregistrer » pour les garder dans tes plans.', ok: 'Quitter sans enregistrer', danger: true });
}
// Écran de l'éditeur dans une adresse (changement d'écran avec des changements : confirmation, js/desk/main.js)
function deskDtRouteKey(h) {
  const a = /^#\/plans-diete\/([A-Za-z0-9_-]{1,64})$/.exec(h || '');
  if (a) return `lib:${a[1]}`;
  const b = /^#\/eleve\/([0-9a-f-]{1,64})\/nutrition\/([0-9a-z_-]{1,64})$/i.exec(h || '');
  return b ? `st:${b[1]}:${b[2]}` : null;
}

// ── Données ─────────────────────────────────────────────────

async function deskDtLoadAcc({ force = false } = {}) {
  if (!force && dt.acc && Date.now() - dt.accAt < DESK_REFRESH_MS) return dt.acc;
  dt.accLoading = true;
  const r = await deskLoadDietAcc();
  dt.accLoading = false;
  if (!r.ok) { if (r.kind === 'signed_out') { deskEndSession(); return null; } dt.accKind = r.kind; return dt.acc; }
  Object.assign(dt, { acc: r.data, accAt: Date.now(), accKind: null });
  return dt.acc;
}
function deskDtFoods() {
  if (dt.foods === 'ready' || dt.foods === 'loading') return;
  dt.foods = 'loading';
  loadFoods(DESK_FOODS_URL).then(db => { dt.foods = db ? 'ready' : 'error'; deskRender(); });
}
// Brouillon mis dans l'éditeur
function deskDtUse({ key, ctx, id, plan, fresh = false, src, sentAt = 0 }) {
  Object.assign(dt, { key, ctx, id, draft: deskDtDraft(plan), fresh, src, sentAt, day: 0, hist: deskDtHistory(), open: null, err: null });
  dt.saved = fresh ? '' : deskDtSnap(dt.draft);
}

// #/plans-diete[/<plan>] : la liste, ou un de mes plans dans l'éditeur
async function deskDtOpenLib(route) {
  const key = route.id ? `lib:${route.id}` : null;
  if (key && dt.key === key && dt.draft) { deskDtFoods(); deskRender(); return; }
  if (!key) deskDtReset();
  deskRender();
  const acc = await deskDtLoadAcc({ force: !key });
  if (deskRoute().name !== 'diets' || deskRoute().id !== route.id) return;
  if (key) {
    const plan = acc?.dietPlans?.[route.id];
    if (plan && !plan.archived && !plan.fromCoach) deskDtUse({ key, ctx: { kind: 'lib' }, id: route.id, plan, src: 'account' });
    else { deskDtReset(); dt.err = acc ? 'gone' : dt.accKind; }
    deskDtFoods();
  }
  deskRender();
}
// Onglet Nutrition d'un élève, …/nutrition/<part> : edit (le plan qu'il a reçu), new (plan neuf), ou un de mes plans
async function deskDtOpenStudent(sid, part) {
  const key = `st:${sid}:${part}`;
  if (dt.key === key && dt.draft) { deskDtFoods(); deskRender(); return; }
  if (dt.key !== key) deskDtReset();
  dt.key = key;
  deskRender();
  const [acc] = await Promise.all([deskDtLoadAcc(), nt.id === sid && !nt.loading ? null : deskNtOpen(sid)]);
  if (deskDtRouteKey(location.hash) !== key) return;
  const ctx = { kind: 'student', sid };
  if (part === 'new') {
    const n = deskDtNew(acc || { dietPlans: {} }, 'Plan de nutrition');
    if (n.kind) { dt.err = n.kind; deskRender(); return; }
    deskDtUse({ key, ctx, id: n.id, plan: n.plan, fresh: true, src: 'new' });
  } else if (part === 'edit') {
    const sent = nt.diets[0];
    const id = sent && deskDtPlanIdOfSent(sent.id);
    if (!sent || !id) { dt.err = 'gone'; deskRender(); return; }
    deskDtUse({ key, ctx, id, plan: sent.data, src: 'sent', sentAt: sent.sentAt });
    // Version reçue par l'élève, pas encore dans mes plans : à enregistrer (ou à envoyer, ce qui l'enregistre aussi)
    if (!acc?.dietPlans?.[id] || acc.dietPlans[id].archived) dt.fresh = true;
  } else {
    const plan = acc?.dietPlans?.[part];
    if (!plan || plan.archived || plan.fromCoach) { dt.err = acc ? 'gone' : dt.accKind; deskRender(); return; }
    deskDtUse({ key, ctx, id: part, plan, src: 'account' });
  }
  deskDtFoods();
  deskRender();
}

// ── Gabarits ────────────────────────────────────────────────

const dtN = v => fmtNum(Math.round(v || 0));
const dtMacros = m => `P ${dtN(m.p)} · G ${dtN(m.c)} · L ${dtN(m.f)}`;
const dtMacrosSpoken = m => `${dtN(m.p)} grammes de protéines, ${dtN(m.c)} de glucides, ${dtN(m.f)} de lipides`;
const dtPair = (shown, spoken) => `<span aria-hidden="true">${shown}</span><span class="sr">${spoken}</span>`;
const dtIdPart = s => String(s).replace(/[^A-Za-z0-9_-]/g, '');
const DESK_DT_SOURCES = 'Valeurs : table Ciqual 2025 de l\'Anses (version du 03/11/2025), doi.org/10.57745/RDMHWY, Licence Ouverte Etalab 2.0 ; valeurs arrondies, énergie de quelques aliments calculée. L\'Anses ne valide pas ces plans. Produits trouvés par leur code-barres : Open Food Facts (openfoodfacts.org), © les contributeurs d\'Open Food Facts, base libre sous licence ODbL ; valeurs à vérifier sur l\'étiquette.';
const DESK_DT_OFF = 'Source : Open Food Facts (openfoodfacts.org), © les contributeurs d\'Open Food Facts, base libre sous licence ODbL. Vérifie avec l\'étiquette.';

// Écran « Plans diète » : mes plans et Mes aliments
function deskDtLibHtml(route) {
  if (route.id) return deskDtFrameHtml(null);
  const acc = dt.acc;
  const head = `<div class="head"><div class="grow"><h1 class="title">Plans diète</h1><div class="sub">Tes plans, gardés sur ton compte : les mêmes que dans l'app (Nutrition › Mes diètes).</div></div>
    <button type="button" class="btn fill" data-dt="new" ${!acc || dt.busy ? 'disabled' : ''}>${deskIcon('plus', 'sm')}Créer un plan</button></div>`;
  if (!acc) {
    return head + (dt.accKind ? `<div class="empty" role="alert">${esc(deskErrorText(dt.accKind))}<br><button type="button" class="btn tint" data-dt="reload">Réessayer</button></div>`
      : '<div class="empty" role="status">Chargement de tes plans…</div>');
  }
  const ids = deskDtPlanIds(acc);
  const consent = acc.consent ? '' : `<p class="dt-note" role="note">${deskIcon('phone', 'sm')}<span>${esc(acc.synced ? DESK_DT_ERRORS.no_consent : DESK_DT_ERRORS.no_doc)}</span></p>`;
  const row = id => {
    const p = acc.dietPlans[id], t = dietPlanMacros(p);
    const sub = [deskDtDaysWord(p), plural(dietShownMeals(p).length, 'repas', 'repas'), `${dtN(t.kcal)} kcal${p.days ? ' le 1er jour' : ''}`, p.updatedAt ? `modifié le ${fmtDate(p.updatedAt, 'short')}` : ''].filter(Boolean).join(' · ');
    return `<li><div class="row dt-pl"><a class="grow dt-pl-a" href="#/plans-diete/${encodeURIComponent(id)}"><b>${esc(p.name)}</b><span class="t2 blk">${esc(sub)}</span></a>
      <button type="button" class="btn link" data-dt="dup" data-id="${esc(id)}" ${acc.consent ? '' : 'disabled'}>${deskIcon('copy', 'sm')}Dupliquer<span class="sr">${esc(` ${p.name}`)}</span></button>
      <a class="btn link ic" href="#/plans-diete/${encodeURIComponent(id)}" aria-hidden="true" tabindex="-1">${deskIcon('chevron', 'sm')}</a></div></li>`;
  };
  const plans = `<section aria-labelledby="h-dt-plans"><h2 class="gh" id="h-dt-plans">Mes plans <span class="r">${esc(`${ids.length} sur ${DIET_PLAN_MAX_COACH}`)}</span></h2>
    ${ids.length ? `<ul class="group" aria-labelledby="h-dt-plans">${ids.map(row).join('')}</ul>` : `<div class="empty">Aucun plan pour l'instant. « Créer un plan » en prépare un avec 4 repas, que tu remplis avec la table Ciqual.</div>`}
    <div class="gfoot">Un plan s'envoie depuis l'éditeur, à un ou plusieurs élèves, ou depuis l'onglet Nutrition d'un élève.</div></section>`;
  const foods = acc.dietFoods;
  const frow = f => `<li><div class="row"><span class="grow"><b>${esc(foodName(f.name))}</b><span class="t2 blk num">${esc(`${f.src === 'off' ? 'Code-barres' : 'Créé'} · 100 g : ${f.per.k} kcal · ${dtMacros(f.per)}`)}</span></span>
    <button type="button" class="btn link danger" data-dt="food-rm" data-id="${esc(f.id)}" ${acc.consent ? '' : 'disabled'}>Retirer<span class="sr">${esc(` ${f.name}`)}</span></button></div></li>`;
  const mine = `<section aria-labelledby="h-dt-foods"><h2 class="gh" id="h-dt-foods">Mes aliments <span class="r">${esc(`${foods.length} sur ${DIET_FOODS_MAX}`)}</span></h2>
    ${foods.length ? `<ul class="group dt-foods" aria-labelledby="h-dt-foods">${foods.map(frow).join('')}</ul>` : '<div class="empty">Aucun aliment perso. Tu en crées un depuis la recherche d\'un aliment (« Créer un aliment »), ou avec son code-barres.</div>'}
    <div class="gfoot">Les aliments absents de la table Ciqual (skyr, whey, produits de marque). Les retirer ne change aucun plan.</div></section>`;
  return `${head}${consent}<div class="cols dtl">${plans}${mine}</div><p class="gfoot dt-src">${esc(DESK_DT_SOURCES)}</p>`;
}

// Éditeur (r : la ligne de l'élève dans l'onglet Nutrition, null dans « Plans diète »)
function deskDtFrameHtml(r) {
  const back = r ? `<p class="crumb"><a href="#/eleve/${encodeURIComponent(r.id)}/nutrition">${deskIcon('back', 'sm')}Nutrition de ${esc(r.name)}</a></p>`
    : '<p class="crumb"><a href="#/plans-diete">' + deskIcon('back', 'sm') + 'Plans diète</a></p>';
  if (dt.err) return `${back}<div class="empty" role="alert">${esc(dt.err === 'gone' ? 'Ce plan n\'existe plus.' : deskDtErr(dt.err))}</div>`;
  if (!dt.draft) return `${back}<div class="empty" role="status">Chargement du plan…</div>`;
  return back + deskDtEditorHtml(r);
}

function deskDtStatusText(r) {
  const dirty = deskDtDirty(), consent = dt.acc?.consent;
  if (dt.src === 'new' && dt.fresh) return 'Nouveau plan, pas encore enregistré.';
  if (dt.src === 'sent') return dirty ? `Version reçue par ${r?.name || 'ton élève'}, modifiée : pas encore envoyée.` : `Version reçue par ${r?.name || 'ton élève'} le ${fmtDate(dt.sentAt, 'short')}`;
  if (dirty) return consent ? 'Changements pas encore enregistrés.' : 'Changements gardés dans cet onglet seulement.';
  const p = dt.acc?.dietPlans?.[dt.id];
  return p?.updatedAt ? `Enregistré dans tes plans, modifié le ${fmtDate(p.updatedAt, 'short')}` : 'Enregistré dans tes plans.';
}

function deskDtEditorHtml(r) {
  const plan = dt.draft, days = dietPlanDays(plan), di = Math.min(dt.day, days.length - 1), day = days[di];
  const mode = plan.days?.mode || 'one';
  const modes = DESK_DT_MODES.map(([m, l]) => `<button type="button" role="radio" aria-checked="${m === mode}" class="${m === mode ? 'on' : ''}" data-dt="mode" data-v="${m}">${esc(l)}</button>`).join('');
  const dayTabs = plan.days ? `<div class="seg dt-days" role="radiogroup" aria-label="Jour du plan">${days.map((o, i) => {
    const k = dietDayKindAt(plan, i), kcal = dietPlanMacros(o).kcal;
    const name = mode === 'week' ? DIET_WEEKDAYS[i].slice(0, 3) + '.' : k === 't' ? 'Entraînement' : 'Repos';
    return `<button type="button" role="radio" aria-checked="${i === di}" class="${i === di ? 'on' : ''}" data-dt="day" data-v="${i}" aria-label="${esc(`${dietDayName(plan, i)}${mode === 'week' ? `, ${k === 'r' ? 'repos' : 'entraînement'}` : ''}, ${dtN(kcal)} kilocalories`)}">
      <span>${esc(name)}</span><em class="num">${esc(`${dtN(kcal)} kcal`)}</em>${mode === 'week' && k === 'r' ? '<span class="tag">Repos</span>' : ''}</button>`;
  }).join('')}</div>` : '';
  const kind = dietDayKindAt(plan, di);
  const dayTools = plan.days ? `<div class="ck-acts dt-daytools">
      ${mode === 'week' ? `<div class="seg" role="radiogroup" aria-label="${esc(`Type du ${DIET_WEEKDAYS[di].toLowerCase()}`)}"><button type="button" role="radio" aria-checked="${kind === 't'}" class="${kind === 't' ? 'on' : ''}" data-dt="kind" data-v="t">Entraînement</button><button type="button" role="radio" aria-checked="${kind === 'r'}" class="${kind === 'r' ? 'on' : ''}" data-dt="kind" data-v="r">Repos</button></div>` : ''}
      <button type="button" class="btn" data-dt="copy-day">${deskIcon('copy', 'sm')}Copier ce jour vers…</button>
      ${mode === 'week' ? '<button type="button" class="btn" data-dt="same-week">Mettre pareil sur les 7 jours</button>' : ''}
    </div>` : '';
  const shown = dietShownMeals(day);
  const meals = shown.map((m, i) => deskDtMealHtml(day, m, i, shown.length, plan)).join('');
  const hidden = day.meals.filter(m => m.hidden);
  const s = deskDtDaySummary(plan, di);
  const dayName = plan.days ? dietDayName(plan, di) : 'Chaque jour';
  const dirty = deskDtDirty(), student = r?.name;
  const canSave = !!dt.acc?.consent;
  return `<div class="head dt-head"><div class="grow">
      <label class="sr" for="dt-name">Nom du plan</label>
      <input id="dt-name" class="in wide dt-name" data-dt-f="name" maxlength="${DIET_NAME_MAX}" autocomplete="off" value="${esc(plan.name)}">
      <div class="sub" id="dt-status">${esc(deskDtStatusText(r))}</div></div></div>
    <div class="dt-modes"><span class="dt-lab" id="dt-mode-l">Jours</span><div class="seg" role="radiogroup" aria-labelledby="dt-mode-l">${modes}</div></div>
    ${dayTabs}${dayTools}
    <div class="cols dt">
      <div class="dt-main">
        <h2 class="gh">${esc(`Repas · ${dayName}`)}</h2>
        ${shown.length ? `<ul class="dt-meals" aria-label="${esc(`Repas, ${dayName}`)}">${meals}</ul>` : '<div class="empty">Aucun repas affiché. Ajoute un repas ci-dessous.</div>'}
        <p id="dt-grip-help" class="sr">Glisse la poignée pour changer l'ordre des repas, ou utilise les flèches haut et bas.</p>
        ${day.meals.length < DIET_MEAL_MAX ? `<form class="pg-add dt-addmeal" data-dt-form="meal"><label class="sr" for="dt-newmeal">Nom du nouveau repas</label>
          <input id="dt-newmeal" class="in wide" placeholder="Nouveau repas, par exemple « Avant la séance »" maxlength="${DIET_NAME_MAX}" autocomplete="off">
          <button class="btn link">${deskIcon('plus', 'sm')}Ajouter un repas</button></form>` : `<p class="gfoot">${esc(`${DIET_MEAL_MAX} repas au plus par jour.`)}</p>`}
        ${hidden.length ? `<h3 class="gh gap">Repas masqués</h3><div class="group">${hidden.map(m => `<button type="button" class="row act" data-dt="show-meal" data-meal="${esc(m.id)}">${esc(`Réafficher ${m.name}`)}</button>`).join('')}</div>
          <div class="gfoot">Un repas masqué n'est pas envoyé à l'élève ; ses aliments sont gardés.</div>` : ''}
      </div>
      <aside class="dt-side" aria-label="Bilan et objectifs">${deskDtSummaryHtml(s, dayName)}${deskDtTargetsHtml(day, dayName)}
        <section class="gblock"><h3 class="gh"><label for="dt-consigne">Consigne du plan</label></h3>
          <textarea id="dt-consigne" class="dt-ta" data-dt-f="consigne" rows="3" maxlength="${CONSIGNE_MAX}" placeholder="Par exemple : bois un grand verre d'eau à chaque repas">${esc(plan.consigne || '')}</textarea>
          <div class="gfoot">${esc(`Lue par l'élève sous le nom du plan. ${CONSIGNE_MAX} caractères au plus.`)}</div></section>
        ${dt.src === 'account' ? '<div class="gblock"><button type="button" class="btn danger wide" data-dt="delete">' + deskIcon('trash', 'sm') + 'Supprimer ce plan</button></div>' : ''}
      </aside>
    </div>
    <p class="gfoot dt-src">${esc(DESK_DT_SOURCES)}</p>
    <div class="savebar stick" role="region" aria-label="Enregistrement et envoi du plan">
      <span class="grow muted">${dirty ? deskIcon('pen', 'sm') : ''}${esc(canSave ? (dirty ? 'Pas encore enregistré.' : 'Tout est enregistré.') : 'Copie des plans sur ton compte désactivée : rien n\'est gardé après l\'envoi.')}</span>
      <button type="button" class="btn" data-dt="undo" ${dt.hist.past.length ? '' : 'disabled'} aria-keyshortcuts="Control+Z Meta+Z" aria-label="Annuler le dernier changement">Annuler</button>
      <button type="button" class="btn" data-dt="redo" ${dt.hist.future.length ? '' : 'disabled'} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">Rétablir</button>
      <button type="button" class="btn" data-dt="send-many" ${dt.busy ? 'disabled' : ''}>${esc(student ? 'Envoyer à plusieurs élèves' : 'Envoyer à des élèves')}</button>
      ${student ? `<button type="button" class="btn ${canSave ? 'tint' : 'fill'}" data-dt="send" ${dt.busy ? 'disabled aria-busy="true"' : ''}>${deskIcon('send', 'sm')}${esc(`Envoyer à ${student}`)}</button>` : ''}
      ${canSave ? `<button type="button" class="btn fill" data-dt="save" ${dt.busy || !dirty ? 'disabled' : ''} aria-keyshortcuts="Control+S Meta+S">Enregistrer</button>` : ''}
    </div>`;
}

function deskDtMealHtml(day, m, i, n, plan) {
  const t = dietMealMacros(m), open = dt.open === m.id, id = dtIdPart(m.id);
  const others = dietShownMeals(day).filter(x => x.id !== m.id);
  const items = m.items.map(it => deskDtItemHtml(m, it, others)).join('');
  const opts = open ? `<div class="dt-opts" id="dt-opts-${id}" role="group" aria-label="${esc(`Options de ${m.name}`)}">
      <div class="fld sm"><label for="dt-mn-${id}">Nom du repas</label><input id="dt-mn-${id}" data-dt-f="mealname" data-meal="${esc(m.id)}" maxlength="${DIET_NAME_MAX}" autocomplete="off" value="${esc(m.name)}"></div>
      <div class="fld sm"><label for="dt-note-${id}">Consigne du repas</label><textarea id="dt-note-${id}" class="dt-ta" data-dt-f="mealnote" data-meal="${esc(m.id)}" rows="2" maxlength="${DIET_NOTE_MAX}" placeholder="Par exemple : 1 h avant la séance">${esc(m.note || '')}</textarea></div>
      <div class="ck-acts">
        <button type="button" class="btn" data-dt="meal-up" data-meal="${esc(m.id)}" ${i === 0 ? 'aria-disabled="true"' : ''}>${deskIcon('up', 'sm')}Monter</button>
        <button type="button" class="btn" data-dt="meal-down" data-meal="${esc(m.id)}" ${i === n - 1 ? 'aria-disabled="true"' : ''}>${deskIcon('down', 'sm')}Descendre</button>
        ${day.meals.length < DIET_MEAL_MAX ? `<button type="button" class="btn" data-dt="meal-copy" data-meal="${esc(m.id)}">${deskIcon('copy', 'sm')}Dupliquer ce repas</button>` : ''}
        ${plan.days ? `<button type="button" class="btn" data-dt="meal-days" data-meal="${esc(m.id)}">Copier vers d'autres jours…</button>` : ''}
        <button type="button" class="btn danger" data-dt="meal-rm" data-meal="${esc(m.id)}">${deskIcon('trash', 'sm')}${m.base ? 'Masquer ce repas' : 'Supprimer le repas'}</button>
      </div></div>` : '';
  return `<li class="dt-meal" data-meal="${esc(m.id)}">
    <div class="dt-mh">
      <button type="button" class="ck-grip dt-grip" id="dt-grip-${id}" data-dt-grip="${esc(m.id)}" aria-label="${esc(`Déplacer ${m.name}, position ${i + 1} sur ${n}`)}" aria-describedby="dt-grip-help">${deskIcon('grip', 'sm')}</button>
      <div class="grow"><h3 class="dt-mt">${esc(m.name)}</h3><span class="t2 num">${m.items.length ? dtPair(esc(`${dtN(t.kcal)} kcal · ${dtMacros(t)}`), esc(`${dtN(t.kcal)} kilocalories, ${dtMacrosSpoken(t)}`)) : 'Aucun aliment'}</span>
        ${m.note && !open ? `<span class="cons">${esc(`« ${m.note} »`)}</span>` : ''}</div>
      <button type="button" class="btn link" data-dt="opts" data-meal="${esc(m.id)}" id="dt-ob-${id}" aria-expanded="${open}" aria-controls="dt-opts-${id}">Options<span class="sr">${esc(`, ${m.name}`)}</span></button>
    </div>
    ${opts}
    <ul class="group dt-items" aria-label="${esc(`Aliments de ${m.name}`)}">${items}
      <li><button type="button" class="row act dt-add" data-dt="add" data-meal="${esc(m.id)}" id="dt-add-${id}" ${m.items.length >= DIET_ITEM_MAX ? 'aria-disabled="true"' : ''}>${deskIcon('plus', 'sm')}<span class="grow">${esc(m.items.length >= DIET_ITEM_MAX ? `${DIET_ITEM_MAX} aliments au plus` : 'Ajouter un aliment')}</span></button></li>
    </ul></li>`;
}

// Quantité affichée dans le champ : nombre d'unités (« 2 », « 1,5 ») ou grammes
const dtQtyField = it => (it.por ? fmtNum(it.por.n, 1) : String(it.g));
function deskDtItemHtml(m, it, others) {
  const mac = dietItemMacros(it), id = `${dtIdPart(m.id)}-${dtIdPart(it.id)}`, units = dietQtyUnits(it, it.por);
  const mode = it.por ? units.findIndex(u => u.u === it.por.u) : -1;
  const src = it.src === 'off' ? 'Open Food Facts' : it.src === 'perso' ? 'Mon aliment' : it.of ? `Valeurs Ciqual : ${foodName(it.of)}` : 'Ciqual';
  const name = foodName(it.name);
  const unitSel = units.length ? deskCkSelectHtml(`dt-u-${id}`, `Unité de ${name}`, [['-1', 'g'], ...units.map((u, i) => [String(i), u.pl])], String(mode), `data-dt-f="unit" data-meal="${esc(m.id)}" data-item="${esc(it.id)}"`)
    : '<span class="muted">g</span>';
  const move = others.length ? deskCkSelectHtml(`dt-mv-${id}`, `Déplacer ${name} vers un autre repas`, [['', 'Déplacer…'], ...others.map(o => [o.id, o.name])], '', `data-dt-f="move" data-meal="${esc(m.id)}" data-item="${esc(it.id)}"`) : '';
  return `<li class="dt-it">
    <div class="dt-in"><b>${esc(name)}</b><small>${esc(`${src}${it.ecalc ? ' · kcal calculées' : ''}${it.por ? ` · ${dietQtyText(it)}` : ''}`)}</small></div>
    <div class="dt-q"><input class="in w" id="dt-q-${id}" data-dt-f="qty" data-meal="${esc(m.id)}" data-item="${esc(it.id)}" inputmode="decimal" autocomplete="off" value="${esc(dtQtyField(it))}" aria-label="${esc(`Quantité de ${name}, en ${it.por ? it.por.pl : 'grammes'}`)}">${unitSel}</div>
    <div class="dt-k num"><b>${dtPair(esc(`${dtN(mac.kcal)} kcal`), esc(`${dtN(mac.kcal)} kilocalories`))}</b><small>${dtPair(esc(dtMacros(mac)), esc(dtMacrosSpoken(mac)))}</small></div>
    <div class="dt-a"><button type="button" class="btn link" data-dt="swap" data-meal="${esc(m.id)}" data-item="${esc(it.id)}">Équivalents<span class="sr">${esc(` de ${name}`)}</span></button>${move}
      <button type="button" class="btn link danger ic" data-dt="rm" data-meal="${esc(m.id)}" data-item="${esc(it.id)}" aria-label="${esc(`Retirer ${name}`)}">${deskIcon('trash', 'sm')}</button></div>
  </li>`;
}

// Bilan du jour : total prévu face aux objectifs (barres neutres, la CSP refusant les styles en ligne)
function deskDtSummaryHtml(s, dayName) {
  const t = s.targets || {};
  const row = (label, v, goal, unit) => `<li><div class="row blk-row"><div class="mac-l"><span class="grow">${esc(label)}${goal ? ` <span class="muted sm-t">${Math.round(v / goal * 100)} %</span>` : ''}</span>
      <span class="num"><span class="strong">${esc(`${dtN(v)}${unit}`)}</span>${goal ? ` <span class="muted">${esc(`sur ${fmtNum(goal)}${unit}`)}</span>` : ''}</span></div>${goal ? deskNtBar(v / goal * 100) : ''}</div></li>`;
  return `<section class="gblock" aria-labelledby="h-dt-sum"><h3 class="gh" id="h-dt-sum">${esc(`Total prévu · ${dayName}`)}</h3>
    <ul class="group mac" aria-labelledby="h-dt-sum">${row('Calories', s.total.kcal, t.kcal, ' kcal')}${row('Protéines', s.total.p, t.p, ' g')}${row('Glucides', s.total.c, t.c, ' g')}${row('Lipides', s.total.f, t.f, ' g')}</ul>
    ${s.gap ? `<p class="dt-note" role="note">${esc(s.gap)}</p>` : ''}
    ${s.low ? `<p class="dt-note" role="note">${esc(`${t.kcal ? 'Cet objectif' : 'Ce plan'} est très bas pour un adulte qui s'entraîne. Les recommandations de santé réservent les régimes sous 1 200 kcal par jour à un suivi médical.`)}</p>` : ''}
    <div class="gfoot" aria-live="polite" id="dt-live-total">${esc(`${dtN(s.total.kcal)} kcal prévues`)}</div></section>`;
}
// Objectifs du jour : mêmes champs et mêmes règles que la feuille de l'app pour un coach (eau et sel en fourchette)
function deskDtTargetsHtml(day, dayName) {
  const t = day.targets || {};
  const f = (k, label, unit, v, mode = 'numeric') => `<label class="dt-tf"><span>${esc(label)}</span><input class="in w" id="dt-t-${k}" data-dt-f="tg" data-k="${k}" inputmode="${mode}" autocomplete="off" value="${v == null ? '' : esc(k === 'kcal' ? String(v) : fmtNum(v, 2))}" placeholder="Aucun" aria-label="${esc(`${label}${unit ? `, en ${unit === 'L' ? 'litres' : unit === 'kcal' ? 'kilocalories' : 'grammes'}` : ''}. Vide : aucun objectif`)}"><span class="muted">${unit}</span></label>`;
  const pair = (k, label, unit, lo, hi) => `<div class="dt-tf dt-range"><span>${esc(label)}</span>
      <input class="in w" id="dt-t-${k}Min" data-dt-f="tg" data-k="${k}Min" inputmode="decimal" autocomplete="off" value="${lo == null ? '' : esc(fmtNum(lo, 2))}" placeholder="de" aria-label="${esc(`${label}, au moins, en ${unit === 'L' ? 'litres' : 'grammes'}. Facultatif`)}">
      <span class="muted" aria-hidden="true">à</span>
      <input class="in w" id="dt-t-${k}Max" data-dt-f="tg" data-k="${k}Max" inputmode="decimal" autocomplete="off" value="${hi == null ? '' : esc(fmtNum(hi, 2))}" placeholder="Aucun" aria-label="${esc(`${label}, au plus, en ${unit === 'L' ? 'litres' : 'grammes'}. Vide : aucun objectif`)}"><span class="muted">${unit}</span></div>`;
  const salt = t.saltMax ?? t.saltMin;
  return `<section class="gblock" aria-labelledby="h-dt-tg"><h3 class="gh" id="h-dt-tg">${esc(`Objectifs · ${dayName}`)}</h3>
    <div class="group dt-tg">${f('kcal', 'Calories', 'kcal', t.kcal)}${f('p', 'Protéines', 'g', t.p, 'decimal')}${f('c', 'Glucides', 'g', t.c, 'decimal')}${f('f', 'Lipides', 'g', t.f, 'decimal')}
      ${pair('water', 'Eau', 'L', t.waterMin, t.water)}${pair('salt', 'Sel', 'g', t.saltMin, t.saltMax)}</div>
    <p class="err" id="dt-tg-err" role="alert">${esc(dt.tgErr || '')}</p>
    <div class="gfoot">Un champ vide ne fixe aucun objectif ; le total prévu sert alors de repère.${salt > DIET_SALT_WHO ? ' Repère de l\'OMS pour un adulte : moins de 5 g de sel par jour.' : ''}</div>
    <button type="button" class="btn link" data-dt="tg-clear">Aucun objectif</button></section>`;
}

// ── Gestes ──────────────────────────────────────────────────

// Geste sur le brouillon : état d'avant gardé (Annuler), puis rendu ; say : annonce aux lecteurs d'écran
function deskDtChange(fn, { key = null, say = '', render = true } = {}) {
  if (!dt.draft) return;
  const before = JSON.stringify(dt.draft);
  const r = fn(dt.draft);
  if (r === false || JSON.stringify(dt.draft) === before) return r;
  deskDtPush(dt.hist, before, key);
  if (say) deskAnnounce(say);
  if (render) deskPgRenderSafe();
  return r;
}
function deskDtUndoRedo(redo) {
  const p = redo ? deskDtRedo(dt.hist, dt.draft) : deskDtUndo(dt.hist, dt.draft);
  if (!p) return;
  dt.draft = p;
  dt.day = Math.min(dt.day, dietPlanDays(p).length - 1);
  deskRender();
  deskAnnounce(redo ? 'Changement rétabli' : 'Changement annulé');
}
// Champ encore en cours de saisie (au doigt, il ne perd le focus qu'après le toucher sur « Enregistrer ») : pris en compte
function deskDtCommitFocused() {
  const t = document.activeElement;
  if (t?.dataset?.dtF) deskDtField(t, true);
}

async function deskDtSave({ quiet = false } = {}) {
  if (!dt.draft || dt.busy) return { ok: false };
  deskDtCommitFocused();
  dt.busy = true; deskRender();
  const r = await deskWriteDiet(deskDtOpSave(dt.id, dt.draft));
  dt.busy = false;
  if (!r.ok) {
    if (r.kind === 'signed_out') { deskEndSession(); return r; }
    if (!quiet) deskToast(deskDtErr(r.kind));
    deskRender();
    return r;
  }
  Object.assign(dt, { acc: r.acc, accAt: Date.now() });
  deskDocCache.at = 0;   // « Envoyer un plan » de l'onglet Nutrition relit mon compte
  dt.saved = deskDtSnap(dt.draft); dt.fresh = false;
  if (dt.src !== 'sent') dt.src = 'account';
  // Plan neuf de l'onglet Nutrition : l'adresse prend son identifiant (sans nouvel écran)
  if (dt.ctx?.kind === 'student' && /\/nutrition\/new$/.test(location.hash)) {
    const h = `#/eleve/${encodeURIComponent(dt.ctx.sid)}/nutrition/${dt.id}`;
    history.replaceState(null, '', h); dt.key = deskDtRouteKey(h); deskHash = h;
  }
  deskRender();
  if (!quiet) deskToast(`Plan « ${dt.draft.name} » enregistré`);
  return r;
}

// Envoi : enregistré d'abord dans mes plans (avec l'accord), puis au format de l'app à chacun (file de l'app)
async function deskDtSend(ids) {
  deskDtCommitFocused();
  const v = deskDtPayload(dt.id, dt.draft);
  if (!v.ok) { deskToast(coachErrorText(v.kind)); return; }
  const limit = coachSendLimit(view.dash?.rows.length || 0);
  if (ids.length > limit) { deskToast(`La limite est de ${limit} envois sur 24 heures (30, plus 2 par élève) : décoche ${plural(ids.length - limit, 'élève', 'élèves')}.`); return; }
  let saved = null;
  if (dt.acc?.consent && deskDtDirty()) saved = await deskDtSave({ quiet: true });
  dt.busy = true; deskRender();
  const res = await coachSendQueue(ids, uid => deskSendProg(uid, v.progId, v.data));
  dt.busy = false;
  if (res.failed.some(f => f.kind === 'signed_out')) { deskEndSession(); return; }
  const sid = dt.ctx?.kind === 'student' ? dt.ctx.sid : null;
  if (sid && res.sent.includes(sid)) {
    if (dt.src === 'sent') { dt.sentAt = Date.now(); if (!dt.acc?.consent) dt.saved = deskDtSnap(dt.draft); }
    nt.at = 0;
  }
  deskRender();
  const nameOf = u => deskChatRow(u)?.name || 'élève';
  const keep = saved && !saved.ok ? ` (pas enregistré dans tes plans : ${deskDtErr(saved.kind)})` : '';
  if (!res.failed.length && !res.left) deskToast(`« ${v.data.diet.name} » envoyé à ${res.sent.length === 1 ? nameOf(res.sent[0]) : plural(res.sent.length, 'élève', 'élèves')}${keep}`);
  else {
    const why = res.rate ? coachErrorText('send_rate') : coachErrorText(res.failed[0]?.kind);
    const missed = [...res.failed.map(f => f.uid), ...ids.filter(u => !res.sent.includes(u) && !res.failed.some(f => f.uid === u))];
    await deskConfirm({ title: res.sent.length ? `Envoyé à ${res.sent.length} sur ${ids.length}` : 'Rien n\'a été envoyé',
      text: `${why} Pas reçu : ${missed.map(nameOf).join(', ')}.${keep}`, ok: 'OK', cancel: false });
  }
  deskRefresh({ force: true });
}
async function deskDtSendMany() {
  const v = deskDtPayload(dt.id, dt.draft);
  if (!v.ok) { deskToast(coachErrorText(v.kind)); return; }
  const far = deskDtFarDays(dt.draft);
  const sid = dt.ctx?.kind === 'student' ? dt.ctx.sid : null;
  const ids = await deskPickStudents({ title: `Envoyer « ${dt.draft.name} »`,
    text: `Les élèves cochés reçoivent ce plan ; un plan déjà envoyé sous ce nom est remplacé chez eux. Il leur faut avoir accepté les plans de leur coach dans l'app.${far.length ? ` Loin de l'objectif : ${far.join(' ; ')}` : ''}`, preset: sid ? [sid] : [] });
  if (ids?.length) await deskDtSend(ids);
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

// Champs (data-dt-f) : la frappe change le brouillon aussitôt (macros en direct) ; commit : le champ est quitté
function deskDtField(t, commit = false) {
  const f = t.dataset.dtF, day = deskDtDayObj(), mealId = t.dataset.meal, itemId = t.dataset.item;
  if (!day) return;
  if (f === 'name') {
    if (!commit && !t.value.trim()) return;
    if (commit && !deskDtRename(dt.draft, t.value)) { t.value = dt.draft.name; return; }
    deskDtChange(p => deskDtRename(p, t.value), { key: 'name' });
  } else if (f === 'consigne') deskDtChange(p => deskDtSetConsigne(p, t.value), { key: 'consigne', render: commit });
  else if (f === 'mealnote') deskDtChange(() => deskDtSetMealNote(deskDtDayObj(), mealId, t.value), { key: `note:${mealId}`, render: commit });
  else if (f === 'mealname') {
    if (!commit) return;
    const r = deskDtRenameMeal(dietDayObj(JSON.parse(JSON.stringify(dt.draft)), dt.day), mealId, t.value);
    if (!r.ok) { deskToast(DESK_DT_ERRORS[r.kind] || deskErrorText(r.kind)); t.value = deskDtMeal(day, mealId)?.name || ''; return; }
    deskDtChange(() => deskDtRenameMeal(deskDtDayObj(), mealId, t.value), { say: `Repas renommé : ${t.value.trim()}` });
  } else if (f === 'qty') {
    const it = deskDtItem(day, mealId, itemId);
    if (!it) return;
    const units = dietQtyUnits(it, it.por), mode = it.por ? units.findIndex(u => u.u === it.por.u) : -1;
    const q = dietQtyValue(units, mode, t.value);
    if (q.err) {
      if (commit) { deskToast(q.err); t.value = dtQtyField(it); }
      return;
    }
    deskDtChange(() => deskDtSetQty(deskDtItem(deskDtDayObj(), mealId, itemId), units, mode, t.value), { key: `qty:${mealId}:${itemId}` });
  } else if (f === 'unit') {
    const it = deskDtItem(day, mealId, itemId);
    if (!it) return;
    const units = dietQtyUnits(it, it.por), mode = Number(t.value);
    // Passer d'un mode à l'autre convertit (120 g → 2 œufs), comme la feuille de quantité de l'app
    const raw = mode < 0 ? String(it.g) : String(portionClampN(it.g / units[mode].g, units[mode]));
    deskDtChange(() => deskDtSetQty(deskDtItem(deskDtDayObj(), mealId, itemId), units, mode, raw), { say: mode < 0 ? `${it.g} grammes` : `En ${units[mode].pl}` });
  } else if (f === 'move') {
    if (!t.value) return;
    const to = deskDtMeal(day, t.value), it = deskDtItem(day, mealId, itemId);
    const r = deskDtChange(() => deskDtMoveItem(deskDtDayObj(), mealId, itemId, t.value), { say: to && it ? `${foodName(it.name)} déplacé vers ${to.name}` : '' });
    if (r && !r.ok) deskToast(DESK_DT_ERRORS[r.kind] || deskErrorText(r.kind));
  } else if (f === 'tg') {
    if (!commit) return;
    const read = k => document.getElementById(`dt-t-${k}`)?.value ?? '';
    const raw = { kcal: read('kcal'), p: read('p'), c: read('c'), f: read('f'), waterMin: read('waterMin'), waterMax: read('waterMax'), saltMin: read('saltMin'), saltMax: read('saltMax') };
    const test = dietTargetsFromForm(raw);
    // Erreur dite sous les champs, sans rendu (les autres valeurs tapées restent dans leurs champs)
    document.querySelectorAll('[data-dt-f="tg"][aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
    const err = document.getElementById('dt-tg-err');
    if (test.err) { dt.tgErr = test.err; if (err) err.textContent = test.err; document.getElementById(`dt-t-${test.field}`)?.setAttribute('aria-invalid', 'true'); return; }
    dt.tgErr = '';
    if (err) err.textContent = '';
    deskDtChange(() => deskDtSetTargets(deskDtDayObj(), raw));
    deskPgRenderSafe();
  }
}

document.addEventListener('input', e => {
  const t = e.target;
  if (!t.dataset?.dtF || !dt.draft || ['move', 'unit', 'tg', 'mealname'].includes(t.dataset.dtF)) return;
  deskDtField(t, false);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (!t.dataset?.dtF || !dt.draft) return;
  deskDtField(t, true);
});
document.addEventListener('keydown', e => {
  const t = e.target;
  if (e.key === 'Enter' && t.dataset?.dtF && t.tagName === 'INPUT') { e.preventDefault(); deskDtField(t, true); deskPgRenderSafe(); return; }
  if (!dt.draft || !(e.ctrlKey || e.metaKey) || e.altKey || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); if (dt.acc?.consent && deskDtDirty()) deskDtSave(); return; }
  // Annuler du navigateur dans un champ ; ailleurs, celui du plan
  if (t.matches?.('input, textarea, select')) return;
  if (k === 'z') { e.preventDefault(); deskDtUndoRedo(e.shiftKey); }
  else if (k === 'y') { e.preventDefault(); deskDtUndoRedo(true); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-dt-form="meal"]');
  if (!f || !dt.draft) return;
  e.preventDefault();
  const input = document.getElementById('dt-newmeal');
  const test = deskDtAddMeal(JSON.parse(JSON.stringify(deskDtDayObj())), input?.value || '');
  if (!test.ok) { deskToast(DESK_DT_ERRORS[test.kind] || `${DIET_MEAL_MAX} repas au plus.`); input?.focus(); return; }
  const name = input.value.trim();
  deskDtChange(() => deskDtAddMeal(deskDtDayObj(), name), { say: `Repas ${name} ajouté`, render: false });
  input.value = '';
  deskRender();
  const m = deskDtDayObj().meals.at(-1);
  document.getElementById(`dt-add-${dtIdPart(m.id)}`)?.focus();
});

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-dt]');
  if (!el) return;
  if (el.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
  const a = el.dataset.dt, mealId = el.dataset.meal, itemId = el.dataset.item;
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
  if (a === 'edit-sent' || a === 'new-for') return;   // liens (href) de l'onglet Nutrition
  if (!dt.draft) return;
  const day = deskDtDayObj();
  if (a === 'undo' || a === 'redo') { deskDtUndoRedo(a === 'redo'); return; }
  if (a === 'save') { deskDtSave(); return; }
  if (a === 'send') { if (dt.ctx?.kind === 'student') deskDtSend([dt.ctx.sid]); return; }
  if (a === 'send-many') { deskDtSendMany(); return; }
  if (a === 'delete') {
    if (!(await deskConfirm({ title: `Supprimer « ${dt.draft.name} » ?`, text: 'Il disparaît de tes plans, ici et dans l\'app. Les élèves qui l\'ont reçu le gardent.', ok: 'Supprimer', danger: true }))) return;
    const r = await deskWriteDiet(deskDtOpArchive(dt.id));
    if (!r.ok) { deskToast(deskDtErr(r.kind)); return; }
    Object.assign(dt, { acc: r.acc, accAt: Date.now() });
    deskDocCache.at = 0;
    const name = dt.draft.name;
    deskDtReset();
    location.hash = '#/plans-diete';
    deskToast(`Plan « ${name} » supprimé`);
    return;
  }
  if (a === 'mode') {
    const mode = el.dataset.v, cur = dt.draft.days?.mode || 'one';
    if (mode === cur) return;
    if (mode === 'one' && dt.draft.days && !(await deskConfirm({ title: 'Revenir à un seul jour ?', text: `Seul le ${dt.draft.days.mode === 'week' ? 'lundi' : 'jour d\'entraînement'} est gardé, pour tous les jours. Tu peux annuler ensuite.`, ok: 'Un seul jour' }))) return;
    deskDtChange(p => deskDtSetMode(p, mode), { say: mode === 'week' ? '7 jours, copies du premier jour' : mode === 'session' ? 'Jour d\'entraînement et jour de repos' : 'Un seul jour', render: false });
    dt.day = 0; deskRender();
    document.querySelector(`[data-dt="mode"][data-v="${mode}"]`)?.focus();
    return;
  }
  if (a === 'day') { dt.day = Number(el.dataset.v) || 0; dt.open = null; dt.tgErr = ''; deskRender(); document.querySelector(`[data-dt="day"][data-v="${dt.day}"]`)?.focus(); return; }
  if (a === 'kind') { deskDtChange(p => deskDtSetKind(p, dt.day, el.dataset.v), { say: el.dataset.v === 'r' ? 'Jour de repos' : 'Jour d\'entraînement' }); return; }
  if (a === 'copy-day') {
    const to = await deskDtPickDays(dt.draft, dt.day, `Copier ${dietDayName(dt.draft, dt.day).toLowerCase()} vers…`, 'Ses repas et ses objectifs remplacent ceux des jours cochés.');
    if (to?.length) deskDtChange(p => !!dietCopyDayToDays(p, dt.day, to), { say: `Copié vers ${plural(to.length, 'jour', 'jours')}` });
    return;
  }
  if (a === 'same-week') {
    if (!(await deskConfirm({ title: 'Mettre pareil sur les 7 jours ?', text: `Les repas et les objectifs du ${DIET_WEEKDAYS[dt.day].toLowerCase()} remplacent ceux des autres jours. Tu peux annuler ensuite.`, ok: 'Mettre pareil' }))) return;
    deskDtChange(p => !!dietCopyDayToDays(p, dt.day, [0, 1, 2, 3, 4, 5, 6]), { say: 'Les 7 jours sont pareils' });
    return;
  }
  if (a === 'opts') { dt.open = dt.open === mealId ? null : mealId; deskRender(); document.getElementById(`dt-ob-${dtIdPart(mealId)}`)?.focus(); return; }
  if (a === 'meal-up' || a === 'meal-down') {
    const shown = dietShownMeals(day), i = shown.findIndex(m => m.id === mealId);
    const pos = deskDtChange(() => deskDtMoveMeal(deskDtDayObj(), mealId, i + (a === 'meal-up' ? -1 : 1)), { render: false });
    if (pos) { deskAnnounce(`${shown[i].name} déplacé en position ${pos}`); deskRender(); document.querySelector(`[data-dt="${a}"][data-meal="${mealId}"]`)?.focus(); }
    return;
  }
  if (a === 'meal-copy') { deskDtChange(() => deskDtCopyMeal(deskDtDayObj(), mealId), { say: 'Repas dupliqué' }); return; }
  if (a === 'meal-days') {
    const m = deskDtMeal(day, mealId);
    const to = await deskDtPickDays(dt.draft, dt.day, `Copier ${m.name} vers…`, 'Il remplace le repas du même nom de chaque jour coché, sinon il s\'ajoute.');
    if (to?.length) deskDtChange(p => !!dietCopyMealToDays(p, dt.day, mealId, to), { say: `${m.name} copié vers ${plural(to.length, 'jour', 'jours')}` });
    return;
  }
  if (a === 'meal-rm') {
    const m = deskDtMeal(day, mealId);
    if (!m) return;
    if (!m.base && !(await deskConfirm({ title: `Supprimer ${m.name} ?`, text: m.items.length ? `${m.name} et ses ${plural(m.items.length, 'aliment', 'aliments')} sont retirés du plan. Tu peux annuler ensuite.` : `${m.name} est retiré du plan.`, ok: 'Supprimer', danger: true }))) return;
    dt.open = null;
    deskDtChange(() => deskDtRemoveMeal(deskDtDayObj(), mealId), { say: m.base ? `${m.name} masqué` : `${m.name} supprimé` });
    return;
  }
  if (a === 'show-meal') { deskDtChange(() => deskDtShowMeal(deskDtDayObj(), mealId), { say: 'Repas réaffiché' }); return; }
  if (a === 'rm') {
    const it = deskDtItem(day, mealId, itemId);
    if (!it) return;
    deskDtChange(() => deskDtRemoveItem(deskDtDayObj(), mealId, itemId), { say: `Retiré : ${foodName(it.name)}. Ctrl + Z pour annuler`, render: false });
    deskRender();
    document.getElementById(`dt-add-${dtIdPart(mealId)}`)?.focus();
    return;
  }
  if (a === 'tg-clear') {
    deskDtChange(() => { delete deskDtDayObj().targets; }, { say: 'Aucun objectif pour ce jour' });
    dt.tgErr = '';
    return;
  }
  if (a === 'add') { deskDtPick(mealId); return; }
  if (a === 'swap') { deskDtSwapDialog(mealId, itemId); }
});
window.addEventListener('beforeunload', e => { if (deskDtDirty()) { e.preventDefault(); e.returnValue = ''; } });

// ── Glisser-déposer des repas (poignée : souris, doigt, stylet ; flèches, Début, Fin au clavier) ──
// Même geste que l'ordre des suivis des bilans (js/desk/templates.js) : la ligne suit le pointeur, un trait montre où
// elle tombe, l'ordre est validé au relâchement et annoncé ; Échap remet l'ordre d'avant.
let deskDtDrag = null;
document.addEventListener('pointerdown', e => {
  const g = e.target.closest?.('[data-dt-grip]');
  if (!g || !dt.draft || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const li = g.closest('li.dt-meal');
  e.preventDefault();
  deskDtDrag = { meal: g.dataset.dtGrip, li, ul: li.parentElement, id: e.pointerId, y: e.clientY, moved: false, to: [...li.parentElement.children].indexOf(li) };
  try { g.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ }
  li.classList.add('drag');
});
function deskDtDropIndex(dr, y) {
  const sibs = [...dr.ul.children].filter(x => x !== dr.li);
  const i = sibs.findIndex(x => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return { to: i < 0 ? sibs.length : i, mark: i < 0 ? null : sibs[i] };
}
window.addEventListener('pointermove', e => {
  const dr = deskDtDrag;
  if (!dr || e.pointerId !== dr.id) return;
  e.preventDefault();
  const dy = e.clientY - dr.y;
  if (Math.abs(dy) > 3) dr.moved = true;
  dr.li.style.transform = `translateY(${dy}px)`;
  const { to, mark } = deskDtDropIndex(dr, e.clientY);
  dr.to = to;
  dr.ul.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  if (mark) mark.classList.add('drop-before'); else [...dr.ul.children].filter(x => x !== dr.li).at(-1)?.classList.add('drop-after');
}, { passive: false });
function deskDtMoveSay(mealId, to) {
  const m = deskDtMeal(deskDtDayObj(), mealId);
  const pos = deskDtChange(() => deskDtMoveMeal(deskDtDayObj(), mealId, to), { render: false });
  deskRender();
  if (pos && m) deskAnnounce(`${m.name} déplacé en position ${pos}`);
  document.getElementById(`dt-grip-${dtIdPart(mealId)}`)?.focus();
}
function deskDtDragEnd(e, cancel) {
  const dr = deskDtDrag;
  if (!dr || (e && e.pointerId !== dr.id)) return;
  deskDtDrag = null;
  if (cancel || !dr.moved) { deskRender(); return; }
  if (e) dr.to = deskDtDropIndex(dr, e.clientY).to;
  deskDtMoveSay(dr.meal, dr.to);
}
window.addEventListener('pointerup', e => deskDtDragEnd(e, false));
window.addEventListener('pointercancel', e => deskDtDragEnd(e, true));
document.addEventListener('dragstart', e => { if (e.target.closest?.('[data-dt-grip]') || deskDtDrag) e.preventDefault(); });
document.addEventListener('mousedown', e => { if (e.target.closest?.('[data-dt-grip]')) e.preventDefault(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && deskDtDrag) { deskDtDragEnd(null, true); return; }
  const g = e.target.closest?.('[data-dt-grip]');
  if (!g || !dt.draft) return;
  const shown = dietShownMeals(deskDtDayObj()), i = shown.findIndex(m => m.id === g.dataset.dtGrip);
  const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? shown.length - 1 : null;
  if (to === null || i < 0) return;
  e.preventDefault();
  deskDtMoveSay(g.dataset.dtGrip, to);
});

// ── Dialogues ───────────────────────────────────────────────

// Dialogue modal hors de #app (jamais effacé par un rendu) ; onClick(bouton data-p), onClose
function deskDtDialog(cls, label) {
  const dlg = document.createElement('dialog');
  dlg.className = `confirm ${cls}`;
  dlg.setAttribute('aria-label', label);
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  return dlg;
}

// Jours à cocher (copier un repas ou un jour) → [index] ou null
function deskDtPickDays(plan, except, title, text) {
  return new Promise(resolve => {
    const dlg = deskDtDialog('choose', title);
    const days = dietPlanDays(plan).map((_, i) => i).filter(i => i !== except);
    const on = new Set(days.length === 1 ? days : []);
    const paint = () => {
      dlg.querySelector('.ch-list').innerHTML = days.map(i => `<button type="button" role="checkbox" class="row ch-o" id="pd-${i}" data-v="${i}" aria-checked="${on.has(i)}">
        <span class="circ" aria-hidden="true">${deskIcon('check', 'xs')}</span><span class="grow">${esc(dietDayName(plan, i))}<span class="t2 blk num">${esc(`${dtN(dietPlanMacros(dietDayObj(plan, i)).kcal)} kcal`)}</span></span></button>`).join('');
      const go = dlg.querySelector('[data-cf="yes"]');
      go.disabled = !on.size;
      go.textContent = on.size ? `Copier vers ${plural(on.size, 'jour', 'jours')}` : 'Copier';
      frTypoNode(dlg);
    };
    dlg.innerHTML = `<h2 class="dlg-t">${esc(title)}</h2><p class="dlg-p">${esc(text)}</p><div class="group ch-list" role="group" aria-label="Jours"></div>
      <div class="dlg-f"><button type="button" class="btn" data-cf="no">Annuler</button><button type="button" class="btn fill" data-cf="yes">Copier</button></div>`;
    paint();
    let answer = null;
    dlg.addEventListener('click', e => {
      const o = e.target.closest('.ch-o');
      if (o) { const v = Number(o.dataset.v); if (on.has(v)) on.delete(v); else on.add(v); paint(); dlg.querySelector(`#pd-${v}`)?.focus(); return; }
      const b = e.target.closest('[data-cf]');
      if (!b) return;
      answer = b.dataset.cf === 'yes' ? [...on] : null;
      dlg.close();
    });
    dlg.addEventListener('close', () => resolve(answer));
    dlg.showModal();
    dlg.querySelector('.ch-o')?.focus();
  });
}

// Équivalents d'un aliment (même règle et même liste que l'app : swapCandidates), quantité déjà calculée
async function deskDtSwapDialog(mealId, itemId) {
  const it = deskDtItem(deskDtDayObj(), mealId, itemId);
  if (!it) return;
  await loadFoods(DESK_FOODS_URL);
  const cands = swapCandidates(it, { own: dt.acc?.dietFoods || [] }), ref = dietItemMacros(it);
  const dlg = deskDtDialog('dt-dlg', `Équivalents de ${foodName(it.name)}`);
  const rows = cands.map((c, i) => {
    const d = Math.round(c.macros.kcal) - Math.round(ref.kcal), tag = foodCookTag(c.food);
    return `<button type="button" class="row ch-o dt-cand" data-c="${i}"><span class="grow"><b>${esc(foodName(c.food.name))}</b>
      <span class="t2 blk num"><b>${esc(`${c.g} g${tag ? ` ${tag}` : ''}`)}</b>${esc(` · ${dtN(c.macros.kcal)} kcal · ${dtMacros(c.macros)}`)}</span></span><span class="v num">${esc(swapDeltaText(d, 'kcal'))}</span></button>`;
  }).join('');
  dlg.innerHTML = `<h2 class="dlg-t">Équivalents</h2>
    <p class="dlg-p"><b>${esc(foodName(it.name))}</b> · ${esc(`${dietQtyText(it)} · ${dtN(ref.kcal)} kcal · ${dtMacros(ref)}`)}</p>
    <p class="dlg-p">${esc(`${swapRuleText(it)}, quantité déjà calculée. Remplace l'aliment dans ce repas du plan.`)}</p>
    ${cands.length ? `<div class="group dt-list" role="group" aria-label="Équivalents proposés">${rows}</div>` : `<p class="empty">${esc(foodDb ? 'Aucun équivalent assez proche dans la base pour cet aliment.' : 'Base d\'aliments indisponible pour l\'instant.')}</p>`}
    <p class="gfoot">P protéines · G glucides · L lipides</p>
    <div class="dlg-f"><button type="button" class="btn" data-cf="no">Fermer</button></div>`;
  frTypoNode(dlg);
  dlg.addEventListener('click', e => {
    const b = e.target.closest('[data-c]');
    if (b) {
      const c = cands[Number(b.dataset.c)];
      const nu = deskDtChange(() => deskDtSwap(deskDtDayObj(), mealId, itemId, c), { say: `Remplacé par ${foodName(c.food.name)}, ${c.g} grammes. Ctrl + Z pour annuler`, render: false });
      dlg.close(); deskRender();
      if (nu) deskToast(`Remplacé par ${foodName(c.food.name)}`);
      document.getElementById(`dt-q-${dtIdPart(mealId)}-${dtIdPart(itemId)}`)?.focus();
      return;
    }
    if (e.target.closest('[data-cf]')) dlg.close();
  });
  dlg.showModal();
  (dlg.querySelector('[data-c]') || dlg.querySelector('[data-cf]')).focus();
}

// Ajouter un aliment à un repas : recherche (Ciqual et Mes aliments), quantité, création d'un aliment perso, code-barres
// saisi (Open Food Facts). « Ajouter et continuer » garde le dialogue ouvert pour l'aliment suivant.
function deskDtPick(mealId) {
  const meal = deskDtMeal(deskDtDayObj(), mealId);
  if (!meal) return;
  deskDtFoods();
  const dlg = deskDtDialog('dt-dlg dt-pick', `Ajouter un aliment à ${meal.name}`);
  const st = { step: 'search', q: '', results: [], active: 0, food: null, units: [], mode: -1, query: '', code: '', off: null, kept: true };
  const own = () => dt.acc?.dietFoods || [];
  const foot = btns => `<div class="dlg-f">${btns}</div>`;
  const header = `<h2 class="dlg-t">${esc(`Ajouter à ${meal.name}`)}</h2>`;
  const go = (step, focus) => { st.step = step; paint(); const f = focus && dlg.querySelector(focus); if (f) { f.focus(); f.select?.(); } };
  const list = () => {
    if (dt.foods !== 'ready' && !own().length) return `<p class="dlg-p">${dt.foods === 'error' ? 'Base d\'aliments indisponible. Tu peux créer ton aliment.' : 'Chargement de la table Ciqual…'}</p>`;
    if (!st.q.trim()) return `<p class="dlg-p">${esc(`Tape un aliment : « riz », « poulet », « crème de riz ».${foodDb ? ` ${fmtNum(foodDb.byCode.size)} aliments de la table Ciqual, accents et majuscules ignorés.` : ''}`)}</p>`;
    const create = foodSearchExact(st.q, st.results) ? '' : `<li role="option" id="dtp-create" class="row ch-o dt-cand" data-p="create-typed" aria-selected="false">${deskIcon('plus', 'sm')}<span class="grow"><b>${esc(`Créer « ${dietCutName(st.q)} »`)}</b><span class="t2 blk">Valeurs de l'étiquette pour 100 g</span></span></li>`;
    if (!st.results.length) return `<ul class="group dt-list" role="listbox" id="dtp-list" aria-label="Résultats">${create}</ul><p class="dlg-p">${esc(`Rien pour « ${st.q} » dans la table Ciqual.`)}</p>`;
    return `<ul class="group dt-list" role="listbox" id="dtp-list" aria-label="Résultats">${st.results.map((x, i) => {
      const tag = foodCookTag(x.food);
      return `<li role="option" id="dtp-o-${i}" class="row ch-o dt-cand${i === st.active ? ' on' : ''}" data-p="pick" data-i="${i}" aria-selected="${i === st.active}"><span class="grow"><b>${esc(foodName(x.food.name))}</b>
        <span class="t2 blk num">${esc([tag, x.own ? 'Mon aliment' : '', x.food.of ? `Valeurs Ciqual : ${foodName(x.food.of)}` : '', `100 g · ${x.food.per.k} kcal${x.food.ecalc ? ' (calculées)' : ''} · ${dtMacros(x.food.per)}`].filter(Boolean).join(' · '))}</span></span></li>`;
    }).join('')}${create}</ul>`;
  };
  const qtyHtml = () => {
    const f = st.food, units = st.units, v = st.mode < 0 ? (st.g ?? 100) : (st.n ?? 1);
    const q = dietQtyValue(units, st.mode, String(v)), m = q.err ? null : dietItemMacros({ g: q.g, per: f.per });
    const twin = st.twin ? `<p class="dt-note" role="note"><span>${esc(`Pesé ${foodCookTag(st.twin) === 'cuit' ? 'cuit' : 'cru'} ? Les valeurs ne sont pas les mêmes.`)}</span> <button type="button" class="btn link" data-p="twin">${esc(`Prendre ${foodName(st.twin.name)}`)}</button></p>` : '';
    return `${header}<p class="dlg-p"><b>${esc(foodName(f.name))}</b><br><span class="num">${esc(`100 g · ${f.per.k} kcal · ${dtMacros(f.per)}`)}</span></p>
      ${units.length ? `<div class="seg" role="radiogroup" aria-label="Quantité en"><button type="button" role="radio" aria-checked="${st.mode < 0}" class="${st.mode < 0 ? 'on' : ''}" data-p="mode" data-v="-1">Grammes</button>${units.map((u, i) => `<button type="button" role="radio" aria-checked="${st.mode === i}" class="${st.mode === i ? 'on' : ''}" data-p="mode" data-v="${i}">${esc(dietQtyLabel(u))}</button>`).join('')}</div>` : ''}
      <div class="dt-qrow"><button type="button" class="btn ic" data-p="step" data-v="-1" aria-label="Moins">−</button>
        <label class="sr" for="dtp-qty">${esc(st.mode < 0 ? 'Quantité en grammes' : `Nombre de ${units[st.mode].pl}`)}</label>
        <input id="dtp-qty" class="in w dt-qin" inputmode="decimal" autocomplete="off" value="${esc(fmtNum(v, 1))}"><span class="muted">${esc(st.mode < 0 ? 'g' : (v >= 2 ? units[st.mode].pl : units[st.mode].u))}</span>
        <button type="button" class="btn ic" data-p="step" data-v="1" aria-label="Plus">+</button></div>
      <p class="dlg-p num" id="dtp-eq" aria-live="polite">${esc(q.err ? q.err : `${q.por ? `${portionText(q.por.n, q.por)} · ` : ''}${q.g} g · ${dtN(m.kcal)} kcal · ${dtMacros(m)}`)}</p>
      ${st.mode >= 0 && units[st.mode].about ? `<p class="gfoot">${esc(`1 ${units[st.mode].u} : environ ${fmtNum(units[st.mode].g)} g, poids moyen.`)}</p>` : ''}
      ${twin}${st.off ? `<p class="gfoot">${esc(DESK_DT_OFF)}${st.kept ? '' : ` ${DESK_DT_ERRORS.foods_full}`}</p>` : ''}
      ${foot(`<button type="button" class="btn" data-p="back">Retour</button><span class="grow"></span><button type="button" class="btn" data-p="add-more">Ajouter et continuer</button><button type="button" class="btn fill" data-p="add">Ajouter</button>`)}`;
  };
  const createHtml = () => {
    const fld = (id, label, unit, ph = '0') => `<label class="dt-tf"><span>${esc(label)}</span><input class="in w" id="dtp-${id}" inputmode="decimal" autocomplete="off" placeholder="${ph}"><span class="muted">${unit}</span></label>`;
    return `<h2 class="dlg-t">Nouvel aliment</h2>
      <div class="fld sm"><label for="dtp-name">Nom</label><input id="dtp-name" maxlength="${DIET_FOOD_NAME_MAX}" autocomplete="off" value="${esc(st.newName || '')}" placeholder="Skyr nature"></div>
      ${st.code ? `<p class="gfoot num">${esc(`Code-barres ${barcodeShown(st.code)}, gardé avec l'aliment.`)}</p>` : ''}
      <p class="dlg-p">Recopie les valeurs de l'étiquette pour 100 g. Sans énergie, elle est calculée : 4 kcal par gramme de protéines ou de glucides, 9 de lipides.</p>
      <div class="group dt-tg">${fld('k', 'Énergie', 'kcal')}${fld('p', 'Protéines', 'g')}${fld('c', 'Glucides', 'g')}${fld('f', 'Lipides', 'g')}${fld('portion', 'Une portion', 'g', 'Facultatif')}</div>
      <div class="fld sm"><label for="dtp-fam">Famille, pour les équivalences</label>${deskCkSelectHtml('dtp-fam', 'Famille', [['', 'Selon ses macros'], ...DIET_FAMS.filter(x => x !== 'a').map(x => [x, FOOD_FAM_LABEL[x]])], '')}</div>
      <p class="gfoot">L'énergie de l'étiquette compte aussi les fibres et l'alcool : elle peut dépasser ce calcul. L'aliment est gardé dans Mes aliments, ici et dans l'app.</p>
      <p class="err" id="dtp-err" role="alert"></p>
      ${foot('<button type="button" class="btn" data-p="back">Retour</button><span class="grow"></span><button type="button" class="btn fill" data-p="create-ok">Créer</button>')}`;
  };
  const OFF_TEXT = { unknown: 'Ce code-barres n\'est pas dans Open Food Facts. Crée l\'aliment avec les valeurs de l\'étiquette.', incomplete: 'Il manque des valeurs pour 100 g dans Open Food Facts. Recopie-les depuis l\'étiquette.',
    offline: 'La recherche demande une connexion. Réessaie, ou crée l\'aliment avec l\'étiquette.', slow: 'Open Food Facts ne répond pas pour ce produit. Réessaie, ou crée l\'aliment avec l\'étiquette.',
    error: 'Open Food Facts ne répond pas. Réessaie dans un moment, ou crée l\'aliment avec l\'étiquette.', bad: 'Ce code ne tient pas. Un code-barres a 13 chiffres, parfois 8 ou 12.' };
  const barcodeHtml = () => `<h2 class="dlg-t">Code-barres</h2>
      <p class="dlg-p">Le scan se fait dans l'app iPhone. Ici, tape les chiffres écrits sous les barres du paquet : le produit est cherché sur Open Food Facts.</p>
      <form class="pg-add" data-p-form="code"><label class="sr" for="dtp-code">Code-barres</label><input id="dtp-code" class="in wide num" inputmode="numeric" autocomplete="off" maxlength="20" placeholder="3017620422003" value="${esc(st.codeRaw || '')}">
        <button class="btn tint" ${st.busy ? 'disabled aria-busy="true"' : ''}>Rechercher</button></form>
      <p class="dlg-p" role="status">${esc(st.busy ? 'Recherche du produit…' : st.offKind ? OFF_TEXT[st.offKind] || OFF_TEXT.error : '')}</p>
      ${st.offKind && st.offKind !== 'bad' ? '<button type="button" class="btn" data-p="create-code">Créer l\'aliment</button>' : ''}
      <p class="gfoot">${esc(DESK_DT_OFF)}</p>
      ${foot('<button type="button" class="btn" data-p="back">Retour</button>')}`;
  const paint = () => {
    if (st.step === 'search') {
      dlg.innerHTML = `${header}<div class="search"><span aria-hidden="true">${deskIcon('search', 'sm')}</span><input id="dtp-q" type="search" maxlength="${SEARCH_MAX}" role="combobox" aria-autocomplete="list" aria-expanded="${st.results.length > 0}" aria-controls="dtp-list" ${st.results.length ? `aria-activedescendant="dtp-o-${st.active}"` : ''} placeholder="Rechercher un aliment" aria-label="Rechercher un aliment" autocomplete="off" value="${esc(st.q)}"></div>
        <div class="dt-res" id="dtp-res">${list()}</div>
        <p class="sr" id="dtp-count" aria-live="polite"></p>
        <div class="ck-acts dt-pick-alt"><button type="button" class="btn link" data-p="barcode">Produit de marque ? Saisir le code-barres</button><button type="button" class="btn link" data-p="create">${deskIcon('plus', 'sm')}Créer un aliment</button></div>
        ${foot('<button type="button" class="btn" data-p="close">Fermer</button>')}`;
    } else if (st.step === 'qty') dlg.innerHTML = qtyHtml();
    else if (st.step === 'create') dlg.innerHTML = createHtml();
    else dlg.innerHTML = barcodeHtml();
    frTypoNode(dlg);
  };
  const repaintList = () => {
    const res = dlg.querySelector('#dtp-res');
    if (!res) return;
    res.innerHTML = list();
    frTypoNode(res);
    const q = dlg.querySelector('#dtp-q');
    q.setAttribute('aria-expanded', String(st.results.length > 0));
    if (st.results.length) q.setAttribute('aria-activedescendant', `dtp-o-${st.active}`); else q.removeAttribute('aria-activedescendant');
    dlg.querySelector(`#dtp-o-${st.active}`)?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (food, query = '', { twin = true } = {}) => {
    st.food = food; st.units = dietQtyUnits(food); st.mode = st.units.length ? 0 : -1; st.g = 100; st.n = 1; st.query = query;
    st.twin = twin && !foodQuerySaysCook(query) && food.code ? foodCookTwin(food) : null;
    go('qty', '#dtp-qty');
  };
  const qtyRead = () => {
    const raw = dlg.querySelector('#dtp-qty')?.value ?? '';
    return dietQtyValue(st.units, st.mode, raw);
  };
  const add = more => {
    const q = qtyRead();
    if (q.err) { dlg.querySelector('#dtp-eq').textContent = q.err; dlg.querySelector('#dtp-qty').focus(); return; }
    const r = deskDtChange(() => deskDtAddItem(deskDtDayObj(), mealId, st.food, q.g, q.por), { render: false });
    if (r && !r.ok) { deskToast(DESK_DT_ERRORS[r.kind] || deskErrorText(r.kind)); return; }
    deskRender();
    deskAnnounce(`Ajouté à ${meal.name} : ${foodName(st.food.name)}, ${q.g} grammes`);
    if (more && deskDtMeal(deskDtDayObj(), mealId)?.items.length < DIET_ITEM_MAX) { st.q = ''; st.results = []; st.off = null; go('search', '#dtp-q'); deskToast(`Ajouté : ${foodName(st.food.name)}`); }
    else dlg.close();
  };
  // Aliment perso : gardé dans Mes aliments (avec l'accord), le plan le reçoit dans tous les cas
  const keep = async (op, food) => {
    if (!dt.acc?.consent) { deskToast('Aliment ajouté au plan, pas gardé dans Mes aliments (copie des plans sur ton compte désactivée).'); return food; }
    const r = await deskWriteDiet(op);
    if (r.ok) { Object.assign(dt, { acc: r.acc, accAt: Date.now() }); return r.result.food; }
    deskToast(deskDtErr(r.kind));
    return food;
  };
  const lookup = async () => {
    const raw = dlg.querySelector('#dtp-code')?.value || '';
    st.codeRaw = raw;
    const code = normBarcode(raw);
    if (!code) { st.offKind = 'bad'; paint(); dlg.querySelector('#dtp-code').focus(); return; }
    st.code = code;
    const local = dietFoodByCode(own(), code);
    if (local) { st.off = local.src === 'off'; st.kept = true; choose(dietOwnPick(local), '', { twin: false }); return; }
    st.busy = true; st.offKind = null; paint();
    const r = await offLookup(code, { userAgent: offUserAgent(null, 'web') });
    st.busy = false;
    if (!dlg.isConnected) return;
    if (r.status === 'found') {
      const full = dietScanFull({ dietFoods: own() }, r.food);
      st.kept = !full && !!dt.acc?.consent;
      const saved = full ? r.food : await keep(deskDtOpKeepScanned(r.food), r.food);
      st.off = true;
      choose(dietOwnPick(saved), '', { twin: false });
      return;
    }
    st.offKind = OFF_TEXT[r.status] ? r.status : 'error';
    st.newName = r.status === 'incomplete' ? r.name || '' : '';
    paint();
    dlg.querySelector('[data-p="create-code"]')?.focus();
  };
  dlg.addEventListener('input', e => {
    if (e.target.id === 'dtp-q') {
      st.q = e.target.value; st.active = 0;
      st.results = searchFoods(st.q, { own: own(), limit: 40 });
      repaintList();
      clearTimeout(st.countT);
      st.countT = setTimeout(() => { const c = dlg.querySelector('#dtp-count'); if (c) c.textContent = !st.q.trim() ? '' : st.results.length ? plural(st.results.length, 'résultat', 'résultats') : 'Aucun résultat'; }, 400);
    } else if (e.target.id === 'dtp-qty') {
      const q = qtyRead(), el = dlg.querySelector('#dtp-eq');
      if (st.mode < 0) st.g = q.g ?? st.g; else st.n = q.por?.n ?? st.n;
      const m = q.err ? null : dietItemMacros({ g: q.g, per: st.food.per });
      el.textContent = q.err ? q.err : `${q.por ? `${portionText(q.por.n, q.por)} · ` : ''}${q.g} g · ${dtN(m.kcal)} kcal · ${dtMacros(m)}`;
      frTypoNode(el);
    }
  });
  dlg.addEventListener('keydown', e => {
    if (e.target.id === 'dtp-q') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!st.results.length) return;
        e.preventDefault();
        st.active = Math.max(0, Math.min(st.results.length - 1, st.active + (e.key === 'ArrowDown' ? 1 : -1)));
        repaintList();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const hit = st.results[st.active];
        if (hit) choose(hit.food, st.q);
        else if (st.q.trim()) { st.newName = dietCutName(st.q).replace(/^./, c => c.toUpperCase()); st.code = ''; go('create', '#dtp-k'); }
      }
    } else if (e.target.id === 'dtp-qty' && e.key === 'Enter') { e.preventDefault(); add(e.shiftKey); }
    else if (e.key === 'Enter' && st.step === 'create' && e.target.tagName === 'INPUT') { e.preventDefault(); dlg.querySelector('[data-p="create-ok"]').click(); }
  });
  dlg.addEventListener('submit', e => { if (e.target.closest('[data-p-form="code"]')) { e.preventDefault(); lookup(); } });
  dlg.addEventListener('click', async e => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const p = b.dataset.p;
    if (p === 'close') dlg.close();
    else if (p === 'pick') { const hit = st.results[Number(b.dataset.i)]; if (hit) choose(hit.food, st.q); }
    else if (p === 'create' || p === 'create-typed') { st.newName = p === 'create-typed' ? dietCutName(st.q).replace(/^./, c => c.toUpperCase()) : ''; st.code = ''; go('create', p === 'create-typed' ? '#dtp-k' : '#dtp-name'); }
    else if (p === 'create-code') { go('create', '#dtp-name'); }
    else if (p === 'barcode') { st.offKind = null; st.code = ''; go('barcode', '#dtp-code'); }
    else if (p === 'back') { st.offKind = null; go('search', '#dtp-q'); repaintList(); }
    else if (p === 'twin' && st.twin) choose(st.twin, '', { twin: false });
    else if (p === 'mode') {
      const v = Number(b.dataset.v), q = qtyRead(), g = q.g ?? (st.mode < 0 ? st.g : 100);
      st.mode = v;
      if (v < 0) st.g = g; else st.n = portionClampN(g / st.units[v].g, st.units[v]);
      paint(); dlg.querySelector(`[data-p="mode"][data-v="${v}"]`)?.focus();
    } else if (p === 'step') {
      const inp = dlg.querySelector('#dtp-qty'), cur = num(inp.value, 0, 100000) ?? 0, d = Number(b.dataset.v);
      if (st.mode < 0) st.g = Math.max(1, Math.min(DIET_G_MAX, Math.round(cur / 10) * 10 + d * 10));
      else st.n = portionClampN(cur + d * portionStep(st.units[st.mode]), st.units[st.mode]);
      paint(); dlg.querySelector(`[data-p="step"][data-v="${b.dataset.v}"]`)?.focus();
    } else if (p === 'add' || p === 'add-more') add(p === 'add-more');
    else if (p === 'create-ok') {
      const v = id => dlg.querySelector(`#dtp-${id}`)?.value ?? '';
      const r = dietFoodFromForm({ name: v('name'), k: v('k'), p: v('p'), c: v('c'), f: v('f'), portion: v('portion'), fam: v('fam') }, { code: st.code || null });
      const err = dlg.querySelector('#dtp-err');
      dlg.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
      if (r.err) {
        err.textContent = r.err;
        const field = dlg.querySelector(`#dtp-${{ name: 'name', k: 'k', portion: 'portion' }[r.field] || 'p'}`);
        field?.setAttribute('aria-invalid', 'true'); field?.focus();
        return;
      }
      const full = dietFoodsFull(own(), r.food);
      st.kept = !full;
      const saved = full ? (deskToast(DESK_DT_ERRORS.foods_full), r.food) : await keep(deskDtOpKeepFood(r.food), r.food);
      st.off = null;
      choose(dietOwnPick(saved), '', { twin: false });
    }
  });
  paint();
  dlg.showModal();
  dlg.querySelector('#dtp-q')?.focus();
  if (dt.foods !== 'ready') loadFoods(DESK_FOODS_URL).then(() => { if (dlg.isConnected && st.step === 'search') { st.results = searchFoods(st.q, { own: own(), limit: 40 }); repaintList(); } });
}
