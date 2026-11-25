// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : écran « Mes bilans » (#/bilans ; docs/COACH_WEB.md, vague 2 ; maquette 7-mes-bilans)
//
//  Liste des modèles, éditeur (suivis cochés par rubrique, ordre, type, échelle, intitulés, mensurations, poses,
//  questions perso), envoi (fréquence, jour et heure, rappel, date limite), destinataires (élèves, groupes, fréquence
//  propre d'un élève), « Envoyer maintenant », « Aperçu élève ».
//  - Enregistrement explicite (« Enregistrer ») : rien ne part au serveur tant que le coach n'a pas validé ; quitter
//    l'écran ou changer de modèle avec des changements demande confirmation (rien n'est perdu sans prévenir).
//    Exception voulue : un groupe s'enregistre seul (« Enregistrer le groupe ») car il sert à plusieurs bilans.
//  - Ordre : glisser la poignée (Pointer Events : souris, doigt, stylet ; touch-action: none sur la poignée), flèches
//    haut et bas sur la poignée, boutons Monter et Descendre dans les réglages du suivi ; chaque déplacement est
//    annoncé (« Sommeil déplacé en position 3 »). Rien ne dépend du survol.
//  - Tout texte reçu (noms des modèles, des groupes, des élèves, questions) passe par esc().
//  Logique pure : js/desk/checkins-model.js.
// ═══════════════════════════════════════════════════════════
'use strict';

const bl = { setup: null, kind: null, loading: false, at: 0, sel: null, mode: 'edit', draft: null, saved: '', open: null,
  recip: false, group: null, own: null, list: false, busy: false, tried: false, addQ: false, focus: null };

const DESK_CK_GROUP_LABEL = Object.fromEntries(CHECKIN_GROUPS);
const DESK_CK_ERRORS = {
  invalid_template: 'Le serveur a refusé un réglage de ce bilan : vérifie les suivis cochés.',
  too_many: 'Tu as déjà 50 bilans : supprime-en un pour en créer un autre.',
  rate_limited: 'Tu as fait 30 envois en 24 heures : réessaie demain.',
  not_found: 'Ce bilan ou ce groupe n\'existe plus : la liste vient d\'être relue.',
  missing: 'Les bilans ne sont pas encore ouverts sur le serveur.',
};
const deskCkErrText = kind => DESK_CK_ERRORS[kind] || deskErrorText(kind);

// ── Données ─────────────────────────────────────────────────

const deskCkDirty = () => !!bl.draft && deskCkSnapshot(bl.draft) !== bl.saved;
const deskCkLinked = () => (view.dash?.rows || []).map(r => r.id);
const deskCkName = id => view.dash?.rows.find(r => r.id === id)?.name || 'Élève';

function deskCkSelect(id) {
  const t = bl.setup?.templates.find(x => x.id === id) || bl.setup?.templates[0] || null;
  bl.sel = t ? t.id : null;
  bl.mode = t ? 'edit' : 'new';
  bl.draft = t ? deskCkDraft(t, bl.setup) : null;
  bl.saved = bl.draft ? deskCkSnapshot(bl.draft) : '';
  Object.assign(bl, { open: null, recip: false, group: null, own: null, tried: false, addQ: false, list: false });
}
async function deskOpenBilans({ force = false, keep = false, quiet = false } = {}) {
  if (!desk.user) return;
  if (!force && bl.setup && Date.now() - bl.at < DESK_REFRESH_MS) return;
  bl.loading = !bl.setup;
  if (bl.loading) deskRender();
  const r = await deskLoadSetup();
  bl.loading = false;
  bl.at = Date.now();
  if (!r.ok) {
    if (r.kind === 'signed_out') return deskEndSession();
    bl.kind = r.kind;
    if (deskRoute().name === 'bilans') deskRender();
    return;
  }
  bl.kind = null;
  bl.setup = r.data;
  if (!keep || !bl.draft) deskCkSelect(bl.sel);
  deskRender({ quiet });   // aussi ailleurs : compteur « Mes bilans » de la barre latérale
}

// ── Rendu ───────────────────────────────────────────────────

const deskCkSwitch = (id, on, label, action, extra = '') => `<button type="button" class="switch" role="switch" id="${id}" aria-checked="${on}" aria-label="${esc(label)}" data-ck="${action}"${extra}><span></span></button>`;
const deskCkRadio = (action, value, on, label, extra = '') => `<button type="button" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" data-ck="${action}" data-v="${esc(value)}"${extra}>${esc(label)}</button>`;

function deskCkRowHtml(r, pos, count) {
  const it = r.item, open = bl.open === r.key;
  const def = checkinKind(it.kind);
  const label = it.kind === 'custom' ? (it.label ? `« ${it.label} »` : 'Nouvelle question') : it.label;
  const sub = deskCkItemSub(it);
  const err = bl.tried && deskCkErrors(bl.draft).find(e => e.key === r.key);
  const types = def ? def.types : CHECKIN_CUSTOM_TYPES;
  return `<li class="ck-row${r.on ? '' : ' off'}${open ? ' open' : ''}" data-key="${esc(r.key)}">
    <div class="ck-line">
      <button type="button" class="ck-box" role="checkbox" id="box-${esc(r.key)}" aria-checked="${r.on}" data-ck="toggle" data-key="${esc(r.key)}" aria-label="${esc(`Inclure ${it.label || 'cette question'}`)}"><span class="circ">${deskIcon('check', 'xs')}</span></button>
      <button type="button" class="ck-grip" id="grip-${esc(r.key)}" data-ck-grip="${esc(r.key)}" aria-label="${esc(`Déplacer ${it.label || 'cette question'}, position ${pos} sur ${count}`)}" aria-describedby="grip-help">${deskIcon('grip', 'sm')}</button>
      <button type="button" class="ck-main" id="main-${esc(r.key)}" data-ck="open" data-key="${esc(r.key)}" aria-expanded="${open}">
        <span class="ck-ic">${deskIcon(def?.icon || 'pen', 'sm')}</span><span class="grow"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>
      <button type="button" class="pill" id="pill-${esc(r.key)}" data-ck="open" data-key="${esc(r.key)}" data-focus="type" aria-label="${esc(`Type : ${checkinTypeText(it)}${types.length > 1 ? ', toucher pour le changer' : ''}`)}"><span>${esc(checkinTypeText(it))}</span></button>
    </div>
    ${err ? `<p class="ck-err" role="alert">${esc(err.text)}</p>` : ''}
    ${open ? deskCkSettingsHtml(r, types, pos, count) : ''}
  </li>`;
}

