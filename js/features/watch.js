// ═══════════════════════════════════════════════════════════
//  Apple Watch : la séance en cours, au poignet
// ═══════════════════════════════════════════════════════════
'use strict';

// La montre n'a aucune donnée à elle : l'iPhone lui envoie l'état de la séance (exercice, série,
// repos) et elle renvoie des gestes (valider la série, passer le repos, ±15 s). La séance, ses
// règles et sa sauvegarde restent ici, au seul endroit où elles existent. Côté natif :
// ios/App/AppExtras/WatchPlugin.swift (WatchConnectivity) et l'app ios/App/Watch/.
// Tout reste entre l'iPhone et la montre : rien ne part au serveur.
//
// Un geste de la montre peut arriver en retard (iPhone en veille, message mis en file) : il porte la
// série qu'il visait (ei, si) et son heure (at) ; il n'est appliqué que si c'est toujours la série en
// cours et s'il a moins de 30 s au moment où le JS l'applique (la vue web suspendue pendant que
// l'iPhone est verrouillé ne le traite qu'au déverrouillage : la vérification du natif ne suffit pas).
//
// Rien n'est écouté ni envoyé avant la fin du démarrage (watchBoot, appelé par init.js une fois la
// séance restaurée) : un geste gardé par le natif serait sinon jugé sur « pas de séance ».

const WATCH_VERSION = 1;
const WATCH_MAX = { title: 40, exercise: 60, load: 30, next: 90 };
const WATCH_ADJUST = 15;   // secondes, comme les boutons −15 / +15 du repos
const WATCH_ACTION_MAX_AGE_MS = 30_000;   // même âge maximal que côté natif (Companion.actionMaxAge)
const WATCH_CLOCK_SKEW_MS = 5_000;        // horloge de la montre un peu en avance : toléré

// Pourquoi la série en cours ne se valide pas depuis la montre ('' : elle se valide).
//   effort  : chrono d'une série en durée en cours (gainage, tapis…), il se pilote sur l'iPhone
//   measure : série en durée ou cardio, dont la valeur se saisit sur l'iPhone
//   editing : une série validée est rouverte sur l'iPhone
//   odd     : valeur inhabituelle, à confirmer sur l'iPhone (comme au ✓ de l'iPhone)
function watchBlockReason(session, cur, { editing = false, odd = false } = {}) {
  const ex = cur && session?.exercises?.[cur.ei];
  const s  = ex?.sets?.[cur.si];
  if (!s || s.done) return 'none';
  if (session.effort) return 'effort';
  if (measureOf(ex) !== 'reps') return 'measure';
  if (editing) return 'editing';
  if (odd) return 'odd';
  return '';
}

// Texte de la montre pour chaque blocage (le détail se lit sur l'iPhone)
const WATCH_BLOCK_TEXT = {
  effort:  'Chrono en cours sur l\'iPhone',
  measure: 'Série à saisir sur l\'iPhone',
  editing: 'Correction en cours sur l\'iPhone',
  odd:     'À confirmer sur l\'iPhone',
};

// État envoyé à la montre (logique pure, testée dans tests/unit/companions.mjs). Textes bruts, bornés :
// WatchConnectivity n'accepte que des types de liste de propriétés, l'état part donc en JSON.
//   session : séance en cours (activeSession) ou null ; cur : série en cours (currentSet()) ou null
//   rest    : { endTime (ms), total (s) } pendant un repos, sinon null
//   block   : watchBlockReason(…) ; next : prochaine séance quand aucune n'est en cours
//   upcoming: pendant un repos, la sous-série qui suit (techNextSub : reprise d'un rest-pause, bloc d'un
//             cluster) : seul le texte l'annonce, cur reste la cible de « Valider »
function watchState(session, cur, { rest = null, block = '', next = null, upcoming = null } = {}) {
  if (!session) {
    return { v: WATCH_VERSION, active: false,
             next: next ? { title: String(next.title).slice(0, WATCH_MAX.title), tint: next.tint } : null };
  }
  const xs = session.exercises || [];
  const total = xs.reduce((a, ex) => a + ex.sets.length, 0);
  const done  = xs.reduce((a, ex) => a + ex.sets.filter(s => s.done).length, 0);
  const set   = restActivityNext(session, (rest && upcoming) || cur);   // { exercise, set, load } ou null (tout est fait)
  const ex    = cur ? xs[cur.ei] : null;
  return {
    v: WATCH_VERSION,
    active: true,
    title: rawLabel(session.category, session.programme).slice(0, WATCH_MAX.title),
    tint:  restActivityTint(sessionMeta(session.category, session.programme).color),
    startedAt: session.startedAt,
    done, total,
    cur: set ? { ei: cur.ei, si: cur.si } : null,
    exercise: set ? set.exercise.slice(0, WATCH_MAX.exercise) : '',
    setNo: set ? set.set : 0,
    setCount: ex ? ex.sets.length : 0,
    load: set ? set.load.slice(0, WATCH_MAX.load) : '',
    canValidate: !!set && block === '',
    blocked: set && block ? (WATCH_BLOCK_TEXT[block] || '') : '',
    rest: rest && rest.endTime > 0 ? { endTime: Math.round(rest.endTime), total: Math.max(1, Math.round(rest.total)) } : null,
  };
}

