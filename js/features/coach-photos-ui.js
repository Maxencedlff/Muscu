// ═══════════════════════════════════════════════════════════
//  Photos de bilan, écrans. Données, chiffrement et appels : js/data/coach-photos.js ; contrat :
//  docs/PHOTOS_BILAN.md.
//
//  - Élève : dans le coffre ouvert (Face ID déjà passé), « Envoyer à mon coach » sur un jour → feuille avec les
//    photos de ce jour ; chacune se coche à part (« Ton coach verra cette photo. Tu peux la retirer quand tu
//    veux. ») ; une seule photo ce jour-là : elle est montrée seule et le bouton dit « Envoyer cette photo ».
//    Mon coach › Bilan › Photos de bilan (`coach-photos-mine`) : ce qui est parti, « Retirer » sur chaque photo.
//  - Coach : fiche de l'élève, groupe « Photos de bilan » ; `coach-photos:UID` s'ouvre avec Face ID : photos par
//    date, deux dates côte à côte pour comparer. Aucun bouton pour enregistrer, appui long sans menu, contenu
//    masqué dans le sélecteur d'apps, refermé en quittant l'écran, en arrière-plan, après une minute sans toucher.
//  - Serveur pas à jour ou module du coffre absent : rien ne s'affiche.
//  Tout texte venu du serveur passe par esc(). Rien au pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

const cphUrls = new Map();   // coach : id → URL d'objet des photos déchiffrées, révoquées à la fermeture
let cphView = { uid: null, phase: 'loading', msg: '', a: null, b: null, done: 0, broken: 0 };
let cphPicked = new Set();   // feuille d'envoi : photos du coffre cochées

const cphCoachName = () => esc(coachName() || 'ton coach');
const cphSize = n => (n ? fmtBytes(n) : '');
const cphPoseDay = p => `${photoPoseLabel(p.pose)} · ${fmtDate(cphDayTs(p.takenOn), 'short')}`;
// Code de la clé du coach (élève) : replié sous « Vérifier le code avec ton coach » (panel du 08/11 : au milieu du texte,
// ce code inquiétait plus qu'il n'aidait). Ouvert : le chiffrement en une phrase et le code à comparer.
let cphVerifyOpen = false;
function cphVerifyHtml(code) {
  if (!code) return '';
  return `
        <div class="group">
          <button class="cell cell--nav cph-verify" data-action="cph-verify" aria-expanded="${cphVerifyOpen}">
            <span class="cell__body"><span class="cell__title">Vérifier le code avec ton coach</span></span>
            ${icon(cphVerifyOpen ? 'chevron.down' : 'chevron.right', 16)}
          </button>${cphVerifyOpen ? `
          <div class="cell"><span class="cell__body"><span class="cell__sub">Tes photos sont protégées sur ton iPhone : seul ton coach peut les ouvrir, ni nous ni personne d'autre. Pour t'en assurer, demande-lui le code écrit en bas de ta page Photos de bilan, dans son app. Il doit être le même que celui-ci : <span class="num cph-code">${esc(code)}</span>. S'il est différent, n'envoie plus de photo et préviens-le.</span></span></div>` : ''}
        </div>`;
}

// ── Élève : coffre ──────────────────────────────────────────

// Bouton d'un jour du coffre ouvert (coach prêt à recevoir, place libre ce jour-là)
function cphDaySendHtml(g) {
  if (!cphStudentShown() || !cph.state.ready) return '';
  const day = g.day, sentDay = cph.state.photos.filter(p => p.takenOn === day).length;
  const unsent = g.photos.filter(p => !cphSentOf(p.id));
  if (!unsent.length || sentDay >= CPH_PER_DAY) return '';
  return `<button class="cph-daybtn" data-action="cph-send-day" data-day="${esc(day)}">${icon('paperplane', 16)}<span>Envoyer à mon coach</span></button>`;
}
// « Envoyer depuis mon coffre » (Mon coach › Photos de bilan) : une fois le coffre ouvert, la feuille d'envoi du jour le plus
// récent qui a encore une photo à envoyer (panel Apple du 08/11 : le bouton ouvrait le coffre et un paragraphe expliquait
// la suite). Aucun jour à envoyer : le coffre reste ouvert, avec un mot.
function cphSendLatestDay() {
  if (!cphStudentShown() || !cph.state?.ready) return;
  const day = photoDayGroups(photoCache || []).find(g => g.photos.some(p => !cphSentOf(p.id))
    && cph.state.photos.filter(p => p.takenOn === g.day).length < CPH_PER_DAY)?.day;
  if (day) cphSendSheet(day);
  else showToast((photoCache || []).length ? 'Tes photos sont déjà envoyées' : 'Ajoute d\'abord une photo à ton coffre');
}
// Feuille d'une photo du coffre : déjà envoyée ? (date, et la retirer)
function cphVaultPhotoHtml(p) {
  const s = cphStudentListed() ? cphSentOf(p.id) : null;   // retirer reste possible quand l'envoi ne l'est plus
  if (!s) return '';
  return `<p class="pview__meta">Envoyée à ${cphCoachName()} le ${esc(fmtDate(s.sentAt || Date.now(), 'short'))}</p>
    <button class="btn btn--danger btn--full cph-gap" data-action="cph-remove" data-id="${esc(s.id)}">Retirer de chez ${cphCoachName()}</button>`;
}
function cphVaultFoot() {
  return account.user && coachRole().hasCoach && !cphAgeBlocked() && !cphDisabled() ? 'Rien n\'est montré à tes amis. Ton coach ne voit que les photos que tu lui envoies toi-même.'
    : cphNobodyTxt();
}
// Personne ne voit rien : « ni à ton coach » seulement à qui en a un (sans coach, la phrase en supposait un)
function cphNobodyTxt() {
  return account.user && coachRole().hasCoach ? 'Rien n\'est montré à tes amis ni à ton coach.' : 'Rien n\'est montré à personne.';
}

