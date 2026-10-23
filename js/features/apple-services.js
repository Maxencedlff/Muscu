// ═══════════════════════════════════════════════════════════
//  Services Apple (app iOS uniquement) : Santé et Apple Music
// ═══════════════════════════════════════════════════════════
'use strict';

// Réglages data.healthOn / data.musicOn (false par défaut). Dans le navigateur, rien n'est affiché :
// Native.isNative vaut false et ces fonctions renvoient du vide.

const MET_STRENGTH = 5;          // musculation, effort soutenu (Compendium of Physical Activities)
const WEIGHT_TTL   = 5 * 60_000; // pesées relues dans Santé au plus toutes les 5 minutes

let weightCache = { at: 0, samples: [] };

const healthEnabled = () => Native.isNative && data.healthOn === true;
const musicEnabled  = () => Native.isNative && data.musicOn === true;

// ── Santé : entraînement de fin de séance ───────────────────

// Énergie active estimée (kcal) : MET × poids (kg) × durée (h). Sans pesée connue : pas d'estimation.
function estimateKcal(durationMs, kg) {
  if (!(kg > 0) || !(durationMs > 0)) return 0;
  return Math.round(MET_STRENGTH * kg * (durationMs / 3_600_000));
}

// Appelé après l'enregistrement d'une séance ; un échec ne bloque jamais le bilan
async function syncWorkoutToHealth(entry) {
  if (!healthEnabled() || !entry?.duration) return;
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

async function bodyMassSamples() {
  if (!healthEnabled()) return [];
  if (Date.now() - weightCache.at < WEIGHT_TTL) return weightCache.samples;
  const samples = await Native.health.bodyMass(90);
  weightCache = { at: Date.now(), samples };
  return samples;
}

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

// Dernière pesée déjà lue : objet, null (Santé n'en a aucune) ou undefined (pas encore lue)
function knownLatestBodyMass() {
  if (Date.now() - weightCache.at >= WEIGHT_TTL) return undefined;
  return weightCache.samples[0] || null;
}

// Emplacement dans Progrès, rempli après le dessin (lecture asynchrone dans Santé)
function renderWeightGroup() {
  if (!healthEnabled()) return '';
  return `<div class="group-title">Poids corporel</div>
        <div class="group" id="weightGroup"><div class="cell"><span class="cell__body"><span class="cell__sub">Lecture dans Santé…</span></span></div></div>`;
}

async function fillWeightGroup() {
  const box = $('#weightGroup');
  if (!box) return;
  const samples = await bodyMassSamples();
  if (!$('#weightGroup')) return;   // écran quitté entre-temps
  if (!samples.length) {
    box.innerHTML = `<div class="cell"><span class="cell__body"><span class="cell__title">Aucune pesée</span>
      <span class="cell__sub">Ajoute ton poids dans l'app Santé (ou une balance connectée) pour le suivre ici.</span></span></div>`;
    return;
  }
  const last  = samples[0];
  const month = samples.filter(s => s.date >= last.date - 30 * 86_400_000);
  const delta = last.kg - month[month.length - 1].kg;
  const trend = month.length > 1 && Math.abs(delta) >= 0.05
    ? `${delta > 0 ? '+' : '−'}${fmtNum(Math.abs(delta), 1)} kg sur 30 jours` : 'Stable sur 30 jours';
  box.innerHTML = `
    <div class="cell">
      <span class="cell__body">
        <span class="cell__title num">${fmtNum(last.kg, 1)} kg</span>
        <span class="cell__sub">${esc(trend)} · ${fmtDate(last.date)}</span>
      </span>
      ${sparkline(samples.slice(0, 30).reverse().map(s => s.kg))}
    </div>`;
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
  return `
        <div class="group-title">Services Apple</div>
        <div class="group">
          <button class="cell" data-action="setting-health" role="switch" aria-checked="${data.healthOn === true}">
            <span class="cell__body"><span class="cell__title">Apple Santé</span>
              <span class="cell__sub">Enregistre tes séances, lit ton poids</span></span>
            ${tog(data.healthOn === true)}
          </button>
          ${data.healthOn === true ? renderBodyWeightCell() : ''}
          ${data.healthOn === true ? (() => {
            const n = healthBacklog().length;
            return `<button class="cell cell--nav" data-action="health-backfill">
            <span class="cell__body"><span class="cell__title">Envoyer l'historique dans Santé</span>
              <span class="cell__sub">${n ? plural(n, 'séance pas encore envoyée', 'séances pas encore envoyées') : 'Tout est déjà dans Santé'}</span></span>
            ${icon('chevron.right', 16)}
          </button>`; })() : ''}
          <button class="cell" data-action="setting-music" role="switch" aria-checked="${data.musicOn === true}">
            <span class="cell__body"><span class="cell__title">Apple Music</span>
              <span class="cell__sub">Pilote l'app Musique d'Apple pendant la séance (pas Spotify ni Deezer)</span></span>
            ${tog(data.musicOn === true)}
          </button>
        </div>`;
}

// Poids pour les calories : celui de Santé dès qu'il y a une pesée (affiché, non modifiable ici),
// sinon le poids saisi dans l'app. Une pesée ajoutée plus tard dans Santé prend le relais.
function renderBodyWeightCell() {
  const last = knownLatestBodyMass();
  const title = '<span class="cell__title">Poids du corps</span>';
  if (last === undefined) {
    return `<div class="cell" id="bodyWeightCell">
            <span class="cell__body">${title}<span class="cell__sub">Lecture dans Santé…</span></span></div>`;
  }
  if (last) {
    return `<div class="cell" id="bodyWeightCell">
            <span class="cell__body">${title}
              <span class="cell__sub">Pris dans Santé · pesée du ${esc(fmtDate(last.date))}</span></span>
            <span class="cell__value num">${fmtW(last.kg)} ${unitLbl()}</span></div>`;
  }
  return `<button class="cell cell--nav" id="bodyWeightCell" data-action="set-body-weight">
            <span class="cell__body">${title}
              <span class="cell__sub">Aucune pesée dans Santé : saisis-le ici</span></span>
            <span class="cell__value num">${data.bodyWeightKg ? `${fmtW(data.bodyWeightKg)} ${unitLbl()}` : 'Non renseigné'}</span>
            ${icon('chevron.right', 16)}
          </button>`;
}

// Réglages : la cellule est redessinée une fois Santé lue (lecture asynchrone)
async function fillBodyWeightCell() {
  if (!$('#bodyWeightCell') || knownLatestBodyMass() !== undefined) return;
  await bodyMassSamples();
  const cell = $('#bodyWeightCell');   // écran quitté ou redessiné entre-temps
  if (cell) cell.outerHTML = renderBodyWeightCell();
}

registerActions({
  'setting-health': async () => {
    if (data.healthOn) { data.healthOn = false; save(); render(); return; }
    const res = await Native.health.authorize();
    if (!res.available) { showToast('Santé n\'est pas disponible sur cet appareil', { error: true }); return; }
    if (!res.workouts) {
      await dialog({ title: 'Accès à Santé refusé',
        message: 'Autorise MDLF Training dans Réglages › Santé › Accès aux données et appareils, puis réessaie.',
        actions: [{ label: 'OK', style: 'preferred' }] });
      return;
    }
    data.healthOn = true; weightCache = { at: 0, samples: [] };
    save(); render(); showToast('Apple Santé connecté');
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
    refreshSummaryBodyKg();
    save(); render(); showToast('Poids enregistré');
  },
  'music-play':     async () => { haptic(); updateMusicBar(await Native.music.command('play')); },
  'music-pause':    async () => { haptic(); updateMusicBar(await Native.music.command('pause')); },
  'music-next':     async () => { haptic(); updateMusicBar(await Native.music.command('next')); },
  'music-previous': async () => { haptic(); updateMusicBar(await Native.music.command('previous')); },
});