function deskCkSettingsHtml(r, types, pos, count) {
  const it = r.item, def = checkinKind(it.kind), k = esc(r.key);
  const parts = [];
  parts.push(`<label class="fld sm"><span>${it.kind === 'custom' ? 'Ta question' : 'Intitulé vu par l\'élève'}</span><input id="lbl-${k}" data-ck-field="label" data-key="${k}" maxlength="${CHECKIN_LABEL_MAX}" value="${esc(it.label)}" placeholder="${it.kind === 'custom' ? 'Par exemple : ta plus grande victoire ?' : esc(def?.label || '')}"></label>`);
  if (types.length > 1) parts.push(`<div class="fld sm"><span id="tl-${k}">Type</span><div class="seg" role="radiogroup" aria-labelledby="tl-${k}">${types.map(t => deskCkRadio('type', t, it.type === t, CHECKIN_TYPE_LABELS[t], ` data-key="${k}" id="type-${k}-${t}"`)).join('')}</div></div>`);
  if (it.type === 'scale') {
    parts.push(`<div class="fld sm"><span id="sl-${k}">Échelle</span><div class="seg" role="radiogroup" aria-labelledby="sl-${k}">${[5, 10].map(n => deskCkRadio('scale', n, it.scale === n, `1 à ${n}`, ` data-key="${k}" id="scale-${k}-${n}"`)).join('')}</div></div>`);
    parts.push(`<div class="two"><label class="fld sm"><span>Libellé de 1</span><input id="lo-${k}" data-ck-field="lo" data-key="${k}" maxlength="${CHECKIN_BOUND_MAX}" value="${esc(it.lo || '')}" placeholder="Mal"></label>
      <label class="fld sm"><span>Libellé de ${it.scale}</span><input id="hi-${k}" data-ck-field="hi" data-key="${k}" maxlength="${CHECKIN_BOUND_MAX}" value="${esc(it.hi || '')}" placeholder="Très bien"></label></div>`);
  }
  if (it.kind === 'custom' && it.type === 'number') parts.push(`<label class="fld sm"><span>Unité (facultative)</span><input id="unit-${k}" data-ck-field="unit" data-key="${k}" maxlength="${CHECKIN_UNIT_MAX}" value="${esc(it.unit || '')}" placeholder="verres, km, h…"></label>`);
  if (it.kind === 'measures') parts.push(`<div class="fld sm"><span id="ml-${k}">Mensurations demandées</span><div class="chips" role="group" aria-labelledby="ml-${k}">${CHECKIN_MEASURE_KEYS.map(m => `<button type="button" class="chip" role="checkbox" id="m-${m}" aria-checked="${it.options.keys.includes(m)}" data-ck="mkey" data-key="${k}" data-v="${m}">${esc(CHECKIN_MEASURE_LABELS[m])}</button>`).join('')}</div></div>`);
  if (it.kind === 'photos') parts.push(`<div class="fld sm"><span id="pl-${k}">Poses demandées</span><div class="chips" role="group" aria-labelledby="pl-${k}">${CHECKIN_POSES.map(p => `<button type="button" class="chip" role="checkbox" id="p-${p}" aria-checked="${it.options.poses.includes(p)}" data-ck="pose" data-key="${k}" data-v="${p}">${esc(CHECKIN_POSE_LABELS[p])}</button>`).join('')}</div></div>`);
  if (def?.sensitive) parts.push('<p class="gfoot flat">Facultatif pour l\'élève : il peut toujours passer ce suivi.</p>');
  else parts.push(`<div class="row flat"><span class="grow" id="rq-${k}">Réponse obligatoire</span>${deskCkSwitch(`req-${k}`, it.required, 'Réponse obligatoire', 'required', ` data-key="${k}"`)}</div>`);
  parts.push(`<div class="ck-acts">
    <button type="button" class="btn" id="up-${k}" data-ck="up" data-key="${k}" ${pos <= 1 ? 'aria-disabled="true"' : ''}>${deskIcon('up', 'sm')}Monter</button>
    <button type="button" class="btn" id="down-${k}" data-ck="down" data-key="${k}" ${pos >= count ? 'aria-disabled="true"' : ''}>${deskIcon('down', 'sm')}Descendre</button>
    ${it.kind === 'custom' ? `<button type="button" class="btn danger-t" id="delq-${k}" data-ck="del-q" data-key="${k}">${deskIcon('trash', 'sm')}Supprimer</button>` : ''}
    <button type="button" class="btn link" data-ck="open" data-key="${k}">Fermer</button></div>`);
  return `<div class="ck-set">${parts.join('')}</div>`;
}

function deskCkGroupHtml(g) {
  const rows = deskCkGroupRows(bl.draft.rows, g);
  const lbl = DESK_CK_GROUP_LABEL[g];
  const add = g === 'custom' ? `<div class="addq">${bl.addQ
    ? `<div class="fld sm"><span id="aq-l">Type de la question</span><div class="seg" role="group" aria-labelledby="aq-l">${CHECKIN_CUSTOM_TYPES.map(t => `<button type="button" data-ck="add-q" data-v="${t}" id="addq-${t}">${esc(t === 'number' ? 'Nombre avec unité' : CHECKIN_TYPE_LABELS[t])}</button>`).join('')}</div></div>`
    : `<button type="button" class="btn link" id="addq" data-ck="add-q-open">${deskIcon('plus', 'sm')}Ajouter une question</button>`}</div>` : '';
  if (!rows.length && g === 'custom') return `<section class="ck-g" aria-labelledby="h-g-${g}"><h2 class="gh" id="h-g-${g}">${esc(lbl)}</h2>${add}</section>`;
  return `<section class="ck-g" aria-labelledby="h-g-${g}"><h2 class="gh" id="h-g-${g}">${esc(lbl)}</h2>
    <ul class="group ck-list" aria-label="${esc(`Suivis : ${lbl}`)}" data-group="${g}">${rows.map((r, i) => deskCkRowHtml(r, i + 1, rows.length)).join('')}</ul>${add}</section>`;
}

function deskCkSaveBarHtml() {
  const dirty = deskCkDirty(), isNew = !bl.draft?.id;
  return `<div class="savebar${dirty || isNew ? ' stick' : ''}" id="savebar">${dirty || isNew
    ? `<span class="grow warn">${isNew ? 'Pas encore enregistré' : 'Changements pas encore enregistrés'}</span>
      ${isNew ? '' : '<button type="button" class="btn" data-ck="revert">Annuler les changements</button>'}
      <button type="button" class="btn tint" id="ck-save" data-ck="save" ${bl.busy ? 'disabled aria-busy="true"' : ''}>Enregistrer</button>`
    : `<span class="grow muted">${deskIcon('check', 'sm')} Tout est enregistré</span>`}</div>`;
}

