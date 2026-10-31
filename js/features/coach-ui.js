// ═══════════════════════════════════════════════════════════
//  Coach (Coach V1), écrans. Contrat : docs/COACH_V1.md ; données et appels : js/data/coach.js.
//
//  - Onglet Amis (pour tout le monde, même sans avoir activé Amis) : en haut, « Rejoindre un coach », ou
//    « Mes élèves » / « Mon coach » avec leur badge (coachCellHtml, appelée par js/features/social-ui.js).
//  - Réglages › Coach (`coach`) : même parcours (code, aperçu `coach-join:CODE`, « J'ai 15 ans ou plus »,
//    « Accepter »), le coach suivi et « Quitter mon coach », accès à « Mes élèves ».
//  - Élève : Mon coach (`coach-mine` : commentaires, programmes reçus avec aperçu des exercices), cartes de
//    l'accueil (programme reçu, commentaire), consignes dans Programme, Programme › Séance et la séance
//    (repliables), commentaire dans Historique (marque dans la liste, détail), notes vues du coach (bilan).
//  - Coach : Mes élèves (`coach-students` : nouvelles séances, invitations, élèves retirés), un élève
//    (`coach-student:UID` : séances, séries faites sur prévues, programmes envoyés pas encore utilisés),
//    une séance (`coach-session:UID:ID` : relecture comparée à ses séances reçues, exercices prévus non faits,
//    « Commenter »), envoi d'un programme avec consignes (`coach-send:UID:PROG`, brouillon gardé sur l'appareil).
//  Tout texte venu du serveur passe par esc() ; les pseudos passent par elide() (« d'essai »). Rien au
//  pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_VIEWS = ['coach', 'coach-join', 'coach-mine', 'coach-students', 'coach-student', 'coach-session', 'coach-send'];
const COACH_SEND_DRAFT_KEY = 'mdlf_coach_send_draft';   // brouillon de l'écran Envoyer (retour arrière, relance)
const coachTipClosed = new Set();   // séance en cours : consignes repliées (identifiant d'exercice, '' : programme)
const coachProgOpen = new Set();    // Mon coach : programmes reçus dont les exercices sont dépliés
let coachSendDraft = null;          // écran d'envoi : { route, prog, ex: { [cat]: { [exId]: texte } } }
let coachNoteDraft = null;          // commentaire pas envoyé (hors ligne) : { key, text }, repris à la réouverture
let coachInviteBusy = false;        // « Inviter un élève » : un seul code par toucher

// ── Petits gabarits ─────────────────────────────────────────

function coachName() { return personName(myCoach()); }
// État d'un programme reçu de mon coach actuel (js/data/coach.js : coachProgrammeStatus)
function coachStatus(item) { return coachProgrammeStatus(data, item, myCoach()?.user_id || null); }
function coachBadgeHtml(n, label) {
  return n ? `<span class="coach-count num" aria-hidden="true">${n > 99 ? '99+' : n}</span><span class="visually-hidden">, ${esc(label)}</span>` : '';
}
// « Push · ton programme · hier » (dernière séance d'un élève)
function studentLastLine(st) {
  const ls = st.last_session;
  if (!ls) return 'Aucune séance pour l\'instant';
  const mine = coachOwnProgrammeName(ls.programme);
  return [ls.label, mine ? 'ton programme' : '', fmtDate(ls.done_at).toLowerCase()].filter(Boolean).join(' · ');
}
function coachOfflineNote(kind, what) {
  return `<div class="social-note" role="status"><p>${kind === 'offline' ? what : esc(coachErrorText(kind))}</p><button class="social-note__btn" data-action="coach-retry">Réessayer</button></div>`;
}
function coachToast(r, okText) {
  if (r.ok) { if (okText) showToast(okText); return true; }
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
  return { coach: 'Coach', 'coach-join': 'Coach', 'coach-mine': 'Mon coach', 'coach-students': 'Mes élèves', 'coach-session': 'Séance', 'coach-send': 'Envoyer' }[name] || null;
}

// ── Cellules : Réglages et onglet Amis ──────────────────────

// Réglages › Amis et coach : la cellule Coach, puis « Séances visibles par défaut » (js/features/social-ui.js,
// seulement quand Amis est activé)
function renderCoachSettingsGroup() {
  if (!accountAvailable()) return '';
  const { isCoach, hasCoach } = coachRole();
  const value = hasCoach ? esc(coachName()) : isCoach ? 'Mes élèves' : account.user ? 'Rejoindre' : '';
  return `
        <div class="group-title">Amis et coach</div>
        <div class="group">
          <button class="cell cell--nav" data-action="coach-open-settings">
            <span class="cell__body"><span class="cell__title">Coach</span></span>
            <span class="cell__value">${value}</span>
            ${icon('chevron.right', 16)}
          </button>${socialDefaultVisibleCell()}${pushSettingsCell()}
        </div>`;
}

