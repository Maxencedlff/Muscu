// ═══════════════════════════════════════════════════════════
//  Affiche du coach (« Mon affiche de coach »), contenu sans dessin, et photo d'origine gardée sur l'appareil.
//  Dessin : js/features/coach-poster-art.js ; écrans : js/features/coach-poster-ui.js ; choix : docs/AFFICHE_COACH.md.
//
//  - Le contenu ne vient que du coach lui-même : son nom (saisi pour l'affiche), son pseudo, son code coach permanent,
//    son badge « Carte pro déclarée » et sa photo. Rien d'un élève : le modèle n'a aucun autre champ (test unitaire).
//  - Photo de l'affiche : l'image d'origine choisie par le coach, réduite à 2048 px au plus, gardée dans IndexedDB de
//    CET appareil seulement (jamais envoyée) ; plus nette que la photo de profil du serveur (512 px).
//  - Rien n'est envoyé : l'image est dessinée sur l'appareil et ne part que par la feuille de partage.
// ═══════════════════════════════════════════════════════════
'use strict';

const CPOSTER_NAME_MAX = 40;
const CPOSTER_SPECIALTY_MAX = CPOSTER_NAME_MAX;   // « Ta spécialité (facultatif) », sous le nom : 40 caractères (posterName)
const CPOSTER_PREFS_KEY = 'mdlf_coach_poster';   // { uid, name, specialty, silhouette, neutral } : cet appareil seulement
const CPOSTER_PHOTO_MAX = 2048;                   // côté le plus long de la photo d'origine gardée
const CPOSTER_DB = 'mdlf-coach-poster', CPOSTER_STORE = 'photo';

