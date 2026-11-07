// Règles pures de la fonction coach-photos-purge (testées sans Deno : tests/unit/coach-photos-purge.mjs).
// Contrat : docs/PHOTOS_BILAN.md, « Effacement réel des fichiers ».

export const PURGE_BATCH = 200;   // chemins pris par tour (l'API Storage en efface 1000 au plus par appel)
export const PURGE_ROUNDS = 5;    // tours au plus par appel (la planification repasse chaque heure)
const PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Comparaison en temps constant du secret de la planification (même règle que push-send)
export function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''));
  if (!x.length || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Chemins rendus par srv_coach_photo_purge_claim : seulement « élève/photo » (deux UUID), sans doublon. Un
// chemin d'une autre forme n'est jamais passé à l'API Storage (il ne peut viser que ce compartiment, mais rien
// d'autre que des photos de bilan ne doit être effacé ici).
export function purgePaths(rows) {
  const out = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const p = typeof r === 'string' ? r : r?.srv_coach_photo_purge_claim;
    if (typeof p === 'string' && PATH_RE.test(p)) out.add(p);
  }
  return [...out];
}

// Un tour : chemins pris → effacés par l'API Storage → soldés. Effacement refusé : rien n'est soldé, le tour
// suivant (ou la prochaine planification) recommence. L'API ne renvoie que les fichiers trouvés : un fichier
// déjà absent est soldé aussi (l'effacer était le but).
export async function purgeRound({ claim, remove, done }) {
  const paths = purgePaths(await claim(PURGE_BATCH));
  if (!paths.length) return { taken: 0, removed: 0, failed: false };
  const r = await remove(paths);
  if (!r.ok) return { taken: paths.length, removed: 0, failed: true };
  await done(paths);
  return { taken: paths.length, removed: paths.length, failed: false };
}
