// ═══════════════════════════════════════════════════════════
//  Sauvegarde : import et export JSON
// ═══════════════════════════════════════════════════════════
'use strict';

// Importe une sauvegarde : tout est vérifié sur une copie, `data` n'est remplacé qu'à la fin
function importText(text) {
  let next, theme;
  try {
    const d = JSON.parse(text);
    if (!d || typeof d !== 'object') throw new Error('format');
    theme = d._theme;
    let candidate;
    if (d.exercises && !d.programmes) {
      // Ancien format (ppl_v1)
      candidate = makeDefaultData();
      candidate.programmes.ppl.exercises = clone(d.exercises);
      candidate.programmes.ppl.timers    = clone(d.timers || {});
      candidate.defaultRest = d.defaultRest || 90;
      candidate.history     = (Array.isArray(d.history) ? clone(d.history) : []).map(h => ({ ...h, programme: 'ppl' }));
    } else if (d.programmes && typeof d.programmes === 'object' && d.activeProgramme) {
      candidate = clone(d);
      delete candidate._theme;
    } else throw new Error('format');
    const given = Array.isArray(candidate.history) ? candidate.history.length : 0;
    next = sanitizeData(normalizeData(candidate));
    recomputePRFromHistory(next);
    // Un fichier dont aucune séance n'est lisible est refusé
    if (given > 0 && next.history.length === 0) throw new Error('history');
    next._skipped = given - next.history.length;
  } catch {
    showToast('Fichier invalide : rien n\'a été modifié', { error: true });
    return false;
  }
  const skipped = next._skipped; delete next._skipped;
  const previous = JSON.stringify(data);
  try { localStorage.setItem(BACKUP_KEY, previous); } catch {}
  data = next;
  if (!save()) { data = JSON.parse(previous); return false; }
  if (theme) applyTheme(theme);
  editorCat = statsCat = addCat = firstSession();
  syncTimersFromHistory();
  render();
  const n = data.history.length;
  showToast(`Import réussi : ${n} séance${n > 1 ? 's' : ''}${skipped ? ` (${skipped} ignorée${skipped > 1 ? 's' : ''})` : ''}`, {
    action: 'Annuler', duration: 6000,
    onAction: () => {
      data = normalizeData(JSON.parse(previous));
      save();
      editorCat = statsCat = addCat = firstSession();
      render(); showToast('Import annulé');
    },
  });
  return true;
}

// Exporte la donnée en JSON (feuille de partage si disponible, sinon téléchargement)
async function exportData() {
  const payload = { ...data, _theme: themePref() };
  const json  = JSON.stringify(payload, null, 2);
  const fname = `muscu-backup-${localISO()}.json`;
  const file  = typeof File === 'function' ? new File([json], fname, { type: 'application/json' }) : null;
  // Date de la dernière sauvegarde, affichée dans Réglages › Données
  const done = () => { data.lastExport = Date.now(); save(true); const t = $('#lastExportTxt'); if (t) { t.textContent = 'Dernière sauvegarde : aujourd\'hui'; t.classList.remove('txt-warn'); } };
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Sauvegarde MDLF Training' }); done(); return; }
    catch (err) { if (err?.name === 'AbortError') return; }
  }
  downloadText(json, fname);
  done();
}

function downloadText(text, fname) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a   = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
