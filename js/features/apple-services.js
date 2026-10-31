// ═══════════════════════════════════════════════════════════
//  Services Apple (app iOS) : Santé et Apple Music ; sur Android, Health Connect seul
// ═══════════════════════════════════════════════════════════
'use strict';

// Réglages data.healthOn / data.musicOn (false par défaut). Dans le navigateur, rien n'est affiché :
// Native.isNative vaut false et ces fonctions renvoient du vide.

const MET_STRENGTH = 5;          // musculation, effort soutenu (Compendium of Physical Activities)
const WEIGHT_TTL   = 5 * 60_000; // pesées relues dans Santé au plus toutes les 5 minutes

let weightCache = { at: 0, samples: [], failed: false };   // failed : dernière lecture en échec

const healthEnabled = () => Native.isNative && data.healthOn === true;

// Textes qui dépendent du système : Apple Santé sur iOS, Health Connect sur Android (Native.health.name)
const HEALTH_TEXT = Native.platform === 'android' ? {
  unavailable: 'Installe ou mets à jour Health Connect depuis le Play Store, puis réessaie',
  refused: 'Autorise MDLF Training dans Health Connect › Autorisations des applications, puis réessaie.',
} : {
  unavailable: 'Santé n\'est pas disponible sur cet appareil',
  refused: 'Autorise MDLF Training dans Réglages › Santé › Accès aux données et appareils, puis réessaie.',
};
const musicEnabled  = () => Native.music.available && data.musicOn === true;   // Apple Music : iOS seulement

// ── Santé : entraînement de fin de séance ───────────────────

// Énergie active estimée (kcal) : MET × poids (kg) × durée (h). Sans pesée connue : pas d'estimation.
function estimateKcal(durationMs, kg) {
  if (!(kg > 0) || !(durationMs > 0)) return 0;
  return Math.round(MET_STRENGTH * kg * (durationMs / 3_600_000));
}

// Autorisations : iOS n'affiche sa fenêtre que pour les types jamais demandés (et retient la réponse,
// qu'il ne dit pas pour la lecture). Le module Android (HealthPlugin.kt) imite ce comportement : chaque
// ensemble n'est demandé qu'une fois, et 'unnecessary' veut dire « déjà demandé », pas « accordé ».
// Elle ne doit jamais s'ouvrir sans contexte, au lancement :
//  - ensureHealthAuth : poids et écriture des séances, une fois par lancement, avant le premier accès.
//    Cas visé : Santé activé dans une donnée restaurée (copie iCloud, nouvel iPhone, réinstallation) alors
//    qu'iOS n'a jamais posé la question pour cette installation : lecture et écriture refusées, « Lecture
//    dans Santé… » sans fin. Sans les courses et le vélo : une installation qui a déjà répondu ne voit rien.
//  - courses et vélo (lecture des entraînements et distances, arrivée avec la build du 25/10/2026) :
//    demandés avec le reste à l'activation de Santé, sinon par un toucher dans Réglages › Services Apple
//    (« Courses et vélo de Santé », action health-workouts-auth). Tant qu'iOS ne les a jamais demandés,
//    rien n'est lu (workoutsAuthStatus).
let healthAuthAsked = null;
function ensureHealthAuth() {
  return (healthAuthAsked ||= Promise.resolve().then(() => Native.health.authorize({ workouts: false })).catch(() => null));
}

// Demande des courses et du vélo encore à faire ? Native.health.requestStatus, lu une fois par lancement
// (et après une demande) : 'shouldRequest', 'unnecessary' ou 'unknown' (build antérieure, échec : la
// lecture est tentée, elle n'ouvre jamais de fenêtre). workoutsAuthKnown : valeur déjà lue, pour Réglages.
let workoutsAuthState = null, workoutsAuthKnown = null;
function workoutsAuthStatus() {
  return (workoutsAuthState ||= Native.health.requestStatus().catch(() => 'unknown').then(st => (workoutsAuthKnown = st)));
}
function resetWorkoutsAuth() { workoutsAuthState = null; workoutsAuthKnown = null; }

