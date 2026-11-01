// ═══════════════════════════════════════════════════════════
//  Progrès › Mesures › Photos : le coffre (code, Face ID, galerie, avant / après)
// ═══════════════════════════════════════════════════════════
//
// Logique du coffre (clé, chiffrement, essais, verrouillage) : js/data/photo-vault.js. Ici, l'écran :
//  - fermé : présentation et création du code (premier accès), puis clavier du code ; Face ID dans
//    une build qui a le module natif (Native.vault), proposé une fois après le premier code.
//  - ouvert : résumé, curseur avant / après, grille par date, réglages du coffre.
// Refermé en quittant l'écran (leave), quand l'app passe en arrière-plan (visibilitychange) et après
// une minute sans toucher l'écran (vaultTouch). Dans le sélecteur d'apps, le contenu est masqué
// (classe pv-shield, et écran natif dans une build qui a le module).
'use strict';

// Phases : loading, nocrypto, intro, create, confirm, unlock, change-old, change-new, change-confirm, open
let pv = { phase: 'loading', msg: '', err: false, legacy: 0, bio: false, bioType: 'none', bioStored: false, count: 0 };
let pvCode = '';               // chiffres tapés, jamais gardés au-delà de l'essai
let pvFirst = '';              // création ou changement : premier code, en attente de confirmation
let pvOld = '';                // changement : code actuel, le temps de saisir le nouveau
let pvBusy = false;            // calcul de la clé en cours (environ une demi-seconde)
let pvWaitUntil = 0;           // fin de l'attente après trop d'erreurs (horloge de l'appareil)
let pvTick = null;
let pvPendingFile = null;      // photo choisie pendant que le coffre s'est refermé : rangée après le déverrouillage
let photoCache = null;         // photos déchiffrées, seulement coffre ouvert
const photoUrls = new Map();   // id → URL d'objet, révoquées à la fermeture
let photoCmp = { a: null, b: null, pos: 50 };
let photoNewPose = 'face';

const PV_PAD_PHASES = ['create', 'confirm', 'unlock', 'change-old', 'change-new', 'change-confirm'];
const bioLabel = () => (pv.bioType === 'touchID' ? 'Touch ID' : pv.bioType === 'opticID' ? 'Optic ID' : 'Face ID');
const pvBioReady = () => Native.vault.available && pv.bio && pv.bioStored && pv.bioType !== 'none';

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
              <span class="cell__sub">Tes photos de progression, protégées par un code</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

// ── Écran ───────────────────────────────────────────────────
function renderPhotoVault() {
  const open = pv.phase === 'open';
  const right = open ? `<button class="navbar__icon" data-action="pv-lock" aria-label="Verrouiller le coffre">${icon('lock', 22)}</button>`
    : PV_PAD_PHASES.includes(pv.phase) && pv.phase.startsWith('change') ? `<button class="navbar__text" data-action="pv-change-cancel">Annuler</button>` : '';
  let body;
  if (pv.phase === 'loading') body = `<div class="pv-center"><p class="pv-sub">Ouverture…</p></div>`;
  else if (pv.phase === 'nocrypto') body = `<div class="pv-center"><p class="pv-sub">Le coffre demande un navigateur récent : les photos ne sont pas disponibles ici.</p></div>`;
  else if (pv.phase === 'intro') body = pvIntroHtml();
  else if (open) body = pvOpenHtml();
  else body = pvPadHtml();
  return `
    <div class="view photo-vault ${open ? 'view--grouped' : 'pv-locked'}">
      ${navBar({ title: open ? 'Photos' : '', right })}
      <div class="scr">${body}</div>
      <input type="file" id="photoFile" class="visually-hidden" accept="image/*" aria-hidden="true" tabindex="-1">
    </div>`;
}

