// ═══════════════════════════════════════════════════════════
//  Coach (Coach V1), écrans. Contrat : docs/COACH_V1.md ; données et appels : js/data/coach.js.
//
//  - Réglages › Coach (`coach`) : rejoindre un coach (code, puis aperçu `coach-join:CODE` avec ce que le
//    coach verra, puis « Accepter »), le coach suivi et « Quitter mon coach », accès à « Mes élèves ».
//  - Onglet Amis : cellule « Mes élèves » ou « Mon coach » en haut, avec son badge, même sans avoir
//    activé Amis (coachCellHtml, appelée par js/features/social-ui.js).
//  - Coach : Mes élèves (`coach-students` : élèves, nouvelles séances, invitations), un élève
//    (`coach-student:UID` : ses séances, « Envoyer un programme », « Retirer l'élève »), une séance
//    (`coach-session:UID:ID` : détail, notes, « Commenter »), envoi d'un programme avec consignes
//    (`coach-send:UID:PROG`).
//  - Élève : Mon coach (`coach-mine` : programmes reçus, commentaires, « Quitter mon coach »), carte
//    de l'accueil (coachHomeCard), consignes dans Programme › Séance (coachEditorConsigneHtml,
//    coachExConsigneSub) et dans la séance (coachSessionTipHtml), commentaire dans Historique › Séance
//    (historyCoachGroup).
//  Tout texte venu du serveur passe par esc(). Rien au pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_VIEWS = ['coach', 'coach-join', 'coach-mine', 'coach-students', 'coach-student', 'coach-session', 'coach-send'];
const coachTipClosed = new Set();   // séance en cours : consignes repliées (identifiant d'exercice)
let coachSendDraft = null;          // écran d'envoi : { route, prog, ex: { [cat]: { [exId]: texte } } }
let coachNoteDraft = null;          // commentaire pas envoyé (hors ligne) : { key, text }, repris à la réouverture

// ── Petits gabarits ─────────────────────────────────────────

