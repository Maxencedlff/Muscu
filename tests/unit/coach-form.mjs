// ═══════════════════════════════════════════════════════════
//  Accord du mot « coach » (js/data/coach-form.js, docs/COACH_FORME.md) : coachWord pour chaque forme, forme gardée
//  sur l'appareil (par compte), et balayage de js/ et index.html : aucun texte ne contient « ton coach », « un
//  coach »… écrit en dur ; tout passe par coachWord (un coach encore inconnu : coachWord sans forme).
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

// Déterminant ou adjectif accordé devant « coach » (masculin et féminin : aucun des deux ne s'écrit en dur)
const HARD = /(?<![\p{L}\p{N}_])(ton|ta|mon|ma|un|une|le|la|du|au|ce|cet|cette|nouveau|nouvelle|ancien|ancienne|de la|à la)\s+coach(?![\p{L}\p{N}_])/iu;

// Source sans ses commentaires (// et /* */ hors des chaînes), lignes gardées à leur place
function stripComments(src) {
  let out = '', i = 0, q = null, tplDepth = [];
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (q === '`' && c === '$' && n === '{') { out += n; tplDepth.push('`'); q = null; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; continue; }
    // Dans un ${…} : une accolade d'objet s'ouvre et se ferme ; celle qui ferme le ${ ramène dans le gabarit
    if (c === '{' && tplDepth.length) tplDepth.push('{');
    else if (c === '}' && tplDepth.at(-1) === '{') tplDepth.pop();
    else if (c === '}' && tplDepth.length) { out += c; q = tplDepth.pop(); i++; continue; }
    if (c === "'" || c === '"' || c === '`') q = c;
    // Expression régulière littérale (après un opérateur, une parenthèse… ou un mot-clé) : copiée telle quelle, ses
    // guillemets ne sont pas des chaînes
    else if (c === '/' && /(^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof|\bcase)\s*$/.test(out.slice(-12))) {
      let j = i + 1, cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
        j++;
      }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

// Fichiers balayés : tout js/ et index.html (commentaires HTML retirés)
function sources(ROOT) {
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  } };
  walk('js');
  return [...files.map(f => [f, stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'))]),
    ['index.html', fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ''))]];
}

