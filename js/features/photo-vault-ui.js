// ═══════════════════════════════════════════════════════════
//  Progrès › Mesures › Photos : le coffre (Face ID, galerie, avant / après)
// ═══════════════════════════════════════════════════════════
//
// Logique du coffre (clé du trousseau, chiffrement, verrouillage) : js/data/photo-vault.js. Ici, l'écran :
//  - fermé : présentation (premier accès), puis écran verrouillé ; Face ID (ou le code de l'iPhone) demandé
//    d'emblée en entrant, et par le bouton « Ouvrir ».
//  - ouvert : résumé, curseur avant / après, grille par date.
//  - à part : coffre indisponible (navigateur, coquille sans le module), iPhone sans code, coffre illisible
//    pour l'instant (clé pas encore arrivée par le trousseau iCloud sur un nouvel iPhone, ou restée sur
//    l'ancien) : réessayer d'abord, vider seulement en dernier recours.
// Refermé en quittant l'écran (leave), quand l'app passe en arrière-plan (visibilitychange) et après
// une minute sans toucher l'écran (vaultTouch). Dans le sélecteur d'apps, le contenu est masqué
// (classe pv-shield, et flou natif posé par le module).
'use strict';

// Phases : loading, unavailable, error, intro, locked, nopasscode, missing, open
let pv = { phase: 'loading', msg: '', err: false, legacy: 0, bioType: 'none', count: 0 };
let pvBusy = false;            // feuille d'iOS (Face ID ou code de l'iPhone) ouverte
let pvPendingFile = null;      // photo choisie pendant que le coffre s'est refermé : rangée après l'ouverture
let photoCache = null;         // photos déchiffrées, seulement coffre ouvert
const photoUrls = new Map();   // id → URL d'objet, révoquées à la fermeture
let photoCmp = { a: null, b: null, pos: 50 };
let photoNewPose = 'face';
let photoAddPose = 'face';     // pose proposée par la case touchée (coffre vide : Face, Profil, Dos)

// Nom de ce qui ouvre le coffre : « Face ID », « Touch ID », « Optic ID », ou le code de l'iPhone seul
const bioLabel = () => ({ faceID: 'Face ID', touchID: 'Touch ID', opticID: 'Optic ID' })[pv.bioType] || '';
const pvOpenLabel = () => (bioLabel() ? `Ouvrir avec ${bioLabel()}` : 'Ouvrir avec le code de l\'iPhone');
const pvHowText = () => (bioLabel() ? `${bioLabel()} ou le code de ton iPhone` : 'le code de ton iPhone');

function photoUrl(p) {
  if (!photoUrls.has(p.id)) photoUrls.set(p.id, URL.createObjectURL(p.blob));
  return photoUrls.get(p.id);
}
function revokePhotoUrls() { photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls.clear(); }