// Appelé après l'enregistrement d'une séance ; un échec ne bloque jamais le bilan
async function syncWorkoutToHealth(entry) {
  if (!healthEnabled() || !entry?.duration) return;
  await ensureHealthAuth();
  const kg  = await weightForCalories();
  const end = entry.date;
  const ok  = await Native.health.saveWorkout({ start: end - entry.duration, end, kcal: estimateKcal(entry.duration, kg) });
  if (ok) { entry.healthSaved = true; save(true); }
  else showToast('Séance non enregistrée dans Santé (autorisation ?)', { error: true });
}

// ── Santé : séances passées ─────────────────────────────────

const DEFAULT_SESSION_MS = 60 * 60_000;

// Séances pas encore envoyées à Santé, de la plus ancienne à la plus récente
function healthBacklog() {
  return (data.history || []).filter(h => !h.healthSaved && h.exercises?.length).sort((a, b) => a.date - b.date);
}

// Durée retenue pour une séance saisie après coup (sans chrono) : médiane des séances chronométrées
function typicalDuration() {
  const ds = (data.history || []).map(h => h.duration).filter(d => d > 5 * 60_000 && d < 4 * 3_600_000).sort((a, b) => a - b);
  return ds.length ? ds[Math.floor(ds.length / 2)] : DEFAULT_SESSION_MS;
}

// Entraînement Santé d'une séance : une séance chronométrée se termine à sa date d'enregistrement ;
// une séance saisie après coup (date à midi, sans durée) commence à cette heure-là
function workoutOf(h, typical, kg) {
  const dur = h.duration > 0 ? h.duration : typical;
  const start = h.duration > 0 ? h.date - dur : h.date;
  return { start, end: start + dur, kcal: estimateKcal(dur, kg) };
}

// Envoie les séances pas encore dans Santé ; renvoie { sent, failed } (l'action s'occupe de l'affichage)
async function sendHistoryToHealth(onProgress = () => {}) {
  await ensureHealthAuth();
  const todo = healthBacklog();
  const typical = typicalDuration();
  const kg = await weightForCalories();
  let sent = 0, failed = 0;
  for (const h of todo) {
    if (await Native.health.saveWorkout(workoutOf(h, typical, kg))) { h.healthSaved = true; sent++; }
    else failed++;
    onProgress(sent + failed, todo.length);
  }
  save(true);
  return { sent, failed };
}

// ── Santé : poids corporel ──────────────────────────────────

// Lecture en échec : jamais gardée (sinon Progrès dirait « Aucune pesée » et Réglages montrerait le
// poids de secours pendant toute la durée du cache), mais signalée (failed) pour proposer de réessayer
// au lieu d'un « Lecture dans Santé… » sans fin. Lecture vide : relue au bout d'une minute.
// Rien sur 90 jours : la dernière pesée est cherchée sur 10 ans (on se pèse parfois rarement).
const WEIGHT_EMPTY_TTL = 60_000;
async function bodyMassSamples() {
  if (!healthEnabled()) return [];
  const ttl = weightCache.samples.length ? WEIGHT_TTL : WEIGHT_EMPTY_TTL;
  if (Date.now() - weightCache.at < ttl) return weightCache.samples;
  await ensureHealthAuth();
  let samples = await Native.health.bodyMass(90);
  if (samples && !samples.length) samples = await Native.health.bodyMass(3650);
  if (!samples) { weightCache.failed = true; return weightCache.samples; }   // on garde la dernière lecture
  weightCache = { at: Date.now(), samples, failed: false };
  return samples;
}
// Nouvel essai demandé (Réglages, Progrès) : le cache est vidé avant de relire
function retryBodyMass() { weightCache = { at: 0, samples: weightCache.samples, failed: false }; }

async function latestBodyMass() {
  return (await bodyMassSamples())[0] || null;
}

// Poids retenu pour les calories : dernière pesée de Santé, sinon le poids de secours des Réglages
async function weightForCalories() {
  return (await latestBodyMass())?.kg || data.bodyWeightKg || null;
}

