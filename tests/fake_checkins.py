"""Faux serveur des bilans configurables (docs/BILANS.md, supabase/migrations/20261125010000_bilans_coach.sql).

FAKE_CHECKINS est injecté APRÈS FAKE_ACCOUNT (tests/fake_account.py) : il pose ses RPC sur __sb.extraRpc (aiguillées
par callCoach, avec __sb.fail.checkins = 'missing' pour un serveur sans la migration ou 'offline'), et efface tout ce
qui touche un élève quand son lien se rompt (__sb.onUnlink). Les règles de validation sont celles de
js/data/checkins.js (checkinItemsClean, checkinValueClean, résolues à l'appel : la page les a chargées) ; le serveur
réel applique les mêmes, vérifiées par tests/sql/bilans_coach_test.sql.

État dans __sb.ck : templates, groups, schedules, requests, answers ({ requête: { clé: valeur } }), reviews
({ requête: { reply, score, reviewed_at, sent_at } }), cycle ({ élève: { coach, at } }), health (accord daté des bilans,
20261127030000_bilans_accord_majeur.sql : { élève: { coach, version, at } } ; sans lui, aucun envoi ; libido et cycle
rendus seulement après « 18 ans ou plus », __sb.co.adults ou accord du cycle), sends (envois « À la
demande », 30 par 24 h), push (notifications mises en file : { recipient, kind, ref }).
Aides : __sb.ckTemplate(coach, { name, items }) crée un modèle ; __sb.ckRequest(coach, student, { name, items,
sentAt, dueAt, periodStart, template }) une demande ; __sb.ckAnswer(id, answers, at) y répond ;
__sb.ckReview(id, { reply, score, sent }) pose le retour du coach ; __sb.ckHealth(élève) donne l'accord daté.
"""