// ── Mesures : ligne d'entrée du coffre (aucune vignette hors du coffre) ──
function photoVaultCellHtml() {
  return `
        <div class="group-title">Photos</div>
        <div class="group">
          <button class="cell cell--nav pv-entry" data-action="go-photo-vault">
            <span class="pv-entry__glyph" aria-hidden="true">${icon('lock', 18)}</span>
            <span class="cell__body"><span class="cell__title">Coffre à photos</span>
              <span class="cell__sub">Tes photos de progression, protégées par Face ID</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

// ── Écran ───────────────────────────────────────────────────
// Barre sans titre : le grand titre est dans l'écran (comme Mesures › une mesure), repris par la barre au défilement
// (observeLargeTitle, js/ui/navbar.js)
function renderPhotoVault() {
  const open = pv.phase === 'open';
  // Action en toutes lettres : le cadenas ne dit que l'état « chiffré » (une icône = un sens, docs/ERGONOMIE.md)
  const right = open ? `<button class="navbar__text" data-action="pv-lock" aria-label="Verrouiller le coffre">Verrouiller</button>` : '';
  const body = open ? pvOpenHtml() : pv.phase === 'intro' ? pvIntroHtml() : pv.phase === 'locked' ? pvLockedHtml() : pvCenterHtml();
  return `
    <div class="view photo-vault ${open ? 'view--grouped' : 'pv-locked'}">
      ${navBar({ title: '', right })}
      <div class="scr">${body}</div>
    </div>`;
}

// Écrans d'un message : chargement, indisponible, erreur, iPhone sans code, coffre illisible
function pvCenterHtml() {
  const ph = pv.phase;
  if (ph === 'loading') return `<div class="pv-center"><p class="pv-sub">Ouverture…</p></div>`;
  const view = {
    unavailable: { title: 'Coffre indisponible', text: Native.isNative
      ? 'Le coffre arrive avec la prochaine version de l\'app. Tes photos déjà prises restent sur ton iPhone et y seront rangées.'
      : 'Le coffre s\'ouvre avec Face ID ou le code de l\'iPhone : il n\'existe que dans l\'app iPhone.' },
    error: { title: 'Coffre à photos', text: 'Le coffre ne s\'ouvre pas pour l\'instant.', retry: 'Réessayer' },
    nopasscode: { title: 'Code de l\'iPhone requis', text: 'Le coffre s\'ouvre avec Face ID ou le code de ton iPhone. Active un code dans Réglages › Face ID et code, puis reviens ici.', retry: 'Réessayer' },
    missing: { title: 'Coffre illisible pour l\'instant', text: `La clé de ton coffre n'est pas encore sur cet iPhone${pv.count ? ` (${plural(pv.count, 'photo', 'photos')})` : ''}. Sur un nouvel iPhone, elle arrive avec le trousseau iCloud, parfois après un moment : réessaie plus tard. Si le trousseau iCloud était désactivé sur l'ancien iPhone, la clé y est restée.`, retry: 'Réessayer', reset: true },
  }[ph] || { title: 'Coffre à photos', text: '' };
  return `
        <div class="pv-center">
          <div class="pv-glyph pv-glyph--sm" aria-hidden="true">${icon('lock', 26)}</div>
          <h1 class="pv-title" id="pvTitle" tabindex="-1">${view.title}</h1>
          <p class="pv-sub">${esc(view.text)}</p>
          ${view.retry ? `<button class="btn ${view.reset ? 'btn--primary' : 'btn--secondary'} pv-cta" data-action="pv-retry">${view.retry}</button>` : ''}
          ${view.reset ? `<button class="pv-link pv-link--danger" data-action="pv-reset">Vider le coffre…</button>` : ''}
        </div>`;
}

function pvIntroHtml() {
  const feat = (ic, t, s) => `<li class="pv-feat"><span class="pv-feat__icon" aria-hidden="true">${icon(ic, 22)}</span>
            <span class="pv-feat__body"><span class="pv-feat__title">${t}</span><span class="pv-feat__sub">${s}</span></span></li>`;
  return `
        <div class="pv-intro">
          <div class="pv-glyph" aria-hidden="true">${icon('lock', 34)}</div>
          <h1 class="pv-title" id="pvTitle" tabindex="-1">Coffre à photos</h1>
          <p class="pv-lead">Tes photos de progression, à l'abri des regards.</p>
          <ul class="pv-feats">
            ${feat('lock', `Ouvert avec ${esc(pvHowText())}`, 'Pas de code en plus à retenir. Chiffrées sur ton iPhone, jusque dans ses sauvegardes.')}
            ${feat('timer', 'Refermé dès que tu pars', 'Quand tu quittes l\'app, ou après une minute sans toucher l\'écran.')}
            ${feat('eye.slash', 'Rien ne sort sans toi', cphStudentShown() && cph.state?.ready
              ? 'Ni dans ta pellicule, ni dans l\'export. Ton coach ne reçoit que les photos que tu choisis d\'envoyer, chiffrées pour ton coach seulement.'
              : 'Ni dans ta pellicule, ni dans l\'export, ni sur nos serveurs.')}
            ${feat('info.circle', 'Te suit sur un nouvel iPhone', 'La clé du coffre est dans ton trousseau iCloud, chiffré de bout en bout. Active-le pour retrouver ton coffre sur un nouvel iPhone.')}
          </ul>
          ${pv.legacy ? `<p class="pv-note">${plural(pv.legacy, 'photo déjà prise y sera rangée', 'photos déjà prises y seront rangées')}.</p>` : ''}
          ${pv.err ? `<p class="pv-sub pv-sub--err" id="pvMsg" role="alert">${esc(pv.msg)}</p>` : ''}
          <button class="btn btn--primary btn--full pv-cta" data-action="pv-start" ${pvBusy ? 'disabled' : ''}>Créer le coffre</button>
        </div>`;
}

// Fermé : comme l'album « Masqués » de Photos, un bouton qui demande Face ID (ou le code de l'iPhone)
function pvLockedHtml() {
  const msg = pv.msg || (pvPendingFile ? 'Ouvre le coffre pour ranger ta photo' : '');
  return `
        <div class="pv-lock">
          <div class="pv-glyph" aria-hidden="true">${icon('lock', 34)}</div>
          <h1 class="pv-title" id="pvTitle" tabindex="-1">Coffre verrouillé</h1>
          <p class="pv-sub ${pv.err ? 'pv-sub--err' : ''}" id="pvMsg" role="status" aria-live="polite">${esc(msg || `Ouvre-le avec ${pvHowText()}.`)}</p>
          <button class="btn btn--primary pv-cta pv-open" data-action="pv-open" ${pvBusy ? 'disabled aria-busy="true"' : ''}>${pv.bioType === 'faceID' ? icon('faceid', 20) : ''}<span>${esc(pvOpenLabel())}</span></button>
        </div>`;
}

function pvOpenHtml() {
  const list = photoCache || [];
  // Coffre vide : les trois cases Face, Profil, Dos suffisent (la ligne « Ajouter une photo » faisait doublon)
  const add = `<button class="cell cell--action" data-action="photo-add">${icon('camera', 22)}<span class="cell__title">Ajouter une photo</span></button>`;
  const oldest = list[list.length - 1];
  const summary = list.length
    ? `${plural(list.length, 'photo', 'photos')} · depuis ${esc(fmtDate(oldest.date, 'short'))}`
    : 'Aucune photo pour l\'instant';
  const days = photoDayGroups(list).map(g => `
            <div class="pgal__day"><div class="pgal__head"><span class="pgal__date">${esc(fmtDate(g.date))}</span>${cphDaySendHtml(g)}</div>
              <div class="pgal__row">${g.photos.map(p => { const sent = cphStudentListed() && !!cphSentOf(p.id); return `
                <button class="pgal__item" data-action="photo-open" data-id="${p.id}" aria-label="${photoPoseLabel(p.pose)}, ${esc(fmtDate(p.date))}${sent ? ', envoyée à ton coach' : ''}">
                  <img src="${photoUrl(p)}" alt="" loading="lazy"><span class="pgal__pose">${photoPoseLabel(p.pose)}</span>${sent ? `
                  <span class="pgal__sent" aria-hidden="true">${icon('checkmark', 10)}<span class="pgal__sent-txt">Envoyée</span></span>` : ''}
                </button>`; }).join('')}</div>
            </div>`).join('');
  return `
        <h1 class="scr-title" id="pvTitle" tabindex="-1">Coffre</h1>
        <p class="pv-summary">${icon('lock', 14)}<span>${summary}</span></p>
        ${photoCompareHtml(list)}
        <div class="group">${list.length ? add : ''}
          ${list.length ? `<div class="cell"><div class="pgal">${days}</div></div>` : `<div class="cell pv-empty">
            <div class="pgal__row">${PHOTO_POSES.map(([k, l]) => `<button class="pv-slot" data-action="photo-add" data-pose="${k}" aria-label="Ajouter une photo : ${l}">${icon('plus', 22)}<span>${l}</span></button>`).join('')}</div>
            <p class="cell__sub">Une photo de temps en temps, pour voir ce que la balance ne dit pas.</p></div>`}
        </div>
        <div class="group-foot">Tes photos restent sur ton iPhone, chiffrées. ${cphVaultFoot()}</div>
        <div class="group-foot">Elles ne sont ni dans l'export ni dans la copie iCloud de l'app ; elles sont chiffrées dans la sauvegarde de l'iPhone et se rouvrent sur un nouvel iPhone grâce au trousseau iCloud.</div>`;
}

