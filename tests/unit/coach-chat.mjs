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

  test('messages : erreurs du serveur traduites, fonction absente reconnue', () => {
    assert.equal(run(`coachErrorKind({ code: 'P0001', message: 'empty_message' })`), 'empty_message');
    assert.equal(run(`coachErrorKind({ code: 'PGRST202', message: 'Could not find the function public.chat_threads without parameters' })`), 'missing');
    for (const k of ['empty_message', 'missing', 'too_long', 'rate_limited']) assert.match(run(`coachErrorText(${JSON.stringify(k)})`), /^[A-ZÉ].+\.$/, k);
  });
}
