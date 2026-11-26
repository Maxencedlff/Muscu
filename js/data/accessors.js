// ═══════════════════════════════════════════════════════════
//  Accès à la donnée : programme actif, séances, unités, séries
// ═══════════════════════════════════════════════════════════
'use strict';

// Programme affiché par les écrans de réglage (page du programme, séances, exercices) : l'actif, sauf quand on règle
// un autre programme sans l'utiliser (coach : le programme d'un élève, retours de Sophie du 26/11 : « le programme créé
// pour l'élève remplaçait le mien »). Le fournisseur est posé par la navigation (js/ui/router.js : la page
// « programmes:<id> » dans la pile de l'onglet affiché) ; tout ce qui sert l'entraînement du jour (séance, widget,
// montre, Siri, délais de récupération) passe par onActiveProgramme et ne voit jamais que l'actif.
let progFocusOf = null;     // () => identifiant de programme ou null (js/ui/router.js)
let progFocusOff = 0;       // > 0 : dans onActiveProgramme
function progFocusId() {
  const id = !progFocusOff && progFocusOf ? progFocusOf() : null;
  return id && progEditable(id) ? id : data.activeProgramme;
}
// Programme qu'on peut ouvrir dans sa page : intégré, ou créé et pas supprimé
function progEditable(id) {
  if (!id || id === FREE) return false;
  if (id === 'custom') return true;
  const up = data.userProgrammes?.[id];
  return up ? !up.archived : !!PROGRAMMES[id];
}
// fn exécuté sur le programme actif, quel que soit le programme affiché
function onActiveProgramme(fn) {
  progFocusOff++;
  try { return fn(); } finally { progFocusOff--; }
}

function prog() {
  const id = progFocusId();
  if (!data.programmes[id]) {
    data.programmes[id] = { exercises: {}, timers: {}, cooldowns: {} };
  }
  const p = data.programmes[id];
  if (!p.cooldowns) p.cooldowns = {};
  return p;
}

function getCooldown(cat) {
  return prog().cooldowns[cat] ?? 72;
}

// Programme modifiable par l'utilisateur : « Perso » (historique) ou un programme créé (id u_…)
function isUserProg(id) { return id === 'custom' || !!data.userProgrammes?.[id]; }

// Séances d'un programme modifiable (objet modifiable en place), null pour un programme intégré
function userSessions(id) {
  if (id === 'custom') return (data.customSessions ||= {});
  return data.userProgrammes?.[id]?.sessions || null;
}

// Séance libre : faite hors de tout programme (programme et catégorie FREE dans l'historique).
// Aucune entrée dans data.programmes : ni exercices prévus, ni délai de récupération.
const FREE = 'free';
const FREE_META = { label: 'Séance libre', color: '#8E8E93', desc: 'Hors programme' };

function progMeta(id) {
  id = id || progFocusId();
  if (id === FREE) return { name: FREE_META.label, desc: FREE_META.desc, icon: '', sessions: {}, free: true };
  const up = data.userProgrammes?.[id];
  if (up) {
    // Séances retirées par un coach (retired, js/data/coach.js) : gardées pour l'historique, jamais listées
    const sessions = Object.fromEntries(Object.entries(up.sessions).filter(([, x]) => !x.retired));
    const names = Object.values(sessions).map(x => x.label).join(' · ');
    return { name: up.name, desc: names || 'Aucune séance', icon: '', sessions, user: true, archived: up.archived };
  }
  return PROGRAMMES[id] || PROGRAMMES.ppl;
}

// Identifiant d'une nouvelle séance perso : jamais un entier, sinon l'objet le rangerait
// en tête quel que soit l'ordre choisi (les clés entières passent avant les autres en JS)
function newSessionId() { return 's' + uid(); }

// Réordonne les séances d'un programme perso : l'ordre des clés de l'objet fait foi. from et to sont des
// rangs de la liste affichée (sessionKeys) ; les séances retirées par un coach restent à la fin
function moveSession(progId, from, to) {
  const store = userSessions(progId);
  if (!store) return false;
  const up = data.userProgrammes?.[progId];
  const visible = moveItem(sessionKeys(progId), from, to);
  const retired = Object.keys(store).filter(k => store[k]?.retired);
  if (up) up.order = [...visible, ...retired];   // ordre synchronisé (userSessionOrder)
  // Date du dernier changement d'ordre : la file de l'accueil repart de cet ordre (sessionQueue, js/features/dashboard.js)
  if (up) up.orderAt = Date.now();
  else if (data.programmes[progId]) data.programmes[progId].orderAt = Date.now();   // « Perso » d'avant les programmes créés
  // Clés de l'objet dans le même ordre (versions précédentes de l'app)
  const entries = [...visible, ...retired].map(k => [k, store[k]]);
  Object.keys(store).forEach(k => { delete store[k]; });
  entries.forEach(([k, v]) => { store[k] = v; });
  return true;
}

