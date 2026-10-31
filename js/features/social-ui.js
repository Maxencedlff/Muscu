// ═══════════════════════════════════════════════════════════
//  Amis (Social V1), écrans : onglet Amis (sans compte, activation, puis recherche, demandes et fil),
//  séance d'un ami (détail des séries, réactions, Signaler) ou la mienne telle que mes abonnés la
//  voient (qui a réagi), profil d'un autre (s'abonner, annuler la demande, se désabonner, Bloquer,
//  Signaler), Gérer (demandes envoyées, bloqués, Désactiver le social), règles de la communauté, et
//  dans Historique › Séance : « Visible sur mon profil », qui a réagi et les commentaires.
//  Commentaires : js/features/comments-ui.js.
//  Réactions : js/features/reactions-ui.js ; Mon profil, Abonnés, Abonnements : js/features/social-me-ui.js.
//  Données et appels au serveur : js/data/social.js (contrat : docs/SOCIAL_V1.md). Tout texte venu du
//  serveur (pseudos, noms de séances et d'exercices des autres) passe par esc().
//  Rien ne bloque : l'état se charge en arrière-plan, l'écran se redessine quand il arrive.
// ═══════════════════════════════════════════════════════════
'use strict';

const SOCIAL_VIEWS = ['friends', 'social-profile', 'social-session', 'social-manage', 'social-rules', 'social-me', 'social-people'];
const RULES_URL = 'https://mdlf.app/privacy.html#communaute';

let socialAgeOk = false;       // case « J'ai 15 ans ou plus » de la carte d'activation
let socialQuery = '';          // recherche saisie
let socialResults = null;      // { q, rows } ou { q, error } de la dernière recherche
let socialSearchTimer = null, socialSearchSeq = 0;
let friendsShown = null;       // état de l'onglet au dernier dessin complet (friendsState)

// ── Petits gabarits ─────────────────────────────────────────

// Pseudo, ou « Compte masqué » (bloqué sans social : pseudo non renvoyé)
function personName(p) { return p?.username || 'Compte masqué'; }
function personAvatar(p, size = 'm') { return avatarHtml(size, p?.avatar, p?.username || '?'); }
// Couleur d'une séance d'un programme intégré ; séance perso d'un autre : gris neutre
function publicSessionColor(s) { return PROGRAMMES[s.programme]?.sessions?.[s.category]?.color || 'var(--label3)'; }
function seriesCount(s) { return s.exercises.reduce((a, e) => a + workSets(e.sets).length, 0); }   // sans l'échauffement
function publicMetaLine(s) {
  const parts = [];
  if (s.duration) parts.push(fmtDuration(s.duration));
  parts.push(plural(s.exercises.length, 'exercice', 'exercices'));
  return parts.join(' · ');
}
// État de l'onglet : 'unavailable' (navigateur), 'out' (sans compte), 'loading', 'error', 'off', 'on'
function friendsState() {
  if (!accountAvailable()) return 'unavailable';
  if (!account.ready) return 'loading';
  if (!account.user) return 'out';
  if (social.state) return social.state.enabled ? 'on' : 'off';
  if (social.cached) return social.cached.enabled ? 'on' : 'off';
  return social.error ? 'error' : 'loading';
}
function offlineNote(what) {
  return `<div class="social-note" role="status"><p>${what}</p><button class="social-note__btn" data-action="social-retry">Réessayer</button></div>`;
}
// Record mis en avant sur la carte : le plus marquant de ceux que son app a notés (jamais recalculé ici :
// le fil ne contient qu'une partie de ses séances). « 🏆 Nouveau record : Squat 100 kg »
function feedRecordHtml(s) {
  const r = topNotedRecord(s.records);
  return r ? `<span class="feed-card__rec"><span aria-hidden="true">🏆 </span>Nouveau record : <span class="num">${esc(notedFeedTxt(r))}</span></span>` : '';
}

// Carte du fil : qui et quand (vers son profil), la séance (vers le détail des séries), puis la
// réaction (js/features/reactions-ui.js). Ma séance (Mon profil) : le résumé des réactions seulement.
// owner : false sur l'écran du profil (la personne est déjà nommée), la date passe alors sous le nom
function feedCardHtml(row, { owner = true } = {}) {
  const s = row.s, p = { username: row.username, avatar: row.avatar };
  return `
    <article class="feed-card" data-owner="${esc(row.owner)}" data-id="${esc(row.id)}">
      ${owner ? `<button class="feed-card__who" data-action="social-open-profile" data-uid="${esc(row.owner)}">
        ${personAvatar(p)}<span class="feed-card__who-text"><span class="feed-card__name">${esc(personName(p))}</span><span class="feed-card__date">${fmtDate(row.doneAt)}</span></span>
      </button>` : ''}
      <button class="feed-card__main" data-action="social-open-session" data-owner="${esc(row.owner)}" data-id="${esc(row.id)}">
        <span class="feed-card__title"><span class="hcell__dot" style="background:${publicSessionColor(s)}" aria-hidden="true"></span><span class="feed-card__label">${esc(s.label)}</span>${owner ? '' : `<span class="feed-card__date">${fmtDate(row.doneAt)}</span>`}</span>
        <span class="feed-card__meta num">${esc(publicMetaLine(s))}</span>
        ${s.exercises.length ? `<span class="feed-card__sum">${esc(feedExercisesLine(s))}</span>` : ''}
        ${feedRecordHtml(s)}
      </button>
      <div class="feed-card__foot">${row.owner === social.userId
        ? `<span class="react-own">${reactionsSummary(row.reactions) ? reactionsSummaryHtml(row.reactions) : '<span class="react-own__none">Aucune réaction</span>'}</span>`
        : reactionBarHtml(row)}</div>
    </article>`;
}

