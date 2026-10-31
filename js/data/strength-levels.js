// ═══════════════════════════════════════════════════════════
//  Niveau de force des trois mouvements de force athlétique (squat, développé couché, soulevé de terre).
//  Logique pure, tout reste sur l'appareil. Seuils : js/data/strength-standards.js (généré depuis
//  OpenPowerlifting par scripts/strength-standards.py). Écrans : js/features/strength-levels-ui.js.
//  Méthode, percentiles et source : docs/ENTRAINEMENT.md
// ═══════════════════════════════════════════════════════════
'use strict';

const STRENGTH_DAY = 86_400_000;
// Débutant : sous le seuil Novice ; les quatre seuils de STRENGTH_STANDARDS sont Novice, Intermédiaire, Avancé, Élite
const STRENGTH_LEVELS = ['Débutant', 'Novice', 'Intermédiaire', 'Avancé', 'Élite'];
const STRENGTH_LIFTS = [
  { id: 'squat',    name: 'Squat barre' },
  { id: 'bench',    name: 'Développé couché barre' },
  { id: 'deadlift', name: 'Soulevé de terre' },
];
// Repères de force (Réglages › Entraînement) : réponse facultative de la personne, jamais déduite de la
// silhouette. 'none' = « Ne pas préciser » : pas de palier, comme sans réponse, mais on ne redemande plus.
const STRENGTH_SEXES = ['male', 'female', 'none'];
// 1RM estimé : meilleure série de ces 90 derniers jours (le niveau dit la force d'aujourd'hui, pas d'il y a un an)
const STRENGTH_WINDOW_DAYS = 90;

// Exercice principal d'un nom (bibliothèque, alias compris : « Développé couché », « bench press ») ou null.
// Les variantes (haltères, machine, prise serrée, sumo) n'ont pas de repères : elles ne comptent pas.
function strengthLiftOf(name) {
  const e = catalogueEntry(name);
  return e ? STRENGTH_LIFTS.find(l => l.name === e.name) || null : null;
}

// Repères à utiliser : 'male', 'female', ou null (pas de réponse, ou « Ne pas préciser ») : pas de palier
function strengthSex(d = data) {
  return d?.strengthSex === 'male' || d?.strengthSex === 'female' ? d.strengthSex : null;
}

// Seuils [novice, intermédiaire, avancé, élite] de la catégorie de poids de bodyKg
function strengthThresholds(lift, bodyKg, sex) {
  const classes = STRENGTH_STANDARDS[lift.id]?.[sex];
  return classes ? classes.find(c => c.max === null || bodyKg <= c.max).thr : null;
}

// Meilleur 1RM estimé d'un exercice principal : { e1rm, date } ou null. Séries de travail en répétitions
// (1 à 12 : calc1RM, Epley), charge > 0. opts.now : fin de la fenêtre ; opts.before : séances strictement
// antérieures à cette date seulement (bilan : le niveau d'avant la séance).
function liftBestE1rm(history, lift, { now = Date.now(), before = Infinity } = {}) {
  const from = now - STRENGTH_WINDOW_DAYS * STRENGTH_DAY;
  let best = null;
  for (const h of history || []) {
    if (!h || !(h.date >= from) || h.date > now || h.date >= before) continue;
    for (const ex of h.exercises || []) {
      if (strengthLiftOf(ex.name)?.id !== lift.id || measureOf(ex) !== 'reps') continue;
      for (const s of workSets(ex.sets)) {
        const e1 = calc1RM(s.weight, s.reps);
        if (e1 && (!best || e1 > best.e1rm)) best = { e1rm: e1, date: h.date };
      }
    }
  }
  return best;
}

// Niveau d'un 1RM estimé : { lift, index, label, ratio, next: { label, kg } | null, progress 0..1 } ou null
// (sexe non précisé, poids du corps inconnu ou hors bornes). Sous le seuil Novice : Débutant ; au-delà du
// seuil Élite : Élite, sans palier suivant.
function strengthStanding(lift, e1rm, bodyKg, sex) {
  if (!lift || !(e1rm > 0) || !(bodyKg >= 25 && bodyKg <= 300)) return null;
  const thr = strengthThresholds(lift, bodyKg, sex);
  if (!thr) return null;
  const ratio = e1rm / bodyKg;
  const index = thr.filter(t => ratio >= t).length;
  const top = index === thr.length;
  const low = index === 0 ? 0 : thr[index - 1];
  const next = top ? null : { label: STRENGTH_LEVELS[index + 1], kg: Math.round(thr[index] * bodyKg * 10) / 10 };
  const progress = top ? 1 : Math.max(0, Math.min(1, (ratio - low) / (thr[index] - low)));
  return { lift: lift.id, index, label: STRENGTH_LEVELS[index], ratio: Math.round(ratio * 100) / 100, next, progress };
}

// Bilan d'une séance : niveau de chaque exercice principal fait, et palier franchi par rapport à avant
// la séance (même fenêtre de 90 jours). [{ name, standing, up }]
function sessionStrengthLevels(entry, history, bodyKg, sex) {
  if (!entry) return [];
  const done = new Set((entry.exercises || []).map(ex => strengthLiftOf(ex.name)).filter(Boolean));
  return STRENGTH_LIFTS.filter(l => done.has(l)).map(lift => {
    const after = liftBestE1rm(history, lift, { now: entry.date });
    const standing = after && strengthStanding(lift, after.e1rm, bodyKg, sex);
    if (!standing) return null;
    const prev = liftBestE1rm(history, lift, { now: entry.date, before: entry.date });
    const was = prev && strengthStanding(lift, prev.e1rm, bodyKg, sex);
    return { name: lift.name, standing, up: !!was && standing.index > was.index };
  }).filter(Boolean);
}
