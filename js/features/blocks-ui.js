// ═══════════════════════════════════════════════════════════
//  Rôle d'un bloc d'exercice (Normal, Pré-fatigue, Échauffement) : choix depuis le menu ⋯ de la séance et depuis
//  Programme › Exercice. Logique dans js/data/blocks.js.
// ═══════════════════════════════════════════════════════════
'use strict';

// Feuille du choix : 'normal', 'prefat', 'warmup', ou null (Annuler). Le rôle actuel est mis en avant.
async function pickBlockRole(ex, title = 'Rôle de l\'exercice') {
  const cur = blockRole(ex) || 'normal';
  // Rôle actuel dit en toutes lettres (le style seul ne se voit pas sur une feuille d'actions)
  const opt = (value, label) => ({ label: cur === value ? `${label} (actuel)` : label, value, ...(cur === value ? { style: 'preferred' } : {}) });
  return dialog({ type: 'sheet', title, message: BLOCK_ROLE_HELP, actions: [
    opt('normal', 'Normal'),
    opt('prefat', BLOCK_ROLES.prefat),
    opt('warmup', BLOCK_ROLES.warmup),
    { label: 'Annuler', style: 'cancel' },
  ] });
}

// Séance en cours : rôle du bloc ei, et du même bloc du programme (la prochaine fois aussi), sauf programme d'un coach
// (c'est lui qui le choisit, la séance seule change)
async function chooseSessionRole(ei) {
  const ex = activeSession?.exercises[ei];
  if (!ex) return;
  const pick = await pickBlockRole(ex, exLabel(ex));
  if (!pick || !activeSession || activeSession.exercises[ei] !== ex) return;
  const role = pick === 'normal' ? null : pick;
  if (role === blockRole(ex)) return;
  setBlockRole(ex, role);
  const inProg = coachLedProgramme(activeSession.programme) ? null : sessExData(ex);
  if (inProg) { if (role) inProg.role = role; else delete inProg.role; save(); }
  haptic();
  persistSession();
  render();
  showToast(role ? `${BLOCK_ROLES[role]} : hors records et volume` : 'Exercice normal');
}

// Programme › Exercice : rôle du bloc, en trois choix (brouillon exDraft, enregistré par « OK » : js/features/programme-editor.js)
function exRoleBtns(d) {
  const cur = d.role || 'normal';
  return [['normal', 'Normal'], ['prefat', BLOCK_ROLES.prefat], ['warmup', BLOCK_ROLES.warmup]].map(([k, label]) =>
    `<button class="segmented__btn ${cur === k ? 'segmented__btn--active' : ''}" aria-pressed="${cur === k}" data-action="ex-role" data-role="${k}">${label}</button>`).join('');
}
function exRoleHtml(d) {
  return `
        <div class="group-title">Rôle</div>
        <div class="group">
          <div class="cell cell--ctl cell--wrap">
            <div class="segmented seg-full seg-fit" role="group" aria-label="Rôle de l'exercice" id="exRole">${exRoleBtns(d)}</div>
          </div>
        </div>
        <div class="group-foot">${BLOCK_ROLE_HELP}</div>`;
}
// Rôle du brouillon appliqué à l'exercice du programme, et au même bloc de la séance en cours (comme la prise et le
// tempo : js/features/grip-ui.js, programme-editor.js)
function applyDraftRole(ex, d) {
  if (!d) return;
  const role = Object.hasOwn(BLOCK_ROLES, d.role) ? d.role : null;
  if (role === blockRole(ex)) return;
  if (role) ex.role = role; else delete ex.role;
  if (!activeSession) return;
  activeSession.exercises.forEach(e => { if (e.exId === exIdOf(ex) && occOf(e) === occOf(ex)) setBlockRole(e, role); });
  persistSession();
}

registerActions({
  'ex-role': (e, el) => {
    if (!exDraft) return;
    exDraft.role = Object.hasOwn(BLOCK_ROLES, el.dataset.role) ? el.dataset.role : null;
    const box = $('#exRole');
    if (box) box.innerHTML = exRoleBtns(exDraft);
    haptic();
  },
});
