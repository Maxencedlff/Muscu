// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : onglet Programme de la fiche (#/eleve/<id>/programme ; docs/COACH_WEB.md, vague 4 ;
//  maquette 4-programme)
//
//  L'éditeur des séances de l'élève en grand écran : exercices, séries, fourchette ou reps fixes, charge prescrite (une
//  pour toutes les séries, ou série par série : top set et back-off), repos, technique d'intensification et « sur
//  quelle série », consigne ; colonne « La dernière fois » (ce que l'élève a fait, face à la fourchette). Envoi à
//  l'élève, ou à plusieurs élèves (chacun garde SES charges prescrites). Logique et format : js/desk/prog-model.js
//  (format de l'app, sans divergence). Rien n'est modifié sur l'iPhone du coach : ses programmes restent les siens ;
//  l'élève reçoit une mise à jour, comme depuis l'écran Envoyer de l'app.
//  Changements pas envoyés : barre collée en bas, confirmation avant de quitter la fiche ou l'onglet du navigateur.
// ═══════════════════════════════════════════════════════════
'use strict';

const pg = { id: null, loading: false, kind: null, via: null, list: [], progId: null, fresh: false, draft: null, saved: '', sel: 0, open: null, busy: false, at: 0 };
const deskDocCache = { data: undefined, kind: null, at: 0 };

const deskPgDirty = () => !!pg.draft && (pg.fresh || deskPgSnapshot(pg.draft, pg.progId) !== pg.saved);
// Serveur sans coach_student_programmes : un programme déjà envoyé se lit seulement (sa version du compte n'a pas les
// charges prescrites depuis l'iPhone : la renvoyer les effacerait chez l'élève) ; un programme pas encore envoyé part
const deskPgReadOnly = () => pg.via === 'doc' && !pg.fresh;
function deskPgReset() { Object.assign(pg, { id: null, draft: null, saved: '', list: [], progId: null, fresh: false, open: null, at: 0 }); }
async function deskPgLeaveOk() {
  if (!deskPgDirty()) return true;
  return deskConfirm({ title: 'Quitter sans envoyer le programme ?', text: 'Tes changements seront perdus. Touche « Envoyer » pour que ton élève les reçoive.', ok: 'Quitter sans envoyer', danger: true });
}

// Mon compte (programmes, plans diète), relu au plus toutes les 60 s
async function deskDoc({ force = false } = {}) {
  if (!force && deskDocCache.data !== undefined && Date.now() - deskDocCache.at < DESK_REFRESH_MS) return deskDocCache;
  const r = await deskLoadDoc();
  Object.assign(deskDocCache, r.ok ? { data: r.data, kind: null } : { data: deskDocCache.data ?? null, kind: r.kind }, { at: Date.now() });
  return deskDocCache;
}

async function deskPgOpen(id, { force = false } = {}) {
  if (!force && pg.id === id && (pg.loading || pg.draft || Date.now() - pg.at < DESK_REFRESH_MS)) { deskPgSyncSel(); deskRender(); return; }
  Object.assign(pg, { id, loading: true, kind: null, draft: null, list: [], at: Date.now(), open: null, fresh: false });
  deskRender();
  const [sent, doc] = await Promise.all([deskLoadSentProgs(id), deskDoc()]);
  if (pg.id !== id) return;
  pg.loading = false;
  if (!sent.ok && sent.kind === 'signed_out') return deskEndSession();
  if (sent.ok) { pg.via = 'sent'; pg.list = sent.data.programmes.map(p => ({ ...p, src: 'sent' })); }
  else if (sent.kind === 'missing') {
    // Serveur sans coach_student_programmes : la version de mes programmes gardée sur mon compte, pour ce que j'ai envoyé
    pg.via = 'doc';
    const st = deskChatRow(id)?.st;
    pg.list = (st?.sent || []).filter(x => !isDietSentId(x.id)).sort((a, b) => b.sentAt - a.sentAt).map(x => {
      const v = doc.data ? coachSentPayload(programmeToSent(doc.data, x.id), x.id) : { ok: false };
      return v.ok ? { id: x.id, sentAt: x.sentAt, seen: x.seen, data: v.data, src: 'doc' } : null;
    }).filter(Boolean);
  } else { pg.kind = sent.kind; deskRender(); return; }
  deskPgUse(pg.list.find(p => p.id === pg.progId) || pg.list[0] || null);
  deskRender();
}
// Programme mis dans l'éditeur (p : un envoi de la liste, ou un de mes programmes pas encore envoyé, fresh)
function deskPgUse(p, { fresh = false } = {}) {
  pg.progId = p?.id || null;
  pg.draft = p ? deskPgDraft(p.data) : null;
  pg.saved = p && !fresh ? deskPgSnapshot(pg.draft, p.id) : '';
  pg.fresh = fresh;
  pg.open = null;
  deskPgSyncSel();
}
// Séance choisie : celle de la route (#/eleve/<id>/programme/<clé>), sinon la première
function deskPgSyncSel() {
  const key = deskRoute().part, n = pg.draft?.sessions.findIndex(s => s.key === key) ?? -1;
  pg.sel = n >= 0 ? n : Math.min(pg.sel, Math.max(0, (pg.draft?.sessions.length || 1) - 1));
}
const deskPgEx = k => { for (const s of pg.draft?.sessions || []) { const e = s.exercises.find(x => x._k === k); if (e) return { s, e }; } return null; };

