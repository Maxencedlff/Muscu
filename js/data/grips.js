// ═══════════════════════════════════════════════════════════
//  Prise d'un exercice : sens des mains, largeur, poignée (décisions : docs/PRISES.md)
//  Donnée seule : réglée dans Programme › Exercice et pendant la séance (js/features/grip-ui.js)
// ═══════════════════════════════════════════════════════════
//
// Un exercice du programme peut porter grip = { hand?, width?, tool? } (champ additif, ignoré par une
// version précédente). La prise est une indication de la même famille d'exercice : elle ne change ni
// l'identifiant (exId), ni les records, ni « Avant ». Elle suit la séance, l'historique et le programme
// envoyé par un coach. Proposée seulement aux mouvements où elle compte (GRIP_FAMILIES), et seulement
// pour ce que le nom ne dit pas déjà (« Tirage vertical prise serrée » : la largeur est dans le nom).
'use strict';

// Choix possibles de chaque réglage : [valeur, libellé du bouton, texte dans la phrase]
const GRIP_HAND = [
  ['pronation', 'Pronation', 'en pronation'], ['supination', 'Supination', 'en supination'],
  ['neutre', 'Neutre', 'neutre'], ['mixte', 'Mixte', 'mixte'], ['crochet', 'Crochet', 'en crochet'],
];
const GRIP_WIDTH = [['serree', 'Serrée', 'serrée'], ['moyenne', 'Moyenne', 'moyenne'], ['large', 'Large', 'large']];
const GRIP_TOOL = [
  ['barre', 'Barre droite'], ['ez', 'Barre EZ'], ['triangle', 'Triangle'], ['poignees', 'Deux poignées'],
  ['corde', 'Corde'], ['v', 'Barre en V'],
];
const GRIP_DIMS = { hand: GRIP_HAND, width: GRIP_WIDTH, tool: GRIP_TOOL };

// Familles, dans l'ordre de reconnaissance (sur ruleKey : minuscules, sans accents). La première qui
// correspond l'emporte : triceps et curl AVANT les tirages (« Extension triceps poulie haute », « Curl
// poulie basse » ne sont pas des tirages). NO_GRIP_RE écarte d'abord les mouvements dont le nom trompe
// (curl ischios, tirage bras tendus, rowing menton, écartés et élévations à la poulie, rameur…).
// « Poulie haute » ou « poulie basse » seuls (alias courants) : tirage vertical ou horizontal, seulement
// sans autre mot de mouvement.
const NO_GRIP_RE = /bras tendus|straight arm|pull ?over|rowing menton|upright row|face pull|rameur|\bleg curl|curl (ischio|jambe|femoral|nordique|poignet)|nordic|wrist|lombaire|arnold|ecarte|\bfly|flye|crossover|elevation|kickback|oiseau|pec deck|butterfly/;
const GRIP_FAMILIES = [
  { id: 'triceps', re: /pushdown|push down|(triceps|extension).*(poulie|corde|cable)/, hand: ['pronation', 'supination'], tool: ['barre', 'v', 'corde'] },
  { id: 'curl', re: /\bcurl/, hand: ['supination', 'neutre', 'pronation'], width: ['serree', 'large'], tool: ['barre', 'ez', 'corde', 'poignees'] },
  { id: 'pulldown', re: /tirage vertical|pulldown|pull down|tirage (poitrine|nuque)|^(tirage )?poulie haute$/,
    hand: ['pronation', 'supination', 'neutre'], width: ['serree', 'moyenne', 'large'], tool: ['barre', 'triangle', 'poignees'] },
  { id: 'pullup', re: /traction|pull ?ups?\b|chin ?ups?\b/,
    hand: ['pronation', 'supination', 'neutre'], width: ['serree', 'moyenne', 'large'] },
  { id: 'cable-row', re: /tirage horizontal|seated row|cable row|rowing (assis|poulie)|tirage assis|^(tirage )?poulie basse$/,
    hand: ['neutre', 'pronation', 'supination'], width: ['serree', 'large'], tool: ['triangle', 'barre', 'poignees', 'corde'] },
  { id: 'row', re: /rowing|\brows?\b/, hand: ['pronation', 'supination', 'neutre'], width: ['serree', 'large'] },
  { id: 'press', re: /developpe|bench press|chest press|overhead press|\bohp\b|shoulder press/,
    hand: ['pronation', 'neutre'], width: ['serree', 'moyenne', 'large'] },
  { id: 'deadlift', re: /souleve de terre|deadlift|rack pull/, hand: ['pronation', 'mixte', 'crochet'] },
];
// Ce que le nom fixe déjà, ou ce qui n'a pas de sens avec ce matériel
const HAND_IN_NAME_RE  = /pronation|supination|neutre|marteau|hammer|inverse|reverse|chin ?up|corde|rope/;
const WIDTH_IN_NAME_RE = /serre|large|close grip|wide grip|narrow/;
const ONE_HAND_RE      = /halter|dumbbell|\bdb\b|kettlebell|unilateral|un bras|une main|single arm|elastique|\bband\b/;
const BAR_RE           = /barre|barbell|smith|\bez\b/;
const CABLE_RE         = /poulie|cable|vis a vis/;

