// Fonction serveur coach-photos-purge (supabase/functions/coach-photos-purge/purge-policy.js) : secret de la
// planification, chemins acceptés, tour d'effacement. Secrets et chemins factices.
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, assert, sameJSON, ROOT }) {
  const load = () => import(path.join(ROOT, 'supabase/functions/coach-photos-purge/purge-policy.js'));
  const S = '00000000-0000-0000-0000-0000000000e1', P = '0d9c3f0e-6a52-4bfb-9a51-6b1f6d9e2a10';

  test('purge des photos : secret comparé en entier, chemins « élève/photo » seulement', async () => {
    const { sameSecret, purgePaths } = await load();
    assert.equal(sameSecret('secret-factice-1', 'secret-factice-1'), true);
    assert.equal(sameSecret('secret-factice-1', 'secret-factice-2'), false);
    assert.equal(sameSecret('', ''), false, 'secret vide');
    assert.equal(sameSecret(null, 'x'), false);
    sameJSON(purgePaths([`${S}/${P}`, `${S}/${P}`, { srv_coach_photo_purge_claim: `${S}/${P.replace('0d', '1d')}` }]), [`${S}/${P}`, `${S}/${P.replace('0d', '1d')}`]);
    sameJSON(purgePaths([`${S}/../avatars/x`, `${S}`, `${S}/${P}/x`, '*', '', null, 42]), []);
    sameJSON(purgePaths(null), []);
  });

  test('purge des photos : soldé seulement après l\'effacement par l\'API Storage', async () => {
    const { purgeRound } = await load();
    const log = [];
    const ok = await purgeRound({ claim: async () => [`${S}/${P}`, 'mauvais'], remove: async p => { log.push(['remove', p]); return { ok: true }; }, done: async p => { log.push(['done', p]); } });
    sameJSON(ok, { taken: 1, removed: 1, failed: false });
    sameJSON(log, [['remove', [`${S}/${P}`]], ['done', [`${S}/${P}`]]]);
    log.length = 0;
    const ko = await purgeRound({ claim: async () => [`${S}/${P}`], remove: async () => ({ ok: false }), done: async p => { log.push(['done', p]); } });
    sameJSON(ko, { taken: 1, removed: 0, failed: true });
    assert.equal(log.length, 0, 'rien de soldé si l\'effacement échoue');
    sameJSON(await purgeRound({ claim: async () => [], remove: async () => { throw new Error('jamais'); }, done: async () => {} }), { taken: 0, removed: 0, failed: false });
  });

  test('purge des photos : planification déclarée (config.toml), migration et fonction d\'accord', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
    assert.match(cfg, /\[functions\.coach-photos-purge\]\s*\n(#.*\n)*verify_jwt = false/);
    const idx = fs.readFileSync(path.join(ROOT, 'supabase/functions/coach-photos-purge/index.ts'), 'utf8');
    assert.match(idx, /x-purge-secret/);
    assert.match(idx, /srv_coach_photo_purge_claim/);
    assert.match(idx, /srv_coach_photo_purge_done/);
    const mig = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261107000000_photos_bilan.sql'), 'utf8');
    assert.match(mig, /grant execute on function public\.srv_coach_photo_purge_claim\(int\) to service_role;/);
    const del = fs.readFileSync(path.join(ROOT, 'supabase/functions/delete-account/index.ts'), 'utf8');
    assert.ok(del.indexOf('removeCoachPhotos(user.id)') > 0 && del.indexOf('removeCoachPhotos(user.id)') < del.indexOf('deleteUser(user.id)'), 'fichiers effacés avant le compte');
  });
}
