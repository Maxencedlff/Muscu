// ═══════════════════════════════════════════════════════════
//  Historique : liste, recherche, détail, suppression
// ═══════════════════════════════════════════════════════════
'use strict';

let histFilter = 'all';
let histQuery  = '';
let histMonths = 3;

function historySorted() {
  return (data.history || []).slice().sort((a, b) => b.date - a.date);
}

// Filtres : les séances du programme actif (data-cat = la catégorie, toujours là), puis celles d'autres programmes ou
// libres réellement présentes dans l'historique (« Bras » d'un autre programme : data-cat = « programme/catégorie »),
// de la plus récente à la plus ancienne. Un filtre = un nom de séance, à la casse et aux accents près (normName :
// « Epaules » d'un programme et « Épaules » d'un autre font une seule pastille, retour de Maxence du 15/11), libellé
// avec accent quand l'un des deux en a. Les données gardées ne changent pas : seul le regroupement à l'affichage.
// Chaque filtre compte ses séances (n), celles des HIST_RECENT_DAYS derniers jours (recent) et la date de la dernière
// (last) : de quoi choisir les pastilles visibles et trier la feuille « Plus ».
const HIST_RECENT_DAYS = 60;
function historyFilterKeys() {
  const out = [], at = new Map();
  const add = (key, label) => {
    const n = normName(label), i = at.get(n);
    if (i === undefined) { at.set(n, out.length); out.push([key, label]); return; }
    if (label.normalize('NFD').length > out[i][1].normalize('NFD').length) out[i][1] = label;   // « Épaules » plutôt que « Epaules »
  };
  sessionKeys().forEach(k => add(k, sessionMeta(k).label));
  const hist = historySorted();
  hist.forEach(h => {
    const prog = entryProg(h);
    if (prog === data.activeProgramme || isHealthEntry(h)) return;
    add(`${prog}/${h.category}`, sessionMeta(h.category, prog).label);
  });
  const stats = out.map(() => ({ n: 0, recent: 0, last: 0 }));
  const since = Date.now() - HIST_RECENT_DAYS * 86_400_000;
  hist.forEach(h => {
    if (isHealthEntry(h)) return;
    const i = at.get(historyEntryName(h));
    if (i === undefined) return;
    const st = stats[i];
    st.n++; if (h.date >= since) st.recent++; if (h.date > st.last) st.last = h.date;
  });
  return out.map(([key, label], i) => ({ key, label, ...stats[i] }));
}

