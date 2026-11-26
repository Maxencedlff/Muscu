// ═══════════════════════════════════════════════════════════
//  Sauvegarde : import et export JSON, export CSV des séances, carte « Sauvegarde tes séances »
// ═══════════════════════════════════════════════════════════
'use strict';

// Délai pendant lequel un import peut être annulé (toast « Annuler » de Réglages)
const IMPORT_UNDO_MS = 6000;

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
  accountResetSyncState();   // compte : les séances absentes du fichier ne sont pas supprimées du compte
  accountHoldSync(IMPORT_UNDO_MS);   // rien ne part tant que l'import peut être annulé
  if (!save()) { data = JSON.parse(previous); return { ok: false, reason: 'storage' }; }
  syncTimersFromHistory();
  return { ok: true, count: data.history.length, skipped, theme: theme || null, previous };
}

// Annule un import : la donnée d'avant (previous) est remise et enregistrée
function undoImport(previous) {
  // Compte : l'état de synchro est gardé, les séances que l'import avait envoyées en repartent
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

// ── Export CSV des séances ──────────────────────────────────
// Une ligne par série (sous-séries d'un drop set, d'un rest-pause ou d'un cluster et second côté d'une série notée par
// bras compris), de la plus ancienne à
// la plus récente : Date ; Séance ; Exercice ; Série ; Kg ; Reps ; RIR ; Note. Pour un tableur (Excel, Numbers,
// Google Sheets), pas une sauvegarde : il ne se réimporte pas (l'export JSON, lui, si). Format français d'Excel :
// point-virgule, virgule décimale, BOM UTF-8 (sans lui, Excel lit « SÃ©ance »). Charges en kg, comme elles sont
// stockées. Séries en durée : « 45 s » ; cardio : « 30 min · 5 km » dans la colonne Reps. Échauffement : « É » ; bloc de
// pré-fatigue (js/data/blocks.js) : « Pré-fatigue 1 », « Pré-fatigue 2 ».
// Texte de la personne (nom, note) : une cellule qui commence par = + - @ serait lue comme une formule par le
// tableur (injection CSV, OWASP) : elle est précédée d'une apostrophe.
const CSV_HEADER = ['Date', 'Séance', 'Exercice', 'Série', 'Kg', 'Reps', 'RIR', 'Note'];
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvNum = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : String(Number(v)).replace('.', ','));
function csvDate(ts) {
  const d = new Date(ts);
  return `${localISO(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function historyCsv(d = data) {
  const rows = [CSV_HEADER];
  const hist = [...(d.history || [])].sort((a, b) => a.date - b.date);
  for (const h of hist) {
    const date = csvDate(h.date), label = rawLabel(h.category, entryProg(h));
    let sessionNote = typeof h.notes === 'string' ? h.notes.trim() : '';
    for (const ex of h.exercises || []) {
      const m = measureOf(ex);
      const reps = st => (m === 'time' ? `${st.reps} s` : m === 'cardio' ? `${st.reps} min${st.dist ? ` · ${csvNum(st.dist)} km` : ''}` : st.reps);
      let n = 0, pf = 0, exNote = ex.note || '';
      const prefat = blockRole(ex) === 'prefat';
      for (const st of ex.sets || []) {
        const warm = isWarmupSet(st);
        const no = prefat && warm ? `${BLOCK_ROLES.prefat} ${++pf}` : warm ? 'É' : String(++n);
        const note = [sessionNote, exNote, st.note || ''].filter(Boolean).join(' · ');
        sessionNote = ''; exNote = '';   // une fois, sur la première ligne de la séance ou de l'exercice
        rows.push([date, label, ex.name, no, m === 'cardio' ? '' : csvNum(st.weight), reps(st), Number.isInteger(st.rir) ? String(st.rir) : '', note]);
        subSetsOf(st).forEach((x, k) => rows.push([date, label, ex.name, `${no}.${k + 1}`, csvNum(x.weight), x.reps, '', TECHS[setTech(st)].label]));
        // Série notée par bras (js/data/unilateral.js) : le second côté et ses sous-séries, « 3 bras droit », « 3.1 bras droit »
        if (!warm && hasSide2(st)) {
          const side = sideName(ex, 2).toLowerCase();
          rows.push([date, label, ex.name, `${no} ${side}`, csvNum(st.side2.weight), st.side2.reps, '', '']);
          side2SubsOf(st).forEach((x, k) => rows.push([date, label, ex.name, `${no}.${k + 1} ${side}`, csvNum(x.weight), x.reps, '', TECHS[setTech(st)].label]));
        }
      }
    }
  }
  // Défis (js/data/defis.js) : une ligne par jour noté, après les séances. Séance « Défi », Reps : le total du jour
  // (« 90 s » pour un défi en temps), Note : l'objectif du jour
  for (const c of [...defiList(d), ...defiList(d, { ended: true })]) {
    for (const day of Object.keys(c.log || {}).sort()) {
      const t = defiDayTotal(c, day), g = defiGoalOn(c, day);
      rows.push([day, 'Défi', c.name, '', '', c.measure === 'time' ? `${t} s` : String(t), '', `Objectif ${c.measure === 'time' ? `${g} s` : g}`]);
    }
  }
  return '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

// Fichier CSV remis par la feuille de partage (comme l'export JSON), sinon téléchargé.
// Renvoie 'empty' (aucune séance), 'cancelled', 'shared' ou 'downloaded'.
async function exportHistoryCsv() {
  if (!(data.history || []).length && !defiList(data).length && !defiList(data, { ended: true }).length) return 'empty';
  const csv = historyCsv(), fname = `mdlf-seances-${localISO()}.csv`;
  if (typeof File !== 'function') { downloadBlob(new Blob([csv], { type: 'text/csv' }), fname); return 'downloaded'; }
  return shareOrDownload(new File([csv], fname, { type: 'text/csv' }), 'Séances MDLF Training');
}

// ── Carte « Sauvegarde tes séances » de l'accueil ───────────
// Regard neuf du 16/11 (« j'ai peur de tout perdre ») : après 3 séances, sans compte ni export récent (exportStale,
// js/features/settings.js), une carte discrète le dit. Fermée : elle revient 30 jours plus tard si rien n'a changé.
// Jamais sur un appareil qui a déjà eu un compte (hadAccount : propriétaire de la synchro connu, déconnexion voulue ou
// session finie) : ses séances sont sur le compte, et la carte de reconnexion parle déjà de sauvegarde.
const BACKUP_CARD_KEY = 'ppl_backup_card_closed';   // date de fermeture (ms)
const BACKUP_CARD_MIN_SESSIONS = 3;
const BACKUP_CARD_SNOOZE_MS = 30 * 86400000;
function backupCardShown({ sessions, ready, signedIn, hadAccount = false, stale, closedAt, now = Date.now() }) {
  if (sessions < BACKUP_CARD_MIN_SESSIONS || !ready || signedIn || hadAccount || !stale) return false;
  return !(Number.isFinite(closedAt) && now - closedAt >= 0 && now - closedAt < BACKUP_CARD_SNOOZE_MS);
}
