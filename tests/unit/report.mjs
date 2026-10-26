// Social V1 : règles de la fonction serveur report (supabase/functions/report/report-policy.js) :
// validation de l'entrée, e-mail d'alerte, cohérence avec les contraintes de public.reports.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, assert, sameJSON, ROOT }) {
  const load = () => import(path.join(ROOT, 'supabase/functions/report/report-policy.js'));
  const me = '11111111-1111-4111-8111-111111111111';
  const target = '22222222-2222-4222-8222-222222222222';
  const base = { target_user: target, kind: 'profile', reason: 'spam' };

  test('report : entrée valide, nettoyée, clés inconnues jamais recopiées', async () => {
    const { validateReport } = await load();
    sameJSON(validateReport(base, me), { ok: true, value: { target_user: target, kind: 'profile', target_ref: null, reason: 'spam', details: null } });
    const r = validateReport({ ...base, target_user: target.toUpperCase(), kind: 'session', target_ref: '  s-123 ', details: '  Insultes répétées  ', reporter_id: 'pirate', created_at: '2000-01-01' }, me);
    sameJSON(r, { ok: true, value: { target_user: target, kind: 'session', target_ref: 's-123', reason: 'spam', details: 'Insultes répétées' } });
    sameJSON(validateReport({ ...base, details: '   ', target_ref: '' }, me).value, { target_user: target, kind: 'profile', target_ref: null, reason: 'spam', details: null }, 'vides → null');
    for (const reason of ['spam', 'harcelement', 'sexuel', 'violence', 'haine', 'autre']) assert.equal(validateReport({ ...base, reason }, me).ok, true, reason);
  });

  test('report : entrée refusée (champ en cause), soi-même compris', async () => {
    const { validateReport, DETAILS_MAX } = await load();
    const field = (b) => { const r = validateReport(b, me); assert.equal(r.ok, false); assert.equal(r.error, 'invalid'); return r.field; };
    assert.equal(field(null), 'body');
    assert.equal(field([base]), 'body');
    assert.equal(field('texte'), 'body');
    assert.equal(field({ ...base, target_user: 'pas-un-uuid' }), 'target_user');
    assert.equal(field({ ...base, target_user: me }), 'target_user', 'se signaler soi-même');
    assert.equal(field({ ...base, target_user: me.toUpperCase() }), 'target_user', 'soi-même en majuscules');
    assert.equal(field({ ...base, kind: 'message' }), 'kind');
    assert.equal(field({ ...base, kind: 'toString' }), 'kind', 'clé héritée d\'Object');
    assert.equal(field({ ...base, reason: 'insulte' }), 'reason');
    assert.equal(field({ ...base, reason: '__proto__' }), 'reason');
    assert.equal(field({ ...base, target_ref: 42 }), 'target_ref');
    assert.equal(field({ ...base, target_ref: 'x'.repeat(65) }), 'target_ref');
    assert.equal(field({ ...base, details: { texte: 'x' } }), 'details');
    assert.equal(field({ ...base, details: 'x'.repeat(DETAILS_MAX + 1) }), 'details');
    // 500 caractères comptés comme Postgres (points de code) : 500 emojis passent
    assert.equal(validateReport({ ...base, details: '🦊'.repeat(DETAILS_MAX) }, me).ok, true);
  });

  test('report : e-mail d\'alerte en français, sans tiret en début de ligne', async () => {
    const { reportEmail } = await load();
    const row = { id: 7, reporter_id: me, target_user: target, target_username: 'bruno.s1', kind: 'session', target_ref: 's-123',
      reason: 'harcelement', details: 'Ligne 1\n- Ligne 2\r\nfin', created_at: '2026-10-26T10:00:00+00:00' };
    const { subject, text } = reportEmail(row);
    assert.equal(subject, 'Signalement : @bruno.s1, harcèlement');
    assert.ok(!/[\r\n]/.test(subject), 'objet sur une ligne');
    for (const want of ['@bruno.s1', 'Motif : Harcèlement', 'Type : Séance', 'Référence : s-123', 'sous 24 h', 'Détails : Ligne 1 - Ligne 2 fin', 'n° 7'])
      assert.ok(text.includes(want), want);
    assert.ok(!text.split('\n').some((l) => /^\s*[-–—]/.test(l)), 'aucune ligne ne commence par un tiret');
    const bare = reportEmail({ ...row, target_username: null, target_ref: null, details: null, kind: 'profile', reason: 'autre' });
    for (const want of ['compte sans pseudo', 'Référence : aucune', 'Détails : aucun', 'Type : Profil', 'Motif : Autre'])
      assert.ok(bare.text.includes(want), want);
  });

  test('report : mêmes listes et bornes que la table public.reports', async () => {
    const { REPORT_REASONS, REPORT_KINDS, DETAILS_MAX, TARGET_REF_MAX, REPORTS_PER_DAY } = await load();
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261026050000_social.sql'), 'utf8');
    const list = (re) => [...sql.match(re)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    sameJSON(list(/reason\s+text not null check \(reason in \(([^)]*)\)/), Object.keys(REPORT_REASONS));
    sameJSON(list(/kind\s+text not null check \(kind in \(([^)]*)\)/), Object.keys(REPORT_KINDS));
    assert.ok(sql.includes(`char_length(details) <= ${DETAILS_MAX}`));
    assert.ok(sql.includes(`char_length(target_ref) between 1 and ${TARGET_REF_MAX}`));
    assert.ok(sql.includes(`>= ${REPORTS_PER_DAY} then`));
    // Même liste que le contrat
    const doc = fs.readFileSync(path.join(ROOT, 'docs/SOCIAL_V1.md'), 'utf8');
    sameJSON([...doc.match(/reason: ([^,]*?), details/)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]), Object.keys(REPORT_REASONS));
  });
}
