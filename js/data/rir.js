// ═══════════════════════════════════════════════════════════
//  RIR (répétitions en réserve) : note facultative d'une série validée, et son équivalent RPE
//  Logique pure ; le sélecteur est dans js/features/session.js. Chargé avant store.js (cleanRir).
// ═══════════════════════════════════════════════════════════
'use strict';

// Champ de série rir : entier 0 à 4, 4 = « 4 ou plus », absent = non renseigné. Équivalence RPE de l'échelle
// RIR de Zourdos et al. (J Strength Cond Res, 2016) : RPE 10 = 0 en réserve, 9 = 1, 8 = 2, 7 = 3, 5-6 = 4 à 6.
// Jamais obligatoire : valider une série reste un seul toucher, le RIR se note après coup (ou pas).
// Une version précédente de l'app ignore le champ. Le serveur le transmet à un ami ou un coach (private.session_public,
// migration 20261031100000_records_series.sql) ; seul l'écran du coach l'affiche (js/features/coach-ui.js).
const RIR_MAX = 4;
const RIR_CHOICES = [0, 1, 2, 3, 4];

function cleanRir(v) { return num(v, 0, RIR_MAX, true); }

// « 10 », « 9 », …, « ≤ 6 » pour 4 et plus
function rirToRpe(rir) {
  const r = cleanRir(rir);
  if (r === null) return '';
  return r >= RIR_MAX ? '≤ 6' : String(10 - r);
}
// « 0 », « 1 », …, « 4+ »
function rirTxt(rir) {
  const r = cleanRir(rir);
  return r === null ? '' : r >= RIR_MAX ? `${RIR_MAX}+` : String(r);
}

// Réglage : sélecteur montré après chaque série (data.rirOn ; coupé pour un nouvel utilisateur, freshData,
// montré pour une donnée d'avant sans le champ ; propre à l'appareil)
function rirShown(d = data) { return d.rirOn !== false; }

// Effort d'une liste de séries : RPE moyen (4+ compté 6) des séries de travail notées, null sans note
function meanRpe(sets) {
  const vals = workSets(sets).map(s => cleanRir(s.rir)).filter(r => r !== null);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, r) => a + 10 - r, 0) / vals.length * 10) / 10;
}

// « Reps en réserve : 2 · 2 · 1 · — » : une valeur par série de travail, « — » quand elle n'est pas notée ;
// '' sans aucune note
function rirLine(sets) {
  const ws = workSets(sets);
  if (!ws.some(s => cleanRir(s.rir) !== null)) return '';
  return `Reps en réserve : ${ws.map(s => rirTxt(s.rir) || '—').join(' · ')}`;
}
