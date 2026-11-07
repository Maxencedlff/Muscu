// Garde de l'appelant des fonctions Edge déployées sans vérification par la passerelle
// (verify_jwt = false dans supabase/config.toml). Preuve en deux temps :
//  1. la garde pure (_shared/auth-guard.js) refuse tout appel sans jeton valable, avec un faux
//     serveur d'authentification ;
//  2. chaque fonction listée en verify_jwt = false passe par caller() et répond 401 AVANT tout
//     travail (lecture du corps, signature d'Apple, base), et caller() délègue bien à la garde avec
//     auth.getUser (vérification du jeton par le serveur d'authentification, pas un simple décodage).
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, assert, sameJSON, ROOT }) {
  const guard = () => import(path.join(ROOT, 'supabase/functions/_shared/auth-guard.js'));
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const req = auth => ({ headers: { get: k => (k === 'Authorization' && auth !== undefined ? auth : null) } });

  test('garde de l\'appelant : sans jeton valable, aucun appelant (donc 401)', async () => {
    const { requireCaller, bearerToken } = await guard();
    const asked = [];
    // Faux serveur d'authentification : seul « bon » est un jeton valable
    const getUser = async jwt => { asked.push(jwt);
      return jwt === 'bon' ? { data: { user: { id: 'u-1' } }, error: null } : { data: { user: null }, error: { status: 401, message: 'invalid JWT' } }; };
    for (const auth of [undefined, '', 'bon', 'Basic bon', 'Bearer', 'Bearer ', 'Bearer   ', 'bearer bon']) {
      assert.equal(await requireCaller(req(auth), getUser), null, `en-tête ${JSON.stringify(auth)} accepté`);
    }
    assert.equal(asked.length, 0, 'le serveur d\'authentification ne doit même pas être appelé sans jeton');
    assert.equal(await requireCaller(req('Bearer faux'), getUser), null, 'jeton refusé par le serveur accepté');
    assert.equal(await requireCaller(req('Bearer x'), async () => { throw new Error('réseau'); }), null, 'panne : accepté');
    assert.equal(await requireCaller(req('Bearer x'), async () => ({ data: { user: {} }, error: null })), null, 'utilisateur sans id accepté');
    assert.equal(await requireCaller(req('Bearer x'), async () => null), null);
    // Erreur du serveur d'authentification, même accompagnée d'un utilisateur : refus
    assert.equal(await requireCaller(req('Bearer x'), async () => ({ data: { user: { id: 'u-1' } }, error: { status: 401 } })), null, 'erreur ignorée');
    sameJSON(await requireCaller(req('Bearer bon'), getUser), { user: { id: 'u-1' }, jwt: 'bon' });
    assert.equal(bearerToken(req('Bearer  bon ')), 'bon');
    assert.equal(bearerToken(null), null);
  });

  test('garde de l\'appelant : chaque fonction sans vérification de la passerelle répond 401 avant tout travail', () => {
    const config = read('supabase/config.toml');
    const open = [...config.matchAll(/\[functions\.([a-z-]+)\]\s*\n(?:#[^\n]*\n)*verify_jwt = false/g)].map(m => m[1]);
    for (const f of ['delete-account', 'revoke-apple', 'report', 'verify-purchase', 'push-send', 'coach-photos-purge']) {
      assert.ok(open.includes(f), `${f} : verify_jwt = false absent de config.toml`);
    }
    const GUARD = /const who = await caller\(req\);\s*\n\s*if \(!who\) return json\(\{ error: 'auth' \}, 401\);/;
    const WORK = /req\.json|bodyJws|bodyCode|verifyAppleJws|adminClient|rpc\(|fetch\(/;
    // Seule exception : strava-connect (docs/STRAVA.md). Son POST (start) passe par la garde ; son GET (finish)
    // est le retour de Strava dans Safari, sans jeton de session : c'est l'état OAuth à usage unique qui désigne
    // le compte, vérifié avant tout travail.
    const OAUTH_RETURN = { 'strava-connect': { post: 'start', get: 'finish', check: 'stateLooksValid(state)' } };
    // Autre exception : push-send (docs/NOTIFICATIONS.md). Jamais appelée par l'app, seulement par la
    // planification de la base (pg_cron + pg_net), qui n'a pas de jeton de session : c'est un secret partagé
    // (PUSH_CRON_SECRET, en-tête x-push-secret, comparé en temps constant par sameSecret) qui ouvre la porte,
    // vérifié en premier ; secret absent du projet = 401 aussi (jamais une porte ouverte par oubli).
    const SHARED_SECRET = {
      'push-send': {
        read: "const secret = env('PUSH_CRON_SECRET');",
        check: "if (!secret || !sameSecret(req.headers.get('x-push-secret'), secret)) return json({ error: 'auth' }, 401);",
        policy: 'push-policy.js',
      },
      // Purge des photos de bilan (docs/PHOTOS_BILAN.md) : même modèle, secret PHOTOS_PURGE_SECRET
      'coach-photos-purge': {
        read: "const secret = env('PHOTOS_PURGE_SECRET');",
        check: "if (!secret || !sameSecret(req.headers.get('x-purge-secret'), secret)) return json({ error: 'auth' }, 401);",
        policy: 'purge-policy.js',
      },
    };
    for (const f of open) {
      const src = read(`supabase/functions/${f}/index.ts`);
      const handler = src.slice(src.indexOf('Deno.serve('));
      assert.ok(handler.length > 20, `${f} : Deno.serve introuvable`);
      const shared = SHARED_SECRET[f];
      if (shared) {
        const at = handler.indexOf(shared.check);
        assert.ok(handler.includes(shared.read) && at > 0, `${f} : pas de refus 401 par le secret partagé`);
        assert.ok(!WORK.test(handler.slice(0, at)), `${f} : du travail avant la vérification du secret`);
        assert.ok(new RegExp(`^import \\{[^}]*\\bsameSecret\\b[^}]*\\} from '\\./${shared.policy.replace('.', '\\.')}';$`, 'm').test(src), `${f} : sameSecret ne vient pas de ${shared.policy}`);
        continue;
      }
      const ex = OAUTH_RETURN[f];
      if (ex) {
        const serve = handler.slice(0, handler.indexOf('\n});') + 4);
        assert.ok(serve.includes(`if (req.method === 'POST') return ${ex.post}(req);`)
          && serve.includes(`if (req.method === 'GET') return ${ex.get}(new URL(req.url));`), `${f} : aiguillage POST / GET inattendu`);
        assert.ok(!WORK.test(serve), `${f} : du travail dans Deno.serve`);
        const post = src.slice(src.indexOf(`async function ${ex.post}(req: Request)`));
        const at = post.search(GUARD);
        assert.ok(at > 0 && !WORK.test(post.slice(0, at)), `${f} : ${ex.post} sans refus 401 par caller() en premier`);
        const get = src.slice(src.indexOf(`async function ${ex.get}(url: URL)`));
        const checkAt = get.indexOf(ex.check);
        assert.ok(checkAt > 0 && !WORK.test(get.slice(0, checkAt)), `${f} : ${ex.get} travaille avant de vérifier l'état OAuth`);
        continue;
      }
      const guardAt = handler.search(GUARD);
      assert.ok(guardAt > 0, `${f} : pas de refus 401 par caller()`);
      // Rien avant la garde, sauf OPTIONS (CORS) et la méthode
      assert.ok(!WORK.test(handler.slice(0, guardAt)), `${f} : du travail avant la garde`);
    }
    // caller() délègue à la garde, avec auth.getUser (vérification par le serveur d'authentification)
    const http = read('supabase/functions/_shared/http.ts');
    assert.ok(/import \{ requireCaller \} from '\.\/auth-guard\.js'/.test(http));
    assert.ok(/const found = await requireCaller\(req, \(jwt: string\) => \{[\s\S]{0,400}asUser\.auth\.getUser\(jwt\)/.test(http), 'caller ne vérifie pas le jeton par auth.getUser');
    assert.ok(/if \(!found\) return null;/.test(http));
  });
}
