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
// dietPlans, dietActive, dietFoods (js/data/nutrition.js) : plans diète (les miens et ceux reçus d'un coach),
// plan suivi et aliments perso : seulement avec l'accord (SYNC_DIET_CONSENT_KEYS) ; dietConsent : cet accord daté.
// appVersion / appSeenAt (noteAppVersion) : version du contenu de l'app et date où elle a été vue,
// pour savoir côté serveur qui a quelle version ; le dernier appareil lancé l'emporte, rien d'autre ne part.
const SYNC_PROFILE_KEYS = ['activeProgramme', 'programmes', 'userProgrammes', 'customSessions', 'defaultRest', 'unit',
  'weeklyGoal', 'exEquip', 'onboarded', 'exerciseMuscles', 'exerciseMusclesSecondary', 'silhouette', 'myProgrammes',
  'level', 'sessionVisibleDefault', 'appVersion', 'appSeenAt', 'dietPlans', 'dietActive', 'dietFoods', 'dietConsent'];
// Clés de nutrition copiées seulement avec l'accord de la personne (dietConsent.on, js/data/nutrition.js) :
// sans accord, ou accord retiré, elles ne partent pas et le profil envoyé les efface du serveur. L'accord
// lui-même ({ on, at }) part toujours : un refus fait sur un appareil vaut pour les autres.
const SYNC_DIET_CONSENT_KEYS = ['dietPlans', 'dietActive', 'dietFoods'];
// Restent sur l'appareil (liste tenue pour le test qui oblige à classer toute nouvelle clé).
// lastAccount : moyen et pseudo du dernier compte connecté ici (reconnexion après une restauration iCloud).
// rirOn (sélecteur RIR) et plates (barre et disques de la salle) : préférences d'affichage et de matériel,
// comme les sons : propres à l'appareil.
// bodyMeasures : mensurations (js/data/body-measures.js), aussi privées que le poids ; les photos de
// progression ne sont même pas dans data (IndexedDB, js/data/progress-photos.js).
// recapCardOff (carte « Ta semaine » de l'accueil coupée) : affichage de cet appareil, comme les sons ;
// sur le compte, son absence (carte rallumée) devrait en plus compter comme un choix (SYNC_ABSENT_IS_CHOICE)
// strengthSex (Réglages › Entraînement › Sexe, repères du niveau de force) : donnée personnelle facultative,
// gardée sur l'appareil comme le poids du corps ; jamais envoyée au serveur
// dietLog (repas cochés et aliments remplacés, js/data/nutrition.js) : ce que la personne a mangé, jour par
// jour ; sur l'appareil seulement en V1 (le montrer au coach demandera son accord, docs/NUTRITION_V1.md)
const SYNC_LOCAL_ONLY = ['history', 'trash', 'bodyWeightKg', 'bodyWeightLog', 'bodyMeasures', 'healthOn', 'musicOn', 'soundOn', 'soundLevel', 'vibrateOn',
  'lastExport', 'healthKgPurged', 'schema', 'lastAccount', 'rirOn', 'plates', 'recapCardOff', 'strengthSex', 'dietLog',
  'dietConsentAsked', 'dietHideNumbers', 'dietStreakOff'];
// Clés dont l'absence est un choix fait sur un appareil (objectif « Auto », derniers muscles rétablis) :
// absentes du compte, elles sont retirées ici aussi. Toutes les versions qui synchronisent les envoient.
// Les autres clés absentes du compte sont gardées ici : un appareil resté sur une version qui ne les
// connaît pas encore (myProgrammes, silhouette) renvoie un profil sans elles, il ne les a pas effacées.
const SYNC_ABSENT_IS_CHOICE = ['weeklyGoal', 'exerciseMuscles', 'exerciseMusclesSecondary'];
// Dictionnaires du profil fusionnés élément par élément (programmes, exercices perso…) : rien n'est perdu
const SYNC_UNION_KEYS = ['programmes', 'userProgrammes', 'customSessions', 'exerciseMuscles', 'exerciseMusclesSecondary', 'dietPlans'];

