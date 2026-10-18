// ═══════════════════════════════════════════════════════════
//  Séance perso : nom, description, icône, couleur
// ═══════════════════════════════════════════════════════════
'use strict';

let csEditId    = null;   // séance modifiée, null pour une nouvelle séance
let csColor     = '#3b82f6';
let csProg      = 'custom';   // programme modifiable visé par l'écran Séance perso
let csIcon      = '🏋️';
const CS_ICONS  = ['🏋️','💪','🦾','🦵','🔥','⚡','🏃','🧘','🥊','🚴','🤸','🎯'];
const CS_COLORS = [['#FF9500','Orange'],['#FF3B30','Rouge'],['#FFCC00','Jaune'],['#34C759','Vert'],['#30B0C7','Turquoise'],
                   ['#007AFF','Bleu'],['#5856D6','Indigo'],['#AF52DE','Violet'],['#FF2D55','Rose'],['#8E8E93','Gris']];

// Séance Perso : nom, description, icône (grille), couleur
function renderCsEdit() {
  const isEdit   = csEditId !== null;
  const existing = isEdit ? (userSessions(csProg)?.[csEditId] || {}) : {};
  const icons    = CS_ICONS.includes(csIcon) ? CS_ICONS : [csIcon, ...CS_ICONS.slice(0, 11)];
  return `
    <div class="view cs-edit view--grouped">
      ${navBar({ title: isEdit ? 'Modifier la séance' : 'Nouvelle séance',
          left: `<button class="navbar__text" data-action="close-cs-modal">Annuler</button>`,
          right: `<button class="navbar__text navbar__text--bold" data-action="save-cs-modal">OK</button>` })}
      <div class="scr">
        <div class="group-title">Nom</div>
        <div class="group">
          <div class="cell cell--field"><input type="text" id="csName" class="field" value="${esc(existing.label)}"
               placeholder="Ex : Séance A" autocomplete="off" aria-label="Nom de la séance"></div>
          <div class="cell cell--field"><input type="text" id="csDesc" class="field" value="${esc(existing.desc)}"
               placeholder="Description (optionnel)" autocomplete="off" aria-label="Description"></div>
        </div>
        <div class="group-title">Icône</div>
        <div class="group group--pad">
          <div class="emoji-grid" role="radiogroup" aria-label="Icône">
            ${icons.map(ic => `<button class="emoji-btn ${ic === csIcon ? 'is-on' : ''}" role="radio" aria-checked="${ic === csIcon}" data-action="pick-cs-icon" data-icon="${esc(ic)}">${esc(ic)}</button>`).join('')}
          </div>
        </div>
        <div class="group-title">Couleur</div>
        <div class="group group--pad">
          <div class="color-grid" role="radiogroup" aria-label="Couleur">
            ${CS_COLORS.map(([c, n]) => `<button class="color-swatch ${c.toLowerCase() === String(csColor).toLowerCase() ? 'is-on' : ''}" role="radio" aria-checked="${c.toLowerCase() === String(csColor).toLowerCase()}" aria-label="${n}" data-action="pick-cs-color" data-color="${c}" style="--c:${c}"></button>`).join('')}
          </div>
        </div>
        ${isEdit ? `
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="delete-custom-session">Supprimer la séance</button>
        </div>` : ''}
      </div>
    </div>`;
}

