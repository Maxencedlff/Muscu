// ═══════════════════════════════════════════════════════════
//  Prise d'un exercice : choix (Programme › Exercice, feuille de la séance) et ligne sous le nom
//  Donnée et règles : js/data/grips.js ; décisions : docs/PRISES.md
// ═══════════════════════════════════════════════════════════
'use strict';

const GRIP_DIM_LABEL = { hand: 'Sens des mains', width: 'Largeur', tool: 'Poignée' };
const GRIP_HELP = 'Pronation : paumes vers l\'avant ou vers le bas. Supination : paumes vers toi. Neutre : paumes face à face.';

// Prise de l'exercice de la séance : copiée du programme au démarrage, changée par la feuille ou par
// Programme › Exercice (qui suivent tous deux la séance en cours) ; null sans prise
function sessGripOf(ex) { return cleanGrip(ex?.grip, ex); }

// Rangées de pastilles, une par réglage proposé ; un nouveau toucher sur la pastille choisie la retire
function gripChipsHtml(opts, grip, action, extra = '') {
  return Object.keys(GRIP_DIMS).filter(dim => opts[dim]).map(dim => `
      <div class="grip__row">
        <div class="grip__lbl" id="grip-lbl-${dim}">${GRIP_DIM_LABEL[dim]}</div>
        <div class="grip__chips" role="group" aria-labelledby="grip-lbl-${dim}">
          ${opts[dim].map(v => {
            const on = grip?.[dim] === v, lbl = GRIP_DIMS[dim].find(c => c[0] === v)[1];
            return `<button class="ax__chip grip__chip" data-action="${action}" data-dim="${dim}" data-v="${v}" ${extra} aria-pressed="${on}">${lbl}</button>`;
          }).join('')}
        </div>
      </div>`).join('');
}

// Pastilles mises à jour sur place (aria-pressed) : la feuille n'est pas reconstruite, VoiceOver garde
// la pastille touchée et annonce son nouvel état
function gripSyncChips(root, grip) {
  root?.querySelectorAll('.grip__chip').forEach(b => b.setAttribute('aria-pressed', String(grip?.[b.dataset.dim] === b.dataset.v)));
}

// Prise choisie après un toucher : la pastille déjà choisie se retire, une autre la remplace
function gripToggled(grip, dim, v) {
  const g = { ...(grip || {}) };
  if (g[dim] === v) delete g[dim]; else g[dim] = v;
  return cleanGrip(g);
}

