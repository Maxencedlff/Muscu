// ═══════════════════════════════════════════════════════════
//  Progrès › Mesures : mensurations et photos de progression (écran, feuilles, actions)
// ═══════════════════════════════════════════════════════════
//
// Tout reste sur l'appareil : mensurations dans data.bodyMeasures (js/data/body-measures.js, jamais
// synchronisées), photos dans IndexedDB (js/data/progress-photos.js). Rien n'apparaît sur l'écran
// Progrès lui-même (pas de vignette : l'app s'ouvre en salle), seulement une ligne qui mène ici.
'use strict';

const BM_PRIVATE = 'Privé, reste sur ton iPhone';

// ── Progrès : ligne d'entrée ────────────────────────────────
function renderBodyMeasuresGroup() {
  const s = bodyMeasureSummary();
  return `
        <div class="group-title">Mesures</div>
        <div class="group">
          <button class="cell cell--nav" data-action="go-body-measures">
            ${icon('ruler', 22)}
            <span class="cell__body"><span class="cell__title">Mensurations et photos</span>
              <span class="cell__sub">${BM_PRIVATE}${s.latest ? ` · ${esc(fmtDate(s.latest))}` : ''}</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}

// ── Écran Mesures ───────────────────────────────────────────
function renderBodyMeasures() {
  const unit = lenUnitLbl();
  const rows = BODY_MEASURES.map(m => {
    const d = bodyMeasureDelta(bodyMeasureSeries(m.key));
    const value = d ? `${fmtLen(d.last.cm)} ${unit}` : '—';
    const delta = d ? fmtLenDelta(d.dPrev) : '';
    const spoken = d ? `${value}${delta ? `, ${delta} depuis la mesure d'avant` : ''}, ${fmtDate(d.last.date)}` : 'aucune mesure';
    return `
          <button class="cell cell--nav bm-cell" data-action="open-body-measure" data-key="${m.key}" aria-label="${m.label} : ${esc(spoken)}">
            <span class="cell__body"><span class="cell__title">${m.label}</span>
              ${d ? `<span class="cell__sub">${esc(fmtDate(d.last.date))}${delta ? ` · ${delta}` : ''}</span>` : ''}</span>
            <span class="cell__value num">${value}</span>
            ${icon('chevron.right', 16)}
          </button>`;
  }).join('');
  return `
    <div class="view body-measures view--grouped">
      ${navBar({ title: 'Mesures' })}
      <div class="scr">
        <div class="bm-private">${icon('eye.slash', 16)}<span>${BM_PRIVATE} : rien ne part sur ton compte, rien n'est montré à tes amis ni à ton coach.</span></div>
        <div class="group-title">Mensurations</div>
        <div class="group">
          <button class="cell cell--action" data-action="bm-add">${icon('plus', 22)}<span class="cell__title">Ajouter des mesures</span></button>
          ${rows}
        </div>
        <div class="group-foot">En ${unit === 'in' ? 'pouces, comme tes charges en lbs' : 'centimètres'}. Tes mensurations sont dans l'export de l'app ; pas tes photos, trop lourdes.</div>
        <div id="photosBox">${photosSectionHtml()}</div>
        <input type="file" id="photoFile" class="visually-hidden" accept="image/*" aria-hidden="true" tabindex="-1">
      </div>
    </div>`;
}

// Feuille de saisie : la date, puis une ligne par mesure (toutes, ou une seule depuis sa courbe)
async function addMeasuresSheet(keys = BODY_MEASURE_KEYS) {
  const today = localISO(), unit = lenUnitLbl();
  const rows = keys.map(k => {
    const series = bodyMeasureSeries(k), last = series[series.length - 1];
    return `
      <label class="sheet-list__row bm-row"><span>${bodyMeasureLabel(k)}</span>
        <span class="field-suffix"><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" class="field field--num bm-in" data-key="${k}"
          placeholder="${last ? fmtLen(last.cm, { plain: true }) : '—'}" aria-label="${bodyMeasureLabel(k)} en ${unit}"><span>${unit}</span></span>
      </label>`;
  }).join('');
  const res = await sheet({ title: keys.length === 1 ? bodyMeasureLabel(keys[0]) : 'Mesures', confirm: 'OK', focus: keys.length === 1 ? '.bm-in' : null, body: `
    <div class="date-row bm-date"><label class="date-label" for="bmDate">Date</label><input type="date" id="bmDate" class="date-input" value="${today}" max="${today}"></div>
    <div class="sheet-list">${rows}</div>
    <p class="mpick__foot">${keys.length > 1 ? 'Laisse vide ce que tu n\'as pas mesuré. ' : ''}Mesure détendu, au même endroit à chaque fois. ${BM_PRIVATE}.</p>`,
    onConfirm: panel => {
      const dateIn = $('#bmDate', panel);
      const date = dateInputToTs(dateIn.value);
      if (date === null) { flagInvalid(dateIn, 'Date invalide'); return false; }
      const out = [];
      for (const inp of panel.querySelectorAll('.bm-in')) {
        if (inp.value.trim() === '') continue;
        const cm = storeLen(inp.value);
        if (cm === null) { flagInvalid(inp, `Entre ${fmtLen(BODY_CM_MIN)} et ${fmtLen(BODY_CM_MAX)} ${unit}`); return false; }
        out.push({ key: inp.dataset.key, cm });
      }
      if (!out.length) { showToast('Saisis au moins une mesure'); return false; }
      return { date, out };
    } });
  if (!res) return;
  res.out.forEach(({ key, cm }) => logBodyMeasure(key, cm, res.date));
  save(); render();
  showToast(plural(res.out.length, 'mesure enregistrée', 'mesures enregistrées'));
}

// ── Écran d'une mesure : courbe et historique ───────────────
function renderBodyMeasure(key) {
  const label = bodyMeasureLabel(key);
  if (!label) {
    chartState = null;
    return `<div class="view body-measure view--grouped">${navBar({ title: 'Mesure' })}<div class="scr"><div class="empty-note">Mesure inconnue.</div></div></div>`;
  }
  const series = bodyMeasureSeries(key), unit = lenUnitLbl();
  const d = bodyMeasureDelta(series);
  // Courbe de Progrès (js/features/progress-chart.js) avec ses propres textes ; axe tronqué : 1 cm sur 90 doit se voir
  chartState = series.length ? {
    vals: series.map(p => p.cm), dates: series.map(p => p.date), points: series, bw: false, mode: 'len', color: 'var(--teal)',
    xLabels: [], sel: null, name: label, fromZero: false,
    fmtVal: v => `${fmtLen(v)} ${unit}`, axisFmt: v => fmtLen(v), bubble: p => `${fmtDate(p.date, 'short')} · ${fmtLen(p.cm)} ${unit}`,
  } : null;
  const entries = series.slice().reverse().map(p => `
          <div class="cell bm-entry">
            <span class="cell__body"><span class="cell__title">${esc(fmtDate(p.date))}</span></span>
            <span class="cell__value num">${fmtLen(p.cm)} ${unit}</span>
            <button class="bm-del" data-action="bm-delete" data-key="${key}" data-date="${p.date}" aria-label="Supprimer la mesure du ${esc(fmtDate(p.date))}">${icon('trash', 20)}</button>
          </div>`).join('');
  return `
    <div class="view body-measure view--grouped">
      ${navBar({ title: '' })}
      <div class="scr">
        <h1 class="scr-title">${label}</h1>
        ${d ? `
        <div class="chart-head">
          <span class="chart-head__val num">${fmtLen(d.last.cm)} ${unit}</span>
          ${fmtLenDelta(d.dPrev) ? `<span class="chart-head__trend num" aria-label="${fmtLenDelta(d.dPrev)} depuis la mesure d'avant">${fmtLenDelta(d.dPrev)}</span>` : ''}
        </div>
        <div class="chart" id="exChart">
          <canvas class="stats-canvas" role="img" aria-label=""></canvas>
          <div class="chart-bubble num" hidden></div>
        </div>
        <div class="group">
          <div class="cell"><span class="cell__body"><span class="cell__title">Depuis la première mesure</span>
            <span class="cell__sub">${esc(fmtDate(series[0].date))} · ${fmtLen(series[0].cm)} ${unit}</span></span>
            <span class="cell__value num">${fmtLenDelta(d.dFirst) || (series.length > 1 ? 'Pareil' : '—')}</span></div>
          <div class="cell"><span class="cell__body"><span class="cell__title">Mesures</span></span><span class="cell__value num">${series.length}</span></div>
        </div>` : `<div class="empty-note">Aucune mesure pour l'instant.</div>`}
        <div class="group">
          <button class="cell cell--action" data-action="bm-add-one" data-key="${key}">${icon('plus', 22)}<span class="cell__title">Ajouter une mesure</span></button>
        </div>
        ${entries ? `<div class="group-title">Historique</div><div class="group">${entries}</div>` : ''}
        <div class="group-foot">${BM_PRIVATE}.</div>
      </div>
    </div>`;
}

// ── Photos ──────────────────────────────────────────────────
let photoCache = null;         // photos lues dans IndexedDB (null : pas encore lues)
const photoUrls = new Map();   // id → URL d'objet d'une vignette, révoquée en quittant l'écran
let photoCmp = { a: null, b: null };   // comparaison : photos de gauche et de droite
let photoNewPose = 'face';

function photoUrl(p) {
  if (!photoUrls.has(p.id)) photoUrls.set(p.id, URL.createObjectURL(p.blob));
  return photoUrls.get(p.id);
}
function revokePhotoUrls() { photoUrls.forEach(u => URL.revokeObjectURL(u)); photoUrls.clear(); }

function photosSectionHtml() {
  const title = '<div class="group-title">Photos</div>';
  const note = txt => `<div class="cell"><span class="cell__body"><span class="cell__sub">${txt}</span></span></div>`;
  if (!photosSupported()) return `${title}<div class="group">${note('Les photos ne sont pas disponibles dans ce navigateur.')}</div>`;
  if (photoCache === null) return `${title}<div class="group">${note('Chargement…')}</div>`;
  const list = photoCache;
  const add = `<button class="cell cell--action" data-action="photo-add">${icon('camera', 22)}<span class="cell__title">Ajouter une photo</span></button>`;
  if (!list.length) {
    return `${title}<div class="group">${add}${note('Face, profil, dos : une photo de temps en temps, pour voir ce que la balance ne dit pas. Elles restent dans l\'app, jamais dans ta pellicule.')}</div>`;
  }
  const days = photoDayGroups(list).map(g => `
            <div class="pgal__day"><span class="pgal__date">${esc(fmtDate(g.date))}</span>
              <div class="pgal__row">${g.photos.map(p => `
                <button class="pgal__item" data-action="photo-open" data-id="${p.id}" aria-label="${photoPoseLabel(p.pose)}, ${esc(fmtDate(p.date))}">
                  <img src="${photoUrl(p)}" alt="" loading="lazy"><span class="pgal__pose">${photoPoseLabel(p.pose)}</span>
                </button>`).join('')}</div>
            </div>`).join('');
  return `${title}
        <div class="group">${add}
          <div class="cell"><div class="pgal">${days}</div></div>
          ${note(`${plural(list.length, 'photo', 'photos')} · ${fmtBytes(photosTotalBytes(list))} sur l'appareil`)}
        </div>
        ${photoCompareHtml(list)}`;
}

// Deux dates côte à côte : par défaut la plus ancienne et la plus récente de la même pose
function photoCompareHtml(list) {
  if (list.length < 2) return '';
  const byId = id => list.find(p => p.id === id);
  if (!byId(photoCmp.a) || !byId(photoCmp.b)) {   // première ouverture ou photo supprimée : choix par défaut
    const newest = list[0];
    const same = list.filter(p => p.pose === newest.pose);
    const pool = same.length > 1 ? same : list;
    photoCmp = { a: pool[pool.length - 1].id, b: newest.id };
  }
  const a = byId(photoCmp.a), b = byId(photoCmp.b);
  const options = sel => list.slice().reverse().map(p =>
    `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(fmtDate(p.date, 'short'))} · ${photoPoseLabel(p.pose)}</option>`).join('');
  const days = Math.round(Math.abs(b.date - a.date) / 86_400_000);
  return `
        <div class="group-title">Comparer</div>
        <div class="group group--pad pcmp">
          <div class="pcmp__cols">${[['a', a, 'Photo de gauche'], ['b', b, 'Photo de droite']].map(([side, p, lbl]) => `
            <div class="pcmp__col">
              <label class="visually-hidden" for="pcmp-${side}">${lbl}</label>
              <select id="pcmp-${side}" class="pcmp__sel" data-side="${side}">${options(p.id)}</select>
              <img class="pcmp__img" src="${photoUrl(p)}" alt="${photoPoseLabel(p.pose)}, ${esc(fmtDate(p.date))}">
            </div>`).join('')}
          </div>
          <div class="pcmp__gap">${days ? `${plural(days, 'jour', 'jours')} d'écart` : 'Même jour'}</div>
        </div>`;
}

// Lecture des photos après le dessin (IndexedDB est asynchrone), puis remplissage de la section
async function refreshPhotos() {
  if (!photosSupported()) return;
  try { photoCache = await photosAll(); } catch { photoCache = []; }
  const box = $('#photosBox');
  if (box) box.innerHTML = photosSectionHtml();
}
function mountBodyMeasures() { refreshPhotos(); }
// Les vignettes restent en mémoire d'un écran de Mesures à l'autre ; libérées en quittant la section
function leaveBodyMeasures() {
  if (currentView() === 'body-measure' || currentView() === 'body-measures') return;
  revokePhotoUrls();
  photoCache = null;
}

// Fichier choisi (caméra ou pellicule) : pose et date, puis réduction et stockage
async function newPhotoSheet(file) {
  const url = URL.createObjectURL(file), today = localISO();
  photoNewPose = 'face';
  const res = await sheet({ title: 'Nouvelle photo', confirm: 'OK', body: `
    <img class="pnew__img" src="${url}" alt="Aperçu de la photo choisie">
    <div class="segmented seg-full pnew__pose" role="radiogroup" aria-label="Pose">
      ${PHOTO_POSES.map(([k, l]) => `<button type="button" class="segmented__btn ${k === photoNewPose ? 'segmented__btn--active' : ''}" role="radio" aria-checked="${k === photoNewPose}" data-action="photo-pose" data-pose="${k}">${l}</button>`).join('')}
    </div>
    <div class="date-row bm-date"><label class="date-label" for="phDate">Date</label><input type="date" id="phDate" class="date-input" value="${today}" max="${today}"></div>
    <p class="mpick__foot">Réduite à ${PHOTO_MAX_PX} px et gardée dans l'app, pas dans ta pellicule. ${BM_PRIVATE}.</p>`,
    onConfirm: panel => {
      const dateIn = $('#phDate', panel);
      const date = dateInputToTs(dateIn.value);
      if (date === null) { flagInvalid(dateIn, 'Date invalide'); return false; }
      return { pose: photoNewPose, date };
    } });
  URL.revokeObjectURL(url);
  if (!res) return;
  try {
    const rec = await photoFromFile(file, res);
    await photoPut(rec);
    await refreshPhotos();
    showToast(`Photo enregistrée · ${fmtBytes(rec.bytes)}`);
  } catch {
    showToast('Photo illisible ou stockage indisponible', { error: true });
  }
}

