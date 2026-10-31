// ═══════════════════════════════════════════════════════════
//  Carte des muscles : muscle sous le doigt et bulle d'information
// ═══════════════════════════════════════════════════════════
'use strict';

// Détection au pixel, d'après la transparence des calques (js/ui/body-map.js, BODY_IMG).
// Au premier toucher d'une vue (sexe × face/dos), ses calques sont dessinés une fois dans un petit
// canvas hors écran, à demi-résolution, et réduits à une carte d'étiquettes : un octet par point, le
// numéro du muscle le plus opaque à cet endroit (0 : aucun). Chaque toucher suivant n'est qu'une
// lecture dans ce tableau.
// Choisi plutôt qu'une carte pré-calculée livrée avec l'app : les calques restent la seule source
// (aucun fichier à régénérer quand le personnage est réexporté de Blender), aucun téléchargement en
// plus (images déjà en cache, bodyPreload), et le calcul ne coûte que quelques dizaines de ms, une
// fois par vue. La demi-résolution (194 × 420 points, 80 Ko par vue) reste plus fine que le doigt.

const BODY_HIT_SCALE = 0.5;     // résolution de la carte d'étiquettes par rapport aux images
const BODY_HIT_ALPHA = 64;      // opacité minimale (0..255) d'un calque pour compter comme « touché »
const BODY_HIT_TOL_PX = 8;      // tolérance autour du doigt, en points CSS (un doigt n'est pas une souris)

// Carte d'étiquettes à partir des alphas (un tableau par muscle, n points chacun) : pour chaque point,
// 1 + rang du muscle le plus opaque ; à égalité, le dernier (calque posé au-dessus dans la carte)
function bodyHitBuild(alphas, n, min = BODY_HIT_ALPHA) {
  const map = new Uint8Array(n), best = new Uint8Array(n);
  alphas.forEach((a, k) => {
    for (let i = 0; i < n; i++) {
      const v = a[i];
      if (v >= min && v >= best[i]) { best[i] = v; map[i] = k + 1; }
    }
  });
  return map;
}

// Rang (0..) du muscle au point (x, y) de la carte, sinon le plus proche dans un rayon r ; -1 : aucun
function bodyHitAt(map, w, h, x, y, r = 0) {
  const cx = Math.round(x), cy = Math.round(y);
  const at = (i, j) => (i >= 0 && j >= 0 && i < w && j < h ? map[j * w + i] : 0);
  if (at(cx, cy)) return at(cx, cy) - 1;
  let found = -1, bd = Infinity;
  const R = Math.max(0, Math.ceil(r));
  for (let j = cy - R; j <= cy + R; j++) {
    for (let i = cx - R; i <= cx + R; i++) {
      const d = (i - x) ** 2 + (j - y) ** 2;
      if (d > r * r || d >= bd) continue;
      const v = at(i, j);
      if (v) { bd = d; found = v - 1; }
    }
  }
  return found;
}

