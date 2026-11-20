// ═══════════════════════════════════════════════════════════
//  « Mon affiche de coach » : entrée, aperçu, partage. Contenu et photo gardée : js/data/coach-poster.js ; dessin :
//  js/features/coach-poster-art.js ; choix et vote : docs/AFFICHE_COACH.md.
//
//  - Seulement pour un coach au rôle validé (coachRole().isCoach) : cellule dans Mes élèves › Invitations et dans
//    Réglages › Coach, sous son code. Un élève ne la voit jamais.
//  - Aperçu commun aux images partagées (openStoryPreview, js/features/share.js) : format story ou carré, nom écrit sur
//    l'affiche, silhouette femme ou homme (préremplie avec le réglage de
//    silhouette du compte, jamais déduite du prénom) qui accorde le titre, titre « Coach » seul au choix, photo de
//    l'affiche (choisie ici, gardée sur l'iPhone, jamais envoyée), puis « Partager » (feuille de partage d'iOS).
//    Rien n'est publié ni envoyé sans ce toucher.
//  - Photo : celle choisie pour l'affiche, sinon l'image d'origine de la photo de profil (gardée à son envoi), sinon la
//    photo de profil du serveur (512 px), sinon aucune (initiales dans le rond) : jamais le personnage à sa place.
//  Rien au pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

const CPOSTER_PHOTO_WAIT_MS = 4000;
const CPOSTER_SILHOUETTES = [{ key: 'female', label: 'Femme' }, { key: 'male', label: 'Homme' }];
// Aperçu ouvert : nom, silhouette, titre neutre, images chargées (un personnage par silhouette)
let cposter = null;

// Cellule « Mon affiche de coach » (coach validé seulement)
function coachPosterCellHtml() {
  if (!account.user || coachRole().isCoach !== true) return '';
  return `<button class="cell cell--nav" data-action="coach-poster-open">
            <span class="cell__body"><span class="cell__title">Mon affiche de coach</span><span class="cell__sub">Une image pour ta story, avec ton code</span></span>
            ${icon('chevron.right', 16)}
          </button>`;
}

// Image d'origine réduite à 2048 px (JPEG), pour la garder sur l'appareil
async function coachPosterEncode(file) {
  const img = await loadImageFrom(file);
  const { w, h } = posterPhotoSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvasToBlob(c, 'image/jpeg', 0.9);
}
// Photo de profil envoyée par un coach : son image d'origine gardée pour l'affiche (appelée par profile-photo-ui.js)
async function coachPosterKeepOriginal(file) {
  const me = account.user?.id;
  if (!me || coachRole().isCoach !== true || !file) return;
  try { await posterPhotoSave(me, await coachPosterEncode(file)); } catch { /* l'affiche prendra la photo du serveur */ }
}

const blobImage = blob => new Promise(resolve => {
  const url = URL.createObjectURL(blob), img = new Image();
  img.onload = () => resolve(img); img.onerror = () => { URL.revokeObjectURL(url); resolve(null); }; img.src = url;
});

// Photo de l'affiche : celle de l'appareil, sinon ma photo de profil lisible (pas masquée, droit gardé)
async function coachPosterPhoto() {
  const me = account.user?.id;
  if (!me) return null;
  const local = await posterPhotoLoad(me);
  if (local) { const img = await blobImage(local); if (img) return img; }
  const p = myProfilePhoto();
  if (!p || p.hidden || !proFeatureAllowed()) return null;
  let url = profilePhotoUrl(me);
  for (let i = 0; !url && i < CPOSTER_PHOTO_WAIT_MS / 150; i++) {
    await new Promise(r => setTimeout(r, 150));
    url = profilePhotoUrlKnown(me);
  }
  return url ? loadImage(url) : null;
}

function coachPosterModelNow() {
  return coachPosterModel({
    name: cposter.name, specialty: cposter.specialty, username: account.profile?.username || '', code: coachPro.code,
    badge: coachPro.card?.status === 'declared', hasPhoto: !!cposter.photo, silhouette: cposter.silhouette, neutral: cposter.neutral,
  });
}

// Bouton d'un segment : actif, aria-pressed, action et valeur
const cposterSeg = (action, key, on, label, aria = '') => `<button type="button" class="segmented__btn${on ? ' segmented__btn--active' : ''}" aria-pressed="${on}"${aria ? ` aria-label="${esc(aria)}"` : ''} data-action="${action}" data-v="${key}">${esc(label)}</button>`;
function cposterTitleLabel() { return cposter.silhouette === 'female' ? 'Nouvelle coach' : 'Nouveau coach'; }