function sessionKeys(progId) {
  progId = progId || progFocusId();
  // Séance retirée par un coach (retired) : lue par rawLabel et sessionMeta (historique), jamais listée
  if (progId === 'custom') return Object.keys(userSessions(progId) || {});
  if (isUserProg(progId)) {
    const up = data.userProgrammes[progId];
    return userSessionOrder(up).filter(k => !up.sessions[k]?.retired);
  }
  return Object.keys(PROGRAMMES[progId]?.sessions || {});
}

// Pastille de séance : un simple point de la couleur de la séance, comme dans l'Historique. L'icône
// d'une séance Perso (cs.icon, emoji choisi avant) reste dans les données mais n'est plus affichée.
function catBadge(color) {
  return `<span class="cat-badge" style="--cat-color:${color}" aria-hidden="true"></span>`;
}

function sessionMeta(cat, progId) {
  progId = progId || progFocusId();
  if (progId === FREE) return { label: FREE_META.label, icon: catBadge(FREE_META.color), desc: FREE_META.desc, color: FREE_META.color };
  if (isUserProg(progId)) {
    const cs = userSessions(progId)?.[cat];
    if (!cs) return { label: esc(cat), icon: catBadge('var(--label2)'), desc: '', color: '#8E8E93' };
    return { ...cs, label: esc(cs.label), icon: catBadge(cs.color), desc: esc(cs.desc) };
  }
  const m = PROGRAMMES[progId]?.sessions[cat];
  if (!m) return { label: esc(cat), icon: catBadge('var(--label2)'), desc: '', color: '#8E8E93' };
  return { ...m, icon: catBadge(m.color) };
}

// Libellé brut (non échappé) pour les textes affichés via textContent
function rawLabel(cat, progId) {
  progId = progId || progFocusId();
  if (progId === FREE) return FREE_META.label;
  if (isUserProg(progId)) return userSessions(progId)?.[cat]?.label || cat;
  return PROGRAMMES[progId]?.sessions[cat]?.label || cat;
}

// Nom en clair d'un libellé anglais de séance (« Push » → « Pousser »), '' sinon. Tiré des programmes intégrés et
// de SESSION_PLAIN (js/data/programmes.js) : les copies de ces programmes (Mes programmes, coach) portent le même
// libellé et sont traduites aussi ; un nom déjà en français (« Jambes » du Bro Split) n'a pas de traduction.
let sessionPlainByLabel = null;
function sessionPlainName(label) {
  if (!sessionPlainByLabel) {
    sessionPlainByLabel = new Map();
    Object.values(PROGRAMMES).forEach(p => Object.entries(p.sessions).forEach(([cat, s]) => {
      if (SESSION_PLAIN[cat] && SESSION_PLAIN[cat] !== s.label) sessionPlainByLabel.set(s.label, SESSION_PLAIN[cat]);
    }));
  }
  return sessionPlainByLabel.get(String(label ?? '').trim()) || '';
}
// Nom d'une séance là où la place le permet (titres, accueil, programme) : « Pousser (Push) ». Texte brut, à échapper.
// Les pastilles, la mini-barre et les petits espaces gardent le nom court (rawLabel, sessionMeta().label).
function sessionTitle(cat, progId) {
  const raw = rawLabel(cat, progId), plain = sessionPlainName(raw);
  return plain ? `${plain} (${raw})` : raw;
}

function firstSession() {
  return sessionKeys()[0] || '';
}

// Séances du mois et de l'année en cours (calendrier local), et au total : des cumuls qui ne font que
// monter, à la place d'une série de semaines qui retombait à zéro après une semaine manquée
function historyTotals(now = Date.now()) {
  const d = new Date(now), y = d.getFullYear(), m = d.getMonth();
  let month = 0, year = 0;
  const hist = data.history || [];
  hist.forEach(h => {
    const t = new Date(h.date);
    if (t.getFullYear() !== y) return;
    year++;
    if (t.getMonth() === m) month++;
  });
  return { month, year, total: hist.length };
}

// ── Silhouette des muscles ──────────────────────────────────

// Réglage « Silhouette » (Réglages › Affichage) : dessin de la carte des muscles (js/ui/body-map.js).
// Absent (données d'avant le réglage) : homme, le seul dessin d'alors.
const SILHOUETTES = [['female', 'Femme'], ['male', 'Homme']];
function bodySilhouette() { return data?.silhouette === 'female' ? 'female' : 'male'; }

