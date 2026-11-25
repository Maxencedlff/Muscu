// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : photos de bilan dans l'onglet Bilans (docs/PHOTOS_WEB.md ; logique :
//  js/desk/photo-device.js).
//
//  - Section « Photos » d'un bilan reçu : face, profil, dos du bilan affiché et du bilan « face à », côte à côte. Rien
//    ne s'affiche tout seul : « Afficher les photos » à chaque fois (un écran d'ordinateur se voit de loin).
//  - Agrandir : dialogue plein écran, les deux bilans côte à côte pour la même pose, zoom commun (boutons, molette,
//    clavier + − 0, double-clic), glisser pour se déplacer, pose suivante avec les flèches.
//  - « Relier cet ordinateur » : dialogue avec le QR code, puis le code de vérification à comparer avec l'iPhone.
//  - Réglages : état, « Oublier cet ordinateur ».
//  Pas de menu « Enregistrer l'image » (clic droit, glisser) : une capture reste possible, c'est dit au coach.
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_PH_ZOOM = [1, 1.5, 2, 3, 4];
const pz = { dlg: null, uid: null, cols: [], pose: 'face', z: 0, tx: 0, ty: 0, drag: null };
let deskPhWant = null, deskPhWorking = false, deskPhPairDlg = null, deskPhShown = null;   // deskPhShown : colonnes du dernier rendu

// Identifiants des photos envoyées dans un bilan (réponses aux suivis « photo »)
function deskPhIdsOf(req) {
  if (!req) return [];
  return req.items.filter(it => it.type === 'photo').flatMap(it => req.answers[it.key]?.ids || []).filter(id => CPH_ID_RE.test(id));
}
// Colonnes de la comparaison : [{ title, byPose: { face: photo | 'gone' } }]. 'gone' : photo retirée depuis par l'élève.
function deskPhColumns(uid, reqs) {
  const known = ph.students[uid]?.photos || [];
  return reqs.filter(Boolean).map(r => {
    const byPose = {};
    deskPhIdsOf(r.req).forEach(id => {
      const p = known.find(x => x.id === id);
      if (p && !byPose[p.pose]) byPose[p.pose] = p;
    });
    return { title: r.title, n: deskPhIdsOf(r.req).length, byPose };
  });
}

function deskPhBodyHtml(uid, cols, nTotal) {
  const host = deskPhHost();
  if (!host && ph.entry === undefined) return '<div class="row"><span class="grow muted">Chargement…</span></div>';
  if (!host && !ph.entry) return `<div class="row ph-intro">${deskIcon('photo', 'sm')}<span class="grow">${esc(plural(nTotal, 'photo envoyée', 'photos envoyées'))}
      <span class="t2 blk">Chiffrées de bout en bout : pour les voir ici, relie une fois cet ordinateur à ton iPhone (QR code, 30 secondes).</span></span>
      <button type="button" class="btn tint" data-ph="link">Relier cet ordinateur</button></div>`;
  if (!ph.session) return `<div class="row ph-intro">${deskIcon('photo', 'sm')}<span class="grow">${esc(plural(nTotal, 'photo envoyée', 'photos envoyées'))}
      <span class="t2 blk">${ph.error ? esc(deskPhErrorText(ph.error)) : ph.lockReason === 'idle' ? 'Masquées après 5 minutes sans activité.' : 'Elles ne s\'affichent pas d\'elles-mêmes : un écran d\'ordinateur se voit de loin.'}</span></span>
      <button type="button" class="btn tint" data-ph="show" ${ph.opening ? 'disabled aria-busy="true"' : ''}>Afficher les photos</button></div>`;
  const st = ph.students[uid];
  if (!st) return '<div class="row"><span class="grow muted">Ouverture des photos…</span></div>';
  if (st.error) return `<div class="row"><span class="grow">${esc(deskPhErrorText(st.error))}</span><button type="button" class="btn" data-ph="retry">Réessayer</button></div>`;
  const poses = PHOTO_POSE_KEYS.filter(k => cols.some(c => c.byPose[k]));
  if (!poses.length) return '<div class="row"><span class="grow muted">Ces photos ont été retirées par ton élève.</span></div>';
  const cell = (c, k) => {
    const p = c.byPose[k];
    if (!p) return `<div class="ph-cell none"><span class="faint">${c.n ? 'Pas de photo' : 'Aucune photo dans ce bilan'}</span></div>`;
    const url = ph.urls.get(p.id);
    const label = `${photoPoseLabel(k)}, ${c.title}`;
    return url ? `<button type="button" class="ph-cell" data-ph="zoom" data-pose="${k}" aria-label="${esc(label)} : agrandir"><img src="${esc(url)}" alt="${esc(label)}" draggable="false"></button>`
      : `<div class="ph-cell none" role="status"><span class="faint">Déchiffrement…</span></div>`;
  };
  return `<div class="ph-grid c${cols.length}" role="table" aria-label="Photos, ${esc(cols.map(c => c.title).join(' face à '))}">
      <div class="ph-h" role="row"><span role="columnheader" class="sr">Pose</span>${cols.map(c => `<span role="columnheader">${esc(c.title)}</span>`).join('')}</div>
      ${poses.map(k => `<div class="ph-r" role="row"><span role="rowheader" class="ph-pose">${esc(photoPoseLabel(k))}</span>${cols.map(c => `<span role="cell">${cell(c, k)}</span>`).join('')}</div>`).join('')}
    </div>`;
}

