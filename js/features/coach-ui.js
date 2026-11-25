// ═══════════════════════════════════════════════════════════
//  Coach (Coach V1), écrans. Contrat : docs/COACH_V1.md ; données et appels : js/data/coach.js.
//
//  - Onglet Social (pour tout le monde, même sans avoir activé le social) : « Mon coach » avec son badge, ou
//    « Rejoindre un coach », en haut (coachCellHtml, appelée par js/features/social-ui.js). Compte coach : l'onglet
//    s'appelle Coach et s'ouvre sur le segment Élèves (coachTeamHtml), docs/SOCIAL_V2.md.
//  - Réglages › Coach (`coach`) : même parcours (code, aperçu `coach-join:CODE`, « J'ai 15 ans ou plus »,
//    « Accepter »), le coach suivi et « Quitter mon coach », accès à « Mes élèves ».
//  - Élève : Mon coach (`coach-mine` : commentaires, programmes reçus avec aperçu des exercices), cartes de
//    l'accueil (programme reçu, commentaire), consignes dans Programme, Programme › Séance et la séance
//    (repliables), commentaire dans Historique (marque dans la liste, détail), notes vues du coach (bilan).
//  - Coach : Mes élèves (`coach-students` : signal de progression et tri, js/features/coach-progress-ui.js ;
//    nouvelles séances, invitations, élèves retirés), un élève (`coach-student:UID` : « 7 derniers jours » en tête,
//    séances, séries faites sur prévues, programmes envoyés pas encore utilisés),
//    une séance (`coach-session:UID:ID` : relecture comparée à ses séances reçues, exercices prévus non faits,
//    « Commenter »), envoi d'un programme avec consignes (`coach-send:UID:PROG`, brouillon gardé sur l'appareil).
//  Tout texte venu du serveur passe par esc() ; les pseudos passent par elide() (« d'essai »). Rien au
//  pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_VIEWS = ['coach', 'coach-join', 'coach-mine', 'coach-students', 'coach-student', 'coach-session', 'coach-send', 'coach-share', 'coach-chat', 'coach-request',
  'coach-plan', 'coach-planning', 'coach-measures', 'coach-measure', 'coach-photos', 'coach-photos-mine', 'coach-send-many'];
const COACH_SEND_DRAFT_KEY = 'mdlf_coach_send_draft';   // brouillon de l'écran Envoyer (retour arrière, relance)
const coachTipClosed = new Set();   // séance en cours : consignes repliées (identifiant d'exercice, '' : programme)
const coachProgOpen = new Set();    // Mon coach : programmes reçus dont les exercices sont dépliés
let coachSendDraft = null;          // écran d'envoi : { route, prog, ex: { [cat]: { [exId]: texte } }, presc: { [cat]: { [exId]: prescription } } }
let coachNoteDraft = null;          // commentaire pas envoyé (hors ligne) : { key, text }, repris à la réouverture
let coachInviteBusy = false;        // « Inviter un élève » : un seul code par toucher

// ── Petits gabarits ─────────────────────────────────────────

function coachName() { return personName(myCoach()); }
// État d'un programme reçu de mon coach actuel (js/data/coach.js : coachProgrammeStatus)
function coachStatus(item) { return coachProgrammeStatus(data, item, myCoach()?.user_id || null); }
function coachBadgeHtml(n, label) {
  return n ? `<span class="coach-count num" aria-hidden="true">${n}</span><span class="visually-hidden">, ${esc(label)}</span>` : '';
}
// Nouvelles séances d'un élève (ligne de Mes élèves) : haltère et nombre, « nouvelles » écrit dessous en petit (« à voir »
// était ambigu, « séances » doublait « 6 séances cette sem. » à côté : panels de la vague 3)
// (panel du 07/11 : « 3 » seul, à côté de « 6 séances cette sem. », ne disait pas ce qu'il comptait ; dessous,
// la pastille reste étroite et la ligne garde ses 3 lignes sur iPhone SE) ; le rouge reste aux
// comptes de l'onglet et de « Mes élèves »
function sessionsBadgeHtml(n) {
  return n ? `<span class="coach-count coach-count--sessions num" aria-hidden="true">${icon('dumbbell', 12)}${n}<span class="coach-count__sub">${n > 1 ? 'nouvelles séances' : 'nouvelle séance'}</span></span><span class="visually-hidden">, ${esc(plural(n, 'nouvelle séance à voir', 'nouvelles séances à voir'))}</span>` : '';
}
// « Push · ton programme · hier » (dernière séance d'un élève)
function studentLastLine(st) {
  const ls = st.last_session;
  if (!ls) return 'Pas encore de séance';
  const mine = coachOwnProgrammeName(ls.programme);
  return [ls.label, mine ? 'ton programme' : '', fmtDate(ls.done_at).toLowerCase()].filter(Boolean).join(' · ');
}
function coachOfflineNote(kind, what) {
  return `<div class="social-note" role="status"><p>${kind === 'offline' ? what : esc(coachErrorText(kind))}</p><button class="social-note__btn" data-action="coach-retry">Réessayer</button></div>`;
}
// Réussite : toast, ou seulement l'annonce VoiceOver quand l'écran montre déjà le résultat sur la ligne concernée
// (« Envoyé le 4 nov. », le commentaire, le code retiré) : pas de bulle posée sur la liste (panel v4 t1, comme en séance)
function coachToast(r, okText, { inline = false } = {}) {
  if (r.ok) { if (okText) { if (inline) announce(okText); else showToast(okText); } return true; }
  showToast(coachErrorText(r.kind), { error: true });
  return false;
}
function sinceText(p) {
  const t = Date.parse(p?.since);
  return Number.isFinite(t) ? fmtDate(t, 'short') : '';
}
// Titre de groupe qui contient un pseudo : sans capitales forcées (« Ce que max verra »)
function coachTitle(html) { return `<h2 class="group-title coach-title">${html}</h2>`; }

// Titres des écrans du coach (bouton retour)
function coachRouteTitle(route) {
  const name = routeName(route);
  if (name === 'coach-student') return coachStudent(routeParams(route)[0])?.username || 'Élève';
  return { coach: 'Coach', 'coach-join': 'Coach', 'coach-mine': myCoachWord('Mon'), 'coach-students': 'Mes élèves', 'coach-session': 'Séance', 'coach-send': 'Envoyer', 'coach-send-many': 'Plusieurs élèves', 'coach-presc': 'Charge et reps', 'coach-share': 'Partager', 'coach-chat': 'Messages', 'coach-request': 'Devenir coach',
    'coach-plan': 'Planning', 'coach-planning': 'Planning', 'coach-measures': 'Mensurations', 'coach-measure': 'Mesure', 'coach-photos': 'Photos de bilan',
    'coach-photos-mine': 'Photos de bilan' }[name] || null;
}

// ── Cellules : Réglages et onglet Social ──────────────────────

// Réglages › Social et coach : la cellule Coach, « Partager avec mon coach » (élève suivi, js/features/coach-share-ui.js),
// puis « Séances visibles par défaut » (js/features/social-ui.js, seulement quand le social est activé)
function renderCoachSettingsGroup() {
  if (!accountAvailable()) return '';
  const { isCoach, hasCoach } = coachRole();
  const value = hasCoach ? esc(coachName()) : isCoach ? 'Mes élèves' : account.user ? 'Rejoindre' : '';
  return `
        <div class="group-title">Social et coach</div>
        <div class="group">
          <button class="cell cell--nav" data-action="coach-open-settings">
            ${cellIco('coach', 'blue')}
            <span class="cell__body"><span class="cell__title">Coach</span></span>
            <span class="cell__value">${value}</span>
            ${icon('chevron.right', 16)}
          </button>${coachShareSettingsCell()}${socialDefaultVisibleCell()}${pushSettingsCell()}
        </div>`;
}

// En haut de l'onglet Social (docs/SOCIAL_V2.md) : « Mon coach » (élève suivi), « Tu ne suis plus … » (coach
// perdu : retiré, ou parti depuis un autre appareil, dit une fois) et « Rejoindre un coach » (pratiquant sans
// coach). Toujours au-dessus de la carte d'activation des amis : dessous, « Rejoindre un coach » finissait sous
// la barre d'onglets, invisible sans défiler (panel du 07/11). Un compte coach a ses élèves dans le segment
// Élèves de son onglet Coach (coachTeamHtml), plus dans une cellule.
function coachCellHtml() {
  if (!accountAvailable()) return '';
  const { isCoach, hasCoach } = account.user ? coachRole() : { isCoach: false, hasCoach: false };
  const rows = [];
  const lost = account.user && !hasCoach ? coachLost() : null;
  if (lost) {
    rows.push(`<div class="cell coach-lost" role="status">
        <span class="cell__body"><span class="cell__title">Tu ne suis plus ${esc(lost)}</span><span class="cell__sub">Ses commentaires et vos messages sont supprimés. Les programmes ajoutés restent chez toi.</span></span>
        <button class="social-x" data-action="coach-lost-ok" aria-label="OK, fermer">${icon('xmark', 14)}</button>
      </div>`);
  }
  if (hasCoach) {
    // Messages : leur propre ligne juste dessous (conversation à un toucher), leurs non-lus n'y sont plus comptés deux fois
    const chatRow = chatAvailable() ? chatCoachRowHtml() : '';
    const p = myCoach(), badge = coachBadgeStudent() + (chatRow ? 0 : chatUnreadOf(CHAT_COACH));
    const label = [myCoachWord('Mon'), p ? personName(p) : '', badge ? plural(badge, 'nouveauté', 'nouveautés') : ''].filter(Boolean).join(', ');
    rows.push(`<button class="cell cell--nav coach-cell coach-cell--mine" data-action="coach-open-mine" aria-label="${esc(label)}">
        ${p ? personAvatar(p) : `<span class="coach-cell__icon" aria-hidden="true">${icon('coach', 20)}</span>`}
        <span class="cell__body"><span class="cell__title">${myCoachWord('Mon')}</span>${p ? `<span class="cell__sub">${esc([personName(p), studentPlanSub()].filter(Boolean).join(' · '))}</span>` : ''}</span>
        ${badge ? `<span class="coach-count num" aria-hidden="true">${badge}</span>` : ''}
        ${icon('chevron.right', 16)}
      </button>${chatRow}`);
  } else if (!isCoach && !coachJoinHiddenByAge()) {   // moins de 15 ans possible (js/data/age-range.js) : rien
    rows.push(`<button class="cell cell--nav coach-cell coach-cell--join" data-action="coach-join-start">
        <span class="coach-cell__icon" aria-hidden="true">${icon('coach', 20)}</span>
        <span class="cell__body"><span class="cell__title">Rejoindre ${coachWord('un')}</span><span class="cell__sub">Tu as un code de ${coachWord('ton')}&nbsp;?</span></span>
        ${icon('chevron.right', 16)}
      </button>`);
  }
  return rows.length ? `<div class="group coach-head">${rows.join('')}</div>` : '';
}
// Onglet affiché : cellules et segment Élèves redessinés sur place (la recherche garde le clavier) ; rôle
// changé (coach validé, élève parti) : l'onglet change de forme, redessin complet
function refreshCoachCell() {
  if (currentView() !== 'friends') return;
  if (friendsLayoutChanged()) { render(); return; }
  const top = $('#coachCell'), team = $('#studentsBody');
  if (top) top.innerHTML = coachCellHtml();
  // Recherche en cours : la liste seule, le champ garde le clavier
  if (team && document.activeElement?.id === 'coachSearch') coachRefreshRows();
  else if (team) { setHtmlIfChanged(team, coachTeamHtml()); coachWatchMore(); }
  if (typeof refreshChatInbox === 'function') refreshChatInbox();
}
// Segment Élèves redessiné à chaque nouveauté du coach (état, conversations, planning, progression : 4 à 6 fois
// par relecture) : avec 300 élèves, ~10 000 nœuds refaits à chaque fois pour un contenu le plus souvent identique
// (mesures du 17/11, tests/charge/). Le DOM n'est réécrit que si le texte a changé depuis la dernière écriture.
function setHtmlIfChanged(el, html) {
  if (el.__html === html) return false;
  el.innerHTML = html;
  el.__html = html;
  return true;
}

// ── Réglages › Coach ────────────────────────────────────────

function renderCoachSettings() {
  const head = navBar({ title: 'Coach', large: false });
  if (!account.user) {
    return `<div class="view view--grouped coach-view">${head}<div class="scr">
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('coach', 40)}</span>
          <h2 class="social-hero__title">Entraîne-toi avec ${coachWord('un')}</h2>
          <p class="social-hero__sub">${coachWord('Ton')} suit tes séances et t'envoie des programmes. Il faut un compte, c'est gratuit.</p>
        </div>
        <button class="btn btn--primary btn--full" data-action="social-sign-in">Se connecter</button>
      </div></div>`;
  }
  const st = coach.state, me = myCoach();
  const { isCoach, hasCoach } = coachRole();
  if (!st && !hasCoach && !isCoach) {
    return `<div class="view view--grouped coach-view">${head}<div class="scr">${coach.error
      ? coachOfflineNote(coach.error, `Pas d'Internet. ${coachWord('Le')} demande du réseau.`) : '<div class="empty-note">Chargement…</div>'}</div></div>`;
  }
  const stale = !st && coach.error ? `<p class="social-inline-error" role="status">${esc(coach.error === 'offline' ? 'Pas d\'Internet : pas à jour.' : coachErrorText(coach.error))}</p>` : '';
  const mine = hasCoach && me ? `
        <div class="group-title">${myCoachWord('Mon')}</div>
        <div class="group">
          <button class="cell cell--nav social-row coach-row" data-action="coach-open-mine">
            <span class="social-row__main">${personAvatar(me)}<span class="social-row__text"><span class="social-row__name">${esc(personName(me))}</span>${sinceText(me) ? `<span class="cell__sub">Depuis le ${esc(sinceText(me))}</span>` : ''}</span></span>
            ${icon('chevron.right', 16)}
          </button>${coachShareSettingsCell()}
        </div>
        <div class="group">
          <button class="cell cell--destructive" data-action="coach-leave">Quitter ${myCoachWord('mon')}</button>
        </div>
        <div class="group-foot">Si tu quittes ${myCoachWord('ton')}, tes séances ne sont plus partagées. Les programmes ajoutés restent chez toi.</div>` : coachJoinHiddenByAge() ? coachJoinAgeHtml() : `
        <div class="social-hero coach-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('coach', 40)}</span>
          <h2 class="social-hero__title">Entraîne-toi avec ${coachWord('un')}</h2>
          <p class="social-hero__sub">Entre le code donné par ${coachWord('ton')}. Avant d'accepter, tu verras ce qu'${coachWord('il')} pourra voir et faire.</p>
        </div>
        <div class="group">
          <button class="cell cell--action" data-action="coach-join"><span class="cell__title">Rejoindre ${coachWord('un')}</span></button>
        </div>
        <div class="group-foot">Tu peux quitter ${coachWord('ton')} à tout moment.</div>`;
  const students = isCoach ? `
        <div class="group-title">Tu es coach</div>
        <div class="group">
          <button class="cell cell--nav" data-action="coach-open-students">
            <span class="cell__body"><span class="cell__title">Mes élèves</span>${st ? `<span class="cell__sub">${st.students.length ? plural(st.students.length, 'élève', 'élèves') : 'Aucun élève pour l\'instant'}</span>` : ''}</span>
            ${coachBadgeHtml(coachBadgeCoach(), plural(coachBadgeCoach(), 'nouvelle séance', 'nouvelles séances'))}
            ${icon('chevron.right', 16)}
          </button>${coachDeskSettingsCell()}
        </div>` : '';
  // Rôle coach (js/features/coach-pro-ui.js) : code permanent et palier sous Mes élèves, ou la demande
  // « Devenir coach » en bas pour qui n'est pas coach
  const pro = renderCoachProGroup();
  return `<div class="view view--grouped coach-view">${head}<div class="scr">${stale}${isCoach ? students + pro + mine : mine + pro}</div></div>`;
}
SCREENS.set('coach', { render: () => renderCoachSettings(), enter: () => { coachRefresh(); coachProRefresh(); } });

