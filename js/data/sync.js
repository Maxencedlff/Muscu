// ═══════════════════════════════════════════════════════════
//  Synchronisation du compte MDLF : logique pure, sans réseau (js/data/account.js fait les appels)
//
//  Serveur (Supabase, supabase/migrations) : une ligne par séance (sessions : id, data, deleted_at,
//  updated_at) et un document de profil (profiles.doc : programmes et réglages communs).
//  Hors ligne d'abord : la donnée locale reste la référence ; le serveur n'en est qu'une copie partagée
//  entre les appareils du compte.
//
//  Détection des changements par empreinte : meta.pushed[id] est l'empreinte de la séance telle
//  qu'elle est sur le serveur (ou 'deleted'). Une séance locale dont l'empreinte diffère a changé
//  ici depuis la dernière synchro : elle part, et une version distante ne l'écrase pas (si la même
//  séance a changé sur deux appareils, le dernier envoi gagne).
//  Séance sans empreinte connue (première liaison de cet appareil, réinstallation, état de synchro
//  remis à zéro après un import) : le compte fait foi. Ses versions et ses suppressions s'appliquent ;
//  seules les séances absentes du compte partent.
//
//  Ne part jamais : le poids du corps (pesée de Santé ou saisi : règle Apple 5.1.3, déclaration de
//  confidentialité) et les réglages propres à l'appareil. Le profil part par liste autorisée
//  (SYNC_PROFILE_KEYS) : une nouvelle clé reste sur l'appareil tant qu'on ne l'y ajoute pas.
// ═══════════════════════════════════════════════════════════
'use strict';

// Profil partagé entre les appareils du compte. silhouette (carte des muscles) : choix de la personne,
// le même sur tous ses appareils comme l'unité ; pas une donnée de santé
const SYNC_PROFILE_KEYS = ['activeProgramme', 'programmes', 'userProgrammes', 'customSessions', 'defaultRest', 'unit',
  'weeklyGoal', 'exEquip', 'onboarded', 'exerciseMuscles', 'exerciseMusclesSecondary', 'silhouette'];
// Restent sur l'appareil (liste tenue pour le test qui oblige à classer toute nouvelle clé).
// lastAccount : moyen et pseudo du dernier compte connecté ici (reconnexion après une restauration iCloud)
const SYNC_LOCAL_ONLY = ['history', 'trash', 'bodyWeightKg', 'bodyWeightLog', 'healthOn', 'musicOn', 'soundOn', 'vibrateOn',
  'lastExport', 'healthKgPurged', 'schema', 'lastAccount'];
// Dictionnaires du profil fusionnés élément par élément (programmes, exercices perso…) : rien n'est perdu
const SYNC_UNION_KEYS = ['programmes', 'userProgrammes', 'customSessions', 'exerciseMuscles', 'exerciseMusclesSecondary'];

// État de synchro vide d'un compte : curseur serveur, empreintes envoyées, profil
function emptySyncMeta(userId) { return { userId, cursor: null, pushed: {}, profileHash: null, profileAt: null }; }

