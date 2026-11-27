// ═══════════════════════════════════════════════════════════
//  Garde des mises à jour à chaud (docs/REVUE_APPLE.md, section 6.2 ; règles 2.5.2 et 2.3.1(a) d'Apple) :
//  une mise à jour à chaud ne transporte que des corrections et des contenus. Refuse (code 1) si features.json
//  déclare une fonction absente de store/derniere-build.json (fonctions de la dernière build examinée) : une
//  fonction nouvelle part dans une build soumise, décrite dans « What to Test » et la note d'examen.
//  Lancé par ota.yml avant la publication.  node scripts/check-features-ota.mjs [features.json] [derniere-build.json]
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';

export function newFeatures(current, lastBuild) {
  const known = new Set(Array.isArray(lastBuild?.features) ? lastBuild.features : []);
  const ids = (Array.isArray(current?.features) ? current.features : []).map(f => f?.id).filter(id => typeof id === 'string' && id);
  return ids.filter(id => !known.has(id));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cur = 'features.json', last = 'store/derniere-build.json'] = process.argv.slice(2);
  const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const added = newFeatures(read(cur), read(last));
  if (added.length) {
    console.error(`Fonctions absentes de la dernière build examinée : ${added.join(', ')}.`);
    console.error('Une fonction nouvelle part dans une build TestFlight, pas en mise à jour à chaud (docs/REVUE_APPLE.md, 6.2).');
    process.exit(1);
  }
  console.log('Aucune fonction nouvelle : mise à jour à chaud permise.');
}