async function cphSendSheet(day) {
  if (!vaultIsOpen() || cph.busy || !cphStudentShown()) return;
  const sentDay = cph.state?.photos.filter(p => p.takenOn === day).length || 0;
  const list = (photoCache || []).filter(p => localISO(p.date) === day);
  const free = CPH_PER_DAY - sentDay;
  if (!list.length || free <= 0) return;
  cphPicked = new Set();
  const unsent = list.filter(p => !cphSentOf(p.id));
  const single = unsent.length === 1;
  const item = p => {
    const done = !!cphSentOf(p.id);
    const pose = photoPoseLabel(p.pose);
    if (single && !done) {
      return `<div class="cphs__one"><img class="cphs__img pview__img" src="${photoUrl(p)}" alt="${pose}, ${esc(fmtDate(p.date))}" draggable="false"></div>`;
    }
    return `<button type="button" class="cphs__item" role="checkbox" aria-checked="false" data-action="cph-pick" data-id="${esc(p.id)}" ${done ? 'disabled' : ''}
      aria-label="${pose}, ${done ? 'déjà envoyée' : 'envoyer cette photo'}" ${done ? '' : `aria-describedby="cphs-ok-${esc(p.id)}"`}>
      <span class="cphs__thumb"><img class="cphs__img" src="${photoUrl(p)}" alt="" draggable="false"><span class="cphs__check" aria-hidden="true">${icon('checkmark', 14)}</span></span>
      <span class="cphs__body"><span class="cphs__pose">${pose}</span>
        <span class="cphs__sub">${done ? 'Déjà envoyée' : 'Touche pour la choisir'}</span>
        <span class="cphs__ok" id="cphs-ok-${esc(p.id)}">Ton coach verra cette photo. Tu peux la retirer quand tu veux.</span></span>
    </button>`;
  };
  const lead = single ? '<p class="cphs__lead">Ton coach verra cette photo. Tu peux la retirer quand tu veux.</p>'
    : `<p class="cphs__lead">Choisis chaque photo à envoyer${free < unsent.length ? ` (${free} au plus)` : ''}.</p>`;
  await sheet({ title: 'Envoyer', cancel: 'Annuler', confirm: '', body: `
    <p class="cphs__day">${esc(fmtDate(cphDayTs(day)))}</p>
    ${lead}
    <div class="cphs__list">${list.map(item).join('')}</div>
    <button class="btn btn--primary btn--full cphs__go" data-action="cph-send-go" data-day="${esc(day)}" ${single ? `data-one="${esc(unsent[0].id)}"` : 'disabled'}>${single ? 'Envoyer cette photo' : 'Envoyer'}</button>
    <p class="mpick__foot">À ${cphCoachName()} seulement, chiffrée sur ton iPhone, sans la localisation ni aucune autre donnée de la photo.</p>` });
  cphPicked = new Set();
}
function cphPickToggle(el) {
  const id = el.dataset.id, root = el.closest('.sheet');
  const free = CPH_PER_DAY - (cph.state?.photos.filter(p => p.takenOn === $('.cphs__go', root)?.dataset.day).length || 0);
  if (cphPicked.has(id)) cphPicked.delete(id);
  else if (cphPicked.size >= free) { showToast(`${plural(CPH_PER_DAY, 'photo', 'photos')} par jour au plus`, { error: true }); return; }
  else cphPicked.add(id);
  const on = cphPicked.has(id);
  el.setAttribute('aria-checked', String(on));
  el.classList.toggle('cphs__item--on', on);
  if (on) announce('Ton coach verra cette photo. Tu peux la retirer quand tu veux.');   // la phrase qui apparaît, dite aussi
  const go = $('.cphs__go', root);
  if (go) { go.disabled = !cphPicked.size; go.textContent = cphPicked.size ? `Envoyer ${plural(cphPicked.size, 'photo', 'photos')}` : 'Envoyer'; }
}
// Avant l'envoi : 18 ans ou plus (déclaré une fois), et clé du coach inchangée depuis le dernier envoi (sinon l'élève
// est prévenu et peut vérifier le code avec son coach). false : rien ne part.
async function cphSendChecks() {
  // Tranche d'âge d'Apple autre que « 18 ans ou plus » : rien ne part, et la déclaration n'est jamais proposée
  if (cphAgeBlocked()) { showToast(cphErrorText('not_adult'), { error: true }); return false; }
  if (cph.state && !cph.state.adult) {
    const ok = await dialog({ title: 'As-tu 18 ans ou plus ?', message: 'Les photos de bilan sont réservées aux 18 ans et plus.',
      actions: [{ label: 'Non', style: 'cancel' }, { label: 'J\'ai 18 ans ou plus', value: true, style: 'preferred' }] });
    if (!ok) return false;
    const r = await cphDeclareAdult();
    if (!r.ok) { showToast(coachErrorText(r.kind), { error: true }); return false; }
  }
  if (cphKeyChanged()) {
    const shown = cph.state.key.public_key;   // la clé dont le code est montré : seule elle est acceptée
    const ok = await dialog({ title: 'La clé de ton coach a changé', message: `Il a pu changer d'iPhone. Avant d'envoyer, vérifiez ensemble que son app montre le même code : ${cph.code}.`,
      actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'C\'est le même code', value: true, style: 'preferred' }] });
    if (!ok) return false;
    cphPinKey(shown);
  }
  return true;
}
async function cphSendGo(el) {
  const ids = el.dataset.one ? [el.dataset.one] : [...cphPicked];
  const photos = ids.map(id => (photoCache || []).find(p => p.id === id)).filter(Boolean);
  if (!photos.length || cph.busy) return;
  if (!(await cphSendChecks())) return;
  el.disabled = true;
  el.setAttribute('aria-busy', 'true');
  el.textContent = 'Envoi…';
  const r = await cphSend(photos);
  el.closest('.sheet-root')?._close?.(null);
  if (currentView() === 'photo-vault') pvPaint();
  if (r.ok) {
    haptic('success');
    // « Retirer » tout de suite (un seul verbe pour ce geste, panels de la vague 3), sans repasser par Mon coach › Photos de bilan (panel Apple du 08/11), comme « Annuler »
    // après une série : le geste vient d'être fait, pas de confirmation de plus
    const sentIds = photos.map(p => cphSentOf(p.id)?.id).filter(Boolean);
    showToast(r.sent > 1 ? `${plural(r.sent, 'photo envoyée', 'photos envoyées')} à ${coachName()}` : `Photo envoyée à ${coachName()}`,
      sentIds.length ? { action: 'Retirer', duration: 6000, onAction: () => cphUndoSend(sentIds) } : {});
    return;
  }
  const done = r.sent ? `${plural(r.sent, 'photo envoyée', 'photos envoyées')}, la suite n'est pas partie. ` : '';
  showToast(done + cphErrorText(r.kind), { error: true });
}
const CPH_ERRORS = {
  locked: 'Le coffre s\'est refermé : rien d\'autre n\'est parti.',
  not_ready: 'Ton coach n\'a pas encore activé la réception des photos.',
  key_changed: 'Ton coach a changé de clé : réessaie.',
  too_many: 'Trop de photos chez ton coach : retires-en avant d\'en envoyer d\'autres.',
  invalid_photo: 'Cette photo ne peut pas être envoyée.',
  not_uploaded: 'Envoi interrompu, rien n\'est resté sur le serveur. Réessaie.',
};
function cphErrorText(kind) { return CPH_ERRORS[kind] || coachErrorText(kind); }

