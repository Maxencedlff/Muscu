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
//  - Liste « Plans diète » et Mes aliments : js/desk/diet-lib.js ; dialogues (ajouter un aliment, équivalents, jours) :
//    js/desk/diet-pick.js.
// ═══════════════════════════════════════════════════════════
'use strict';

// Base Ciqual vue de la page (le site construit la sert à côté, le dépôt un dossier plus haut : balise de index.html)
const DESK_FOODS_URL = document.querySelector?.('meta[name="mdlf-foods"]')?.content || 'data/foods.json';
const dt = { acc: null, accAt: 0, accKind: null, accLoading: false,
  key: null, ctx: null, id: null, draft: null, saved: '', fresh: false, src: null, sentAt: 0, baseAt: null, copyId: null,
  day: 0, hist: deskDtHistory(), open: null, busy: false, foods: 'idle', err: null };

const deskDtDirty = () => !!dt.draft && (dt.fresh || deskDtSnap(dt.draft) !== dt.saved);
const deskDtDayObj = () => dietDayObj(dt.draft, dt.day);
const deskDtErr = kind => DESK_DT_ERRORS[kind] || (COACH_ERROR_TEXT[kind] ? coachErrorText(kind) : deskErrorText(kind));
function deskDtReset() { Object.assign(dt, { key: null, ctx: null, id: null, draft: null, saved: '', fresh: false, src: null, sentAt: 0, baseAt: null, copyId: null, day: 0, hist: deskDtHistory(), open: null, err: null, tgErr: '' }); }
async function deskDtLeaveOk() {
  if (!deskDtDirty()) return true;
  if (dt.src === 'sent') return deskConfirm({ title: 'Quitter sans envoyer ?', text: 'Tes changements pour cet élève seront perdus. Touche « Envoyer » pour qu\'il les reçoive.', ok: 'Quitter sans envoyer', danger: true });
  return deskConfirm({ title: 'Quitter sans enregistrer le plan ?', text: 'Tes changements seront perdus. Touche « Enregistrer » pour les garder dans tes plans.', ok: 'Quitter sans enregistrer', danger: true });
}
// L'éditeur est-il à l'écran ? (raccourcis clavier seulement là)
const deskDtOnScreen = () => !!dt.draft && deskDtRouteKey(location.hash) === dt.key;
// iPhone resté sur une version d'avant la fusion des plans (js/data/sync.js) : il pourrait remettre son ancienne
// version d'un plan modifié ici. Le profil du compte le dit (dietSyncV, posé par l'app à jour avec l'accord)
const deskDtOldPhone = () => !!dt.acc?.consent && !dt.acc.syncOk;
const deskDtCanSave = () => !!dt.acc?.consent && !deskDtOldPhone();
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
// baseAt : date du plan du compte à l'ouverture (brouillon périmé si elle a changé à l'enregistrement)
function deskDtUse({ key, ctx, id, plan, fresh = false, src, sentAt = 0 }) {
  Object.assign(dt, { key, ctx, id, draft: deskDtDraft(plan), fresh, src, sentAt, day: 0, hist: deskDtHistory(), open: null, err: null, tgErr: '', copyId: null,
    baseAt: src === 'account' ? Number(plan.updatedAt) || 0 : null });
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
    // Version reçue par l'élève : l'envoi ne change que SON plan ; mon plan modèle (même identifiant) n'est jamais
    // remplacé par elle. Elle se garde, si le coach le veut, comme un nouveau plan (« Sèche (lea) »)
    deskDtUse({ key, ctx, id, plan: sent.data, src: 'sent', sentAt: sent.sentAt });
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
  if (dt.src === 'sent') return `${dirty ? `Version de ${r?.name || 'ton élève'}, modifiée : pas encore envoyée.` : `Version reçue par ${r?.name || 'ton élève'} le ${fmtDate(dt.sentAt, 'short')}.`} L'envoi ne change que son plan, pas ton plan « ${dt.acc?.dietPlans?.[dt.id]?.name || dt.draft.name} ».`;
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
  const canSave = deskDtCanSave(), sent = dt.src === 'sent';
  return `<div class="head dt-head"><div class="grow">
      <label class="sr" for="dt-name">Nom du plan</label>
      <input id="dt-name" class="in wide dt-name" data-dt-f="name" maxlength="${DIET_NAME_MAX}" autocomplete="off" value="${esc(plan.name)}">
      <div class="sub" id="dt-status">${esc(deskDtStatusText(r))}</div></div></div>
    ${deskDtOldPhone() ? `<p class="dt-note" role="note">${deskIcon('phone', 'sm')}<span>${esc(DESK_DT_ERRORS.old_phone)}</span></p>` : ''}
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
      <span class="grow muted">${dirty ? deskIcon('pen', 'sm') : ''}${esc(sent ? (dirty ? 'Pas encore envoyé.' : 'Envoyé.') : !dt.acc?.consent ? 'Copie des plans sur ton compte désactivée : rien n\'est gardé après l\'envoi.' : deskDtOldPhone() ? 'Mets l\'app à jour sur ton iPhone pour enregistrer ici.' : dirty ? 'Pas encore enregistré.' : 'Tout est enregistré.')}</span>
      <button type="button" class="btn" data-dt="undo" ${dt.hist.past.length ? '' : 'disabled'} aria-keyshortcuts="Control+Z Meta+Z" aria-label="Annuler le dernier changement">Annuler</button>
      <button type="button" class="btn" data-dt="redo" ${dt.hist.future.length ? '' : 'disabled'} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">Rétablir</button>
      <button type="button" class="btn" data-dt="send-many" ${dt.busy ? 'disabled' : ''}>${esc(student ? 'Envoyer à plusieurs élèves' : 'Envoyer à des élèves')}</button>
      ${sent && canSave ? `<button type="button" class="btn" data-dt="save-copy" ${dt.busy ? 'disabled' : ''}>${esc(dt.copyId ? 'Mettre à jour la copie' : 'Garder comme nouveau plan')}</button>` : ''}
      ${student ? `<button type="button" class="btn ${canSave && !sent ? 'tint' : 'fill'}" data-dt="send" ${dt.busy ? 'disabled aria-busy="true"' : ''}>${deskIcon('send', 'sm')}${esc(`Envoyer à ${student}`)}</button>` : ''}
      ${canSave && !sent ? `<button type="button" class="btn fill" data-dt="save" ${dt.busy || !dirty ? 'disabled' : ''} aria-keyshortcuts="Control+S Meta+S">Enregistrer</button>` : ''}
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

// Enregistrer dans mes plans. Le plan a changé ailleurs (iPhone) depuis son ouverture : « Recharger » (sa version) ou
// « Garder ma version » (la mienne remplace la sienne), jamais en silence. force : sans ce contrôle
async function deskDtSave({ quiet = false, force = false } = {}) {
  if (!dt.draft || dt.busy || dt.src === 'sent' || !deskDtCanSave()) return { ok: false, kind: deskDtOldPhone() ? 'old_phone' : 'no_consent' };
  deskDtCommitFocused();
  dt.busy = true; deskRender();
  const r = await deskWriteDiet(deskDtOpSave(dt.id, dt.draft, Date.now(), { expectAt: force ? undefined : dt.baseAt }));
  dt.busy = false;
  if (!r.ok) {
    if (r.kind === 'signed_out') { deskEndSession(); return r; }
    if (r.kind === 'stale') {
      deskRender();
      const c = await deskDtAsk3({ title: 'Ce plan a changé ailleurs', text: `« ${r.current?.name || dt.draft.name} » a été modifié depuis un autre appareil (l'app iPhone) après son ouverture ici. Recharger prend sa version et perd tes changements d'ici ; Garder ma version remplace la sienne.`,
        a: ['reload', 'Recharger'], b: ['keep', 'Garder ma version'] });
      if (c === 'keep') return deskDtSave({ quiet, force: true });
      if (c === 'reload') {
        await deskDtLoadAcc({ force: true });
        const plan = dt.acc?.dietPlans?.[dt.id];
        if (plan) { deskDtUse({ key: dt.key, ctx: dt.ctx, id: dt.id, plan, src: 'account' }); deskRender(); deskToast('Version du compte rechargée'); }
      }
      return r;
    }
    if (!quiet) deskToast(deskDtErr(r.kind));
    deskRender();
    return r;
  }
  Object.assign(dt, { acc: r.acc, accAt: Date.now(), baseAt: r.result.plan.updatedAt });
  deskDocCache.at = 0;   // « Envoyer un plan » de l'onglet Nutrition relit mon compte
  dt.saved = deskDtSnap(dt.draft); dt.fresh = false; dt.src = 'account';
  // Plan neuf de l'onglet Nutrition : l'adresse prend son identifiant (sans nouvel écran)
  if (dt.ctx?.kind === 'student' && /\/nutrition\/new$/.test(location.hash)) {
    const h = `#/eleve/${encodeURIComponent(dt.ctx.sid)}/nutrition/${dt.id}`;
    history.replaceState(null, '', h); dt.key = deskDtRouteKey(h); deskHash = h;
  }
  deskRender();
  if (!quiet) deskToast(`Plan « ${dt.draft.name} » enregistré`);
  return r;
}
// Version d'un élève gardée comme un NOUVEAU plan (« Sèche (lea) ») : mon plan modèle n'est jamais remplacé par elle
async function deskDtSaveCopy() {
  if (!dt.draft || dt.busy || dt.src !== 'sent' || !deskDtCanSave()) return;
  deskDtCommitFocused();
  const who = deskChatRow(dt.ctx?.sid)?.name || 'élève';
  if (!dt.copyId) {
    const n = deskDtNew(dt.acc, 'x');
    if (n.kind) { deskToast(deskDtErr(n.kind)); return; }
    dt.copyId = n.id;
  }
  const copy = { ...deskDtClone(dt.draft), name: dietText(`${dt.draft.name.slice(0, DIET_NAME_MAX - who.length - 3)} (${who})`, DIET_NAME_MAX) };
  dt.busy = true; deskRender();
  const r = await deskWriteDiet(deskDtOpSave(dt.copyId, copy));
  dt.busy = false;
  if (!r.ok) { if (r.kind === 'signed_out') { deskEndSession(); return; } deskToast(deskDtErr(r.kind)); deskRender(); return; }
  Object.assign(dt, { acc: r.acc, accAt: Date.now() });
  deskDocCache.at = 0;
  deskRender();
  deskToast(`Gardé dans tes plans : « ${copy.name} ». Ton plan « ${dt.acc.dietPlans[dt.id]?.name || dt.draft.name} » ne change pas.`);
}

