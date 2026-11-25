// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : Messages (docs/COACH_WEB.md, vague 4 ; maquette 6-messages)
//
//  - Écran #/messages[/<élève>] : conversations (non lues en tête, recherche par pseudo, aussi les élèves sans message),
//    le fil de la conversation choisie, et « <élève> en bref » (dernière séance, séances, bilan, diète, liens) à partir
//    de 1240 px. Onglet Messages de la fiche (#/eleve/<id>/messages) : le même fil et le même panneau.
//  - Mêmes RPC et mêmes règles que l'app iPhone : les fonctions de js/data/coach-chat.js sont appelées telles quelles
//    avec l'appel du site ({ rpc: deskRpc }) : chat_messages (curseur des messages reçus), chat_send (2000 caractères,
//    texte nettoyé, 60 par heure et 500 par 24 h côté serveur), chat_mark_read (jusqu'au dernier reçu : écrire ne vaut
//    pas lecture), report_chat (Signaler). Aucun blocage dans la messagerie du coach : le serveur ne le regarde pas
//    (l'élève quitte son coach, ou le coach retire l'élève) ; coach_push_off dit quand l'élève ne reçoit pas les
//    notifications.
//  - Rafraîchissement, comme l'app : pas de temps réel ; la conversation ouverte est relue toutes les CHAT_POLL_MS
//    (15 s, seulement les messages après le dernier reçu), les résumés (chat_threads) toutes les 60 s, seulement
//    onglet visible ; au retour sur l'onglet, tout de suite.
//  - Dans le fil : les séances de l'élève (commentaire du coach : coach_set_note, 1000 caractères) et ses bilans
//    répondus (lien vers le bilan, où la réponse du coach part aussi dans la conversation).
//  Tout texte reçu passe par esc() ; retours à la ligne gardés par le CSS (pre-wrap).
// ═══════════════════════════════════════════════════════════
'use strict';

const ms = { q: '', drafts: {}, extra: {}, note: null, noteBusy: false, pushOff: null, timer: 0, ticks: 0, stick: false };
const deskChatOpts = { rpc: (fn, args) => deskRpc(fn, args) };

// Élève dont la conversation est à l'écran (écran Messages ou onglet de la fiche), sinon null
function deskChatKey(route = deskRoute()) {
  if (route.name === 'messages') return route.id || null;
  if (route.name === 'student' && route.tab === 'messages') return route.id;
  return null;
}
const deskChatRow = id => view.dash?.rows.find(r => r.id === id) || null;

// ── Données ─────────────────────────────────────────────────

// Résumés relus (non-lus de la barre latérale et de la liste) : l'objet partagé avec js/data/coach-chat.js
function deskChatSetThreads(threads) {
  if (!view.dash) return;
  view.dash.threads = threads;
  chat.threads = threads;
  chat.available = threads ? true : chat.available;
  view.dash.rows = deskStudentRows(view.dash);
}
async function deskChatThreadsRefresh() {
  const r = await deskRpc('chat_threads');
  if (r.ok) deskChatSetThreads(cleanChatThreads(r.data));
  else if (r.kind === 'missing') chat.available = false;
}

// Conversation ouverte : messages, lecture, séances et bilans du fil, notifications coupées
async function deskChatOpen(id) {
  if (!id || !deskChatRow(id)) return;
  deskChatStart();
  ms.stick = true;
  const c = chatConv(id);
  const first = !c.loadedAt;
  const r = first ? await chatLoad(id, deskChatOpts) : await chatPoll(id, deskChatOpts);
  if (r.ok && deskChatKey() === id) { await chatMarkRead(id, { force: true, ...deskChatOpts }); deskChatSetThreads(chat.threads); }
  if (r.kind === 'signed_out') return deskEndSession();
  deskRender();
  deskChatExtra(id);
  if (ms.pushOff === null) {
    const p = await deskRpc('coach_push_off');
    ms.pushOff = p.ok ? cleanPushOff(p.data) : new Set();
    deskRender();
  }
}
// Séances (avec mon commentaire) et bilans de l'élève, relus au plus toutes les 60 s
async function deskChatExtra(id, { force = false } = {}) {
  const x = ms.extra[id];
  if (x?.loading || (!force && x && Date.now() - x.at < DESK_REFRESH_MS)) return;
  ms.extra[id] = { ...(x || { sessions: [], checkins: [] }), loading: true, at: Date.now() };
  const [s, ck] = await Promise.all([deskLoadSessionsPage(id), deskLoadStudentCheckins(id)]);
  ms.extra[id] = { sessions: s.ok ? s.data : x?.sessions || [], checkins: ck.ok ? ck.data : x?.checkins || [], loading: false, at: Date.now() };
  if (deskChatKey() === id) deskRender();
}

