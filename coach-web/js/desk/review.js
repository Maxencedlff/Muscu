// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : bilans reçus (docs/COACH_WEB.md, vague 2 ; maquette 3-bilan)
//
//  - Onglet « Bilans » de la fiche élève (#/eleve/<id>/bilans[/<bilan>]) : bilan reçu, navigation d'un bilan à
//    l'autre, comparaison « face à » un bilan précédent (écarts du poids, des mensurations, des nombres, des
//    échelles), réponses lisibles (checkinValueText), photos face, profil, dos des deux bilans côte à côte (vague 5,
//    js/desk/photos.js), réponse du coach (2000 caractères au plus) et note de la semaine, « Brouillon » ou « Envoyer » (la
//    réponse part aussi dans la conversation, chat_send). Bilans en attente et pas remplis listés aussi.
//  - Liste « Bilans reçus » (#/bilans-recus) : bilans à répondre, puis ceux qu'on attend des élèves.
//  Une réponse en cours d'écriture reste en mémoire d'un bilan à l'autre ; quitter la fiche avec une réponse pas
//  enregistrée demande confirmation. Tout texte reçu passe par esc().
// ═══════════════════════════════════════════════════════════
'use strict';

// chatFail : réponse envoyée dans le bilan mais pas dans les messages (limite de chat_send, réseau) : { request, student, body }
const rv = { sel: null, cmp: {}, drafts: {}, busy: false, chatFail: null };

const deskRvSaved = r => ({ reply: r.review?.reply || '', score: r.review?.score ?? null });
const deskRvDraft = r => rv.drafts[r.id] || deskRvSaved(r);
// Une réponse écrite et pas encore enregistrée (brouillon ou envoi), sur n'importe quel bilan ouvert
function deskRvDirty() {
  const list = view.student?.checkins || [];
  return Object.entries(rv.drafts).some(([id, d]) => { const r = list.find(x => x.id === id); return r && JSON.stringify(d) !== JSON.stringify(deskRvSaved(r)); });
}
async function deskRvLeaveOk() {
  if (!deskRvDirty()) return true;
  const ok = await deskConfirm({ title: 'Quitter sans enregistrer ta réponse ?', text: 'Ce que tu as écrit sera perdu. Touche Brouillon pour le garder.', ok: 'Quitter sans enregistrer', danger: true });
  if (ok) rv.drafts = {};
  return ok;
}

const deskRvMissingHtml = () => `<div class="empty" role="alert"><b>Les bilans ne sont pas encore ouverts</b><br>Le serveur de MDLF n'a pas encore reçu la mise à jour des bilans configurables. Les semaines de tes élèves restent disponibles ; reviens un peu plus tard.<br><a class="btn" href="#/">Voir mes élèves</a></div>`;

function deskRvFigureHtml(f, cmpWeek) {
  const dec = f.unit === 'kg' || f.unit === 'cm';
  const v = dec ? deskKg(f.value) : fmtNum(f.value, 2);
  const dt = f.delta === null ? '' : dec ? deskSigned(f.delta, ` ${f.unit}`) : `${f.delta > 0 ? '+' : f.delta < 0 ? '−' : '±'}${fmtNum(Math.abs(f.delta), 2)}${f.unit ? ` ${f.unit}` : ''}`;
  return `<div class="stat"><span class="l">${esc(f.label)}</span><b>${esc(v)}${f.unit ? `<small>${esc(f.unit)}</small>` : ''}</b><span class="d muted">${dt ? esc(`${dt} depuis S${cmpWeek}`) : '&nbsp;'}</span></div>`;
}

