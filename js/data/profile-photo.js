// ═══════════════════════════════════════════════════════════
//  Photo de profil : image préparée sur l'appareil, envoi, lecture des photos des autres, signalement local
//  (sans écran). Contrat, choix, sources et limites : docs/PHOTO_PROFIL.md ; serveur :
//  supabase/migrations/20261116000000_photo_profil.sql ; écrans : js/features/profile-photo-ui.js.
//
//  - Droit : proFeatureAllowed() (js/data/access.js), la même règle que les autres fonctions Pro : abonné, ou
//    coach actif ; verrou éteint, ouvert à tous. Le serveur refait le contrôle (not_allowed) à chaque envoi.
//  - Image : recadrée au centre en carré, PPH_PX px de côté au plus, WebP si l'appareil sait l'encoder (WebKit ne
//    le sait pas : JPEG), qualité baissée jusqu'à PPH_TARGET octets. Redessinée par un canvas : aucune métadonnée
//    de la photo d'origine ne part (ni lieu, ni appareil, ni date).
//  - Lecture : profile_photos(uids) dit quelles photos je peux voir (amis acceptés, coach, élèves) ; chaque image
//    est lue par une URL signée de PPH_URL_TTL_S secondes puis gardée en mémoire (URL d'objet), jamais sur le
//    disque. Elle est posée PAR-DESSUS l'emoji ou l'initiale (avatarHtml) : si elle ne charge pas, l'emoji reste.
//  - Signaler une photo la masque aussitôt sur cet appareil (PPH_HIDDEN_KEY), avant toute décision du serveur.
//  - Serveur pas à jour (PGRST202) ou photos éteintes (app_config.profile_photos_on) : rien ne s'affiche, aucune
//    lecture des photos des autres. Déconnexion : tout est oublié (URL d'objet révoquées).
// ═══════════════════════════════════════════════════════════
'use strict';

const PPH_BUCKET     = 'profile-photos';
const PPH_PX         = 512;                       // côté de l'image envoyée
const PPH_TARGET     = 64 * 1024;                 // taille visée (vers 60 ko)
const PPH_MAX_BYTES  = 256 * 1024;                // limite du compartiment
const PPH_QUALITIES  = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42];
const PPH_URL_TTL_S  = 1800;                      // URL signée : 30 min, lue aussitôt
const PPH_LIST_MS    = 10 * 60_000;               // qui a une photo : relu après 10 min
const PPH_RETRY_MS   = 10 * 60_000;               // serveur sans la fonction : nouvel essai après 10 min
const PPH_BATCH      = 200;                       // comptes par appel de profile_photos (borne du serveur)
const PPH_HIDDEN_KEY = 'mdlf_pph_hidden';         // photos signalées depuis cet appareil (identifiants)
const PPH_HIDDEN_MAX = 200;
const PPH_ID_RE      = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// state : profile_photo_state nettoyé ; people : uid → { id, path, at } ou { id: null, at } ; urls : id → URL d'objet
const pph = { userId: null, state: null, loading: false, missing: false, triedAt: 0, busy: false,
  people: new Map(), urls: new Map(), fetching: new Set(), queue: new Set(), flushing: false, timer: null };
let pphSeq = 0;
const pphListeners = [];
function onProfilePhotoChange(fn) { pphListeners.push(fn); }
function notifyProfilePhoto() { for (const fn of pphListeners) { try { fn(); } catch { /* écran absent */ } } }

// ── Logique pure ────────────────────────────────────────────

// Carré central d'une image w × h : { sx, sy, side } (au moins 1 px)
function pphCropRect(w, h) {
  const W = Math.max(1, Math.round(w) || 1), H = Math.max(1, Math.round(h) || 1);
  const side = Math.min(W, H);
  return { sx: Math.floor((W - side) / 2), sy: Math.floor((H - side) / 2), side };
}
// Côté de l'image envoyée : PPH_PX, jamais agrandie
function pphOutSide(side) { return Math.max(1, Math.min(PPH_PX, Math.round(side) || 1)); }
// Image retenue parmi les essais [{ size, type }] (dans l'ordre des qualités) : la première sous PPH_TARGET, sinon
// la plus petite sous PPH_MAX_BYTES, sinon null (trop lourde)
function pphPickEncoding(tries) {
  const ok = (tries || []).filter(t => t && t.size > 0 && t.size <= PPH_MAX_BYTES && ['image/jpeg', 'image/webp'].includes(t.type));
  return ok.find(t => t.size <= PPH_TARGET) || ok.sort((a, b) => a.size - b.size)[0] || null;
}
const pphPath = (uid, id) => `${uid}/${id}`;
const pphValid = (uid, id, path) => PPH_ID_RE.test(uid || '') && PPH_ID_RE.test(id || '') && path === pphPath(uid, id);