// Réglages de l'aperçu, dans un bloc groupé sous le format : nom, silhouette, titre et photo
function coachPosterToolsHtml() {
  // Ordre (5e panel) : le nom d'abord (obligatoire pour partager ; la note « Ajoute ton nom » y mène), puis Silhouette,
  // le titre, la spécialité (facultative) et la photo. Plus d'aide « sticker lien » : l'app
  // n'est pas encore sur l'App Store (docs/AFFICHE_COACH.md)
  return {
    note: 'Ajoute ton nom pour partager ton affiche.',
    noteFocus: '#cposterName',
    rows: `
      <div class="cposter-form">
        <label class="cposter-row" for="cposterName">
          <span class="cposter-row__title">Nom</span>
          <input class="cposter-row__input" id="cposterName" type="text" autocomplete="name" autocapitalize="words" autocorrect="off"
                 spellcheck="false" enterkeyhint="done" maxlength="${CPOSTER_NAME_MAX}" placeholder="Prénom Nom" value="${esc(cposter.name)}"
                 aria-label="Ton nom sur l'affiche">
        </label>
        <div class="cposter-row">
          <span class="cposter-row__title" id="cposterSilLabel">Silhouette</span>
          <div class="segmented cposter-row__seg" role="group" aria-labelledby="cposterSilLabel">
            ${CPOSTER_SILHOUETTES.map(x => cposterSeg('coach-poster-silhouette', x.key, x.key === cposter.silhouette, x.label)).join('')}
          </div>
        </div>
        <div class="cposter-row">
          <span class="cposter-row__title" id="cposterTitleLabel">Titre</span>
          <div class="segmented cposter-row__seg" role="group" aria-labelledby="cposterTitleLabel">
            ${cposterSeg('coach-poster-title', 'gendered', !cposter.neutral, cposterTitleLabel())}${cposterSeg('coach-poster-title', 'neutral', cposter.neutral, 'Coach', 'Coach, sans nouveau ni nouvelle')}
          </div>
        </div>
        <label class="cposter-row" for="cposterSpecialty">
          <span class="cposter-row__title">Spécialité</span>
          <input class="cposter-row__input" id="cposterSpecialty" type="text" autocomplete="off" autocapitalize="sentences" autocorrect="on"
                 enterkeyhint="done" maxlength="${CPOSTER_SPECIALTY_MAX}" placeholder="Force · Perte de poids · Rééducation" value="${esc(cposter.specialty)}"
                 aria-label="Ta spécialité (facultatif), par exemple Force, Perte de poids, Rééducation">
        </label>
        <button type="button" class="cposter-row cposter-row--nav" data-action="coach-poster-photo" aria-label="Photo de l'affiche, gardée sur ton iPhone">
          <span class="cposter-row__title">Photo</span><span class="cposter-row__end"><span class="cposter-row__value">${cposter.photo ? 'Changer' : 'Choisir'}</span>${icon('chevron.right', 14)}</span>
        </button>
      </div>
      <p class="cposter-foot">Spécialité facultative, ${CPOSTER_SPECIALTY_MAX} caractères au plus. Quand tu partages ton affiche, tes élèves voient ce nom dans Mon coach.</p>`,
  };
}

// Personnage de la silhouette choisie (chargé une fois par silhouette)
async function cposterBody(mine) {
  const k = mine.silhouette;
  if (!mine.bodies[k]) mine.bodies[k] = cpaHeroBody(k).catch(() => null);
  return mine.bodies[k];
}