// Liste de cartes d'un fil (fil principal '' ou profil), « Afficher plus », chargement, hors ligne
function feedListHtml(key, { owner = true, empty }) {
  const f = socialFeed(key);
  const cards = f.rows.map(r => feedCardHtml(r, { owner })).join('');
  if (!f.rows.length) {
    if (f.loading || (!f.loadedAt && !f.error)) return '<div class="empty-note">Chargement…</div>';
    if (f.error) return offlineNote(f.error === 'offline' ? 'Pas d\'Internet. Les séances s\'afficheront quand le réseau reviendra.' : socialErrorText(f.error));
    return `<div class="empty-note">${empty}</div>`;
  }
  const more = !f.end ? `<button class="btn-more" data-action="social-more" data-key="${esc(key)}" ${f.loading ? 'disabled' : ''}>${f.loading ? 'Chargement…' : 'Afficher plus'}</button>` : '';
  const err = f.error ? `<p class="social-inline-error" role="status">${esc(f.error === 'offline' ? 'Pas d\'Internet : fil pas à jour.' : socialErrorText(f.error))}</p>` : '';
  return `${err}<div class="feed">${cards}</div>${more}`;
}

// Ligne d'une personne : avatar et pseudo (vers son profil), puis une action à droite
function personRowHtml(p, trailing = '', sub = '') {
  return `
    <div class="cell social-row">
      <button class="social-row__main" data-action="social-open-profile" data-uid="${esc(p.user_id)}">
        ${personAvatar(p)}<span class="social-row__text"><span class="social-row__name">${esc(personName(p))}</span>${sub ? `<span class="cell__sub">${esc(sub)}</span>` : ''}</span>
      </button>
      ${trailing}
    </div>`;
}
function pill(action, uid, label, { fill = false, aria = '' } = {}) {
  return `<button class="social-pill ${fill ? 'social-pill--fill' : ''}" data-action="${action}" data-uid="${esc(uid)}"${aria ? ` aria-label="${esc(aria)}"` : ''}>${label}</button>`;
}

// ── Onglet Amis ─────────────────────────────────────────────

function renderFriends() {
  const st = friendsState();
  friendsShown = st;
  const right = st === 'on' ? meButtonHtml() : '';
  const search = st === 'on' ? `
        <div class="hist-tools">
          <input type="search" id="socialSearch" class="search" placeholder="Rechercher un pseudo" value="${esc(socialQuery)}"
                 autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Rechercher un ami par son pseudo">
        </div>` : '';
  return `
    <div class="view view--grouped friends-view">
      ${navBar({ title: 'Amis', right })}
      <div class="scr">${reactHintHtml()}<div id="coachCell">${coachCellHtml({ place: 'top', friends: st })}</div>${search}<div id="friendsBody">${friendsBodyHtml(st)}</div></div>
    </div>`;
}

function friendsBodyHtml(st = friendsState()) {
  if (st === 'unavailable') return `
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Entraîne-toi avec tes amis</h2>
          <p class="social-hero__sub">Les amis demandent un compte MDLF, dans l'app iPhone.</p>
        </div>`;
  if (st === 'out') return `
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Entraîne-toi avec tes amis</h2>
          <p class="social-hero__sub">Suis les séances de tes amis et encourage-les d'une réaction. Il faut un compte, gratuit et facultatif.</p>
        </div>
        <button class="btn btn--primary btn--full" data-action="social-sign-in">Se connecter</button>`;
  if (st === 'loading') return '<div class="empty-note">Chargement…</div>';
  if (st === 'error') return offlineNote(social.error === 'offline' ? 'Pas d\'Internet. Reconnecte-toi au réseau pour voir tes amis.' : socialErrorText(social.error));
  // Carte d'activation : « Rejoindre un coach » passe dessous, pour que « Activer » reste visible sans défiler
  if (st === 'off') return `${activationHtml()}<div id="coachCellLow">${coachCellHtml({ place: 'low', friends: st })}</div>`;
  return enabledBodyHtml();
}

