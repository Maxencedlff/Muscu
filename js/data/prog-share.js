// ═══════════════════════════════════════════════════════════
//  Partage d'un programme par message : texte lisible (séances, exercices, séries, tempo, repos).
//  Jamais les charges, records ni l'historique, propres à chacun. L'import dans l'appli d'un ami
//  viendra avec les comptes et des liens à envoyer (pas de code dans le message : illisible).
// ═══════════════════════════════════════════════════════════
'use strict';

// Plan partageable du programme progId : { name, sessions: [{ label, ex: [{ n nom, s séries, r repos (s),
// m mesure, t tempo }] }] }
function programmeSharePayload(progId) {
  const sessions = sessionKeys(progId).map(cat => ({
    label: rawLabel(cat, progId),
    ex: (data.programmes[progId]?.exercises?.[cat] || []).map(e => {
      const o = { n: e.name, s: e.sets };
      if (e.rest) o.r = e.rest;
      if (e.measure) o.m = e.measure;
      if (e.tempo) o.t = e.tempo;
      return o;
    }),
  }));
  return { name: progMeta(progId).name, sessions };
}

// Message : le nom du programme, puis chaque séance et ses exercices
function programmeShareText(payload) {
  const exLine = e => {
    const bits = [`${e.s} série${e.s > 1 ? 's' : ''}`];
    if (e.m === 'time') bits.push('en durée');
    else if (e.m === 'cardio') bits.push('cardio');
    if (e.t) bits.push(`tempo ${shortTempo(e.t)}`);
    if (e.r) bits.push(`repos ${fmtRest(e.r)}`);
    return `• ${e.n} : ${bits.join(', ')}`;
  };
  const body = payload.sessions.map(s => `${s.label}\n${s.ex.length ? s.ex.map(exLine).join('\n') : '(aucun exercice)'}`).join('\n\n');
  return `Mon programme « ${payload.name} » sur MDLF Training\n\n${body}`;
}