// Relecture régulière : la conversation à l'écran toutes les CHAT_POLL_MS, les résumés toutes les 60 s ; onglet caché :
// rien ne part (relu au retour)
function deskChatStart() {
  if (ms.timer) return;
  ms.ticks = 0;
  ms.timer = setInterval(deskChatTick, CHAT_POLL_MS);
}
function deskChatStop() { clearInterval(ms.timer); ms.timer = 0; }
async function deskChatTick({ now = false } = {}) {
  const route = deskRoute(), id = deskChatKey(route);
  if (!desk.user || (route.name !== 'messages' && !id)) { deskChatStop(); return; }
  if (document.visibilityState !== 'visible') return;
  ms.ticks++;
  if (now || ms.ticks % Math.round(DESK_CHAT_THREADS_MS / CHAT_POLL_MS) === 0) await deskChatThreadsRefresh();
  if (id) {
    const r = await chatPoll(id, deskChatOpts);
    if (r.ok && r.theirs && deskChatKey() === id) { await chatMarkRead(id, { force: true, ...deskChatOpts }); deskChatSetThreads(chat.threads); }
    if (now) deskChatExtra(id);
  }
  deskRender();
}

// ── Gabarits ────────────────────────────────────────────────

function deskChatListHtml(activeId) {
  const rows = deskChatRows(view.dash, ms.q, Date.now());
  const items = rows.map(x => `<li><a class="row msg-row${x.id === activeId ? ' on' : ''}" href="#/messages/${encodeURIComponent(x.id)}"${x.id === activeId ? ' aria-current="true"' : ''}>
      ${deskAvatar(x.name)}<span class="grow"><span class="mr-top"><b${x.unread ? ' class="unr"' : ''}>${esc(x.name)}</b><span class="t2">${esc(x.time)}</span></span>
      <span class="t2 prev${x.unread ? ' strong' : ''}">${esc(x.preview)}</span></span>
      ${x.unread ? `<span class="badge" aria-label="${esc(plural(x.unread, 'message non lu', 'messages non lus'))}">${x.unread}</span>` : ''}</a></li>`).join('');
  return `<h1 class="title" id="h-msg">Messages</h1>
    <label class="search msg-search">${deskIcon('search', 'sm')}<span class="sr">Rechercher un élève</span><input id="mq" type="search" placeholder="Rechercher un élève" value="${esc(ms.q)}" autocomplete="off" maxlength="${SEARCH_MAX}"></label>
    ${chat.available === false ? '<div class="empty">La messagerie n\'est pas encore ouverte sur le serveur.</div>'
    : rows.length ? `<ul class="group msg-lst" aria-labelledby="h-msg">${items}</ul>`
      : `<div class="empty">${ms.q ? 'Aucun élève ne porte ce pseudo.' : 'Aucune conversation pour l\'instant. Cherche un élève pour lui écrire.'}</div>`}`;
}