// ── Gabarits ────────────────────────────────────────────────

const deskPgKg = v => (v === null || v === undefined ? '' : fmtNum(v, 3));
const deskPgIn = (id, f, k, value, label, { mode = 'numeric', cls = '' } = {}) =>
  `<input class="in ${cls}" id="${id}" data-pg-f="${f}" data-k="${k}" inputmode="${mode}" autocomplete="off" value="${esc(value)}" aria-label="${esc(label)}">`;
function deskPgRestSel(e, id) {
  const opts = [['', 'Par défaut'], ...DESK_PG_RESTS.map(s => [String(s), fmtRest(s)])];
  if (e.rest && !DESK_PG_RESTS.includes(e.rest)) opts.push([String(e.rest), fmtRest(e.rest)]);
  return deskCkSelectHtml(id, `Repos, ${e.name}`, opts, e.rest ? String(e.rest) : '', `data-pg-f="rest" data-k="${e._k}"`);
}

function deskPgRowHtml(e, i, n, rows, name) {
  const k = e._k, reps = measureOf(e) === 'reps', rp = deskPgReps(e), ld = deskPgLoads(e);
  const tag = intensText(e, { short: true });
  const muscles = (catalogueEntry(e.name)?.primary || []).slice(0, 3).map(muscleLabel).filter(Boolean).join(', ');
  const exCell = `<div class="pg-ex"><b>${esc(e.name)}</b>${tag ? ` <span class="tag">${esc(tag.charAt(0).toUpperCase() + tag.slice(1))}</span>` : ''}${e.ss ? ' <span class="tag">Superset</span>' : ''}
    ${muscles ? `<small>${esc(muscles)}</small>` : ''}${e.consigne ? `<span class="cons">${esc(`« ${e.consigne} »`)}</span>` : ''}</div>`;
  const repsCell = !reps ? `<span class="muted">${esc(measureOf(e) === 'time' ? 'Maintien' : 'Cardio')}</span>`
    : rp.fixed ? `${deskPgIn(`pg-hi-${k}`, 'repMax', k, rp.hi, `Reps fixes, ${e.name}`)}<span class="muted">reps</span>`
      : `${deskPgIn(`pg-lo-${k}`, 'repMin', k, rp.lo ?? '', `Reps, bas de la fourchette, ${e.name}`)}<span class="muted">à</span>${deskPgIn(`pg-hi-${k}`, 'repMax', k, rp.hi, `Reps, haut de la fourchette, ${e.name}`)}`;
  const loadCell = !reps ? '<span class="faint">—</span>' : ld.mode === 'sets'
    ? `<div class="loads">${ld.loads.map((kg, j) => `<span class="ld">${deskPgIn(`pg-ld${j}-${k}`, `loads.${j}`, k, deskPgKg(kg), `Charge de la série ${j + 1}, ${e.name}`, { mode: 'decimal', cls: kg !== null && j === 0 && prescSetTag(e, 0) ? 'on' : '' })}<small>${esc(prescSetTag(e, j) || `série ${j + 1}`)}</small></span>`).join('')}</div>`
    : deskPgIn(`pg-ld-${k}`, 'load', k, deskPgKg(ld.load), `Charge prescrite en kilos, ${e.name}`, { mode: 'decimal', cls: 'w' });
  const last = deskPgLast(rows, e);
  const lastCell = last ? `<span class="tnum">${esc(last.text)}</span>${last.word ? `<span class="${last.status === 'under' ? 'warn' : 'green'} blk">${esc(last.word)}</span>` : ''}<small class="blk faint">${esc(fmtDate(last.doneAt, 'short'))}</small>`
    : `<span class="faint">${reps ? 'Pas encore fait' : '—'}</span>`;
  const open = pg.open === k;
  return `<li class="pg-row${open ? ' open' : ''}" data-k="${k}">
    ${exCell}
    <div class="pg-c pg-sets"><span class="pg-l" aria-hidden="true">Séries</span><span class="pg-v">${deskPgIn(`pg-sets-${k}`, 'sets', k, e.sets, `Séries, ${e.name}`)}</span></div>
    <div class="pg-c pg-reps"><span class="pg-l" aria-hidden="true">Reps</span><span class="pg-v">${repsCell}</span></div>
    <div class="pg-c pg-load"><span class="pg-l" aria-hidden="true">Charge (kg)</span><span class="pg-v">${loadCell}</span></div>
    <div class="pg-c pg-rest"><span class="pg-l" aria-hidden="true">Repos</span><span class="pg-v">${deskPgRestSel(e, `pg-rest-${k}`)}</span></div>
    <div class="pg-c pg-last"><span class="pg-l" aria-hidden="true">La dernière fois</span><span class="pg-v blk">${lastCell}</span></div>
    <div class="pg-act"><button type="button" class="btn link" data-pg="open" data-k="${k}" aria-expanded="${open}" aria-controls="pg-set-${k}" id="pg-open-${k}">Réglages<span class="sr">${esc(`, ${e.name}`)}</span></button></div>
    ${open ? deskPgSettingsHtml(e, i, n, name) : ''}
  </li>`;
}