// Écran « Nouvelle séance » du programme actif (ou de Perso pour un programme intégré)
function openNewSession() {
  csProg = isUserProg(data.activeProgramme) ? data.activeProgramme : 'custom';
  csEditId = null; csColor = '#FF9500'; csIcon = '🏋️';
  navigate('cs-edit');
}

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'add-custom-session': openNewSession,
  'edit-custom-session': (e, el) => {
    const id = el.dataset.id;
    csProg = isUserProg(data.activeProgramme) ? data.activeProgramme : 'custom';
    const cs = userSessions(csProg)?.[id] || {};
    csEditId = id; csColor = cs.color || '#FF9500'; csIcon = cs.icon || '🏋️';
    navigate('cs-edit');
  },
  'close-cs-modal': () => {
    csEditId = null; goBack();
  },
  'pick-cs-color': (e, el) => {
    csColor = el.dataset.color;
    document.querySelectorAll('.color-swatch').forEach(b => {
      const on = b.dataset.color === csColor;
      b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on);
    });
  },
  'pick-cs-icon': (e, el) => {
    csIcon = el.dataset.icon;
    document.querySelectorAll('.emoji-btn').forEach(b => {
      const on = b.dataset.icon === csIcon;
      b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on);
    });
  },
  'save-cs-modal': () => {
    const name = $('#csName')?.value.trim();
    const desc = $('#csDesc')?.value.trim() || '';
    if (!name) { flagInvalid($('#csName'), 'Entre un nom'); return; }

    const id = csEditId || newSessionId();
    const store = userSessions(csProg);
    if (!store) return;
    const prev = store[id];
    // Une séance copiée d'un programme intégré garde sa pastille à initiale tant qu'on ne choisit pas d'emoji
    store[id] = { label: name, icon: prev && !prev.icon && csIcon === '🏋️' ? '' : (csIcon || '🏋️'), desc, color: csColor };

    // Emplacements exercices / chrono / récupération
    const pd = data.programmes[csProg] ||= { exercises: {}, timers: {}, cooldowns: {} };
    pd.exercises ||= {}; pd.timers ||= {}; pd.cooldowns ||= {};
    if (!pd.exercises[id])  pd.exercises[id]  = [];
    if (!pd.timers[id])     pd.timers[id]     = null;
    if (pd.cooldowns[id] == null) pd.cooldowns[id] = 72;

    const wasEdit = csEditId !== null;
    csEditId = null;
    if (!addCat || !sessionKeys().includes(addCat)) addCat = firstSession();

    save();
    showToast(wasEdit ? 'Séance modifiée' : 'Séance créée');
    if (wasEdit) { goBack(); return; }
    // Nouvelle séance : on enchaîne sur ses exercices, recherche ouverte. L'écran du nom est remplacé,
    // le retour ramène donc à la liste des séances.
    editorEditing = false;
    navigate(makeRoute('editor', id), { replace: true });
    setTimeout(() => { if (currentRoute() === makeRoute('editor', id)) openAddExSheet({ target: 'programme' }); }, 380);
  },
  'delete-custom-session': async (e, el) => {
    // Depuis l'écran de la séance (data-id) ou depuis « Nom, icône et couleur » (csEditId)
    if (el.dataset.id) { csEditId = el.dataset.id; csProg = isUserProg(data.activeProgramme) ? data.activeProgramme : 'custom'; }
    const id = csEditId, pid = csProg;
    const running = activeSession && activeSession.programme === pid && activeSession.category === id;
    if (running && !(await confirmSheet('Cette séance est en cours', 'Elle sera abandonnée.', 'Supprimer'))) return;
    const n = (data.history || []).filter(h => h.category === id && h.programme === pid).length;
    const msg = n ? `Ses exercices seront supprimés et ${n} séance${n > 1 ? 's' : ''} de l'historique ser${n > 1 ? 'ont effacées' : 'a effacée'}.`
                  : 'Ses exercices seront supprimés.';
    if (!(await confirmSheet('Supprimer cette séance ?', msg, 'Supprimer'))) return;
    if (running) endSession();
    const store = userSessions(pid);
    if (id && store) {
      delete store[id];
      const pd = data.programmes[pid];
      if (pd) {
        delete pd.exercises?.[id];
        delete pd.timers?.[id];
        delete pd.cooldowns?.[id];
      }
      data.history = (data.history || []).filter(h => !(h.category === id && h.programme === pid));
    }
    csEditId = null;
    addCat   = firstSession();
    save();
    routeTo('programmes');
  },
});