// ── Barre de filtres : « Toutes » + au plus HIST_VISIBLE séances, puis « Plus » (retour de Maxence du 15/11 : avec
// 20 séances différentes, la barre défilait sans fin). Visibles : les plus fréquentes sur 60 jours (ex aequo : la plus
// récente d'abord), affichées dans l'ordre du programme ; le filtre choisi est toujours visible (il prend la place de la
// 4e). Écran étroit (< 390 pt, iPhone SE) : la moins fréquente des quatre (data-opt) est cachée en CSS et « Plus »
// apparaît s'il le faut. Texte agrandi : « Toutes » et « Filtrer… » seulement (CSS aussi : rien à redessiner).
const HIST_VISIBLE = 4;
function historyFilterRank(a, b) { return b.recent - a.recent || b.last - a.last || b.n - a.n; }
function historyFiltersHtml(filters = historyFilterKeys()) {
  const ranked = filters.slice().sort(historyFilterRank);
  let shown = ranked.slice(0, HIST_VISIBLE);
  const act = filters.find(f => f.key === histFilter);
  if (act && !shown.includes(act)) shown = [...shown.slice(0, HIST_VISIBLE - 1), act];
  const more = filters.length > HIST_VISIBLE + 1;                // plus de 5 séances : « Plus » partout
  const narrowMore = filters.length === HIST_VISIBLE + 1 || more; // écran étroit : « Plus » dès 5
  if (!more) shown = filters.slice();
  // Cachée sur écran étroit : la moins bien classée des visibles, jamais le filtre choisi
  const opt = filters.length > HIST_VISIBLE ? shown.slice().sort(historyFilterRank).reverse().find(f => f.key !== histFilter) : null;
  const visible = filters.filter(f => shown.includes(f));        // ordre du programme, puis des autres séances
  const btn = (k, l, extra = '') => `<button class="segmented__btn ${histFilter === k ? 'segmented__btn--active' : ''}" aria-pressed="${histFilter === k}" data-action="hist-filter" data-cat="${esc(k)}"${extra}>${l}</button>`;
  const actLabel = act ? act.label : '';
  return `<div class="segmented seg-full hist-seg" role="group" aria-label="Filtrer par séance">
      ${btn('all', 'Toutes')}
      ${visible.map(f => btn(f.key, f.label, `${f === opt ? ' data-opt="1"' : ''} title="${esc(f.label)}"`)).join('')}
      ${more || narrowMore ? `<button class="segmented__btn hist-seg__more${more ? '' : ' hist-seg__more--narrow'}" data-action="hist-filter-more" aria-label="Autres séances" aria-haspopup="dialog">${icon('ellipsis', 18)}</button>` : ''}
      <button class="segmented__btn hist-seg__xl${act ? ' segmented__btn--active' : ''}" data-action="hist-filter-more" aria-haspopup="dialog" aria-pressed="${!!act}">${act ? actLabel : 'Filtrer…'}</button>
    </div>`;
}
function refreshHistoryFilters() {
  const el = $('.hist-seg');
  if (el) el.outerHTML = historyFiltersHtml();
}
// Feuille « Plus » : les séances qui ne sont pas à l'écran (selon la largeur et la taille du texte), triées par nombre de
// séances, le nombre en valeur à droite (cellules iOS)
async function historyFilterSheet() {
  const shownKeys = new Set([...document.querySelectorAll('.hist-seg [data-action="hist-filter"]')]
    .filter(b => b.offsetWidth > 0).map(b => b.dataset.cat));
  const all = historyFilterKeys();
  const rest = all.filter(f => !shownKeys.has(f.key)).sort((a, b) => b.n - a.n || historyFilterRank(a, b));
  if (!rest.length) return;
  // Coche iOS sur le filtre en cours ; « Toutes les séances » en tête, avec le nombre total
  const row = (key, label, n) => {
    const on = key === histFilter;
    return `<button class="cell hist-pick${on ? ' hist-pick--on' : ''}" data-pick="${esc(key)}" aria-pressed="${on}">
      <span class="hist-pick__check" aria-hidden="true">${on ? icon('checkmark', 17) : ''}</span>
      <span class="cell__body"><span class="cell__title">${label}</span></span>
      <span class="cell__value num" aria-hidden="true">${n}</span><span class="visually-hidden">, ${plural(n, 'séance', 'séances')}</span>
    </button>`;
  };
  const total = all.reduce((a, f) => a + f.n, 0);
  const p = sheet({ title: 'Séances', cancel: 'Annuler', confirm: '', body: `<div class="view--grouped hist-picks-wrap"><div class="group hist-picks">${row('all', 'Toutes les séances', total)}${rest.map(f => row(f.key, f.label, f.n)).join('')}</div></div>` });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  root?.addEventListener('click', ev => { const b = ev.target.closest('[data-pick]'); if (b) root._close(b.dataset.pick); });
  const key = await p;
  if (key == null) return;
  setHistoryFilter(key);
}
function setHistoryFilter(key) {
  histFilter = key; histMonths = 3;
  refreshHistoryFilters();
  refreshHistoryList();
}
// Nom affiché d'une séance passée : le libellé fusionné des filtres (« Épaules » pour « Epaules » et « Épaules »), pour que
// la carte, le détail et la pastille disent la même chose (panel du 15/11 : on croyait à deux séances). labels :
// historyNameLabels() déjà calculé (boucles) ; les données gardées ne changent pas
function historyNameLabels(filters = historyFilterKeys()) { return new Map(filters.map(f => [normName(f.label), f.label])); }
function historyEntryLabel(h, labels = historyNameLabels()) {
  const label = sessionMeta(h.category, entryProg(h)).label;
  return labels.get(normName(label)) || label;
}
// Nom normalisé d'une séance passée, et celui que vise un filtre (« programme/catégorie » ou catégorie du programme actif)
function historyEntryName(h) { return normName(sessionMeta(h.category, entryProg(h)).label); }
function historyFilterName(key) {
  const i = key.indexOf('/');
  return normName(i > 0 ? sessionMeta(key.slice(i + 1), key.slice(0, i)).label : sessionMeta(key).label);
}
// Une séance passe le filtre quand son nom est celui du filtre, quel que soit son programme ; les courses et sorties vélo
// de Santé n'ont que « Toutes »
function historyFilterHit(h, name = historyFilterName(histFilter)) {
  if (histFilter === 'all') return true;
  return !isHealthEntry(h) && historyEntryName(h) === name;
}

