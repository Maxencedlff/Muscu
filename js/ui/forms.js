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
// Zone de texte hors ligne de formulaire (notes du bilan, séance ajoutée) : le message va juste sous elle
function fieldHost(input) { return input?.closest?.(FIELD_HOST_SEL) || (input?.matches?.('textarea') ? input : null); }
// Message sous le champ (cls : field-err rouge, field-hint gris), réutilisé s'il est déjà là ; retiré à la frappe
// aria-describedby : une liste d'identifiants (aide d'origine : #coachCardHelp, #payCodeHelp…) ; on ajoute ou on retire le
// sien sans jamais écraser les autres
function describedAdd(el, id) {
  const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (!ids.includes(id)) el.setAttribute('aria-describedby', [...ids, id].join(' '));
}
function describedRemove(el, id) {
  const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== id);
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' ')); else el.removeAttribute('aria-describedby');
}
// detail : seconde ligne en texte secondaire (texte gardé d'un collage coupé, en texte très grand).
// live : le message est lu par VoiceOver dès qu'il paraît (seul canal : jamais en plus d'announce ni d'un focus)
function fieldNote(input, msg, cls = 'field-err', detail = '', live = true) {
  const host = fieldHost(input);
  if (!host) return false;
  let p = host.nextElementSibling?.matches?.('.field-err, .field-hint, .field-warn') ? host.nextElementSibling : null;
  if (!p) { p = document.createElement('p'); host.after(p); }
  p.className = cls; p.textContent = msg; p.id ||= 'fn-' + uid();
  if (detail) { const d = document.createElement('span'); d.className = 'field-note__detail'; d.textContent = detail; p.append(d); }
  // Erreur : lue tout de suite ; avertissement (collage coupé) : lu poliment ; aide : pas annoncée
  p.removeAttribute('role'); p.removeAttribute('aria-live');
  if (live && cls === 'field-err') p.setAttribute('role', 'alert');
  if (live && cls === 'field-warn') p.setAttribute('aria-live', 'polite');
  describedAdd(input, p.id);
  input.dataset.fieldNote = p.id;
  return true;
}
function clearFieldNote(input) {
  const id = input?.dataset?.fieldNote;
  if (!id) return;
  document.getElementById(id)?.remove();
  delete input.dataset.fieldNote;
  describedRemove(input, id);
}

