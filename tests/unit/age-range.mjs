// Tranche d'âge partagée par Apple (js/data/age-range.js) : catégorie, conservation, demande au module
// natif simulé, effets sur le social (js/data/social.js). Le Swift (AgeRangePlugin.swift) n'est pas compilé
// ici : ses noms sont vérifiés par le test « chaque module Swift » de run.mjs et par le dernier test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default function ({ test, run, assert, sameJSON }) {
  const band = r => run(`ageBand(cleanAgeRange(${JSON.stringify(r)}))`);

  test('âge : catégorie d\'après les bornes, seuils 13, 15, 18 ou ceux d\'une région', () => {
    assert.equal(band({ status: 'sharing', upperBound: 12 }), 'young', 'moins de 13 ans');
    assert.equal(band({ status: 'sharing', lowerBound: 13, upperBound: 14 }), 'young', '13-14 ans : règle des 15 ans');
    assert.equal(band({ status: 'sharing', lowerBound: 15, upperBound: 17 }), 'teen');
    assert.equal(band({ status: 'sharing', lowerBound: 18 }), 'adult');
    assert.equal(band({ status: 'sharing', lowerBound: 18, communicationLimits: true }), 'adult', 'majeur : contrôle parental sans effet');
    assert.equal(band({ status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: true }), 'limited');
    assert.equal(band({ status: 'sharing', upperBound: 12, communicationLimits: true }), 'young');
    // Seuils imposés par la région (ex. Texas : 13, 16, 18) : une tranche qui n'exclut pas moins de 15 ans
    // compte comme moins de 15 ans ; 'teen' seulement si 15 ans est sûr
    assert.equal(band({ status: 'sharing', lowerBound: 13, upperBound: 15 }), 'young', 'Texas 13-15 : 13 ou 14 ans possible');
    assert.equal(band({ status: 'sharing', lowerBound: 13, upperBound: 15, communicationLimits: true }), 'young');
    assert.equal(band({ status: 'sharing', upperBound: 15 }), 'young', 'moins de 16 ans : moins de 15 possible');
    assert.equal(band({ status: 'sharing', lowerBound: 14, upperBound: 17 }), 'young', '14-17 ans : 14 possible');
    assert.equal(band({ status: 'sharing', lowerBound: 16, upperBound: 17 }), 'teen');
    assert.equal(band({ status: 'sharing', lowerBound: 15, upperBound: 16 }), 'teen', 'borne basse 15 : 15 ans sûr');
    // Refus, indisponible, réponse incohérente ou inconnue : comportement inchangé
    for (const r of [{ status: 'declined' }, { status: 'unavailable' }, { status: 'sharing' }, { status: 'autre', lowerBound: 3 }, null]) {
      assert.equal(band(r), null, JSON.stringify(r));
    }
  });

  test('âge : réponse du module réduite à la liste blanche, bornes entières seulement', () => {
    sameJSON(run(`cleanAgeRange({ status: 'sharing', lowerBound: '18', upperBound: 17.5, communicationLimits: 1, extra: 1 })`),
      { status: 'sharing', lowerBound: null, upperBound: null, communicationLimits: false });
    sameJSON(run(`cleanAgeRange({ status: 'declined', lowerBound: 18 })`), { status: 'declined' });
    sameJSON(run(`cleanAgeRange(undefined)`), { status: 'unavailable' });
  });

  test('âge : réponse gardée 30 jours (tranche), 7 jours (indisponible), refus jamais redemandé', () => {
    const fresh = (status, days) => run(`ageRangeFresh({ status: '${status}', at: 0 }, ${days} * 86400e3)`);
    assert.equal(fresh('sharing', 29), true);
    assert.equal(fresh('sharing', 31), false);
    assert.equal(fresh('unavailable', 6), true);
    assert.equal(fresh('unavailable', 8), false);
    assert.equal(fresh('declined', 3650), true);
    assert.equal(run(`ageRangeFresh({ status: 'sharing', at: 10 * 86400e3 }, 0)`), false, 'horloge revenue en arrière : redemandé');
    assert.equal(run('ageRangeFresh(null)'), false);
  });

  // Module simulé : Native.ageRange remplacé le temps du test, état remis ensuite
  const scenario = (responses, body) => run(`(async () => {
    const saved = Native.ageRange, state = { ...ageRange }, calls = [];
    const answers = ${JSON.stringify(responses)};
    Native.ageRange = { available: true, async request() { calls.push(1); const a = answers.shift(); if (a === 'throw') throw new Error('x'); return a; } };
    Object.assign(ageRange, { stored: null, asking: false, askedThisLaunch: false });
    localStorage.removeItem(AGE_RANGE_KEY);
    let seen = 0; onAgeRangeChange(() => { seen++; });
    try { return await (async () => { ${body} })(); }
    finally { Native.ageRange = saved; Object.assign(ageRange, state); localStorage.removeItem(AGE_RANGE_KEY); }
  })()`);

  test('âge : demandé une fois par lancement, gardé sur l\'appareil, écran prévenu d\'un changement', async () => {
    const r = await scenario([{ status: 'sharing', upperBound: 12 }], `
      const first = await ageRangeCheck(), second = await ageRangeCheck();
      const kept = JSON.parse(localStorage.getItem(AGE_RANGE_KEY));
      return { first, second, calls: calls.length, seen, kept: kept.status, hidden: socialHiddenByAge() };`);
    sameJSON(r, { first: 'young', second: 'young', calls: 1, seen: 1, kept: 'sharing', hidden: true });
  });

  test('âge : module absent, en erreur ou refus → rien ne change, jamais d\'exception', async () => {
    const absent = await run(`(async () => { const s = Native.ageRange; Native.ageRange = { available: false, request() { throw new Error('jamais'); } };
      try { return await ageRangeCheck(); } finally { Native.ageRange = s; } })()`);
    assert.equal(absent, null);
    const thrown = await scenario(['throw'], 'const b = await ageRangeCheck(); return { b, hidden: socialHiddenByAge(), seen };');
    sameJSON(thrown, { b: null, hidden: false, seen: 0 });
    const declined = await scenario([{ status: 'declined' }], `const b = await ageRangeCheck();
      ageRange.askedThisLaunch = false; await ageRangeCheck();   // lancement suivant : refus pas redemandé
      return { b, calls: calls.length, seen };`);
    sameJSON(declined, { b: null, calls: 1, seen: 0 });
  });

  test('âge : tranche connue puis indisponible → la tranche reste, redemandée dans 7 jours', async () => {
    const r = await scenario([{ status: 'unavailable' }], `
      ageRange.stored = { status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: false, at: Date.now() - 40 * 86400e3 };
      const b = await ageRangeCheck();
      return { b, fresh: ageRangeFresh(ageRange.stored), later: ageRangeFresh(ageRange.stored, Date.now() + 8 * 86400e3) };`);
    sameJSON(r, { b: 'teen', fresh: true, later: false });
  });

  test('âge : 15-17 ans → séances masquées par défaut ; moins de 15 ans → social éteint partout, rien de neuf montré', () => {
    const r = run(`(() => {
      const user = account.user, saved = { ...social }, stored = ageRange.stored;
      try {
        data = makeDefaultData(); data.schema = SCHEMA;
        account.user = { id: 'u' }; social.state = cleanSocialState({ enabled: true, badge: 2, activity_new: 1 });
        const out = {};
        out.adultDefault = sessionsVisibleByDefault();
        ageRange.stored = { status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: false, at: Date.now() };
        out.teenDefault = sessionsVisibleByDefault();
        out.teenHidden = newSessionHidden();
        data.sessionVisibleDefault = true;
        out.teenChosen = newSessionHidden();
        out.teenBadge = socialBadge();
        ageRange.stored = { status: 'sharing', lowerBound: null, upperBound: 12, communicationLimits: false, at: Date.now() };
        out.youngHidden = newSessionHidden();
        out.youngBadge = socialBadge();
        out.youngEnabled = socialEnabled();       // point unique : bilan, Historique, Réglages, relectures
        out.youngActivated = socialActivated();   // le compte, lui, reste activé jusqu'à social_disable
        social.state = cleanSocialState({ enabled: false });
        data.sessionVisibleDefault = true;
        out.youngOffHidden = newSessionHidden();  // jamais activé : masquée quand même, rien de neuf plus tard
        ageRange.stored = { status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: true, at: Date.now() };
        social.state = cleanSocialState({ enabled: true });
        out.limitedEnabled = socialEnabled();
        out.limitedHidden = newSessionHidden();
        return out;
      } finally { account.user = user; Object.assign(social, saved); ageRange.stored = stored; data = makeDefaultData(); data.schema = SCHEMA; }
    })()`);
    sameJSON(r, { adultDefault: true, teenDefault: false, teenHidden: true, teenChosen: false, teenBadge: 3,
      youngHidden: true, youngBadge: 0, youngEnabled: false, youngActivated: true,
      youngOffHidden: true, limitedEnabled: false, limitedHidden: true });
  });

  // social activé sur le compte, puis tranche qui le masque : social_disable une fois par compte et par lancement
  const disableScenario = (stored, enabled, rpcOk = true) => run(`(async () => {
    const user = account.user, saved = { ...social }, st = ageRange.stored, sbSaved = sb, calls = [];
    try {
      account.user = { id: 'u-age' }; socialAgeDisabledFor = null;
      social.state = cleanSocialState({ enabled: ${enabled} }); social.cached = null; social.loading = false;
      ageRange.stored = ${JSON.stringify(stored)};
      sb = { rpc: async fn => { calls.push(fn); if (fn === 'social_disable' && !${rpcOk}) return { data: null, error: { message: 'Failed to fetch' } };
        if (fn === 'social_disable') social.state.enabled = false; return { data: fn === 'social_state' ? { enabled: false } : null, error: null }; } };
      socialDisableForAge(); socialDisableForAge();
      await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
      return { disables: calls.filter(c => c === 'social_disable').length, done: socialAgeDisabledFor === 'u-age' };
    } finally { account.user = user; Object.assign(social, saved); ageRange.stored = st; sb = sbSaved; socialAgeDisabledFor = null; }
  })()`);

  test('âge : social activé puis masqué → désactivé sur le serveur une fois ; 15-17 ans, majeur ou déjà éteint → rien', async () => {
    const at = Date.now();
    const young = { status: 'sharing', upperBound: 12, communicationLimits: false, at };
    const limited = { status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: true, at };
    sameJSON(await disableScenario(young, true), { disables: 1, done: true });
    sameJSON(await disableScenario(limited, true), { disables: 1, done: true });
    sameJSON(await disableScenario(young, true, false), { disables: 1, done: false }, 'hors ligne : redemandé au prochain état');
    sameJSON(await disableScenario(young, false), { disables: 0, done: false }, 'jamais activé : rien');
    sameJSON(await disableScenario({ status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: false, at }, true), { disables: 0, done: false });
    sameJSON(await disableScenario({ status: 'declined', at }, true), { disables: 0, done: false });
  });

  test('âge : moins de 15 ans → « Rejoindre un coach » masqué ; Limites de communication → messages du coach coupés', async () => {
    const r = await run(`(async () => {
      const user = account.user, st = ageRange.stored, chatSaved = { ...chat }, coachState = coach.state;
      try {
        account.user = { id: 'u-age' };
        chat.available = true; chat.threads = cleanChatThreads({ coach: { unread: 2 } }); chat.cachedUnread = 0;
        const at = Date.now(), out = {};
        const snap = name => { out[name] = { join: coachJoinHiddenByAge(), chat: chatAvailable(), unread: chatUnreadTotal(),
          suggest: referralSuggestJoin({ referrer: 'Coach', referrerCoach: true }) }; };
        ageRange.stored = null; snap('none');
        ageRange.stored = { status: 'sharing', lowerBound: 13, upperBound: 15, communicationLimits: false, at }; snap('young');
        ageRange.stored = { status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: true, at }; snap('limited');
        ageRange.stored = { status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: false, at }; snap('teen');
        ageRange.stored = { status: 'sharing', lowerBound: 15, upperBound: 17, communicationLimits: true, at };
        out.limitedCalls = [await chatSend(CHAT_COACH, 'salut'), await chatLoad(CHAT_COACH), await chatPoll(CHAT_COACH)].map(x => x.kind);
        return out;
      } finally { account.user = user; ageRange.stored = st; Object.assign(chat, chatSaved); coach.state = coachState; }
    })()`);
    const v = (join, chat, unread, suggest) => ({ join, chat, unread, suggest });
    sameJSON({ none: r.none, young: r.young, limited: r.limited, teen: r.teen },
      { none: v(false, true, 2, true), young: v(true, true, 2, false), limited: v(false, false, 0, true), teen: v(false, true, 2, true) });
    sameJSON(r.limitedCalls, ['age_limited', 'age_limited', 'age_limited']);
  });

  test('âge : module Swift, entitlement et pont JS concordent', () => {
    const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
    const swift = read('ios/App/App/AgeRangePlugin.swift');
    assert.match(swift, /#if canImport\(DeclaredAgeRange\)\s*\nimport DeclaredAgeRange/);
    assert.match(swift, /if #available\(iOS 26\.0, \*\)/);
    assert.match(swift, /AgeRangeService\.shared\.requestAgeRange\(ageGates: 13, 15, 18, in: controller\)/);
    assert.doesNotMatch(swift, /call\.reject/, 'jamais de rejet : l\'app garde son comportement');
    assert.doesNotMatch(swift.replace(/^\s*\/\/.*$/gm, ''), /isEligibleForAgeFeatures/, 'iOS 26.2 : hors du garde iOS 26.0');
    for (const s of ['sharing', 'declined', 'unavailable']) assert.match(swift, new RegExp(`"status": "${s}"`));
    for (const k of ['lowerBound', 'upperBound', 'communicationLimits']) assert.match(swift, new RegExp(`out\\["${k}"\\]|"${k}":`));
    assert.match(read('ios/App/App/App.entitlements'), /<key>com\.apple\.developer\.declared-age-range<\/key>\s*<true\/>/);
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    assert.equal(pbx.split('/* AgeRangePlugin.swift in Sources */').length - 1, 2, 'PBXBuildFile et phase Sources');
    assert.equal(pbx.split('/* AgeRangePlugin.swift */').length - 1, 3, 'PBXBuildFile, PBXFileReference et groupe App');
    assert.match(pbx, /path = AgeRangePlugin\.swift; sourceTree = "<group>";/);
    // iOS 26 seulement, app à partir de 16.4 : lien faible dans Debug et Release de la cible App, vérifié en CI
    for (const id of ['504EC3171FED79650016851F /* Debug */', '504EC3181FED79650016851F /* Release */']) {
      const block = pbx.slice(pbx.indexOf(`${id} = {`), pbx.indexOf('name = ', pbx.indexOf(`${id} = {`)));
      assert.match(block, /OTHER_LDFLAGS = \(\s*"\$\(inherited\)",\s*"-weak_framework",\s*DeclaredAgeRange,\s*\);/, id);
    }
    const ios = read('.github/workflows/ios.yml');
    for (const app of ['build/Build/Products/Debug-iphonesimulator/App.app', 'build/App.xcarchive/Products/Applications/App.app']) {
      assert.ok(ios.includes(`bash scripts/ios/check-weak-frameworks.sh ${app}`), app);
    }
    assert.match(read('js/platform/native.js'), /AgeRange\.request\(\)/);
    for (const f of ['index.html', 'sw.js']) assert.ok(read(f).includes('js/data/age-range.js'), f);
  });
}