function pvIntroHtml() {
  const feat = (ic, t, s) => `<li class="pv-feat"><span class="pv-feat__icon" aria-hidden="true">${icon(ic, 22)}</span>
            <span class="pv-feat__body"><span class="pv-feat__title">${t}</span><span class="pv-feat__sub">${s}</span></span></li>`;
  return `
        <div class="pv-intro">
          <div class="pv-glyph" aria-hidden="true">${icon('lock', 34)}</div>
          <h1 class="pv-title">Coffre à photos</h1>
          <p class="pv-lead">Tes photos de progression, à l'abri des regards. Elles ne s'ouvrent qu'avec ton code.</p>
          <ul class="pv-feats">
            ${feat('lock', 'Chiffrées sur ton iPhone', 'Elles ne s\'affichent qu\'avec ton code, et restent chiffrées dans les sauvegardes.')}
            ${feat('eye.slash', 'Refermé dès que tu pars', 'Quand tu quittes l\'app, ou après une minute sans toucher l\'écran.')}
            ${feat('camera', 'Rien ne sort du coffre', 'Ni dans ta pellicule, ni dans l\'export, ni sur nos serveurs, ni chez ton coach.')}
          </ul>
          ${pv.legacy ? `<p class="pv-note">${plural(pv.legacy, 'photo déjà prise y sera rangée', 'photos déjà prises y seront rangées')}.</p>` : ''}
          <button class="btn btn--primary btn--full pv-cta" data-action="pv-start">Créer mon code</button>
          <p class="pv-foot">Garde-le bien : si tu l'oublies, personne ne peut rouvrir le coffre, pas même nous. Tu pourras seulement le vider pour repartir de zéro.</p>
        </div>`;
}

function pvPadTitle() {
  return { create: 'Choisis un code', confirm: 'Confirme ton code', unlock: 'Entre ton code',
           'change-old': 'Code actuel', 'change-new': 'Nouveau code', 'change-confirm': 'Confirme le nouveau code' }[pv.phase];
}
function pvDefaultMsg() {
  if (pv.phase === 'create') return `${VAULT_CODE_LEN} chiffres, pour ouvrir ton coffre`;
  if (pv.phase === 'unlock' && pvPendingFile) return 'Déverrouille pour ranger ta photo';
  return '';
}
function pvWaitText(ms) {
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
}

function pvPadHtml() {
  const wait = Math.max(0, pvWaitUntil - Date.now());
  const msg = wait > 0 ? `Trop d'essais. Réessaie dans ${pvWaitText(wait)}` : (pv.msg || pvDefaultMsg());
  const locked = wait > 0 || pvBusy;
  const key = (d) => `<button class="pv-key num" data-action="pv-digit" data-d="${d}" ${locked ? 'disabled' : ''}>${d}</button>`;
  const bio = pv.phase === 'unlock' && pvBioReady()
    ? `<button class="pv-key pv-key--fn" data-action="pv-bio" aria-label="Ouvrir avec ${bioLabel()}" ${wait > 0 ? '' : ''}>${icon('faceid', 30)}</button>`
    : '<span class="pv-key pv-key--void" aria-hidden="true"></span>';
  return `
        <div class="pv-lock">
          <div class="pv-glyph pv-glyph--sm" aria-hidden="true">${icon('lock', 26)}</div>
          <h1 class="pv-title" id="pvTitle">${pvPadTitle()}</h1>
          <p class="pv-sub ${pv.err && !wait ? 'pv-sub--err' : ''}" id="pvMsg" role="status" aria-live="polite">${esc(msg)}</p>
          <div class="pv-dots ${pvBusy ? 'pv-dots--busy' : ''}" role="img" aria-label="${pvCode.length} chiffre${pvCode.length > 1 ? 's' : ''} sur ${VAULT_CODE_LEN}">
            ${Array.from({ length: VAULT_CODE_LEN }, (_, i) => `<span class="pv-dot ${i < pvCode.length ? 'pv-dot--on' : ''}"></span>`).join('')}
          </div>
          <div class="pv-pad" role="group" aria-labelledby="pvTitle">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(key).join('')}
            ${bio}${key(0)}
            <button class="pv-key pv-key--fn" data-action="pv-erase" aria-label="Effacer le dernier chiffre" ${pvCode ? '' : 'disabled'}>${icon('delete.left', 26)}</button>
          </div>
          ${pv.phase === 'unlock' ? '<button class="pv-link" data-action="pv-forgot">Code oublié ?</button>' : '<span class="pv-link pv-link--void" aria-hidden="true"></span>'}
        </div>`;
}