function deskPgSettingsHtml(e, i, n, name) {
  const k = e._k, reps = measureOf(e) === 'reps', rp = deskPgReps(e), ld = deskPgLoads(e), tc = deskPgTech(e);
  const radio = (act, v, on, label) => `<button type="button" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" data-pg="${act}" data-k="${k}" data-v="${v}">${esc(label)}</button>`;
  const sub = !!TECHS[tc.tech]?.sub;
  const where = tc.where;
  const chip = (act, v, on, label, role = 'radio') => `<button type="button" class="chip" role="${role}" aria-checked="${on}" data-pg="${act}" data-k="${k}" data-v="${v}">${esc(label)}</button>`;
  const chips = sub ? `<div class="fld sm"><span id="pg-wh-${k}">Sur quelle série</span><div class="chips" role="group" aria-labelledby="pg-wh-${k}">
      ${chip('where', 'last', where === 'last', 'Dernière')}${chip('where', 'all', where === 'all', 'Toutes')}
      ${Array.from({ length: e.sets }, (_, j) => chip('set-n', j + 1, Array.isArray(where) ? where.includes(j + 1) : where === 'all' || j === e.sets - 1, `Série ${j + 1}`, 'checkbox')).join('')}
    </div><span class="t2">${esc(intensText(e) || '')}</span></div>` : '';
  return `<div class="pg-set" id="pg-set-${k}" role="group" aria-label="${esc(`Réglages de ${e.name}`)}">
    ${reps ? `<div class="fld sm"><span id="pg-rm-${k}">Reps</span><div class="seg" role="radiogroup" aria-labelledby="pg-rm-${k}">${radio('reps-mode', 'range', !rp.fixed, 'Fourchette')}${radio('reps-mode', 'fixed', rp.fixed, 'Fixes')}</div></div>
    <div class="fld sm"><span id="pg-lm-${k}">Charge prescrite</span><div class="seg" role="radiogroup" aria-labelledby="pg-lm-${k}">${radio('load-mode', 'one', ld.mode === 'one', 'Même charge')}${radio('load-mode', 'sets', ld.mode === 'sets', 'Série par série')}</div>
      <span class="t2">${esc(`${name} la voit dans sa séance, avec la fourchette. Vide : pas de charge prescrite.`)}</span></div>
    <div class="fld sm"><span aria-hidden="true">Technique d'intensification</span>${deskCkSelectHtml(`pg-tech-${k}`, `Technique d'intensification, ${e.name}`, DESK_PG_TECHS, tc.tech, `data-pg-f="tech" data-k="${k}"`)}</div>
    ${chips}` : ''}
    <div class="fld sm pg-cons"><label for="pg-cons-${k}">Consigne pour ${esc(name)}</label><textarea id="pg-cons-${k}" data-pg-f="consigne" data-k="${k}" rows="2" maxlength="${CONSIGNE_MAX}" placeholder="Ex : 2 reps en réserve sur le top set">${esc(e.consigne || '')}</textarea></div>
    <div class="ck-acts"><button type="button" class="btn" data-pg="up" data-k="${k}" ${i === 0 ? 'aria-disabled="true"' : ''}>${deskIcon('up', 'sm')}Monter</button>
      <button type="button" class="btn" data-pg="down" data-k="${k}" ${i === n - 1 ? 'aria-disabled="true"' : ''}>${deskIcon('down', 'sm')}Descendre</button>
      <button type="button" class="btn danger" data-pg="remove" data-k="${k}">${deskIcon('trash', 'sm')}Retirer l'exercice</button></div>
  </div>`;
}

function deskPgHtml(r) {
  const name = r.name;
  if (pg.id !== r.id || pg.loading) return '<div class="empty" role="status">Chargement du programme…</div>';
  if (pg.kind) return `<div class="empty" role="alert">${esc(deskErrorText(pg.kind))}<br><button type="button" class="btn tint" data-pg="retry">Réessayer</button></div>`;
  const mine = deskSendableProgs(deskDocCache.data);
  if (!pg.draft) {
    return `<div class="empty"><b>${esc(`Aucun programme envoyé à ${name} pour l'instant.`)}</b><br>${mine.length ? 'Choisis un de tes programmes : tu pourras régler ses séances ici avant de l\'envoyer.' : 'Crée d\'abord un programme dans l\'app iPhone (onglet Programme) : il arrivera ici avec ton compte.'}
      ${mine.length ? '<br><button type="button" class="btn tint" data-pg="send-mine">Choisir un de mes programmes</button>' : ''}</div>`;
  }
  const d = pg.draft, s = d.sessions[pg.sel] || d.sessions[0];
  const cur = pg.list.find(p => p.id === pg.progId);
  const rows = view.student?.id === r.id ? view.student.sessions || [] : [];
  const sessTabs = d.sessions.map((x, i) => `<button type="button" role="radio" aria-checked="${i === pg.sel}" class="${i === pg.sel ? 'on' : ''}" data-pg="session" data-v="${i}">${esc(x.label)}</button>`).join('');
  const progSel = pg.list.length + (pg.fresh ? 1 : 0) > 1
    ? deskCkSelectHtml('pg-prog', 'Programme', [...(pg.fresh ? [[pg.progId, `${d.name} (pas encore envoyé)`]] : []), ...pg.list.map(p => [p.id, p.data.name])], pg.progId, 'data-pg-f="prog"') : '';
  const info = pg.fresh ? `« ${d.name} » · pas encore envoyé à ${name}` : `« ${d.name} » · ${deskPgSentText(cur, name)}`;
  const note = deskPgReadOnly() ? `<p class="gfoot pg-note">${esc(`Version de ce programme gardée sur ton compte, en lecture seule : le serveur ne rend pas encore la version reçue par ${name} (mise à jour à venir). Les charges prescrites depuis l'iPhone n'y sont pas ; pour modifier ce programme, passe par l'app en attendant.`)}</p>` : '';
  const list = s && s.exercises.length ? `<ul class="group pg-list" aria-label="${esc(`Exercices de la séance ${s.label}`)}">
      <li class="pg-row pg-hdr" aria-hidden="true"><span>Exercice</span><span>Séries</span><span>Reps</span><span>Charge (kg)</span><span class="pg-rest">Repos</span><span>La dernière fois</span><span></span></li>
      ${s.exercises.map((e, i) => deskPgRowHtml(e, i, s.exercises.length, rows, name)).join('')}</ul>`
    : `<div class="empty">Aucun exercice dans cette séance.</div>`;
  const dirty = deskPgDirty();
  return `<div class="head pg-head"><div class="seg" role="radiogroup" aria-label="Séance">${sessTabs}</div>${progSel}
      <div class="grow sub pg-info">${esc(info)}</div></div>${note}
    ${list}
    <form class="pg-add" data-pg-form="add"><label class="sr" for="pg-add">Ajouter un exercice à ${esc(s?.label || 'la séance')}</label>
      <input id="pg-add" class="in wide" list="pg-names" placeholder="Ajouter un exercice" autocomplete="off" maxlength="80" ${s && s.exercises.length >= DESK_PG_EX_MAX ? 'disabled' : ''}>
      <datalist id="pg-names">${catalogueNames().map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>
      <button class="btn link">${deskIcon('plus', 'sm')}Ajouter</button></form>
    <div class="savebar${dirty ? ' stick' : ''}" role="region" aria-label="Envoi du programme">
      <span class="grow muted">${dirty ? `${deskIcon('pen', 'sm')}${esc(pg.fresh ? `Pas encore envoyé à ${name}.` : `Changements pas encore envoyés à ${name}.`)}` : esc(`Charges prescrites par toi ; ${name} les voit dans sa séance avec la fourchette.`)}</span>
      ${dirty && !pg.fresh ? '<button type="button" class="btn" data-pg="reset">Annuler les changements</button>' : ''}
      <button type="button" class="btn" data-pg="send-many" ${pg.busy || pg.via === 'doc' ? 'disabled' : ''}>Envoyer à plusieurs élèves</button>
      <button type="button" class="btn tint" data-pg="send" ${pg.busy ? 'disabled aria-busy="true"' : deskPgReadOnly() ? 'disabled' : ''}>${deskIcon('send', 'sm')}${esc(pg.fresh ? `Envoyer à ${name}` : 'Envoyer la mise à jour')}</button>
    </div>`;
}

// ── Gestes ──────────────────────────────────────────────────

// Champ encore en cours de saisie (au doigt, le champ ne perd le focus qu'après le toucher sur « Envoyer ») : pris
// en compte avant l'envoi, comme si le coach l'avait quitté
function deskPgCommitFocused() {
  const t = document.activeElement, f = t?.dataset?.pgF;
  if (!f || f === 'prog' || !t.dataset.k) return;
  const x = deskPgEx(t.dataset.k);
  if (x) deskPgPatch(x.e, f, t.value);
}
async function deskPgSend() {
  const id = pg.id, name = deskChatRow(id)?.name || 'ton élève';
  if (!pg.draft || pg.busy) return;
  deskPgCommitFocused();
  const v = deskPgPayload(pg.draft, pg.progId);
  if (!v.ok) { deskToast(coachErrorText(v.kind)); return; }
  pg.busy = true; deskRender();
  const r = await deskSendProg(id, pg.progId, v.data);
  pg.busy = false;
  if (!r.ok) { if (r.kind === 'signed_out') return deskEndSession(); deskToast(coachErrorText(r.kind)); deskRender(); return; }
  deskPgSent(v.data);
  deskRender();
  deskToast(`Programme envoyé à ${name}`);
  deskRefresh({ force: true });
}
// Envoi réussi : l'éditeur repart de ce qui est parti
function deskPgSent(data) {
  const entry = { id: pg.progId, data, sentAt: Date.now(), seen: false, src: 'sent' };
  pg.list = [entry, ...pg.list.filter(p => p.id !== pg.progId)];
  pg.fresh = false;
  pg.saved = deskPgSnapshot(pg.draft, pg.progId);
}

// Plusieurs élèves : cases à cocher (l'élève de la fiche coché d'avance), « Tout cocher », limite des 24 h
function deskPickStudents({ title, text, preset }) {
  return new Promise(resolve => {
    const rows = view.dash?.rows || [];
    const on = new Set(preset);
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm choose';
    dlg.setAttribute('aria-labelledby', 'pk-title');
    const paint = () => {
      dlg.querySelector('.ch-list').innerHTML = rows.map((r, i) => `<button type="button" role="checkbox" class="row ch-o" id="pk-${i}" data-v="${esc(r.id)}" aria-checked="${on.has(r.id)}">
        <span class="circ" aria-hidden="true">${deskIcon('check', 'xs')}</span>${deskAvatar(r.name, 'sm-av')}<span class="grow">${esc(r.name)}<span class="t2 blk">${esc(r.phase?.text || '')}</span></span></button>`).join('');
      const go = dlg.querySelector('[data-cf="yes"]');
      go.disabled = !on.size;
      go.textContent = on.size ? `Envoyer à ${plural(on.size, 'élève', 'élèves')}` : 'Envoyer';
      dlg.querySelector('[data-cf="all"]').textContent = rows.every(r => on.has(r.id)) ? 'Tout décocher' : 'Tout cocher';
      frTypoNode(dlg);
    };
    dlg.innerHTML = `<h2 id="pk-title" class="dlg-t">${esc(title)}</h2><p class="dlg-p">${esc(text)}</p>
      <div class="group ch-list" role="group" aria-labelledby="pk-title"></div>
      <div class="dlg-f"><button type="button" class="btn link" data-cf="all">Tout cocher</button><span class="grow"></span><button type="button" class="btn" data-cf="no">Annuler</button><button type="button" class="btn tint" data-cf="yes">Envoyer</button></div>`;
    document.body.appendChild(dlg);
    paint();
    let answer = null;
    dlg.addEventListener('click', e => {
      const o = e.target.closest('.ch-o');
      if (o) { const v = o.dataset.v; if (on.has(v)) on.delete(v); else on.add(v); const idx = o.id; paint(); dlg.querySelector(`#${idx}`)?.focus(); return; }
      const b = e.target.closest('[data-cf]');
      if (!b) return;
      if (b.dataset.cf === 'all') { const all = rows.every(r => on.has(r.id)); rows.forEach(r => (all ? on.delete(r.id) : on.add(r.id))); paint(); return; }
      answer = b.dataset.cf === 'yes' ? [...on] : null;
      dlg.close();
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
    dlg.showModal();
    dlg.querySelector('.ch-o')?.focus();
  });
}

