// ═══════════════════════════════════════════════════════════
//  Repos : barre non bloquante et feuille détaillée
// ═══════════════════════════════════════════════════════════
'use strict';

let restInterval  = null;
let restTimeLeft  = 0;
let restEndTime   = 0;
let restActive    = false;
let restMinimized = false;
let restSheetOpen = false; // feuille détaillée du repos ouverte
let restTotal     = 0;     // durée totale du repos en cours (anneau de progression)

const RING_SMALL = 2 * Math.PI * 17;
const RING_BIG   = 2 * Math.PI * 100;
const REST_PRESETS = [60, 90, 120, 180, 240, 300]; // préréglages proposés dans les feuilles de repos

// Part du repos qui reste à l'instant même, calculée sur l'heure de fin et non sur la seconde entière :
// l'anneau se vide dès la première image (avant, il restait plein jusqu'au premier tic d'une seconde)
function restFraction(now = Date.now()) {
  if (!(restTotal > 0)) return 0;
  const left = restEndTime ? (restEndTime - now) / 1000 : restTimeLeft;
  return Math.min(1, Math.max(0, left / restTotal));
}

// Anneaux du repos redessinés à chaque image (requestAnimationFrame) : ils se vident en continu, sans
// transition CSS qui retarderait l'anneau sur le chiffre. iOS suspend requestAnimationFrame app en
// arrière-plan, rien ne tourne pour rien. Réduire les animations : l'anneau suit le tic (4 fois par seconde).
let restRingRaf = 0;
function restRingFrame() {
  restRingRaf = 0;
  if (!restActive) return;
  setRestRings(restFraction());
  restRingRaf = requestAnimationFrame(restRingFrame);
}
function setRestRings(f) {
  document.querySelector('.rest-mini .rest-ring__bar')?.setAttribute('stroke-dashoffset', RING_SMALL * (1 - f));
  document.querySelector('.sess-sheet--rest .rest-ring__bar')?.setAttribute('stroke-dashoffset', RING_BIG * (1 - f));
}
function startRestRings() {
  if (restRingRaf || typeof requestAnimationFrame !== 'function') return;
  try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch { /* sans matchMedia : animé */ }
  restRingRaf = requestAnimationFrame(restRingFrame);
}
function stopRestRings() { if (restRingRaf) cancelAnimationFrame(restRingRaf); restRingRaf = 0; }

function renderRestOverlay() {
  if (!restActive || !activeSession) return '';
  const nxt = nextSetParts();
  const off  = RING_SMALL * (1 - restFraction());
  const meta = sessionMeta(activeSession.category, activeSession.programme);
  return `
    <div class="rest-mini" role="region" aria-label="Repos" style="--cat-color:${meta.color}">
      <button class="rest-mini__main" data-action="expand-rest" aria-label="${restMiniLabel()}">
        <svg class="rest-ring rest-ring--small" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="17" class="rest-ring__track"/>
          <circle cx="20" cy="20" r="17" class="rest-ring__bar" stroke-dasharray="${RING_SMALL}" stroke-dashoffset="${off}"/>
        </svg>
        <span class="rest-mini__timer num" role="timer" aria-live="off">${fmtRest(restTimeLeft)}</span>
      </button>
      <button class="rest-mini__btn num" data-action="rest-adjust" data-d="-15" aria-label="Moins 15 secondes">−15</button>
      <button class="rest-mini__btn num" data-action="rest-adjust" data-d="15" aria-label="Plus 15 secondes">+15</button>
      <button class="rest-mini__skip" data-action="skip-rest" aria-label="Passer le repos">Passer</button>
      ${nxt ? `<div class="rest-mini__next">${nxt.sub ? `<span class="rest-mini__name">Ensuite :&nbsp;</span><span class="rest-mini__tail num">${esc(nxt.tail)}</span><span class="sr-text">, ${esc(nxt.name)}</span>`
        : `<span class="rest-mini__name">Ensuite : ${esc(nxt.name)}</span><span class="rest-mini__tail num"><span class="rest-mini__step">&nbsp;· ${esc(nxt.step)}</span>${esc(nxt.load).replace(/^ · /, '<span class="rest-mini__sep"> · </span>')}</span>`}</div>` : ''}
    </div>`;
}