function deskRvPanelHtml(d, r) {
  const c = d.checkins, now = d.now || Date.now();
  if (d.ckKind === 'missing') return deskRvMissingHtml();
  if (d.ckKind) return `<div class="empty" role="alert">${esc(deskErrorText(d.ckKind))}<br><button type="button" class="btn tint" data-action="reload">Réessayer</button></div>`;
  if (!c) return '<div class="empty" role="status">Chargement des bilans…</div>';
  const h = deskCkHistory(c);
  const waitHtml = (h.pending.length || h.missed.length) ? `<section class="gblock" aria-labelledby="h-wait"><h2 class="gh" id="h-wait">En attente de ${esc(r.name)}</h2><ul class="group" aria-labelledby="h-wait">
    ${h.pending.map(p => `<li><div class="row"><span class="grow">${esc(deskCkTitle(p, now).title)}<span class="t2 blk">${esc(p.name)}, envoyé ${esc(deskAgo(p.sentAt, now) || '')}</span></span><span class="v">${p.dueAt ? esc(`à rendre ${p.dueAt < now ? 'depuis' : 'avant'} le ${fmtDate(p.dueAt, 'short')}`) : 'pas encore rempli'}</span></div></li>`).join('')}
    ${h.missed.map(p => `<li><div class="row"><span class="grow">${esc(deskCkTitle(p, now).title)}<span class="t2 blk">${esc(p.name)}</span></span><span class="v muted">pas rempli à temps</span></div></li>`).join('')}
  </ul></section>` : '';
  if (!h.answered.length) {
    return `<div class="empty"><b>Pas encore de bilan reçu de ${esc(r.name)}.</b><br>Envoie-lui un bilan depuis Mes bilans : ses réponses arriveront ici.<br><a class="btn tint" href="#/bilans">Mes bilans</a></div>${waitHtml ? `<div class="gap-t">${waitHtml}</div>` : ''}`;
  }
  const idx = Math.max(0, h.answered.findIndex(x => x.id === rv.sel));
  const cur = h.answered[idx];
  const older = h.answered.slice(idx + 1);
  const cmpId = Object.hasOwn(rv.cmp, cur.id) ? rv.cmp[cur.id] : older[0]?.id || '';
  const prev = older.find(x => x.id === cmpId) || null;
  const cmp = deskCkCompare(cur, prev);
  const t = deskCkTitle(cur, now), pt = prev ? deskCkTitle(prev, now) : null;
  const cmpWeek = prev ? deskIsoWeek(deskCkPeriodTs(prev)) : '';
  const nav = `<div class="rv-bar">
    <div class="rv-nav group">
      <button type="button" class="btn link ic" data-rv="older" ${idx >= h.answered.length - 1 ? 'aria-disabled="true"' : ''} aria-label="Bilan d'avant">${deskIcon('back', 'sm')}</button>
      <div class="grow rv-cur" aria-live="polite"><b>${esc(t.title)}</b> <span class="muted">${esc(t.sub)}</span></div>
      <button type="button" class="btn link ic" data-rv="newer" ${idx === 0 ? 'aria-disabled="true"' : ''} aria-label="Bilan suivant">${deskIcon('chevron', 'sm')}</button>
    </div>
    <span class="muted rv-vs" id="l-cmp">face à</span>
    ${deskCkSelectHtml('rv-cmp', 'Comparer avec', [['', 'Aucun bilan'], ...older.map(o => [o.id, `${deskCkTitle(o, now).title} · ${o.name}`])], cmpId, 'aria-labelledby="l-cmp" data-rv-sel="cmp"')}
  </div>`;
  // Photos de bilan (vague 5, js/desk/photos.js) : ce bilan et celui « face à », côte à côte
  const photos = deskPhSectionHtml(r.id, { req: cur, title: t.title }, prev ? { req: prev, title: pt.title } : null);
  const figures = cmp.figures.length ? `<div class="stats rv-figs" aria-label="Chiffres du bilan">${cmp.figures.map(f => deskRvFigureHtml(f, cmpWeek)).join('')}</div>` : '';
  const answers = `<section aria-labelledby="h-ans"><h2 class="gh" id="h-ans">Réponses</h2><ul class="group" aria-labelledby="h-ans">${cmp.answers.map(a => `<li><div class="row rv-a">
    <span class="rv-l">${esc(a.label)}</span><span class="grow${a.none ? ' muted' : ''} rv-t">${esc(a.text)}</span>${a.delta !== null && a.delta !== undefined ? `<span class="v">${esc(a.delta === 0 ? `= S${cmpWeek}` : `${a.delta > 0 ? '+' : '−'}${Math.abs(a.delta)} depuis S${cmpWeek}`)}</span>` : ''}
  </div></li>`).join('') || '<li><div class="row"><span class="grow muted">Aucune autre réponse.</span></div></li>'}</ul>
    <div class="gfoot">${prev ? esc(`Écarts entre ${t.title.toLowerCase()} et ${pt.title.toLowerCase()}.`) : 'Choisis un bilan précédent pour voir les écarts.'}${cmp.answers.some(a => a.none) ? ` « Pas de réponse » : ${esc(r.name)} a passé ce suivi.` : ''}</div></section>`;
  const dr = deskRvDraft(cur), sent = !!cur.review?.sent;
  const len = Array.from(dr.reply).length;
  const reply = sent
    ? `<section class="gblock" aria-labelledby="h-rep"><h2 class="gh" id="h-rep">Ta réponse à ${esc(r.name)}</h2><div class="group pad"><p class="rv-sent">${esc(cur.review.reply)}</p></div>
      ${rv.chatFail?.request === cur.id
    ? `<div class="gfoot rv-fail" role="alert"><span class="grow">Envoyée dans le bilan, mais pas encore dans vos messages.</span><button type="button" class="btn link" data-rv="chat-retry" ${rv.busy ? 'disabled' : ''}>Réessayer</button></div>`
    : `<div class="gfoot green">${deskIcon('check', 'xs')} Envoyée${cur.review.at ? ` le ${esc(fmtDate(cur.review.at, 'short'))}` : ''}, aussi dans vos messages${cur.review.score ? ` · note ${cur.review.score} sur 10` : ''}.</div>`}</section>`
    : `<section class="gblock" aria-labelledby="h-rep"><h2 class="gh" id="h-rep"><label for="rv-reply">Ta réponse à ${esc(r.name)}</label></h2>
      <div class="group pad"><textarea id="rv-reply" rows="6" maxlength="${CHECKIN_REPLY_MAX}" placeholder="Ce qui va bien, ce qu'on ajuste cette semaine…" aria-describedby="rv-count">${esc(dr.reply)}</textarea></div>
      <div class="gfoot" id="rv-count">${len} sur ${CHECKIN_REPLY_MAX} caractères${cur.review && !sent ? ' · brouillon enregistré' : ''}</div>
      <h2 class="gh gap" id="h-score">Note de la semaine</h2>
      <div class="scores" role="radiogroup" aria-labelledby="h-score">${Array.from({ length: 10 }, (_, i) => `<button type="button" role="radio" id="score-${i + 1}" aria-checked="${dr.score === i + 1}" class="${dr.score === i + 1 ? 'on' : ''}" data-rv="score" data-v="${i + 1}">${i + 1}</button>`).join('')}</div>
      <div class="gfoot">${esc(r.name)} ne voit pas cette note : elle sert à ton suivi.</div>
      <div class="ck-acts gap-t"><button type="button" class="btn" id="rv-draft" data-rv="draft" ${rv.busy ? 'disabled' : ''}>Brouillon</button>
        <button type="button" class="btn tint grow" id="rv-send" data-rv="send" ${rv.busy ? 'disabled aria-busy="true"' : ''}>${deskIcon('send', 'sm')}${esc(`Envoyer à ${r.name}`)}</button></div></section>`;
  return `${nav}<div class="cols rvc"><div class="tbl-col">${photos}${figures}${answers}</div><div class="side-panel rv-side">${reply}${waitHtml}</div></div>`;
}

