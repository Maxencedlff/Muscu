// ═══════════════════════════════════════════════════════════
//  Tempo d'un exercice : notation, lecture, sens de départ
// ═══════════════════════════════════════════════════════════
'use strict';

// Notation de Poliquin, toujours dans cet ordre : excentrique (le muscle s'allonge : on descend la
// barre), pause en bas, concentrique (on pousse ou on tire), pause en haut. « X » = aussi vite que
// possible (guidé comme 1 s). « 3-1-1 » se lit « 3-1-1-0 ». Chaque phase de 0 à 10 s.
const TEMPO_PRESETS = [
  { tempo: '2-0-1-0', label: 'Contrôlé' },
  { tempo: '3-1-1-0', label: 'Lent' },
  { tempo: '4-0-1-0', label: 'Très lent' },
  { tempo: '2-0-X-0', label: 'Explosif' },
];

// [ecc, pause bas, con, pause haut] en secondes (X → 'X'), ou null si illisible.
// Accepte « 3-1-1 », « 3 1 1 0 », « 31X0 », « 3/1/x/0 ».
function parseTempo(str) {
  const s = String(str ?? '').trim().toUpperCase();
  if (!s) return null;
  const parts = /^[0-9X]{3,4}$/.test(s) ? s.split('') : s.split(/[\s\-/.,]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const vals = parts.map(p => p === 'X' ? 'X' : (/^\d{1,2}$/.test(p) && +p <= 10 ? +p : NaN));
  if (vals.some(v => v !== 'X' && !Number.isFinite(v))) return null;
  if (vals.length === 3) vals.push(0);
  if (vals.every(v => v === 0)) return null;
  return vals;
}
function formatTempo(t) { return t ? t.join('-') : ''; }
// Série guidée : temps pour s'installer (sur le banc, la barre décrochée) avant la première rep
const TEMPO_PREP_CHOICES = [5, 10, 20, 30], TEMPO_PREP_DEFAULT = 10;
function tempoPrepOf(ex) { const v = Number(ex?.tempoPrep); return TEMPO_PREP_CHOICES.includes(v) ? v : TEMPO_PREP_DEFAULT; }
// Affichage : « 3-1-1 » quand il n'y a pas de pause en haut (écriture usuelle), sinon les 4 phases
function shortTempo(str) { const t = parseTempo(str); return !t ? '' : (t[3] === 0 ? t.slice(0, 3) : t).join('-'); }
// Durée guidée d'une phase (X : 1 s) et d'une répétition
const tempoSecs = v => v === 'X' ? 1 : v;
function tempoRepSeconds(t) { return t.reduce((a, v) => a + tempoSecs(v), 0); }

// Les tirages, curls, soulevés et extensions commencent par la phase concentrique (on part bras ou
// jambes tendus et on tire) ; les développés, squats, pompes et dips commencent par la descente.
const ECCENTRIC_FIRST_RE = /developpe|press|bench|pompe|push ?up|\bdips?\b|squat|fente|lunge|bulgare|roumain|rdl|jambes tendues|good morning|ecarte|pec deck|butterfly|vis a vis|crossover|pull ?over|barre au front|skull|extension (triceps )?(nuque|couche)|pistol/;
// Exception : au-dessus de la tête (militaire, épaules, Arnold), la barre part des épaules, on pousse d'abord
const OVERHEAD_RE = /militaire|epaule|overhead|shoulder|arnold|\bdm\b/;
function concentricFirst(name) { const k = ruleKey(name || ''); return OVERHEAD_RE.test(k) || !ECCENTRIC_FIRST_RE.test(k); }

// Phrase d'aide : « 3 s pour descendre, 1 s en bas, 1 s pour remonter »
function tempoSentence(t, name = '') {
  if (!t) return '';
  const pull = concentricFirst(name);
  const sec = v => v === 'X' ? 'le plus vite possible' : `${v} s`;
  const parts = [
    `${sec(t[0])} pour ${pull ? 'revenir' : 'descendre'}`,
    t[1] ? `${t[1]} s ${pull ? 'bras ou jambes tendus' : 'en bas'}` : '',
    `${sec(t[2])} pour ${pull ? 'tirer' : 'remonter'}`,
    t[3] ? `${t[3]} s ${pull ? 'contracté' : 'en haut'}` : '',
  ].filter(Boolean);
  return parts.join(', ').replace(/^./, c => c.toUpperCase());
}
