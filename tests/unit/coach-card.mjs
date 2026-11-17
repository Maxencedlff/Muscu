// Badge « Carte pro déclarée » (js/data/coach-pro.js, js/features/coach-pro-ui.js) : logique pure, sans réseau,
// et cohérence avec supabase/migrations/20261117090000_badge_carte_pro.sql et le contrat (docs/COACH_V1.md).
import fs from 'node:fs';
import path from 'node:path';

export default function ({ test, run, assert, sameJSON, ROOT }) {
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

  test('badge carte pro : numéro au format des cartes EAPS, saisie tolérante', () => {
    assert.equal(run(`normalizeBadgeCard(' 049 12-ed.0123 ')`), '04912ED0123');
    assert.equal(run(`normalizeBadgeCard('02a24ed0042')`), '02A24ED0042', 'Corse');
    assert.equal(run(`normalizeBadgeCard('971/23/ED/10042')`), '97123ED10042', 'outre-mer, numéro à 5 chiffres');
    for (const bad of ['', '12345', '04912XX0123', '0491ED0123', '04912ED012', '04912ED012345', 'ABCDEFGHIJK', '04C12ED0123', null, 42]) {
      assert.equal(run(`normalizeBadgeCard(${JSON.stringify(bad)})`), null, `accepté : ${bad}`);
    }
  });

  test('badge carte pro : même format que le serveur', () => {
    const sql = read('supabase/migrations/20261117090000_badge_carte_pro.sql');
    const re = run('COACH_BADGE_CARD_RE.source');
    // Le serveur écrit [0-9] ce que l'app écrit \d
    const server = re.replace('[\\dAB]', '[0-9AB]').replace(/\\d/g, '[0-9]');
    assert.ok(sql.includes(`'${server}'`), `format du serveur différent de ${server}`);
    assert.equal(sql.split(`'${server}'`).length - 1, 2, 'contrainte de la table et contrôle de coach_card_declare');
  });

  test('badge carte pro : état du coach nettoyé, « vérifiée » jamais montré', () => {
    const at = '2026-11-17T10:00:00Z';
    sameJSON(run(`cleanCoachCard({ status: 'declared', card_number: '04912ED0123', declared_at: '${at}' })`),
      { status: 'declared', card_number: '04912ED0123', declared_at: Date.parse(at), suspended_at: null, removed_reason: '' });
    assert.equal(run(`cleanCoachCard({ status: 'verified', card_number: '04912ED0123', declared_at: '${at}' }).status`), 'declared');
    assert.equal(run(`cleanCoachCard({ status: 'suspended', card_number: '04912ED0123', suspended_at: '${at}' }).suspended_at`), Date.parse(at));
    assert.equal(run(`cleanCoachCard({ status: 'piraté', card_number: '04912ED0123' }).status`), 'none');
    assert.equal(run(`cleanCoachCard({ status: 'declared', card_number: '<img>' }).status`), 'none', 'numéro illisible : rien de montré');
    sameJSON(run(`cleanCoachCard(null)`), { status: 'none', card_number: null, declared_at: null, suspended_at: null, removed_reason: '' });
  });

  test('badge carte pro : badge public montré seulement sur un oui exact, jamais de numéro', () => {
    const at = '2026-11-17T10:00:00Z';
    sameJSON(run(`cleanCoachBadge({ shown: true, declared_at: '${at}', card_number: '04912ED0123' })`), { shown: true, declared_at: Date.parse(at) });
    sameJSON(run(`cleanCoachBadge({ shown: 'true', declared_at: '${at}' })`), { shown: false, declared_at: null });
    sameJSON(run(`cleanCoachBadge(['x'])`), { shown: false, declared_at: null });
  });

  test('badge carte pro : libellé exact, jamais « vérifiée » ni « certifié »', () => {
    assert.equal(run('COACH_BADGE_LABEL'), 'Carte pro déclarée');
    // Textes montrés par l'écran du badge : aucune promesse de vérification
    const ui = read('js/features/coach-pro-ui.js');
    const start = ui.indexOf('// ── Badge « Carte pro déclarée »'), end = ui.indexOf('// ── Écran « Devenir coach »');
    assert.ok(start > 0 && end > start, 'section du badge introuvable');
    const shown = ui.slice(start, end).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const plain = shown.replace("il ne dit pas qu'elle a été vérifiée", '');
    assert.ok(shown.includes("il ne dit pas qu'elle a été vérifiée"), 'le coach est prévenu que le badge ne vaut pas vérification');
    assert.ok(!/certifi|vérifié/i.test(plain), 'promesse de vérification dans les textes du badge');
    // Le numéro n'est affiché que dans la section du coach lui-même (coachPro.card), jamais pour un autre
    assert.ok(!/coachBadges[^\n]*card_number/.test(read('js/data/coach-pro.js')), 'numéro gardé avec les badges des autres');
  });

  test('badge carte pro : RPC, erreurs et administration dans la migration et le contrat', () => {
    const sql = read('supabase/migrations/20261117090000_badge_carte_pro.sql');
    const doc = read('docs/COACH_V1.md');
    const down = read('supabase/rollback/20261117090000_badge_carte_pro_down.sql');
    for (const f of ['coach_card_state', 'coach_card_declare', 'coach_card_withdraw', 'coach_card_badge', 'report_coach_card',
      'coach_card_restore', 'coach_card_remove', 'coach_cards_review', 'coach_card_reporters']) {
      assert.ok(sql.includes(f), `${f} absent de la migration`);
      assert.ok(doc.includes(f), `${f} absent du contrat`);
      assert.ok(down.includes(f), `${f} absent du retour arrière`);
    }
    for (const e of ['not_coach', 'invalid_card', 'card_suspended', 'card_removed', 'rate_limited']) {
      assert.ok(sql.includes(`'${e}'`) || e === 'rate_limited', `erreur ${e} absente de la migration`);
      assert.ok(doc.includes(e), `erreur ${e} absente du contrat`);
      assert.ok(run(`coachProErrorText(${JSON.stringify(e)})`), `erreur ${e} sans texte`);
    }
    // Les fonctions de l'app sont ouvertes au rôle authenticated, jamais à anon ; l'administration à personne
    for (const f of ['coach_card_state()', 'coach_card_declare(text)', 'coach_card_withdraw()', 'coach_card_badge(uuid)', 'report_coach_card(uuid, text)']) {
      assert.ok(sql.includes(`grant execute on function public.${f} to authenticated;`), `GRANT de ${f}`);
    }
    assert.ok(!/grant[^;]*private\.coach_card/.test(sql), 'fonction d\'administration ouverte');
    assert.ok(!/grant[^;]*on public\.coach_cards/.test(sql), 'table lisible par un client');
  });

  test('badge carte pro : suspendu à partir de 2 comptes différents, lien de la fiche officielle pour la revue', () => {
    const sql = read('supabase/migrations/20261117090000_badge_carte_pro.sql');
    assert.ok(/count\(distinct r\.reporter_id\)/.test(sql), 'comptes différents comptés');
    assert.ok(sql.includes("private.coach_card_reporters(c.user_id) >= 2 then"), 'seuil de 2 comptes');
    assert.ok(sql.includes("'https://recherche-educateur.sports.gouv.fr/CartePro/' || c.card_number as fiche"), 'lien de la fiche dans la vue de revue');
    const doc = read('docs/COACH_V1.md');
    assert.ok(doc.includes('2 comptes différents') && doc.includes('recherche-educateur.sports.gouv.fr/CartePro/'), 'contrat');
  });

  test('badge carte pro : CGU (FR et EN) annoncent la suppression du compte en cas d\'usurpation', () => {
    const cgu = read('cgu.html');
    const [fr, en] = [cgu.slice(0, cgu.indexOf('id="en"')), cgu.slice(cgu.indexOf('id="en"'))];
    assert.ok(/Carte pro déclarée/.test(fr) && /suppression du compte/.test(fr), 'CGU FR');
    assert.ok(/Professional card declared|Carte pro déclarée/.test(en) && /account (will be |is )?deleted|deletion of the account/i.test(en), 'CGU EN');
  });
}
