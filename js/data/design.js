'use strict';

// ═══════════════════════════════════════════════════════════
//  Réglages › Apparence › Design : la couleur d'accent de l'app
// ═══════════════════════════════════════════════════════════
//
// Deux choix (panel « orange » du 25/11) : « Orange » (par défaut, orange brique #B8460F à texte blanc,
// liens #F27A45) et « Bleu » (accent bleu système, #0A6CDB / #0066CC à texte blanc). Les couleurs sont
// dans css/theme-sobre.css (classe body.design-bleu) : ici, seulement le choix.
//
// data.design = { accent, at } : réglage explicite et daté, comme « Défis dans les récaps » (defisRecap,
// js/data/defis.js). Absent = Orange. D'un appareil à l'autre, le choix le plus récent gagne (mergeDesign,
// js/data/sync.js) ; un compte sans la clé (appareil resté sur une version d'avant) ne l'efface pas ici.

const DESIGN_ACCENTS = Object.freeze(['orange', 'bleu']);
const DESIGN_DEFAULT = 'orange';

function cleanDesign(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && DESIGN_ACCENTS.includes(v.accent) && Number.isFinite(v.at) && v.at > 0
    ? { accent: v.accent, at: Math.round(v.at) } : undefined;
}
function designAccent(d) { return cleanDesign(d?.design)?.accent || DESIGN_DEFAULT; }
// Le plus récent gagne ; à égalité, l'orange (le défaut) pour que deux appareils tombent d'accord
function mergeDesign(a, b) {
  const x = cleanDesign(a), y = cleanDesign(b);
  if (!x || !y) return x || y;
  if (y.at !== x.at) return y.at > x.at ? y : x;
  return x.accent === DESIGN_DEFAULT ? x : y;
}
// Appelé par sanitizeData
function sanitizeDesign(d) {
  if (d.design !== undefined) { const v = cleanDesign(d.design); if (v) d.design = v; else delete d.design; }
  return d;
}
// Design de l'app en cours (data de js/data/store.js ; absent, dans un outil qui ne charge pas la donnée : l'orange)
function currentDesignAccent() { return typeof data === 'undefined' ? DESIGN_DEFAULT : designAccent(data); }
// Classe du design sur body (css/theme-sobre.css) ; appelée au démarrage et à chaque dessin d'écran (js/ui/router.js) :
// un choix reçu d'un autre appareil s'applique au premier redessin
function applyDesign() {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.classList.toggle('design-bleu', currentDesignAccent() === 'bleu');
}