// Carte d'activation : pseudo obligatoire, âge déclaré, règles, puis « Activer »
function activationHtml() {
  const name = account.profile?.username;
  const ready = !!name && socialAgeOk;
  return `
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Entraîne-toi avec tes amis</h2>
          <p class="social-hero__sub">Suis leurs séances et encourage-les d'une réaction. Ton compte reste privé : seules les personnes que tu acceptes voient tes séances.</p>
        </div>
        <div class="group">
          <button class="cell cell--nav" data-action="social-choose-username">
            <span class="cell__body"><span class="cell__title">Pseudo</span></span>
            <span class="cell__value ${name ? '' : 'social-choose'}">${name ? esc(name) : 'Choisir'}</span>
            ${icon('chevron.right', 16)}
          </button>
          <button class="cell" data-action="social-age" role="switch" aria-checked="${socialAgeOk}">
            <span class="cell__body"><span class="cell__title">J'ai 15 ans ou plus</span></span>
            ${switchHtml(socialAgeOk)}
          </button>
        </div>
        <div class="group-foot">${name ? 'Tes amis te trouvent avec ce pseudo.' : 'Il faut un pseudo pour que tes amis te trouvent.'} Tes notes, ton poids et tes données Santé ne sont jamais montrés. <button class="link-inline" data-action="social-rules">Règles de la communauté</button></div>
        <button class="btn btn--primary btn--full social-enable" data-action="social-enable" ${ready ? '' : 'disabled'}>Activer</button>`;
}

function enabledBodyHtml() {
  const q = normalizeSocialQuery(socialQuery);
  if (q) return searchResultsHtml(q);
  const st = social.state;
  const pending = st?.pending_in || [];
  const requests = pending.length ? `
        <div class="group-title">Demandes</div>
        <div class="group">${pending.map(p => personRowHtml(p,
          pill('social-accept', p.user_id, 'Accepter', { fill: true, aria: `Accepter ${personName(p)}` })
          + `<button class="social-x" data-action="social-refuse" data-uid="${esc(p.user_id)}" aria-label="${esc(`Refuser ${personName(p)}`)}">${icon('xmark', 14)}</button>`,
          '')).join('')}</div>` : '';
  const stale = social.error && st ? `<p class="social-inline-error" role="status">${esc(social.error === 'offline' ? 'Pas d\'Internet : demandes pas à jour.' : socialErrorText(social.error))}</p>` : '';
  return `${stale}${requests}
        <div class="group-title">Séances de tes amis</div>
        ${feedListHtml('', { empty: 'Rien pour l\'instant. Cherche un ami par son pseudo pour suivre ses séances.' })}`;
}

