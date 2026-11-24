// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : logique pure des bilans configurables (docs/COACH_WEB.md, vague 2 ; contrat :
//  docs/BILANS.md)
//
//  Aucun accès au DOM ni au serveur. Les règles d'un suivi et d'une réponse viennent de js/data/checkins.js
//  (checkinItemsClean, checkinDefaultItem, checkinValueText, checkinValueNumber, checkinScheduleText…), jamais
//  recopiées. Ici :
//  - l'éditeur de « Mes bilans » : lignes cochées par rubrique, ordre (glisser, boutons, clavier), erreurs, plan
//    d'enregistrement (modèle, plannings créés ou remplacés, plannings retirés) ;
//  - la fiche élève : bilans reçus, en attente, comparaison « face à » un bilan précédent, colonnes de la fiche
//    Semaines ;
//  - le tableau de bord : bilans reçus et pas encore répondus (signal « Bilan reçu, à répondre »).
//  Testé par tests/unit/coach-web-bilans.mjs.
// ═══════════════════════════════════════════════════════════
'use strict';

// Réglage d'envoi par défaut d'un bilan sans destinataire : chaque semaine, dimanche 18 h, rappel 1 jour après,
// à rendre 2 jours après
const DESK_CK_BASE = Object.freeze({ freq: 'week', weekday: 0, monthday: 1, send_hour: 18, remind_after_h: 24, due_after_h: 48 });
const DESK_CK_REMIND = [12, 24, 48, 72];        // rappel : heures après l'envoi
const DESK_CK_DUE = [24, 48, 72, 96, 168];      // à rendre : heures après l'envoi
const DESK_CK_FREQ_SHORT = { week: 'Chaque semaine', '2weeks': '2 semaines', month: 'Chaque mois', manual: 'À la demande' };
const DESK_CK_FREQ_OVERRIDE = { week: 'chaque semaine', '2weeks': 'toutes les 2 sem.', month: 'chaque mois', manual: 'à la demande' };

// ── Éditeur : lignes ────────────────────────────────────────

// Lignes de l'éditeur depuis les suivis d'un modèle, rubrique par rubrique (Corps, Activité et plan, Ressenti, Tes
// questions) : d'abord les suivis du modèle dans son ordre, puis ceux du catalogue qu'il n'a pas, décochés.
// Ligne : { key, group, on, item } (item gardé même décoché : ses réglages reviennent si on le recoche)
function deskCkRows(items) {
  const list = checkinItemsClean(items);
  const out = [];
  for (const [g] of CHECKIN_GROUPS) {
    if (g === 'custom') { list.filter(it => it.kind === 'custom').forEach(it => out.push({ key: it.key, group: g, on: true, item: it })); continue; }
    const mine = list.filter(it => it.kind !== 'custom' && checkinKind(it.kind)?.group === g);
    mine.forEach(it => out.push({ key: it.key, group: g, on: true, item: it }));
    CHECKIN_KINDS.filter(k => k.group === g && !mine.some(it => it.kind === k.kind))
      .forEach(k => out.push({ key: k.kind, group: g, on: false, item: checkinDefaultItem(k.kind) }));
  }
  return out;
}
// Suivis à enregistrer : les lignes cochées, rubrique par rubrique, dans l'ordre choisi, nettoyées comme le serveur
// (un suivi refusé reste tel quel : deskCkErrors le signale et l'enregistrement attend)
function deskCkItems(rows) {
  return CHECKIN_GROUPS.flatMap(([g]) => rows.filter(r => r.group === g && r.on)).map(r => checkinItemClean(r.item) || r.item);
}
// Lignes d'une rubrique
const deskCkGroupRows = (rows, group) => rows.filter(r => r.group === group);

