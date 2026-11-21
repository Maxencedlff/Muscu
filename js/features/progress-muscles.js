// ═══════════════════════════════════════════════════════════
//  Progrès par muscle (refonte du 15/11, maquette C retenue) : chaque groupe en carte illustrée (vignette 3D, force
//  gagnée en 3 mois, séries par semaine), comme Fitbod montre la force par groupe et Hevy les séries par muscle ;
//  détail d'un groupe ; lignes « séries par semaine » partagées avec Séries par muscle (js/features/muscles.js).
//  Images toujours décoratives (alt vide, aria-hidden) : VoiceOver lit le texte et l'intitulé complet du bouton.
// ═══════════════════════════════════════════════════════════
'use strict';

const PROG_WINDOW_DAYS = 84;   // « 3 mois » : 12 semaines

// Vignette 3D du muscle principal d'un exercice ou d'un groupe (img/muscles/<id>.webp, celle de la Bibliothèque) ;
// fichier absent : js/ui/vivant.js la marque data-missing et la cache
function progThumbHtml(id, cls = '') {
  return id ? `<img class="mgc__img ${cls}" src="img/muscles/${id}.webp" alt="" aria-hidden="true" width="600" height="400" decoding="async">` : '';
}
function exMainMuscle(name) {
  const id = exerciseMuscles({ name }).primary?.[0];
  return isMuscleId(id) ? id : null;
}
function muscleGroupOf(id) { return MUSCLE_GROUPS.find(g => g.muscles.includes(id)) || null; }

