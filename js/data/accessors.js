// ═══════════════════════════════════════════════════════════
//  Accès à la donnée : programme actif, séances, unités, séries
// ═══════════════════════════════════════════════════════════
'use strict';

function prog() {
  if (!data.programmes[data.activeProgramme]) {
    data.programmes[data.activeProgramme] = { exercises: {}, timers: {}, cooldowns: {} };
  }
  const p = data.programmes[data.activeProgramme];
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
  id = id || data.activeProgramme;
  if (id === FREE) return { name: FREE_META.label, desc: FREE_META.desc, icon: '', sessions: {}, free: true };
  const up = data.userProgrammes?.[id];
  if (up) {
    const names = Object.values(up.sessions).map(x => x.label).join(' · ');
    return { name: up.name, desc: names || 'Aucune séance', icon: '', sessions: up.sessions, user: true, archived: up.archived };
  }
  return PROGRAMMES[id] || PROGRAMMES.ppl;
}

// Identifiant d'une nouvelle séance perso : jamais un entier, sinon l'objet le rangerait
// en tête quel que soit l'ordre choisi (les clés entières passent avant les autres en JS)
function newSessionId() { return 's' + uid(); }

// Réordonne les séances d'un programme perso : l'ordre des clés de l'objet fait foi
function moveSession(progId, from, to) {
  const store = userSessions(progId);
  if (!store) return false;
  const entries = moveItem(Object.entries(store), from, to);
  Object.keys(store).forEach(k => { delete store[k]; });
  entries.forEach(([k, v]) => { store[k] = v; });
  return true;
}

function sessionKeys(progId) {
  progId = progId || data.activeProgramme;
  if (isUserProg(progId)) return Object.keys(userSessions(progId) || {});
  return Object.keys(PROGRAMMES[progId]?.sessions || {});
}

// Pastille ronde de 28 px : initiale blanche sur la couleur de la séance,
// ou l'emoji choisi par l'utilisateur (séances Perso) dans un carré fixe
function catBadge(label, color, emoji, size = 28) {
  const sz = size !== 28 ? `--badge:${size}px;` : '';
  if (emoji) return `<span class="cat-badge cat-badge--emoji" ${sz ? `style="${sz}"` : ''} aria-hidden="true">${emoji}</span>`;
  const initial = String(label || '?').trim().charAt(0).toUpperCase();
  return `<span class="cat-badge" style="${sz}--cat-color:${color}" aria-hidden="true">${esc(initial)}</span>`;
}

function sessionMeta(cat, progId) {
  progId = progId || data.activeProgramme;
  if (progId === FREE) return { label: FREE_META.label, icon: catBadge(FREE_META.label, FREE_META.color), emoji: '', desc: FREE_META.desc, color: FREE_META.color };
  if (isUserProg(progId)) {
    const cs = userSessions(progId)?.[cat];
    if (!cs) return { label: esc(cat), icon: catBadge(cat, 'var(--label2)'), emoji: '', desc: '', color: '#8E8E93' };
    return { ...cs, label: esc(cs.label), icon: catBadge(cs.label, cs.color, esc(cs.icon)), emoji: esc(cs.icon), desc: esc(cs.desc) };
  }
  const m = PROGRAMMES[progId]?.sessions[cat];
  if (!m) return { label: esc(cat), icon: catBadge(cat, 'var(--label2)'), emoji: '', desc: '', color: '#8E8E93' };
  return { ...m, emoji: m.icon, icon: catBadge(m.label, m.color) };
}

// Libellé brut (non échappé) pour les textes affichés via textContent
function rawLabel(cat, progId) {
  progId = progId || data.activeProgramme;
  if (progId === FREE) return FREE_META.label;
  if (isUserProg(progId)) return userSessions(progId)?.[cat]?.label || cat;
  return PROGRAMMES[progId]?.sessions[cat]?.label || cat;
}

function firstSession() {
  return sessionKeys()[0] || '';
}

// Clé de la semaine ISO d'un horodatage : « 2026-W41 »
function isoWeek(ts) {
  const d = new Date(ts);
  const day = d.getDay() || 7; // lundi = 1 … dimanche = 7
  d.setDate(d.getDate() + 4 - day); // jeudi de la même semaine
  const year = d.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const week = Math.ceil(((d - startOfYear) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Régularité : semaines consécutives avec au moins deux séances
function computeStreak() {
  const history = data.history || [];
  if (!history.length) return 0;
  const weekCounts = {};
  history.forEach(h => { const k = isoWeek(h.date); weekCounts[k] = (weekCounts[k] || 0) + 1; });
  const activeWeeks = new Set(Object.keys(weekCounts).filter(k => weekCounts[k] >= 2));
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 104; i++) {
    const ts = now.getTime() - i * 7 * 86400000;
    const key = isoWeek(ts);
    if (activeWeeks.has(key)) {
      streak++;
    } else if (i === 0) {
      // semaine en cours pas encore validée : elle ne casse pas la série
    } else {
      break;
    }
  }
  return streak;
}

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

// Volume (kg) : « 850 kg », « 12,4 t », « 1 874 lbs », « 27,3 k lbs »
// Palier de charge de la double progression (puce de la séance, cibles de l'accueil)
function bumpLabel() { return data.unit === 'lbs' ? '+5 lb' : '+2,5 kg'; }
function bumpStepKg() { return data.unit === 'lbs' ? 5 / KG_TO_LBS : 2.5; }

function fmtVolume(kg) {
  if (kg === 0) return `0 ${unitLbl()}`;
  if (data.unit === 'lbs') {
    const lbs = kg * KG_TO_LBS;
    return lbs >= 1000 ? fmtNum(lbs / 1000, 1) + ' k lbs' : fmtNum(Math.round(lbs)) + ' lbs';
  }
  return kg >= 1000 ? fmtNum(kg / 1000, 1) + ' t' : fmtNum(Math.round(kg)) + ' kg';
}

function historyColor(h) {
  const progId = h.programme || 'ppl';
  return sessionMeta(h.category, progId).color || 'var(--label2)';
}

// Meilleure série d'une liste : la plus lourde, puis le plus de reps
function bestSet(sets) {
  let best = null;
  (sets || []).forEach(s => {
    const w = parseFloat(s.weight) || 0, r = parseInt(s.reps) || 0;
    if (r <= 0) return;
    if (!best || w > best.w || (w === best.w && r > best.r)) best = { w, r, weight: s.weight, reps: s.reps };
  });
  return best;
}
// « 32,5 kg × 8 », ou « 8 reps » au poids du corps
function setTxt(b) {
  if (!b) return '';
  return b.w > 0 ? `${fmtW(b.weight)} ${unitLbl()} × ${b.r}` : `${b.r} reps`;
}