function pvOpenHtml() {
  const list = photoCache || [];
  const add = `<button class="cell cell--action" data-action="photo-add">${icon('camera', 22)}<span class="cell__title">Ajouter une photo</span></button>`;
  const oldest = list[list.length - 1];
  const summary = list.length
    ? `${plural(list.length, 'photo', 'photos')} · depuis ${esc(fmtDate(oldest.date, 'short'))}`
    : 'Aucune photo pour l\'instant';
  const days = photoDayGroups(list).map(g => `
            <div class="pgal__day"><span class="pgal__date">${esc(fmtDate(g.date))}</span>
              <div class="pgal__row">${g.photos.map(p => `
                <button class="pgal__item" data-action="photo-open" data-id="${p.id}" aria-label="${photoPoseLabel(p.pose)}, ${esc(fmtDate(p.date))}">
                  <img src="${photoUrl(p)}" alt="" loading="lazy"><span class="pgal__pose">${photoPoseLabel(p.pose)}</span>
                </button>`).join('')}</div>
            </div>`).join('');
  const bioCell = Native.vault.available && pv.bioType !== 'none' ? `
          <button class="cell" data-action="pv-bio-toggle" role="switch" aria-checked="${pv.bio}">
            <span class="cell__body"><span class="cell__title">Ouvrir avec ${bioLabel()}</span></span>
            ${switchHtml(pv.bio)}
          </button>` : '';
  return `
        <h1 class="scr-title">Photos</h1>
        <p class="pv-summary">${icon('lock', 14)}<span>${summary}</span></p>
        ${photoCompareHtml(list)}
        <div class="group">${add}
          ${list.length ? `<div class="cell"><div class="pgal">${days}</div></div>` : `<div class="cell"><span class="cell__body"><span class="cell__sub">Face, profil, dos : une photo de temps en temps, pour voir ce que la balance ne dit pas.</span></span></div>`}
        </div>
        <div class="group-title">Coffre</div>
        <div class="group">${bioCell}
          <button class="cell cell--nav" data-action="pv-change"><span class="cell__body"><span class="cell__title">Changer le code</span></span>${icon('chevron.right', 16)}</button>
        </div>
        <div class="group-foot">${list.length ? `${fmtBytes(photosTotalBytes(list))}, chiffrées sur cet appareil. ` : ''}Hors de l'export et de la copie iCloud de l'app ; chiffrées dans la sauvegarde de l'iPhone. Rien n'est montré à tes amis ni à ton coach.</div>`;
}

