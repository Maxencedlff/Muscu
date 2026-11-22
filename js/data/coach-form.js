// ═══════════════════════════════════════════════════════════
//  Accord du mot « coach » : « Mon coach » ou « Ma coach » (contrat : docs/COACH_FORME.md).
//
//  - La forme est choisie par le coach lui-même, une seule fois, dans Réglages › Coach (« Tes élèves lisent ») :
//    'il' (« Mon coach »), 'elle' (« Ma coach ») ou 'neutre' (« Ne pas préciser »). Jamais déduite du prénom, de la
//    silhouette ni de la photo.
//  - Sans réponse (jamais choisie, pas encore lue, serveur d'avant) ou 'neutre' : l'accord par défaut du français,
//    celui d'avant (« ton coach », « il »). 'neutre' change seulement le titre de l'affiche (« COACH »).
//  - Tous les textes de l'app qui parlent d'un coach passent par coachWord (test : tests/unit/coach-form.mjs, qui
//    balaie js/ et index.html) ; un texte sur un coach encore inconnu (« Rejoindre un coach ») porte la marque
//    « accord-générique » sur sa ligne.
//  - Serveur : supabase/migrations/20261122010000_forme_coach.sql (coach_set_form, coach_form : lue par le coach et
//    ses élèves seulement). Gardée sur l'appareil (mdlf_coach_form) pour les textes hors ligne et au démarrage.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_FORMS = Object.freeze(['il', 'elle', 'neutre']);
const COACH_FORM_KEY = 'mdlf_coach_form';   // { userId, mine, pending, of: { [uid du coach]: forme } } : cet appareil seulement
const COACH_FORM_TTL = 5 * 60_000;

// Forme reçue (serveur, appareil, appel) → 'il' | 'elle' | 'neutre' | null (inconnue)
function cleanCoachForm(v) { return COACH_FORMS.includes(v) ? v : null; }

