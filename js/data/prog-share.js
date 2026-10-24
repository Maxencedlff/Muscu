// ═══════════════════════════════════════════════════════════
//  Partage d'un programme entre utilisateurs, sans compte ni serveur
//  Le programme part dans un message texte : lisible par un humain (séances et exercices),
//  suivi d'un code (JSON en base64url) que l'appli du destinataire sait relire.
//  On partage le plan (séances, exercices, séries, repos, mesure, tempo, muscles), jamais les
//  charges, records ni l'historique, qui sont propres à chacun.
// ═══════════════════════════════════════════════════════════
'use strict';

const PROG_SHARE_PREFIX = 'MDLF-PROG1:';
const PROG_SHARE_RE = /MDLF-PROG1:([A-Za-z0-9_-]+)/;
const PROG_SHARE_LIMITS = { name: 40, sessions: 12, exercises: 30, exName: 80 };

// Plan partageable du programme progId : { v, name, sessions: [{ label, icon, color, desc, ex: [...] }] }.
// Clés courtes pour garder le code compact : n nom, s séries, r repos (s), m mesure, t tempo,
// g guidage au son, p préparation (s), rm haut de fourchette, mu / ms muscles principaux / secondaires.
function programmeSharePayload(progId) {
  const sessions = sessionKeys(progId).map(cat => {
    const meta = sessionMeta(cat, progId);
    const ex = (data.programmes[progId]?.exercises?.[cat] || []).map(e => {
      const o = { n: e.name, s: e.sets };
      if (e.rest) o.r = e.rest;
      if (e.measure) o.m = e.measure;
      if (e.tempo) { o.t = e.tempo; if (e.tempoGuide === true) { o.g = 1; o.p = tempoPrepOf(e); } }
      if (e.repMax !== undefined && e.repMax !== 12) o.rm = e.repMax;
      if (e.muscles?.length) o.mu = e.muscles;
      if (e.musclesSecondary?.length) o.ms = e.musclesSecondary;
      return o;
    });
    return { label: rawLabel(cat, progId), icon: isUserProg(progId) ? (userSessions(progId)?.[cat]?.icon || '') : '',
             color: meta.color, desc: isUserProg(progId) ? (userSessions(progId)?.[cat]?.desc || '') : (meta.desc || ''), ex };
  });
  return { v: 1, name: progMeta(progId).name, sessions };
}

// UTF-8 ↔ base64url (alphabet sûr dans une URL ou un message, sans « = » final)
function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function encodeProgrammeShare(payload) { return PROG_SHARE_PREFIX + toBase64Url(JSON.stringify(payload)); }

// Message complet : le programme en clair, la marche à suivre, puis le code
function programmeShareText(payload) {
  const exLine = e => {
    const bits = [`${e.s} série${e.s > 1 ? 's' : ''}`];
    if (e.m === 'time') bits.push('en durée');
    else if (e.m === 'cardio') bits.push('cardio');
    if (e.t) bits.push(`tempo ${shortTempo(e.t)}`);
    if (e.r) bits.push(`repos ${fmtRest(e.r)}`);
    return `• ${e.n} : ${bits.join(', ')}`;
  };
  const body = payload.sessions.map(s => `${s.label}\n${s.ex.length ? s.ex.map(exLine).join('\n') : '(aucun exercice)'}`).join('\n\n');
  return `Mon programme « ${payload.name} » sur MDLF Training\n\n${body}\n\n`
    + `Pour l'ajouter dans l'appli : copie tout ce message, puis Programme › Importer un programme.\n`
    + encodeProgrammeShare(payload);
}

// Relit un message reçu : le plan validé et borné, ou null si aucun code lisible n'y est trouvé
function parseProgrammeShare(text) {
  const m = PROG_SHARE_RE.exec(String(text || ''));
  if (!m) return null;
  let d;
  try { d = JSON.parse(fromBase64Url(m[1])); } catch { return null; }
  if (!d || d.v !== 1 || !Array.isArray(d.sessions)) return null;
  const L = PROG_SHARE_LIMITS, str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const ids = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && MUSCLE_ID_RE.test(x)).slice(0, MAX_MUSCLES) : [];
  const sessions = d.sessions.slice(0, L.sessions).filter(s => s && typeof s === 'object').map(s => ({
    label: str(s.label, 40) || 'Séance',
    icon: str(s.icon, 8),
    color: /^(#[0-9a-f]{6}|var\(--[a-z]+\))$/i.test(s.color || '') ? s.color : '#8E8E93',
    desc: str(s.desc, 80),
    ex: (Array.isArray(s.ex) ? s.ex : []).slice(0, L.exercises).filter(e => e && str(e.n, L.exName)).map(e => {
      const o = { n: str(e.n, L.exName), s: num(e.s, 1, 10, true) || 3 };
      const r = num(e.r, 10, 600, true); if (r) o.r = r;
      if (['reps', 'time', 'cardio'].includes(e.m)) o.m = e.m;
      const t = parseTempo(e.t); if (t) { o.t = formatTempo(t); if (e.g === 1) { o.g = 1; o.p = tempoPrepOf({ tempoPrep: e.p }); } }
      const rm = num(e.rm, 1, 100, true); if (rm) o.rm = rm;
      const mu = ids(e.mu), ms = ids(e.ms); if (mu.length) o.mu = mu; if (ms.length) o.ms = ms;
      return o;
    }),
  }));
  if (!sessions.length) return null;
  return { v: 1, name: str(d.name, L.name) || 'Programme reçu', sessions };
}

// Ajoute le plan reçu comme nouveau programme perso (rien d'existant n'est remplacé) ; renvoie son id.
// Nom déjà pris : « Nom (2) », « Nom (3) »…
function importSharedProgramme(payload) {
  const taken = new Set(Object.values(data.userProgrammes || {}).filter(p => !p.archived).map(p => p.name));
  let name = payload.name;
  for (let i = 2; taken.has(name); i++) name = `${payload.name} (${i})`;
  const id = 'u_' + uid(), sessions = {}, pdata = { exercises: {}, timers: {}, cooldowns: {} };
  payload.sessions.forEach(s => {
    const cat = newSessionId();
    sessions[cat] = { label: s.label, icon: s.icon, desc: s.desc, color: s.color };
    pdata.timers[cat] = null;
    pdata.exercises[cat] = s.ex.map(e => {
      const ex = makeExercise(e.n, e.s);
      if (e.r) ex.rest = e.r;
      if (e.m) ex.measure = e.m;
      if (e.t) { ex.tempo = e.t; if (e.g) { ex.tempoGuide = true; ex.tempoPrep = e.p; } }
      if (e.rm) ex.repMax = e.rm;
      if (e.mu) ex.muscles = e.mu;
      if (e.ms) ex.musclesSecondary = e.ms;
      return ex;
    });
  });
  data.userProgrammes ||= {};
  data.userProgrammes[id] = { name, sessions, archived: false };
  data.programmes[id] = pdata;
  return id;
}