// ── Élève : Mon coach › Photos de bilan ─────────────────────

// Cellule de Mon coach (groupe Bilan), et de « Partager avec mon coach »
function cphMineCellHtml() {
  const n = cphStudentListed() ? cph.state.photos.length : 0;
  // Envoi interdit par la tranche d'âge : la cellule ne reste que pour retirer ce qui serait déjà parti
  if (!cphStudentShown() && !n) return '';
  return `
        <div class="group-title">Bilan</div>
        <div class="group">
          <button class="cell cell--nav" data-action="cph-open-mine">
            ${icon('lock', 20)}
            <span class="cell__body"><span class="cell__title">Photos de bilan</span>
              <span class="cell__sub">${n ? plural(n, 'photo envoyée', 'photos envoyées') : cph.state.ready ? 'Envoie-les depuis ton coffre' : 'Ton coach ne les reçoit pas encore'}</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}
function renderCphMine() {
  const head = navBar({ title: 'Photos de bilan', large: false });
  const view = body => `<div class="view view--grouped coach-photos-mine-view">${head}<div class="scr">${body}</div></div>`;
  if (!account.user || !coachRole().hasCoach) return view('<div class="empty-note">Rejoins d\'abord un coach : « Rejoindre un coach », en haut de l\'onglet Social.</div>');
  const st = cph.state, name = cphCoachName();
  if (!st) return view(cph.error && !cph.missing ? coachOfflineNote(cph.error, 'Pas d\'Internet. Tes photos envoyées s\'afficheront avec du réseau.') : '<div class="empty-note">Chargement…</div>');
  // Le coffre se referme dès qu'on le quitte : pas de miniature ici. Toucher la ligne ouvre la photo d'origine dans le coffre
  // (Face ID), là où elle se retire aussi ; une photo envoyée d'un autre appareil ou supprimée du coffre n'a que sa
  // pose et son jour, numérotés quand deux se ressemblent (panel du 08/11 : deux « Face » indiscernables)
  const twins = {};
  st.photos.forEach(p => { const k = `${p.pose}|${p.takenOn}`; twins[k] = (twins[k] || 0) + 1; });
  const seen = {};
  const label = p => { const k = `${p.pose}|${p.takenOn}`; seen[k] = (seen[k] || 0) + 1; return twins[k] > 1 ? `${cphPoseDay(p)} (${seen[k]})` : cphPoseDay(p); };
  const rows = cphDays(st.photos).map(g => g.photos.map(p => { const name = label(p), vid = vaultAvailable() ? cphVaultIdOf(p.id) : null; return `
          <div class="cell cph-row">
            ${vid ? '<button class="cell__body cph-row__see"' + ` data-action="cph-see" data-id="${esc(vid)}" aria-label="${esc(`${name}, voir dans le coffre`)}">` : '<span class="cell__body">'}<span class="cell__title">${esc(name)}</span>
              <span class="cell__sub">${p.sentAt ? `Envoyée le ${esc(fmtDate(p.sentAt, 'short'))}` : 'Envoyée'}${cphSize(p.bytes) ? ` · ${esc(cphSize(p.bytes))}` : ''}</span>${vid ? `
              <span class="cph-row__link">Voir dans le coffre</span></button>` : '</span>'}
            <button class="cph-remove" data-action="cph-remove" data-id="${esc(p.id)}" aria-label="Retirer la photo ${esc(name)}">Retirer</button>
          </div>`; }).join('')).join('');
  const send = cphDisabled() ? `<div class="group"><div class="cell"><span class="cell__body"><span class="cell__sub">L'envoi de photos de bilan est suspendu pour l'instant. Tu peux retirer celles qui sont déjà parties.</span></span></div></div>`
    : cphAgeBlocked() ? `<div class="group"><div class="cell"><span class="cell__body"><span class="cell__sub">Les photos de bilan sont réservées aux 18 ans et plus. Tu peux retirer celles qui sont déjà parties.</span></span></div></div>`
    : st.ready ? `
        <div class="group">
          <button class="cell cell--action" data-action="cph-send-from-vault">${icon('paperplane', 20)}<span>Envoyer depuis mon coffre</span></button>
        </div>`
    : `<div class="group"><div class="cell"><span class="cell__body"><span class="cell__sub">${name} n'a pas encore activé la réception des photos dans son app. Dès que c'est fait, tu pourras lui en envoyer depuis ton coffre.</span></span></div></div>`;
  return view(`
        ${coachTitle(`Avec ${name}`)}
        ${send}
        <div class="group-title">Envoyées</div>
        <div class="group">${rows || '<div class="cell"><span class="cell__sub">Aucune photo envoyée.</span></div>'}</div>
        <div class="group-foot">${name} voit seulement les photos que tu lui envoies, avec leur jour et leur pose. « Retirer » : ton coach ne la voit plus, elle reste dans ton coffre.</div>
        <div class="group-foot">Quitter ton coach ou supprimer ton compte les retire toutes. Ce que ton coach a déjà vu ne peut pas s'effacer de sa mémoire : n'envoie que ce que tu acceptes de montrer.</div>
        ${st.ready && cphStudentShown() ? cphVerifyHtml(cph.code) : ''}`);
}
SCREENS.set('coach-photos-mine', { render: () => renderCphMine(), enter: () => { cphRefresh(); } });

// « Retirer » du toast d'envoi : les photos qui viennent de partir sont effacées de chez le coach
async function cphUndoSend(ids) {
  let done = 0, fail = null;
  for (const id of ids) { const r = await cphRemove(id); if (r.ok) done++; else fail = fail || r.kind; }
  if (fail) showToast(coachErrorText(fail), { error: true });
  else showToast(done > 1 ? `${plural(done, 'photo retirée', 'photos retirées')} de chez ton coach` : 'Photo retirée de chez ton coach');
  if (['photo-vault', 'coach-photos-mine'].includes(currentView())) render();
}
async function cphRemoveFlow(id) {
  if (!(await confirmSheet('Retirer cette photo ?', `${coachName() || 'Ton coach'} ne la verra plus. Elle reste dans ton coffre.`, 'Retirer'))) return;
  const r = await cphRemove(id);
  if (!r.ok) { showToast(coachErrorText(r.kind), { error: true }); return; }
  document.querySelectorAll('.sheet-root').forEach(el => { if (el.querySelector('[data-action="cph-remove"]')) el._close?.(null); });
  showToast('Photo retirée de chez ton coach');
  if (['photo-vault', 'coach-photos-mine'].includes(currentView())) render();
}

// ── Coach : fiche de l'élève ────────────────────────────────

// « Recevoir les photos de bilan » (une fois pour tous les élèves) : dans la fiche de chaque élève, et sous la liste
// de Coach › Élèves tant que ce n'est pas fait (panel du 08/11 : caché élève par élève, on ne le trouvait pas)
function cphSetupGroupHtml() {
  return `
        <div class="group-title">Photos de bilan</div>
        <div class="group">
          <button class="cell cell--action" data-action="cph-setup" ${cphCoach.busy ? 'disabled' : ''}><span>Recevoir les photos de bilan</span></button>
        </div>
        <div class="group-foot">Tes élèves pourront t'envoyer des photos, chiffrées pour toi seul, que tu ouvres avec Face ID. Une fois pour tous tes élèves.</div>`;
}
function cphTeamSetupHtml(students) {
  return students.length && cphCoachShown() && !cphCoach.key ? cphSetupGroupHtml() : '';
}
function cphCoachGroupHtml(uid) {
  if (!cphCoachShown()) return '';
  if (!cphCoach.key) return cphSetupGroupHtml();
  const f = cphStudentOf(uid), n = f.photos.length;
  const last = n ? f.photos[0] : null;
  return `
        <div class="group-title">Photos de bilan</div>
        <div class="group">
          <button class="cell cell--nav" data-action="cph-open" data-uid="${esc(uid)}">
            ${icon('lock', 20)}
            <span class="cell__body"><span class="cell__title">${n ? plural(n, 'photo', 'photos') : 'Photos de bilan'}</span>
              <span class="cell__sub${cphCoach.mismatch ? ' cph-alert' : ''}">${cphCoach.mismatch ? CPH_MISMATCH_TITLE : last ? `Dernière du ${esc(fmtDate(cphDayTs(last.takenOn), 'short'))}` : f.loadedAt ? 'Aucune photo pour l\'instant' : 'Ouverture avec Face ID'}</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

// ── Coach : photos d'un élève ───────────────────────────────

const CPH_MISMATCH_TITLE = 'La clé enregistrée sur le serveur n\'est plus la tienne';
function cphPhotoUrl(p) { return cphUrls.get(p.id) || ''; }
function cphRevoke() { cphUrls.forEach(u => URL.revokeObjectURL(u)); cphUrls.clear(); }
function renderCphCoach(uid) {
  const p = coachStudent(uid);
  // « Verrouiller » dans la barre, comme le coffre de l'élève (experts Apple, vague 3-t4), en toutes lettres (une icône = un
  // sens, docs/ERGONOMIE.md). La barre reprend le grand titre en version courte (« Photos », data-bar-title) : « Photos de
  // bilan » ne tient pas à côté de « ‹ lea » et de « Verrouiller » sur 320 à 375 pt
  const right = cphView.phase === 'open' ? `<button class="navbar__text" data-action="cph-lock" aria-label="Verrouiller les photos">Verrouiller</button>` : '';
  const head = navBar({ title: '', right });
  const view = (body, cls = '') => `<div class="view view--grouped coach-photos-view ${cls}">${head}<div class="scr">${body}</div></div>`;
  if (!p) return view(`<div class="empty-note">${coach.state ? 'Cette personne ne fait plus partie de tes élèves.' : 'Chargement…'}</div>`);
  const who = esc(personName(p));
  if (!cphCoachShown() || !cphCoach.key) return view(`<div class="empty-note">${cphCoach.error && !cphCoach.missing ? esc(coachErrorText(cphCoach.error)) : 'Les photos de bilan ne sont pas disponibles ici.'}</div>`);
  const ph = cphView.phase;
  if (ph !== 'open') {
    const txt = {
      loading: 'Ouverture…',
      locked: cphView.msg || 'Ouvre-les avec Face ID ou le code de ton iPhone.',
      missing: 'La clé de tes photos n\'est pas encore sur cet iPhone. Sur un nouvel iPhone, elle arrive avec le trousseau iCloud, parfois après un moment : réessaie plus tard.',
      nopasscode: 'Les photos s\'ouvrent avec Face ID ou le code de ton iPhone. Active un code dans Réglages › Face ID et code.',
      mismatch: cphCoach.own
        ? 'Le serveur donne à tes élèves une autre clé que la tienne : ce qu\'ils enverraient avec elle ne serait pas chiffré pour toi seul. Republie ta clé, puis vérifiez le code ensemble. Les photos reçues pour la clé du serveur seront effacées.'
        : 'Le serveur donne à tes élèves une autre clé que la tienne, et la tienne n\'est pas sur cet iPhone. Crée une nouvelle clé, puis vérifiez le code ensemble.',
    }[ph] || '';
    const myCode = ph === 'mismatch' && cphCoach.myCode ? `<p class="pv-sub">Code de ta clé : <span class="num cph-code">${esc(cphCoach.myCode)}</span></p>` : '';
    return view(`
        <div class="pv-center">
          <div class="pv-glyph pv-glyph--sm" aria-hidden="true">${icon('lock', 26)}</div>
          <h1 class="pv-title" id="cphTitle" tabindex="-1">${ph === 'missing' ? 'Clé absente de cet iPhone' : ph === 'mismatch' ? esc(CPH_MISMATCH_TITLE) : `Photos ${elide('de', who)}`}</h1>
          <p class="pv-sub" role="status">${esc(txt)}</p>
          ${myCode}
          ${ph === 'locked' ? `<button class="btn btn--primary pv-cta pv-open" data-action="cph-unlock">${icon('faceid', 20)}<span>Ouvrir</span></button>` : ''}
          ${ph === 'missing' || ph === 'nopasscode' ? '<button class="btn btn--primary pv-cta" data-action="cph-unlock">Réessayer</button>' : ''}
          ${ph === 'mismatch' && cphCoach.own ? '<button class="btn btn--primary pv-cta" data-action="cph-republish">Republier ma clé</button>' : ''}
          ${ph === 'missing' || ph === 'mismatch' ? '<button class="pv-link pv-link--danger" data-action="cph-rekey">Créer une nouvelle clé…</button>' : ''}
        </div>`, 'pv-locked');
  }
  const f = cphStudentOf(uid), list = f.photos.filter(x => cphUrls.has(x.id));
  const days = cphDays(list);
  const foot = `<div class="group-foot">Envoyées par ${who}, chiffrées pour toi seul. ${who} peut les retirer à tout moment ; elles disparaissent aussi si le suivi s'arrête. Ne les enregistre pas, ne les montre pas et ne les publie pas sans son accord écrit.${cphCoach.session?.code ? ` Code de ta clé : <span class="num cph-code">${esc(cphCoach.session.code)}</span> ; ${who} voit le même dans son app.` : ''}</div>`;
  if (!days.length) {
    const msg = f.loading || cphView.done < f.photos.length ? 'Ouverture des photos…' : f.photos.length ? 'Ces photos ne s\'ouvrent pas sur cet iPhone.' : `${who} ne t'a pas encore envoyé de photo.`;
    return view(`<h1 class="scr-title" id="cphTitle" tabindex="-1">Photos de bilan</h1><p class="scr-sub">${who}</p><div class="empty-note">${msg}</div>${foot}`);
  }
  const dayKeys = days.map(d => d.day);
  // Par défaut (tant que le coach n'a rien choisi) : la date la plus ancienne contre la plus récente, recalculées pendant
  // que les photos s'ouvrent une à une
  const sel = { a: dayKeys.includes(cphView.a) ? cphView.a : dayKeys[dayKeys.length - 1], b: dayKeys.includes(cphView.b) ? cphView.b : dayKeys[0] };
  const opts = sel => dayKeys.slice().reverse().map(d => `<option value="${d}" ${d === sel ? 'selected' : ''}>${esc(fmtDate(cphDayTs(d), 'short'))}</option>`).join('');
  const byDay = d => days.find(x => x.day === d)?.photos || [];
  const poses = PHOTO_POSE_KEYS.filter(k => byDay(sel.a).some(x => x.pose === k) || byDay(sel.b).some(x => x.pose === k));
  const cellImg = (d, k) => { const x = byDay(d).find(y => y.pose === k);
    return x ? `<button class="cph-shot" data-action="cph-view" data-id="${x.id}" aria-label="${photoPoseLabel(k)}, ${esc(fmtDate(cphDayTs(d)))}"><img src="${cphPhotoUrl(x)}" alt="" draggable="false"></button>`
      : '<span class="cph-shot cph-shot--none">Pas de photo</span>'; };
  const compare = days.length > 1 ? `
        <div class="group-title">Comparer</div>
        <div class="group group--pad">
          <div class="pcmp__cols">${[['a', 'Avant'], ['b', 'Après']].map(([s, l]) => `
            <label class="pcmp__col"><span class="pcmp__lbl">${l}</span><span class="pcmp__pick"><select class="pcmp__sel cph-sel" data-side="${s}" id="cph-${s}">${opts(sel[s])}</select>${icon('chevron.up.chevron.down', 14)}</span></label>`).join('')}
          </div>
          ${poses.map(k => `
          <div class="cph-pair"><span class="cph-pair__pose">${photoPoseLabel(k)}</span>
            <div class="cph-pair__row">${cellImg(sel.a, k)}${cellImg(sel.b, k)}</div></div>`).join('')}
          <div class="pcmp__gap">${(() => { const g = Math.abs(daysAgo(cphDayTs(sel.a), cphDayTs(sel.b))); return g ? `${plural(g, 'jour', 'jours')} d'écart` : 'Même jour'; })()}</div>
        </div>` : '';
  const grid = days.map(d => `
            <div class="pgal__day"><span class="pgal__date">${esc(fmtDate(cphDayTs(d.day)))}</span>
              <div class="pgal__row">${d.photos.map(x => `
                <button class="pgal__item cph-item" data-action="cph-view" data-id="${x.id}" aria-label="${photoPoseLabel(x.pose)}, ${esc(fmtDate(cphDayTs(d.day)))}">
                  <img src="${cphPhotoUrl(x)}" alt="" draggable="false"><span class="pgal__pose">${photoPoseLabel(x.pose)}</span></button>`).join('')}</div>
            </div>`).join('');
  const broken = cphView.broken ? `<p class="pv-summary">${plural(cphView.broken, 'photo ne s\'ouvre pas', 'photos ne s\'ouvrent pas')} sur cet iPhone.</p>` : '';
  return view(`
        <h1 class="scr-title" id="cphTitle" tabindex="-1" data-bar-title="Photos">Photos de bilan</h1>
        <p class="scr-sub">${who} · ${plural(list.length, 'photo', 'photos')} · se referment après une minute sans activité</p>
        ${broken}
        ${compare}
        <div class="group-title">Par date</div>
        <div class="group"><div class="cell"><div class="pgal">${grid}</div></div></div>
        ${foot}`);
}

function cphPaint() {
  if (currentView() !== 'coach-photos') return;
  render();
}
// Entrée : liste relue, Face ID demandé d'emblée
async function cphCoachEnter() {
  const uid = routeParams(currentRoute())[0];
  cphView = { uid, phase: cphIsOpen() ? 'open' : 'loading', msg: '', a: null, b: null, done: 0, broken: 0 };
  if (cphCoach.key === undefined) await cphCoachRefresh();
  if (!cphCoach.key) { cphPaint(); return; }
  await cphCoachLoad(uid);
  if (cphIsOpen()) { cphLoadImages(uid); return; }
  cphView.phase = 'locked';
  // Clé du serveur autre que celle retenue ici : dit avant Face ID (qui la vérifie : levé si elle est bien la mienne)
  if (cphCoach.mismatch) cphView.msg = 'La clé du serveur n\'est pas celle retenue sur cet iPhone : Face ID va vérifier si elle est bien la tienne.';
  cphPaint();
  cphUnlockFlow();
}
async function cphUnlockFlow() {
  const uid = cphView.uid;
  if (cphCoach.busy || !uid) return;
  cphCoach.busy = true;
  let r;
  try { r = await cphCoachUnlock(); } catch { r = { ok: false, failed: true }; }
  cphCoach.busy = false;
  if (currentView() !== 'coach-photos' || cphView.uid !== uid) return;
  if (r.stale) { cphView.phase = 'locked'; cphPaint(); return; }
  if (!r.ok) {
    cphView.phase = r.mismatch ? 'mismatch' : r.missing ? 'missing' : r.nopasscode ? 'nopasscode' : 'locked';
    cphView.msg = r.canceled ? '' : r.mismatch || r.missing || r.nopasscode ? '' : 'Ouverture impossible pour l\'instant, réessaie.';
    cphPaint();
    return;
  }
  haptic('success');
  cphLoadImages(uid);
}
// Photos déchiffrées une à une (60 au plus) ; l'écran se redessine au fil de l'eau
async function cphLoadImages(uid) {
  const session = cphCoach.session;
  if (!session) return;
  cphView.phase = 'open';
  Native.vault.shield(true);
  cphPaint();
  const f = cphStudentOf(uid);
  cphView.done = 0; cphView.broken = 0;
  for (const p of f.photos) {
    if (cphCoach.session !== session || cphView.uid !== uid) return;
    if (!cphUrls.has(p.id)) {
      const blob = await cphCoachFetch(uid, p);
      if (cphCoach.session !== session) return;
      if (blob) cphUrls.set(p.id, URL.createObjectURL(blob)); else cphView.broken++;
    }
    cphView.done++;
    cphPaint();
  }
}
function cphCoachLeave() {
  cphLock('leave');
  cphView = { uid: null, phase: 'loading', msg: '', a: null, b: null, done: 0, broken: 0 };
}
SCREENS.set('coach-photos', { render: uid => renderCphCoach(uid), enter: () => { cphCoachEnter(); }, leave: () => cphCoachLeave() });

// Photo en grand : une feuille, sans bouton d'enregistrement
async function cphViewSheet(id) {
  const p = cphStudentOf(cphView.uid).photos.find(x => x.id === id);
  if (!p || !cphUrls.has(id)) return;
  await sheet({ title: cphPoseDay(p), cancel: 'Fermer', confirm: '', body: `
    <div class="cph-big"><img class="cphs__img pview__img" src="${cphPhotoUrl(p)}" alt="${esc(cphPoseDay(p))}" draggable="false"></div>
    <button class="btn btn--danger btn--full" data-action="cph-hide" data-id="${esc(p.id)}">Ne plus voir cette photo</button>
    <p class="mpick__foot">Elle est effacée. Pour signaler un envoi déplacé, écris à l'équipe depuis vos messages (⋯ › Signaler).</p>` });
}