// Geste reçu de la montre, vérifié avant d'y toucher : { type, at, ei?, si?, d? } → action propre, ou null.
//   at         : heure du geste (ms) ; plus de 30 s, dans le futur ou absente : ignoré
//   validate   : la série visée doit être la série en cours, validable depuis la montre
//   skipRest   : seulement pendant un repos
//   restAdjust : ±15 s seulement, pendant un repos
function watchActionFor(msg, state, now = Date.now()) {
  if (!msg || typeof msg !== 'object' || !state?.active) return null;
  const at = Number(msg.at);
  if (!(now - at <= WATCH_ACTION_MAX_AGE_MS) || at > now + WATCH_CLOCK_SKEW_MS) return null;
  if (msg.type === 'validate') {
    const ok = state.canValidate && state.cur && msg.ei === state.cur.ei && msg.si === state.cur.si;
    return ok ? { type: 'validate', ei: msg.ei, si: msg.si } : null;
  }
  if (msg.type === 'skipRest') return state.rest ? { type: 'skipRest' } : null;
  if (msg.type === 'restAdjust') {
    const d = Number(msg.d);
    return state.rest && (d === WATCH_ADJUST || d === -WATCH_ADJUST) ? { type: 'restAdjust', d } : null;
  }
  return null;
}

// ── Branchement à l'app ──────────────────────────────────────

let watchLastSent = '';   // dernier état envoyé (JSON) : rien n'est renvoyé s'il n'a pas changé
let watchReady    = false; // démarrage fini (watchBoot) : avant, la séance n'est pas encore restaurée

function currentWatchState() {
  const cur = activeSession ? currentSet() : null;
  if (!activeSession) {
    const keys = sessionKeys(), cat = nextSessionCat(keys);
    const next = cat ? { title: rawLabel(cat), tint: restActivityTint(sessionMeta(cat).color) } : null;
    return watchState(null, null, { next });
  }
  const ex = cur && activeSession.exercises[cur.ei], s = ex?.sets[cur.si];
  const odd = !!s && !s.done && measureOf(ex) === 'reps'
    && !!unusualSetText(ex, { ...s, reps: String(s.reps ?? '').trim() ? s.reps : setGoal(ex, s) });
  const block = watchBlockReason(activeSession, cur, { editing: !!editingSet, odd });
  const rest = restActive ? { endTime: restEndTime, total: restTotal } : null;
  return watchState(activeSession, cur, { rest, block, upcoming: rest ? techNextSub() : null });
}

// Appelé à chaque sauvegarde de la séance (persistSession) : début, série validée, repos, fin.
// Il est appelé à chaque frappe dans un champ, d'où la comparaison avec le dernier envoi.
function syncWatch() {
  if (!watchReady || !Native.watch.available) return;
  let json;
  try { json = JSON.stringify(currentWatchState()); }
  catch { return; }   // la montre ne doit jamais empêcher la sauvegarde de la séance

  if (json === watchLastSent) return;
  watchLastSent = json;
  Native.watch.send(json);
}

// Geste de la montre, appliqué comme le même geste sur l'iPhone
function handleWatchAction(msg) {
  const action = watchActionFor(msg, currentWatchState());
  if (!action) { watchLastSent = ''; syncWatch(); return; }   // geste périmé : la montre reçoit l'état réel
  if (action.type === 'validate') validateSet(action.ei, action.si);
  else if (action.type === 'skipRest') skipRest();
  else adjustRest(action.d);
  persistSession();   // sauvegarde, et l'état suivant part vers la montre
}

// Appelé par init.js une fois la séance restaurée (avec son repos et son chrono d'effort). Les gestes
// et demandes arrivés avant sont gardés par le natif (retainUntilConsumed, WatchPlugin.swift) et remis
// ici, à l'addListener : ils sont donc jugés sur la vraie séance. Puis le premier état part (sans séance
// en cours, rien d'autre ne l'enverrait).
function watchBoot() {
  if (watchReady) return;
  watchReady = true;
  Native.watch.onAction(handleWatchAction);
  // La montre vient d'ouvrir son app : elle redemande l'état (le dernier envoi a pu se perdre)
  Native.watch.onRequest(() => { watchLastSent = ''; syncWatch(); });
  syncWatch();
}
