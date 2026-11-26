// ═══════════════════════════════════════════════════════════
//  Notes : saisie en séance et relecture (carte d'exercice, série, haut de la séance, Historique, fiche)
//  Logique et données : js/data/notes.js. Discrètes par principe : rien ne s'affiche tant qu'il n'y a pas
//  de note, sauf le lien « Note » au bout d'un exercice (la case « Avant » d'une série ouvre sa note, sans icône).
//
//  - Exercice : menu ⋯ › Plus d'options… › « Ajouter une note », ou l'icône au bout de la carte repliée. La note la plus
//    récente de l'exercice (même fiche de la bibliothèque) se lit sous son nom à la séance suivante,
//    en gris : « Dernière note : siège cran 4 » ; un toucher la modifie ou l'efface.
//  - Série : la case « Avant » de chaque série (à faire ou validée) ouvre sa note ; une icône pleine y paraît quand la
//    série en a une, et la note se lit sous la ligne (ou celle de la même série la dernière fois, sur une série à faire).
//    Jamais au toucher de validation, jamais par un appui long (règle iOS « un seul tap »).
//  - Fin d'exercice : lien « Note » au pied de la carte, et « Note » sous le résumé de la carte repliée.
//  - Séance : la note du bilan revient en haut de la même séance du programme, la fois suivante, et se ferme.
// ═══════════════════════════════════════════════════════════
'use strict';

const NOTE_CLEAR = Object.freeze({ clear: true });   // valeur du choix « Effacer » (dialog la rend telle quelle)

// Saisie d'une note : { text } à enregistrer, { clear: true } à effacer (ou champ vidé), null si annulé.
// Une ligne de 140 caractères dans l'alerte iOS à champ ; « Supprimer » seulement s'il y a une note.
// « Visible par toi seul » : vrai tant que le serveur ne transmet ni les notes d'exercice ni celles de série au coach
// (private.session_for_coach) ; à revoir le jour où il les transmettra. La note de séance, elle, part au coach.
async function askNote({ title, message, value = '', canClear = false, placeholder = 'Ex. siège cran 4' }) {
  const actions = canClear
    ? [{ label: 'Enregistrer', style: 'preferred' }, { label: 'Supprimer', value: NOTE_CLEAR, style: 'destructive' }, { label: 'Annuler', style: 'cancel' }]
    : [{ label: 'Annuler', style: 'cancel' }, { label: 'Enregistrer', style: 'preferred' }];
  const r = await dialog({ title, message, input: { value, placeholder, text: true, max: NOTE_MAX, label: 'Note' }, actions });
  if (r === null || r === undefined) return null;
  if (r === NOTE_CLEAR) return NOTE_CLEAR;
  const text = cleanNote(r);
  return text ? { text } : (canClear ? NOTE_CLEAR : null);
}

// ── Exercice ────────────────────────────────────────────────

// Note affichée sur la carte : celle de la séance en cours, sinon la dernière de l'historique.
// { text, own } ou null ; last : { hid, xi } de la note de l'historique
function exNoteShown(ex) {
  const own = cleanNote(ex?.note);
  if (own) return { text: own, own: true };
  const last = ex ? lastExerciseNote(ex.name) : null;
  return last ? { text: last.text, own: false, last } : null;
}

// Ligne grise sous le nom : « Dernière note : … » (ou « Note : … » écrite pendant la séance). Rien sans note.
// tag : lettre du superset (A1, B…) quand la carte en réunit plusieurs
function exNoteLineHtml(ex, ei, tag = '') {
  const n = exNoteShown(ex);
  if (!n) return '';
  const lbl = n.own ? 'Note' : 'Dernière note';
  return `
      <button class="ex-note" data-action="ex-note" data-ei="${ei}" aria-label="${tag ? `${esc(ex.name)}, ` : ''}${lbl} : ${esc(n.text)}. Modifier la note">
        ${tag ? `<span class="ss-tag ss-tag--sm" aria-hidden="true">${tag}</span>` : icon('note', 14)}
        <span class="ex-note__text" aria-hidden="true"><span class="ex-note__lbl">${lbl} :</span> ${esc(n.text)}</span>
      </button>`;
}

