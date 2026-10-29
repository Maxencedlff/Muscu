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

// Place de la bulle (w × h) pour un doigt en (x, y). Ordre de préférence : à côté du muscle (du côté
// le plus large de l'écran), puis en dessous, puis au-dessus ; la première place qui tient entre minTop
// et maxBottom (barre de navigation, barre d'onglets), à margin des bords, sans couvrir aucun rectangle
// de avoid (sélecteur de période). Sinon : en dessous, ramenée dans l'écran.
// side : côté de la bulle par rapport au doigt ; arrow : position de la pointe le long du bord concerné
function bodyTipPlace({ x, y, w, h, vw, minTop, maxBottom, avoid = [], margin = 8, gap = 14 }) {
  const clampX = l => Math.max(margin, Math.min(vw - margin - w, l));
  const clampY = t => Math.max(minTop, Math.min(maxBottom - h, t));
  const sides = vw - x >= x ? ['right', 'left'] : ['left', 'right'];
  // À côté : centrée sur le doigt, puis descendue sous un rectangle à éviter qu'elle chevaucherait,
  // tant que sa flèche peut encore viser le doigt (14 points du coin au moins)
  const beside = left => {
    let top = clampY(y - h / 2);
    for (const r of avoid) if (left < r.right && left + w > r.left && top < r.bottom && top + h > r.top) top = r.bottom + margin;
    return { left, top: y - top >= 14 ? top : -Infinity };
  };
  const at = {
    right: () => beside(x + gap),
    left:  () => beside(x - gap - w),
    below: () => ({ left: clampX(x - w / 2), top: y + gap }),
    above: () => ({ left: clampX(x - w / 2), top: y - gap - h }),
  };
  const fits = ({ left, top }) => left >= margin && left + w <= vw - margin && top >= minTop && top + h <= maxBottom
    && !avoid.some(r => left < r.right && left + w > r.left && top < r.bottom && top + h > r.top);
  let side = [...sides, 'below', 'above'].find(s => fits(at[s]()));
  let p = side ? at[side]() : null;
  if (!p) { side = 'below'; p = at.below(); p.top = clampY(p.top); }
  const arrow = side === 'left' || side === 'right' ? Math.max(14, Math.min(h - 14, y - p.top)) : Math.max(16, Math.min(w - 16, x - p.left));
  return { left: Math.round(p.left), top: Math.round(p.top), side, arrow: Math.round(arrow) };
}

let bodyTipEl = null;
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
  bodyTipEl = bodyTipAnchor = null;
}

// Ouvre la bulle près du doigt. html : contenu (dont un titre #btipTitle, nom de la bulle pour VoiceOver).
// anchor : élément touché, dont le déplacement à l'écran (défilement) ferme la bulle
function showBodyTip(html, x, y, anchor = null) {
  closeBodyTip();
  const el = document.createElement('div');
  el.className = 'btip';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', 'btipTitle');
  el.innerHTML = `${html}<i class="btip__arrow" aria-hidden="true"></i>`;
  document.body.appendChild(el);
  const p = bodyTipPlace({ x, y, w: el.offsetWidth, h: el.offsetHeight, vw: document.documentElement.clientWidth,
    ...bodyTipBounds(anchor), avoid: bodyTipAvoid(anchor) });
  el.style.left = `${p.left}px`; el.style.top = `${p.top}px`;
  el.style.setProperty('--arrow', `${p.arrow}px`);
  el.classList.add(`btip--${p.side}`);
  bodyTipEl = el;
  bodyTipAnchor = anchor ? { el: anchor, top: anchor.getBoundingClientRect().top } : null;
  return el;
}

// Touche une carte (.body-map) : muscle sous le doigt, puis bulle de contenu(muscle, carte), ou
// fermeture hors d'un muscle. Un clic clavier (sans position) ne fait rien : VoiceOver lit la liste.
async function bodyTipTap(e, mapEl, content) {
  if (!e || (!e.clientX && !e.clientY)) return;
  const seq = ++bodyTipSeq;
  const hit = await bodyMuscleAt(mapEl, e.clientX, e.clientY);
  if (seq !== bodyTipSeq || !mapEl.isConnected) return;
  if (!hit) { closeBodyTip(); return; }
  showBodyTip(content(hit.muscle, mapEl), e.clientX, e.clientY, mapEl);
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