// profile_photo_state() nettoyé : { enabled, allowed, banned, photo: { id, path, hidden } | null }, ou null
function cleanPphState(raw, me) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!r) return null;
  const p = r.photo && typeof r.photo === 'object' && pphValid(me, r.photo.id, r.photo.path)
    ? { id: r.photo.id, path: r.photo.path, hidden: r.photo.hidden === true } : null;
  return { enabled: r.enabled === true, allowed: r.allowed === true, banned: r.banned === true, photo: p };
}
// profile_photos(uids) nettoyé : [{ user_id, id, path }] dont le chemin est bien « compte/photo »
function cleanPphList(raw) {
  return (Array.isArray(raw) ? raw : []).filter(x => x && pphValid(x.user_id, x.id, x.path))
    .map(x => ({ user_id: x.user_id, id: x.id, path: x.path }));
}

// ── Photos signalées depuis cet appareil ────────────────────
function pphHiddenIds() {
  try { const v = JSON.parse(localStorage.getItem(PPH_HIDDEN_KEY)); return Array.isArray(v) ? v.filter(x => PPH_ID_RE.test(x)) : []; }
  catch { return []; }
}
function pphHideLocally(id) {
  if (!PPH_ID_RE.test(id || '')) return;
  const list = [id, ...pphHiddenIds().filter(x => x !== id)].slice(0, PPH_HIDDEN_MAX);
  try { localStorage.setItem(PPH_HIDDEN_KEY, JSON.stringify(list)); } catch { /* facultatif : masquée pour ce lancement */ }
  pphHiddenNow.add(id);
}
const pphHiddenNow = new Set();
const pphIsHidden = id => pphHiddenNow.has(id) || pphHiddenIds().includes(id);

// ── État ────────────────────────────────────────────────────

// Photos de profil en service pour ce compte (serveur à jour et interrupteur allumé)
function profilePhotoOn() { return !!(account.user && pph.state?.enabled && !pph.missing); }
// Ma photo (serveur), ou null
function myProfilePhoto() { return profilePhotoOn() ? pph.state.photo : null; }

// Photo montrée pour ce compte : URL d'objet déjà lue, sinon null (et la lecture est lancée). Jamais la photo d'un
// compte que le serveur ne m'a pas donnée, ni une photo signalée depuis cet appareil.
function profilePhotoUrl(uid) {
  if (!profilePhotoOn() || !PPH_ID_RE.test(uid || '')) return null;
  const e = pph.people.get(uid);
  if (!e || (uid !== account.user.id && Date.now() - e.at > PPH_LIST_MS)) pphAsk(uid);
  if (!e?.id || pphIsHidden(e.id)) return null;
  const url = pph.urls.get(e.id);
  if (!url) pphFetch(uid, e);
  return url || null;
}
// Identifiant de la photo montrée pour ce compte (signalement), ou null
function profilePhotoIdOf(uid) {
  const e = profilePhotoOn() ? pph.people.get(uid) : null;
  return e?.id && !pphIsHidden(e.id) && pph.urls.has(e.id) ? e.id : null;
}

// ── Appels au serveur ───────────────────────────────────────

function pphErrorKind(error) {
  if (!error) return null;
  if ((typeof isNetworkError === 'function' && isNetworkError(error)) || /fetch|network|load failed/i.test(String(error.message || ''))) return 'offline';
  const msg = String(error.message || error.error || '');
  for (const k of ['disabled', 'not_allowed', 'banned', 'rate_limited', 'not_found', 'not_uploaded']) if (msg.includes(k)) return k;
  if (error.code === 'PGRST202' || /could not find the function/i.test(msg)) return 'missing';
  return 'server';
}
async function pphRpc(fn, args) {
  if (!sb || !account.user) return { ok: false, kind: 'signed_out' };
  const seq = pphSeq;
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (seq !== pphSeq) return { ok: false, kind: 'signed_out' };
    return error ? { ok: false, kind: pphErrorKind(error) } : { ok: true, data };
  } catch (e) { return { ok: false, kind: pphErrorKind(e) || 'server' }; }
}

// Relit ma photo et l'interrupteur. Serveur sans la fonction : rien, nouvel essai après 10 min.
async function profilePhotoRefresh({ now = Date.now() } = {}) {
  if (!sb || !account.user || pph.loading) return false;
  if (pph.missing && now - pph.triedAt < PPH_RETRY_MS) return false;
  pph.loading = true;
  pph.triedAt = now;
  const me = account.user.id;
  const r = await pphRpc('profile_photo_state');
  pph.loading = false;
  if (!r.ok) {
    if (r.kind === 'missing') { pph.missing = true; notifyProfilePhoto(); }
    return false;
  }
  const was = profilePhotoOn();
  pph.missing = false;
  pph.state = cleanPphState(r.data, me);
  if (pph.state) pph.people.set(me, pph.state.photo ? { id: pph.state.photo.id, path: pph.state.photo.path, at: Date.now() } : { id: null, at: Date.now() });
  notifyProfilePhoto();
  if (!was && profilePhotoOn()) pphPaintAll();   // avatars déjà affichés : leur photo est cherchée maintenant
  else pphPaint(me);
  return true;
}

