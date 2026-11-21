// ═══════════════════════════════════════════════════════════
//  Atlas détaillé : nom du sous-muscle touché, vue agrandie (pincer, toucher deux fois)
// ═══════════════════════════════════════════════════════════
'use strict';

// Carte de la fiche exercice (bodyAtlasHtml, js/ui/body-map.js) :
//   un toucher        bulle du sous-muscle : nom de salle, nom officiel (latin), rôle pour cet exercice
//   deux touchers     vue agrandie, zoomée là où le doigt a touché
//   deux doigts       vue agrandie, et le pincement CONTINUE dedans avec les mêmes doigts (atlasPinchFromMap) : les
//                     touchers restent adressés à la carte (cible d'origine) même sous la feuille, on les recopie
//   bouton Agrandir   vue agrandie (VoiceOver, et pour qui ne connaît pas les gestes)
// Vue agrandie (feuille) : pincer (le zoom suit les doigts, de ×1 à ×6, élastique aux bornes comme Photos), glisser
// (avec inertie), toucher deux fois (×2,5 sur le point touché, puis retour), boutons + et − (VoiceOver, contacteur),
// toucher un muscle (bulle, posée dans la feuille modale pour VoiceOver).
// Déplacement et zoom : un seul transform CSS (translate3d + scale) sur la scène, écrit une fois par image ;
// le compositeur de WebKit agrandit la couche sans repeindre (démo : mdlf-perso/demo-zoom).
//
// Images (img/body2/, tools/gen-body2.py) : le 1× est celui de la fiche (en cache d'installation, sw.js). Le 3×
// (base@3x, p3/, lines@3x) se charge dès ×1,26 (90 % de ATLAS_HI_AT : prêt avant ×1,4), pour LA vue (face ou dos) au centre de l'écran : une
// seule vue 3× décodée à la fois (mémoire de WebKit sur iPhone, ≈ 25 Mo par vue) ; passer à l'autre vue rend
// d'abord la première au 1× (marge : face sous 45 % de la largeur, dos au-delà de 55 %, pas d'aller-retour au milieu).
// Le service worker garde ensuite ces fichiers (règle « cache d'abord ») ; hors ligne sans eux, le 1× reste affiché.
// Carte de toucher : hit.png (1 + rang du sous-muscle dans BODY_PARTS.parts, 0 = rien), lue une fois par vue.

const ATLAS_HI_AT = 1.4;      // images 3× de la vue affichée, chargées dès 90 % de ce seuil (×1,26)
const ATLAS_LINES_AT = 2;     // au-delà : contours des sous-muscles
const ATLAS_MAX = 6;
const ATLAS_DOUBLE_MS = 350;  // deux touchers à moins de 350 ms (comme iOS) et 32 points : double toucher
const ATLAS_DOUBLE_PX = 32;
const ATLAS_ZOOM_TO = 2.5;    // vue agrandie : double toucher, zoom sur le point touché (la carte ouvre la vue entière)
const ATLAS_STEP = 1.6;       // boutons + et − : facteur de zoom par toucher

// ── Carte de toucher ────────────────────────────────────────

const atlasHitMaps = new Map();
function atlasHitMap(kind, view) {
  const key = `${kind}/${view}`;
  if (!atlasHitMaps.has(key)) {
    const url = body2Url(kind, view, 'hit.png');
    atlasHitMaps.set(key, bodyLoadImage(url).then(img => {
      bodyImageCache.delete(url);   // lue une fois : seule la carte d'indices (Uint8Array) reste en mémoire
      if (!img) { atlasHitMaps.delete(key); return null; }
      const [w, h] = BODY_PARTS.hit;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h).data, map = new Uint8Array(w * h);
      for (let i = 0; i < map.length; i++) map[i] = d[i * 4];
      c.width = c.height = 0;       // WebKit libère le tampon du canvas tout de suite
      return { w, h, map };
    }));
  }
  return atlasHitMaps.get(key);
}