// JSON aux clés triées : deux objets égaux donnent la même empreinte, quel que soit l'ordre des clés
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
// Empreinte FNV-1a 32 bits (comparaison seulement, aucune sécurité)
function syncHash(v) {
  const s = stableJson(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// Séance telle qu'elle part sur le serveur : sans le poids du corps
function sessionPayload(h) { const { bodyKg, ...rest } = h; return rest; }
// Profil partagé : seulement les clés autorisées
function profilePayload(d) {
  const out = {};
  for (const k of SYNC_PROFILE_KEYS) if (d[k] !== undefined) out[k] = d[k];
  return out;
}

// Appareil vierge (aucune séance) : à la liaison, le compte fait foi (nouvel iPhone, réinstallation)
function isBlankData(d) { return !(d.history || []).length; }

// Ce qui doit partir : séances nouvelles ou modifiées ici, et suppressions (tombstones)
function planSessionPush(history, meta) {
  const local = new Map(history.map(h => [h.id, h]));
  const upserts = [];
  for (const h of history) {
    const data = sessionPayload(h), hash = syncHash(data);
    if (meta.pushed[h.id] !== hash) upserts.push({ id: h.id, data, hash });
  }
  const deletes = Object.keys(meta.pushed).filter(id => meta.pushed[id] !== 'deleted' && !local.has(id));
  return { upserts, deletes };
}

// Séances reçues du serveur appliquées à l'historique local. Renvoie { history (trié, plus récente
// d'abord), changed, removed (séances retirées ici, pour « Supprimés récemment ») } ; meta.pushed est
// tenu à jour. Règles :
// - séance modifiée ici depuis la dernière synchro : la version locale gagne (elle partira) ;
// - inchangée ici, ou sans empreinte connue : la version distante remplace la locale (poids du corps
//   local gardé) ;
// - suppression distante : appliquée sauf si la séance a changé ici depuis la dernière synchro ;
// - séance supprimée ici (encore à envoyer) : pas de résurrection, sauf si elle a changé ailleurs.
function applyRemoteSessions(history, rows, meta) {
  const byId = new Map(history.map((h, i) => [h.id, i]));
  const out = history.slice();
  const removedIds = new Set();
  let changed = false;
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue;
    const i = byId.get(row.id), local = i === undefined ? null : out[i];
    const known = meta.pushed[row.id];
    const changedHere = !!local && known !== undefined && known !== syncHash(sessionPayload(local));
    if (row.deleted_at) {
      if (local && !changedHere) { removedIds.add(row.id); changed = true; }
      if (!changedHere) meta.pushed[row.id] = 'deleted';
      continue;
    }
    if (!row.data || typeof row.data !== 'object') continue;
    const remoteHash = syncHash(row.data);
    if (!local) {
      if (known === remoteHash) continue;   // supprimée ici, suppression encore à envoyer
      out.push({ ...row.data, id: row.id });
      byId.set(row.id, out.length - 1);
      meta.pushed[row.id] = remoteHash;
      changed = true;
    } else if (syncHash(sessionPayload(local)) === remoteHash) {
      meta.pushed[row.id] = remoteHash;
    } else if (!changedHere) {
      out[i] = { ...row.data, id: row.id, ...(local.bodyKg !== undefined ? { bodyKg: local.bodyKg } : {}) };
      meta.pushed[row.id] = remoteHash;
      changed = true;
    }
    // sinon : modifiée ici depuis la dernière synchro, la version locale partira au prochain envoi
  }
  const removed = out.filter(h => removedIds.has(h.id));
  const kept = removed.length ? out.filter(h => !removedIds.has(h.id)) : out;
  if (changed) kept.sort((a, b) => b.date - a.date);
  return { history: kept, changed, removed };
}

// Profil reçu (doc, updated_at) appliqué aux données locales (modifiées en place). Renvoie true si
// quelque chose a changé ici.
// - appareil vierge, ou profil local inchangé depuis la dernière synchro : copie exacte du compte ;
// - première liaison (aucune empreinte connue) : le compte gagne, ce qui n'existe qu'ici est ajouté
//   (un programme créé sur cet iPhone, par exemple) ;
// - modifié des deux côtés : cet appareil gagne, ce qui n'existe que sur le compte est ajouté.
//   Limite connue : sans tombstone de programme, un programme supprimé ailleurs revient dans ce cas
//   (les programmes perso supprimés sont archivés, pas effacés : cas rare et sans perte).
function applyRemoteProfile(d, remote, meta) {
  if (!remote?.doc || typeof remote.doc !== 'object') return false;
  if (meta.profileAt && remote.updated_at && remote.updated_at <= meta.profileAt) return false;
  meta.profileAt = remote.updated_at || meta.profileAt;
  const doc = profilePayload(remote.doc);
  const remoteHash = syncHash(doc), localHash = syncHash(profilePayload(d));
  if (localHash === remoteHash) { meta.profileHash = localHash; return false; }
  if (isBlankData(d) || meta.profileHash === localHash) {
    for (const k of SYNC_PROFILE_KEYS) { if (k in doc) d[k] = doc[k]; else delete d[k]; }
    meta.profileHash = remoteHash;
    return true;
  }
  const remoteWins = meta.profileHash == null;
  for (const [k, v] of Object.entries(doc)) {
    const both = SYNC_UNION_KEYS.includes(k) && v && typeof v === 'object' && d[k] && typeof d[k] === 'object';
    if (both) d[k] = remoteWins ? { ...d[k], ...v } : { ...v, ...d[k] };
    else if (remoteWins || d[k] === undefined) d[k] = v;
  }
  // Empreinte du compte : le résultat de la fusion, différent, partira au prochain envoi
  meta.profileHash = remoteHash;
  return true;
}
