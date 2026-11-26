// ═══════════════════════════════════════════════════════════
//  Visite de l'accueil : voile sombre, un vrai élément découpé, une bulle courte avec sa flèche
//
//  Part une fois, à la première arrivée sur l'accueil après les questions du premier lancement (data.tour = 'due',
//  js/data/tour.js), et se revoit dans Réglages › Aide › Revoir la visite. « Passer » et « Suivant » toujours
//  visibles (barre collée au bas de la bulle, même quand le texte agrandi la fait défiler), « C'est parti » à la fin.
//  Jamais bloquante : une étape dont l'élément manque est sautée, aucune étape trouvée = rien ne s'ouvre ; la visite
//  attend qu'aucune autre fenêtre ne soit ouverte (questions qui se referment, compte, rappel des notifications).
//  Fenêtre modale comme les feuilles (MODAL_SEL, js/core/dialogs.js) : l'app dessous est inerte, VoiceOver reste dans
//  la bulle, dont le titre prend le focus à chaque étape (« Étape 2 sur 5, Programme »). Un seul toucher par bouton
//  (click), rien au pointerdown. Le voile ne se touche pas : il ne ferme rien par erreur.
//  Suit la rotation, la taille de l'écran et le texte agrandi (resize, redessin de l'accueil) ; mouvements coupés
//  avec « Réduire les animations » (css/tour.css).
// ═══════════════════════════════════════════════════════════
'use strict';

const tour = { root: null, steps: [], i: 0, replay: false, timer: 0, watch: null };
const TOUR_DELAY_MS = 450;   // après la transition d'écran et la fermeture animée des questions (240 ms)

// Appelé après chaque dessin de l'accueil (SCREENS, js/ui/router.js) : visite à faire ou demandée, sinon replacement
function maybeStartTour() {
  if (tour.root) { tourLayout(); return; }
  if (!tour.replay && !tourIsDue(data)) return;
  tourStopWaiting();
  tour.timer = setTimeout(tourTryStart, TOUR_DELAY_MS);
}

// Une autre fenêtre (questions, compte, rappel) est posée sur document.body comme la visite (MODAL_SEL)
const TOUR_OTHER_MODALS = MODAL_SEL.split(',').map(s => s.trim()).filter(s => s !== '.tour').join(',');
function tourBlocked() { return !!document.querySelector(TOUR_OTHER_MODALS); }

function tourStopWaiting() {
  clearTimeout(tour.timer);
  tour.watch?.disconnect();
  tour.watch = null;
}

// Fenêtre ouverte : on attend qu'elle se retire de la page (observateur, aucune minuterie qui tourne en boucle),
// puis on réessaie une fois. Quitter l'accueil arrête tout : le prochain dessin de l'accueil relance.
function tourTryStart() {
  tourStopWaiting();
  if (tour.root || (!tour.replay && !tourIsDue(data)) || currentView() !== 'dashboard') return;
  if (!tourBlocked()) { tourOpen(); return; }
  tour.watch = new MutationObserver(() => {
    if (tourBlocked()) return;
    tourStopWaiting();
    tour.timer = setTimeout(tourTryStart, TOUR_DELAY_MS);
  });
  tour.watch.observe(document.body, { childList: true });
}

function tourContext() {
  const role = typeof coachRole === 'function' && account.user ? coachRole() : {};
  const title = document.querySelector('.hero .targets__title')?.textContent || '';
  return {
    live: !!document.querySelector('.hero [data-action="resume-session"]'),
    beat: title.startsWith('À battre'),
    coach: role.isCoach ? 'coach' : role.hasCoach ? 'student' : null,
  };
}

// Élément d'une étape, seulement s'il est vraiment affiché (une étape sans lui est sautée)
function tourTarget(step) {
  const el = document.querySelector(step.sel);
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

function tourOpen() {
  const steps = tourSteps(tourContext()).filter(tourTarget);
  tour.replay = false;
  // Montrée une fois : marquée vue dès l'ouverture (l'app fermée en cours de route ne la remontre pas)
  if (data.tour !== 'seen') { data.tour = 'seen'; save(true); }
  if (!steps.length) return;
  tour.steps = steps;
  tour.i = 0;
  const root = document.createElement('div');
  root.className = 'tour';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'tourTitle');
  root.setAttribute('aria-describedby', 'tourText');
  root.innerHTML = `
    <span class="tour__safe tour__safe--top" aria-hidden="true"></span><span class="tour__safe tour__safe--bottom" aria-hidden="true"></span>
    <div class="tour__hole" aria-hidden="true"></div>
    <div class="tour__bubble"><span class="tour__arrow" aria-hidden="true"></span>
      <div class="tour__inner"><div class="tour__body"></div>
        <div class="tour__actions">
          <button class="tour__skip" data-action="tour-skip">Passer</button>
          <button class="tour__next" data-action="tour-next">Suivant</button>
        </div>
      </div>
    </div>`;
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); tourClose(); } });
  tour.root = root;
  document.body.appendChild(root);
  window.addEventListener('resize', tourLayout);
  window.visualViewport?.addEventListener('resize', tourLayout);
  tourShow(0);
  // Mouvements d'une étape à l'autre seulement : la première se pose d'un coup, sans partir d'un coin
  requestAnimationFrame(() => requestAnimationFrame(() => tour.root?.classList.add('tour--ready')));
}