// Dernière pesée lue dans Santé (kg), même au-delà de la durée du cache ; null si aucune
function lastBodyMassKg() { return healthEnabled() ? weightCache.samples[0]?.kg || null : null; }
// Lecture au démarrage : le poids est connu avant la première séance enregistrée
function prefetchBodyMass() { if (healthEnabled()) bodyMassSamples().catch(() => {}); }

// Dernière pesée déjà lue : objet, null (Santé n'en a aucune) ou undefined (pas encore lue, ou en échec :
// voir weightCache.failed)
function knownLatestBodyMass() {
  if (Date.now() - weightCache.at >= (weightCache.samples.length ? WEIGHT_TTL : WEIGHT_EMPTY_TTL)) return undefined;
  return weightCache.samples[0] || null;
}

// Emplacement dans Progrès, rempli après le dessin (lecture asynchrone dans Santé)
function renderWeightGroup() {
  // Sans Santé : les pesées saisies dans l'app, même cellule, dessinée tout de suite
  if (!healthEnabled()) {
    const log = data.bodyWeightLog || [];
    return log.length ? `<div class="group-title">Poids corporel</div>
        <div class="group">${weightCellHtml(log, 'set-body-weight')}</div>` : '';
  }
  return `<div class="group-title">Poids corporel</div>
        <div class="group" id="weightGroup"><div class="cell"><span class="cell__body"><span class="cell__sub">Lecture dans Santé…</span></span></div></div>`;
}

async function fillWeightGroup() {
  const box = $('#weightGroup');
  if (!box) return;
  const samples = await bodyMassSamples();
  if (!$('#weightGroup')) return;   // écran quitté entre-temps
  if (!samples.length && weightCache.failed) {
    box.innerHTML = `<button class="cell cell--nav" data-action="retry-body-weight"><span class="cell__body"><span class="cell__title">Santé n'a pas répondu</span>
      <span class="cell__sub">Touche pour réessayer.</span></span>${icon('arrow.clockwise', 18)}</button>`;
    return;
  }
  if (!samples.length) {
    // iOS ne dit pas si la lecture du poids est refusée : il renvoie juste une liste vide
    box.innerHTML = `<div class="cell"><span class="cell__body"><span class="cell__title">Aucune pesée lue</span>
      <span class="cell__sub">Ajoute ton poids dans Santé. Si tu en as déjà : Réglages de l'iPhone › Santé › Accès aux données et appareils › MDLF Training › autorise Poids.</span></span></div>`;
    return;
  }
  box.innerHTML = weightCellHtml(samples);
}

// Dernière pesée, tendance sur 30 jours et courbe des 30 dernières : pesées de Santé ou saisies dans
// l'app (samples du plus récent au plus ancien). action : la cellule devient un bouton (pesée à ajouter).
function weightCellHtml(samples, action = '') {
  const last  = samples[0];
  const month = samples.filter(s => s.date >= last.date - 30 * 86_400_000);
  // Dans l'unité de l'app (kg ou lbs), comme la saisie
  const delta = toUnitW(last.kg) - toUnitW(month[month.length - 1].kg);
  const trend = month.length > 1 && Math.abs(delta) >= 0.05
    ? `${delta > 0 ? '+' : '−'}${fmtNum(Math.abs(delta), 1)} ${unitLbl()} sur 30 jours` : 'Stable sur 30 jours';
  const value = `${fmtNum(toUnitW(last.kg), 1)} ${unitLbl()}`;
  const tag = action ? 'button' : 'div';
  return `
    <${tag} class="cell${action ? ' cell--nav' : ''}"${action ? ` data-action="${action}" aria-label="Poids ${value}, ${esc(trend)}, ${fmtDate(last.date)}. Ajouter une pesée"` : ''}>
      <span class="cell__body">
        <span class="cell__title num">${value}</span>
        <span class="cell__sub">${esc(trend)} · ${fmtDate(last.date)}</span>
      </span>
      ${sparkline(samples.slice(0, 30).reverse().map(s => s.kg))}
      ${action ? icon('chevron.right', 16) : ''}
    </${tag}>`;
}

