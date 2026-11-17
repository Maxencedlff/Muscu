// ═══════════════════════════════════════════════════════════
//  Photo de profil, écrans. Données et appels : js/data/profile-photo.js ; contrat : docs/PHOTO_PROFIL.md.
//
//  - Réglages › Compte : cellule « Photo de profil », avec une petite mention « Pro » (rien pour un coach : elle
//    lui est offerte). Sans droit (verrou allumé, ni abonné ni coach) : l'écran d'abonnement.
//  - Feuille : aperçu, « Choisir une photo » (un seul toucher : la feuille d'iOS Prendre une photo / Photothèque
//    s'ouvre dans le geste), aperçu du carré recadré, « Utiliser cette photo » ; « Retirer la photo » ramène l'emoji.
//  - Profil d'un ami : « Signaler la photo » sous « Signaler » quand il a une photo visible ; la photo disparaît
//    aussitôt sur cet appareil, puis la proposition de bloquer, comme pour un profil.
//  - Serveur pas à jour ou photos éteintes : rien ne s'affiche.
//  Rien au pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

// Motifs propres à une photo (même fonction report que pour un profil : kind 'profile', ref 'photo:<id>').
// « Ce n'est pas cette personne » : la photo de quelqu'un d'autre (droit à l'image).
const PPH_REPORT_REASONS = [
  { key: 'sexuel', reason: 'sexuel', label: 'Nudité ou contenu sexuel' },
  { key: 'violence', reason: 'violence', label: 'Violence ou image choquante' },
  { key: 'haine', reason: 'haine', label: 'Symbole ou propos haineux' },
  { key: 'usurpation', reason: 'autre', label: 'Ce n\'est pas cette personne', details: 'Photo de profil : ce n\'est pas cette personne' },
  { key: 'autre', reason: 'autre', label: 'Autre chose' },
];
const PPH_ERROR_TEXT = {
  offline: 'Pas d\'Internet : réessaie avec du réseau.',
  disabled: 'Les photos de profil sont indisponibles pour le moment.',
  not_allowed: 'La photo de profil fait partie de MDLF Pro.',
  banned: 'Ta photo de profil a été retirée après des signalements. Écris à contact@mdlf.app si c\'est une erreur.',
  rate_limited: 'Tu as changé de photo plusieurs fois aujourd\'hui. Réessaie demain.',
  unreadable: 'Cette image ne peut pas être lue. Choisis-en une autre.',
  too_big: 'Cette image est trop lourde, même réduite. Choisis-en une autre.',
  busy: 'Envoi déjà en cours.',
};
const pphErrorText = k => PPH_ERROR_TEXT[k] || 'L\'envoi n\'a pas abouti. Réessaie.';

// Feuille ouverte : étape ('choose' | 'preview' | 'sending'), image préparée et son URL d'aperçu
let pphView = { stage: 'choose', enc: null, url: null };

// Coach actif : photo offerte, sans mention « Pro »
const pphFree = () => coachRole().isCoach === true;
function pphProTag() { return pphFree() ? '' : '<span class="pro-tag" aria-label="fonction Pro">Pro</span>'; }

// ── Réglages › Compte ───────────────────────────────────────
function profilePhotoCellHtml() {
  pphShownKey = pphKey();
  if (!profilePhotoOn()) return '';
  const p = myProfilePhoto();
  return `
          <button class="cell cell--nav" data-action="pph-open">
            <span class="cell__body"><span class="cell__title">Photo de profil ${pphProTag()}</span></span>
            <span class="cell__value">${p ? (p.hidden ? 'Masquée' : 'Ajoutée') : 'Aucune'}</span>
            ${icon('chevron.right', 16)}
          </button>`;
}