// Avant / après : les deux photos superposées, un curseur découvre l'une sur l'autre.
// Par défaut la plus ancienne et la plus récente de la même pose.
function photoCompareHtml(list) {
  if (list.length < 2) return '';
  const byId = id => list.find(p => p.id === id);
  if (!byId(photoCmp.a) || !byId(photoCmp.b)) {
    const newest = list[0];
    const same = list.filter(p => p.pose === newest.pose);
    const pool = same.length > 1 ? same : list;
    photoCmp = { ...photoCmp, a: pool[pool.length - 1].id, b: newest.id };
  }
  const a = byId(photoCmp.a), b = byId(photoCmp.b);
  const options = sel => list.slice().reverse().map(p =>
    `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(fmtDate(p.date, 'short'))} · ${photoPoseLabel(p.pose)}</option>`).join('');
  const days = photoGapDays(a.date, b.date);
  const pos = photoCmp.pos;
  return `
        <div class="group-title">Avant / après</div>
        <div class="group group--pad pcmp">
          <div class="pcmp__frame" style="--pos:${pos}%">
            <img class="pcmp__img" src="${photoUrl(b)}" alt="Après : ${photoPoseLabel(b.pose)}, ${esc(fmtDate(b.date))}">
            <div class="pcmp__before"><img class="pcmp__img" src="${photoUrl(a)}" alt="Avant : ${photoPoseLabel(a.pose)}, ${esc(fmtDate(a.date))}"></div>
            <span class="pcmp__handle" aria-hidden="true"><span class="pcmp__knob">${icon('chevron.left', 12)}${icon('chevron.right', 12)}</span></span>
            <span class="pcmp__tag pcmp__tag--a" aria-hidden="true">Avant</span><span class="pcmp__tag pcmp__tag--b" aria-hidden="true">Après</span>
            <input type="range" class="pcmp__range visually-hidden" min="0" max="100" step="1" value="${pos}" aria-label="Curseur avant / après" aria-valuetext="${pos} % de la photo d'avant">
          </div>
          <div class="pcmp__cols">${[['a', a, 'Avant'], ['b', b, 'Après']].map(([side, p, lbl]) => `
            <label class="pcmp__col"><span class="pcmp__lbl">${lbl}</span>
              <select id="pcmp-${side}" class="pcmp__sel" data-side="${side}">${options(p.id)}</select>
            </label>`).join('')}
          </div>
          <div class="pcmp__gap">${days ? `${plural(days, 'jour', 'jours')} d'écart` : 'Même jour'}</div>
        </div>`;
}

// ── Cycle de vie ────────────────────────────────────────────
function pvPaint() { if (currentView() === 'photo-vault') render(); }

// Ouverture de l'écran : état du coffre lu dans IndexedDB, Face ID proposé d'emblée s'il est en place
async function mountPhotoVault({ first } = {}) {
  if (!first) return;
  if (!photosEnabled() || !vaultCryptoOk()) { pv = { ...pv, phase: 'nocrypto' }; pvPaint(); return; }
  if (vaultIsOpen()) { pv.phase = 'open'; await pvLoadPhotos(); return; }
  let st;
  try { st = await vaultState(); } catch { pv = { ...pv, phase: 'nocrypto' }; pvPaint(); return; }
  const bio = await Native.vault.status();
  pv = { ...pv, msg: '', err: false, bio: !!st.meta?.bio, bioType: bio.biometry, bioStored: bio.stored };
  pvCode = ''; pvFirst = ''; pvOld = '';
  if (!st.meta) {
    pv.legacy = await vaultLegacyCount();
    pv.phase = 'intro';
  } else {
    pv.phase = 'unlock';
    pvSetWait(vaultWaitMs(st.tries));
  }
  pvPaint();
  if (pv.phase === 'unlock' && pvBioReady() && !(pvWaitUntil > Date.now())) pvTryBio();
}
function leavePhotoVault() {
  vaultLock('leave');
  pvPendingFile = null;
  pv.phase = 'loading';
  pvCode = ''; pvFirst = ''; pvOld = '';
}

async function pvLoadPhotos() {
  let res;
  try { res = await vaultPhotos(); } catch { res = null; }
  if (!vaultIsOpen()) return;   // refermé pendant la lecture : aucune photo gardée en mémoire
  photoCache = res ? res.photos : [];
  if (res?.broken) showToast(plural(res.broken, 'photo illisible ignorée', 'photos illisibles ignorées'), { error: true });
  pvPaint();
  if (pvPendingFile) { const f = pvPendingFile; pvPendingFile = null; newPhotoSheet(f); }
}

// Coffre refermé (js/data/photo-vault.js) : images libérées, feuilles de photo retirées sur-le-champ
onVaultLock(reason => {
  Native.vault.shield(false);
  document.body.classList.remove('pv-shield');
  document.querySelectorAll('.sheet-root').forEach(el => { if (el.querySelector('.pnew__img, .pview__img')) { el._close?.(null); el.remove(); } });
  revokePhotoUrls();
  photoCache = null;
  photoCmp = { a: null, b: null, pos: 50 };
  pvCode = ''; pvFirst = ''; pvOld = '';
  if (reason === 'leave' || reason === 'reset') return;
  pv = { ...pv, phase: 'unlock', err: false, msg: reason === 'idle' ? 'Refermé après une minute sans activité' : '' };
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

function pvSetWait(ms) {
  clearInterval(pvTick);
  pvWaitUntil = ms > 0 ? Date.now() + ms : 0;
  if (!pvWaitUntil) return;
  pvTick = setInterval(() => {
    const left = pvWaitUntil - Date.now();
    const msg = $('#pvMsg');
    if (left <= 0) { clearInterval(pvTick); pvWaitUntil = 0; pv.msg = ''; pv.err = false; pvPaint(); return; }
    if (msg) msg.textContent = `Trop d'essais. Réessaie dans ${pvWaitText(left)}`;
  }, 1000);
}