// ── Rejoindre : code, aperçu, âge, accepter ─────────────────

// Feuille du code : un code ou le message d'invitation collé entier ; erreur dans la feuille (saisie gardée),
// « Vérification… » sur Suivant pendant l'appel. Renvoie le code accepté par coach_preview, ou null
function coachCodeSheet() {
  return sheet({
    title: 'Rejoindre', confirm: 'Suivant', focus: '#coachCode',
    body: `<div class="coach-sheet">
        <label class="coach-sheet__label" for="coachCode">Code reçu de ${coachWord('ton')}</label>
        <input class="coach-code-input" id="coachCode" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off"
               spellcheck="false" enterkeyhint="go" placeholder="Ex : K7M2-QX9P-R4TD" aria-describedby="coachCodeHelp">
        <p class="coach-sheet__hint" id="coachCodeHelp" aria-live="polite">8 ou 12 lettres et chiffres. Tu peux coller tout le message d'invitation.</p>
      </div>`,
    onConfirm: async panel => {
      const input = panel.querySelector('#coachCode'), help = panel.querySelector('#coachCodeHelp');
      const btn = panel.querySelector('.sheet__btn--confirm');
      const fail = msg => { help.textContent = msg; help.classList.add('coach-sheet__hint--bad'); input.setAttribute('aria-invalid', 'true'); haptic('medium'); return false; };
      const code = extractCoachCode(input.value);
      if (!code) return fail('Code introuvable : il fait 8 ou 12 lettres et chiffres, comme K7M2-QX9P-R4TD.');
      btn.disabled = true; btn.textContent = 'Vérification…';
      let r = await coachPreview(code);
      if (!r.ok && r.kind === 'username_required') {
        btn.disabled = false; btn.textContent = 'Suivant';
        return { code, needUsername: true };
      }
      btn.disabled = false; btn.textContent = 'Suivant';
      if (!r.ok) return fail(coachErrorText(r.kind));
      return { code };
    },
  });
}

// Rejoindre un coach masqué par la tranche d'âge partagée par Apple (moins de 15 ans possible,
// js/data/age-range.js) : la règle des 15 ans (privacy.html), dite sans bouton
function coachJoinAgeHtml() {
  return `
        <div class="social-hero coach-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('coach', 40)}</span>
          <h2 class="social-hero__title">Coach indisponible</h2>
          <p class="social-hero__sub">Suivre ${coachWord('un')} est réservé aux 15 ans et plus, d'après la tranche d'âge transmise par Apple. Tout le reste de l'app reste disponible.</p>
        </div>`;
}

// Parcours commun : onglet Social, Réglages › Coach
async function coachJoinFlow() {
  if (!account.user) { navigate('coach'); return; }
  if (coachJoinHiddenByAge()) { navigate('coach'); return; }   // l'écran dit pourquoi
  if (!(await coachEnsureUsername())) return;
  let res = await coachCodeSheet();
  if (!res) return;
  // Compte sans pseudo (le serveur le demande) : choix du pseudo, puis nouvel essai avec le même code
  if (res.needUsername) {
    if (!(await coachEnsureUsername(true))) return;
    const r = await coachPreview(res.code);
    if (!coachToast(r)) return;
  }
  navigate(makeRoute('coach-join', res.code));
}

// Aperçu du coach avant d'accepter : qui, ce qui sera visible, ce que le coach pourra faire, ce qui ne l'est
// jamais. Interrupteur « J'ai 15 ans ou plus » (même déclaration que pour les amis : socialAgeOk) et
// « Accepter » collés en bas, toujours visibles : l'interrupteur sous la liste passait sous la barre (panel du 07/11)
function renderCoachJoin(code) {
  const pv = coach.preview?.code === code ? coach.preview.person : null;
  const head = navBar({ title: 'Rejoindre', large: false });
  if (coachJoinHiddenByAge()) return `<div class="view view--grouped coach-join-view">${head}<div class="scr">${coachJoinAgeHtml()}</div></div>`;
  if (!pv) return `<div class="view view--grouped coach-join-view">${head}<div class="scr"><div class="empty-note">Saisis de nouveau le code dans l'onglet Social.</div></div></div>`;
  const name = esc(personName(pv)), pf = coachFormOf(pv.user_id);
  const list = items => `<div class="group">${items.map(([t, d]) => `
          <div class="cell coach-join__item"><span class="cell__body"><span class="cell__title">${t}</span><span class="cell__sub">${d}</span></span></div>`).join('')}</div>`;
  const ok = socialAgeOk;
  // Photos de bilan (docs/PHOTOS_BILAN.md) : dites seulement là où l'envoi existe (coffre de l'app iPhone, tranche
  // d'âge d'Apple qui ne l'interdit pas) ; ailleurs, aucune photo ne peut partir
  const photos = vaultAvailable() && !cphAgeBlocked();
  return `
    <div class="view view--grouped coach-join-view">
      ${head}
      <div class="scr">
        <div class="coach-join__who">
          ${personAvatar(pv, 'l')}
          <span><span class="coach-join__name">${name}</span><span class="coach-join__sub">veut être ${coachWord('ton', pf)}</span>${cardBadgeHtml(pv.user_id, 'card-badge--who')}</span>
        </div>
        ${coachTitle(`Ce ${elide('que', name)} verra`)}
        ${list([['Toutes tes séances', 'Anciennes et nouvelles, avec exercices, séries et notes. Même celles masquées à ceux qui te suivent.']])}
        ${coachTitle(`Ce ${elide('que', name)} pourra faire`)}
        ${list([['Des programmes pour toi', 'Avec ses consignes. Tu choisis de les ajouter.'], ['Ses commentaires', 'Sous tes séances, dans l\'historique.'],
          ['Des messages', 'Texte seul, entre vous deux. Supprimés si le suivi s\'arrête. Tu peux en signaler un.'],
          ['Des plans de nutrition', 'Si tu les acceptes. Tu choisis de les suivre.']])}
        ${coachTitle('Seulement si tu le choisis')}
        ${list([['Poids et mensurations', `Rien au départ. Tu choisis dans Réglages › Social et coach › Partager avec ${coachWord('mon', pf)}.`],
          ...(photos ? [['Des photos de bilan', `Celles que tu envoies depuis ton coffre, chiffrées pour ${coachWord('ton', pf)} seul${coachWord('e', pf)}. Tu peux les retirer.`]] : [])])}
        ${coachTitle('Jamais visible')}
        ${list([['Le reste', `Ni tes données Santé, ni ${photos ? 'les autres photos du coffre' : 'tes photos'}, ni tes programmes perso. Tu ne vois pas ses autres élèves, et eux ne te voient pas.`]])}
        <div class="coach-join__foot">
          <button class="cell coach-join__age" data-action="coach-age" role="switch" aria-checked="${ok}">
            <span class="cell__body"><span class="cell__title" id="coachAgeHint">J'ai 15 ans ou plus</span></span>
            <span class="switch ${ok ? 'switch--on' : ''}" aria-hidden="true"><span class="switch__thumb"></span></span>
          </button>
          <button class="btn ${ok ? 'btn--primary' : 'btn--secondary'} btn--full coach-accept" data-action="coach-accept" data-code="${esc(code)}" ${ok ? '' : 'disabled aria-describedby="coachAgeHint"'}>Accepter</button>
        </div>
      </div>
    </div>`;
}
SCREENS.set('coach-join', { render: code => renderCoachJoin(code), enter: () => { coachBadgeLoad(coach.preview?.person?.user_id); } });

// ── Élève : Mon coach ───────────────────────────────────────

// Exercice filmé par un coach partenaire : ouvre sa fiche, où la vidéo est lue (js/ui/exercise-video.js)
function coachExVideoBtn(name) {
  return `<button class="coach-prog__video" data-action="open-library-ex" data-name="${esc(name)}" aria-label="Voir la vidéo : ${esc(name)}">${icon('play', 11)}<span>Vidéo</span></button>`;
}

// Aperçu des exercices d'un programme reçu (avant de l'ajouter)
// Ce que le coach prescrit en plus des séries (« 4 séries » ou « 4 × 12 » en reps fixes : setsRepsText) :
// fourchette (« 8 à 12 reps », exercice en répétitions avec un bas de fourchette) et technique
// d'intensification (« dernière en drop set », « 1re en cluster », js/data/intensif.js). Écran Envoyer et aperçu de l'élève ;
// la prise a sa ligne à elle (gripText)
function coachExPlanParts(e) {
  const out = [];
  // Fourchette, même sans bas réglé (4 sous le haut : repSpanOf) : plus de « Pompes · 3 séries » sans reps (panel vague 4)
  const span = repSpanOf(e);
  if (span) out.push(`${span[0]} à ${span[1]} reps`);
  const it = intensText(e, { short: true });   // « 1re en cluster », « dernière en drop set »
  if (it) out.push(it);
  return out;
}

// Séries d'un élève, côté coach : reps à virgules (setsTextRead, js/data/measures.js), échappées pour le HTML
function coachSetsLine(sets, measure, kind) {
  return esc(setsTextRead(sets, measure, kind));
}

function coachProgPreviewHtml(item) {
  return `<div class="coach-prog__preview">${item.data.sessions.map(s => `
          <div class="coach-prog__sess">
            <div class="coach-prog__sess-name"><span class="hcell__dot" style="background:${esc(s.color)}" aria-hidden="true"></span>${esc(s.label)}</div>
            <ul class="coach-prog__ex">${s.exercises.map(e => `<li><span class="coach-prog__ex-name">${esc(e.name)}</span>&nbsp;<span class="num">· ${setsRepsHtml(e)}</span>${coachExPlanParts(e).map(x => `&nbsp;<span class="coach-prog__ex-plan num">· ${esc(x)}</span>`).join('')}${gripText(e.grip, e) ? `&nbsp;<span class="coach-prog__ex-grip">· ${gripText(e.grip, e)}</span>` : ''}${exerciseVideo(e.name) ? coachExVideoBtn(e.name) : ''}${e.consigne ? `<span class="coach-prog__ex-tip">${esc(e.consigne)}</span>` : ''}</li>`).join('') || '<li>Aucun exercice</li>'}</ul>
          </div>`).join('')}</div>`;
}

// Illustration d'un programme reçu : la règle de Mes programmes (js/features/programme.js, programmeFocusGroup et
// programmeLevels, réutilisées telles quelles) : un groupe seul s'il pèse plus de 60 % des exercices, sinon le
// personnage entier, face et dos, muscles travaillés en rouge (« Force » Haut + Bas : tout le corps, plus les seuls
// pectoraux, panel coach t1). Décorative ; '' sans détail (hors ligne) ni exercice.
function coachProgArtHtml(item, cls) {
  if (item?.meta) return '';
  const exs = (item?.data?.sessions || []).flatMap(x => x.exercises || []);
  if (!exs.length) return '';
  const focus = programmeFocusGroup(exs);
  if (focus) return progThumbHtml(focus, cls);
  const levels = programmeLevels(exs);
  return Object.keys(levels).length ? `<span class="${cls} cprog-body" aria-hidden="true">${bodyMapHtml(levels, { view: 'both' })}</span>` : '';
}
// État d'un programme reçu en une phrase courte (carte de tête de Mon coach)
function coachProgStateText(item) {
  const { status, id } = coachStatus(item);
  if (status === 'update') return 'Mise à jour à prendre';
  if (status === 'new') return 'À ajouter à tes programmes';
  return data.activeProgramme === id ? 'Ton programme actuel' : 'Dans tes programmes';
}