// L'accueil quitté (Siri, notification, montre) : plus d'attente, visite refermée
function tourLeave() { tourStopWaiting(); tourClose(); }

function tourClose() {
  const root = tour.root;
  if (!root) return;
  tour.root = null;
  window.removeEventListener('resize', tourLayout);
  window.visualViewport?.removeEventListener('resize', tourLayout);
  if (root.contains(document.activeElement)) document.activeElement.blur();
  root.remove();   // le focus revient à l'élément d'avant (syncModal)
}

// Étape i : saute celles dont l'élément a disparu entre-temps (accueil redessiné), ferme après la dernière
function tourShow(i) {
  while (i < tour.steps.length && !tourTarget(tour.steps[i])) i++;
  if (i >= tour.steps.length) { tourClose(); return; }
  tour.i = i;
  const s = tour.steps[i], n = tour.steps.length, last = i === n - 1;
  const body = tour.root.querySelector('.tour__body');
  // Titre remplacé (pas modifié) : VoiceOver annonce le nouveau focus à chaque étape
  body.innerHTML = `
    <h2 class="tour__head" id="tourTitle" tabindex="-1"><span class="tour__count">${tourCountLabel(i, n)}</span><span class="tour__title">${esc(s.title)}</span></h2>
    <p class="tour__text" id="tourText">${esc(s.text)}</p>`;
  tour.root.querySelector('.tour__next').textContent = last ? 'C\'est parti' : 'Suivant';
  tour.root.querySelector('.tour__inner').scrollTop = 0;
  tourLayout();
  tour.root.querySelector('#tourTitle').focus({ preventScroll: true });
}

// Marges sûres (barre d'état, barre d'accueil) lues sur deux repères en env(safe-area-inset-*)
function tourSafe() {
  const q = c => tour.root.querySelector(c)?.getBoundingClientRect().height || 0;
  return { top: q('.tour__safe--top'), bottom: q('.tour__safe--bottom') };
}

// Zone de l'accueil qui défile, entre la barre de navigation collée en haut et la barre d'onglets
function tourContentView() {
  const nb = document.querySelector('#app .navbar')?.getBoundingClientRect();
  return { width: innerWidth, height: innerHeight, top: nb ? Math.max(0, nb.bottom) : 0, bottom: Math.max(0, innerHeight - bottomBarTop()) };
}

function tourLayout() {
  if (!tour.root) return;
  const s = tour.steps[tour.i];
  const el = s && tourTarget(s);
  if (!el) { tourShow(tour.i + 1); return; }
  const bubble = tour.root.querySelector('.tour__bubble'), hole = tour.root.querySelector('.tour__hole');
  const safe = tourSafe();
  // Largeur d'abord (le texte s'y replie), hauteur mesurée ensuite ; plafonnée par le CSS (max-height), elle défile
  const inner = tour.root.querySelector('.tour__inner');
  bubble.style.width = `${Math.min(360, innerWidth - 24)}px`;
  inner.style.maxHeight = '';
  const bh = bubble.offsetHeight;
  if (!s.fixed) {
    const want = tourScrollTarget(el.getBoundingClientRect(), tourContentView(), bh, window.scrollY,
      document.documentElement.scrollHeight - innerHeight);
    if (want !== null) window.scrollTo({ top: want, behavior: 'instant' });   // d'un coup : l'élément est en place avant le découpage
  }
  const p = tourPlace(el.getBoundingClientRect(), { width: innerWidth, height: innerHeight, top: safe.top, bottom: safe.bottom },
    { width: bubble.offsetWidth, height: bh }, 6, [...el.querySelectorAll('li')].map(li => li.getBoundingClientRect().bottom));
  Object.assign(hole.style, { top: `${p.hole.top}px`, left: `${p.hole.left}px`, width: `${p.hole.width}px`, height: `${p.hole.height}px` });
  Object.assign(bubble.style, { top: `${p.top}px`, left: `${p.left}px`, width: `${p.width}px` });
  if (p.maxHeight !== null) inner.style.maxHeight = `${p.maxHeight}px`;
  bubble.dataset.side = p.side;
  bubble.style.setProperty('--tour-arrow-x', `${p.arrowX}px`);
}

registerActions({
  'tour-next': () => { haptic(); tourShow(tour.i + 1); },
  'tour-skip': () => tourClose(),
  // Réglages › Aide : retour à l'accueil, la visite part dès qu'il est affiché (maybeStartTour au dessin)
  'tour-replay': () => {
    tour.replay = true;
    switchTab('train', { reset: true });
    maybeStartTour();
  },
});
