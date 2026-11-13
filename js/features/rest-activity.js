// ═══════════════════════════════════════════════════════════
//  Live Activity du repos (app iOS : écran verrouillé et Dynamic Island)
// ═══════════════════════════════════════════════════════════
'use strict';

// iOS dessine lui-même le compte à rebours à partir de l'heure de fin (Text(timerInterval:),
// ProgressView(timerInterval:)) : l'app n'envoie rien chaque seconde, seulement quand le repos
// commence, change (±15 s, autre durée) ou s'arrête. Voir ios/App/App/LiveActivityPlugin.swift.
// Apple limite les données d'une Live Activity à 4 Ko (ActivityKit, « Displaying live data with
// Live Activities ») : les textes sont donc bornés ici.

// Teinte de la Live Activity, du widget et de la montre : l'orange MDLF, le même pour toutes les séances
// (direction « sobre » : une seule couleur d'action, plus de couleur par séance, plus d'indigo).
// Envoyé en « #RRGGBB » : les versions natives déjà installées savent dessiner un code hex (RestTint,
// WatchTint), un nom inconnu les ferait retomber sur leur indigo d'avant. Les versions natives à jour
// ignorent la valeur et prennent l'orange de l'app, foncé (#C64000) sur fond clair.
const MDLF_TINT = '#FF7A1A';
const REST_ACTIVITY_MAX   = { title: 40, exercise: 60 };

// Couleur de la séance ignorée : toutes les séances ont la teinte de l'app (l'argument reste pour les appelants)
function restActivityTint(_color) { return MDLF_TINT; }

// Série suivante : { exercise, set, of, load } avec load = « 80 kg × 8 », « 12 reps » au poids du
// corps, '' sans reps prévues. null quand toutes les séries sont faites. cur peut être la sous-série
// qui suit (techNextSub : { ei, si, label, set }) : « Squat · Mini-série 1 », sa charge (l'écran iOS
// écrit ensuite « série N », celle qu'elle prolonge)
function restActivityNext(session, cur) {
  const ex = cur && session?.exercises?.[cur.ei];
  const s  = cur?.label ? cur.set : ex?.sets?.[cur.si];
  if (!ex || !s) return null;
  const reps = String(s.reps ?? '').trim();
  const w    = fmtW(s.weight);
  const m    = measureOf(ex);
  const kind = loadKind(ex);
  const load = !reps ? (cur.label && w ? `${w} ${unitLbl()}` : '') : m !== 'reps' || kind !== 'charge' ? measureSetTxt(s, m, kind) : w ? `${w} ${unitLbl()} × ${reps}` : `${reps} reps`;
  // Numéro affiché, échauffements à part : un échauffement se nomme et annonce la série de travail qui le suit
  const warm = !cur.label && isWarmupSet(s), no = setDisplayNo(ex.sets, cur.si);
  const name = cur.label ? `${ex.name} · ${cur.label}`
    : warm ? `${ex.name} · Échauffement ${ex.sets.slice(0, cur.si + 1).filter(isWarmupSet).length}` : String(ex.name);
  // of : nombre de séries de travail (« série 3/4 » sur l'écran verrouillé, build 68 et suivantes ;
  // une build plus ancienne l'ignore et écrit « série 3 »)
  return { exercise: name.slice(0, REST_ACTIVITY_MAX.exercise), set: warm ? no + 1 : Math.max(1, no), of: workSets(ex.sets).length, load };
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
  const payload = restActivityPayload(activeSession, techNextSub() || currentSet(), { endTime: restEndTime, total: restTotal });
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