// ── Saisie du code ──────────────────────────────────────────
function pvSyncDots() {
  const dots = document.querySelectorAll('.pv-dot');
  dots.forEach((d, i) => d.classList.toggle('pv-dot--on', i < pvCode.length));
  const box = $('.pv-dots');
  box?.setAttribute('aria-label', `${pvCode.length} chiffre${pvCode.length > 1 ? 's' : ''} sur ${VAULT_CODE_LEN}`);
  const erase = $('[data-action="pv-erase"]');
  if (erase) erase.disabled = !pvCode;
}
function pvFail(msg) {
  pvCode = '';
  pv.msg = msg; pv.err = true;
  haptic('medium');
  pvPaint();
  $('.pv-dots')?.classList.add('pv-dots--shake');
}
function pvType(d) {
  if (pvBusy || pvWaitUntil > Date.now() || pvCode.length >= VAULT_CODE_LEN) return;
  pvCode += d;
  if (pv.err) { pv.err = false; pv.msg = ''; const m = $('#pvMsg'); if (m) { m.textContent = pvDefaultMsg(); m.classList.remove('pv-sub--err'); } }
  pvSyncDots();
  if (pvCode.length === VAULT_CODE_LEN) setTimeout(pvSubmit, 120);   // le dernier point se voit avant la suite
}

async function pvSubmit() {
  const code = pvCode;
  if (code.length !== VAULT_CODE_LEN) return;
  const ph = pv.phase;
  if (ph === 'create' || ph === 'change-new') {
    if (vaultCodeTooSimple(code)) { pvFail('Code trop facile à deviner, choisis-en un autre'); return; }
    if (ph === 'change-new' && code === pvOld) { pvFail('C\'est déjà ton code actuel'); return; }
    pvFirst = code; pvCode = '';
    pv = { ...pv, phase: ph === 'create' ? 'confirm' : 'change-confirm', msg: '', err: false };
    pvPaint();
    return;
  }
  if (ph === 'confirm' || ph === 'change-confirm') {
    if (code !== pvFirst) {
      pvFirst = '';
      pv.phase = ph === 'confirm' ? 'create' : 'change-new';
      pvFail('Les deux codes ne correspondent pas, recommence');
      return;
    }
    pvBusy = true; pvPaint();
    try {
      if (ph === 'confirm') {
        const { migrated, stale } = await vaultSetup(code);
        pvBusy = false; pvCode = ''; pvFirst = '';
        if (stale) return;   // écran quitté pendant le calcul : le coffre est créé, et fermé
        pv = { ...pv, phase: 'open', msg: '', err: false };
        Native.vault.shield(true);
        await pvLoadPhotos();
        showToast(migrated ? `Coffre créé · ${plural(migrated, 'photo rangée', 'photos rangées')}` : 'Coffre créé');
        await pvOfferBio();
      } else {
        const r = await vaultChangeCode(pvOld, code);
        pvBusy = false; pvCode = ''; pvFirst = '';
        if (!r.ok) {   // ancien code devenu faux entre-temps (essai compté)
          pvOld = '';
          pv.phase = 'change-old';
          pvSetWait(r.wait);
          pvFail('Code actuel incorrect');
          return;
        }
        pvOld = '';
        pv = { ...pv, phase: 'open', msg: '', err: false };
        pvPaint();
        showToast('Code changé');
      }
    } catch {
      pvBusy = false;
      pvFail('Enregistrement impossible, réessaie');
    }
    return;
  }
  if (ph === 'unlock' || ph === 'change-old') {
    pvBusy = true; pvPaint();
    let r;
    try { r = ph === 'unlock' ? await vaultUnlockWithCode(code) : await vaultTryCode(code); }
    catch { r = { ok: false, wait: 0, left: 1, failed: true }; }
    pvBusy = false;
    if (r.stale) return;   // refermé (écran quitté, arrière-plan) pendant le calcul
    if (!r.ok) {
      pvSetWait(r.wait);
      if (r.failed) { pvFail('Coffre illisible pour l\'instant, réessaie'); return; }
      pvFail(r.wait > 0 ? '' : r.left > 0 && r.left <= 2 ? `Code incorrect · ${plural(r.left, 'essai', 'essais')} avant une attente` : 'Code incorrect');
      return;
    }
    pvCode = '';
    if (ph === 'change-old') { pvOld = code; pv = { ...pv, phase: 'change-new', msg: '', err: false }; pvPaint(); return; }
    pv = { ...pv, phase: 'open', msg: '', err: false };
    haptic('success');
    Native.vault.shield(true);
    await pvLoadPhotos();
    await pvOfferBio();
  }
}

