// ═══════════════════════════════════════════════════════════
//  Atlas détaillé : nom du sous-muscle touché, vue agrandie (pincer, toucher deux fois)
// ═══════════════════════════════════════════════════════════
'use strict';

// Carte de la fiche exercice (bodyAtlasHtml, js/ui/body-map.js) :
//   un toucher        bulle du sous-muscle : nom de salle, nom officiel (latin), rôle pour cet exercice
//   deux touchers     vue agrandie, zoomée là où le doigt a touché
//   deux doigts       vue agrandie (le pincement commence sur la carte, il continue dans la vue)
//   bouton Agrandir   vue agrandie (VoiceOver, et pour qui ne connaît pas les gestes)
// Vue agrandie (feuille) : pincer, glisser, toucher deux fois (zoom ou retour), toucher un muscle (bulle).
// Déplacement et zoom : un seul transform CSS (translate3d + scale) sur la scène, écrit une fois par image ;
// le compositeur de WebKit agrandit la couche sans repeindre (démo : mdlf-perso/demo-zoom).
//
// Images (img/body2/, tools/gen-body2.py) : le 1× est celui de la fiche (en cache d'installation, sw.js). Le 3×
// (base@3x, p3/, lines@3x) ne se charge qu'au-delà de ×1,4, pour LA vue (face ou dos) au centre de l'écran : une
// seule vue 3× décodée à la fois (mémoire de WebKit sur iPhone, ≈ 25 Mo par vue) ; passer à l'autre vue rend
// d'abord la première au 1×. Le service worker garde ensuite ces fichiers (règle « cache d'abord »).
// Carte de toucher : hit.png (1 + rang du sous-muscle dans BODY_PARTS.parts, 0 = rien), lue une fois par vue.

const ATLAS_HI_AT = 1.4;      // au-delà : images 3× de la vue affichée
const ATLAS_LINES_AT = 2;     // au-delà : contours des sous-muscles
const ATLAS_MAX = 6;
const ATLAS_DOUBLE_MS = 320;  // deux touchers à moins de 320 ms et 32 points : double toucher
const ATLAS_DOUBLE_PX = 32;
const ATLAS_ZOOM_TO = 2.6;    // double toucher : zoom sur le point touché

// ── Carte de toucher ────────────────────────────────────────

const atlasHitMaps = new Map();
function atlasHitMap(kind, view) {
  const key = `${kind}/${view}`;
  if (!atlasHitMaps.has(key)) {
    atlasHitMaps.set(key, bodyLoadImage(body2Url(kind, view, 'hit.png')).then(img => {
      if (!img) { atlasHitMaps.delete(key); return null; }
      const [w, h] = BODY_PARTS.hit;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h).data, map = new Uint8Array(w * h);
      for (let i = 0; i < map.length; i++) map[i] = d[i * 4];
      return { w, h, map };
    }));
  }
  return atlasHitMaps.get(key);
}