function deskCkEditorHtml() {
  const d = bl.draft, items = deskCkItems(d.rows);
  const errs = bl.tried ? deskCkErrors(d).filter(e => !e.key) : [];
  return `<label class="ed-name"><span class="sr">Nom du bilan</span><input id="ck-name" maxlength="${CHECKIN_NAME_MAX}" value="${esc(d.name)}" placeholder="Nom du bilan" autocomplete="off"></label>
    <p class="sub">${esc(`${plural(items.length, 'suivi', 'suivis')} sur ${d.rows.length}`)} · environ ${esc(plural(checkinMinutes(items), 'minute', 'minutes'))} à remplir</p>
    <p class="ed-help">Coche, glisse pour l'ordre, touche le type pour le changer : échelle 1 à 5 ou 1 à 10, oui/non, nombre avec unité, texte, photo, ou automatique (rempli par l'app).</p>
    <p id="grip-help" class="sr">Glisse pour changer l'ordre, ou utilise les flèches haut et bas.</p>
    ${errs.length ? `<div class="ck-errs" role="alert">${errs.map(e => `<p>${esc(e.text)}</p>`).join('')}</div>` : ''}
    <div class="ed-cols"><div class="ed-col">${deskCkGroupHtml('body')}${deskCkGroupHtml('activity')}</div><div class="ed-col">${deskCkGroupHtml('feel')}${deskCkGroupHtml('custom')}</div></div>
    ${deskCkSaveBarHtml()}
    ${d.id ? `<div class="group gap-t"><button type="button" class="row act danger-t" id="ck-delete" data-ck="delete">${deskIcon('trash', 'sm')}<span class="grow">Supprimer ce bilan</span></button></div>` : ''}`;
}

function deskCkNewHtml() {
  return `<h2 class="ed-t">Nouveau bilan</h2><p class="sub">Pars de zéro, ou d'un modèle que tu adaptes ensuite.</p>
    <ul class="group gap-t" aria-label="Point de départ">
      <li><button type="button" class="row" data-ck="start" data-i="-1"><span class="grow"><b>Partir de zéro</b><div class="t2">Aucun suivi coché : tu choisis tout</div></span>${deskIcon('chevron', 'sm')}</button></li>
      ${CHECKIN_STARTERS.map((s, i) => { const n = s.kinds.length + s.questions.length; return `<li><button type="button" class="row" data-ck="start" data-i="${i}"><span class="grow"><b>${esc(s.name)}</b><div class="t2">${esc(`${plural(n, 'suivi', 'suivis')} · ${DESK_CK_FREQ_SHORT[s.freq]} · environ ${plural(checkinMinutes(checkinStarterItems(s, () => 0)), 'minute', 'minutes')}`)}</div></span>${deskIcon('chevron', 'sm')}</button></li>`; }).join('')}
    </ul>${bl.setup.templates.length ? '<button type="button" class="btn link" data-ck="cancel-new">Annuler</button>' : ''}`;
}

// Aperçu de ce que verra l'élève dans l'app iPhone : lecture seule, aucun champ actif
function deskCkPreviewHtml() {
  const d = bl.draft, items = deskCkItems(d.rows), form = view.dash?.form || null;
  const field = it => {
    if (it.type === 'scale') return `<div class="pv-scale" aria-hidden="true">${Array.from({ length: it.scale }, (_, i) => `<span>${i + 1}</span>`).join('')}</div>${it.lo || it.hi ? `<div class="pv-bounds"><span>${esc(it.lo)}</span><span>${esc(it.hi)}</span></div>` : ''}`;
    if (it.type === 'yesno') return '<div class="pv-yn" aria-hidden="true"><span>Oui</span><span>Non</span></div>';
    if (it.kind === 'measures') return `<div class="pv-ms">${it.options.keys.map(m => `<span>${esc(CHECKIN_MEASURE_LABELS[m])}<i>— cm</i></span>`).join('')}</div>`;
    if (it.type === 'number') return `<div class="pv-box">${it.kind === 'weight' ? 'Rempli avec sa dernière pesée' : '—'}${checkinUnitText(it) ? ` ${esc(checkinUnitText(it))}` : ''}</div>`;
    if (it.type === 'text') return '<div class="pv-box tall">Sa réponse</div>';
    if (it.type === 'photo') return `<div class="pv-ms">${it.options.poses.map(p => `<span>${esc(CHECKIN_POSE_LABELS[p])}<i>${deskIcon('photo', 'xs')}</i></span>`).join('')}</div>`;
    if (it.type === 'auto') return '<div class="pv-box">Rempli par l\'app, modifiable par l\'élève</div>';
    if (it.type === 'choice') return `<div class="pv-yn wrap">${CHECKIN_CYCLE_PHASES.map(([, l]) => `<span>${esc(l)}</span>`).join('')}</div>`;
    return '';
  };
  const groups = CHECKIN_GROUPS.map(([g, l]) => {
    const its = items.filter(it => (it.kind === 'custom' ? 'custom' : checkinKind(it.kind)?.group) === g);
    if (!its.length) return '';
    return `<h3 class="gh">${esc(g === 'custom' ? 'Questions' : l)}</h3><div class="group pv-g">${its.map(it => `<div class="pv-i"><b>${esc(it.label)}</b>${checkinKind(it.kind)?.sensitive ? ' <span class="tag">Facultatif</span>' : it.required ? '' : ''}${field(it)}</div>`).join('')}</div>`;
  }).join('');
  return `<div class="pv-head"><div class="grow"><h2 class="ed-t">Aperçu élève</h2><p class="sub">Lecture seule : c'est ce que ton élève verra dans l'app iPhone.</p></div>
    <button type="button" class="btn" id="pv-close" data-ck="preview">Fermer l'aperçu</button></div>
    <section class="pv" aria-label="Aperçu du bilan">
      <h3 class="pv-t">${esc(checkinLine(d.name, CHECKIN_NAME_MAX) || 'Bilan')}</h3>
      <p class="sub">${esc(coachWord('Ton', form))} te demande ce bilan · environ ${esc(plural(checkinMinutes(items), 'minute', 'minutes'))}</p>
      ${items.length ? groups : '<div class="empty">Aucun suivi coché pour l\'instant.</div>'}
      <p class="gfoot">Tes réponses sont partagées avec ${esc(coachWord('ton', form))}. Les photos sont chiffrées de bout en bout.</p>
    </section>`;
}