async function deskPgSendMany() {
  const id = pg.id, progId = pg.progId;
  if (!pg.draft || pg.busy) return;
  deskPgCommitFocused();
  const v = deskPgPayload(pg.draft, progId);
  if (!v.ok) { deskToast(coachErrorText(v.kind)); return; }
  const ids = await deskPickStudents({ title: `Envoyer « ${pg.draft.name} »`,
    text: 'Les élèves cochés reçoivent ces séances. Chacun garde les charges que tu lui as prescrites (rien pour un exercice qu\'il n\'avait pas).', preset: [id] });
  if (!ids?.length) return;
  const limit = coachSendLimit(view.dash?.rows.length || 0);
  if (ids.length > limit) { deskToast(`La limite est de ${limit} envois sur 24 heures (30, plus 2 par élève) : décoche ${plural(ids.length - limit, 'élève', 'élèves')}.`); return; }
  pg.busy = true; deskRender();
  const res = await coachSendQueue(ids, async uid => {
    if (uid === id) return deskSendProg(uid, progId, v.data);
    // Ses charges : lues de ce qu'il a reçu ; lecture impossible → rien ne part pour lui (jamais ses charges effacées)
    const theirs = await deskLoadSentProgs(uid);
    if (!theirs.ok) return theirs;
    const t = theirs.data.programmes.find(p => p.id === progId)?.data || null;
    const o = deskPgPayload(deskPgForOther(pg.draft, t), progId);
    return o.ok ? deskSendProg(uid, progId, o.data) : o;
  });
  pg.busy = false;
  if (res.sent.includes(id)) deskPgSent(v.data);
  deskRender();
  const nameOf = u => deskChatRow(u)?.name || 'élève';
  if (!res.failed.length && !res.left) deskToast(`« ${pg.draft.name} » envoyé à ${plural(res.sent.length, 'élève', 'élèves')}`);
  else {
    const why = res.rate ? coachErrorText('send_rate') : coachErrorText(res.failed[0]?.kind);
    await deskConfirm({ title: res.sent.length ? `Envoyé à ${res.sent.length} sur ${ids.length}` : 'Rien n\'a été envoyé',
      text: `${why} Pas reçu : ${[...res.failed.map(f => f.uid), ...ids.filter(u => !res.sent.includes(u) && !res.failed.some(f => f.uid === u))].map(nameOf).join(', ')}.`, ok: 'OK', cancel: false });
  }
  deskRefresh({ force: true });
}