// En haut de l'onglet Amis : « Rejoindre un coach » pour tout le monde, sinon Mes élèves / Mon coach.
// Coach perdu (retiré, ou parti depuis un autre appareil) : une ligne pour le dire, une fois
// place : 'top' (en haut de l'onglet) ou 'low' (sous la carte d'activation des amis) ; la cellule
// « Rejoindre un coach » seule passe dessous tant que la carte d'activation est affichée (friends : état de l'onglet)
function coachCellHtml({ place = 'top', friends = null } = {}) {
  if (!accountAvailable()) return '';
  const joinOnly = !(account.user && (coachRole().isCoach || coachRole().hasCoach)) && !(account.user && coachLost());
  const low = joinOnly && friends === 'off';
  if ((place === 'low') !== low) return '';
  const { isCoach, hasCoach } = account.user ? coachRole() : { isCoach: false, hasCoach: false };
  const rows = [];
  const lost = account.user && !hasCoach ? coachLost() : null;
  if (lost) {
    rows.push(`<div class="cell coach-lost" role="status">
        <span class="cell__body"><span class="cell__title">Tu ne suis plus ${esc(lost)}</span><span class="cell__sub">Ses commentaires sont effacés. Les programmes ajoutés restent chez toi.</span></span>
        <button class="social-x" data-action="coach-lost-ok" aria-label="OK, fermer">${icon('xmark', 14)}</button>
      </div>`);
  }
  if (isCoach) {
    const st = coach.state, n = st ? st.students.length : null, badge = coachBadgeCoach();
    const sub = n === null ? '' : n ? plural(n, 'élève', 'élèves') : 'Invite ton premier élève';
    rows.push(`<button class="cell cell--nav coach-cell" data-action="coach-open-students">
        <span class="coach-cell__icon" aria-hidden="true">${icon('person.2', 20)}</span>
        <span class="cell__body"><span class="cell__title">Mes élèves</span>${sub ? `<span class="cell__sub">${sub}</span>` : ''}</span>
        ${coachBadgeHtml(badge, plural(badge, 'nouvelle séance', 'nouvelles séances'))}
        ${icon('chevron.right', 16)}
      </button>`);
  }
  if (hasCoach) {
    const p = myCoach(), badge = coachBadgeStudent();
    const label = ['Mon coach', p ? personName(p) : '', badge ? plural(badge, 'nouveauté', 'nouveautés') : ''].filter(Boolean).join(', ');
    rows.push(`<button class="cell cell--nav coach-cell" data-action="coach-open-mine" aria-label="${esc(label)}">
        ${p ? personAvatar(p) : `<span class="coach-cell__icon" aria-hidden="true">${icon('person.2', 20)}</span>`}
        <span class="cell__body"><span class="cell__title">Mon coach</span>${p ? `<span class="cell__sub">${esc(personName(p))}</span>` : ''}</span>
        ${badge ? `<span class="coach-count num" aria-hidden="true">${badge > 99 ? '99+' : badge}</span>` : ''}
        ${icon('chevron.right', 16)}
      </button>`);
  } else if (!isCoach) {
    rows.push(`<button class="cell cell--nav coach-cell coach-cell--join" data-action="coach-join-start">
        <span class="coach-cell__icon" aria-hidden="true">${icon('person.2', 20)}</span>
        <span class="cell__body"><span class="cell__title">Rejoindre un coach</span><span class="cell__sub">Tu as un code de ton coach ?</span></span>
        ${icon('chevron.right', 16)}
      </button>`);
  }
  return `<div class="group coach-head">${rows.join('')}</div>`;
}
function refreshCoachCell() {
  const st = typeof friendsState === 'function' ? friendsState() : null;
  const box = $('#coachCell'), low = $('#coachCellLow');
  if (box) box.innerHTML = coachCellHtml({ place: 'top', friends: st });
  if (low) low.innerHTML = coachCellHtml({ place: 'low', friends: st });
}

// ── Réglages › Coach ────────────────────────────────────────

function renderCoachSettings() {
  const head = navBar({ title: 'Coach', large: false });
  if (!account.user) {
    return `<div class="view view--grouped coach-view">${head}<div class="scr">
        <div class="social-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Entraîne-toi avec un coach</h2>
          <p class="social-hero__sub">Ton coach voit tes séances, t'envoie des programmes et commente tes séances. Il faut un compte, gratuit.</p>
        </div>
        <button class="btn btn--primary btn--full" data-action="social-sign-in">Se connecter</button>
      </div></div>`;
  }
  const st = coach.state, me = myCoach();
  const { isCoach, hasCoach } = coachRole();
  if (!st && !hasCoach && !isCoach) {
    return `<div class="view view--grouped coach-view">${head}<div class="scr">${coach.error
      ? coachOfflineNote(coach.error, 'Pas d\'Internet. Le coach demande du réseau.') : '<div class="empty-note">Chargement…</div>'}</div></div>`;
  }
  const stale = !st && coach.error ? `<p class="social-inline-error" role="status">${esc(coach.error === 'offline' ? 'Pas d\'Internet : pas à jour.' : coachErrorText(coach.error))}</p>` : '';
  const mine = hasCoach && me ? `
        <div class="group-title">Mon coach</div>
        <div class="group">
          <button class="cell cell--nav social-row coach-row" data-action="coach-open-mine">
            <span class="social-row__main">${personAvatar(me)}<span class="social-row__text"><span class="social-row__name">${esc(personName(me))}</span>${sinceText(me) ? `<span class="cell__sub">Depuis le ${esc(sinceText(me))}</span>` : ''}</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
        <div class="group">
          <button class="cell cell--destructive" data-action="coach-leave">Quitter mon coach</button>
        </div>
        <div class="group-foot">Si tu le quittes, ton coach ne verra plus tes séances. Les programmes déjà ajoutés restent dans tes programmes.</div>` : `
        <div class="social-hero coach-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Entraîne-toi avec un coach</h2>
          <p class="social-hero__sub">Ton coach te donne un code. Ton coach verra tes séances, pourra t'envoyer des programmes et commenter tes séances.</p>
        </div>
        <div class="group">
          <button class="cell cell--action" data-action="coach-join"><span class="cell__title">Rejoindre un coach</span></button>
        </div>
        <div class="group-foot">Tu peux arrêter à tout moment. Tu ne vois pas ses autres élèves, et ils ne te voient pas.</div>`;
  const students = isCoach ? `
        <div class="group-title">Tu es coach</div>
        <div class="group">
          <button class="cell cell--nav" data-action="coach-open-students">
            <span class="cell__body"><span class="cell__title">Mes élèves</span>${st ? `<span class="cell__sub">${st.students.length ? plural(st.students.length, 'élève', 'élèves') : 'Aucun élève pour l\'instant'}</span>` : ''}</span>
            ${coachBadgeHtml(coachBadgeCoach(), plural(coachBadgeCoach(), 'nouvelle séance', 'nouvelles séances'))}
            ${icon('chevron.right', 16)}
          </button>
        </div>` : '';
  return `<div class="view view--grouped coach-view">${head}<div class="scr">${stale}${students}${mine}</div></div>`;
}
SCREENS.set('coach', { render: () => renderCoachSettings(), enter: () => { coachRefresh(); } });

// ── Rejoindre : code, aperçu, âge, accepter ─────────────────

