// ═══════════════════════════════════════════════════════════
//  Supprimés récemment : séances en corbeille et programmes archivés
// ═══════════════════════════════════════════════════════════
'use strict';

// Une séance supprimée quitte data.history (stats, records, délais l'ignorent aussitôt)
// et attend TRASH_DAYS jours dans data.trash, purgée au chargement par sanitizeData.
// Un programme supprimé est seulement archivé : l'historique a besoin de ses noms et couleurs.
// Aucun effet d'écran ni d'écriture : l'appelant enregistre (historyChanged) et redessine.

const DAY_MS = 86400000;

// Retire une séance de l'historique et la met en tête de la corbeille ; renvoie la séance ou null
function moveToTrash(id, now = Date.now()) {
  const idx = (data.history || []).findIndex(h => h.id === id);
  if (idx < 0) return null;
  const [entry] = data.history.splice(idx, 1);
  (data.trash ||= []).unshift({ entry, deletedAt: now });
  return entry;
}

// Remet une séance de la corbeille dans l'historique ; renvoie la séance ou null
function restoreFromTrash(id) {
  const idx = (data.trash || []).findIndex(t => t.entry.id === id);
  if (idx < 0) return null;
  const [{ entry }] = data.trash.splice(idx, 1);
  data.history.push(entry);
  data.history.sort((a, b) => b.date - a.date);
  // Le délai de récupération reprend la date de la séance si elle est la plus récente de sa catégorie
  const timers = data.programmes[entry.programme || 'ppl']?.timers;
  if (timers && entry.date > (timers[entry.category] || 0)) timers[entry.category] = entry.date;
  return entry;
}

// Efface une séance de la corbeille (sans retour possible) ; renvoie true si elle y était
function purgeFromTrash(id) {
  const before = (data.trash || []).length;
  data.trash = (data.trash || []).filter(t => t.entry.id !== id);
  return data.trash.length < before;
}

function emptyTrash() { data.trash = []; }

// Jours restants avant l'effacement automatique (au moins 1 tant qu'elle est là)
function trashDaysLeft(t, now = Date.now()) {
  return Math.max(1, Math.ceil((t.deletedAt + TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

// Programmes créés puis supprimés : [[id, programme], …]
function archivedProgrammes() {
  return Object.entries(data.userProgrammes || {}).filter(([, p]) => p.archived);
}

// Rend un programme supprimé à nouveau disponible (il ne devient pas actif) ; renvoie true si fait
function restoreProgramme(id) {
  const up = data.userProgrammes?.[id];
  if (!up?.archived) return false;
  up.archived = false;
  return true;
}
