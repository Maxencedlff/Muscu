// ═══════════════════════════════════════════════════════════
//  Live Activity du repos (app iOS : écran verrouillé et Dynamic Island)
// ═══════════════════════════════════════════════════════════
'use strict';

// iOS dessine lui-même le compte à rebours à partir de l'heure de fin (Text(timerInterval:),
// ProgressView(timerInterval:)) : l'app n'envoie rien chaque seconde, seulement quand le repos
// commence, change (±15 s, autre durée) ou s'arrête. Voir ios/App/App/LiveActivityPlugin.swift.
// Apple limite les données d'une Live Activity à 4 Ko (ActivityKit, « Displaying live data with
// Live Activities ») : les textes sont donc bornés ici.

// Couleurs de séance rendues par une couleur système d'iOS (claire ou sombre selon l'écran) :
// les tokens de css/base.css reprennent exactement ces couleurs système.
const REST_ACTIVITY_TINTS = ['orange', 'red', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink'];
const REST_ACTIVITY_MAX   = { title: 40, exercise: 60 };

// « var(--orange) » → 'orange', « #30b0c7 » → '#30B0C7', sinon la couleur de l'app ('indigo')
function restActivityTint(color) {
  const c = String(color ?? '').trim();
  const token = /^var\(--([a-z]+)\)$/.exec(c)?.[1];
  if (token && REST_ACTIVITY_TINTS.includes(token)) return token;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toUpperCase();
  return 'indigo';
}

// Série suivante : { exercise, set, load } avec load = « 80 kg × 8 », « 12 reps » au poids du
// corps, '' sans reps prévues. null quand toutes les séries sont faites.
function restActivityNext(session, cur) {
  const ex = cur && session?.exercises?.[cur.ei];
  const s  = ex?.sets?.[cur.si];
  if (!s) return null;
  const reps = String(s.reps ?? '').trim();
  const w    = fmtW(s.weight);
  const m    = measureOf(ex);
  const kind = loadKind(ex);
  const load = !reps ? '' : m !== 'reps' || kind !== 'charge' ? measureSetTxt(s, m, kind) : w ? `${w} ${unitLbl()} × ${reps}` : `${reps} reps`;
  return { exercise: String(ex.name).slice(0, REST_ACTIVITY_MAX.exercise), set: cur.si + 1, load };
}

// Données envoyées au module natif (logique pure, testée dans tests/unit/run.mjs)
function restActivityPayload(session, cur, { endTime, total }) {
  return {
    endTime,
    total: Math.max(1, Math.round(total)),
    title: rawLabel(session.category, session.programme).slice(0, REST_ACTIVITY_MAX.title),
    color: restActivityTint(sessionMeta(session.category, session.programme).color),
    next:  restActivityNext(session, cur),
  };
}

let restActivityLive = false;   // une Live Activity a été demandée pour le repos en cours

// Début du repos, ±15 s, autre durée, reprise d'une séance restaurée
function syncRestActivity() {
  if (!Native.isNative || !restActive || !activeSession) return;
  const payload = restActivityPayload(activeSession, currentSet(), { endTime: restEndTime, total: restTotal });
  if (restActivityLive) Native.liveActivity.update(payload);
  else Native.liveActivity.start(payload);
  restActivityLive = true;
}

// Chrono d'effort (gainage…) : la même Live Activity, en phase « effort », compte jusqu'à la fin du
// côté en cours ; le repos qui suit la remplace (syncRestActivity). Chrono libre : pas d'heure de fin.
function syncEffortActivity() {
  const e = activeSession?.effort;
  if (!Native.isNative || !e?.target) return;
  const c = effortClock(e), ex = activeSession.exercises[e.ei];
  if (c.phase !== 'effort') return;
  const sideEnd = e.start + (c.side === 2 ? 2 * e.target + EFFORT_SWITCH_S : e.target) * 1000;
  const payload = {
    endTime: sideEnd, total: e.target,
    title: rawLabel(activeSession.category, activeSession.programme).slice(0, REST_ACTIVITY_MAX.title),
    color: restActivityTint(sessionMeta(activeSession.category, activeSession.programme).color),
    next: null, phase: 'effort',
    label: `${ex.name}${e.sides === 2 ? ` · côté ${c.side}` : ''}`.slice(0, 60),
  };
  if (restActivityLive) Native.liveActivity.update(payload); else Native.liveActivity.start(payload);
  restActivityLive = true;
}

// Repos fini, passé, annulé, séance terminée ou abandonnée : retirée tout de suite
// (Apple HIG, Live Activities : « Always end a Live Activity immediately when the task ends »)
function endRestActivity() {
  restActivityLive = false;
  Native.liveActivity.end();
}