function deskBubbleHtml(m) {
  const t = fmtTime(m.at);
  return `<div class="bub ${m.mine ? 'tx' : 'rx'}" data-mid="${m.id}"><p><span class="sr">${m.mine ? 'Toi' : 'Message reçu'}, ${esc(t)} : </span>${esc(m.body)}</p><small aria-hidden="true">${esc(t)}</small></div>`;
}
function deskEventHtml(e, id, name) {
  if (e.type === 'checkin') {
    return `<div class="ref">${deskIcon('checkins', 'sm')}<span class="grow">${esc(`${name} a répondu à son bilan : ${e.title}, ${e.name}`)}</span>
      <a class="btn link" href="#/eleve/${encodeURIComponent(id)}/bilans/${encodeURIComponent(e.id)}">${e.replied ? 'Ouvrir le bilan' : 'Répondre au bilan'}</a></div>`;
  }
  const open = ms.note?.sid === e.id;
  const head = `<div class="ref">${deskIcon('programmes', 'sm')}<span class="grow">${esc(`Séance « ${e.label} » terminée à ${fmtTime(e.at)}`)}${e.note && !open ? `<span class="ref-note">${esc(`Ton commentaire : « ${e.note} »`)}</span>` : ''}</span>
    ${open ? '' : `<button type="button" class="btn link" data-ms="note-open" data-sid="${esc(e.id)}">${e.note ? 'Modifier le commentaire' : 'Commenter la séance'}</button>`}</div>`;
  if (!open) return head;
  const len = Array.from(ms.note.text).length;
  return `${head}<div class="note-ed group pad"><label class="fld sm" for="note-in"><span>${esc(`Commentaire sur la séance « ${e.label} »`)}</span></label>
    <textarea id="note-in" rows="3" maxlength="${COACH_NOTE_MAX}" placeholder="Ex : garde 2 minutes de repos sur le squat." aria-describedby="note-count">${esc(ms.note.text)}</textarea>
    <p class="gfoot flat" id="note-count">${len} sur ${COACH_NOTE_MAX} caractères. ${esc(name)} le voit sous sa séance.</p>
    <div class="ck-acts"><button type="button" class="btn" data-ms="note-cancel">Annuler</button>
      ${e.note ? `<button type="button" class="btn danger" data-ms="note-del" ${ms.noteBusy ? 'disabled' : ''}>Supprimer</button>` : ''}
      <button type="button" class="btn tint" data-ms="note-save" ${ms.noteBusy ? 'disabled aria-busy="true"' : ''}>Enregistrer</button></div></div>`;
}