// Déplace un suivi à la position `to` (0 = premier) de sa rubrique. Rend { rows, pos (1 = premier), label, moved }
function deskCkMove(rows, key, to) {
  const row = rows.find(r => r.key === key);
  if (!row) return { rows, pos: 0, label: '', moved: false };
  const g = deskCkGroupRows(rows, row.group);
  const from = g.indexOf(row);
  const dest = Math.max(0, Math.min(g.length - 1, to));
  if (dest === from) return { rows, pos: from + 1, label: row.item.label, moved: false };
  const ng = g.filter(r => r !== row);
  ng.splice(dest, 0, row);
  const out = [];
  let done = false;
  for (const r of rows) {
    if (r.group !== row.group) out.push(r);
    else if (!done) { out.push(...ng); done = true; }
  }
  return { rows: out, pos: dest + 1, label: row.item.label, moved: true };
}
function deskCkMoveBy(rows, key, delta) {
  const row = rows.find(r => r.key === key);
  if (!row) return { rows, pos: 0, label: '', moved: false };
  return deskCkMove(rows, key, deskCkGroupRows(rows, row.group).indexOf(row) + delta);
}
// Annonce d'un déplacement pour les lecteurs d'écran : « Sommeil déplacé en position 3 »
function deskCkMoveText(r) { return r.moved ? `${r.label} déplacé en position ${r.pos}` : `${r.label} reste en position ${r.pos}`; }

// Réglages d'un suivi changés depuis l'éditeur (type, échelle, bornes, intitulé, unité, mensurations, poses,
// obligatoire) → suivi tel que le serveur le gardera ; null si refusé (intitulé vide d'une question…)
function deskCkItemPatch(item, patch) {
  const next = { ...item, ...patch };
  if (patch.options) next.options = { ...(item.options || {}), ...patch.options };
  if (patch.type && patch.type !== item.type) {
    const def = checkinKind(item.kind);
    if (patch.type === 'scale') { next.scale = item.scale || def?.scale || 5; next.lo = item.lo ?? def?.lo ?? ''; next.hi = item.hi ?? def?.hi ?? ''; }
    else { delete next.scale; delete next.lo; delete next.hi; }
    if (patch.type !== 'number') delete next.unit;
  }
  return checkinItemClean(next);
}
// Nouvelle question libre (texte, échelle, oui/non, nombre avec unité)
function deskCkNewQuestion(type, rand = Math.random) {
  return { key: checkinNewKey(rand), kind: 'custom', label: '', type: CHECKIN_CUSTOM_TYPES.includes(type) ? type : 'text', required: false,
    ...(type === 'scale' ? { scale: 5, lo: '', hi: '' } : {}), ...(type === 'number' ? { unit: '' } : {}) };
}
// Sous-titre d'une ligne : mensurations choisies, poses, bornes de l'échelle, aide du catalogue
function deskCkItemSub(item) {
  if (item.kind === 'measures') return (item.options?.keys || []).map(k => CHECKIN_MEASURE_LABELS[k] || k).join(', ');
  if (item.kind === 'photos') return (item.options?.poses || []).map(k => CHECKIN_POSE_LABELS[k] || k).join(', ');
  if (item.type === 'scale' && item.lo && item.hi) return `${item.lo} à ${item.hi}`;
  if (item.kind === 'custom') return item.type === 'number' && item.unit ? `Nombre en ${item.unit}` : '';
  return checkinKind(item.kind)?.help || '';
}

// Ce qui empêche d'enregistrer : [{ key?, text }]
function deskCkErrors(draft) {
  const out = [];
  if (!checkinLine(draft.name, CHECKIN_NAME_MAX)) out.push({ key: null, text: 'Donne un nom à ce bilan.' });
  const on = draft.rows.filter(r => r.on);
  if (!on.length) out.push({ key: null, text: 'Coche au moins un suivi.' });
  for (const r of on) {
    if (r.item.kind === 'custom' && !checkinLine(r.item.label, CHECKIN_LABEL_MAX)) out.push({ key: r.key, text: 'Écris le texte de ta question, ou décoche-la.' });
    else if (!checkinItemClean(r.item)) out.push({ key: r.key, text: `${r.item.label || 'Ce suivi'} : réglage incomplet.` });
  }
  if (on.length > CHECKIN_ITEMS_MAX) out.push({ key: null, text: `Un bilan garde ${CHECKIN_ITEMS_MAX} suivis au plus.` });
  return out;
}

// ── Éditeur : envoi (fréquence, destinataires) ──────────────