// Mots accordés. Une clé en minuscules donne un texte en minuscules ; « Ton », « Il »… une majuscule en tête.
//   ton, mon, un, le, du, au, ce, nouveau, ancien : le groupe entier (« ta coach », « de la coach »)
//   il : sujet (il / elle) ; pron : complément (« quitte-le » / « quitte-la ») ; e : accord d'un adjectif ou d'un
//   participe (« prêt » + coachWord('e') → « prête »)
const COACH_WORDS = Object.freeze({
  ton: ['ton coach', 'ta coach'],
  mon: ['mon coach', 'ma coach'],
  un: ['un coach', 'une coach'],
  le: ['le coach', 'la coach'],
  du: ['du coach', 'de la coach'],
  au: ['au coach', 'à la coach'],
  ce: ['ce coach', 'cette coach'],
  nouveau: ['nouveau coach', 'nouvelle coach'],
  ancien: ['ancien coach', 'ancienne coach'],
  il: ['il', 'elle'],
  pron: ['le', 'la'],
  e: ['', 'e'],
});
function coachWord(key, form) {
  const k = String(key || '');
  const low = k.charAt(0).toLowerCase() + k.slice(1);
  const pair = Object.hasOwn(COACH_WORDS, low) ? COACH_WORDS[low] : null;
  if (!pair) throw new Error(`coachWord : clé inconnue « ${k} »`);
  const s = pair[cleanCoachForm(form) === 'elle' ? 1 : 0];
  return k !== low && s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── Formes gardées sur l'appareil ───────────────────────────

const coachForms = { at: new Map(), loading: new Set(), server: true };   // uid → date de lecture ; lectures en cours
function coachFormStore() {
  const uid = typeof account === 'object' ? account.user?.id : null;
  try {
    const s = JSON.parse(localStorage.getItem(COACH_FORM_KEY));
    if (s && s.userId === uid && uid) {
      const mine = cleanCoachForm(s.mine);
      return { userId: uid, mine, pending: !!mine && s.pending === true, of: s.of && typeof s.of === 'object' && !Array.isArray(s.of) ? s.of : {} };
    }
  } catch { /* rien de gardé */ }
  return { userId: uid, mine: null, pending: false, of: {} };
}
function coachFormSave(s) {
  if (!s.userId) return;
  const of = {};
  for (const [k, v] of Object.entries(s.of).slice(-20)) if (typeof k === 'string' && cleanCoachForm(v)) of[k] = v;
  try { localStorage.setItem(COACH_FORM_KEY, JSON.stringify({ userId: s.userId, mine: s.mine, pending: s.pending === true, of })); }
  catch { /* facultatif */ }
}

// Forme d'un coach ; la mienne si uid est mon compte (null : inconnue)
function coachFormOf(uid) {
  const s = coachFormStore();
  if (!uid || !s.userId) return null;
  return uid === s.userId ? s.mine : Object.hasOwn(s.of, uid) ? cleanCoachForm(s.of[uid]) : null;
}
// Forme de MON coach (élève) : celle que lisent tous les textes « ton coach »
function myCoachForm() { return typeof myCoach === 'function' ? coachFormOf(myCoach()?.user_id) : null; }
// Ma forme (coach) : celle de mon affiche et des réglages
function myOwnCoachForm() { return coachFormStore().mine; }
// Raccourci des textes de l'élève : coachWord avec la forme de son coach
function myCoachWord(key) { return coachWord(key, myCoachForm()); }

// ── Serveur ─────────────────────────────────────────────────

const coachFormMissing = e => e?.code === 'PGRST202' || /could not find the function/i.test(String(e?.message || ''));
async function coachFormRpc(fn, args) {
  if (typeof sb === 'undefined' || !sb || !account.user) return { ok: false };
  const uid = account.user.id;
  try {
    const { data: res, error } = await sb.rpc(fn, args);
    if (account.user?.id !== uid) return { ok: false };
    if (error && coachFormMissing(error)) coachForms.server = false;
    return error ? { ok: false, missing: coachFormMissing(error) } : { ok: true, data: res };
  } catch { return { ok: false }; }   // hors ligne : la forme gardée reste
}

// Lit la forme d'un coach (gardée 5 min) ; true si elle a changé
async function coachFormLoad(uid) {
  if (!coachForms.server || typeof uid !== 'string' || !uid || coachForms.loading.has(uid)) return false;
  if (Date.now() - (coachForms.at.get(uid) || 0) < COACH_FORM_TTL) return false;
  coachForms.loading.add(uid);
  try {
    const r = await coachFormRpc('coach_form', { coach: uid });
    if (!r.ok) return false;
    coachForms.at.set(uid, Date.now());
    const s = coachFormStore(), next = cleanCoachForm(r.data?.form), old = coachFormOf(uid);
    if (uid === s.userId && s.pending) return false;   // mon choix pas encore parti : il prime sur le serveur
    if (uid === s.userId) s.mine = next; else if (next) s.of[uid] = next; else delete s.of[uid];
    coachFormSave(s);
    return old !== next;
  } finally { coachForms.loading.delete(uid); }
}

// Le coach choisit sa forme : gardée tout de suite sur l'appareil (en attente), envoyée au serveur ; un échec (hors
// ligne, serveur d'avant) la laisse en attente, renvoyée au prochain état lu (coachFormFollow)
async function coachFormSet(form) {
  const f = cleanCoachForm(form);
  if (!f || !account.user) return { ok: false };
  const s = coachFormStore();
  s.mine = f; s.pending = true;
  coachFormSave(s);
  return coachFormSend();
}
async function coachFormSend() {
  const s = coachFormStore();
  if (!s.pending || !s.mine) return { ok: true };
  const r = await coachFormRpc('coach_set_form', { form: s.mine });
  if (r.ok) {
    coachForms.server = true; coachForms.at.set(s.userId, Date.now());
    const now = coachFormStore();
    if (now.userId === s.userId && now.mine === s.mine) { now.pending = false; coachFormSave(now); }   // pas d'autre choix entre-temps
  }
  return r;
}

// Élève : la forme de son coach suit l'état lu ; coach : la sienne (autre appareil). Relue au plus toutes les 5 min.
function coachFormFollow() {
  if (!account.user) return;
  const c = typeof myCoach === 'function' ? myCoach() : null;
  const isCoach = typeof coachRole === 'function' && coachRole().isCoach;
  if (isCoach && coachFormStore().pending) coachFormSend();
  const ids = [c?.user_id, isCoach ? account.user.id : null].filter(Boolean);
  for (const id of ids) coachFormLoad(id).then(changed => { if (changed) notifyCoach(); });
}
if (typeof onCoachChange === 'function') onCoachChange(coachFormFollow);
if (typeof onAccountChange === 'function') onAccountChange(() => { coachForms.at.clear(); coachForms.server = true; });
