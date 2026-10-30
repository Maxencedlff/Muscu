// ═══════════════════════════════════════════════════════════
//  Réglages › Données › Importer depuis une autre app (Hevy, Strong)
//  Choix du fichier CSV, aperçu (séances, exercices reconnus ou à créer, liens à la main), import.
//  Logique dans js/data/import-csv.js ; ici seulement l'écran et l'enregistrement.
// ═══════════════════════════════════════════════════════════
'use strict';

// Import en cours d'aperçu : fichier lu, liens posés à la main, options
let imp = null;
const IMP_LIST_MAX = 200;   // noms à créer affichés au plus (le reste est compté)
const IMP_SOURCE = { hevy: 'Hevy', strong: 'Strong' };

// Fichier choisi : lu, reconnu, puis l'aperçu s'ouvre ; sinon un message dit quoi exporter
function importOtherAppText(text) {
  const plan = readImportCsv(text);
  if (!plan.ok) {
    const msg = plan.reason === 'size' ? 'Fichier trop gros (25 Mo au plus)'
      : plan.reason === 'empty' ? 'Aucune séance lisible dans ce fichier'
      : 'Fichier non reconnu. Exporte tes séances depuis Hevy (Export Workouts) ou Strong (Export Data), au format CSV.';
    showToast(msg, { error: true, duration: 6000 });
    return;
  }
  imp = { plan, links: {}, keepWarmups: false, unit: data.unit === 'lbs' ? 'lbs' : 'kg' };
  openImportPreview();
}

// Essai à blanc sur une copie : ce que l'import ferait avec les choix actuels (doublons compris)
function importDryRun() {
  return applyImport(imp.plan, imp, clone(data));
}

function importPreviewHtml() {
  const { plan } = imp;
  const r = importDryRun();
  const first = plan.sessions[0].date, last = plan.sessions.at(-1).date;
  // « du 14 janv. au 1 févr. 2026 » (année du début seulement si elle diffère)
  const y = ts => new Date(ts).getFullYear();
  const day = ts => `${fmtDate(ts, 'short')}${y(ts) !== y(last) || ts === last ? ` ${y(ts)}` : ''}`;
  const range = plan.sessions.length === 1 ? `le ${day(first)}` : `du ${day(first)} au ${day(last)}`;
  const unknown = plan.names.filter(n => !n.match);
  const row = (label, value) => `<li class="sheet-list__row"><span>${label}</span><span class="sheet-list__meta num">${value}</span></li>`;
  const linkRow = n => {
    const linked = imp.links[n.raw];
    return `<li class="sheet-list__row imp-row">
      <span class="imp-row__body"><span class="imp-row__name">${esc(n.raw)}</span>
        <span class="imp-row__sub">${linked ? `→ ${esc(linked)}` : plural(n.count, 'séance', 'séances')}</span></span>
      <button class="imp-row__btn" data-action="imp-link" data-raw="${esc(n.raw)}" aria-label="${linked ? 'Modifier le lien de' : 'Relier'} ${esc(n.raw)}">${linked ? 'Modifier' : 'Relier'}</button>
    </li>`;
  };
  return `
    <div class="imp" id="impSheet">
      <p class="imp__lead">${plural(plan.sessions.length, 'séance', 'séances')} ${esc(range)}.</p>
      <ul class="sheet-list">
        ${row('Séances à ajouter', r.added)}
        ${r.duplicates ? row('Déjà dans l\'historique', r.duplicates) : ''}
        ${row('Exercices reconnus', `${r.recognized} / ${plan.names.length}`)}
        ${r.created ? row('Exercices créés sous leur nom', r.created) : ''}
        ${plan.skippedRows ? row('Lignes ignorées', plan.skippedRows) : ''}
      </ul>
      ${plan.weightUnit ? '' : `
      <div class="imp__ctl">
        <span class="imp__ctl-label">Charges du fichier en</span>
        <div class="segmented seg-sm" role="group" aria-label="Unité des charges du fichier">
          ${['kg', 'lbs'].map(u => `<button class="segmented__btn ${imp.unit === u ? 'segmented__btn--active' : ''}" aria-pressed="${imp.unit === u}" data-action="imp-unit" data-val="${u}">${u === 'kg' ? 'kg' : 'lb'}</button>`).join('')}
        </div>
      </div>`}
      ${plan.warmups ? `
      <ul class="sheet-list">
        <li class="sheet-list__row imp-row">
          <button class="imp__switch" data-action="imp-warmups" role="switch" aria-checked="${imp.keepWarmups}">
            <span class="imp-row__body"><span class="imp-row__name">Garder les séries d'échauffement</span>
              <span class="imp-row__sub">${plural(plan.warmups, 'série', 'séries')} · elles compteraient dans le volume</span></span>
            <span class="switch ${imp.keepWarmups ? 'switch--on' : ''}" aria-hidden="true"><span class="switch__thumb"></span></span>
          </button>
        </li>
      </ul>` : ''}
      ${unknown.length ? `
      <div class="imp__title">Non reconnus (${unknown.length}) : créés sous leur nom, ou à relier</div>
      <ul class="sheet-list">${unknown.slice(0, IMP_LIST_MAX).map(linkRow).join('')}
        ${unknown.length > IMP_LIST_MAX ? `<li class="sheet-list__row"><span class="imp-row__sub">… et ${unknown.length - IMP_LIST_MAX} autres</span></li>` : ''}
      </ul>` : ''}
      <p class="imp__foot">Les séances arrivent dans un programme «\u00a0${IMP_SOURCE[plan.format]}\u00a0», une séance par nom de séance du fichier${account.user ? ', et sur ton compte' : ''}. Tes séances et programmes actuels ne changent pas.</p>
    </div>`;
}

