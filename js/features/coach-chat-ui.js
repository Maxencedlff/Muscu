// ═══════════════════════════════════════════════════════════
//  Messages coach ↔ élève, écran : conversation (coach-chat:CLÉ, CLÉ = CHAT_COACH pour l'élève, ou
//  l'identifiant d'un élève pour son coach), bulles façon Messages (les miennes à droite, à la teinte ;
//  celles de l'autre à gauche, en gris), séparateurs de jour, « Afficher les messages précédents »,
//  saisie collée en bas au-dessus de la barre d'onglets, menu ⋯ (Signaler : copie des derniers
//  messages gardée par le serveur, chatReport).
//  Entrées : cellule « Messages » de Mon coach (élève) et de la fiche d'un élève (coach), avec le
//  nombre de non-lus ; pastille dans Mes élèves ; non-lus ajoutés au badge de l'onglet Social.
//  Données : js/data/coach-chat.js (contrat : docs/COACH_V1.md, « Messages »). Texte venu du serveur
//  passé par esc() ; retours à la ligne gardés par le CSS (pre-wrap).
//  Relecture : toutes les CHAT_POLL_MS tant que la conversation est à l'écran et l'app au premier
//  plan ; une conversation ouverte est marquée lue. Pendant la frappe, seule la liste est redessinée.
//  iOS : rien au pointerdown, un seul toucher.
// ═══════════════════════════════════════════════════════════
'use strict';

const chatDrafts = {};      // brouillon par conversation
// Information unique de l'élève (liens créés avant la messagerie : rien dit à l'acceptation) : vue une
// fois fermée, ou la conversation avec le coach ouverte. Sur l'appareil seulement (confort).
const CHAT_INTRO_KEY = 'mdlf_chat_intro_seen';
let chatPollTimer = null;   // relecture de la conversation affichée
let chatShownLast = null;   // dernier message dessiné (défilement en bas quand il change)

function chatKeyShown() { return currentView() === 'coach-chat' ? routeParams(currentRoute())[0] || null : null; }
// L'autre personne de la conversation (null : lien inconnu ou rompu)
function chatPartner(key) { return key === CHAT_COACH ? myCoach() : coachStudent(key); }

// ── Gabarits ────────────────────────────────────────────────

function chatBubbleHtml(m) {
  return `
          <div class="chat-msg ${m.mine ? 'chat-msg--mine' : 'chat-msg--theirs'}" data-mid="${m.id}">
            <p class="chat-msg__bubble"><span class="visually-hidden">${m.mine ? 'Toi' : 'Message reçu'}, ${esc(fmtTime(m.at))} : </span>${esc(m.body)}</p>
            <span class="chat-msg__time num" aria-hidden="true">${esc(fmtTime(m.at))}</span>
          </div>`;
}

function chatListHtml(key) {
  const c = chatConv(key);
  if (!c.rows.length) {
    if (c.loading || (!c.loadedAt && !c.error)) return '<p class="chat-empty">Chargement…</p>';
    if (c.error) return coachOfflineNote(c.error, 'Pas d\'Internet. Les messages s\'afficheront quand le réseau reviendra.');
    return `<p class="chat-empty">${key === CHAT_COACH ? 'Pose une question ou dis à ton coach si un exercice te gêne.'
      : 'Envoie une consigne ou une question à ton élève.'}</p>`;
  }
  let day = '', html = '';
  for (const m of c.rows) {
    const d = chatDayLabel(m.at);
    if (d !== day) { day = d; html += `<p class="chat-day" role="heading" aria-level="3">${esc(d)}</p>`; }
    html += chatBubbleHtml(m);
  }
  const more = c.end ? '' : `<button class="btn-more chat-more" data-action="chat-more" data-key="${esc(key)}" ${c.loading ? 'disabled' : ''}>${c.loading ? 'Chargement…' : 'Afficher les messages précédents'}</button>`;
  return more + html;
}

function chatCountText(text) {
  const n = chatLength(text);
  return n >= CHAT_WARN ? `${n} / ${CHAT_MAX}` : '';
}