// Échecs d'un envoi groupé, par raison : « Ton élève doit d'abord accepter… : karim, ines. Hors ligne : tom. »
function deskDtFailText(res, ids) {
  const nameOf = u => deskChatRow(u)?.name || 'élève';
  const groups = new Map();
  for (const f of res.failed) { const t = coachErrorText(f.kind); groups.set(t, [...(groups.get(t) || []), f.uid]); }
  const left = ids.filter(u => !res.sent.includes(u) && !res.failed.some(f => f.uid === u));
  if (left.length) { const t = res.rate ? coachErrorText('send_rate') : 'Pas envoyé :'; groups.set(t, [...(groups.get(t) || []), ...left]); }
  return [...groups].map(([why, us]) => `${why.replace(/\.$/, '')} : ${us.map(nameOf).join(', ')}.`).join(' ');
}
// Envoi au format de l'app à chacun (file de l'app). Un de mes plans est d'abord enregistré (avec l'accord) ; la version
// d'un élève ne l'est jamais (elle ne remplace pas mon plan modèle)
async function deskDtSend(ids) {
  deskDtCommitFocused();
  const v = deskDtPayload(dt.id, dt.draft);
  if (!v.ok) { deskToast(coachErrorText(v.kind)); return; }
  const limit = coachSendLimit(view.dash?.rows.length || 0);
  if (ids.length > limit) { deskToast(`La limite est de ${limit} envois sur 24 heures (30, plus 2 par élève) : décoche ${plural(ids.length - limit, 'élève', 'élèves')}.`); return; }
  let saved = null;
  if (dt.src !== 'sent' && deskDtCanSave() && deskDtDirty()) {
    saved = await deskDtSave({ quiet: true });
    if (saved.kind === 'stale') return;   // le coach a choisi : rien ne part tant qu'il n'a pas tranché
  }
  dt.busy = true; deskRender();
  const res = await coachSendQueue(ids, uid => deskSendProg(uid, v.progId, v.data));
  dt.busy = false;
  if (res.failed.some(f => f.kind === 'signed_out')) { deskEndSession(); return; }
  const sid = dt.ctx?.kind === 'student' ? dt.ctx.sid : null;
  if (sid && res.sent.includes(sid)) {
    if (dt.src === 'sent') { dt.sentAt = Date.now(); dt.saved = deskDtSnap(dt.draft); }
    nt.at = 0;
  }
  if (!deskDtCanSave() && dt.src !== 'sent' && res.sent.length) dt.saved = deskDtSnap(dt.draft);
  deskRender();
  const nameOf = u => deskChatRow(u)?.name || 'élève';
  const keep = saved && !saved.ok ? ` (pas enregistré dans tes plans : ${deskDtErr(saved.kind)})` : '';
  if (!res.failed.length && !res.left) deskToast(`« ${v.data.diet.name} » envoyé à ${res.sent.length === 1 ? nameOf(res.sent[0]) : plural(res.sent.length, 'élève', 'élèves')}${keep}`);
  else {
    await deskConfirm({ title: res.sent.length ? `Envoyé à ${res.sent.length} sur ${ids.length}` : 'Rien n\'a été envoyé',
      text: `${deskDtFailText(res, ids)}${keep}`, ok: 'OK', cancel: false });
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
  if (!deskDtOnScreen() || !(e.ctrlKey || e.metaKey) || e.altKey || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); if (deskDtCanSave() && dt.src !== 'sent' && deskDtDirty()) deskDtSave(); return; }
  // Dans un champ de l'éditeur aussi : chaque frappe change déjà le plan (et le rendu efface l'historique du
  // navigateur) ; l'annulation du plan remet le champ comme avant la saisie. Champs hors éditeur : le navigateur
  if (t.matches?.('input, textarea, select') && !t.dataset?.dtF) return;
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
  if (a === 'edit-sent' || a === 'new-for') return;   // liens (href) de l'onglet Nutrition
  if (!dt.draft) return;
  const day = deskDtDayObj();
  if (a === 'undo' || a === 'redo') { deskDtUndoRedo(a === 'redo'); return; }
  if (a === 'save') { deskDtSave(); return; }
  if (a === 'save-copy') { deskDtSaveCopy(); return; }
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
// elle tombe (deskCkDropIndex, js/desk/templates.js), l'ordre est validé au relâchement et annoncé ; Échap remet l'ordre d'avant.
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
window.addEventListener('pointermove', e => {
  const dr = deskDtDrag;
  if (!dr || e.pointerId !== dr.id) return;
  e.preventDefault();
  const dy = e.clientY - dr.y;
  if (Math.abs(dy) > 3) dr.moved = true;
  dr.li.style.transform = `translateY(${dy}px)`;
  const { to, mark } = deskCkDropIndex(dr, e.clientY);
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
  if (e) dr.to = deskCkDropIndex(dr, e.clientY).to;
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