function deskCkSelectHtml(id, label, options, value, extra = '') {
  return `<label class="sel"><span class="sr">${esc(label)}</span><select id="${id}" ${extra}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>${deskIcon('down', 'xs')}</label>`;
}
const DESK_CK_HOURS = Array.from({ length: 24 }, (_, h) => [h, `${h} h`]);
const DESK_CK_DAYS = [1, 2, 3, 4, 5, 6, 0].map(d => [d, CHECKIN_WEEKDAYS[d].charAt(0).toUpperCase() + CHECKIN_WEEKDAYS[d].slice(1)]);
const DESK_CK_MONTHDAYS = Array.from({ length: 28 }, (_, i) => [i + 1, i ? `Le ${i + 1}` : 'Le 1er']);

function deskCkSendHtml() {
  const d = bl.draft, b = d.base, groups = bl.setup.groups;
  const students = deskCkStudentsOf(d.targets, groups, deskCkLinked());
  const freqs = CHECKIN_FREQS.map(([k]) => deskCkRadio('freq', k, b.freq === k, DESK_CK_FREQ_SHORT[k], ` id="freq-${k}"`)).join('');
  const day = b.freq === 'manual' ? ''
    : `<div class="row"><span class="grow" id="l-day">Jour d'envoi</span><span class="sels">${b.freq === 'month'
      ? deskCkSelectHtml('ck-monthday', 'Jour du mois', DESK_CK_MONTHDAYS, b.monthday, 'data-ck-sel="monthday"')
      : deskCkSelectHtml('ck-weekday', 'Jour de la semaine', DESK_CK_DAYS, b.weekday, 'data-ck-sel="weekday"')}${deskCkSelectHtml('ck-hour', 'Heure d\'envoi', DESK_CK_HOURS, b.send_hour, 'data-ck-sel="send_hour"')}</span></div>`;
  const remindOn = b.remind_after_h !== null;
  // Options : « Mardi, 18 h » pour un envoi chaque semaine, sinon « 2 jours après l'envoi » ; le délai écrit dessous
  const opt = h => [h, deskCkWhenText(b, h) || deskCkDelayText(h).replace(/^./, c => c.toUpperCase())];
  const delay = h => (deskCkWhenText(b, h) ? `<span class="t2 blk">${esc(deskCkDelayText(h))}</span>` : '');
  const remind = `<div class="row"><span class="grow">Rappel à l'élève<span class="t2 blk">${remindOn ? 'S\'il n\'a pas encore répondu' : 'Pas de rappel'}</span></span>${deskCkSwitch('ck-remind', remindOn, 'Rappel à l\'élève', 'remind')}</div>
    ${remindOn ? `<div class="row"><span class="grow">Rappel envoyé${delay(b.remind_after_h)}</span>${deskCkSelectHtml('ck-remind-h', 'Moment du rappel', DESK_CK_REMIND.map(opt), b.remind_after_h, 'data-ck-sel="remind_after_h"')}</div>` : ''}`;
  const due = `<div class="row"><span class="grow">À rendre avant${delay(b.due_after_h)}</span>${deskCkSelectHtml('ck-due', 'À rendre avant', DESK_CK_DUE.map(opt), b.due_after_h, 'data-ck-sel="due_after_h"')}</div>`;
  const canSend = d.id && !deskCkDirty() && students.length;
  const sendNow = b.freq === 'manual' ? `<div class="group gap-t"><div class="row"><span class="grow">Envoyer maintenant<span class="t2 blk">${!d.id || deskCkDirty() ? 'Enregistre d\'abord le bilan' : students.length ? `À ${esc(plural(students.length, 'élève', 'élèves'))}` : 'Choisis d\'abord à qui il part'}</span></span>
    <button type="button" class="btn tint" id="ck-send-now" data-ck="send-now" ${canSend ? '' : 'aria-disabled="true"'}>${deskIcon('send', 'sm')}Envoyer</button></div></div>` : '';
  return `<section class="gblock" aria-labelledby="h-freq"><h2 class="gh" id="h-freq">Fréquence</h2>
    <div class="seg grid2" role="radiogroup" aria-labelledby="h-freq">${freqs}</div>
    <div class="group gap-t">${day}${remind}${due}</div>${sendNow}</section>
    <section class="gblock" aria-labelledby="h-to">${bl.group ? deskCkGroupEditHtml() : bl.recip ? deskCkRecipHtml() : deskCkTargetsHtml()}</section>`;
}

function deskCkTargetsHtml() {
  const d = bl.draft, groups = bl.setup.groups, linked = deskCkLinked();
  const rows = d.targets.map(t => {
    if (t.type === 'group') {
      const g = groups.find(x => x.id === t.id);
      if (!g) return '';
      const n = g.members.filter(m => linked.includes(m)).length;
      return `<li><div class="row nowrap"><span class="av sm-av" aria-hidden="true">${deskIcon('group', 'sm')}</span><span class="grow">${esc(g.name)}<span class="t2 blk">${esc(plural(n, 'élève', 'élèves'))}</span></span></div></li>`;
    }
    if (!linked.includes(t.id)) return '';
    const open = bl.own === t.id, name = deskCkName(t.id);
    const cur = t.own ? t.own.freq : 'base';
    return `<li><div class="row nowrap"><span class="av sm-av" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span><span class="grow">${esc(name)}</span>
      <button type="button" class="btn link" id="own-${esc(t.id)}" data-ck="own" data-id="${esc(t.id)}" aria-expanded="${open}">${esc(t.own ? deskCkOverrideText(t.own) : 'comme le bilan')}</button></div>
      ${open ? `<div class="row sub-row"><div class="seg grid2 wide" role="radiogroup" aria-label="${esc(`Fréquence pour ${name}`)}">${deskCkRadio('own-freq', 'base', cur === 'base', 'Comme le bilan', ` data-id="${esc(t.id)}"`)}${CHECKIN_FREQS.map(([k]) => deskCkRadio('own-freq', k, cur === k, DESK_CK_FREQ_SHORT[k], ` data-id="${esc(t.id)}"`)).join('')}</div></div>` : ''}</li>`;
  }).join('');
  return `<h2 class="gh" id="h-to">Envoyé à<button type="button" class="btn link r" id="ck-recip" data-ck="recip">Modifier</button></h2>
    ${rows ? `<ul class="group" aria-label="Destinataires">${rows}</ul>` : '<div class="group"><div class="row"><span class="grow muted">Personne pour l\'instant. Touche Modifier pour choisir des élèves ou un groupe.</span></div></div>'}
    <div class="gfoot">La fréquence se règle pour le bilan, et peut changer pour un élève : touche ce qui est écrit à droite de son nom.</div>`;
}