function deskThreadHtml(id, { inFiche = false } = {}) {
  const row = deskChatRow(id);
  if (!row) return '<div class="chat"><div class="empty">Cet élève ne te suit plus : les messages ont été supprimés.</div></div>';
  const name = row.name, c = chatConv(id), x = ms.extra[id];
  const events = deskThreadEvents({ sessions: x?.sessions, checkins: x?.checkins });
  let body;
  if (chat.available === false) body = '<div class="empty">La messagerie n\'est pas encore ouverte sur le serveur.</div>';
  else if (!c.rows.length && (c.loading || !c.loadedAt) && !c.error) body = '<p class="chat-empty" role="status">Chargement…</p>';
  else if (!c.rows.length && c.error) body = `<div class="empty" role="alert">${esc(deskErrorText(c.error))}<br><button type="button" class="btn tint" data-ms="retry">Réessayer</button></div>`;
  else {
    const items = deskThreadItems(c.rows, events, { end: c.end });
    const more = c.end ? '' : `<button type="button" class="btn link chat-more" data-ms="more" ${c.loading ? 'disabled' : ''}>${c.loading ? 'Chargement…' : 'Afficher les messages précédents'}</button>`;
    body = `${more}${items.map(it => it.type === 'day' ? `<h3 class="day">${esc(it.label)}</h3>` : it.type === 'msg' ? deskBubbleHtml(it.m) : deskEventHtml(it, id, name)).join('')}
      ${c.rows.length ? '' : `<p class="chat-empty">Envoie une consigne ou une question à ${esc(name)}.</p>`}`;
  }
  const draft = ms.drafts[id] || '', cnt = deskChatCount(draft);
  const off = ms.pushOff?.has(id);
  return `<section class="chat${inFiche ? ' in-fiche' : ''}" aria-label="${esc(`Conversation avec ${name}`)}">
    <div class="chat-h">${deskAvatar(name)}<div class="grow"><b>${esc(name)}</b><div class="t2">${esc(row.phase?.text || 'Élève')}</div></div>
      ${inFiche ? '' : `<a class="btn link" href="#/eleve/${encodeURIComponent(id)}">Fiche</a>`}
      <button type="button" class="btn link" data-ms="report">Signaler</button></div>
    <div class="chat-b" id="chat-b" data-keep-scroll="${esc(id)}" role="log" aria-live="polite" aria-relevant="additions" tabindex="0" aria-label="${esc(`Messages avec ${name}`)}">
      <p class="chat-intro">Personne d'autre que toi et ${esc(name)} ne lit ces messages, sauf en cas de signalement. Ils sont supprimés si le suivi s'arrête.</p>${body}</div>
    ${off ? `<p class="chat-off">${esc(`${name} ne reçoit pas tes messages en notification : ils l'attendent dans l'app.`)}</p>` : ''}
    <div class="chat-in"><label class="sr" for="chat-in">${esc(`Message à ${name}`)}</label>
      <textarea id="chat-in" data-key="${esc(id)}" rows="1" placeholder="${esc(`Écrire à ${name}`)}" autocomplete="off" aria-describedby="chat-count chat-help"${cnt.over ? ' aria-invalid="true"' : ''}>${esc(draft)}</textarea>
      <button type="button" class="send" data-ms="send" aria-label="Envoyer le message" ${c.sending || chatProblem(draft) ? 'disabled' : ''}>${deskIcon('send')}</button></div>
    <p class="chat-cnt${cnt.over ? ' over' : ''}" id="chat-count" aria-live="polite">${esc(cnt.text)}</p>
    <p class="sr" id="chat-help">Entrée envoie le message, Maj et Entrée passent à la ligne.</p>
  </section>`;
}

function deskBriefHtml(id) {
  const row = deskChatRow(id);
  if (!row) return '';
  const now = Date.now(), base = `#/eleve/${encodeURIComponent(id)}`;
  const last = row.st.last_session;
  const ck = deskCkHistory(ms.extra[id]?.checkins || []).answered[0] || null;
  const link = (href, icon, text) => `<li><a class="row" href="${href}">${deskIcon(icon, 'sm')}<span class="grow">${esc(text)}</span><span class="chev">${deskIcon('chevron', 'sm')}</span></a></li>`;
  return `<section class="gblock" aria-labelledby="h-brief"><h2 class="gh" id="h-brief">${esc(`${row.name} en bref`)}</h2><ul class="group" aria-labelledby="h-brief">
      <li><div class="row"><span class="grow">Dernière séance<span class="t2 blk">${last ? esc(`${last.label} · ${deskAgo(last.done_at, now)}`) : 'Aucune séance'}</span></span></div></li>
      <li><div class="row"><span class="grow">Séances<span class="t2 blk">${esc(plural(row.n7 || 0, 'séance', 'séances'))} en 7 jours</span></span></div></li>
      <li><div class="row"><span class="grow">Bilan<span class="t2 blk">${ck ? esc(`${deskCkTitle(ck, now).title} · ${ck.review?.sent ? 'répondu' : 'à répondre'}`) : 'Aucun bilan reçu'}</span></span>${ck?.review?.sent ? `<span class="green">${deskIcon('check', 'sm')}</span>` : ''}</div></li>
      <li><div class="row"><span class="grow">Diète<span class="t2 blk">${row.dietShared ? esc(`${row.dietOk7 ?? 0} jours suivis sur 7`) : 'Non partagée'}</span></span></div></li>
    </ul></section>
    <section class="gblock" aria-labelledby="h-open"><h2 class="gh" id="h-open">Ouvrir</h2><ul class="group" aria-labelledby="h-open">
      ${ck ? link(`${base}/bilans/${encodeURIComponent(ck.id)}`, 'checkins', `Bilan : ${deskCkTitle(ck, now).title}`) : link(`${base}/bilans`, 'checkins', 'Bilans')}
      ${link(`${base}/programme`, 'programmes', 'Programme')}${link(`${base}/nutrition`, 'diet', 'Nutrition')}${link(base, 'calendar', 'Semaines')}
    </ul><div class="gfoot">Texte seul, comme dans l'app iPhone : la conversation est la même des deux côtés.</div></section>`;
}

