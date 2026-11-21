// ═══════════════════════════════════════════════════════════
//  Atlas détaillé : sous-muscles d'un exercice (fiche de la bibliothèque)
// ═══════════════════════════════════════════════════════════
'use strict';

// Données générées : BODY_PARTS (js/data/body-parts.js, noms et boîtes des calques) et EXERCISE_PARTS
// (js/data/exercise-parts.js, sous-muscles par exercice). Affichage : bodyAtlasHtml (js/ui/body-map.js),
// zoom et noms au toucher : js/ui/body-zoom.js.
// Intensités : 2 = rouge plein (comme un muscle principal aujourd'hui), 1 = rouge atténué (secondaire).

const ATLAS_PARTS = new Map(BODY_PARTS.parts.map((p, rank) => [p.id, { ...p, rank }]));

function atlasPart(id) { return ATLAS_PARTS.get(id) || null; }

// Sous-muscles visibles d'un muscle de l'app (les profonds ne se montrent que nommés par un exercice)
function atlasPartsOf(muscle) {
  return BODY_PARTS.parts.filter(p => p.parent === muscle && !p.deep).map(p => p.id);
}

// Parents (muscles de l'app) d'une liste de sous-muscles ; null (muscles seulement nommés au toucher) ignoré
function atlasParents(ids) {
  return [...new Set(ids.map(id => atlasPart(id)?.parent).filter(Boolean))];
}

const atlasSameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

// Sous-muscles colorés pour un exercice : { levels: { id: 2|1 }, source }.
//   'atlas'    détail de la correspondance (EXERCISE_PARTS), seulement si ses muscles parents sont exactement
//              ceux affichés (muscles vérifiés de la bibliothèque, jamais modifiés par la personne) : la carte
//              ne contredit jamais les pastilles
//   'muscles'  repli : chaque muscle entier, tous ses sous-muscles (2 pour un principal, 1 pour un secondaire)
// name : nom de l'exercice ; m : { primary, secondary, source } (exerciseMuscles)
function exercisePartLevels(name, m) {
  const primary = m?.primary || [], secondary = m?.secondary || [];
  const e = m?.source === 'catalogue' ? EXERCISE_PARTS[catalogueEntry(name)?.name] : null;
  if (e && atlasSameSet(atlasParents(Object.keys(e.p)), primary)
      && atlasParents(Object.keys(e.s)).every(id => primary.includes(id) || secondary.includes(id))
      && secondary.every(id => atlasParents(Object.keys(e.s)).includes(id))) {
    return { levels: { ...e.s, ...e.p }, source: 'atlas' };
  }
  const levels = {};
  secondary.forEach(id => atlasPartsOf(id).forEach(p => { levels[p] = 1; }));
  primary.forEach(id => atlasPartsOf(id).forEach(p => { levels[p] = 2; }));
  return { levels, source: 'muscles' };
}

// Rôle dit dans la bulle d'un sous-muscle touché, d'après sa couleur à l'écran : les mots des deux lignes de la fiche
// (« Muscles ciblés » en rouge plein, « Muscles qui aident » en rose)
function atlasRole(level) {
  return level >= 2 ? 'Muscle ciblé' : level === 1 ? 'Muscle qui aide' : 'Non ciblé par cet exercice';   // mots des deux lignes de la fiche
}