function restSheetHtml() {
  const nxt = nextSetText();
  return `
    <div class="rs">
      <div class="rs__top">
        <h2 class="rs__title" tabindex="-1">Repos</h2>
        <button class="rs__collapse" data-action="collapse-rest">Réduire</button>
      </div>
      <div class="rs__ring">
        <svg class="rest-ring rest-ring--big" viewBox="0 0 220 220" aria-hidden="true">
          <circle cx="110" cy="110" r="100" class="rest-ring__track"/>
          <circle cx="110" cy="110" r="100" class="rest-ring__bar" stroke-dasharray="${RING_BIG}" stroke-dashoffset="${RING_BIG * (1 - restFraction())}"/>
        </svg>
        <div class="rs__center">
          <div class="rs__time num" role="timer" aria-live="off" aria-label="${restTimerLabel()}">${fmtRest(restTimeLeft)}</div>
          <div class="rs__resume num">Fin du repos à ${restResumeAt()}</div>
        </div>
      </div>
      <div class="rs-seg" role="group" aria-label="Durée du repos">
        ${REST_PRESETS.map(p => `<button class="rs-seg__btn num" data-action="set-rest" data-secs="${p}" aria-pressed="${restTotal === p}" aria-label="${fmtRestSpoken(p)}">${fmtRest(p)}</button>`).join('')}
      </div>
      <div class="rs__adj">
        <button class="rs__round num" data-action="rest-adjust" data-d="-15" aria-label="Moins 15 secondes">−15</button>
        <button class="rs__skip" data-action="skip-rest" aria-label="Passer le repos">Passer</button>
        <button class="rs__round num" data-action="rest-adjust" data-d="15" aria-label="Plus 15 secondes">+15</button>
      </div>
      ${nxt ? `<div class="rs__next">Ensuite : ${esc(nxt)}</div>` : ''}
    </div>`;
}

function restResumeAt() {
  return fmtTime(restEndTime);
}

function openRestSheet() {
  restSheetOpen = true;
  const root = openSessSheet({ cls: 'sess-sheet--rest', label: 'Repos', html: restSheetHtml(), onClose: () => { restSheetOpen = false; } });
  root.style.setProperty('--cat-color', sessionMeta(activeSession.category, activeSession.programme).color);
}
function closeRestSheet() { document.querySelector('.sess-sheet--rest')?._close?.(); restSheetOpen = false; }

// Minuteur lu par VoiceOver en minutes et secondes (« 1:30 » se lisait comme une heure, panels de la vague 3),
// arrondi aux 15 s pour ne pas changer à chaque seconde
function restTimerLabel() { return `Il reste ${fmtRestSpoken(Math.ceil(Math.max(0, restTimeLeft) / 15) * 15)}`; }
// Nom du bouton de la barre réduite, temps restant compris (VoiceOver ne lisait que « Repos en cours »)
function restMiniLabel() { return `Repos, il reste ${fmtRestSpoken(restTimeLeft)}, ouvrir le détail`; }

// Met à jour chiffres et anneaux sans relancer render()
function updateRestUI() {
  const t = fmtRest(restTimeLeft), f = restFraction();
  const mini = $('.rest-mini__timer');
  if (mini && mini.textContent !== t) {
    mini.textContent = t;
    $('.rest-mini__main')?.setAttribute('aria-label', restMiniLabel());
  }
  if (!restRingRaf) setRestRings(f);
  const sheet = $('.sess-sheet--rest');
  if (sheet) {
    const el = sheet.querySelector('.rs__time');
    if (el) { el.textContent = t; if (el.getAttribute('aria-label') !== restTimerLabel()) el.setAttribute('aria-label', restTimerLabel()); }
    const ra = sheet.querySelector('.rs__resume');
    if (ra) ra.textContent = `Fin du repos à ${restResumeAt()}`;
    sheet.querySelectorAll('.rs-seg__btn').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.secs === restTotal)));
  }
}