// Avant / après : les deux photos superposées, un curseur découvre l'une sur l'autre.
// Par défaut la même pose à deux dates (photoComparePair, js/data/progress-photos.js) ; aucune pose prise deux jours
// différents : pas de comparateur, une phrase dit quoi faire. Un choix fait dans les menus est gardé.
function photoCompareHtml(list) {
  if (!list.length) return '';
  const byId = id => list.find(p => p.id === id);
  if (!byId(photoCmp.a) || !byId(photoCmp.b)) {
    const pair = photoComparePair(list);
    if (!pair) return `
        <div class="group-title">Avant / après</div>
        <div class="group"><div class="cell"><span class="cell__sub pcmp__hint">${esc(photoCompareHint(list))}</span></div></div>`;
    photoCmp = { ...photoCmp, ...pair };
  }
  const a = byId(photoCmp.a), b = byId(photoCmp.b);
  // Même pose des deux côtés (le cas par défaut) : la pose dans le titre, la date seule dans les menus, lisible sur iPhone SE
  // (panels de la vague 3 : « 21 oct. · F ») ; une photo d'une autre pose garde « date · pose »
  const pose = a.pose === b.pose ? a.pose : null;
  const options = sel => list.slice().reverse().map(p =>
    `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(fmtDate(p.date, 'short'))}${p.pose === pose ? '' : ` · ${photoPoseLabel(p.pose)}`}</option>`).join('');
  const days = photoGapDays(a.date, b.date);
  const pos = photoCmp.pos;
  return `
        <div class="group-title">Avant / après${pose ? ` · ${photoPoseLabel(pose)}` : ''}</div>
        <div class="group group--pad pcmp">
          <div class="pcmp__frame" style="--pos:${pos}%">
            <img class="pcmp__img" src="${photoUrl(b)}" alt="Après : ${photoPoseLabel(b.pose)}, ${esc(fmtDate(b.date))}">
            <div class="pcmp__before"><img class="pcmp__img" src="${photoUrl(a)}" alt="Avant : ${photoPoseLabel(a.pose)}, ${esc(fmtDate(a.date))}"></div>
            <span class="pcmp__handle" aria-hidden="true"><span class="pcmp__knob">${icon('chevron.left', 12)}${icon('chevron.right', 12)}</span></span>
            <span class="pcmp__tag pcmp__tag--a" aria-hidden="true">Avant</span><span class="pcmp__tag pcmp__tag--b" aria-hidden="true">Après</span>
            <input type="range" class="pcmp__range" min="0" max="100" step="1" value="${pos}" aria-label="Curseur avant / après" aria-valuetext="${pos} % de la photo d'avant">
          </div>
          <div class="pcmp__cols">${[['a', a, 'Avant'], ['b', b, 'Après']].map(([side, p, lbl]) => `
            <label class="pcmp__col"><span class="pcmp__lbl">${lbl}</span>
              <span class="pcmp__pick"><select id="pcmp-${side}" class="pcmp__sel" data-side="${side}">${options(p.id)}</select>${icon('chevron.up.chevron.down', 14)}</span>
            </label>`).join('')}
          </div>
          <div class="pcmp__gap">${days ? `${plural(days, 'jour', 'jours')} d'écart` : 'Même jour'}</div>
        </div>`;
}

// ── Cycle de vie ────────────────────────────────────────────
let pvShownPhase = null;   // phase du dernier dessin : le focus va au titre quand elle change (VoiceOver)
function pvPaint() {
  if (currentView() !== 'photo-vault') return;
  render();
  if (pv.phase !== pvShownPhase) {   // nouvelle étape : en haut de l'écran, focus sur son titre
    pvShownPhase = pv.phase;
    window.scrollTo(0, 0);
    $('#pvTitle')?.focus({ preventScroll: true });
  }
}
// Toujours sur le coffre, et rien n'a été refermé depuis `epoch` ? (sinon un résultat tardif est ignoré)
const pvCurrent = epoch => epoch === vaultEpoch && currentView() === 'photo-vault';

// Ouverture de l'écran : état du coffre lu dans IndexedDB et le trousseau, Face ID demandé d'emblée
async function mountPhotoVault({ first } = {}) {
  if (!first) return;
  if (photosEnabled()) photoInput();
  await null;   // le routeur note l'écran comme ouvert après mount : un dessin synchrone ici le remonterait (first) sans fin
  const epoch = vaultEpoch;
  if (!photosEnabled() || !vaultAvailable()) { pv = { ...pv, phase: 'unavailable' }; pvPaint(); return; }
  if (vaultIsOpen()) { pv.phase = 'open'; await pvLoadPhotos(); return; }
  let meta, st, legacy = 0;
  try {
    [meta, st] = await Promise.all([vaultMeta(), Native.vault.status()]);
    if (!vaultReady(meta)) legacy = await vaultLegacyCount();
  } catch { if (pvCurrent(epoch)) { pv = { ...pv, phase: 'error' }; pvPaint(); } return; }
  if (!pvCurrent(epoch)) return;   // écran quitté pendant la lecture
  pv = { ...pv, msg: '', err: false, bioType: st.biometry, legacy, count: 0 };
  if (!st.passcode) { pv.phase = 'nopasscode'; pvPaint(); return; }
  if (!vaultReady(meta)) { pv.phase = 'intro'; pvPaint(); return; }   // rien, ou création pas aboutie
  // Clé absente de cet iPhone : la lecture répond « absente » sans rien demander (écran « illisible »)
  pv.phase = 'locked';
  pvPaint();
  pvOpenVault();
}
// Photo à montrer une fois le coffre ouvert (Mon coach › Photos de bilan › « Voir »)
let pvPendingPhoto = null;
function pvShowPhoto(id) { pvPendingPhoto = id; navigate('photo-vault'); }
// Feuille d'envoi au coach à ouvrir une fois le coffre ouvert (Mon coach › Photos de bilan › « Envoyer depuis mon coffre »)
let pvPendingSend = false;
function pvSendToCoach() { pvPendingSend = true; navigate('photo-vault'); }
function leavePhotoVault() {
  vaultLock('leave');
  pvPendingFile = null;
  pvPendingPhoto = null;
  pvPendingSend = false;
  pv.phase = 'loading';
  pvShownPhase = null;
}
// Coffre illisible ici (clé pas encore arrivée, ou qui ne correspond pas) : nombre de photos, puis l'écran
async function pvMissing(epoch) {
  const count = await photoRowsCount().catch(() => -1);
  if (!pvCurrent(epoch)) return;
  if (count === 0) {   // coffre vide : rien à perdre, on repart directement de la présentation (nouvelle clé)
    await vaultReset({ keep: true });
    const legacy = await vaultLegacyCount();
    if (currentView() === 'photo-vault') { pv = { ...pv, phase: 'intro', legacy, count: 0, msg: '', err: false }; pvPaint(); }
    return;
  }
  pv = { ...pv, phase: 'missing', count: Math.max(0, count), msg: '', err: false };
  pvPaint();
}

async function pvLoadPhotos() {
  let res;
  try { res = await vaultPhotos(); } catch { res = null; }
  if (!vaultIsOpen()) return;   // refermé pendant la lecture : aucune photo gardée en mémoire
  photoCache = res ? res.photos : [];
  // Envois au coach : relus pour les boutons « Envoyer à mon coach » (serveur sans la fonction : rien)
  cphRefresh({ minAge: 60_000 }).then(ok => { if (ok && vaultIsOpen()) pvPaint(); });
  if (!res) showToast('Lecture du coffre impossible, réessaie', { error: true });
  else if (res.broken) showToast(plural(res.broken, 'photo illisible ignorée', 'photos illisibles ignorées'), { error: true });
  pvPaint();
  if (pvPendingFile) { const f = pvPendingFile; pvPendingFile = null; newPhotoSheet(f); }
  else if (pvPendingPhoto) { const id = pvPendingPhoto; pvPendingPhoto = null; if (photoCache.some(x => x.id === id)) openPhotoSheet(id); }
  else if (pvPendingSend) { pvPendingSend = false; cphSendLatestDay(); }
}

// Coffre refermé (js/data/photo-vault.js) : images libérées, feuilles de photo retirées sur-le-champ,
// dialogues ouverts fermés (une confirmation « Supprimer cette photo ? » ne doit pas survivre au verrou)
onVaultLock(reason => {
  Native.vault.shield(false);
  document.body.classList.remove('pv-shield');
  document.querySelectorAll('.sheet-root').forEach(el => { if (el.querySelector('.pnew__img, .pview__img')) { el._close?.('locked'); el.remove(); } });
  if (reason !== 'reset') closeTransientUI();
  revokePhotoUrls();
  photoCache = null;
  photoCmp = { a: null, b: null, pos: 50 };
  if (reason === 'leave' || reason === 'reset') return;
  pv = { ...pv, phase: 'locked', err: false, msg: reason === 'idle' ? 'Refermé après une minute sans activité.' : '' };
  pvPaint();
});
// Arrière-plan : refermé tout de suite (la capture du sélecteur d'apps est faite juste avant)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') vaultLock('background'); });
window.addEventListener('pagehide', () => vaultLock('background'));
// Sélecteur d'apps, Centre de contrôle : contenu masqué tant que l'app n'est plus au premier plan
Native.onActiveChange(active => { document.body.classList.toggle('pv-shield', !active && vaultIsOpen()); });
// Toute activité garde le coffre ouvert une minute de plus (rien d'autre au toucher : un seul tap sur iOS)
['pointerdown', 'keydown', 'input'].forEach(t => document.addEventListener(t, () => vaultTouch(), { passive: true, capture: true }));
window.addEventListener('scroll', () => vaultTouch(), { passive: true });

// ── Face ID (ou code de l'iPhone) ───────────────────────────
// Réponse d'iOS qui n'ouvre pas : message sur l'écran en cours ; true si l'écran a changé de phase
function pvRefusal(r, epoch) {
  if (r.nopasscode) { pv = { ...pv, phase: 'nopasscode', msg: '', err: false }; pvPaint(); return true; }
  if (r.missing) { pvMissing(epoch); return true; }
  pv.msg = r.canceled ? '' : 'Ouverture impossible pour l\'instant, réessaie.';
  pv.err = !r.canceled;
  pvPaint();
  return false;
}
// Création : iOS tire la clé après Face ID (ou le code), le coffre s'ouvre, les anciennes photos y entrent
async function pvCreate() {
  if (pvBusy) return;
  const epoch = vaultEpoch;
  pvBusy = true; pv.msg = ''; pv.err = false; pvPaint();
  let r;
  try { r = await vaultSetup('Créer ton coffre à photos'); } catch { r = { ok: false, failed: true }; }
  pvBusy = false;
  if (!pvCurrent(epoch) || r.stale) {   // écran quitté ou app partie pendant la feuille d'iOS
    if (r.stale && currentView() === 'photo-vault') { pv = { ...pv, phase: 'locked', msg: '', err: false }; pvPaint(); }
    return;
  }
  if (!r.ok) { pvRefusal(r, epoch); return; }
  pv = { ...pv, phase: 'open', msg: '', err: false };
  haptic('success');
  Native.vault.shield(true);
  await pvLoadPhotos();
  showToast(r.migrated ? `Coffre créé · ${plural(r.migrated, 'photo rangée', 'photos rangées')}` : 'Coffre créé');
}
async function pvOpenVault() {
  if (pvBusy || pv.phase !== 'locked') return;
  const epoch = vaultEpoch;
  pvBusy = true; pvPaint();
  let r;
  try { r = await vaultUnlock('Ouvrir ton coffre à photos', epoch); } catch { r = { ok: false, failed: true }; }
  pvBusy = false;
  if (!pvCurrent(epoch) || r.stale) { if (currentView() === 'photo-vault') pvPaint(); return; }
  if (!r.ok) { pvRefusal(r, epoch); return; }
  pv = { ...pv, phase: 'open', msg: '', err: false };
  haptic('success');
  Native.vault.shield(true);
  await pvLoadPhotos();
}

// ── Coffre illisible : le vider en dernier recours (la clé peut encore arriver par le trousseau iCloud) ──
async function pvReset() {
  const n = pv.count || await photoRowsCount().catch(() => 0);
  const ok1 = await dialog({ title: n ? `Effacer ${plural(n, 'photo', 'photos')} ?` : 'Vider le coffre ?',
    message: 'Si la clé arrive plus tard par le trousseau iCloud, il sera trop tard : ces photos seront supprimées de cet iPhone. Tu pourras ensuite créer un nouveau coffre.',
    actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Effacer', value: true, style: 'destructive' }] });
  if (!ok1) return;
  const ok = await vaultReset({ keep: true });
  const legacy = await vaultLegacyCount();
  pv = { ...pv, phase: 'intro', legacy, count: 0, msg: '', err: false };
  pvPaint();
  showToast(ok ? 'Coffre vidé' : 'Effacement incomplet, réessaie', { error: !ok });
}

// ── Photos : ajout, ouverture, suppression ─────────────────
async function newPhotoSheet(file) {
  const url = URL.createObjectURL(file), today = localISO();
  photoNewPose = photoAddPose;
  const res = await sheet({ title: 'Nouvelle photo', confirm: 'OK', body: `
    <img class="pnew__img" src="${url}" alt="Aperçu de la photo choisie">
    <div class="segmented seg-full pnew__pose" role="radiogroup" aria-label="Pose">
      ${PHOTO_POSES.map(([k, l]) => `<button type="button" class="segmented__btn ${k === photoNewPose ? 'segmented__btn--active' : ''}" role="radio" aria-checked="${k === photoNewPose}" data-action="photo-pose" data-pose="${k}">${l}</button>`).join('')}
    </div>
    <div class="date-row bm-date"><label class="date-label" for="phDate">Date</label><input type="date" id="phDate" class="date-input" value="${today}" max="${today}"></div>
    <p class="mpick__foot">Réduite à ${PHOTO_MAX_PX} px, chiffrée et rangée dans le coffre, pas dans ta pellicule.</p>`,
    onConfirm: panel => {
      const dateIn = $('#phDate', panel);
      const date = dateInputToTs(dateIn.value);
      if (date === null) { flagInvalid(dateIn, 'Date invalide'); return false; }
      return { pose: photoNewPose, date };
    } });
  URL.revokeObjectURL(url);
  if (res === 'locked' || (res && !vaultIsOpen())) {   // refermé pendant la feuille : rangée à la prochaine ouverture, si on est resté dans le coffre
    if (currentView() === 'photo-vault') { pvPendingFile = file; pvPaint(); }
    return;
  }
  if (!res) return;
  try {
    const rec = await photoFromFile(file, res);
    await vaultAddPhoto(rec);
    await pvLoadPhotos();
    announce('Photo rangée dans le coffre');   // la photo apparaît dans la liste ; un toast couvrait les menus Avant / Après (panel t5)
  } catch {
    if (!vaultIsOpen()) { if (currentView() === 'photo-vault') { pvPendingFile = file; pvPaint(); } return; }   // refermé pendant la préparation
    showToast('Photo illisible ou stockage indisponible', { error: true });
  }
}

async function openPhotoSheet(id) {
  const p = photoCache?.find(x => x.id === id);
  if (!p) return;
  await sheet({ title: `${photoPoseLabel(p.pose)} · ${fmtDate(p.date)}`, cancel: 'Fermer', confirm: '', body: `
    <img class="pview__img" src="${photoUrl(p)}" alt="${photoPoseLabel(p.pose)}, ${esc(fmtDate(p.date))}">
    <p class="pview__meta">${p.w} × ${p.h} px</p>
    ${cphVaultPhotoHtml(p)}
    <button class="btn btn--danger btn--full" data-action="photo-delete" data-id="${p.id}">Supprimer cette photo</button>` });
}

function pvSetComparePos(v) {
  photoCmp.pos = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const frame = $('.pcmp__frame');
  frame?.style.setProperty('--pos', `${photoCmp.pos}%`);
  frame?.querySelector('.pcmp__range')?.setAttribute('aria-valuetext', `${photoCmp.pos} % de la photo d'avant`);
}

