// ═══════════════════════════════════════════════════════════
//  Site du coach, connexion Google ou Apple d'un identifiant inconnu de MDLF (docs/COACH_WEB.md, « Identifiant
//  inconnu : aucun compte laissé ») et erreurs rendues par Supabase au retour de Google :
//  - règles de la fonction serveur coach-web-orphan (orphan-policy.js) ;
//  - deskGoogleReturn : code d'erreur de Supabase traduit, adresse et ancre nettoyées, error_description jamais lu ;
//  - deskDiscardNewAccount : réponse de la fonction serveur, jamais d'identifiant envoyé ;
//  - web-public/auth-retour.js (mdlf.app) : seuls error et error_code renvoyés vers le site du coach, destination fixe ;
//  - migration et retour arrière présents, fonction déclarée dans config.toml.
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export default function ({ test, assert, ROOT }) {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const J = o => JSON.stringify(o);

  test('coach-web-orphan : candidat seulement pour un compte Google ou Apple seul, de moins de 10 minutes, jeton du même compte', async () => {
    const { orphanCandidate, claimOutcome, ORPHAN_MAX_AGE_S } = await import(path.join(ROOT, 'supabase/functions/coach-web-orphan/orphan-policy.js'));
    const nowS = 1_800_000_000, sid = '00000000-0000-4000-8000-0000000000aa', id = 'u-1';
    const at = s => new Date((nowS - s) * 1000).toISOString();
    const user = (age, ...providers) => ({ id, created_at: at(age), identities: providers.map(p => ({ provider: p })) });
    const claims = (over = {}) => ({ sub: id, session_id: sid, ...over });
    assert.equal(ORPHAN_MAX_AGE_S, 600);
    assert.equal(J(orphanCandidate({ user: user(20, 'google'), claims: claims(), nowS })), J({ sid, provider: 'google' }));
    assert.equal(J(orphanCandidate({ user: user(599, 'apple'), claims: claims(), nowS })), J({ sid, provider: 'apple' }));
    for (const [why, u, c] of [
      ['compte de 11 minutes', user(660, 'google'), claims()],
      ['date dans le futur', user(-120, 'google'), claims()],
      ['e-mail', user(20, 'email'), claims()],
      ['deux identités', user(20, 'google', 'apple'), claims()],
      ['aucune identité', user(20), claims()],
      ['jeton d\'un autre compte', user(20, 'google'), claims({ sub: 'u-2' })],
      ['sans session_id', user(20, 'google'), claims({ session_id: undefined })],
      ['session_id illisible', user(20, 'google'), claims({ session_id: "x' or 1=1" })],
      ['date illisible', { ...user(20, 'google'), created_at: 'n/a' }, claims()],
      ['sans utilisateur', null, claims()],
    ]) assert.equal(orphanCandidate({ user: u, claims: c, nowS }), null, why);
    // Seul 'orphan' avec un ticket supprime
    assert.equal(J(claimOutcome({ result: 'orphan', ticket: 7 }, null)), J({ status: 200, body: { deleted: true }, remove: true, ticket: 7 }));
    assert.equal(J(claimOutcome({ result: 'kept' }, null)), J({ status: 200, body: { deleted: false }, remove: false, ticket: null }));
    assert.equal(J(claimOutcome({ result: 'limit' }, null)), J({ status: 429, body: { error: 'rate_limited' }, remove: false, ticket: null }));
    assert.equal(J(claimOutcome({ result: 'orphan', ticket: 7 }, { message: 'panne' })), J({ status: 503, body: { error: 'claim' }, remove: false, ticket: null }), 'erreur : jamais de suppression');
    for (const d of ['orphan', true, null, undefined, { result: 'orphan' }, { result: 'orphan', ticket: 0 }, { result: 'orphan', ticket: '7' }, { result: 'ORPHAN', ticket: 7 }]) assert.equal(claimOutcome(d, null).remove, false, J(d));
  });

  test('coach-web-orphan : migration, retour arrière, test de retour arrière en CI et verify_jwt déclaré', () => {
    const mig = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).find(f => f.endsWith('_compte_vide_site_coach.sql'));
    assert.ok(mig && mig.slice(0, 14) >= '20261128010000', `migration ${mig}`);
    assert.ok(fs.existsSync(path.join(ROOT, 'supabase/rollback', mig.replace('.sql', '_down.sql'))), 'retour arrière');
    const sql = read(`supabase/migrations/${mig}`);
    assert.match(sql, /revoke all on function public\.coach_web_orphan_claim\(uuid, uuid\) from public, anon, authenticated;/);
    assert.match(sql, /grant execute on function public\.coach_web_orphan_claim\(uuid, uuid\) to service_role;/);
    assert.match(sql, /revoke all on function public\.coach_web_orphan_release\(bigint\) from public, anon, authenticated;/);
    assert.match(sql, /revoke all on function private\.coach_web_account_empty\(uuid\) from public, anon, authenticated, service_role;/);
    assert.match(sql, /security definer set search_path = ''/);
    assert.match(read('.github/workflows/tests.yml'), /bash tests\/sql\/compte_vide_site_coach_rollback_test\.sh/);
    assert.match(read('supabase/config.toml'), /\[functions\.coach-web-orphan\]\n(#[^\n]*\n)*verify_jwt = false/);
    // La fonction ne lit jamais le corps : uid et session viennent du jeton
    const src = read('supabase/functions/coach-web-orphan/index.ts');
    assert.ok(!/req\.json|bodyCode|bodyJws/.test(src), 'corps de la requête lu');
    assert.match(src, /rpc\('coach_web_orphan_claim', \{ uid: user\.id, sid: cand\.sid \}\)/);
  });

  // Contexte : les scripts de coach-web/index.html (main.js excepté), avec une adresse et un history factices
  const html = read('coach-web/index.html');
  const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => path.normalize(path.join('coach-web', m[1])));
  const store = new Map();
  const loc = { search: '', hash: '', pathname: '/', origin: 'https://coach.mdlf.app' };
  const sandbox = { console, setTimeout, clearTimeout, Intl, atob, btoa, TextEncoder, TextDecoder, crypto: globalThis.crypto, URLSearchParams,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    sessionStorage: { getItem: k => store.get('s:' + k) ?? null, setItem: (k, v) => store.set('s:' + k, String(v)), removeItem: k => store.delete('s:' + k) },
    navigator: {}, addEventListener() {}, location: loc,
    history: { replaceState(_s, _t, url) { const u = new URL(url, 'https://coach.mdlf.app'); loc.pathname = u.pathname; loc.search = u.search; loc.hash = u.hash; } },
    document: { querySelector: () => null, getElementById: () => null, addEventListener() {} } };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files.filter(f => !f.endsWith('main.js'))) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const run = code => vm.runInContext(code, ctx);
  const at = (search, hash = '') => { loc.pathname = '/'; loc.search = search; loc.hash = hash; };

  test('coach web, retour de Google : code d\'erreur de Supabase traduit, adresse et ancre nettoyées', async () => {
    const back = async (search, hash = '') => { at(search, hash); const r = await run('deskGoogleReturn()'); return { kind: r?.kind ?? null, ok: r?.ok ?? null, left: loc.search + loc.hash }; };
    assert.equal(J(await back('?error=access_denied&error_description=refus')), J({ kind: 'google_cancel', ok: false, left: '' }), 'refus chez Google');
    assert.equal(J(await back('?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+not+found+or+expired')), J({ kind: 'google_expired', ok: false, left: '' }));
    // Ancre de Supabase (#error=…&sb) seule, ou en plus de la requête : lue et retirée
    assert.equal(J(await back('', '#error=invalid_request&error_code=flow_state_expired&sb=')), J({ kind: 'google_expired', ok: false, left: '' }));
    assert.equal(J(await back('?error=server_error&error_description=x', '#error=server_error&sb=')), J({ kind: 'google_failed', ok: false, left: '' }));
    assert.equal(J(await back('?error=access_denied&error_code=signup_disabled')), J({ kind: 'google_unlinked', ok: false, left: '' }), 'access_denied avec un code : Supabase, pas Google');
    assert.equal(J(await back('?error=access_denied&error_code=user_banned')), J({ kind: 'google_failed', ok: false, left: '' }));
    assert.equal(J(await back('?error=invalid_request&error_code=provider_disabled')), J({ kind: 'google_config', ok: false, left: '' }));
    assert.equal(J(await back('?error=access_denied&error_code=<script>')), J({ kind: 'google_failed', ok: false, left: '' }), 'code illisible ignoré');
    // Rien à faire : routes du site gardées telles quelles
    assert.equal(J(await back('', '#/eleve/abc')), J({ kind: null, ok: null, left: '#/eleve/abc' }));
    // Tous les textes existent, aucun ne reprend error_description
    for (const k of ['google_cancel', 'google_config', 'google_expired', 'google_failed', 'google_unlinked']) assert.ok(run(`DESK_GOOGLE_TEXT.${k}`), k);
    assert.equal(run('deskGoogleReturnKind("x", "__proto__")'), 'google_failed', 'pas de clé héritée');
    assert.equal(run('DESK_UNLINKED_TEXT.google'), 'Ce compte Google n\'est relié à aucun compte MDLF. Dans l\'app : Réglages › Compte › Google › Ajouter, puis réessaie.');
    assert.match(run('DESK_UNLINKED_TEXT.apple'), /^Cet identifiant Apple n'est relié à aucun compte MDLF\. Dans l'app : Réglages › Compte › Apple › Ajouter, puis réessaie\.$/);
    at('', '');
  });

  test('coach web : deskDiscardNewAccount appelle coach-web-orphan sans rien envoyer, et ne dit « gardé » que sur deleted: false', async () => {
    const calls = [];
    const answer = r => { run('sb = null'); ctx.supabase = { createClient: () => ({ auth: {}, functions: { invoke: async (fn, o) => { calls.push([fn, o]); if (r instanceof Error) throw r; return r; } } }) }; };
    for (const [r, want] of [
      [{ data: { deleted: true }, error: null }, 'deleted'],
      [{ data: { deleted: false }, error: null }, 'kept'],
      [{ data: null, error: { name: 'FunctionsHttpError', context: { status: 429 } } }, 'failed'],
      [{ data: null, error: { name: 'FunctionsFetchError' } }, 'failed'],
      [{ data: { deleted: 'false' }, error: null }, 'failed'],
      [{ data: {}, error: null }, 'failed'],
      [new TypeError('Failed to fetch'), 'failed'],
    ]) { answer(r); assert.equal(await run('deskDiscardNewAccount()'), want, J(r)); }
    assert.ok(calls.every(([fn, o]) => fn === 'coach-web-orphan' && J(o) === J({ body: {} })), 'aucun identifiant envoyé');
    run('sb = null'); delete ctx.supabase;
  });

  test('mdlf.app : auth-retour.js renvoie error et error_code seuls vers le site du coach, rien d\'autre', () => {
    const src = read('web-public/auth-retour.js');
    const go = (search, hash = '') => {
      let to = null;
      const box = { URLSearchParams, location: { search, hash, replace: u => { to = u; } } };
      vm.runInNewContext(src, box);
      return to;
    };
    assert.equal(go('?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+not+found+or+expired'),
      'https://coach.mdlf.app/?error=invalid_request&error_code=bad_oauth_state');
    assert.equal(go('', '#error=access_denied&error_description=x&sb='), 'https://coach.mdlf.app/?error=access_denied');
    assert.equal(go('?error=server_error&error_code=..%2F..%2Fevil'), 'https://coach.mdlf.app/?error=server_error', 'code douteux retiré');
    // Rien sans erreur lisible : la page « l'app est sur iPhone » reste
    for (const s of ['', '?code=abc', '?error=', '?error=%3Cscript%3E', '?error=javascript:alert(1)', '?error=a%26redirect_to%3Dhttps://evil.example', `?error=${'a'.repeat(65)}`]) {
      assert.equal(go(s), null, s);
    }
    // Destination fixe, jamais lue dans l'adresse
    assert.equal((src.match(/https:\/\/[^'"\s]+/g) || []).filter(u => u !== 'https://coach.mdlf.app/').length, 0, 'une seule destination');
    assert.ok(!/redirect_to|returnTo|next=/.test(src.replace(/\/\/.*$/gm, '')), 'aucune destination lue dans l\'adresse');
    // Chargé dans la tête de la page, fichier du même site (CSP script-src 'self', aucune empreinte à changer)
    const page = read('web-public/index.html');
    assert.ok(page.indexOf('<script src="/auth-retour.js"></script>') > 0 && page.indexOf('<script src="/auth-retour.js"></script>') < page.indexOf('</head>'));
  });
}