// Ouvre l'aperçu. Code coach pas encore lu : relu d'abord ; sans code, un message (rien ne s'ouvre)
async function openCoachPoster() {
  if (!account.user || coachRole().isCoach !== true || cposter || shareState) return;
  if (!coachPro.code) await coachProRefresh();
  if (!coachPro.code) { showToast(coachPro.error ? coachProErrorText(coachPro.error) : 'Ton code coach n\'est pas prêt. Réessaie plus tard.', { error: true }); return; }
  const me = account.user.id;
  const prefs = coachPosterPrefs(me);
  const mine = cposter = { name: prefs ? prefs.name : posterName(coachPro.request?.card_name), specialty: prefs?.specialty || '',
    silhouette: prefs ? prefs.silhouette : (bodySilhouette() === 'female' ? 'female' : 'male'), neutral: prefs?.neutral === true,
    photo: null, icon: null, body: null, bodies: {}, timer: null };
  const [photo, iconImg, body] = await Promise.all([coachPosterPhoto(), loadImage('icon-192.png'), cposterBody(mine), cpaFontsReady()]);
  Object.assign(mine, { photo, icon: iconImg, body });
  const state = { name: coachPosterFileName('story'), alt: coachPosterAlt(coachPosterModelNow()), formats: true,
    tools: coachPosterToolsHtml(), stats: { title: 'Mon affiche de coach' },
    canSend: () => !!mine.name,
    // Partagée : le nom part au serveur pour Mon coach de ses élèves (dit sous les réglages)
    onShared: () => { if (mine.name) coachPosterPublishName(mine.name); },
    onClose: () => { clearTimeout(mine.timer); if (cposter === mine) cposter = null; } };
  const opened = openStoryPreview(state, (canvas, format) => {
    const m = coachPosterModelNow();
    canvas.setAttribute('aria-label', coachPosterAlt(m));
    drawCoachPosterArt(canvas, m, { photo: mine.photo, icon: mine.icon, body: mine.body }, { format });
  });
  // Nom et spécialité : l'aperçu se redessine après la frappe ; sans nom, « Partager » reste grisé (canSend)
  for (const [id, field] of [['#cposterName', 'name'], ['#cposterSpecialty', 'specialty']]) {
    const input = state.root?.querySelector(id);
    input?.addEventListener('input', () => {
      clearTimeout(mine.timer);
      mine.timer = setTimeout(() => {
        if (cposter !== mine || shareState !== state) return;
        mine[field] = posterName(input.value);
        coachPosterSavePrefs(me, mine);
        sharePreviewDraw(state);
      }, 250);
    });
  }
  await opened;
}

// Photo de l'affiche choisie ici : gardée sur l'appareil seulement (jamais envoyée), l'aperçu se redessine
function coachPosterPhotoInput() {
  let inp = document.getElementById('cposterFile');
  if (inp) return inp;
  inp = document.createElement('input');
  Object.assign(inp, { type: 'file', id: 'cposterFile', accept: 'image/*', tabIndex: -1, className: 'visually-hidden' });
  inp.setAttribute('aria-hidden', 'true');
  inp.addEventListener('change', async () => {
    const file = inp.files?.[0], st = shareState, mine = cposter, me = account.user?.id;
    inp.value = '';
    if (!file || !st || !mine || !me) return;
    let blob, img;
    try { blob = await coachPosterEncode(file); img = await blobImage(blob); }
    catch { showToast('Cette image ne peut pas être lue. Choisis-en une autre.', { error: true }); return; }
    if (!img || cposter !== mine) return;
    await posterPhotoSave(me, blob);
    mine.photo = img;
    const v = st.root?.querySelector('[data-action="coach-poster-photo"] .cposter-row__value');
    if (v) v.textContent = 'Changer';
    sharePreviewDraw(st);
  });
  document.body.appendChild(inp);
  return inp;
}

registerActions({
  'coach-poster-open': () => { openCoachPoster(); },
  // Un seul toucher : le sélecteur d'iOS (Photothèque, Prendre une photo) s'ouvre dans le geste
  'coach-poster-photo': () => { const inp = coachPosterPhotoInput(); inp.value = ''; inp.click(); },
  'coach-poster-silhouette': (e, el) => { cposterPick(el, 'silhouette', CPOSTER_SILHOUETTES.map(x => x.key)); },
  'coach-poster-title': (e, el) => { cposterPick(el, 'neutral', ['gendered', 'neutral']); },
});

// Un choix des segments de l'aperçu : réglage gardé, boutons mis à jour, personnage rechargé si la silhouette change,
// libellé du titre accordé, image redessinée
async function cposterPick(el, field, keys) {
  const st = shareState, mine = cposter, v = el.dataset.v;
  if (!st || !mine || st.busy || !keys.includes(v)) return;
  const val = field === 'neutral' ? v === 'neutral' : v;
  if (mine[field] === val) return;
  mine[field] = val;
  coachPosterSavePrefs(account.user?.id, mine);
  el.closest('.segmented')?.querySelectorAll('.segmented__btn').forEach(b => {
    const on = b === el;
    b.setAttribute('aria-pressed', String(on)); b.classList.toggle('segmented__btn--active', on);
  });
  if (field === 'silhouette') {
    const t = st.root?.querySelector('[data-action="coach-poster-title"][data-v="gendered"]');
    if (t) t.textContent = cposterTitleLabel();
    const send = st.root?.querySelector('.share-preview__send');
    if (send) send.disabled = true;   // personnage en chargement : pas de partage de l'ancienne image
    st.blob = null;
    mine.body = await cposterBody(mine);
    if (cposter !== mine || shareState !== st) return;
  }
  haptic();
  sharePreviewDraw(st);
}