// Champ fichier des photos : dans <body>, hors de #app (comme sur main, b62fca7). Dans l'écran, un redessin
// pendant que la photothèque d'iOS est ouverte le remplaçait, et la photo choisie arrivait sur un champ
// sorti de la page.
function photoInput() {
  let inp = document.getElementById('photoFile');
  if (inp) return inp;
  inp = document.createElement('input');
  Object.assign(inp, { type: 'file', id: 'photoFile', accept: 'image/*', tabIndex: -1, className: 'visually-hidden' });
  inp.setAttribute('aria-hidden', 'true');
  inp.addEventListener('change', () => {
    const file = inp.files?.[0];
    inp.value = '';   // la même photo choisie deux fois de suite déclenche bien un nouveau change
    if (!file || currentView() !== 'photo-vault') return;
    if (vaultIsOpen()) newPhotoSheet(file);
    else { pvPendingFile = file; pvPaint(); }
  });
  document.body.appendChild(inp);
  return inp;
}

document.addEventListener('change', e => {
  const el = e.target;
  if (el.classList?.contains('pcmp__sel')) {
    photoCmp = { ...photoCmp, [el.dataset.side]: el.value };
    pvPaint();
    announce(document.querySelector('.pcmp__gap')?.textContent || '');   // l'écart dit après le choix d'une date
  }
});
document.addEventListener('input', e => { if (e.target.classList?.contains('pcmp__range')) pvSetComparePos(e.target.value); });
// Curseur : le doigt posé n'importe où sur les photos, puis glissé ; défilement vertical gardé (touch-action: pan-y).
// Clavier et VoiceOver : le curseur range (masqué à l'écran) fait la même chose.
let pcmpDrag = null;
const pcmpAt = (frame, x) => { const r = frame.getBoundingClientRect(); pvSetComparePos(((x - r.left) / r.width) * 100); };
document.addEventListener('pointerdown', e => {
  const frame = e.target.closest?.('.pcmp__frame');
  if (!frame || e.button > 0) return;
  pcmpDrag = { frame, id: e.pointerId, x: e.clientX, moved: false };
  try { frame.setPointerCapture(e.pointerId); } catch { /* glissé suivi sur le document */ }
});
document.addEventListener('pointermove', e => {
  if (!pcmpDrag || e.pointerId !== pcmpDrag.id) return;
  if (!pcmpDrag.moved && Math.abs(e.clientX - pcmpDrag.x) < 4) return;
  pcmpDrag.moved = true;
  pcmpAt(pcmpDrag.frame, e.clientX);
});
document.addEventListener('pointerup', e => {
  if (!pcmpDrag || e.pointerId !== pcmpDrag.id) return;
  if (!pcmpDrag.moved) pcmpAt(pcmpDrag.frame, e.clientX);   // simple toucher : le curseur va là
  const r = pcmpDrag.frame.querySelector('.pcmp__range');
  if (r) r.value = String(photoCmp.pos);
  pcmpDrag = null;
});
document.addEventListener('pointercancel', () => { pcmpDrag = null; });

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'go-photo-vault': () => { navigate('photo-vault'); },
  'pv-retry':  () => { pv.phase = 'loading'; pvPaint(); mountPhotoVault({ first: true }); },
  'pv-start':  () => pvCreate(),
  'pv-open':   () => pvOpenVault(),
  'pv-reset':  () => pvReset(),
  'pv-lock':   () => { vaultLock('manual'); },
  // Un seul tap : le sélecteur de fichier s'ouvre dans le geste (caméra ou pellicule, au choix d'iOS)
  'photo-add': (e, el) => {
    photoAddPose = PHOTO_POSE_KEYS.includes(el?.dataset?.pose) ? el.dataset.pose : 'face';
    const inp = photoInput();
    inp.value = '';
    inp.click();
  },
  'photo-pose': (e, el) => {
    photoNewPose = el.dataset.pose;
    el.closest('.pnew__pose').querySelectorAll('.segmented__btn').forEach(b => {
      const on = b === el;
      b.classList.toggle('segmented__btn--active', on);
      b.setAttribute('aria-checked', String(on));
    });
  },
  'photo-open': (e, el) => openPhotoSheet(el.dataset.id),
  'photo-delete': async (e, el) => {
    const id = el.dataset.id;
    // Envoyée au coach : elle est retirée de chez lui d'abord (sinon elle ne serait plus nulle part ici, mais chez lui)
    const sent = cphStudentListed() ? cphSentOf(id) : null;
    // État des envois inconnu ici (hors ligne, autre iPhone) alors qu'on a un coach : on ne promet pas « nulle part ailleurs »
    const unsure = !sent && account.user && coachRole().hasCoach;
    const msg = sent ? 'Elle est aussi retirée de chez ton coach. Pas de corbeille.'
      : unsure ? 'Pas de corbeille. Si tu l\'as envoyée à ton coach, retire-la aussi dans Mon coach › Photos de bilan.' : 'Elle n\'est nulle part ailleurs : pas de corbeille.';
    if (!(await confirmSheet('Supprimer cette photo ?', msg, 'Supprimer'))) return;
    if (!vaultIsOpen()) return;   // refermé pendant la confirmation : rien sans rouvrir le coffre
    if (sent) { const r = await cphRemove(sent.id); if (!r.ok) { showToast(coachErrorText(r.kind), { error: true }); return; } }
    try { await photoDelete(id); } catch { showToast('Suppression impossible', { error: true }); return; }
    if (photoUrls.has(id)) { URL.revokeObjectURL(photoUrls.get(id)); photoUrls.delete(id); }
    el.closest('.sheet-root')?._close?.(null);
    if (vaultIsOpen()) await pvLoadPhotos();
    showToast('Photo supprimée');
  },
});