// ── Séance : ligne sous le nom, et la photo quand les coachs l'auront fournie ──
// « Prise serrée neutre · Triangle » ; si la dernière fois était différente : « Avant : prise large… »
function gripLineHtml(ex, ei, tag = '') {
  const g = sessGripOf(ex);
  if (!g) return '';
  const txt = gripText(g, ex);
  const last = cleanGrip(lastPerf(activeSession.programme, activeSession.category, ex)?.ex.grip, ex);
  const before = last && !sameGrip(last, g) ? gripText(last, ex) : '';
  const photo = gripPhoto(ex, g);
  return `
      <button class="ex-grip" data-action="ex-grip" data-ei="${ei}" aria-label="${tag ? `${esc(ex.name)}, ` : ''}${txt}${before ? `, la dernière fois ${before.toLowerCase()}` : ''}. Modifier la prise">
        ${photo ? `<img class="ex-grip__photo" src="${esc(photo)}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="ex-grip__text"><span class="ex-grip__main">${tag ? `<span class="ss-tag ss-tag--sm" aria-hidden="true">${tag}</span>` : ''}${txt}</span>${before ? `<span class="ex-grip__before">Avant : ${before.charAt(0).toLowerCase() + before.slice(1)}</span>` : ''}</span>
      </button>`;
}

// ── Séance : feuille « Prise » (menu ⋯ ou toucher sur la ligne) ──
let gripEditEi = null;
function gripSheetHtml(ei) {
  const ex = activeSession.exercises[ei], opts = gripOptionsFor(ex), g = sessGripOf(ex);
  return `
    <div class="rs rs--ex grip">
      <div class="rs__title">Prise · ${esc(ex.name)}</div>
      <div class="grip__now" aria-live="polite">${g ? gripText(g, ex) : 'Aucune prise précisée'}</div>
      ${gripChipsHtml(opts, g, 'sess-grip')}
      <div class="grip__help">${GRIP_HELP} ${sessionGripStaysInSession() ? 'Pour cette séance seulement : le programme de ton coach ne change pas.' : 'Elle reste dans le programme pour la prochaine fois.'}</div>
      <button class="rs__done" data-action="sheet-done">OK</button>
    </div>`;
}
function openGripSheet(ei) {
  const ex = activeSession?.exercises[ei];
  if (!ex || !gripOptionsFor(ex)) return;
  gripEditEi = ei;
  openSessSheet({ cls: 'sess-sheet--grip', label: 'Prise', html: gripSheetHtml(ei), onClose: () => { gripEditEi = null; render(); } });
}

// Programme reçu d'un coach : la prise changée en séance reste dans la séance (le programme du coach ne
// change pas, l'élève n'est pas marqué « modifié » ; js/data/coach.js, coachProgrammeStatus)
function sessionGripStaysInSession() { return !!data.userProgrammes?.[activeSession?.programme]?.fromCoach; }

// Prise de l'exercice ei de la séance : appliquée à la séance, et au programme perso (la prochaine fois aussi)
function setSessionGrip(ei, grip) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  const g = cleanGrip(grip, ex);
  ex.grip = g;   // null : prise retirée (ne reprend pas celle du programme)
  const inProg = sessionGripStaysInSession() ? null : sessExData(ex);
  if (inProg) { if (g) inProg.grip = g; else delete inProg.grip; save(); }
  persistSession();
}

// ── Programme › Exercice : rubrique « Prise » (brouillon exDraft, appliqué par OK) ──
function exGripHtml(d) {
  const ex = { name: d.name, measure: d.measure }, opts = gripOptionsFor(ex);
  if (!opts) return '';
  const g = cleanGrip(d.grip, ex);
  return `
        <div class="group-title">Prise</div>
        <div class="group"><div class="cell cell--ctl cell--wrap grip grip--cell">${gripChipsHtml(opts, g, 'ex-grip-pick')}</div></div>
        <div class="group-foot">${exGripFootText(g, ex)}</div>`;
}
function exGripFootText(g, ex) { return `${g ? `${gripText(g, ex)}. ` : ''}${GRIP_HELP} Montrée pendant la séance, sous le nom.`; }
// Nom ou mesure changés : la rubrique est redessinée (les réglages proposés en dépendent)
function refreshExGrip() { const box = $('#exGrip'); if (box && exDraft) box.innerHTML = exGripHtml(exDraft); }

// Prise du brouillon enregistrée sur l'exercice ex du programme, et sur la séance en cours qui le contient
function applyDraftGrip(ex, draft) {
  if (!draft || !('grip' in draft)) return;
  const g = cleanGrip(draft.grip, ex);
  if (g) ex.grip = g; else delete ex.grip;
  if (activeSession) activeSession.exercises.forEach(e => { if (e.exId === ex.id) e.grip = g; });
}

// Programme › Séance et écrans du coach : « Prise serrée neutre » sous le nom, '' sans prise
function gripSubHtml(ex, cls = 'cell__sub') {
  const t = gripText(ex?.grip, ex);
  return t ? `<span class="${cls} grip-sub">${t}</span>` : '';
}

registerActions({
  'ex-grip': (e, el) => openGripSheet(parseInt(el.dataset.ei)),
  'sess-grip': (e, el) => {
    if (gripEditEi === null || !activeSession) return;
    const ex = activeSession.exercises[gripEditEi];
    setSessionGrip(gripEditEi, gripToggled(sessGripOf(ex), el.dataset.dim, el.dataset.v));
    haptic();
    const sheet = el.closest('.grip'), g = sessGripOf(ex);
    gripSyncChips(sheet, g);
    const now = sheet?.querySelector('.grip__now');
    if (now) now.textContent = g ? gripText(g, ex) : 'Aucune prise précisée';
  },
  'ex-grip-pick': (e, el) => {
    if (!exDraft) return;
    const ex = { name: exDraft.name, measure: exDraft.measure };
    exDraft.grip = gripToggled(cleanGrip(exDraft.grip, ex), el.dataset.dim, el.dataset.v);
    // Sur place : la pastille touchée garde le focus de VoiceOver
    const box = $('#exGrip');
    gripSyncChips(box, cleanGrip(exDraft.grip, ex));
    const foot = box?.querySelector('.group-foot');
    if (foot) foot.textContent = exGripFootText(cleanGrip(exDraft.grip, ex), ex);
    haptic();
  },
});