// Nom écrit par le coach : espaces resserrés, 40 caractères au plus (coupés sans casser un emoji)
const POSTER_INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
function posterName(raw) {
  // Caractères de contrôle remplacés par une espace ; caractères de mise en forme invisibles (espace sans chasse,
  // marques et isolats de sens d'écriture, BOM) retirés : ils pourraient retourner ou cacher le texte (audit du 21/11)
  const s = String(raw ?? '').replace(POSTER_INVISIBLE, '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, CPOSTER_NAME_MAX).join('').trim();
}

// Initiales (sans photo ni personnage chargé) : premières lettres des deux premiers mots (« Léa Martin » → « LM »),
// une seule pour un mot. Seuls les lettres et chiffres comptent ; rien de lisible : « ? »
function posterInitials(name) {
  const words = String(name ?? '').split(/[\s._\-']+/u)
    .map(w => Array.from(w).find(ch => /[\p{L}\p{N}]/u.test(ch)))
    .filter(Boolean);
  if (!words.length) return '?';
  return words.slice(0, 2).join('').toLocaleUpperCase('fr-FR');
}

// Contenu exact de l'affiche. name : nom saisi (vide : seul le @pseudo, sur sa ligne, l'aperçu propose « Ajoute ton
// prénom ») ;
// code : code coach permanent ; badge : carte pro déclarée et montrée ; hasPhoto : photo lisible ; silhouette :
// 'female' ou 'male', choisie dans l'écran de l'affiche (jamais déduite du prénom) : accord « NOUVELLE COACH » ou
// « NOUVEAU COACH » ; neutral : « COACH » seul, sans genre
function coachPosterModel({ name = '', specialty = '', username = '', code = '', badge = false, hasPhoto = false, silhouette = 'male', neutral = false } = {}) {
  const user = String(username ?? '').replace(/^@/, '').trim();
  const n = posterName(name);
  return {
    name: n,                                  // vide : pas de nom géant (jamais le @pseudo en capitales) ; partage bloqué
    specialty: posterName(specialty),
    handle: user ? `@${user}` : '',
    initials: n ? posterInitials(n) : '',     // jamais tirées du pseudo
    photo: hasPhoto === true,
    title: neutral === true ? 'COACH' : silhouette === 'female' ? 'NOUVELLE COACH' : 'NOUVEAU COACH',
    badge: badge === true ? COACH_BADGE_LABEL : null,
    ctaLine: 'Rejoins-moi sur MDLF Training',   // le coach d'abord, l'app ensuite (10e panel)
    ctaWhere: 'Entre mon code dans Social › Rejoindre un coach',
    code: formatCoachCode(String(code ?? '').toUpperCase()),
  };
}

// Texte lu par VoiceOver sur l'aperçu : ce que montre l'image (mise en page « hero » : ni pseudo ni badge dessus)
function coachPosterAlt(m) {
  const title = { 'NOUVELLE COACH': 'Nouvelle coach', 'NOUVEAU COACH': 'Nouveau coach' }[m.title] || 'Coach';
  return [`Affiche « ${title} »${m.name ? ` : ${m.name}` : ''}`, m.specialty, 'sur MDLF Training', `code ${m.code}`].filter(Boolean).join(', ');
}

// Nom du fichier partagé (sans le pseudo : le fichier peut être renvoyé ailleurs)
function coachPosterFileName(format) { return format === 'square' ? 'affiche-coach-carre.png' : 'affiche-coach.png'; }

// Réglages de l'affiche gardés sur l'appareil, pour ce compte seulement
function coachPosterPrefs(uid) {
  try {
    const p = JSON.parse(localStorage.getItem(CPOSTER_PREFS_KEY) || 'null');
    if (p && p.uid === uid) {
      return { name: posterName(p.name), specialty: posterName(p.specialty), silhouette: p.silhouette === 'female' ? 'female' : 'male', neutral: p.neutral === true };
    }
  } catch { /* stockage illisible : valeurs par défaut */ }
  return null;
}
function coachPosterSavePrefs(uid, { name, specialty, silhouette, neutral }) {
  try {
    localStorage.setItem(CPOSTER_PREFS_KEY, JSON.stringify({ uid, name: posterName(name), specialty: posterName(specialty), silhouette: silhouette === 'female' ? 'female' : 'male',
      neutral: neutral === true }));
  }
  catch { /* stockage plein : pas grave */ }
}

// Côtés réduits pour que le plus long fasse au plus `max` px (jamais agrandie)
function posterPhotoSize(w, h, max = CPOSTER_PHOTO_MAX) {
  const W = Math.max(1, Math.round(w) || 1), H = Math.max(1, Math.round(h) || 1), k = Math.min(1, max / Math.max(W, H));
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) };
}

// ── Photo d'origine (IndexedDB de l'appareil) ───────────────
function posterDb() {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return; }
    let req;
    try { req = indexedDB.open(CPOSTER_DB, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(CPOSTER_STORE)) req.result.createObjectStore(CPOSTER_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
// IndexedDB qui ne répond pas (WebKit bloqué) : abandon après 3 s, l'affiche s'ouvre sans la photo d'origine
const CPOSTER_DB_WAIT_MS = 3000;
async function posterDbDo(mode, op) {
  let late = false;
  const db = await Promise.race([posterDb().then(d => { if (late) d?.close(); return d; }),
    new Promise(r => setTimeout(() => { late = true; r(null); }, CPOSTER_DB_WAIT_MS))]);
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(CPOSTER_STORE, mode), r = op(tx.objectStore(CPOSTER_STORE));
      tx.oncomplete = () => { db.close(); resolve(r?.result ?? null); };
      tx.onerror = tx.onabort = () => { db.close(); resolve(null); };
    } catch { db.close(); resolve(null); }
  });
}
// Photo de l'affiche de ce compte (Blob JPEG), ou null. Gardée en ArrayBuffer : WebKit refuse parfois un Blob dans
// IndexedDB (contexte éphémère), un tableau d'octets passe partout.
async function posterPhotoLoad(uid) {
  const r = await posterDbDo('readonly', s => s.get(uid));
  return r && r.buf instanceof ArrayBuffer && r.buf.byteLength ? new Blob([r.buf], { type: r.type || 'image/jpeg' }) : null;
}
async function posterPhotoSave(uid, blob) {
  if (!uid || !blob) return;
  const buf = await blob.arrayBuffer();
  await posterDbDo('readwrite', s => s.put({ buf, type: blob.type || 'image/jpeg', at: Date.now() }, uid));
}
async function posterPhotoClear(uid) { if (uid) await posterDbDo('readwrite', s => s.delete(uid)); }
// Tout ce que l'affiche garde sur cet appareil (réglages, photo d'origine) : effacé à la déconnexion, à la suppression du
// compte et par « Supprimer toutes les données » (audit du 21/11, privacy.html « Sur ton appareil »)
async function coachPosterForgetDevice() {
  try { localStorage.removeItem(CPOSTER_PREFS_KEY); } catch { /* rien */ }
  if (typeof indexedDB === 'undefined' || !indexedDB) return;
  await new Promise(resolve => {
    try {
      const req = indexedDB.deleteDatabase(CPOSTER_DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch { resolve(); }
  });
}

// ── Nom de l'affiche montré aux élèves (Mon coach, 5e panel) ─
// L'élève reconnaît la coach de l'affiche : Mon coach montre ce nom, @pseudo dessous. Le nom part au serveur
// seulement quand le coach PARTAGE son affiche (geste explicite, dit sous les réglages) ; le serveur ne le montre
// qu'au coach et à ses élèves (coach_poster_name). Serveur d'avant (migration pas appliquée) : rien n'est montré,
// Mon coach garde le pseudo seul, aucun message.
const CPOSTER_NAME_TTL = 5 * 60_000;
const coachPosterNames = new Map();   // uid du coach → { name, at, loading }
// Serveur sans la migration du nom (supabase/migrations/20261120020000_nom_affiche_coach.sql, en attente) : la lecture
// n'est plus tentée de la session (aucun appel à chaque ouverture de Mon coach) ; l'envoi, lui, est retenté à chaque
// partage, et s'il passe (migration appliquée), la lecture reprend
let coachPosterServer = true;
const posterFnMissing = e => e?.code === 'PGRST202' || /could not find the function/i.test(String(e?.message || ''));
async function posterRpc(fn, args) {
  if (!sb || !account.user) return { ok: false, missing: false };
  const uid = account.user.id;
  try {
    const { data, error } = await sb.rpc(fn, args);
    if (account.user?.id !== uid) return { ok: false, missing: false };
    return error ? { ok: false, missing: posterFnMissing(error) } : { ok: true, data };
  } catch { return { ok: false, missing: false }; }   // hors ligne : rien dit, réessayé plus tard
}
async function coachPosterPublishName(name) {
  const n = posterName(name);
  if (!n || !account.user) return { ok: false };
  const me = account.user.id, r = await posterRpc('coach_set_poster_name', { name: n });
  if (r.ok) { coachPosterServer = true; coachPosterNames.set(me, { name: n, at: Date.now() }); }
  return r;   // échec (serveur d'avant, hors ligne) : ignoré en silence, retenté au prochain partage
}
// Nom montré pour ce coach ('' s'il n'en a pas, pas encore lu, ou serveur d'avant)
function coachPosterNameOf(uid) { return (uid && coachPosterNames.get(uid)?.name) || ''; }
// Lit le nom (gardé 5 min) ; onChange appelé s'il a changé
async function coachPosterNameLoad(uid, onChange) {
  if (!coachPosterServer || !sb || !account.user || typeof uid !== 'string' || !uid) return coachPosterNameOf(uid);
  const old = coachPosterNames.get(uid);
  if (old?.loading || (old && Date.now() - old.at < CPOSTER_NAME_TTL)) return old?.name || '';
  coachPosterNames.set(uid, { name: old?.name || '', at: old?.at || 0, loading: true });
  const r = await posterRpc('coach_poster_name', { coach: uid });
  if (!account.user) return '';
  if (r.missing) coachPosterServer = false;
  const name = r.ok && r.data && typeof r.data.name === 'string' ? posterName(r.data.name) : '';
  coachPosterNames.set(uid, { name: r.ok ? name : old?.name || '', at: r.ok || r.missing ? Date.now() : 0 });
  if ((old?.name || '') !== coachPosterNameOf(uid)) onChange?.();
  return coachPosterNameOf(uid);
}
onAccountChange(() => coachPosterNames.clear());