const deskCkSettingsOf = s => ({ freq: s.freq, weekday: s.weekday, monthday: s.monthday, send_hour: s.send_hour,
  remind_after_h: s.remind_after_h ?? null, due_after_h: s.due_after_h });
const deskCkSame = (a, b) => JSON.stringify(deskCkSettingsOf(a)) === JSON.stringify(deskCkSettingsOf(b));

// Brouillon de l'éditeur pour un modèle enregistré (setup : coach_checkin_setup nettoyé) ou un nouveau (template
// { id: null, name, items }, freq du modèle fourni). Réglage du bilan (base) : celui du premier planning d'un groupe,
// sinon d'un élève, sinon DESK_CK_BASE. Un destinataire dont le planning diffère garde le sien (own).
function deskCkDraft(template, setup, freq = null) {
  const scheds = (setup?.schedules || []).filter(s => template.id && s.template === template.id);
  const first = scheds.find(s => s.group) || scheds[0] || null;
  const base = first ? deskCkSettingsOf(first) : { ...DESK_CK_BASE, ...(freq ? { freq } : {}) };
  const targets = scheds.map(s => ({ type: s.group ? 'group' : 'student', id: s.group || s.student, own: deskCkSame(s, base) ? null : deskCkSettingsOf(s) }));
  return { id: template.id || null, name: template.name || '', rows: deskCkRows(template.items || []), base, targets };
}
// Empreinte comparable (changements non enregistrés)
function deskCkSnapshot(draft) {
  return JSON.stringify({ name: checkinLine(draft.name, CHECKIN_NAME_MAX), items: deskCkItems(draft.rows), base: deskCkSettingsOf(draft.base),
    targets: draft.targets.map(t => [t.type, t.id, t.own ? deskCkSettingsOf(t.own) : null]).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])) });
}
// Plan d'enregistrement : le modèle, puis un planning par destinataire (créé ou remplacé), puis les plannings des
// destinataires retirés. { template: { id, name, items }, schedules: [{ student, grp, ...réglage }], deletes: [id] }
function deskCkSavePlan(draft, setup) {
  const schedules = draft.targets.map(t => ({ student: t.type === 'student' ? t.id : null, grp: t.type === 'group' ? t.id : null, ...deskCkSettingsOf(t.own || draft.base) }));
  const deletes = (setup?.schedules || []).filter(s => draft.id && s.template === draft.id
    && !draft.targets.some(t => (t.type === 'group' ? s.group === t.id : s.student === t.id))).map(s => s.id);
  return { template: { id: draft.id, name: checkinLine(draft.name, CHECKIN_NAME_MAX), items: deskCkItems(draft.rows) }, schedules, deletes };
}
// Élèves touchés par des destinataires (groupes dépliés, élèves encore liés seulement) : ids sans doublon
function deskCkStudentsOf(targets, groups, linked = null) {
  const ids = new Set();
  for (const t of targets) {
    if (t.type === 'student') ids.add(t.id);
    else (groups || []).find(g => g.id === t.id)?.members.forEach(m => ids.add(m));
  }
  return [...ids].filter(id => !linked || linked.includes(id));
}
// Ligne d'un modèle dans la liste : fréquence lisible et nombre d'élèves
function deskCkTemplateLine(t, setup) {
  const d = deskCkDraft(t, setup);
  const n = deskCkStudentsOf(d.targets, setup?.groups).length;
  return { id: t.id, name: t.name, when: checkinScheduleText(d.base), students: n, text: n ? plural(n, 'élève', 'élèves') : 'Aucun élève' };
}

