// ═══════════════════════════════════════════════════════════
//  Commentaires d'une séance, écran : liste (du plus ancien au plus récent, « Afficher les précédents »),
//  saisie en bas (compteur près de la limite, bouton Envoyer), et sur chaque commentaire un menu ⋯ :
//  Supprimer (le mien, ou tout commentaire sur ma séance), Signaler puis proposer de bloquer (celui
//  d'un autre). Placé dans la séance d'un ami (js/features/social-ui.js, social-session), dans ma
//  séance vue par mes abonnés, et dans Historique › Séance (ma séance, Amis activé).
//  Données : js/data/comments.js (contrat : docs/SOCIAL_V1.md, « Commentaires »). Tout texte venu du
//  serveur passe par esc() ; retours à la ligne gardés par le CSS (white-space: pre-wrap), jamais en HTML.
//  Saisie : le brouillon est gardé par séance pendant la frappe (sans redessiner) ; un changement reçu
//  pendant que le champ a le focus ne redessine que la liste (refreshCommentsList), le clavier reste.
//  iOS : rien au pointerdown, un seul toucher sur chaque bouton.
// ═══════════════════════════════════════════════════════════
'use strict';

const commentDrafts = {};   // brouillon par séance (clé owner/id), jusqu'à l'envoi

// ── Gabarits ────────────────────────────────────────────────

function commentRowHtml(c, owner, id) {
  const name = personName(c);
  const menu = c.canDelete || !c.mine
    ? `<button class="comment__more" data-action="comment-menu" data-owner="${esc(owner)}" data-id="${esc(id)}" data-cid="${c.id}" aria-label="${esc(`Options du commentaire de ${name}`)}">${icon('ellipsis', 18)}</button>`
    : '';
  return `
          <div class="cell comment${c.masked ? ' comment--masked' : ''}" data-cid="${c.id}">
            ${personAvatar(c, 's')}
            <div class="comment__main">
              <p class="comment__head"><b class="comment__name">${esc(name)}</b><span class="comment__at">${esc(fmtAgo(c.at))}</span></p>
              <p class="comment__body">${esc(c.body)}</p>
              ${c.masked ? '<p class="comment__note">Masqué après des signalements : toi seul le vois.</p>' : ''}
            </div>
            ${menu}
          </div>`;
}

// Liste seule (redessinée sans toucher à la saisie)
function commentsListHtml(owner, id) {
  const t = commentsOf(owner, id), rows = commentsShown(owner, id);
  if (!rows.length) {
    if (t.loading || (!t.loadedAt && !t.error)) return '<div class="cell"><span class="cell__sub">Chargement…</span></div>';
    if (t.error) {
      const msg = t.error === 'offline' ? 'Pas d\'Internet : les commentaires s\'afficheront quand le réseau reviendra.' : 'Commentaires indisponibles pour l\'instant.';
      return `<div class="cell comments__error" role="status"><span class="cell__sub">${msg}</span><button class="social-note__btn" data-action="comments-retry" data-owner="${esc(owner)}" data-id="${esc(id)}">Réessayer</button></div>`;
    }
    return '<div class="cell"><span class="cell__sub social-empty">Aucun commentaire pour l\'instant.</span></div>';
  }
  const more = t.end ? '' : `<button class="cell cell--action comments__more" data-action="comments-more" data-owner="${esc(owner)}" data-id="${esc(id)}" ${t.loading ? 'disabled' : ''}>${t.loading ? 'Chargement…' : 'Afficher les commentaires précédents'}</button>`;
  return more + rows.map(c => commentRowHtml(c, owner, id)).join('');
}

function commentCountHtml(text) {
  const n = commentLength(text);
  return n >= COMMENT_WARN ? `${n} / ${COMMENT_MAX}` : '';
}

// Groupe complet : titre, liste, saisie (writable : séance visible, où l'on peut encore écrire)
function commentsGroupHtml(owner, id, { writable = true } = {}) {
  const key = commentKey(owner, id), draft = commentDrafts[key] || '';
  const n = commentsShown(owner, id).length, t = commentsOf(owner, id);
  const busy = comments.busy;
  const composer = writable ? `
        <div class="comment-compose">
          <textarea id="commentInput" class="comment-compose__input" data-owner="${esc(owner)}" data-id="${esc(id)}" rows="1"
            aria-label="Ajouter un commentaire" placeholder="Ajouter un commentaire…" autocomplete="off" autocapitalize="sentences" aria-describedby="commentCount">${esc(draft)}</textarea>
          <button class="comment-compose__send" data-action="comment-send" data-owner="${esc(owner)}" data-id="${esc(id)}"
            aria-label="Envoyer le commentaire" ${busy || commentProblem(draft) ? 'disabled' : ''}>${icon('arrow.up', 18)}</button>
        </div>
        <p class="comment-compose__count num" id="commentCount" aria-live="polite">${commentCountHtml(draft)}</p>` : '';
  return `
        <div class="group-title">Commentaires${n && t.end ? ` (${n})` : ''}</div>
        <div class="group comments" id="commentsList">${commentsListHtml(owner, id)}</div>
        ${composer}
        <div class="group-foot">${writable ? 'Reste bienveillant : les insultes sont refusées et un commentaire signalé plusieurs fois est masqué.'
          : 'Séance masquée : personne d\'autre ne voit ces commentaires, et on ne peut plus en ajouter.'}</div>`;
}

