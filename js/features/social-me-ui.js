// ═══════════════════════════════════════════════════════════
//  Amis › Mon profil (mon avatar en haut à droite de l'onglet) : avatar, pseudo, chiffres (séances
//  visibles, abonnés, abonnements), Activité (réactions à mes séances, nouveaux abonnés, demandes
//  acceptées et reçues, du plus récent au plus ancien), mes séances telles que mes abonnés les voient
//  (avec leurs réactions), puis Gérer (demandes envoyées, bloqués, désactivation).
//  Abonnés et Abonnements : écrans à part (social-people), ouverts depuis les chiffres.
//  Ouvrir Mon profil vaut « activité vue » (mark_activity_seen) : la pastille de l'onglet s'éteint, les
//  nouveautés gardent leur point bleu jusqu'à la prochaine ouverture.
//  Données : js/data/social.js (socialActivity, SOCIAL_ME, socialMarkActivitySeen). Tout texte venu du
//  serveur passe par esc().
// ═══════════════════════════════════════════════════════════
'use strict';

const ME_ACTIVITY_SHOWN = 8;   // lignes d'activité avant « Afficher plus »
let meActivityAll = false;     // « Afficher plus » touché (jusqu'à la sortie de Mon profil)

// Bouton de l'onglet Amis (en haut à droite) : mon avatar, avec un point s'il y a du nouveau
function meButtonHtml() {
  const n = socialActivityNew();
  return `<button class="navbar__icon navbar__avatar me-btn" data-action="social-me" aria-label="${esc(n ? `Mon profil, ${plural(n, 'nouveauté', 'nouveautés')}` : 'Mon profil')}">
      ${avatarHtml('s')}${n ? '<span class="me-btn__dot" aria-hidden="true"></span>' : ''}
    </button>`;
}
// Le point suit l'état sans redessiner l'onglet (la recherche garde le clavier)
function refreshMeButton() {
  const btn = $('.me-btn');
  if (btn) btn.outerHTML = meButtonHtml();
}

// Nom d'une de mes séances : celui de cet appareil s'il la connaît (le serveur n'a que son libellé)
function mySessionLabel(sessionId) {
  const h = sessionId && (data.history || []).find(x => x.id === sessionId);
  return h ? rawLabel(h.category, entryProg(h)) : '';
}

// Ligne de l'activité : avatar, « pseudo a réagi 🔥 à ta séance Legs », depuis quand ; point bleu si
// nouvelle. Réaction : vers ma séance (Historique) si cet appareil l'a, sinon le profil de la personne.
// Demande reçue : Accepter et Refuser, comme dans l'onglet.
function activityRowHtml(a) {
  const name = personName(a);
  const text = activityText(a, mySessionLabel(a.sessionId));
  const local = a.kind === 'reaction' && (data.history || []).some(h => h.id === a.sessionId);
  const open = local ? `data-action="social-open-my-session" data-id="${esc(a.sessionId)}"` : `data-action="social-open-profile" data-uid="${esc(a.user_id)}"`;
  const trailing = a.kind === 'request' && socialRelation(a.user_id, social.state).pendingIn
    ? pill('social-accept', a.user_id, 'Accepter', { fill: true, aria: `Accepter ${name}` })
      + `<button class="social-x" data-action="social-refuse" data-uid="${esc(a.user_id)}" aria-label="${esc(`Refuser ${name}`)}">${icon('xmark', 14)}</button>`
    : '';
  return `
    <div class="cell social-row activity-row">
      <button class="social-row__main" ${open} aria-label="${esc(`${a.isNew ? 'Nouveau. ' : ''}${name} ${text}, ${fmtAgo(a.at)}`)}">
        ${personAvatar(a)}
        <span class="social-row__text">
          <span class="activity-row__text"><b>${esc(name)}</b> ${esc(text)}</span>
          <span class="cell__sub">${esc(fmtAgo(a.at))}</span>
        </span>
        ${a.isNew ? '<span class="activity-row__new" aria-hidden="true"></span>' : ''}
      </button>
      ${trailing}
    </div>`;
}

function meActivityHtml() {
  const a = socialActivity();
  if (!a.rows.length) {
    if (a.loading || (!a.loadedAt && !a.error)) return '<div class="group"><div class="cell"><span class="cell__sub">Chargement…</span></div></div>';
    if (a.error) return offlineNote(a.error === 'offline' ? 'Pas d\'Internet : l\'activité s\'affichera quand le réseau reviendra.' : socialErrorText(a.error));
    return '<div class="group"><div class="cell"><span class="cell__sub social-empty">Rien pour l\'instant. Les réactions à tes séances et tes nouveaux abonnés s\'afficheront ici.</span></div></div>';
  }
  const rows = meActivityAll ? a.rows : a.rows.slice(0, ME_ACTIVITY_SHOWN);
  const more = (!meActivityAll && a.rows.length > ME_ACTIVITY_SHOWN) || (meActivityAll && !a.end)
    ? `<button class="btn-more" data-action="social-activity-more" ${a.loading ? 'disabled' : ''}>${a.loading ? 'Chargement…' : 'Afficher plus'}</button>` : '';
  return `<div class="group activity">${rows.map(activityRowHtml).join('')}</div>${more}`;
}

