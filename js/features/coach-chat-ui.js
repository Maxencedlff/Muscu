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
    return `<p class="chat-empty">${key === CHAT_COACH ? 'Écris à ton coach : une question, ton ressenti, une gêne pendant une séance.'
      : 'Écris à ton élève : un encouragement, une consigne, une question.'}</p>`;
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
      ? (key === CHAT_COACH ? 'Tu n\'as plus de coach : les messages ont été effacés.' : 'Cette personne ne fait plus partie de tes élèves : les messages ont été effacés.')
      : 'Chargement…'}</div></div></div>`;
  }
  const c = chatConv(key), draft = chatDrafts[key] || '';
  return `
    <div class="view view--grouped coach-chat-view">
      ${head}
      <div class="scr chat">
        <p class="chat-intro">${esc(key === CHAT_COACH ? `Messages avec ton coach ${name}. Vous seuls les lisez.` : `Messages avec ${name}. Vous seuls les lisez.`)}
          Ils sont effacés si le coaching s'arrête.</p>
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && chatKeyShown()) chatTick(); });

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
    message: `Pourquoi ? ${name} ne saura pas que c'est toi. Les 50 derniers messages de la conversation sont joints au signalement pour l'équipe de modération.`,
    actions: [...REPORT_REASONS.map(x => ({ label: x.label, value: x.reason })), { label: 'Annuler', style: 'cancel' }] });
  if (!reason) return;
  const r = await chatReport(key, reason);
  if (!r.ok) { showToast(r.kind === 'report_rate' ? socialErrorText(r.kind) : coachErrorText(r.kind), { error: true }); return; }
  haptic();
  await dialog({ title: 'Signalement envoyé', message: `Merci. Il sera traité sous 24 heures. La copie des messages est gardée même si le coaching s'arrête. ${key === CHAT_COACH
    ? 'Pour ne plus échanger avec ton coach : Mon coach › Quitter mon coach.' : 'Pour ne plus échanger avec cet élève, retire-le depuis sa fiche.'}`,
    actions: [{ label: 'OK', style: 'preferred' }] });
}

registerActions({
  'chat-open': (e, el) => navigate(makeRoute('coach-chat', el.dataset.key)),
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
    await chatLoad(key);
    if (chatKeyShown() === key) chatMarkRead(key, { force: true });
  },
  leave: () => { chatStopPoll(); },
});

// Changement de l'état du coach ou d'une conversation pendant la saisie : la liste seule (le rendu
// complet attend la fin de la frappe, js/features/coach-ui.js)
onCoachChange(() => {
  const key = chatKeyShown();
  if (key && document.activeElement?.id === 'chatInput') refreshChatList(key);
});

// ── Cellules d'entrée ───────────────────────────────────────

function chatIntroSeen() { try { return localStorage.getItem(CHAT_INTRO_KEY) === '1'; } catch { return false; } }
function setChatIntroSeen() { try { localStorage.setItem(CHAT_INTRO_KEY, '1'); } catch { /* redit à la prochaine visite */ } }
// Mon coach (élève) : ce que la messagerie permet, dit une fois
function chatIntroHtml() {
  if (!chatAvailable() || chatIntroSeen()) return '';
  return `
        <div class="group">
          <div class="cell coach-lost chat-intro-note" role="status">
            <span class="cell__body"><span class="cell__title">Ton coach peut t'écrire</span><span class="cell__sub">Messages texte seul, que vous seuls lisez, effacés quand le coaching s'arrête. Un message te gêne ? Signale-le depuis la conversation, ou quitte ton coach.</span></span>
            <button class="social-x" data-action="chat-intro-ok" aria-label="OK, fermer">${icon('xmark', 14)}</button>
          </div>
        </div>`;
}

// Pastille des non-lus d'une conversation
function chatBadgeHtml(n) {
  return n ? `<span class="chat-count num" aria-hidden="true">${icon('text.bubble', 14)}${n > 99 ? '99+' : n}</span>` : '';
}
// Cellule « Messages » (Mon coach, fiche d'un élève) ; rien si le serveur n'a pas la messagerie
function chatCellHtml(key) {
  if (!chatAvailable()) return '';
  const th = chatThreadOf(key), n = chatUnreadOf(key);
  const last = th?.last ? `${th.last.mine ? 'Toi : ' : ''}${th.last.body.replace(/\s+/g, ' ')}` : 'Aucun message pour l\'instant';
  const label = ['Messages', n ? plural(n, 'non lu', 'non lus') : ''].filter(Boolean).join(', ');
  return `
        <div class="group">
          <button class="cell cell--nav chat-cell" data-action="chat-open" data-key="${esc(key)}" aria-label="${esc(label)}">
            <span class="coach-cell__icon" aria-hidden="true">${icon('text.bubble', 20)}</span>
            <span class="cell__body"><span class="cell__title">Messages</span><span class="cell__sub chat-cell__last">${esc(last)}</span></span>
            ${n ? `<span class="coach-count num" aria-hidden="true">${n > 99 ? '99+' : n}</span>` : ''}
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}