// Carte d'un programme reçu (Mon coach) : statut, nom et séances à gauche, vignette du groupe le plus travaillé à
// droite (décorative), consigne, exercices dépliables, action
function coachProgCardHtml(item) {
  const { status, id } = coachStatus(item);
  const nS = item.data.sessions.length, who = esc(coachName());
  const kept = status === 'current' && data.userProgrammes?.[id]?.fromCoach?.keptAt === item.sentAt && item.sentAt > (data.userProgrammes[id].fromCoach.sentAt || 0);
  const eyebrow = status === 'update' ? `Mis à jour par ${who}` : status === 'new' ? `Nouveau programme ${elide('de', who)}` : `Reçu ${elide('de', who)}`;
  const open = coachProgOpen.has(item.id) && !item.meta;
  const art = coachProgArtHtml(item, 'coach-prog__img');
  const btn = status === 'current'
    ? (kept ? `<p class="coach-prog__done">Tu as gardé ta version.</p>
        <button class="btn btn--secondary coach-prog__btn" data-action="coach-take-prog" data-id="${esc(item.id)}">Prendre la version ${elide('de', who)}</button>`
      : '<p class="coach-prog__done">Dans tes programmes</p>')
    : `<button class="btn btn--primary coach-prog__btn" data-action="coach-add-prog" data-id="${esc(item.id)}" aria-label="${status === 'update' ? `Mettre à jour ${esc(item.data.name)}` : `Ajouter ${esc(item.data.name)} à mes programmes`}">${status === 'update' ? 'Mettre à jour' : 'Ajouter à mes programmes'}</button>`;
  return `
        <article class="coach-prog" id="coach-prog-${esc(item.id)}">
          <div class="coach-prog__head${art ? '' : ' coach-prog__head--noart'}">
            <div class="coach-prog__head-text">
              <div class="coach-prog__eyebrow">${eyebrow}${coachNewDotHtml(!item.seen)}</div>
              <h3 class="coach-prog__name">${esc(item.data.name)}</h3>
              ${item.meta ? '<p class="coach-prog__meta">Détail disponible avec du réseau.</p>' : `<p class="coach-prog__meta">${plural(nS, 'séance', 'séances')}${nS ? ` : ${esc(item.data.sessions.map(s => s.label).join(', '))}` : ''}</p>`}
            </div>
            ${art}
          </div>
          ${item.data.consigne ? `<p class="coach-prog__consigne">${icon('info.circle', 14)}<span>${esc(item.data.consigne)}</span></p>` : ''}
          ${item.meta ? '' : `<button class="coach-prog__toggle" data-action="coach-prog-toggle" data-id="${esc(item.id)}" aria-expanded="${open}">${open ? 'Masquer les exercices' : 'Voir les exercices'} ${icon(open ? 'chevron.up' : 'chevron.down', 12)}</button>`}
          ${open ? coachProgPreviewHtml(item) : ''}
          ${btn}
        </article>`;
}

// Pastille « nouveau » d'un élément compté dans la pastille de « Mon coach » (Social) : chaque nouveauté comptée
// se retrouve à l'intérieur (panel t6 : 3 sur la ligne, une seule pastille visible dedans)
// Pastille rouge « Nouveau », la même que les compteurs (panel coach t1 : un point rouge sans chiffre ne se comptait pas
// dans « Mon coach 3 ») ; collée au dernier mot par une espace insécable, jamais seule sur sa ligne. VoiceOver lit
// « Nouveau ».
function coachNewDotHtml(on) { return on ? '\u00a0<span class="coach-new">Nouveau</span>' : ''; }
// Commentaires non lus à l'arrivée sur Mon coach : marqués vus tout de suite (la pastille de l'onglet baisse),
// leur point reste jusqu'au départ de l'écran pour qu'on voie lesquels étaient nouveaux
let coachMineFresh = new Set();
// Commentaires de mon coach : nom de la séance, date, texte entier
function coachNotesHtml(notes) {
  return `<div class="group">${notes.map(n => {
    const h = (data.history || []).find(x => x.id === n.session_id);
    const label = h ? rawLabel(h.category, entryProg(h)) : 'Séance';
    return `<button class="cell ${h ? 'cell--nav' : ''} coach-note-row" ${h ? `data-action="coach-open-history" data-id="${esc(n.session_id)}"` : 'disabled'}>
            <span class="cell__body"><span class="cell__title">${esc(label)}${h ? ` · ${esc(fmtDate(h.date))}` : ''}${coachNewDotHtml(!n.seen || coachMineFresh.has(n.session_id))}</span><span class="coach-note-row__text">${esc(n.text)}</span></span>
            ${h ? icon('chevron.right', 16) : ''}
          </button>`;
  }).join('')}</div>`;
}

// Carte de tête de Mon coach, en bas : le dernier programme reçu, illustré (décoratif), son nom et son état. La ligne
// se touche, avec un chevron comme Messages : elle amène à la carte du programme, plus bas, qui garde l'action (Ajouter,
// Mettre à jour) et l'aperçu des exercices. Rien sans programme.
function coachMineProgHtml(inbox) {
  const item = inbox?.programmes?.[0];
  if (!item) return '';
  const art = coachProgArtHtml(item, 'cmine-hero__img'), n = item.meta ? 0 : item.data.sessions.length;
  return `
          <button class="cmine-hero__prog${art ? '' : ' cmine-hero__prog--noart'}" data-action="coach-prog-jump" data-id="${esc(item.id)}">
            ${art ? `<span class="cmine-hero__pic">${art}</span>` : ''}
            <span class="cmine-hero__text">
              <span class="cmine-hero__eyebrow">${inbox.programmes.length > 1 ? 'Dernier programme reçu' : 'Programme reçu'}</span>
              <span class="cmine-hero__name">${esc(item.data.name)}</span>
              <span class="cmine-hero__sub">${n ? `${plural(n, 'séance', 'séances')}<span aria-hidden="true"> · </span><span class="visually-hidden">, </span>` : ''}${coachProgStateText(item)}</span>
            </span>
            ${icon('chevron.right', 16)}
          </button>`;
}

function renderCoachMine() {
  const head = navBar({ title: myCoachWord('Mon'), large: true });   // grand titre replié au défilement, comme Coach et Mon profil
  const p = myCoach();
  if (!p) {
    return `<div class="view view--grouped coach-mine-view">${head}<div class="scr">${!coach.state && coach.error
      ? coachOfflineNote(coach.error, `Pas d'Internet. ${myCoachWord('Ton')} s'affichera quand le réseau reviendra.`)
      : coach.state ? '<div class="empty-note">Tu n\'as pas de coach. Rejoins-en un depuis l\'onglet Social.</div>' : '<div class="empty-note">Chargement…</div>'}</div></div>`;
  }
  const inbox = coach.inbox;
  // Nom de son affiche (s'il l'a partagée) et sa photo de profil : l'élève reconnaît la coach qui l'a fait venir,
  // @pseudo dessous (5e panel)
  const posterNm = coachPosterNameOf(p.user_id), shownName = posterNm || personName(p);
  const stale = !coach.state && coach.error ? `<p class="social-inline-error" role="status">${esc(coach.error === 'offline' ? 'Pas d\'Internet : dernières nouvelles gardées sur ${thePhone()}.' : coachErrorText(coach.error))}</p>` : '';
  const progs = inbox ? (inbox.programmes.length ? inbox.programmes.map(coachProgCardHtml).join('')
    : '<div class="empty-note coach-empty">Aucun programme reçu.</div>') : '<div class="empty-note coach-empty">Chargement…</div>';
  const notes = inbox?.notes.length ? `<div class="group-title">Commentaires</div>${coachNotesHtml(inbox.notes)}` : '';
  return `
    <div class="view view--grouped coach-mine-view">
      ${head}
      <div class="scr">
        ${stale}
        <div class="cmine-hero">
          <div class="coach-join__who coach-mine__who">
            ${personAvatar(p, 'l')}
            <span><span class="coach-join__name" role="heading" aria-level="1" data-echo-title>${nameBreakHtml(shownName)}</span>${posterNm && p.username ? `<span class="coach-join__sub coach-mine__handle">@${nameBreakHtml(p.username)}</span>` : ''}<span class="coach-join__sub">${myCoachWord('Ton')}${sinceText(p) ? ` depuis le ${esc(sinceText(p))}` : ''}</span>${cardBadgeHtml(p.user_id, 'card-badge--who')}</span>
          </div>
          ${coachMineProgHtml(inbox)}
        </div>
        ${chatIntroHtml()}
        ${chatCellHtml(CHAT_COACH)}
        ${studentPlanHtml()}
        ${typeof checkinMineCellHtml === 'function' ? checkinMineCellHtml() : ''}
        ${cphMineCellHtml()}
        ${notes}
        <div class="group-title">Programmes reçus</div>
        <div class="coach-progs">${progs}</div>
        ${dietInboxHtml()}
        <div class="group group--gap">
          ${cardBadgeReportCell(p.user_id)}
          <button class="cell cell--destructive" data-action="coach-leave">Quitter ${myCoachWord('mon')}</button>
        </div>
        <div class="group-foot">Si tu quittes ${myCoachWord('ton')}, tes séances ne sont plus partagées et vos messages sont supprimés.</div>
      </div>
    </div>`;
}
SCREENS.set('coach-mine', {
  render: () => renderCoachMine(),
  // Relu à chaque arrivée (retour compris) ; commentaires listés ici : vus
  enter: async () => {
    coachBadgeLoad(myCoach()?.user_id);
    coachPosterNameLoad(myCoach()?.user_id, () => { if (currentView() === 'coach-mine') render(); });
    await coachRefresh(); cphRefresh({ minAge: 30_000 });
    const fresh = (coach.inbox?.notes || []).filter(n => !n.seen);
    coachMineFresh = new Set(fresh.map(n => n.session_id));
    fresh.forEach(n => coachMarkInboxSeen('note', n.session_id));
  },
  leave: () => { coachMineFresh = new Set(); },
});

// Cartes de l'accueil : programme reçu pas encore ajouté (ou mis à jour), commentaire pas encore lu
function coachHomeCard() {
  if (!account.user || !myCoach() || !coach.inbox) return '';
  const who = esc(coachName());
  const cards = [];
  const item = coach.inbox.programmes.find(p => !p.seen && coachStatus(p).status !== 'current');
  if (item) {
    const upd = coachStatus(item).status === 'update';
    cards.push(`
    <section class="home-card account-card coach-home" aria-labelledby="coachCardTitle">
      <div class="account-card__text">
        <h2 class="account-card__title" id="coachCardTitle">${upd ? `Programme mis à jour par ${who}` : `Nouveau programme ${elide('de', who)}`}</h2>
        <p class="account-card__sub">${esc(item.data.name)}</p>
      </div>
      <button class="account-card__btn" data-action="coach-add-prog" data-id="${esc(item.id)}" aria-label="${upd ? `Mettre à jour ${esc(item.data.name)}` : `Ajouter ${esc(item.data.name)} à mes programmes`}">${upd ? 'Mettre à jour' : 'Ajouter'}</button>
      <button class="account-card__close" data-action="coach-dismiss-prog" data-id="${esc(item.id)}" aria-label="Plus tard">${icon('xmark', 16)}</button>
    </section>`);
  }
  const note = coach.inbox.notes.find(n => !n.seen && (data.history || []).some(h => h.id === n.session_id));
  if (note) {
    const h = data.history.find(x => x.id === note.session_id);
    cards.push(`
    <section class="home-card account-card coach-home coach-home--note" aria-labelledby="coachNoteTitle">
      <div class="account-card__text">
        <h2 class="account-card__title" id="coachNoteTitle">${who} a commenté ta séance</h2>
        <p class="account-card__sub">${esc(rawLabel(h.category, entryProg(h)))} · ${esc(fmtDate(h.date))}</p>
      </div>
      <button class="account-card__btn" data-action="coach-open-history" data-id="${esc(note.session_id)}" aria-label="Lire le commentaire">Lire</button>
      <button class="account-card__close" data-action="coach-dismiss-note" data-id="${esc(note.session_id)}" aria-label="Plus tard">${icon('xmark', 16)}</button>
    </section>`);
  }
  return cards.join('');
}

// Ajout ou mise à jour d'un programme reçu ; programme modifié par l'élève : question avant d'écraser.
// take : « Prendre la version du coach » après l'avoir refusée
async function addCoachProgrammeFlow(progId, { take = false } = {}) {
  const item = coach.inbox?.programmes.find(p => p.id === progId);
  if (!item) return;
  // Programme gardé hors ligne (cache, au démarrage avant la réponse du serveur) : on n'a que son nom. Si
  // rien n'indique qu'on est hors ligne, on relit d'abord l'état et on réessaie avec le contenu complet ;
  // vraiment hors ligne, l'ajout reste impossible (c'est voulu)
  if (item.meta) {
    if (coach.error) { showToast(coachErrorText('offline'), { error: true }); return; }
    await coachRefresh();
    const fresh = coach.inbox?.programmes.find(p => p.id === progId);
    if (!fresh || fresh.meta) { showToast(coachErrorText('offline'), { error: true }); return; }
    return addCoachProgrammeFlow(progId, { take });
  }
  const st = coachStatus(item);
  const status = take ? 'update' : st.status, localId = st.id, name = item.data.name;
  // Séance en cours sur ce programme : la mise à jour attend la fin de la séance (ses exercices et ses
  // séances changeraient en pleine séance)
  if (status === 'update' && activeSession?.programme === localId) {
    await dialog({ title: 'Séance en cours', message: `Termine la séance, puis mets à jour « ${name} » depuis ${myCoachWord('Mon')}.`,
      actions: [{ label: 'OK', style: 'preferred' }] });
    return;
  }
  if (take) {
    if (!(await confirmSheet('Prendre sa version ?', `Tes changements de « ${name} » seront remplacés. Les séances faites restent dans l'historique.`, 'Prendre sa version'))) return;
  } else if (status === 'update' && st.modified) {
    const choice = await dialog({ type: 'sheet', title: 'Remplacer tes changements ?',
      message: `Tu as modifié « ${name} ». La nouvelle version ${elide('de', coachName())} remplace tes changements. Les séances faites restent dans l'historique.`,
      actions: [{ label: 'Prendre la nouvelle version', value: 'replace', style: 'destructive' }, { label: 'Garder ma version', value: 'keep' }, { label: 'Annuler', style: 'cancel' }] });
    if (!choice) return;
    if (choice === 'keep') {
      keepMyCoachProgramme(data, item, myCoach()?.user_id || null);
      save();
      coachMarkInboxSeen('programme', item.id);
      showToast('Version gardée');
      render();
      return;
    }
  }
  const id = importCoachProgramme(data, item, myCoach());
  if (!id) { showToast(coachErrorText('server'), { error: true }); return; }
  if (data.activeProgramme === id) activateProgramme(id);
  save();
  haptic();
  coachMarkInboxSeen('programme', item.id);
  if (status === 'update') { showToast(`« ${name} » mis à jour`); render(); return; }
  render();
  if (data.activeProgramme === id || activeSession) { showToast(`« ${name} » ajouté à tes programmes`); return; }
  const go = await dialog({ title: 'Programme ajouté', message: `Passer à « ${name} » maintenant ? L'historique est conservé.`,
    actions: [{ label: 'Plus tard', style: 'cancel' }, { label: 'Passer à ce programme', value: true, style: 'preferred' }] });
  if (go === true) { activateProgramme(id); save(); showToast(`Programme : ${name}`); render(); }
}