// Section de l'onglet Bilans : cur, prev = { req, title }
function deskPhSectionHtml(uid, cur, prev) {
  const nTotal = deskPhIdsOf(cur.req).length + (prev ? deskPhIdsOf(prev.req).length : 0);
  if (!nTotal) return '';
  const cols = deskPhColumns(uid, [cur, prev]);
  deskPhShown = { uid, cols };
  if (ph.session) { deskPhWant = { uid, photos: cols.flatMap(c => Object.values(c.byPose)) }; queueMicrotask(deskPhWork); }
  if (!deskPhHost() && ph.entry === undefined) deskPhEntry().then(() => deskPhNotify());
  const foot = ph.session ? `<div class="gfoot ph-foot"><span class="grow">Touche une photo pour l'agrandir. Déchiffrées sur cet ordinateur, jamais enregistrées ; une capture d'écran reste possible.</span>
      <button type="button" class="btn link" data-ph="hide">Masquer les photos</button></div>` : '';
  return `<section class="gblock ph-sec" aria-labelledby="h-ph"><h2 class="gh" id="h-ph">Photos</h2><div class="group pad-s">${deskPhBodyHtml(uid, cols, nTotal)}</div>${foot}</section>`;
}
// Chargements demandés par le dernier rendu : liste de l'élève, puis chaque image (une à la fois)
async function deskPhWork() {
  const w = deskPhWant;
  if (!w || deskPhWorking || !ph.session) return;
  deskPhWorking = true;
  try {
    if (!ph.students[w.uid]) { await deskPhLoad(w.uid); return; }
    for (const p of w.photos) { if (!ph.session || deskPhWant !== w) break; if (!ph.urls.has(p.id)) await deskPhImage(w.uid, p); }
  } finally { deskPhWorking = false; if (deskPhWant !== w) queueMicrotask(deskPhWork); }
}

async function deskPhShow() {
  if (ph.opening || deskPhNeedsCleanPage('show')) return;
  ph.opening = true; ph.error = null; deskPhNotify();
  const r = await deskPhOpen();
  ph.opening = false;
  if (!r.ok && r.kind !== 'stale') {
    if (r.kind === 'signed_out') { deskEndSession(); return; }
    ph.error = r.kind === 'unlinked' ? null : r.kind;
    deskToast(deskPhErrorText(r.kind));
  }
  deskPhNotify();
}

// ── Relier cet ordinateur (dialogue) ────────────────────────

