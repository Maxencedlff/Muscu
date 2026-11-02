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

// Personnage face et dos (js/ui/body-map.js), muscles de la séance coloriés dans la couleur de la
// séance comme le halo de l'image ; null si aucun muscle n'est reconnu (mise en page en ligne).
// Dessiné dans un canvas (bodyMapImage) : couleurs résolues, base assombrie en thème sombre.
// Sans légendes « Face » / « Dos » : à l'échelle de la story elles seraient illisibles (≈ 11 px sur
// 1080), et le personnage gagne de la hauteur.
function storyMuscleMap(entry, stats, palette) {
  const levels = sessionMuscleLevels(entry);
  if (!Object.keys(levels).length) return null;
  return { levels, colors: { ...bodyMapColors(), heat: rgbaCss(palette.cat) } };
}
shareStoryHooks.muscleMap = storyMuscleMap;

// Carte du fournisseur (shareStoryHooks.muscleMap, remplaçable par les tests) dessinée, sinon null
async function storyMuscleImage(entry, stats, palette) {
  let map = null;
  try { map = shareStoryHooks.muscleMap?.(entry, stats, palette) || null; } catch { map = null; }
  if (!map) return null;
  try { return await bodyMapImage(map.levels, { colors: map.colors }); } catch { return null; }
}

// Image de la séance dans un canvas 1080 × 1920 (records : ceux notés dans la séance, comme le bilan)
async function renderShareStory(entry, { stats = shareStoryStats(entry),
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

// alt : description de l'image pour VoiceOver (shareStoryAlt, recapPageAlt)
function sharePreviewBody(alt) {
  return `
    <div class="share-preview">
      <div class="share-preview__frame">
        <canvas class="share-preview__img" width="1080" height="1920" role="img" aria-label="${esc(alt)}"></canvas>
      </div>
      <button class="btn btn--primary btn--full share-preview__send" data-action="share-story-send" disabled>
        ${icon('square.and.arrow.up', 22)}<span>Partager</span>
      </button>
      <p class="share-preview__hint">Format story Instagram</p>
    </div>`;
}

// Feuille d'aperçu commune aux images partagées (séance, écran d'un récap : js/features/recap.js).
// state : { stats: { title }, name (fichier), alt, … } devient shareState le temps de l'aperçu ;
// draw(canvas) dessine l'image dans le canvas de la feuille. Un seul aperçu à la fois (double toucher).
async function openStoryPreview(state, draw) {
  if (shareState) return;
  Object.assign(state, { blob: null, file: null, busy: false });
  shareState = state;
  sheet({ title: 'Aperçu', cancel: 'Fermer', confirm: '', body: sharePreviewBody(state.alt) })
    .then(() => { if (shareState === state) shareState = null; });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  state.close  = v => root?._close?.(v);
  state.canvas = root.querySelector('.share-preview__img');
  try {
    await draw(state.canvas);
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

// Ouvre l'aperçu de l'image d'une séance de l'historique
async function openSharePreview(id) {
  const entry = (data.history || []).find(h => h.id === id);
  if (!entry) return;
  // Records notés dans la séance (entryRecords) : les mêmes que ceux du bilan
  const stats = shareStoryStats(entry);
  await openStoryPreview({ entry, stats, name: shareFileName(entry), alt: shareStoryAlt(stats) },
    canvas => renderShareStory(entry, { stats, canvas }));
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
    // Feuille de partage refermée : l'aperçu se ferme aussi, y compris 'handed' (Instagram « Story »
    // ouvre sa propre app et iOS le rapporte comme une erreur : Native.shareOutcome). L'aperçu ne
    // reste ouvert qu'en cas d'échec réel, pour pouvoir réessayer.
    if (result !== 'failed') st.close?.(true);
  },
});

// Bouton commun du bilan et du détail d'une séance
function shareStoryButton(id, cls = '') {
  return `<button class="btn btn--secondary btn--full share-btn ${cls}" data-action="share-story" data-id="${esc(id)}">
    ${icon('square.and.arrow.up', 22)}<span>Partager ma séance</span></button>`;
}