// ── Santé : courses et sorties vélo ─────────────────────────

// Relues dans Santé comme les pesées (cache en mémoire, jamais dans data : voir js/data/health-workouts.js),
// sur les 60 derniers jours : assez pour l'Historique récent et la récupération, sans tout relire.
// Lecture en échec : la dernière liste est gardée (failed) et Santé n'est pas relu avant WEIGHT_EMPTY_TTL
// (failedAt), sinon chaque dessin de l'accueil relancerait un appel natif.
const HEALTH_WORKOUT_DAYS = 60;
const emptyWorkoutCache = () => ({ at: 0, list: [], failed: false, failedAt: 0 });
let workoutCache = emptyWorkoutCache();

// Relit les entraînements si le cache a expiré ; renvoie true si la liste a changé (l'écran se redessine).
// Deux appels rapprochés (accueil puis historique) partagent la même lecture (workoutLoad).
let workoutLoad = null;
function loadHealthWorkouts() {
  if (!healthEnabled()) return Promise.resolve(false);
  return (workoutLoad ||= readHealthWorkouts().finally(() => { workoutLoad = null; }));
}
async function readHealthWorkouts() {
  const now = Date.now(), ttl = workoutCache.list.length ? WEIGHT_TTL : WEIGHT_EMPTY_TTL;
  if (now - workoutCache.at < ttl || now - (workoutCache.failedAt || 0) < WEIGHT_EMPTY_TTL) return false;
  if (await workoutsAuthStatus() === 'shouldRequest') return false;   // jamais demandé : rien à lire, rien demandé ici
  const list = await Native.health.workouts(HEALTH_WORKOUT_DAYS);
  if (!list) { workoutCache = { ...workoutCache, failed: true, failedAt: Date.now() }; return false; }   // dernière lecture gardée
  const changed = JSON.stringify(list) !== JSON.stringify(workoutCache.list);
  workoutCache = { ...emptyWorkoutCache(), at: Date.now(), list };
  return changed;
}

// Lignes de Santé déjà lues, au format d'une séance ; recalculées seulement quand la lecture ou
// l'historique changent (l'accueil les lit pour chaque séance)
let healthEntriesMemo = { key: null, entries: [] };
function healthEntries() {
  if (!healthEnabled() || !workoutCache.list.length) return [];
  const h = data.history || [];
  const key = `${workoutCache.at}:${h.length}:${h[0]?.id}:${h[0]?.date}`;
  if (healthEntriesMemo.key !== key) healthEntriesMemo = { key, entries: healthHistoryEntries(workoutCache.list, h) };
  return healthEntriesMemo.entries;
}

// Après le dessin de l'accueil et de l'historique : lecture en arrière-plan, puis l'écran est mis à jour
// s'il est toujours affiché (refresh : redessin propre à l'écran)
function mountHealthWorkouts(viewName, refresh) {
  if (!healthEnabled()) return;
  loadHealthWorkouts().then(changed => { if (changed && currentView() === viewName) refresh(); }).catch(() => {});
}

// ── Apple Music : barre de lecture pendant la séance ────────

let musicState = null;
let musicListening = false;

// Barre masquée tant que l'app Musique n'a aucun morceau (rien en cours, ou musique écoutée dans
// une autre app comme Spotify, qu'iOS ne laisse pas piloter) ; un morceau en pause la garde visible
function musicBarIdle(st) { return !st?.title; }

function renderMusicBar() {
  if (!musicEnabled()) return '';
  return `<div class="music-bar ${musicBarIdle(musicState) ? 'music-bar--idle' : ''}" id="musicBar" aria-label="Apple Music">${musicBarInner(musicState)}</div>`;
}

