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

// Profil partagé entre les appareils du compte. silhouette (carte des muscles), level (niveau du premier
// lancement, repère de la bulle des muscles) : réponses de la personne,
// le même sur tous ses appareils comme l'unité ; pas une donnée de santé. myProgrammes (liste ordonnée,
// remplacée en bloc, pas fusionnée) : un programme créé sur un autre appareil y revient par
// cleanMyProgrammes (store.js) après la fusion. sessionVisibleDefault (Réglages › Amis et coach) :
// préremplit « Visible sur mon profil » à la fin d'une séance, même choix sur tous les appareils.
// appVersion / appSeenAt (noteAppVersion) : version du contenu de l'app et date où elle a été vue,
// pour savoir côté serveur qui a quelle version ; le dernier appareil lancé l'emporte, rien d'autre ne part.
const SYNC_PROFILE_KEYS = ['activeProgramme', 'programmes', 'userProgrammes', 'customSessions', 'defaultRest', 'unit',
  'weeklyGoal', 'exEquip', 'onboarded', 'exerciseMuscles', 'exerciseMusclesSecondary', 'silhouette', 'myProgrammes',
  'level', 'sessionVisibleDefault', 'appVersion', 'appSeenAt'];
// Restent sur l'appareil (liste tenue pour le test qui oblige à classer toute nouvelle clé).
// lastAccount : moyen et pseudo du dernier compte connecté ici (reconnexion après une restauration iCloud).
// rirOn (sélecteur RIR) et plates (barre et disques de la salle) : préférences d'affichage et de matériel,
// comme les sons : propres à l'appareil
const SYNC_LOCAL_ONLY = ['history', 'trash', 'bodyWeightKg', 'bodyWeightLog', 'healthOn', 'musicOn', 'soundOn', 'vibrateOn',
  'lastExport', 'healthKgPurged', 'schema', 'lastAccount', 'rirOn', 'plates'];
// Clés dont l'absence est un choix fait sur un appareil (objectif « Auto », derniers muscles rétablis) :
// absentes du compte, elles sont retirées ici aussi. Toutes les versions qui synchronisent les envoient.
// Les autres clés absentes du compte sont gardées ici : un appareil resté sur une version qui ne les
// connaît pas encore (myProgrammes, silhouette) renvoie un profil sans elles, il ne les a pas effacées.
const SYNC_ABSENT_IS_CHOICE = ['weeklyGoal', 'exerciseMuscles', 'exerciseMusclesSecondary'];
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

// Séance telle qu'elle part sur le serveur : sans le poids du corps, avec son nom affiché (label,
// rawLabel du programme et de la séance) calculé au moment de la synchro, pour les abonnés qui n'ont pas
// les programmes perso de la personne (docs/SOCIAL_V1.md). Seule lecture de `data` de ce fichier (noms
// des séances perso, profil synchronisé avant l'envoi). Le nom fait partie de l'empreinte : renommer
// une séance perso renvoie une fois ses séances ; l'ajout du champ (Social V1) les renvoie toutes une
// fois ; une empreinte enregistrée sans label compte comme « inchangée ici » (sessionUnchangedSince),
// sinon une correction ou une suppression faite sur un autre appareil serait écrasée à cette occasion. hidden : séance
// masquée aux abonnés (true, absent sinon), envoyée telle quelle.
function sessionPayload(h) {
  const { bodyKg, label, ...rest } = h;
  return typeof h.category === 'string' ? { ...rest, label: rawLabel(h.category, entryProg(h)) } : rest;
}
// Empreinte d'une séance au format d'avant Social V1 (sans label ; bodyKg n'est jamais parti) :
// meta.pushed garde ces empreintes jusqu'au premier envoi de la séance avec son nom
function legacySessionHash(h) { const { bodyKg, label, ...rest } = h; return syncHash(rest); }
// Séance inchangée ici depuis la dernière synchro : son empreinte enregistrée est celle de son payload
// actuel, ou celle de l'ancien format (appareil mis à jour depuis : la séance n'a pas changé pour autant ;
// elle repartira une fois avec son nom, planSessionPush, si le compte ne l'a pas modifiée entre-temps)
function sessionUnchangedSince(known, h) { return known === syncHash(sessionPayload(h)) || known === legacySessionHash(h); }
// Séance reçue du compte : sans son nom (recalculé ici à l'envoi, jamais stocké dans l'historique)
function remoteEntry(rowData, id) { const { label, ...rest } = rowData; return { ...rest, id }; }
// Version du contenu de l'app notée dans le profil au démarrage (js/app/init.js). Renvoie true si elle
// a changé (à enregistrer) : appVersion = version du contenu (window.MDLF_BUILD, absent dans la PWA :
// rien n'est noté), appSeenAt = date ISO du premier lancement de cette version sur cet appareil.
function noteAppVersion(d, version, now = new Date()) {
  if (typeof version !== 'string' || !version || d.appVersion === version) return false;
  d.appVersion = version;
  d.appSeenAt  = now.toISOString();
  return true;
}