// Fermeture (écran quitté, arrière-plan, inactivité, compte) : images libérées, feuilles retirées
onCphLock(reason => {
  Native.vault.shield(vaultIsOpen());   // le coffre de l'élève, s'il est ouvert, garde son flou
  document.body.classList.remove('cph-shield');
  document.querySelectorAll('.sheet-root').forEach(el => { if (el.querySelector('.cph-big')) { el._close?.('locked'); el.remove(); } });
  cphRevoke();
  if (reason === 'leave' || currentView() !== 'coach-photos') return;
  cphView = { ...cphView, phase: 'locked', msg: reason === 'idle' ? 'Refermées après une minute sans activité.' : '' };
  cphPaint();
});
// Coffre de l'élève refermé : la feuille d'envoi (qui montre ses photos) se ferme avec lui
onVaultLock(() => { document.querySelectorAll('.sheet-root').forEach(el => { if (el.querySelector('.cphs__list, .cphs__one')) { el._close?.('locked'); el.remove(); } }); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') cphLock('background'); });
window.addEventListener('pagehide', () => cphLock('background'));
Native.onActiveChange(active => { document.body.classList.toggle('cph-shield', !active && cphIsOpen()); });
['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, () => cphTouch(), { passive: true, capture: true }));
window.addEventListener('scroll', () => cphTouch(), { passive: true });
// Appui long sur une photo du coach : aucun menu (pas d'« Enregistrer l'image »)
document.addEventListener('contextmenu', e => { if (e.target.closest?.('.coach-photos-view, .cph-big')) e.preventDefault(); });
document.addEventListener('change', e => {
  if (!e.target.classList?.contains('cph-sel')) return;
  cphView[e.target.dataset.side] = e.target.value;
  cphPaint();
  announce(document.querySelector('.pcmp__gap')?.textContent || '');   // l'écart dit après le choix d'une date
});
// Coach : l'état relu (clé, liste) redessine la fiche et l'écran des photos ; élève : Mon coach et le coffre
onCoachChange(() => {
  const v = currentView();
  if (v === 'coach-photos-mine' && !document.activeElement?.matches?.('input, textarea, select')) render();
});

// ── Actions ─────────────────────────────────────────────────

registerActions({
  'cph-send-day': (e, el) => cphSendSheet(el.dataset.day),
  'cph-send-from-vault': () => pvSendToCoach(),
  'cph-pick': (e, el) => cphPickToggle(el),
  'cph-send-go': (e, el) => cphSendGo(el),
  'cph-remove': (e, el) => cphRemoveFlow(el.dataset.id),
  'cph-see': (e, el) => pvShowPhoto(el.dataset.id),
  'cph-verify': () => { cphVerifyOpen = !cphVerifyOpen; render(); },
  'cph-open-mine': () => navigate('coach-photos-mine'),
  'cph-open': (e, el) => navigate(makeRoute('coach-photos', el.dataset.uid)),
  'cph-unlock': () => { if (cphView.phase !== 'open') { cphView.phase = 'locked'; cphUnlockFlow(); } },
  'cph-lock': () => { cphLock('manual'); },
  'cph-view': (e, el) => cphViewSheet(el.dataset.id),
  'cph-hide': async (e, el) => {
    const id = el.dataset.id, uid = cphView.uid;
    if (!(await confirmSheet('Ne plus voir cette photo ?', 'Elle est effacée de chez toi et du serveur. Ton élève peut te la renvoyer.', 'Effacer'))) return;
    const r = await cphCoachHide(uid, id);
    if (!r.ok) { showToast(coachErrorText(r.kind), { error: true }); return; }
    document.querySelectorAll('.sheet-root').forEach(x => { if (x.querySelector('.cph-big')) x._close?.(null); });
    if (cphUrls.has(id)) { URL.revokeObjectURL(cphUrls.get(id)); cphUrls.delete(id); }
    showToast('Photo effacée');
    cphPaint();
  },
  'cph-setup': async () => {
    const r = await cphCoachSetup();
    if (r.ok) { haptic('success'); showToast('Réception des photos activée'); render(); return; }
    if (!r.canceled) showToast(r.nopasscode ? 'Active un code sur ton iPhone d\'abord.' : coachErrorText(r.kind), { error: true });
    render();
  },
  'cph-republish': async () => {
    const ok = await dialog({ title: 'Republier ta clé ?', message: 'Ta clé remplace celle que sert le serveur. Les photos reçues pour la clé du serveur seront effacées ; tes élèves pourront te les renvoyer. Vérifiez ensuite le code ensemble.',
      actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Republier', value: true, style: 'preferred' }] });
    if (!ok) return;
    const r = await cphCoachRepublish();
    if (!r.ok) {
      if (r.mismatch) showToast('Le serveur sert encore une autre clé.', { error: true });
      else if (r.missing) showToast('Ta clé n\'est pas sur cet iPhone : crée une nouvelle clé.', { error: true });
      else if (!r.canceled) showToast(r.nopasscode ? 'Active un code sur ton iPhone d\'abord.' : coachErrorText(r.kind), { error: true });
      cphPaint();
      return;
    }
    haptic('success');
    showToast('Ta clé est republiée');
    if (cphView.uid) { await cphCoachLoad(cphView.uid); cphLoadImages(cphView.uid); }
  },
  'cph-rekey': async () => {
    const ok = await dialog({ title: 'Créer une nouvelle clé ?', message: 'Les photos déjà reçues de tous tes élèves seront effacées : elles ne s\'ouvrent qu\'avec l\'ancienne clé. Tes élèves pourront te les renvoyer. Si la clé arrive plus tard par le trousseau iCloud, il sera trop tard.',
      actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Créer', value: true, style: 'destructive' }] });
    if (!ok) return;
    const r = await cphCoachSetup({ replace: true });
    if (!r.ok) { if (!r.canceled) showToast(coachErrorText(r.kind), { error: true }); return; }
    showToast('Nouvelle clé créée');
    if (cphView.uid) { await cphCoachLoad(cphView.uid); cphLoadImages(cphView.uid); }
  },
});