// Notifications refusées dans iOS : une ligne discrète vers les Réglages de l'iPhone (js/features/push-ui.js)
function chatPushLineHtml() {
  return pushDeniedHere() ? `<button class="chat-push-off" data-action="push-open-ios-settings-chat">Notifications désactivées · <span class="chat-push-off__link">Réglages</span></button>` : '';
}

function renderCoachChat(key) {
  const p = chatPartner(key);
  const name = p ? personName(p) : 'Messages';
  // Ouverte depuis la fiche de cette personne (retour « ‹ lea ») : la barre dit « Messages », pas « lea » une 2e fois
  const st = nav.stacks[nav.tab], prev = st.length > 1 ? routeTitle(st[st.length - 2], st.length - 2 === 0) : '';
  const title = p && prev === name ? 'Messages' : name;
  const menu = p ? `<button class="navbar__icon" data-action="chat-menu" data-key="${esc(key)}" aria-label="Options de la conversation">${icon('ellipsis', 22)}</button>` : '';
  const head = navBar({ title: esc(title), large: false, right: chatHiddenByAge() ? '' : menu });
  // Contrôle parental « Limites de communication » (js/data/age-range.js) : conversation fermée, dit sans bouton
  if (chatHiddenByAge()) return `<div class="view view--grouped coach-chat-view">${head}<div class="scr"><div class="empty-note">${coachErrorText('age_limited')}</div></div></div>`;
  if (!p) {
    return `<div class="view view--grouped coach-chat-view">${head}<div class="scr"><div class="empty-note">${coach.state
      ? (key === CHAT_COACH ? 'Tu n\'as plus de coach. Les messages ont été supprimés.' : 'Cette personne ne fait plus partie de tes élèves. Les messages ont été supprimés.')
      : 'Chargement…'}</div></div></div>`;
  }
  const c = chatConv(key), draft = chatDrafts[key] || '';
  return `
    <div class="view view--grouped coach-chat-view">
      ${head}
      <div class="scr chat">
        <p class="chat-intro">Personne d'autre que toi et ${esc(name)} ne lit ces messages, sauf en cas de signalement. Ils sont supprimés si le suivi s'arrête.</p>
        <div id="chatPushLine">${chatPushLineHtml()}</div>
        <div class="chat-list" id="chatList" role="log" aria-live="polite" aria-relevant="additions">${chatListHtml(key)}</div>
        <div class="chat-compose">
          <textarea id="chatInput" class="comment-compose__input chat-compose__input" data-key="${esc(key)}" rows="1"
            aria-label="${esc(`Message à ${name}`)}" placeholder="Message" autocomplete="off" autocapitalize="sentences" aria-describedby="chatCount">${esc(draft)}</textarea>
          <button class="comment-compose__send" data-action="chat-send" data-key="${esc(key)}" aria-label="Envoyer le message"
            ${c.sending || chatProblem(draft) ? 'disabled' : ''}>${icon('arrow.up', 18)}</button>
        </div>
        <p class="comment-compose__count num" id="chatCount" aria-live="polite">${chatCountText(draft)}</p>
      </div>
    </div>`;
}

// Liste seule (saisie en cours) ; défile en bas si on y était déjà ou si un message vient d'arriver de moi
function refreshChatList(key) {
  const box = $('#chatList');
  if (!box) return false;
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;
  box.innerHTML = chatListHtml(key);
  const send = $('.chat-compose .comment-compose__send'), input = $('#chatInput');
  if (send && input) send.disabled = chatConv(key).sending || !!chatProblem(input.value);
  chatScrollIfNew(key, atBottom);
  return true;
}
// Dernier message changé : en bas (si on y était, ou à la première ouverture)
function chatScrollIfNew(key, atBottom = true) {
  const rows = chatConv(key).rows, last = rows.length ? `${key}/${rows[rows.length - 1].id}` : null;
  if (last === chatShownLast) return;
  const first = !chatShownLast || !chatShownLast.startsWith(`${key}/`);
  chatShownLast = last;
  if (first || atBottom || rows[rows.length - 1]?.mine) {
    requestAnimationFrame(() => {
      // Dernier message déjà visible au-dessus de la saisie : on ne défile pas (sinon l'intro passait sous la
      // barre de titre pour une conversation courte, panel du 06/11)
      const lastMsg = $('#chatList')?.lastElementChild, comp = $('.chat-compose');
      if (lastMsg && comp && lastMsg.getBoundingClientRect().bottom <= comp.getBoundingClientRect().top && window.scrollY === 0) return;
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: first || reduceMotion.matches ? 'auto' : 'smooth' });
    });
  }
}