// Changement reçu pendant la saisie : la liste seule, le champ garde le focus et le clavier
function refreshCommentsList() {
  const box = $('#commentsList'), input = $('#commentInput');
  if (!box || !input) return false;
  box.innerHTML = commentsListHtml(input.dataset.owner, input.dataset.id);
  const send = $('.comment-compose__send');
  if (send) send.disabled = comments.busy || !!commentProblem(input.value);
  return true;
}

// ── Saisie ──────────────────────────────────────────────────

// Hauteur du champ ajustée au texte (5 lignes au plus, puis défilement dans le champ)
function fitCommentInput(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}
document.addEventListener('input', e => {
  const el = e.target;
  if (el?.id !== 'commentInput') return;
  commentDrafts[commentKey(el.dataset.owner, el.dataset.id)] = el.value;
  fitCommentInput(el);
  const send = $('.comment-compose__send'), count = $('#commentCount');
  if (send) send.disabled = comments.busy || !!commentProblem(el.value);
  if (count) count.textContent = commentCountHtml(el.value);
  count?.classList.toggle('is-over', commentLength(el.value) > COMMENT_MAX);
});

async function sendComment(owner, id) {
  const key = commentKey(owner, id), input = $('#commentInput');
  const text = input ? input.value : commentDrafts[key] || '';
  const r = await commentsAdd(owner, id, text);
  if (!r.ok) {
    if (r.kind !== 'busy') showToast(socialErrorText(r.kind), { error: true });
    return;
  }
  haptic();
  const el = $('#commentInput');
  const rest = draftAfterSend(el ? el.value : commentDrafts[key] || '', text);
  if (rest) commentDrafts[key] = rest; else delete commentDrafts[key];
  if (el) { el.value = rest; fitCommentInput(el); }
  const count = $('#commentCount');
  if (count) count.textContent = rest ? commentCountHtml(rest) : '';
  announce('Commentaire envoyé');
  if (!refreshCommentsList()) render();
  $('#commentsList .comment:last-child')?.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
}

// Menu ⋯ d'un commentaire : Supprimer, Signaler
async function commentMenu(owner, id, cid) {
  const c = commentsOf(owner, id).rows.find(x => x.id === cid);
  if (!c) return;
  const actions = [];
  if (!c.mine) actions.push({ label: 'Signaler', value: 'report' });
  if (c.canDelete) actions.push({ label: 'Supprimer', value: 'delete', style: 'destructive' });
  actions.push({ label: 'Annuler', style: 'cancel' });
  const name = personName(c);
  const choice = await dialog({ type: 'sheet', title: c.mine ? 'Ton commentaire' : `Commentaire de ${name}`, actions });
  if (choice === 'delete') {
    if (!c.mine && !(await confirmSheet('Supprimer ce commentaire ?', `${name} ne sera pas prévenu.`, 'Supprimer'))) return;
    const r = await commentsDelete(owner, id, cid);
    if (socialToast(r, 'Commentaire supprimé')) haptic();
    return;
  }
  if (choice !== 'report') return;
  const reason = await dialog({ type: 'sheet', title: 'Signaler ce commentaire', message: `Pourquoi ? ${name} ne saura pas que c'est toi.`,
    actions: [...REPORT_REASONS.map(x => ({ label: x.label, value: x.reason })), { label: 'Annuler', style: 'cancel' }] });
  if (!reason) return;
  const r = await commentsReport(owner, id, cid, reason);
  if (!socialToast(r)) return;
  haptic();
  const block = await dialog({ title: 'Commentaire signalé', message: `Merci. Il est masqué pour toi. Tu peux aussi bloquer ${name} : vous ne verrez plus les séances ni les commentaires l'un de l'autre.`,
    actions: [{ label: 'Bloquer', value: true, style: 'destructive' }, { label: 'OK', style: 'preferred' }] });
  if (block !== true) return;
  // Pas blockFlow : bloquer l'auteur d'un commentaire ne quitte pas la séance affichée (sauf si c'est la sienne)
  const rb = await socialBlock(c.user_id);
  if (!socialToast(rb, `${name} bloqué`)) return;
  if (currentView() === 'social-session' && owner === c.user_id) goBack();
  else render();
}

registerActions({
  'comment-send': (e, el) => { sendComment(el.dataset.owner, el.dataset.id); },
  'comment-menu': (e, el) => { commentMenu(el.dataset.owner, el.dataset.id, Number(el.dataset.cid)); },
  'comments-more': (e, el) => { commentsLoad(el.dataset.owner, el.dataset.id, { more: true }); },
  'comments-retry': (e, el) => { commentsLoad(el.dataset.owner, el.dataset.id); },
});

// ── Historique › Séance (ma séance) ─────────────────────────

// Groupe des commentaires de ma séance : Amis activé ; masquée : lecture seule (ceux d'avant restent)
function historyCommentsHtml(h) {
  if (!socialEnabled() || !account.user) return '';
  return commentsGroupHtml(account.user.id, h.id, { writable: h.hidden !== true });
}
// Ouverture du détail : commentaires relus (30 s au plus)
function historyCommentsMount(id) {
  if (!socialEnabled() || !account.user || !id) return;
  commentsLoad(account.user.id, id, { minAge: COMMENTS_REFRESH_MS });
  const el = $('#commentInput');
  if (el) fitCommentInput(el);
}
