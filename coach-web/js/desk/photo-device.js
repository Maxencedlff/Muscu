// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : photos de bilan, côté navigateur (docs/PHOTOS_WEB.md). Sans DOM.
//
//  - Relier cet ordinateur : paire éphémère D (privée non extractible), secret du QR, appairage sur le serveur, QR
//    affiché, relecture toutes les 1,5 s ; à l'offre du téléphone, code de vérification ; à la fin, l'enveloppe est
//    rouverte une fois (preuve que tout va bien) et SEULE la clé d'enveloppe, non extractible, est gardée dans
//    IndexedDB (base « mdlf-coach-web », une entrée par compte). D et le secret sont oubliés.
//  - Ouvrir les photos : l'enveloppe est relue sur le serveur à chaque ouverture (retirer l'ordinateur suffit donc à
//    couper l'accès), revérifiée contre la clé du coach retenue à l'appairage, rouverte en clé privée non extractible,
//    gardée en mémoire seulement. Refermées : onglet caché, 5 minutes sans geste, onglet Bilans quitté, déconnexion.
//  - Images : déchiffrées par cphFetchWith (js/data/coach-photos.js, partagé avec l'app), adresses blob: en mémoire,
//    libérées à la fermeture ; jamais écrites ailleurs (pas de service worker, chiffré lu sans cache).
//  - Page embarquée dans l'app iPad (MDLF_COACH_HOST.photos, docs/COACH_IPAD.md) : l'app déchiffre, la page ne voit que
//    des adresses blob: ; pas d'appairage.
//  - Scripts de connexion tiers (Apple, Google) chargés dans cette page : avant toute action sur les photos, la page se
//    recharge sans eux (session gardée), et reprend l'action demandée.
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_PH_DB = 'mdlf-coach-web';
const DESK_PH_STORE = 'link';
const DESK_PH_IDLE_MS = 5 * 60_000;
const DESK_PH_MAX_MS = 15 * 60_000;                // durée maximale d'une ouverture, même avec des gestes
const DESK_PH_RESUME = 'mdlf_coach_web_resume';   // sessionStorage : action reprise après le rechargement

// entry : undefined (pas lue), null (pas relié), { coach, device, wrapKey, keyId, coachPub, label, linkedAt } ;
// session : { priv, pub, keyId } en mémoire ; pair : appairage en cours ; students : { [uid]: { photos, error } } ;
// urls : Map id → adresse blob: ; mem : entrée gardée en mémoire si IndexedDB refuse (navigation privée)
const ph = { entry: undefined, session: null, pair: null, students: {}, urls: new Map(), mem: null, epoch: 0, opening: false, error: null, onChange: () => {} };
let deskPhTimer = 0, deskPhPollTimer = 0, deskThirdParty = false;

// ── Page embarquée (iPad) ───────────────────────────────────

function deskPhHost() {
  try {
    const p = window.MDLF_COACH_HOST?.photos;
    return p && ['unlock', 'list', 'open', 'release'].every(k => typeof p[k] === 'function') ? p : null;
  } catch { return null; }
}

// ── IndexedDB (une entrée par compte, la clé d'enveloppe non extractible) ──

function deskPhDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { reject(new Error('indexedDB')); return; }
    const rq = indexedDB.open(DESK_PH_DB, 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore(DESK_PH_STORE, { keyPath: 'coach' }); };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