// ── Relecture ───────────────────────────────────────────────

function chatStopPoll() { if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; } }
async function chatTick() {
  const key = chatKeyShown();
  if (!key) { chatStopPoll(); return; }
  if (document.visibilityState !== 'visible') return;
  const r = await chatPoll(key);
  if (r.ok && r.theirs && chatKeyShown() === key) chatMarkRead(key, { force: true });
}
function chatStartPoll() {
  chatStopPoll();
  chatPollTimer = setInterval(chatTick, CHAT_POLL_MS);
}
// Retour au premier plan (peut-être depuis les Réglages de l'iPhone) : messages et autorisation d'iOS relus
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && chatKeyShown()) { chatTick(); pushRefreshPermission(); } });
// Autorisation d'iOS changée : la ligne seule, sans redessiner la saisie
onPushChange(() => {
  const line = chatKeyShown() && $('#chatPushLine');
  if (line) { const html = chatPushLineHtml(); if (line.innerHTML !== html) line.innerHTML = html; }
});

// ── Saisie et actions ───────────────────────────────────────

document.addEventListener('input', e => {
  const el = e.target;
  if (el?.id !== 'chatInput') return;
  chatDrafts[el.dataset.key] = el.value;
  fitCommentInput(el);
  const send = $('.chat-compose .comment-compose__send'), count = $('#chatCount');
  if (send) send.disabled = chatConv(el.dataset.key).sending || !!chatProblem(el.value);
  if (count) { count.textContent = chatCountText(el.value); count.classList.toggle('is-over', chatLength(el.value) > CHAT_MAX); }
});

async function sendChat(key) {
  const input = $('#chatInput');
  const text = input ? input.value : chatDrafts[key] || '';
  const r = await chatSend(key, text);
  if (!r.ok) { if (r.kind !== 'busy') showToast(coachErrorText(r.kind), { error: true }); return; }
  haptic();
  const el = $('#chatInput');
  const rest = draftAfterSend(el ? el.value : chatDrafts[key] || '', text);
  if (rest) chatDrafts[key] = rest; else delete chatDrafts[key];
  if (el) { el.value = rest; fitCommentInput(el); }
  const count = $('#chatCount');
  if (count) count.textContent = rest ? chatCountText(rest) : '';
  announce('Message envoyé');
  if (!refreshChatList(key)) render();
  // Relu tout de suite : un message de l'autre arrivé juste avant le mien s'affiche sans attendre 15 s
  chatTick();
}

