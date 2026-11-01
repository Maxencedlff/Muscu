// Parrainage (js/data/referral.js et tools/rapport-parrainage.mjs) : logique pure sans réseau
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function ({ test, run, assert, sameJSON, ROOT }) {
  const tool = await import(pathToFileURL(path.join(ROOT, 'tools', 'rapport-parrainage.mjs')).href);

  test('parrainage : code saisi normalisé (majuscules, espaces, tirets), forme impossible refusée', () => {
    assert.equal(run(`normalizeReferralCode(' lu-cas ')`), 'LUCAS');
    assert.equal(run(`normalizeReferralCode('coach.paul_2')`), 'COACHPAUL2');
    assert.equal(run(`normalizeReferralCode('ＬＵＣＡＳ')`), 'LUCAS', 'pleine chasse (clavier asiatique)');
    for (const bad of ['', 'AB', 'LUCAS!', 'élodie', 'X'.repeat(21), null, undefined, 42]) {
      assert.equal(run(`normalizeReferralCode(${JSON.stringify(bad ?? null)})`), '', `refusé : ${bad}`);
    }
  });

  test('parrainage : état du serveur nettoyé (nom borné, saisie fermée une fois parrainé)', () => {
    sameJSON(run(`cleanReferralState({ referrer: { name: '  Lucas ', since: '2026-10-30T10:00:00Z', code: 'LUCAS', rate: 0.2 }, can_enter: true, until: '2026-11-29T10:00:00Z' })`),
      { referrer: { name: 'Lucas', since: Date.parse('2026-10-30T10:00:00Z'), coach: false }, canEnter: false, until: Date.parse('2026-11-29T10:00:00Z') });
    // Parrain coach, dit par le serveur (jamais déduit de la forme du code)
    assert.equal(run(`cleanReferralState({ referrer: { name: 'k', since: null, coach: true } }).referrer.coach`), true);
    assert.equal(run(`cleanReferralState({ referrer: { name: 'k', since: null, coach: 'oui' } }).referrer.coach`), false);
    sameJSON(run(`cleanReferralState({ referrer: null, can_enter: true, until: 'x' })`), { referrer: null, canEnter: true, until: null });
    sameJSON(run(`cleanReferralState(null)`), { referrer: null, canEnter: false, until: null });
    assert.equal(run(`cleanReferralState({ referrer: { name: 7 } }).referrer`), null);
    assert.equal(run(`cleanReferralState({ referrer: { name: 'x'.repeat(80) } }).referrer.name.length`), 40);
  });

  test('parrainage : délai de 30 jours vu par l\'app, erreurs du serveur lisibles', () => {
    const now = Date.parse('2026-11-30T12:00:00Z');
    assert.equal(run(`referralOpenFor({ created_at: '2026-11-01T12:00:01Z' }, ${now})`), true);
    assert.equal(run(`referralOpenFor({ created_at: '2026-10-31T12:00:00Z' }, ${now})`), false);
    assert.equal(run(`referralOpenFor({}, ${now})`), false);
    assert.equal(run(`referralErrorKind({ message: 'already_referred', code: 'P0001' })`), 'already_referred');
    assert.equal(run(`referralErrorKind({ message: 'too_late' })`), 'too_late');
    assert.equal(run(`referralErrorKind({ message: 'TypeError: Failed to fetch' })`), 'offline');
    assert.equal(run(`referralErrorKind({ message: 'boom' })`), 'server');
    assert.match(run(`referralErrorText('invalid_code')`), /Code inconnu/);
    assert.equal(run(`referralErrorText('autre')`), run(`referralErrorText('server')`));
  });

  test('parrainage : rapport CSV (partenaires et coachs, « ; », virgule décimale, euros, report sous 20 €, pas de formule)', () => {
    const csv = tool.toCsv([
      { month: '2026-11-01', kind: 'partner', code: 'LUCAS', coach_id: null, display_name: 'Lucas', active: true, commission_rate: 0.25, commission_months: 12, new_accounts: 3, total_accounts: 7, active_subscribers: null },
      { month: '2026-11-01', kind: 'partner', code: 'PAUL', coach_id: null, display_name: '=HYPERLINK("x");Paul', active: false, commission_rate: '0.2000', commission_months: 6, new_accounts: 0, total_accounts: 1, active_subscribers: 2 },
      { month: '2026-11-01', kind: 'coach', code: null, coach_id: 'c0ffee00-0000-0000-0000-000000000001', display_name: 'kevin', active: true, commission_rate: 0.2, commission_months: 12, new_accounts: 4, total_accounts: 9, active_subscribers: 6,
        net_cents: 2124, coach_active: true, commission_cents: 425, paid_cents: 0, balance_cents: 1700, payable: false },
    ]);
    const lines = csv.trimEnd().split('\r\n');
    assert.equal(lines[0], 'mois;type;code;coach_id;nom;actif;taux_commission;duree_mois;nouveaux_comptes;comptes_total;abonnes_actifs;revenu_net_eur;abonnement_coach_actif;commission_mois_eur;deja_verse_eur;reste_du_eur;a_verser');
    assert.equal(lines[1], '2026-11;partenaire;LUCAS;;Lucas;oui;25 %;12;3;7;;;;;;;');
    assert.equal(lines[2], `2026-11;partenaire;PAUL;;"'=HYPERLINK(""x"");Paul";non;20 %;6;0;1;2;;;;;;`);
    assert.equal(lines[3], '2026-11;coach;;c0ffee00-0000-0000-0000-000000000001;kevin;oui;20 %;12;4;9;6;21,24;oui;4,25;0,00;17,00;non, reporté');
  });

  test('parrainage : arguments du rapport (mois, période, erreurs)', () => {
    sameJSON(tool.parseArgs(['--mois', '2026-11']), { from: '2026-11-01', to: '2026-11-01', out: null, json: null });
    sameJSON(tool.parseArgs(['--de', '2026-01', '--a', '2026-12', '--sortie', 'x.csv']), { from: '2026-01-01', to: '2026-12-01', out: 'x.csv', json: null });
    assert.throws(() => tool.parseArgs([]), /obligatoire/);
    assert.throws(() => tool.parseArgs(['--mois', '2026-13']), /obligatoire/);
    assert.throws(() => tool.parseArgs(['--de', '2026-12', '--a', '2026-01']), /après/);
  });
}
