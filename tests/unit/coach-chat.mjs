// Messages coach ↔ élève (js/data/coach-chat.js) : logique pure, sans réseau. Mêmes règles que
// supabase/migrations/20261031510000_chat_coach.sql.
export default function ({ test, run, assert, sameJSON }) {
  test('messages : texte nettoyé et compté comme le serveur', () => {
    assert.equal(run(`chatClean('\\n  Salut\\r\\n\\n\\n coach \\t')`), 'Salut\n\n coach');
    assert.equal(run(`chatProblem('   ')`), 'empty');
    assert.equal(run(`chatProblem('é'.repeat(2000))`), null);
    assert.equal(run(`chatProblem('é'.repeat(2001))`), 'too_long');
  });

  test('messages : conversation désignée sans ambiguïté', () => {
    sameJSON(run(`chatArgs(CHAT_COACH)`), {});
    sameJSON(run(`chatArgs('uid-eleve')`), { student: 'uid-eleve' });
  });

  test('messages : lignes du serveur nettoyées, fusion par identifiant', () => {
    const m = run(`cleanChatMessage({ id: '7', mine: true, body: 'Top', at: '2026-10-31T10:00:00Z', from_coach: true })`);
    sameJSON(m, { id: 7, mine: true, body: 'Top', at: Date.parse('2026-10-31T10:00:00Z') });
    assert.equal(run(`cleanChatMessage({ id: 1, body: '', at: '2026-10-31T10:00:00Z' })`), null);
    assert.equal(run(`cleanChatMessage({ id: -1, body: 'x', at: '2026-10-31T10:00:00Z' })`), null);
    assert.equal(run(`cleanChatMessage({ id: 1, body: 'x', at: 'demain' })`), null);
    const merged = run(`chatMerge([{ id: 3, body: 'c' }, { id: 1, body: 'a' }], [{ id: 2, body: 'b' }, { id: 3, body: 'c2' }])`);
    sameJSON(merged.map(x => [x.id, x.body]), [[1, 'a'], [2, 'b'], [3, 'c2']]);
  });

  test('messages : résumés et total des non-lus', () => {
    const t = run(`cleanChatThreads({ coach: { unread: 2, last: { id: 9, mine: false, body: 'Yo', at: '2026-10-31T10:00:00Z' } },
      students: [{ student_id: 'a', unread: 3, last: null }, { student_id: 'b', unread: -4 }, { unread: 9 }, null], unread: 999 })`);
    assert.equal(t.coach.unread, 2);
    assert.equal(t.coach.last.body, 'Yo');
    sameJSON(Object.keys(t.students), ['a', 'b']);
    assert.equal(t.students.b.unread, 0, 'nombre négatif : 0');
    assert.equal(t.unread, 5, 'total recalculé, pas repris du serveur');
    sameJSON(run(`cleanChatThreads(null)`), { coach: null, students: {}, unread: 0 });
  });

  test('messages : séparateurs de jour', () => {
    const now = Date.parse('2026-10-31T15:00:00');
    assert.equal(run(`chatDayLabel(${Date.parse('2026-10-31T08:00:00')}, ${now})`), 'Aujourd\'hui');
    assert.equal(run(`chatDayLabel(${Date.parse('2026-10-30T23:30:00')}, ${now})`), 'Hier');
    assert.match(run(`chatDayLabel(${Date.parse('2026-10-20T12:00:00')}, ${now})`), /^[A-Z].*20 octobre/);
  });

  // Faux serveur de messages (règles de chat_messages, chat_send, chat_mark_read, report_chat) : __srv.msgs,
  // __srv.read (marque de l'élève), __calls ; l'appareil est l'élève (conversation CHAT_COACH)
  const setup = () => run(`(() => {
    globalThis.__calls = [];
    globalThis.__srv = { msgs: [{ id: 9, from_coach: true, body: 'avant', at: '2026-10-31T10:00:00Z' }], next: 10, read: 0, reports: 0 };
    account.user = { id: 'eleve' };
    chatReset('eleve');
    const row = m => ({ id: m.id, mine: !m.from_coach, body: m.body, at: m.at });
    const answers = {
      chat_messages: a => a.after_id != null ? __srv.msgs.filter(m => m.id > a.after_id).map(row)
        : __srv.msgs.filter(m => a.before_id == null || m.id < a.before_id).slice().reverse().slice(0, 50).map(row),
      chat_send: a => { const m = { id: __srv.next++, from_coach: false, body: a.body, at: '2026-10-31T10:05:00Z' }; __srv.msgs.push(m); return row(m); },
      chat_mark_read: a => { const top = Math.max(0, ...__srv.msgs.filter(m => a.up_to == null || m.id <= a.up_to).map(m => m.id)); __srv.read = Math.max(__srv.read, top); return null; },
      report_chat: () => ++__srv.reports,
    };
    sb = {
      rpc: async (fn, args) => { __calls.push([fn, JSON.parse(JSON.stringify(args ?? null))]); return { data: answers[fn](args || {}), error: null }; },
      functions: { invoke: async (fn, o) => { __calls.push(['invoke:' + fn, o.body]); return { data: { ok: true }, error: null }; } },
    };
  })()`);
  const teardown = () => run('sb = null; account.user = null; chatReset(null); delete globalThis.__calls; delete globalThis.__srv;');
  const coachSends = body => run(`__srv.msgs.push({ id: __srv.next++, from_coach: true, body: ${JSON.stringify(body)}, at: '2026-10-31T10:04:00Z' })`);
  const shown = () => run('chatConv(CHAT_COACH).rows.map(m => m.body)');

  test('messages : un message de l\'autre arrivé juste avant ma réponse est relu, jamais marqué lu sans être reçu', async () => {
    try {
      setup();
      await run('chatLoad(CHAT_COACH)');
      sameJSON(shown(), ['avant']);
      // Le coach écrit entre deux relectures (15 s), l'élève répond avant la relecture suivante
      coachSends('MESSAGE DU COACH');
      sameJSON((await run(`chatSend(CHAT_COACH, 'ma réponse')`)).ok, true);
      sameJSON(shown(), ['avant', 'ma réponse'], 'mon message affiché tout de suite');
      assert.equal(run('chatConv(CHAT_COACH).cursor'), 9, 'mon envoi n\'avance pas le curseur');
      // Avant la relecture, marquer lu ne va pas au-delà de ce qui a été reçu
      await run('chatMarkRead(CHAT_COACH, { force: true })');
      sameJSON(run('__calls').at(-1), ['chat_mark_read', { up_to: 9 }]);
      assert.equal(run('__srv.read'), 9, 'le message du coach jamais reçu reste non lu');
      // Relecture : after_id = dernier reçu du serveur, le message du coach revient à sa place
      const r = await run('chatPoll(CHAT_COACH)');
      sameJSON(run('__calls').filter(c => c[0] === 'chat_messages').at(-1)[1], { after_id: 9 });
      sameJSON(r, { ok: true, added: 1, theirs: 1 }, 'un seul nouveau : le mien n\'est pas compté deux fois');
      sameJSON(shown(), ['avant', 'MESSAGE DU COACH', 'ma réponse']);
      await run('chatMarkRead(CHAT_COACH, { force: true })');
      assert.equal(run('__srv.read'), 11, 'reçu : marqué lu');
      // Relecture sans nouveauté : rien d'ajouté
      sameJSON(await run('chatPoll(CHAT_COACH)'), { ok: true, added: 0, theirs: 0 });
    } finally { teardown(); }
  });

  test('messages : le premier message de l\'autre dans une conversation vide ouverte est marqué lu à la relecture', async () => {
    try {
      setup();
      run('__srv.msgs = []');
      sameJSON(await run('chatLoad(CHAT_COACH)'), { ok: true });
      await run('chatMarkRead(CHAT_COACH, { force: true })');
      assert.equal(run('__srv.read'), 0);
      coachSends('Salut');
      const r = await run('chatPoll(CHAT_COACH)');
      sameJSON(r, { ok: true, added: 1, theirs: 1 }, 'chemin conversation vide : theirs compté');
      sameJSON(shown(), ['Salut']);
      // Ce que fait chatTick quand la conversation est à l'écran
      if (r.theirs) await run('chatMarkRead(CHAT_COACH, { force: true })');
      assert.equal(run('__srv.read'), 10, 'premier message du coach marqué lu');
      sameJSON(await run('chatPoll(CHAT_COACH)'), { ok: true, added: 0, theirs: 0 });
    } finally { teardown(); }
  });

  test('messages : rouvrir une conversation remontée jusqu\'au début rend les anciens messages à nouveau accessibles', async () => {
    try {
      setup();
      run(`__srv.msgs = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, from_coach: i % 2 === 0, body: 'm' + (i + 1), at: '2026-10-31T10:00:00Z' })); __srv.next = 121`);
      const state = () => run('(c => ({ n: c.rows.length, first: c.rows[0].id, end: c.end }))(chatConv(CHAT_COACH))');
      await run('chatLoad(CHAT_COACH)');
      sameJSON(state(), { n: 50, first: 71, end: false });
      await run('chatLoad(CHAT_COACH, { more: true })');
      await run('chatLoad(CHAT_COACH, { more: true })');
      sameJSON(state(), { n: 120, first: 1, end: true }, 'remontée complète');
      // Retour à la fiche puis réouverture : la première page remplace la liste, le bouton revient
      await run('chatLoad(CHAT_COACH)');
      sameJSON(state(), { n: 50, first: 71, end: false }, 'messages plus anciens encore à charger');
      await run('chatLoad(CHAT_COACH, { more: true })');
      sameJSON(state(), { n: 100, first: 21, end: false });
    } finally { teardown(); }
  });

  test('messages : signaler copie les messages côté serveur puis demande l\'alerte', async () => {
    try {
      setup();
      await run('chatLoad(CHAT_COACH)');
      sameJSON(await run(`chatReport(CHAT_COACH, 'insulte')`), { ok: false, kind: 'server' }, 'motif inconnu : rien envoyé');
      sameJSON(await run(`chatReport(CHAT_COACH, 'harcelement')`), { ok: true });
      await new Promise(r => setTimeout(r, 0));
      // Seuls les appels du signalement : d'autres lectures de fond (my_access, coach_state) peuvent
      // s'intercaler selon le moment où leurs minuteries se déclenchent (test instable avant le 06/11/2026)
      const calls = run('__calls').filter(([n]) => n === 'report_chat' || n === 'invoke:report').slice(-2);
      sameJSON(calls, [['report_chat', { reason: 'harcelement' }], ['invoke:report', { report_id: 1 }]]);
      run(`sb.rpc = async () => ({ data: null, error: { code: 'P0001', message: 'rate_limited' } })`);
      sameJSON(await run(`chatReport(CHAT_COACH, 'spam')`), { ok: false, kind: 'report_rate' });
    } finally { teardown(); }
  });

  test('messages : erreurs du serveur traduites, fonction absente reconnue', () => {
    assert.equal(run(`coachErrorKind({ code: 'P0001', message: 'empty_message' })`), 'empty_message');
    assert.equal(run(`coachErrorKind({ code: 'PGRST202', message: 'Could not find the function public.chat_threads without parameters' })`), 'missing');
    for (const k of ['empty_message', 'missing', 'too_long', 'rate_limited']) assert.match(run(`coachErrorText(${JSON.stringify(k)})`), /^[A-ZÉ].+\.$/, k);
  });
}