// Sous-muscle sous le doigt dans un conteneur de vues (.body-map__fig, transformées ou non) : { part, view, fig }
// ou null. Tolérance autour du doigt : celle de la carte des 18 muscles (BODY_HIT_TOL_PX, js/ui/body-tip.js)
async function atlasPartAt(root, kind, clientX, clientY) {
  for (const fig of root.querySelectorAll('.body-map__fig')) {
    const r = fig.getBoundingClientRect();
    if (!r.width || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
    const view = fig.classList.contains('body-map__back') ? 'back' : 'front';
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

function atlasTipHtml(part, level) {
  return `<p class="btip__title" id="btipTitle">${esc(part.name)}</p>
    <p class="btip__latin" lang="la">${esc(part.latin)}</p>
    <p class="btip__sub">${atlasRole(level)}</p>`;
}

// Mise en valeur du sous-muscle touché (comme bodyTipMarkHtml) : copie opaque de son calque, à sa boîte
function atlasMarkHtml(kind, view, id, res, tint) {
  const b = BODY_PARTS.boxes[kind]?.[view]?.[id];
  if (!b) return '';
  const bb = b[res === 3 ? 1 : 0], W = res === 3 ? BODY_PARTS.w3 : BODY_PARTS.w, H = res === 3 ? BODY_PARTS.h3 : BODY_PARTS.h;
  const pct = v => `${Math.round(v * 1e5) / 1e3}%`;
  const url = `url(${body2Url(kind, view, `${res === 3 ? 'p3' : 'p'}/${id}.webp`)})`;
  return `<span class="body-map__hl" data-part="${id}" aria-hidden="true"><i style="left:${pct(bb[0] / W)};top:${pct(bb[1] / H)};width:${pct((bb[2] - bb[0]) / W)};height:${pct((bb[3] - bb[1]) / H)};background-color:${esc(tint)};background-image:${url};-webkit-mask-image:${url};mask-image:${url}"></i></span>`;
}

// Bulle et mise en valeur d'un sous-muscle touché. root : carte ou scène de la vue agrandie ; res : 1 ou 3
// selon les images affichées dans la vue touchée ; top : bulle au-dessus de la feuille de la vue agrandie
async function atlasShowName(root, kind, levels, e, { res = () => 1, top = false, prefer = [] } = {}) {
  const seq = ++bodyTipSeq;
  const hit = await atlasPartAt(root, kind, e.clientX, e.clientY);
  if (seq !== bodyTipSeq || !root.isConnected) return;
  if (!hit) { closeBodyTip(); return; }
  const lv = levels[hit.part.id] || 0;
  // Comme la carte des 18 muscles : la bulle évite de couvrir un sous-muscle coloré (surface des boîtes à l'écran)
  const boxes = [...root.querySelectorAll('.body-map__p')].map(l => l.getBoundingClientRect());
  const cost = r => boxes.reduce((t, b) => t + Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left))
    * Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top)), 0);
  const tip = showBodyTip(atlasTipHtml(hit.part, lv), e.clientX, e.clientY, top ? null : root, { prefer, cost });
  if (top) tip.classList.add('btip--top');
  const layer = hit.fig.querySelector(`.body-map__p[data-part="${hit.part.id}"]`);
  hit.fig.insertAdjacentHTML('beforeend', atlasMarkHtml(kind, hit.view, hit.part.id, res(hit.view), bodyTipTint(layer)));
  bodyTipSetMark(hit.fig.lastElementChild?.classList.contains('body-map__hl') ? hit.fig.lastElementChild : null);
  haptic();
}

// ── Carte de la fiche : toucher, double toucher, deux doigts ─

let atlasLastTap = null;
function atlasTap(e, mapEl) {
  if (!e || (!e.clientX && !e.clientY)) return;
  const now = performance.now();
  const last = atlasLastTap;
  if (last && last.el === mapEl && now - last.t < ATLAS_DOUBLE_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < ATLAS_DOUBLE_PX) {
    atlasLastTap = null;
    closeBodyTip();
    openAtlasViewer(mapEl, { x: e.clientX, y: e.clientY, scale: ATLAS_ZOOM_TO });
    return;
  }
  atlasLastTap = { el: mapEl, t: now, x: e.clientX, y: e.clientY };
  atlasShowName(mapEl, bodyKind(mapEl.dataset.body), atlasLevels(mapEl), e, { prefer: ['under', 'outer'] });
}

if (typeof document !== 'undefined' && document.addEventListener) {
  // Deux doigts posés sur la carte : la vue agrandie s'ouvre (la carte refuse le zoom de la page : touch-action)
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) return;
    const maps = [...e.touches].map(t => t.target?.closest?.('.body-map--atlas[data-action="body-tap"]'));
    if (!maps[0] || maps[0] !== maps[1]) return;
    const [a, b] = e.touches;
    closeBodyTip();
    openAtlasViewer(maps[0], { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, scale: 2 });
  }, { passive: true });
}

// ── Vue agrandie ────────────────────────────────────────────

let atlasViewer = null;   // vue ouverte (une seule) : état du zoom, pour les tests (atlasViewerState)

function atlasFigHtml(kind, view, levels) {
  return `<span class="body-map__fig body-map__${view}" data-view="${view}"><img class="body-map__base" src="${body2Url(kind, view, 'base.webp')}" alt="" draggable="false" decoding="async"><span class="azoom__lay">${bodyAtlasLayersHtml(kind, view, levels, 1)}</span><img class="azoom__lines" alt="" draggable="false" decoding="async" hidden></span>`;
}