function musicBarInner(st) {
  const playing = !!st?.playing;
  const title   = st?.title ? esc(st.title) : 'Aucune musique en cours';
  const artist  = st?.artist ? esc(st.artist) : (st?.title ? '' : 'Lance une lecture');
  const art     = st?.artwork ? `<img class="music-bar__art" src="${esc(st.artwork)}" alt="">`
                              : `<span class="music-bar__art music-bar__art--empty" aria-hidden="true">${icon('music', 20)}</span>`;
  return `
    ${art}
    <span class="music-bar__text">
      <span class="music-bar__title">${title}</span>
      ${artist ? `<span class="music-bar__artist">${artist}</span>` : ''}
    </span>
    <button class="music-bar__btn" data-action="music-previous" aria-label="Morceau précédent">${icon('backward', 22)}</button>
    <button class="music-bar__btn" data-action="${playing ? 'music-pause' : 'music-play'}" aria-label="${playing ? 'Pause' : 'Lecture'}">${icon(playing ? 'pause' : 'play', 24)}</button>
    <button class="music-bar__btn" data-action="music-next" aria-label="Morceau suivant">${icon('forward', 22)}</button>`;
}

function updateMusicBar(st) {
  if (st && st.authorized === false) { data.musicOn = false; save(); return; }
  musicState = st || musicState;
  const bar = $('#musicBar');
  if (bar) {
    bar.innerHTML = musicBarInner(musicState);
    bar.classList.toggle('music-bar--idle', musicBarIdle(musicState));
  }
}

// Après le dessin de la séance : état courant, puis mises à jour poussées par iOS
async function mountMusicBar() {
  if (!musicEnabled() || !$('#musicBar')) return;
  if (!musicListening) { musicListening = true; Native.music.onChange(updateMusicBar); }
  updateMusicBar(await Native.music.nowPlaying());
}

// ── Réglages ────────────────────────────────────────────────

function renderAppleServicesGroup(tog) {
  if (!Native.isNative) return '';
  // Android : pas d'Apple Music, la santé passe par Health Connect (Native.health.name)
  return `
        <div class="group-title">${Native.music.available ? 'Services Apple' : 'Santé'}</div>
        <div class="group">
          <button class="cell" data-action="setting-health" role="switch" aria-checked="${data.healthOn === true}">
            <span class="cell__body"><span class="cell__title">${Native.health.name}</span>
              <span class="cell__sub">Enregistre tes séances, lit ton poids, tes courses et sorties vélo</span></span>
            ${tog(data.healthOn === true)}
          </button>
          ${data.healthOn === true ? renderHealthWorkoutsCell() : ''}
          ${data.healthOn === true ? (() => {
            const n = healthBacklog().length;
            return `<button class="cell cell--nav" data-action="health-backfill">
            <span class="cell__body"><span class="cell__title">Envoyer l'historique dans Santé</span>
              <span class="cell__sub">${n ? plural(n, 'séance pas encore envoyée', 'séances pas encore envoyées') : 'Tout est déjà dans Santé'}</span></span>
            ${icon('chevron.right', 16)}
          </button>`; })() : ''}
          ${Native.music.available ? `<button class="cell" data-action="setting-music" role="switch" aria-checked="${data.musicOn === true}">
            <span class="cell__body"><span class="cell__title">Apple Music</span>
              <span class="cell__sub">Pilote l'app Musique d'Apple pendant la séance (pas Spotify ni Deezer)</span></span>
            ${tog(data.musicOn === true)}
          </button>` : ''}
        </div>`;
}

// Poids pour les calories (Réglages › Entraînement › Poids du corps, js/features/settings.js) : celui de Santé
// dès qu'il y a une pesée (affiché, non modifiable ici), sinon le poids saisi dans l'app. Une pesée ajoutée
// plus tard dans Santé prend le relais.
// « pesée d'aujourd'hui », « pesée d'hier », « pesée du mar. 21 oct. »
function weighInWhen(ts) {
  const d = fmtDate(ts);
  return d === 'Aujourd\'hui' || d === 'Hier' ? `d'${d.toLowerCase()}` : `du ${d}`;
}

