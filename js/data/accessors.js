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

function progMeta(id) {
  id = id || data.activeProgramme;
  const up = data.userProgrammes?.[id];
  if (up) {
    const names = Object.values(up.sessions).map(x => x.label).join(' · ');
    return { name: up.name, desc: names || 'Aucune séance', icon: '', sessions: up.sessions, user: true, archived: up.archived };
  }
  return PROGRAMMES[id] || PROGRAMMES.ppl;
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
  if (isUserProg(progId)) return userSessions(progId)?.[cat]?.label || cat;
  return PROGRAMMES[progId]?.sessions[cat]?.label || cat;
}

function firstSession() {
  return sessionKeys()[0] || '';
}

// ISO week key "YYYY-Www" for a timestamp
function isoWeek(ts) {
  const d = new Date(ts);
  const day = d.getDay() || 7; // Mon=1 … Sun=7
  d.setDate(d.getDate() + 4 - day); // nearest Thursday
  const year = d.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const week = Math.ceil(((d - startOfYear) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

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
      // current week not yet active — don't break streak, just skip
    } else {
      break;
    }
  }
  return streak;
}

// Volume = Σ (weight × reps) for a list of sets [{weight, reps}]
function setsVolume(sets) {
  return (sets || []).reduce((a, s) => a + (parseFloat(s.weight) || 0) * (parseInt(s.reps) || 0), 0);
}

const KG_TO_LBS = 2.20462;
function unitLbl() { return data.unit === 'lbs' ? 'lbs' : 'kg'; }

// kg stored → display string (no unit suffix)
function dispW(kg) {
  if (kg === '' || kg == null) return '';
  const v = parseFloat(kg);
  if (isNaN(v)) return '';
  if (data.unit === 'lbs') return String(Math.round(v * KG_TO_LBS * 10) / 10);
  return String(Math.round(v * 100) / 100);
}

// display input → kg stored string
function storeW(val) {
  if (val === '' || val == null) return '';
  const v = parseFloat(String(val).replace(',', '.'));
  if (isNaN(v)) return '';
  if (data.unit === 'lbs') return String(Math.round(v / KG_TO_LBS * 1000) / 1000); // précision pour retomber sur la valeur saisie
  return String(v);
}

function fmtVolume(kg) {
  if (kg === 0) return `0 ${unitLbl()}`;
  if (data.unit === 'lbs') {
    const lbs = kg * KG_TO_LBS;
    return lbs >= 1000 ? fmtNum(lbs / 1000, 1) + ' k lbs' : fmtNum(Math.round(lbs)) + ' lbs';
  }
  return kg >= 1000 ? fmtNum(kg / 1000, 1) + ' t' : fmtNum(Math.round(kg)) + ' kg';
}

// Charge affichée en texte : « 32,5 » (dispW reste au point pour les champs de saisie)
function fmtW(kg) {
  const v = dispW(kg);
  return v === '' ? '' : fmtNum(v);
}

function historyColor(h) {
  const progId = h.programme || 'ppl';
  return sessionMeta(h.category, progId).color || 'var(--label2)';
}

// Poids affiché à la française (« 32,5 »), quel que soit le format renvoyé par dispW
function wFr(kg) {
  const s = dispW(kg);
  if (s === '') return '';
  const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  return isNaN(v) ? s : fmtNum(v);
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
function setTxt(b) {
  if (!b) return '';
  return b.w > 0 ? `${wFr(b.weight)} ${unitLbl()} × ${b.r}` : `${b.r} reps`;
}