function historyMatches(h, q, name) {
  if (!historyFilterHit(h, name)) return false;
  if (!q) return true;
  if (isHealthEntry(h)) return [h.health.title, h.health.source, h.exercises[0].name].some(t => normName(t).includes(q));
  if (normName(h.notes).includes(q)) return true;
  if ((h.exercises || []).some(e => normName(e.note).includes(q))) return true;   // notes d'exercice (js/data/notes.js)
  return (h.exercises || []).some(e => normName(e.name).includes(q));
}

// Course ou sortie vélo lue dans Santé : ligne non modifiable (ni détail, ni balayage pour supprimer)
function healthHistoryCell(h) {
  return `
    <div class="hrow hrow--health" data-id="${esc(h.id)}">
      <div class="hcell hcell--static">
        <span class="hcell__dot hcell__dot--health" aria-hidden="true"></span>
        <span class="hcell__body">
          <span class="hcell__top"><span class="hcell__title">${esc(h.health.title)}</span><span class="hcell__date">${fmtDate(h.date)}</span></span>
          <span class="hcell__sub num">${esc(healthEntryLine(h))}</span>
        </span>
      </div>
    </div>`;
}

// Séance passée en carte illustrée, comme « Autres séances » de l'accueil : nom, date et records, puis exercices, tonnage
// et durée à gauche ; à droite, le personnage entier (face et dos) avec les muscles de la séance réellement faite :
// principaux de chaque exercice en rouge plein, secondaires en rouge clair (exercisesBodyHtml, js/features/progress-muscles.js ;
// une séance épaules + abdos montre les deux, retour de Maxence du 15/11). Décoratif (aria-hidden) : VoiceOver lit le
// texte, records compris. Texte agrandi : plus de personnage (css/screens.css).
// index : chosenMusclesIndex() calculé une fois pour toute la liste
function historyCell(h, index, labels) {
  if (isHealthEntry(h)) return healthHistoryCell(h);
  const progId = entryProg(h);
  const vol    = sessionVolume(h.exercises || [], entryBodyKg(h));
  // Séance d'un autre programme : « Programme Bras & épaules » sur sa propre ligne, sous la date (panel vague 4 : après le
  // titre, « Bras · Bras & é… » se coupait sur iPhone SE et semblait répéter le nom) ; la ligne du dessous reste
  // « N exercices · t · durée » partout (panel t5 : la mention remplaçait le nombre d'exercices)
  const other  = progId !== data.activeProgramme && progId !== FREE;
  const parts  = [plural((h.exercises || []).length, 'exercice', 'exercices')];
  if (vol > 0) parts.push(fmtVolume(vol));
  if (h.duration) parts.push(fmtDuration(h.duration));
  // Records de la séance (recordCount, js/data/records.js : même règle que le bilan et Progrès) : médaille et nombre, à
  // côté de la date
  const recs = recordCount(h);
  const recMark = recs ? `<span class="hcell__rec num">${medalSvg(14)}${plural(recs, 'record', 'records')}</span>` : '';
  const body = exercisesBodyHtml(h.exercises, index, 'hcell__body-map');
  const art = body ? `<span class="hcell__map">${body}</span>` : '';
  return `
    <div class="hrow" data-id="${esc(h.id)}">
      <button class="hrow__del" data-action="swipe-delete-session" data-id="${esc(h.id)}" tabindex="-1">Supprimer</button>
      <button class="hcell hcell--card mgc" data-action="open-history" data-id="${esc(h.id)}">
        <span class="hcell__body mgc__text">
          <span class="hcell__title">${historyEntryLabel(h, labels)}${coachHistoryMark(h)}${historyHiddenMark(h)}${historyReactionsMark(h)}</span>
          <span class="hcell__when"><span class="hcell__date">${fmtDate(h.date)}</span>${recMark}</span>
          ${other ? `<span class="hcell__prog">Programme ${esc(progMeta(progId).name)}</span>` : ''}
          <span class="hcell__sub num">${parts.join(' · ')}</span>
        </span>
        ${art}
        ${icon('chevron.right', 16)}
      </button>
    </div>`;
}