function deskPhPairHtml() {
  const p = ph.pair;
  if (!p) return `<h2 class="dlg-t" id="phl-t">Relier cet ordinateur</h2>
    <p class="dlg-p">Tes photos de bilan sont chiffrées pour toi seul. Ton iPhone confie leur clé à cet ordinateur, chiffrée pour lui : le serveur ne peut pas la lire.</p>
    <p class="dlg-p">Ne relie pas un ordinateur partagé. Tu pourras le retirer à tout moment, ici ou depuis l'iPhone.</p>
    <div class="dlg-f"><button type="button" class="btn" data-phl="close">Annuler</button><button type="button" class="btn tint" data-phl="start">Afficher le QR code</button></div>`;
  if (p.state === 'waiting') return `<h2 class="dlg-t" id="phl-t">Vise ce QR code avec ton iPhone</h2>
    <div class="phl-qr">${deskQrSvg(p.qr, 'QR code à viser avec l\'app MDLF Training')}</div>
    <ol class="phl-steps"><li>Dans l'app : Coach › Mes élèves › Ordinateurs reliés.</li><li>« Relier un ordinateur », puis vise le code.</li></ol>
    <p class="dlg-p muted" id="phl-exp" aria-live="off">Valable 2 minutes.</p>
    <div class="dlg-f"><button type="button" class="btn" data-phl="close">Annuler</button></div>`;
  if (p.state === 'offered') return `<h2 class="dlg-t" id="phl-t">Code de vérification</h2>
    <p class="phl-sas" aria-label="Code ${esc(p.sas.split('').join(' '))}">${esc(p.sas)}</p>
    <p class="dlg-p">Ton iPhone affiche-t-il le même code ? Si oui, touche « Relier » sur l'iPhone. Sinon, touche Annuler sur les deux.</p>
    <div class="dlg-f"><button type="button" class="btn" data-phl="close">Annuler</button></div>`;
  if (p.state === 'done') return `<h2 class="dlg-t" id="phl-t">Cet ordinateur est relié</h2>
    <p class="dlg-p">${p.persisted === false ? 'Ce navigateur ne garde pas la clé (navigation privée) : il faudra le relier de nouveau à la prochaine ouverture.' : 'Tu verras les photos de tes élèves dans l\'onglet Bilans de leur fiche.'}</p>
    <div class="dlg-f"><button type="button" class="btn tint" data-phl="close">Voir les photos</button></div>`;
  const why = p.state === 'expired' ? 'Le code a expiré.' : deskPhErrorText(p.kind);
  return `<h2 class="dlg-t" id="phl-t">Pas relié</h2><p class="dlg-p" role="alert">${esc(why)}</p>
    <div class="dlg-f"><button type="button" class="btn" data-phl="close">Fermer</button><button type="button" class="btn tint" data-phl="start">Nouveau code</button></div>`;
}
function deskPhPairPaint() {
  const dlg = deskPhPairDlg;
  if (!dlg) return;
  const key = ph.pair ? `${ph.pair.id}|${ph.pair.state}` : 'intro';
  if (dlg.dataset.key === key) {
    const exp = dlg.querySelector('#phl-exp');
    if (exp && ph.pair) exp.textContent = `Valable encore ${Math.max(0, Math.ceil((ph.pair.expiresAt - Date.now()) / 1000))} s.`;
    return;
  }
  dlg.dataset.key = key;
  dlg.innerHTML = deskPhPairHtml();
  frTypoNode(dlg);
  (dlg.querySelector('[data-phl="start"]') || dlg.querySelector('[data-phl="close"]'))?.focus();
  deskAnnounce(dlg.querySelector('.dlg-t')?.textContent || '');
}
function deskPhPairOpen() {
  if (deskPhHost() || deskPhNeedsCleanPage('link')) return;
  deskPhPairDlg?.close();
  const dlg = document.createElement('dialog');
  dlg.className = 'confirm phl';
  dlg.setAttribute('aria-labelledby', 'phl-t');
  document.body.appendChild(dlg);
  deskPhPairDlg = dlg;
  dlg.addEventListener('click', async e => {
    const b = e.target.closest('[data-phl]');
    if (!b) return;
    if (b.dataset.phl === 'close') { dlg.close(); return; }
    b.disabled = true;
    const r = await deskPhPairStart();
    if (!r.ok) { b.disabled = false; if (r.kind === 'signed_out') { dlg.close(); deskEndSession(); return; } deskToast(deskPhErrorText(r.kind)); }
  });
  dlg.addEventListener('close', () => {
    const done = ph.pair?.state === 'done';
    deskPhPairStop();
    dlg.remove();
    if (deskPhPairDlg === dlg) deskPhPairDlg = null;
    deskRender();
    if (done) document.querySelector('[data-ph="hide"], [data-ph="show"]')?.focus();
  });
  deskPhPairPaint();
  dlg.showModal();
}

// ── Agrandir ────────────────────────────────────────────────