// Écran #/messages[/<élève>]
function deskMessagesHtml(route) {
  const id = route.id && deskChatRow(route.id) ? route.id : null;
  const thread = id ? deskThreadHtml(id) : `<section class="chat"><div class="empty">${route.id ? 'Cet élève ne te suit plus : les messages ont été supprimés.' : 'Choisis une conversation, ou cherche un élève pour lui écrire.'}</div></section>`;
  return `<div class="crumb msg-back${id ? ' on' : ''}"><a href="#/messages">${deskIcon('back', 'xs')}Messages</a></div>
    <div class="msg-page${id ? ' has-sel' : ''}"><div class="msg-list">${deskChatListHtml(id)}</div>${thread}${id ? `<aside class="msg-side" aria-label="En bref">${deskBriefHtml(id)}</aside>` : ''}</div>`;
}
// Onglet Messages de la fiche
function deskStudentMessagesHtml(id) {
  return `<div class="cols msgc">${deskThreadHtml(id, { inFiche: true })}<aside class="side-panel msg-brief" aria-label="En bref">${deskBriefHtml(id)}</aside></div>`;
}

// ── Gestes ──────────────────────────────────────────────────

async function deskChatSend(id) {
  const el = document.getElementById('chat-in');
  const text = el ? el.value : ms.drafts[id] || '';
  if (chatProblem(text)) { if (chatProblem(text) === 'too_long') deskToast(coachErrorText('too_long')); return; }
  ms.drafts[id] = text;
  const r = await chatSend(id, text, deskChatOpts);
  if (!r.ok) {
    if (r.kind === 'signed_out') return deskEndSession();
    if (r.kind !== 'busy') deskToast(r.kind === 'rate_limited' ? 'Trop de messages d\'un coup : réessaie dans un moment.' : coachErrorText(r.kind));
    deskRender();
    return;
  }
  const now = document.getElementById('chat-in')?.value ?? text;
  ms.drafts[id] = now.startsWith(text) ? now.slice(text.length) : now === text ? '' : now;
  ms.stick = true;
  deskAnnounce('Message envoyé');
  deskRender();
  document.getElementById('chat-in')?.focus();
  // Relu tout de suite : un message de l'élève arrivé juste avant le mien s'affiche sans attendre
  const p = await chatPoll(id, deskChatOpts);
  if (p.ok && p.theirs) await chatMarkRead(id, { force: true, ...deskChatOpts });
  deskChatSetThreads(chat.threads);
  deskRender();
}

async function deskNoteSave(id, del = false) {
  const n = ms.note;
  if (!n || ms.noteBusy) return;
  const text = del ? '' : String(n.text).trim();
  if (text.length > COACH_NOTE_MAX) { deskToast(coachErrorText('too_long')); return; }
  ms.noteBusy = true; deskRender();
  const r = await deskRpc('coach_set_note', { student: id, session_id: n.sid, text });
  ms.noteBusy = false;
  if (!r.ok) { if (r.kind === 'signed_out') return deskEndSession(); deskToast(coachErrorText(r.kind)); deskRender(); return; }
  const row = ms.extra[id]?.sessions.find(s => s.id === n.sid);
  if (row) row.note = text;
  ms.note = null;
  deskRender();
  deskToast(text ? 'Commentaire envoyé' : 'Commentaire supprimé');
  document.querySelector(`[data-sid="${CSS.escape(n.sid)}"]`)?.focus();
}