// Première lettre en capitale (« octobre 2026 » → « Octobre 2026 »)
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Séances regroupées par mois, dans l'ordre de la liste
function historyByMonth(list) {
  const months = [];
  list.forEach(h => {
    const d   = new Date(h.date);
    const key = d.getFullYear() + '-' + d.getMonth();
    let m = months[months.length - 1];
    if (!m || m.key !== key) {
      m = { key, title: capitalize(fmtDate(d, 'month')), sessions: [] };
      months.push(m);
    }
    m.sessions.push(h);
  });
  return months;
}

// Liste chargée par paquets de mois (« Afficher plus » ajoute les 3 suivants) ; les courses et sorties
// vélo de Santé s'y mêlent à leur date (filtre « Toutes » seulement : elles n'appartiennent à aucune séance)
function historyListHTML() {
  const q   = normName(histQuery);
  const name = histFilter === 'all' ? '' : historyFilterName(histFilter);
  const all = [...historySorted(), ...healthEntries()].sort((a, b) => b.date - a.date).filter(h => historyMatches(h, q, name));
  if (!all.length) {
    return (data.history || []).length || healthEntries().length
      ? `<div class="empty-note">Aucune séance ne correspond.</div>`
      : `<div class="empty-note">Aucune séance enregistrée.<br>Termine ta première séance pour la voir ici.</div>
        <div class="group"><button class="cell cell--action" data-action="go-home"><span class="cell__title">Démarrer une séance</span></button></div>`;
  }
  const months = historyByMonth(all);
  const index = chosenMusclesIndex(), labels = historyNameLabels();
  // En-tête de mois : le mois et son nombre de séances (« Novembre 2026 · 4 séances »), pour se repérer en défilant
  const out = months.slice(0, histMonths).map(m =>
    `<section class="hmonth" data-month="${m.key}"><h2 class="hmonth__title">${m.title}<span class="hmonth__count"><span aria-hidden="true"> · </span><span class="visually-hidden">, </span>${plural(m.sessions.length, 'séance', 'séances')}</span></h2>
      <div class="group">${m.sessions.map(h => historyCell(h, index, labels)).join('')}</div></section>`).join('');
  return months.length > histMonths ? out + `<button class="btn-more" data-action="hist-more">Afficher plus</button>` : out;
}

function renderHistory() {
  const filters = historyFilterKeys();
  if (histFilter !== 'all' && !filters.some(f => f.key === histFilter)) histFilter = 'all';
  return `
    <div class="view history view--grouped">
      ${navBar({ title: 'Historique', right: `${histCalBtnHtml()}<button class="navbar__icon" data-action="go-add-session" aria-label="Ajouter une séance passée">${icon('plus', 24)}</button>` })}
      <div class="scr" id="histScroll">
        ${histCalHtml()}
        <div class="hist-tools">
          <input type="search" id="histSearch" maxlength="${SEARCH_MAX}" class="search" placeholder="Rechercher" value="${esc(histQuery)}"
                 autocomplete="off" enterkeyhint="search" aria-label="Rechercher dans l'historique">
          ${historyFiltersHtml(filters)}
        </div>
        <div id="histList">${historyListHTML()}</div>
      </div>
    </div>`;
}

function refreshHistoryList() {
  const el = $('#histList');
  if (el) el.innerHTML = historyListHTML();
  refreshHistoryCalendar();   // filtre changé, séance supprimée : le calendrier suit (js/features/history-calendar.js)
}