// État de synchro vide d'un compte : curseur serveur, empreintes envoyées, profil
function emptySyncMeta(userId) { return { userId, cursor: null, pushed: {}, pushedCore: {}, profileHash: null, profileCore: null, profileAt: null }; }

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
//
// Records notés (h.records) : donnée dérivée, recalculée ici par renoteRecords (js/data/records.js) quand
// une séance passée est ajoutée, modifiée ou supprimée. Ce recalcul ne compte pas comme « modifié ici » :
// meta.pushedCore[id] garde l'empreinte de la séance sans ses records (sessionCoreHash), et une séance
// dont seuls les records ont changé reste « inchangée ici ». Sinon une suppression faite ailleurs serait
// ignorée (séance ressuscitée) ou une correction faite ailleurs écrasée. Les records repartent quand même
// (planSessionPush compare l'empreinte complète) ; après une version distante appliquée, ils sont
// recalculés ici (renoteMerged). État de synchro d'avant ce champ (pas de pushedCore) : repris à la
// première synchro (applyRemoteSessions) pour les séances inchangées ici ; seuls des records renotés
// avant cette première synchro comptent encore comme « modifiés ici ». core : knownCore(meta, id).
function sessionUnchangedSince(known, h, core) {
  return known === syncHash(sessionPayload(h)) || known === legacySessionHash(h)
    || (core != null && core === sessionCoreHash(sessionPayload(h)));
}
// Empreinte d'une séance telle qu'elle part (payload), sans ses records notés
function sessionCoreHash(payload) { const { records, ...rest } = payload || {}; return syncHash(rest); }
// Empreintes de la séance telle qu'elle est sur le serveur (hash : complète, core : sans les records),
// ou 'deleted' (core oublié). pushedCore[id] garde la paire { hash, core } : core ne vaut que pour
// l'empreinte qu'il accompagne (knownCore)
function notePushed(meta, id, hash, core) {
  meta.pushed[id] = hash;
  meta.pushedCore ||= {};
  if (hash === 'deleted' || core == null) delete meta.pushedCore[id]; else meta.pushedCore[id] = { hash, core };
}
// Empreinte sans records de la séance sur le serveur, ou null si elle n'est pas sûre : une version
// d'avant pushedCore (retour arrière de l'app) écrit meta.pushed[id] sans toucher pushedCore, et une
// valeur seule (format du 31/10/2026, jamais publié) ne dit pas pour quelle empreinte elle a été notée
function knownCore(meta, id) {
  const known = meta.pushed?.[id], c = meta.pushedCore?.[id];
  if (known === undefined || known === 'deleted' || !c || typeof c !== 'object') return null;
  return c.hash === known && typeof c.core === 'string' ? c.core : null;
}
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
  const diet = d.dietConsent?.on === true;
  for (const k of SYNC_PROFILE_KEYS) if (d[k] !== undefined && (diet || !SYNC_DIET_CONSENT_KEYS.includes(k))) out[k] = d[k];
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
// Clés du profil que l'app change d'elle-même (noteAppVersion) : elles partent sur le compte, mais ne
// comptent pas comme « modifié ici » ; sinon une mise à jour de l'app, notée avant la première synchro,
// ferait gagner cet appareil sur les changements faits ailleurs entre-temps
const SYNC_PROFILE_VOLATILE = ['appVersion', 'appSeenAt'];
// Empreinte du profil sans ces clés (meta.profileCore). Une empreinte enregistrée avant elles (profil sans
// appVersion) est égale à celle-ci tant que rien d'autre n'a changé
function profileCoreHash(doc) {
  const out = { ...(doc || {}) };
  for (const k of SYNC_PROFILE_VOLATILE) delete out[k];
  return syncHash(out);
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
    if (meta.pushed[h.id] !== hash) upserts.push({ id: h.id, data, hash, core: sessionCoreHash(data) });
  }
  const deletes = Object.keys(meta.pushed).filter(id => meta.pushed[id] !== 'deleted' && !local.has(id));
  return { upserts, deletes };
}

