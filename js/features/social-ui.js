// ═══════════════════════════════════════════════════════════
//  Social (Social V1, refait en V2 : docs/SOCIAL_V2.md), écrans : onglet Social (sans compte, activation,
//  puis recherche, demandes et fil ; compte coach : onglet « Coach » à deux segments, Élèves et Social), séance
//  d'un ami (détail des séries, réactions, Signaler) ou la mienne telle que mes abonnés la voient (qui a réagi),
//  profil d'un autre (Suivre, annuler la demande, Ne plus suivre, Bloquer, Signaler), Gérer (demandes
//  envoyées, bloqués, Désactiver le social), règles de la communauté, et dans Historique › Séance : « Visible
//  sur mon profil », qui a réagi et les commentaires.
//  Commentaires : js/features/comments-ui.js.
//  Réactions : js/features/reactions-ui.js ; Mon profil, Abonnés, Abonnements : js/features/social-me-ui.js.
//  Élèves du coach : js/features/coach-ui.js (coachTeamHtml).
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
let friendsLayout = null;      // forme de l'onglet au dernier dessin complet (friendsLayoutKey)
let socialSeg = 'students';    // compte coach : segment affiché, Élèves (à l'ouverture de l'app), Messages ou Mes amis
const SOCIAL_SEGS = ['students', 'messages', 'friends'];
let socialScrollComments = false;   // « Commenter » d'une carte : la séance s'ouvre sur ses commentaires

// ── Petits gabarits ─────────────────────────────────────────

