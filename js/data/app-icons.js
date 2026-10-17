'use strict';

// ═══════════════════════════════════════════════════════════
//  Icônes de l'app : catalogue et dessin du signe
// ═══════════════════════════════════════════════════════════
//
// Seule source de l'identité visuelle : le signe (un « M » dessiné comme une barre chargée vue de
// face : les disques forment les jambages, la barre qui fléchit forme le V) et ses déclinaisons.
// - L'écran Réglages (app iOS) dessine ses vignettes avec appIconSvg().
// - scripts/brand-icons.py lit ce fichier (par Node) pour produire toutes les images : icônes de la
//   PWA, AppIcon iOS (clair, sombre, teinté), icônes alternatives, écran de démarrage, marque de la
//   Live Activity. Changer une couleur ici, puis relancer le script.
//
// Style « aplat » : une forme, deux couleurs, aucun dégradé, reflet ni ombre. Les couleurs sont
// celles des images de la marque, pas de l'interface : elles n'ont pas leur place dans les tokens.
//
// `asset` est le nom du jeu d'icônes dans ios/App/App/Assets.xcassets ; l'icône par défaut
// (AppIcon) correspond au nom natif null de UIApplication.alternateIconName.

const APP_ICON_DEFAULT_ASSET = 'AppIcon';

const APP_ICONS = Object.freeze([
  { id: 'orange',    label: 'Orange',         asset: 'AppIcon',           bg: '#111111', fg: '#FF6A1A', sag: 360, stroke: 70 },
  { id: 'rouille',   label: 'Fonte rouillée', asset: 'AppIcon-Rouille',   bg: '#1B1815', fg: '#D9542B', sag: 360, stroke: 70 },
  { id: 'inversee',  label: 'Inversée',       asset: 'AppIcon-Inversee',  bg: '#FF5A1F', fg: '#111111', sag: 360, stroke: 70 },
  { id: 'craie',     label: 'Craie',          asset: 'AppIcon-Craie',     bg: '#F1ECE3', fg: '#C9461F', sag: 360, stroke: 70 },
  { id: 'signature', label: 'Signature',      asset: 'AppIcon-Signature', bg: '#E0582A', fg: '#15120F', sag: 430, stroke: 58 },
].map(Object.freeze));

const DEFAULT_APP_ICON = APP_ICONS.find(i => i.asset === APP_ICON_DEFAULT_ASSET);

// Icône du catalogue correspondant au nom natif (null ou inconnu : l'icône par défaut)
function appIconFromNative(name) {
  return APP_ICONS.find(i => i.asset === name && name !== APP_ICON_DEFAULT_ASSET) || DEFAULT_APP_ICON;
}

// Nom natif à passer à setAlternateIconName : null pour l'icône par défaut, undefined si inconnue
function nativeAppIconName(id) {
  const icon = APP_ICONS.find(i => i.id === id);
  if (!icon) return undefined;
  return icon === DEFAULT_APP_ICON ? null : icon.asset;
}

// Noms des icônes alternatives (ASSETCATALOG_COMPILER_ALTERNATE_APP_ICON_NAMES du projet Xcode)
function alternateAppIconNames() {
  return APP_ICONS.filter(i => i !== DEFAULT_APP_ICON).map(i => i.asset);
}

// ── Dessin ──────────────────────────────────────────────────
// Repère 1024 × 1024. Disques : 120 × 460 (intérieurs), 54 × 300 (extérieurs) ; la barre part du
// haut des disques intérieurs et fléchit de `sag` au centre. `scale` réduit le signe autour du
// centre (0,8 : marge de l'icône ; plus petit pour une zone sûre « maskable »).

const r2 = v => Math.round(v * 100) / 100;

function appIconGlyph(color, { sag = 360, stroke = 70, scale = 0.8 } = {}) {
  const PLATE = 120, CY = 520, LEFT = 262, RIGHT = 762;
  const rect = (x, y, w, h, r) => `<rect x="${r2(x)}" y="${r2(y)}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`;
  const top = r2(CY - 230 + stroke * 0.9);
  const mid = r2(top + sag * 0.6), low = r2(top + sag);
  return `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">`
    + rect(LEFT - PLATE, CY - 230, PLATE, 460, 50)
    + rect(RIGHT, CY - 230, PLATE, 460, 50)
    + rect(LEFT - PLATE - 68, CY - 150, 54, 300, 27)
    + rect(RIGHT + PLATE + 14, CY - 150, 54, 300, 27)
    + `<path d="M${r2(LEFT - PLATE / 2)} ${top} Q382 ${mid} 512 ${low} Q642 ${mid} ${r2(RIGHT + PLATE / 2)} ${top}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`
    + '</g>';
}

// SVG complet d'une icône. background : couleur du fond (false : transparent) ; color : couleur
// du signe (par défaut celle du catalogue) ; attrs : attributs ajoutés à la balise <svg>.
function appIconSvg(icon, { background = icon.bg, color = icon.fg, scale = 0.8, attrs = '' } = {}) {
  const bg = background ? `<rect width="1024" height="1024" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"${attrs ? ' ' + attrs : ''}>${bg}`
    + appIconGlyph(color, { sag: icon.sag, stroke: icon.stroke, scale }) + '</svg>';
}