// ── Élève : consignes, commentaire, notes ───────────────────

// Programme reçu d'un coach (programme perso marqué fromCoach), ou null
function coachProgOf(progId) { return data.userProgrammes?.[progId]?.fromCoach ? data.userProgrammes[progId] : null; }
function coachAuthor(up) { return up?.fromCoach?.name || coachWord('ton', coachFormOf(up?.fromCoach?.coachId)); }
// « De ton coach max » : Mes programmes, accueil
// « De ton coach max » tant qu'on suit ce coach ; ensuite « Reçu de max » (ou rien si le nom manque)
function coachFromLine(progId) {
  const up = coachProgOf(progId);
  if (!up) return '';
  const name = up.fromCoach.name;
  if (myCoach()?.user_id && myCoach().user_id === up.fromCoach.coachId) return `De ${myCoachWord('ton')} ${esc(name || myCoach().username || '')}`.trim();
  return name ? `Reçu ${elide('de', esc(name))}` : '';
}

// Accueil : muscles d'une séance d'un programme reçu (le coach n'envoie pas de description) : les plus
// travaillés par ses exercices, comme « Pectoraux · Épaules · Triceps » des programmes intégrés
function coachSessionDesc(progId, cat) {
  return coachProgOf(progId) ? sessionMusclesSummary(progId, cat) : '';
}

// Programme et Programme › Séance : consigne générale du programme
function coachEditorConsigneHtml(progId) {
  const up = coachProgOf(progId);
  if (!up?.consigne) return '';
  return `
        ${coachTitle(`Consigne ${elide('de', esc(coachAuthor(up)))}`)}
        <div class="group group--pad"><p class="coach-consigne">${esc(up.consigne)}</p></div>`;
}
// Programme › Séance : consigne d'un exercice sous son nom (texte normal, petite icône, 3 lignes)
function coachExConsigneSub(progId, ex) {
  if (!coachProgOf(progId) || !ex?.consigne) return '';
  return `<span class="cell__sub coach-ex-consigne">${icon('info.circle', 12)}<span>${esc(ex.consigne)}</span></span>`;
}

// Séance en cours : consigne du programme (en tête) et de chaque exercice, repliables
function coachTipOf(ex) {
  const s = activeSession;
  if (!s || !coachProgOf(s.programme)) return null;
  const pe = (data.programmes[s.programme]?.exercises?.[s.category] || []).find(e => e.id === ex.exId);
  return pe?.consigne || null;
}
function coachTipHtml(key, title, text) {
  const open = !coachTipClosed.has(key);
  return `<button class="coach-tip ${open ? '' : 'coach-tip--closed'}" data-action="coach-tip" data-ex="${esc(key)}" aria-expanded="${open}">
      <span class="coach-tip__head">${icon('info.circle', 14)}<span>${title}</span>${icon(open ? 'chevron.up' : 'chevron.down', 12)}</span>
      <span class="coach-tip__text">${esc(text)}</span>
    </button>`;
}
function coachSessionTipHtml(ex, label = '') {
  const tip = coachTipOf(ex);
  if (!tip) return '';
  return coachTipHtml(ex.exId, `${label ? `${esc(label)} · ` : ''}Consigne ${elide('de', esc(coachAuthor(coachProgOf(activeSession.programme))))}`, tip);
}
function coachSessionProgTipHtml() {
  const up = activeSession && coachProgOf(activeSession.programme);
  if (!up?.consigne) return '';
  return `<div class="coach-tip-wrap">${coachTipHtml('', `Consigne du programme · ${esc(coachAuthor(up))}`, up.consigne)}</div>`;
}

// Historique › Séance : commentaire du coach ; liste de l'Historique : petite bulle
function historyCoachGroup(h) {
  const n = coachNoteFor(h.id);
  if (!n) return '';
  return `
        <div class="group-title">Commentaire de ${myCoachWord('ton')}</div>
        <div class="group group--pad"><p class="hnotes coach-note">${esc(n.text)}</p></div>`;
}
function coachHistoryMark(h) {
  if (!coachNoteFor(h.id)) return '';
  return `<span class="coach-mark" role="img" aria-label="Commentée par ${myCoachWord('ton')}">${icon('bubble.left', 14)}</span>`;   // bulle vide : un commentaire ; la bulle à lignes reste aux messages privés
}
// Ouverture d'Historique › Séance : son commentaire est vu
function coachHistoryMount() {
  const id = routeParams(currentRoute())[0];
  const n = id && coachNoteFor(id);
  if (n && !n.seen) coachMarkInboxSeen('note', id);
}
// Bilan : sous les notes, quand on a un coach
function coachNotesHint() {
  return account.user && myCoach() ? `<p class="coach-notes-hint">${myCoachWord('Ton')} voit la note de séance.</p>` : '';
}

// ── Coach : Mes élèves ──────────────────────────────────────

// Plus de COACH_SEARCH_FROM élèves : un champ filtre la liste par pseudo, sans quitter l'écran (panel Apple de la vague 3 :
// les coachs partenaires suivent beaucoup d'élèves). Au-delà de 20 élèves, des filtres (Tous, À relancer, Nouveautés,
// Sans programme, compteurs exacts) ; la liste se dessine par COACH_ROWS_PAGE cartes, la suite en défilant (test de charge
// du 17/11 : 300 élèves faisaient une seule liste de 35 000 px). Recherche et filtre ne redessinent que la liste
// (#coachRows) : le champ garde le clavier.
const COACH_SEARCH_FROM = 9;
const COACH_ROWS_PAGE = 40;
let coachSearchQ = '';
let coachFilter = 'all';        // filtre de Mes élèves (COACH_FILTERS, js/data/coach-progress.js)
let coachShownN = COACH_ROWS_PAGE;   // cartes dessinées
let coachRowsObserver = null;   // « Afficher plus » touché tout seul quand il arrive à l'écran
function coachTeamView() {
  const st = coach.state, now = Date.now();
  const sorted = coachSortedStudents(st.students, now);
  const many = st.students.length >= COACH_FILTER_MIN;
  const unreadOf = s => chatUnreadOf(s.user_id);
  const counts = many ? coachFilterCounts(sorted, unreadOf) : null;
  const filter = many && counts[coachFilter] !== undefined ? coachFilter : 'all';
  const q = normName(coachSearchQ);
  const shown = sorted.filter(({ st: s, pr }) => coachStudentIn(filter, s, pr, unreadOf(s)) && (!q || normName(personName(s)).includes(q)));
  return { sorted, counts, filter, shown, now };
}
function coachRowsHtml(v = coachTeamView()) {
  const page = v.shown.slice(0, coachShownN);
  const rest = v.shown.length - page.length;
  const none = !v.shown.length && coach.state.students.length
    ? `<div class="cell" id="coachSearchNone"><span class="cell__sub social-empty">${coachSearchQ ? 'Aucun élève ne correspond.' : 'Aucun élève dans ce filtre.'}</span></div>` : '';
  return `${page.map(({ st, pr }) => coachStudentRowHtml(st, pr, v.now)).join('') || none || '<div class="cell"><span class="cell__sub social-empty">Aucun élève pour l\'instant</span></div>'}${rest > 0
    ? `<button class="cell cell--action coach-more-rows" data-action="coach-more-rows">Afficher ${plural(Math.min(rest, COACH_ROWS_PAGE), 'élève de plus', 'élèves de plus')}</button>` : ''}`;
}
function coachFiltersHtml(v) {
  if (!v.counts) return '';
  return `<div class="coach-filters" role="group" aria-label="Filtrer les élèves">${COACH_FILTERS.map(([k, l]) =>
    `<button class="coach-filter${v.filter === k ? ' coach-filter--on' : ''}" data-action="coach-filter" data-filter="${k}" aria-pressed="${v.filter === k}">${esc(l)} <span class="coach-filter__n num">${v.counts[k]}</span></button>`).join('')}</div>`;
}
// Liste seule redessinée (recherche, filtre, « Afficher plus ») ; le compteur des filtres suit
function coachRefreshRows() {
  const el = $('#coachRows');
  if (!el || !coach.state) return;
  const v = coachTeamView();
  setHtmlIfChanged(el, coachRowsHtml(v));
  const f = $('#coachFilters');
  if (f) setHtmlIfChanged(f, coachFiltersHtml(v));
  // Le segment entier montre maintenant ce que donnerait coachTeamHtml() : la prochaine relecture sans nouveauté ne le
  // réécrit pas (setHtmlIfChanged de refreshCoachCell)
  const team = $('#studentsBody');
  if (team) team.__html = coachTeamHtml();
  coachWatchMore();
}
// Bas de la liste atteint : 40 cartes de plus, sans toucher (le bouton reste pour VoiceOver et sans IntersectionObserver)
function coachWatchMore() {
  // Filtre choisi visible dans sa ligne qui défile (ouverte par une notification sur Nouveautés), sans défiler la page
  const on = $('.coach-filter--on'), row = on?.parentElement;
  if (row && (on.offsetLeft < row.scrollLeft || on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth)) row.scrollLeft = on.offsetLeft - 16;
  coachRowsObserver?.disconnect();
  const btn = $('.coach-more-rows');
  if (!btn || typeof IntersectionObserver !== 'function') return;
  coachRowsObserver = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { coachRowsObserver.disconnect(); coachShowMoreRows(); } }, { rootMargin: '600px 0px' });
  coachRowsObserver.observe(btn);
}
function coachShowMoreRows() { coachShownN += COACH_ROWS_PAGE; coachRefreshRows(); }
document.addEventListener('input', e => {
  if (e.target.id !== 'coachSearch') return;
  coachSearchQ = e.target.value;
  coachShownN = COACH_ROWS_PAGE;
  coachRefreshRows();
});

// Petite hauteur (iPhone SE) : résumé de la semaine sur une ligne (css/coach.css, même seuil) et Planning sous la liste
// des élèves, pour qu'au moins deux élèves se voient sans défiler (panel Apple du 08/11)
const COACH_COMPACT = '(max-height: 700px)';
const coachCompact = () => typeof window.matchMedia === 'function' && window.matchMedia(COACH_COMPACT).matches;

