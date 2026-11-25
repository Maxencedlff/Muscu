// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : logique pure des Messages (docs/COACH_WEB.md, vague 4 ; maquette 6-messages)
//
//  Les règles de la messagerie sont celles de l'app, reprises telles quelles de js/data/coach-chat.js : nettoyage et
//  limites (chatClean, chatProblem, CHAT_MAX), lignes de la boîte (chatInboxRows : non lues en tête, puis la plus
//  récente), heures (chatListTime), séparateurs de jour (chatDayLabel). Ici seulement ce qui est propre au grand
//  écran : le fil mêlé aux séances commentées et aux bilans répondus (deskThreadItems), le compteur de caractères.
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_CHAT_THREADS_MS = 60_000;   // résumés des conversations relus sur l'écran Messages (la conversation : CHAT_POLL_MS)
const DESK_CHAT_EVENTS_DAYS = 21;      // séances et bilans montrés dans le fil : 3 semaines au plus avant le plus ancien message

// Lignes de la liste des conversations : celles de l'app (chatInboxRows), avec le pseudo et l'aperçu
// → [{ id, name, unread, last, time, preview }]
function deskChatRows(dash, query = '', now = Date.now()) {
  if (!dash?.state) return [];
  return chatInboxRows(dash.state.students, dash.threads, query, normName).map(x => ({
    id: x.st.user_id, name: personName(x.st), unread: x.unread, last: x.last,
    time: x.last ? chatListTime(x.last.at, now) : '',
    preview: x.last ? `${x.last.mine ? 'Toi : ' : ''}${x.last.body.replace(/\s+/g, ' ')}` : 'Pas encore de message',
  }));
}

// Compteur sous la saisie (mêmes seuils que l'app : rien avant CHAT_WARN, puis « n sur 2000 », puis le dépassement)
function deskChatCount(text) {
  const n = chatLength(text);
  if (n > CHAT_MAX) return { over: true, text: `${plural(n - CHAT_MAX, 'caractère', 'caractères')} en trop : enlève-${n - CHAT_MAX > 1 ? 'les' : 'le'} pour envoyer` };
  return { over: false, text: n >= CHAT_WARN ? `${n} sur ${CHAT_MAX} caractères` : '' };
}

// Événements du fil : séances de l'élève (avec le commentaire du coach) et bilans répondus
// sessions : lignes de coach_student_sessions (cleanCoachSessionRow) ; checkins : demandes (cleanCheckinRequest)
function deskThreadEvents({ sessions = [], checkins = [], now = Date.now() } = {}) {
  const out = [];
  for (const r of sessions || []) {
    if (!r || !Number.isFinite(r.doneAt) || r.doneAt > now + 3600e3) continue;
    out.push({ type: 'session', at: r.doneAt, id: r.id, label: r.s?.label || 'Séance', note: r.note || '' });
  }
  for (const c of deskCkHistory(checkins || []).answered) {
    if (!Number.isFinite(c.answeredAt)) continue;
    out.push({ type: 'checkin', at: c.answeredAt, id: c.id, title: deskCkTitle(c, now).title, name: c.name, replied: !!c.review?.sent });
  }
  return out.sort((a, b) => a.at - b.at);
}

// Fil affiché : messages et événements par ordre chronologique, un séparateur par jour. Les événements plus anciens que
// le plus ancien message chargé n'y entrent que si toute la conversation est là (end), et 3 semaines au plus avant lui :
// « Afficher les messages précédents » les fait apparaître avec les messages de leur période.
// → [{ type: 'day', label } | { type: 'msg', m } | événement]
function deskThreadItems(rows, events, { end = true, now = Date.now() } = {}) {
  const first = rows.length ? rows[0].at : now;
  const floor = end ? first - DESK_CHAT_EVENTS_DAYS * 86400e3 : first;
  const all = [...rows.map(m => ({ type: 'msg', at: m.at, m })), ...events.filter(e => e.at >= floor)]
    .sort((a, b) => (a.at - b.at) || (a.type === 'msg' ? 1 : -1));
  const out = [];
  let day = '';
  for (const x of all) {
    const d = chatDayLabel(x.at, now);
    if (d !== day) { day = d; out.push({ type: 'day', label: d }); }
    out.push(x);
  }
  return out;
}