// ── Noms de salle : pastilles et titre de la bulle ──────────
// Pastille d'un sous-muscle : son nom de salle quand le découpage compte à la salle (faisceaux du pectoral et du
// trapèze, coiffe, rhomboïdes…), sinon le nom du muscle de l'app (les trois chefs du triceps font « Triceps »).
// Pectoral : claviculaire = haut, sterno-costal = milieu (la plus grande partie), abdominal = bas.
const ATLAS_PILL = {
  chest_clavicular: 'Haut des pectoraux', chest_sternal: 'Milieu des pectoraux', chest_abdominal: 'Bas des pectoraux',
  pec_minor: 'Petit pectoral', serratus: 'Dentelé antérieur',
  traps_upper: 'Haut des trapèzes', traps_middle: 'Milieu des trapèzes', traps_lower: 'Bas des trapèzes',
  levator_scapulae: 'Élévateur de la scapula', rhomboid_minor: 'Rhomboïdes', rhomboid_major: 'Rhomboïdes',
  teres: 'Grand rond', infraspinatus: 'Coiffe des rotateurs', teres_minor: 'Coiffe des rotateurs',
  glute_max: 'Grand fessier', glute_med: 'Moyen fessier', tfl: 'Tenseur du fascia lata', sartorius: 'Sartorius',
  scm: 'Sterno-cléido-mastoïdien', coracobrachialis: 'Coraco-brachial', tibialis: 'Tibial antérieur', peroneus: 'Long fibulaire',
};
function atlasPillLabel(id) {
  const p = atlasPart(id);
  return ATLAS_PILL[id] || (p?.parent ? muscleLabel(p.parent) : p?.name || id);
}
// Titre de la bulle : le nom de la pastille s'il ne désigne que ce sous-muscle, sinon son nom précis
// (« Triceps, chef latéral » sous la pastille « Triceps ») : la bulle commence toujours par le nom de la pastille
function atlasPartTitle(id) {
  const label = atlasPillLabel(id);
  const shared = BODY_PARTS.parts.some(p => p.id !== id && atlasPillLabel(p.id) === label);
  if (!shared) return label;
  const name = atlasPart(id).name;
  if (name.startsWith(label)) return name;
  // « Mollet, gastrocnémien médial » → « Mollets, gastrocnémien médial » ; « Petit rond (coiffe) » → « Coiffe des rotateurs, petit rond »
  const precise = (name.includes(', ') ? name.slice(name.indexOf(', ') + 2) : name).replace(/\s*\(.*\)$/, '');
  return `${label}, ${precise.charAt(0).toLowerCase()}${precise.slice(1)}`;
}
// Précision d'un sous-muscle dans son groupe, en minuscules : « vaste latéral » (Quadriceps), « chef long » (Triceps),
// « semi-tendineux » (Ischio-jambiers), « infra-épineux » (Coiffe des rotateurs)
function atlasPartDetail(id) {
  const label = atlasPillLabel(id), title = atlasPartTitle(id);
  const rest = title.startsWith(`${label}, `) ? title.slice(label.length + 2) : title;
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}
// Précisions de plusieurs sous-muscles d'un groupe, en une parenthèse (panel atlas-bas t3) : « vastes latéral et médial »
// (même premier mot : au pluriel, une fois), « gastrocnémiens » (tous les sous-muscles de ce mot : le mot seul),
// « semi-tendineux et semi-membraneux »
function atlasDetailList(ids) {
  const parts = ids.map(atlasPartDetail), and = l => l.length > 1 ? `${l.slice(0, -1).join(', ')} et ${l.at(-1)}` : l[0];
  const words = parts.map(d => d.split(' ')), w = words[0][0];
  if (parts.length > 1 && words.every(x => x.length === 2 && x[0] === w)) {
    const plural = /[sx]$/.test(w) ? w : `${w}s`;
    const all = BODY_PARTS.parts.filter(p => p.name.replace(/\u00ad/g, '').toLowerCase().includes(w.replace(/\u00ad/g, ''))).every(p => ids.includes(p.id));
    return all ? plural : `${plural} ${and(words.map(x => x[1]))}`;
  }
  return and(parts);
}

// Lignes de la fiche (panels atlas-bas t2 et t3) : on ne nomme que ce qui est coloré sur cette silhouette. Un groupe dont
// TOUS les sous-muscles visibles ont la même couleur garde son nom nu (« Quadriceps », « Triceps ») ; sinon, à chaque
// couleur, le groupe puis sa précision : « Quadriceps (vastes latéral et médial) » ciblés, « Quadriceps (droit fémoral) »
// qui aide. Visibles : un calque sur une vue du personnage (les profonds seulement quand l'exercice les colore).
function atlasSeen(id, levels, kind) {
  const p = atlasPart(id);
  return !!p && ['front', 'back'].some(v => BODY_PARTS.boxes[kind]?.[v]?.[id]) && (!p.deep || levels[id] > 0);
}
// Clé de ligne d'un sous-muscle : le nom nu du groupe s'il est d'une seule couleur, sinon groupe + couleur
function atlasLineKey(id, levels, kind) {
  const label = atlasPillLabel(id), main = levels[id] >= 2;
  const whole = BODY_PARTS.parts.filter(p => atlasPillLabel(p.id) === label && atlasSeen(p.id, levels, kind))
    .every(p => levels[p.id] > 0 && (levels[p.id] >= 2) === main);
  return whole ? label : `${label}|${main ? 2 : 1}`;
}
// Sous-muscles colorés et visibles, regroupés en noms de ligne, dans l'ordre de ids : [{ label, level, ids }]
function atlasLineGroups(ids, levels, kind) {
  const by = new Map();
  for (const id of ids.filter(id => levels[id] > 0 && atlasSeen(id, levels, kind))) {
    const key = atlasLineKey(id, levels, kind), cur = by.get(key);
    if (cur) { cur.ids.push(id); cur.level = Math.max(cur.level, levels[id]); } else by.set(key, { key, level: levels[id], ids: [id] });
  }
  return [...by.values()].map(({ key, level, ids: g }) => {
    const label = atlasPillLabel(g[0]);
    return { label: key === label ? label : `${label} (${atlasDetailList(g)})`, level, ids: g };
  });
}