function startRestCountdown() {
  restEndTime = Date.now() + restTimeLeft * 1000;
  resumeRestCountdown();
  afterPaint(syncNativeRest);    // notification et Live Activity après l'affichage de la feuille du repos
}

// App iOS : aligne sur le repos en cours tout ce qu'iOS affiche hors de l'app, à savoir la
// notification de fin de repos et la Live Activity (rest-activity.js), utiles écran verrouillé
// ou app en arrière-plan
function syncNativeRest() {
  if (!Native.isNative || !restActive) return;
  syncRestActivity();
  Native.scheduleRestEnd(restEndTime, restEndBody());
}

// Texte de la notification de fin de repos : « Série 4 · Squat barre », pendant la pause d'un rest-pause
// ou d'un cluster la sous-série qui suit avec sa charge : « Mini-série +1 · Squat barre · 70 kg × 4 »
function restEndBody() {
  const sub = activeSession && techNextSub();
  if (sub) { const p = nextSetParts(); return `${p.step} · ${p.name}${p.load}`; }
  const nx = activeSession && currentSet();
  // Numéro affiché (setSpokenName) : avec 3 échauffements, la série 1 n'est pas « Série 4 »
  return nx ? `${setSpokenName(activeSession.exercises[nx.ei], nx.si)} · ${activeSession.exercises[nx.ei].name}` : 'C\'est reparti';
}

// Relance l'affichage du chrono sans toucher à l'heure de fin (retour au premier plan, restauration)
function resumeRestCountdown() {
  clearInterval(restInterval);
  startRestRings();
  let before = Math.max(0, Math.ceil((restEndTime - Date.now()) / 1000));
  restInterval = setInterval(() => {
    restTimeLeft = Math.max(0, Math.ceil((restEndTime - Date.now()) / 1000));
    // Seuls les jalons sont annoncés (le chrono lui-même est en aria-live="off")
    if (before > 30 && restTimeLeft <= 30 && restTimeLeft > 10) announce('30 secondes');
    else if (before > 10 && restTimeLeft <= 10 && restTimeLeft > 0) announce('10 secondes');
    // Decompte sonore des 3 dernieres secondes (le GO vient de restFinished -> timerDone).
    // App a l'ecran seulement : ecran verrouille, c'est la notification qui annonce la fin.
    if (before > restTimeLeft && restTimeLeft >= 1 && restTimeLeft <= 3 && document.visibilityState === 'visible') restCountBeep();
    before = restTimeLeft;
    updateRestUI();
    // App à l'écran : les bips de l'app annoncent la fin, la notification ferait doublon (bannière + son)
    if (restTimeLeft <= 1 && document.visibilityState === 'visible') Native.cancelRestEnd();
    if (restTimeLeft <= 0) restFinished();
  }, 250);
}

// Fin du repos : la barre pulse, affiche « C'est reparti » 2 s, puis la série suivante est centrée
function restFinished() {
  stopRest();
  restTimeLeft = 0;
  persistSession();
  timerDone();
  closeRestSheet();
  const sub = techNextSub(), nx = sub || currentSet();
  announce(nx ? `Repos terminé, ${(sub ? sub.label : setSpokenName(activeSession.exercises[nx.ei], nx.si)).toLowerCase()} de ${activeSession.exercises[nx.ei].name}` : 'Repos terminé');
  const bar = $('.rest-mini');
  if (bar) {
    bar.classList.add('rest-mini--done');
    bar.innerHTML = `<div class="rest-mini__go">C'est reparti</div>`;
    setTimeout(() => {
      if (restActive) return; // un nouveau repos a commencé entre-temps
      bar.remove();
      $('.view.session')?.classList.remove('session--resting');
    }, 2000);
  }
  if (currentView() === 'session') {
    $('.session-set--current')?.classList.add('session-set--go');
    scrollToCurrent();
  }
}

