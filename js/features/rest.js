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
const REST_PRESETS = [60, 90, 120, 180]; // préréglages proposés dans les feuilles de repos

function restFraction() {
  return restTotal > 0 ? Math.min(1, Math.max(0, restTimeLeft / restTotal)) : 0;
}

function renderRestOverlay() {
  if (!restActive || !activeSession) return '';
  const nxt = nextSetText();
  const off  = RING_SMALL * (1 - restFraction());
  const meta = sessionMeta(activeSession.category, activeSession.programme);
  return `
    <div class="rest-mini" role="region" aria-label="Repos" style="--cat-color:${meta.color}">
      <button class="rest-mini__main" data-action="expand-rest" aria-label="Repos en cours, ouvrir le détail">
        <svg class="rest-ring rest-ring--small" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="17" class="rest-ring__track"/>
          <circle cx="20" cy="20" r="17" class="rest-ring__bar" stroke-dasharray="${RING_SMALL}" stroke-dashoffset="${off}"/>
        </svg>
        <span class="rest-mini__timer num" role="timer" aria-live="off">${fmtRest(restTimeLeft)}</span>
      </button>
      <button class="rest-mini__btn num" data-action="rest-adjust" data-d="-15" aria-label="Moins 15 secondes">−15<span class="rest-mini__u">&nbsp;s</span></button>
      <button class="rest-mini__btn num" data-action="rest-adjust" data-d="15" aria-label="Plus 15 secondes">+15<span class="rest-mini__u">&nbsp;s</span></button>
      <button class="rest-mini__skip" data-action="skip-rest" aria-label="Passer le repos">Passer</button>
      ${nxt ? `<div class="rest-mini__next">Ensuite : ${esc(nxt)}</div>` : ''}
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
          <div class="rs__time num" role="timer" aria-live="off">${fmtRest(restTimeLeft)}</div>
          <div class="rs__resume num">Reprise à ${restResumeAt()}</div>
        </div>
      </div>
      <div class="rs-seg" role="group" aria-label="Durée du repos">
        ${REST_PRESETS.map(p => `<button class="rs-seg__btn num" data-action="set-rest" data-secs="${p}" aria-pressed="${restTotal === p}">${fmtRest(p)}</button>`).join('')}
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

// Met à jour chiffres et anneaux sans relancer render()
function updateRestUI() {
  const t = fmtRest(restTimeLeft), f = restFraction();
  const mini = $('.rest-mini__timer');
  if (mini) mini.textContent = t;
  const small = $('.rest-mini .rest-ring__bar');
  if (small) small.setAttribute('stroke-dashoffset', RING_SMALL * (1 - f));
  const sheet = $('.sess-sheet--rest');
  if (sheet) {
    const el = sheet.querySelector('.rs__time');
    if (el) el.textContent = t;
    sheet.querySelector('.rest-ring__bar')?.setAttribute('stroke-dashoffset', RING_BIG * (1 - f));
    const ra = sheet.querySelector('.rs__resume');
    if (ra) ra.textContent = `Reprise à ${restResumeAt()}`;
    sheet.querySelectorAll('.rs-seg__btn').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.secs === restTotal)));
  }
}

function startRestCountdown() {
  restEndTime = Date.now() + restTimeLeft * 1000;
  resumeRestCountdown();
  scheduleRestNotification();
}

// App iOS : notification de fin de repos et Live Activity (rest-activity.js), utiles écran
// verrouillé ou app en arrière-plan
function scheduleRestNotification() {
  if (!Native.isNative || !restActive) return;
  syncRestActivity();
  const nx = activeSession && currentSet();
  const body = nx ? `Série ${nx.si + 1} · ${activeSession.exercises[nx.ei].name}` : 'C\'est reparti';
  Native.scheduleRestEnd(restEndTime, body);
}

// Relance l'affichage du chrono sans toucher à l'heure de fin (retour au premier plan, restauration)
function resumeRestCountdown() {
  clearInterval(restInterval);
  let before = Math.max(0, Math.ceil((restEndTime - Date.now()) / 1000));
  restInterval = setInterval(() => {
    restTimeLeft = Math.max(0, Math.ceil((restEndTime - Date.now()) / 1000));
    // Seuls les jalons sont annoncés (le chrono lui-même est en aria-live="off")
    if (before > 30 && restTimeLeft <= 30 && restTimeLeft > 10) announce('30 secondes');
    else if (before > 10 && restTimeLeft <= 10 && restTimeLeft > 0) announce('10 secondes');
    before = restTimeLeft;
    updateRestUI();
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
  const nx = currentSet();
  announce(nx ? `Repos terminé, série ${nx.si + 1} de ${activeSession.exercises[nx.ei].name}` : 'Repos terminé');
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

// Repos repris d'une séance restaurée : relancé s'il n'est pas déjà fini
function resumeRest(saved) {
  const endTime = saved ? Number(saved.endTime) : 0;
  if (!(endTime > Date.now())) return;
  restActive    = true;
  restMinimized = !!saved.minimized;
  restEndTime   = endTime;
  restTimeLeft  = Math.ceil((endTime - Date.now()) / 1000);
  restTotal     = Number(saved.total) || Math.max(restTimeLeft, data.defaultRest);
  resumeRestCountdown();
  scheduleRestNotification();
}

function clearRest() { clearInterval(restInterval); restInterval = null; }

// Arrête le repos en cours (chrono et état) sans toucher à l'affichage
function stopRest() { clearRest(); restActive = false; Native.cancelRestEnd(); endRestActivity(); }

function removeRestUI() {
  document.querySelectorAll('.rest-mini').forEach(el => el.remove());
  $('.view.session')?.classList.remove('session--resting');
}

function openRest(secs, doRender = true) {
  restActive    = true;
  restMinimized = true;
  restTimeLeft  = secs ?? data.defaultRest;
  restTotal     = restTimeLeft;
  startRestCountdown();
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
  scheduleRestNotification();
}

// Retour au premier plan : le son est réveillé et le repos recalé sur son heure de fin
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  try { if (audioCtx?.state === 'suspended') audioCtx.resume(); } catch {}
  if (!restActive) return;
  const remaining = Math.ceil((restEndTime - Date.now()) / 1000);
  if (remaining <= 0) restFinished();
  else { restTimeLeft = remaining; resumeRestCountdown(); updateRestUI(); }
});

// ── Actions ─────────────────────────────────────────────────
registerActions({
  'skip-rest': () => {
    stopRest();
    closeRestSheet();
    removeRestUI();
    persistSession();
  },
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