// Liste « Bilans reçus » : à répondre, puis en attente des élèves
function deskReceivedHtml(dash) {
  const head = '<div class="head"><div class="grow"><h1 class="title">Bilans reçus</h1><div class="sub">Les bilans de tes élèves qui attendent ta réponse</div></div><a class="btn" href="#/bilans">Mes bilans</a></div>';
  if (!dash.ckOv) return `${head}${dash.ckKind === 'missing' || !dash.ckKind ? deskRvMissingHtml() : `<div class="empty" role="alert">${esc(deskErrorText(dash.ckKind))}<br><button type="button" class="btn tint" data-action="reload">Réessayer</button></div>`}`;
  const ids = dash.rows.map(x => x.id), now = dash.now;
  const name = id => dash.rows.find(x => x.id === id)?.name || 'Élève';
  const todo = deskCkToAnswer(dash.ckOv, ids), wait = deskCkWaiting(dash.ckOv, now, ids);
  const row = (x, sub, v) => `<li><a class="row" href="#/eleve/${encodeURIComponent(x.student)}/bilans/${encodeURIComponent(x.id)}">${deskAvatar(name(x.student))}<span class="grow"><b>${esc(name(x.student))}</b><span class="t2 blk">${esc(sub)}</span></span><span class="v">${esc(v)}</span><span class="chev">${deskIcon('chevron', 'sm')}</span></a></li>`;
  return `${head}<section aria-labelledby="h-todo"><h2 class="gh" id="h-todo">À répondre</h2>
    ${todo.length ? `<ul class="group" aria-labelledby="h-todo">${todo.map(x => row(x, x.name, `reçu ${deskAgo(x.answeredAt, now)}`)).join('')}</ul>` : '<div class="empty">Tu as répondu à tous les bilans reçus.</div>'}</section>
    ${wait.length ? `<section class="gap-t" aria-labelledby="h-w"><h2 class="gh gap" id="h-w">Pas encore remplis</h2><ul class="group" aria-labelledby="h-w">${wait.map(x => row(x, x.name, x.dueAt ? `à rendre avant le ${fmtDate(x.dueAt, 'short')}` : 'envoyé')).join('')}</ul></section>` : ''}`;
}

// ── Gestes ──────────────────────────────────────────────────

const deskRvCurrent = () => { const h = deskCkHistory(view.student?.checkins || []); return h.answered.find(x => x.id === rv.sel) || h.answered[0] || null; };
function deskRvSync() {
  const el = document.getElementById('rv-count'), cur = deskRvCurrent();
  if (el && cur) el.textContent = `${Array.from(deskRvDraft(cur).reply).length} sur ${CHECKIN_REPLY_MAX} caractères`;
}

