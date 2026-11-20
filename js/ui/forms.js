// ═══════════════════════════════════════════════════════════
//  Saisie : contrôle des valeurs et signalement des erreurs
// ═══════════════════════════════════════════════════════════
'use strict';

// Interrupteur iOS : le bouton de la rangée porte l'état (role="switch", aria-checked), le dessin est décoratif
function switchHtml(on) {
  return `<span class="switch ${on ? 'switch--on' : ''}" aria-hidden="true"><span class="switch__thumb"></span></span>`;
}

// Icône de ligne des Réglages, comme les Réglages d'iOS : symbole blanc dans un carré arrondi de couleur
// (css/theme-sobre-reglages.css). Décorative : le titre de la ligne dit tout, VoiceOver la saute.
// Teintes sobres, jamais l'orange des actions ni le rouge des muscles : blue, green, sable, gray.
const CELL_ICO_TONES = ['blue', 'green', 'sable', 'gray'];
function cellIco(name, tone = 'gray') {
  const t = CELL_ICO_TONES.includes(tone) ? tone : 'gray';
  return `<span class="set-ico set-ico--${t}" aria-hidden="true">${icon(name, 19)}</span>`;
}

// Ligne d'un formulaire qui porte un champ : le message d'erreur ou de limite s'écrit juste dessous
const FIELD_HOST_SEL = '.cell, .diet-field, .coach-req-field, .date-row, .ios-dialog__field';
function fieldHost(input) { return input?.closest?.(FIELD_HOST_SEL) || null; }
// Message sous le champ (cls : field-err rouge, field-hint gris), réutilisé s'il est déjà là ; retiré à la frappe
function fieldNote(input, msg, cls = 'field-err') {
  const host = fieldHost(input);
  if (!host) return false;
  let p = host.nextElementSibling?.matches?.('.field-err, .field-hint, .field-warn') ? host.nextElementSibling : null;
  if (!p) { p = document.createElement('p'); host.after(p); }
  p.className = cls; p.textContent = msg; p.id ||= 'fn-' + uid();
  // Erreur : lue tout de suite ; avertissement (collage coupé) : lu poliment ; aide : pas annoncée
  if (cls === 'field-err') p.setAttribute('role', 'alert'); else p.removeAttribute('role');
  if (cls === 'field-warn') p.setAttribute('aria-live', 'polite'); else p.removeAttribute('aria-live');
  input.setAttribute('aria-describedby', p.id);
  input.dataset.fieldNote = p.id;
  return true;
}
function clearFieldNote(input) {
  const id = input?.dataset?.fieldNote;
  if (!id) return;
  document.getElementById(id)?.remove();
  delete input.dataset.fieldNote;
  if (input.getAttribute('aria-describedby') === id) input.removeAttribute('aria-describedby');
}

// Signale un champ invalide (contour rouge, aria-invalid) et dit pourquoi juste sous lui, ramené à l'écran (panel du
// 20/11 : un toast de deux lignes coupait le message, loin du champ). Séries de la séance : message en ligne de la carte.
function flagInvalid(input, msg) {
  if (input) {
    input.classList.add('set-input--error');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
  if (input && !input.closest('.session-set') && fieldNote(input, msg)) {
    input.scrollIntoView?.({ block: 'center' });
    announce(msg, true);
    return;
  }
  showToast(msg, { error: true });
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

// Saisie dans un champ : son message d'erreur s'efface (contour rouge compris). Texte collé ou tapé jusqu'au bout d'un
// champ borné (maxlength) : la limite est dite SOUS le champ (« Coupé à 80 caractères » pour un collage trop long),
// jamais coupée en silence (grille avant panel, règle 18) ni en toast par-dessus une autre ligne (panel du 20/11).
// Pas pour les nombres (leur message de refus suffit) ni pour une zone qui a déjà son compteur.
function fieldLimitNotice(e) {
  const el = e.target;
  if (el?.dataset?.fieldNote) {
    clearFieldNote(el);
    el.classList.remove('set-input--error'); el.removeAttribute('aria-invalid');
  }
  if (!el?.matches?.('input[maxlength], textarea[maxlength]') || /numeric|decimal/.test(el.inputMode || '')) return;
  if (el.getAttribute('aria-describedby')?.includes('Count')) return;   // compteur « 120/1000 » déjà affiché
  const max = el.maxLength, before = el._lenBefore ?? 0, pasted = el._pasted;
  el._pasted = false;
  if (!(max > 0) || el.value.length < max) return;
  // Collage coupé : sur iOS, un vrai collage (insertFromPaste) arrive SANS e.data ; on le reconnaît à son type, à
  // l'événement paste, ou à un saut de plus d'un caractère (panel du 20/11, t2 : jamais signalé sur iPhone)
  const cut = pasted || /^insertFrom(Paste|Drop)$|^insertReplacementText$/.test(e.inputType || '')
    || el.value.length - before > 1 || (typeof e.data === 'string' && e.data.length > 1);
  if (cut) {
    if (fieldNote(el, `Coupé à ${max} caractères`, 'field-warn')) announce(`Coupé à ${max} caractères`);
    else showToast(`Coupé à ${max} caractères`);
    // Début du nom gardé à l'écran pour le relire ; le curseur reste où il est (la frappe suivante le ramène)
    requestAnimationFrame(() => { el.scrollLeft = 0; el.scrollTop = 0; });
  } else if (!fieldNote(el, `${max} caractères au plus`, 'field-hint')) showToast(`${max} caractères au plus`);
}
// Longueur juste avant chaque saisie, et collage repéré : fieldLimitNotice sait si le texte est arrivé d'un coup
function fieldBeforeInput(e) { if (e.target?.matches?.('input, textarea')) e.target._lenBefore = e.target.value.length; }
function fieldPaste(e) { if (e.target?.matches?.('input, textarea')) { e.target._pasted = true; e.target._lenBefore = e.target.value.length; } }
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('beforeinput', fieldBeforeInput, true);
  document.addEventListener('paste', fieldPaste, true);
  document.addEventListener('input', fieldLimitNotice, true);
}