// personName (pseudo, ou « Compte masqué ») : js/data/social.js
// Pseudo (ou nom) à afficher en HTML : coupure possible après « _ », « . » et « - » (« camille_ / coach ») plutôt
// qu'au milieu d'un mot en très grand texte ; jamais rogné
function nameBreakHtml(text) { return esc(text).replace(/([._-])/g, '$1<wbr>'); }
function personAvatar(p, size = 'm') { return avatarHtml(size, p?.avatar, p?.username || '?', p?.user_id || p?.owner || null); }
// Couleur d'une séance d'un programme intégré ; séance perso d'un autre : gris neutre
function publicSessionColor(s) { return PROGRAMMES[s.programme]?.sessions?.[s.category]?.color || 'var(--label3)'; }
function seriesCount(s) { return s.exercises.reduce((a, e) => a + workSets(e.sets).length, 0); }   // sans l'échauffement
function publicMetaLine(s) {
  const parts = [];
  if (s.duration) parts.push(fmtDuration(s.duration));
  parts.push(plural(s.exercises.length, 'exercice', 'exercices'));
  return parts.join(' · ');
}
// État de l'onglet : 'unavailable' (navigateur), 'age' (masqué par la tranche d'âge partagée par Apple,
// js/data/age-range.js), 'out' (sans compte), 'loading', 'error', 'off', 'on'
function friendsState() {
  if (!accountAvailable()) return 'unavailable';
  if (socialHiddenByAge()) return 'age';
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
// le fil ne contient qu'une partie de ses séances), en or, et combien d'autres (« +1 », lu « plus 1 »).
// « Record · Squat 125 kg +1 », derrière la médaille au trait (js/ui/medal.js), jamais un emoji
function feedRecordHtml(s) {
  const r = topNotedRecord(s.records);
  if (!r) return '';
  const more = (s.records?.length || 0) - 1;
  return `<span class="feed-card__rec">${medalSvg(18)}<span>Record · <span class="num">${esc(notedFeedTxt(r))}</span>${more > 0 ? `<span class="feed-card__rec-more num"> +${more}</span>` : ''}</span></span>`;
}
// « 1 560 kg » : l'unité en plus petit, comme au bilan (le volume en kg entiers dépassait d'une case sur Android, 26/11)
function statUnitHtml(v) { return esc(v).replace(/(\d)[\s\u00a0]((?:kg|lbs))$/, '$1<span class="stat-unit">\u00a0$2</span>'); }
// Les trois chiffres de la carte : durée, volume, séries (sans l'échauffement) ; un chiffre absent est omis. Même ordre et
// même style (valeur, puis libellé dessous, avec une capitale) dans la séance d'un ami, Mon profil et le bilan (vague 3)
function feedStatsHtml(s) {
  const vol = reviewVolume(s.exercises), n = seriesCount(s);
  const stats = [s.duration ? [fmtDuration(s.duration), 'Durée'] : null, vol > 0 ? [fmtVolume(vol), 'Volume'] : null,
    [String(n), n > 1 ? 'Séries' : 'Série']].filter(Boolean);
  return `<span class="feed-card__stats">${stats.map(([v, l]) => `<span class="feed-card__stat"><span class="feed-card__stat-val num">${statUnitHtml(v)}</span><span class="feed-card__stat-lbl">${l}</span></span>`).join('')}</span>`;
}
// Muscles : puces pour l'œil, une phrase pour VoiceOver (hors d'un bouton, aria-label sur un span ne serait pas lu)
function feedMusclesHtml(s) {
  const m = feedMuscles(s);
  return m.length ? `<span class="feed-card__muscles"><span class="sr-text">${esc(`Muscles : ${m.join(', ')}`)}</span>${m.map(x => `<span class="feed-card__chip" aria-hidden="true">${esc(x)}</span>`).join('')}</span>` : '';
}

// Vignette 3D du groupe le plus travaillé d'une séance reçue (ami, élève) : mainGroupOf (js/features/progress-muscles.js)
// sur ses exercices, avec un index vide : mes propres choix de muscles ne s'appliquent pas aux exercices des autres
// (bibliothèque et règles du nom seulement). Rien de nouveau n'est montré : les exercices sont déjà dans la séance
// reçue. null sans groupe reconnu.
const OTHERS_MUSCLES_INDEX = new Map();
function sessionGroupOf(exercises) { return mainGroupOf(exercises, OTHERS_MUSCLES_INDEX); }

// Carte du fil, illustrée comme l'Historique : qui et quand (vers son profil), puis la séance (vers le détail des
// séries, au premier toucher) : nom à gauche, vignette du groupe travaillé à droite (décorative) ; puis le résumé
// (muscles, les trois chiffres, le record en or), zone du double toucher « J'aime » qui n'ouvre rien
// (js/features/reactions-ui.js, décision du 17/11) ; puis réagir et Commenter (la séance, sur ses commentaires).
// Ma séance (Mon profil) : le résumé des réactions seulement, pas de double toucher.
// owner : false sur l'écran du profil (la personne est déjà nommée), la date passe alors sous le nom de séance.
// Texte agrandi : plus de vignette (css/muscles.css), le texte prend toute la largeur.
function feedCardHtml(row, { owner = true } = {}) {
  const s = row.s, p = { user_id: row.owner, username: row.username, avatar: row.avatar };
  const mine = row.owner === social.userId;
  const art = progThumbHtml(sessionGroupOf(s.exercises), 'feed-card__img');
  return `
    <article class="feed-card" data-owner="${esc(row.owner)}" data-id="${esc(row.id)}">
      ${owner ? `<button class="feed-card__who" data-action="social-open-profile" data-uid="${esc(row.owner)}">
        ${personAvatar(p)}<span class="feed-card__who-text"><span class="feed-card__name">${esc(personName(p))}</span><span class="feed-card__date">${esc(fmtAgo(row.doneAt))}</span></span>
      </button>` : ''}
      <button class="feed-card__main" data-action="social-open-session" data-owner="${esc(row.owner)}" data-id="${esc(row.id)}">
        <span class="feed-card__head${art ? '' : ' feed-card__head--noart'}">
          <span class="feed-card__text">
            <span class="feed-card__title"><span class="feed-card__label">${esc(s.label)}</span>${owner ? '' : `<span class="feed-card__date">${fmtDate(row.doneAt)}</span>`}</span>
          </span>
          ${art}
        </span>
      </button>
      <div class="feed-card__sum"${likeZoneAttrs(row, mine)}>
        ${feedMusclesHtml(s)}
        ${feedStatsHtml(s)}
        ${feedRecordHtml(s)}
      </div>
      <div class="feed-card__foot">${mine
        ? `<span class="react-own">${reactionsSummary(row.reactions) ? reactionsSummaryHtml(row.reactions) : '<span class="react-own__none">Aucune réaction</span>'}</span>`
        : reactionBarHtml(row)}
        <button class="feed-card__comment" data-action="social-open-comments" data-owner="${esc(row.owner)}" data-id="${esc(row.id)}" aria-label="${esc(`Commenter la séance ${s.label} de ${personName(p)}`)}">${icon('bubble.left', 20)}<span aria-hidden="true">Commenter</span></button>
      </div>
    </article>`;
}

// Liste de cartes d'un fil (fil principal '' ou profil), « Afficher plus », chargement, hors ligne
// quiet : pas de note « fil pas à jour » (une note au-dessus le dit déjà)
function feedListHtml(key, { owner = true, empty, quiet = false }) {
  const f = socialFeed(key);
  const cards = f.rows.map(r => feedCardHtml(r, { owner })).join('');
  if (!f.rows.length) {
    if (f.loading || (!f.loadedAt && !f.error)) return '<div class="empty-note">Chargement…</div>';
    if (f.error) return offlineNote(f.error === 'offline' ? 'Pas d\'Internet. Les séances s\'afficheront quand le réseau reviendra.' : socialErrorText(f.error));
    return typeof empty === 'function' ? empty() : `<div class="empty-note">${empty}</div>`;
  }
  const more = !f.end ? `<button class="btn-more" data-action="social-more" data-key="${esc(key)}" ${f.loading ? 'disabled' : ''}>${f.loading ? 'Chargement…' : 'Afficher plus'}</button>` : '';
  return `${quiet ? '' : feedErrorNote(f.error)}<div class="feed">${cards}</div>${more}`;
}

// Note au-dessus d'un fil déjà affiché quand le rafraîchissement échoue (hors ligne ou erreur) : le fil et
// l'aperçu des séances de Mon profil (meSessionsHtml, js/features/social-me-ui.js) ; '' sans erreur
function feedErrorNote(error) {
  if (!error) return '';
  return `<p class="social-inline-error" role="status">${esc(error === 'offline' ? 'Pas d\'Internet : fil pas à jour.' : socialErrorText(error))}</p>`;
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

// ── Onglet Social (Coach pour un compte coach) ──────────────

// Compte coach : l'onglet s'appelle Coach et s'ouvre sur ses élèves (docs/SOCIAL_V2.md). Rôle connu par
// coach_state, sinon le dernier de l'appareil (coachRole) : le bon libellé dès le lancement.
function coachTabOn() { return accountAvailable() && !!account.user && coachRole().isCoach; }
// Nombre de « Mes amis » (demandes reçues, nouveautés du social, ce que mon propre coach m'envoie) : avec celui de
// « Messages », la somme est la pastille de l'onglet Coach (updateTabBadge, js/ui/navbar.js). Un nombre, une place
// (juges iPad du 26/11 : pastille 3, Messages 1, sans dire où étaient les 2 autres)
function friendsSegCountHtml() {
  const n = socialBadge() + (typeof coachBadgeStudent === 'function' ? coachBadgeStudent() : 0);
  return n ? ` <span class="seg-count num" aria-hidden="true">${n}</span><span class="visually-hidden">, ${plural(n, 'nouveauté', 'nouveautés')}</span>` : '';
}
function friendsTabMeta() { return coachTabOn() ? { label: 'Coach', icon: 'coach' } : { label: 'Social', icon: 'person.2' }; }
function friendsSeg() { return coachTabOn() ? socialSeg : 'friends'; }
// Forme de l'onglet : un changement (rôle, segment, état du social) demande un redessin complet
function friendsLayoutKey() { return `${coachTabOn()}:${friendsSeg()}:${friendsState()}`; }
function friendsLayoutChanged() { return friendsLayout !== friendsLayoutKey(); }

function renderFriends() {
  const st = friendsState(), seg = friendsSeg(), coachTab = coachTabOn();
  friendsShown = st;
  friendsLayout = friendsLayoutKey();
  const right = st === 'on' ? meButtonHtml() : '';
  // « Mes amis » plutôt que « Social » : la vie de pratiquant du coach, à part de ses élèves (panel v4 t1). Messages
  // (17/11, validé par Maxence) : toutes les conversations avec ses élèves, sans 6e onglet (iOS le rangerait dans « Plus »)
  const segs = coachTab ? `
        <div class="segmented seg-full social-seg" role="group" aria-label="Afficher">
          ${[['students', 'Élèves'], ['messages', 'Messages'], ['friends', 'Mes amis']].map(([k, l]) => `<button class="segmented__btn ${seg === k ? 'segmented__btn--active' : ''}" data-action="social-seg" data-seg="${k}" aria-pressed="${seg === k}">${l}${k === 'messages' ? chatSegCountHtml() : k === 'friends' ? friendsSegCountHtml() : ''}</button>`).join('')}
        </div>` : '';
  const body = seg === 'students'
    ? `<div id="studentsBody" class="coach-team">${coachTeamHtml()}</div>`
    : seg === 'messages' ? chatInboxScreenHtml()
    : `${reactHintHtml()}<div id="coachCell">${coachCellHtml()}</div>${st === 'on' ? searchHtml() : ''}<div id="friendsBody">${friendsBodyHtml(st)}</div>`;
  return `
    <div class="view view--grouped friends-view${coachTab ? ' friends-view--coach' : ''}">
      ${navBar({ title: tabMeta('friends').label, right })}
      <div class="scr">${segs}${body}</div>
    </div>`;
}
// Segment montré à la prochaine ouverture de l'onglet (compte coach) : Élèves après avoir retiré un élève,
// Social pour une demande d'abonnement reçue en notification
function setSocialSeg(seg) { socialSeg = SOCIAL_SEGS.includes(seg) ? seg : 'students'; }
function routeToStudents() { setSocialSeg('students'); routeTo('friends'); }
function searchHtml() {
  return `
        <div class="social-search">
          <span class="social-search__icon" aria-hidden="true">${icon('magnifyingglass', 17)}</span>
          <input type="search" id="socialSearch" maxlength="${SEARCH_MAX}" class="search social-search__input" placeholder="Pseudo" value="${esc(socialQuery)}"
                 autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Rechercher un pseudo">
        </div>`;
}

function friendsBodyHtml(st = friendsState()) {
  if (st === 'unavailable') return `
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Entraîne-toi avec tes amis</h2>
          <p class="social-hero__sub">${PT.socialUnavailable}</p>
        </div>`;
  if (st === 'out') return `
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Entraîne-toi avec tes amis</h2>
          <p class="social-hero__sub">Suis les séances de tes amis et <span class="nowrap">réagis-y</span>. Il faut un compte gratuit.</p>
        </div>
        <button class="btn btn--primary btn--full" data-action="social-sign-in">Se connecter</button>`;
  if (st === 'age') return ageHiddenHtml();
  if (st === 'loading') return '<div class="empty-note">Chargement…</div>';
  // Hors ligne : le gabarit des autres états vides (titre, texte, action), pas une ligne grise (panel v4 t1)
  if (st === 'error') return social.error === 'offline' ? `
        <div class="social-hero" role="status">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Pas de connexion</h2>
          <p class="social-hero__sub">Reconnecte-toi au réseau pour voir les séances des personnes que tu suis.</p>
        </div>
        <button class="btn btn--secondary btn--full" data-action="social-retry">Réessayer</button>` : offlineNote(socialErrorText(social.error));
  if (st === 'off') return activationHtml();
  return enabledBodyHtml();
}

// Social masqué par la tranche d'âge : explication sobre, sans bouton (le coach reste au-dessus)
function ageHiddenHtml() {
  const why = currentAgeBand() === 'limited'
    ? `Le contrôle parental de ${thisPhone()} limite les échanges : le social n'est pas disponible.`
    : 'Le social est réservé aux 15 ans et plus, d\'après la tranche d\'âge partagée avec Apple.';
  return `
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Social indisponible</h2>
          <p class="social-hero__sub">${why} Le reste de l'app fonctionne normalement.</p>
        </div>
        <div class="group-foot">Si ta tranche d'âge a changé, mets-la à jour dans les Réglages ${ofThePhone()}, à ton nom.</div>`;
}

// Carte d'activation : pseudo obligatoire, âge déclaré, règles, puis « Activer ». Élève d'un coach : les amis
// sont en plus, pas l'étape suivante (panel du 07/11 : le gros « Activer » bleu passait devant « Mon coach ») ;
// titre de groupe « Amis (facultatif) » et bouton secondaire « Ajouter aussi des amis »
function activationHtml() {
  const name = account.profile?.username;
  const ready = !!name && socialAgeOk;
  const coached = coachRole().hasCoach;
  const sub = 'Suis les séances de tes amis et <span class="nowrap">réagis-y</span>. Seules les personnes que tu acceptes voient les tiennes.';
  return `
        ${coached ? `<div class="group-title">Social (facultatif)</div>
        <p class="social-optional">${sub}</p>` : `
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Entraîne-toi avec tes amis</h2>
          <p class="social-hero__sub">${sub}</p>
        </div>`}
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
        <button class="btn ${coached ? 'btn--secondary' : 'btn--primary'} btn--full social-enable" data-action="social-enable" ${ready ? '' : 'disabled'}>${coached ? 'Ajouter aussi des amis' : 'Activer'}</button>
        <div class="group-foot">${name ? 'On te trouve avec ce pseudo.' : 'Il faut un pseudo pour qu\'on te trouve.'}${socialTeenByAge() ? ' Tes séances sont masquées par défaut. Tu choisis celles à montrer.' : ''} Tes notes, ton poids et tes données Santé ne sont jamais montrés à ceux qui te suivent.${coachRole().hasCoach ? ` ${myCoachWord('Ton')} voit en plus tes séances et leur note de séance, et ton poids si tu choisis de le partager.` : ''} <button class="link-inline" data-action="social-rules">Règles de la communauté</button></div>`;
}

function enabledBodyHtml() {
  const q = normalizeSocialQuery(socialQuery);
  if (q) return searchResultsHtml(q);
  const st = social.state;
  const pending = st?.pending_in || [];
  const requests = pending.length ? `
        <div class="group-title">Demandes d'ami</div>
        <div class="group">${pending.map(p => personRowHtml(p,
          pill('social-accept', p.user_id, 'Accepter', { fill: true, aria: `Accepter ${personName(p)} comme ami` })
          + `<button class="social-x" data-action="social-refuse" data-uid="${esc(p.user_id)}" aria-label="${esc(`Refuser ${personName(p)}`)}">${icon('xmark', 14)}</button>`,
          // Déjà mon élève : l'amitié est un lien à part, rien à accepter pour le suivi (juges du 26/11 : on croyait devoir
          // accepter son élève une deuxième fois)
          typeof coachStudent === 'function' && coachStudent(p.user_id) ? 'Déjà ton élève · demande d\'ami en plus' : '')).join('')}</div>` : '';
  // Hors ligne : un seul message (panel Apple du 08/11 : « demandes pas à jour » s'ajoutait au bloc « Pas d'Internet »
  // du fil vide, alors qu'aucune demande n'était affichée). Demandes affichées : la note les cite, et le fil aussi
  // s'il a des séances (sa propre note est alors tue) ; sans demande, le fil dit seul ce qu'il en est.
  const feed = socialFeed('');
  const stale = social.error && st && pending.length;
  const both = stale && feed.error && feed.rows.length;
  const note = stale ? `<p class="social-inline-error" role="status">${esc(social.error === 'offline' ? `Pas d'Internet : ${both ? 'demandes et fil pas à jour' : 'demandes pas à jour'}.` : socialErrorText(social.error))}</p>` : '';
  return `${note}${requests}
        ${feed.rows.length ? '<div class="group-title">Séances des personnes que tu suis</div>' : ''}
        ${feedListHtml('', { empty: feedEmptyHtml, quiet: !!both })}`;
}

// Fil vide : accueil chaleureux, l'action qui le remplit (inviter un ami) et la recherche juste au-dessus
function feedEmptyHtml() {
  const following = social.state?.following?.length || 0;
  const name = account.profile?.username;
  return `
        <div class="social-hero social-hero--empty">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">${following ? 'Pas encore de séance' : 'Aucune personne suivie'}</h2>
          <p class="social-hero__sub">${following
            ? 'Les séances des personnes que tu suis s\'afficheront ici, avec leurs records.'
            : `Invite un ami. Il te trouve avec ton pseudo${name ? ` <b>${esc(name)}</b>` : ''}.`}</p>
        </div>
        <button class="btn btn--primary btn--full" data-action="social-invite">${icon('square.and.arrow.up', 20)}<span>Inviter un ami</span></button>`;
}

function searchResultsHtml(q) {
  const r = socialResults;
  if (!r || r.q !== q) return '<div class="empty-note">Recherche…</div>';
  if (r.error) return offlineNote(r.error === 'offline' ? 'Pas d\'Internet : la recherche demande du réseau.' : socialErrorText(r.error));
  if (!r.rows.length) return `<div class="empty-note">Aucun pseudo ne commence par « ${esc(q)} ».</div>`;
  return `<div class="group social-results">${r.rows.map(p => {
    const rel = socialRelation(p.user_id, social.state).status;
    const status = rel === 'following' ? 'Suivi' : rel === 'requested' ? 'Demandé' : '';
    const trailing = status ? `<span class="social-status">${status}</span>`
      : pill('social-follow', p.user_id, 'Suivre', { fill: true, aria: `Suivre ${personName(p)}` });
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
  // Fenêtre d'iOS 26 au premier passage avec un compte (sans compte, rien à protéger) ; la réponse redessine
  // l'onglet (onAgeRangeChange)
  ageRangeCheck();
  // Segment Élèves (compte coach) : état, progression et palier ; sinon la cellule Mon coach (js/features/coach-ui.js),
  // indépendante du social. Social masqué par la tranche d'âge : les élèves d'un coach restent à jour
  if (friendsSeg() === 'students') coachTeamEnter();
  if (friendsSeg() === 'messages') { chatInboxEnter(); return; }
  if (socialHiddenByAge()) return;
  if (friendsSeg() !== 'students') coachRefresh({ minAge: SOCIAL_REFRESH_MS });
  await socialRefresh();
  if (socialEnabled() && Date.now() - socialFeed('').loadedAt > SOCIAL_REFRESH_MS) socialLoadFeed('');
}
SCREENS.set('friends', { render: () => renderFriends(), mount: () => { if (friendsSeg() === 'students') coachWatchMore(); if (friendsSeg() === 'messages') chatInboxWatchMore(); }, enter: () => { friendsEnter(); } });

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
  const s = row.s, p = { user_id: row.owner, username: row.username, avatar: row.avatar };
  const mine = row.owner === social.userId;
  let when = capitalize(fmtDate(row.doneAt, 'long'));
  if (s.duration) when += ` · ${fmtTime(row.doneAt)}`;
  const n = seriesCount(s), vol = reviewVolume(s.exercises), rec = friendRecord(row);
  return `
    <div class="view view--grouped social-session-view">
      ${navBar({ title: '' })}
      <div class="scr">
        ${mine ? `<p class="social-who social-who--me">${personAvatar(p)}<span class="social-who__name">Vue par ceux qui te suivent</span></p>`
          : `<button class="social-who" data-action="social-open-profile" data-uid="${esc(row.owner)}">${personAvatar(p)}<span class="social-who__name">${esc(personName(p))}</span></button>`}
        <h1 class="scr-title"><span class="hcell__dot hcell__dot--lg" style="background:${publicSessionColor(s)}" aria-hidden="true"></span>${esc(s.label)}</h1>
        <p class="scr-sub">${when}</p>
        <div class="tiles tiles--4 session-stats">
          <div class="tile"><span class="tile__val num">${s.duration ? fmtDuration(s.duration) : '—'}</span><span class="tile__lbl">Durée</span></div>
          <div class="tile"><span class="tile__val num">${vol > 0 ? fmtVolume(vol) : '—'}</span><span class="tile__lbl">Volume</span></div>
          <div class="tile"><span class="tile__val num">${n}</span><span class="tile__lbl">${n > 1 ? 'Séries' : 'Série'}</span></div>
          <div class="tile"><span class="tile__val num">${s.exercises.length}</span><span class="tile__lbl">${s.exercises.length > 1 ? 'Exercices' : 'Exercice'}</span></div>
        </div>
        ${rec ? `<div class="group social-session__rec">${notedRecordCell(rec, { before: false })}</div>` : ''}
        <div class="group-title">Exercices</div>
        <div class="group">
          ${s.exercises.map((e, i, xs) => `
            <div class="cell hex">
              <span class="cell__body">
                <span class="hex__name">${ssTagHtml(xs, i)}${esc(e.name)}</span>
                <span class="hex__sets num">${esc(sidePrefix(e, e.sets))}${setsLine(e.sets, e.measure || measureOf(e), reviewSetKind(e))}</span>
                ${warmupText(e.sets) ? `<span class="hex__sets hex__sets--note num">${esc(warmupText(e.sets))}</span>` : ''}
                ${techLinesHtml(e)}
                ${reviewGripHtml(e)}
              </span>
            </div>`).join('') || '<div class="cell"><span class="cell__sub">Aucun exercice</span></div>'}
        </div>
        ${mine ? mySessionWhoHtml(row) : `
        <div class="group-title">Réagir</div>
        <div class="group group--pad social-session__react">${reactionRowHtml(row)}</div>`}
        ${commentsGroupHtml(row.owner, row.id, { quick: !mine, record: !!rec })}
        ${mine ? '' : `
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="social-report" data-uid="${esc(row.owner)}" data-ref="${esc(row.id)}">Signaler cette séance</button>
        </div>`}
        ${vol > 0 ? '<div class="group-foot">Volume : charge × reps, hors échauffement. Le poids du corps ne compte pas, le lest oui.</div>' : ''}
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
const COMMENTS_ANCHOR_MS = 2000;
let commentsAnchorUntil = 0;
function scrollToComments() {
  const title = $('#commentsList')?.previousElementSibling;
  if (title) window.scrollTo(0, Math.max(0, title.getBoundingClientRect().top + window.scrollY - ($('.navbar')?.offsetHeight || 0) - 8));
}
['touchstart', 'wheel', 'keydown'].forEach(t => window.addEventListener(t, () => { commentsAnchorUntil = 0; }, { passive: true }));
SCREENS.set('social-session', {
  render: (owner, id) => renderSocialSession(owner, id),
  // Séance d'un ami : ses séances visibles (fil de son profil) chargées pour savoir si un record est
  // vraiment battu. La mienne : qui a réagi. Les deux : commentaires (js/features/comments-ui.js).
  // Ouverte par « Commenter » : les commentaires sous la barre de navigation, et ils y restent pendant que la
  // séance finit de se charger (record, réactions, commentaires : la page grandit au-dessus), jusqu'au
  // premier geste de défilement
  mount: () => { const el = $('#commentInput'); if (el) fitCommentInput(el); if (Date.now() < commentsAnchorUntil) scrollToComments(); },
  shown: () => {
    if (!socialScrollComments) return;
    socialScrollComments = false;
    commentsAnchorUntil = Date.now() + COMMENTS_ANCHOR_MS;
    scrollToComments();
  },
  leave: () => { commentsAnchorUntil = 0; },
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
  const sub = { following: rel.followsYou ? 'Vous vous suivez' : 'Suivi', requested: 'Demande envoyée', blocked: 'Bloqué' }[rel.status]
    || (rel.followsYou ? 'Te suit' : '');
  const main = {
    none: `<button class="btn btn--primary btn--full" data-action="social-follow" data-uid="${esc(uid)}">Suivre</button>`,
    requested: `<button class="btn btn--secondary btn--full" data-action="social-cancel" data-uid="${esc(uid)}">Annuler la demande</button>`,
    following: `<button class="btn btn--secondary btn--full" data-action="social-unfollow" data-uid="${esc(uid)}">Ne plus suivre</button>`,
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
    : `<div class="empty-note social-profile__locked">${rel.status === 'requested' ? 'Ses séances s\'afficheront ici quand ta demande sera acceptée.' : 'Suis cette personne pour voir ses séances, une fois ta demande acceptée.'}</div>`;
  return `
    <div class="view view--grouped social-profile-view">
      ${navBar({ title: esc(name), large: false })}
      <div class="scr">
        ${reactHintHtml()}
        <div class="account-hero">
          ${personAvatar({ ...p, user_id: uid }, 'xl')}
          <h2 class="account-hero__name">${esc(name)}</h2>
          ${sub ? `<p class="account-hero__sub">${sub}</p>` : ''}
          ${cardBadgeHtml(uid, 'card-badge--hero')}
        </div>
        ${incoming}
        <div class="social-profile__action">${main}</div>
        ${sessions}
        ${rel.status === 'blocked' ? '' : `
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="social-block" data-uid="${esc(uid)}">Bloquer</button>
          <button class="cell cell--destructive" data-action="social-report" data-uid="${esc(uid)}">Signaler</button>
          ${profilePhotoReportCellHtml(uid)}
          ${cardBadgeReportCell(uid)}
        </div>
        <div class="group-foot">Bloquer coupe tout contact dans les deux sens. Personne n'en est averti.</div>`}
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
  // Ses séances : chargées à l'arrivée si je le suis ; son badge carte pro s'il est coach (js/data/coach-pro.js)
  enter: () => {
    coachBadgeLoad(routeParams(currentRoute())[0]);
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
        ${st.blocked.length ? `<div class="group-foot">${unblockCoachText()}</div>` : ''}
        <div class="group group--gap">
          <button class="cell cell--action" data-action="social-rules"><span class="cell__title">Règles de la communauté</span></button>
        </div>
        <div class="group">
          <button class="cell cell--destructive" data-action="social-disable">Désactiver le social</button>
        </div>
        <div class="group-foot">Tu disparais de la recherche et tes séances sont masquées. Tes listes Suivis et Te suivent reviennent si tu réactives.</div>
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
    ['15 ans ou plus', 'Le social est réservé aux 15 ans et plus.'],
  ];
  return `
    <div class="view view--grouped social-rules-view">
      ${navBar({ title: 'Règles', large: false })}
      <div class="scr">
        <h1 class="scr-title">Règles de la communauté</h1>
        <div class="group">${rules.map(([t, d]) => `
          <div class="cell"><span class="cell__body"><span class="cell__title">${t}</span><span class="cell__sub">${d}</span></span></div>`).join('')}
        </div>
        <div class="group-foot">Chaque signalement est lu sous 24 heures. Un contenu contraire aux règles est retiré. Son auteur peut perdre son compte. Écris à contact@mdlf.app. <button class="link-inline" data-action="social-rules-web">Confidentialité</button></div>
      </div>
    </div>`;
}
SCREENS.set('social-rules', { render: () => renderSocialRules() });

// ── Visible sur mon profil : bilan, Historique › Séance et liste de l'Historique ──
// Un seul réglage par séance, le même libellé partout : allumé = visible (champ hidden absent),
// éteint = hidden: true (docs/SOCIAL_V1.md). La synchro l'envoie tel quel ; le coach voit tout.
// Réglages › Social et coach › Séances visibles par défaut (sessionVisibleDefault, js/data/social.js) préremplit
// l'interrupteur du bilan pour les séances à venir ; les séances déjà faites ne changent pas.

// Cellule des Réglages, seulement quand le social est activé (sinon, rien à montrer à personne)
function socialDefaultVisibleCell() {
  if (!socialEnabled()) return '';
  const on = sessionsVisibleByDefault();
  return `
          <button class="cell" data-action="setting-visible-default" role="switch" aria-checked="${on}">
            ${cellIco('eye', 'blue')}
            <span class="cell__body"><span class="cell__title">Séances visibles par défaut</span>
              <span class="cell__sub">Active « Visible sur mon profil » à chaque bilan</span></span>
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
        <div class="sum-section-title">Social</div>
        <div class="sum-list">
          <button class="sum-row sum-row--action" data-action="summary-visible" data-id="${esc(h.id)}" role="switch" aria-checked="${on}">
            <div class="sum-row__main"><div class="sum-row__name">Visible sur mon profil</div><div class="sum-row__sub">Ceux qui te suivent verront cette séance, sans tes notes ni ton poids.</div></div>
            ${switchHtml(on)}
          </button>
        </div>`;
}

// Liste de l'Historique : œil barré discret sur une séance masquée (social activé : sinon rien à masquer)
function historyHiddenMark(h) {
  if (h.hidden !== true || !socialEnabled()) return '';
  return `<span class="hidden-mark" role="img" aria-label="Masquée à ceux qui te suivent">${icon('eye.slash', 14)}</span>`;
}

// Groupe ajouté au détail d'une séance (js/features/history.js) quand le social est activé
function historySocialGroup(h) {
  if (!socialEnabled()) return '';
  // Masquée : les réactions déjà reçues restent, mais plus personne ne la voit (le serveur refuse les nouvelles)
  const hidden = h.hidden === true;
  return `
        <div class="group-title">Social</div>
        <div class="group">
          <button class="cell" data-action="history-hide" data-id="${esc(h.id)}" role="switch" aria-checked="${!hidden}">
            <span class="cell__body"><span class="cell__title">Visible sur mon profil</span></span>
            ${switchHtml(!hidden)}
          </button>
        </div>
        <div class="group-foot">${hidden ? 'Ceux qui te suivent ne voient pas cette séance.'
          : 'Ceux qui te suivent voient le nom, la date, la durée et les séries.'}</div>
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
      input: { value: '', placeholder: 'Détails', text: true, max: REPORT_DETAILS_MAX },   // ce que le serveur garde
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

// Lien coach avec cette personne (mon coach, ou un de mes élèves) : clé de la conversation à signaler, sinon null
function blockCoachKey(uid) {
  if (typeof myCoach === 'function' && myCoach()?.user_id === uid) return CHAT_COACH;
  if (typeof coach === 'object' && coach.state?.students?.some(s => s.user_id === uid)) return uid;
  return null;
}
// Bloquer son coach (ou son élève) coupe le suivi et efface la conversation (20261127010000_blocage_coupe_coach.sql) :
// on le dit, et on propose de signaler d'abord (report_chat joint les 50 derniers messages, gardés même après)
// Nom de la personne : celui du lien coach (le profil social peut être masqué)
function blockCoachName(uid, key) {
  const p = key === CHAT_COACH ? myCoach() : coach.state?.students?.find(s => s.user_id === uid);
  return p ? personName(p) : personName(socialPerson(uid));
}
async function blockCoachFlow(uid, key) {
  const name = blockCoachName(uid, key);
  const choice = await dialog({ type: 'sheet', title: `Bloquer ${name} ?`,
    message: `Bloquer efface votre conversation et coupe le suivi. Programmes, bilans et partages avec ${name} sont retirés. Pour garder une trace d'un problème, signale d'abord : les derniers messages sont joints au signalement. Personne n'est averti.`,
    actions: [{ label: 'Signaler d\'abord', value: 'report' }, { label: 'Bloquer', value: 'block', style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
  if (choice === 'report') {
    const reason = await dialog({ type: 'sheet', title: `Signaler ${name}`,
      message: `Pourquoi ? ${name} ne saura pas que c'est toi. Les 50 derniers messages sont joints pour l'équipe de modération, puis ${name} est bloqué.`,
      actions: [...REPORT_REASONS.map(x => ({ label: x.label, value: x.reason })), { label: 'Annuler', style: 'cancel' }] });
    if (!reason) return false;
    const r = await chatReport(key, reason);
    if (!r.ok) { showToast(r.kind === 'report_rate' ? socialErrorText(r.kind) : coachErrorText(r.kind), { error: true }); return false; }
    haptic();
    return true;
  }
  return choice === 'block';
}

// Débloquer ne rétablit pas un suivi coupé par le blocage (dit sous la liste des bloqués et après le déblocage) ;
// form : forme de ce coach si on la connaît (accord du texte)
function unblockCoachText(form = null) {
  return `Débloquer ne reprend pas un suivi. Pour reprendre avec ${coachWord('ce', form)}, rejoins-${coachWord('pron', form)} avec son code d'invitation. Ce qui a été effacé au blocage ne revient pas.`;
}
async function blockFlow(uid, { confirm = true } = {}) {
  const key = blockCoachKey(uid);
  const name = key ? blockCoachName(uid, key) : personName(socialPerson(uid));
  if (key) { if (!(await blockCoachFlow(uid, key))) return; }
  else if (confirm && !(await confirmSheet(`Bloquer ${name} ?`, `${name} ne pourra plus te trouver ni voir tes séances, et tu ne verras plus les siennes. Vous ne vous suivez plus. Personne n'en est averti.`, 'Bloquer'))) return;
  const r = await socialBlock(uid);
  if (!socialToast(r, key ? `${name} bloqué, suivi arrêté` : `${name} bloqué`)) return;
  // Lien coupé côté serveur : Mon coach (ou la liste des élèves) relu tout de suite
  if (key && typeof coachRefresh === 'function') coachRefresh();
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
    if (!(await confirmSheet('Désactiver le social ?', 'Tu disparais de la recherche et tes séances sont masquées. Tes listes Suivis et Te suivent reviennent si tu réactives.', 'Désactiver'))) return;
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
  // Commenter : la séance s'ouvre directement sur ses commentaires (le champ se touche ensuite : iOS n'ouvre
  // pas le clavier sur un focus hors du geste)
  'social-open-comments': (e, el) => { socialScrollComments = true; navigate(makeRoute('social-session', el.dataset.owner, el.dataset.id)); },
  // Compte coach : Élèves ou Social, en haut de l'onglet Coach ; chaque segment se recharge à l'arrivée
  'social-seg': (e, el) => {
    const seg = SOCIAL_SEGS.includes(el.dataset.seg) ? el.dataset.seg : 'students';
    if (seg === socialSeg) return;
    socialSeg = seg;
    haptic();
    render();
    window.scrollTo(0, 0);
    friendsEnter();
  },
  // Inviter un ami : feuille de partage d'iOS avec où me trouver ; hors app, partage du navigateur ou copie
  'social-invite': async () => {
    const text = friendInviteText(account.profile?.username || '');
    if (Native.isNative) { if ((await Native.shareText(text, 'Invitation')) === 'failed') showToast('Partage impossible', { error: true }); return; }
    if (navigator.share) { try { await navigator.share({ text }); } catch {} return; }
    try { await navigator.clipboard.writeText(text); showToast('Invitation copiée, colle-la dans un message'); }
    catch { showToast('Partage impossible', { error: true }); }
  },
  // Fil vide : le champ de recherche, juste au-dessus (focus dans le geste : le clavier s'ouvre)
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
    if (!(await confirmSheet(`Ne plus suivre ${name} ?`, 'Ses séances ne seront plus dans ton fil. Pour le suivre à nouveau, il faudra une nouvelle demande.', 'Ne plus suivre'))) return;
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
    if (socialToast(r)) {
      // Débloquer ne rétablit aucun suivi : on le dit
      await dialog({ title: `${personName(socialPerson(el.dataset.uid))} débloqué`, message: unblockCoachText(typeof coachFormOf === 'function' ? coachFormOf(el.dataset.uid) : null), actions: [{ label: 'OK', style: 'preferred' }] });
    }
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
// État reçu, fil chargé, réaction : badge, puis l'écran affiché. Onglet Social de même forme : seule la zone
// sous la recherche est redessinée (le champ garde le clavier) ; sinon redessin complet
onSocialChange(() => {
  socialDisableForAge();   // social activé lu alors que la tranche d'âge le masque
  updateTabBadge();
  const v = currentView();
  // Fil affiché jamais chargé (hors ligne au premier passage, ou social activé connu après l'ouverture) :
  // chargé maintenant ; son début de chargement notifie et redessine l'écran
  const feedKey = socialHiddenByAge() ? null : v === 'friends' ? '' : v === 'social-profile' ? followedProfileShown() : v === 'social-me' ? SOCIAL_ME : null;
  if (feedKey != null && socialFeedNeedsLoad(feedKey)) { socialLoadFeed(feedKey); return; }
  if (v === 'friends' && !friendsLayoutChanged()) { refreshFriendsBody(); refreshMeButton(); return; }
  // Liste de l'Historique : redessinée seulement si les réactions reçues ont changé (« 👏 2 »)
  if (v === 'history') { if (social.reactions !== historyReactionsShown) { historyReactionsShown = social.reactions; refreshHistoryList(); } return; }
  if (!SOCIAL_VIEWS.includes(v) && v !== 'history-detail') return;
  if (document.activeElement?.matches?.('#socialSearch')) { refreshFriendsBody(); return; }
  // Commentaire en cours de saisie : la liste seule (js/features/comments-ui.js), le clavier reste
  if (document.activeElement?.matches?.('#commentInput') && refreshCommentsList()) return;
  render();
});
// Tranche d'âge connue ou changée : social désactivé sur le serveur s'il est désormais masqué, badge et
// écrans du social redessinés
onAgeRangeChange(() => {
  socialDisableForAge();
  updateTabBadge();
  if (SOCIAL_VIEWS.includes(currentView())) render();
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