// Sous-muscle sous le doigt dans un conteneur de vues (.body-map__fig, transformées ou non) : { part, view, fig }
// ou null ; fig : boîte du corps entier (.body-map__body dans une carte cadrée sur le haut ou le bas du corps).
// Tolérance autour du doigt : celle de la carte des 18 muscles (BODY_HIT_TOL_PX, js/ui/body-tip.js)
async function atlasPartAt(root, kind, clientX, clientY) {
  for (const box of root.querySelectorAll('.body-map__fig')) {
    const clip = box.getBoundingClientRect();
    if (!clip.width || clientX < clip.left || clientX > clip.right || clientY < clip.top || clientY > clip.bottom) continue;
    const fig = box.querySelector('.body-map__body') || box, r = fig.getBoundingClientRect();
    if (!r.width || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
    const view = box.classList.contains('body-map__back') ? 'back' : 'front';
    const hit = await atlasHitMap(kind, view);
    if (!hit) return null;
    const sx = hit.w / r.width;
    const k = bodyHitAt(hit.map, hit.w, hit.h, (clientX - r.left) * sx, (clientY - r.top) * (hit.h / r.height), BODY_HIT_TOL_PX * sx);
    const part = k >= 0 ? BODY_PARTS.parts[k] : null;
    return part && !part.deep ? { part, view, fig } : null;
  }
  return null;
}

function atlasLevels(mapEl) {
  try { return JSON.parse(mapEl.dataset.atlas || '{}') || {}; } catch { return {}; }
}

// Nom de salle (celui de la pastille), nom officiel (latin, caché en texte agrandi), rôle d'après la couleur
function atlasTipHtml(part, level) {
  return `<p class="btip__title" id="btipTitle">${esc(atlasPartTitle(part.id))}</p>
    <p class="btip__latin" lang="la">${esc(part.latin)}</p>
    <p class="btip__sub">${atlasRole(level)}</p>`;
}

// ── Carte d'info du muscle touché (panel affichage-e t8 : la bulle flottante couvrait le personnage ou la liste) ──
// Un toucher remplit une carte fixe, dans la page, juste sous le dessin (fiche, Progrès) ou en tête de la bande du bas
// (vue agrandie) : elle pousse le contenu au lieu de le couvrir, se ferme par sa croix ou par un toucher hors d'un muscle.
// Le muscle touché garde ses couleurs, cerné d'un contour fin (marque) pour le repérer
function atlasInfoShow(root, html, container = null) {
  closeAtlasInfo();
  const card = `<section class="atlas-info" aria-live="polite" aria-label="Muscle touché">
      <div class="atlas-info__body">${html}</div>
      <button class="atlas-info__close" data-action="atlas-info-close" aria-label="Fermer">${icon('xmark', 16)}</button>
    </section>`;
  const band = container?.querySelector('.azoom__band'), box = root.closest('.atlas-box');
  if (band) band.insertAdjacentHTML('beforebegin', card);   // vue agrandie : en tête de la bande du bas, au-dessus de la légende
  else if (box) (box.nextElementSibling?.classList.contains('atlas-box__iso') ? box.nextElementSibling : box).insertAdjacentHTML('afterend', card);
  else return null;
  const el = document.querySelector('.atlas-info');
  // Carte de la page : amenée à l'écran si elle passe sous la barre d'onglets (le personnage remonte d'autant)
  const bar = document.querySelector('.tabbar')?.getBoundingClientRect().top ?? innerHeight, over = el.getBoundingClientRect().bottom - (bar - 8);
  if (!band && over > 0) scrollBy({ top: over, behavior: 'instant' });
  return el;
}
function closeAtlasInfo() {
  document.querySelectorAll('.atlas-info, .body-map__mark').forEach(e => e.remove());
}
// Marque du muscle touché : son contour, fin, à la couleur du texte (dessin de bodyOutlineHtml), posé sur le corps de sa vue
function atlasMarkPart(fig, kind, view, id, res) {
  fig.querySelector('.body-map__mark')?.remove();
  (fig.querySelector('.body-map__body') || fig).insertAdjacentHTML('beforeend', bodyOutlineHtml(kind, view, [id], res, 'body-map__mark'));
}

// Toucher d'un sous-muscle : carte d'info et marque. root : carte ou scène de la vue agrandie ; res(vue) : 1 ou 3 selon
// les images affichées ; container : la feuille de la vue agrandie ; tip : 'load' (Progrès : volume de la période,
// atlasLoadTipHtml de js/features/progress-atlas.js), sinon la fiche (nom, latin, rôle)
async function atlasShowName(root, kind, levels, e, { res = () => 1, container = null, tip = '' } = {}) {
  const seq = ++bodyTipSeq;
  const hit = await atlasPartAt(root, kind, e.clientX, e.clientY);
  if (seq !== bodyTipSeq || !root.isConnected) return;
  if (!hit) { closeBodyTip(); return; }
  const card = atlasInfoShow(root, tip === 'load' ? atlasLoadTipHtml(hit.part) : atlasTipHtml(hit.part, levels[hit.part.id] || 0), container);
  if (!card) return;
  atlasMarkPart(hit.fig, kind, hit.view, hit.part.id, res(hit.view));
  haptic();
}

// ── Carte de la fiche : toucher, double toucher, deux doigts ─

let atlasLastTap = null;
function atlasTap(e, mapEl) {
  if (!e || (!e.clientX && !e.clientY)) return;
  // Heure du toucher lui-même (e.timeStamp), pas celle où il est traité : la bulle du premier toucher se prépare (carte de
  // toucher, mise en page) et peut retarder le traitement du second ; mesuré à l'arrivée, un vrai double toucher passait
  // pour deux touchers sur un appareil chargé (CI, iPhone 17 : bulle rouverte au lieu de la vue agrandie)
  const now = e.timeStamp > 0 ? e.timeStamp : performance.now();
  const last = atlasLastTap;
  if (last && last.el === mapEl && now - last.t < ATLAS_DOUBLE_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < ATLAS_DOUBLE_PX) {
    atlasLastTap = null;
    closeBodyTip();
    // La vue entière, face et dos (panel t8) : le pincement agrandit ensuite
    openAtlasViewer(mapEl, null);
    return;
  }
  atlasLastTap = { el: mapEl, t: now, x: e.clientX, y: e.clientY };
  atlasShowName(mapEl, bodyKind(mapEl.dataset.body), atlasLevels(mapEl), e, { tip: mapEl.dataset.tip || '' });
}

// Pincement commencé sur la carte de la fiche (ou de Progrès) : la vue agrandie s'ouvre et suit les mêmes doigts.
// iOS adresse tous les touchers d'un geste à l'élément où ils ont commencé, même recouvert par la feuille : on les
// lit ici (document) et on les passe au zoom de la vue, comme s'ils y avaient commencé. Le défilement de la page
// n'est empêché que pendant ce pincement (preventDefault seulement à deux doigts sur une carte).
let atlasPinch = null;   // { viewer } pendant un pincement commencé sur une carte
if (typeof document !== 'undefined' && document.addEventListener) {
  // Un vrai toucher ailleurs (légende, liste…) entre deux touchers de la carte : ce n'est plus un double toucher
  // (les clics simulés de haptic(), non « trusted », juste après un toucher, ne comptent pas)
  document.addEventListener('click', e => {
    if (e.isTrusted && atlasLastTap && !atlasLastTap.el.contains(e.target)) atlasLastTap = null;
  }, true);
  const feed = (type, list) => {
    for (const t of list) atlasViewer?.feed(type, { pointerId: `t${t.identifier}`, clientX: t.clientX, clientY: t.clientY });
  };
  document.addEventListener('touchstart', e => {
    if (atlasPinch || e.touches.length !== 2) return;
    const maps = [...e.touches].map(t => t.target?.closest?.('.body-map--atlas[data-action="body-tap"]'));
    if (!maps[0] || maps[0] !== maps[1]) return;
    const [a, b] = e.touches;
    closeBodyTip();
    atlasLastTap = null;
    openAtlasViewer(maps[0], { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, scale: 1, now: true });
    if (!atlasViewer) return;
    atlasPinch = { viewer: atlasViewer };
    feed('down', e.touches);
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!atlasPinch) return;
    if (e.cancelable) e.preventDefault();   // ni défilement ni zoom de la page pendant le pincement
    feed('move', e.touches);
  }, { passive: false });
  const end = e => {
    if (!atlasPinch) return;
    feed('cancel', e.changedTouches);
    if (!e.touches.length) atlasPinch = null;
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
}

// ── Vue agrandie ────────────────────────────────────────────

let atlasViewer = null;   // vue ouverte (une seule) : état du zoom, pour les tests (atlasViewerState)

function atlasFigHtml(kind, view, levels, tiers = false, outline = []) {
  return `<span class="body-map__fig body-map__${view}" data-view="${view}"><img class="body-map__base" src="${body2Url(kind, view, 'base.webp')}" alt="" draggable="false" decoding="async"><span class="azoom__lay">${bodyAtlasLayersHtml(kind, view, levels, 1, tiers, outline)}</span><img class="azoom__lines" alt="" draggable="false" decoding="async" hidden></span>`;
}

// Description pour VoiceOver : les sous-muscles colorés, ciblés d'abord (fiche) ; Progrès (tiers) : du plus au moins travaillé
function atlasA11yLabel(levels, tiers = false) {
  const names = test => [...new Set(BODY_PARTS.parts.filter(p => test(levels[p.id] || 0)).map(p => atlasPillLabel(p.id)))];
  if (tiers) {
    const parts = [2, 1].map(l => [l, names(v => v === l)]).filter(([, n]) => n.length);
    return parts.length ? `Travail de la période : ${parts.map(([l, n]) => `${MUSCLE_LEVEL_WORDS[l]} : ${n.join(', ')}`).join(' ; ')}` : 'Personnage, aucun muscle travaillé sur la période';
  }
  const main = names(v => v >= 2), sec = names(v => v === 1);
  return [main.length && `Muscles ciblés : ${main.join(', ')}`, sec.length && `muscles qui aident : ${sec.join(', ')}`].filter(Boolean).join(' ; ')
    || 'Personnage, aucun muscle coloré';
}

// from : { x, y, scale } point touché sur la carte de la fiche (zoom sur ce point), ou null (×1)
function openAtlasViewer(mapEl, from = null) {
  if (atlasViewer || !mapEl?.isConnected) return;
  const kind = bodyKind(mapEl.dataset.body), levels = atlasLevels(mapEl), tiers = mapEl.dataset.tiers === '1', tip = mapEl.dataset.tip || '';
  const row = mapEl.querySelector('.body-map__row')?.getBoundingClientRect();
  // Point touché ramené au corps entier, face et dos (la carte de la fiche peut être cadrée sur le haut ou le bas du
  // corps, ou ne montrer qu'une vue : data-view)
  const [c0, c1] = (mapEl.dataset.crop || `0,${BODY_PARTS.h}`).split(',').map(Number);
  const rowW = 2 + BODY_GAP, one = mapEl.dataset.view, outline = (mapEl.dataset.ol || '').split(' ').filter(Boolean);
  const u = r => (one ? (one === 'back' ? 1 + BODY_GAP : 0) + r : r * rowW) / rowW;
  const at = from && row?.width ? { u: u((from.x - row.left) / row.width),
    v: (c0 + (from.y - row.top) / row.height * (c1 - c0)) / BODY_PARTS.h, scale: from.scale } : null;
  // Légende : toujours une ligne visible, les noms de la page (fiche : Ciblé, Qui aide ; Progrès : les 3 états). En texte
  // très grand (AX33 : le personnage n'avait plus que 350 points sur iPhone SE), les bornes en séries passent derrière
  // « Légende » (panel affichage-e t4 : repliée, la légende ne disait plus rien)
  const xl = document.documentElement.classList.contains('type-xl');
  const legend = tiers ? `<p class="azoom__legend">${muscleLegendItemsHtml(!xl)}</p>`
    : `<p class="azoom__legend"><span class="mline2__dot mline2__dot--main" aria-hidden="true"></span>Ciblé <span class="mline2__dot mline2__dot--help" aria-hidden="true"></span>Qui aide</p>`;
  const key = tiers && xl ? `<details class="azoom__key"><summary class="azoom__sum">Légende</summary><span class="azoom__legend">${muscleLegendItemsHtml(true)}</span></details>` : '';
  const body = `
    <div class="azoom" data-scale="1" data-hi="" data-lines="">
      <div class="azoom__stage body-map body-map--atlas" data-body="${kind}"${tiers ? ' data-tiers="1"' : ''} role="img" aria-label="${esc(atlasA11yLabel(levels, tiers))}">
        <span class="body-map__row" style="--fig:${Math.round(10000 / rowW) / 100}%">${['front', 'back'].map(v => atlasFigHtml(kind, v, levels, tiers, outline)).join('')}</span>
      </div>
    </div>
    <div class="azoom__band">
      ${legend}
      <div class="azoom__text">
        ${key}
        <p class="azoom__hint">Pince pour zoomer. Touche un muscle pour son nom.</p>
        ${tiers ? '' : '<p class="azoom__short">Touche un muscle pour son nom</p>'}
      </div>
      <div class="azoom__ctl">
        <button class="azoom__btn" data-z="-1" aria-label="Dézoomer">${icon('minus', 22)}</button>
        <button class="azoom__btn" data-z="1" aria-label="Zoomer">${icon('plus', 22)}</button>
      </div>
    </div>`;
  const done = sheet({ title: mapEl.dataset.title || 'Muscles', cancel: '', confirm: 'OK', body });
  const roots = document.querySelectorAll('.sheet-root');
  const root = roots[roots.length - 1];
  const view = root?.querySelector('.azoom');
  if (!view) return;
  root.classList.add('sheet-root--atlas');
  if (from?.now) root.classList.add('sheet-root--now');   // pincement en cours : la feuille est là tout de suite, sous les doigts
  atlasViewer = atlasZoom(view, kind, levels, at, root, { tiers, tip, outline });
  done.then(() => { atlasViewer?.destroy(); atlasViewer = null; closeBodyTip(); });
}

// État de la vue agrandie (tests) : { scale, hi, lines } ou null
function atlasViewerState() {
  return atlasViewer ? { scale: atlasViewer.scale(), hi: atlasViewer.hi(), lines: atlasViewer.lines() } : null;
}

// Zoom, déplacement et noms dans la vue agrandie
function atlasZoom(view, kind, levels, at, root, { tiers = false, tip = '', outline = [] } = {}) {
  const stage = view.querySelector('.azoom__stage');
  const figs = { front: stage.querySelector('.body-map__front'), back: stage.querySelector('.body-map__back') };
  const ratio = (2 + BODY_GAP) * BODY_PARTS.w / BODY_PARTS.h;
  let W = 0, H = 0, s = 1, x = 0, y = 0, raf = 0;
  let hiView = '', hiWant = '', linesOn = false, alive = true;
  const hiFailed = new Set();   // vue dont le 3× n'a pas pu se charger (hors ligne, jamais zoomée) : 1× gardé

  function layout() {
    const vw = view.clientWidth, vh = view.clientHeight;
    W = Math.min(vw - 16, (vh - 16) * ratio); H = W / ratio;
    stage.style.width = `${W}px`; stage.style.height = `${H}px`;
  }
  function viewRect() { return { w: view.clientWidth, h: view.clientHeight }; }
  function clamp() {
    const r = viewRect();
    s = Math.min(ATLAS_MAX, Math.max(1, s));
    const w = W * s, h = H * s;
    x = w <= r.w ? (r.w - w) / 2 : Math.min(r.w * 0.25, Math.max(r.w * 0.75 - w, x));
    y = h <= r.h ? (r.h - h) / 2 : Math.min(r.h * 0.25, Math.max(r.h * 0.75 - h, y));
  }
  function apply() {
    raf = 0;
    if (!alive) return;
    stage.style.transform = `translate3d(${x}px,${y}px,0) scale(${s})`;
    view.dataset.scale = s.toFixed(2);
    detail();
    buttons();
  }
  function frame() { if (!raf) raf = requestAnimationFrame(apply); }
  function zoomAt(px, py, s2) {
    const k = Math.min(ATLAS_MAX, Math.max(1, s2)) / s;
    x = px - (px - x) * k; y = py - (py - y) * k; s *= k;
    clamp();
  }

  // Vue (face ou dos) au centre de l'écran : celle qui reçoit le 3×. Marge autour du milieu : on ne change de vue
  // que franchement passé (face sous 45 %, dos au-delà de 55 %), pas d'échange d'images en boucle au milieu
  function centerView() {
    const u = (viewRect().w / 2 - x) / (W * s);
    if (hiWant === 'front') return u > 0.55 ? 'back' : 'front';
    if (hiWant === 'back') return u < 0.45 ? 'front' : 'back';
    return u < 0.5 ? 'front' : 'back';
  }
  // Marque du muscle touché : gardée à travers l'échange 1× ↔ 3×, refaite à la résolution affichée
  function swapLayers(v, res) {
    const f = figs[v], part = f.querySelector('.body-map__mark')?.dataset.ol;
    f.querySelector('.azoom__lay').innerHTML = bodyAtlasLayersHtml(kind, v, levels, res, tiers, outline);
    if (part) atlasMarkPart(f, kind, v, part, res);
  }
  function toLow(v) {
    const f = figs[v];
    f.querySelector('.body-map__base').src = body2Url(kind, v, 'base.webp');
    swapLayers(v, 1);
    const ln = f.querySelector('.azoom__lines');
    ln.hidden = true; ln.removeAttribute('src');
  }
  function toHi(v) {
    hiWant = v;
    const urls = [body2Url(kind, v, 'base@3x.webp'),
      ...BODY_PARTS.parts.filter(p => (levels[p.id] > 0 || outline.includes(p.id)) && BODY_PARTS.boxes[kind]?.[v]?.[p.id]).map(p => body2Url(kind, v, `p3/${p.id}.webp`))];
    // Affiché seulement une fois tout décodé : sinon un muscle clignoterait sans couleur. Une image en échec (hors
    // ligne, jamais zoomée) : rien n'est échangé, le 1× reste à l'écran
    Promise.all(urls.map(u => { const im = new Image(); im.src = u; return im.decode().then(() => true, () => false); })).then(ok => {
      if (!alive || hiWant !== v) return;
      if (!ok.every(Boolean)) { hiWant = ''; hiFailed.add(v); return; }
      if (hiView && hiView !== v) toLow(hiView);
      figs[v].querySelector('.body-map__base').src = urls[0];
      swapLayers(v, 3);
      hiView = v; view.dataset.hi = v;
      detail();
    });
  }
  function detail() {
    if (s >= ATLAS_HI_AT * 0.9) {
      const v = centerView();
      if (v !== hiWant && !hiFailed.has(v)) {
        // Une seule vue 3× : l'ancienne repasse au 1× avant que la nouvelle ne se charge
        if (hiView) { toLow(hiView); hiView = ''; view.dataset.hi = ''; linesOn = false; view.dataset.lines = ''; }
        toHi(v);
      }
    }
    const want = hiView && s >= ATLAS_LINES_AT;
    if (!!want !== linesOn) {
      const ln = figs[hiView || 'front'].querySelector('.azoom__lines');
      if (want) { ln.onerror = () => { ln.hidden = true; }; ln.src = body2Url(kind, hiView, 'lines@3x.webp'); }
      ln.hidden = !want;
      linesOn = !!want; view.dataset.lines = want ? hiView : '';
    }
  }

  // ── Gestes (Pointer Events) ──
  // Élastique aux bornes (comme Photos) : au-delà de ×1 ou ×6, ou du bord du dessin, le geste ne suit plus qu'au quart ;
  // au relâchement, retour souple dans les bornes. Inertie : la vitesse du doigt au lâcher se prolonge et s'amortit.
  const pts = new Map();
  let start = null, moved = false, lastTap = null, track = [], glide = 0;
  const local = e => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function snapshot() {
    const a = [...pts.values()];
    const c = a.length > 1 ? { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 } : a[0];
    const d = a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
    return { c, d, s, x, y };
  }
  const soft = (v, lo, hi) => (v > hi ? hi + (v - hi) * 0.25 : v < lo ? lo - (lo - v) * 0.25 : v);
  // Échelle : élastique borné (au plus 30 % au-delà de ×6, ou en deçà de ×1), comme Photos
  const softScale = v => (v > ATLAS_MAX ? ATLAS_MAX * (1.3 - 0.3 / (v / ATLAS_MAX)) : v < 1 ? 1 - 0.3 * (1 - v) : v);
  function bounds(sc) {   // [xmin, xmax, ymin, ymax] permis à l'échelle sc (comme clamp)
    const r = viewRect(), w = W * sc, h = H * sc;
    const bx = w <= r.w ? [(r.w - w) / 2, (r.w - w) / 2] : [r.w * 0.75 - w, r.w * 0.25];
    const by = h <= r.h ? [(r.h - h) / 2, (r.h - h) / 2] : [r.h * 0.75 - h, r.h * 0.25];
    return [...bx, ...by];
  }
  function stopGlide() { if (glide) cancelAnimationFrame(glide); glide = 0; }
  function down(e) {
    if (e.target?.closest?.('button')) return;   // boutons + et − : leur propre clic
    try { view.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique (tests), toucher venu de la carte */ }
    stopGlide();
    pts.set(e.pointerId, local(e));
    stage.classList.remove('azoom__stage--anim');
    start = snapshot();
    moved = pts.size > 1;
    track = [];
  }
  function move(e) {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    const now = snapshot();
    if (pts.size > 1 && start.d > 0) {
      const s2 = softScale(start.s * now.d / start.d);
      const k = s2 / start.s;
      s = s2; x = now.c.x - (start.c.x - start.x) * k; y = now.c.y - (start.c.y - start.y) * k;
      moved = true;
    } else {
      const dx = now.c.x - start.c.x, dy = now.c.y - start.c.y;
      if (!moved && Math.hypot(dx, dy) > 8) moved = true;
      if (!moved) return;
      const [x0, x1, y0, y1] = bounds(s);
      x = soft(start.x + dx, x0, x1); y = soft(start.y + dy, y0, y1);
      track.push({ t: performance.now(), x, y });
      if (track.length > 5) track.shift();
    }
    closeBodyTip();
    frame();
  }
  // Inertie : vitesse des dernières 100 ms, amortie (≈ 0,995 par ms, comme le défilement d'iOS), arrêtée au bord
  function inertia() {
    const a = track[0], b = track[track.length - 1], dt = b && a ? b.t - a.t : 0;
    if (!dt || reduceMotion.matches || performance.now() - b.t > 100) return false;
    let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt, last = performance.now();
    if (Math.hypot(vx, vy) < 0.1) return false;
    const stepGlide = t => {
      const d = t - last; last = t;
      const [x0, x1, y0, y1] = bounds(s);
      x += vx * d; y += vy * d;
      if (x < x0 || x > x1) { x = Math.min(x1, Math.max(x0, x)); vx = 0; }
      if (y < y0 || y > y1) { y = Math.min(y1, Math.max(y0, y)); vy = 0; }
      const f = Math.pow(0.995, d); vx *= f; vy *= f;
      apply();
      glide = Math.hypot(vx, vy) > 0.02 && alive ? requestAnimationFrame(stepGlide) : 0;
    };
    glide = requestAnimationFrame(stepGlide);
    return true;
  }
  function up(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size) { start = snapshot(); track = []; return; }
    if (!moved && e.type === 'pointerup') { tap(e); return; }
    const [x0, x1, y0, y1] = bounds(Math.min(ATLAS_MAX, Math.max(1, s)));
    const outside = s < 1 || s > ATLAS_MAX || x < x0 || x > x1 || y < y0 || y > y1;
    if (!outside && inertia()) return;
    if (!reduceMotion.matches) stage.classList.add('azoom__stage--anim');   // retour souple dans les bornes
    clamp(); frame();
  }
  function tap(e) {
    const p = local(e), t = e.timeStamp > 0 ? e.timeStamp : performance.now();   // heure du toucher (atlasTap)
    if (lastTap && t - lastTap.t < ATLAS_DOUBLE_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < ATLAS_DOUBLE_PX) {
      lastTap = null;
      closeBodyTip();
      if (!reduceMotion.matches) stage.classList.add('azoom__stage--anim');
      zoomAt(p.x, p.y, s > 1.3 ? 1 : ATLAS_ZOOM_TO);
      frame();
      return;
    }
    lastTap = { t, ...p };
    atlasShowName(stage, kind, levels, e, { res: v => (v === hiView ? 3 : 1), container: root, tip });
  }
  // Boutons + et − : zoom autour du centre de la vue (VoiceOver, accès par contacteur)
  function step(dir) {
    const r = viewRect();
    closeBodyTip();
    if (!reduceMotion.matches) stage.classList.add('azoom__stage--anim');
    zoomAt(r.w / 2, r.h / 2, dir > 0 ? s * ATLAS_STEP : s / ATLAS_STEP);
    frame();
  }
  const btns = [...root.querySelectorAll('.azoom__btn')];   // bande du bas, hors du dessin (panel affichage-e t1)
  btns.forEach(b => b.addEventListener('click', () => step(Number(b.dataset.z))));
  function buttons() {
    for (const b of btns) b.disabled = Number(b.dataset.z) > 0 ? s >= ATLAS_MAX - 0.01 : s <= 1.01;
  }
  view.addEventListener('pointerdown', down);
  view.addEventListener('pointermove', move);
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', up);
  // Taille de la vue : rotation, et légende dépliée ou repliée (texte très grand)
  const onResize = () => { if (!alive) return; layout(); clamp(); frame(); };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  if (ro) ro.observe(view); else window.addEventListener('resize', onResize);

  layout();
  clamp();
  if (at) {   // zoom sur le point touché dans la fiche, amené au centre
    const r = viewRect();
    s = Math.min(ATLAS_MAX, Math.max(1, at.scale));
    x = r.w / 2 - at.u * W * s; y = r.h / 2 - at.v * H * s;
    clamp();
  }
  apply();

  return {
    scale: () => s, hi: () => hiView, lines: () => (linesOn ? hiView : ''),
    // Toucher venu d'ailleurs (pincement commencé sur la carte) : type 'down' | 'move' | 'cancel'
    feed(type, e) { const ev = { ...e, target: view, type: type === 'cancel' ? 'pointercancel' : `pointer${type}` }; (type === 'down' ? down : type === 'move' ? move : up)(ev); },
    destroy() { alive = false; stopGlide(); ro?.disconnect(); window.removeEventListener('resize', onResize); if (raf) cancelAnimationFrame(raf); },
  };
}
