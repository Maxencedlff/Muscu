// ═══════════════════════════════════════════════════════════
//  Regard neuf du 16/11, chantier « mots et accès » (yn2) : noms des séances en clair, export CSV des séances, carte « Sauvegarde tes séances », nom de l'appareil
// ═══════════════════════════════════════════════════════════
export default function ({ test, run, reset, assert, sameJSON }) {
  test('sessionTitle : le nom en français seul pour les séances intégrées, les noms tapés inchangés (26/11)', () => {
    reset();
    assert.equal(run("sessionTitle('push', 'ppl')"), 'Pousser');
    assert.equal(run("sessionTitle('pull', 'ppl')"), 'Tirer');
    assert.equal(run("sessionTitle('legs', 'ppl')"), 'Jambes', 'plus de « Jambes (Legs) »');
    assert.equal(run("sessionTitle('upper', 'upper_lower')"), 'Haut du corps');
    assert.equal(run("sessionTitle('fullbody', 'fullbody')"), 'Corps entier');
    assert.equal(run("sessionTitle('legs', 'bro')"), 'Jambes');
    assert.equal(run("sessionTitle('haut', 'maison')"), 'Haut du corps');
    assert.equal(run("sessionTitle(FREE, FREE)"), 'Séance libre');
    // Copie d'un programme intégré (même clé de séance) : même traduction ; séance créée et nommée « Push » à la main
    // (clé tirée au hasard) : le nom tapé, jamais « Pousser » (Karim le 26/11)
    run("data.userProgrammes.u_copie = { name: 'Copie', sessions: { push: { label: 'Push', icon: '', desc: '', color: '#8E8E93' }, s1a: { label: 'Push', icon: '', desc: '', color: '#8E8E93' }, a2: { label: 'Dos <b>', icon: '', desc: '', color: '#8E8E93' } }, order: ['push', 's1a', 'a2'] }");
    assert.equal(run("sessionTitle('push', 'u_copie')"), 'Pousser');
    assert.equal(run("sessionTitle('s1a', 'u_copie')"), 'Push');
    assert.equal(run("sessionTitle('a2', 'u_copie')"), 'Dos <b>', 'texte brut : l\'appelant échappe');
    assert.equal(run("sessionPlainName('Pecs')"), '');
    // Les données gardent leurs libellés (historique, synchro)
    assert.equal(run("PROGRAMMES.ppl.sessions.push.label"), 'Push');
    assert.equal(run("rawLabel('push', 'ppl')"), 'Push');
    // Premier lancement : toujours la traduction à part (SESSION_PLAIN déplacé dans js/data/programmes.js)
    assert.equal(run("programmePreview('ppl')[0].plain"), 'Pousser');
    assert.equal(run("programmePreview('bro').find(s => s.cat === 'legs').plain"), '');
  });

  test('historyCsv : une ligne par série, format français, échauffement, sous-séries, notes une fois', () => {
    reset();
    const t1 = new Date(2026, 10, 2, 18, 5).getTime(), t2 = new Date(2026, 10, 4, 7, 30).getTime();
    run(`data.history = [
      { id: 'b', date: ${t2}, programme: 'ppl', category: 'pull', exercises: [
        { name: 'Gainage (planche)', measure: 'time', sets: [{ weight: '', reps: '45' }] },
        { name: 'Vélo', measure: 'cardio', sets: [{ weight: '', reps: '30', dist: '12.5' }] } ] },
      { id: 'a', date: ${t1}, programme: 'ppl', category: 'push', notes: 'Bonne séance; "top"', exercises: [
        { name: 'Développé couché', note: '=Coudes serrés', sets: [
          { weight: '40', reps: '10', warmup: true },
          { weight: '82.5', reps: '8', rir: 2, note: 'dur' },
          { weight: '82.5', reps: '6', tech: 'drop', sub: [{ weight: '60', reps: '5' }] } ] } ] },
    ]`);
    const csv = run('historyCsv()');
    assert.ok(csv.startsWith('﻿'), 'BOM UTF-8 pour Excel');
    const lines = csv.slice(1).trimEnd().split('\r\n');
    assert.equal(lines[0], 'Date;Séance;Exercice;Série;Kg;Reps;RIR;Note');
    assert.equal(lines[1], '2026-11-02 18:05;Push;Développé couché;É;40;10;;"Bonne séance; ""top"" · =Coudes serrés"', 'notes de séance et d\'exercice sur la première ligne');
    assert.equal(lines[2], '2026-11-02 18:05;Push;Développé couché;1;82,5;8;2;dur');
    assert.equal(lines[3], '2026-11-02 18:05;Push;Développé couché;2;82,5;6;;');
    assert.equal(lines[4], '2026-11-02 18:05;Push;Développé couché;2.1;60;5;;Drop set');
    assert.equal(lines[5], '2026-11-04 07:30;Pull;Gainage (planche);1;;45 s;;');
    assert.equal(lines[6], '2026-11-04 07:30;Pull;Vélo;1;;30 min · 12,5 km;;');
    assert.equal(lines.length, 7);
    // Injection de formule : une cellule qui commence par = + - @ est désamorcée
    assert.equal(run("csvCell('=HYPERLINK(1)')"), "'=HYPERLINK(1)");
    assert.equal(run("csvCell('-5')"), "'-5");
    assert.equal(run("csvCell('ok')"), 'ok');
  });

  test('backupCardShown : 3 séances, sans compte, sans sauvegarde récente ; fermée, revient après 30 jours', () => {
    const now = 1_800_000_000_000, day = 86400000;
    const base = { sessions: 3, ready: true, signedIn: false, stale: true, closedAt: null, now };
    const shown = o => run(`backupCardShown(${JSON.stringify({ ...base, ...o })})`);
    assert.equal(shown({}), true);
    assert.equal(shown({ sessions: 2 }), false, 'moins de 3 séances');
    assert.equal(shown({ signedIn: true }), false, 'compte : déjà sauvegardé');
    assert.equal(shown({ stale: false }), false, 'export récent');
    assert.equal(shown({ ready: false }), false, 'compte pas encore lu');
    assert.equal(shown({ hadAccount: true }), false, 'appareil qui a déjà eu un compte (déconnecté, session finie)');
    assert.equal(shown({ closedAt: now - 5 * day }), false, 'fermée il y a 5 jours');
    assert.equal(shown({ closedAt: now - 31 * day }), true, 'fermée il y a 31 jours : revient');
    assert.equal(shown({ closedAt: now + day }), true, 'date de fermeture dans le futur (horloge reculée) : ignorée');
  });

  test('phoneName : « iPhone » sur un iPhone, « téléphone » ailleurs, avec l\'élision', () => {
    run("navigator.userAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 7)'");
    sameJSON(run('[phoneName(), thisPhone(), newPhone()]'), ['téléphone', 'ce téléphone', 'nouveau téléphone']);
    run("navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)'");
    sameJSON(run('[phoneName(), thisPhone(), newPhone()]'), ['iPhone', 'cet iPhone', 'nouvel iPhone']);
    run("delete navigator.userAgent");
  });
}