async function deskPhTx(mode, op) {
  const db = await deskPhDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DESK_PH_STORE, mode), rq = op(tx.objectStore(DESK_PH_STORE));
      tx.oncomplete = () => resolve(rq?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const deskPhValid = e => !!(e && typeof e === 'object' && PLINK_UUID_RE.test(e.coach || '') && PLINK_UUID_RE.test(e.device || '')
  && e.wrapKey && typeof e.wrapKey === 'object' && e.wrapKey.extractable === false && /^[0-9a-f]{32}$/.test(e.keyId || '') && PLINK_PUB_RE.test(e.coachPub || ''));

async function deskPhEntry() {
  const me = desk.user?.id;
  if (!me) return null;
  if (ph.entry !== undefined && (ph.entry === null || ph.entry.coach === me)) return ph.entry;
  let e = null;
  try { e = await deskPhTx('readonly', s => s.get(me)); } catch { e = ph.mem; }
  ph.entry = deskPhValid(e) && e.coach === me ? e : (ph.mem?.coach === me ? ph.mem : null);
  return ph.entry;
}
async function deskPhSave(e) {
  try { await deskPhTx('readwrite', s => s.put(e)); ph.mem = null; return true; }
  catch { ph.mem = e; return false; }   // navigateur qui refuse IndexedDB : relié jusqu'à la fermeture de l'onglet
}
async function deskPhDrop(coach) {
  ph.mem = null;
  try { await deskPhTx('readwrite', s => s.delete(coach)); } catch { /* rien à effacer */ }
}

// ── Session des photos ──────────────────────────────────────

function deskPhNotify() { try { ph.onChange(); } catch { /* écran absent */ } }
function deskPhTouch(now = Date.now()) {
  if (!ph.session) return;
  if (now - (ph.session.openedAt || now) > DESK_PH_MAX_MS) { deskPhLock('max'); return; }
  clearTimeout(deskPhTimer);
  deskPhTimer = setTimeout(() => deskPhLock('idle'), DESK_PH_IDLE_MS);
}
// Durée maximale d'une ouverture, même sans geste (le minuteur de 5 minutes ne part qu'au geste)
let deskPhMaxTimer = 0;
function deskPhArm() { clearTimeout(deskPhMaxTimer); deskPhMaxTimer = setTimeout(() => deskPhLock('max'), DESK_PH_MAX_MS); }
// Referme : clé privée oubliée, images libérées
function deskPhLock(reason = 'manual') {
  ph.epoch++;
  clearTimeout(deskPhTimer);
  clearTimeout(deskPhMaxTimer);
  const was = !!ph.session || ph.urls.size > 0;
  ph.session = null;
  ph.students = {};
  const host = deskPhHost();
  ph.urls.forEach(u => { try { host ? host.release(u) : URL.revokeObjectURL(u); } catch { /* déjà libérée */ } });
  ph.urls.clear();
  if (host) { try { host.lock?.(); } catch { /* hôte parti */ } }
  ph.lockReason = reason;
  if (was) deskPhNotify();
  return was;
}

// Ouvre les photos sur cet ordinateur. → { ok } ou { ok: false, kind } : unlinked (pas relié), revoked (retiré depuis
// l'iPhone, expiré), key_changed (clé des photos changée sur l'iPhone), broken (enveloppe qui ne s'ouvre pas), et les
// erreurs du serveur (disabled, offline…). Les trois premiers effacent l'entrée de cet ordinateur.
async function deskPhOpen() {
  if (ph.session) { deskPhTouch(); return { ok: true }; }
  const host = deskPhHost();
  if (host) {
    try { const r = await host.unlock(); if (!r?.ok) return { ok: false, kind: r?.refused ? 'canceled' : 'host' }; } catch { return { ok: false, kind: 'host' }; }
    ph.session = { host: true, openedAt: Date.now() };
    deskPhArm(); deskPhTouch(); deskPhNotify();
    return { ok: true };
  }
  const me = desk.user?.id, e = await deskPhEntry();
  if (!me || !e) return { ok: false, kind: 'unlinked' };
  const epoch = ph.epoch;
  const [d, k] = await Promise.all([deskRpc('coach_photo_device_key', { device: e.device }), deskRpc('coach_photo_key')]);
  if (epoch !== ph.epoch) return { ok: false, kind: 'stale' };
  if (!d.ok) { if (d.kind === 'not_found') { await deskPhForget({ server: false }); return { ok: false, kind: 'revoked' }; } return d; }
  if (!k.ok) return k;
  const dev = cleanPlinkDevice(d.data), key = cleanCphKey(k.data);
  // Clé du serveur autre que celle de l'appairage (nouvelle clé sur l'iPhone, ou serveur qui en glisse une autre) :
  // jamais d'ouverture avec elle ; l'ordinateur est à relier de nouveau
  if (!dev || dev.id !== e.device || dev.keyId !== e.keyId || !key || key.key_id !== e.keyId || key.public_key !== e.coachPub) {
    await deskPhForget({ server: true });
    return { ok: false, kind: 'key_changed' };
  }
  const priv = await plinkUnwrap(e.wrapKey, dev, { device: e.device, coach: me, keyId: e.keyId, coachPub: e.coachPub });
  if (epoch !== ph.epoch) return { ok: false, kind: 'stale' };
  if (!priv) { await deskPhForget({ server: true }); return { ok: false, kind: 'broken' }; }
  ph.session = { priv, pub: e.coachPub, keyId: e.keyId, device: e.device, openedAt: Date.now() };
  deskPhArm(); deskPhTouch(); deskPhNotify();
  return { ok: true };
}

// Oublier cet ordinateur : retiré du serveur (server: true), entrée effacée, photos refermées
async function deskPhForget({ server = true } = {}) {
  const e = ph.entry || ph.mem;
  deskPhLock('forget');
  deskPhPairStop();
  ph.entry = null;
  if (e) {
    if (server) await deskRpc('coach_photo_device_revoke', { device: e.device });
    await deskPhDrop(e.coach);
  }
  deskPhNotify();
}

// ── Photos d'un élève ───────────────────────────────────────

async function deskPhLoad(uid) {
  if (!ph.session) return { ok: false, kind: 'locked' };
  const epoch = ph.epoch, host = deskPhHost();
  let photos;
  if (host) {
    try {
      const r = await host.list(uid);
      if (!r?.ok) return { ok: false, kind: 'host' };
      photos = (Array.isArray(r.photos) ? r.photos : []).filter(p => p && CPH_ID_RE.test(p.id || '') && CPH_DAY_RE.test(p.takenOn || '') && PHOTO_POSE_KEYS.includes(p.pose))
        .map(p => ({ id: p.id, takenOn: p.takenOn, pose: p.pose }));
    } catch { return { ok: false, kind: 'host' }; }
  } else {
    // Ordinateur retiré depuis l'iPhone pendant que les photos sont ouvertes : coupé dès l'élève suivant (l'enveloppe est
    // relue, pas seulement à l'ouverture)
    const still = await deskRpc('coach_photo_device_key', { device: ph.session.device });
    if (epoch !== ph.epoch) return { ok: false, kind: 'stale' };
    if (!still.ok) {
      if (still.kind === 'not_found') { await deskPhForget({ server: false }); ph.error = 'revoked'; deskPhNotify(); return { ok: false, kind: 'revoked' }; }
      // Toute autre réponse (limite, hors ligne, serveur) : rien de chargé, photos refermées
      deskPhLock('server'); ph.error = still.kind; deskPhNotify(); return still;
    }
    const r = await deskRpc('coach_student_photos', { student: uid });
    if (!r.ok) { if (epoch === ph.epoch) { ph.students[uid] = { photos: [], error: r.kind }; deskPhNotify(); } return r; }
    photos = cleanCoachPhotos(r.data, uid).filter(p => p.keyId === ph.session?.keyId);
  }
  if (epoch !== ph.epoch) return { ok: false, kind: 'stale' };
  ph.students[uid] = { photos, error: null };
  deskPhNotify();
  return { ok: true };
}
// Image déchiffrée d'une photo (adresse blob:), chargée une fois ; null si illisible
async function deskPhImage(uid, p) {
  if (ph.urls.has(p.id)) return ph.urls.get(p.id);
  const session = ph.session, epoch = ph.epoch;
  if (!session) return null;
  let url = null;
  const host = deskPhHost();
  if (host) { try { url = await host.open(uid, p.id); } catch { url = null; } if (typeof url !== 'string' || !url.startsWith('blob:')) url = null; }
  else {
    const blob = await cphFetchWith({ client: deskClient(), session, me: desk.user?.id, uid, p, alive: () => ph.session === session });
    url = blob ? URL.createObjectURL(blob) : null;
  }
  if (!url) return null;
  if (epoch !== ph.epoch || ph.session !== session) { try { host ? host.release(url) : URL.revokeObjectURL(url); } catch { /* rien */ } return null; }
  ph.urls.set(p.id, url);
  deskPhNotify();
  return url;
}

// ── Relier cet ordinateur ───────────────────────────────────

// state : 'waiting' (QR affiché), 'offered' (code de vérification), 'done', 'expired', 'error' (kind)
async function deskPhPairStart() {
  deskPhPairStop();
  const me = desk.user?.id;
  if (!me) return { ok: false, kind: 'signed_out' };
  let d, pub, secret;
  try {
    d = await crypto.subtle.generateKey(PLINK_P256, false, ['deriveBits']);
    pub = bytesToB64(new Uint8Array(await crypto.subtle.exportKey('raw', d.publicKey)));
    secret = crypto.getRandomValues(new Uint8Array(16));
  } catch { return { ok: false, kind: 'crypto' }; }
  const r = await deskRpc('coach_photo_pair_start', { device_pub: pub, verifier: await plinkVerifier(secret), label: plinkLabel(navigator.userAgent) });
  if (!r.ok) return r;
  const id = r.data?.pair;
  if (!PLINK_UUID_RE.test(id || '')) return { ok: false, kind: 'server' };
  const qr = plinkQrText({ pair: id, coach: me, pub, secret });
  if (!qr) return { ok: false, kind: 'server' };
  ph.pair = { id, coach: me, priv: d.privateKey, pub, secret, qr, state: 'waiting', sas: '', epk: null, wrapKey: null, kind: null,
    // Horloge de l'ordinateur (jamais celle du serveur, qui peut différer) : 5 s de marge sous les 2 minutes
    expiresAt: Date.now() + PLINK_TTL_MS - 5_000 };
  deskPhPollTimer = setInterval(() => { deskPhPairPoll(); }, PLINK_POLL_MS);
  deskPhNotify();
  return { ok: true };
}
function deskPhPairWipe(p) {
  if (!p) return;
  p.secret?.fill(0);
  p.priv = null; p.secret = null; p.wrapKey = null;
}
// Fenêtre fermée ou appairage fini : relecture arrêtée, secrets oubliés ; abandon dit au serveur s'il n'est pas fini
function deskPhPairStop({ cancel = true } = {}) {
  clearInterval(deskPhPollTimer);
  const p = ph.pair;
  ph.pair = null;
  if (!p) return;
  if (cancel && p.state !== 'done') deskRpc('coach_photo_pair_cancel', { pair: p.id });
  deskPhPairWipe(p);
}
function deskPhPairFail(p, state, kind = null) {
  clearInterval(deskPhPollTimer);
  p.state = state; p.kind = kind;
  if (state !== 'done') deskRpc('coach_photo_pair_cancel', { pair: p.id });
  deskPhPairWipe(p);
  deskPhNotify();
}
let deskPhPolling = false;
async function deskPhPairPoll(now = Date.now()) {
  const p = ph.pair;
  if (!p || deskPhPolling || !['waiting', 'offered'].includes(p.state)) return;
  if (now > p.expiresAt) { deskPhPairFail(p, 'expired'); return; }
  deskPhPolling = true;
  try {
    const r = await deskRpc('coach_photo_pair_status', { pair: p.id });
    if (ph.pair !== p || !['waiting', 'offered'].includes(p.state)) return;
    // Expiré ou annulé : fini. Refus du serveur (limite, session, rôle, photos éteintes) : arrêté et dit, jamais une relecture
    // muette ; hors ligne ou serveur lent : on relit au tour suivant
    if (!r.ok) {
      if (r.kind === 'not_found') deskPhPairFail(p, 'expired');
      else if (!['offline', 'server'].includes(r.kind)) deskPhPairFail(p, 'error', r.kind);
      return;
    }
    const st = cleanPlinkStatus(r.data);
    if (!st) { deskPhPairFail(p, 'error', 'server'); return; }
    if (st.state === 'waiting') return;
    // La clé du téléphone ne change jamais après l'offre : un serveur qui la remplacerait est arrêté net
    if (p.epk && st.epk !== p.epk) { deskPhPairFail(p, 'error', 'tampered'); return; }
    if (!p.epk) {
      const got = await plinkDerive(p.priv, st.epk, { pair: p.id, coach: p.coach, devicePub: p.pub, epk: st.epk, secret: p.secret }, 'unwrapKey');
      if (ph.pair !== p) return;
      Object.assign(p, { epk: st.epk, wrapKey: got.wrapKey, sas: got.sas, state: 'offered' });
      p.priv = null;   // D ne sert plus
      deskPhNotify();
    }
    if (st.state === 'done') await deskPhPairFinish(p, st.device);
  } catch { if (ph.pair === p) deskPhPairFail(p, 'error', 'server'); }
  finally { deskPhPolling = false; }
}
async function deskPhPairFinish(p, device) {
  clearInterval(deskPhPollTimer);
  const me = desk.user?.id;
  if (device !== p.id || me !== p.coach) { deskPhPairFail(p, 'error', 'tampered'); return; }
  const [d, k] = await Promise.all([deskRpc('coach_photo_device_key', { device }), deskRpc('coach_photo_key')]);
  if (ph.pair !== p) return;
  const dev = d.ok ? cleanPlinkDevice(d.data) : null, key = k.ok ? cleanCphKey(k.data) : null;
  if (!dev || !key || dev.id !== device || dev.keyId !== key.key_id) { deskPhPairFail(p, 'error', d.ok && k.ok ? 'tampered' : (d.kind || k.kind || 'server')); return; }
  // Données liées : la clé publique est celle que le téléphone a vérifiée avec sa clé privée. Un serveur qui servirait
  // une autre clé ici ferait échouer l'ouverture.
  const priv = await plinkUnwrap(p.wrapKey, dev, { device, coach: me, keyId: dev.keyId, coachPub: key.public_key });
  if (ph.pair !== p) return;
  if (!priv || !(await plinkKeyMatches(priv, key.public_key))) { deskRpc('coach_photo_device_revoke', { device }); deskPhPairFail(p, 'error', 'tampered'); return; }
  if (ph.pair !== p) return;
  const entry = { coach: me, device, wrapKey: p.wrapKey, keyId: dev.keyId, coachPub: key.public_key, label: plinkLabel(navigator.userAgent), linkedAt: Date.now() };
  p.persisted = await deskPhSave(entry);
  ph.entry = entry;
  deskPhLock('relink');
  ph.session = { priv, pub: key.public_key, keyId: dev.keyId, device, openedAt: Date.now() };
  deskPhArm(); deskPhTouch();
  p.state = 'done';
  deskPhPairWipe(p);
  deskPhNotify();
}

// ── Scripts de connexion tiers : page rechargée avant les photos ──

function deskPhMarkThirdParty() { deskThirdParty = true; }
// Vrai si la page doit d'abord se recharger (l'action reprend ensuite, deskPhResumeTake)
function deskPhNeedsCleanPage(action) {
  if (!deskThirdParty || deskPhHost()) return false;
  // Sans sessionStorage (bloqué) : rechargée quand même, le coach refait son geste ; jamais de photos avec un script tiers
  try { sessionStorage.setItem(DESK_PH_RESUME, JSON.stringify({ action, hash: location.hash, at: Date.now() })); } catch { /* pas de reprise */ }
  location.reload();
  return true;
}
function deskPhResumeTake() {
  let v = null;
  try { v = JSON.parse(sessionStorage.getItem(DESK_PH_RESUME) || 'null'); sessionStorage.removeItem(DESK_PH_RESUME); } catch { return null; }
  return v && typeof v.action === 'string' && Date.now() - v.at < 60_000 && v.hash === location.hash ? v.action : null;
}

const DESK_PH_ERRORS = {
  revoked: 'Cet ordinateur n\'est plus relié (retiré depuis ton iPhone, ou 30 jours sans usage). Relie-le de nouveau pour voir les photos.',
  key_changed: 'Ta clé des photos a changé sur ton iPhone : relie de nouveau cet ordinateur.',
  broken: 'La clé de cet ordinateur ne s\'ouvre plus : relie-le de nouveau.',
  tampered: 'La réponse ne correspond pas au code ni à ta clé : rien n\'a été gardé. Recommence avec un nouveau code.',
  max: 'Masquées après 15 minutes : affiche-les de nouveau.',
  rate_limited: 'Trop d\'essais en peu de temps : attends quelques minutes, puis réessaie.',
  no_key: 'Active d\'abord la réception des photos de bilan dans l\'app iPhone (Coach › Mes élèves).',
  too_many: 'Tu as déjà 5 ordinateurs reliés. Retires-en un dans l\'app : Coach › Mes élèves › Ordinateurs reliés.',
  disabled: 'Les photos de bilan sont suspendues pour l\'instant.',
  missing: 'Le serveur de MDLF n\'a pas encore reçu l\'ouverture des photos sur ordinateur. Elles restent dans l\'app iPhone.',
  crypto: 'Ce navigateur ne sait pas ouvrir les photos chiffrées. Prends une version récente de Chrome, Edge, Firefox ou Safari.',
  host: 'Les photos n\'ont pas pu s\'ouvrir dans l\'app.',
  canceled: 'Ouverture annulée.',
};
function deskPhErrorText(kind) { return DESK_PH_ERRORS[kind] || deskErrorText(kind); }
