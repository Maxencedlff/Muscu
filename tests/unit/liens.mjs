// Liens et actions en texte (css/liens.css, 27/11) : toute règle qui colore un texte avec --tint ou --tint-on-fill sans
// fixer de graisse est soit dans la liste de css/liens.css (demi-gras, pour rester reconnaissable comme un lien), soit
// dans la liste blanche ci-dessous (icône, état choisi, bouton de barre ou de dialogue à la manière d'iOS). Une nouvelle
// action en texte oubliée dans liens.css fait échouer ce test au lieu d'apparaître en texte normal, comme un simple mot.
import fs from 'node:fs';
import path from 'node:path';

// Sélecteurs écartés, par raison. Un ajout ici se justifie : ce n'est pas un texte qui se lit comme un lien.
const ALLOWED = {
  icon: ['.auth__avatar', '.ck-choice .icon', '.coach-cell__icon', '.coach-icon-btn', '.mpick__row .icon',
    '.navbar__icon', '.diet-cand--create .icon', '.diet-cand--new .icon', '.diet-cand--scan .icon', '.diet-dpick__mark',
    '.cell--action .icon', '.cell__check', '.hist-pick__check', '.pcmp__pick .icon', '.pv-glyph', '.pv-feat__icon',
    '.sum-order__check', '.social-hero__icon', '.set-play'],
  // État choisi (segment, onglet, bouton enfoncé) : la couleur marque le choix, pas un lien
  state: ['.onb__body--on', '.ck-seg--on', '.tabbar__btn--active', '.ed-ss-btn[aria-pressed="true"]',
    '.cell.is-loading[data-action="coach-poster-open"] .cell__sub'],
  // Boutons de barre de navigation, de feuille et de dialogue (convention iOS : graisse propre, place fixe), bouton à fond,
  // « Modifier » d'un en-tête de groupe (À battre aujourd'hui : en demi-gras il passait sous le titre sur iPhone SE)
  bar: ['.navbar__back', '.navbar__text', '.sheet__btn', '.ios-dialog__btn', '.btn--secondary', '.targets__edit'],
};

export default function ({ test, assert, ROOT }) {
  const dir = path.join(ROOT, 'css');
  const read = f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const liens = read('liens.css');
  const listed = new Set(liens.match(/:is\(([\s\S]*?)\)\s*\{/)[1].split(',').map(s => s.trim()).filter(Boolean));
  const allowed = new Set(Object.values(ALLOWED).flat());

  // Règles « sélecteurs { déclarations } » sans bloc imbriqué (les @media gardent leurs règles internes à plat)
  function tintRules() {
    const out = [];
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.css') && x !== 'liens.css')) {
      const re = /([^{}]+)\{([^{}]*)\}/g;
      const src = read(f);
      let m;
      while ((m = re.exec(src))) {
        const body = m[2];
        if (!/(^|[;\s])color:\s*var\(--tint(-on-fill)?\)/.test(body) || /font-weight/.test(body)) continue;
        m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(sel => out.push({ f, sel }));
      }
    }
    return out;
  }

  test('liens : toute règle color: var(--tint) sans graisse est dans css/liens.css ou en liste blanche (icône, état, barre)', () => {
    const rules = tintRules();
    assert.ok(rules.length > 20, 'relevé non vide');
    const missing = rules.filter(r => !listed.has(r.sel) && !allowed.has(r.sel)).map(r => `${r.f} : ${r.sel}`);
    assert.deepEqual(missing, [], 'à ajouter à css/liens.css (action en texte) ou à la liste blanche de tests/unit/liens.mjs');
  });

  test('liens : la liste blanche ne garde que des sélecteurs encore relevés, et rien n\'est à la fois listé et écarté', () => {
    const seen = new Set(tintRules().map(r => r.sel));
    assert.deepEqual([...allowed].filter(s => !seen.has(s)), [], 'sélecteur écarté qui n\'existe plus : à retirer');
    assert.deepEqual([...allowed].filter(s => listed.has(s)), []);
  });

  test('liens : « Remplacé par… » et « Ajouté à… » de la nutrition sont une note grise, pas un lien', () => {
    assert.match(read('nutrition.css'), /\.diet-item__swapped \{[^}]*color: var\(--label2\)/);
  });
}