// ── Groupes travaillés par une liste d'exercices (séance du programme, séance passée) ─
// Muscle principal d'un exercice = le premier : il compte 1, les autres principaux ½ (un Pull avec curls et tractions
// reste « Dos » et non « Bras » : retour de Maxence, 15/11). index : chosenMusclesIndex() déjà calculé (boucles).
function exercisesMuscleCount(list, index = chosenMusclesIndex()) {
  const n = new Map();
  (Array.isArray(list) ? list : []).forEach(ex => exerciseMuscles(ex, index).primary
    .forEach((m, i) => n.set(m, (n.get(m) || 0) + (i ? 0.5 : 1))));
  return n;
}
// Groupes de MUSCLE_GROUPS touchés, du plus au moins travaillé ([{ g, n }]) ; à égalité, l'ordre du corps
function exercisesGroups(list, index) {
  const n = exercisesMuscleCount(list, index);
  return MUSCLE_GROUPS.map(g => ({ g, n: g.muscles.reduce((a, m) => a + (n.get(m) || 0), 0) }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n);
}
// Groupe principal (celui qui compte le plus d'exercices) : Push → pectoraux, Pull → dos, Legs → jambes ; null si aucun
function mainGroupOf(list, index) {
  return exercisesGroups(list, index)[0]?.g.id || null;
}

// ── Silhouette d'un exercice ou d'une séance : muscles ciblés et muscles en soutien ──
// Principaux pleins, secondaires presque pleins mais d'une autre teinte (--body-heat-sec, option secondary de
// bodyMapHtml), pour rester lisibles et distincts. m : { primary, secondary } (exerciseMuscles)
const SECONDARY_INTENSITY = 0.8;
function exerciseIntensity(m) {
  const lv = {};
  m.secondary.forEach(id => { lv[id] = SECONDARY_INTENSITY; });
  m.primary.forEach(id => { lv[id] = 1; });
  return lv;
}
// Muscles d'une liste d'exercices (séance passée) : principaux de chacun des exercices, puis secondaires qui ne sont
// principaux d'aucun (épaules + abdos : les deux en rouge plein, triceps et trapèzes en soutien).
// Renvoie { primary, secondary } au format d'exerciseMuscles ; index : chosenMusclesIndex() déjà calculé (boucles)
function exercisesMuscles(list, index = chosenMusclesIndex()) {
  const primary = new Set(), secondary = new Set();
  (Array.isArray(list) ? list : []).forEach(ex => {
    const m = exerciseMuscles(ex, index);
    m.primary.forEach(id => primary.add(id));
    m.secondary.forEach(id => secondary.add(id));
  });
  return { primary: [...primary], secondary: [...secondary].filter(id => !primary.has(id)) };
}
// Personnage entier (face et dos) d'une liste d'exercices, décoratif ; '' si aucun muscle reconnu (cardio, inconnus).
// Le texte de la carte ou de l'en-tête dit déjà les groupes travaillés à VoiceOver.
function exercisesBodyHtml(list, index, className = '') {
  const m = exercisesMuscles(list, index);
  return m.primary.length ? bodyMapHtml(exerciseIntensity(m), { view: 'both', secondary: m.secondary, className }) : '';
}
// Légende des deux teintes (détail d'une séance passée), décorative comme les personnages qu'elle explique
function bodyLegendHtml(cls = '') {
  return `<div class="body-legend ${cls}" aria-hidden="true"><span class="body-legend__it"><i class="body-legend__dot"></i>Ciblés</span><span class="body-legend__it"><i class="body-legend__dot body-legend__dot--sec"></i>En soutien</span></div>`;
}

// Progrès d'un exercice en % sur la fenêtre : première et dernière séance des 12 semaines (la grandeur de sa liste :
// charge max, ou reps au poids du corps). null sans deux séances, ou si la dernière date de plus de 3 semaines
function windowPoints(it, now = Date.now()) { return it.points.filter(p => p.date >= now - PROG_WINDOW_DAYS * 86_400_000); }
function exWindowPct(it, now = Date.now()) {
  if (it.measure === 'cardio') return null;
  const pts = windowPoints(it, now);
  if (pts.length < 2 || pts.at(-1).date < now - 21 * 86_400_000) return null;
  const a = mainMetric(it, pts[0]), b = mainMetric(it, pts.at(-1));
  return a > 0 ? Math.round((b - a) / a * 100) : null;
}

// ── Chaque groupe de muscles en carte illustrée : force gagnée en 3 mois, séries par semaine ──
// Force d'un groupe : moyenne des progrès (exWindowPct) des exercices dont il est le muscle principal
// Séries par semaine du groupe : somme des séries par semaine affichées de ses muscles (load.weekly) : la carte, le
// détail du groupe et Séries par muscle disent le même nombre
// Moins de GROUP_MIN_SESSIONS séances des exercices du groupe en 12 semaines : « Pas assez de séances » plutôt qu'un
// « Stable » qui laisserait croire à une mesure (panel Progrès t2 : Abdominaux « Stable » à 1 série par semaine)
const GROUP_MIN_SESSIONS = 4;
function groupProgress(idx, load) {
  const by = new Map(MUSCLE_GROUPS.map(g => [g.id, []]));
  idx.forEach(it => {
    const g = muscleGroupOf(exMainMuscle(it.name)), p = g ? exWindowPct(it) : null;
    if (p !== null) by.get(g.id).push({ it, pct: p, n: windowPoints(it).length });
  });
  return MUSCLE_GROUPS.map(g => {
    const ex = by.get(g.id), enough = ex.reduce((a, x) => a + x.n, 0) >= GROUP_MIN_SESSIONS;
    const perWeek = g.muscles.reduce((a, m) => a + (load.weekly[m] || 0), 0);
    return { g, ex, n: ex.length, pct: enough ? Math.round(ex.reduce((a, x) => a + x.pct, 0) / ex.length) : null, perWeek };
  });
}
function groupTrendTxt(pct) { return pct === null ? 'Pas assez de séances' : pct === 0 ? 'Stable' : `${pctTxt(pct)} de force`; }
const GROUP_FORCE_HOW = 'Moyenne des exercices du groupe. Pour chacun, la charge max de ta première à ta dernière séance sur 12 semaines.';
// load : la période de la carte Muscles (muscleSpan, js/features/muscles.js), la même pour les deux
function progGroupCardsHtml(idx, load = muscleLoad(muscleSpan)) {
  const rows = groupProgress(idx, load).map(({ g, n, pct, perWeek }) => {
    const cls = pct > 0 ? 'txt-up' : 'txt-flat';   // une baisse en gris : le rouge, ici, c'est le muscle
    const trend = groupTrendTxt(pct);
    const sets = `${plural(perWeek, 'série', 'séries')} par semaine`;
    const label = `${g.label} : ${trend}${pct !== null ? ` sur ${plural(n, 'exercice', 'exercices')}` : ''} en 3 mois, ${sets}`;
    return `
      <button class="cell cell--nav mgc pgrp" data-action="open-stats-group" data-group="${g.id}" aria-label="${esc(label)}">
        <span class="mgc__text" aria-hidden="true">
          <span class="mgc__title">${esc(g.label)}</span>
          <span class="pgrp__trend num ${pct === null ? '' : cls}">${trend}</span>
          <span class="mgc__sub num">${sets}</span>
        </span>
        ${progThumbHtml(g.id)}
        ${icon('chevron.right', 16)}
      </button>`;
  }).join('');
  return `<div class="group-title">Muscles en 3 mois</div><div class="group mgcs pgrps">${rows}</div>
    <div class="group-foot">Force : charge max sur 12 semaines. ${load.span === 'month' ? 'Séries : moyenne par semaine sur 4 semaines.' : 'Séries : cette semaine.'}</div>`;
}

// ── Progrès › un groupe de muscles : grande vignette, force et les exercices qui la font, séries de ses muscles ──
function renderStatsGroup(id) {
  const g = MUSCLE_GROUP_BY_ID.get(id);
  if (!g) return renderStats();
  const load = muscleLoad(muscleSpan);
  const gp = groupProgress(exerciseIndex(), load).find(x => x.g.id === g.id);
  const cls = gp.pct > 0 ? 'txt-up' : 'txt-flat';
  const rows = gp.ex.slice().sort((a, b) => b.pct - a.pct).map(x => statsRow(x.it, { recent: true })).join('');
  return `
    <div class="view stats-group view--grouped">
      ${navBar({ title: '' })}
      <div class="scr">
        ${statsGroupAtlasHtml(g)}
        <h1 class="scr-title exhead__title">${esc(g.label)}</h1>
        <div class="sgrp__force">
          <span class="sgrp__pct num ${gp.pct === null ? 'txt-flat' : cls}">${groupTrendTxt(gp.pct)}</span>
          <span class="sgrp__since">en 3 mois${gp.pct !== null ? `, sur ${plural(gp.n, 'exercice', 'exercices')}` : ''}</span>
        </div>
        <p class="sgrp__how">${GROUP_FORCE_HOW}</p>
        ${rows ? `<div class="group-title">Exercices</div><div class="group">${rows}</div>`
          : '<div class="group-foot">La force s\'affiche après deux séances d\'un exercice de ce groupe en 3 mois.</div>'}
        <div class="group-title">${weeklyTitle(load.span)}</div>
        <div class="group">
          ${g.muscles.length > 1 ? `<div class="cell sgrp__total"><span class="cell__body"><span class="cell__title" aria-hidden="true">Tout le groupe</span><span class="visually-hidden">Tout le groupe : ${weeklyTxt(gp.perWeek, load.span)}</span></span><span class="cell__value num" aria-hidden="true">${gp.perWeek}</span></div>` : ''}
          ${muscleWeekRowsHtml(load, g.muscles)}
        </div>
        ${g.muscles.some(id => atlasMuscleZones(partLoad(load.span), id).length) ? `<div class="group-foot">${MUSCLE_ZONES_NOTE}</div>` : ''}
        <div class="group">
          <button class="cell cell--nav" data-action="go-stats-muscles"><span class="cell__body"><span class="cell__title">Tous les muscles</span></span>${icon('chevron.right', 16)}</button>
        </div>
      </div>
    </div>`;
}

// Tête de la page d'un groupe : le personnage détaillé, sous-muscle par sous-muscle (haut, milieu et bas des pectoraux…)
// dans les couleurs de la carte « Muscles » (panel affichage-e t9 : le groupe apparaissait en un seul bloc) ; ses
// sous-muscles à 0 série cernés ; vues et cadrage calculés sur tous ses sous-muscles (sinon ceux à 0 série de l'autre
// vue, le dos de l'épaule, le triceps, restaient hors du dessin) ; toucher : la carte d'info de Progrès ; la légende des 3 états dessous
function statsGroupAtlasHtml(g) {
  const pl = partLoad(muscleSpan), ids = BODY_PARTS.parts.filter(p => g.muscles.includes(p.parent) && !p.deep).map(p => p.id);
  const on = Object.fromEntries(ids.filter(id => pl.levels[id] > 0).map(id => [id, pl.levels[id]]));
  const map = bodyAtlasHtml(on, { className: 'exhero__body', title: g.label, tap: true, tiers: true, tip: 'load', outline: ids.filter(id => !on[id]), frame: Object.fromEntries(ids.map(id => [id, 1])) });
  return `<figure class="exhero exhero--deep exhero--atlas">${atlasBoxHtml(map, 'sgrp__box')}
    <figcaption class="exhero__cap exhero__legend" aria-hidden="true">${muscleLegendItemsHtml()}</figcaption></figure>`;
}

// Sous les zones (panel t13 : Pectoraux 14, mais Haut 7, Milieu 10, Bas 9) : pourquoi le muscle n'est pas leur somme
const MUSCLE_ZONES_NOTE = 'Une série compte une fois pour le muscle, même si elle touche plusieurs zones.';

// Lignes « muscle, séries par semaine, barre » : Séries par muscle et détail d'un groupe (même unité que la carte)
function muscleWeekRowsHtml(load, ids) {
  const max = Math.max(MUSCLE_LEVEL_FROM.at(-1) * 2, ...MUSCLES.map(m => load.weekly[m.id]));   // l'objectif (10) à mi-barre
  const pl = partLoad(load.span);
  return ids.map(id => {
    const n = load.weekly[id], tier = bodyTier(load.intensity[id]);
    // Zones du dessin (panel t12) : « Haut 5 · Milieu 9 · Bas 0 », repliable, pour recouper la carte et le personnage
    const zones = atlasMuscleZones(pl, id).map(z => `${esc(z.label)}\u00a0<span class="num">${z.n}</span>`).join(' · ');
    return `
      <div class="cell mrow${id === muscleFocus ? ' mrow--focus' : ''}" data-muscle="${id}">
        <span class="cell__body">
          <span class="mrow__top" aria-hidden="true"><span class="cell__title">${muscleLabel(id)}</span><span class="cell__value num">${n}</span></span>
          <span class="mrow__bar" aria-hidden="true"><i${tier ? ` class="is-${tier.tone}"` : ''} style="width:${Math.round(n / max * 100)}%"></i></span>
          <span class="visually-hidden">${muscleLabel(id)} : ${weeklyTxt(n, load.span)}, ${levelWord(load.levels[id])}</span>
          ${zones ? `<span class="mrow__zones"><button class="mrow__zsum" data-action="mrow-zones" aria-expanded="true">Par zone${icon('chevron.down', 12)}</button><span class="mrow__zline">${zones}</span></span>` : ''}
        </span>
      </div>`;
  }).join('');
}
function weeklyTitle(span = muscleSpan) { return span === 'month' ? 'Séries par semaine, moyenne sur 4 semaines' : 'Séries cette semaine'; }

registerActions({
  // « Par zone » replié ou déplié (ligne des zones du dessin sous un muscle)
  'mrow-zones': (e, el) => { el.setAttribute('aria-expanded', String(el.getAttribute('aria-expanded') !== 'true')); },
  'open-stats-group': (e, el) => {
    if (MUSCLE_GROUP_BY_ID.has(el.dataset.group)) navigate(makeRoute('stats-group', el.dataset.group));
  },
});