// « 1 jour après l'envoi », « 12 h après l'envoi »
function deskCkDelayText(h) { return h % 24 ? `${h} h après l'envoi` : `${plural(h / 24, 'jour', 'jours')} après l'envoi`; }
// Jour et heure d'un rappel ou d'une date limite, pour un envoi chaque semaine ou toutes les 2 semaines : « Mardi, 18 h »
function deskCkWhenText(s, addH = 0) {
  if (!s || s.freq === 'manual') return null;
  const total = s.send_hour + addH, day = Math.floor(total / 24), hour = total % 24;
  if (s.freq === 'month') { const md = s.monthday + day; return `Le ${md === 1 ? '1er' : md}, ${hour} h`; }
  const wd = CHECKIN_WEEKDAYS[(s.weekday + day) % 7];
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)}, ${hour} h`;
}
// Fréquence propre d'un élève, dans la liste « Envoyé à » : « toutes les 2 sem. »
function deskCkOverrideText(own) { return own ? DESK_CK_FREQ_OVERRIDE[own.freq] || '' : ''; }

// ── Fiche élève : bilans reçus ──────────────────────────────

// Liste de coach_student_checkins nettoyée : répondus (du plus récent), en attente, pas remplis à temps
function deskCkHistory(requests) {
  const list = (requests || []).filter(Boolean);
  const byRecent = (a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0);
  return {
    answered: list.filter(r => r.answeredAt).sort(byRecent),
    pending: list.filter(r => !r.answeredAt && !r.cancelledAt).sort(byRecent),
    missed: list.filter(r => !r.answeredAt && r.cancelledAt).sort(byRecent),
  };
}
// Début de la période d'un bilan (minuit local), sinon le jour d'envoi
function deskCkPeriodTs(r) {
  if (r.periodStart) { const [y, m, d] = r.periodStart.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
  return Number.isFinite(r.sentAt) ? deskDayStart(r.sentAt) : null;
}
// Titre d'un bilan : « Semaine 47 », et ce qui le situe : « Hebdo, reçu dim. 22 nov. »
function deskCkTitle(r, now) {
  const t = deskCkPeriodTs(r);
  const title = t === null ? r.name : `Semaine ${deskIsoWeek(t)}`;
  const when = r.answeredAt ? `reçu ${deskAgo(r.answeredAt, now)}` : r.cancelledAt ? 'pas rempli à temps' : `envoyé ${deskAgo(r.sentAt, now)}`;
  return { title, sub: `${r.name}, ${when}` };
}
// Nombre des photos envoyées dans un bilan (le web ne les déchiffre pas encore : vague 5)
function deskCkPhotoCount(r) {
  return r.items.filter(it => it.type === 'photo').reduce((a, it) => a + (r.answers[it.key]?.ids?.length || 0), 0);
}

const deskCkRound = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
// Comparaison d'un bilan « face à » un autre (prev, ou null) :
//   figures : chiffres (poids, chaque mensuration, nombres) { key, label, value, unit, delta } ;
//   answers : le reste, lisible { key, label, text, delta } (delta : écart d'une échelle de même borne) ;
//   photos : nombre des photos envoyées
function deskCkCompare(cur, prev = null) {
  const figures = [], answers = [];
  const pv = key => (prev && Object.hasOwn(prev.answers, key) ? prev.answers[key] : undefined);
  const pitem = key => prev?.items.find(i => i.key === key) || null;
  for (const it of cur.items) {
    const v = Object.hasOwn(cur.answers, it.key) ? cur.answers[it.key] : undefined;
    if (it.type === 'photo') continue;
    if (it.kind === 'measures') {
      for (const k of it.options?.keys || []) {
        if (!v || v[k] === undefined) continue;
        const p = pv(it.key)?.[k];
        figures.push({ key: `${it.key}.${k}`, label: CHECKIN_MEASURE_LABELS[k] || k, value: v[k], unit: 'cm', delta: typeof p === 'number' ? deskCkRound(v[k] - p) : null });
      }
      if (!v) answers.push({ key: it.key, label: it.label, text: 'Pas de réponse', delta: null, none: true });
      continue;
    }
    if (it.type === 'number' && v !== undefined) {
      const p = pv(it.key), pi = pitem(it.key);
      const same = pi && pi.type === 'number' && pi.unit === it.unit;
      figures.push({ key: it.key, label: it.label, value: v, unit: checkinUnitText(it), delta: same && typeof p === 'number' ? deskCkRound(v - p, it.unit === 'kg' ? 1 : 2) : null, item: it });
      continue;
    }
    if (v === undefined) { answers.push({ key: it.key, label: it.label, text: 'Pas de réponse', delta: null, none: true }); continue; }
    const p = pv(it.key), pi = pitem(it.key);
    let delta = null;
    if (pi && p !== undefined && pi.type === it.type && (it.type !== 'scale' || pi.scale === it.scale)) {
      const a = checkinValueNumber(it, v), b = checkinValueNumber(pi, p);
      if (a !== null && b !== null && it.type !== 'number') delta = a - b;
    }
    answers.push({ key: it.key, label: it.label, text: checkinValueText(it, v), delta, type: it.type });
  }
  return { figures, answers, photos: deskCkPhotoCount(cur) };
}

// ── Fiche Semaines : colonnes des bilans ────────────────────

// Colonnes : chaque suivi échelle, nombre ou automatique du bilan répondu le plus récent (sauf poids et mensurations,
// déjà dans le tableau). [{ key, label, head }]
function deskCkWeekColumns(requests) {
  const last = deskCkHistory(requests).answered[0];
  if (!last) return [];
  return last.items.filter(it => (it.type === 'scale' || it.type === 'number' || it.type === 'auto') && it.kind !== 'weight' && it.kind !== 'measures')
    .map(it => ({ key: it.key, label: it.label,
      head: it.type === 'scale' ? `${it.label} (sur ${it.scale})` : it.type === 'auto' ? `${it.label} (${it.kind === 'diet_adherence' ? 'jours' : 'séances'})` : checkinUnitText(it) ? `${it.label} (${checkinUnitText(it)})` : it.label }));
}
// Valeur de chaque colonne pour une semaine [start, end) : celle du bilan répondu dont la période commence dans la
// semaine (le plus récent s'il y en a deux). { clé: { n, text } }
function deskCkWeekValues(week, requests, cols) {
  const req = deskCkHistory(requests).answered.find(r => { const t = deskCkPeriodTs(r); return t !== null && t >= week.start && t < week.end; });
  const out = {};
  if (!req) return out;
  for (const c of cols) {
    const it = req.items.find(i => i.key === c.key);
    if (!it || !Object.hasOwn(req.answers, c.key)) continue;
    const v = req.answers[c.key], n = checkinValueNumber(it, v);
    if (n === null) continue;
    out[c.key] = { n, text: it.type === 'auto' ? `${v.done} sur ${v.of}` : it.unit === 'kg' ? CHECKIN_NF1.format(n) : CHECKIN_NF.format(n) };
  }
  return out;
}

// ── Tableau de bord : bilans reçus, à répondre ──────────────

// coach_checkins_overview nettoyé : [{ id, student, name, sentAt, dueAt, answeredAt, reviewed }]
function deskCkOverview(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.filter(r => r && typeof r === 'object' && typeof r.request_id === 'string' && typeof r.student_id === 'string').map(r => ({
    id: r.request_id, student: r.student_id, name: checkinLine(r.name, CHECKIN_NAME_MAX) || 'Bilan',
    sentAt: checkinTs(r.sent_at), dueAt: checkinTs(r.due_at), answeredAt: checkinTs(r.answered_at), reviewed: r.reviewed === true }));
}
// Bilans reçus et pas encore répondus (retour pas envoyé), du plus récent ; élèves encore dans la liste seulement
function deskCkToAnswer(ov, studentIds = null) {
  return (ov || []).filter(r => r.answeredAt && !r.reviewed && (!studentIds || studentIds.includes(r.student))).sort((a, b) => b.answeredAt - a.answeredAt);
}
// Bilans envoyés, pas encore remplis (dans les temps)
function deskCkWaiting(ov, now, studentIds = null) {
  return (ov || []).filter(r => !r.answeredAt && (r.dueAt === null || r.dueAt > now) && (!studentIds || studentIds.includes(r.student))).sort((a, b) => b.sentAt - a.sentAt);
}
// Nombre de bilans à répondre par élève : { élève: n }
function deskCkAnswerCounts(ov) {
  const out = {};
  for (const r of deskCkToAnswer(ov)) out[r.student] = (out[r.student] || 0) + 1;
  return out;
}
