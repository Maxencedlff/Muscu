// ═══════════════════════════════════════════════════════════
//  Registre des actions (data-action)
// ═══════════════════════════════════════════════════════════
'use strict';

// Chaque écran déclare ses actions avec registerActions({ 'nom-action': (e, el) => { … } }).
// Un clic sur un élément [data-action] passe par handleAction, qui ne fait qu'aiguiller :
// e est l'événement (null lors d'un appel direct), el l'élément qui porte data-action.
const actionHandlers = new Map();

function registerActions(handlers) {
  for (const [name, run] of Object.entries(handlers)) {
    if (actionHandlers.has(name)) console.warn(`Action déclarée deux fois : ${name}`);
    actionHandlers.set(name, run);
  }
}

async function handleAction(e, el, action) {
  const run = actionHandlers.get(action);
  if (run) await run(e, el, action);
}
