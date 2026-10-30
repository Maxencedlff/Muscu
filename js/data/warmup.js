// ═══════════════════════════════════════════════════════════
//  Échauffement : séries d'échauffement proposées avant les séries de travail
//  Logique pure ; la feuille est dans js/features/session-tools.js. Chargé avant store.js : isWarmupSet et
//  workSets servent au volume et aux records dès le chargement.
// ═══════════════════════════════════════════════════════════
'use strict';

// Une série d'échauffement porte warmup: true (champ de série, à côté de weight et reps). Elle compte dans
// la séance (coche, repos) mais JAMAIS dans le volume, les records, le 1RM estimé, les courbes de progrès,
// les séries par muscle, la meilleure série ni la cible de la prochaine séance (workSets). Une version
// précédente de l'app ignore le champ : elle voit des séries ordinaires. Le serveur n'envoie que weight,
// reps et dist d'une série (private.session_public, supabase/migrations/20261026050000_social.sql) : un coach
// ou un ami ne voit pas le marquage et compte ces séries dans son volume (docs/SEANCE_OUTILS.md).
function isWarmupSet(s) { return s?.warmup === true; }
function workSets(sets) { return (sets || []).filter(s => !isWarmupSet(s)); }

// Règle : trois paliers en pourcentage de la charge de travail, avec de moins en moins de répétitions :
// 40 % × 8, 60 % × 5, 80 % × 3. C'est une convention courante de montée en charge (« ramp-up »), pas un
// protocole publié avec ces chiffres : le NSCA (Essentials of Strength Training and Conditioning, chapitre
// sur l'échauffement) préconise un échauffement spécifique au mouvement, à charges légères puis croissantes ;
// Starting Strength (Rippetoe) une montée par paliers à peu près réguliers avec des reps qui diminuent,
// barre à vide d'abord. Les pourcentages sont le choix de l'app dans cet esprit.
const WARMUP_STEPS = [[0.4, 8], [0.6, 5], [0.8, 3]];

// Séries proposées pour une charge de travail (unité affichée). round : arrondi au matériel (roundLoad,
// js/data/plates.js). Un palier arrondi à la charge de travail ou au-delà disparaît ; deux paliers arrondis
// à la même charge ne font qu'une série (celle qui a le plus de reps). Charge nulle : rien.
// Renvoie [{ pct, load, reps }]
function warmupSets(workLoad, round = v => v) {
  const w = parseFloat(workLoad) || 0;
  if (w <= 0) return [];
  const out = [];
  for (const [pct, reps] of WARMUP_STEPS) {
    const load = Math.round(round(w * pct) * 100) / 100;
    if (!(load > 0) || load >= w || out.some(s => s.load === load)) continue;
    out.push({ pct, load, reps });
  }
  return out;
}

// Charge de travail d'un exercice de la séance (kg stockés) : la première série à faire, sinon sa valeur
// prévue ou celle de la dernière fois ; '' si rien
function warmupBaseKg(ex) {
  const s = workSets(ex?.sets).find(x => !x.done) || workSets(ex?.sets)[0];
  if (!s) return '';
  for (const v of [s.weight, s.plannedWeight, s.prev?.weight]) if (v !== '' && v != null && parseFloat(v) > 0) return String(v);
  return '';
}

// Numéro affiché d'une série : les séries d'échauffement ne comptent pas (la 1re série de travail reste « 1 »)
function setDisplayNo(sets, si) {
  let n = 0;
  for (let i = 0; i <= si && i < (sets || []).length; i++) if (!isWarmupSet(sets[i])) n++;
  return n;
}

// Un exercice peut recevoir un échauffement : répétitions en vraie charge, charge connue, aucune série
// faite ni d'échauffement déjà présent
function canWarmup(ex) {
  return measureOf(ex) === 'reps' && loadKind(ex) === 'charge' && warmupBaseKg(ex) !== ''
    && !(ex.sets || []).some(s => s.done || isWarmupSet(s));
}
