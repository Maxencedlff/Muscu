// ═══════════════════════════════════════════════════════════
//  Plans diète modifiés sur l'appli web du coach puis repris par l'iPhone (docs/COACH_WEB.md, « Plans diète ») :
//  scénarios de l'audit du 25/11, joués de bout en bout par applyRemoteProfile (js/data/sync.js) dans le contexte de
//  l'app, et par deskDtApply / deskDtOpSave dans celui du site. Fusion à trois voies (empreinte de chaque plan au
//  dernier échange, meta.dietPlans) : un plan modifié d'un seul côté gagne sans regarder l'horloge ; la date ne
//  départage qu'un vrai conflit (modifié des deux côtés).
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

export default function ({ test, assert, ROOT }) {
  const runSrc = fs.readFileSync(path.join(ROOT, 'tests/unit/run.mjs'), 'utf8');
  const SCRIPTS = [...runSrc.slice(runSrc.indexOf('const SCRIPTS'), runSrc.indexOf('];', runSrc.indexOf('const SCRIPTS'))).matchAll(/'([^']+\.js)'/g)].map(m => m[1]);
  class Mem { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); } clear() { this.m.clear(); } key(i) { return [...this.m.keys()][i] ?? null; } get length() { return this.m.size; } }
  const app = (() => {
    const sb = { console, AbortController, setTimeout, clearTimeout, SCREENS: new Map(), setInterval: () => 0, atob, btoa, TextEncoder, TextDecoder, Blob, crypto: globalThis.crypto,
      localStorage: new Mem(), navigator: {}, document: { querySelector: () => null, getElementById: () => null }, showToast: () => {}, announce: () => {}, makeReorderable: () => {} };
    sb.window = sb;
    const c = vm.createContext(sb);
    for (const f of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
    return c;
  })();
  const web = (() => {
    const html = fs.readFileSync(path.join(ROOT, 'coach-web/index.html'), 'utf8');
    const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => path.normalize(path.join('coach-web', m[1])));
    const store = new Map();
    const sb = { console, setTimeout, clearTimeout, setInterval, clearInterval, Intl, atob, btoa, TextEncoder, TextDecoder, crypto: globalThis.crypto,
      localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
      navigator: {}, addEventListener() {}, document: { querySelector: () => null, getElementById: () => null, addEventListener() {} } };
    sb.window = sb;
    const c = vm.createContext(sb);
    for (const f of files.filter(f => !f.endsWith('main.js'))) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
    return c;
  })();
  const J = o => JSON.stringify(o), P = s => JSON.parse(s);
  const A = code => vm.runInContext(code, app), W = code => vm.runInContext(code, web);
  const ID = 'd_aaaa1111';
  const T0 = Date.parse('2026-11-01T10:00:00Z');   // dans le passé : une suppression faite « maintenant » est plus récente
  const CONSENT = { on: true, at: '2026-10-01T00:00:00.000Z' };
  const plan = (name, at, extra = {}) => ({ name, meals: [{ id: 'm1', name: 'Déjeuner', items: [{ id: 'i1', name: 'Riz', food: 9100, fam: 'f', g: 100, per: { k: 130, p: 3, c: 28, f: 0.3 }, src: 'ciqual-2025' }] }], updatedAt: at, ...extra });

  // iPhone à jour, synchronisé : profil local = compte, empreintes notées (dont celle de chaque plan)
  const phone = p => {
    app.__s = J({ history: [{ id: 'h1' }], weeklyGoal: 3, dietConsent: CONSENT, dietPlans: { [ID]: p } });
    A(`__d = JSON.parse(__s); sanitizeData(__d); __m = emptySyncMeta('u'); __m.profileHash = syncHash(profilePayload(__d)); __m.profileCore = profileCoreHash(profilePayload(__d));
      __m.profileAt = '2026-11-01T10:00:00.000000+00:00'; __m.dietPlans = dietPlanHashes(profilePayload(__d).dietPlans);`);
  };
  const serverDoc = () => P(A('JSON.stringify(profilePayload(__d))'));
  const webSave = (doc, p, now, o = {}) => { web.__doc = J(doc); web.__p = J(p); return P(W(`JSON.stringify(deskDtApply(JSON.parse(__doc), deskDtOpSave(${J(ID)}, JSON.parse(__p), ${now}, ${J(o)})))`)); };
  const pull = (doc, at = '2026-11-01T10:06:00.000000+00:00') => {
    app.__r = J({ doc, updated_at: at });
    A('applyRemoteProfile(__d, JSON.parse(__r), __m)');
    return { name: A(`__d.dietPlans[${J(ID)}].name`), archived: A(`!!__d.dietPlans[${J(ID)}].archived`), pushed: P(A('JSON.stringify(profilePayloadForServer(__d).doc)')) };
  };

  test('diète web et iPhone : l\'iPhone d\'à jour écrit sa version de fusion, le site refuse d\'écrire sans elle', () => {
    phone(plan('iPhone v1', T0));
    assert.equal(serverDoc().dietSyncV, 1, 'profil envoyé avec la version de fusion (avec l\'accord)');
    assert.equal(A('profilePayload({ dietConsent: { on: false } }).dietSyncV'), undefined, 'sans l\'accord : rien');
    assert.equal(A('"dietSyncV" in __d'), false, 'jamais gardée dans les données');
    const old = { ...serverDoc() }; delete old.dietSyncV;
    assert.equal(webSave(old, plan('Web', 0), T0).kind, 'old_phone', 'profil écrit par un iPhone d\'avant : le site n\'écrit pas');
  });

  test('S1 diète web et iPhone : horloge du PC en retard, iPhone sans changement : la version du site gagne', () => {
    phone(plan('iPhone v1', T0));
    const w = webSave(serverDoc(), plan('Web v2', 0), T0 - 2 * 60e3);   // PC en retard : date plus ancienne
    assert.ok(w.ok);
    assert.ok(w.doc.dietPlans[ID].updatedAt > T0, 'la date passe au-delà de l\'ancienne malgré l\'horloge');
    const r = pull(w.doc);
    assert.equal(r.name, 'Web v2');
    assert.equal(r.pushed.dietPlans[ID].name, 'Web v2', 'rien de l\'ancienne version ne repart');
  });

  test('S2 diète web et iPhone : plan supprimé sur l\'iPhone après la modification du site : la suppression gagne', () => {
    phone(plan('iPhone v1', T0));
    const w = webSave(serverDoc(), plan('Web v2', 0), T0 + 60e3);
    A(`dietArchivePlan(__d, ${J(ID)})`);
    assert.ok(A(`__d.dietPlans[${J(ID)}].updatedAt`) > T0 + 60e3, 'suppression datée (dietTouch)');
    const r = pull(w.doc);
    assert.equal(r.archived, true, 'modifié des deux côtés : la plus récente (la suppression) gagne');
  });

  test('S3 diète web et iPhone : l\'iPhone a changé autre chose (objectif de la semaine) : le plan du site gagne, l\'objectif reste', () => {
    phone(plan('iPhone v1', T0));
    const w = webSave(serverDoc(), plan('Web v2', 0), T0 + 60e3);
    A('__d.weeklyGoal = 4');
    const r = pull(w.doc);
    assert.equal(r.name, 'Web v2', 'plan inchangé sur l\'iPhone depuis le dernier échange : la version du compte');
  });

  test('diète web et iPhone : plan modifié sur l\'iPhone seulement : il gagne, même daté avant ; vrai conflit : le plus récent', () => {
    phone(plan('v1', T0));
    const base = serverDoc();
    // Le compte n'a pas changé ce plan (même empreinte), l'iPhone l'a modifié : le sien, quelle que soit la date
    A(`__d.dietPlans[${J(ID)}].name = 'iPhone v2'; __d.dietPlans[${J(ID)}].updatedAt = ${T0 - 3600e3}`);
    const other = { ...base, weeklyGoal: 6 };
    assert.equal(pull(other).name, 'iPhone v2');
    // Modifié des deux côtés : la date départage
    phone(plan('v1', T0));
    const w = webSave(serverDoc(), plan('Web', 0), T0 + 10 * 60e3);
    A(`__d.dietPlans[${J(ID)}].name = 'iPhone'; dietTouch(__d.dietPlans[${J(ID)}], ${T0 + 5 * 60e3})`);
    assert.equal(pull(w.doc).name, 'Web', 'site modifié après l\'iPhone');
    phone(plan('v1', T0));
    const w2 = webSave(serverDoc(), plan('Web', 0), T0 + 5 * 60e3);
    A(`__d.dietPlans[${J(ID)}].name = 'iPhone'; dietTouch(__d.dietPlans[${J(ID)}], ${T0 + 10 * 60e3})`);
    assert.equal(pull(w2.doc).name, 'iPhone', 'iPhone modifié après le site');
  });

  test('S4 diète web et iPhone : écriture du site pendant la synchro de l\'iPhone : son envoi est conditionnel, relu et refusionné', () => {
    // account.js : envoi du profil par update…eq('updated_at') ; aucune ligne rendue → relecture, applyRemoteProfile, nouvel essai
    const acc = fs.readFileSync(path.join(ROOT, 'js/data/account.js'), 'utf8');
    assert.match(acc, /from\('profiles'\)\.update\(\{ doc \}\)\.eq\('user_id', userId\)\.eq\('updated_at', serverAt\)/);
    assert.match(acc, /applyRemoteProfile\(data, again, meta\)/);
    phone(plan('iPhone v1', T0));
    const v1 = serverDoc();
    A(`__d.dietPlans.d_bbbb2222 = ${J(plan('Plan iPhone', T0 + 30e3))}`);   // changement local qui partira
    const v2 = webSave(v1, plan('Web v2', 0), T0 + 60e3).doc;         // le site écrit pendant la synchro
    // L'update conditionnel échoue (le compte a changé) : l'iPhone relit v2 et refusionne avant de renvoyer
    const r = pull(v2, '2026-11-01T10:07:00.000000+00:00');
    assert.equal(r.pushed.dietPlans[ID].name, 'Web v2');
    assert.equal(r.pushed.dietPlans.d_bbbb2222?.name, 'Plan iPhone', 'son propre changement repart aussi');
  });

  test('S5 diète web : brouillon périmé (l\'iPhone a modifié le plan après son ouverture) : refusé, jamais écrasé en silence', () => {
    web.__b = J({ dietConsent: CONSENT, dietSyncV: 1, dietPlans: { [ID]: plan('v1', T0) } });
    const draft = P(W(`JSON.stringify(deskDtDraft(JSON.parse(__b).dietPlans[${J(ID)}]))`));
    const after = { dietConsent: CONSENT, dietSyncV: 1, dietPlans: { [ID]: plan('v1 + aliments ajoutés sur l\'iPhone', T0 + 5 * 60e3) } };
    draft.name = 'v1 renommé sur le site';
    const w = webSave(after, draft, T0 + 10 * 60e3, { expectAt: T0 });
    assert.equal(w.kind, 'stale');
    assert.equal(w.current.name, 'v1 + aliments ajoutés sur l\'iPhone', 'la version de l\'iPhone est rendue pour « Recharger »');
    assert.ok(webSave(after, draft, T0 + 10 * 60e3).ok, '« Garder ma version » : écrit en connaissance de cause');
  });

  test('S6 diète web : la version reçue par un élève ne remplace jamais le plan modèle (copie sous un nouvel identifiant)', () => {
    const lib = { name: 'Sèche', updatedAt: T0, meals: [
      { id: 'm1', name: 'Petit-déjeuner', base: 'b', items: plan('x', 0).meals[0].items },
      { id: 'm2', name: 'Collation', base: 's', hidden: true, items: [{ id: 'i2', name: 'Pomme', food: 13039, fam: 'r', g: 150, per: { k: 52, p: 0.3, c: 12, f: 0.2 }, src: 'ciqual-2025' }] }] };
    web.__lib = J(lib);
    const sent = P(W('JSON.stringify(cleanSentDiet(dietToSent(JSON.parse(__lib))))'));
    assert.equal(sent.meals.length, 1, 'l\'élève ne reçoit pas le repas masqué');
    // Éditeur : la version d'un élève se garde sous un identifiant neuf (deskDtSaveCopy), l'envoi garde diet_<modèle>
    const ed = fs.readFileSync(path.join(ROOT, 'coach-web/js/desk/diet-editor.js'), 'utf8');
    assert.match(ed, /dt\.src === 'sent' \|\| !deskDtCanSave\(\)\) return \{ ok: false/, 'deskDtSave refuse la version d\'un élève');
    assert.match(ed, /deskWriteDiet\(deskDtOpSave\(dt\.copyId, copy\)\)/, 'copie sous un nouvel identifiant');
    const doc = { dietConsent: CONSENT, dietSyncV: 1, dietPlans: { [ID]: lib } };
    web.__doc = J(doc); web.__sent = J(sent);
    const r = P(W(`(() => { const n = deskDtNew(deskDtAcc(JSON.parse(__doc)), 'x'); return JSON.stringify(deskDtApply(JSON.parse(__doc), deskDtOpSave(n.id, { ...JSON.parse(__sent), name: 'Sèche (lea)' }))); })()`));
    assert.ok(r.ok);
    assert.equal(J(r.doc.dietPlans[ID]), J(lib), 'mon modèle intact, repas masqué et repas de base compris');
    assert.equal(Object.keys(r.doc.dietPlans).length, 2);
  });

  test('S8 diète web : profil près de la limite : le site s\'arrête à 800 Ko, l\'iPhone garde la place de ses plans', () => {
    phone(plan('iPhone v1', T0));
    const big = serverDoc();
    big.customSessions = { pad: { name: 'x'.repeat(820 * 1024) } };
    assert.equal(webSave(big, plan('Web v2', 0), T0 + 60e3).kind, 'doc_too_big');
    big.customSessions = { pad: { name: 'x'.repeat(700 * 1024) } };
    assert.ok(webSave(big, plan('Web v2', 0), T0 + 60e3).ok, 'en dessous : écrit');
  });
}