// Comptes à interroger, regroupés en un appel au tour suivant de la boucle (un écran demande tous ses avatars)
function pphAsk(uid) {
  pph.queue.add(uid);
  if (!pph.timer) pph.timer = setTimeout(pphFlush, 0);
}
async function pphFlush() {
  pph.timer = null;
  if (pph.flushing || !profilePhotoOn()) return;
  pph.flushing = true;
  const seq = pphSeq;
  try {
    while (pph.queue.size) {
      const uids = [...pph.queue].slice(0, PPH_BATCH);
      uids.forEach(u => pph.queue.delete(u));
      const r = await pphRpc('profile_photos', { uids });
      if (seq !== pphSeq) return;
      if (!r.ok) { if (r.kind === 'missing') pph.missing = true; return; }   // hors ligne : redemandé au prochain affichage
      const found = new Map(cleanPphList(r.data).map(x => [x.user_id, x]));
      const at = Date.now();
      for (const u of uids) {
        const x = found.get(u), before = pph.people.get(u);
        const e = x ? { id: x.id, path: x.path, at } : { id: null, at };
        pph.people.set(u, e);
        if (before?.id && before.id !== x?.id) pphForget(before.id);
        if (x && !pph.urls.has(x.id) && !pphIsHidden(x.id)) pphFetch(u, e);
        else pphPaint(u);
      }
    }
    notifyProfilePhoto();
  } finally { pph.flushing = false; }
}
// Image d'une photo : URL signée lue aussitôt, gardée en mémoire. Échec : rien (l'emoji reste).
async function pphFetch(uid, e) {
  if (!e?.id || pph.fetching.has(e.id) || !sb) return;
  pph.fetching.add(e.id);
  const seq = pphSeq;
  try {
    const { data, error } = await sb.storage.from(PPH_BUCKET).createSignedUrl(e.path, PPH_URL_TTL_S);
    if (error || !data?.signedUrl || seq !== pphSeq) return;
    const res = await fetch(data.signedUrl, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok || seq !== pphSeq) return;
    const blob = await res.blob();
    if (!blob.size || blob.size > PPH_MAX_BYTES || seq !== pphSeq) return;
    const typed = ['image/jpeg', 'image/webp'].includes(blob.type) ? blob : new Blob([blob], { type: 'image/jpeg' });
    pph.urls.set(e.id, URL.createObjectURL(typed));
    pphPaint(uid);
    notifyProfilePhoto();
  } catch { /* hors ligne : redemandée au prochain affichage */ }
  finally { pph.fetching.delete(e.id); }
}
function pphForget(id) {
  const u = pph.urls.get(id);
  if (u) { URL.revokeObjectURL(u); pph.urls.delete(id); }
}

// ── Affichage : la photo posée sur les avatars déjà à l'écran (sans redessiner l'écran) ──
function pphPaint(uid) {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  const url = profilePhotoUrlKnown(uid);
  document.querySelectorAll(`[data-pph="${uid}"]`).forEach(el => {
    const img = el.querySelector('.avatar__photo');
    if (!url) { img?.remove(); el.classList.remove('avatar--photo'); return; }
    if (img?.getAttribute('src') === url) return;
    if (img) img.src = url;
    else el.insertAdjacentHTML('beforeend', pphImgHtml(url));
    el.classList.add('avatar--photo');
  });
}
function pphPaintAll() {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
  const uids = new Set([...document.querySelectorAll('[data-pph]')].map(el => el.dataset.pph));
  uids.forEach(u => { if (profilePhotoUrl(u)) pphPaint(u); });
}
// URL déjà lue (sans rien lancer)
function profilePhotoUrlKnown(uid) {
  const e = profilePhotoOn() ? pph.people.get(uid) : null;
  return e?.id && !pphIsHidden(e.id) ? pph.urls.get(e.id) || null : null;
}
function pphImgHtml(url) { return `<img class="avatar__photo" src="${esc(url)}" alt="" draggable="false">`; }
// Image qui ne se décode pas : retirée, l'emoji ou l'initiale dessous reste visible
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('error', ev => {
    const t = ev.target;
    if (!t?.classList?.contains('avatar__photo')) return;
    t.closest('.avatar')?.classList.remove('avatar--photo');
    t.remove();
  }, true);
}

