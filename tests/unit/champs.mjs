// Inventaire des champs (tools/champs) et règles de saisie corrigées le 20/11 (« pire équipe de testeurs »)
import { champsDuCode, constantesDu, resoudre, bornesExpression, bornesSql, branchesDialogue } from '../../tools/champs/extraction.mjs';
import { verifier, lireDepot } from '../../tools/champs/inventaire.mjs';

export default function ({ test, run, reset, assert, sameJSON, ROOT }) {
  const DIALOGS = { chemin: 'js/core/dialogs.js', src: `const DLG_MAX = 40;
    <input class="ios-dialog__input" \${input.digits ? 'type="text" inputmode="numeric" maxlength="20"'
      : input.text ? \`type="text" maxlength="\${input.max || 40}"\`
      : input.decimal ? 'type="text" inputmode="decimal" maxlength="12"'
      : 'type="text" inputmode="numeric" maxlength="12"'}
         value="\${esc(input.value)}">` };
  const repo = (src, migrations = [], extra = []) => ({ fichiers: [DIALOGS, { chemin: 'js/features/x.js', src }, ...extra], migrations });

  // ── Extraction ────────────────────────────────────────────

  test('champs : balises, attributs résolus, ${…} avec « > » et attributs dynamiques', () => {
    const src = `const NOM_MAX = 40, NOTE_X = NOM_MAX * 2;
      const h = \`<input type="text" id="nom" maxlength="\${NOM_MAX}" value="\${a > b ? esc(x) : ''}" \${attrs}>
        <textarea class="zone big" maxlength="\${NOTE_X}"></textarea>
        <input type="search" class="search" placeholder="Rechercher">\`;
      // <input id="commentaire"> dans un commentaire : ignoré`;
    const c = champsDuCode([{ chemin: 'js/features/x.js', src }]);
    sameJSON(c.map(x => x.cle), ['features/x.js#nom', 'features/x.js#zone', 'features/x.js#search']);
    const k = constantesDu([{ chemin: 'js/features/x.js', src }]);
    assert.equal(resoudre(c[0].a.maxlength, k), 40);
    assert.equal(resoudre(c[1].a.maxlength, k), 80, 'constante calculée');
    sameJSON(c[0].dyn, ['attrs']);
    assert.equal(c[1].a.type, 'textarea');
    assert.equal(c[0].ligne, 2);
  });

  test('champs : même id dessiné deux fois = un champ, sans id = deux champs numérotés', () => {
    const src = 'a = `<input id="r" inputmode="numeric">`; b = `<input id="r" inputmode="numeric">`;\nc = `<input class="f">`; d = `<input class="f">`;';
    const c = champsDuCode([{ chemin: 'js/features/x.js', src }]);
    sameJSON(c.map(x => [x.cle, x.lignes]), [['features/x.js#r', [1, 1]], ['features/x.js#f', [2]], ['features/x.js#f~2', [2]]]);
  });

  test('champs : dialogues et aides lus dans le gabarit de dialogs.js (jamais recopiés)', () => {
    const b = branchesDialogue(DIALOGS.src);
    assert.match(b.autre, /inputmode="numeric" maxlength="12"/);
    const src = `dialog({ title: 'Sel', input: { decimal: true, value: '' }, actions: [] });
      askText({ title: 'Nom', max: 100 });
      askNumber({ title: 'Repos', min: 10, max: 600 });
      askNumber({ title: \`Poids \${u}\`, value: f({ a: 1 }), decimal: true });
      async function askText({ title }) {}`;
    const c = champsDuCode([DIALOGS, { chemin: 'js/features/x.js', src }]).filter(x => x.fichier === 'js/features/x.js');
    sameJSON(c.map(x => x.cle), ['features/x.js:dialog:Sel', 'features/x.js:askText:Nom', 'features/x.js:askNumber:Repos', 'features/x.js:askNumber:Poids ${u}']);
    assert.equal(c[0].a.inputmode, 'decimal');
    assert.equal(c[1].a.maxlength, '100', 'max passé à askText');
    assert.equal(c[2].a.inputmode, 'numeric');
    assert.equal(c[3].a.inputmode, 'decimal', 'option lue au premier niveau, malgré un objet imbriqué');
  });

  test('champs : bornes SQL (longueur, motifs, between, aides diet_*_ok) et dernière migration gagnante', () => {
    sameJSON(bornesExpression("check (code ~ '^[A-HJ-NP-Z2-9]{8}$' or (permanent and code ~ '^[A-HJ-NP-Z2-9]{12}$'))", 'code'),
      { motif: '[A-HJ-NP-Z2-9]{8} | [A-HJ-NP-Z2-9]{12}', longMin: 8, longMax: 12 });
    const u = bornesExpression("username ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$'", 'username');
    assert.equal(u.longMin, 3); assert.equal(u.longMax, 20);
    sameJSON(bornesExpression('kg numeric(5, 2) not null check (kg between 25 and 300),', 'kg'), { min: 25, max: 300 });
    sameJSON(bornesExpression("if char_length(nm) not between 2 and 80 then", 'nm'), { longMin: 2, longMax: 80 });
    sameJSON(bornesExpression("and private.diet_num_ok(v -> 'saltMax', 0, 15, true)", 'saltMax'), { min: 0, max: 15 });
    const migs = [
      { fichier: '1.sql', texte: 'create table public.t (\n  id int,\n  name text check (char_length(name) <= 40)\n);' },
      { fichier: '2.sql', texte: 'alter table public.t add constraint t_name check (char_length(name) <= 30);' },
      { fichier: '3.sql', texte: "create function public.f(x text) returns void language plpgsql as $$\nbegin if char_length(t) > 500 then raise exception 'x'; end if; end $$;" },
    ];
    assert.equal(bornesSql(migs, { table: 'public.t', colonne: 'name' }).longMax, 30, 'contrainte ajoutée plus tard');
    assert.equal(bornesSql(migs, { fonction: 'public.f', variable: 't' }).longMax, 500);
    assert.equal(bornesSql(migs, { table: 'public.t', colonne: 'autre' }), null);
  });

  // ── Règles ────────────────────────────────────────────────

  const problemes = (src, entree, migrations = []) => {
    const r = verifier(repo(src, migrations), [{ cle: 'features/x.js#c', nom: 'c', ...entree }]).find(x => x.cle === 'features/x.js#c');
    return r.problemes.filter(p => p.grave).map(p => p.texte).join(' | ');
  };

  test('champs : chaque problème signalé (longueur, type number, virgule, bornes, trim, serveur)', () => {
    assert.match(problemes('`<input id="c">`', { genre: 'texte', vide: 'permis' }), /sans limite de longueur/);
    assert.equal(problemes('`<input id="c" maxlength="40">`; x.trim()', { genre: 'texte', vide: 'refuse' }), '');
    assert.match(problemes('`<input id="c" maxlength="40">`', { genre: 'texte', vide: 'refuse' }), /espaces seuls/);
    assert.match(problemes('`<input id="c" type="number" maxlength="4">`', { genre: 'entier' }), /type="number"/);
    assert.match(problemes('`<input id="c" inputmode="numeric" maxlength="6">`', { genre: 'nombre', virgule: true }), /pas de virgule/);
    assert.match(problemes('`<input id="c" maxlength="4">`', { genre: 'reps', bornes: { min: -1, max: 100 } }), /négative/);
    assert.match(problemes('`<input id="c" maxlength="4">`', { genre: 'reps', bornes: { min: 10, max: 5 } }), /sous la basse/);
    assert.match(problemes('`<input id="c" maxlength="7">`', { genre: 'charge', bornes: { min: 1, max: 1000 } }), /charge à 0 refusée/);
    assert.match(problemes('`<input id="c" maxlength="7">`', { genre: 'charge', preuve: ['weightOk('] }), /validation annoncée introuvable/);
    const migs = [{ fichier: '1.sql', texte: 'create table public.t (\n  name text check (char_length(name) between 2 and 40)\n);' }];
    const srv = [{ table: 'public.t', colonne: 'name' }];
    assert.match(problemes('`<input id="c" maxlength="80">`', { genre: 'texte', vide: 'permis', serveur: srv }, migs), /au-dessus du serveur 40/);
    assert.match(problemes('`<input id="c" maxlength="40">`; x.trim()', { genre: 'texte', vide: 'refuse', serveur: srv }, migs), /en veut 2 au moins/);
    assert.equal(problemes('`<input id="c" maxlength="40">`; x.trim()', { genre: 'texte', vide: 'refuse', longueur: { min: 2 }, serveur: srv }, migs), '');
    assert.match(problemes('`<textarea id="c"></textarea>`', { genre: 'texte-long', exemption: { longueur: 'compteur' }, serveur: [{ tronque: 2000, ou: 'x' }] }), /coupe à 2000/);
    assert.match(problemes('`<input id="c" maxlength="40">`', { genre: 'texte', serveur: [{ table: 'public.absente', colonne: 'x' }] }), /introuvable/);
  });

  test('champs : champ hors registre et entrée périmée refusés', () => {
    const r = verifier(repo('`<input id="neuf" maxlength="9">`'), [{ cle: 'features/x.js#vieux', nom: 'vieux', genre: 'texte' }]);
    assert.match(r.find(x => x.cle === 'features/x.js#neuf').problemes[0].texte, /absent du registre/);
    assert.match(r.find(x => x.cle === 'features/x.js#vieux').problemes[0].texte, /ne correspond plus/);
  });

  test('champs : l\'inventaire du dépôt n\'a aucun problème (tout nouveau champ doit être décrit)', () => {
    const graves = verifier(lireDepot(ROOT)).filter(x => x.problemes.some(p => p.grave));
    assert.equal(graves.length, 0, graves.map(x => `${x.cle} : ${x.problemes.map(p => p.texte).join(' ; ')}`).join('\n'));
  });

  // ── Règles corrigées dans l'app ───────────────────────────

  test('saisie : numRefusal dit « nombre entier » pour une virgule dans un champ d\'entiers', () => {
    assert.equal(run('numRefusal("175,5", 100, 250, true)'), 'Nombre entier entre 100 et 250');
    assert.equal(run('numRefusal("1e3", 10, 600, true)'), 'Valeur entre 10 et 600');
    assert.equal(run('numRefusal("99", 0.25, 50, false)'), 'Valeur entre 0,25 et 50');
  });

  test('saisie : clipText ne coupe jamais un emoji en deux, hasVisible refuse espaces et invisibles seuls', () => {
    assert.equal(run('clipText("ab\\u{1F3CB}", 3)'), 'ab', 'paire UTF-16 entière ou rien');
    assert.equal(run('clipText("abc", 2)'), 'ab');
    assert.equal(run('clipText(null, 5)'), '');
    for (const v of ['"   "', '"\\u00a0\\u202f"', '"\\u200b\\u200b"', '"\\ufeff"', '"\\u200e\\u200f"', '""', 'null']) assert.equal(run(`hasVisible(${v})`), false, v);
    for (const v of ['"a"', '" é "', '"\\u{1F3CB}"', '"مرحبا"']) assert.equal(run(`hasVisible(${v})`), true, v);
  });

  test('saisie : haltères fixes, refus dit d\'un morceau illisible, virgule décimale ou séparateur', () => {
    sameJSON(run('genParseLoads("4 8 12")'), { loads: [4, 8, 12] });
    sameJSON(run('genParseLoads("12,5 17,5 12,5")'), { loads: [12.5, 17.5] }, 'virgule décimale, doublon retiré');
    sameJSON(run('genParseLoads("4,8,12")'), { loads: [4, 8, 12] }, 'collage d\'un tableur');
    sameJSON(run('genParseLoads("4, 8; 12kg")'), { loads: [4, 8, 12] });
    sameJSON(run('genParseLoads("")'), { loads: [] });
    for (const [v, bad] of [['4 -8', '-8'], ['4 1e3', '1e3'], ['4 NaN', 'NaN'], ['4 81', '81'], ['0', '0'], ['<b>8</b>', '<b>8</b>']]) {
      assert.equal(run(`genParseLoads(${JSON.stringify(v)}).bad`), bad, v);
    }
    assert.equal(run('genParseLoads(Array.from({ length: 30 }, (_, i) => i + 1).join(" ")).loads.length'), 20);
  });

  test('saisie : valeur machine tapée, refusée hors plage ou illisible au lieu d\'être bornée en silence', () => {
    assert.equal(run('machineParseValue("12,34", "kmh")'), 12.3);
    assert.equal(run('machineParseValue("-2", "pct")'), -2, 'pente négative : une vraie valeur');
    for (const v of ['12abc', '1e9', '999', 'NaN', '', '-5']) assert.equal(run(`machineParseValue(${JSON.stringify(v)}, "kmh")`), null, v);
  });

  test('saisie : numéro de carte de la demande de coach normalisé comme le serveur', () => {
    assert.equal(run('normalizeCardNumber("04/912 ED.0123")'), '04912ED0123');
    assert.equal(run('normalizeCardNumber("ab-12-cd")'), 'AB12CD');
    assert.equal(run('normalizeCardNumber("abc")'), null);
  });

  test('saisie : demande de coach, nom compté en caractères, invisibles seuls refusés', async () => {
    const r = await run(`coachRequestSubmit({ cardName: '\\u200b\\u200b\\u200b', cardNumber: 'AB1234', diploma: 'BPJEPS' })`);
    assert.equal(r.kind, 'invalid_name');
    const long = await run(`coachRequestSubmit({ cardName: '${'\u{1F3CB}'.repeat(81)}', cardNumber: 'AB1234', diploma: 'BPJEPS' })`);
    assert.equal(long.kind, 'invalid_name', '81 emoji : trop long pour le serveur aussi');
  });

  test('saisie : nom d\'un contenant d\'eau fait d\'invisibles refusé', () => {
    reset();
    assert.equal(run(`waterAddCup(data, '\\u200b\\ufeff', 500).error`), 'name');
    assert.equal(run(`waterAddCup(data, 'Gourde', 500).ok`), true);
  });

  test('saisie : commentaire et message faits d\'espaces insécables ou d\'invisibles refusés', () => {
    for (const fn of ['commentProblem', 'chatProblem']) {
      assert.equal(run(`${fn}("\\u00a0\\u00a0")`), 'empty', fn);
      assert.equal(run(`${fn}("\\u200b")`), 'empty', fn);
      assert.equal(run(`${fn}(" ok ")`), null, fn);
    }
  });

  test('saisie : notes, noms de diète et notes de séance coupés sans demi-emoji, notes trop longues ramenées à 2000', () => {
    reset();
    assert.equal(run('cleanNote("\\u200b \\u200b")'), null, 'note invisible : pas de note');
    const n = run(`cleanNote("a".repeat(139) + "\\u{1F3CB}")`);
    assert.equal(n, 'a'.repeat(139), 'emoji à cheval sur la limite retiré entier');
    assert.equal(run(`dietText("x".repeat(39) + "\\u{1F3CB}", 40)`), 'x'.repeat(39));
    const h = run(`(() => { const h = { id: 'a', date: 1, category: 'push', exercises: [], notes: 'n'.repeat(5000) }; cleanHistoryEntry(h); return h.notes.length; })()`);
    assert.equal(h, run('SESSION_NOTES_MAX'));
  });
}