// Carte repliée (exercice terminé) : note de la séance sous le résumé, et l'icône pour en écrire une
function collapsedNoteLineHtml(ex) {
  const own = cleanNote(ex?.note);
  return own ? `<span class="ex-summary__note">${icon('note', 12)}<span>${esc(own)}</span></span>` : '';
}
// Lien texte (une icône = un sens : l'icône grise reste l'étiquette d'une note, jamais un bouton)
function collapsedNoteBtnHtml(ex, ei) {
  const own = cleanNote(ex?.note);
  return `<button class="ex-note-link" data-action="ex-note" data-ei="${ei}" aria-label="${own ? 'Modifier la note' : 'Ajouter une note'}, ${esc(ex.name)}">${own ? 'Modifier la note' : 'Note'}</button>`;
}

// Choix du menu ⋯
function exNoteMenuLabel(ex) { return exNoteShown(ex) ? 'Modifier la note' : 'Ajouter une note'; }

async function editExerciseNote(ei) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  const shown = exNoteShown(ex);
  const r = await askNote({ title: ex.name, message: 'Affichée à ta prochaine séance de cet exercice. Visible par toi seul.', value: shown?.text || '', canClear: !!shown });
  if (!r || !activeSession || activeSession.exercises[ei] !== ex) return;
  if (r === NOTE_CLEAR) {
    // La note de la séance d'abord ; sans elle, celle de la dernière fois, retirée de sa séance (synchronisée)
    if (ex.note !== undefined) delete ex.note;
    else if (shown?.last && clearHistoryExerciseNote(shown.last.hid, shown.last.xi)) save();
    announce('Note supprimée');
  } else {
    if (!shown?.own && shown?.text === r.text) return;   // « Dernière note » relue sans changement
    ex.note = r.text;
    announce('Note enregistrée');
  }
  haptic();
  persistSession();
  render();
}

// ── Série ───────────────────────────────────────────────────

// Toute série (à faire, validée, rouverte) : la case « Avant » est le bouton de sa note (demande du 16/11 : « une petite
// partie dans chaque série, on clique dessus pour écrire et/ou voir la note »). Aucune colonne de plus sur iPhone SE.
// Sans note, la case ne montre que la valeur d'avant : l'icône au trait sous chaque série faisait deux icônes « note »
// avec le lien « Note » du pied de la carte, sous un titre « Avant » qui parle d'autre chose (retour d'Inès du 26/11) ;
// le lien « Note » reste la seule entrée visible. Note écrite : l'icône remplie dit qu'il y en a une. Loin du champ Reps et du ✓
// prevHtml : contenu de la case (« 32 × 9 », ou « — »), prevSpoken : la même valeur pour VoiceOver (WCAG 2.5.3)
// who : « de la série 3, bras droit » sur une série notée par bras (deux lignes, une même note : VoiceOver dit laquelle)
function setNoteBtnHtml(ex, ei, s, si, prevHtml, prevSpoken, who = '') {
  const own = cleanNote(s?.note), last = !own && !s?.done ? cleanNote(s?.prev?.note) : null;
  // La série et l'exercice sont dits par la tête de ligne et le groupe (js/features/session.js, renderSetRow)
  const of = who ? ` ${who}` : '';
  const what = own ? `Note${of} : ${esc(own)}. Modifier la note`
    : `Ajouter une note${of}${last ? `. La dernière fois : ${esc(last)}` : ''}`;
  return `<button class="set-prev set-note-btn num${own ? ' set-note-btn--on' : ''}" data-action="set-note" data-ei="${ei}" data-si="${si}" aria-label="${prevSpoken ? `Avant ${prevSpoken}. ` : ''}${what}"><span class="set-note-btn__val">${prevHtml}</span>${own ? `<span class="set-note-btn__ico">${icon('note.fill', 14)}</span>` : ''}</button>`;
}
// Sous la ligne, seulement quand il y a quoi lire : la note de la série, sinon (série à faire) celle de la même série la
// dernière fois. Lue par VoiceOver dans le bouton ci-dessus et la phrase de la série validée ; ici, un toucher l'ouvre
function setNotePreviewHtml(ei, s, si) {
  const own = cleanNote(s?.note), last = !own && !s?.done ? cleanNote(s?.prev?.note) : null;
  if (!own && !last) return '';
  return `<span class="set-note-prev" data-action="set-note" data-ei="${ei}" data-si="${si}" aria-hidden="true">${last ? '<span class="set-note-prev__lbl">La dernière fois :</span> ' : ''}${esc(own || last)}</span>`;
}

