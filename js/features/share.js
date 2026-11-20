// ═══════════════════════════════════════════════════════════
//  Partage de séance : aperçu de l'image et feuille de partage
// ═══════════════════════════════════════════════════════════
'use strict';

// Bouton « Partager la séance » (bilan, Historique › Séance) → feuille d'aperçu → partage :
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
    gold:     color('var(--medal)') || color('var(--yellow)'),   // or de la médaille : assombri en clair (3:1)
    goldText: color('var(--gold-text)'),
    // Plus de couleur de séance dans l'image (direction sobre) : l'orange de l'app ne sert qu'à
    // l'icône de secours de la signature ; catColor reste accepté pour les appelants
    cat:      color('var(--tint-fill)') || color(catColor) || color('var(--green)'),
    onTint:   color('var(--on-tint)'),   // texte posé sur l'orange plein (code de l'affiche du coach)
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

// Personnage face et dos (js/ui/body-map.js), muscles de la séance coloriés comme dans l'app
// (--body-heat) ; null si aucun muscle n'est reconnu (mise en page en ligne).
// Dessiné dans un canvas (bodyMapImage) : couleurs résolues, base assombrie en thème sombre.
// Sans légendes « Face » / « Dos » : à l'échelle de la story elles seraient illisibles (≈ 11 px sur
// 1080), et le personnage gagne de la hauteur.
function storyMuscleMap(entry, stats, palette) {
  const levels = sessionMuscleLevels(entry);
  if (!Object.keys(levels).length) return null;
  return { levels, colors: bodyMapColors() };
}
shareStoryHooks.muscleMap = storyMuscleMap;

// Carte du fournisseur (shareStoryHooks.muscleMap, remplaçable par les tests) dessinée, sinon null
async function storyMuscleImage(entry, stats, palette) {
  let map = null;
  try { map = shareStoryHooks.muscleMap?.(entry, stats, palette) || null; } catch { map = null; }
  if (!map) return null;
  try { return await bodyMapImage(map.levels, { colors: map.colors }); } catch { return null; }
}