// Niveau répondu au premier lancement (js/features/onboarding.js) : 'debutant', 'confirme' ou null (inconnu).
// Gardé pour les écrans qui s'adaptent au niveau. Valeurs : TRAINING_LEVELS (store.js)
function trainingLevel() { return TRAINING_LEVELS.includes(data?.level) ? data.level : null; }

// Ligne « Record 32 × 9 » sous le nom de chaque exercice en séance (exSubHtml, js/features/session.js) : data.recordOn,
// true ou false une fois choisi (Réglages › Entraînement), absent = automatique : cachée au niveau « Je débute » (regard
// neuf du 16/11 : « Objectif », « Record » et « Avant » empilés ; l'objectif suffit, les records restent dans Progrès
// et le badge d'une série qui en bat un reste affiché)
function headRecordShown(d = data) { return typeof d?.recordOn === 'boolean' ? d.recordOn : d?.level !== 'debutant'; }

// ── Unités ──────────────────────────────────────────────────
// Les charges sont toujours stockées en kg (chaîne) ; l'affichage suit data.unit.
const KG_TO_LBS = 2.20462;
function unitLbl() { return data.unit === 'lbs' ? 'lbs' : 'kg'; }

// Charge stockée (kg) → nombre dans l'unité affichée, arrondi au 0,1 lb ou au 0,01 kg.
// null si vide ou invalide.
function toUnitW(kg) {
  if (kg === '' || kg == null) return null;
  const v = parseFloat(kg);
  if (isNaN(v)) return null;
  return data.unit === 'lbs' ? Math.round(v * KG_TO_LBS * 10) / 10 : Math.round(v * 100) / 100;
}

// Charge affichée, sans unité, à la française : « 1 032,5 ».
// plain: true donne « 1032,5 » sans séparateur de milliers : valeur des champs de saisie
// (relue par num()) et cellules étroites de la séance.
function fmtW(kg, { plain = false } = {}) {
  const v = toUnitW(kg);
  if (v === null) return '';
  return plain ? String(v).replace('.', ',') : fmtNum(v);
}

// Saisie dans l'unité affichée → kg stocké (chaîne)
function storeW(val) {
  if (val === '' || val == null) return '';
  const v = parseFloat(String(val).replace(',', '.'));
  if (isNaN(v)) return '';
  if (data.unit === 'lbs') return String(Math.round(v / KG_TO_LBS * 1000) / 1000); // précision pour retomber sur la valeur saisie
  return String(v);
}

// Palier de charge de la double progression, sans signe : « 2,5 kg », « 5 lb » (puce de la séance après
// une flèche ↑, cibles de l'accueil, toast « Charge augmentée de 2,5 kg »)
function bumpLabel() { return data.unit === 'lbs' ? '5 lb' : '2,5 kg'; }
function bumpStepKg() { return data.unit === 'lbs' ? 5 / KG_TO_LBS : 2.5; }

// Volume (kg) : « 850 kg », « 12,4 t », « 1 874 lbs », « 27,3 k lbs »
// Tonnes (milliers de lbs) toujours au dixième, partout la même précision : « 5,0 t » au bilan comme « 4,6 t » dans
// l'historique (« 5 t » arrondi à la tonne cachait un écart de 32 kg, panel t5)
function fmtVolume(kg) {
  if (kg === 0) return `0 ${unitLbl()}`;
  const tenth = v => v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (data.unit === 'lbs') {
    const lbs = kg * KG_TO_LBS;
    return lbs >= 1000 ? tenth(lbs / 1000) + ' k lbs' : fmtNum(Math.round(lbs)) + ' lbs';
  }
  return kg >= 1000 ? tenth(kg / 1000) + ' t' : fmtNum(Math.round(kg)) + ' kg';
}

// Texte posé sur une couleur de séance : blanc, ou noir quand le blanc n'atteindrait pas 4,5:1
// (orange, jaune, turquoise, couleurs claires des séances perso). Les var(--x) sont lues en sombre,
// le thème où elles sont les plus claires.
const CAT_HEX = { orange: '#FF9F0A', yellow: '#FFD60A', teal: '#40C8E0', green: '#30D158', indigo: '#5E5CE6', purple: '#BF5AF2', red: '#FF453A' };
function textOnColor(color) {
  const hex = CAT_HEX[/^var\(--(\w+)\)$/.exec(color)?.[1]] || color;
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 'var(--white)';
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05) >= 4.5 ? 'var(--white)' : '#000';
}