function deskCkRecipHtml() {
  const d = bl.draft, groups = bl.setup.groups, students = view.dash?.rows || [];
  const has = (type, id) => d.targets.some(t => t.type === type && t.id === id);
  const inGroups = id => groups.filter(g => g.members.includes(id) && has('group', g.id)).map(g => g.name);
  return `<h2 class="gh" id="h-to">Envoyé à<button type="button" class="btn link r" id="ck-recip-done" data-ck="recip">Terminé</button></h2>
    <h3 class="gh sm-h" id="h-grp">Groupes</h3>
    <ul class="group" aria-labelledby="h-grp">${groups.map(g => `<li><div class="row">
      <button type="button" class="ck-box" role="checkbox" id="tg-${esc(g.id)}" aria-checked="${has('group', g.id)}" data-ck="target" data-type="group" data-id="${esc(g.id)}" aria-label="${esc(`Envoyer au groupe ${g.name}`)}"><span class="circ">${deskIcon('check', 'xs')}</span></button>
      <span class="grow">${esc(g.name)}<span class="t2 blk">${esc(plural(g.members.length, 'élève', 'élèves'))}</span></span>
      <button type="button" class="btn link" data-ck="group-edit" data-id="${esc(g.id)}" aria-label="${esc(`Modifier le groupe ${g.name}`)}">Modifier</button></div></li>`).join('')}
      <li><button type="button" class="row act" id="ck-new-group" data-ck="group-edit" data-id="">${deskIcon('plus', 'sm')}<span class="grow">Nouveau groupe</span></button></li></ul>
    <h3 class="gh sm-h gap" id="h-stu">Élèves</h3>
    ${students.length ? `<ul class="group" aria-labelledby="h-stu">${students.map(s => { const gs = inGroups(s.id); return `<li><div class="row">
      <button type="button" class="ck-box" role="checkbox" id="ts-${esc(s.id)}" aria-checked="${has('student', s.id)}" data-ck="target" data-type="student" data-id="${esc(s.id)}" aria-label="${esc(`Envoyer à ${s.name}`)}"><span class="circ">${deskIcon('check', 'xs')}</span></button>
      <span class="grow">${esc(s.name)}${gs.length ? `<span class="t2 blk">${esc(`Déjà dans ${gs.join(', ')}`)}</span>` : ''}</span></div></li>`; }).join('')}</ul>`
    : '<div class="group"><div class="row"><span class="grow muted">Pas encore d\'élève.</span></div></div>'}
    <div class="gfoot">Un élève coché en plus de son groupe peut avoir sa propre fréquence.</div>`;
}

function deskCkGroupEditHtml() {
  const g = bl.group, students = view.dash?.rows || [];
  return `<h2 class="gh" id="h-to">${g.id ? 'Modifier le groupe' : 'Nouveau groupe'}</h2>
    <div class="group pad"><label class="fld sm"><span>Nom du groupe</span><input id="ck-gname" maxlength="${CHECKIN_GROUP_NAME_MAX}" value="${esc(g.name)}" placeholder="Par exemple : Sèche" autocomplete="off"></label></div>
    <h3 class="gh sm-h gap" id="h-gm">Membres</h3>
    <ul class="group" aria-labelledby="h-gm">${students.map(s => `<li><div class="row">
      <button type="button" class="ck-box" role="checkbox" id="gm-${esc(s.id)}" aria-checked="${g.members.includes(s.id)}" data-ck="gmember" data-id="${esc(s.id)}" aria-label="${esc(`${s.name} dans le groupe`)}"><span class="circ">${deskIcon('check', 'xs')}</span></button>
      <span class="grow">${esc(s.name)}</span></div></li>`).join('')}</ul>
    <div class="ck-acts gap-t"><button type="button" class="btn tint" id="ck-gsave" data-ck="group-save">Enregistrer le groupe</button>
      ${g.id ? '<button type="button" class="btn danger-t" data-ck="group-delete">Supprimer le groupe</button>' : ''}
      <button type="button" class="btn link" data-ck="group-cancel">Annuler</button></div>
    <div class="gfoot">Un groupe s'enregistre tout de suite : il peut servir à plusieurs bilans.</div>`;
}

function deskBilansHtml() {
  const head = (btns = '') => `<div class="head"><div class="grow"><h1 class="title">Mes bilans</h1><div class="sub">Tes modèles de bilan, et à qui ils partent</div></div>${btns}</div>`;
  if (bl.kind === 'missing') {
    return `${head()}<div class="empty" role="alert"><b>Les bilans ne sont pas encore ouverts</b><br>Le serveur de MDLF n'a pas encore reçu la mise à jour des bilans configurables. Tes élèves et leurs semaines restent disponibles ; reviens un peu plus tard.<br>
      <button type="button" class="btn tint" data-ck="reload">Réessayer</button> <a class="btn" href="#/">Voir mes élèves</a></div>`;
  }
  if (bl.kind) return `${head()}<div class="empty" role="alert">${esc(deskCkErrText(bl.kind))}<br><button type="button" class="btn tint" data-ck="reload">Réessayer</button></div>`;
  if (!bl.setup) return `${head()}<div class="empty" role="status">Chargement de tes bilans…</div>`;
  const saved = bl.draft?.id && bl.mode !== 'new';
  const btns = `<div class="head-btns">
    ${saved ? `<button type="button" class="btn" id="ck-dup" data-ck="duplicate">${deskIcon('copy', 'sm')}Dupliquer</button>` : ''}
    ${bl.draft && bl.mode !== 'new' ? `<button type="button" class="btn" id="ck-preview" data-ck="preview" aria-pressed="${bl.mode === 'preview'}">${deskIcon('phone', 'sm')}Aperçu élève</button>` : ''}
    <button type="button" class="btn tint" id="ck-new" data-ck="new">${deskIcon('plus', 'sm')}Nouveau bilan</button></div>`;
  const list = bl.setup.templates.map(t => {
    const l = deskCkTemplateLine(t, bl.setup), on = t.id === bl.draft?.id && bl.mode !== 'new';
    return `<li><button type="button" class="row tpl${on ? ' on' : ''}" data-ck="pick" data-id="${esc(t.id)}"${on ? ' aria-current="true"' : ''}><span class="grow"><b>${esc(t.name)}</b><span class="t2 blk">${esc(l.when)}</span><span class="t2 blk">${esc(l.text)}</span></span>${deskIcon('chevron', 'sm')}</button></li>`;
  }).join('');
  const draftNew = bl.draft && !bl.draft.id && bl.mode !== 'new' ? `<li><button type="button" class="row tpl on" aria-current="true" data-ck="noop"><span class="grow"><b>${esc(checkinLine(bl.draft.name, CHECKIN_NAME_MAX) || 'Nouveau bilan')}</b><span class="t2 blk">Pas encore enregistré</span></span></button></li>` : '';
  const listHtml = `<nav class="bl-list${bl.list ? ' show' : ''}" id="bl-list" aria-labelledby="h-tpl"><h2 class="gh" id="h-tpl">Modèles</h2>
    ${list || draftNew ? `<ul class="group" aria-labelledby="h-tpl">${draftNew}${list}</ul>` : '<div class="group"><div class="row"><span class="grow muted">Aucun bilan pour l\'instant.</span></div></div>'}
    <div class="gfoot">Pars d'un modèle et duplique-le pour un élève ou un groupe.</div></nav>`;
  const toggle = `<button type="button" class="btn bl-toggle" id="bl-toggle" data-ck="list" aria-expanded="${bl.list}" aria-controls="bl-list">${deskIcon('templates', 'sm')}Modèles${deskIcon(bl.list ? 'up' : 'down', 'xs')}</button>`;
  let center;
  if (bl.mode === 'new' || !bl.draft) center = deskCkNewHtml();
  else if (bl.mode === 'preview') center = deskCkPreviewHtml();
  else center = deskCkEditorHtml();
  const side = bl.draft && bl.mode !== 'new' ? `<div class="bl-side">${deskCkSendHtml()}</div>` : '';
  return `${head(btns)}<div class="cols bl${side ? '' : ' noside'}">${listHtml}<section class="bl-ed" aria-label="Bilan">${toggle}${center}</section>${side}</div>`;
}

