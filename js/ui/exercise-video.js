// ═══════════════════════════════════════════════════════════
//  Lecteur des vidéos d'exercices (données : js/data/exercise-videos.js)
//  Fiche d'un exercice, dans « Comment faire » à la place du mannequin animé. Muette, en boucle, dans la
//  page (playsinline) ; rien n'est téléchargé avant que la vidéo soit à l'écran (preload="none", src posé
//  au montage) ; lecture automatique seulement si videoAutoplayAllowed(), sinon au toucher.
// ═══════════════════════════════════════════════════════════
'use strict';

function exerciseVideoHtml(name) {
  const v = exerciseVideo(name);
  if (!v) return '';
  const label = `Vidéo de l'exercice ${name}, par @${v.coach}`;
  return `<figure class="exvideo" style="--ar:${(v.width / v.height).toFixed(4)}" data-coach="${esc(v.coach)}">
      <div class="exvideo__frame">
        <video class="exvideo__media" playsinline muted loop preload="none" disablepictureinpicture disableremoteplayback
               poster="${esc(v.poster)}" data-src="${esc(v.src)}" aria-label="${esc(label)}"></video>
        <button class="exvideo__play" data-action="exvideo-toggle" aria-label="Lire la vidéo">
          <span class="exvideo__btn" aria-hidden="true">${icon('play', 26)}</span>
        </button>
      </div>
      <figcaption class="exvideo__credit">Vidéo : @${esc(v.coach)}</figcaption>
    </figure>`;
}

function exvideoPlay(fig) {
  const video = fig.querySelector('video');
  if (!video.getAttribute('src')) { video.src = video.dataset.src; video.preload = 'auto'; }
  video.muted = true;
  const p = video.play();
  if (p?.catch) p.catch(() => exvideoState(fig));   // lecture refusée : le bouton reste, au toucher
}

// Bouton : visible et « Lire » à l'arrêt ; invisible et « Mettre en pause » pendant la lecture
function exvideoState(fig) {
  const video = fig.querySelector('video'), btn = fig.querySelector('.exvideo__play');
  const playing = !video.paused && !video.ended;
  fig.classList.toggle('exvideo--playing', playing);
  btn.setAttribute('aria-label', playing ? 'Mettre la vidéo en pause' : 'Lire la vidéo');
}

// Montage : état du bouton, lecture automatique quand la vidéo est à moitié visible, pause quand elle sort
function mountExerciseVideo() {
  const fig = document.querySelector('#app .exvideo:not([data-mounted])');
  if (!fig) return;
  fig.dataset.mounted = '1';
  const video = fig.querySelector('video');
  video.muted = true;
  ['play', 'playing', 'pause', 'ended'].forEach(ev => video.addEventListener(ev, () => exvideoState(fig)));
  video.addEventListener('error', () => {
    fig.classList.add('exvideo--error');
    fig.querySelector('.exvideo__credit').textContent = `Vidéo indisponible ${navigator.onLine === false ? 'sans réseau' : 'pour le moment'} · @${fig.dataset.coach}`;
  });
  const auto = videoAutoplayAllowed(navigator, matchMedia('(prefers-reduced-motion: reduce)').matches);
  fig.classList.toggle('exvideo--manual', !auto);
  if (!auto) return;
  if (typeof IntersectionObserver !== 'function') { exvideoPlay(fig); return; }
  const io = new IntersectionObserver(entries => {
    if (!fig.isConnected) { io.disconnect(); return; }
    const on = entries[entries.length - 1].isIntersecting;
    if (on && !fig.dataset.userPaused) exvideoPlay(fig);
    else if (!on && !video.paused) video.pause();
  }, { threshold: 0.5 });
  io.observe(fig);
}

registerActions({
  // Toucher : lire ou mettre en pause ; une pause voulue n'est pas relancée par le défilement
  'exvideo-toggle': (e, el) => {
    const fig = el.closest('.exvideo');
    if (!fig || fig.classList.contains('exvideo--error')) return;
    const video = fig.querySelector('video');
    if (video.paused || video.ended) { delete fig.dataset.userPaused; exvideoPlay(fig); }
    else { fig.dataset.userPaused = '1'; video.pause(); }
  },
});
