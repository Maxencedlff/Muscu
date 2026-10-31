// Juridique : lettre d'information (logique pure de js/data/newsletter.js, accord avec la migration et
// le faux serveur), pages juridiques (liens, ancres, aucun script, emplacements à compléter listés),
// prix des Conditions de vente identiques au contrat (docs/PAYANT_V1.md).
import fs from 'node:fs';
import path from 'node:path';

const PAGES = ['privacy.html', 'mentions-legales.html', 'cgu.html', 'cgv.html'];

export default function ({ test, run, assert, sameJSON, ROOT }) {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

  test('lettre : état du serveur nettoyé, inscrit seulement si le serveur le dit', () => {
    sameJSON(run('cleanNewsletterState({ subscribed: true, consented_at: "2026-10-31T10:00:00Z", version: "v1" })'),
      { subscribed: true, consentedAt: Date.parse('2026-10-31T10:00:00Z'), version: 'v1' });
    for (const raw of ['null', '"oui"', '[]', '{ subscribed: "true" }', '{ subscribed: 1 }', '{}']) {
      sameJSON(run(`cleanNewsletterState(${raw})`), { subscribed: false, consentedAt: null, version: null }, raw);
    }
    sameJSON(run('cleanNewsletterState({ subscribed: true, consented_at: "pas une date", version: "<b>" })'),
      { subscribed: true, consentedAt: null, version: null }, 'date et version invalides écartées');
  });

  test('lettre : erreurs du serveur et hors ligne reconnues, texte pour chacune', () => {
    assert.equal(run('newsletterErrorKind({ message: "rate_limited" })'), 'rate_limited');
    assert.equal(run('newsletterErrorKind({ message: "invalid_version" })'), 'invalid_version');
    assert.equal(run('newsletterErrorKind({ message: "TypeError: Failed to fetch" })'), 'offline');
    assert.equal(run('newsletterErrorKind({ message: "boom" })'), 'server');
    assert.equal(run('newsletterErrorKind(null)'), null);
    for (const k of ['offline', 'rate_limited', 'not_found', 'signed_out', 'invalid_version', 'server', 'inconnu']) {
      assert.ok(run(`newsletterErrorText(${JSON.stringify(k)})`).length > 10, k);
    }
  });

  test('lettre : version du texte au format du serveur, texte de consentement clair', () => {
    const version = run('NEWSLETTER_CONSENT_VERSION'), text = run('NEWSLETTER_CONSENT_TEXT');
    assert.match(version, /^v\d{1,3}$/);
    const sql = read('supabase/migrations/20261031230000_newsletter.sql');
    assert.ok(sql.includes("'^v[0-9]{1,3}$'"), 'même contrôle de version côté serveur');
    assert.ok(/désinscrire à tout moment/.test(text) && /e-mail/.test(text), 'retrait du consentement annoncé');
    // Le texte exact de la version en cours est consigné dans le contrat
    const doc = read('docs/NEWSLETTER.md');
    assert.ok(doc.includes(text), 'texte de la version en cours absent de docs/NEWSLETTER.md');
    assert.ok(doc.includes(`| ${version} |`), 'version absente du tableau des versions');
  });

  test('lettre : mêmes RPC dans la migration, le faux serveur, l\'app et le contrat', () => {
    const sql = read('supabase/migrations/20261031230000_newsletter.sql');
    const fake = read('tests/fake_account.py'), app = read('js/data/newsletter.js'), doc = read('docs/NEWSLETTER.md');
    for (const f of ['newsletter_state', 'newsletter_subscribe', 'newsletter_unsubscribe']) {
      for (const [name, src] of [['migration', sql], ['faux serveur', fake], ['app', app], ['contrat', doc]]) {
        assert.ok(src.includes(f), `${f} absent : ${name}`);
      }
      assert.ok(sql.includes(`grant execute on function public.${f}(`) && /to authenticated;/.test(sql), `${f} : GRANT authenticated`);
    }
    for (const f of ['newsletter_recipients', 'newsletter_unsubscribe_token']) {
      assert.ok(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role;`).test(sql), `${f} : serveur seulement`);
      assert.ok(doc.includes(f), `${f} absent du contrat`);
    }
    assert.ok(!/to anon/.test(sql), 'rien pour anon');
    assert.ok(fs.existsSync(path.join(ROOT, 'supabase/rollback/20261031230000_newsletter_down.sql')), 'retour arrière');
  });

  test('pages juridiques : une seule liste d\'adresses, toutes sur mdlf.app et existantes', () => {
    const urls = JSON.parse(run('JSON.stringify(LEGAL_URLS)'));
    for (const [k, u] of Object.entries(urls)) {
      const m = u.match(/^https:\/\/mdlf\.app\/([a-z-]+\.html)(?:#([\w-]+))?$/);
      assert.ok(m, `${k} : ${u}`);
      assert.ok(PAGES.includes(m[1]), `${k} : page inconnue ${m[1]}`);
      if (m[2]) assert.ok(read(m[1]).includes(`id="${m[2]}"`), `${k} : ancre #${m[2]} absente de ${m[1]}`);
    }
    // Plus d'adresse de page juridique écrite en dur ailleurs que dans legal-links.js
    for (const f of ['js/features/settings.js', 'js/features/paywall-ui.js', 'js/features/newsletter-ui.js']) {
      assert.ok(!/https:\/\/mdlf\.app\/(privacy|cgu|cgv|mentions)/.test(read(f)), `${f} : adresse en dur`);
    }
  });

  test('pages juridiques : statiques (aucun script, CSP du site), FR puis EN, liens internes valides', () => {
    for (const f of PAGES) {
      const html = read(f);
      assert.ok(!/<script/i.test(html), `${f} : script (refusé par la CSP de mdlf.app)`);
      assert.ok(html.includes('<html lang="fr">') && html.includes('href="legal.css"'), `${f} : langue ou feuille de style`);
      assert.ok(/<title>[^<]+· MDLF Training<\/title>/.test(html), `${f} : titre`);
      assert.ok(/lang="en"/.test(html) || f === 'privacy.html', `${f} : version anglaise`);
      for (const [, page, anchor] of html.matchAll(/href="([a-z-]+\.html)?(?:#([\w-]+))?"/g)) {
        const target = page || f;
        assert.ok(PAGES.includes(target), `${f} : lien vers ${target} inexistant`);
        if (anchor) assert.ok(read(target).includes(`id="${anchor}"`), `${f} : ancre ${target}#${anchor} absente`);
      }
    }
    assert.ok(read('.github/workflows/tests.yml').includes('cp privacy.html mentions-legales.html cgu.html cgv.html legal.css web-public/'),
      'pages publiées par la CI');
  });

  test('pages juridiques : chaque emplacement à compléter est listé dans docs/JURIDIQUE.md', () => {
    const doc = read('docs/JURIDIQUE.md');
    const todos = new Set();
    for (const f of PAGES) for (const [, t] of read(f).matchAll(/<span class="a-completer">\[([^\]]+)\]<\/span>/g)) todos.add(t);
    assert.ok(todos.size >= 4, 'emplacements attendus (SIRET, téléphone, médiateur, date)');
    for (const t of todos) assert.ok(doc.includes(t), `emplacement non listé : ${t}`);
  });

  test('conditions de vente : prix France identiques au contrat (docs/PAYANT_V1.md) et à l\'offre élève de l\'app', () => {
    const cgv = read('cgv.html'), contract = read('docs/PAYANT_V1.md');
    const rows = [...contract.matchAll(/^\| [^|]+ \| `com\.mdlf\.training\.(\w+)\.(monthly|yearly)` \| \d+ \| \d+ \| ([\d,]+) € \|/gm)];
    assert.equal(rows.length, 10, 'dix produits dans le contrat');
    for (const [, tier, period, price] of rows) assert.ok(cgv.includes(`${price} €`), `${tier} ${period} : ${price} € absent des CGV`);
    const student = run('planStudentPrice("EUR")');
    assert.ok(cgv.includes(`${student.replace(/ /g, ' ').replace(' €', '')} € par mois pendant 12 mois`), `offre élève ${student}`);
    for (const s of ['3 mois gratuits', 'au moins 24 heures avant la fin de l\'essai', 'reportaproblem.apple.com', 'TVA non applicable, art. 293 B du CGI']) {
      assert.ok(cgv.includes(s), `CGV : « ${s} » absent`);
    }
  });
}