// « Envoyer un programme » (en-tête de la fiche) : un de mes programmes, mis dans l'éditeur avant l'envoi
async function deskPgPickMine(id) {
  if (deskPgDirty() && pg.id === id && !(await deskPgLeaveOk())) return;
  const doc = await deskDoc();
  const mine = deskSendableProgs(doc.data);
  if (!mine.length) {
    deskToast(doc.kind ? deskErrorText(doc.kind) : 'Aucun programme sur ton compte : crée-en un dans l\'app iPhone (onglet Programme).');
    return;
  }
  const choice = await deskChoose({ title: 'Envoyer un programme', text: `Choisis un de tes programmes pour ${deskChatRow(id)?.name || 'ton élève'} : tu règles ses séances, puis tu l'envoies.`,
    options: mine.map(p => [p.id, p.name, plural(p.sessions, 'séance', 'séances')]), ok: 'Ouvrir dans l\'éditeur' });
  if (!choice) return;
  if (deskRoute().tab !== 'programme' || deskRoute().id !== id) { location.hash = `#/eleve/${encodeURIComponent(id)}/programme`; await deskPgOpen(id); }
  if (pg.loading) await new Promise(res => { const t = setInterval(() => { if (!pg.loading) { clearInterval(t); res(); } }, 50); });
  const sent = pg.list.find(p => p.id === choice);
  if (sent) deskPgUse(sent);
  else deskPgUse(mine.find(p => p.id === choice), { fresh: true });
  deskRender();
  document.querySelector('[data-pg="session"]')?.focus();
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-pg]');
  if (!el) return;
  const a = el.dataset.pg, route = deskRoute();
  if (a === 'send-mine') { if (route.name === 'student') deskPgPickMine(route.id); return; }
  if (route.tab !== 'programme' || el.getAttribute('aria-disabled') === 'true') return;
  const x = el.dataset.k ? deskPgEx(el.dataset.k) : null;
  const say = t => deskAnnounce(t);
  if (a === 'retry') { deskPgOpen(route.id, { force: true }); return; }
  if (a === 'session') { pg.sel = Number(el.dataset.v) || 0; pg.open = null; history.replaceState(null, '', `#/eleve/${encodeURIComponent(route.id)}/programme/${encodeURIComponent(pg.draft.sessions[pg.sel].key)}`); deskRender(); document.querySelector(`[data-pg="session"][data-v="${pg.sel}"]`)?.focus(); return; }
  if (a === 'open' && x) { pg.open = pg.open === x.e._k ? null : x.e._k; deskRender(); document.getElementById(`pg-open-${x.e._k}`)?.focus(); return; }
  if ((a === 'reps-mode' || a === 'load-mode' || a === 'where') && x) {
    deskPgPatch(x.e, { 'reps-mode': 'repsMode', 'load-mode': 'loadMode', where: 'where' }[a], el.dataset.v);
    deskRender(); document.querySelector(`[data-pg="${a}"][data-k="${x.e._k}"][data-v="${el.dataset.v}"]`)?.focus(); return;
  }
  if (a === 'set-n' && x) {
    const tc = deskPgTech(x.e);
    deskPgPatch(x.e, 'where', deskPgToggleSet(tc.where, Number(el.dataset.v), x.e.sets));
    say(intensText(x.e)); deskRender(); document.querySelector(`[data-pg="set-n"][data-k="${x.e._k}"][data-v="${el.dataset.v}"]`)?.focus(); return;
  }
  if ((a === 'up' || a === 'down') && x) {
    const pos = deskPgMove(x.s, x.e._k, a === 'up' ? -1 : 1);
    if (pos) { say(`${x.e.name} déplacé en position ${pos}`); deskRender(); document.querySelector(`[data-pg="${a}"][data-k="${x.e._k}"]`)?.focus(); }
    return;
  }
  if (a === 'remove' && x) {
    if (!(await deskConfirm({ title: `Retirer ${x.e.name} ?`, text: `Il partira de la séance « ${x.s.label} » au prochain envoi.`, ok: 'Retirer', danger: true }))) return;
    x.s.exercises = x.s.exercises.filter(y => y !== x.e); pg.open = null; say(`${x.e.name} retiré`); deskRender(); document.getElementById('pg-add')?.focus(); return;
  }
  if (a === 'reset') { const cur = pg.list.find(p => p.id === pg.progId); if (cur) deskPgUse(cur); deskRender(); say('Changements annulés'); return; }
  if (a === 'send') deskPgSend();
  if (a === 'send-many') deskPgSendMany();
});
document.addEventListener('change', e => {
  const t = e.target, f = t.dataset?.pgF;
  if (!f || deskRoute().tab !== 'programme') return;
  if (f === 'prog') {
    const p = pg.list.find(x => x.id === t.value);
    (async () => { if (!p || (deskPgDirty() && !(await deskPgLeaveOk()))) { deskRender(); return; } deskPgUse(p); deskRender(); document.getElementById('pg-prog')?.focus(); })();
    return;
  }
  const x = deskPgEx(t.dataset.k);
  if (!x) return;
  deskPgPatch(x.e, f, t.value);
  deskPgRenderSafe();
});
// Un champ quitté par un clic ou un toucher (taper une charge puis toucher « Envoyer ») : le rendu attend la fin du clic,
// sinon le bouton serait remplacé entre l'appui et le clic, et le clic perdu. Au doigt, le navigateur envoie mousedown
// (qui fait quitter le champ) puis click APRÈS pointerup : on attend donc le click (600 ms au plus).
let deskPgPtrAt = 0, deskPgLater = 0;
function deskPgFlush() { clearTimeout(deskPgLater); deskPgLater = 0; deskRender(); }
function deskPgRenderSafe() {
  if (Date.now() - deskPgPtrAt > 1000) { deskRender(); return; }
  clearTimeout(deskPgLater);
  deskPgLater = setTimeout(deskPgFlush, 600);
}
document.addEventListener('pointerdown', () => { deskPgPtrAt = Date.now(); }, true);
document.addEventListener('mousedown', () => { deskPgPtrAt = Date.now(); }, true);
document.addEventListener('click', () => { if (deskPgLater) setTimeout(deskPgFlush, 0); }, true);
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-pg-form="add"]');
  if (!f) return;
  e.preventDefault();
  const input = document.getElementById('pg-add'), s = pg.draft?.sessions[pg.sel];
  const ex = deskPgNewExercise(input?.value);
  if (!s || !ex) { input?.focus(); return; }
  if (s.exercises.length >= DESK_PG_EX_MAX) { deskToast(`${DESK_PG_EX_MAX} exercices au plus par séance.`); return; }
  s.exercises.push(ex);
  pg.open = ex._k;
  deskRender();
  deskAnnounce(`${ex.name} ajouté à ${s.label} : 3 séries de 8 à 12 reps`);
  document.getElementById(`pg-sets-${ex._k}`)?.focus();
});
window.addEventListener('beforeunload', e => { if (deskPgDirty()) { e.preventDefault(); e.returnValue = ''; } });