// Description pour VoiceOver : les sous-muscles colorés, principaux d'abord
function atlasA11yLabel(levels) {
  const names = lv => BODY_PARTS.parts.filter(p => levels[p.id] === lv).map(p => p.name);
  const main = names(2), sec = names(1);
  return [main.length && `Principaux : ${main.join(', ')}`, sec.length && `secondaires : ${sec.join(', ')}`].filter(Boolean).join(' ; ')
    || 'Personnage, aucun muscle coloré';
}

// from : { x, y, scale } point touché sur la carte de la fiche (zoom sur ce point), ou null (×1)
function openAtlasViewer(mapEl, from = null) {
  if (atlasViewer || !mapEl?.isConnected) return;
  const kind = bodyKind(mapEl.dataset.body), levels = atlasLevels(mapEl);
  const row = mapEl.querySelector('.body-map__row')?.getBoundingClientRect();
  const at = from && row?.width ? { u: (from.x - row.left) / row.width, v: (from.y - row.top) / row.height, scale: from.scale } : null;
  const rowW = 2 + BODY_GAP;
  const body = `
    <div class="azoom" role="img" aria-label="${esc(atlasA11yLabel(levels))}" data-scale="1" data-hi="" data-lines="">
      <div class="azoom__stage body-map body-map--atlas" data-body="${kind}">
        <span class="body-map__row" style="--fig:${Math.round(10000 / rowW) / 100}%">${['front', 'back'].map(v => atlasFigHtml(kind, v, levels)).join('')}</span>
      </div>
    </div>
    <p class="azoom__hint">Pince ou touche deux fois pour zoomer. Touche un muscle pour son nom.</p>`;
  const done = sheet({ title: mapEl.dataset.title || 'Muscles', cancel: '', confirm: 'OK', body });
  const roots = document.querySelectorAll('.sheet-root');
  const root = roots[roots.length - 1];
  const view = root?.querySelector('.azoom');
  if (!view) return;
  root.classList.add('sheet-root--atlas');
  atlasViewer = atlasZoom(view, kind, levels, at);
  done.then(() => { atlasViewer?.destroy(); atlasViewer = null; closeBodyTip(); });
}

// État de la vue agrandie (tests) : { scale, hi, lines } ou null
function atlasViewerState() {
  return atlasViewer ? { scale: atlasViewer.scale(), hi: atlasViewer.hi(), lines: atlasViewer.lines() } : null;
}

