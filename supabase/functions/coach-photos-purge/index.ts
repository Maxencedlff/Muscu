// Effacement réel des fichiers des photos de bilan (contrat : docs/PHOTOS_BILAN.md ; règles : purge-policy.js).
//
// 1. Appelée par la planification de la base (pg_cron + pg_net, chaque heure, docs/PHOTOS_BILAN.md « Mise en
//    production »), jamais par l'app : l'en-tête x-purge-secret doit valoir le secret PHOTOS_PURGE_SECRET
//    (comparaison en temps constant), sinon 401 (secret absent du projet : 401 aussi). Pas de jeton de session (verify_jwt = false dans config.toml).
// 2. Le SQL ne peut pas effacer un fichier du stockage (verrou storage.protect_delete de Supabase, et un fichier
//    dont la ligne disparaît resterait orphelin) : la base met les chemins en file (private.coach_photo_trash :
//    photo retirée, lien rompu, compte supprimé, clé du coach changée, envoi pas abouti, fichier sans ligne), et
//    cette fonction les efface par l'API Storage avec la clé serveur, 200 par tour, 5 tours au plus.
// 3. Ce qui est effacé n'était lisible par personne avant même cette purge : la ligne qui permettait de le lire
//    et de le déchiffrer a disparu dans la même transaction que le retrait (crypto-effacement). La purge retire
//    le chiffré lui-même.
// 4. Deuxième compartiment, profile-photos (photo de profil, docs/PHOTO_PROFIL.md) : même file et même règle,
//    traité après le premier et séparément (PURGE_BUCKETS).
// 5. Réponse : { removed, failed } ; aucun chemin dans les journaux.
import { adminClient, env, json } from '../_shared/http.ts';
import { purgeRound, PURGE_ROUNDS, sameSecret } from './purge-policy.js';

// Deux compartiments, même file, même règle : photos de bilan (docs/PHOTOS_BILAN.md) et photos de profil
// (docs/PHOTO_PROFIL.md, migration 20261117000000). Traités l'un après l'autre et séparément : un échec sur l'un
// (migration pas encore appliquée, API Storage en panne) n'empêche jamais de purger l'autre.
export const PURGE_BUCKETS = [
  { bucket: 'coach-photos', claim: 'srv_coach_photo_purge_claim', done: 'srv_coach_photo_purge_done' },
  { bucket: 'profile-photos', claim: 'srv_profile_photo_purge_claim', done: 'srv_profile_photo_purge_done' },
];

export async function handler(req: Request): Promise<Response> {
  const secret = env('PHOTOS_PURGE_SECRET');
  if (!secret || !sameSecret(req.headers.get('x-purge-secret'), secret)) return json({ error: 'auth' }, 401);
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const admin = adminClient();
  let removed = 0, failed = false;
  for (const b of PURGE_BUCKETS) {
    let bucketFailed = false;
    for (let i = 0; i < PURGE_ROUNDS && !bucketFailed; i++) {
      const r = await purgeRound({
        claim: async (n: number) => {
          const { data, error } = await admin.rpc(b.claim, { max_n: n });
          if (error) throw new Error(error.code);
          return data;
        },
        remove: async (paths: string[]) => {
          const { error } = await admin.storage.from(b.bucket).remove(paths);
          return { ok: !error };
        },
        done: async (paths: string[]) => {
          const { error } = await admin.rpc(b.done, { paths });
          if (error) throw new Error(error.code);
        },
      }).catch(() => ({ taken: 0, removed: 0, failed: true }));
      removed += r.removed;
      bucketFailed = r.failed;
      if (!r.taken) break;
    }
    if (bucketFailed) console.error(`coach-photos-purge: tour interrompu (${b.bucket}), repris à la prochaine planification`);
    failed = failed || bucketFailed;
  }
  return json({ removed, failed }, failed ? 500 : 200);
}

// Toujours servi en production ; les tests Deno (tests/deno, MDLF_EDGE_TESTS=1) importent le handler sans serveur
if (!Deno.env.get('MDLF_EDGE_TESTS')) Deno.serve(handler);
