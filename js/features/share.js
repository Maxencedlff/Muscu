// ═══════════════════════════════════════════════════════════
//  Partage de séance : aperçu de l'image et feuille de partage
// ═══════════════════════════════════════════════════════════
'use strict';

// Bouton « Partager ma séance » (bilan, Historique › Séance) → feuille d'aperçu → partage :
// - app iOS : Native.shareImage (fichier en cache + feuille de partage d'iOS) ;
// - PWA : navigator.share({ files }) si le navigateur accepte les fichiers, sinon téléchargement.
// Safari n'autorise navigator.share que pendant le geste de l'utilisateur (« transient activation »,
// MDN) : l'image est donc préparée dès l'ouverture de l'aperçu, et le toucher sur « Partager »
// appelle le partage sans rien attendre avant.

let shareState = null;   // { entry, stats, canvas, file, name, close } de l'aperçu ouvert

// Tokens de css/base.css résolus dans le thème courant de l'app ([r, g, b, a] pour le canvas)
function storyPalette(catColor) {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const color = css => { probe.style.color = ''; probe.style.color = css; return parseCssColor(getComputedStyle(probe).color); };
  const root  = getComputedStyle(document.body);
  const token = name => root.getPropertyValue(name).trim();
  const p = {
    light:    document.body.classList.contains('light'),
    bg:       color('var(--bg)'),
    cell:     color('var(--cell)'),
    label:    color('var(--label)'),
    label2:   color('var(--label2)'),
    sep:      color('var(--sep)'),
    gold:     color('var(--yellow)'),
    goldText: color('var(--gold-text)'),
    cat:      color(catColor) || color('var(--green)'),
    font:        token('--font') || '-apple-system, system-ui, sans-serif',
    fontRounded: token('--font-rounded') || '-apple-system, system-ui, sans-serif',
  };
  // Texte coloré par la séance : même mélange que les feuilles de style (--cat-text-mix)
  p.catText = mixColor(p.cat, color('var(--cat-text-base)'), parseFloat(token('--cat-text-mix')) || 70);
  probe.remove();
  return p;
}

function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Silhouette fournie par un autre module (shareStoryHooks.muscleSvg), sinon null
async function storyMuscleImage(entry, stats, palette) {
  let svg = null;
  try { svg = shareStoryHooks.muscleSvg?.(entry, stats, palette) || null; } catch { svg = null; }
  return svg ? loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)) : null;
}

// Image de la séance dans un canvas 1080 × 1920. baseline : records d'avant la séance (bilan).
async function renderShareStory(entry, { baseline = null, stats = shareStoryStats(entry, { baseline }),
                                         canvas = document.createElement('canvas') } = {}) {
  const palette = storyPalette(stats.color);
  const [icon, muscle] = await Promise.all([loadImage('icon-192.png'), storyMuscleImage(entry, stats, palette)]);
  drawStory(canvas, stats, palette, { icon, muscle });
  return { canvas, stats };
}

function canvasBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function sharePreviewBody(stats) {
  return `
    <div class="share-preview">
      <div class="share-preview__frame">
        <canvas class="share-preview__img" width="1080" height="1920" role="img" aria-label="${esc(shareStoryAlt(stats))}"></canvas>
      </div>
      <button class="btn btn--primary btn--full share-preview__send" data-action="share-story-send" disabled>
        ${icon('square.and.arrow.up', 22)}<span>Partager</span>
      </button>
      <p class="share-preview__hint">Format story Instagram</p>
    </div>`;
}

// Ouvre l'aperçu de l'image d'une séance de l'historique
async function openSharePreview(id) {
  const entry = (data.history || []).find(h => h.id === id);
  if (!entry || shareState) return;   // double toucher : un seul aperçu
  // Bilan de la séance qui vient de se terminer : mêmes records que ceux affichés
  const baseline = lastSummary?.id === id ? lastSummary.baseline : null;
  const stats = shareStoryStats(entry, { baseline });
  const state = { entry, stats, file: null, name: shareFileName(entry) };
  shareState = state;
  sheet({ title: 'Aperçu', cancel: 'Fermer', confirm: '', body: sharePreviewBody(stats) })
    .then(() => { if (shareState === state) shareState = null; });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  state.close  = v => root?._close?.(v);
  state.canvas = root.querySelector('.share-preview__img');
  try {
    await renderShareStory(entry, { stats, canvas: state.canvas });
    const blob = await canvasBlob(state.canvas);
    if (blob && typeof File === 'function') state.file = new File([blob], state.name, { type: 'image/png' });
  } catch {
    showToast('Image impossible à créer');
    return;
  }
  const btn = root.querySelector('.share-preview__send');
  if (btn && (state.file || Native.isNative)) btn.disabled = false;
}

const SHARE_MESSAGES = { downloaded: 'Image enregistrée', failed: 'Partage impossible' };

registerActions({
  'share-story': (e, el) => { openSharePreview(el.dataset.id); },
  'share-story-send': async () => {
    const st = shareState;
    if (!st?.canvas) return;
    const result = Native.isNative
      ? await Native.shareImage(st.canvas.toDataURL('image/png'), st.name)
      : (st.file ? await shareOrDownload(st.file, `${st.stats.title} · MDLF Training`) : 'failed');
    if (SHARE_MESSAGES[result]) showToast(SHARE_MESSAGES[result]);
    if (result === 'shared' || result === 'downloaded') st.close?.(true);
  },
});

// Bouton commun du bilan et du détail d'une séance
function shareStoryButton(id, cls = '') {
  return `<button class="btn btn--secondary btn--full share-btn ${cls}" data-action="share-story" data-id="${esc(id)}">
    ${icon('square.and.arrow.up', 22)}<span>Partager ma séance</span></button>`;
}