function searchResultsHtml(q) {
  const r = socialResults;
  if (!r || r.q !== q) return '<div class="empty-note">Recherche…</div>';
  if (r.error) return offlineNote(r.error === 'offline' ? 'Pas d\'Internet : la recherche demande du réseau.' : socialErrorText(r.error));
  if (!r.rows.length) return `<div class="empty-note">Aucun pseudo ne commence par « ${esc(q)} ».</div>`;
  return `<div class="group social-results">${r.rows.map(p => {
    const rel = socialRelation(p.user_id, social.state).status;
    const status = rel === 'following' ? 'Abonné' : rel === 'requested' ? 'Demandé' : '';
    const trailing = status ? `<span class="social-status">${status}</span>`
      : pill('social-follow', p.user_id, 'S\'abonner', { fill: true, aria: `S'abonner à ${personName(p)}` });
    return personRowHtml(p, trailing, p.relation === 'follows_you' ? 'Te suit' : '');
  }).join('')}</div>`;
}

// Recherche : seule la zone sous le champ est redessinée (le champ garde le focus et le clavier)
function refreshFriendsBody() {
  const body = $('#friendsBody');
  if (body) body.innerHTML = friendsBodyHtml();
}
function runSocialSearch() {
  clearTimeout(socialSearchTimer);
  const q = normalizeSocialQuery(socialQuery);
  if (!q) { socialResults = null; refreshFriendsBody(); return; }
  if (socialResults?.q !== q) refreshFriendsBody();
  const seq = ++socialSearchSeq;
  socialSearchTimer = setTimeout(async () => {
    const r = await socialSearch(q);
    if (seq !== socialSearchSeq) return;
    socialResults = r.ok ? { q, rows: r.data } : { q, error: r.kind };
    if (currentView() === 'friends') refreshFriendsBody();
  }, 250);
}

// Ouverture de l'onglet : état relu (badge), puis le fil s'il a plus de 30 s
async function friendsEnter() {
  if (!account.user) return;
  coachRefresh({ minAge: SOCIAL_REFRESH_MS });   // cellule Mes élèves / Mon coach (js/features/coach-ui.js), indépendante d'Amis
  await socialRefresh();
  if (socialEnabled() && Date.now() - socialFeed('').loadedAt > SOCIAL_REFRESH_MS) socialLoadFeed('');
}
SCREENS.set('friends', { render: () => renderFriends(), enter: () => { friendsEnter(); } });

// ── Séance d'un ami ─────────────────────────────────────────

// Record nommé, un seul : encourager, pas relire (ni flèches de baisse, ni notes, que les amis ne reçoivent
// pas). Noté par son app : toujours sûr. Séance d'une version d'avant : recalculé, seulement quand toutes ses
// séances visibles sont chargées (fil de son profil complet) : sur une partie seulement, un « record »
// pourrait être faux. Le poids du corps n'y entre jamais (js/data/session-review.js).
function friendRecord(row) {
  const f = socialFeed(row.owner);
  if (!reviewRecordsSure(row, f.end && f.loadedAt)) return null;
  return reviewRecords(row, f.rows, 1)[0] || null;
}

function renderSocialSession(owner, id) {
  const row = socialSessionOf(owner, id);
  if (!row) {
    return `<div class="view view--grouped social-session-view">${navBar({ title: 'Séance' })}
      <div class="scr"><div class="empty-note">Cette séance n'est plus disponible.</div></div></div>`;
  }
  const s = row.s, p = { username: row.username, avatar: row.avatar };
  const mine = row.owner === social.userId;
  let when = capitalize(fmtDate(row.doneAt, 'long'));
  if (s.duration) when += ` · ${fmtTime(row.doneAt)}`;
  const n = seriesCount(s), vol = reviewVolume(s.exercises), rec = friendRecord(row);
  return `
    <div class="view view--grouped social-session-view">
      ${navBar({ title: '' })}
      <div class="scr">
        ${mine ? `<p class="social-who social-who--me">${personAvatar(p)}<span class="social-who__name">Vue par tes abonnés</span></p>`
          : `<button class="social-who" data-action="social-open-profile" data-uid="${esc(row.owner)}">${personAvatar(p)}<span class="social-who__name">${esc(personName(p))}</span></button>`}
        <h1 class="scr-title"><span class="hcell__dot hcell__dot--lg" style="background:${publicSessionColor(s)}" aria-hidden="true"></span>${esc(s.label)}</h1>
        <p class="scr-sub">${when}</p>
        <div class="tiles tiles--4">
          <div class="tile"><span class="tile__val num">${vol > 0 ? fmtVolume(vol) : '—'}</span><span class="tile__lbl">volume</span></div>
          <div class="tile"><span class="tile__val num">${s.duration ? fmtDuration(s.duration) : '—'}</span><span class="tile__lbl">durée</span></div>
          <div class="tile"><span class="tile__val num">${n}</span><span class="tile__lbl">${n > 1 ? 'séries' : 'série'}</span></div>
          <div class="tile"><span class="tile__val num">${s.exercises.length}</span><span class="tile__lbl">${s.exercises.length > 1 ? 'exercices' : 'exercice'}</span></div>
        </div>
        ${rec ? `<div class="group social-session__rec">${notedRecordCell(rec, { before: false })}</div>` : ''}
        <div class="group-title">Exercices</div>
        <div class="group">
          ${s.exercises.map((e, i, xs) => `
            <div class="cell hex">
              <span class="cell__body">
                <span class="hex__name">${ssTagHtml(xs, i)}${esc(e.name)}</span>
                <span class="hex__sets num">${setsLine(e.sets, e.measure || measureOf(e), reviewSetKind(e))}</span>
                ${warmupText(e.sets) ? `<span class="hex__sets hex__sets--note num">${esc(warmupText(e.sets))}</span>` : ''}
              </span>
            </div>`).join('') || '<div class="cell"><span class="cell__sub">Aucun exercice</span></div>'}
        </div>
        ${mine ? mySessionWhoHtml(row) : `
        <div class="group-title">Réagir</div>
        <div class="group group--pad social-session__react">${reactionRowHtml(row)}</div>`}
        ${commentsGroupHtml(row.owner, row.id)}
        ${mine ? '' : `
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="social-report" data-uid="${esc(row.owner)}" data-ref="${esc(row.id)}">Signaler cette séance</button>
        </div>`}
        ${vol > 0 ? '<div class="group-foot">Volume = charge notée × reps, sans l\'échauffement, poids du corps non compté (lest compris).</div>' : ''}
      </div>
    </div>`;
}
// Ma séance vue par mes abonnés : qui a réagi
function mySessionWhoHtml(row) {
  const list = whoListHtml(row.id, row.bravos);
  return `
        <div class="group-title">Réactions${row.bravos ? ` (${row.bravos})` : ''}</div>
        <div class="group who-list">${list || '<div class="cell"><span class="cell__sub social-empty">Aucune réaction pour l\'instant.</span></div>'}</div>`;
}
SCREENS.set('social-session', {
  render: (owner, id) => renderSocialSession(owner, id),
  // Séance d'un ami : ses séances visibles (fil de son profil) chargées pour savoir si un record est
  // vraiment battu. La mienne : qui a réagi. Les deux : commentaires (js/features/comments-ui.js).
  mount: () => { const el = $('#commentInput'); if (el) fitCommentInput(el); },
  enter: () => {
    const [owner, id] = routeParams(currentRoute());
    if (owner && id) commentsLoad(owner, id);
    if (owner && owner === social.userId) { if (id) socialLoadWho(id); return; }
    if (owner && socialFeedNeedsLoad(owner)) socialLoadFeed(owner);
  },
});