// Réglages proposés pour un exercice : { family, hand?: [...], width?: [...], tool?: [...] }, ou null
// (répétitions seulement : ni maintien, ni cardio)
function gripOptionsFor(exLike) {
  if (!exLike?.name || (typeof measureOf === 'function' && measureOf(exLike) !== 'reps')) return null;
  const k = typeof ruleKey === 'function' ? ruleKey(exLike.name) : normName(exLike.name);
  if (NO_GRIP_RE.test(k)) return null;
  const f = GRIP_FAMILIES.find(x => x.re.test(k));
  if (!f) return null;
  const o = { family: f.id };
  if (f.hand && !HAND_IN_NAME_RE.test(k)) o.hand = f.hand;
  // Largeur : à la barre seulement (les tractions avec élastique restent à la barre)
  if (f.width && !WIDTH_IN_NAME_RE.test(k) && (f.id === 'pullup' || !ONE_HAND_RE.test(k))) o.width = f.width;
  if (f.tool && !/corde|rope|triangle/.test(k)) o.tool = f.tool;
  // Matériel : la poignée se choisit au câble ; au curl barre, seule la barre (droite ou EZ) ; développé
  // à la barre (nom sans haltères ni machine), les mains sont forcément en pronation
  if (f.id === 'curl') {
    if (CABLE_RE.test(k)) delete o.width;
    else if (BAR_RE.test(k)) { o.tool = ['barre', 'ez']; if (o.hand) o.hand = ['supination', 'pronation']; }
    else { delete o.tool; delete o.width; }
  }
  if (f.id === 'press' && !ONE_HAND_RE.test(k) && !/machine|chest press/.test(k)) delete o.hand;
  if (f.id === 'press' && /machine|chest press/.test(k)) delete o.width;   // poignées fixes de la machine
  if (f.id === 'deadlift' && ONE_HAND_RE.test(k)) delete o.hand;
  if (f.id === 'triceps' && /corde|rope/.test(k)) delete o.hand;
  // Rien qui contredise le nom (panel du 07/11 : « Tirage vertical prise large » + « Prise neutre · Deux
  // poignées ») : une prise large se tient à la barre, mains en pronation ou en supination (triangle,
  // deux poignées et corde rapprochent les mains, paumes face à face) ; un nom en pronation ou en
  // supination exclut le triangle et la corde, toujours neutres
  if (WIDE_IN_NAME_RE.test(k)) { gripKeep(o, 'hand', h => h !== 'neutre'); gripKeep(o, 'tool', t => !NEUTRAL_TOOLS.includes(t) && t !== 'poignees'); }
  if (/pronation|supination|reverse|inverse|chin ?up/.test(k)) gripKeep(o, 'tool', t => !NEUTRAL_TOOLS.includes(t));
  if (o.tool?.length === 1 && o.tool[0] === 'barre') delete o.tool;   // la barre seule n'est pas un choix
  return o.hand || o.width || o.tool ? o : null;
}
const WIDE_IN_NAME_RE = /large|wide grip/;
const NEUTRAL_TOOLS = ['triangle', 'corde'];
// Garde les choix d'un réglage qui passent le filtre ; le réglage disparaît s'il n'en reste aucun
function gripKeep(o, dim, keep) {
  if (!o[dim]) return;
  o[dim] = o[dim].filter(keep);
  if (!o[dim].length) delete o[dim];
}

// Prise nettoyée : seules les valeurs connues sont gardées ; null s'il n'en reste aucune.
// Sans nom, toutes les valeurs connues ; avec un nom, seulement celles proposées pour lui.
function cleanGrip(g, exLike = null) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
  const opts = exLike ? gripOptionsFor(exLike) : null;
  const out = {};
  Object.entries(GRIP_DIMS).forEach(([dim, list]) => {
    const v = g[dim];
    if (typeof v !== 'string' || !list.some(c => c[0] === v)) return;
    if (exLike && !opts?.[dim]?.includes(v)) return;
    out[dim] = v;
  });
  return Object.keys(out).length ? out : null;
}

function sameGrip(a, b) {
  const x = cleanGrip(a), y = cleanGrip(b);
  return ['hand', 'width', 'tool'].every(d => (x?.[d] ?? null) === (y?.[d] ?? null));
}

// « Prise serrée neutre · Triangle », « Prise en supination », « Deux poignées » ; '' sans prise.
// Texte fait de libellés fixes : sûr dans un gabarit HTML.
function gripText(g, exLike = null) {
  const c = cleanGrip(g, exLike);
  if (!c) return '';
  const word = (list, v) => list.find(x => x[0] === v);
  const hand = c.hand ? word(GRIP_HAND, c.hand)[2] : '', width = c.width ? word(GRIP_WIDTH, c.width)[2] : '';
  const prise = hand || width ? `Prise ${[width, hand].filter(Boolean).join(' ')}` : '';
  const tool = c.tool ? word(GRIP_TOOL, c.tool)[1] : '';
  return [prise, tool].filter(Boolean).join(' · ');
}

// Photo d'une prise, fournie plus tard par les coachs partenaires : { 'pulldown/hand-neutre': 'img/prises/…webp' }.
// Vide pour l'instant : aucune image (ni cadre vide) n'est affichée tant qu'il n'y en a pas.
const GRIP_PHOTOS = {};
function gripPhoto(exLike, g) {
  const opts = gripOptionsFor(exLike), c = cleanGrip(g, exLike);
  if (!opts || !c) return null;
  for (const dim of ['tool', 'hand', 'width']) {
    const url = c[dim] && GRIP_PHOTOS[`${opts.family}/${dim}-${c[dim]}`];
    if (url) return url;
  }
  return null;
}