// ── Image envoyée ───────────────────────────────────────────

// Fichier choisi (caméra ou photothèque) → { blob, type, side } : carré central, 512 px au plus, ~60 ko
async function profilePhotoEncode(file) {
  const img = await loadImageFrom(file);
  const { sx, sy, side } = pphCropRect(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const out = pphOutSide(side);
  const canvas = document.createElement('canvas');
  canvas.width = out; canvas.height = out;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // Fond blanc sous une image transparente (PNG, autocollant) : la photo reste opaque, l'emoji ne transparaît pas dessous
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  const tries = [];
  // WebP d'abord ; un navigateur qui ne sait pas l'encoder rend du PNG (WebKit) : JPEG alors
  for (const type of ['image/webp', 'image/jpeg']) {
    for (const q of PPH_QUALITIES) {
      const blob = await canvasToBlob(canvas, type, q);
      if (blob.type !== type) break;
      tries.push({ blob, size: blob.size, type });
      if (blob.size <= PPH_TARGET) break;
    }
    const pick = pphPickEncoding(tries);
    if (pick && pick.size <= PPH_TARGET) return { blob: pick.blob, type: pick.type, side: out };
  }
  const pick = pphPickEncoding(tries);
  if (!pick) throw new Error('too_big');
  return { blob: pick.blob, type: pick.type, side: out };
}

// Envoi d'une image déjà préparée ({ blob, type }) : préparation, fichier, validation. → { ok } ou { ok: false, kind }
async function profilePhotoUpload(enc) {
  if (pph.busy) return { ok: false, kind: 'busy' };
  const me = account.user?.id;
  if (!sb || !me) return { ok: false, kind: 'signed_out' };
  pph.busy = true;
  const seq = pphSeq;
  try {
    const p = await pphRpc('profile_photo_prepare');
    if (!p.ok) return p;
    const id = p.data?.id, path = p.data?.path;
    if (!pphValid(me, id, path)) return { ok: false, kind: 'server' };
    const up = await sb.storage.from(PPH_BUCKET).upload(path, enc.blob, { contentType: enc.type, upsert: false, cacheControl: '3600' });
    if (seq !== pphSeq) return { ok: false, kind: 'signed_out' };
    if (up.error) return { ok: false, kind: pphErrorKind(up.error) === 'offline' ? 'offline' : 'server' };
    const c = await pphRpc('profile_photo_commit', { photo: id });
    if (!c.ok) return c;
    const old = pph.people.get(me)?.id;
    if (old && old !== id) pphForget(old);
    pph.urls.set(id, URL.createObjectURL(enc.blob));   // l'image envoyée, sans la relire
    pph.state = { ...(pph.state || { enabled: true, allowed: true, banned: false }), photo: { id, path, hidden: false } };
    pph.people.set(me, { id, path, at: Date.now() });
    notifyProfilePhoto();
    pphPaint(me);
    return { ok: true };
  } finally { pph.busy = false; }
}

// Retour à l'emoji : la photo est effacée du serveur (la purge efface le fichier ; il est aussi retiré tout de suite
// par l'API Storage, au mieux). → { ok } ou { ok: false, kind }
async function profilePhotoRemove() {
  const me = account.user?.id;
  if (!sb || !me) return { ok: false, kind: 'signed_out' };
  const cur = pph.state?.photo;
  const r = await pphRpc('profile_photo_remove');
  if (!r.ok) return r;
  if (cur) {
    try { await sb.storage.from(PPH_BUCKET).remove([cur.path]); } catch { /* la purge s'en charge */ }
    pphForget(cur.id);
  }
  if (pph.state) pph.state = { ...pph.state, photo: null };
  pph.people.set(me, { id: null, at: Date.now() });
  notifyProfilePhoto();
  pphPaint(me);
  return { ok: true };
}

// Photo d'un autre signalée depuis cet appareil : masquée tout de suite ici
function profilePhotoHide(uid, id) {
  pphHideLocally(id);
  pphPaint(uid);
}

function pphReset(userId) {
  pphSeq++;
  for (const u of pph.urls.values()) URL.revokeObjectURL(u);
  if (pph.timer) clearTimeout(pph.timer);
  Object.assign(pph, { userId, state: null, loading: false, missing: false, triedAt: 0, busy: false, flushing: false, timer: null });
  pph.people.clear(); pph.urls.clear(); pph.fetching.clear(); pph.queue.clear();
}
if (typeof onAccountChange === 'function') {
  onAccountChange(() => {
    const id = account.user?.id || null;
    if (id === pph.userId) return;
    pphReset(id);
    if (id) profilePhotoRefresh();
  });
}