// Séries d'un exercice (setsTextRead, js/data/measures.js : « 130 kg × 10, 10 »), échappées pour le HTML
function setsLine(sets, measure = 'reps', kind = 'charge') {
  const shown = setsTextRead(sets, measure, kind), spoken = setsSpoken(sets, measure, kind);
  return spoken ? `<span aria-hidden="true">${esc(shown)}</span><span class="visually-hidden">${esc(spoken)}</span>` : esc(shown);
}
// Même chose pour VoiceOver : « 4 séries à 28 kilos : 8, 8, 8 et 8 reps » et non « 28 kg multiplié par 8, 8, 8, 8 »
// (panel vague 4 ; en séance, chaque ligne a déjà sa phrase) ; '' hors répétitions (le texte affiché se lit bien)
function setsSpoken(sets, measure, kind) {
  const ok = workSets(sets).filter(s => String(s.reps ?? '') !== '');
  if (measure !== 'reps' || !ok.length) return '';
  const and = xs => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} et ${xs.at(-1)}` : xs[0];
  const unit = data.unit === 'lbs' ? 'livres' : 'kilos', pre = { lest: 'plus ', aide: 'aide de ' }[kind] || '';
  const load = s => parseFloat(s.weight) > 0 ? `${pre}${fmtW(s.weight)} ${unit}` : '';
  const n = plural(ok.length, 'série', 'séries');
  if (ok.every(s => load(s) === load(ok[0]))) return `${n}${load(ok[0]) ? ` à ${load(ok[0])}` : ''} : ${and(ok.map(s => s.reps))} reps`;
  return `${n} : ${and(ok.map(s => `${load(s) || 'poids du corps'}, ${s.reps} reps`))}`;
}
// Prise d'un exercice reçu d'un ami ou d'un élève (js/data/grips.js : libellés fixes, échappés quand même)
function reviewGripHtml(e) {
  const t = gripText(e.grip, e);
  return t ? `<span class="hex__sets hex__sets--note">${esc(t)}</span>` : '';
}
// Lignes « Drop set série 3 : 46 kg × 5 », « Top set série 1 · Back-off séries 2, 3 » sous les séries (js/data/intensif.js), puis
// « Série 3, bras droit : 12 kg × 9 » pour une série notée par bras (js/data/unilateral.js)
function techLinesHtml(e) {
  if ((e.measure || measureOf(e)) !== 'reps') return '';
  return [...techLines(e.sets, setKind(e), e), ...sideLines(e, e.sets, setKind(e))]
    .map(l => `<span class="hex__sets hex__sets--note num">${esc(l)}</span>`).join('');
}

// Records battus par la séance : notés à l'enregistrement, sinon recalculés (séance d'avant, js/data/records.js)
function historyRecordsGroup(h) {
  const recs = entryRecords(h);
  if (!recs.length) return '';
  return `<div class="group-title">${recs.length > 1 ? 'Records' : 'Record'}</div>
        <div class="group">${recs.map(r => notedRecordCell(r)).join('')}</div>`;
}

// Petite vignette du muscle principal d'un exercice, à droite de son nom (décorative ; texte agrandi : retirée)
function histExThumbHtml(e, index) {
  const id = exerciseMuscles(e, index).primary?.[0];
  return isMuscleId(id) ? progThumbHtml(id, 'hex__img') : '';
}

// Historique › Séance : la séance vient de la route (« history-detail:ID »)
function renderHistoryDetail(id) {
  const h = (data.history || []).find(x => x.id === id);
  if (!h) {
    return `<div class="view history-detail view--grouped">${navBar({ title: 'Séance' })}
      <div class="scr"><div class="empty-note">Cette séance n'existe plus.</div></div></div>`;
  }
  const progId = entryProg(h);
  let when = capitalize(fmtDate(h.date, 'long'));
  // L'heure n'a de sens que pour une séance chronométrée (une séance passée n'a pas d'heure)
  // « · 13:11 » d'un seul tenant (.hdhead__time, nowrap) : l'heure ne se coupe jamais (« 1 / 3:11 » en AX33) ni ne
  // laisse son point seul en bout de ligne ; il passe à la ligne entier si la date remplit déjà la ligne
  if (h.duration) when = `${esc(when)} <span class="hdhead__time">·\u00a0${fmtTime(h.date)}</span>`;
  const vol   = sessionVolume(h.exercises || [], entryBodyKg(h));
  const nSets = (h.exercises || []).reduce((a, e) => a + workSets(e.sets).length, 0);   // séries de travail
  const index = chosenMusclesIndex();
  // Groupes travaillés, du plus au moins sollicité : écrits sous la date (lus par VoiceOver, restent en texte agrandi) ;
  // le personnage, à droite, montre les muscles ciblés et ceux en soutien, comme la carte de la liste (décoratif) ; la
  // légende des deux teintes est ici, une seule fois (dans la liste, elle coûtait une carte visible sur iPhone SE)
  const groups = exercisesGroups(h.exercises, index);
  const body = exercisesBodyHtml(h.exercises, index, 'hdhead__body-map');
  const art = body ? `<span class="hdhead__map">${body}</span>` : '';
  return `
    <div class="view history-detail view--grouped">
      ${navBar({ title: '', right: `<button class="navbar__text" data-action="edit-session" data-id="${esc(h.id)}">Modifier</button>` })}
      <div class="scr">
        <section class="hdhead mgc${art ? '' : ' hdhead--noart'}">
          <div class="hdhead__text mgc__text">
            <h1 class="scr-title hdhead__title">${historyEntryLabel(h)}</h1>
            <span class="hdhead__when">${when}</span>
            ${progId !== data.activeProgramme && progId !== FREE ? `<span class="hdhead__prog">Programme ${esc(progMeta(progId).name)}</span>` : ''}
            ${groups.length ? `<span class="hdhead__mus">${groups.slice(0, 3).map(x => esc(x.g.label)).join('\u00a0· ')}</span>` : ''}
            ${body ? bodyLegendHtml('hd-legend') : ''}
          </div>
          ${art}
        </section>
        <div class="tiles">
          <div class="tile"><span class="tile__val num">${h.duration ? fmtDuration(h.duration) : '—'}</span><span class="tile__lbl">Durée</span></div>
          <div class="tile"><span class="tile__val num">${vol > 0 ? fmtVolume(vol) : '—'}</span><span class="tile__lbl">Soulevé</span></div>
          <div class="tile"><span class="tile__val num">${nSets}</span><span class="tile__lbl">${nSets > 1 ? 'Séries' : 'Série'}</span></div>
        </div>
        <div class="group-title">Exercices</div>
        <div class="group">
          ${(h.exercises || []).map((e, i, xs) => `
            <div class="cell hex hex--art">
              ${histExThumbHtml(e, index)}
              <span class="cell__body">
                <span class="hex__name">${ssTagHtml(xs, i)}${esc(e.name)}</span>
                ${gripText(e.grip, e) ? `<span class="hex__sets hex__sets--note">${gripText(e.grip, e)}</span>` : ''}
                <span class="hex__sets num">${esc(sidePrefix(e, e.sets))}${setsLine(e.sets, measureOf(e), setKind(e))}</span>
                ${warmupText(e.sets) ? `<span class="hex__sets hex__sets--note num">${esc(warmupText(e.sets))}</span>` : ''}
                ${techLinesHtml(e)}
                ${rirLine(e.sets) ? `<span class="hex__sets hex__sets--note num">${esc(rirLine(e.sets))}</span>` : ''}
                ${historyNotesHtml(e)}
              </span>
            </div>`).join('')}
        </div>
        ${historyRecordsGroup(h)}
        ${h.notes ? `<div class="group-title">Notes</div><div class="group group--pad"><p class="hnotes">${esc(h.notes)}</p></div>` : ''}
        ${historyCoachGroup(h)}
        ${historySocialGroup(h)}
        ${stravaHistoryGroup(h)}
        <div class="share-detail">${shareStoryButton(h.id)}</div>
        <div class="group group--gap">
          <button class="cell cell--destructive" data-action="delete-session" data-id="${esc(h.id)}">Supprimer de l'historique</button>
        </div>
      </div>
    </div>`;
}