// Menu : Signaler (report_chat : le serveur copie les 50 derniers messages pour l'équipe, puis l'alerte
// part par e-mail). Quitter ou retirer ensuite efface la conversation, pas la copie.
async function chatMenu(key) {
  const p = chatPartner(key);
  if (!p) return;
  const name = personName(p);
  const choice = await dialog({ type: 'sheet', title: name, actions: [{ label: `Signaler ${name}`, value: 'report', style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
  if (choice !== 'report') return;
  const reason = await dialog({ type: 'sheet', title: `Signaler ${name}`,
    message: `Pourquoi ? ${name} ne saura pas que c'est toi. Les 50 derniers messages sont joints pour l'équipe de modération.`,
    actions: [...REPORT_REASONS.map(x => ({ label: x.label, value: x.reason })), { label: 'Annuler', style: 'cancel' }] });
  if (!reason) return;
  const r = await chatReport(key, reason);
  if (!r.ok) { showToast(r.kind === 'report_rate' ? socialErrorText(r.kind) : coachErrorText(r.kind), { error: true }); return; }
  haptic();
  await dialog({ title: 'Signalement envoyé', message: `Il sera traité sous 24 heures. La copie des messages est gardée même si le suivi s'arrête. ${key === CHAT_COACH
    ? 'Pour ne plus échanger avec ton coach : Mon coach › Quitter mon coach.' : 'Pour ne plus échanger avec cet élève, retire-le depuis sa fiche.'}`,
    actions: [{ label: 'OK', style: 'preferred' }] });
}

registerActions({
  'chat-open': (e, el) => navigate(makeRoute('coach-chat', el.dataset.key)),
  'chat-inbox-more': () => { chatInboxN += CHAT_INBOX_PAGE; refreshChatInbox(); },
  'chat-send': (e, el) => { sendChat(el.dataset.key); },
  'chat-more': (e, el) => { chatLoad(el.dataset.key, { more: true }); },
  'chat-menu': (e, el) => { chatMenu(el.dataset.key); },
  'chat-intro-ok': () => { setChatIntroSeen(); render(); },
});

SCREENS.set('coach-chat', {
  render: key => renderCoachChat(key),
  mount: () => {
    const key = chatKeyShown(), el = $('#chatInput');
    if (el) fitCommentInput(el);
    if (key) chatScrollIfNew(key);
  },
  // Ouverture : messages relus, conversation marquée lue, relecture régulière ; départ : relecture arrêtée
  enter: async () => {
    const key = chatKeyShown();
    if (!key || chatHiddenByAge()) return;
    chatShownLast = null;
    if (key === CHAT_COACH) setChatIntroSeen();
    chatStartPoll();
    pushRefreshPermission();
    await chatLoad(key);
    if (chatKeyShown() === key) chatMarkRead(key, { force: true });
    // Première ouverture : proposer d'être prévenu des messages (une fois, js/features/push-ui.js)
    if (chatKeyShown() === key) pushAskInContext(key === CHAT_COACH ? 'student' : 'coach', () => chatKeyShown() === key);
  },
  leave: () => { chatStopPoll(); },
});

// Changement de l'état du coach ou d'une conversation pendant la saisie : la liste seule (le rendu
// complet attend la fin de la frappe, js/features/coach-ui.js)
onCoachChange(() => {
  const key = chatKeyShown();
  if (key && document.activeElement?.id === 'chatInput') refreshChatList(key);
});

// ── Boîte de réception du coach (segment Messages de l'onglet Coach) ─────────
// Comme Messages d'iOS : avatar (ou photo), pseudo, heure, dernier message sur une ligne ; les non-lues en tête avec
// leur nombre ; recherche par pseudo (aussi les élèves sans conversation, pour en commencer une). Dessinée par
// CHAT_INBOX_PAGE lignes, la suite en défilant. Recherche et relecture ne redessinent que la liste (#chatRows).
let chatInboxQ = '';
let chatInboxN = CHAT_INBOX_PAGE;
let chatInboxObserver = null;

// Nombre de non-lus sur le bouton Messages du segment (exact)
function chatSegCountHtml() {
  const n = chatAvailable() ? chatUnreadTotal() : 0;
  return n ? ` <span class="seg-count num" aria-hidden="true">${n}</span><span class="visually-hidden">, ${plural(n, 'non lu', 'non lus')}</span>` : '';
}
function chatInboxRowHtml({ st, unread, last }, now) {
  const name = personName(st);
  const preview = last ? `${last.mine ? 'Toi : ' : ''}${last.body.replace(/\s+/g, ' ')}` : 'Aucun message';
  const time = last ? chatListTime(last.at, now) : '';
  return `
          <button class="cell cell--nav chat-row${unread ? ' chat-row--unread' : ''}" data-action="chat-open" data-key="${esc(st.user_id)}">
            ${personAvatar(st)}
            <span class="chat-row__body">
              <span class="chat-row__top"><span class="chat-row__name">${esc(name)}</span>${pushOffMarkHtml(st.user_id)}<span class="chat-row__time num">${esc(time)}</span></span>
              <span class="chat-row__last">${unread ? `<span class="visually-hidden">${plural(unread, 'message non lu', 'messages non lus')}, </span>` : ''}${esc(preview)}</span>
            </span>
            ${unread ? `<span class="coach-count num" aria-hidden="true">${unread}</span>` : ''}
            ${icon('chevron.right', 16)}
          </button>`;
}
function chatInboxRowsHtml() {
  const st = coach.state;
  const all = chatInboxRows(st?.students || [], chat.threads, chatInboxQ, normName);
  const page = all.slice(0, chatInboxN), rest = all.length - page.length, now = Date.now();
  if (!all.length) {
    return `<div class="cell" id="chatInboxNone"><span class="cell__sub social-empty">${chatInboxQ ? 'Aucun élève ne correspond.'
      : 'Aucune conversation. Cherche un élève par son pseudo pour lui écrire.'}</span></div>`;
  }
  return page.map(r => chatInboxRowHtml(r, now)).join('') + (rest > 0
    ? `<button class="cell cell--action chat-more-rows" data-action="chat-inbox-more">Afficher ${plural(Math.min(rest, CHAT_INBOX_PAGE), 'conversation de plus', 'conversations de plus')}</button>` : '');
}
function chatInboxScreenHtml() {
  const st = coach.state;
  if (!st) return `<div id="chatInbox">${coach.error ? coachOfflineNote(coach.error, 'Pas d\'Internet. Tes messages s\'afficheront quand le réseau reviendra.') : '<div class="empty-note">Chargement…</div>'}</div>`;
  if (!chatAvailable()) return `<div id="chatInbox"><div class="empty-note">${chatHiddenByAge() ? esc(coachErrorText('age_limited')) : 'Les messages ne sont pas encore disponibles.'}</div></div>`;
  if (!st.students.length) return '<div id="chatInbox"><div class="empty-note">Les conversations avec tes élèves s\'affichent ici.</div></div>';
  return `<div id="chatInbox">
        <div class="social-search"><span class="social-search__icon" aria-hidden="true">${icon('magnifyingglass', 17)}</span><input type="search" id="chatSearch" maxlength="${SEARCH_MAX}" class="search social-search__input" placeholder="Rechercher" aria-label="Rechercher un élève par son pseudo"
            autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search" value="${esc(chatInboxQ)}"></div>
        ${chat.error && !chat.threads ? `<p class="social-inline-error" role="status">${esc(chat.error === 'offline' ? 'Pas d\'Internet : pas à jour.' : coachErrorText(chat.error))}</p>` : ''}
        <div class="group chat-inbox" id="chatRows">${chatInboxRowsHtml()}</div>
        ${chatPushOff.ids?.size ? `<div class="group-foot">${icon('bell.slash', 13)} : notifications coupées chez cet élève. Il verra tes messages en ouvrant l'app.</div>` : ''}
      </div>`;
}
// Liste seule (relecture, recherche) ; segment Messages affiché seulement
function refreshChatInbox() {
  if (currentView() !== 'friends' || friendsSeg() !== 'messages') return;
  const rows = $('#chatRows');
  if (!rows) { const box = $('#chatInbox'); if (box && !coachTyping()) { box.outerHTML = chatInboxScreenHtml(); chatInboxWatchMore(); } return; }
  setHtmlIfChanged(rows, chatInboxRowsHtml());
  chatInboxWatchMore();
}
// Nombre de non-lus du bouton Messages, quel que soit le segment affiché
function refreshChatSegCount() {
  const seg = $('.social-seg [data-seg="messages"]');
  if (seg) setHtmlIfChanged(seg, `Messages${chatSegCountHtml()}`);
}
function chatInboxWatchMore() {
  chatInboxObserver?.disconnect();
  const btn = $('.chat-more-rows');
  if (!btn || typeof IntersectionObserver !== 'function') return;
  chatInboxObserver = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { chatInboxObserver.disconnect(); chatInboxN += CHAT_INBOX_PAGE; refreshChatInbox(); } }, { rootMargin: '600px 0px' });
  chatInboxObserver.observe(btn);
}
// Arrivée sur Messages : état et résumés des conversations relus (chatRefresh suit coachRefresh), cloches
function chatInboxEnter() {
  coachRefresh({ minAge: 10_000 }).then(() => chatPushOffRefresh());
  if (coach.state && chat.loadedAt && Date.now() - chat.loadedAt > 10_000) chatRefresh();
}
document.addEventListener('input', e => {
  if (e.target.id !== 'chatSearch') return;
  chatInboxQ = e.target.value;
  chatInboxN = CHAT_INBOX_PAGE;
  refreshChatInbox();
});
onCoachChange(() => { refreshChatSegCount(); refreshChatInbox(); });

// ── Cellules d'entrée ───────────────────────────────────────

function chatIntroSeen() { try { return localStorage.getItem(CHAT_INTRO_KEY) === '1'; } catch { return false; } }
function setChatIntroSeen() { try { localStorage.setItem(CHAT_INTRO_KEY, '1'); } catch { /* redit à la prochaine visite */ } }
// Mon coach (élève) : ce que la messagerie permet, dit une fois
function chatIntroHtml() {
  if (!chatAvailable() || chatIntroSeen()) return '';
  return `
        <div class="group">
          <div class="cell coach-lost chat-intro-note" role="status">
            <span class="cell__body"><span class="cell__title">Ton coach peut t'écrire</span><span class="cell__sub">Un message te gêne ? Signale-le depuis la conversation, ou quitte ton coach.</span></span>
            <button class="social-x" data-action="chat-intro-ok" aria-label="OK, fermer">${icon('xmark', 14)}</button>
          </div>
        </div>`;
}

// Pastille des non-lus d'une conversation
function chatBadgeHtml(n) {
  return n ? `<span class="chat-count num" aria-hidden="true">${icon('text.bubble', 14)}${n}</span>` : '';
}
// Élève : « Messages » juste sous « Mon coach », en tête de l'onglet Social : la conversation à un toucher, avec ses non-lus
function chatCoachRowHtml() {
  const th = chatThreadOf(CHAT_COACH), n = chatUnreadOf(CHAT_COACH);
  const last = th?.last ? `${th.last.mine ? 'Toi : ' : ''}${th.last.body.replace(/\s+/g, ' ')}` : 'Écris à ton coach';
  return `
      <button class="cell cell--nav coach-cell chat-cell chat-cell--coach" data-action="chat-open" data-key="${CHAT_COACH}">
        <span class="coach-cell__icon" aria-hidden="true">${icon('text.bubble', 20)}</span>
        <span class="cell__body"><span class="cell__title">Messages${n ? `<span class="sr-text">, ${plural(n, 'non lu', 'non lus')},</span>` : ''}</span><span class="cell__sub chat-cell__last chat-cell__last--one">${esc(last)}</span></span>
        ${n ? `<span class="coach-count num" aria-hidden="true">${n}</span>` : ''}
        ${icon('chevron.right', 16)}
      </button>`;
}
// Cellule « Messages » (Mon coach, fiche d'un élève) ; rien si le serveur n'a pas la messagerie
function chatCellHtml(key) {
  if (!chatAvailable()) return '';
  const th = chatThreadOf(key), n = chatUnreadOf(key);
  // Nom lu par VoiceOver = texte du bouton (« Messages, 2 non lus, » puis le dernier message) : pas d'aria-label,
  // qui cachait le dernier message affiché
  const last = th?.last ? `${th.last.mine ? 'Toi : ' : ''}${th.last.body.replace(/\s+/g, ' ')}` : 'Aucun message';
  return `
        <div class="group">
          <button class="cell cell--nav chat-cell" data-action="chat-open" data-key="${esc(key)}">
            <span class="coach-cell__icon" aria-hidden="true">${icon('text.bubble', 20)}</span>
            <span class="cell__body"><span class="cell__title">Messages${n ? `<span class="sr-text">, ${plural(n, 'non lu', 'non lus')},</span>` : ''}</span><span class="cell__sub chat-cell__last">${esc(last)}</span></span>
            ${n ? `<span class="coach-count num" aria-hidden="true">${n}</span>` : ''}
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}