async function openPhotoSheet(id) {
  const p = photoCache?.find(x => x.id === id);
  if (!p) return;
  await sheet({ title: `${photoPoseLabel(p.pose)} · ${fmtDate(p.date)}`, cancel: 'Fermer', confirm: '', body: `
    <img class="pview__img" src="${photoUrl(p)}" alt="${photoPoseLabel(p.pose)}, ${esc(fmtDate(p.date))}">
    <p class="pview__meta">${p.w} × ${p.h} px · ${fmtBytes(p.bytes)}</p>
    <button class="btn btn--danger btn--full" data-action="photo-delete" data-id="${p.id}">Supprimer cette photo</button>` });
}

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'photoFile') {
    const file = el.files?.[0];
    el.value = '';   // la même photo choisie deux fois de suite déclenche bien un nouveau change
    if (file) newPhotoSheet(file);
    return;
  }
  if (el.classList?.contains('pcmp__sel')) {
    photoCmp = { ...photoCmp, [el.dataset.side]: el.value };
    const box = $('#photosBox');
    if (box) box.innerHTML = photosSectionHtml();
  }
});

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'go-body-measures':  () => { navigate('body-measures'); },
  'open-body-measure': (e, el) => { navigate(makeRoute('body-measure', el.dataset.key)); },
  'bm-add':            () => addMeasuresSheet(),
  'bm-add-one':        (e, el) => addMeasuresSheet([el.dataset.key]),
  'bm-delete': async (e, el) => {
    const key = el.dataset.key, date = parseInt(el.dataset.date, 10);
    if (!(await confirmSheet('Supprimer cette mesure ?', `${bodyMeasureLabel(key)} du ${fmtDate(date)}.`, 'Supprimer'))) return;
    removeBodyMeasure(key, date);
    save(); render(); showToast('Mesure supprimée');
  },
  // Un seul tap : le sélecteur de fichier s'ouvre dans le geste (caméra ou pellicule, au choix d'iOS)
  'photo-add': () => {
    const inp = $('#photoFile');
    if (!inp) return;
    inp.value = '';
    inp.click();
  },
  'photo-pose': (e, el) => {
    photoNewPose = el.dataset.pose;
    el.closest('.pnew__pose').querySelectorAll('.segmented__btn').forEach(b => {
      const on = b === el;
      b.classList.toggle('segmented__btn--active', on);
      b.setAttribute('aria-checked', String(on));
    });
  },
  'photo-open': (e, el) => openPhotoSheet(el.dataset.id),
  'photo-delete': async (e, el) => {
    const id = el.dataset.id;
    if (!(await confirmSheet('Supprimer cette photo ?', 'Elle n\'est nulle part ailleurs : pas de corbeille.', 'Supprimer'))) return;
    try { await photoDelete(id); } catch { showToast('Suppression impossible', { error: true }); return; }
    if (photoUrls.has(id)) { URL.revokeObjectURL(photoUrls.get(id)); photoUrls.delete(id); }
    el.closest('.sheet-root')?._close?.(null);
    await refreshPhotos();
    showToast('Photo supprimée');
  },
});
