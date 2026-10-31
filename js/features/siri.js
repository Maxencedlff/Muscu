// ═══════════════════════════════════════════════════════════
//  Siri et raccourcis : « Démarrer ma séance » (app iOS)
// ═══════════════════════════════════════════════════════════
'use strict';

// Le raccourci (App Intents, ios/App/AppExtras/StartSessionIntent.swift) ouvre l'app et lui laisse une
// demande ; ios/App/AppExtras/ShortcutsPlugin.swift la transmet ici, une seule fois. La séance démarre
// exactement comme par le bouton de l'accueil (startSessionFlow : séance vide refusée, séance déjà en
// cours proposée à la reprise).
//
// Une demande n'est suivie que si l'app est prête à l'écouter : pas pendant Bienvenue, les questions
// du premier lancement ou un dialogue ouvert (l'app s'ouvre alors simplement), et pas si elle est
// trop ancienne (Siri qui répond, puis l'app ouverte une minute plus tard : rien ne démarre).

const SIRI_MAX_AGE_MS = 60_000;

// Que faire d'une demande (logique pure, testée dans tests/unit/companions.mjs) :
//   'resume' : une séance est en cours, on y retourne ; 'start' : on démarre la prochaine séance ;
//   null     : rien (demande inconnue ou trop ancienne, app occupée, aucune séance au programme)
function siriDecision(req, { now = Date.now(), busy = false, active = false, next = null } = {}) {
  if (req?.action !== 'startSession' || !(now - Number(req.at) <= SIRI_MAX_AGE_MS) || Number(req.at) > now + 5000) return null;
  if (busy) return null;
  if (active) return 'resume';
  return next ? 'start' : null;
}

// Écran qui attend une réponse : Bienvenue, questions du premier lancement, dialogue ou feuille
function siriBusy() {
  return dataBroken || onboardingNeeded() || !!document.querySelector('.auth, .onb, .ios-dialog, .sheet-root');
}

async function handleSiriRequest(req) {
  const next = nextSessionCat(sessionKeys());
  const what = siriDecision(req, { busy: siriBusy(), active: !!activeSession, next });
  if (what === 'resume') { if (currentView() !== 'session') navigate('session'); }
  else if (what === 'start') await startSessionFlow(next);
}

// Avant la fin du démarrage, aucune demande n'est suivie : la séance en cours n'est pas encore restaurée
// (siriDecision répondrait « démarrer » et la nouvelle séance écraserait celle enregistrée). La demande
// reste alors dans ShortcutInbox (ShortcutsPlugin.swift) et siriBoot la prend.
let siriReady = false;

// Appelé par init.js une fois l'app démarrée (séance restaurée, après Bienvenue) : demande laissée avant
// le lancement, puis celles qui arrivent app ouverte (évènement, puis la demande est consommée)
async function siriBoot() {
  if (siriReady) return;
  siriReady = true;
  Native.shortcuts.onRequest(async () => {
    const req = await Native.shortcuts.takeRequest();
    if (req) await handleSiriRequest(req);
  });
  const req = await Native.shortcuts.takeRequest();
  if (req) await handleSiriRequest(req);
}