// Mes élèves : résumé de la semaine, élèves triés par progression, invitations, retirés. Le même contenu
// dans le segment Élèves de l'onglet Coach (js/features/social-ui.js) et dans Réglages › Coach › Mes élèves.
function coachTeamHtml() {
  const st = coach.state;
  if (!st) return coach.error
    ? coachOfflineNote(coach.error, 'Pas d\'Internet. Tes élèves s\'afficheront quand le réseau reviendra.') : '<div class="empty-note">Chargement…</div>';
  if (!st.is_coach) return `<div class="empty-note">${esc(coachErrorText('not_coach'))}</div>`;
  // Lignes triées, avec le signal de progression de chaque élève (js/features/coach-progress-ui.js), filtrées et par pages
  const v = coachTeamView();
  const compact = coachCompact();
  const invites = st.invites.map(i => `
          <div class="cell coach-invite">
            <span class="cell__body"><span class="cell__title coach-code num">${esc(i.code)}</span><span class="cell__sub">Jusqu'au ${esc(fmtDate(i.expires_at, 'short'))}</span></span>
            <button class="coach-icon-btn" data-action="coach-share-invite" data-code="${esc(i.code)}" aria-label="Partager le code ${esc(i.code)}">${icon('square.and.arrow.up', 20)}</button>
            <button class="social-x" data-action="coach-revoke-invite" data-code="${esc(i.code)}" aria-label="Supprimer le code ${esc(i.code)}">${icon('xmark', 14)}</button>
          </div>`).join('');
  const removed = st.removed.length ? `
        <div class="group-title">Retirés</div>
        <div class="group">${st.removed.map(p => personRowHtml(p,
          `<button class="social-pill" data-action="coach-allow" data-uid="${esc(p.user_id)}" aria-label="${esc(`Autoriser ${personName(p)} à revenir`)}">Autoriser</button>`, 'Ne peut plus revenir avec tes codes')).join('')}</div>
        <div class="group-foot">« Autoriser » lui permet de revenir avec un de tes codes.</div>` : '';
  return `
        ${coach.error ? `<p class="social-inline-error" role="status">${esc(coach.error === 'offline' ? 'Pas d\'Internet : liste pas à jour.' : coachErrorText(coach.error))}</p>` : ''}
        ${coachTierBannerHtml()}
        ${coachDeskCardHtml()}
        ${coachTeamWeekHtml(st.students)}
        ${compact ? '' : coachPlanningCellHtml()}
        <div class="group-title">Élèves${st.students.length ? ` (${st.students.length})` : ''}</div>
        ${st.students.length >= COACH_SEARCH_FROM ? `<div class="social-search"><span class="social-search__icon" aria-hidden="true">${icon('magnifyingglass', 17)}</span><input type="search" id="coachSearch" maxlength="${SEARCH_MAX}" class="search social-search__input" placeholder="Rechercher un élève" aria-label="Rechercher un élève par son pseudo"
            autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search" value="${esc(coachSearchQ)}"></div>` : ''}
        <div id="coachFilters">${coachFiltersHtml(v)}</div>
        <div class="group" id="coachRows">${coachRowsHtml(v)}</div>
        <div class="group-foot">${st.students.length > 1 ? PROGRESS_SORT_FOOT : 'Tes élèves ne se voient pas entre eux.'}</div>
        ${compact ? coachPlanningCellHtml() : ''}
        ${cphTeamSetupHtml(st.students)}
        <div class="group-title">Invitations</div>
        <div class="group">
          ${coachPermanentCodeHtml()}
          ${coachPro.code ? coachPosterCellHtml() : ''}
          ${invites}
          <button class="cell cell--action" data-action="coach-invite" ${coachInviteBusy ? 'disabled' : ''}>${icon('plus', 20)}<span>${coachPro.code ? 'Créer un code de 7 jours' : 'Inviter un élève'}</span></button>
        </div>
        <div class="group-foot">${coachPro.code ? 'Les codes de 7 jours expirent au bout d\'une semaine. ' : 'Ces codes sont valables 7 jours et servent à plusieurs élèves. '}L'élève saisit le code dans Social › Rejoindre ${coachWord('un')}.</div>
        ${removed}`;
}
// Code coach permanent, en tête des invitations : c'est lui qui va dans la bio, les codes de 7 jours viennent
// ensuite (panel v4 t1 : il n'était que dans Réglages › Coach, et le bouton principal créait des codes qui expirent)
function coachPermanentCodeHtml() {
  return coachPro.code ? coachCodeCellHtml(coachPro.code, { main: true }) : '';
}
// Carte du code coach permanent, la même dans Mes élèves › Invitations et Réglages › Coach (panel v11 t5 : coupée à
// droite en AX33 sur iPhone SE). Le code tient toujours en entier : sa taille suit la largeur (css/coach.css,
// .coach-code--fit), et sous le plancher lisible il passe à la ligne par blocs entiers (« BM5T-PRZF- » / « 3VV3 »),
// jamais au milieu d'un bloc ; le sous-titre passe à la ligne
function coachCodeCellHtml(code, { main = false } = {}) {
  const shown = formatCoachCode(code);
  const blocks = shown.split(/(?<=-)/).map(b => `<span class="coach-code__blk">${esc(b)}</span>`).join('');
  return `<div class="cell coach-code-cell${main ? ' coach-code-cell--main' : ''}">
            <span class="cell__body"><span class="cell__title coach-code coach-code--fit num">${blocks}</span><span class="cell__sub">Code permanent, à mettre dans ta bio</span></span>
            <span class="coach-code-cell__btns"><button class="coach-icon-btn coach-copy-btn" data-action="coach-copy-code" data-code="${esc(shown)}" aria-label="Copier ton code coach">${icon('doc.on.doc', 20)}</button><button class="coach-icon-btn" data-action="coach-share-invite" data-code="${esc(code)}" aria-label="Partager ton code coach">${icon('square.and.arrow.up', 20)}</button></span>
          </div>`;
}
function renderCoachStudents() {
  return `
    <div class="view view--grouped coach-students-view">
      ${navBar({ title: 'Mes élèves', large: false })}
      <div class="scr coach-team">${coachTeamHtml()}</div>
    </div>`;
}
// Arrivée sur Mes élèves (écran ou segment Élèves) : état relu, puis la progression (30 s au plus), le palier, la clé
// des photos de bilan (une fois)
function coachTeamEnter() {
  const view = currentView();
  coachAskHere = () => currentView() === view && (view !== 'friends' || friendsSeg() === 'students');
  coachRefresh().then(() => { coachProgressRefresh({ minAge: 30_000 }); coachDietOverviewRefresh({ minAge: 30_000 }); chatPushOffRefresh(); });
  if (cphCoach.key === undefined) cphCoachRefresh();   // « Recevoir les photos de bilan » proposé sous la liste
  coachProRefresh({ minAge: 30_000 });
}
// Premier élève arrivé : sur Mes élèves, une fois l'état relu (lecture déjà en cours comprise), proposer d'être
// prévenu quand un élève écrit (une fois par arrivée, js/features/push-ui.js)
let coachAskHere = null;
onCoachChange(() => {
  const here = coachAskHere;
  if (!here || !coach.state) return;
  if (!here()) { coachAskHere = null; return; }
  if (!coach.state.is_coach || !coach.state.students.length) return;
  coachAskHere = null;
  pushAskInContext('coach', here);
});
SCREENS.set('coach-students', { render: () => renderCoachStudents(), mount: () => coachWatchMore(), enter: () => { coachTeamEnter(); } });

// ── Coach : un élève et ses séances ─────────────────────────

function coachStudent(uid) { return coach.state?.students.find(s => s.user_id === uid) || null; }

// Couleur d'une séance d'élève : celle de ma séance si elle vient de mon programme, sinon comme le fil
function coachSessionColor(s) {
  const mine = coachSentIdOf(s.programme, account.user?.id);
  return (mine && data.userProgrammes?.[mine]?.sessions?.[s.category]?.color) || publicSessionColor({ ...s, programme: mine || s.programme });
}

// Séance faite avec mon programme : séries faites sur prévues et exercices prévus non faits (mon
// programme tel qu'il est sur mon appareil), sinon null
function coachPlanOf(s) {
  const mine = coachSentIdOf(s.programme, account.user?.id);
  const planned = mine && data.programmes[mine]?.exercises?.[s.category];
  if (!planned?.length) return null;
  let done = 0, total = 0;
  const missing = [];
  planned.forEach(pe => {
    total += pe.sets;
    const got = s.exercises.find(e => normName(e.name) === normName(pe.name));
    const n = got ? got.sets.length : 0;
    done += Math.min(n, pe.sets);
    if (!n) missing.push(pe.name);
  });
  return { done, total, missing };
}

// Personnage de la carte, celui de l'Historique (exercisesBodyHtml, js/features/progress-muscles.js : face et dos, muscles
// ciblés et en soutien), avec l'index vide des séances reçues (mes choix de muscles ne s'appliquent pas aux autres)
function coachSessionBodyHtml(exercises) {
  const body = exercisesBodyHtml(exercises, OTHERS_MUSCLES_INDEX, 'hcell__body-map');
  return body ? `<span class="hcell__map">${body}</span>` : '';
}
// Séance d'un élève en carte illustrée, comme l'Historique : nom, date et records, « durée · exercices » (et séries
// faites sur prévues avec mon programme), étiquettes ; personnage de l'Historique à droite (décoratif). Chevron :
// la carte s'ouvre. Texte agrandi : plus de personnage (css/screens.css).
function coachSessionCell(uid, row) {
  const s = row.s, mine = coachOwnProgrammeName(s.programme), plan = coachPlanOf(s);
  const recs = Array.isArray(s.records) ? s.records.length : 0;
  const recMark = recs ? `<span class="hcell__rec num">${medalSvg(14)}${plural(recs, 'record', 'records')}</span>` : '';
  return `
          <div class="hrow coach-sess-row"><button class="hcell hcell--card mgc coach-sess" data-action="coach-open-session" data-uid="${esc(uid)}" data-id="${esc(row.id)}">
            <span class="hcell__body mgc__text">
              <span class="hcell__title">${esc(s.label)}</span>
              <span class="hcell__when"><span class="hcell__date">${fmtDate(row.doneAt)}</span>${recMark}</span>
              <span class="hcell__sub num">${esc(publicMetaLine(s))}${plan ? ` · ${plan.done}/${plan.total} séries` : ''}</span>
              ${mine || row.note ? `<span class="coach-sess__tags">${mine ? '<span class="coach-tag">Ton programme</span>' : ''}${row.note ? '<span class="coach-tag coach-tag--note">Commentée</span>' : ''}</span>` : ''}
            </span>
            ${coachSessionBodyHtml(s.exercises)}
            ${icon('chevron.right', 16)}
          </button></div>`;
}

// Carte de tête de la fiche (refonte Coach v2) : sa dernière séance illustrée (nom, date, chiffres, records, vignette
// du groupe travaillé), qui s'ouvre si elle est chargée, puis ses 7 derniers jours en pastilles comme la semaine de
// l'accueil (aujourd'hui à droite). Mêmes données que la liste de ses séances : rien de nouveau n'est montré.
function coachStudentHeroHtml(uid) {
  const st = coachStudent(uid);
  if (!st) return '';
  const ls = st.last_session, first = coachSessions(uid).rows[0];
  const row = first && ls && first.doneAt === ls.done_at ? first : null;
  const s = row?.s;
  const mine = ls && coachOwnProgrammeName(ls.programme);
  const facts = s ? [publicMetaLine(s), reviewVolume(s.exercises) > 0 ? fmtVolume(reviewVolume(s.exercises)) : ''].filter(Boolean).join(' · ') : '';
  const recs = Array.isArray(s?.records) ? s.records.length : 0;
  const g = studentLastGroup(st);
  const when = ls ? capitalize(fmtDate(ls.done_at)).replace(/ /g, '\u00a0') : '';
  const text = `
            <span class="cstu-hero__text">
              <span class="cstu-hero__eyebrow">Dernière séance</span>
              <span class="cstu-hero__name">${ls ? esc(ls.label) : 'Pas encore de séance'}</span>
              ${ls ? `<span class="cstu-hero__info num">${esc(when)}${mine ? '<span aria-hidden="true"> · </span><span class="visually-hidden">, </span>ton programme' : ''}</span>` : ''}
              ${facts ? `<span class="cstu-hero__info num">${esc(facts)}</span>` : ''}
              ${recs ? `<span class="hcell__rec cstu-hero__rec num">${medalSvg(14)}${plural(recs, 'record', 'records')}</span>` : ''}
            </span>
            ${ls && g ? progThumbHtml(g, 'cstu-hero__img') : ''}`;
  const top = row
    ? `<button class="cstu-hero__last" data-action="coach-open-session" data-uid="${esc(uid)}" data-id="${esc(row.id)}">${text}${icon('chevron.right', 16)}</button>`
    : `<div class="cstu-hero__last">${text}</div>`;
  const days = studentDays(st);
  let week = '';
  if (days) {
    const now = Date.now();
    const dots = days.map((x, i) => {
      const d = new Date(now); d.setDate(d.getDate() - (6 - i));
      return weekDayHtml(WEEK_DAYS[(d.getDay() + 6) % 7], x > 0, i === 6);
    }).join('');
    const on = days.map((x, i) => { const d = new Date(now); d.setDate(d.getDate() - (6 - i)); return x ? WEEK_NAMES[(d.getDay() + 6) % 7] : ''; }).filter(Boolean);
    week = `
          <div class="cstu-hero__week">
            <span class="cstu-hero__week-head"><span class="cstu-hero__eyebrow">Jours de séance</span><span class="cstu-hero__count num" aria-hidden="true"><b>${days.filter(Boolean).length}</b> sur 7</span></span>
            <span class="week__days" aria-hidden="true">${dots}</span>
            <span class="visually-hidden">${on.length ? `${on.length} sur les 7 derniers jours : ${on.join(', ')}.` : 'Aucun sur les 7 derniers jours.'}</span>
          </div>`;
  }
  return `
        <div class="cstu-hero${ls && g ? '' : ' cstu-hero--noart'}">${top}${week}</div>`;
}

function renderCoachStudent(uid) {
  const p = coachStudent(uid);
  const head = navBar({ title: p ? '' : 'Élève' });   // le nom est dans l'en-tête, la barre le reprend au défilement (panel t5)
  if (!p) return `<div class="view view--grouped coach-student-view">${head}<div class="scr"><div class="empty-note">${coach.state ? 'Cette personne ne fait plus partie de tes élèves.' : 'Chargement…'}</div></div></div>`;
  const f = coachSessions(uid);
  let list;
  if (!f.rows.length) {
    list = f.loading || (!f.loadedAt && !f.error) ? '<div class="empty-note">Chargement…</div>'
      : f.error ? coachOfflineNote(f.error, 'Pas d\'Internet. Ses séances s\'afficheront quand le réseau reviendra.')
      : '<div class="empty-note">Pas encore de séance.</div>';
  } else {
    list = `<div class="group coach-sess-list">${f.rows.map(r => coachSessionCell(uid, r)).join('')}</div>
      ${f.end ? '' : `<button class="btn-more" data-action="coach-more" data-uid="${esc(uid)}" ${f.loading ? 'disabled' : ''}>${f.loading ? 'Chargement…' : 'Afficher plus'}</button>`}`;
  }
  // Programmes envoyés : pas encore ouvert, vu, pas encore de séance avec (coachSentStatus)
  const sentList = f.loadedAt || coachStudent(uid)?.sent ? coachSentStatus(uid, f.rows) : [];
  const STATE = { unseen: 'Pas encore ouvert', unused: 'Vu, pas encore de séance avec', used: 'Vu' };
  const sent = sentList.length ? `
        <div class="group-title">Programmes envoyés</div>
        <div class="group">${sentList.map(x => `
          <div class="cell coach-sent" data-prog="${esc(x.progId)}"><span class="cell__body"><span class="cell__title">${esc(coachSentName(uid, x.progId))}</span><span class="cell__sub">Envoyé le ${esc(fmtDate(x.sentAt, 'short'))}</span><span class="cell__sub coach-sent__state coach-sent__state--${x.state}">${STATE[x.state]}</span></span></div>`).join('')}</div>` : '';

  return `
    <div class="view view--grouped coach-student-view">
      ${head}
      <div class="scr">
        <div class="coach-join__who">
          ${personAvatar(p, 'l')}
          <span><span class="coach-join__name" role="heading" aria-level="1" data-echo-title>${nameBreakHtml(personName(p))}</span><span class="coach-join__sub">${sinceText(p) ? `Élève depuis le ${esc(sinceText(p))}` : 'Élève'}</span></span>
        </div>
        ${coachStudentHeroHtml(uid)}
        ${coachWeekSummaryHtml(uid)}
        ${chatCellHtml(uid)}
        ${coachPlanGroupHtml(uid)}
        <div class="group">
          <button class="cell cell--action" data-action="coach-send" data-uid="${esc(uid)}">${icon('paperplane', 20)}<span>Envoyer un programme</span></button>
        </div>
        ${sent}
        ${coachDietGroupHtml(uid)}
        ${coachDietTrackHtml(uid, esc(personName(p)))}
        ${coachBilanHtml(uid, esc(personName(p)))}
        <div class="group-title">Séances</div>
        ${list}
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="coach-remove" data-uid="${esc(uid)}">Retirer l'élève</button>
        </div>
        <div class="group-foot">Tu ne verras plus ses séances. Vos messages et tes commentaires seront supprimés. Tes codes ne fonctionneront plus pour cette personne, sauf si tu l'autorises à revenir dans Mes élèves.</div>
      </div>
    </div>`;
}
SCREENS.set('coach-student', {
  render: uid => { chartState = null; return renderCoachStudent(uid); },
  mount: () => { if ($('#exChart')) drawCharts(); },   // courbe du poids (élève qui le partage)
  // Séances et pesées partagées relues à chaque arrivée, puis séances vues (pastille et badge retirés)
  enter: () => {
    const uid = routeParams(currentRoute())[0];
    if (!uid) return;
    coachLoadSessions(uid);
    coachLoadWeights(uid);
    coachLoadMeasures(uid);
    coachLoadDiet(uid);   // suivi de la diète partagé (carte Diète)
    cphCoachRefresh().then(() => { if (cphCoach.key) cphCoachLoad(uid); });   // photos de bilan (liste chiffrée, rien d'ouvert)
    if (!plan.coach && plan.available !== false) coachPlanRefresh();   // planning (serveur sans planification : rien)
    coachProgressRefresh();   // résumé « 7 derniers jours » (5 min au plus entre deux lectures)
    coachMarkSeen(uid);
  },
});

// ── Coach : une séance d'un élève, relue en 20 secondes ─────
// De haut en bas : référence (« vs Legs du 22 oct. »), notes de l'élève (encadré orange si un mot de
// douleur), 4 cases (volume et écart, durée, séries, exercices), records battus avec l'ancienne valeur,
// exercices avec flèche contre la dernière fois que l'élève a fait CET exercice, puis le commentaire.
// Comparaisons : uniquement ses séances reçues (js/data/session-review.js), jamais les miennes.

const REVIEW_ARROW = { up: '↑', down: '↓', same: '' };
const REVIEW_SPOKEN = { up: 'en hausse', down: 'en baisse', same: 'identique' };

// Flèche d'un exercice : verte en hausse, grise sinon (jamais rouge)
function reviewTrendHtml(tr) {
  if (!tr) return '';
  // Égal : rien à l'écran (un « = » gris ne se lisait pas, vague 3-t4), « identique » dit à VoiceOver
  if (tr.dir === 'same') return '<span class="visually-hidden">, identique à la dernière fois</span>';
  const txt = `${REVIEW_ARROW[tr.dir]} ${tr.text}`;
  return `<span class="review-trend review-trend--${tr.dir} num" aria-hidden="true">${esc(txt)}</span><span class="visually-hidden">, ${REVIEW_SPOKEN[tr.dir]}${tr.dir === 'same' ? '' : ` : ${esc(tr.text)}`} depuis la dernière fois</span>`;
}
// Volume d'un exercice en petit gris ; sans charge comptée (poids du corps, charge non notée) : ses reps
function reviewExAmount(x) {
  if (x.volume > 0) return fmtVolume(x.volume);
  return measureOf(x.ex) === 'reps' && x.reps ? plural(x.reps, 'rep', 'reps') : '';
}
function reviewExerciseCell(x, xs, i) {
  const e = x.ex, amount = reviewExAmount(x);
  return `
            <div class="cell hex review-ex">
              <span class="cell__body">
                <span class="review-ex__line"><span class="hex__name">${ssTagHtml(xs, i)}${esc(e.name)}</span>${reviewTrendHtml(x.trend)}</span>
                <span class="review-ex__line"><span class="hex__sets num">${esc(sidePrefix(e, e.sets))}${coachSetsLine(e.sets, e.measure || measureOf(e), reviewSetKind(e))}</span>${amount ? `<span class="review-ex__vol num">${esc(amount)}</span>` : ''}</span>
                ${warmupText(e.sets) ? `<span class="hex__sets hex__sets--note num">${esc(warmupText(e.sets))}</span>` : ''}
                ${techLinesHtml(e)}
                ${prescGapText(e) ? `<span class="hex__sets hex__sets--note num coach-presc-gap">${esc(prescGapText(e))}</span>` : ''}
                ${reviewGripHtml(e)}
                ${rirLine(e.sets) ? `<span class="hex__sets hex__sets--note num">${esc(rirLine(e.sets))}</span>` : ''}
                ${historyNotesHtml(e)}
                ${x.prev ? `<span class="review-ex__prev num">avant ${coachSetsLine(x.prev.ex.sets, x.prev.ex.measure || measureOf(x.prev.ex), reviewSetKind(x.prev.ex))} (${esc(fmtDate(x.prev.doneAt, 'short'))})</span>` : ''}
              </span>
            </div>`;
}
// Case : valeur, libellé, puis écart éventuel (vert en hausse, gris sinon)
function reviewTile(val, lbl, delta = null, up = false) {
  return `<div class="tile"><span class="tile__val num">${val}</span><span class="tile__lbl">${lbl}</span>${delta ? `<span class="tile__delta num ${up ? 'tile__delta--up' : ''}">${delta}</span>` : ''}</div>`;
}
// Règle du volume, dite telle qu'elle est (la même chaque semaine), et étendue des comparaisons. bodyKg :
// poids du corps de l'élève à la date de la séance (il me le partage), compté dans le volume
function reviewRuleFoot(rows, complete, bodyKg = null) {
  const oldest = rows.reduce((m, r) => Math.min(m, r.doneAt), Infinity);
  const scope = complete || !Number.isFinite(oldest) ? 'ses séances reçues' : `ses séances reçues depuis le ${fmtDate(oldest, 'short')}`;
  const body = bodyKg
    ? `poids du corps compté (${fmtNum(toUnitW(bodyKg), 1)} ${unitLbl()}, sa dernière pesée partagée à cette date ; lest ajouté, aide déduite)`
    : 'poids du corps non compté (lest compris)';
  return `<div class="group-foot review-rule">Volume = charge notée × reps, sans l'échauffement, ${body}. Comparaisons avec ${scope}.</div>`;
}

