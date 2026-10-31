// Commentaires (js/data/comments.js) et leur ligne d'activité (js/data/social.js) : logique pure,
// sans réseau. Mêmes règles que supabase/migrations/20261031500000_commentaires.sql.
export default function ({ test, run, assert, sameJSON }) {
  test('commentaires : texte nettoyé et compté comme le serveur', () => {
    assert.equal(run(`commentClean('  Bravo\\r\\n\\n\\n\\nla perf  ')`), 'Bravo\n\nla perf');
    assert.equal(run(`commentClean(null)`), '');
    assert.equal(run(`commentProblem(' \\n\\t ')`), 'empty');
    // Caractères, pas unités UTF-16 : 500 emojis passent, 501 non
    assert.equal(run(`commentProblem('💪'.repeat(500))`), null);
    assert.equal(run(`commentProblem('a'.repeat(501))`), 'too_long');
    assert.equal(run(`commentLength('  é  ')`), 1);
  });

  test('commentaires : ligne du serveur nettoyée, inutilisable écartée', () => {
    const c = run(`cleanComment({ id: 12, user_id: 'u1', username: 'lea', avatar: '🦁', body: 'Top', at: '2026-10-31T10:00:00Z', mine: false, can_delete: true, masked: false, extra: 1 })`);
    sameJSON(Object.keys(c).sort(), ['at', 'avatar', 'body', 'canDelete', 'id', 'masked', 'mine', 'user_id', 'username']);
    assert.equal(c.canDelete, true);
    assert.equal(c.at, Date.parse('2026-10-31T10:00:00Z'));
    // Pseudo hors forme, avatar hors liste : initiale ; texte jamais réinterprété (échappé à l'affichage)
    const odd = run(`cleanComment({ id: '3', user_id: 'u2', username: '<b>x</b>', avatar: '💩', body: '<img src=x>', at: '2026-10-31T10:00:00Z', mine: 'true' })`);
    assert.equal(odd.username, null);
    assert.equal(odd.avatar, null);
    assert.equal(odd.mine, false, 'mine : true seulement');
    assert.equal(odd.body, '<img src=x>');
    for (const bad of ['null', `{ id: 0, user_id: 'u', body: 'x', at: '2026-10-31T10:00:00Z' }`, `{ id: 1, body: 'x', at: '2026-10-31T10:00:00Z' }`,
      `{ id: 1, user_id: 'u', body: '', at: '2026-10-31T10:00:00Z' }`, `{ id: 1, user_id: 'u', body: 'x', at: 'hier' }`]) {
      assert.equal(run(`cleanComment(${bad})`), null, bad);
    }
    // Texte trop long venu du serveur : coupé à 500 caractères
    assert.equal(run(`[...cleanComment({ id: 1, user_id: 'u', body: '🔥'.repeat(600), at: '2026-10-31T10:00:00Z' }).body].length`), 500);
  });

  test('commentaires : erreurs du serveur traduites', () => {
    const kinds = run(`['empty_comment', 'too_long', 'comment_forbidden', 'invalid_reason'].map(m => socialErrorKind({ code: 'P0001', message: m }))`);
    sameJSON(kinds, ['empty_comment', 'too_long', 'comment_forbidden', 'invalid_reason']);
    for (const k of kinds) assert.match(run(`socialErrorText(${JSON.stringify(k)})`), /^[A-ZÉ].+\.$/, k);
  });

  test('activité : ligne « comment » (texte, clé de départage par commentaire)', () => {
    const a = run(`cleanActivityRow({ kind: 'comment', user_id: 'u1', username: 'lea', at: '2026-10-31T10:00:00.123456+00:00', session_id: 's1',
      session_label: 'Legs', comment_id: 42, comment_text: 'Belle   séance\\n!', is_new: true })`);
    assert.equal(a.kind, 'comment');
    assert.equal(a.sessionId, 's1');
    assert.equal(a.commentId, 42);
    assert.equal(a.cursor.key, 'comment:u1:s1:42');
    assert.equal(a.cursor.at, '2026-10-31T10:00:00.123456+00:00', 'date gardée telle quelle (microsecondes)');
    assert.equal(run(`activityText(${JSON.stringify(a)})`), 'a commenté ta séance Legs : « Belle séance ! »');
    assert.equal(run(`activityText(${JSON.stringify(a)}, 'Jambes')`), 'a commenté ta séance Jambes : « Belle séance ! »');
    // Sans identifiant de commentaire ou de séance : écartée ; les autres sortes gardent leur clé
    assert.equal(run(`cleanActivityRow({ kind: 'comment', user_id: 'u1', at: '2026-10-31T10:00:00Z', session_id: 's1' })`), null);
    assert.equal(run(`cleanActivityRow({ kind: 'comment', user_id: 'u1', at: '2026-10-31T10:00:00Z', comment_id: 3 })`), null);
    assert.equal(run(`cleanActivityRow({ kind: 'reaction', user_id: 'u1', at: '2026-10-31T10:00:00Z', session_id: 's1', reaction: 'fire' }).cursor.key`), 'reaction:u1:s1');
    assert.equal(run(`cleanActivityRow({ kind: 'follower', user_id: 'u1', at: '2026-10-31T10:00:00Z' }).cursor.key`), 'follower:u1:');
    assert.equal(run(`cleanActivityRow({ kind: 'poke', user_id: 'u1', at: '2026-10-31T10:00:00Z' })`), null, 'sorte inconnue : écartée');
  });
}