export default function ({ test, app, run, assert, ROOT }) {
  test('coachWord : chaque clé, chaque forme, majuscule gardée', () => {
    const expect = {
      ton: ['ton coach', 'ta coach'], mon: ['mon coach', 'ma coach'], un: ['un coach', 'une coach'], le: ['le coach', 'la coach'],
      du: ['du coach', 'de la coach'], au: ['au coach', 'à la coach'], ce: ['ce coach', 'cette coach'],
      nouveau: ['nouveau coach', 'nouvelle coach'], ancien: ['ancien coach', 'ancienne coach'], il: ['il', 'elle'], pron: ['le', 'la'], e: ['', 'e'],
    };
    for (const [k, [m, f]] of Object.entries(expect)) {
      for (const form of ['il', 'neutre', null, undefined, '', 'Elle', 'femme', 42]) assert.equal(app.coachWord(k, form), m, `${k} / ${form}`);
      assert.equal(app.coachWord(k, 'elle'), f, `${k} / elle`);
      const K = k[0].toUpperCase() + k.slice(1);
      assert.equal(app.coachWord(K, 'elle'), f && f[0].toUpperCase() + f.slice(1), `${K} / elle`);
      assert.equal(app.coachWord(K, 'il'), m && m[0].toUpperCase() + m.slice(1), `${K} / il`);
    }
    assert.throws(() => app.coachWord('leur', 'elle'), /clé inconnue/);
    assert.equal(app.cleanCoachForm('elle'), 'elle');
    assert.equal(app.cleanCoachForm('femme'), null);
  });

  test('forme gardée sur l\'appareil : par compte, mon coach et la mienne, jamais d\'un autre compte', () => {
    run(`account.user = { id: 'eleve-1' }; localStorage.removeItem(COACH_FORM_KEY);`);
    assert.equal(app.coachFormOf('coach-1'), null, 'rien de gardé : inconnue');
    run(`localStorage.setItem(COACH_FORM_KEY, JSON.stringify({ userId: 'eleve-1', mine: null, of: { 'coach-1': 'elle', 'coach-2': 'chat' } })); coachForms.memo = null;`);
    assert.equal(app.coachFormOf('coach-1'), 'elle');
    assert.equal(app.coachFormOf('coach-2'), null, 'valeur inconnue écartée');
    run(`account.user = { id: 'autre' }`);
    assert.equal(app.coachFormOf('coach-1'), null, 'autre compte : rien');
    run(`account.user = { id: 'coach-1' }; localStorage.setItem(COACH_FORM_KEY, JSON.stringify({ userId: 'coach-1', mine: 'neutre', of: {} })); coachForms.memo = null;`);
    assert.equal(app.myOwnCoachForm(), 'neutre');
    assert.equal(app.coachFormOf('coach-1'), 'neutre', 'ma forme');
    run(`account.user = null; localStorage.removeItem(COACH_FORM_KEY); coachForms.memo = null;`);
  });

  // Faux serveur : coach_set_form et coach_form répondent après `delay` ms ; la forme du serveur est `server.form`
  const withServer = body => run(`(async () => {
    const u = account.user, realSb = sb, realRole = coachRole, realMine = myCoach, realNotify = notifyCoach;
    const server = { form: null, calls: [], delay: {} };
    const wait = ms => new Promise(r => setTimeout(r, ms || 0));
    try {
      localStorage.removeItem(COACH_FORM_KEY); coachForms.memo = null; coachForms.at.clear(); coachForms.loading.clear(); coachForms.server = true;
      sb = { rpc: async (fn, args) => {
        server.calls.push(fn);
        const seen = server.form;   // lue à l'arrivée de la requête ; la réponse revient après le délai
        await wait(server.delay[fn]);
        if (fn === 'coach_set_form') { server.form = args.form; return { data: { form: args.form }, error: null }; }
        if (fn === 'coach_form') return { data: { form: seen }, error: null };
        return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      } };
      ${body}
    } finally {
      account.user = u; sb = realSb; coachRole = realRole; myCoach = realMine; notifyCoach = realNotify;
      localStorage.removeItem(COACH_FORM_KEY); coachForms.memo = null; coachForms.at.clear(); coachForms.loading.clear();
    }
  })()`);

  test('course : un choix en attente part AVANT la relecture, jamais écrasé par l\'ancienne valeur du serveur', async () => {
    const r = await withServer(`
      account.user = { id: 'coach-1' }; coachRole = () => ({ isCoach: true, hasCoach: false }); myCoach = () => null; notifyCoach = () => {};
      server.form = 'il';
      // Choix fait hors ligne : gardé, en attente
      const s = coachFormStore(); s.mine = 'elle'; s.pending = true; coachFormSave(s);
      // Lecture plus lente que l'envoi : partie en même temps, sa réponse « il » arriverait après l'envoi et l'écraserait
      server.delay.coach_set_form = 30; server.delay.coach_form = 60;
      coachFormFollow();
      await wait(150);
      return { calls: server.calls, mine: myOwnCoachForm(), pending: coachFormStore().pending, server: server.form };`);
    assert.equal(r.calls[0], 'coach_set_form', 'envoi d\'abord');
    assert.ok(r.calls.indexOf('coach_form') === -1 || r.calls.indexOf('coach_form') > 0, `lecture après l'envoi seulement (${r.calls})`);
    assert.equal(r.mine, 'elle', 'mon choix gardé');
    assert.equal(r.pending, false, 'plus en attente');
    assert.equal(r.server, 'elle', 'parti au serveur');
  });

  test('après Rejoindre : la forme est attendue (lecture partagée), 1,5 s au plus, puis l\'accord par défaut', async () => {
    const r = await withServer(`
      account.user = { id: 'eleve-1' }; coachRole = () => ({ isCoach: false, hasCoach: true }); myCoach = () => ({ user_id: 'coach-1' }); notifyCoach = () => {};
      server.form = 'elle';
      server.delay.coach_form = 20;
      coachFormFollow();                         // lecture déjà partie (état coach lu après le lien)
      const pf = await coachFormAwait('coach-1');  // la même lecture, pas une seconde
      const n = server.calls.filter(c => c === 'coach_form').length;
      // Serveur lent : au bout du délai, la forme inconnue (accord par défaut), sans attendre plus
      server.form = 'il'; server.delay.coach_form = 500; coachForms.at.clear();
      const t0 = Date.now(), late = await coachFormAwait('coach-2', 50), waited = Date.now() - t0;
      return { pf, n, late, waited, word: coachWord('ton', pf) };`);
    assert.equal(r.pf, 'elle');
    assert.equal(r.word, 'ta coach', '« Léa est ta coach »');
    assert.equal(r.n, 1, 'une seule lecture du serveur');
    assert.equal(r.late, null, 'délai dépassé : forme inconnue');
    assert.ok(r.waited < 300, `pas d'attente au-delà du délai (${r.waited} ms)`);
  });

  test('copie en mémoire : localStorage lu une fois, relu après coachFormSave et au changement de compte', () => {
    const r = run(`(() => {
      const u = account.user, realGet = localStorage.getItem.bind(localStorage);
      let reads = 0;
      try {
        account.user = { id: 'eleve-1' }; coachForms.memo = null;
        localStorage.setItem(COACH_FORM_KEY, JSON.stringify({ userId: 'eleve-1', mine: null, of: { c: 'elle' } }));
        localStorage.getItem = k => { if (k === COACH_FORM_KEY) reads++; return realGet(k); };
        for (let i = 0; i < 50; i++) coachFormOf('c');
        const first = reads;
        const s = coachFormStore(); s.of.c = 'il'; coachFormSave(s);
        const after = coachFormOf('c');
        account.user = { id: 'autre' };
        const other = coachFormOf('c');
        return { first, after, other, total: reads };
      } finally { localStorage.getItem = realGet; account.user = u; localStorage.removeItem(COACH_FORM_KEY); coachForms.memo = null; }
    })()`);
    assert.equal(r.first, 1, '50 lectures, localStorage lu une fois');
    assert.equal(r.after, 'il', 'relu après coachFormSave');
    assert.equal(r.other, null, 'autre compte : rien');
    assert.equal(r.total, 3, 'une relecture par changement');
  });

  test('textes : aucun « ton coach », « un coach »… en dur dans js/ ni index.html (tout passe par coachWord)', () => {
    const bad = [];
    for (const [f, src] of sources(ROOT)) {
      if (f.endsWith(path.join('data', 'coach-form.js'))) continue;   // la table des accords elle-même
      src.split('\n').forEach((line, i) => { const m = line.match(HARD); if (m) bad.push(`${f}:${i + 1} « ${m[0]} »`); });
    }
    assert.deepEqual(bad, [], `textes à faire passer par coachWord :\n${bad.join('\n')}`);
  });

  test('balayage : il voit bien un texte en dur (garde-fou du test lui-même)', () => {
    const src = stripComments("// ton coach dans un commentaire\nconst a = 'Écris à ta coach'; /* un coach */\nconst b = `${x ? 'Mon coach' : ''}`;\nconst c = `${f({ a: 1 })} ok`; // du coach\nconst r = s.split(/[\\s']+/u); // un coach\nconst d = 'x';");
    const hits = src.split('\n').filter(l => HARD.test(l));
    assert.equal(hits.length, 2, hits.join(' | '));
    assert.ok(!HARD.test('coachs et élèves'), 'pluriel générique laissé');
    assert.ok(!HARD.test('Le rôle coach est réservé'), '« rôle coach » n\'est pas « le coach »');
  });
}
