// ═══════════════════════════════════════════════════════════
//  Saisie : contrôle des valeurs et signalement des erreurs
// ═══════════════════════════════════════════════════════════
'use strict';

// Signale un champ invalide (contour rouge, aria-invalid) et affiche le message
function flagInvalid(input, msg) {
  if (input) {
    input.classList.add('set-input--error');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
  showToast(msg);
}

// Distance (cardio) : '' accepté, sinon 0 à MAX_DIST_KM km, virgule ou point
function distOk(raw) { return String(raw ?? '').trim() === '' || num(raw, 0, MAX_DIST_KM) !== null; }
function distMsg() { return `Distance entre 0 et ${MAX_DIST_KM} km`; }
function setDist(s, raw) {
  const km = String(raw ?? '').trim() === '' ? null : num(raw, 0, MAX_DIST_KM);
  if (km) s.dist = String(km); else delete s.dist;
}

function weightMsg() {
  return `Poids entre 0 et ${data.unit === 'lbs' ? '2205' : '1000'} ${unitLbl()}`;
}

// Charge saisie (unité affichée) valide ? '' (poids du corps) est accepté
function weightOk(raw) {
  if (String(raw ?? '').trim() === '') return true;
  const v = num(raw, 0, data.unit === 'lbs' ? 1000 * KG_TO_LBS + 0.5 : 1000);
  return v !== null;
}