// Feuille du code : un code ou le message d'invitation collé entier ; erreur dans la feuille (saisie gardée),
// « Vérification… » sur Suivant pendant l'appel. Renvoie le code accepté par coach_preview, ou null
function coachCodeSheet() {
  return sheet({
    title: 'Rejoindre', confirm: 'Suivant', focus: '#coachCode',
    body: `<div class="coach-sheet">
        <label class="coach-sheet__label" for="coachCode">Code reçu de ton coach</label>
        <input class="coach-code-input" id="coachCode" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off"
               spellcheck="false" enterkeyhint="go" placeholder="Ex : K7M2QX9P" aria-describedby="coachCodeHelp">
        <p class="coach-sheet__hint" id="coachCodeHelp" aria-live="polite">8 lettres et chiffres. Tu peux coller tout le message d'invitation.</p>
      </div>`,
    onConfirm: async panel => {
      const input = panel.querySelector('#coachCode'), help = panel.querySelector('#coachCodeHelp');
      const btn = panel.querySelector('.sheet__btn--confirm');
      const fail = msg => { help.textContent = msg; help.classList.add('coach-sheet__hint--bad'); input.setAttribute('aria-invalid', 'true'); haptic('medium'); return false; };
      const code = extractCoachCode(input.value);
      if (!code) return fail('Code introuvable : il fait 8 lettres et chiffres, comme K7M2QX9P.');
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

// Parcours commun : onglet Amis, Réglages › Coach
async function coachJoinFlow() {
  if (!account.user) { navigate('coach'); return; }
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
// jamais. Case « J'ai 15 ans ou plus » (même déclaration que pour les amis : socialAgeOk) et « Accepter »
// en bas, toujours visibles
function renderCoachJoin(code) {
  const pv = coach.preview?.code === code ? coach.preview.person : null;
  const head = navBar({ title: 'Rejoindre', large: false });
  if (!pv) return `<div class="view view--grouped coach-join-view">${head}<div class="scr"><div class="empty-note">Saisis de nouveau le code dans l'onglet Amis.</div></div></div>`;
  const name = esc(personName(pv));
  const list = items => `<div class="group">${items.map(([t, d]) => `
          <div class="cell coach-join__item"><span class="cell__body"><span class="cell__title">${t}</span><span class="cell__sub">${d}</span></span></div>`).join('')}</div>`;
  const ok = socialAgeOk;
  return `
    <div class="view view--grouped coach-join-view">
      ${head}
      <div class="scr">
        <div class="coach-join__who">
          ${personAvatar(pv, 'l')}
          <span><span class="coach-join__name">${name}</span><span class="coach-join__sub">veut être ton coach</span></span>
        </div>
        ${coachTitle(`Ce ${elide('que', name)} verra`)}
        ${list([['Toutes tes séances', 'Y compris celles d\'avant, avec exercices, séries et notes, même les séances masquées à tes abonnés.']])}
        ${coachTitle(`Ce ${elide('que', name)} pourra faire`)}
        ${list([['Des programmes pour toi', 'Avec ses consignes. Tu choisis de les ajouter.'], ['Ses commentaires', 'Sous tes séances, dans ton historique.']])}
        ${coachTitle('Jamais visible')}
        ${list([['Le reste', 'Ni ton poids, ni tes données Santé, ni tes programmes perso. Tu ne vois pas ses autres élèves, et ils ne te voient pas.']])}
        <div class="coach-join__foot">
          <div class="group">
            <button class="cell" data-action="coach-age" role="switch" aria-checked="${ok}">
              <span class="cell__body"><span class="cell__title">J'ai 15 ans ou plus</span></span>
              <span class="switch ${ok ? 'switch--on' : ''}" aria-hidden="true"><span class="switch__thumb"></span></span>
            </button>
          </div>
          ${ok ? '' : '<p class="coach-join__hint" id="coachAgeHint">Coche « J\'ai 15 ans ou plus » pour accepter.</p>'}
          <button class="btn ${ok ? 'btn--primary' : 'btn--secondary'} btn--full coach-accept" data-action="coach-accept" data-code="${esc(code)}" ${ok ? '' : 'disabled aria-describedby="coachAgeHint"'}>Accepter</button>
        </div>
      </div>
    </div>`;
}
SCREENS.set('coach-join', { render: code => renderCoachJoin(code) });

// ── Élève : Mon coach ───────────────────────────────────────

// Aperçu des exercices d'un programme reçu (avant de l'ajouter)
function coachProgPreviewHtml(item) {
  return `<div class="coach-prog__preview">${item.data.sessions.map(s => `
          <div class="coach-prog__sess">
            <div class="coach-prog__sess-name"><span class="hcell__dot" style="background:${esc(s.color)}" aria-hidden="true"></span>${esc(s.label)}</div>
            <ul class="coach-prog__ex">${s.exercises.map(e => `<li><span class="coach-prog__ex-name">${esc(e.name)}</span> <span class="num">· ${plural(e.sets, 'série', 'séries')}</span>${e.consigne ? `<span class="coach-prog__ex-tip">${esc(e.consigne)}</span>` : ''}</li>`).join('') || '<li>Aucun exercice</li>'}</ul>
          </div>`).join('')}</div>`;
}

// Carte d'un programme reçu (Mon coach) : statut, consigne, exercices dépliables, action
function coachProgCardHtml(item) {
  const { status, id } = coachStatus(item);
  const nS = item.data.sessions.length, who = esc(coachName());
  const kept = status === 'current' && data.userProgrammes?.[id]?.fromCoach?.keptAt === item.sentAt && item.sentAt > (data.userProgrammes[id].fromCoach.sentAt || 0);
  const eyebrow = status === 'update' ? `Mis à jour par ${who}` : status === 'new' ? `Nouveau programme ${elide('de', who)}` : `Reçu ${elide('de', who)}`;
  const open = coachProgOpen.has(item.id) && !item.meta;
  const btn = status === 'current'
    ? (kept ? `<p class="coach-prog__done">Tu as gardé ta version.</p>
        <button class="btn btn--secondary coach-prog__btn" data-action="coach-take-prog" data-id="${esc(item.id)}">Prendre la version ${elide('de', who)}</button>`
      : '<p class="coach-prog__done">Dans tes programmes</p>')
    : `<button class="btn btn--primary coach-prog__btn" data-action="coach-add-prog" data-id="${esc(item.id)}" aria-label="${status === 'update' ? `Mettre à jour ${esc(item.data.name)}` : `Ajouter ${esc(item.data.name)} à mes programmes`}">${status === 'update' ? 'Mettre à jour' : 'Ajouter à mes programmes'}</button>`;
  return `
        <article class="coach-prog">
          <div class="coach-prog__eyebrow">${eyebrow}</div>
          <h3 class="coach-prog__name">${esc(item.data.name)}</h3>
          ${item.meta ? '<p class="coach-prog__meta">Détail disponible avec du réseau.</p>' : `<p class="coach-prog__meta">${plural(nS, 'séance', 'séances')}${nS ? ` : ${esc(item.data.sessions.map(s => s.label).join(', '))}` : ''}</p>`}
          ${item.data.consigne ? `<p class="coach-prog__consigne">${icon('info.circle', 14)}<span>${esc(item.data.consigne)}</span></p>` : ''}
          ${item.meta ? '' : `<button class="coach-prog__toggle" data-action="coach-prog-toggle" data-id="${esc(item.id)}" aria-expanded="${open}">${open ? 'Masquer les exercices' : 'Voir les exercices'} ${icon(open ? 'chevron.up' : 'chevron.down', 12)}</button>`}
          ${open ? coachProgPreviewHtml(item) : ''}
          ${btn}
        </article>`;
}

// Commentaires de mon coach : nom de la séance, date, texte entier
function coachNotesHtml(notes) {
  return `<div class="group">${notes.map(n => {
    const h = (data.history || []).find(x => x.id === n.session_id);
    const label = h ? rawLabel(h.category, entryProg(h)) : 'Séance';
    return `<button class="cell ${h ? 'cell--nav' : ''} coach-note-row" ${h ? `data-action="coach-open-history" data-id="${esc(n.session_id)}"` : 'disabled'}>
            <span class="cell__body"><span class="cell__title">${esc(label)}${h ? ` · ${esc(fmtDate(h.date))}` : ''}${n.seen ? '' : ' <span class="coach-dot" aria-label="nouveau"></span>'}</span><span class="coach-note-row__text">${esc(n.text)}</span></span>
            ${h ? icon('chevron.right', 16) : ''}
          </button>`;
  }).join('')}</div>`;
}

function renderCoachMine() {
  const head = navBar({ title: 'Mon coach', large: false });
  const p = myCoach();
  if (!p) {
    return `<div class="view view--grouped coach-mine-view">${head}<div class="scr">${!coach.state && coach.error
      ? coachOfflineNote(coach.error, 'Pas d\'Internet. Ton coach s\'affichera quand le réseau reviendra.')
      : coach.state ? '<div class="empty-note">Tu n\'as pas de coach. Rejoins-en un depuis l\'onglet Amis.</div>' : '<div class="empty-note">Chargement…</div>'}</div></div>`;
  }
  const inbox = coach.inbox;
  const stale = !coach.state && coach.error ? `<p class="social-inline-error" role="status">${esc(coach.error === 'offline' ? 'Pas d\'Internet : dernières nouvelles gardées sur l\'iPhone.' : coachErrorText(coach.error))}</p>` : '';
  const progs = inbox ? (inbox.programmes.length ? inbox.programmes.map(coachProgCardHtml).join('')
    : '<div class="empty-note coach-empty">Aucun programme reçu pour l\'instant.</div>') : '<div class="empty-note coach-empty">Chargement…</div>';
  const notes = inbox?.notes.length ? `<div class="group-title">Commentaires</div>${coachNotesHtml(inbox.notes)}` : '';
  return `
    <div class="view view--grouped coach-mine-view">
      ${head}
      <div class="scr">
        ${stale}
        <div class="coach-join__who coach-mine__who">
          ${personAvatar(p, 'l')}
          <span><span class="coach-join__name">${esc(personName(p))}</span><span class="coach-join__sub">Ton coach${sinceText(p) ? ` depuis le ${esc(sinceText(p))}` : ''}</span></span>
        </div>
        ${notes}
        <div class="group-title">Programmes reçus</div>
        <div class="coach-progs">${progs}</div>
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="coach-leave">Quitter mon coach</button>
        </div>
        <div class="group-foot">Si tu le quittes, ton coach ne verra plus tes séances.</div>
      </div>
    </div>`;
}
SCREENS.set('coach-mine', {
  render: () => renderCoachMine(),
  // Relu à chaque arrivée (retour compris) ; commentaires listés ici : vus
  enter: async () => { await coachRefresh(); (coach.inbox?.notes || []).filter(n => !n.seen).forEach(n => coachMarkInboxSeen('note', n.session_id)); },
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
    await dialog({ title: 'Séance en cours', message: `Termine d'abord ta séance, puis mets à jour « ${name} ». La nouvelle version t'attend dans Mon coach.`,
      actions: [{ label: 'OK', style: 'preferred' }] });
    return;
  }
  if (take) {
    if (!(await confirmSheet('Prendre sa version ?', `Tes changements de « ${name} » sont remplacés. Tes séances déjà faites restent dans l'historique.`, 'Prendre sa version'))) return;
  } else if (status === 'update' && st.modified) {
    const choice = await dialog({ type: 'sheet', title: 'Remplacer tes changements ?',
      message: `Tu as modifié « ${name} ». La nouvelle version ${elide('de', coachName())} remplace tes changements. Tes séances déjà faites restent dans l'historique.`,
      actions: [{ label: 'Prendre la nouvelle version', value: 'replace', style: 'destructive' }, { label: 'Garder ma version', value: 'keep' }, { label: 'Annuler', style: 'cancel' }] });
    if (!choice) return;
    if (choice === 'keep') {
      keepMyCoachProgramme(data, item, myCoach()?.user_id || null);
      save();
      coachMarkInboxSeen('programme', item.id);
      showToast('Ta version est gardée');
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
  const go = await dialog({ title: 'Programme ajouté', message: `Passer à « ${name} » maintenant ? Ton historique reste disponible.`,
    actions: [{ label: 'Plus tard', style: 'cancel' }, { label: 'Passer à ce programme', value: true, style: 'preferred' }] });
  if (go === true) { activateProgramme(id); save(); showToast(`Programme : ${name}`); render(); }
}

// ── Élève : consignes, commentaire, notes ───────────────────

// Programme reçu d'un coach (programme perso marqué fromCoach), ou null
function coachProgOf(progId) { return data.userProgrammes?.[progId]?.fromCoach ? data.userProgrammes[progId] : null; }
function coachAuthor(up) { return up?.fromCoach?.name || 'ton coach'; }
// « De ton coach max » : Mes programmes, accueil
// « De ton coach max » tant qu'on suit ce coach ; ensuite « Reçu de max » (ou rien si le nom manque)
function coachFromLine(progId) {
  const up = coachProgOf(progId);
  if (!up) return '';
  const name = up.fromCoach.name;
  if (myCoach()?.user_id && myCoach().user_id === up.fromCoach.coachId) return `De ton coach ${esc(name || myCoach().username || '')}`.trim();
  return name ? `Reçu ${elide('de', esc(name))}` : '';
}

// Accueil : muscles d'une séance d'un programme reçu (le coach n'envoie pas de description) : les plus
// travaillés par ses exercices, comme « Pectoraux · Épaules · Triceps » des programmes intégrés
function coachSessionDesc(progId, cat) {
  if (!coachProgOf(progId)) return '';
  const count = new Map();
  (data.programmes[progId]?.exercises?.[cat] || []).forEach(e => exerciseMuscles(e).primary.forEach(id => {
    const label = MUSCLE_BY_ID.get(id)?.short || muscleLabel(id);
    count.set(label, (count.get(label) || 0) + 1);
  }));
  return esc([...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l).join(' · '));
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
        <div class="group-title">Commentaire de ton coach</div>
        <div class="group group--pad"><p class="hnotes coach-note">${esc(n.text)}</p></div>`;
}
function coachHistoryMark(h) {
  if (!coachNoteFor(h.id)) return '';
  return `<span class="coach-mark" role="img" aria-label="Commentée par ton coach">${icon('text.bubble', 14)}</span>`;
}
// Ouverture d'Historique › Séance : son commentaire est vu
function coachHistoryMount() {
  const id = routeParams(currentRoute())[0];
  const n = id && coachNoteFor(id);
  if (n && !n.seen) coachMarkInboxSeen('note', id);
}
// Bilan : sous les notes, quand on a un coach
function coachNotesHint() {
  return account.user && myCoach() ? '<p class="coach-notes-hint">Ton coach voit tes notes.</p>' : '';
}

// ── Coach : Mes élèves ──────────────────────────────────────

function renderCoachStudents() {
  const st = coach.state;
  const head = navBar({ title: 'Mes élèves', large: false });
  if (!st) return `<div class="view view--grouped coach-students-view">${head}<div class="scr">${coach.error
    ? coachOfflineNote(coach.error, 'Pas d\'Internet. Tes élèves s\'afficheront quand le réseau reviendra.') : '<div class="empty-note">Chargement…</div>'}</div></div>`;
  if (!st.is_coach) return `<div class="view view--grouped coach-students-view">${head}<div class="scr"><div class="empty-note">${esc(coachErrorText('not_coach'))}</div></div></div>`;
  const rows = st.students.map(s => `
          <button class="cell cell--nav social-row coach-student-row" data-action="coach-open-student" data-uid="${esc(s.user_id)}">
            <span class="social-row__main">${personAvatar(s)}<span class="social-row__text">
              <span class="social-row__name">${esc(personName(s))}</span>
              <span class="cell__sub">${esc(studentLastLine(s))}</span>
              ${s.last_session ? `<span class="cell__sub num">${s.sessions_7d ? `${plural(s.sessions_7d, 'séance', 'séances')} en 7 jours` : 'Aucune séance en 7 jours'}</span>` : ''}
            </span></span>
            ${coachBadgeHtml(s.new_sessions, plural(s.new_sessions, 'nouvelle séance', 'nouvelles séances'))}
            ${icon('chevron.right', 16)}
          </button>`).join('');
  const invites = st.invites.map(i => `
          <div class="cell coach-invite">
            <span class="cell__body"><span class="cell__title coach-code num">${esc(i.code)}</span><span class="cell__sub">Jusqu'au ${esc(fmtDate(i.expires_at, 'short'))}</span></span>
            <button class="coach-icon-btn" data-action="coach-share-invite" data-code="${esc(i.code)}" aria-label="Partager le code ${esc(i.code)}">${icon('square.and.arrow.up', 20)}</button>
            <button class="social-x" data-action="coach-revoke-invite" data-code="${esc(i.code)}" aria-label="Retirer le code ${esc(i.code)}">${icon('xmark', 14)}</button>
          </div>`).join('');
  const removed = st.removed.length ? `
        <div class="group-title">Retirés</div>
        <div class="group">${st.removed.map(p => personRowHtml(p,
          `<button class="social-pill" data-action="coach-allow" data-uid="${esc(p.user_id)}" aria-label="${esc(`Autoriser ${personName(p)} à revenir`)}">Autoriser</button>`, 'Ne peut plus revenir avec tes codes')).join('')}</div>
        <div class="group-foot">« Autoriser » lui permet de revenir avec un de tes codes.</div>` : '';
  return `
    <div class="view view--grouped coach-students-view">
      ${head}
      <div class="scr">
        ${coach.error ? `<p class="social-inline-error" role="status">${esc(coach.error === 'offline' ? 'Pas d\'Internet : liste pas à jour.' : coachErrorText(coach.error))}</p>` : ''}
        <div class="group-title">Élèves${st.students.length ? ` (${st.students.length})` : ''}</div>
        <div class="group">${rows || '<div class="cell"><span class="cell__sub social-empty">Aucun élève pour l\'instant</span></div>'}</div>
        <div class="group-foot">Tes élèves ne se voient pas entre eux.</div>
        <div class="group-title">Invitations</div>
        <div class="group">
          ${invites}
          <button class="cell cell--action" data-action="coach-invite" ${coachInviteBusy ? 'disabled' : ''}>${icon('plus', 20)}<span>Inviter un élève</span></button>
        </div>
        <div class="group-foot">Chaque code est valable 7 jours et sert à plusieurs élèves. L'élève le saisit dans l'onglet Amis › Rejoindre un coach.</div>
        ${removed}
      </div>
    </div>`;
}
SCREENS.set('coach-students', { render: () => renderCoachStudents(), enter: () => { coachRefresh(); } });

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

function coachSessionCell(uid, row) {
  const s = row.s, mine = coachOwnProgrammeName(s.programme), plan = coachPlanOf(s);
  return `
          <button class="hcell coach-sess" data-action="coach-open-session" data-uid="${esc(uid)}" data-id="${esc(row.id)}">
            <span class="hcell__dot" style="background:${coachSessionColor(s)}" aria-hidden="true"></span>
            <span class="hcell__body">
              <span class="hcell__top"><span class="hcell__title">${esc(s.label)}</span><span class="hcell__date">${fmtDate(row.doneAt)}</span></span>
              <span class="hcell__sub num">${esc(publicMetaLine(s))}${plan ? ` · ${plan.done}/${plan.total} séries` : ''}</span>
              ${mine || row.note ? `<span class="coach-sess__tags">${mine ? '<span class="coach-tag">Ton programme</span>' : ''}${row.note ? '<span class="coach-tag coach-tag--note">Commentée</span>' : ''}</span>` : ''}
            </span>
          </button>`;
}

function renderCoachStudent(uid) {
  const p = coachStudent(uid);
  const head = navBar({ title: esc(personName(p)), large: false });
  if (!p) return `<div class="view view--grouped coach-student-view">${head}<div class="scr"><div class="empty-note">${coach.state ? 'Cette personne ne fait plus partie de tes élèves.' : 'Chargement…'}</div></div></div>`;
  const f = coachSessions(uid);
  let list;
  if (!f.rows.length) {
    list = f.loading || (!f.loadedAt && !f.error) ? '<div class="empty-note">Chargement…</div>'
      : f.error ? coachOfflineNote(f.error, 'Pas d\'Internet. Ses séances s\'afficheront quand le réseau reviendra.')
      : '<div class="empty-note">Aucune séance pour l\'instant.</div>';
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
          <span><span class="coach-join__name">${esc(personName(p))}</span><span class="coach-join__sub">${sinceText(p) ? `Élève depuis le ${esc(sinceText(p))}` : 'Élève'}</span></span>
        </div>
        <div class="group">
          <button class="cell cell--action" data-action="coach-send" data-uid="${esc(uid)}">${icon('square.and.arrow.up', 20)}<span>Envoyer un programme</span></button>
        </div>
        ${sent}
        <div class="group-title">Séances</div>
        ${list}
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="coach-remove" data-uid="${esc(uid)}">Retirer l'élève</button>
        </div>
        <div class="group-foot">Tu ne verras plus ses séances, et tes codes ne marcheront plus pour cette personne, sauf si tu autorises son retour.</div>
      </div>
    </div>`;
}
SCREENS.set('coach-student', {
  render: uid => renderCoachStudent(uid),
  // Séances relues à chaque arrivée, puis vues (pastille et badge retirés)
  enter: () => {
    const uid = routeParams(currentRoute())[0];
    if (!uid) return;
    coachLoadSessions(uid);
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
  const txt = tr.dir === 'same' ? '=' : `${REVIEW_ARROW[tr.dir]} ${tr.text}`;
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
                <span class="review-ex__line"><span class="hex__sets num">${setsLine(e.sets, e.measure || measureOf(e), reviewSetKind(e))}</span>${amount ? `<span class="review-ex__vol num">${esc(amount)}</span>` : ''}</span>
                ${x.prev ? `<span class="review-ex__prev num">préc. ${setsLine(x.prev.ex.sets, x.prev.ex.measure || measureOf(x.prev.ex), reviewSetKind(x.prev.ex))} (${esc(fmtDate(x.prev.doneAt, 'short'))})</span>` : ''}
              </span>
            </div>`;
}
// Case : valeur, libellé, puis écart éventuel (vert en hausse, gris sinon)
function reviewTile(val, lbl, delta = null, up = false) {
  return `<div class="tile"><span class="tile__val num">${val}</span><span class="tile__lbl">${lbl}</span>${delta ? `<span class="tile__delta num ${up ? 'tile__delta--up' : ''}">${delta}</span>` : ''}</div>`;
}
// Règle du volume, dite telle qu'elle est (la même chaque semaine), et étendue des comparaisons
function reviewRuleFoot(rows, complete) {
  const oldest = rows.reduce((m, r) => Math.min(m, r.doneAt), Infinity);
  const scope = complete || !Number.isFinite(oldest) ? 'ses séances reçues' : `ses séances reçues depuis le ${fmtDate(oldest, 'short')}`;
  return `<div class="group-foot review-rule">Volume = charge notée × reps, échauffement compris, poids du corps non compté (lest compris). Comparaisons avec ${scope}.</div>`;
}

function renderCoachSession(uid, id) {
  const row = coachSessionOf(uid, id), p = coachStudent(uid);
  if (!row) return `<div class="view view--grouped coach-session-view">${navBar({ title: 'Séance' })}<div class="scr"><div class="empty-note">Cette séance n'est plus disponible.</div></div></div>`;
  const s = row.s, n = seriesCount(s), mine = coachOwnProgrammeName(s.programme), plan = coachPlanOf(s);
  const f = coachSessions(uid), rv = sessionReview(row, f.rows);
  const who = esc(personName(p));
  let when = capitalize(fmtDate(row.doneAt, 'long'));
  if (s.duration) when += ` · ${fmtTime(row.doneAt)}`;
  const vs = rv.prev ? `vs ${esc(rv.prev.s.label)} du ${esc(fmtDate(rv.prev.doneAt, 'short'))}` : f.end ? `1re séance ${esc(s.label)}` : '';
  const pain = s.notes && painInNotes(s.notes);
  const notes = s.notes ? `
        <div class="review-notes ${pain ? 'review-notes--pain' : ''}">
          <p class="review-notes__head">Notes ${elide('de', who)}${pain ? '<span class="review-notes__flag">À lire</span>' : ''}</p>
          <p class="hnotes">${esc(s.notes)}</p>
        </div>` : '';
  const vd = rv.volDelta;
  const tiles = [
    reviewTile(rv.volume > 0 ? fmtVolume(rv.volume) : '—', 'volume', rv.volume > 0 && vd ? (vd.dir === 'same' ? '=' : fmtPct(vd.pct)) : null, vd?.dir === 'up'),
    reviewTile(s.duration ? fmtDuration(s.duration) : '—', 'durée', s.duration && rv.durGap !== null ? fmtPct(rv.durGap) : null),
    reviewTile(plan ? `${plan.done}/${plan.total}` : n, plan ? 'séries prévues' : n > 1 ? 'séries' : 'série'),
    reviewTile(s.exercises.length, s.exercises.length > 1 ? 'exercices' : 'exercice'),
  ].join('');
  // Records seulement quand toutes ses séances sont chargées (même règle que friendRecord, js/features/social-ui.js) :
  // sur une page seulement, un « record » pourrait être faux
  const records = f.end && rv.records.length ? `
        <div class="group-title">${rv.records.length > 1 ? 'Records' : 'Record'}</div>
        <div class="group">${rv.records.map(r => reviewRecordCell(r)).join('')}</div>` : '';
  const missing = (plan?.missing || []).map(name => `
            <div class="cell hex review-ex review-ex--missing"><span class="cell__body"><span class="review-ex__line"><span class="hex__name">${esc(name)}</span><span class="review-trend num">pas fait</span></span></span></div>`).join('');
  return `
    <div class="view view--grouped coach-session-view">
      ${navBar({ title: '' })}
      <div class="scr">
        <div class="social-who">${personAvatar(p)}<span class="social-who__name">${who}</span></div>
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
        ${s.hidden ? '<div class="group-foot">Séance masquée à ses abonnés : tu la vois en tant que coach.</div>' : ''}
        <div class="group-title">Ton commentaire</div>
        <div class="group">
          ${row.note ? `<div class="cell"><p class="hnotes coach-note">${esc(row.note)}</p></div>` : ''}
          <button class="cell cell--action" data-action="coach-comment" data-uid="${esc(uid)}" data-id="${esc(row.id)}">${icon('pencil', 18)}<span>${row.note ? 'Modifier le commentaire' : 'Commenter'}</span></button>
        </div>
        <div class="group-foot">${who} le voit dans son historique et dans Mon coach.</div>
        ${reviewRuleFoot(f.rows, f.end)}
      </div>
    </div>`;
}
SCREENS.set('coach-session', { render: (uid, id) => renderCoachSession(uid, id) });

// Feuille du commentaire : champ actif dès l'ouverture (dans le geste : clavier d'iOS), compteur sur 1000,
// « Laisse vide pour retirer » seulement s'il y a déjà un commentaire
function coachTextSheet({ title, value, placeholder, max, existing, confirm = 'Envoyer' }) {
  const p = sheet({ title, confirm, focus: '#coachSheetText',
    body: `<div class="coach-sheet"><textarea class="coach-textarea" id="coachSheetText" rows="6" maxlength="${max}" placeholder="${esc(placeholder)}" aria-label="${esc(title)}" aria-describedby="coachSheetCount">${esc(value)}</textarea>
      <p class="coach-sheet__hint"><span>${existing ? 'Laisse vide pour retirer le commentaire.' : ''}</span><span class="num coach-sheet__count" id="coachSheetCount">${String(value || '').length}/${max}</span></p></div>`,
    onConfirm: panel => panel.querySelector('#coachSheetText').value });
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
  if (kept) { coachSendDraft = { route, prog: String(kept.prog || ''), ex: kept.ex && typeof kept.ex === 'object' ? kept.ex : {} }; return coachSendDraft; }
  const progId = routeParams(route)[1];
  const ex = {};
  progSessionsOf(data, progId).forEach(s => {
    ex[s.key] = {};
    (data.programmes[progId]?.exercises?.[s.key] || []).forEach(e => { ex[s.key][e.id] = e.consigne || ''; });
  });
  coachSendDraft = { route, prog: data.userProgrammes?.[progId]?.consigne || data.programmes[progId]?.consigne || '', ex };
  return coachSendDraft;
}

function renderCoachSend(uid, progId) {
  const p = coachStudent(uid);
  const name = progMeta(progId).name;
  const dr = coachSendDraftFor(currentRoute());
  const sessions = progSessionsOf(data, progId);
  const who = esc(personName(p));
  const ta = (attrs, value, label, ph) => `<textarea class="coach-textarea coach-textarea--inline" rows="1" maxlength="${CONSIGNE_MAX}" ${attrs} aria-label="${esc(label)}" placeholder="${esc(ph)}">${esc(value)}</textarea>`;
  const groups = sessions.map(s => {
    const xs = data.programmes[progId]?.exercises?.[s.key] || [];
    return `
        <div class="group-title">${esc(s.label)}</div>
        <div class="group">${xs.length ? xs.map((e, i) => `
          <div class="cell coach-send-ex">
            <span class="cell__body">
              <span class="cell__title">${ssTagHtml(xs, i)}${esc(e.name)}</span>
              <span class="cell__sub num">${plural(e.sets, 'série', 'séries')}${e.rest ? ` · repos ${fmtRest(e.rest)}` : ''}${e.tempo ? ` · tempo ${esc(shortTempo(e.tempo))}` : ''}</span>
              ${ta(`data-cat="${esc(s.key)}" data-ex="${esc(e.id)}"`, dr.ex[s.key]?.[e.id] || '', `Consigne pour ${e.name}`, 'Consigne (facultatif)')}
            </span>
          </div>`).join('') : '<div class="cell"><span class="cell__sub">Aucun exercice</span></div>'}
        </div>`;
  }).join('');
  return `
    <div class="view view--grouped coach-send-view">
      ${navBar({ title: 'Envoyer', large: false })}
      <div class="scr">
        <h1 class="scr-title">${esc(name)}</h1>
        <p class="scr-sub">Pour ${who} · ${plural(sessions.length, 'séance', 'séances')}</p>
        <div class="group-title">Consigne du programme</div>
        <div class="group group--pad">${ta('data-prog="1"', dr.prog, 'Consigne du programme', 'Ex : 3 séances par semaine, une journée de repos entre deux')}</div>
        <div class="group-foot">Les consignes sont facultatives et gardées pour tes prochains envois. ${who} les voit dans le programme et pendant la séance.</div>
        ${groups}
        <button class="btn btn--primary btn--full coach-send-btn" data-action="coach-send-go" data-uid="${esc(uid)}" data-prog="${esc(progId)}">Envoyer à ${who}</button>
        <div class="group-foot">Ni tes charges, ni tes records, ni ton historique. Un nouvel envoi du même programme le met à jour chez ton élève.</div>
      </div>
    </div>`;
}
SCREENS.set('coach-send', { render: (uid, progId) => renderCoachSend(uid, progId) });

// Programmes que je peux envoyer : Mes programmes, sans les programmes reçus d'un coach
function coachSendableProgrammes() {
  return (data.myProgrammes || []).filter(id => id !== 'custom' && COACH_PROG_ID_RE.test(id) && !coachProgOf(id)
    && (PROGRAMMES[id] || (data.userProgrammes[id] && !data.userProgrammes[id].archived)));
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
  const go = await dialog({ title: 'Choisis un pseudo', message: 'Ton coach te reconnaîtra avec ton pseudo.',
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
    if (!socialAgeOk) return;
    el.disabled = true;
    const name = personName(coach.preview?.person);
    const r = await coachJoin(el.dataset.code);
    if (!coachToast(r)) { el.disabled = false; return; }
    haptic();
    goBack();
    await dialog({ title: 'C\'est fait !', message: `Les programmes ${elide('de', name)} arriveront dans Amis › Mon coach.`,
      actions: [{ label: 'OK', style: 'preferred' }] });
  },
  'coach-leave': async () => {
    const name = coachName();
    const lost = (coach.inbox?.programmes || []).filter(p => coachStatus(p).status === 'new').map(p => `« ${p.data.name} »`);
    const extra = lost.length ? ` ${lost.length > 1 ? `Les programmes ${lost.join(', ')} que tu n'as pas ajoutés seront perdus.` : `Le programme ${lost[0]} que tu n'as pas ajouté sera perdu.`}` : '';
    if (!(await confirmSheet(`Quitter ${name} ?`, `${name} ne verra plus tes séances. Ses commentaires sont effacés. Les programmes déjà ajoutés restent dans tes programmes.${extra}`, 'Quitter mon coach'))) return;
    const r = await coachLeave();
    if (!coachToast(r, `Tu ne suis plus ${name}`)) return;
    if (currentView() === 'coach-mine') goBack(); else render();
  },
  'coach-lost-ok': () => { coachSetLost(null); refreshCoachCell(); },
  'coach-add-prog': async (e, el) => { await addCoachProgrammeFlow(el.dataset.id); },
  'coach-take-prog': async (e, el) => { await addCoachProgrammeFlow(el.dataset.id, { take: true }); },
  'coach-prog-toggle': (e, el) => { const id = el.dataset.id; if (coachProgOpen.has(id)) coachProgOpen.delete(id); else coachProgOpen.add(id); render(); },
  'coach-dismiss-prog': (e, el) => { coachMarkInboxSeen('programme', el.dataset.id); render(); showToast('Il reste dans Amis › Mon coach'); },
  'coach-dismiss-note': (e, el) => { coachMarkInboxSeen('note', el.dataset.id); render(); showToast('Il reste dans Amis › Mon coach'); },
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
    } finally { coachInviteBusy = false; if (currentView() === 'coach-students') render(); }
  },
  'coach-share-invite': async (e, el) => { await shareCoachInvite(el.dataset.code); },
  'coach-revoke-invite': async (e, el) => {
    if (!(await confirmSheet(`Retirer le code ${el.dataset.code} ?`, 'Il ne servira plus à personne. Tes élèves actuels restent suivis.', 'Retirer le code'))) return;
    coachToast(await coachRevokeInvite(el.dataset.code), 'Code retiré');
  },
  'coach-open-student': (e, el) => navigate(makeRoute('coach-student', el.dataset.uid)),
  'coach-open-session': (e, el) => navigate(makeRoute('coach-session', el.dataset.uid, el.dataset.id)),
  'coach-more': (e, el) => { coachLoadSessions(el.dataset.uid, { more: true }); },
  'coach-remove': async (e, el) => {
    const name = personName(coachStudent(el.dataset.uid));
    if (!(await confirmSheet(`Retirer ${name} ?`, `${name} ne pourra plus revenir avec tes codes, sauf si tu l'autorises dans Mes élèves. Tu ne verras plus ses séances ; tes commentaires et les programmes pas encore ajoutés sont effacés.`, 'Retirer l\'élève'))) return;
    const r = await coachRemoveStudent(el.dataset.uid);
    if (!coachToast(r, `${name} ne fait plus partie de tes élèves`)) return;
    routeTo('coach-students');
  },
  'coach-allow': async (e, el) => {
    const p = (coach.state?.removed || []).find(x => x.user_id === el.dataset.uid);
    el.disabled = true;
    coachToast(await coachAllowStudent(el.dataset.uid), `${personName(p)} peut revenir avec un de tes codes`);
    render();
  },
  'coach-comment': async (e, el) => {
    const { uid, id } = el.dataset;
    const row = coachSessionOf(uid, id);
    if (!row) return;
    const key = uid + '/' + id;
    const value = coachNoteDraft?.key === key ? coachNoteDraft.text : row.note;
    const text = await coachTextSheet({ title: row.note ? 'Modifier' : 'Commenter', value, existing: !!row.note,
      placeholder: 'Ex : Belle séance, garde 2 minutes de repos sur le squat.', max: COACH_NOTE_MAX });
    if (text === null) return;
    const r = await coachSetNote(uid, id, text);
    // Échec (hors ligne) : le texte est gardé pour le prochain essai
    coachNoteDraft = r.ok ? null : { key, text };
    if (coachToast(r, text.trim() ? 'Commentaire envoyé' : 'Commentaire retiré')) haptic();
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
    const r = await coachSendProgramme(uid, prog, { prog: dr.prog, ex: dr.ex });
    if (!coachToast(r, `Programme envoyé à ${personName(coachStudent(uid))}`)) { el.disabled = false; return; }
    // Consignes gardées dans mon programme (perso : up.consigne ; intégré : programmes[id].consigne) : le
    // prochain envoi les reprend
    const c = cleanConsigne(dr.prog), up = data.userProgrammes?.[prog], pd = data.programmes[prog] ||= makeProgData(prog);
    if (up) { if (c) up.consigne = c; else delete up.consigne; }
    else if (c) pd.consigne = c; else delete pd.consigne;
    Object.entries(dr.ex).forEach(([cat, m]) => (pd.exercises?.[cat] || []).forEach(x => {
      if (!(x.id in m)) return;
      const xc = cleanConsigne(m[x.id]);
      if (xc) x.consigne = xc; else delete x.consigne;
    }));
    save();
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
  return JSON.stringify([account.user?.id || null, coachRole(), coachBadge(), coachBadgeCoach(), coachBadgeStudent(), myCoach()?.user_id || null, myCoach()?.username || null,
    coach.state?.students.length ?? null, account.user ? coachLost() : null,
    ib ? [ib.programmes.map(p => [p.id, p.sentAt, p.seen, !!p.meta]), ib.notes.map(n => [n.session_id, n.updatedAt, n.seen])] : null]);
}
let coachShown = null;
function coachTyping() { return !!document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]'); }
// coachShown n'avance QUE lorsque l'écran a été redessiné (ou n'avait rien à redessiner) : un changement
// arrivé pendant une saisie reste « non affiché » et sera repris au focusout, pas marqué « déjà vu »
const COACH_WATCH_VIEWS = ['settings', 'dashboard', 'history', 'history-detail', 'editor', 'programmes', 'my-programmes', 'summary'];
function coachApplyChange() {
  const v = currentView(), key = coachShownKey();
  if (v === 'friends') { if (key !== coachShown) { refreshCoachCell(); coachShown = key; } return; }
  if (coachTyping()) return;   // champ en cours de saisie : rendu reporté au focusout (coachShown gardé)
  if (COACH_VIEWS.includes(v)) { render(); coachShown = key; return; }
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
// Connexion, déconnexion : la cellule de l'onglet Amis change de forme
onAccountChange(() => { if (currentView() === 'friends') refreshCoachCell(); });