function renderBodyWeightCell() {
  const last = knownLatestBodyMass();
  const title = '<span class="cell__title">Poids du corps</span>';
  if (last === undefined && weightCache.failed) {
    return `<button class="cell cell--nav" id="bodyWeightCell" data-action="retry-body-weight">
            <span class="cell__body">${title}<span class="cell__sub">Santé n'a pas répondu : touche pour réessayer</span></span>
            ${icon('arrow.clockwise', 18)}</button>`;
  }
  if (last === undefined) {
    return `<div class="cell" id="bodyWeightCell">
            <span class="cell__body">${title}<span class="cell__sub">Lecture dans Santé…</span></span></div>`;
  }
  if (last) {
    return `<div class="cell" id="bodyWeightCell">
            <span class="cell__body">${title}
              <span class="cell__sub">Pris dans Santé · pesée ${esc(weighInWhen(last.date))}</span></span>
            <span class="cell__value num">${fmtW(last.kg)} ${unitLbl()}</span></div>`;
  }
  return `<button class="cell cell--nav" id="bodyWeightCell" data-action="set-body-weight">
            <span class="cell__body">${title}
              <span class="cell__sub">Aucune pesée lue dans Santé : saisis-le ici</span></span>
            <span class="cell__value num">${data.bodyWeightKg ? `${fmtW(data.bodyWeightKg)} ${unitLbl()}` : 'Non renseigné'}</span>
            ${icon('chevron.right', 16)}
          </button>`;
}

// Courses et vélo de Santé : à autoriser tant qu'iOS ne les a jamais demandés (Santé activé avant la build
// qui les lit), puis rappel de ce qui en est fait. État pas encore lu ou inconnu (build antérieure) : rien.
function renderHealthWorkoutsCell() {
  const title = '<span class="cell__title">Courses et vélo de Santé</span>';
  if (workoutsAuthKnown === 'shouldRequest') {
    return `<button class="cell cell--nav" data-action="health-workouts-auth">
            <span class="cell__body">${title}
              <span class="cell__sub">Autorise leur lecture : elles s'affichent dans l'Historique et comptent pour la récupération</span></span>
            ${icon('chevron.right', 16)}
          </button>`;
  }
  if (workoutsAuthKnown !== 'unnecessary') return '';
  return `<div class="cell">
            <span class="cell__body">${title}
              <span class="cell__sub">Affichées dans l'Historique ; comptent pour la récupération à partir de 20 min</span></span>
          </div>`;
}
// Réglages : l'état de l'autorisation est lu une fois, puis l'écran est redessiné s'il est toujours affiché
function fillHealthWorkoutsCell() {
  if (!healthEnabled() || workoutsAuthKnown !== null) return;
  workoutsAuthStatus().then(st => { if (st !== 'unknown' && currentView() === 'settings') render(); });
}

// Réglages : la cellule est redessinée une fois Santé lue (lecture asynchrone)
async function fillBodyWeightCell() {
  if (!$('#bodyWeightCell') || knownLatestBodyMass() !== undefined || weightCache.failed) return;
  await bodyMassSamples();
  const cell = $('#bodyWeightCell');   // écran quitté ou redessiné entre-temps
  if (cell) cell.outerHTML = renderBodyWeightCell();
}

