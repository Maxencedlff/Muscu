// ═══════════════════════════════════════════════════════════
//  Progrès › Mesures : mensurations et photos de progression (écran, feuilles, actions)
// ═══════════════════════════════════════════════════════════
//
// Rien sur le serveur : mensurations dans data.bodyMeasures (js/data/body-measures.js, jamais
// synchronisées, mais dans la copie iCloud de l'app et dans l'export), sauf si l'élève coche
// « Mensurations » pour son coach (js/data/coach-share.js : copie dédiée, effacée en décochant ;
// textes de cet écran adaptés, bmSharedWithCoach), photos dans IndexedDB
// (js/data/progress-photos.js, sur l'appareil seulement), rangées dans le coffre à photos
// (js/features/photo-vault-ui.js) : ici, une seule ligne qui y mène, sans vignette. Rien n'apparaît sur
// l'écran Progrès lui-même (l'app s'ouvre en salle), seulement une ligne qui mène ici.
'use strict';

const BM_PRIVATE = 'Privé : reste sur ton iPhone et dans ta copie iCloud, jamais sur nos serveurs';
// Élève d'un coach : « rien n'est montré à ton coach » ne serait pas sûr pour l'écran, qui mène au coffre d'où partent
// les photos de bilan, même avant que leur état soit relu du serveur (panels de la vague 3 : texte faux à l'arrivée)
const bmPhotosToCoach = () => !!(account.user && coachRole().hasCoach) && !cphAgeBlocked() && !cphDisabled();
const BM_SHARED = 'Partagées avec ton coach, qui voit leurs valeurs et leurs dates. Tes amis ne voient rien, et tes photos restent dans ton coffre, sauf celles que tu lui envoies toi-même';
// Mensurations cochées dans Réglages › Partager avec mon coach (js/data/coach-share.js)
function bmSharedWithCoach() { return !!account.user && coachShareOn('measures'); }
function bmPrivacyText() { return bmSharedWithCoach() ? BM_SHARED : BM_PRIVATE; }
// Une mensuration change sur cet appareil : enregistrée, puis renvoyée au coach si la case est cochée
function bmSaved() { save(); coachShareMeasuresChanged(); render(); }

// ── Progrès : ligne d'entrée ────────────────────────────────
function renderBodyMeasuresGroup() {
  const s = bodyMeasureSummary();
  return `
        <div class="group-title">Mesures</div>
        <div class="group">
          <button class="cell cell--nav" data-action="go-body-measures">
            ${icon('ruler', 22)}
            <span class="cell__body"><span class="cell__title">${photosAllowedHere() ? 'Mensurations et photos' : 'Mensurations'}</span>
              <span class="cell__sub">${bmSharedWithCoach() ? 'Partagé avec ton coach' : 'Privé'}${s.latest ? ` · ${esc(fmtDate(s.latest))}` : ''}</span></span>
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
        <div class="bm-private">${bmSharedWithCoach() ? `${icon('person.2', 16)}<span>${BM_SHARED}. Pour arrêter : Réglages › Partager avec mon coach.</span>`
          : `${icon('eye.slash', 16)}<span>${BM_PRIVATE}. ${bmPhotosToCoach() ? 'Tes mesures ne sont montrées à personne ; ton coach ne voit que les photos que tu lui envoies toi-même.' : cphNobodyTxt()}</span>`}</div>
        <div class="group-title">Mensurations</div>
        <div class="group">
          <button class="cell cell--action" data-action="bm-add">${icon('plus', 22)}<span class="cell__title">Ajouter des mesures</span></button>
          ${rows}
        </div>
        <div class="group-foot">En ${unit === 'in' ? 'pouces, comme tes charges en lbs' : 'centimètres'}. Tes mensurations sont dans l'export de l'app${photosAllowedHere() ? ' ; pas tes photos, trop lourdes' : ''}.</div>
        ${photosEnabled() ? photoVaultCellHtml() : ''}
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
    <div class="date-row bm-date"><label class="date-label" for="bmDate">Date</label><input type="date" id="bmDate" class="date-input" value="${today}" min="2000-01-01" max="${today}"></div>
    <div class="sheet-list">${rows}</div>
    <p class="mpick__foot">${keys.length > 1 ? 'Laisse vide ce que tu n\'as pas mesuré. ' : ''}Mesure détendu, au même endroit à chaque fois. ${bmPrivacyText()}.</p>`,
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
  bmSaved();
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
        <div class="group-foot">${bmPrivacyText()}.</div>
      </div>
    </div>`;
}

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
    bmSaved(); showToast('Mesure supprimée');
  },
});
