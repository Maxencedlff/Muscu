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
//  ici depuis la dernière synchro : elle part, et une version distante ne l'écrase jamais.
//
//  Ne part jamais : le poids du corps (pesée de Santé ou saisi : règle Apple 5.1.3, déclaration de
//  confidentialité) et les réglages propres à l'appareil (sons, Santé, Musique).
// ═══════════════════════════════════════════════════════════
'use strict';

const SYNC_LOCAL_ONLY = new Set(['history', 'trash', 'bodyWeightKg', 'healthOn', 'musicOn', 'soundOn',
  'vibrateOn', 'lastExport', 'healthKgPurged', 'schema']);
// Dictionnaires du profil fusionnés clé par clé à la première liaison d'un appareil (rien n'est perdu)
const SYNC_UNION_KEYS = ['programmes', 'userProgrammes', 'customSessions', 'exerciseMuscles'];

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
// Profil partagé : tout sauf l'historique et ce qui reste sur l'appareil
function profilePayload(d) {
  const out = {};
  for (const k of Object.keys(d)) if (!SYNC_LOCAL_ONLY.has(k)) out[k] = d[k];
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

// Séances reçues du serveur appliquées à l'historique local. Renvoie le nouvel historique et un
// indicateur de changement ; meta.pushed est tenu à jour. Règles :
// - séance modifiée ici depuis la dernière synchro : la version locale gagne (elle partira) ;
// - sinon la version distante remplace la locale (le poids du corps local est gardé) ;
// - suppression distante : appliquée si la séance n'a pas changé ici ;
// - séance supprimée ici (encore à envoyer) : pas de résurrection, sauf si elle a changé ailleurs.
function applyRemoteSessions(history, rows, meta) {
  const byId = new Map(history.map((h, i) => [h.id, i]));
  const out = history.slice();
  const removed = new Set();
  let changed = false;
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue;
    const i = byId.get(row.id), local = i === undefined ? null : out[i];
    const localHash = local ? syncHash(sessionPayload(local)) : null;
    const unchangedHere = !!local && meta.pushed[row.id] === localHash;
    if (row.deleted_at) {
      if (local && unchangedHere) { removed.add(row.id); changed = true; meta.pushed[row.id] = 'deleted'; }
      else if (!local) meta.pushed[row.id] = 'deleted';
      continue;
    }
    if (!row.data || typeof row.data !== 'object') continue;
    const remoteHash = syncHash(row.data);
    if (!local) {
      const deletedHere = meta.pushed[row.id] !== undefined && meta.pushed[row.id] !== 'deleted';
      if (deletedHere && meta.pushed[row.id] === remoteHash) continue;   // suppression locale à envoyer
      out.push({ ...row.data, id: row.id });
      byId.set(row.id, out.length - 1);
      meta.pushed[row.id] = remoteHash;
      changed = true;
    } else if (localHash === remoteHash) {
      meta.pushed[row.id] = remoteHash;
    } else if (unchangedHere) {
      out[i] = { ...row.data, id: row.id, ...(local.bodyKg !== undefined ? { bodyKg: local.bodyKg } : {}) };
      meta.pushed[row.id] = remoteHash;
      changed = true;
    }
    // sinon : modifiée des deux côtés, la version locale partira au prochain envoi
  }
  return { history: removed.size ? out.filter(h => !removed.has(h.id)) : out, changed };
}

// Profil reçu (doc, updated_at) appliqué aux données locales (modifiées en place). Renvoie true si
// quelque chose a changé ici. Profil local inchangé depuis la dernière synchro, ou appareil vierge :
// le profil distant remplace le local. Sinon (les deux ont changé, ou première liaison) : fusion
// sans perte, dictionnaires réunis clé par clé et valeurs locales gagnantes.
function applyRemoteProfile(d, remote, meta) {
  if (!remote?.doc || typeof remote.doc !== 'object') return false;
  if (meta.profileAt && remote.updated_at && remote.updated_at <= meta.profileAt) return false;
  meta.profileAt = remote.updated_at || meta.profileAt;
  const doc = profilePayload(remote.doc);
  const localHash = syncHash(profilePayload(d));
  if (localHash === syncHash(doc)) { meta.profileHash = localHash; return false; }
  const takeRemote = meta.profileHash === localHash || isBlankData(d);
  for (const [k, v] of Object.entries(doc)) {
    if (takeRemote || d[k] === undefined) d[k] = v;
    else if (SYNC_UNION_KEYS.includes(k) && v && typeof v === 'object' && d[k] && typeof d[k] === 'object') d[k] = { ...v, ...d[k] };
  }
  if (takeRemote) meta.profileHash = syncHash(profilePayload(d));
  return true;
}