// ── Feuille ─────────────────────────────────────────────────
function pphSheetBody() {
  const v = pphView, p = myProfilePhoto();
  const free = pphFree(), allowed = proFeatureAllowed();
  const scope = 'Visible seulement de tes amis et de ton coach. Pas de nudité ni d\'image choquante : une photo signalée est masquée.';
  if (v.stage !== 'choose' && v.url) {
    const sending = v.stage === 'sending';
    return `
      <div class="pph-preview"><img class="pph-preview__img" src="${esc(v.url)}" alt="Aperçu de ta photo de profil, recadrée en carré" draggable="false"></div>
      <p class="pph-lead">Ta photo, recadrée en carré. ${scope}</p>
      <button class="btn btn--primary btn--full" data-action="pph-use" ${sending ? 'disabled aria-busy="true"' : ''}>${sending ? 'Envoi…' : 'Utiliser cette photo'}</button>
      <button class="btn btn--secondary btn--full pph-gap" data-action="pph-pick" ${sending ? 'disabled' : ''}>Choisir une autre photo</button>`;
  }
  const notice = p?.hidden ? '<p class="pph-note" role="status">Ta photo est masquée après un signalement, le temps que nous la vérifions (24 heures au plus).</p>'
    : p && !allowed ? '<p class="pph-note" role="status">Ta photo n\'est plus montrée : elle fait partie de MDLF Pro. Ton avatar la remplace.</p>' : '';
  return `
      <div class="pph-preview">${avatarHtml('xl')}</div>
      <p class="pph-lead">${scope}</p>
      ${notice}
      ${allowed ? `<button class="btn btn--primary btn--full" data-action="pph-pick">${p ? 'Changer de photo' : 'Choisir une photo'}</button>` : ''}
      ${p ? `<button class="btn btn--danger btn--full pph-gap" data-action="pph-remove">Retirer la photo</button>` : ''}
      <p class="pph-foot">${free ? 'Offerte aux coachs.' : 'Comprise dans MDLF Pro.'} Recadrée en carré et envoyée sans la localisation ni aucune autre donnée de la photo. Si elle ne s'affiche pas, ton avatar la remplace.</p>`;
}
function pphSheetPaint() {
  const el = document.querySelector('.pph-sheet');
  if (el) el.innerHTML = pphSheetBody();
}
async function pphOpenSheet() {
  if (!profilePhotoOn()) return;
  if (pph.state?.banned) { showToast(pphErrorText('banned'), { error: true }); return; }
  if (!proFeatureAllowed() && !myProfilePhoto()) { openPaywall('offer'); return; }
  pphView = { stage: 'choose', enc: null, url: null };
  await sheet({ title: 'Photo de profil', cancel: 'Fermer', confirm: '', body: `<div class="pph-sheet">${pphSheetBody()}</div>` });
  pphClearPreview();
}
function pphClearPreview() {
  if (pphView.url) URL.revokeObjectURL(pphView.url);
  pphView = { stage: 'choose', enc: null, url: null };
}

// Champ fichier : dans <body>, hors de #app et de la feuille (un redessin pendant que la photothèque d'iOS est
// ouverte remplacerait le champ, comme pour le coffre)
function pphInput() {
  let inp = document.getElementById('pphFile');
  if (inp) return inp;
  inp = document.createElement('input');
  Object.assign(inp, { type: 'file', id: 'pphFile', accept: 'image/*', tabIndex: -1, className: 'visually-hidden' });
  inp.setAttribute('aria-hidden', 'true');
  inp.addEventListener('change', async () => {
    const file = inp.files?.[0];
    inp.value = '';
    if (!file || !document.querySelector('.pph-sheet')) return;
    let enc;
    try { enc = await profilePhotoEncode(file); }
    catch (e) { showToast(pphErrorText(e?.message === 'too_big' ? 'too_big' : 'unreadable'), { error: true }); return; }
    if (pphView.url) URL.revokeObjectURL(pphView.url);
    pphView = { stage: 'preview', enc, url: URL.createObjectURL(enc.blob) };
    pphSheetPaint();
    document.querySelector('.pph-sheet [data-action="pph-use"]')?.focus({ preventScroll: true });
  });
  document.body.appendChild(inp);
  return inp;
}