// Pastilles de la fiche, dans l'ordre : rouge plein d'abord (intensité 2), puis atténué ; mêmes noms que les lignes
// (atlasLineGroups). [{ label, level, ids }]
function atlasPills(levels, kind = bodyKind(bodySilhouette())) {
  return atlasLineGroups(BODY_PARTS.parts.map(p => p.id), levels, kind).sort((a, b) => b.level - a.level);
}


// ── Fiche exercice (variante E) : deux lignes « Muscles ciblés » / « Muscles qui aident » ──
// Rôles d'un exercice par sous-muscle, selon le RÔLE AFFICHÉ sur la fiche (exercisePartLevels : niveau 2 « Muscle ciblé »,
// niveau 1 « Qui aide ») : p compte la série entière, s la moitié (audit M1 : le comptage de Progrès suivait la
// correspondance brute et contredisait la fiche sur 71 exercices). Ordre : celui de la correspondance quand elle vaut
// (le plus sollicité d'abord), sinon celui de BODY_PARTS. { p: [ids], s: [ids] }
function exercisePartRoles(name, m) {
  const r = exercisePartLevels(name, m), lv = r.levels, e = EXERCISE_PARTS[catalogueEntry(name)?.name];
  const order = r.source === 'atlas' && e ? [...Object.keys(e.p), ...Object.keys(e.s)] : BODY_PARTS.parts.map(p => p.id);
  const ids = [...new Set([...order, ...Object.keys(lv)])];
  return { p: ids.filter(id => lv[id] >= 2), s: ids.filter(id => lv[id] === 1) };
}

// Noms classés pour les deux lignes (atlasLineGroups), dans l'ordre de la correspondance (le plus sollicité d'abord :
// principaux puis secondaires). [{ label, level, ids }]
function atlasRanked(name, m, levels, kind = bodyKind(bodySilhouette())) {
  const { p, s } = exercisePartRoles(name, m);
  const order = [...p, ...s.filter(id => !p.includes(id))];
  const rank = id => (levels[id] >= 2 ? 0 : 1000) + (order.includes(id) ? order.indexOf(id) : 500 + (atlasPart(id)?.rank || 0));
  const ids = Object.keys(levels).sort((a, b) => rank(a) - rank(b));
  return atlasLineGroups(ids, levels, kind).sort((a, b) => b.level - a.level);   // tri stable : l'ordre de la correspondance reste
}

// Au-delà de max noms (4), les premiers puis « + N autres » : { shown, more }
const ATLAS_LINE_MAX = 4;
function atlasLineItems(items, max = ATLAS_LINE_MAX) {
  return items.length > max ? { shown: items.slice(0, max - 1), more: items.length - (max - 1) } : { shown: items, more: 0 };
}

// ── Progrès : travail de la période par sous-muscle ─────────
// Séries des séances de la période × correspondance : un sous-muscle principal compte la série entière, un secondaire
// la moitié (SECONDARY_WEIGHT, comme les 18 muscles et Strava). { sets: { id: n }, byEx: { id: { nom: n } } }
const ATLAS_SECONDARY_WEIGHT = 0.5;
function partSetCounts(history, from = -Infinity, to = Infinity, index = chosenMusclesIndex()) {
  const sets = {}, byEx = {};
  const add = (id, n, ex) => {
    sets[id] = (sets[id] || 0) + n;
    (byEx[id] ||= {})[ex] = (byEx[id][ex] || 0) + n;
  };
  (history || []).forEach(h => {
    if (!(h?.date >= from && h.date < to)) return;
    (h.exercises || []).forEach(e => {
      const n = workSets(e.sets).filter(s => (parseInt(s?.reps) || 0) > 0).length;
      if (!n) return;
      const { p, s } = exercisePartRoles(e.name, exerciseMuscles(e, index));
      const name = catalogueEntry(e.name)?.name || e.name;
      p.forEach(id => add(id, n, name));
      s.forEach(id => { if (!p.includes(id)) add(id, n * ATLAS_SECONDARY_WEIGHT, name); });
    });
  });
  return { sets, byEx };
}