FAKE_CHECKINS = r"""
(() => {
  const sb = window.__sb;
  if (!sb) return;
  const now = () => Date.now();
  const iso = t => new Date(t).toISOString();
  const uuid = () => crypto.randomUUID();
  const err = message => ({ data: null, error: { code: 'P0001', message, details: null, hint: null } });
  const ck = sb.ck = { templates: [], groups: [], members: [], schedules: [], requests: [], answers: {}, reviews: {}, cycle: {}, health: {}, sends: [], push: [] };
  const HEALTH_VERSION = 1, ADULT_KINDS = ['libido', 'cycle'];
  const isAdult = me => !!sb.co.adults?.[me] || !!ck.cycle[me];
  const shown = (it, me) => (!ADULT_KINDS.includes(it.kind) || isAdult(me)) && (it.kind !== 'cycle' || !!ck.cycle[me]);
  const healthOk = (me, coach) => ck.health[me]?.coach === coach && ck.health[me].version >= HEALTH_VERSION;
  const healthJson = me => { const h = ck.health[me]; return { consented: !!h && h.version >= HEALTH_VERSION, version: h?.version ?? null, current: HEALTH_VERSION, at: h ? iso(h.at) : null }; };
  sb.ckHealth = student => { ck.health[student] = { coach: sb.linkOf(student)?.coach, version: HEALTH_VERSION, at: now() }; };
  const isCoach = id => !!sb.co.coachAt[id];
  const myStudent = (me, s) => { const l = sb.linkOf(s); return !!(l && l.coach === me) && !sb.blockedBetween(me, s); };
  const linked = (coach, s) => { const l = sb.linkOf(s); return !!(l && l.coach === coach); };
  const tplJson = t => ({ id: t.id, name: t.name, items: t.items, version: t.version, created_at: iso(t.created), updated_at: iso(t.updated) });
  const open = r => !r.answered_at && !r.cancelled_at;
  const membersOf = g => ck.members.filter(m => m.group === g.id && linked(g.coach, m.student)).map(m => m.student);
  const reviewOf = (id, forStudent) => {
    const v = ck.reviews[id];
    if (!v) return null;
    if (forStudent) return v.sent_at ? { reply: v.reply, reviewed_at: iso(v.sent_at) } : null;
    return { reply: v.reply, score: v.score, reviewed_at: iso(v.reviewed_at), sent: !!v.sent_at };
  };
  const reqJson = (r, forStudent) => {
    const items = forStudent ? r.items.filter(i => shown(i, r.student)) : r.items;
    const base = { id: r.id, name: r.name, items, period_start: r.period_start, sent_at: iso(r.sent_at), due_at: r.due_at ? iso(r.due_at) : null,
      answered_at: r.answered_at ? iso(r.answered_at) : null, review: reviewOf(r.id, forStudent) };
    if (forStudent) return { ...base, coach_id: r.coach };
    return { ...base, template_id: r.template, student_id: r.student, cancelled_at: r.cancelled_at ? iso(r.cancelled_at) : null, answers: ck.answers[r.id] || {} };
  };
  const pushTo = (recipient, kind, actor, ref) => ck.push.push({ recipient, kind, actor, ref, at: now() });
  const periodOf = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const makeRequest = (coach, student, { name, items, template = null, sentAt = now(), dueAt = null, periodStart = null, schedule = null }) => {
    const r = { id: uuid(), coach, student, template, schedule, name, items: checkinItemsClean(items), version: 1,
      period_start: periodStart || periodOf(sentAt), sent_at: sentAt, due_at: dueAt ?? sentAt + 48 * 3600e3, answered_at: null, cancelled_at: null };
    ck.requests.push(r);
    pushTo(student, 'checkin', coach, r.id);
    return r;
  };
  sb.ckTemplate = (coach, { name, items }) => { const t = { id: uuid(), coach, name, items: checkinItemsClean(items), version: 1, created: now(), updated: now() }; ck.templates.push(t); return t.id; };
  sb.ckRequest = (coach, student, o) => makeRequest(coach, student, o).id;
  sb.ckAnswer = (id, answers, at = now()) => { const r = ck.requests.find(x => x.id === id); ck.answers[id] = checkinAnswersClean(r.items, answers).answers; r.answered_at = at; };
  sb.ckReview = (id, { reply = '', score = null, sent = true }) => { ck.reviews[id] = { reply, score, reviewed_at: now(), sent_at: sent ? now() : null }; };
  sb.ckGroup = (coach, name, members) => { const g = { id: uuid(), coach, name }; ck.groups.push(g); members.forEach(s => ck.members.push({ group: g.id, student: s })); return g.id; };
  // Lien rompu (quitter, être retiré) : demandes, réponses, retours, accord du cycle, groupes et plannings de l'élève
  (sb.onUnlink = sb.onUnlink || []).push(student => {
    const gone = new Set(ck.requests.filter(r => r.student === student).map(r => r.id));
    ck.requests = ck.requests.filter(r => !gone.has(r.id));
    gone.forEach(id => { delete ck.answers[id]; delete ck.reviews[id]; });
    delete ck.cycle[student];
    delete ck.health[student];
    ck.members = ck.members.filter(m => m.student !== student);
    ck.schedules = ck.schedules.filter(s => s.student !== student);
  });
  const setupOf = me => ({
    templates: ck.templates.filter(t => t.coach === me).sort((a, b) => a.created - b.created).map(tplJson),
    schedules: ck.schedules.filter(s => s.coach === me).map(s => ({ id: s.id, template_id: s.template, student_id: s.student, group_id: s.group, freq: s.freq,
      weekday: s.weekday, monthday: s.monthday, send_hour: s.send_hour, timezone: s.timezone, remind_after_h: s.remind_after_h, due_after_h: s.due_after_h,
      paused: !!s.paused, next_at: s.next_at ? iso(s.next_at) : null })),
    groups: ck.groups.filter(g => g.coach === me).map(g => ({ id: g.id, name: g.name, members: membersOf(g) })),
  });
  const nextAt = s => {
    if (s.freq === 'manual' || s.paused) return null;
    const d = new Date(now()); d.setMinutes(0, 0, 0); d.setHours(s.send_hour);
    if (s.freq === 'month') { d.setDate(s.monthday); if (d.getTime() <= now()) d.setMonth(d.getMonth() + 1); return d.getTime(); }
    while (d.getDay() !== s.weekday || d.getTime() <= now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  };
  sb.extraRpc = {
    coach_checkin_setup: me => (isCoach(me) ? setupOf(me) : err('not_coach')),
    coach_template_save: (me, { id = null, name = '', items = [] }) => {
      if (!isCoach(me)) return err('not_coach');
      const clean = checkinItemsClean(items);
      const n = checkinLine(name, CHECKIN_NAME_MAX);
      if (!n || !Array.isArray(items) || !clean.length || clean.length !== items.length) return err('invalid_template');
      let t = id ? ck.templates.find(x => x.id === id && x.coach === me) : null;
      if (id && !t) return err('not_found');
      if (!t) {
        if (ck.templates.filter(x => x.coach === me).length >= CHECKIN_TEMPLATES_MAX) return err('too_many');
        t = { id: uuid(), coach: me, name: n, items: clean, version: 1, created: now(), updated: now() }; ck.templates.push(t);
      } else {
        if (JSON.stringify(t.items) !== JSON.stringify(clean)) t.version += 1;
        Object.assign(t, { name: n, items: clean, updated: now() });
      }
      return tplJson(t);
    },
    coach_template_duplicate: (me, { id }) => {
      if (!isCoach(me)) return err('not_coach');
      const t = ck.templates.find(x => x.id === id && x.coach === me);
      if (!t) return err('not_found');
      if (ck.templates.filter(x => x.coach === me).length >= CHECKIN_TEMPLATES_MAX) return err('too_many');
      const c = { ...t, id: uuid(), name: Array.from(`Copie de ${t.name}`).slice(0, CHECKIN_NAME_MAX).join(''), version: 1, created: now(), updated: now(), items: JSON.parse(JSON.stringify(t.items)) };
      ck.templates.push(c);
      return tplJson(c);
    },
    coach_template_delete: (me, { id }) => {
      if (!isCoach(me)) return err('not_coach');
      ck.templates = ck.templates.filter(x => !(x.id === id && x.coach === me));
      ck.schedules = ck.schedules.filter(s => !(s.template === id && s.coach === me));
      ck.requests.forEach(r => { if (r.template === id && r.coach === me) r.template = null; });
      return null;
    },
    coach_group_save: (me, { id = null, name = '', members = [] }) => {
      if (!isCoach(me)) return err('not_coach');
      const n = checkinLine(name, CHECKIN_GROUP_NAME_MAX);
      if (!n) return err('invalid_group');
      let g = id ? ck.groups.find(x => x.id === id && x.coach === me) : null;
      if (id && !g) return err('not_found');
      if (!g) { if (ck.groups.filter(x => x.coach === me).length >= 50) return err('too_many'); g = { id: uuid(), coach: me, name: n }; ck.groups.push(g); }
      g.name = n;
      ck.members = ck.members.filter(m => m.group !== g.id);
      [...new Set(members || [])].filter(s => linked(me, s)).slice(0, 500).forEach(s => ck.members.push({ group: g.id, student: s }));
      return { id: g.id, name: g.name, members: membersOf(g) };
    },
    coach_group_delete: (me, { id }) => {
      if (!isCoach(me)) return err('not_coach');
      ck.groups = ck.groups.filter(g => !(g.id === id && g.coach === me));
      ck.members = ck.members.filter(m => m.group !== id);
      ck.schedules = ck.schedules.filter(s => s.group !== id);
      return null;
    },
    coach_schedule_save: (me, a) => {
      if (!isCoach(me)) return err('not_coach');
      const t = ck.templates.find(x => x.id === a.template && x.coach === me);
      if (!t) return err('not_found');
      if (!a.student === !a.grp) return err('invalid_schedule');
      if (a.student && !linked(me, a.student)) return err('not_found');
      if (a.grp && !ck.groups.some(g => g.id === a.grp && g.coach === me)) return err('not_found');
      if (!CHECKIN_FREQS.some(([k]) => k === a.freq)) return err('invalid_schedule');
      const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
      if (!int(a.weekday, 0, 6) || !int(a.monthday, 1, 28) || !int(a.send_hour, 0, 23) || !int(a.due_after_h, 1, 336)
        || !(a.remind_after_h === null || a.remind_after_h === undefined || int(a.remind_after_h, 1, 168))) return err('invalid_schedule');
      let s = ck.schedules.find(x => x.template === a.template && (a.student ? x.student === a.student : x.group === a.grp));
      if (!s) { s = { id: uuid(), coach: me, template: a.template, student: a.student || null, group: a.grp || null }; ck.schedules.push(s); }
      Object.assign(s, { freq: a.freq, weekday: a.weekday, monthday: a.monthday, send_hour: a.send_hour, timezone: a.timezone || 'Europe/Paris',
        remind_after_h: a.remind_after_h ?? null, due_after_h: a.due_after_h, paused: !!a.paused });
      s.next_at = nextAt(s);
      return setupOf(me).schedules.find(x => x.id === s.id);
    },
    coach_schedule_delete: (me, { id }) => { ck.schedules = ck.schedules.filter(s => !(s.id === id && s.coach === me)); return null; },
    coach_checkin_send_now: (me, { template, students = [] }) => {
      if (!isCoach(me)) return err('not_coach');
      const t = ck.templates.find(x => x.id === template && x.coach === me);
      if (!t) return err('not_found');
      ck.sends = ck.sends.filter(x => x.coach !== me || x.at > now() - 86400e3);
      if (ck.sends.filter(x => x.coach === me).length >= 30) return err('rate_limited');
      ck.sends.push({ coach: me, at: now() });
      let sent = 0;
      for (const s of [...new Set(students)]) {
        if (!myStudent(me, s)) continue;
        if (ck.requests.some(r => r.student === s && r.template === t.id && open(r))) continue;
        makeRequest(me, s, { name: t.name, items: t.items, template: t.id }); sent++;
      }
      return { sent };
    },
    coach_checkins_overview: me => {
      if (!isCoach(me)) return err('not_coach');
      return ck.requests.filter(r => r.coach === me && myStudent(me, r.student) && r.sent_at > now() - 35 * 86400e3)
        .sort((a, b) => b.sent_at - a.sent_at)
        .map(r => ({ request_id: r.id, student_id: r.student, name: r.name, sent_at: iso(r.sent_at), due_at: r.due_at ? iso(r.due_at) : null,
          answered_at: r.answered_at ? iso(r.answered_at) : null, reviewed: !!ck.reviews[r.id]?.sent_at }));
    },
    coach_student_checkins: (me, { student, lim = 26 }) => {
      if (!isCoach(me) || !myStudent(me, student)) return err('not_found');
      return ck.requests.filter(r => r.coach === me && r.student === student).sort((a, b) => b.sent_at - a.sent_at)
        .slice(0, Math.max(1, Math.min(52, lim))).map(r => reqJson(r, false));
    },
    coach_checkin_review: (me, { request, reply = '', score = null, send = false }) => {
      const r = ck.requests.find(x => x.id === request && x.coach === me);
      if (!isCoach(me) || !r || !myStudent(me, r.student)) return err('not_found');
      if (!r.answered_at) return err('not_answered');
      const t = checkinText(reply, CHECKIN_REPLY_MAX + 1);
      if (Array.from(t).length > CHECKIN_REPLY_MAX) return err('too_long');
      if (score !== null && !(Number.isInteger(score) && score >= 1 && score <= 10)) return err('invalid_score');
      if (send && !t) return err('empty_reply');
      const prev = ck.reviews[request];
      ck.reviews[request] = { reply: t, score, reviewed_at: now(), sent_at: send ? now() : prev?.sent_at || null };
      return reviewOf(request, false);
    },
    student_checkins: me => {
      const l = sb.linkOf(me);
      if (!l || sb.blockedBetween(me, l.coach)) return { requests: [], cycle: { consented: !!ck.cycle[me] }, adult: isAdult(me), adult_asked: false, health: healthJson(me) };
      const mine = ck.requests.filter(r => r.student === me && r.coach === l.coach).sort((a, b) => b.sent_at - a.sent_at);
      const list = [...mine.filter(open), ...mine.filter(r => r.answered_at).slice(0, 5)];
      // asked (proposition de l'app de l'élève, docs/BILANS.md « App iPhone (élève) ») : un bilan ouvert suit le cycle,
      // sans dire lequel ni rien montrer de plus ; l'app peut ainsi proposer l'accord dans le bilan. Faux tant que le
      // serveur ne le rend pas
      const asked = !ck.cycle[me] && isAdult(me) && sb.ckCycleAsked !== false && mine.some(r => open(r) && r.items.some(i => i.kind === 'cycle'));
      const adultAsked = !isAdult(me) && mine.some(r => open(r) && r.items.some(i => ADULT_KINDS.includes(i.kind)));
      return { requests: list.map(r => reqJson(r, true)), cycle: { consented: !!ck.cycle[me], ...(sb.ckCycleAsked === false ? {} : { asked }) },
        adult: isAdult(me), adult_asked: adultAsked, health: healthJson(me) };
    },
    student_checkin_answer: (me, { request, answers }) => {
      const r = ck.requests.find(x => x.id === request && x.student === me);
      const l = sb.linkOf(me);
      if (!r || !l || l.coach !== r.coach || sb.blockedBetween(me, r.coach)) return err('not_found');
      if (r.answered_at) return { answered_at: iso(r.answered_at) };
      if (r.cancelled_at) return err('closed');
      if (!healthOk(me, r.coach)) return err('no_health_consent');
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return err('invalid_answer');
      for (const [k, v] of Object.entries(answers)) {
        const it = r.items.find(i => i.key === k);
        if (!it || checkinValueClean(it, v) === undefined) return err('invalid_answer');
        if (ADULT_KINDS.includes(it.kind) && !isAdult(me)) return err('not_adult');
        if (it.kind === 'cycle' && !ck.cycle[me]) return err('no_consent');
        if (it.type === 'photo' && !v.ids.every(id => sb.co.photos.some(p => p.id === id && p.student === me && p.coach === r.coach && p.state === 'ready'))) return err('invalid_answer');
      }
      const { answers: clean, missing } = checkinAnswersClean(r.items.filter(i => shown(i, me)), answers);
      if (missing.length) return err('invalid_answer');
      ck.answers[r.id] = clean; r.answered_at = now();
      return { answered_at: iso(r.answered_at) };
    },
    student_checkin_cycle: (me, { accept, adult = false }) => {
      const l = sb.linkOf(me);
      if (!l) return err('not_found');
      if (accept) { if (adult !== true) return err('not_adult'); if (sb.co.adults) sb.co.adults[me] ||= iso(now()); ck.cycle[me] = { coach: l.coach, at: now() }; return { consented: true }; }
      delete ck.cycle[me];
      for (const r of ck.requests.filter(x => x.student === me)) {
        const cyc = r.items.filter(i => i.kind === 'cycle').map(i => i.key);
        if (ck.answers[r.id]) cyc.forEach(k => delete ck.answers[r.id][k]);
      }
      return { consented: false };
    },
    // Accord daté pour les bilans (version du texte en vigueur exigée) ; retrait : plus d'envoi
    student_checkin_consent: (me, { accept, version = null }) => {
      const l = sb.linkOf(me);
      if (!l || sb.blockedBetween(me, l.coach)) return err('not_found');
      if (accept) { if (version !== HEALTH_VERSION) return err('invalid_version'); ck.health[me] = { coach: l.coach, version, at: now() }; }
      else delete ck.health[me];
      return healthJson(me);
    },
  };
})();
"""