// État du repos gardé avec la séance (writeSession), null hors repos
function restSnapshot() {
  return restActive ? { endTime: restEndTime, minimized: restMinimized, total: restTotal } : null;
}

// Repos repris d'une séance restaurée : relancé s'il n'est pas déjà fini. Déjà fini (page
// rechargée par une mise à jour à chaud après la fin du repos), sa Live Activity est retirée :
// le module natif ne la nettoie qu'à son propre lancement.
function resumeRest(saved) {
  const endTime = saved ? Number(saved.endTime) : 0;
  if (!(endTime > Date.now())) { endRestActivity(); return; }
  restActive    = true;
  restMinimized = !!saved.minimized;
  restEndTime   = endTime;
  restTimeLeft  = Math.ceil((endTime - Date.now()) / 1000);
  restTotal     = Number(saved.total) || Math.max(restTimeLeft, data.defaultRest);
  resumeRestCountdown();
  syncNativeRest();
}

function clearRest() { clearInterval(restInterval); restInterval = null; stopRestRings(); }

// Arrête le repos en cours (chrono et état) sans toucher à l'affichage
function stopRest() { clearRest(); restActive = false; Native.cancelRestEnd(); endRestActivity(); }

function removeRestUI() {
  document.querySelectorAll('.rest-mini').forEach(el => el.remove());
  $('.view.session')?.classList.remove('session--resting');
}

// from : début réel du repos (fin d'un effort chronométré constatée en retard, app en arrière-plan)
function openRest(secs, doRender = true, from = null) {
  restActive    = true;
  restMinimized = true;
  restTotal     = secs ?? data.defaultRest;
  restTimeLeft  = restTotal;
  if (from) {
    restEndTime  = from + restTotal * 1000;
    restTimeLeft = Math.ceil((restEndTime - Date.now()) / 1000);
    if (restTimeLeft <= 0) { restFinished(); if (doRender) render(); return; }
    resumeRestCountdown();
    afterPaint(syncNativeRest);
  } else startRestCountdown();
  if (doRender) render();
}

function adjustRest(d) {
  if (!restActive) return;
  restEndTime += d * 1000;
  restTotal    = Math.max(15, restTotal + d);
  restTimeLeft = Math.max(0, Math.ceil((restEndTime - Date.now()) / 1000));
  haptic();
  if (restTimeLeft <= 0) { restFinished(); return; }
  updateRestUI();
  persistSession();
  syncNativeRest();
}

// « Passer » : le repos s'arrête et disparaît (bouton du repos, ou Apple Watch : js/features/watch.js)
function skipRest() {
  stopRest();
  closeRestSheet();
  removeRestUI();
  persistSession();
}

// Retour au premier plan : le son est réveillé et le repos recalé sur son heure de fin
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  wakeAudio();
  if (!restActive) return;
  const remaining = Math.ceil((restEndTime - Date.now()) / 1000);
  if (remaining <= 0) restFinished();
  else { restTimeLeft = remaining; resumeRestCountdown(); updateRestUI(); }
});

// ── Actions ─────────────────────────────────────────────────
registerActions({
  // Le bouton « Passer » disparaît avec la barre : le focus va au ✓ de la série à faire (VoiceOver)
  'skip-rest': () => { skipRest(); if (currentView() === 'session') focusCurrentSet(); },
  'collapse-rest': () => {
    closeRestSheet();
  },
  'expand-rest': () => {
    if (restActive) openRestSheet();
  },
  'rest-adjust': (e, el) => {
    adjustRest(parseInt(el.dataset.d));
  },
  'set-rest': (e, el) => {
    const secs = parseInt(el.dataset.secs);
    clearRest(); restTimeLeft = secs; restTotal = secs; startRestCountdown();
    updateRestUI(); haptic();
  },
});
