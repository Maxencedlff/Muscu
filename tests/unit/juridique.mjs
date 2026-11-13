// Juridique : lettre d'information (logique pure de js/data/newsletter.js, accord avec la migration et
// le faux serveur), pages juridiques (liens, ancres, aucun script, emplacements à compléter listés),
// prix des Conditions de vente identiques au contrat (docs/PAYANT_V1.md).
import fs from 'node:fs';
import path from 'node:path';

const PAGES = ['privacy.html', 'mentions-legales.html', 'cgu.html', 'cgv.html'];

export default function ({ test, run, assert, sameJSON, ROOT }) {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

  test('confidentialité : photos de bilan nommées comme dans l\'app, traduites dans la version anglaise', () => {
    const page = read('privacy.html'), en = page.slice(page.indexOf('lang="en"') > 0 ? page.indexOf('lang="en"') : page.indexOf('Without an account, MDLF Training'));
    assert.ok(page.includes('Social › Mon coach › Photos de bilan'), 'FR : chemin de l\'app');
    assert.ok(en.includes('“Photos de bilan” (progress check photos)') && en.includes('(“Photos de bilan” in the app)'), 'EN : libellé de l\'app, traduit entre parenthèses');
    assert.ok(en.includes('“Envoyer cette photo”, Send this photo') && en.includes('(Your coach will see this photo.'), 'EN : boutons et phrase de l\'app, traduits');
    for (const ui of ['Photos de bilan', 'Envoyer cette photo']) assert.ok(read('js/features/coach-photos-ui.js').includes(ui), `libellé « ${ui} » toujours dans l'app`);
  });

  test('confidentialité : sauvegardes chiffrées de la base annoncées (90 jours chez GitHub, copies locales), FR et EN', () => {
    const page = read('privacy.html'), cut = page.indexOf('<hr>'), fr = page.slice(0, cut), en = page.slice(cut);
    const wf = read('.github/workflows/sauvegarde-base.yml');
    const days = Number(wf.match(/retention-days:\s*(\d+)/)[1]);
    assert.equal(days, 90, 'durée du workflow');
    assert.ok(fr.includes(`pendant <strong>${days} jours</strong>`) && en.includes(`for <strong>${days} days</strong>`), 'durée de 90 jours annoncée (FR et EN)');
    assert.ok(/chiffrée<\/strong> \(AES-256\)/.test(fr) && /encrypted<\/strong> \(AES-256\)/.test(en), 'chiffrement annoncé');
    assert.ok(/--cipher-algo AES256/.test(wf), 'le workflow chiffre bien en AES-256');
    assert.ok(fr.includes('<strong>GitHub</strong> (GitHub, Inc.') && en.includes('<strong>GitHub</strong> (GitHub, Inc.'), 'GitHub nommé comme sous-traitant');
    assert.ok(fr.includes('Data Privacy Framework') && en.includes('Data Privacy Framework'), 'transfert hors UE encadré');
    assert.ok(fr.includes('30 dernières copies') && en.includes('last 30 copies'), 'copies chiffrées sur le poste de l\'éditeur');
    assert.ok(/GitHub, Inc\. \(sauvegardes chiffrées de la base/.test(fr) && /GitHub, Inc\. \(encrypted database backups/.test(en), 'GitHub dans la liste des hébergeurs');
    // Après la suppression du compte : plus « effacé partout », mais présent jusqu'à l'expiration des sauvegardes
    assert.ok(/Elles restent seulement dans les sauvegardes chiffrées faites avant[^<]*au plus tard 90 jours/.test(fr), 'FR : ce qui reste après suppression');
    assert.ok(/remains only in the encrypted backups made before[^<]*at most 90 days/.test(en), 'EN : what remains after deletion');
    assert.ok(!/quelques jours la ligne d'une photo|for a few days \(its day/.test(page), 'plus de « quelques jours » pour les sauvegardes');
    assert.ok(page.includes('id="sauvegardes"') && page.includes('id="backups"'), 'ancres FR et EN');
    // Date de mise à jour, FR et EN, identiques
    assert.ok(fr.includes('mise à jour le 12 novembre 2026') && en.includes('updated November 12, 2026'), 'date du 12/11/2026');
  });

  test('confidentialité : copie iCloud décrite sans poids, mensurations, repas ni sexe (règle 5.1.3(ii)), FR et EN', () => {
    const page = read('privacy.html'), cut = page.indexOf('<hr>'), fr = page.slice(0, cut), en = page.slice(cut);
    assert.ok(fr.includes('Cette copie iCloud ne contient ni ton poids, ni tes mensurations, ni les repas que tu coches, ni ton sexe'), 'FR');
    assert.ok(en.includes('This iCloud copy contains neither your body weight, nor your body measurements, nor the meals you tick, nor your sex'), 'EN');
    assert.ok(!/dans la copie iCloud de l'app et dans l'export|in the app's iCloud copy and in the export|dans la copie iCloud de l'app décrite ci-dessous et dans l'export|in the app's iCloud copy described below and in the export/.test(page), 'plus aucune promesse de ces données dans iCloud');
  });

  test('lettre : état du serveur nettoyé, inscrit seulement si le serveur le dit', () => {
    sameJSON(run('cleanNewsletterState({ subscribed: true, consented_at: "2026-10-31T10:00:00Z", version: "v1", has_email: true })'),
      { subscribed: true, consentedAt: Date.parse('2026-10-31T10:00:00Z'), version: 'v1', hasEmail: true });
    for (const raw of ['null', '"oui"', '[]', '{ subscribed: "true" }', '{ subscribed: 1 }', '{}', '{ has_email: "true" }', '{ has_email: 1 }']) {
      sameJSON(run(`cleanNewsletterState(${raw})`), { subscribed: false, consentedAt: null, version: null, hasEmail: false }, raw);
    }
    sameJSON(run('cleanNewsletterState({ subscribed: true, consented_at: "pas une date", version: "<b>" })'),
      { subscribed: true, consentedAt: null, version: null, hasEmail: false }, 'date et version invalides écartées, adresse non supposée');
  });

  test('lettre : état relu quand le compte change l\'écran Compte ouvert, sans relance en boucle', () => {
    const nr = (nl, user) => run(`newsletterNeedsRefresh(${JSON.stringify(nl)}, ${JSON.stringify(user)})`);
    const base = { userId: 'u1', state: null, loading: false, error: null };
    const st = (hasEmail) => ({ subscribed: false, consentedAt: null, version: null, hasEmail });
    assert.equal(nr(base, null), false, 'déconnecté');
    assert.equal(nr(base, { id: 'u1' }), true, 'connexion faite sur l\'écran : état inconnu');
    assert.equal(nr({ ...base, userId: null }, { id: 'u1' }), true, 'autre compte');
    assert.equal(nr({ ...base, loading: true }, { id: 'u1' }), false, 'lecture en cours');
    assert.equal(nr({ ...base, error: 'offline' }, { id: 'u1' }), false, 'après un échec : « Réessayer »');
    assert.equal(nr({ ...base, state: st(true) }, { id: 'u1', email: 'a@example.test' }), false, 'état connu');
    assert.equal(nr({ ...base, state: st(false) }, { id: 'u1', email: null }), false, 'Apple seul, rien de neuf');
    assert.equal(nr({ ...base, state: st(false) }, { id: 'u1', email: 'a@example.test' }), true, 'adresse ajoutée au compte');
  });

  test('lettre : erreurs du serveur et hors ligne reconnues, texte pour chacune', () => {
    assert.equal(run('newsletterErrorKind({ message: "rate_limited" })'), 'rate_limited');
    assert.equal(run('newsletterErrorKind({ message: "invalid_version" })'), 'invalid_version');
    assert.equal(run('newsletterErrorKind({ message: "no_email" })'), 'no_email');
    assert.match(run('newsletterErrorText("no_email")'), /Ajoute une connexion Google ou e-mail/);
    assert.equal(run('newsletterErrorKind({ message: "TypeError: Failed to fetch" })'), 'offline');
    assert.equal(run('newsletterErrorKind({ message: "boom" })'), 'server');
    assert.equal(run('newsletterErrorKind(null)'), null);
    for (const k of ['offline', 'rate_limited', 'not_found', 'signed_out', 'invalid_version', 'no_email', 'server', 'inconnu']) {
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
    for (const [name, src] of [['migration', sql], ['faux serveur', fake], ['app', app], ['contrat', doc]]) {
      assert.ok(src.includes('no_email') && src.includes('has_email'), `compte sans adresse (no_email, has_email) absent : ${name}`);
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

  test('pages juridiques : la publication refuse toute page avec un emplacement à compléter', async () => {
    const { legalPlaceholders } = await import(path.join(ROOT, 'scripts/check-legal-pages.mjs'));
    sameJSON(legalPlaceholders('<p>SIRET : 123</p>\n<p>Médiateur : CM2C</p>'), [], 'page remplie');
    for (const bad of ['<span class="a-completer">[x]</span>', '<span class="note a-completer">x</span>', '[À COMPLÉTER : date]',
      '[À VÉRIFIER : RCS]', '[TO COMPLETE: phone]', '[TO CHECK: RCS]']) {
      assert.equal(legalPlaceholders(`<p>ok</p>\n<p>${bad}</p>`).length, 1, bad);
      assert.equal(legalPlaceholders(`<p>${bad}</p>`)[0].line, 1, `${bad} : ligne`);
    }
    // Le job deploy lance la garde AVANT la copie, sur exactement les pages copiées
    const ci = read('.github/workflows/tests.yml');
    const guard = ci.indexOf('node scripts/check-legal-pages.mjs privacy.html mentions-legales.html cgu.html cgv.html');
    const copy = ci.indexOf('cp privacy.html mentions-legales.html cgu.html cgv.html legal.css web-public/');
    assert.ok(guard > ci.indexOf('  deploy:') && guard < copy, 'garde des emplacements avant la publication');
  });

  test('mise à jour à chaud : refusée si une page juridique de l\'app est absente en ligne', async () => {
    const { legalUrlsFromSource, pagesToCheck, checkLegalOnline } = await import(path.join(ROOT, 'scripts/check-legal-online.mjs'));
    const urls = legalUrlsFromSource(read('js/data/legal-links.js'));
    assert.ok(urls.length >= 6 && urls.every(u => u.startsWith('https://mdlf.app/')), 'adresses lues dans legal-links.js');
    const pages = pagesToCheck(urls);
    assert.equal(pages.length, 4, 'chaque page téléchargée une seule fois');
    sameJSON(pages.find(p => p.url.endsWith('/cgv.html')).anchors, ['remboursement']);
    sameJSON(pages.find(p => p.url.endsWith('/privacy.html')).anchors, ['newsletter', 'nutrition']);
    // Chaque page servie en ligne = la page du dépôt ; aucun réseau
    const local = Object.fromEntries(PAGES.map(f => [`https://mdlf.app/${f}`, read(f)]));
    const fakeFetch = (overrides = {}) => async url => {
      if (url in overrides) { const o = overrides[url]; if (o instanceof Error) throw o; return o; }
      return url in local ? { ok: true, status: 200, text: async () => local[url] } : { ok: false, status: 404, text: async () => '' };
    };
    const opts = f => ({ fetchImpl: f, waitMs: 0 });
    sameJSON(await checkLegalOnline(urls, opts(fakeFetch())), [], 'pages du dépôt en ligne : publication permise');
    sameJSON(await checkLegalOnline(urls, opts(fakeFetch({ 'https://mdlf.app/cgu.html': { ok: false, status: 404, text: async () => '' } }))),
      ['https://mdlf.app/cgu.html : HTTP 404'], 'CGU absentes (état du 31/10) : refus');
    assert.equal((await checkLegalOnline(urls, opts(fakeFetch({ 'https://mdlf.app/cgv.html': new Error('réseau') })))).length, 1, 'injoignable : refus');
    sameJSON(await checkLegalOnline(urls, opts(fakeFetch({ 'https://mdlf.app/privacy.html': { ok: true, status: 200, text: async () => '<h2 id="mentions">x</h2>' } }))),
      ['https://mdlf.app/privacy.html#newsletter : ancre absente de la page en ligne', 'https://mdlf.app/privacy.html#nutrition : ancre absente de la page en ligne'],
      'ancienne politique sans #newsletter ni #nutrition : refus');
    let calls = 0;
    const flaky = async url => (++calls === 1 ? { ok: false, status: 503, text: async () => '' } : fakeFetch()(url));
    sameJSON(await checkLegalOnline(urls, opts(flaky)), [], 'erreur passagère : réessayée');
    assert.throws(() => pagesToCheck(['http://mdlf.app/cgu.html']), /https/);
    // ota.yml lance les deux gardes AVANT de construire et publier le paquet
    const ota = read('.github/workflows/ota.yml');
    const build = ota.indexOf('python3 scripts/ota-bundle.py');
    for (const cmd of ['node scripts/check-legal-pages.mjs privacy.html mentions-legales.html cgu.html cgv.html', 'node scripts/check-legal-online.mjs']) {
      const at = ota.indexOf(cmd);
      assert.ok(at > 0 && at < build, `ota.yml : « ${cmd} » avant la publication`);
    }
    // Envoi TestFlight : mêmes gardes, avant la signature (mode testflight seulement)
    const ios = read('.github/workflows/ios.yml');
    const sign = ios.indexOf('- name: Certificat et profil de distribution');
    const step = ios.slice(ios.indexOf('- name: Pages juridiques complètes et en ligne'), sign);
    assert.ok(sign > 0 && step.includes('if: ${{ inputs.testflight }}'), 'ios.yml : garde en mode testflight, avant la signature');
    for (const cmd of ['node scripts/check-legal-pages.mjs privacy.html mentions-legales.html cgu.html cgv.html', 'node scripts/check-legal-online.mjs']) {
      assert.ok(step.includes(cmd), `ios.yml : « ${cmd} »`);
    }
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
