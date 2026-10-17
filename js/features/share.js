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
// L'image n'est encodée en PNG qu'une fois, de façon asynchrone (HTMLCanvasElement.toBlob, MDN),
// à l'ouverture de l'aperçu : la PWA en fait un File, l'app iOS la relit en data URL au partage
// (aucun geste à préserver côté natif), sans second encodage synchrone par toDataURL.

let shareState = null;   // { entry, stats, canvas, blob, file, name, busy, close } de l'aperçu ouvert

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

// Silhouette face et dos des muscles de la séance (js/ui/body-map.js), coloriée dans la couleur
// de la séance comme le halo de l'image ; null si aucun muscle n'est reconnu (mise en page en ligne).
// Couleurs résolues (SVG chargé comme image : var(--x) n'y a pas de sens) ; largeur 600 px pour
// rester net une fois réduit dans le canvas. Sans légendes « Face » / « Dos » : à l'échelle de la
// story elles seraient illisibles (≈ 11 px sur 1080), et la silhouette gagne de la hauteur.
function storyMuscleSvg(entry, stats, palette) {
  const levels = sessionMuscleLevels(entry);
  if (!Object.keys(levels).length) return null;
  const colors = { ...bodyMapColors(), heat: rgbaCss(palette.cat) };
  return bodyMapSvg(levels, { standalone: true, width: 600, colors });
}
shareStoryHooks.muscleSvg = storyMuscleSvg;

// Silhouette du fournisseur (shareStoryHooks.muscleSvg, remplaçable par les tests), sinon null
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

// Blob → « data:image/png;base64,… » attendu par Native.shareImage (FileReader.readAsDataURL, MDN)
function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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
  const state = { entry, stats, blob: null, file: null, name: shareFileName(entry), busy: false };
  shareState = state;
  sheet({ title: 'Aperçu', cancel: 'Fermer', confirm: '', body: sharePreviewBody(stats) })
    .then(() => { if (shareState === state) shareState = null; });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  state.close  = v => root?._close?.(v);
  state.canvas = root.querySelector('.share-preview__img');
  try {
    await renderShareStory(entry, { stats, canvas: state.canvas });
    state.blob = await canvasBlob(state.canvas);
    if (state.blob && !Native.isNative && typeof File === 'function') {
      state.file = new File([state.blob], state.name, { type: 'image/png' });
    }
  } catch {
    showToast('Image impossible à créer');
    return;
  }
  const btn = root.querySelector('.share-preview__send');
  if (btn && (state.file || (Native.isNative && state.blob))) btn.disabled = false;
}

const SHARE_MESSAGES = { downloaded: 'Image enregistrée', failed: 'Partage impossible' };

registerActions({
  'share-story': (e, el) => { openSharePreview(el.dataset.id); },
  // Un seul partage à la fois : un double toucher ouvrirait une seconde feuille, refusée par iOS.
  // busy et disabled sont posés sans rien attendre, pour garder le geste exigé par navigator.share.
  'share-story-send': async (e, el) => {
    const st = shareState;
    if (!st?.blob || st.busy) return;
    st.busy = true;
    el.disabled = true;
    let result = 'failed';
    try {
      result = Native.isNative
        ? await Native.shareImage(await blobDataUrl(st.blob), st.name)
        : (st.file ? await shareOrDownload(st.file, `${st.stats.title} · MDLF Training`) : 'failed');
    } catch {
      result = 'failed';
    } finally {
      st.busy = false;
      el.disabled = false;
    }
    if (SHARE_MESSAGES[result]) showToast(SHARE_MESSAGES[result]);
    if (result === 'shared' || result === 'downloaded') st.close?.(true);
  },
});

// Bouton commun du bilan et du détail d'une séance
function shareStoryButton(id, cls = '') {
  return `<button class="btn btn--secondary btn--full share-btn ${cls}" data-action="share-story" data-id="${esc(id)}">
    ${icon('square.and.arrow.up', 22)}<span>Partager ma séance</span></button>`;
}
