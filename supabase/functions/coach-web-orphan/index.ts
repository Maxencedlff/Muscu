// Site du coach (coach.mdlf.app) : compte tout neuf et vide créé par « Se connecter avec Google » (ou Apple) effacé
// aussitôt (docs/COACH_WEB.md, « Identifiant inconnu : aucun compte laissé »). Appelée par coach-web/js/desk/api.js
// (deskDiscardNewAccount) juste après la connexion, avec le jeton de cette connexion.
//
// 1. L'appelant est identifié par son jeton de session, relu sur le serveur d'authentification (caller) : uid et
//    session viennent de ce jeton, jamais du corps de la requête (ignoré). Pas d'IDOR possible.
// 2. Tri préalable sans base (orphan-policy.js) : une seule identité Google ou Apple, compte de moins de 10 minutes.
// 3. Décision de la base, clé serveur (public.coach_web_orphan_claim) : une seule session au total, celle-ci, ouverte
//    à la création ; aucune ligne dans aucune table qui pointe vers le compte ; aucun fichier ; 30 par heure au plus
//    pour tout le projet. Réponse 'orphan' seulement si tout est vrai.
// 4. Seulement alors, suppression par l'API d'administration (auth.admin.deleteUser : identités et sessions partent
//    avec le compte ; l'identité Google redevient libre, à relier dans l'app).
// Réponses : 200 { deleted: true | false }, 401 { error: 'auth' }, 429 { error: 'rate_limited' },
// 503 { error: 'claim' } (base injoignable ou migration absente), 500 { error: 'delete' }.
import { adminClient, caller, CORS, json } from '../_shared/http.ts';
import { claimOutcome, orphanCandidate } from './orphan-policy.js';

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'auth' }, 401);
  const { user, claims } = who;

  const cand = orphanCandidate({ user, claims, nowS: Math.floor(Date.now() / 1000) });
  if (!cand) return json({ deleted: false });
  const { data, error } = await adminClient().rpc('coach_web_orphan_claim', { uid: user.id, sid: cand.sid });
  const out = claimOutcome(data, error);
  if (!out.remove) return json(out.body, out.status);
  const { error: delErr } = await adminClient().auth.admin.deleteUser(user.id);
  if (delErr) { console.error('coach-web-orphan: suppression refusée'); return json({ error: 'delete' }, 500); }
  console.log(`coach-web-orphan: compte ${cand.provider} tout neuf et vide effacé`);
  return json(out.body);
}

// Toujours servi en production ; les tests Deno (tests/deno, MDLF_EDGE_TESTS=1) importent le handler sans serveur
if (!Deno.env.get('MDLF_EDGE_TESTS')) Deno.serve(handler);
