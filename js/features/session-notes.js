// ═══════════════════════════════════════════════════════════
//  Notes : saisie en séance et relecture (carte d'exercice, série, haut de la séance, Historique, fiche)
//  Logique et données : js/data/notes.js. Discrètes par principe : rien ne s'affiche tant qu'il n'y a pas
//  de note, sauf une petite icône « note » au bout d'un exercice terminé (et le choix du menu ⋯).
//
//  - Exercice : menu ⋯ « Ajouter une note », ou l'icône au bout de la carte repliée. La note la plus
//    récente de l'exercice (même fiche de la bibliothèque) se lit sous son nom à la séance suivante,
//    en gris : « Dernière note : siège cran 4 » ; un toucher la modifie ou l'efface.
//  - Série : série validée touchée (rouverte), puis « Ajouter une note » sous ses champs. Jamais au toucher
//    de validation, jamais par un appui long (le toucher simple ouvre déjà la série, règle iOS « un seul tap »).
//  - Séance : la note du bilan revient en haut de la même séance du programme, la fois suivante, et se ferme.
// ═══════════════════════════════════════════════════════════
'use strict';

const NOTE_CLEAR = Object.freeze({ clear: true });   // valeur du choix « Effacer » (dialog la rend telle quelle)

// Saisie d'une note : { text } à enregistrer, { clear: true } à effacer (ou champ vidé), null si annulé.
// Une ligne de 140 caractères dans l'alerte iOS à champ ; « Effacer » seulement s'il y a une note.
async function askNote({ title, message, value = '', canClear = false }) {
  const actions = canClear
    ? [{ label: 'Enregistrer', style: 'preferred' }, { label: 'Effacer', value: NOTE_CLEAR, style: 'destructive' }, { label: 'Annuler', style: 'cancel' }]
    : [{ label: 'Annuler', style: 'cancel' }, { label: 'Enregistrer', style: 'preferred' }];
  const r = await dialog({ title, message, input: { value, placeholder: 'Ex. siège cran 4', text: true, max: NOTE_MAX, label: 'Note' }, actions });
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
function collapsedNoteBtnHtml(ex, ei) {
  const own = cleanNote(ex?.note);
  return `<button class="ex-note-btn${own ? ' ex-note-btn--on' : ''}" data-action="ex-note" data-ei="${ei}" aria-label="${own ? 'Modifier la note' : 'Ajouter une note'}, ${esc(ex.name)}">${icon('note', 20)}</button>`;
}

// Choix du menu ⋯
function exNoteMenuLabel(ex) { return exNoteShown(ex) ? 'Modifier la note' : 'Ajouter une note'; }

async function editExerciseNote(ei) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  const shown = exNoteShown(ex);
  const r = await askNote({ title: ex.name, message: 'Relue la prochaine fois sur cet exercice.', value: shown?.text || '', canClear: !!shown });
  if (!r || !activeSession || activeSession.exercises[ei] !== ex) return;
  if (r === NOTE_CLEAR) {
    // La note de la séance d'abord ; sans elle, celle de la dernière fois, retirée de sa séance (synchronisée)
    if (ex.note !== undefined) delete ex.note;
    else if (shown?.last && clearHistoryExerciseNote(shown.last.hid, shown.last.xi)) save();
    announce('Note effacée');
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

// Série validée rouverte : sous ses champs, « Ajouter une note » ou la note, à modifier
function setNoteLinkHtml(ex, ei, si) {
  const n = cleanNote(ex.sets[si]?.note);
  return `<button class="set-note-link" data-action="set-note" data-ei="${ei}" data-si="${si}" aria-label="${n ? `Note : ${esc(n)}. Modifier la note` : 'Ajouter une note'}, ${setRefName(ex, si)}, ${esc(ex.name)}">${icon('note', 14)}<span aria-hidden="true">${n ? esc(n) : 'Ajouter une note'}</span></button>`;
}
// Petit indicateur (10 px) sur une série validée qui a une note : après le numéro, dans le coin sous une lettre de superset
function setNoteDotHtml(s, tag = '') {
  return cleanNote(s?.note) ? `<span class="set-note-dot${tag ? ' set-note-dot--corner' : ''}" aria-hidden="true">${icon('note', 10)}</span>` : '';
}

async function editSetNote(ei, si) {
  const ex = activeSession?.exercises[ei], s = ex?.sets[si];
  if (!s) return;
  // Série rouverte : rien de tapé, elle se referme simplement ; une valeur tapée est enregistrée d'abord
  if (editingSet) {
    if (editingSet.weight === undefined && editingSet.reps === undefined) { editingSet = null; document.activeElement?.blur?.(); }
    else if (!saveEditedSet()) return;
  }
  const had = cleanNote(s.note);
  const r = await askNote({ title: `Note · ${setSpokenName(ex, si)}`, message: ex.name, value: had || '', canClear: !!had });
  if (activeSession?.exercises[ei]?.sets[si] !== s) return;
  if (r === NOTE_CLEAR) { delete s.note; announce('Note effacée'); }
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
          <button class="sess-lastnote__close" data-action="sess-lastnote-close" aria-label="Masquer la note de la dernière fois">${icon('xmark', 16)}</button>
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
