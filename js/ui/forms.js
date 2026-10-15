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

function weightMsg() {
  return `Poids entre 0 et ${data.unit === 'lbs' ? '2205' : '1000'} ${unitLbl()}`;
}

// Charge saisie (unité affichée) valide ? '' (poids du corps) est accepté
function weightOk(raw) {
  if (String(raw ?? '').trim() === '') return true;
  const v = num(raw, 0, data.unit === 'lbs' ? 1000 * KG_TO_LBS + 0.5 : 1000);
  return v !== null;
}