// Signale un champ invalide (contour rouge, aria-invalid) et dit pourquoi juste sous lui, ramené à l'écran (panel du
// 20/11 : un toast de deux lignes coupait le message, loin du champ). Séries de la séance : message en ligne de la carte.
// Un seul canal pour VoiceOver : champ déjà actif → message en role=alert ; sinon le focus qui y revient lit le champ et
// son message (aria-describedby), sans alerte en plus (audit du 20/11 : lu deux ou trois fois)
function flagInvalid(input, msg) {
  const wasActive = !!input && document.activeElement === input;
  if (input) {
    input.classList.add('set-input--error');
    input.setAttribute('aria-invalid', 'true');
  }
  if (input && !input.closest('.session-set') && fieldNote(input, msg, 'field-err', '', wasActive)) {
    if (!wasActive) input.focus();
    (fieldHost(input) || input).scrollIntoView?.({ block: 'center' });   // le champ avec son libellé (texte agrandi)
    return;
  }
  input?.focus();
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

// Collage dans un champ borné (logique pure, testée dans tests/unit/champs.mjs). value : la valeur après le collage
// (déjà coupée par le navigateur au maxlength) ; before, selStart, selEnd : la valeur et la sélection juste avant ;
// inserted : longueur du texte collé (presse-papier), null si inconnue. Rend { cut, value, caret } :
// - cut seulement si le texte collé a VRAIMENT été tronqué (avant − sélection remplacée + collé > max) ; inconnu :
//   un saut de plus d'un caractère qui arrive pile à la limite ;
// - une valeur d'avant déjà plus longue que la limite n'est jamais touchée ;
// - champ d'une ligne : on ne recule jusqu'à un espace qu'À L'INTÉRIEUR du morceau collé (le texte autour reste).
function pasteCut({ value, before, selStart = before, selEnd = selStart, inserted = null, max, single = true }) {
  const kept = before - (selEnd - selStart);
  if (!(max > 0) || before > max || value.length < max) return { cut: false, value, caret: null };
  const cut = inserted !== null ? kept + inserted > max : value.length - before > 1;
  if (!cut || !single) return { cut, value, caret: null };
  const start = Math.min(selStart, value.length), piece = value.slice(start, start + Math.max(0, value.length - kept));
  const sp = piece.lastIndexOf(' ');
  if (sp <= 0) return { cut, value, caret: null };
  const head = value.slice(0, start) + piece.slice(0, sp).trimEnd();
  return { cut, value: head + value.slice(start + piece.length), caret: head.length };
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
  const max = el.maxLength, before = el._lenBefore ?? el.value.length, len = el.value.length;
  const st = { selStart: el._selStart ?? before, selEnd: el._selEnd ?? before, inserted: el._insLen ?? null, pasted: el._pasted };
  el._pasted = false; el._insLen = null; el._lenBefore = null;
  if (!(max > 0)) return;
  // Zone de texte longue (notes de séance) : compteur à l'approche de la limite, comme les commentaires
  if (len < max) {
    if (el.matches('textarea') && max >= 200 && len >= max * 0.9) fieldNote(el, `${fmtNum(len)} / ${fmtNum(max)} caractères`, 'field-hint');
    return;
  }
  if (before > max) return;   // valeur d'avant plus longue que la limite : rien n'est coupé ni dit (correction auto comprise)
  // Collage (ou correction automatique, glisser-déposer) : coupé seulement si le texte inséré a vraiment été tronqué
  const insert = st.pasted || /^insertFrom(Paste|Drop)$|^insertReplacementText$/.test(e.inputType || '') || len - before > 1;
  const r = insert ? pasteCut({ value: el.value, before, selStart: st.selStart, selEnd: st.selEnd,
    inserted: st.inserted ?? (typeof e.data === 'string' ? e.data.length : null), max, single: el.matches('input') }) : { cut: false };
  if (r.cut) {
    // Coupe ramenée au dernier espace du morceau collé, avant que l'app lise la valeur (écouteur en capture)
    if (r.value !== el.value) { el.value = r.value; try { el.setSelectionRange(r.caret, r.caret); } catch { /* type sans sélection */ } }
    // Texte très grand : un champ d'une ligne n'en montre qu'un bout, le texte gardé est redit dessous
    const xl = el.matches('input') && document.documentElement.classList.contains('type-xl');
    if (fieldNote(el, cutNoticeText(max), 'field-warn', xl ? `Gardé : « ${el.value} »` : '')) {
      // Zone de texte : le message, sous elle, est ramené au-dessus des boutons fixes du bas (« Terminé » du bilan)
      if (el.matches('textarea')) document.getElementById(el.dataset.fieldNote)?.scrollIntoView({ block: 'center' });
    }
    else showToast(cutNoticeText(max));
    // Début du nom gardé à l'écran pour le relire ; le curseur reste où il est (la frappe suivante le ramène)
    if (el.matches('input')) requestAnimationFrame(() => { el.scrollLeft = 0; });
  } else if (!fieldNote(el, `${fmtNum(max)} caractères au plus`, 'field-hint')) showToast(`${max} caractères au plus`);
}
// Collage coupé (panel controle-champs t5 : « Coupé à 40 caractères » laissait croire le texte entier gardé) : la
// fin perdue est dite, en taille normale comme en texte très grand
function cutNoticeText(max) { return `Coupé à ${fmtNum(max)} caractères, la fin n'est pas gardée`; }
// Juste avant chaque saisie : longueur, sélection remplacée, longueur du texte inséré (presse-papier ou glisser) ;
// fieldLimitNotice sait alors si le texte arrivé d'un coup a vraiment été coupé
function fieldMark(el) { el._lenBefore = el.value.length; el._selStart = el.selectionStart ?? el.value.length; el._selEnd = el.selectionEnd ?? el._selStart; }
function fieldBeforeInput(e) {
  const el = e.target;
  if (!el?.matches?.('input, textarea')) return;
  fieldMark(el);
  const t = e.data ?? e.dataTransfer?.getData?.('text/plain');
  if (typeof t === 'string' && el._insLen == null) el._insLen = t.length;
}
function fieldPaste(e) {
  const el = e.target;
  if (!el?.matches?.('input, textarea')) return;
  fieldMark(el);
  el._pasted = true;
  const t = e.clipboardData?.getData?.('text/plain') ?? e.clipboardData?.getData?.('text');
  el._insLen = typeof t === 'string' ? t.length : null;
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('beforeinput', fieldBeforeInput, true);
  document.addEventListener('paste', fieldPaste, true);
  document.addEventListener('input', fieldLimitNotice, true);
}
