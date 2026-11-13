// ═══════════════════════════════════════════════════════════
//  Lecteur des vidéos d'exercices (données : js/data/exercise-videos.js)
//  Fiche d'un exercice, dans « Comment faire » à la place du mannequin animé. Muette, en boucle, dans la
//  page (playsinline) ; rien n'est téléchargé avant que la vidéo soit à l'écran (preload="none", src posé
//  au montage) ; lecture automatique seulement si videoAutoplayAllowed(), sinon au toucher.
//  Sans vidéo de coach : animation 3D du personnage maison (js/data/exercise-anims.js), même lecteur, fichier de
//  l'app (lecture automatique sauf si l'iPhone demande de réduire les animations : affiche et ▶).
// ═══════════════════════════════════════════════════════════
'use strict';

function exerciseVideoHtml(name) {
  const v = exerciseVideo(name);
  if (!v) return exerciseAnimHtml(name);
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

// Animation 3D (repli) : même figure, sans crédit de coach ; data-src* : H.264 puis VP9, choisi à la lecture
function exerciseAnimHtml(name) {
  const a = exerciseAnim(name);
  if (!a) return '';
  const label = `Animation 3D de l'exercice ${name}`;
  return `<figure class="exvideo exvideo--3d" style="--ar:${(a.width / a.height).toFixed(4)}" data-local="1">
      <div class="exvideo__frame">
        <video class="exvideo__media" playsinline muted loop preload="none" disablepictureinpicture disableremoteplayback
               poster="${esc(a.poster)}" data-src="${esc(a.sources[0].src)}"
               data-sources="${esc(JSON.stringify(a.sources))}" aria-label="${esc(label)}"></video>
        <button class="exvideo__play" data-action="exvideo-toggle" aria-label="Lire l'animation">
          <span class="exvideo__btn" aria-hidden="true">${icon('play', 26)}</span>
        </button>
      </div>
      <figcaption class="exvideo__credit">Animation 3D</figcaption>
    </figure>`;
}

// Fichier lisible par ce navigateur : premier type reconnu (canPlayType), sinon le premier de la liste
function exvideoSource(video) {
  let list = [];
  try { list = JSON.parse(video.dataset.sources || '[]'); } catch { list = []; }
  const ok = list.find(s => s && typeof s.src === 'string' && video.canPlayType?.(s.type));
  return ok ? ok.src : video.dataset.src;
}

function exvideoPlay(fig) {
  const video = fig.querySelector('video');
  if (!video.getAttribute('src')) { video.src = exvideoSource(video); video.preload = 'auto'; }
  video.muted = true;
  const p = video.play();
  if (p?.catch) p.catch(() => exvideoState(fig));   // lecture refusée : le bouton reste, au toucher
}

// Bouton : visible et « Lire » à l'arrêt ; invisible et « Mettre en pause » pendant la lecture
function exvideoState(fig) {
  const video = fig.querySelector('video'), btn = fig.querySelector('.exvideo__play');
  const playing = !video.paused && !video.ended;
  const what = fig.dataset.local ? 'l\'animation' : 'la vidéo';
  fig.classList.toggle('exvideo--playing', playing);
  btn.setAttribute('aria-label', playing ? `Mettre ${what} en pause` : `Lire ${what}`);
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
    fig.querySelector('.exvideo__credit').textContent = fig.dataset.local ? 'Animation indisponible pour le moment'
      : `Vidéo indisponible ${navigator.onLine === false ? 'sans réseau' : 'pour le moment'} · @${fig.dataset.coach}`;
  });
  // Animation 3D : fichier de l'app (aucune donnée cellulaire), seul « réduire les animations » l'arrête
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const auto = fig.dataset.local ? !reduced : videoAutoplayAllowed(navigator, reduced);
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