async function pphUse(el) {
  if (pphView.stage !== 'preview' || !pphView.enc) return;
  pphView.stage = 'sending';
  pphSheetPaint();
  const r = await profilePhotoUpload(pphView.enc);
  if (!r.ok) {
    pphView.stage = 'preview';
    pphSheetPaint();
    if (r.kind === 'not_allowed') { el?.closest('.sheet-root')?._close?.(null); openPaywall('offer'); return; }
    showToast(pphErrorText(r.kind), { error: true });
    return;
  }
  haptic('success');
  document.querySelector('.pph-sheet')?.closest('.sheet-root')?._close?.(null);
  showToast('Photo de profil enregistrée');
  if (currentView() === 'account') render();
}

async function pphRemoveFlow() {
  if (!(await confirmSheet('Retirer ta photo ?', 'Elle est effacée du serveur. Ton avatar la remplace auprès de tes amis et de ton coach.', 'Retirer'))) return;
  const r = await profilePhotoRemove();
  if (!r.ok) { showToast(pphErrorText(r.kind), { error: true }); return; }
  document.querySelector('.pph-sheet')?.closest('.sheet-root')?._close?.(null);
  showToast('Photo retirée');
  if (currentView() === 'account') render();
}

// ── Profil d'un ami : signaler sa photo ─────────────────────
function profilePhotoReportCellHtml(uid) {
  pphShownKey = pphKey(uid);
  return profilePhotoIdOf(uid) ? `<button class="cell cell--destructive" data-action="pph-report" data-uid="${esc(uid)}">Signaler la photo</button>` : '';
}
async function pphReportFlow(uid) {
  const id = profilePhotoIdOf(uid);
  if (!id) return;
  const name = personName(socialPerson(uid) || {});
  const key = await dialog({ type: 'sheet', title: 'Signaler la photo', message: `Pourquoi ? ${name} ne saura pas que c'est toi.`,
    actions: [...PPH_REPORT_REASONS.map(r => ({ label: r.label, value: r.key })), { label: 'Annuler', style: 'cancel' }] });
  const why = PPH_REPORT_REASONS.find(r => r.key === key);
  if (!why) return;
  const r = await socialReport({ target: uid, kind: 'profile', ref: `photo:${id}`, reason: why.reason, details: why.details || '' });
  if (!socialToast(r)) return;
  profilePhotoHide(uid, id);   // plus montrée ici, sans attendre
  haptic();
  render();
  const block = await dialog({ title: 'Signalement envoyé', message: `Merci. La photo n'est plus affichée chez toi, et nous la vérifions sous 24 heures. Tu peux aussi bloquer ${name}.`,
    actions: [{ label: 'Bloquer', value: true, style: 'destructive' }, { label: 'OK', style: 'preferred' }] });
  if (block === true) await blockFlow(uid, { confirm: false });
}

// Profil d'un ami ou Compte affiché : redessiné quand ce qu'il montre de la photo change (cellule « Signaler la
// photo » quand sa photo arrive, « Ajoutée »). Clé notée au dessin, comparée à chaque nouvelle.
let pphShownKey = '';
function pphKey(uid = null) {
  return JSON.stringify([currentView(), uid, uid ? profilePhotoIdOf(uid) : null, profilePhotoOn(), myProfilePhoto()?.id || null, myProfilePhoto()?.hidden || false]);
}
onProfilePhotoChange(() => {
  const v = currentView();
  if (v !== 'social-profile' && v !== 'account') return;
  const uid = v === 'social-profile' ? routeParams(currentRoute())[0] : null;
  if (pphKey(uid) !== pphShownKey && !document.activeElement?.matches?.(EDITABLE)) render();
});

registerActions({
  'pph-open': () => pphOpenSheet(),
  // Un seul toucher : le sélecteur s'ouvre dans le geste
  'pph-pick': () => { const inp = pphInput(); inp.value = ''; inp.click(); },
  'pph-use': (e, el) => pphUse(el),
  'pph-remove': () => pphRemoveFlow(),
  'pph-report': (e, el) => pphReportFlow(el.dataset.uid),
});