// ── Gestes ──────────────────────────────────────────────────

const deskCkRow = key => bl.draft?.rows.find(r => r.key === key) || null;
function deskCkPatch(key, patch) {
  const r = deskCkRow(key);
  if (!r) return;
  const c = deskCkItemPatch({ ...r.item, label: r.item.label || 'x' }, patch);
  r.item = c ? { ...c, label: Object.hasOwn(patch, 'label') ? patch.label : r.item.label } : { ...r.item, ...patch };
}
function deskCkSyncBar() {
  const el = document.getElementById('savebar');
  if (!el) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = deskCkSaveBarHtml();
  frTypoNode(tmp);
  el.replaceWith(tmp.firstElementChild);
}
function deskCkMoveAndSay(res, focusId) {
  if (!bl.draft) return;
  bl.draft.rows = res.rows;
  deskRender();
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: false });
  deskAnnounce(deskCkMoveText(res));
}
async function deskCkLeaveOk() {
  if (!deskCkDirty()) return true;
  return deskConfirm({ title: 'Quitter sans enregistrer ?', text: `Tes changements sur « ${checkinLine(bl.draft.name, CHECKIN_NAME_MAX) || 'ce bilan'} » seront perdus.`, ok: 'Quitter sans enregistrer', danger: true });
}

async function deskCkSave() {
  const d = bl.draft;
  if (deskCkErrors(d).length) {
    bl.tried = true; deskRender();
    document.querySelector('.ck-errs, .ck-err')?.scrollIntoView({ block: 'center' });
    deskAnnounce(deskCkErrors(d)[0].text);
    return;
  }
  bl.busy = true; deskCkSyncBar();
  const plan = deskCkSavePlan(d, bl.setup);
  plan.template.items = checkinItemsClean(plan.template.items);
  const r = await deskSaveTemplate(plan, deskTimezone());
  bl.busy = false;
  if (r.template) d.id = r.template.id;
  if (!r.ok) {
    if (r.kind === 'signed_out') return deskEndSession();
    deskToast(deskCkErrText(r.kind));
    if (r.template) await deskOpenBilans({ force: true, keep: true });
    deskRender();
    return;
  }
  d.id = r.data.id;
  bl.sel = r.data.id;
  bl.tried = false;
  await deskOpenBilans({ force: true, keep: true });
  bl.saved = deskCkSnapshot(d);
  deskRender();
  deskToast('Bilan enregistré');
}

async function deskCkSendNow() {
  const d = bl.draft;
  const students = deskCkStudentsOf(d.targets, bl.setup.groups, deskCkLinked());
  if (!d.id || deskCkDirty()) { deskToast('Enregistre d\'abord le bilan, puis envoie-le.'); return; }
  if (!students.length) { deskToast('Choisis d\'abord à qui il part : Envoyé à › Modifier.'); return; }
  const ok = await deskConfirm({ title: `Envoyer « ${d.name} » maintenant ?`, text: `${plural(students.length, 'élève le reçoit', 'élèves le reçoivent')} tout de suite dans l'app.`, ok: 'Envoyer' });
  if (!ok) return;
  const r = await deskRpc('coach_checkin_send_now', { template: d.id, students });
  if (!r.ok) { deskToast(deskCkErrText(r.kind)); return; }
  const sent = Number.isInteger(r.data?.sent) ? r.data.sent : 0;
  deskToast(sent ? `${plural(sent, 'bilan envoyé', 'bilans envoyés')}` : 'Aucun envoi : ces élèves ont déjà ce bilan à remplir.');
  deskRefresh({ force: true });
}