// Séances reçues du serveur appliquées à l'historique local. Renvoie { history (trié, plus récente
// d'abord), changed, removed (séances retirées ici, pour « Supprimés récemment »), applied (séances
// ajoutées ou remplacées par leur version distante : leurs records et ceux d'après sont à renoter),
// recordsOnly (identifiants des séances remplacées par une version distante qui ne diffère de la
// dernière connue que par ses records : records gardés tels quels, renoteMerged) } ;
// meta.pushed et meta.pushedCore sont tenus à jour. Règles :
// - séance modifiée ici depuis la dernière synchro : la version locale gagne (elle partira) ;
// - inchangée ici, ou sans empreinte connue : la version distante remplace la locale (poids du corps
//   local gardé) ; une séance dont seuls les records notés ont changé ici compte comme inchangée ;
// - suppression distante : appliquée sauf si la séance a changé ici depuis la dernière synchro ;
// - séance supprimée ici (encore à envoyer) : pas de résurrection, sauf si elle a changé ailleurs.
function applyRemoteSessions(history, rows, meta) {
  const byId = new Map(history.map((h, i) => [h.id, i]));
  const out = history.slice();
  const removedIds = new Set();
  const applied = [], recordsOnly = [];
  let changed = false;
  // État de synchro d'avant pushedCore, ou empreinte sans records qui n'accompagne plus l'empreinte connue
  // (knownCore) : reprise des séances inchangées ici, pour que les records renotés ensuite ne comptent
  // plus comme « modifiés ici » ; sinon oubliée (la séance compte comme modifiée ici si elle a changé)
  meta.pushedCore ||= {};
  for (const h of history) {
    const known = meta.pushed[h.id];
    if (known === undefined || known === 'deleted' || knownCore(meta, h.id) != null) continue;
    const payload = sessionPayload(h);
    if (known === syncHash(payload)) meta.pushedCore[h.id] = { hash: known, core: sessionCoreHash(payload) };
    else delete meta.pushedCore[h.id];
  }
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue;
    const i = byId.get(row.id), local = i === undefined ? null : out[i];
    const known = meta.pushed[row.id];
    const core = knownCore(meta, row.id);
    const changedHere = !!local && known !== undefined && !sessionUnchangedSince(known, local, core);
    if (row.deleted_at) {
      if (local && !changedHere) { removedIds.add(row.id); changed = true; }
      if (!changedHere) notePushed(meta, row.id, 'deleted');
      continue;
    }
    if (!row.data || typeof row.data !== 'object') continue;
    const remoteHash = syncHash(row.data), remoteCore = sessionCoreHash(row.data);
    if (!local) {
      // supprimée ici, suppression encore à envoyer (empreinte de l'ancien format : même séance renvoyée
      // avec son nom par un appareil à jour)
      if (known === remoteHash || known === legacySessionHash(row.data)) continue;
      out.push(remoteEntry(row.data, row.id));
      byId.set(row.id, out.length - 1);
      applied.push(out[out.length - 1]);
      notePushed(meta, row.id, remoteHash, remoteCore);
      changed = true;
    } else if (syncHash(sessionPayload(local)) === remoteHash) {
      notePushed(meta, row.id, remoteHash, remoteCore);
    } else if (!changedHere) {
      out[i] = { ...remoteEntry(row.data, row.id), ...(local.bodyKg !== undefined ? { bodyKg: local.bodyKg } : {}) };
      // Seuls ses records ont changé ailleurs (renotés par l'appareil qui a fait le geste) : pas à renoter
      // ici, sinon deux appareils qui les calculent autrement (versions différentes) se les renverraient
      // sans fin. Sans empreinte sûre (core null) : version réellement modifiée ailleurs
      if (core != null && core === remoteCore) recordsOnly.push(row.id); else applied.push(out[i]);
      notePushed(meta, row.id, remoteHash, remoteCore);
      changed = true;
    }
    // sinon : modifiée ici depuis la dernière synchro, la version locale partira au prochain envoi
  }
  const removed = out.filter(h => removedIds.has(h.id));
  const kept = removed.length ? out.filter(h => !removedIds.has(h.id)) : out;
  if (changed) kept.sort((a, b) => b.date - a.date);
  return { history: kept, changed, removed, applied: applied.filter(h => !removedIds.has(h.id)),
    recordsOnly: recordsOnly.filter(id => !removedIds.has(id)) };
}