registerActions({
  'retry-body-weight': async () => {
    retryBodyMass();
    if ($('#weightGroup')) { $('#weightGroup').innerHTML = `<div class="cell"><span class="cell__body"><span class="cell__sub">Lecture dans Santé…</span></span></div>`; await fillWeightGroup(); }
    const cell = $('#bodyWeightCell');
    if (cell) { cell.outerHTML = renderBodyWeightCell(); await fillBodyWeightCell(); }
  },
  'setting-health': async () => {
    if (data.healthOn) { data.healthOn = false; save(); render(); return; }
    const res = await Native.health.authorize();
    if (!res.available) { showToast(HEALTH_TEXT.unavailable, { error: true }); return; }
    if (!res.workouts) {
      await dialog({ title: 'Accès à Santé refusé',
        message: HEALTH_TEXT.refused,
        actions: [{ label: 'OK', style: 'preferred' }] });
      return;
    }
    data.healthOn = true; weightCache = { at: 0, samples: [], failed: false }; workoutCache = emptyWorkoutCache();
    healthAuthAsked = Promise.resolve(res); resetWorkoutsAuth();   // tout vient d'être demandé
    save(); render(); showToast(`${Native.health.name} connecté`);
  },
  // Courses et vélo, demandés ici seulement (jamais au lancement : voir ensureHealthAuth)
  'health-workouts-auth': async () => {
    const res = await Native.health.authorize();
    if (!res.available) { showToast(HEALTH_TEXT.unavailable, { error: true }); return; }
    resetWorkoutsAuth(); workoutCache = emptyWorkoutCache();
    await workoutsAuthStatus();
    render();
    // Android seulement (iOS ne dit pas si une lecture est refusée : workoutsRead absent) : refus, ou
    // fenêtre que Health Connect ne montre plus après deux refus. Le toucher dit alors où autoriser.
    if (res.workoutsRead === false) {
      await dialog({ title: 'Accès aux courses refusé', message: HEALTH_TEXT.refused,
        actions: [{ label: 'OK', style: 'preferred' }] });
      return;
    }
    await loadHealthWorkouts();
  },
  'setting-music': async () => {
    if (data.musicOn) { data.musicOn = false; save(); render(); return; }
    if (!(await Native.music.authorize())) {
      await dialog({ title: 'Accès à Apple Music refusé',
        message: 'Autorise MDLF Training dans Réglages › Confidentialité et sécurité › Médias et Apple Music, puis réessaie.',
        actions: [{ label: 'OK', style: 'preferred' }] });
      return;
    }
    data.musicOn = true; save(); render(); showToast('Apple Music connecté');
  },
  'health-backfill': async () => {
    const n = healthBacklog().length;
    if (!n) { showToast('Tout ton historique est déjà dans Santé'); return; }
    if (!(await confirmSheet(`Envoyer ${plural(n, 'séance', 'séances')} dans Santé ?`,
      'Chaque séance devient un entraînement « Musculation » à sa date. Une séance saisie sans chrono reçoit ta durée habituelle. Les séances déjà envoyées ne sont pas renvoyées.',
      'Envoyer', false))) return;
    const { sent, failed } = await sendHistoryToHealth((i, total) => {
      if (i % 5 === 0 && i < total) showToast(`Envoi dans Santé… ${i}/${total}`);
    });
    render();
    if (failed) showToast(`${plural(sent, 'séance envoyée', 'séances envoyées')}, ${failed} en échec (autorisation ?)`, { error: true });
    else showToast(`${plural(sent, 'séance envoyée', 'séances envoyées')} dans Santé`);
  },
  'set-body-weight': async () => {
    if (await latestBodyMass()) { render(); showToast('Ton poids vient de Santé : modifie-le dans l\'app Santé'); return; }
    const lbs = data.unit === 'lbs';
    const v = await askNumber({ title: 'Poids du corps',
      message: 'Sert au volume des exercices au poids du corps (tractions, dips, pompes) et aux calories quand Santé n\'a aucune pesée.',
      value: data.bodyWeightKg ? fmtW(data.bodyWeightKg, { plain: true }) : '', unit: unitLbl(),
      min: lbs ? 55 : 25, max: lbs ? 660 : 300, decimal: true });
    if (v === null) return;
    data.bodyWeightKg = parseFloat(storeW(v));
    logBodyWeight(data.bodyWeightKg);   // courbe de Progrès sans Santé (jamais envoyée sur le compte)
    refreshSummaryBodyKg();
    save(); render(); showToast('Poids enregistré');
  },
  'music-play':     async () => { haptic(); updateMusicBar(await Native.music.command('play')); },
  'music-pause':    async () => { haptic(); updateMusicBar(await Native.music.command('pause')); },
  'music-next':     async () => { haptic(); updateMusicBar(await Native.music.command('next')); },
  'music-previous': async () => { haptic(); updateMusicBar(await Native.music.command('previous')); },
});