// Cartes déjà calculées, par « sexe/vue » (promesses : deux touchers rapides ne calculent qu'une fois)
const bodyHitMaps = new Map();
function bodyHitMap(kind, view) {
  const key = `${kind}/${view}`;
  if (!bodyHitMaps.has(key)) {
    bodyHitMaps.set(key, (async () => {
      const ids = BODY_IMG.bodies[kind][view];
      const w = Math.round(BODY_IMG.w * BODY_HIT_SCALE), h = Math.round(BODY_IMG.h * BODY_HIT_SCALE);
      const imgs = await Promise.all(ids.map(m => bodyLoadImage(bodyImgUrl(kind, view, m))));
      if (imgs.some(i => !i)) { bodyHitMaps.delete(key); return null; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      const alphas = imgs.map(img => {
        x.clearRect(0, 0, w, h);
        x.drawImage(img, 0, 0, w, h);
        const d = x.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
        for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
        return a;
      });
      return { ids, w, h, map: bodyHitBuild(alphas, w * h) };
    })());
  }
  return bodyHitMaps.get(key);
}

// Muscle touché dans une carte affichée (.body-map) au point (clientX, clientY) de l'écran :
// { muscle, view } ou null (fond, zone grise, écart entre les vues)
async function bodyMuscleAt(mapEl, clientX, clientY) {
  const kind = bodyKind(mapEl.dataset.body);
  for (const fig of mapEl.querySelectorAll('.body-map__fig')) {
    const r = fig.getBoundingClientRect();
    if (!r.width || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
    const view = fig.classList.contains('body-map__back') ? 'back' : 'front';
    const hit = await bodyHitMap(kind, view);
    if (!hit) return null;
    const sx = hit.w / r.width;
    const k = bodyHitAt(hit.map, hit.w, hit.h, (clientX - r.left) * sx, (clientY - r.top) * (hit.h / r.height), BODY_HIT_TOL_PX * sx);
    return k < 0 ? null : { muscle: hit.ids[k], view };
  }
  return null;
}

// ── Bulle ───────────────────────────────────────────────────

// Place de la bulle (w × h) pour un doigt en (x, y).
// Candidats, dans l'ordre de préférence : spots (places choisies par l'écran : marge extérieure, sous
// le personnage…), puis à côté du doigt (côté le plus large d'abord), dessous, dessus, puis une grille
// autour du doigt (la plus proche d'abord). Chacun est ramené
// dans l'écran (entre minTop et maxBottom, à margin des bords) et descendu sous un rectangle de avoid
// qu'il chevaucherait. Interdits : couvrir un rectangle de avoid (sélecteur de période) ou le doigt.
// Choix : le premier candidat qui ne couvre (presque) pas de muscle coloré (cost : surface colorée
// couverte, en points²), sinon celui qui en couvre le moins.
// side : 'above' | 'below' | 'left' | 'right' (flèche vers le doigt, arrow : sa position le long du
// bord) ou 'free' (bulle à l'écart du doigt, sans flèche)
function bodyTipPlace({ x, y, w, h, vw, minTop, maxBottom, avoid = [], spots = [], cost = () => 0, margin = 8, gap = 14 }) {
  const clampX = l => Math.max(margin, Math.min(vw - margin - w, l));
  const clampY = t => Math.max(minTop, Math.min(maxBottom - h, t));
  const hits = (p, r) => p.left < r.right && p.left + w > r.left && p.top < r.bottom && p.top + h > r.top;
  const finger = { left: x - gap + 2, right: x + gap - 2, top: y - gap + 2, bottom: y + gap - 2 };
  const settle = ({ left, top }) => {
    const p = { left: clampX(left), top: clampY(top) };
    for (const r of avoid) if (hits(p, r)) p.top = r.bottom + margin;
    return p;
  };
  const near = vw - x >= x ? [x + gap, x - gap - w] : [x - gap - w, x + gap];
  // Puis une grille autour du doigt (bords, centre), la plus proche d'abord : de quoi trouver une place
  // hors des muscles colorés quand les places habituelles en couvrent
  const grid = [];
  for (let top = y - gap - 1.5 * h; top <= y + gap + h / 2; top += 12) {
    for (const left of [margin, (vw - w) / 2, vw - margin - w, x - w / 2]) grid.push({ left, top });
  }
  const dist = p => Math.hypot(p.left + w / 2 - x, p.top + h / 2 - y);
  grid.sort((a, b) => dist(a) - dist(b));
  const cands = [...spots, ...near.map(left => ({ left, top: y - h / 2 })),
    { left: x - w / 2, top: y + gap }, { left: x - w / 2, top: y - gap - h }, ...grid].map(settle)
    .filter(p => p.left >= margin && p.left + w <= vw - margin && p.top >= minTop && p.top + h <= maxBottom
      && !avoid.some(r => hits(p, r)) && !hits(p, finger));
  const tol = 0.02 * w * h;
  const scored = cands.map(p => ({ p, c: cost({ left: p.left, top: p.top, right: p.left + w, bottom: p.top + h }) }));
  let best = scored.find(s => s.c <= tol) || scored.reduce((a, b) => (b.c < a.c ? b : a), scored[0]);
  if (!best) best = { p: { left: clampX(x - w / 2), top: clampY(y + gap) } };
  const { left, top } = best.p;
  // Flèche : seulement si la bulle borde le doigt (à moins de 3 fois l'écart) sur l'un de ses côtés
  const reach = 3 * gap;
  let side = 'free', arrow = 0;
  if (x >= left + 16 && x <= left + w - 16 && top >= y && top - y <= reach) { side = 'below'; arrow = x - left; }
  else if (x >= left + 16 && x <= left + w - 16 && top + h <= y && y - top - h <= reach) { side = 'above'; arrow = x - left; }
  else if (y >= top + 14 && y <= top + h - 14 && left >= x && left - x <= reach) { side = 'right'; arrow = y - top; }
  else if (y >= top + 14 && y <= top + h - 14 && left + w <= x && x - left - w <= reach) { side = 'left'; arrow = y - top; }
  return { left: Math.round(left), top: Math.round(top), side, arrow: Math.round(arrow) };
}

// Surface colorée (en points²) d'une carte affichée sous un rectangle de l'écran : muscles qui ont un
// calque dans la carte (palier > 0, principal ou secondaire), d'après les cartes d'étiquettes.
// Une table de sommes cumulées par vue rend chaque mesure immédiate.
async function bodyTipCoverage(mapEl) {
  const kind = bodyKind(mapEl.dataset.body);
  const parts = [];
  for (const fig of mapEl.querySelectorAll('.body-map__fig')) {
    const view = fig.classList.contains('body-map__back') ? 'back' : 'front';
    const hit = await bodyHitMap(kind, view);
    if (!hit) continue;
    const on = new Set([...fig.querySelectorAll('.body-map__m')].map(e => e.dataset.muscle));
    const colored = hit.ids.map(id => on.has(id));
    const W = hit.w + 1, sum = new Uint32Array(W * (hit.h + 1));
    for (let j = 0; j < hit.h; j++) {
      let row = 0;
      for (let i = 0; i < hit.w; i++) {
        const v = hit.map[j * hit.w + i];
        row += v && colored[v - 1] ? 1 : 0;
        sum[(j + 1) * W + i + 1] = sum[j * W + i + 1] + row;
      }
    }
    parts.push({ r: fig.getBoundingClientRect(), w: hit.w, h: hit.h, W, sum });
  }
  return rect => parts.reduce((total, { r, w, h, W, sum }) => {
    const sx = w / r.width, sy = h / r.height;
    const i0 = Math.max(0, Math.floor((rect.left - r.left) * sx)), i1 = Math.min(w, Math.ceil((rect.right - r.left) * sx));
    const j0 = Math.max(0, Math.floor((rect.top - r.top) * sy)), j1 = Math.min(h, Math.ceil((rect.bottom - r.top) * sy));
    if (i1 <= i0 || j1 <= j0) return total;
    const n = sum[j1 * W + i1] - sum[j0 * W + i1] - sum[j1 * W + i0] + sum[j0 * W + i0];
    return total + n / (sx * sy);
  }, 0);
}

// Places proposées par l'écran, en points de l'écran, à partir des boîtes de la carte touchée :
//   'outer'  marge extérieure de la vue touchée (à gauche de la face, à droite du dos), à hauteur du
//            doigt, puis en haut, puis en bas du personnage
//   'under'  sous le personnage (sur la légende ou au-dessus des pastilles), sous le doigt
function bodyTipSpots(mapEl, x, y, w, h, prefer) {
  const row = mapEl.querySelector('.body-map__row')?.getBoundingClientRect();
  if (!row) return [];
  const figs = [...mapEl.querySelectorAll('.body-map__fig')].map(f => ({ back: f.classList.contains('body-map__back'), r: f.getBoundingClientRect() }));
  const fig = figs.find(f => x >= f.r.left && x <= f.r.right) || figs[0];
  const outerLeft = fig.back && figs.length > 1 ? fig.r.right - w * 0.25 : fig.r.left - w * 0.75;
  const at = {
    outer: [y - h / 2, row.top, row.bottom - h].map(top => ({ left: outerLeft, top })),
    under: [{ left: x - w / 2, top: row.bottom + 4 }],
  };
  return prefer.flatMap(k => at[k] || []);
}

// Muscle touché mis en valeur pendant que sa bulle est ouverte : une copie opaque de son calque (même
// ombrage, sa couleur à l'écran ou blanc s'il n'est pas coloré), éclaircie et cernée d'un halo, posée
// au-dessus des autres dans la vue touchée (CSS : .body-map__hl). Opaque, pour que le halo ne se voie
// qu'autour du muscle, pas à travers. tint : couleur CSS déjà résolue (bodyTipTint)
function bodyTipMarkHtml(kind, view, muscle, tint = '#FFFFFF') {
  if (!BODY_IMG.bodies[kind]?.[view]?.includes(muscle)) return '';
  const url = `url(${bodyImgUrl(kind, view, muscle)})`;
  return `<span class="body-map__hl" data-muscle="${muscle}" aria-hidden="true"><i style="background-color:${esc(tint)};background-image:${url};-webkit-mask-image:${url};mask-image:${url}"></i></span>`;
}

// Couleur du muscle tel qu'il apparaît : celle de son calque mêlée de blanc selon son opacité (palier)
function bodyTipTint(layer) {
  if (!layer) return '#FFFFFF';
  const op = Math.round((parseFloat(layer.style.opacity) || 0) * 100);
  return `color-mix(in srgb, ${getComputedStyle(layer).backgroundColor} ${op}%, #FFFFFF)`;
}

let bodyTipEl = null;
let bodyTipMarkEl = null;      // mise en valeur du muscle touché (retirée à la fermeture)
let bodyTipAnchor = null;      // { el, top } : carte touchée et sa position à l'ouverture (fermeture au défilement)
let bodyTipSeq = 0;            // un toucher plus récent annule l'affichage d'un précédent encore en calcul

// Limites verticales : sous la barre de navigation de l'écran (sinon la zone sûre du haut), au-dessus de
// la barre d'onglets
function bodyTipBounds(anchor) {
  const nav = anchor?.closest('.view')?.querySelector('.navbar__bar');
  let top = nav ? nav.getBoundingClientRect().bottom : 0;
  if (!nav) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top,0px);visibility:hidden';
    document.body.appendChild(probe);
    top = probe.offsetHeight;
    probe.remove();
  }
  const bar = document.querySelector('.tabbar');
  const r = bar?.getBoundingClientRect();   // barre fixe : offsetParent toujours nul, on mesure sa boîte
  const barTop = r && r.height > 0 ? r.top : innerHeight;
  return { minTop: top + 8, maxBottom: Math.min(innerHeight, barTop) - 8 };
}

