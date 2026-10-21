// ═══════════════════════════════════════════════════════════
//  Réglages › Supprimés récemment : restaurer ou effacer pour de bon
// ═══════════════════════════════════════════════════════════
'use strict';

// Données et règles : js/data/trash.js. Comme « Supprimés récemment » de Photos :
// une séance y reste TRASH_DAYS jours, un programme jusqu'à ce qu'il soit restauré.

function trashCount() {
  return (data.trash || []).length + archivedProgrammes().length;
}

function trashSessionCell(t) {
  const h    = t.entry;
  const meta = sessionMeta(h.category, h.programme || 'ppl');
  const left = trashDaysLeft(t);
  return `
    <div class="hrow">
      <button class="hcell" data-action="trash-session" data-id="${esc(h.id)}">
        <span class="hcell__dot" style="background:${meta.color}"></span>
        <span class="hcell__body">
          <span class="hcell__top"><span class="hcell__title">${meta.label}</span><span class="hcell__date">${fmtDate(h.date)}</span></span>
          <span class="hcell__sub">Supprimée ${agoText(t.deletedAt)} · encore ${plural(left, 'jour', 'jours')}</span>
        </span>
        ${icon('chevron.right', 16)}
      </button>
    </div>`;
}

function trashProgrammeCell([id, p]) {
  const n = (data.history || []).filter(h => h.programme === id).length;
  return `
    <button class="cell cell--nav" data-action="trash-programme" data-id="${esc(id)}">
      <span class="cell__body">
        <span class="cell__title">${esc(p.name)}</span>
        <span class="cell__sub">${n ? `${plural(n, 'séance', 'séances')} dans l'historique` : 'Aucune séance faite'}</span>
      </span>
      <span class="cell__value">Restaurer</span>
    </button>`;
}

function renderTrash() {
  const sessions = data.trash || [];
  const progs    = archivedProgrammes();
  const body = !sessions.length && !progs.length
    ? `<div class="empty-note">Rien à récupérer.<br>Les séances et programmes supprimés apparaîtront ici.</div>`
    : `${progs.length ? `
        <div class="group-title">Programmes</div>
        <div class="group">${progs.map(trashProgrammeCell).join('')}</div>
        <div class="group-foot">Un programme supprimé reste ici jusqu'à ce que tu le restaures.</div>` : ''}
      ${sessions.length ? `
        <div class="group-title">Séances</div>
        <div class="group">${sessions.map(trashSessionCell).join('')}</div>
        <div class="group-foot">Chaque séance est effacée définitivement ${TRASH_DAYS} jours après sa suppression.</div>
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="trash-empty">${sessions.length > 1 ? `Effacer les ${sessions.length} séances définitivement` : 'Effacer la séance définitivement'}</button>
        </div>` : ''}`;
  return `
    <div class="view trash-view view--grouped">
      ${navBar({ title: 'Supprimés récemment' })}
      <div class="scr">${body}</div>
    </div>`;
}

registerActions({
  'go-trash': () => navigate('trash'),
  'trash-session': async (e, el) => {
    const t = (data.trash || []).find(x => x.entry.id === el.dataset.id);
    if (!t) return;
    const meta = sessionMeta(t.entry.category, t.entry.programme || 'ppl');
    const choice = await dialog({ type: 'sheet', title: `${meta.label} du ${fmtDate(t.entry.date)}`, actions: [
      { label: 'Restaurer dans l\'historique', value: 'restore', style: 'preferred' },
      { label: 'Effacer définitivement', value: 'purge', style: 'destructive' },
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (choice === 'restore') {
      restoreFromTrash(t.entry.id);
      historyChanged();
      render(); showToast('Séance restaurée');
    } else if (choice === 'purge') {
      if (!(await confirmSheet('Effacer cette séance ?', 'Elle ne pourra plus être récupérée.', 'Effacer définitivement'))) return;
      purgeFromTrash(t.entry.id);
      save(); render(); showToast('Séance effacée');
    }
  },
  'trash-programme': async (e, el) => {
    const up = data.userProgrammes?.[el.dataset.id];
    if (!up?.archived) return;
    if (!(await confirmSheet(`Restaurer « ${up.name} » ?`, 'Il revient dans tes programmes, avec ses séances et ses exercices.', 'Restaurer', false))) return;
    restoreProgramme(el.dataset.id);
    save(); render(); showToast('Programme restauré');
  },
  'trash-empty': async () => {
    const n = (data.trash || []).length;
    if (!n) return;
    if (!(await confirmSheet(n > 1 ? `Effacer les ${n} séances définitivement ?` : 'Effacer la séance définitivement ?', 'Elles ne pourront plus être récupérées.', 'Tout effacer'))) return;
    emptyTrash();
    save(); render(); showToast('Corbeille vidée');
  },
});