function renderCoachSession(uid, id) {
  const row = coachSessionOf(uid, id), p = coachStudent(uid);
  if (!row) return `<div class="view view--grouped coach-session-view">${navBar({ title: 'Séance' })}<div class="scr"><div class="empty-note">Cette séance n'est plus disponible.</div></div></div>`;
  const s = row.s, n = seriesCount(s), mine = coachOwnProgrammeName(s.programme), plan = coachPlanOf(s);
  const f = coachSessions(uid), rv = sessionReview(row, f.rows);
  const who = esc(personName(p));
  let when = capitalize(fmtDate(row.doneAt, 'long'));
  if (s.duration) when += ` · ${fmtTime(row.doneAt)}`;
  // « 1re séance Haut » seulement si rien n'a d'« avant » : sinon la ligne contredit les exercices (panel t6)
  const vs = rv.prev ? `vs ${esc(rv.prev.s.label)} du ${esc(fmtDate(rv.prev.doneAt, 'short'))}`
    : f.end && !rv.exercises.some(x => x.prev) ? `1re séance ${esc(s.label)}` : '';
  const pain = s.notes && painInNotes(s.notes);
  const notes = s.notes ? `
        <div class="review-notes ${pain ? 'review-notes--pain' : ''}">
          <p class="review-notes__head">Notes${pain ? '<span class="review-notes__flag">À lire</span>' : ''}</p>
          <p class="hnotes">${esc(s.notes)}</p>
        </div>` : '';
  const vd = rv.volDelta;
  // Même ordre et même casse que le bilan, l'historique et la séance d'un ami : Durée, Volume, Séries
  const tiles = [
    reviewTile(s.duration ? fmtDuration(s.duration) : '—', 'Durée', s.duration && rv.durGap !== null ? fmtPct(rv.durGap) : null),
    reviewTile(rv.volume > 0 ? fmtVolume(rv.volume) : '—', 'Volume', rv.volume > 0 && vd && vd.dir !== 'same' ? fmtPct(vd.pct) : null, vd?.dir === 'up'),
    reviewTile(plan ? `${plan.done}/${plan.total}` : n, plan ? 'Séries prévues' : n > 1 ? 'Séries' : 'Série'),
    reviewTile(s.exercises.length, s.exercises.length > 1 ? 'Exercices' : 'Exercice'),
  ].join('');
  // Records notés par son app (toujours sûrs) ; séance d'une version d'avant : recalculés, seulement quand
  // toutes ses séances sont chargées (même règle que friendRecord, js/features/social-ui.js)
  const records = reviewRecordsSure(row, f.end) && rv.records.length ? `
        <div class="group-title">${rv.records.length > 1 ? 'Records' : 'Record'}</div>
        <div class="group">${rv.records.map(r => notedRecordCell(r)).join('')}</div>` : '';
  const missing = (plan?.missing || []).map(name => `
            <div class="cell hex review-ex review-ex--missing"><span class="cell__body"><span class="review-ex__line"><span class="hex__name">${esc(name)}</span><span class="review-trend num">pas fait</span></span></span></div>`).join('');
  return `
    <div class="view view--grouped coach-session-view">
      ${navBar({ title: '' })}
      <div class="scr">
        <h1 class="scr-title"><span class="hcell__dot hcell__dot--lg" style="background:${coachSessionColor(s)}" aria-hidden="true"></span>${esc(s.label)}</h1>
        <p class="scr-sub">${when}</p>
        ${vs ? `<p class="review-vs">${vs}</p>` : ''}
        ${mine ? `<p class="coach-sess__prog"><span class="coach-tag">Ton programme</span> ${esc(mine)}</p>` : ''}
        ${notes}
        <div class="tiles tiles--4">${tiles}</div>
        ${records}
        <div class="group-title">Exercices</div>
        <div class="group">
          ${rv.exercises.map((x, i) => reviewExerciseCell(x, s.exercises, i)).join('') || (missing ? '' : '<div class="cell"><span class="cell__sub">Aucun exercice</span></div>')}${missing}
        </div>
        ${missing ? '<div class="group-foot coach-missing">Exercices grisés : prévus dans ton programme, pas faits.</div>' : ''}
        ${s.hidden ? '<div class="group-foot">Séance masquée à ceux qui le suivent : tu la vois en tant que coach.</div>' : ''}
        <div class="group-title">Ton commentaire</div>
        <div class="group">
          ${row.note ? `<div class="cell"><p class="hnotes coach-note">${esc(row.note)}</p></div>` : ''}
          <button class="cell cell--action" data-action="coach-comment" data-uid="${esc(uid)}" data-id="${esc(row.id)}">${icon('pencil', 18)}<span>${row.note ? 'Modifier le commentaire' : 'Commenter'}</span></button>
        </div>
        <div class="group-foot">${who} le voit dans son historique et dans ${coachWord('Mon', myOwnCoachForm())}.</div>
        ${reviewRuleFoot(f.rows, f.end, rv.bodyKg)}
      </div>
    </div>`;
}
SCREENS.set('coach-session', { render: (uid, id) => renderCoachSession(uid, id) });

// Feuille du commentaire : champ actif dès l'ouverture (dans le geste : clavier d'iOS), compteur sur 1000,
// « Laisse vide pour retirer » seulement s'il y a déjà un commentaire
function coachTextSheet({ title, value, placeholder, max, existing, confirm = 'Envoyer' }) {
  const p = sheet({ title, confirm, focus: '#coachSheetText',
    body: `<div class="coach-sheet"><textarea class="coach-textarea" id="coachSheetText" rows="6" maxlength="${max}" placeholder="${esc(placeholder)}" aria-label="${esc(title)}" aria-describedby="coachSheetCount">${esc(value)}</textarea>
      <p class="coach-sheet__hint"><span>${existing ? 'Laisse vide pour supprimer le commentaire.' : ''}</span><span class="num coach-sheet__count" id="coachSheetCount">${String(value || '').length}/${max}</span></p></div>`,
    onConfirm: panel => panel.querySelector('#coachSheetText').value,
    // Texte changé : Annuler, le fond, Échap ou le glissé demandent avant de le perdre (panel t5), comme iOS
    onCancel: async panel => {
      if (panel.querySelector('#coachSheetText').value === String(value || '')) return true;
      const drop = await dialog({ type: 'sheet', actions: [
        { label: existing ? 'Abandonner les modifications' : 'Supprimer le brouillon', value: true, style: 'destructive' },
        { label: 'Continuer à écrire', style: 'cancel' }] });
      return drop === true;
    } });
  const ta = $('#coachSheetText');
  ta?.addEventListener('input', () => { const c = $('#coachSheetCount'); if (c) c.textContent = `${ta.value.length}/${max}`; });
  return p;
}

// ── Coach : envoyer un programme avec des consignes ─────────

// Brouillon de l'écran Envoyer : gardé sur l'appareil (retour arrière, app relancée), repris pour la même
// route ; sinon les consignes déjà données à ce programme (perso : up.consigne ; intégré : programmes[id])
function coachReadSendDraft(route) {
  try { const d = JSON.parse(localStorage.getItem(COACH_SEND_DRAFT_KEY)); return d && d.route === route && d.userId === account.user?.id ? d : null; }
  catch { return null; }
}
function coachSaveSendDraft() {
  try { if (coachSendDraft) localStorage.setItem(COACH_SEND_DRAFT_KEY, JSON.stringify({ ...coachSendDraft, userId: account.user?.id })); else localStorage.removeItem(COACH_SEND_DRAFT_KEY); }
  catch { /* brouillon facultatif */ }
}
function coachSendDraftFor(route) {
  if (coachSendDraft?.route === route) return coachSendDraft;
  const kept = coachReadSendDraft(route);
  if (kept) { coachSendDraft = { route, prog: String(kept.prog || ''), ex: kept.ex && typeof kept.ex === 'object' ? kept.ex : {}, presc: kept.presc && typeof kept.presc === 'object' ? kept.presc : {} }; return coachSendDraft; }
  const [uid, progId] = routeParams(route);
  const ex = {};
  progSessionsOf(data, progId).forEach(s => {
    ex[s.key] = {};
    (data.programmes[progId]?.exercises?.[s.key] || []).forEach(e => { ex[s.key][e.id] = e.consigne || ''; });
  });
  // Charge et reps prescrites : celles de mon dernier envoi de ce programme à cet élève (js/data/coach-presc.js)
  coachSendDraft = { route, prog: data.userProgrammes?.[progId]?.consigne || data.programmes[progId]?.consigne || '', ex, presc: coachPrescFor(uid, progId) };
  return coachSendDraft;
}