// Profil partagé : seulement les clés autorisées
function profilePayload(d) {
  const out = {};
  for (const k of SYNC_PROFILE_KEYS) if (d[k] !== undefined) out[k] = d[k];
  return out;
}

// Empreinte du profil sans l'ordre des séances des programmes perso (userProgrammes[k].order, posé au
// chargement et à l'enregistrement depuis le 27/10/2026, js/data/store.js : userSessionOrder). Comme
// legacySessionHash : une empreinte enregistrée avant ce champ compte comme « inchangé ici », sinon la
// première synchro après la mise à jour ferait gagner cet appareil sur les changements faits ailleurs.
// Seul champ ajouté d'office à tout le monde par cette version (consigne, retired, fromCoach n'existent
// que si la personne a un coach ou en est un, et ne sont jamais posés au chargement).
function profileHashBeforeOrder(doc) {
  const ups = doc?.userProgrammes;
  if (!ups || typeof ups !== 'object') return syncHash(doc);
  const out = {};
  for (const [k, up] of Object.entries(ups)) {
    if (up && typeof up === 'object') { const { order, ...rest } = up; out[k] = rest; } else out[k] = up;
  }
  return syncHash({ ...doc, userProgrammes: out });
}
// Ordres locaux des séances, gardés quand le profil reçu n'en a pas encore (compte rempli par une version
// précédente : ses clés arrivent triées par jsonb, l'ordre de cet appareil est le bon)
function keepLocalOrders(d, before) {
  for (const [k, up] of Object.entries(d.userProgrammes || {})) {
    if (up && typeof up === 'object' && !Array.isArray(up.order) && Array.isArray(before[k])) up.order = before[k];
  }
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
    const changedHere = !!local && known !== undefined && !sessionUnchangedSince(known, local);
    if (row.deleted_at) {
      if (local && !changedHere) { removedIds.add(row.id); changed = true; }
      if (!changedHere) meta.pushed[row.id] = 'deleted';
      continue;
    }
    if (!row.data || typeof row.data !== 'object') continue;
    const remoteHash = syncHash(row.data);
    if (!local) {
      // supprimée ici, suppression encore à envoyer (empreinte de l'ancien format : même séance renvoyée
      // avec son nom par un appareil à jour)
      if (known === remoteHash || known === legacySessionHash(row.data)) continue;
      out.push(remoteEntry(row.data, row.id));
      byId.set(row.id, out.length - 1);
      meta.pushed[row.id] = remoteHash;
      changed = true;
    } else if (syncHash(sessionPayload(local)) === remoteHash) {
      meta.pushed[row.id] = remoteHash;
    } else if (!changedHere) {
      out[i] = { ...remoteEntry(row.data, row.id), ...(local.bodyKg !== undefined ? { bodyKg: local.bodyKg } : {}) };
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
// - appareil vierge : copie exacte du compte ;
// - profil local inchangé depuis la dernière synchro : copie du compte, mais une clé absente du compte
//   n'est retirée ici que si son absence est un choix (SYNC_ABSENT_IS_CHOICE) ;
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
  const blank = isBlankData(d);
  const before = Object.fromEntries(Object.entries(d.userProgrammes || {}).filter(([, up]) => Array.isArray(up?.order)).map(([k, up]) => [k, up.order.slice()]));
  // Inchangé ici : empreinte égale, ou égale sans l'ordre des séances ajouté par cette version
  const unchangedHere = meta.profileHash === localHash || (meta.profileHash != null && meta.profileHash === profileHashBeforeOrder(profilePayload(d)));
  if (blank || unchangedHere) {
    // Appareil vierge : ses clés ne sont que les valeurs par défaut, copie exacte (Mes programmes se
    // reconstruit alors depuis l'historique du compte, cleanMyProgrammes)
    for (const k of SYNC_PROFILE_KEYS) { if (k in doc) d[k] = doc[k]; else if (blank || SYNC_ABSENT_IS_CHOICE.includes(k)) delete d[k]; }
    keepLocalOrders(d, before);
    meta.profileHash = remoteHash;
    return true;
  }
  const remoteWins = meta.profileHash == null;
  for (const [k, v] of Object.entries(doc)) {
    const both = SYNC_UNION_KEYS.includes(k) && v && typeof v === 'object' && d[k] && typeof d[k] === 'object';
    if (both) d[k] = remoteWins ? { ...d[k], ...v } : { ...v, ...d[k] };
    else if (remoteWins || d[k] === undefined) d[k] = v;
  }
  keepLocalOrders(d, before);
  // Empreinte du compte : le résultat de la fusion, différent, partira au prochain envoi
  meta.profileHash = remoteHash;
  return true;
}