async function deskRvSave(send) {
  const cur = deskRvCurrent(), route = deskRoute();
  if (!cur || rv.busy) return;
  const dr = deskRvDraft(cur), reply = checkinText(dr.reply, CHECKIN_REPLY_MAX + 1);
  if (Array.from(reply).length > CHECKIN_REPLY_MAX) { deskToast(`Ta réponse dépasse ${CHECKIN_REPLY_MAX} caractères.`); return; }
  if (send && !reply) { deskToast('Écris ta réponse avant de l\'envoyer.'); document.getElementById('rv-reply')?.focus(); return; }
  rv.busy = true; deskRender();
  const r = await deskRpc('coach_checkin_review', { request: cur.id, reply, score: dr.score, send });
  if (!r.ok) {
    rv.busy = false; deskRender();
    if (r.kind === 'signed_out') return deskEndSession();
    deskToast(r.kind === 'missing' ? DESK_CK_ERRORS.missing : deskErrorText(r.kind));
    return;
  }
  cur.review = { reply, score: dr.score, at: Date.now(), sent: send || !!cur.review?.sent };
  delete rv.drafts[cur.id];
  let chatOk = true;
  const name = view.dash?.rows.find(x => x.id === route.id)?.name || 'ton élève';
  if (send) chatOk = (await deskRpc('chat_send', { body: reply, student: route.id })).ok;
  rv.chatFail = send && !chatOk ? { request: cur.id, student: route.id, body: reply } : null;
  rv.busy = false;
  deskRender();
  deskToast(!send ? 'Brouillon enregistré' : chatOk ? `Réponse envoyée à ${name}` : `Réponse envoyée dans le bilan de ${name}, mais pas dans vos messages : touche Réessayer.`);
  if (send) deskRefresh({ force: true });
}

// Réponse partie dans le bilan, pas dans les messages : renvoyée dans la conversation seulement
async function deskRvChatRetry() {
  const f = rv.chatFail;
  if (!f || rv.busy) return;
  rv.busy = true; deskRender();
  const r = await deskRpc('chat_send', { body: f.body, student: f.student });
  rv.busy = false;
  if (r.ok) rv.chatFail = null;
  deskRender();
  if (!r.ok && r.kind === 'signed_out') return deskEndSession();
  deskToast(r.ok ? 'Réponse envoyée dans vos messages' : r.kind === 'rate_limited' ? 'Trop de messages d\'un coup : réessaie dans un moment.' : deskErrorText(r.kind));
}

// Fin de session pour inactivité (main.js) : chaque réponse écrite et pas enregistrée part en brouillon sur le serveur
async function deskRvSaveDrafts() {
  const list = view.student?.checkins || [];
  const jobs = Object.entries(rv.drafts).flatMap(([id, d]) => {
    const r = list.find(x => x.id === id);
    if (!r || r.review?.sent || JSON.stringify(d) === JSON.stringify(deskRvSaved(r))) return [];
    return [deskRpc('coach_checkin_review', { request: id, reply: checkinText(d.reply, CHECKIN_REPLY_MAX), score: d.score, send: false })];
  });
  rv.drafts = {};
  await Promise.allSettled(jobs);
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-rv]');
  if (!el || deskRoute().tab !== 'checkins') return;
  if (el.getAttribute('aria-disabled') === 'true') return;
  const a = el.dataset.rv, h = deskCkHistory(view.student?.checkins || []);
  const cur = deskRvCurrent();
  if (a === 'older' || a === 'newer') {
    const i = h.answered.indexOf(cur), next = h.answered[i + (a === 'older' ? 1 : -1)];
    if (next) { rv.sel = next.id; history.replaceState(null, '', `#/eleve/${encodeURIComponent(deskRoute().id)}/bilans/${encodeURIComponent(next.id)}`); deskRender(); document.querySelector(`[data-rv="${a}"]`)?.focus(); }
    return;
  }
  if (a === 'score' && cur) { const v = Number(el.dataset.v), dr = deskRvDraft(cur); rv.drafts[cur.id] = { ...dr, score: dr.score === v ? null : v }; deskRender(); return; }
  if (a === 'chat-retry') { deskRvChatRetry(); return; }
  if (a === 'draft') deskRvSave(false);
  if (a === 'send') deskRvSave(true);
});
document.addEventListener('input', e => {
  if (e.target.id !== 'rv-reply') return;
  const cur = deskRvCurrent();
  if (!cur) return;
  rv.drafts[cur.id] = { ...deskRvDraft(cur), reply: e.target.value.slice(0, CHECKIN_REPLY_MAX) };
  deskRvSync();
});
document.addEventListener('change', e => {
  if (e.target.dataset?.rvSel !== 'cmp') return;
  const cur = deskRvCurrent();
  if (cur) { rv.cmp[cur.id] = e.target.value; deskRender(); }
});