// À ne jamais couvrir : le sélecteur de période (et tout autre contrôle segmenté) du groupe de la carte
function bodyTipAvoid(anchor) {
  return [...(anchor?.closest('.group')?.querySelectorAll('.segmented') || [])].map(e => e.getBoundingClientRect());
}

function closeBodyTip() {
  bodyTipSeq++;
  bodyTipEl?.remove();
  bodyTipMarkEl?.remove();
  bodyTipEl = bodyTipAnchor = bodyTipMarkEl = null;
}

// Ouvre la bulle près du doigt. html : contenu (dont un titre #btipTitle, nom de la bulle pour VoiceOver).
// anchor : élément touché, dont le déplacement à l'écran (défilement) ferme la bulle
// place : { spots, cost } (bodyTipSpots, bodyTipCoverage), facultatif
function showBodyTip(html, x, y, anchor = null, place = {}) {
  closeBodyTip();
  const el = document.createElement('div');
  el.className = 'btip';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', 'btipTitle');
  el.innerHTML = `${html}<i class="btip__arrow" aria-hidden="true"></i>`;
  document.body.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  const p = bodyTipPlace({ x, y, w, h, vw: document.documentElement.clientWidth, ...bodyTipBounds(anchor), avoid: bodyTipAvoid(anchor),
    spots: place.prefer && anchor ? bodyTipSpots(anchor, x, y, w, h, place.prefer) : [], cost: place.cost });
  el.style.left = `${p.left}px`; el.style.top = `${p.top}px`;
  el.style.setProperty('--arrow', `${p.arrow}px`);
  el.classList.add(`btip--${p.side}`);
  bodyTipEl = el;
  bodyTipAnchor = anchor ? { el: anchor, top: anchor.getBoundingClientRect().top } : null;
  return el;
}

