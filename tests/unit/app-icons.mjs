// ═══════════════════════════════════════════════════════════
//  Tests unitaires de l'icône de l'app : catalogue, noms natifs, dessin du signe, cohérence
//  avec le projet Xcode (jeux d'icônes, réglages, module natif) et pont Native.appIcon
//  Chargés par run.mjs (même contexte vm, mêmes outils)
// ═══════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const XCASSETS = 'ios/App/App/Assets.xcassets';

export default function appIconTests({ test, app, run, sameJSON, assert, nativeContext }) {
  const icons = () => run('APP_ICONS');

  test('icône : catalogue (défaut « Orange » en tête, identifiants et jeux uniques, couleurs #RRGGBB)', () => {
    const all = icons();
    sameJSON(all.map(i => i.label), ['Orange', 'Fonte rouillée', 'Craie', 'Signature', 'Bleue', 'Noël']);
    // Icône par défaut inchangée (choix de Maxence du 25/11, même avec l'accent orange brique de l'app)
    assert.equal(all[0].bg, '#111111'); assert.equal(all[0].fg, '#FF6A1A');
    // « Inversée » (fond orange vif, signe noir) retirée ; jamais de signe noir sur un fond orange
    sameJSON([...run('APP_ICONS_RETIRED')], ['AppIcon-Inversee']);
    assert.ok(!all.some(i => i.id === 'inversee'));
    assert.equal(all[0].asset, 'AppIcon');
    assert.equal(run('DEFAULT_APP_ICON').id, 'orange');
    assert.equal(new Set(all.map(i => i.id)).size, all.length, 'identifiant en double');
    assert.equal(new Set(all.map(i => i.asset)).size, all.length, 'jeu d\'icônes en double');
    all.forEach(i => {
      assert.match(i.bg, /^#[0-9A-F]{6}$/, `${i.id} : fond`);
      assert.match(i.fg, /^#[0-9A-F]{6}$/, `${i.id} : signe`);
      assert.match(i.asset, /^AppIcon(-[A-Za-z]+)?$/, `${i.id} : nom de jeu d'icônes valide pour Xcode`);
    });
    assert.ok(Object.isFrozen(all) && Object.isFrozen(all[0]), 'catalogue figé');
  });

  test('icône : nom natif ↔ catalogue (null = défaut, inconnu = défaut)', () => {
    assert.equal(app.appIconFromNative(null).id, 'orange');
    assert.equal(app.appIconFromNative(undefined).id, 'orange');
    assert.equal(app.appIconFromNative('AppIcon').id, 'orange');
    assert.equal(app.appIconFromNative('AppIcon-Craie').id, 'craie');
    assert.equal(app.appIconFromNative('AppIcon-Disparue').id, 'orange', 'jeu retiré d\'une version : défaut');
    assert.equal(app.nativeAppIconName('orange'), null);
    assert.equal(app.nativeAppIconName('signature'), 'AppIcon-Signature');
    assert.equal(app.nativeAppIconName('inconnue'), undefined);
    icons().forEach(i => assert.equal(app.appIconFromNative(app.nativeAppIconName(i.id)).id, i.id, `aller-retour ${i.id}`));
    sameJSON([...app.alternateAppIconNames()], ['AppIcon-Rouille', 'AppIcon-Craie', 'AppIcon-Signature', 'AppIcon-Bleue', 'AppIcon-Noel']);
    assert.equal(app.appIconFromNative('AppIcon-Inversee').id, 'orange', 'icône retirée encore en place : défaut');
  });

  test('icône : dessin du signe (géométrie validée, fond facultatif, aplat sans dégradé)', () => {
    const orange = run("appIconSvg(APP_ICONS[0])");
    assert.ok(orange.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'));
    assert.ok(orange.includes('<rect width="1024" height="1024" fill="#111111"/>'));
    assert.ok(orange.includes('d="M202 353 Q382 569 512 713 Q642 569 822 353"'), 'barre qui fléchit (sag 360)');
    assert.ok(orange.includes('stroke="#FF6A1A" stroke-width="70"'));
    assert.equal((orange.match(/<rect /g) || []).length, 5, 'fond + 4 disques');
    assert.ok(!/Gradient|filter|opacity/.test(orange), 'aucun dégradé, filtre ni transparence');
    const sig = run("appIconSvg(APP_ICONS.find(i => i.id === 'signature'))");
    assert.ok(sig.includes('d="M202 342.2 Q382 600.2 512 772.2 Q642 600.2 822 342.2"'), 'Signature : sag 430, trait 58');
    const bare = run("appIconSvg(APP_ICONS[0], { background: false, color: '#FFFFFF', attrs: 'aria-hidden=\"true\"' })");
    assert.ok(!bare.includes('width="1024"'), 'sans fond');
    assert.ok(bare.includes('fill="#FFFFFF"') && bare.includes(' aria-hidden="true">'));
  });

  test('icône : proposées selon les jeux du paquet natif (Bleue et Noël demandent la build)', () => {
    const ids = av => run(`appIconsOffered(${JSON.stringify(av)}).map(i => i.id)`);
    sameJSON(ids(null), ['orange', 'rouille', 'craie', 'signature'], 'coquille d\'avant : pas les nouvelles');
    sameJSON(ids(['AppIcon-Rouille', 'AppIcon-Inversee', 'AppIcon-Craie', 'AppIcon-Signature']), ['orange', 'rouille', 'craie', 'signature'], 'paquet d\'avant, Inversée encore dedans : jamais proposée');
    sameJSON(ids(['AppIcon-Bleue', 'AppIcon-Craie', 'AppIcon-Noel', 'AppIcon-Rouille', 'AppIcon-Signature']), ['orange', 'rouille', 'craie', 'signature', 'bleue', 'noel']);
    sameJSON(ids([]), ['orange'], 'aucun jeu alternatif : le défaut seul');
    assert.ok(run("APP_ICONS.filter(i => i.needsBuild).map(i => i.id).join()") === 'bleue,noel');
  });

  test('icône : Noël, trois couleurs (petits disques rouges), et Bleue sur le fond de l\'icône par défaut', () => {
    const noel = run("appIconSvg(APP_ICONS.find(i => i.id === 'noel'))");
    assert.ok(noel.includes('fill="#0E3B2C"') && noel.includes('stroke="#F4EFE6"'));
    assert.equal((noel.match(/fill="#C8102E"/g) || []).length, 2, 'deux petits disques rouges');
    assert.equal((noel.match(/fill="#F4EFE6"/g) || []).length, 2, 'deux grands disques blanc cassé');
    const tinted = run("appIconSvg(APP_ICONS.find(i => i.id === 'noel'), { background: false, color: '#FFFFFF' })");
    assert.ok(!tinted.includes('#C8102E'), 'couleur imposée (icône teintée) : les disques la suivent');
    const bleue = run("APP_ICONS.find(i => i.id === 'bleue')");
    assert.equal(bleue.bg, '#111111'); assert.equal(bleue.fg, '#0A84FF');
  });

  test('icône : projet Xcode cohérent avec le catalogue (jeux, réglages, module enregistré)', () => {
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    const alt = [...pbx.matchAll(/ASSETCATALOG_COMPILER_ALTERNATE_APP_ICON_NAMES = "([^"]*)";/g)].map(m => m[1]);
    sameJSON(alt, Array(2).fill([...app.alternateAppIconNames()].join(' ')), 'Debug et Release');
    assert.equal((pbx.match(/ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS = YES;/g) || []).length, 2);
    assert.match(pbx, /AppIconPlugin\.swift in Sources \*\/,/, 'AppIconPlugin.swift compilé');
    assert.match(read('ios/App/App/MainViewController.swift'), /registerPluginInstance\(AppIconPlugin\(\)\)/, 'module enregistré');
    assert.match(read('ios/App/App/AppIconPlugin.swift'), /jsName = "MdlfAppIcon"/);
    assert.match(read('js/platform/native.js'), /plugin\('MdlfAppIcon'\)/);

    const sets = fs.readdirSync(path.join(ROOT, XCASSETS)).filter(d => d.endsWith('.appiconset')).sort();
    sameJSON(sets, icons().map(i => i.asset + '.appiconset').sort(), 'un jeu par icône, aucun en trop');
    for (const i of icons()) {
      const dir = `${XCASSETS}/${i.asset}.appiconset`;
      const imgs = JSON.parse(read(`${dir}/Contents.json`)).images;
      imgs.forEach(im => {
        assert.equal(im.size, '1024x1024');
        assert.ok(fs.existsSync(path.join(ROOT, dir, im.filename)), `${dir}/${im.filename} absent`);
      });
      const looks = imgs.map(im => im.appearances?.[0]?.value || 'any');
      sameJSON(looks, i.asset === 'AppIcon' ? ['any', 'dark', 'tinted'] : ['any'], `${i.asset} : apparences`);
    }
  });

  test('icône : pont natif hors app → sans effet ; dans l\'app → module MdlfAppIcon', async () => {
    const web = nativeContext({ native: false });
    sameJSON(await web.Native.appIcon.get(), { supported: false, name: null, available: null });
    assert.equal(await web.Native.appIcon.set('AppIcon-Craie'), false);
    assert.equal(web.calls.length, 0);

    let current = 'AppIcon-Craie';
    const n = nativeContext({ plugins: { MdlfAppIcon: {
      getName: async () => (current ? { supported: true, name: current } : { supported: true, available: ['AppIcon-Craie', 7] }),
      change:  async ({ name }) => { if (name === 'AppIcon-Inconnue') throw new Error('No such icon'); current = name; return {}; },
    } } });
    sameJSON(await n.Native.appIcon.get(), { supported: true, name: 'AppIcon-Craie', available: null }, 'coquille d\'avant : available inconnu');
    assert.equal(await n.Native.appIcon.set(null), true);
    sameJSON(await n.Native.appIcon.get(), { supported: true, name: null, available: ['AppIcon-Craie'] }, 'défaut : nom absent → null ; jeux du paquet, chaînes seulement');
    assert.equal(await n.Native.appIcon.set('AppIcon-Inconnue'), false, 'refus d\'iOS → false');

    const unsupported = nativeContext({ plugins: { MdlfAppIcon: { getName: async () => { throw new Error('UNAVAILABLE'); } } } });
    sameJSON(await unsupported.Native.appIcon.get(), { supported: false, name: null, available: null });
  });
}