// Records notés après une fusion (merged : applyRemoteSessions), recalculés dans history (modifié en
// place) avec la bibliothèque de cet appareil : séances reçues ou supprimées ailleurs, et celles d'après
// (elles repartiront si leurs records changent, sans compter comme « modifiées ici »). Les séances dont
// seuls les records ont changé ailleurs (merged.recordsOnly) gardent ceux reçus : l'appareil qui a fait
// le geste publie les records dérivés, les autres ne les contestent pas. Une séance reçue en même temps
// qu'une autre réellement modifiée ailleurs a été renotée là-bas avec elle : ses records reçus valent.
function renoteMerged(merged, history) {
  const ids = new Set(merged.recordsOnly || []);
  const keep = history.filter(h => ids.has(h.id)).map(h => [h, h.records]);
  const n = renoteRecordsFrom([...(merged.applied || []), ...(merged.removed || [])], history);
  for (const [h, records] of keep) { if (records === undefined) delete h.records; else h.records = records; }
  return n;
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
  if (localHash === remoteHash) { meta.profileHash = localHash; meta.profileCore = profileCoreHash(doc); return false; }
  const blank = isBlankData(d);
  const before = Object.fromEntries(Object.entries(d.userProgrammes || {}).filter(([, up]) => Array.isArray(up?.order)).map(([k, up]) => [k, up.order.slice()]));
  // Inchangé ici : empreinte égale, ou égale sans l'ordre des séances ajouté par une version précédente,
  // ou égale sans la version de l'app (SYNC_PROFILE_VOLATILE : notée au démarrage, avant la synchro)
  const localDoc = profilePayload(d), localCore = profileCoreHash(localDoc);
  const unchangedHere = meta.profileHash === localHash
    || (meta.profileHash != null && (meta.profileHash === profileHashBeforeOrder(localDoc) || meta.profileHash === localCore))
    || (meta.profileCore != null && meta.profileCore === localCore);
  if (blank || unchangedHere) {
    // Appareil vierge : ses clés ne sont que les valeurs par défaut, copie exacte (Mes programmes se
    // reconstruit alors depuis l'historique du compte, cleanMyProgrammes)
    // La version de l'app reste celle de cet appareil (elle partira au prochain envoi)
    const ownVersion = Object.fromEntries(SYNC_PROFILE_VOLATILE.filter(k => d[k] !== undefined).map(k => [k, d[k]]));
    // Nutrition : jamais effacée ici parce que le compte ne l'a pas (sans accord, elle n'y est jamais)
    const keepHere = k => SYNC_DIET_CONSENT_KEYS.includes(k) || k === 'dietConsent';
    for (const k of SYNC_PROFILE_KEYS) { if (k in doc) d[k] = doc[k]; else if ((blank && !keepHere(k)) || SYNC_ABSENT_IS_CHOICE.includes(k)) delete d[k]; }
    Object.assign(d, ownVersion);
    keepLocalOrders(d, before);
    meta.profileHash = remoteHash; meta.profileCore = profileCoreHash(doc);
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
  meta.profileHash = remoteHash; meta.profileCore = profileCoreHash(doc);
  return true;
}