async function deskCkGroupSave() {
  const g = bl.group;
  const name = checkinLine(document.getElementById('ck-gname')?.value ?? g.name, CHECKIN_GROUP_NAME_MAX);
  if (!name) { deskToast('Donne un nom au groupe.'); document.getElementById('ck-gname')?.focus(); return; }
  const r = await deskRpc('coach_group_save', { id: g.id, name, members: g.members });
  if (!r.ok) { deskToast(deskCkErrText(r.kind)); return; }
  const saved = cleanCheckinGroup(r.data);
  bl.group = null;
  // Un nouveau groupe devient destinataire de ce bilan (c'est depuis ce bilan qu'il a été créé)
  if (saved && !g.id && !bl.draft.targets.some(t => t.type === 'group' && t.id === saved.id)) bl.draft.targets.push({ type: 'group', id: saved.id, own: null });
  await deskOpenBilans({ force: true, keep: true });
  bl.recip = true;
  deskRender();
  deskToast(`Groupe « ${saved?.name || name} » enregistré`);
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-ck]');
  if (!el || deskRoute().name !== 'bilans') return;
  const a = el.dataset.ck, key = el.dataset.key, d = bl.draft;
  if (el.getAttribute('aria-disabled') === 'true' && a !== 'send-now') return;
  if (a === 'reload') { bl.kind = null; deskOpenBilans({ force: true }); return; }
  if (a === 'list') { bl.list = !bl.list; deskRender(); return; }
  if (a === 'pick') {
    if (el.dataset.id === d?.id && bl.mode !== 'new') { bl.list = false; deskRender(); return; }
    if (!(await deskCkLeaveOk())) return;
    deskCkSelect(el.dataset.id); deskRender(); document.getElementById('ck-name')?.focus(); return;
  }
  if (a === 'new') { if (!(await deskCkLeaveOk())) return; bl.mode = 'new'; bl.list = false; deskRender(); return; }
  if (a === 'cancel-new') { deskCkSelect(bl.sel); deskRender(); return; }
  if (a === 'start') {
    const i = Number(el.dataset.i), s = CHECKIN_STARTERS[i] || null;
    bl.draft = deskCkDraft({ id: null, name: s ? s.name : '', items: s ? checkinStarterItems(s) : [] }, bl.setup, s?.freq || null);
    bl.saved = '';
    Object.assign(bl, { mode: 'edit', open: null, recip: false, group: null, own: null, tried: false, addQ: false });
    deskRender(); document.getElementById('ck-name')?.focus();
    return;
  }
  if (!d) return;
  if (a === 'preview') { bl.mode = bl.mode === 'preview' ? 'edit' : 'preview'; deskRender(); document.getElementById(bl.mode === 'preview' ? 'pv-close' : 'ck-preview')?.focus(); return; }
  if (a === 'toggle') { const r = deskCkRow(key); r.on = !r.on; deskRender(); return; }
  if (a === 'open') {
    bl.open = bl.open === key ? null : key; deskRender();
    if (bl.open && el.dataset.focus === 'type') (document.querySelector(`[data-ck="type"][data-key="${CSS.escape(key)}"].on`) || document.querySelector(`[data-ck="scale"][data-key="${CSS.escape(key)}"].on`))?.focus();
    return;
  }
  if (a === 'type') { deskCkPatch(key, { type: el.dataset.v }); deskRender(); return; }
  if (a === 'scale') { deskCkPatch(key, { scale: Number(el.dataset.v) }); deskRender(); return; }
  if (a === 'required') { deskCkPatch(key, { required: !deskCkRow(key).item.required }); deskRender(); return; }
  if (a === 'mkey' || a === 'pose') {
    const r = deskCkRow(key), field = a === 'mkey' ? 'keys' : 'poses', list = r.item.options[field], v = el.dataset.v;
    const next = list.includes(v) ? list.filter(x => x !== v) : [...list, v];
    if (!next.length) { deskToast(a === 'mkey' ? 'Garde au moins une mensuration, ou décoche Mensurations.' : 'Garde au moins une pose, ou décoche Photos.'); return; }
    deskCkPatch(key, { options: { [field]: next } }); deskRender(); return;
  }
  if (a === 'up' || a === 'down') { deskCkMoveAndSay(deskCkMoveBy(d.rows, key, a === 'up' ? -1 : 1), `${a}-${key}`); return; }
  if (a === 'add-q-open') { bl.addQ = true; deskRender(); document.getElementById('addq-text')?.focus(); return; }
  if (a === 'add-q') {
    if (d.rows.filter(r => r.group === 'custom').length >= 20) { deskToast('Vingt questions au plus par bilan.'); return; }
    const it = deskCkNewQuestion(el.dataset.v);
    d.rows.push({ key: it.key, group: 'custom', on: true, item: it });
    Object.assign(bl, { addQ: false, open: it.key });
    deskRender(); document.getElementById(`lbl-${it.key}`)?.focus();
    return;
  }
  if (a === 'del-q') { d.rows = d.rows.filter(r => r.key !== key); bl.open = null; deskRender(); deskAnnounce('Question supprimée'); document.getElementById('addq')?.focus(); return; }
  if (a === 'freq') { d.base = { ...d.base, freq: el.dataset.v }; deskRender(); return; }
  if (a === 'remind') { d.base = { ...d.base, remind_after_h: d.base.remind_after_h === null ? 24 : null }; deskRender(); return; }
  if (a === 'recip') { bl.recip = !bl.recip; bl.own = null; deskRender(); document.getElementById(bl.recip ? 'ck-recip-done' : 'ck-recip')?.focus(); return; }
  if (a === 'target') {
    const { type, id } = el.dataset, i = d.targets.findIndex(t => t.type === type && t.id === id);
    if (i >= 0) d.targets.splice(i, 1); else d.targets.push({ type, id, own: null });
    deskRender(); return;
  }
  if (a === 'own') { bl.own = bl.own === el.dataset.id ? null : el.dataset.id; deskRender(); return; }
  if (a === 'own-freq') {
    const t = d.targets.find(x => x.type === 'student' && x.id === el.dataset.id);
    if (t) t.own = el.dataset.v === 'base' || el.dataset.v === d.base.freq ? null : { ...d.base, freq: el.dataset.v };
    bl.own = null; deskRender(); document.getElementById(`own-${el.dataset.id}`)?.focus(); return;
  }
  if (a === 'group-edit') {
    const g = bl.setup.groups.find(x => x.id === el.dataset.id);
    bl.group = g ? { id: g.id, name: g.name, members: [...g.members] } : { id: null, name: '', members: [] };
    deskRender(); document.getElementById('ck-gname')?.focus(); return;
  }
  if (a === 'gmember') {
    const g = bl.group, id = el.dataset.id;
    g.name = document.getElementById('ck-gname')?.value ?? g.name;
    g.members = g.members.includes(id) ? g.members.filter(x => x !== id) : [...g.members, id];
    deskRender(); return;
  }
  if (a === 'group-cancel') { bl.group = null; deskRender(); return; }
  if (a === 'group-save') { deskCkGroupSave(); return; }
  if (a === 'group-delete') {
    const g = bl.group;
    if (!(await deskConfirm({ title: `Supprimer le groupe « ${g.name} » ?`, text: 'Ses élèves restent tes élèves. Les envois programmés pour ce groupe s\'arrêtent.', ok: 'Supprimer', danger: true }))) return;
    const r = await deskRpc('coach_group_delete', { id: g.id });
    if (!r.ok) { deskToast(deskCkErrText(r.kind)); return; }
    d.targets = d.targets.filter(t => !(t.type === 'group' && t.id === g.id));
    bl.group = null;
    // Le serveur a retiré les plannings du groupe : ce bilan enregistré ne les a plus
    await deskOpenBilans({ force: true, keep: true });
    if (!deskCkDirty()) bl.saved = deskCkSnapshot(d);
    bl.recip = true; deskRender(); deskToast('Groupe supprimé');
    return;
  }
  if (a === 'revert') { deskCkSelect(d.id); deskRender(); deskToast('Changements annulés'); return; }
  if (a === 'save') { deskCkSave(); return; }
  if (a === 'send-now') { deskCkSendNow(); return; }
  if (a === 'duplicate') {
    if (deskCkDirty() && !(await deskConfirm({ title: 'Dupliquer la version enregistrée ?', text: 'Tes changements pas encore enregistrés ne seront pas copiés, et ils seront perdus.', ok: 'Dupliquer' }))) return;
    const r = await deskRpc('coach_template_duplicate', { id: d.id });
    if (!r.ok) { deskToast(deskCkErrText(r.kind)); return; }
    const t = cleanCheckinTemplate(r.data);
    bl.sel = t?.id || d.id;
    await deskOpenBilans({ force: true });
    deskRender(); deskToast(`Copie créée : « ${t?.name || ''} »`); document.getElementById('ck-name')?.focus();
    return;
  }
  if (a === 'delete') {
    if (!(await deskConfirm({ title: `Supprimer « ${d.name} » ?`, text: 'Ses envois programmés s\'arrêtent. Les bilans déjà reçus restent dans la fiche de chaque élève.', ok: 'Supprimer', danger: true }))) return;
    const r = await deskRpc('coach_template_delete', { id: d.id });
    if (!r.ok) { deskToast(deskCkErrText(r.kind)); return; }
    bl.sel = null; bl.draft = null;
    await deskOpenBilans({ force: true });
    deskRender(); deskToast('Bilan supprimé');
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (deskRoute().name !== 'bilans' || !bl.draft) return;
  if (t.id === 'ck-name') { bl.draft.name = t.value; deskCkSyncBar(); return; }
  if (t.id === 'ck-gname' && bl.group) { bl.group.name = t.value; return; }
  if (t.dataset.ckField) {
    deskCkPatch(t.dataset.key, { [t.dataset.ckField]: t.value });
    deskCkSyncBar();
    // Libellé et sous-titre de la ligne mis à jour sur place : un rendu complet au moment où le champ perd le focus
    // remplacerait le bouton que le coach est en train de toucher (le clic serait perdu)
    const it = deskCkRow(t.dataset.key)?.item, main = document.getElementById(`main-${t.dataset.key}`);
    if (it && main) {
      const b = main.querySelector('b'), sm = main.querySelector('small');
      if (b) b.textContent = it.kind === 'custom' ? (it.label ? `« ${it.label} »` : 'Nouvelle question') : it.label;
      if (sm) sm.textContent = deskCkItemSub(it);
    }
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (deskRoute().name !== 'bilans' || !bl.draft) return;
  if (t.dataset.ckSel) { bl.draft.base = { ...bl.draft.base, [t.dataset.ckSel]: Number(t.value) }; deskRender(); }
});