// L'historique fait foi : délais de récupération et records en sont recalculés.
// removed : séance retirée ; si elle fixait le délai de sa catégorie, il recule à la précédente.
function historyChanged(removed = null) {
  if (removed) { releaseTimer(removed); renoteRecords(removed); }
  syncTimersFromHistory();
  recomputePRFromHistory();
  save();
}

// Supprime une séance après confirmation : elle part dans « Supprimés récemment » (TRASH_DAYS jours).
// Depuis la liste, seule sa cellule disparaît (pas de re-rendu complet) ; « Annuler » pendant 5 s.
async function deleteSession(id) {
  const ok = await confirmSheet('Supprimer cette séance ?',
    `Elle sera retirée de l'historique et des statistiques. Tu pourras la restaurer pendant ${TRASH_DAYS} jours dans Réglages › Supprimés récemment.`,
    'Supprimer de l\'historique');   // « Supprimer la séance » : retirer une séance d'un programme
  if (!ok) { closeOpenRows(); return; }
  const removed = moveToTrash(id);
  if (!removed) return;
  historyChanged(removed);
  if (currentView() === 'history-detail') routeTo('history');
  else {
    const row = document.querySelector(`.hrow[data-id="${CSS.escape(id)}"]`);
    if (row) {
      const sec = row.closest('.hmonth');
      row.remove();
      if (sec && !sec.querySelector('.hrow')) sec.remove();
    } else render();
  }
  showToast('Séance supprimée', {
    action: 'Annuler', duration: 5000,
    onAction: () => {
      if (!restoreFromTrash(id)) return;
      historyChanged();
      if (['history', 'history-detail', 'trash'].includes(currentView())) render();
    },
  });
}