// Touche une carte (.body-map) : muscle sous le doigt, puis bulle de contenu(muscle, carte), ou
// fermeture hors d'un muscle. Un clic clavier (sans position) ne fait rien : VoiceOver lit la liste.
// prefer : places préférées de l'écran (bodyTipSpots), avant celles autour du doigt ; la bulle évite
// dans tous les cas de couvrir un muscle coloré quand une autre place existe
async function bodyTipTap(e, mapEl, content, prefer = []) {
  if (!e || (!e.clientX && !e.clientY)) return;
  const seq = ++bodyTipSeq;
  const hit = await bodyMuscleAt(mapEl, e.clientX, e.clientY);
  if (seq !== bodyTipSeq || !mapEl.isConnected) return;
  if (!hit) { closeBodyTip(); return; }
  const cost = await bodyTipCoverage(mapEl);
  if (seq !== bodyTipSeq || !mapEl.isConnected) return;
  showBodyTip(content(hit.muscle, mapEl), e.clientX, e.clientY, mapEl, { prefer, cost });
  const fig = mapEl.querySelector(`.body-map__${hit.view}`);
  if (fig) {
    const tint = bodyTipTint(fig.querySelector(`.body-map__m[data-muscle="${hit.muscle}"]`));
    fig.insertAdjacentHTML('beforeend', bodyTipMarkHtml(bodyKind(mapEl.dataset.body), hit.view, hit.muscle, tint));
    bodyTipMarkEl = fig.lastElementChild?.classList.contains('body-map__hl') ? fig.lastElementChild : null;
  }
  haptic();
}

// Défilement : seulement si la carte a vraiment bougé (un événement scroll tardif, fin d'élan ou
// défilement d'avant le toucher, arrive parfois juste après l'ouverture)
function bodyTipScrolled() {
  if (!bodyTipEl) return;
  const a = bodyTipAnchor;
  if (!a || !a.el.isConnected || Math.abs(a.el.getBoundingClientRect().top - a.top) > 3) closeBodyTip();
}

// Fermeture : toucher ailleurs (la bulle elle-même et la carte gèrent leurs touchers), défilement,
// rotation, passage en arrière-plan
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    // Seuls les vrais touchers : haptic() simule un clic (case « switch » de Safari) juste après l'ouverture
    if (!bodyTipEl || !e.isTrusted) return;
    const t = e.target;
    if (t.closest?.('.btip [data-action]')) { setTimeout(closeBodyTip, 0); return; }
    if (t.closest?.('.btip, [data-action="body-tap"]')) return;
    closeBodyTip();
  }, true);
  document.addEventListener('scroll', bodyTipScrolled, { capture: true, passive: true });
  window.addEventListener('resize', () => { if (bodyTipEl) closeBodyTip(); });
  document.addEventListener('visibilitychange', () => { if (bodyTipEl) closeBodyTip(); });
}