function refreshImportPreview() {
  const el = $('#impSheet');
  if (el) el.outerHTML = importPreviewHtml();
}

async function openImportPreview() {
  const plan = imp.plan;
  const done = await sheet({ title: `Import ${IMP_SOURCE[plan.format]}`, cancel: 'Annuler', confirm: 'Importer',
    body: importPreviewHtml(), onConfirm: () => { runImport(); return true; } });
  if (done === null) imp = null;
}

// Import : copie d'avant gardée pour « Annuler » ; la synchro attend la fin de ce délai (rien ne part
// d'une séance qu'on pourrait retirer). Stockage plein : la donnée d'avant est remise.
function runImport() {
  if (!imp) return;
  const previous = JSON.stringify(data);
  const r = applyImport(imp.plan, imp);
  imp = null;
  if (!r.added) {
    data = JSON.parse(previous);
    showToast(r.duplicates ? 'Rien à importer : ces séances sont déjà dans l\'historique' : 'Rien à importer');
    return;
  }
  try { localStorage.setItem(BACKUP_KEY, previous); } catch { /* copie de secours facultative */ }
  accountHoldSync(IMPORT_UNDO_MS);
  recomputePRFromHistory();
  if (!save()) { data = JSON.parse(previous); showToast('Stockage plein : rien n\'a été importé', { error: true }); return; }
  syncTimersFromHistory();
  render();
  const extra = [r.duplicates ? `${r.duplicates} déjà présente${r.duplicates > 1 ? 's' : ''}` : '', r.created ? `${plural(r.created, 'exercice créé', 'exercices créés')}` : ''].filter(Boolean);
  showToast(`Import réussi : ${plural(r.added, 'séance', 'séances')}${extra.length ? ` (${extra.join(', ')})` : ''}`, {
    action: 'Annuler', duration: IMPORT_UNDO_MS,
    onAction: () => { undoImport(previous); render(); showToast('Import annulé'); },
  });
}

// ── Relier un nom non reconnu à un exercice de la bibliothèque ──
let impLinkRaw = null;
function impPickListHtml(q) {
  const names = catalogueNames();
  const query = q.trim();
  const base = impLinkRaw.match(/^(.*?)\s*\(/)?.[1] || impLinkRaw;
  let list;
  if (!query) {
    const near = closestExercises(names, base, 5);
    list = near.length ? near : [];
  } else {
    list = names.map(n => ({ n, score: exerciseMatchScore(n, query) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.n);
    if (!list.length) list = closestExercises(names, query, 5);
  }
  const rows = list.slice(0, 40).map(n => `<button class="imp-pick" data-action="imp-pick" data-name="${esc(n)}"><span class="imp-row__body"><span>${esc(n)}</span>${exMusclesSubHtml({ name: n }, 'imp-row__sub')}</span></button>`).join('');
  const keep = imp.links[impLinkRaw] ? `<button class="imp-pick imp-pick--keep" data-action="imp-pick" data-name="">Garder « ${esc(impLinkRaw)} » tel quel</button>` : '';
  return `${!query && list.length ? '<div class="imp__hint">Les plus proches</div>' : ''}${rows || '<div class="sheet-empty">Aucun exercice</div>'}${keep}`;
}

async function openImportLinkSheet(raw) {
  impLinkRaw = raw;
  await sheet({ title: 'Relier à un exercice', cancel: 'Annuler', confirm: '', focus: '#impSearch',
    body: `<p class="imp__lead">« ${esc(raw)} » dans le fichier devient, dans l'app :</p>
      <input type="search" id="impSearch" class="search" placeholder="Rechercher dans la bibliothèque" autocomplete="off" aria-label="Rechercher un exercice">
      <div class="sheet-list imp-pick-list" id="impPickList">${impPickListHtml('')}</div>` });
  impLinkRaw = null;
}

// Saisie dans la recherche de la feuille de lien
document.addEventListener('input', ev => {
  if (ev.target?.id !== 'impSearch') return;
  const list = $('#impPickList');
  if (list) list.innerHTML = impPickListHtml(ev.target.value.slice(0, 80));
});

// Ferme la feuille la plus haute (celle du lien), la feuille d'aperçu reste dessous
function closeTopSheet() {
  const roots = document.querySelectorAll('.sheet-root:not(.sheet-root--out)');
  roots[roots.length - 1]?._close?.(null);
}

registerActions({
  'import-other-app': () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.csv,text/csv,text/comma-separated-values,text/plain';
    inp.onchange = ev => {
      const file = ev.target.files[0]; if (!file) return;
      if (file.size > IMPORT_MAX_BYTES) { showToast('Fichier trop gros (25 Mo au plus)', { error: true }); return; }
      const reader = new FileReader();
      reader.onload = re => importOtherAppText(String(re.target.result));
      reader.readAsText(file);
    };
    inp.click();
  },
  'imp-unit': (e, el) => {
    if (!imp || !['kg', 'lbs'].includes(el.dataset.val)) return;
    imp.unit = el.dataset.val; refreshImportPreview();
  },
  'imp-warmups': () => {
    if (!imp) return;
    imp.keepWarmups = !imp.keepWarmups; refreshImportPreview();
  },
  'imp-link': (e, el) => { if (imp) openImportLinkSheet(el.dataset.raw); },
  'imp-pick': (e, el) => {
    if (!imp || impLinkRaw === null) return;
    const name = el.dataset.name;
    if (name && catalogueEntry(name)) imp.links[impLinkRaw] = catalogueEntry(name).name; else delete imp.links[impLinkRaw];
    closeTopSheet();
    refreshImportPreview();
  },
});
