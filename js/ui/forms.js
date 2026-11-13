// ═══════════════════════════════════════════════════════════
//  Saisie : contrôle des valeurs et signalement des erreurs
// ═══════════════════════════════════════════════════════════
'use strict';

// Interrupteur iOS : le bouton de la rangée porte l'état (role="switch", aria-checked), le dessin est décoratif
function switchHtml(on) {
  return `<span class="switch ${on ? 'switch--on' : ''}" aria-hidden="true"><span class="switch__thumb"></span></span>`;
}

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
// « = Pec deck » sous un nom qui est un alias d'une fiche de la bibliothèque (catalogueAliasOf) ; '' sinon
function aliasNoteHtml(name, cls = 'ex-alias') {
  const own = catalogueAliasOf(name);
  return own ? `<div class="${cls}"><span class="visually-hidden">Même exercice que </span><span aria-hidden="true">= </span>${esc(own)}</div>` : '';
}
function distMsg() { return `Distance entre 0 et ${MAX_DIST_KM} km`; }
function setDist(s, raw) {
  const km = String(raw ?? '').trim() === '' ? null : num(raw, 0, MAX_DIST_KM);
  if (km) s.dist = String(km); else delete s.dist;
}

// Champ de reps (ou de durée) : ne garde que les chiffres, dans le champ comme dans la valeur rendue
function repsInput(el) {
  const v = cleanReps(el.value);
  if (v !== el.value) el.value = v;
  return v;
}

function weightMsg() {
  return `Poids entre 0 et ${data.unit === 'lbs' ? '2205' : '1000'} ${unitLbl()}`;
}

// Charge saisie (unité affichée) valide ? '' (poids du corps) est accepté. Au plus 4 chiffres et
// 2 décimales (fmtW n'en affiche pas plus) : « 1,000 » est une faute de frappe, pas 1 kg (audit du 12/11, m3)
const LOAD_RE = /^\d{1,4}(?:[.,]\d{1,2})?$/;
function weightOk(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return true;
  if (!LOAD_RE.test(s)) return false;
  const v = num(s, 0, data.unit === 'lbs' ? 1000 * KG_TO_LBS + 0.5 : 1000);
  return v !== null;
}