// Zoom, déplacement et noms dans la vue agrandie
function atlasZoom(view, kind, levels, at) {
  const stage = view.querySelector('.azoom__stage');
  const figs = { front: stage.querySelector('.body-map__front'), back: stage.querySelector('.body-map__back') };
  const ratio = (2 + BODY_GAP) * BODY_PARTS.w / BODY_PARTS.h;
  let W = 0, H = 0, s = 1, x = 0, y = 0, raf = 0;
  let hiView = '', hiWant = '', linesOn = false, alive = true;

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
  }
  function frame() { if (!raf) raf = requestAnimationFrame(apply); }
  function zoomAt(px, py, s2) {
    const k = Math.min(ATLAS_MAX, Math.max(1, s2)) / s;
    x = px - (px - x) * k; y = py - (py - y) * k; s *= k;
    clamp();
  }

  // Vue (face ou dos) au centre de l'écran : celle qui reçoit le 3×
  function centerView() {
    const u = (viewRect().w / 2 - x) / (W * s);
    return u < 0.5 ? 'front' : 'back';
  }
  function toLow(v) {
    const f = figs[v];
    f.querySelector('.body-map__base').src = body2Url(kind, v, 'base.webp');
    f.querySelector('.azoom__lay').innerHTML = bodyAtlasLayersHtml(kind, v, levels, 1);
    const ln = f.querySelector('.azoom__lines');
    ln.hidden = true; ln.removeAttribute('src');
    f.querySelector('.body-map__hl')?.remove();
  }
  function toHi(v) {
    hiWant = v;
    const urls = [body2Url(kind, v, 'base@3x.webp'),
      ...BODY_PARTS.parts.filter(p => levels[p.id] > 0 && BODY_PARTS.boxes[kind]?.[v]?.[p.id]).map(p => body2Url(kind, v, `p3/${p.id}.webp`))];
    // Affiché seulement une fois décodé : sinon un muscle clignoterait sans couleur
    Promise.all(urls.map(u => { const im = new Image(); im.src = u; return im.decode().catch(() => {}); })).then(() => {
      if (!alive || hiWant !== v) return;
      if (hiView && hiView !== v) toLow(hiView);
      const f = figs[v];
      f.querySelector('.body-map__base').src = urls[0];
      f.querySelector('.azoom__lay').innerHTML = bodyAtlasLayersHtml(kind, v, levels, 3);
      f.querySelector('.body-map__hl')?.remove();
      hiView = v; view.dataset.hi = v;
      detail();
    });
  }
  function detail() {
    if (s >= ATLAS_HI_AT * 0.9) {
      const v = centerView();
      if (v !== hiWant) {
        // Une seule vue 3× : l'ancienne repasse au 1× avant que la nouvelle ne se charge
        if (hiView) { toLow(hiView); hiView = ''; view.dataset.hi = ''; linesOn = false; view.dataset.lines = ''; }
        toHi(v);
      }
    }
    const want = hiView && s >= ATLAS_LINES_AT;
    if (!!want !== linesOn) {
      const ln = figs[hiView || 'front'].querySelector('.azoom__lines');
      if (want) ln.src = body2Url(kind, hiView, 'lines@3x.webp');
      ln.hidden = !want;
      linesOn = !!want; view.dataset.lines = want ? hiView : '';
    }
  }

  // ── Gestes (Pointer Events) ──
  const pts = new Map();
  let start = null, moved = false, lastTap = null;
  const local = e => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function snapshot() {
    const a = [...pts.values()];
    const c = a.length > 1 ? { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 } : a[0];
    const d = a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
    return { c, d, s, x, y };
  }
  function down(e) {
    try { view.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique (tests) */ }
    pts.set(e.pointerId, local(e));
    stage.classList.remove('azoom__stage--anim');
    start = snapshot();
    moved = pts.size > 1;
  }
  function move(e) {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    const now = snapshot();
    if (pts.size > 1 && start.d > 0) {
      const s2 = Math.min(ATLAS_MAX * 1.15, Math.max(0.85, start.s * now.d / start.d));
      const k = s2 / start.s;
      s = s2; x = now.c.x - (start.c.x - start.x) * k; y = now.c.y - (start.c.y - start.y) * k;
    } else {
      const dx = now.c.x - start.c.x, dy = now.c.y - start.c.y;
      if (!moved && Math.hypot(dx, dy) > 8) moved = true;
      if (!moved) return;
      x = start.x + dx; y = start.y + dy;
    }
    closeBodyTip();
    frame();
  }
  function up(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size) { start = snapshot(); return; }
    if (!moved && e.type === 'pointerup') { tap(e); return; }
    if (!reduceMotion.matches) stage.classList.add('azoom__stage--anim');
    clamp(); frame();
  }
  function tap(e) {
    const p = local(e), t = performance.now();
    if (lastTap && t - lastTap.t < ATLAS_DOUBLE_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < ATLAS_DOUBLE_PX) {
      lastTap = null;
      closeBodyTip();
      if (!reduceMotion.matches) stage.classList.add('azoom__stage--anim');
      zoomAt(p.x, p.y, s > 1.3 ? 1 : ATLAS_ZOOM_TO);
      frame();
      return;
    }
    lastTap = { t, ...p };
    atlasShowName(stage, kind, levels, e, { res: v => (v === hiView ? 3 : 1), top: true });
  }
  view.addEventListener('pointerdown', down);
  view.addEventListener('pointermove', move);
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', up);
  const onResize = () => { layout(); clamp(); frame(); };
  window.addEventListener('resize', onResize);

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
    destroy() { alive = false; window.removeEventListener('resize', onResize); if (raf) cancelAnimationFrame(raf); },
  };
}