async function deskChatReport(id) {
  const row = deskChatRow(id);
  if (!row) return;
  const reason = await deskChoose({ title: `Signaler ${row.name}`,
    text: `Pourquoi ? ${row.name} ne saura pas que c'est toi. Les 50 derniers messages sont joints pour l'équipe de modération.`,
    options: REPORT_REASONS.map(x => [x.reason, x.label]), ok: 'Signaler', danger: true });
  if (!reason) return;
  const r = await chatReport(id, reason, { ...deskChatOpts, reportAlert: deskReportAlert });
  if (!r.ok) { deskToast(r.kind === 'report_rate' ? 'Tu as déjà fait 10 signalements en 24 heures : réessaie demain.' : coachErrorText(r.kind)); return; }
  await deskConfirm({ title: 'Signalement envoyé', text: 'Il sera traité sous 24 heures. La copie des messages est gardée même si le suivi s\'arrête. Pour ne plus échanger avec cet élève, retire-le depuis l\'app.', ok: 'OK', cancel: false });
}
// Alerte par e-mail d'un signalement enregistré (fonction Edge report, comme socialReportAlert de l'app)
async function deskReportAlert(reportId) {
  try { const { data, error } = await deskClient().functions.invoke('report', { body: { report_id: reportId } }); return !error && data?.ok === true; }
  catch { return false; }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-ms]');
  if (!el) return;
  const id = deskChatKey();
  if (!id) return;
  const a = el.dataset.ms;
  if (a === 'send') deskChatSend(id);
  else if (a === 'more') { chatLoad(id, { more: true, ...deskChatOpts }).then(() => deskRender()); deskRender(); }
  else if (a === 'retry') { chatLoad(id, deskChatOpts).then(() => deskRender()); }
  else if (a === 'report') deskChatReport(id);
  else if (a === 'note-open') {
    const row = ms.extra[id]?.sessions.find(s => s.id === el.dataset.sid);
    ms.note = { sid: el.dataset.sid, text: row?.note || '' };
    deskRender();
    document.getElementById('note-in')?.focus();
  } else if (a === 'note-cancel') { const sid = ms.note?.sid; ms.note = null; deskRender(); if (sid) document.querySelector(`[data-sid="${CSS.escape(sid)}"]`)?.focus(); }
  else if (a === 'note-save') deskNoteSave(id);
  else if (a === 'note-del') deskNoteSave(id, true);
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'mq') { ms.q = t.value.slice(0, SEARCH_MAX); deskRender(); return; }
  if (t.id === 'note-in' && ms.note) {
    ms.note.text = t.value.slice(0, COACH_NOTE_MAX);
    const c = document.getElementById('note-count');
    if (c) c.textContent = `${Array.from(ms.note.text).length} sur ${COACH_NOTE_MAX} caractères.`;
    return;
  }
  if (t.id !== 'chat-in') return;
  ms.drafts[t.dataset.key] = t.value;
  const cnt = deskChatCount(t.value), el = document.getElementById('chat-count'), send = document.querySelector('[data-ms="send"]');
  if (el) { el.textContent = cnt.text; el.classList.toggle('over', cnt.over); }
  if (cnt.over) t.setAttribute('aria-invalid', 'true'); else t.removeAttribute('aria-invalid');
  if (send) send.disabled = chatConv(t.dataset.key).sending || !!chatProblem(t.value);
});
// Entrée envoie ; Maj + Entrée passe à la ligne (et jamais pendant une composition : accents, saisie asiatique)
document.addEventListener('keydown', e => {
  if (e.target.id !== 'chat-in' || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.altKey) return;
  e.preventDefault();
  deskChatSend(e.target.dataset.key);
});
// Un changement de js/data/coach-chat.js (envoi, page reçue) : l'écran se redessine une fois par image
let deskChatFrame = 0;
onCoachChange(() => {
  if (!deskChatKey() || deskChatFrame) return;
  deskChatFrame = requestAnimationFrame(() => { deskChatFrame = 0; deskRender(); });
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && desk.user && (deskRoute().name === 'messages' || deskChatKey())) deskChatTick({ now: true }); });
