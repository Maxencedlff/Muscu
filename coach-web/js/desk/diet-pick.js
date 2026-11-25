// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : dialogues de l'éditeur des plans diète (docs/COACH_WEB.md, « Plans diète »)
//
//  Ajouter un aliment (recherche Ciqual et Mes aliments, quantité en grammes ou à l'unité, aliment perso, code-barres
//  saisi → Open Food Facts), équivalents d'un aliment, jours à cocher, choix à trois réponses (brouillon périmé).
//  Dialogues modaux hors de #app : jamais effacés par un rendu de l'éditeur (js/desk/diet-editor.js).
// ═══════════════════════════════════════════════════════════
'use strict';

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
    if (!deskDtCanSave()) { deskToast(`Aliment ajouté au plan, pas gardé dans Mes aliments (${deskDtOldPhone() ? 'mets l\'app à jour sur ton iPhone' : 'copie des plans sur ton compte désactivée'}).`); return food; }
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
      st.kept = !full && deskDtCanSave();
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

// Trois choix (brouillon périmé) : rend 'reload', 'keep' ou null (Échap, Annuler : rien ne change)
function deskDtAsk3({ title, text, a, b }) {
  return new Promise(resolve => {
    const dlg = deskDtDialog('', title);
    dlg.innerHTML = `<h2 class="dlg-t">${esc(title)}</h2><p class="dlg-p">${esc(text)}</p>
      <div class="dlg-f"><button type="button" class="btn" data-cf="">Annuler</button><span class="grow"></span><button type="button" class="btn" data-cf="${a[0]}">${esc(a[1])}</button><button type="button" class="btn fill" data-cf="${b[0]}">${esc(b[1])}</button></div>`;
    frTypoNode(dlg);
    let answer = null;
    dlg.addEventListener('click', e => { const x = e.target.closest('[data-cf]'); if (x) { answer = x.dataset.cf || null; dlg.close(); } });
    dlg.addEventListener('close', () => resolve(answer));
    dlg.showModal();
    dlg.querySelector('[data-cf=""]').focus();
  });
}