// Image de la séance dans un canvas 1080 × 1920, ou 1080 × 1080 en format carré (format : 'square')
// (records : ceux notés dans la séance, comme le bilan)
async function renderShareStory(entry, { stats = shareStoryStats(entry),
                                         canvas = document.createElement('canvas'), format = 'story' } = {}) {
  const palette = storyPalette(stats.color);
  if (format === 'square') {
    drawSquare(canvas, stats, palette, { icon: await loadImage('icon-192.png') });
    return { canvas, stats };
  }
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

// Formats proposés pour une séance : story (9:16) et carré (fil, messages)
const SHARE_FORMATS = { story: { label: 'Story', hint: 'Pour une story Instagram' }, square: { label: 'Carré', hint: 'Pour le fil et les messages' } };

// alt : description de l'image pour VoiceOver (shareStoryAlt, recapPageAlt) ; formats : choix story / carré ;
// tools : réglages propres à l'image (affiche du coach) : { rows } posés sous le choix du format
function sharePreviewBody(alt, formats = false, tools = null) {
  const seg = formats ? `
      <div class="segmented seg-full share-preview__formats" role="group" aria-label="Format de l'image">
        ${Object.entries(SHARE_FORMATS).map(([k, f]) => `<button type="button" class="segmented__btn${k === 'story' ? ' segmented__btn--active' : ''}" aria-pressed="${k === 'story'}" data-action="share-format" data-f="${k}">${f.label}</button>`).join('')}
      </div>` : '';
  const frame = `
      <div class="share-preview__frame">
        <canvas class="share-preview__img" width="1080" height="1920" role="img" aria-label="${esc(alt)}"></canvas>
      </div>`;
  const send = `
      <button class="btn btn--primary btn--full share-preview__send" data-action="share-story-send" disabled>
        ${icon('square.and.arrow.up', 22)}<span>Partager</span>
      </button>
      <p class="share-preview__hint">${SHARE_FORMATS.story.hint}</p>`;
  // Avec des réglages (affiche du coach) : l'aperçu de l'image entière FIXÉ en haut de la feuille (hauteur bornée, un
  // toucher l'ouvre en plein écran), les réglages qui défilent dessous, « Partager » dans une barre fixée en bas (fond
  // opaque). Choisir Femme ou Homme montre tout de suite le changement, même sur un petit écran en très grand texte.
  // La note (ce qui manque pour partager) va dans la barre, au-dessus du bouton : un lien vers le champ à remplir
  // (tools.noteFocus)
  if (tools) {
    const help = tools.help ? esc(tools.help) : '';
    // En très grand texte, la version courte (tools.noteShort) : la barre fixée reste basse
    const short = tools.noteShort ? `<span class="share-preview__note-short">${esc(tools.noteShort)}</span>` : '';
    const note = tools.note ? `<p class="share-preview__note" role="status" hidden><button type="button" class="share-preview__note-link${short ? ' share-preview__note-link--short' : ''}" data-action="share-preview-note" aria-label="${esc(tools.note)}"><span class="share-preview__note-full">${esc(tools.note)}</span>${short}</button></p>` : '';
    return `
    <div class="share-preview share-preview--tools">
      <div class="share-preview__top">
        <button type="button" class="share-preview__zoom" data-action="share-preview-zoom" aria-label="${esc(sharePreviewZoomLabel(alt))}">${frame}</button>
        <button type="button" class="share-preview__seebig" data-action="share-preview-zoom">${icon('arrow.up.left.and.arrow.down.right', 16)}<span>Voir en grand</span></button>
      </div>
      ${tools.rows || ''}${seg}
      ${help ? `<p class="share-preview__hint share-preview__help share-preview__help--flow">${help}</p>` : ''}
      <div class="share-preview__actionbar">${note}${send.replace(/\s*<p class="share-preview__hint">[^<]*<\/p>/, '')}
        ${help ? `<p class="share-preview__hint share-preview__help share-preview__help--bar">${help}</p>` : ''}
      </div>
    </div>`;
  }
  return `
    <div class="share-preview">${seg}${frame}${send}
    </div>`;
}

// Nom lu par VoiceOver sur l'aperçu touchable (8e panel) : la description complète de l'image, puis ce que fait le toucher
function sharePreviewZoomLabel(alt) { return `${String(alt || 'Image').replace(/\.$/, '')}. Touche deux fois pour voir en grand.`; }

// Feuille d'aperçu commune aux images partagées (séance, écran d'un récap : js/features/recap.js).
// state : { stats: { title }, name (fichier), alt, … } devient shareState le temps de l'aperçu ;
// draw(canvas) dessine l'image dans le canvas de la feuille. Un seul aperçu à la fois (double toucher).
// draw(canvas, format) : format 'story' ou 'square' (state.formats : le choix est proposé)
async function openStoryPreview(state, draw) {
  if (shareState) return;
  Object.assign(state, { blob: null, file: null, busy: false, format: 'story', baseName: state.name, draw, drawn: 0 });
  shareState = state;
  sheet({ title: 'Aperçu', cancel: 'Fermer', confirm: '', body: sharePreviewBody(state.alt, !!state.formats, state.tools || null) })
    .then(() => { if (shareState === state) shareState = null; state.onClose?.(); });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  state.root   = root;
  state.close  = v => root?._close?.(v);
  state.canvas = root.querySelector('.share-preview__img');
  await sharePreviewDraw(state);
}

// (Re)dessine l'image au format choisi ; un changement de format pendant un dessin l'emporte (drawn)
async function sharePreviewDraw(state) {
  const n = ++state.drawn, btn = state.root?.querySelector('.share-preview__send');
  if (btn) btn.disabled = true;
  state.blob = null; state.file = null;
  state.name = state.format === 'square' ? state.baseName.replace(/\.png$/, '-carre.png') : state.baseName;
  try {
    await state.draw(state.canvas, state.format);
    const zoom = state.root?.querySelector('.share-preview__zoom'), alt = state.canvas?.getAttribute('aria-label');
    if (zoom && alt) zoom.setAttribute('aria-label', sharePreviewZoomLabel(alt));
    const blob = await canvasBlob(state.canvas);
    if (n !== state.drawn) return;
    state.blob = blob;
    if (state.blob && !Native.isNative && typeof File === 'function') {
      state.file = new File([state.blob], state.name, { type: 'image/png' });
    }
  } catch {
    if (n === state.drawn) showToast('Image impossible à créer');
    return;
  }
  // canSend (affiche du coach) : partage refusé tant qu'il manque une donnée (le nom), la note dit laquelle
  const ok = !state.canSend || state.canSend();
  state.root?.querySelectorAll('.share-preview__note').forEach(n => { n.hidden = ok; });
  if (btn && ok && (state.file || (Native.isNative && state.blob))) btn.disabled = false;
}

// Ouvre l'aperçu de l'image d'une séance de l'historique
async function openSharePreview(id) {
  const entry = (data.history || []).find(h => h.id === id);
  if (!entry) return;
  // Records notés dans la séance (entryRecords) : les mêmes que ceux du bilan
  const stats = shareStoryStats(entry);
  await openStoryPreview({ entry, stats, name: shareFileName(entry), alt: shareStoryAlt(stats), formats: true },
    (canvas, format) => renderShareStory(entry, { stats, canvas, format }));
}

const SHARE_MESSAGES = { downloaded: 'Image enregistrée', failed: 'Partage impossible' };

registerActions({
  'share-story': (e, el) => { openSharePreview(el.dataset.id); },
  // Aperçu en plein écran (affiche du coach) : l'image telle qu'elle partira, fermée d'un toucher
  'share-preview-zoom': () => { sharePreviewZoom(); },
  // Note « Ajoute ton nom… » : amène au champ (centré, entre l'aperçu et la barre fixés) et l'active
  'share-preview-note': () => {
    const f = shareState?.tools?.noteFocus && shareState.root?.querySelector(shareState.tools.noteFocus);
    if (!f) return;
    f.scrollIntoView({ block: 'center' });
    f.focus({ preventScroll: true });
  },
  // Story ou carré : le cadre de l'aperçu prend le format, l'image est redessinée
  'share-format': (e, el) => {
    const st = shareState, f = el.dataset.f;
    if (!st || !SHARE_FORMATS[f] || st.format === f || st.busy) return;
    st.format = f;
    st.root?.querySelectorAll('[data-action="share-format"]').forEach(b => {
      const on = b.dataset.f === f;
      b.setAttribute('aria-pressed', String(on)); b.classList.toggle('segmented__btn--active', on);
    });
    st.root?.querySelector('.share-preview__frame')?.classList.toggle('share-preview__frame--square', f === 'square');
    const hint = st.root?.querySelector('.share-preview__hint:not(.share-preview__help)');
    if (hint) hint.textContent = SHARE_FORMATS[f].hint;
    haptic();
    sharePreviewDraw(st);
  },
  // Un seul partage à la fois : un double toucher ouvrirait une seconde feuille, refusée par iOS.
  // busy et disabled sont posés sans rien attendre, pour garder le geste exigé par navigator.share.
  'share-story-send': async (e, el) => {
    const st = shareState;
    if (!st?.blob || st.busy || (st.canSend && !st.canSend())) return;
    // beforeSend (affiche du coach) : une question avant le partage (sans photo) ; false : rien n'est partagé
    if (st.beforeSend) {
      st.busy = true;
      const go = await st.beforeSend().catch(() => false);
      st.busy = false;
      if (!go || shareState !== st) return;
    }
    st.busy = true;
    el.disabled = true;
    // Départ vers une autre app pendant le partage (Instagram « Story » ouvre la sienne) : l'aperçu
    // se ferme tout de suite. La feuille d'iOS, elle, reste affichée tant qu'iOS n'a pas de réponse ;
    // la coquille native la referme au retour (SceneDelegate.closeShareSheetAfterLeaving).
    const onLeave = () => { if (document.visibilityState === 'hidden') st.close?.(true); };
    document.addEventListener('visibilitychange', onLeave);
    let result = 'failed';
    try {
      result = Native.isNative
        ? await Native.shareImage(await blobDataUrl(st.blob), st.name)
        : (st.file ? await shareOrDownload(st.file, `${st.stats.title} · MDLF Training`) : 'failed');
    } catch {
      result = 'failed';
    } finally {
      document.removeEventListener('visibilitychange', onLeave);
      st.busy = false;
      el.disabled = false;
    }
    if (SHARE_MESSAGES[result]) showToast(SHARE_MESSAGES[result]);
    // Feuille de partage refermée : l'aperçu se ferme aussi, y compris 'handed' (une app choisie qui
    // renvoie une erreur : Native.shareOutcome). L'aperçu ne reste ouvert qu'en cas d'échec réel,
    // pour pouvoir réessayer.
    if (result !== 'failed') { st.onShared?.(result); st.close?.(true); }
  },
});

function sharePreviewZoom() {
  const st = shareState;
  if (!st?.canvas || document.querySelector('.share-zoom')) return;
  let url;
  try { url = st.canvas.toDataURL('image/png'); } catch { return; }
  const el = document.createElement('div');
  el.className = 'share-zoom';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Image en plein écran');
  el.innerHTML = `<img class="share-zoom__img" src="${url}" alt="${esc(st.canvas.getAttribute('aria-label') || '')}">
    <button type="button" class="btn btn--secondary share-zoom__close">Fermer</button>`;
  const close = () => { el.remove(); st.root?.querySelector('.share-preview__zoom')?.focus({ preventScroll: true }); };
  el.addEventListener('click', close);
  document.body.appendChild(el);
  el.querySelector('.share-zoom__close').focus({ preventScroll: true });
}

// Bouton commun du bilan et du détail d'une séance
function shareStoryButton(id, cls = '') {
  return `<button class="btn btn--secondary btn--full share-btn ${cls}" data-action="share-story" data-id="${esc(id)}">
    ${icon('square.and.arrow.up', 22)}<span>Partager la séance</span></button>`;
}