// Charge de la période par sous-muscle, mêmes périodes et paliers que muscleLoad (séries par semaine affichées) :
// { sets, weekly, levels: { id: 0..MUSCLE_LEVEL_MAX }, byEx, load } ; load : muscleLoad de la même période
function partLoad(spanKey = 'week', now = Date.now(), history = data.history) {
  const load = muscleLoad(spanKey, now, history), span = MUSCLE_SPANS[spanKey] || MUSCLE_SPANS.week;
  const from = span.calendar ? weekStart(now) : now - span.days * 86_400_000;
  const { sets, byEx } = partSetCounts(history, from, now + 1);
  const weekly = {}, levels = {};
  for (const p of BODY_PARTS.parts) {
    const perWeek = roundSets(sets[p.id] || 0) / span.weeks;
    weekly[p.id] = perWeek > 0 ? Math.max(1, Math.round(perWeek)) : 0;
    levels[p.id] = muscleLevel(weekly[p.id]);
  }
  return { sets, weekly, levels, byEx, load };
}

// « À travailler » (panels affichage-e t4 et t5) : les muscles de salle (ceux de « Séries par muscle », js/data/muscles.js)
// dont au moins un sous-muscle visible est gris ou rouge pâle sur le personnage ; ids : ces sous-muscles-là (isolés au
// toucher du nom). Correspondance avec le dessin au niveau du muscle de salle : chaque nom a une zone grise ou pâle, chaque
// zone grise ou pâle d'un muscle de salle a son nom (les sous-muscles sans muscle de salle, tenseur du fascia lata,
// sterno-cléido-mastoïdien…, et les profonds, invisibles non colorés, n'y entrent pas), sauf pour un muscle de salle à
// l'objectif dans « Séries par muscle » : jamais listé. Du moins au plus de séries de la
// période ; à égalité, les grands groupes avant les petits (minor), puis l'ordre de « Séries par muscle ».
// [{ key, label, sets, minor, ids }]
function atlasToWork(pl, kind = bodyKind(bodySilhouette())) {
  const visible = p => !p.deep && ['front', 'back'].some(v => BODY_PARTS.boxes[kind]?.[v]?.[p.id]);
  const items = MUSCLES.map((m, i) => ({ key: m.id, label: m.label, sets: pl.load.sets[m.id] || 0, minor: !!m.minor, rank: i,
    ids: BODY_PARTS.parts.filter(p => p.parent === m.id && visible(p) && (pl.levels[p.id] || 0) < MUSCLE_LEVEL_MAX).map(p => p.id) }))
    // Un muscle à l'objectif dans « Séries par muscle » n'est pas à travailler, même si l'un de ses sous-muscles est pâle
    // (audit M2 : les deux listes se contredisaient)
    .filter(it => it.ids.length && (pl.load.levels[it.key] || 0) < MUSCLE_LEVEL_MAX);
  return items.sort((a, b) => a.sets - b.sets || a.minor - b.minor || a.rank - b.rank);
}

// Les 3 exercices qui ont le plus travaillé un sous-muscle sur la période : [[nom, séries]]
function partTopExercises(byEx, id, n = 3) {
  return Object.entries(byEx[id] || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

// Décomposition d'un muscle de salle en ses zones dessinées (panel t12 : Pectoraux 14 à l'objectif, mais un faisceau
// pâle sur le dessin) : [{ label, n }], n = séries par semaine de la zone, l'unité de « Séries par muscle ». Zones
// nommées court : « Haut », « Milieu », « Bas » (pectoraux, trapèzes), « Chef long » (triceps), sinon le nom de la
// pastille ; deux sous-muscles de même pastille (rhomboïdes) n'en font qu'une, au plus travaillé. Vide pour les
// muscles d'un seul tenant sur le dessin. Jambes comprises depuis leur détail (panel atlas-bas t2 : au squat, les vastes
// ciblés et le droit fémoral qui aide n'ont pas le même palier, « Par zone » le dit : « Vaste latéral 10 · Droit fémoral 5 »)
function atlasMuscleZones(pl, muscleId, kind = bodyKind(bodySilhouette())) {
  const label = muscleLabel(muscleId), cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const parts = BODY_PARTS.parts.filter(p => p.parent === muscleId && ['front', 'back'].some(v => BODY_PARTS.boxes[kind]?.[v]?.[p.id]));
  const pills = new Set(parts.map(p => atlasPillLabel(p.id)));
  const zones = new Map();
  for (const p of parts) {
    let name = pills.size > 1 ? atlasPillLabel(p.id) : atlasPartTitle(p.id);
    if (name.startsWith(`${label}, `)) name = cap(name.slice(label.length + 2));
    else if (name.endsWith(` des ${label.toLowerCase()}`)) name = name.slice(0, -(label.length + 5));
    zones.set(name, Math.max(zones.get(name) ?? 0, pl.weekly[p.id] || 0));
  }
  return zones.size > 1 ? [...zones].map(([l, n]) => ({ label: l, n })) : [];
}