// ── Face ID ─────────────────────────────────────────────────
async function pvTryBio() {
  if (!pvBioReady() || pvBusy) return;
  const epoch = vaultEpoch;
  const r = await Native.vault.unlock('Ouvrir le coffre à photos');
  if (!r || r.canceled) return;
  if (r.failed) { pv.msg = `${bioLabel()} n'a pas reconnu ton visage : entre ton code`; pv.err = false; pvPaint(); return; }
  if (r.gone) {   // visages modifiés dans Réglages : iOS a retiré la clé, retour au code
    pv.bioStored = false;
    await vaultSetBio(false); pv.bio = false;
    pv.msg = `${bioLabel()} a changé sur cet iPhone : entre ton code`; pv.err = false;
    pvPaint();
    return;
  }
  if (!r.key) return;
  const ok = await vaultUnlockWithKey(r.key, epoch);
  if (ok.stale) return;
  if (!ok.ok) { pv.msg = 'Entre ton code'; pvPaint(); return; }
  pvCode = '';
  pv = { ...pv, phase: 'open', msg: '', err: false };
  Native.vault.shield(true);
  await pvLoadPhotos();
}
async function pvEnableBio() {
  if (!vaultIsOpen()) return false;
  const ok = await Native.vault.remember(await vaultDekB64(vaultKey), `Ouvrir le coffre avec ${bioLabel()}`);
  if (!ok) return false;
  await vaultSetBio(true);
  pv.bio = true; pv.bioStored = true;
  return true;
}
// Proposé une fois, juste après le premier code (création ou premier déverrouillage dans une build qui l'a)
async function pvOfferBio() {
  if (!Native.vault.available || pv.bioType === 'none' || pv.bio) return;
  const meta = await vaultMeta();
  if (!meta || meta.bioAsked) return;
  await photoMetaPut({ ...meta, bioAsked: true });
  const yes = await dialog({ title: `Ouvrir avec ${bioLabel()} ?`, message: `Ton code reste nécessaire si ${bioLabel()} échoue.`, actions: [
    { label: 'Plus tard', style: 'cancel' },
    { label: `Utiliser ${bioLabel()}`, value: true, style: 'preferred' },
  ] });
  if (yes && (await pvEnableBio())) { pvPaint(); showToast(`${bioLabel()} activé pour le coffre`); }
}