// Meilleure série d'une liste : la plus lourde, puis le plus de reps
// ex facultatif : avec une machine d'assistance, la meilleure série est celle qui a le moins d'aide
function bestSet(sets, ex = null) {
  let best = null, bestKey = null;
  const sign = ex && isAssisted(ex) ? -1 : 1;
  workSets(sets).forEach(s => {   // jamais une série d'échauffement (js/data/warmup.js)
    const w = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0;
    if (r <= 0) return;
    const key = sign * w;
    if (!best || key > bestKey || (key === bestKey && r > best.r)) {
      best = { w, r, weight: s.weight, reps: s.reps, ...(s.dist ? { dist: s.dist } : {}) };
      bestKey = key;
    }
  });
  return best;
}
// « 32,5 kg × 8 », ou « 8 reps » au poids du corps ; « 45 s », « 5 km · 30 min · 6:00 /km » selon la mesure
// Second argument : l'exercice (mesure, lest / aide et allure déduits) ou directement une mesure
function setTxt(b, exOrMeasure = 'reps') {
  if (!b) return '';
  const ex = typeof exOrMeasure === 'object' ? exOrMeasure : null;
  const measure = ex ? measureOf(ex) : exOrMeasure;
  if (measure !== 'reps' || (ex && loadKind(ex) !== 'charge')) return measureSetTxt(b, measure, ex ? setKind(ex) : 'charge');
  return b.w > 0 ? `${fmtW(b.weight)} ${unitLbl()} × ${b.r}` : `${b.r} reps`;
}

// ── Jours et semaines du calendrier (heure locale) ──────────
// Jamais de pas de 24 h ni de 7 × 24 h : la semaine du passage à l'heure d'hiver dure 169 h,
// celle de l'heure d'été 167 h. On compte en jours du calendrier (setDate, getDay).

// Même heure locale, n jours plus tard (n négatif : plus tôt)
function addDays(ts, n) {
  const d = new Date(ts); d.setDate(d.getDate() + n);
  return d.getTime();
}

// Rang du jour dans la semaine : lundi 0 … dimanche 6
function dayIndexInWeek(ts) { return (new Date(ts).getDay() + 6) % 7; }

// Lundi 0 h (heure locale) de la semaine de `ts` : début de « Cette semaine » (accueil, Progrès, silhouette)
function weekStart(ts = Date.now()) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  return addDays(d.getTime(), -dayIndexInWeek(d));
}

// Séances par semaine sur les `n` dernières semaines (la dernière : la semaine en cours),
// de lundi 0 h à lundi 0 h : [{ start, n }] du plus ancien au plus récent (graphique de Mon profil)
function weeklySessionCounts(n, now = Date.now()) {
  const ws = weekStart(now), hist = data.history || [];
  return Array.from({ length: n }, (_, i) => {
    const start = addDays(ws, -7 * (n - 1 - i)), end = addDays(start, 7);
    return { start, n: hist.filter(h => h.date >= start && h.date < end).length };
  });
}

// Date de la plus ancienne séance de l'historique (Infinity sans séance)
function firstHistoryDate() {
  return (data.history || []).reduce((m, h) => (h && h.date < m ? h.date : m), Infinity);
}

// Régularité de Mon profil : les `n` dernières semaines (weeklySessionCounts) et la moyenne de séances par
// semaine, au dixième. La moyenne ne compte que les semaines depuis celle de la première séance (deux semaines
// d'historique ne sont pas divisées par 12), semaine en cours comprise comme sur le graphique ; span : le
// nombre de semaines comptées, affiché à côté de la moyenne. Sans séance : avg et span à 0.
function regularity(n = 12, now = Date.now()) {
  const weeks = weeklySessionCounts(n, now);
  const first = firstHistoryDate();
  if (!Number.isFinite(first) || first >= addDays(weeks[n - 1].start, 7)) return { weeks, avg: 0, span: 0 };
  const from = Math.max(0, weeks.findIndex(w => addDays(w.start, 7) > first));
  const counted = weeks.slice(from), total = counted.reduce((a, w) => a + w.n, 0);
  return { weeks, avg: Math.round(total / counted.length * 10) / 10, span: counted.length };
}

// « Membre depuis » de Mon profil : la plus ancienne date entre la première séance de l'historique et la
// création du compte (created_at du serveur, texte ISO, s'il est connu) ; null sans l'une ni l'autre
function memberSince(createdAt) {
  const created = Date.parse(createdAt || '');
  const first = Math.min(firstHistoryDate(), Number.isFinite(created) ? created : Infinity);
  return Number.isFinite(first) ? first : null;
}