function deskPhZoomApply() {
  const d = pz.dlg;
  if (!d) return;
  const s = DESK_PH_ZOOM[pz.z];
  if (s === 1) { pz.tx = 0; pz.ty = 0; }
  d.querySelectorAll('.phz-view img').forEach(img => { img.style.transform = `translate(${pz.tx}px, ${pz.ty}px) scale(${s})`; });
  const out = d.querySelector('.phz-z');
  if (out) out.textContent = `${Math.round(s * 100)} %`;
  d.querySelector('[data-pz="out"]')?.toggleAttribute('disabled', pz.z === 0);
  d.querySelector('[data-pz="in"]')?.toggleAttribute('disabled', pz.z === DESK_PH_ZOOM.length - 1);
  d.classList.toggle('zoomed', s > 1);
}
function deskPhZoomPaint() {
  const d = pz.dlg;
  if (!d) return;
  const poses = PHOTO_POSE_KEYS.filter(k => pz.cols.some(c => c.byPose[k] && ph.urls.has(c.byPose[k].id)));
  if (!poses.includes(pz.pose)) pz.pose = poses[0] || 'face';
  d.innerHTML = `<div class="phz-head">
      <h2 class="dlg-t" id="phz-t">${esc(photoPoseLabel(pz.pose))}</h2>
      <div class="seg" role="radiogroup" aria-label="Pose">${poses.map(k => `<button type="button" role="radio" aria-checked="${k === pz.pose}" class="${k === pz.pose ? 'on' : ''}" data-pz="pose" data-pose="${k}">${esc(photoPoseLabel(k))}</button>`).join('')}</div>
      <div class="phz-tools"><button type="button" class="btn ic" data-pz="out" aria-label="Dézoomer">−</button><output class="phz-z" aria-live="polite">100 %</output>
        <button type="button" class="btn ic" data-pz="in" aria-label="Zoomer">+</button><button type="button" class="btn" data-pz="fit">Ajuster</button></div>
      <button type="button" class="btn" data-pz="close">Fermer</button></div>
    <div class="phz-panes c${pz.cols.length}">${pz.cols.map(c => {
      const p = c.byPose[pz.pose], url = p && ph.urls.get(p.id);
      return `<figure class="phz-pane"><figcaption>${esc(c.title)}</figcaption><div class="phz-view">${url ? `<img src="${esc(url)}" alt="${esc(`${photoPoseLabel(pz.pose)}, ${c.title}`)}" draggable="false">` : '<span class="faint">Pas de photo</span>'}</div></figure>`;
    }).join('')}</div>`;
  frTypoNode(d);
  deskPhZoomApply();
}
function deskPhZoomOpen(uid, cols, pose) {
  pz.dlg?.close();
  const d = document.createElement('dialog');
  d.className = 'phz';
  d.setAttribute('aria-labelledby', 'phz-t');
  document.body.appendChild(d);
  Object.assign(pz, { dlg: d, uid, cols, pose, z: 0, tx: 0, ty: 0, drag: null });
  const step = k => { pz.z = Math.max(0, Math.min(DESK_PH_ZOOM.length - 1, pz.z + k)); deskPhZoomApply(); };
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-pz]');
    if (!b) return;
    const a = b.dataset.pz;
    if (a === 'close') d.close();
    else if (a === 'in') step(1);
    else if (a === 'out') step(-1);
    else if (a === 'fit') { pz.z = 0; deskPhZoomApply(); }
    else if (a === 'pose') { pz.pose = b.dataset.pose; deskPhZoomPaint(); d.querySelector(`[data-pz="pose"][data-pose="${pz.pose}"]`)?.focus(); }
  });
  d.addEventListener('dblclick', e => { if (e.target.closest('.phz-view')) { pz.z = pz.z ? 0 : 2; deskPhZoomApply(); } });
  d.addEventListener('wheel', e => { if (!e.target.closest('.phz-view')) return; e.preventDefault(); step(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  d.addEventListener('keydown', e => {
    deskPhTouch();
    if (e.key === '+' || e.key === '=') { e.preventDefault(); step(1); }
    else if (e.key === '-') { e.preventDefault(); step(-1); }
    else if (e.key === '0') { e.preventDefault(); pz.z = 0; deskPhZoomApply(); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.target.closest('[role="radiogroup"]')) {
      const poses = [...d.querySelectorAll('[data-pz="pose"]')].map(x => x.dataset.pose), i = poses.indexOf(pz.pose);
      if (poses.length > 1) { e.preventDefault(); pz.pose = poses[(i + (e.key === 'ArrowRight' ? 1 : poses.length - 1)) % poses.length]; deskPhZoomPaint(); }
    }
  });
  // Glisser (souris, doigt, stylet) pour se déplacer dans la photo agrandie ; les deux suivent ensemble
  d.addEventListener('pointerdown', e => {
    if (!e.target.closest('.phz-view') || DESK_PH_ZOOM[pz.z] === 1) return;
    pz.drag = { x: e.clientX - pz.tx, y: e.clientY - pz.ty, id: e.pointerId };
    e.target.closest('.phz-view').setPointerCapture?.(e.pointerId);
  });
  d.addEventListener('pointermove', e => { if (pz.drag && e.pointerId === pz.drag.id) { pz.tx = e.clientX - pz.drag.x; pz.ty = e.clientY - pz.drag.y; deskPhZoomApply(); } });
  ['pointerup', 'pointercancel'].forEach(t => d.addEventListener(t, () => { pz.drag = null; }));
  d.addEventListener('contextmenu', e => { if (e.target.closest('.phz-view')) e.preventDefault(); });
  d.addEventListener('close', () => { d.remove(); if (pz.dlg === d) pz.dlg = null; document.querySelector(`[data-ph="zoom"][data-pose="${pose}"]`)?.focus(); });
  deskPhZoomPaint();
  d.showModal();
  d.querySelector('[data-pz="close"]')?.focus();
}

// ── Réglages ────────────────────────────────────────────────

function deskPhSettingsHtml() {
  if (deskPhHost()) return '';
  if (ph.entry === undefined) deskPhEntry().then(() => deskPhNotify());
  const e = ph.entry;
  return `<section class="narrow gap-t" aria-labelledby="h-ph-set"><h2 class="gh" id="h-ph-set">Photos de bilan sur cet ordinateur</h2><div class="group">
      ${e ? `<div class="row"><div class="grow">Relié${e.linkedAt ? ` le ${esc(fmtDate(e.linkedAt, 'short'))}` : ''}<span class="t2 blk">${esc(e.label || 'Cet ordinateur')}</span></div></div>
        <button type="button" class="row act" data-ph="forget">${deskIcon('trash', 'sm')}<span class="grow">Oublier cet ordinateur</span></button>`
    : `<div class="row"><div class="grow">Pas relié</div></div><button type="button" class="row act" data-ph="link">${deskIcon('phone', 'sm')}<span class="grow">Relier cet ordinateur</span></button>`}
    </div><div class="gfoot">${e ? 'Oublier efface la clé de ce navigateur et retire l\'ordinateur de ton compte. Se déconnecter de cet ordinateur l\'oublie aussi.' : 'Avec l\'app iPhone, par un QR code. La clé des photos reste illisible pour le serveur.'}</div></section>`;
}

// ── Gestes ──────────────────────────────────────────────────

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-ph]');
  if (!el) return;
  const a = el.dataset.ph;
  if (a === 'link') deskPhPairOpen();
  else if (a === 'show') deskPhShow();
  else if (a === 'hide') { deskPhLock('manual'); deskRender(); document.querySelector('[data-ph="show"]')?.focus(); }
  else if (a === 'retry') { const uid = deskRoute().id; delete ph.students[uid]; deskRender(); }
  else if (a === 'zoom') {
    if (!deskPhShown || !ph.session) return;
    deskPhZoomOpen(deskPhShown.uid, deskPhShown.cols, el.dataset.pose);
  } else if (a === 'forget') {
    if (!(await deskConfirm({ title: 'Oublier cet ordinateur ?', text: 'Il ne pourra plus ouvrir les photos de tes élèves. Tu pourras le relier de nouveau avec ton iPhone.', ok: 'Oublier', danger: true }))) return;
    await deskPhForget({ server: true });
    deskToast('Cet ordinateur est oublié');
    deskRender();
  }
});
document.addEventListener('contextmenu', e => { if (e.target.closest?.('.ph-cell')) e.preventDefault(); });
['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, () => deskPhTouch(), { passive: true, capture: true }));
// Onglet caché (autre onglet, ordinateur verrouillé, fenêtre réduite) : photos masquées tout de suite
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && deskPhLock('hidden')) { pz.dlg?.close(); } });
window.addEventListener('pagehide', () => { deskPhLock('hidden'); deskPhPairStop(); });
ph.onChange = () => {
  deskPhPairPaint();
  if (pz.dlg && !ph.session) pz.dlg.close();
  if (desk.user) deskRender();
};