// Balayage vers la gauche sur une cellule de l'historique : révèle « Supprimer »
let hSwipe = null;
let suppressClick = false;
const SWIPE_W = 88;
function closeOpenRows(except) {
  document.querySelectorAll('.hrow.is-open').forEach(r => { if (r !== except) { r.classList.remove('is-open'); r.querySelector('.hcell').style.transform = ''; } });
}
document.addEventListener('pointerdown', e => {
  const cell = e.target.closest?.('.hcell:not(.hcell--static)');
  if (!cell || currentView() !== 'history') { if (!e.target.closest?.('.hrow__del')) closeOpenRows(); return; }
  const row = cell.parentElement;
  closeOpenRows(row);
  hSwipe = { row, cell, x: e.clientX, y: e.clientY, base: row.classList.contains('is-open') ? -SWIPE_W : 0, axis: null, dx: 0, id: e.pointerId };
});
document.addEventListener('pointermove', e => {
  if (!hSwipe || e.pointerId !== hSwipe.id) return;
  const dx = e.clientX - hSwipe.x, dy = e.clientY - hSwipe.y;
  if (!hSwipe.axis) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    hSwipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (hSwipe.axis === 'x') { hSwipe.cell.classList.add('is-swiping'); hSwipe.row.classList.add('is-swipe'); try { hSwipe.cell.setPointerCapture(e.pointerId); } catch {} }
  }
  if (hSwipe.axis !== 'x') return;
  hSwipe.dx = dx;
  const t = Math.max(-SWIPE_W * 1.3, Math.min(0, hSwipe.base + dx));
  hSwipe.cell.style.transform = `translateX(${t}px)`;
});
function endHSwipe(e) {
  if (!hSwipe || e.pointerId !== hSwipe.id) return;
  const s = hSwipe; hSwipe = null;
  s.cell.classList.remove('is-swiping');
  s.row.classList.remove('is-swipe');
  if (s.axis !== 'x') return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 50);
  const open = s.base + s.dx < -SWIPE_W / 2;
  s.row.classList.toggle('is-open', open);
  s.cell.style.transform = open ? `translateX(${-SWIPE_W}px)` : '';
}
document.addEventListener('pointerup', endHSwipe);
document.addEventListener('pointercancel', endHSwipe);
// Le clic qui suit un balayage n'ouvre pas la séance ; une cellule ouverte se referme au tap
document.addEventListener('click', e => {
  const cell = e.target.closest?.('.hcell');
  if (!cell) return;
  if (suppressClick || cell.parentElement.classList.contains('is-open')) {
    e.stopImmediatePropagation(); e.preventDefault();
    if (!suppressClick) { cell.parentElement.classList.remove('is-open'); cell.style.transform = ''; }
  }
}, true);

// Recherche dans l'historique : seule la liste est redessinée (le champ garde le focus)
document.addEventListener('input', e => {
  if (e.target.id === 'histSearch') { histQuery = e.target.value; histMonths = 3; refreshHistoryList(); }
});

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'go-history': (e, el) => {
    if (el.closest('.tabbar')) switchTab('history'); else navigate('history');
  },
  'open-history': (e, el) => {
    navigate(makeRoute('history-detail', el.dataset.id));
  },
  'hist-filter': (e, el) => setHistoryFilter(el.dataset.cat),
  'hist-filter-more': () => historyFilterSheet(),
  'hist-more': () => {
    histMonths += 3; refreshHistoryList();
  },
  'swipe-delete-session': (e, el) => deleteSession(el.dataset.id),
  'delete-session':       (e, el) => deleteSession(el.dataset.id),
});