// ── Code oublié : le coffre est vidé, rien ne peut le rouvrir ──
async function pvForgot() {
  const n = await photoRowsCount().catch(() => 0);
  const step1 = await dialog({ type: 'sheet', title: 'Code oublié ?',
    message: 'Ton code n\'est enregistré nulle part : ni nous ni personne ne peut rouvrir le coffre. Tu peux seulement le vider et créer un nouveau code.',
    actions: [{ label: 'Vider le coffre…', value: true, style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
  if (!step1) return;
  const step2 = await dialog({ title: n ? `Effacer ${plural(n, 'photo', 'photos')} ?` : 'Vider le coffre ?',
    message: 'Elles seront supprimées définitivement de cet iPhone. Impossible de revenir en arrière.',
    actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Effacer', value: true, style: 'destructive' }] });
  if (!step2) return;
  await vaultReset();
  pvSetWait(0);
  pv = { ...pv, phase: 'intro', legacy: 0, bio: false, bioStored: false, msg: '', err: false };
  pvPaint();
  showToast('Coffre vidé');
}

// ── Photos : ajout, ouverture, suppression ─────────────────
async function newPhotoSheet(file) {
  const url = URL.createObjectURL(file), today = localISO();
  photoNewPose = 'face';
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
  if (!res) return;
  if (!vaultIsOpen()) { pvPendingFile = file; pvPaint(); return; }   // refermé pendant la feuille
  try {
    const rec = await photoFromFile(file, res);
    await vaultAddPhoto(rec);
    await pvLoadPhotos();
    showToast(`Photo rangée dans le coffre · ${fmtBytes(rec.bytes)}`);
  } catch {
    if (!vaultIsOpen()) { pvPendingFile = file; pvPaint(); return; }   // refermé pendant la préparation : rangée après le code
    showToast('Photo illisible ou stockage indisponible', { error: true });
  }
}

async function openPhotoSheet(id) {
  const p = photoCache?.find(x => x.id === id);
  if (!p) return;
  await sheet({ title: `${photoPoseLabel(p.pose)} · ${fmtDate(p.date)}`, cancel: 'Fermer', confirm: '', body: `
    <img class="pview__img" src="${photoUrl(p)}" alt="${photoPoseLabel(p.pose)}, ${esc(fmtDate(p.date))}">
    <p class="pview__meta">${p.w} × ${p.h} px · ${fmtBytes(p.bytes)}</p>
    <button class="btn btn--danger btn--full" data-action="photo-delete" data-id="${p.id}">Supprimer cette photo</button>` });
}

function pvSetComparePos(v) {
  photoCmp.pos = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const frame = $('.pcmp__frame');
  frame?.style.setProperty('--pos', `${photoCmp.pos}%`);
  frame?.querySelector('.pcmp__range')?.setAttribute('aria-valuetext', `${photoCmp.pos} % de la photo d'avant`);
}

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'photoFile') {
    const file = el.files?.[0];
    el.value = '';   // la même photo choisie deux fois de suite déclenche bien un nouveau change
    if (!file) return;
    if (vaultIsOpen()) newPhotoSheet(file);
    else { pvPendingFile = file; pvPaint(); }
    return;
  }
  if (el.classList?.contains('pcmp__sel')) {
    photoCmp = { ...photoCmp, [el.dataset.side]: el.value };
    pvPaint();
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
// Clavier physique (iPad, Mac, tests) : chiffres et effacement sur le clavier du code
document.addEventListener('keydown', e => {
  if (currentView() !== 'photo-vault' || !PV_PAD_PHASES.includes(pv.phase) || document.querySelector(MODAL_SEL)) return;
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); pvType(e.key); }
  else if (e.key === 'Backspace' && pvCode) { e.preventDefault(); pvCode = pvCode.slice(0, -1); pvSyncDots(); }
});

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'go-photo-vault': () => { navigate('photo-vault'); },
  'pv-start':  () => { pvCode = ''; pvFirst = ''; pv = { ...pv, phase: 'create', msg: '', err: false }; pvPaint(); },
  'pv-digit':  (e, el) => { haptic('light'); pvType(el.dataset.d); },
  'pv-erase':  () => { if (!pvCode) return; pvCode = pvCode.slice(0, -1); pvSyncDots(); },
  'pv-bio':    () => pvTryBio(),
  'pv-forgot': () => pvForgot(),
  'pv-lock':   () => { vaultLock('manual'); showToast('Coffre verrouillé'); },
  'pv-change': () => { pvCode = ''; pvOld = ''; pvFirst = ''; pv = { ...pv, phase: 'change-old', msg: '', err: false }; pvPaint(); },
  'pv-change-cancel': () => { pvCode = ''; pvOld = ''; pvFirst = ''; pv = { ...pv, phase: vaultIsOpen() ? 'open' : 'unlock', msg: '', err: false }; pvPaint(); },
  'pv-bio-toggle': async () => {
    if (pv.bio) { await Native.vault.forget(); await vaultSetBio(false); pv.bio = false; pv.bioStored = false; pvPaint(); return; }
    if (await pvEnableBio()) pvPaint();
  },
  // Un seul tap : le sélecteur de fichier s'ouvre dans le geste (caméra ou pellicule, au choix d'iOS)
  'photo-add': () => {
    const inp = $('#photoFile');
    if (!inp) return;
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
    if (!(await confirmSheet('Supprimer cette photo ?', 'Elle n\'est nulle part ailleurs : pas de corbeille.', 'Supprimer'))) return;
    try { await photoDelete(id); } catch { showToast('Suppression impossible', { error: true }); return; }
    if (photoUrls.has(id)) { URL.revokeObjectURL(photoUrls.get(id)); photoUrls.delete(id); }
    el.closest('.sheet-root')?._close?.(null);
    if (vaultIsOpen()) await pvLoadPhotos();
    showToast('Photo supprimée');
  },
});