function coachName() { return personName(coach.state?.coach); }
function coachBadgeHtml(n, label) {
  return n ? `<span class="coach-count num" aria-label="${esc(label)}">${n > 99 ? '99+' : n}</span>` : '';
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

// Titres des écrans du coach (bouton retour)
function coachRouteTitle(route) {
  const name = routeName(route);
  if (name === 'coach-student') return coach.state?.students.find(s => s.user_id === routeParams(route)[0])?.username || 'Élève';
  return { coach: 'Coach', 'coach-join': 'Coach', 'coach-mine': 'Mon coach', 'coach-students': 'Mes élèves', 'coach-session': 'Séance', 'coach-send': 'Envoyer' }[name] || null;
}

// ── Cellules : Réglages et onglet Amis ──────────────────────

function renderCoachSettingsGroup() {
  if (!accountAvailable()) return '';
  const { isCoach, hasCoach } = coachRole();
  const value = hasCoach ? esc(coachName()) : isCoach ? 'Mes élèves' : account.user ? 'Rejoindre' : '';
  return `
        <div class="group">
          <button class="cell cell--nav" data-action="coach-open-settings">
            <span class="cell__body"><span class="cell__title">Coach</span></span>
            <span class="cell__value">${value}</span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

// Cellule en haut de l'onglet Amis : coach (Mes élèves) et / ou élève (Mon coach)
function coachCellHtml() {
  if (!account.user) return '';
  const { isCoach, hasCoach } = coachRole();
  if (!isCoach && !hasCoach) return '';
  const st = coach.state;
  const rows = [];
  if (isCoach) {
    const n = st ? st.students.length : null;
    const badge = st ? st.badge : coach.cached?.badge || 0;
    rows.push(`<button class="cell cell--nav coach-cell" data-action="coach-open-students">
        <span class="coach-cell__icon" aria-hidden="true">${icon('person.2', 20)}</span>
        <span class="cell__body"><span class="cell__title">Mes élèves</span>${n !== null ? `<span class="cell__sub">${n ? plural(n, 'élève', 'élèves') : 'Invite ton premier élève'}</span>` : ''}</span>
        ${coachBadgeHtml(badge, plural(badge, 'nouvelle séance', 'nouvelles séances'))}
        ${icon('chevron.right', 16)}
      </button>`);
  }
  if (hasCoach) {
    const p = st?.coach;
    const badge = isCoach ? 0 : (st ? st.badge : coach.cached?.badge || 0);
    rows.push(`<button class="cell cell--nav coach-cell" data-action="coach-open-mine">
        ${p ? personAvatar(p) : `<span class="coach-cell__icon" aria-hidden="true">${icon('person.2', 20)}</span>`}
        <span class="cell__body"><span class="cell__title">Mon coach</span>${p ? `<span class="cell__sub">${esc(personName(p))}</span>` : ''}</span>
        ${coachBadgeHtml(badge, plural(badge, 'nouveauté', 'nouveautés'))}
        ${icon('chevron.right', 16)}
      </button>`);
  }
  return `<div class="group coach-head">${rows.join('')}</div>`;
}
function refreshCoachCell() {
  const box = $('#coachCell');
  if (box) box.innerHTML = coachCellHtml();
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
  const st = coach.state;
  if (!st) {
    return `<div class="view view--grouped coach-view">${head}<div class="scr">${coach.error
      ? coachOfflineNote(coach.error, 'Pas d\'Internet. Le coach demande du réseau.') : '<div class="empty-note">Chargement…</div>'}</div></div>`;
  }
  const mine = st.coach ? `
        <div class="group-title">Mon coach</div>
        <div class="group">
          <button class="cell cell--nav social-row coach-row" data-action="coach-open-mine">
            <span class="social-row__main">${personAvatar(st.coach)}<span class="social-row__text"><span class="social-row__name">${esc(personName(st.coach))}</span>${sinceText(st.coach) ? `<span class="cell__sub">Depuis le ${esc(sinceText(st.coach))}</span>` : ''}</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
        <div class="group">
          <button class="cell cell--destructive" data-action="coach-leave">Quitter mon coach</button>
        </div>
        <div class="group-foot">Ton coach ne voit plus tes séances. Les programmes déjà ajoutés restent dans tes programmes.</div>` : `
        <div class="social-hero coach-hero">
          <span class="social-hero__icon" aria-hidden="true">${icon('person.2', 40)}</span>
          <h2 class="social-hero__title">Entraîne-toi avec un coach</h2>
          <p class="social-hero__sub">Ton coach te donne un code. Il verra tes séances, pourra t'envoyer des programmes et commenter tes séances.</p>
        </div>
        <div class="group">
          <button class="cell cell--action" data-action="coach-join"><span class="cell__title">Rejoindre un coach</span></button>
        </div>
        <div class="group-foot">Tu peux le quitter à tout moment. Rien n'est visible des autres élèves.</div>`;
  const students = st.is_coach ? `
        <div class="group-title">Tu es coach</div>
        <div class="group">
          <button class="cell cell--nav" data-action="coach-open-students">
            <span class="cell__body"><span class="cell__title">Mes élèves</span><span class="cell__sub">${st.students.length ? plural(st.students.length, 'élève', 'élèves') : 'Aucun élève pour l\'instant'}</span></span>
            ${coachBadgeHtml(st.badge, plural(st.badge, 'nouvelle séance', 'nouvelles séances'))}
            ${icon('chevron.right', 16)}
          </button>
        </div>` : '';
  return `<div class="view view--grouped coach-view">${head}<div class="scr">${students}${mine}</div></div>`;
}
SCREENS.set('coach', { render: () => renderCoachSettings(), enter: () => { coachRefresh(); } });

// Aperçu du coach avant d'accepter : qui, et ce qu'il verra
function renderCoachJoin(code) {
  const pv = coach.preview?.code === code ? coach.preview.person : null;
  const head = navBar({ title: 'Rejoindre', large: false });
  if (!pv) return `<div class="view view--grouped coach-join-view">${head}<div class="scr"><div class="empty-note">Saisis de nouveau le code dans Réglages › Coach.</div></div></div>`;
  const name = esc(personName(pv));
  const items = [
    ['Toutes tes séances', 'Exercices, séries et notes de séance, même celles masquées à tes abonnés.'],
    ['Des programmes pour toi', 'Il pourra t\'en envoyer, avec ses consignes. Tu choisis de les ajouter.'],
    ['Ses commentaires', 'Il pourra commenter tes séances.'],
    ['Jamais', 'Ni ton poids, ni tes données Santé, ni les autres élèves.'],
  ];
  return `
    <div class="view view--grouped coach-join-view">
      ${head}
      <div class="scr">
        <div class="account-hero">
          ${personAvatar(pv, 'xl')}
          <h2 class="account-hero__name">${name}</h2>
          <p class="account-hero__sub">veut être ton coach</p>
        </div>
        <div class="group-title">Ce que ${name} verra</div>
        <div class="group">${items.map(([t, d]) => `
          <div class="cell"><span class="cell__body"><span class="cell__title">${t}</span><span class="cell__sub">${d}</span></span></div>`).join('')}
        </div>
        <div class="group-foot">Tu peux le quitter à tout moment dans Réglages › Coach.</div>
        <button class="btn btn--primary btn--full coach-accept" data-action="coach-accept" data-code="${esc(code)}">Accepter</button>
        <button class="btn btn--secondary btn--full coach-cancel" data-action="back">Annuler</button>
      </div>
    </div>`;
}
SCREENS.set('coach-join', { render: code => renderCoachJoin(code) });

// ── Élève : Mon coach ───────────────────────────────────────

// Carte d'un programme reçu (Mon coach), ou sa version compacte de l'accueil
function coachProgCardHtml(item) {
  const { status } = coachProgrammeStatus(data, item);
  const nS = item.data.sessions.length;
  const eyebrow = status === 'update' ? `Mis à jour par ${esc(coachName())}` : status === 'new' ? `Nouveau programme de ${esc(coachName())}` : `Reçu de ${esc(coachName())}`;
  const btn = status === 'current'
    ? '<span class="coach-prog__done">Dans tes programmes</span>'
    : `<button class="btn btn--primary coach-prog__btn" data-action="coach-add-prog" data-id="${esc(item.id)}">${status === 'update' ? 'Mettre à jour' : 'Ajouter à mes programmes'}</button>`;
  return `
        <article class="coach-prog">
          <div class="coach-prog__eyebrow">${eyebrow}</div>
          <h3 class="coach-prog__name">${esc(item.data.name)}</h3>
          <p class="coach-prog__meta">${plural(nS, 'séance', 'séances')}${item.data.sessions.length ? ` : ${esc(item.data.sessions.map(s => s.label).join(', '))}` : ''}</p>
          ${item.data.consigne ? `<p class="coach-prog__consigne">${esc(item.data.consigne)}</p>` : ''}
          ${btn}
        </article>`;
}

function renderCoachMine() {
  const st = coach.state;
  const head = navBar({ title: 'Mon coach', large: false });
  if (!st?.coach) {
    return `<div class="view view--grouped coach-mine-view">${head}<div class="scr">${!st && coach.error
      ? coachOfflineNote(coach.error, 'Pas d\'Internet. Ton coach s\'affichera quand le réseau reviendra.')
      : st ? '<div class="empty-note">Tu n\'as pas de coach. Rejoins-en un dans Réglages › Coach.</div>' : '<div class="empty-note">Chargement…</div>'}</div></div>`;
  }
  const p = st.coach, inbox = coach.inbox;
  const progs = inbox ? (inbox.programmes.length ? inbox.programmes.map(coachProgCardHtml).join('')
    : '<div class="empty-note coach-empty">Aucun programme reçu pour l\'instant.</div>') : '<div class="empty-note coach-empty">Chargement…</div>';
  const notes = inbox?.notes.length ? `
        <div class="group-title">Commentaires</div>
        <div class="group">${inbox.notes.map(n => {
          const h = (data.history || []).find(x => x.id === n.session_id);
          const label = h ? rawLabel(h.category, entryProg(h)) : 'Séance';
          return `<button class="cell ${h ? 'cell--nav' : ''} coach-note-row" ${h ? `data-action="coach-open-history" data-id="${esc(n.session_id)}"` : 'disabled'}>
            <span class="cell__body"><span class="cell__title">${esc(label)}${h ? ` · ${esc(fmtDate(h.date))}` : ''}${n.seen ? '' : ' <span class="coach-dot" aria-label="nouveau"></span>'}</span><span class="cell__sub coach-note-row__text">${esc(n.text)}</span></span>
            ${h ? icon('chevron.right', 16) : ''}
          </button>`;
        }).join('')}</div>` : '';
  return `
    <div class="view view--grouped coach-mine-view">
      ${head}
      <div class="scr">
        <div class="account-hero">
          ${personAvatar(p, 'xl')}
          <h2 class="account-hero__name">${esc(personName(p))}</h2>
          <p class="account-hero__sub">Ton coach${sinceText(p) ? ` depuis le ${esc(sinceText(p))}` : ''}</p>
        </div>
        <div class="group-title">Programmes reçus</div>
        <div class="coach-progs">${progs}</div>
        ${notes}
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="coach-leave">Quitter mon coach</button>
        </div>
      </div>
    </div>`;
}
SCREENS.set('coach-mine', {
  render: () => renderCoachMine(),
  // Commentaires listés ici : vus
  enter: async () => { await coachRefresh(); (coach.inbox?.notes || []).filter(n => !n.seen).forEach(n => coachMarkInboxSeen('note', n.session_id)); },
});

// Carte de l'accueil : premier programme reçu pas encore ajouté (ou mis à jour) et pas encore vu
function coachHomeCard() {
  if (!account.user || !coach.state?.coach || !coach.inbox) return '';
  const item = coach.inbox.programmes.find(p => !p.seen && coachProgrammeStatus(data, p).status !== 'current');
  if (!item) return '';
  const upd = coachProgrammeStatus(data, item).status === 'update';
  return `
    <section class="home-card account-card coach-home" aria-labelledby="coachCardTitle">
      <div class="account-card__text">
        <h2 class="account-card__title" id="coachCardTitle">${upd ? `Programme mis à jour par ${esc(coachName())}` : `Nouveau programme de ${esc(coachName())}`}</h2>
        <p class="account-card__sub">${esc(item.data.name)}</p>
      </div>
      <button class="account-card__btn" data-action="coach-add-prog" data-id="${esc(item.id)}">${upd ? 'Mettre à jour' : 'Ajouter'}</button>
      <button class="account-card__close" data-action="coach-dismiss-prog" data-id="${esc(item.id)}" aria-label="Plus tard">${icon('xmark', 16)}</button>
    </section>`;
}

// Ajout ou mise à jour d'un programme reçu ; programme modifié par l'élève : question avant d'écraser
async function addCoachProgrammeFlow(progId) {
  const item = coach.inbox?.programmes.find(p => p.id === progId);
  if (!item) return;
  const { status, modified } = coachProgrammeStatus(data, item);
  const name = item.data.name;
  if (status === 'update' && modified) {
    const choice = await dialog({ type: 'sheet', title: 'Remplacer tes changements ?',
      message: `Tu as modifié « ${name} ». La nouvelle version de ${coachName()} remplace tes changements. Tes séances déjà faites restent dans l'historique.`,
      actions: [{ label: 'Prendre la nouvelle version', value: 'replace', style: 'destructive' }, { label: 'Garder ma version', value: 'keep' }, { label: 'Annuler', style: 'cancel' }] });
    if (!choice) return;
    if (choice === 'keep') {
      keepMyCoachProgramme(data, item);
      save();
      coachMarkInboxSeen('programme', item.id);
      showToast('Ta version est gardée');
      render();
      return;
    }
  }
  const id = importCoachProgramme(data, item, coach.state?.coach);
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
  if (go === true) { activateProgramme(id); save(); showToast(`Programme : ${name}`); render(); }
}

// ── Élève : consignes et commentaire ────────────────────────

// Programme reçu d'un coach (programme perso marqué fromCoach), ou null
function coachProgOf(progId) { return data.userProgrammes?.[progId]?.fromCoach ? data.userProgrammes[progId] : null; }
function coachAuthor(up) { return up?.fromCoach?.name || 'ton coach'; }

// Programme › Séance : consigne du programme en tête
function coachEditorConsigneHtml(progId) {
  const up = coachProgOf(progId);
  if (!up?.consigne) return '';
  return `
        <div class="group-title">Consigne de ${esc(coachAuthor(up))}</div>
        <div class="group group--pad"><p class="coach-consigne">${esc(up.consigne)}</p></div>`;
}
// Programme › Séance : consigne d'un exercice sous son nom
function coachExConsigneSub(progId, ex) {
  if (!coachProgOf(progId) || !ex?.consigne) return '';
  return `<span class="cell__sub coach-ex-consigne">${esc(ex.consigne)}</span>`;
}

// Séance en cours : consigne de l'exercice du programme, repliable (une ligne quand elle est repliée)
function coachTipOf(ex) {
  const s = activeSession;
  if (!s || !coachProgOf(s.programme)) return null;
  const pe = (data.programmes[s.programme]?.exercises?.[s.category] || []).find(e => e.id === ex.exId);
  return pe?.consigne || null;
}
function coachSessionTipHtml(ex, label = '') {
  const tip = coachTipOf(ex);
  if (!tip) return '';
  const open = !coachTipClosed.has(ex.exId);
  return `<button class="coach-tip ${open ? '' : 'coach-tip--closed'}" data-action="coach-tip" data-ex="${esc(ex.exId)}" aria-expanded="${open}">
      <span class="coach-tip__head">${icon('info.circle', 14)}<span>${label ? `${esc(label)} · ` : ''}Consigne de ${esc(coachAuthor(coachProgOf(activeSession.programme)))}</span>${icon(open ? 'chevron.up' : 'chevron.down', 12)}</span>
      <span class="coach-tip__text">${esc(tip)}</span>
    </button>`;
}

// Historique › Séance : commentaire du coach
function historyCoachGroup(h) {
  const n = coachNoteFor(h.id);
  if (!n) return '';
  return `
        <div class="group-title">Commentaire de ${esc(coachName())}</div>
        <div class="group group--pad"><p class="hnotes coach-note">${esc(n.text)}</p></div>`;
}
// Ouverture d'Historique › Séance : son commentaire est vu
function coachHistoryMount() {
  const id = routeParams(currentRoute())[0];
  const n = id && coachNoteFor(id);
  if (n && !n.seen) coachMarkInboxSeen('note', id);
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
  return `
    <div class="view view--grouped coach-students-view">
      ${head}
      <div class="scr">
        ${coach.error ? `<p class="social-inline-error" role="status">${esc(coach.error === 'offline' ? 'Pas d\'Internet : liste pas à jour.' : coachErrorText(coach.error))}</p>` : ''}
        <div class="group-title">Élèves${st.students.length ? ` (${st.students.length})` : ''}</div>
        <div class="group">${rows || '<div class="cell"><span class="cell__sub social-empty">Aucun élève pour l\'instant</span></div>'}</div>
        <div class="group-foot">Tes élèves ne se voient pas entre eux.</div>
        <div class="group-title">Invitations</div>
        <div class="group">
          ${invites}
          <button class="cell cell--action" data-action="coach-invite">${icon('plus', 20)}<span>Inviter un élève</span></button>
        </div>
        <div class="group-foot">Chaque code est valable 7 jours et sert à plusieurs élèves. L'élève le saisit dans Réglages › Coach.</div>
      </div>
    </div>`;
}
SCREENS.set('coach-students', { render: () => renderCoachStudents(), enter: () => { coachRefresh(); } });

// ── Coach : un élève et ses séances ─────────────────────────

function coachStudent(uid) { return coach.state?.students.find(s => s.user_id === uid) || null; }

// Couleur d'une séance d'élève : celle de ma séance si elle vient de mon programme, sinon comme le fil
function coachSessionColor(s) {
  const mine = coachSentIdOf(s.programme);
  return (mine && data.userProgrammes?.[mine]?.sessions?.[s.category]?.color) || publicSessionColor({ ...s, programme: mine || s.programme });
}

function coachSessionCell(uid, row) {
  const s = row.s, mine = coachOwnProgrammeName(s.programme);
  return `
          <button class="hcell coach-sess" data-action="coach-open-session" data-uid="${esc(uid)}" data-id="${esc(row.id)}">
            <span class="hcell__dot" style="background:${coachSessionColor(s)}" aria-hidden="true"></span>
            <span class="hcell__body">
              <span class="hcell__top"><span class="hcell__title">${esc(s.label)}</span><span class="hcell__date">${fmtDate(row.doneAt)}</span></span>
              <span class="hcell__sub num">${esc(publicMetaLine(s))}</span>
              ${mine || row.note ? `<span class="coach-sess__tags">${mine ? '<span class="coach-tag">Ton programme</span>' : ''}${row.note ? '<span class="coach-tag coach-tag--note">Commentée</span>' : ''}</span>` : ''}
            </span>
          </button>`;
}

function renderCoachStudent(uid) {
  const p = coachStudent(uid);
  const head = navBar({ title: esc(personName(p)), large: false });
  if (!p) return `<div class="view view--grouped coach-student-view">${head}<div class="scr"><div class="empty-note">${coach.state ? 'Cet élève ne te suit plus.' : 'Chargement…'}</div></div></div>`;
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
  return `
    <div class="view view--grouped coach-student-view">
      ${head}
      <div class="scr">
        <div class="account-hero">
          ${personAvatar(p, 'xl')}
          <h2 class="account-hero__name">${esc(personName(p))}</h2>
          <p class="account-hero__sub">${sinceText(p) ? `Élève depuis le ${esc(sinceText(p))}` : 'Élève'}</p>
        </div>
        <div class="group">
          <button class="cell cell--action" data-action="coach-send" data-uid="${esc(uid)}">${icon('square.and.arrow.up', 20)}<span>Envoyer un programme</span></button>
        </div>
        <div class="group-title">Séances</div>
        ${list}
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="coach-remove" data-uid="${esc(uid)}">Retirer l'élève</button>
        </div>
        <div class="group-foot">Il ne te verra plus comme coach. Les programmes qu'il a déjà ajoutés restent chez lui.</div>
      </div>
    </div>`;
}
SCREENS.set('coach-student', {
  render: uid => renderCoachStudent(uid),
  // Séances relues à l'arrivée, puis vues (pastille et badge retirés)
  enter: () => {
    const uid = routeParams(currentRoute())[0];
    if (!uid) return;
    coachLoadSessions(uid);
    coachMarkSeen(uid);
  },
});

function renderCoachSession(uid, id) {
  const row = coachSessionOf(uid, id), p = coachStudent(uid);
  if (!row) return `<div class="view view--grouped coach-session-view">${navBar({ title: 'Séance' })}<div class="scr"><div class="empty-note">Cette séance n'est plus disponible.</div></div></div>`;
  const s = row.s, n = seriesCount(s), mine = coachOwnProgrammeName(s.programme);
  let when = capitalize(fmtDate(row.doneAt, 'long'));
  if (s.duration) when += ` · ${fmtTime(row.doneAt)}`;
  return `
    <div class="view view--grouped coach-session-view">
      ${navBar({ title: '' })}
      <div class="scr">
        <div class="social-who">${personAvatar(p)}<span class="social-who__name">${esc(personName(p))}</span></div>
        <h1 class="scr-title"><span class="hcell__dot hcell__dot--lg" style="background:${coachSessionColor(s)}" aria-hidden="true"></span>${esc(s.label)}</h1>
        <p class="scr-sub">${when}</p>
        ${mine ? `<p class="coach-sess__prog"><span class="coach-tag">Ton programme</span> ${esc(mine)}</p>` : ''}
        <div class="tiles">
          <div class="tile"><span class="tile__val num">${s.duration ? fmtDuration(s.duration) : '—'}</span><span class="tile__lbl">durée</span></div>
          <div class="tile"><span class="tile__val num">${s.exercises.length}</span><span class="tile__lbl">${s.exercises.length > 1 ? 'exercices' : 'exercice'}</span></div>
          <div class="tile"><span class="tile__val num">${n}</span><span class="tile__lbl">${n > 1 ? 'séries' : 'série'}</span></div>
        </div>
        <div class="group-title">Exercices</div>
        <div class="group">
          ${s.exercises.map((e, i, xs) => `
            <div class="cell hex">
              <span class="cell__body">
                <span class="hex__name">${ssTagHtml(xs, i)}${esc(e.name)}</span>
                <span class="hex__sets num">${setsLine(e.sets, e.measure || measureOf(e), setKind(e))}</span>
              </span>
            </div>`).join('') || '<div class="cell"><span class="cell__sub">Aucun exercice</span></div>'}
        </div>
        ${s.notes ? `<div class="group-title">Notes de ${esc(personName(p))}</div><div class="group group--pad"><p class="hnotes">${esc(s.notes)}</p></div>` : ''}
        ${s.hidden ? '<div class="group-foot">Séance masquée à ses abonnés : tu la vois en tant que coach.</div>' : ''}
        <div class="group-title">Ton commentaire</div>
        <div class="group">
          ${row.note ? `<div class="cell"><p class="hnotes coach-note">${esc(row.note)}</p></div>` : ''}
          <button class="cell cell--action" data-action="coach-comment" data-uid="${esc(uid)}" data-id="${esc(row.id)}">${icon('pencil', 18)}<span>${row.note ? 'Modifier le commentaire' : 'Commenter'}</span></button>
        </div>
        <div class="group-foot">${esc(personName(p))} le voit dans son historique, sous cette séance.</div>
      </div>
    </div>`;
}
SCREENS.set('coach-session', { render: (uid, id) => renderCoachSession(uid, id) });

// Feuille du commentaire : texte de 1000 caractères au plus, vide pour le retirer
function coachTextSheet({ title, value, placeholder, max, confirm = 'Enregistrer' }) {
  return sheet({ title, confirm,
    body: `<div class="coach-sheet"><textarea class="coach-textarea" id="coachSheetText" rows="6" maxlength="${max}" placeholder="${esc(placeholder)}" aria-label="${esc(title)}">${esc(value)}</textarea>
      <p class="coach-sheet__hint">Laisse vide pour retirer le commentaire.</p></div>`,
    onConfirm: panel => panel.querySelector('#coachSheetText').value });
}

// ── Coach : envoyer un programme avec des consignes ─────────

function coachSendDraftFor(route) {
  if (coachSendDraft?.route === route) return coachSendDraft;
  const progId = routeParams(route)[1];
  const ex = {};
  (progSessionsOf(data, progId)).forEach(s => {
    ex[s.key] = {};
    (data.programmes[progId]?.exercises?.[s.key] || []).forEach(e => { ex[s.key][e.id] = e.consigne || ''; });
  });
  coachSendDraft = { route, prog: data.userProgrammes?.[progId]?.consigne || '', ex };
  return coachSendDraft;
}

function renderCoachSend(uid, progId) {
  const p = coachStudent(uid);
  const name = progMeta(progId).name;
  const route = currentRoute();
  const dr = coachSendDraftFor(route);
  const sessions = progSessionsOf(data, progId);
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
        <p class="scr-sub">Pour ${esc(personName(p))} · ${plural(sessions.length, 'séance', 'séances')}</p>
        <div class="group-title">Consigne du programme</div>
        <div class="group group--pad">${ta('data-prog="1"', dr.prog, 'Consigne du programme', 'Ex : 3 séances par semaine, une journée de repos entre deux')}</div>
        <div class="group-foot">Les consignes sont facultatives. ${esc(personName(p))} les voit dans le programme et pendant la séance.</div>
        ${groups}
        <button class="btn btn--primary btn--full coach-send-btn" data-action="coach-send-go" data-uid="${esc(uid)}" data-prog="${esc(progId)}">Envoyer à ${esc(personName(p))}</button>
        <div class="group-foot">Ni tes charges, ni tes records, ni ton historique. Un nouvel envoi du même programme le met à jour chez lui.</div>
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

function coachInviteText(code) {
  return `Je te propose de te suivre sur MDLF Training. Dans l'app : Réglages › Coach › Rejoindre un coach, puis saisis le code ${code}. Il est valable 7 jours.`;
}
async function shareCoachInvite(code) {
  const text = coachInviteText(code);
  if (Native.isNative) { if ((await Native.shareText(text, 'Invitation')) === 'failed') showToast('Partage impossible', { error: true }); return; }
  if (navigator.share) { try { await navigator.share({ text }); } catch {} return; }
  try { await navigator.clipboard.writeText(text); showToast('Invitation copiée, colle-la dans un message'); }
  catch { showToast(`Code : ${code}`); }
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
  'coach-join': async () => {
    const raw = await askText({ title: 'Rejoindre un coach', message: 'Saisis le code reçu de ton coach.', placeholder: 'Ex : K7M2QX9P', confirm: 'Suivant' });
    if (!raw) return;
    const code = normalizeCoachCode(raw);
    if (!code) { showToast('Ce code n\'a pas la bonne forme : 8 lettres et chiffres.', { error: true }); return; }
    const r = await coachPreview(code);
    if (!coachToast(r)) return;
    navigate(makeRoute('coach-join', code));
  },
  'coach-accept': async (e, el) => {
    el.disabled = true;
    const name = personName(coach.preview?.person);
    const r = await coachJoin(el.dataset.code);
    if (!coachToast(r, `${name} est ton coach`)) { el.disabled = false; return; }
    haptic();
    goBack();
  },
  'coach-leave': async () => {
    const name = coachName();
    if (!(await confirmSheet(`Quitter ${name} ?`, `${name} ne verra plus tes séances. Ses commentaires sont effacés. Les programmes déjà ajoutés restent dans tes programmes.`, 'Quitter mon coach'))) return;
    const r = await coachLeave();
    if (!coachToast(r, 'Tu n\'as plus de coach')) return;
    if (currentView() === 'coach-mine') goBack(); else render();
  },
  'coach-add-prog': async (e, el) => { await addCoachProgrammeFlow(el.dataset.id); },
  'coach-dismiss-prog': (e, el) => { coachMarkInboxSeen('programme', el.dataset.id); render(); showToast('Il reste dans Amis › Mon coach'); },
  'coach-open-history': (e, el) => navigate(makeRoute('history-detail', el.dataset.id)),
  'coach-tip': (e, el) => {
    const id = el.dataset.ex;
    if (coachTipClosed.has(id)) coachTipClosed.delete(id); else coachTipClosed.add(id);
    render();
  },
  'coach-invite': async () => {
    const r = await coachCreateInvite();
    if (!coachToast(r)) return;
    haptic();
    await shareCoachInvite(r.data);
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
    if (!(await confirmSheet(`Retirer ${name} ?`, `Tu ne verras plus ses séances. Tes commentaires et les programmes pas encore ajoutés sont effacés.`, 'Retirer l\'élève'))) return;
    const r = await coachRemoveStudent(el.dataset.uid);
    if (!coachToast(r, `${name} retiré`)) return;
    routeTo('coach-students');
  },
  'coach-comment': async (e, el) => {
    const { uid, id } = el.dataset;
    const row = coachSessionOf(uid, id);
    if (!row) return;
    const key = uid + '/' + id;
    const value = coachNoteDraft?.key === key ? coachNoteDraft.text : row.note;
    const text = await coachTextSheet({ title: row.note ? 'Modifier le commentaire' : 'Commenter', value, placeholder: 'Ex : Belle séance, garde 2 minutes de repos sur le squat.', max: COACH_NOTE_MAX });
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
    coachSendDraft = null;
    navigate(makeRoute('coach-send', uid, progId));
  },
  'coach-send-go': async (e, el) => {
    const { uid, prog } = el.dataset;
    const dr = coachSendDraftFor(currentRoute());
    el.disabled = true;
    const r = await coachSendProgramme(uid, prog, { prog: dr.prog, ex: dr.ex });
    if (!coachToast(r, `Programme envoyé à ${personName(coachStudent(uid))}`)) { el.disabled = false; return; }
    // Consignes gardées dans mon programme : le prochain envoi les reprend
    const up = data.userProgrammes?.[prog];
    if (up) { if (cleanConsigne(dr.prog)) up.consigne = cleanConsigne(dr.prog); else delete up.consigne; }
    Object.entries(dr.ex).forEach(([cat, m]) => (data.programmes[prog]?.exercises?.[cat] || []).forEach(x => {
      if (!(x.id in m)) return;
      const c = cleanConsigne(m[x.id]);
      if (c) x.consigne = c; else delete x.consigne;
    }));
    save();
    haptic();
    coachSendDraft = null;
    goBack();
  },
});

// Saisie des consignes : recopiées dans le brouillon, sans redessiner (le champ garde le clavier)
document.addEventListener('input', e => {
  const t = e.target;
  if (!t.matches?.('.coach-send-view .coach-textarea') || !coachSendDraft) return;
  if (t.dataset.prog) coachSendDraft.prog = t.value;
  else if (t.dataset.cat && t.dataset.ex) (coachSendDraft.ex[t.dataset.cat] ||= {})[t.dataset.ex] = t.value;
});

// ── Mises à jour de l'écran ─────────────────────────────────

onCoachChange(() => {
  updateTabBadge();
  const v = currentView();
  if (v === 'friends') { refreshCoachCell(); return; }
  if (v === 'settings') { render(); return; }
  if (v === 'coach-send' && document.activeElement?.matches?.('textarea')) return;
  if (COACH_VIEWS.includes(v) || v === 'dashboard' || v === 'history-detail' || v === 'editor') render();
});
