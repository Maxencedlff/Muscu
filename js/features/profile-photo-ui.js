// ═══════════════════════════════════════════════════════════
//  Photo de profil, écrans. Données et appels : js/data/profile-photo.js ; contrat : docs/PHOTO_PROFIL.md.
//
//  - Réglages › Compte : cellule « Photo de profil », avec une petite mention « Pro » (rien pour un coach ni pour
//    l'élève que son coach couvre : elle leur est offerte). Sans droit (verrou allumé, ni abonné, ni coach, ni élève
//    couvert) : l'écran d'abonnement.
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

// Mention seulement (le droit reste proFeatureAllowed) : photo offerte, sans « Pro », au coach actif ('coach') et à
// l'élève dont le coach couvre l'accès ('team' : statut 'coach_team' du serveur, offre en cours ou en grâce de 7 jours)
function pphFree() {
  if (coachRole().isCoach === true) return 'coach';
  const cover = accessStatus() === 'coach_team' ? accessCoachCover() : null;
  return cover && ['active', 'grace'].includes(cover.state) ? 'team' : null;
}
const PPH_FREE_TEXT = { coach: 'Offerte aux coachs.', team: 'Offerte par ton coach.' };
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
  // Coach : son affiche de coach (qu'il partage lui-même) peut aussi la montrer
  const poster = coachRole().isCoach === true ? ' Ton affiche de coach montre aussi cette photo.' : '';
  // En très grand texte (5e panel), une phrase courte, la règle dans un détail repliable : les boutons restent hauts
  const who = 'Visible seulement de tes amis et de ton coach.', rule = `${poster.trim()} Pas de nudité ni d'image choquante : une photo signalée est masquée.`.trim();
  const scope = `<span class="pph-scope-full">${who} ${rule}</span><span class="pph-scope-short">${who}</span>`;
  const rules = `<details class="pph-rules"><summary>Ce qui est permis</summary><p>${rule}</p></details>`;
  if (v.stage !== 'choose' && v.url) {
    const sending = v.stage === 'sending';
    return `
      <div class="pph-preview"><img class="pph-preview__img" src="${esc(v.url)}" alt="Aperçu de ta photo de profil, recadrée en carré" draggable="false"></div>
      <p class="pph-lead">Ta photo, recadrée en carré. ${scope}</p>${rules}
      <div class="pph-actionbar">
        <button class="btn btn--primary btn--full" data-action="pph-use" ${sending ? 'disabled aria-busy="true"' : ''}>${sending ? 'Envoi…' : 'Utiliser cette photo'}</button>
        <button class="btn btn--secondary btn--full pph-gap" data-action="pph-pick" ${sending ? 'disabled' : ''}>Choisir une autre photo</button>
      </div>`;
  }
  const notice = p?.hidden ? '<p class="pph-note" role="status">Ta photo est masquée après un signalement, le temps que nous la vérifions (24 heures au plus).</p>'
    : p && !allowed ? '<p class="pph-note" role="status">Ta photo n\'est plus montrée : elle fait partie de MDLF Pro. Ton avatar la remplace.</p>' : '';
  return `
      <div class="pph-preview">${avatarHtml('xl')}</div>
      <p class="pph-lead">${scope}</p>${rules}
      ${notice}
      ${allowed ? `<button class="btn btn--primary btn--full" data-action="pph-pick">${p ? 'Changer de photo' : 'Choisir une photo'}</button>` : ''}
      ${p ? `<button class="btn btn--secondary btn--full pph-gap" data-action="pph-avatar">Changer l'avatar</button>` : ''}
      ${p ? `<button class="btn btn--danger btn--full pph-gap" data-action="pph-remove">Retirer la photo</button>` : ''}
      <p class="pph-foot">${PPH_FREE_TEXT[free] || 'Comprise dans MDLF Pro.'} Recadrée en carré et envoyée sans la localisation ni aucune autre donnée de la photo. Si elle ne s'affiche pas, ton avatar la remplace.</p>`;
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
    pphView = { stage: 'preview', enc, url: URL.createObjectURL(enc.blob), file };
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
  // Coach : l'image d'origine reste sur l'iPhone pour son affiche (plus nette que les 512 px envoyés)
  if (pphView.file && typeof coachPosterKeepOriginal === 'function') coachPosterKeepOriginal(pphView.file);
  document.querySelector('.pph-sheet')?.closest('.sheet-root')?._close?.(null);
  showToast('Photo de profil enregistrée');
  if (currentView() === 'account') render();
}

async function pphRemoveFlow() {
  if (!(await confirmSheet('Retirer ta photo ?', 'Elle est effacée du serveur. Ton avatar la remplace auprès de tes amis et de ton coach.', 'Retirer'))) return;
  const r = await profilePhotoRemove();
  if (!r.ok) { showToast(pphErrorText(r.kind), { error: true }); return; }
  if (typeof posterPhotoClear === 'function') posterPhotoClear(account.user?.id);   // et sa copie pour l'affiche
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
  // Une ligne = un sens (panel du 20/11) : avec une photo, la ligne Avatar du compte disparaît ; l'avatar (montré si la
  // photo ne charge pas) se change ici
  'pph-avatar': async (e, el) => {
    el?.closest('.sheet-root')?._close?.(null);
    await new Promise(r => setTimeout(r, 300));
    await openAuthFlow({ step: 'avatar', mode: 'profile' });
  },
  'pph-report': (e, el) => pphReportFlow(el.dataset.uid),
});
