// ═══════════════════════════════════════════════════════════
//  Photo de profil (js/data/profile-photo.js) : recadrage, choix de l'encodage, nettoyage de ce que renvoie le
//  serveur, photos signalées sur l'appareil, droit (même règle que les fonctions Pro : verrou éteint ouvert,
//  allumé abonné ou coach) ; contrat avec la migration, la purge, la suppression du compte, sw.js, index.html et
//  privacy.html. Identifiants factices. Le parcours réel (choix d'une image, envoi, profil vu par un ami,
//  signalement) est dans tests/test_photo_profil.py.
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, app, assert, sameJSON, ROOT }) {
  const ME = '00000000-0000-4000-8000-0000000007a1', F = '00000000-0000-4000-8000-0000000007a2';
  const P1 = '0d9c3f0e-6a52-4bfb-9a51-6b1f6d9e2a10', P2 = '1d9c3f0e-6a52-4bfb-9a51-6b1f6d9e2a11';
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

  test('photo de profil : carré central, 512 px au plus, jamais agrandie', () => {
    sameJSON(app.pphCropRect(4032, 3024), { sx: 504, sy: 0, side: 3024 });
    sameJSON(app.pphCropRect(3024, 4032), { sx: 0, sy: 504, side: 3024 });
    sameJSON(app.pphCropRect(300, 300), { sx: 0, sy: 0, side: 300 });
    sameJSON(app.pphCropRect(0, NaN), { sx: 0, sy: 0, side: 1 });
    assert.equal(app.pphOutSide(3024), 512);
    assert.equal(app.pphOutSide(300), 300, 'petite image gardée telle quelle');
    assert.equal(app.pphOutSide(0), 1);
  });

  test('photo de profil : encodage retenu (première sous 64 ko, sinon la plus petite sous 256 ko)', () => {
    const t = (size, type = 'image/jpeg') => ({ size, type });
    sameJSON(app.pphPickEncoding([t(90000), t(60000), t(40000)]), t(60000));
    sameJSON(app.pphPickEncoding([t(200000), t(150000)]), t(150000));
    assert.equal(app.pphPickEncoding([t(300000)]), null, 'trop lourde');
    assert.equal(app.pphPickEncoding([t(1000, 'image/png')]), null, 'PNG refusé (le compartiment aussi)');
    sameJSON(app.pphPickEncoding([t(50000, 'image/webp')]), t(50000, 'image/webp'));
    assert.equal(app.pphPickEncoding(null), null);
  });

  test('photo de profil : état et liste du serveur nettoyés (chemin « compte/photo » exigé)', () => {
    sameJSON(app.cleanPphState({ enabled: true, allowed: true, banned: false, photo: { id: P1, path: `${ME}/${P1}`, hidden: false } }, ME),
      { enabled: true, allowed: true, banned: false, photo: { id: P1, path: `${ME}/${P1}`, hidden: false } });
    // Chemin d'un autre compte, ou forme fausse : pas de photo
    assert.equal(app.cleanPphState({ enabled: true, photo: { id: P1, path: `${F}/${P1}` } }, ME).photo, null);
    assert.equal(app.cleanPphState({ enabled: 'oui', photo: { id: '../x', path: '../x' } }, ME).enabled, false);
    assert.equal(app.cleanPphState(null, ME), null);
    assert.equal(app.cleanPphState([], ME), null);
    sameJSON(app.cleanPphList([{ user_id: F, id: P1, path: `${F}/${P1}` }, { user_id: F, id: P2, path: `${ME}/${P2}` },
      { user_id: 'x', id: P1, path: `x/${P1}` }, null, 'texte']), [{ user_id: F, id: P1, path: `${F}/${P1}` }]);
    sameJSON(app.cleanPphList({ pas: 'une liste' }), []);
  });

  test('photo de profil : erreurs du serveur lues', () => {
    assert.equal(app.pphErrorKind({ message: 'not_allowed' }), 'not_allowed');
    assert.equal(app.pphErrorKind({ message: 'banned' }), 'banned');
    assert.equal(app.pphErrorKind({ message: 'rate_limited' }), 'rate_limited');
    assert.equal(app.pphErrorKind({ code: 'PGRST202', message: 'Could not find the function public.profile_photo_state' }), 'missing');
    assert.equal(app.pphErrorKind({ message: 'TypeError: Failed to fetch' }), 'offline');
    assert.equal(app.pphErrorKind({ message: 'autre' }), 'server');
  });

  test('photo de profil : photo signalée masquée sur l\'appareil, liste bornée, identifiants seulement', () => {
    run('localStorage.removeItem(PPH_HIDDEN_KEY); pphHiddenNow.clear();');
    run(`pphHideLocally(${JSON.stringify(P1)}); pphHideLocally('pas-un-id');`);
    sameJSON(run('pphHiddenIds()'), [P1]);
    assert.equal(run(`pphIsHidden(${JSON.stringify(P1)})`), true);
    assert.equal(run(`pphIsHidden(${JSON.stringify(P2)})`), false);
    run('localStorage.setItem(PPH_HIDDEN_KEY, "{abîmé")');
    sameJSON(run('pphHiddenIds()'), [], 'stockage abîmé : rien, sans erreur');
    assert.equal(run(`pphIsHidden(${JSON.stringify(P1)})`), true, 'gardée pour ce lancement');
    run('localStorage.removeItem(PPH_HIDDEN_KEY); pphHiddenNow.clear();');
  });

  test('photo de profil : sans état du serveur (ou serveur pas à jour), aucune photo demandée', () => {
    const r = run(`(() => {
      const u = account.user;
      try {
        account.user = { id: ${JSON.stringify(ME)} };
        pphReset(account.user.id);
        const off = [profilePhotoOn(), profilePhotoUrl(${JSON.stringify(F)}), pph.queue.size];
        pph.state = cleanPphState({ enabled: true, allowed: true, photo: null }, account.user.id);
        pph.missing = true;
        return [...off, profilePhotoOn()];
      } finally { account.user = u; pphReset(u?.id || null); }
    })()`);
    sameJSON(r, [false, null, 0, false]);
  });

  test('photo de profil : droit = même règle que les fonctions Pro (verrou éteint ouvert, allumé abonné ou coach)', () => {
    const state = (o) => JSON.stringify({ status: 'none', paywall_on: true, can_write: false, gift: false, coach_team: false, server_now: Date.now(), ...o });
    const allowed = (st, { user = true, isCoach = false } = {}) => run(`(() => {
      const u = account.user, saved = { ...access }, cs = coach.state;
      try {
        account.user = ${user ? `{ id: ${JSON.stringify(ME)} }` : 'null'};
        accessReset(account.user?.id || null);
        access.state = ${st ? `cleanAccess(${st})` : 'null'};
        coach.state = { is_coach: ${isCoach}, coach: null, students: [], badge: 0 };
        return proFeatureAllowed();
      } finally { account.user = u; Object.assign(access, saved); coach.state = cs; localStorage.removeItem(ACCESS_CACHE_KEY); }
    })()`);
    assert.equal(allowed(state({ paywall_on: false })), true, 'verrou éteint : ouvert');
    assert.equal(allowed(null), true, 'état inconnu : rien ne bloque (comme canWrite)');
    assert.equal(allowed(state()), false, 'verrou allumé, sans abonnement');
    assert.equal(allowed(state({ status: 'active', can_write: true })), true, 'abonné');
    assert.equal(allowed(state(), { isCoach: true }), true, 'coach actif, sans abonnement');
    assert.equal(allowed(state({ paywall_on: false }), { user: false }), false, 'sans compte : pas de photo');
    // Une seule règle : la fonction de l'app reprend canWrite, celle du serveur access_json.can_write
    const acc = read('js/data/access.js');
    assert.match(acc, /function proFeatureAllowed\(\) \{\n\s+if \(!account\.user\) return false;\n\s+return canWrite\(\) \|\| coachRole\(\)\.isCoach === true;/);
    const ui = read('js/features/profile-photo-ui.js') + read('js/data/profile-photo.js');
    assert.ok(!/paywall_on|can_write|paywallOn\(\)|canWrite\(\)/.test(ui), 'aucune règle de droit en double dans la photo');
  });

  test('photo de profil : migration (GRANT, RLS, compartiment privé, droit unique), rollback, purge et suppression du compte', () => {
    const mig = read('supabase/migrations/20261117010000_photo_profil.sql');
    assert.match(mig, /values \('profile-photos', 'profile-photos', false, 262144, array\['image\/jpeg', 'image\/webp'\]\)/);
    assert.match(mig, /create function private\.pro_feature\(uid uuid\)[\s\S]*?private\.access_json\(uid\) ->> 'can_write'[\s\S]*?private\.is_coach\(uid\)/);
    for (const f of ['profile_photo_state()', 'profile_photo_prepare()', 'profile_photo_commit(uuid)', 'profile_photo_remove()', 'profile_photos(uuid[])']) {
      assert.ok(mig.includes(`revoke all on function public.${f} from public, anon, authenticated;`), `revoke ${f}`);
      assert.ok(mig.includes(`grant execute on function public.${f} to authenticated;`), `grant ${f}`);
    }
    assert.match(mig, /alter table public\.profile_photos enable row level security;/);
    assert.ok(!/create policy [^\n]* for update/.test(mig), 'aucune politique UPDATE (pas de remplacement de fichier)');
    assert.ok(fs.existsSync(path.join(ROOT, 'supabase/rollback/20261117010000_photo_profil_down.sql')), 'retour arrière');
    const purge = read('supabase/functions/coach-photos-purge/index.ts');
    assert.match(purge, /\{ bucket: 'profile-photos', claim: 'srv_profile_photo_purge_claim', done: 'srv_profile_photo_purge_done' \}/);
    const del = read('supabase/functions/delete-account/index.ts');
    assert.match(del, /\['coach-photos', 'profile-photos'\]/);
    // La fonction report ne change pas : une photo est signalée comme un profil, avec sa référence
    assert.match(read('js/features/profile-photo-ui.js'), /kind: 'profile', ref: `photo:\$\{id\}`/);
    assert.match(mig, /'\^photo:\[0-9a-f\]\{8\}-/);
  });

  test('photo de profil : chargée dans l\'app, mise en cache, annoncée dans la page de confidentialité', () => {
    const html = read('index.html'), sw = read('sw.js');
    const at = f => html.indexOf(`<script src="${f}"></script>`);
    assert.ok(at('js/data/profile-photo.js') > at('js/data/access.js') && at('js/data/profile-photo.js') < at('js/features/account-ui.js'), 'données avant les écrans');
    assert.ok(at('js/features/profile-photo-ui.js') > at('js/features/social-ui.js'), 'écran après le social');
    assert.match(sw, /const CACHE = 'ppl-v\d+';/, 'version du cache (montée à la publication)');
    assert.ok(sw.includes("'/js/data/profile-photo.js'") && sw.includes("'/js/features/profile-photo-ui.js'"));
    // Build 69 : les textes d'autorisation d'iOS nomment la photo de profil (règle 5.1.1, docs/PHOTO_PROFIL.md)
    const plist = read('ios/App/App/Info.plist');
    for (const k of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription']) {
      assert.match(plist, new RegExp(`<key>${k}</key>\\s*<string>[^<]*photo de profil[^<]*</string>`), `${k} : photo de profil`);
    }
    const privacy = read('privacy.html');
    const li = privacy.slice(privacy.indexOf('<li id="photo-profil">'), privacy.indexOf('</li>', privacy.indexOf('<li id="photo-profil">')));
    assert.ok(li.length > 100, 'paragraphe « Photo de profil »');
    for (const w of ['MDLF Pro', 'offerte aux coachs', 'sans la localisation', 'ton coach', 'consentement', 'Retirer la photo', 'suppression du compte', 'signalée', '24 heures'])
      assert.ok(li.includes(w), `privacy.html : ${w}`);
    assert.match(privacy, /An optional profile photo is included in MDLF Pro and free for coaches/);
  });
}
