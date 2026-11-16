// Tarifs du 30/10 : alerte d'une demande du rôle coach (supabase/functions/coach-request-alert) et
// cohérence de la migration 20261030000000_payant_tarifs.sql avec le contrat (docs/PAYANT_V1.md).
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, assert, ROOT }) {
  const load = () => import(path.join(ROOT, 'supabase/functions/coach-request-alert/alert-policy.js'));
  const sql = () => fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261030000000_payant_tarifs.sql'), 'utf8');
  const doc = () => fs.readFileSync(path.join(ROOT, 'docs/PAYANT_V1.md'), 'utf8');
  const row = { user_id: '11111111-1111-4111-8111-111111111111', card_name: 'Marc Dupont', card_number: '04912ED0123',
    diploma: 'BPJEPS AF', status: 'pending', created_at: '2026-10-30T10:00:00Z', notified_at: null };

  test('demande coach : alerte seulement pour une demande en attente pas encore signalée', async () => {
    const { shouldAlert } = await load();
    assert.equal(shouldAlert(row), true);
    assert.equal(shouldAlert({ ...row, notified_at: '2026-10-30T10:01:00Z' }), false, 'déjà signalée');
    for (const status of ['approved', 'rejected', 'revoked']) assert.equal(shouldAlert({ ...row, status }), false, status);
    assert.equal(shouldAlert(null), false, 'aucune demande');
  });

  test('demande coach : e-mail en texte brut, champs aplatis, commandes de validation', async () => {
    const { requestEmail, VERIFY_URL } = await load();
    const { subject, text } = requestEmail({ ...row, card_name: 'Marc\nSubject: pirate', diploma: '\u0007BPJEPS' }, 'marc.t1');
    assert.equal(subject, 'Demande coach : marc.t1');
    assert.ok(text.includes('Nom sur la carte : Marc Subject: pirate'), 'retour à la ligne aplati');
    assert.ok(text.includes('Diplôme : BPJEPS'), 'caractère de contrôle retiré');
    assert.ok(text.includes(VERIFY_URL) && VERIFY_URL === 'https://recherche-educateur.sports.gouv.fr');
    assert.ok(text.includes(`select private.approve_coach('${row.user_id}'`) && text.includes('private.reject_coach'));
    for (const l of text.split('\n')) assert.ok(!/^\s*[-–—]/.test(l), `ligne qui commence par un tiret : ${l}`);
    assert.equal(requestEmail(row, null).subject, 'Demande coach : sans pseudo');
  });

  test('tarifs : RPC, erreurs et fonctions d\'administration documentées dans le contrat', () => {
    const s = sql(), d = doc();
    for (const f of ['coach_request_state', 'coach_request_submit', 'coach_my_code', 'coach_tier_state', 'student_offer_code',
      'approve_coach', 'reject_coach', 'revoke_coach', 'coach_requests_pending', 'coach_offer_codes']) {
      assert.ok(s.includes(f), `${f} absent de la migration`);
      assert.ok(d.includes(f), `${f} absent du contrat`);
    }
    for (const e of ['already_coach', 'invalid_name', 'invalid_card', 'invalid_diploma', 'tier_full', 'not_student', 'not_new', 'no_code']) {
      assert.ok(s.includes(`'${e}'`), `erreur ${e} absente de la migration`);
      assert.ok(d.includes(e), `erreur ${e} absente du contrat`);
    }
    // Les tarifs du 30/10 ne produisaient plus coach_team (élève payant) : c'est 20261116030000 qui le rétablit
    assert.ok(!/st := 'coach_team'/.test(s), 'tarifs : statut coach_team produit');
    assert.ok(/'coach_team',\s+false/.test(s), 'tarifs : coach_team toujours faux');
  });

  test('élèves offerts (16/11/2026) : migration, retour arrière et contrat', () => {
    const up = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261116030000_eleves_gratuits.sql'), 'utf8');
    const down = fs.readFileSync(path.join(ROOT, 'supabase/rollback/20261116030000_eleves_gratuits_down.sql'), 'utf8');
    const d = doc();
    // Élève offert dans la limite du palier, 7 jours de grâce, offre −25 % retirée
    assert.ok(/elsif in_team then st := 'coach_team';/.test(up) && /'coach_cover', cover,/.test(up), 'coach_team et coach_cover produits');
    assert.ok(/select interval '7 days'/.test(up) && /w\.lim > rnk/.test(up), 'grâce de 7 jours, rang dans le palier');
    assert.ok(/drop function public\.student_offer_code\(text\);/.test(up), 'offre élève retirée');
    // Le retour arrière remet le texte exact des tarifs (comparé par tests/sql/rollback_nuit_check.sh)
    const tarifs = sql();
    for (const f of ['create or replace function private.access_json', 'create function public.student_offer_code']) {
      const body = tarifs.slice(tarifs.indexOf(f), tarifs.indexOf('\n$$;', tarifs.indexOf(f)));
      assert.ok(down.includes(body), `${f} : texte d'origine dans le retour arrière`);
    }
    for (const k of ['coach_cover', 'over_limit', 'grace', 'uncovered', 'coach_tier_log', '20261116030000_eleves_gratuits']) {
      assert.ok(d.includes(k), `${k} absent du contrat`);
    }
  });
}