// Glisser-déposer à la poignée (souris, doigt, stylet) : la ligne suit le pointeur (translation), un trait montre où
// elle va tomber dans sa rubrique ; l'ordre est validé au relâchement et annoncé ; Échap ou une annulation remet
// l'ordre d'avant. Le DOM ne bouge pas pendant le geste (le pointeur capturé n'est jamais perdu).
let deskCkDrag = null;
document.addEventListener('pointerdown', e => {
  const g = e.target.closest?.('[data-ck-grip]');
  if (!g || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const li = g.closest('li.ck-row');
  e.preventDefault();
  deskCkDrag = { key: g.dataset.ckGrip, li, ul: li.parentElement, id: e.pointerId, y: e.clientY, moved: false, to: [...li.parentElement.children].indexOf(li) };
  try { g.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ }
  li.classList.add('drag');
});
// Place visée : nombre de lignes (hors celle qu'on glisse) dont le milieu est au-dessus du pointeur
function deskCkDropIndex(dr, y) {
  const sibs = [...dr.ul.children].filter(x => x !== dr.li);
  const i = sibs.findIndex(x => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return { to: i < 0 ? sibs.length : i, mark: i < 0 ? null : sibs[i] };
}
window.addEventListener('pointermove', e => {
  const dr = deskCkDrag;
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
function deskCkDragEnd(e, cancel) {
  const dr = deskCkDrag;
  if (!dr || (e && e.pointerId !== dr.id)) return;
  deskCkDrag = null;
  if (cancel || !dr.moved) { deskRender(); return; }
  if (e) dr.to = deskCkDropIndex(dr, e.clientY).to;
  deskCkMoveAndSay(deskCkMove(bl.draft.rows, dr.key, dr.to), `grip-${dr.key}`);
}
window.addEventListener('pointerup', e => deskCkDragEnd(e, false));
// Firefox lance sinon son propre glisser-déposer (qui annule les pointeurs) quand la souris bouge sur la poignée
document.addEventListener('dragstart', e => { if (e.target.closest?.('[data-ck-grip]') || deskCkDrag) e.preventDefault(); });
document.addEventListener('lostpointercapture', e => { if (deskCkDrag && e.pointerId === deskCkDrag.id && e.target.isConnected === false) deskCkDragEnd(e, true); });
document.addEventListener('mousedown', e => { if (e.target.closest?.('[data-ck-grip]')) e.preventDefault(); });
window.addEventListener('pointercancel', e => deskCkDragEnd(e, true));
// Clavier sur la poignée : flèches haut et bas, Début et Fin
document.addEventListener('keydown', e => {
  const g = e.target.closest?.('[data-ck-grip]');
  if (e.key === 'Escape' && deskCkDrag) { deskCkDragEnd(null, true); return; }
  if (!g || !bl.draft) return;
  const key = g.dataset.ckGrip;
  const n = deskCkGroupRows(bl.draft.rows, deskCkRow(key).group).length;
  const res = e.key === 'ArrowUp' ? deskCkMoveBy(bl.draft.rows, key, -1) : e.key === 'ArrowDown' ? deskCkMoveBy(bl.draft.rows, key, 1)
    : e.key === 'Home' ? deskCkMove(bl.draft.rows, key, 0) : e.key === 'End' ? deskCkMove(bl.draft.rows, key, n - 1) : null;
  if (!res) return;
  e.preventDefault();
  deskCkMoveAndSay(res, `grip-${key}`);
});
// Fermer l'onglet avec des changements : le navigateur demande confirmation
window.addEventListener('beforeunload', e => { if (deskCkDirty() || (typeof deskRvDirty === 'function' && deskRvDirty())) { e.preventDefault(); e.returnValue = ''; } });