// Fin de l'exercice (pied de la carte, entre « + Série » et « Plus tard ») : la note de l'exercice, sans chercher dans ⋯.
// Lien texte comme ses voisins ; la note elle-même se lit sous le nom (exNoteLineHtml)
function exNoteFootHtml(ex, ei) {
  const shown = exNoteShown(ex);
  return `<button class="add-set-link ex-foot-note" data-action="ex-note" data-ei="${ei}" aria-label="${shown?.own ? 'Modifier la note' : 'Ajouter une note'} de l'exercice, ${esc(ex.name)}">Note</button>`;
}

async function editSetNote(ei, si) {
  const ex = activeSession?.exercises[ei], s = ex?.sets[si];
  if (!s) return;
  // Série rouverte : rien de tapé, elle se referme simplement ; une valeur tapée est enregistrée d'abord
  if (editingSet) {
    if (editingSet.weight === undefined && editingSet.reps === undefined) { editingSet = null; document.activeElement?.blur?.(); }
    else if (!saveEditedSet()) return;
  }
  const had = cleanNote(s.note), last = !had ? cleanNote(s.prev?.note) : null;
  const r = await askNote({ title: `Note · ${setSpokenName(ex, si)}`, message: `${ex.name}.${last ? ` La dernière fois : ${last}.` : ''} Visible par toi seul.`, value: had || '', canClear: !!had,
    placeholder: 'Ex. dernière rep difficile, épaule OK' });
  if (activeSession?.exercises[ei]?.sets[si] !== s) return;
  if (r === NOTE_CLEAR) { delete s.note; announce('Note supprimée'); }
  else if (r) { s.note = r.text; announce('Note enregistrée'); }
  if (r) haptic();
  persistSession();
  render();
}

// ── Séance : note de la dernière fois ───────────────────────

// En haut de la séance : la note du bilan de la dernière séance du même type, tant qu'on ne l'a pas fermée
function lastSessionNoteHtml() {
  if (!activeSession || activeSession.lastNoteOff) return '';
  const n = lastSessionNote(activeSession.programme, activeSession.category);
  if (!n) return '';
  return `
        <div class="sess-lastnote" role="note">
          <span class="sess-lastnote__icon">${icon('note', 16)}</span>
          <p class="sess-lastnote__text"><span class="sess-lastnote__lbl">Note de la dernière fois :</span> ${esc(n.text)}</p>
          <button class="sess-lastnote__close" data-action="sess-lastnote-close" aria-label="Masquer la note (elle reste dans l'historique)">${icon('xmark', 16)}</button>
        </div>`;
}

// ── Relecture : Historique et fiche de l'exercice ───────────

// Historique › Séance, sous un exercice : sa note, puis les notes de ses séries
function historyNotesHtml(e) {
  const own = cleanNote(e?.note);
  const sets = setNotesOf(e);
  return (own ? `<span class="hex__note">${icon('note', 12)}<span>${esc(own)}</span></span>` : '')
    + sets.map(n => `<span class="hex__note hex__note--set">${icon('note', 12)}<span><span class="hex__note-lbl">${esc(n.label)} :</span> ${esc(n.text)}</span></span>`).join('');
}

// Fiche de l'exercice (Bibliothèque) : notes récentes, datées, chacune vers sa séance. limit : 1 dans À propos
function libExNotesHtml(name, limit) {
  const list = exerciseNotes(name, data.history, limit);
  if (!list.length) return '';
  return `<div class="group-title">${limit === 1 ? 'Dernière note' : 'Notes'}</div>
        <div class="group">${list.map(n => `
          <button class="cell cell--nav ex-notecell" data-action="open-history" data-id="${esc(n.hid)}">
            <span class="cell__body"><span class="cell__title cell__title--reg">${esc(n.text)}</span><span class="cell__sub">${esc(fmtDate(n.date))}</span></span>${icon('chevron.right', 16)}
          </button>`).join('')}</div>`;
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'ex-note': async (e, el) => { await editExerciseNote(parseInt(el.dataset.ei)); },
  'set-note': async (e, el) => { await editSetNote(parseInt(el.dataset.ei), parseInt(el.dataset.si)); },
  'sess-lastnote-close': () => {
    if (!activeSession) return;
    activeSession.lastNoteOff = true;
    haptic();
    persistSession();
    render();
  },
});