function renderSocialMe() {
  const st = social.state || cleanSocialState({});
  const name = account.profile?.username || st.username || 'Mon profil';
  const stat = (n, one, many, action, extra = '') => `
          <button class="me-stat" data-action="${action}" ${extra}>
            <span class="me-stat__val num">${n == null ? '—' : n}</span><span class="me-stat__lbl">${n === 1 ? one : many}</span>
          </button>`;
  return `
    <div class="view view--grouped social-me-view">
      ${navBar({ title: 'Mon profil', large: false })}
      <div class="scr">
        ${reactHintHtml()}
        <div class="account-hero">
          ${avatarHtml('xl')}
          <h2 class="account-hero__name">${esc(name)}</h2>
          <p class="account-hero__sub">Compte privé : seules les personnes que tu acceptes voient tes séances.</p>
        </div>
        <div class="me-stats">
          ${stat(st.shown_sessions, 'séance visible', 'séances visibles', 'social-me-sessions')}
          ${stat(st.followers.length, 'abonné', 'abonnés', 'social-people', 'data-list="followers"')}
          ${stat(st.following.length, 'abonnement', 'abonnements', 'social-people', 'data-list="following"')}
        </div>
        <div class="group-title">Activité</div>
        ${meActivityHtml()}
        <div class="group-title" id="meSessions">Mes séances vues par mes abonnés</div>
        ${feedListHtml(SOCIAL_ME, { owner: false, empty: 'Aucune séance visible pour l\'instant. Une séance apparaît ici quand « Visible sur mon profil » est allumé.' })}
        <div class="group-foot">Tes abonnés voient le nom, la date, la durée et les séries. Jamais tes notes ni ton poids.</div>
        <div class="group group--gap">
          <button class="cell cell--nav" data-action="social-manage">
            <span class="cell__body"><span class="cell__title">Gérer</span><span class="cell__sub">Demandes envoyées, comptes bloqués, désactiver</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
      </div>
    </div>`;
}

// Ouverture : état, activité et mes séances relus, puis activité vue (la pastille s'éteint)
async function socialMeEnter() {
  meActivityAll = false;
  socialRefresh({ minAge: 5000 });
  socialLoadFeed(SOCIAL_ME);
  await socialLoadActivity();
  if (currentView() === 'social-me' && !socialActivity().error) socialMarkActivitySeen();
}
SCREENS.set('social-me', { render: () => renderSocialMe(), enter: () => { socialMeEnter(); } });

// ── Abonnés, Abonnements ────────────────────────────────────

function renderSocialPeople(list) {
  const st = social.state || cleanSocialState({});
  const followers = list === 'followers';
  const people = followers ? st.followers : st.following;
  const chevron = `<span class="social-row__chev" aria-hidden="true">${icon('chevron.right', 16)}</span>`;
  const rows = people.map(p => personRowHtml(p, followers
    ? pill('social-remove-follower', p.user_id, 'Retirer', { aria: `Retirer ${personName(p)} de tes abonnés` })
    : chevron)).join('');
  return `
    <div class="view view--grouped social-people-view">
      ${navBar({ title: followers ? 'Abonnés' : 'Abonnements', large: false })}
      <div class="scr">
        <div class="group social-people">${rows || `<div class="cell"><span class="cell__sub social-empty">${followers ? 'Personne ne te suit pour l\'instant.' : 'Tu ne suis personne pour l\'instant.'}</span></div>`}</div>
        <div class="group-foot">${followers ? 'Tes abonnés voient tes séances visibles. Retirer un abonné ne le prévient pas.' : 'Tu vois les séances visibles des personnes que tu suis.'}</div>
      </div>
    </div>`;
}
SCREENS.set('social-people', { render: list => renderSocialPeople(list), enter: () => { socialRefresh({ minAge: 5000 }); } });

registerActions({
  'social-me': () => navigate('social-me'),
  'social-people': (e, el) => navigate(makeRoute('social-people', el.dataset.list)),
  'social-me-sessions': () => {
    $('#meSessions')?.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  },
  'social-activity-more': () => {
    if (!meActivityAll) { meActivityAll = true; render(); return; }
    socialLoadActivity({ more: true });
  },
  // Ma séance (Historique › séance), empilée dans l'onglet Amis
  'social-open-my-session': (e, el) => navigate(makeRoute('history-detail', el.dataset.id)),
});