function renderCoachSend(uid, progId) {
  const p = coachStudent(uid);
  const name = progMeta(progId).name;
  const dr = coachSendDraftFor(currentRoute());
  const sessions = progSessionsOf(data, progId);
  const who = esc(personName(p));
  const ta = (attrs, value, label, ph, cls = '') => `<textarea class="coach-textarea coach-textarea--inline ${cls}" rows="1" maxlength="${CONSIGNE_MAX}" ${attrs} aria-label="${esc(label)}" placeholder="${esc(ph)}">${esc(value)}</textarea>`;
  const groups = sessions.map(s => {
    const xs = data.programmes[progId]?.exercises?.[s.key] || [];
    return `
        <div class="group-title">${esc(s.label)}</div>
        <div class="group">${xs.length ? xs.map((e0, i) => {
          // Reps prescrites à cet élève (js/data/coach-presc.js) à la place de celles du programme
          const e = applyCoachPresc({ ...e0 }, dr.presc?.[s.key]?.[e0.id]);
          return `
          <div class="cell coach-send-ex">
            <span class="cell__body">
              <span class="cell__title">${ssTagHtml(xs, i)}${esc(e.name)}</span>
              <span class="cell__sub num">${[setsRepsHtml(e), ...[...coachExPlanParts(e), ...(e.rest ? [`repos ${fmtRest(e.rest)}`] : []), ...(e.tempo ? [`tempo ${shortTempo(e.tempo)}`] : [])].map(esc)].join(' · ')}</span>
              ${gripSubHtml(e)}
              ${coachPrescBtnHtml(uid, progId, s.key, e)}
              ${ta(`data-cat="${esc(s.key)}" data-ex="${esc(e.id)}"`, dr.ex[s.key]?.[e.id] || '', `Consigne pour ${e.name}`, 'Consigne (facultative)')}
            </span>
          </div>`;
        }).join('') : '<div class="cell"><span class="cell__sub">Aucun exercice</span></div>'}
        </div>`;
  }).join('');
  return `
    <div class="view view--grouped coach-send-view">
      ${navBar({ title: 'Envoyer', large: false })}
      <div class="scr">
        <h1 class="scr-title">${esc(name)}</h1>
        <p class="scr-sub">Pour ${who} · ${plural(sessions.length, 'séance', 'séances')}</p>
        <div class="group-title">Consigne du programme</div>
        <div class="group group--pad">${ta('data-prog="1"', dr.prog, 'Consigne du programme', 'Ex : 3 séances par semaine', 'coach-textarea--prog')}</div>
        <div class="group-foot">Facultative, gardée pour les prochains envois. ${who} la voit dans le programme et en séance.</div>
        ${groups}
        <button class="btn btn--primary btn--full coach-send-btn" data-action="coach-send-go" data-uid="${esc(uid)}" data-prog="${esc(progId)}">Envoyer à ${who}</button>
        ${(coach.state?.students.length || 0) > 1 ? `<div class="group coach-send-many-group"><button class="cell cell--nav" data-action="coach-send-many" data-uid="${esc(uid)}" data-prog="${esc(progId)}">
            <span class="coach-cell__icon" aria-hidden="true">${icon('person.2', 20)}</span><span class="cell__body"><span class="cell__title">Envoyer à plusieurs élèves</span><span class="cell__sub">Mêmes consignes, la charge prescrite à chacun</span></span>${icon('chevron.right', 16)}</button></div>` : ''}
        <div class="group-foot">Seules les charges que tu prescris sont envoyées, pas tes propres charges, records ni historique. Pour changer une charge d'une semaine à l'autre, modifie-la et renvoie le programme : il se met à jour chez l'élève.</div>
      </div>
    </div>`;
}
SCREENS.set('coach-send', { render: (uid, progId) => renderCoachSend(uid, progId) });

// ── Envoi à plusieurs élèves (Programme › Envoyer › Envoyer à plusieurs élèves) ──
// Route coach-send-many:UID:PROG, UID = l'élève d'où l'on vient (coché d'office). Mêmes consignes que l'écran Envoyer
// (son brouillon) ; charges et reps : celles prescrites à chaque élève lors de son dernier envoi de ce programme
// (coachPrescFor), celles du brouillon pour l'élève d'origine. Un appel coach_send_programme par élève, 4 à la fois ;
// la limite du serveur (30 + 2 par élève sur 24 h) est dite avant, et un refus arrête l'envoi en disant la vraie durée.
let coachMany = null;   // { key, ids: Set, q, busy, done }
function coachManyFor(uid, progId) {
  const key = `${uid}/${progId}`;
  if (coachMany?.key !== key) coachMany = { key, ids: new Set(coachStudent(uid) ? [uid] : []), q: '', busy: false, done: 0 };
  return coachMany;
}
function coachManyRowsHtml(m) {
  const q = normName(m.q);
  const list = (coach.state?.students || []).slice().sort((a, b) => personName(a).localeCompare(personName(b), 'fr'))
    .filter(st => !q || normName(personName(st)).includes(q));
  return list.map(st => {
    const on = m.ids.has(st.user_id);
    return `<button class="cell coach-pick${on ? ' coach-pick--on' : ''}" role="checkbox" aria-checked="${on}" data-action="coach-many-pick" data-uid="${esc(st.user_id)}" ${m.busy ? 'disabled' : ''}>
            <span class="coach-pick__box" aria-hidden="true">${on ? icon('checkmark', 14) : ''}</span>${personAvatar(st, 's')}
            <span class="cell__body"><span class="cell__title">${nameBreakHtml(personName(st))}${pushOffMarkHtml(st.user_id)}</span></span>
          </button>`;
  }).join('') || '<div class="cell"><span class="cell__sub social-empty">Aucun élève ne correspond.</span></div>';
}
function coachManyBtnText(m) {
  if (m.busy) return `Envoi… ${m.done} sur ${m.ids.size}`;
  return m.ids.size ? `Envoyer à ${plural(m.ids.size, 'élève', 'élèves')}` : 'Choisis des élèves';
}
function renderCoachSendMany(uid, progId) {
  const m = coachManyFor(uid, progId), all = coach.state?.students || [];
  const allOn = all.length > 0 && all.every(st => m.ids.has(st.user_id));
  const limit = coachSendLimit(all.length);
  return `
    <div class="view view--grouped coach-send-many-view">
      ${navBar({ title: 'Plusieurs élèves', large: false })}
      <div class="scr">
        <h1 class="scr-title">${esc(progMeta(progId).name)}</h1>
        <p class="scr-sub">Mêmes consignes que pour ${esc(personName(coachStudent(uid)))}. Charge : la dernière que tu as prescrite à chaque élève.</p>
        ${all.length >= COACH_SEARCH_FROM ? `<div class="social-search"><span class="social-search__icon" aria-hidden="true">${icon('magnifyingglass', 17)}</span><input type="search" id="coachManySearch" maxlength="${SEARCH_MAX}" class="search social-search__input" placeholder="Rechercher un élève" aria-label="Rechercher un élève par son pseudo"
            autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search" value="${esc(m.q)}"></div>` : ''}
        <div class="group">
          <button class="cell coach-pick coach-pick--all${allOn ? ' coach-pick--on' : ''}" role="checkbox" aria-checked="${allOn}" data-action="coach-many-all" ${m.busy ? 'disabled' : ''}>
            <span class="coach-pick__box" aria-hidden="true">${allOn ? icon('checkmark', 14) : ''}</span>
            <span class="cell__body"><span class="cell__title">Tous</span></span><span class="cell__value num">${all.length}</span>
          </button>
        </div>
        <div class="group" id="coachManyRows">${coachManyRowsHtml(m)}</div>
        <div class="group-foot">Limite d'envoi : ${limit} sur 24 heures (30, plus 2 par élève). Un programme déjà envoyé est mis à jour chez l'élève.</div>
        <button class="btn btn--primary btn--full coach-send-btn" id="coachManyGo" data-action="coach-many-go" data-uid="${esc(uid)}" data-prog="${esc(progId)}" ${m.busy || !m.ids.size ? 'disabled' : ''}>${esc(coachManyBtnText(m))}</button>
      </div>
    </div>`;
}
SCREENS.set('coach-send-many', { render: (uid, progId) => renderCoachSendMany(uid, progId) });
document.addEventListener('input', e => {
  if (e.target.id !== 'coachManySearch' || !coachMany) return;
  coachMany.q = e.target.value;
  const rows = $('#coachManyRows');
  if (rows) rows.innerHTML = coachManyRowsHtml(coachMany);
});
// Consignes de l'envoi gardées dans mon programme (perso : up.consigne ; intégré : programmes[id].consigne) : le
// prochain envoi les reprend
function coachKeepConsignes(prog, dr) {
  const c = cleanConsigne(dr.prog), up = data.userProgrammes?.[prog], pd = data.programmes[prog] ||= makeProgData(prog);
  if (up) { if (c) up.consigne = c; else delete up.consigne; }
  else if (c) pd.consigne = c; else delete pd.consigne;
  Object.entries(dr.ex).forEach(([cat, mm]) => (pd.exercises?.[cat] || []).forEach(x => {
    if (!(x.id in mm)) return;
    const xc = cleanConsigne(mm[x.id]);
    if (xc) x.consigne = xc; else delete x.consigne;
  }));
  save();
}
// Envoi à chacun, 4 à la fois ; arrêté au premier refus de limite. → { sent: [uid], failed: [{ uid, kind }], rate }
async function coachSendMany(uids, progId, dr, origin) {
  return coachSendQueue(uids, async uid => {
    const presc = uid === origin ? dr.presc || {} : coachPrescFor(uid, progId);
    const r = await coachSendProgramme(uid, progId, { prog: dr.prog, ex: dr.ex, presc });
    if (r.ok) coachPrescRemember(uid, progId, presc);
    return r;
  }, { onStep: n => { if (coachMany) { coachMany.done = n; const b = $('#coachManyGo'); if (b) b.textContent = coachManyBtnText(coachMany); } } });
}

// Charge et reps prescrites d'un exercice (écran coach-presc, js/features/coach-presc-ui.js) : « Charge : 60 kg × 8 ·
// Modifier », sinon « Prescrire une charge » ; lien en orange, comme les autres actions
function coachPrescBtnHtml(uid, progId, cat, e) {
  if (measureOf(e) !== 'reps') return '';
  const txt = prescText(e);
  return `<button class="coach-presc-btn num" data-action="coach-presc-open" data-uid="${esc(uid)}" data-prog="${esc(progId)}" data-cat="${esc(cat)}" data-ex="${esc(e.id)}"
    aria-label="${txt ? `Charge prescrite à ${esc(e.name)} : ${esc(prescSpoken(e))}. Modifier` : `Prescrire une charge et des reps pour ${esc(e.name)}`}">${txt ? `<span class="coach-presc-btn__val">Charge : ${esc(txt)}</span><span class="coach-presc-btn__act" aria-hidden="true">Modifier</span>` : 'Prescrire une charge'}</button>`;
}


// ── Partage d'un code d'invitation ──────────────────────────

async function shareCoachInvite(code) {
  const text = coachInviteText(code);
  if (Native.isNative) { if ((await Native.shareText(text, 'Invitation')) === 'failed') showToast('Partage impossible', { error: true }); return; }
  if (navigator.share) { try { await navigator.share({ text }); } catch {} return; }
  try { await navigator.clipboard.writeText(text); showToast('Invitation copiée, colle-la dans un message'); }
  catch { showToast(`Code : ${code}`); }
}

// Pseudo obligatoire pour rejoindre un coach (le coach reconnaît son élève à son pseudo), comme pour les
// amis : sans pseudo, explication puis écran du pseudo (texte du coach). force : le serveur l'a demandé
async function coachEnsureUsername(force = false) {
  if (account.profile?.username && !force) return true;
  const go = await dialog({ title: 'Choisis un pseudo', message: `Le pseudo permet à ${coachWord('ton')} de te reconnaître.`,
    actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Choisir', value: true, style: 'preferred' }] });
  if (go !== true) return false;
  await openAuthFlow({ step: 'username', mode: 'profile', context: 'coach' });
  return !!account.profile?.username;
}

// ── Actions ─────────────────────────────────────────────────

registerActions({
  'coach-open-settings': () => navigate('coach'),
  'coach-open-students': () => navigate('coach-students'),
  'coach-open-mine': () => navigate('coach-mine'),
  'coach-retry': async () => {
    await coachRefresh();
    const v = currentView();
    if (v === 'coach-student') coachLoadSessions(routeParams(currentRoute())[0]);
  },
  'coach-join': async () => { await coachJoinFlow(); },
  'coach-join-start': async () => { await coachJoinFlow(); },
  'coach-age': () => { socialAgeOk = !socialAgeOk; haptic(); render(); },
  'coach-accept': async (e, el) => {
    if (!socialAgeOk || coachJoinHiddenByAge()) return;
    el.disabled = true;
    const name = personName(coach.preview?.person), uid = coach.preview?.person?.user_id;
    const r = await coachJoin(el.dataset.code);
    if (!coachToast(r)) { el.disabled = false; return; }
    haptic();
    // Lien fait : la forme du coach se lit maintenant (« Léa est ta coach »), attendue 1,5 s au plus
    const pf = await coachFormAwait(uid);
    goBack();
    await dialog({ title: `${name} est ${coachWord('ton', pf)}`, message: `Les programmes ${elide('de', name)} arriveront dans Social › ${coachWord('Mon', pf)}.`,
      actions: [{ label: 'OK', style: 'preferred' }] });
    // Couvert par son coach alors qu'il a son propre abonnement ou essai chez Apple : le lui dire (paywall-ui.js)
    await payDoubleAfterJoin();
    // Lien accepté : proposer d'être prévenu quand le coach écrit (une fois, js/features/push-ui.js)
    pushAskInContext('student');
  },
  'coach-leave': async () => {
    const name = coachName();
    const lost = (coach.inbox?.programmes || []).filter(p => coachStatus(p).status === 'new').map(p => `« ${p.data.name} »`);
    const extra = lost.length ? ` ${lost.length > 1 ? `Les programmes ${lost.join(', ')} que tu n'as pas ajoutés seront perdus.` : `Le programme ${lost[0]} que tu n'as pas ajouté sera perdu.`}` : '';
    if (!(await confirmSheet(`Quitter ${name} ?`, `${name} ne verra plus tes séances. Ses commentaires et vos messages seront supprimés. Les programmes ajoutés restent chez toi.${extra}`, `Quitter ${myCoachWord('mon')}`))) return;
    const me = account.user?.id;
    const r = await coachLeave();
    if (!coachToast(r, `Tu ne suis plus ${name}`)) return;
    cphForgetAll(me);   // photos de bilan : lignes effacées par le serveur, fichiers de mon dossier aussi
    if (currentView() === 'coach-mine') goBack(); else render();
  },
  'coach-lost-ok': () => { coachSetLost(null); refreshCoachCell(); },
  'coach-add-prog': async (e, el) => { await addCoachProgrammeFlow(el.dataset.id); },
  'coach-take-prog': async (e, el) => { await addCoachProgrammeFlow(el.dataset.id, { take: true }); },
  // Carte de tête de Mon coach : la carte du programme sous la barre de navigation, son titre annoncé par VoiceOver
  'coach-prog-jump': (e, el) => {
    const card = document.getElementById(`coach-prog-${el.dataset.id}`);
    if (!card) return;
    window.scrollTo(0, Math.max(0, card.getBoundingClientRect().top + window.scrollY - ($('.navbar')?.offsetHeight || 0) - 8));
    const h = card.querySelector('.coach-prog__name');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  },
  'coach-prog-toggle': (e, el) => { const id = el.dataset.id; if (coachProgOpen.has(id)) coachProgOpen.delete(id); else coachProgOpen.add(id); render(); },
  'coach-dismiss-prog': (e, el) => { coachMarkInboxSeen('programme', el.dataset.id); render(); showToast(`Il reste dans Social › ${myCoachWord('Mon')}`); },
  'coach-dismiss-note': (e, el) => { coachMarkInboxSeen('note', el.dataset.id); render(); showToast(`Il reste dans Social › ${myCoachWord('Mon')}`); },
  'coach-open-history': (e, el) => navigate(makeRoute('history-detail', el.dataset.id)),
  'coach-tip': (e, el) => {
    const id = el.dataset.ex;
    if (coachTipClosed.has(id)) coachTipClosed.delete(id); else coachTipClosed.add(id);
    render();
  },
  'coach-invite': async (e, el) => {
    if (coachInviteBusy) return;
    coachInviteBusy = true;
    if (el) el.disabled = true;
    try {
      const r = await coachCreateInvite();
      if (!coachToast(r)) return;
      haptic();
      await shareCoachInvite(r.data);
    } finally { coachInviteBusy = false; if (currentView() === 'coach-students') render(); else refreshCoachCell(); }
  },
  'coach-share-invite': async (e, el) => { await shareCoachInvite(el.dataset.code); },
  // Code seul, pour la bio : confirmé sur le bouton lui-même (coche 2 s, « Code copié » pour VoiceOver), pas par un
  // toast posé sur la liste
  'coach-copy-code': async (e, el) => {
    const code = el.dataset.code;
    try { await navigator.clipboard.writeText(code); }
    catch { showToast(`Code : ${code}`); return; }
    haptic();
    announce('Code copié');
    el.innerHTML = icon('checkmark', 20);
    el.setAttribute('aria-label', 'Code copié');
    clearTimeout(el._copied);
    el._copied = setTimeout(() => { if (el.isConnected) { el.innerHTML = icon('doc.on.doc', 20); el.setAttribute('aria-label', 'Copier ton code coach'); } }, 2000);
  },
  'coach-revoke-invite': async (e, el) => {
    if (!(await confirmSheet(`Supprimer le code ${el.dataset.code} ?`, 'Il ne fonctionnera plus. Tes élèves actuels restent suivis.', 'Supprimer le code'))) return;
    coachToast(await coachRevokeInvite(el.dataset.code), 'Code supprimé', { inline: true });
  },
  'coach-open-student': (e, el) => navigate(makeRoute('coach-student', el.dataset.uid)),
  'coach-filter': (e, el) => {
    const f = COACH_FILTERS.some(([k]) => k === el.dataset.filter) ? el.dataset.filter : 'all';
    if (f === coachFilter) return;
    coachFilter = f;
    coachShownN = COACH_ROWS_PAGE;
    haptic();
    coachRefreshRows();
  },
  'coach-more-rows': () => coachShowMoreRows(),
  'coach-send-many': (e, el) => { coachMany = null; navigate(makeRoute('coach-send-many', el.dataset.uid, el.dataset.prog)); },
  'coach-many-pick': (e, el) => {
    if (!coachMany || coachMany.busy) return;
    const id = el.dataset.uid;
    if (coachMany.ids.has(id)) coachMany.ids.delete(id); else coachMany.ids.add(id);
    haptic();
    render();
  },
  'coach-many-all': () => {
    if (!coachMany || coachMany.busy) return;
    const all = coach.state?.students || [];
    const allOn = all.every(st => coachMany.ids.has(st.user_id));
    coachMany.ids = new Set(allOn ? [] : all.map(st => st.user_id));
    haptic();
    render();
  },
  'coach-many-go': async (e, el) => {
    const m = coachMany, { uid, prog } = el.dataset;
    if (!m || m.busy || !m.ids.size) return;
    const ids = [...m.ids].filter(id => coachStudent(id));
    const limit = coachSendLimit();
    if (ids.length > limit) {
      await dialog({ title: 'Trop d\'élèves d\'un coup', message: `La limite est de ${limit} envois sur 24 heures (30, plus 2 par élève). Décoche ${plural(ids.length - limit, 'élève', 'élèves')}.`, actions: [{ label: 'OK', style: 'preferred' }] });
      return;
    }
    const dr = coachSendDraftFor(makeRoute('coach-send', uid, prog));
    m.busy = true; m.done = 0;
    render();
    const r = await coachSendMany(ids, prog, dr, uid);
    m.busy = false;
    if (r.sent.length) { coachKeepConsignes(prog, dr); haptic(); }
    const name = progMeta(prog).name;
    if (!r.failed.length) {
      showToast(`« ${name} » envoyé à ${plural(r.sent.length, 'élève', 'élèves')}`);
      coachSendDraft = null; coachSaveSendDraft(); coachMany = null;
      const back = makeRoute('coach-student', uid);
      if (nav.stacks[nav.tab].includes(back)) routeTo(back); else goBack();
      coachRefresh();
      return;
    }
    // Échecs : les élèves déjà servis sont décochés, il reste ceux à refaire
    r.sent.forEach(id => m.ids.delete(id));
    const rest = r.failed.length + r.left;
    const why = r.rate ? coachErrorText('send_rate') : coachErrorText(r.failed[0].kind);
    await dialog({ title: r.sent.length ? `Envoyé à ${r.sent.length} sur ${ids.length}` : 'Rien n\'a été envoyé',
      message: `${why} ${plural(rest, 'élève reste coché', 'élèves restent cochés')} pour un nouvel essai.`, actions: [{ label: 'OK', style: 'preferred' }] });
    render();
    coachRefresh();
  },
  'coach-open-session': (e, el) => navigate(makeRoute('coach-session', el.dataset.uid, el.dataset.id)),
  'coach-more': (e, el) => { coachLoadSessions(el.dataset.uid, { more: true }); },
  'coach-remove': async (e, el) => {
    const name = personName(coachStudent(el.dataset.uid));
    if (!(await confirmSheet(`Retirer ${name} ?`, `Tu ne verras plus ses séances. Tes commentaires, vos messages et les programmes non ajoutés seront supprimés. ${name} ne pourra revenir que si tu l'autorises dans Mes élèves.`, 'Retirer l\'élève'))) return;
    const r = await coachRemoveStudent(el.dataset.uid);
    if (!coachToast(r, `${name} ne fait plus partie de tes élèves`)) return;
    // Retour à Mes élèves : l'écran s'il est dans la pile (Réglages › Coach), sinon le segment Élèves de l'onglet
    if (nav.stacks[nav.tab].includes('coach-students')) routeTo('coach-students'); else routeToStudents();
  },
  'coach-allow': async (e, el) => {
    const p = (coach.state?.removed || []).find(x => x.user_id === el.dataset.uid);
    el.disabled = true;
    coachToast(await coachAllowStudent(el.dataset.uid), `${personName(p)} peut revenir avec un de tes codes`, { inline: true });
    render();
  },
  'coach-comment': async (e, el) => {
    const { uid, id } = el.dataset;
    const row = coachSessionOf(uid, id);
    if (!row) return;
    const key = uid + '/' + id;
    const value = coachNoteDraft?.key === key ? coachNoteDraft.text : row.note;
    const text = await coachTextSheet({ title: row.note ? 'Modifier' : 'Commenter', value, existing: !!row.note,
      placeholder: 'Ex : garde 2 minutes de repos sur le squat.', max: COACH_NOTE_MAX });
    if (text === null) return;
    const r = await coachSetNote(uid, id, text);
    // Échec (hors ligne) : le texte est gardé pour le prochain essai
    coachNoteDraft = r.ok ? null : { key, text };
    if (coachToast(r, text.trim() ? 'Commentaire envoyé' : 'Commentaire supprimé', { inline: true })) haptic();
    render();
  },
  'coach-send': async (e, el) => {
    const uid = el.dataset.uid, ids = coachSendableProgrammes();
    if (!ids.length) { showToast('Crée d\'abord un programme dans l\'onglet Programme.'); return; }
    const progId = await dialog({ type: 'sheet', title: 'Envoyer un programme', message: `Choisis un de tes programmes pour ${personName(coachStudent(uid))}.`,
      actions: [...ids.map(id => ({ label: progMeta(id).name, value: id })), { label: 'Annuler', style: 'cancel' }] });
    if (!progId) return;
    navigate(makeRoute('coach-send', uid, progId));
  },
  'coach-send-go': async (e, el) => {
    const { uid, prog } = el.dataset;
    const dr = coachSendDraftFor(currentRoute());
    el.disabled = true;
    const r = await coachSendProgramme(uid, prog, { prog: dr.prog, ex: dr.ex, presc: dr.presc || {} });
    if (!coachToast(r, `Programme envoyé à ${personName(coachStudent(uid))}`, { inline: true })) { el.disabled = false; return; }
    coachKeepConsignes(prog, dr);
    coachPrescRemember(uid, prog, dr.presc || {});   // repris au prochain envoi à cet élève (js/data/coach-presc.js)
    haptic();
    coachSendDraft = null;
    coachSaveSendDraft();
    goBack();
    coachRefresh();   // « Programmes envoyés » : « Pas encore ouvert » tout de suite, renvoi compris
  },
});

