// ═══════════════════════════════════════════════════════════
//  Sauvegarde : import et export JSON
// ═══════════════════════════════════════════════════════════
'use strict';

// Importe une sauvegarde : tout est vérifié sur une copie, `data` n'est remplacé qu'à la fin.
// Aucun effet d'écran : l'appelant affiche le résultat.
//   { ok: false, reason: 'invalid' }  fichier illisible, rien n'a été modifié
//   { ok: false, reason: 'storage' }  stockage plein (save() l'a signalé), donnée d'avant remise
//   { ok: true, count, skipped, theme, previous }  previous : texte de la donnée remplacée (undoImport)
function importText(text) {
  let next, theme, skipped;
  try {
    const d = JSON.parse(text);
    if (!d || typeof d !== 'object') throw new Error('format');
    // Fichier d'une version plus récente de l'app : son format n'est pas encore connu
    if (d.schema != null && !(Number(d.schema) <= SCHEMA)) throw new Error('schema');
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
    skipped = given - next.history.length;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const previous = JSON.stringify(data);
  try { localStorage.setItem(BACKUP_KEY, previous); } catch {}
  data = next;
  if (!save()) { data = JSON.parse(previous); return { ok: false, reason: 'storage' }; }
  syncTimersFromHistory();
  return { ok: true, count: data.history.length, skipped, theme: theme || null, previous };
}

// Annule un import : la donnée d'avant (previous) est remise et enregistrée
function undoImport(previous) {
  data = normalizeData(JSON.parse(previous));
  save();
}

// Exporte la donnée en JSON (feuille de partage si disponible, sinon téléchargement).
// theme : préférence de thème jointe au fichier (_theme). Renvoie true une fois le fichier remis
// (date gardée dans data.lastExport), false si le partage a été annulé.
async function exportData(theme) {
  const payload = { ...data, _theme: theme };
  const json  = JSON.stringify(payload, null, 2);
  const fname = `muscu-backup-${localISO()}.json`;
  const file  = typeof File === 'function' ? new File([json], fname, { type: 'application/json' }) : null;
  const done = () => { data.lastExport = Date.now(); save(true); return true; };
  if (!file) { downloadText(json, fname); return done(); }
  return (await shareOrDownload(file, 'Sauvegarde MDLF Training')) === 'cancelled' ? false : done();
}

// Feuille de partage du système si elle accepte le fichier, sinon téléchargement.
// Web Share API (MDN, Navigator.share) : canShare({ files }) d'abord ; AbortError = feuille fermée.
// Renvoie 'shared', 'cancelled' ou 'downloaded'.
async function shareOrDownload(file, title) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; }
    catch (err) { if (err?.name === 'AbortError') return 'cancelled'; }
  }
  downloadBlob(file, file.name);
  return 'downloaded';
}

function downloadText(text, fname) {
  downloadBlob(new Blob([text], { type: 'application/json' }), fname);
}

// Fichier remis au navigateur (téléchargement), quel que soit son type
function downloadBlob(blob, fname) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