// ── Profil d'un autre ───────────────────────────────────────

function renderSocialProfile(uid) {
  const p = socialPerson(uid) || {};
  const rel = socialRelation(uid, social.state);
  const name = personName(p);
  const sub = { following: rel.followsYou ? 'Vous vous suivez' : 'Abonné', requested: 'Demande envoyée', blocked: 'Bloqué' }[rel.status]
    || (rel.followsYou ? 'Te suit' : '');
  const main = {
    none: `<button class="btn btn--primary btn--full" data-action="social-follow" data-uid="${esc(uid)}">S'abonner</button>`,
    requested: `<button class="btn btn--secondary btn--full" data-action="social-cancel" data-uid="${esc(uid)}">Annuler la demande</button>`,
    following: `<button class="btn btn--secondary btn--full" data-action="social-unfollow" data-uid="${esc(uid)}">Se désabonner</button>`,
    blocked: `<button class="btn btn--secondary btn--full" data-action="social-unblock" data-uid="${esc(uid)}">Débloquer</button>`,
  }[rel.status] || '';
  const incoming = rel.pendingIn && rel.status !== 'blocked' ? `
        <div class="group social-incoming">
          <div class="cell"><span class="cell__body"><span class="cell__title">Veut voir tes séances</span></span>
            ${pill('social-accept', uid, 'Accepter', { fill: true })}
            <button class="social-x" data-action="social-refuse" data-uid="${esc(uid)}" aria-label="Refuser la demande">${icon('xmark', 14)}</button>
          </div>
        </div>` : '';
  const sessions = rel.status === 'following'
    ? `<div class="group-title">Séances</div>${feedListHtml(uid, { owner: false, empty: 'Aucune séance visible pour l\'instant.' })}`
    : rel.status === 'blocked' ? ''
    : `<div class="empty-note social-profile__locked">${rel.status === 'requested' ? 'Ses séances s\'afficheront ici quand ta demande sera acceptée.' : 'Abonne-toi pour voir ses séances, une fois ta demande acceptée.'}</div>`;
  return `
    <div class="view view--grouped social-profile-view">
      ${navBar({ title: esc(name), large: false })}
      <div class="scr">
        ${reactHintHtml()}
        <div class="account-hero">
          ${personAvatar(p, 'xl')}
          <h2 class="account-hero__name">${esc(name)}</h2>
          ${sub ? `<p class="account-hero__sub">${sub}</p>` : ''}
        </div>
        ${incoming}
        <div class="social-profile__action">${main}</div>
        ${sessions}
        ${rel.status === 'blocked' ? '' : `
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="social-block" data-uid="${esc(uid)}">Bloquer</button>
          <button class="cell cell--destructive" data-action="social-report" data-uid="${esc(uid)}">Signaler</button>
        </div>
        <div class="group-foot">Bloquer coupe tout dans les deux sens : recherche, demandes, séances et réactions. Personne n'en est averti.</div>`}
      </div>
    </div>`;
}
// Profil affiché d'une personne que je suis (ses séances se chargent), sinon null
function followedProfileShown() {
  const uid = routeParams(currentRoute())[0];
  return uid && socialRelation(uid, social.state).status === 'following' ? uid : null;
}
SCREENS.set('social-profile', {
  render: uid => renderSocialProfile(uid),
  // Ses séances : chargées à l'arrivée si je le suis
  enter: () => {
    const uid = followedProfileShown();
    if (uid && !socialFeed(uid).loadedAt) socialLoadFeed(uid);
  },
});

// ── Gérer ───────────────────────────────────────────────────

function renderSocialManage() {
  const st = social.state || cleanSocialState({});
  const section = (title, list, trailing, empty) => `
        <div class="group-title">${title}${list.length ? ` (${list.length})` : ''}</div>
        <div class="group">${list.length ? list.map(p => personRowHtml(p, trailing(p))).join('') : `<div class="cell"><span class="cell__sub social-empty">${empty}</span></div>`}</div>`;
  // Abonnés et Abonnements : dans Mon profil (js/features/social-me-ui.js)
  return `
    <div class="view view--grouped social-manage-view">
      ${navBar({ title: 'Gérer', large: false })}
      <div class="scr">
        ${section('Demandes envoyées', st.requested, p => pill('social-cancel', p.user_id, 'Annuler', { aria: `Annuler la demande à ${personName(p)}` }), 'Aucune')}
        ${section('Bloqués', st.blocked, p => pill('social-unblock', p.user_id, 'Débloquer', { aria: `Débloquer ${personName(p)}` }), 'Personne')}
        <div class="group group--gap">
          <button class="cell cell--action" data-action="social-rules"><span class="cell__title">Règles de la communauté</span></button>
        </div>
        <div class="group">
          <button class="cell cell--destructive" data-action="social-disable">Désactiver le social</button>
        </div>
        <div class="group-foot">Tu disparais de la recherche et tes abonnés ne voient plus tes séances. Tes abonnés et abonnements sont gardés si tu réactives.</div>
      </div>
    </div>`;
}
SCREENS.set('social-manage', { render: () => renderSocialManage(), enter: () => { socialRefresh(); } });

// ── Règles de la communauté (mêmes règles que privacy.html#communaute) ──

function renderSocialRules() {
  const rules = [
    ['Respecte les autres', 'Pas d\'insulte, de moquerie ni de harcèlement.'],
    ['Rien de choquant', 'Pas de contenu sexuel, violent ou haineux, pseudos et noms de séances compris.'],
    ['Pas de spam', 'Ni publicité, ni demandes en masse.'],
    ['Sois toi-même', 'Un compte par personne, sans te faire passer pour quelqu\'un d\'autre.'],
    ['15 ans ou plus', 'Les amis sont réservés aux 15 ans et plus.'],
  ];
  return `
    <div class="view view--grouped social-rules-view">
      ${navBar({ title: 'Règles', large: false })}
      <div class="scr">
        <h1 class="scr-title">Règles de la communauté</h1>
        <div class="group">${rules.map(([t, d]) => `
          <div class="cell"><span class="cell__body"><span class="cell__title">${t}</span><span class="cell__sub">${d}</span></span></div>`).join('')}
        </div>
        <div class="group-foot">Chaque signalement est lu sous 24 heures. Un contenu contraire aux règles est retiré, et son auteur peut perdre son compte. Contact : contact@mdlf.app. <button class="link-inline" data-action="social-rules-web">Confidentialité</button></div>
      </div>
    </div>`;
}
SCREENS.set('social-rules', { render: () => renderSocialRules() });

// ── Visible sur mon profil : bilan, Historique › Séance et liste de l'Historique ──
// Un seul réglage par séance, le même libellé partout : allumé = visible (champ hidden absent),
// éteint = hidden: true (docs/SOCIAL_V1.md). La synchro l'envoie tel quel ; le coach voit tout.
// Réglages › Amis et coach › Séances visibles par défaut (sessionVisibleDefault, js/data/social.js) préremplit
// l'interrupteur du bilan pour les séances à venir ; les séances déjà faites ne changent pas.

// Cellule des Réglages, seulement quand Amis est activé (sans Amis, rien à montrer à personne)
function socialDefaultVisibleCell() {
  if (!socialEnabled()) return '';
  const on = sessionsVisibleByDefault();
  return `
          <button class="cell" data-action="setting-visible-default" role="switch" aria-checked="${on}">
            <span class="cell__body"><span class="cell__title">Séances visibles par défaut</span>
              <span class="cell__sub">Préremplit « Visible sur mon profil » au bilan de chaque séance</span></span>
            ${switchHtml(on)}
          </button>`;
}

// Bascule visible ↔ masquée, enregistrée (la synchro part de save, js/data/account.js). Renvoie la séance.
function toggleSessionHidden(id) {
  const h = (data.history || []).find(x => x.id === id);
  if (!h) return null;
  if (h.hidden) delete h.hidden; else h.hidden = true;
  haptic();
  save();
  return h;
}

// Bilan de fin de séance (js/features/summary.js) : seulement quand le social est activé
function summarySocialGroup(h) {
  if (!h || !socialEnabled()) return '';
  const on = h.hidden !== true;
  return `
        <div class="sum-section-title">Amis</div>
        <div class="sum-list">
          <button class="sum-row sum-row--action" data-action="summary-visible" data-id="${esc(h.id)}" role="switch" aria-checked="${on}">
            <div class="sum-row__main"><div class="sum-row__name">Visible sur mon profil</div><div class="sum-row__sub">Tes abonnés verront cette séance (jamais tes notes ni ton poids).</div></div>
            ${switchHtml(on)}
          </button>
        </div>`;
}

// Liste de l'Historique : œil barré discret sur une séance masquée (social activé : sinon rien à masquer)
function historyHiddenMark(h) {
  if (h.hidden !== true || !socialEnabled()) return '';
  return `<span class="hidden-mark" role="img" aria-label="Masquée à tes abonnés">${icon('eye.slash', 14)}</span>`;
}

// Groupe ajouté au détail d'une séance (js/features/history.js) quand le social est activé
function historySocialGroup(h) {
  if (!socialEnabled()) return '';
  // Masquée : les réactions déjà reçues restent, mais plus personne ne la voit (le serveur refuse les nouvelles)
  const hidden = h.hidden === true;
  return `
        <div class="group-title">Amis</div>
        <div class="group">
          <button class="cell" data-action="history-hide" data-id="${esc(h.id)}" role="switch" aria-checked="${!hidden}">
            <span class="cell__body"><span class="cell__title">Visible sur mon profil</span></span>
            ${switchHtml(!hidden)}
          </button>
        </div>
        <div class="group-foot">${hidden ? 'Tes abonnés ne voient pas cette séance.'
          : 'Tes abonnés voient le nom, la date, la durée et les séries. Jamais tes notes ni ton poids.'}</div>
        ${historyWhoHtml(h)}
        ${historyCommentsHtml(h)}`;
}

// ── Flux d'actions ──────────────────────────────────────────

function socialToast(r, okText) {
  if (r.ok) { if (okText) showToast(okText); return true; }
  showToast(socialErrorText(r.kind), { error: true });
  return false;
}

// Signalement : motif, détails facultatifs (« Autre chose »), puis proposition de bloquer (profil)
async function reportFlow(uid, ref) {
  const name = personName(socialPerson(uid));
  const reason = await dialog({ type: 'sheet', title: ref ? 'Signaler cette séance' : `Signaler ${name}`,
    message: `Pourquoi ? ${name} ne saura pas que c'est toi.`,
    actions: [...REPORT_REASONS.map(r => ({ label: r.label, value: r.reason })), { label: 'Annuler', style: 'cancel' }] });
  if (!reason) return;
  let details = '';
  if (reason === 'autre') {
    const t = await dialog({ title: 'Que se passe-t-il ?', message: 'Quelques mots pour nous aider (facultatif).',
      input: { value: '', placeholder: 'Détails', text: true },
      actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Envoyer', style: 'preferred' }] });
    if (t === null) return;
    details = t;
  }
  const r = await socialReport({ target: uid, kind: ref ? 'session' : 'profile', ref, reason, details });
  if (!socialToast(r)) return;
  haptic();
  const block = await dialog({ title: 'Signalement envoyé', message: `Merci. Il sera traité sous 24 heures. Tu peux aussi bloquer ${name}.`,
    actions: [{ label: 'Bloquer', value: true, style: 'destructive' }, { label: 'OK', style: 'preferred' }] });
  if (block === true) await blockFlow(uid, { confirm: false });
}

async function blockFlow(uid, { confirm = true } = {}) {
  const name = personName(socialPerson(uid));
  if (confirm && !(await confirmSheet(`Bloquer ${name} ?`, `${name} ne pourra plus te trouver ni voir tes séances, et tu ne verras plus les siennes. Vos abonnements sont retirés. Personne n'en est averti.`, 'Bloquer'))) return;
  const r = await socialBlock(uid);
  if (!socialToast(r, `${name} bloqué`)) return;
  if (currentView() === 'social-session') goBack();
  render();
}

registerActions({
  'go-friends': (e, el) => { if (el.closest('.tabbar')) switchTab('friends'); else routeTo('friends'); },
  'social-sign-in': () => navigate('account'),
  'social-choose-username': async () => { await openAuthFlow({ step: 'username', mode: 'profile' }); },
  'social-age': () => { socialAgeOk = !socialAgeOk; haptic(); render(); },
  'social-rules': () => navigate('social-rules'),
  'social-rules-web': () => { window.open(RULES_URL, '_blank'); },
  'social-manage': () => navigate('social-manage'),
  'social-retry': async () => {
    if (normalizeSocialQuery(socialQuery)) { socialResults = null; runSocialSearch(); }
    await socialRefresh();
    if (socialEnabled()) socialLoadFeed(currentView() === 'social-profile' ? routeParams(currentRoute())[0] : '');
  },
  'social-enable': async (e, el) => {
    if (!account.profile?.username || !socialAgeOk) return;
    el.disabled = true;
    const r = await socialEnable(true);
    if (!socialToast(r)) { el.disabled = false; return; }
    haptic();
    socialLoadFeed('');
    render();
  },
  'social-disable': async () => {
    if (!(await confirmSheet('Désactiver le social ?', 'Tu disparais de la recherche et tes abonnés ne voient plus tes séances. Tes abonnés et abonnements sont gardés si tu réactives.', 'Désactiver'))) return;
    const r = await socialDisable();
    if (!socialToast(r, 'Social désactivé')) return;
    socialAgeOk = false;
    routeTo('friends');
  },
  'social-open-profile': (e, el) => {
    const route = makeRoute('social-profile', el.dataset.uid);
    if (currentRoute() !== route) navigate(route);
  },
  'social-open-session': (e, el) => navigate(makeRoute('social-session', el.dataset.owner, el.dataset.id)),
  'social-more': (e, el) => { socialLoadFeed(el.dataset.key || '', { more: true }); },
  'social-follow': async (e, el) => {
    el.disabled = true;
    const r = await socialRequestFollow(el.dataset.uid);
    socialToast(r);
    if (currentView() === 'friends') refreshFriendsBody(); else render();
  },
  'social-cancel': async (e, el) => {
    const r = await socialCancelFollow(el.dataset.uid);
    socialToast(r, 'Demande annulée');
    render();
  },
  'social-unfollow': async (e, el) => {
    const name = personName(socialPerson(el.dataset.uid));
    if (!(await confirmSheet(`Se désabonner de ${name} ?`, 'Ses séances ne seront plus dans ton fil. Pour le suivre à nouveau, il faudra une nouvelle demande.', 'Se désabonner'))) return;
    const r = await socialCancelFollow(el.dataset.uid);
    socialToast(r);
    render();
  },
  'social-accept': async (e, el) => {
    el.disabled = true;
    const r = await socialRespond(el.dataset.uid, true);
    if (socialToast(r, `${personName(socialPerson(el.dataset.uid))} peut voir tes séances`)) haptic();
    render();
  },
  'social-refuse': async (e, el) => {
    const r = await socialRespond(el.dataset.uid, false);
    socialToast(r, 'Demande refusée');
    render();
  },
  'social-remove-follower': async (e, el) => {
    const name = personName(socialPerson(el.dataset.uid));
    if (!(await confirmSheet(`Retirer ${name} ?`, `${name} ne verra plus tes séances. Personne n'en est averti.`, 'Retirer'))) return;
    const r = await socialRemoveFollower(el.dataset.uid);
    socialToast(r);
    render();
  },
  'social-block': async (e, el) => { await blockFlow(el.dataset.uid); },
  'social-unblock': async (e, el) => {
    const r = await socialUnblock(el.dataset.uid);
    socialToast(r, `${personName(socialPerson(el.dataset.uid))} débloqué`);
    render();
  },
  'social-report': async (e, el) => { await reportFlow(el.dataset.uid, el.dataset.ref || null); },
  'history-hide': (e, el) => {
    if (toggleSessionHidden(el.dataset.id)) render();
  },
  'setting-visible-default': () => {
    data.sessionVisibleDefault = !sessionsVisibleByDefault();
    save(); render();
  },
  // Bilan : l'interrupteur change sur place (pas de redessin : les notes en cours et le défilement restent)
  'summary-visible': (e, el) => {
    const h = toggleSessionHidden(el.dataset.id);
    if (!h) return;
    const on = h.hidden !== true;
    el.setAttribute('aria-checked', String(on));
    el.querySelector('.switch')?.classList.toggle('switch--on', on);
  },
});

// Recherche au fil de la frappe
document.addEventListener('input', e => {
  if (e.target.id !== 'socialSearch') return;
  socialQuery = e.target.value;
  runSocialSearch();
});

// ── Mises à jour de l'écran ─────────────────────────────────

let historyReactionsShown = null;   // réactions reçues au dernier dessin de la liste de l'Historique
// État reçu, fil chargé, réaction : badge, puis l'écran affiché. Onglet Amis au même état : seule la zone
// sous la recherche est redessinée (le champ garde le clavier) ; sinon redessin complet
onSocialChange(() => {
  updateTabBadge();
  const v = currentView();
  // Fil affiché jamais chargé (hors ligne au premier passage, ou Amis activé connu après l'ouverture) :
  // chargé maintenant ; son début de chargement notifie et redessine l'écran
  const feedKey = v === 'friends' ? '' : v === 'social-profile' ? followedProfileShown() : v === 'social-me' ? SOCIAL_ME : null;
  if (feedKey != null && socialFeedNeedsLoad(feedKey)) { socialLoadFeed(feedKey); return; }
  if (v === 'friends' && friendsState() === friendsShown) { refreshFriendsBody(); refreshMeButton(); return; }
  // Liste de l'Historique : redessinée seulement si les réactions reçues ont changé (« 👏 2 »)
  if (v === 'history') { if (social.reactions !== historyReactionsShown) { historyReactionsShown = social.reactions; refreshHistoryList(); } return; }
  if (!SOCIAL_VIEWS.includes(v) && v !== 'history-detail') return;
  if (document.activeElement?.matches?.('#socialSearch')) { refreshFriendsBody(); return; }
  // Commentaire en cours de saisie : la liste seule (js/features/comments-ui.js), le clavier reste
  if (document.activeElement?.matches?.('#commentInput') && refreshCommentsList()) return;
  render();
});
// Pseudo choisi, connexion, déconnexion : la carte d'activation et l'onglet changent de forme
let socialAccountKey = null;
onAccountChange(() => {
  const key = JSON.stringify([account.ready, account.user?.id, account.profile?.username, account.profile?.avatar]);
  if (key === socialAccountKey) return;
  socialAccountKey = key;
  updateTabBadge();
  if (SOCIAL_VIEWS.includes(currentView())) render();
});