// Saisie des consignes : recopiées dans le brouillon (gardé sur l'appareil), sans redessiner
document.addEventListener('input', e => {
  const t = e.target;
  if (!t.matches?.('.coach-send-view .coach-textarea') || !coachSendDraft) return;
  if (t.dataset.prog) coachSendDraft.prog = t.value;
  else if (t.dataset.cat && t.dataset.ex) (coachSendDraft.ex[t.dataset.cat] ||= {})[t.dataset.ex] = t.value;
  coachSaveSendDraft();
});

// ── Mises à jour de l'écran ─────────────────────────────────

// Ce que les écrans hors coach montrent du coach (cartes de l'accueil, marques de l'Historique, cellule
// des Réglages…) : ils ne sont redessinés que si cette signature change, jamais pendant une saisie
function coachShownKey() {
  const ib = coach.inbox;
  return JSON.stringify([account.user?.id || null, coachRole(), coachBadge(), coachBadgeCoach(), coachBadgeStudent(), chatUnreadTotal(), chat.available, myCoach()?.user_id || null, myCoach()?.username || null,
    coach.state?.students.length ?? null, account.user ? coachLost() : null, typeof coachShareSummary === 'function' ? coachShareSummary() : null,
    // '' avant comme après le chargement de coach-plan-ui.js (chargé après ce fichier) : sinon la signature
    // calculée au démarrage (coachShown) diffère de la suivante, et le premier focusout redessine l'écran,
    // ce qui, sur WebKit, annule la navigation du clic en cours
    (typeof studentPlanSub === 'function' ? studentPlanSub() : '') || '',
    ib ? [ib.programmes.map(p => [p.id, p.sentAt, p.seen, !!p.meta]), (ib.diets || []).map(p => [p.id, p.sentAt, p.seen, !!p.meta]), ib.notes.map(n => [n.session_id, n.updatedAt, n.seen])] : null]);
}
let coachShown = null;
function coachTyping() { return !!document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]'); }
// coachShown n'avance QUE lorsque l'écran a été redessiné (ou n'avait rien à redessiner) : un changement
// arrivé pendant une saisie reste « non affiché » et sera repris au focusout, pas marqué « déjà vu »
const COACH_WATCH_VIEWS = ['settings', 'dashboard', 'history', 'history-detail', 'editor', 'programmes', 'my-programmes', 'summary', 'nutrition', 'diet-plans'];
// Écran du coach après une donnée relue : redessiné seulement s'il change (renderIfChanged, js/ui/router.js). Sans
// redessin, la courbe affichée garde son état (chartState, posé par le gabarit, complété par drawCharts au montage)
function coachRepaint() {
  const chart = chartState;
  if (!renderIfChanged()) chartState = chart;
}
function coachApplyChange() {
  const v = currentView(), key = coachShownKey();
  // Onglet Social : cellules redessinées si ce qu'elles montrent a changé ; segment Élèves (compte coach) à chaque
  // nouveauté du coach (progression, planning, palier : hors de la signature), sans champ de saisie à préserver
  if (v === 'friends') { if (key !== coachShown || friendsSeg() === 'students') { refreshCoachCell(); coachShown = key; } return; }
  if (coachTyping()) return;   // champ en cours de saisie : rendu reporté au focusout (coachShown gardé)
  if (COACH_VIEWS.includes(v)) { coachRepaint(); coachShown = key; return; }
  if (key !== coachShown && COACH_WATCH_VIEWS.includes(v)) { render(); coachShown = key; return; }
  coachShown = key;   // écran sans rapport : à jour sans redessin
}
// Repère initialisé au démarrage : sinon, pour un compte sans coach, coachShown reste null et le tout
// premier focusout (par ex. le clic qui ouvre une séance) croit qu'il y a du nouveau et redessine
// l'écran, ce qui, sur WebKit, passe avant la navigation du clic et l'annule.
coachShown = coachShownKey();
onCoachChange(() => { updateTabBadge(); coachApplyChange(); });
// Fin d'une saisie : un changement arrivé pendant la frappe est redessiné maintenant (activeElement
// mis à jour au tour suivant)
document.addEventListener('focusout', () => { if (coachShownKey() !== coachShown) setTimeout(coachApplyChange, 0); });
// Connexion, déconnexion : les cellules de l'onglet Social changent de forme
onAccountChange(() => { if (currentView() === 'friends') refreshCoachCell(); });
