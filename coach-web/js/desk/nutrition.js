// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : onglet Nutrition de la fiche (#/eleve/<id>/nutrition ; docs/COACH_WEB.md, vague 4 ;
//  maquette 5-nutrition)
//
//  - Plan diète envoyé à l'élève (coach_student_programmes : ce que j'ai envoyé ; serveur d'avant : mon plan gardé sur
//    mon compte), ses objectifs, la date d'envoi et s'il l'a ouvert.
//  - Semaine cochée, seulement si l'élève partage « Suivi de ma diète » (coach_student_diet) : 7 pastilles (suivi,
//    partiel, pas suivi, rien de noté), le détail d'un jour (repas cochés, avec les aliments du plan), calories et
//    macros face à l'objectif, eau, sel, moyennes de la semaine. Sans partage : rien d'autre que l'endroit où l'activer.
//  - Envoi : un de mes plans (coachDietPayload, comme l'app ; l'élève doit avoir accepté les plans de son coach).
//  - Modifier le plan reçu par l'élève, ou en créer un : l'éditeur des plans diète (js/desk/diet-editor.js), dans
//    l'onglet (#/eleve/<id>/nutrition/edit, …/new, …/<plan>), avec la recherche Ciqual.
// ═══════════════════════════════════════════════════════════
'use strict';

const nt = { id: null, loading: false, kind: null, via: null, diets: [], back: 0, sel: null, busy: false, at: 0 };

async function deskNtOpen(id, { force = false } = {}) {
  if (!force && nt.id === id && (nt.loading || Date.now() - nt.at < DESK_REFRESH_MS)) return;
  if (nt.id !== id) Object.assign(nt, { back: 0, sel: null });
  Object.assign(nt, { id, loading: true, kind: null, diets: [], at: Date.now() });
  deskRender();
  const [sent, doc] = await Promise.all([deskLoadSentProgs(id), deskDoc()]);
  if (nt.id !== id) return;
  nt.loading = false;
  if (sent.ok) { nt.via = 'sent'; nt.diets = sent.data.diets; }
  else if (sent.kind === 'missing') {
    nt.via = 'doc';
    const st = deskChatRow(id)?.st, plans = doc.data?.dietPlans || {};
    nt.diets = (st?.sent || []).filter(x => isDietSentId(x.id)).sort((a, b) => b.sentAt - a.sentAt).map(x => {
      const planId = Object.keys(plans).find(k => dietSentId(k) === x.id && !plans[k].archived);
      return planId ? { id: x.id, sentAt: x.sentAt, seen: x.seen, data: plans[planId] } : null;
    }).filter(Boolean);
  } else if (sent.kind === 'signed_out') return deskEndSession();
  else nt.kind = sent.kind;
  deskRender();
}

const deskNtL = ml => `${fmtNum(Math.round(ml / 100) / 10, 1)} L`;
const deskNtPctTxt = (v, goal) => (goal ? `${Math.round(v / goal * 100)} %` : '');

// Barre de progression en SVG (la CSP refuse les styles en ligne) : couleur neutre, jamais l'orange des actions
function deskNtBar(pct) {
  const w = Math.max(0, Math.min(100, pct || 0));
  return `<svg class="bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="bar-b" width="100" height="6" rx="3"/><rect class="bar-f" width="${w}" height="6" rx="3"/></svg>`;
}

function deskNtPlanHtml(r) {
  const p = nt.diets[0] || null;
  const base = `#/eleve/${encodeURIComponent(r.id)}/nutrition`;
  const btn = `<div class="ck-acts nt-acts">${p ? `<a class="btn tint" href="${base}/edit" data-dt="edit-sent">${deskIcon('pen', 'sm')}Modifier ce plan</a>` : ''}
    <a class="btn" href="${base}/new" data-dt="new-for">${deskIcon('plus', 'sm')}Créer un plan</a>
    <button type="button" class="btn" data-nt="send" ${nt.busy ? 'disabled aria-busy="true"' : ''}>${deskIcon('send', 'sm')}Envoyer un de mes plans</button></div>`;
  if (!p) {
    return `<div class="head nt-head"><div class="grow"><h2 class="ed-t">Plan de nutrition</h2><div class="sub">${esc(`Aucun plan envoyé à ${r.name} pour l'instant.`)}</div></div>${btn}</div>`;
  }
  const line = [deskNtPlanHead(p.data), `envoyé le ${fmtDate(p.sentAt, 'short')}`, p.seen ? `vu par ${r.name}` : 'pas encore ouvert'].filter(Boolean).join(' · ');
  // Repas du plan loin de son objectif (plan sur un jour) : dit une fois, avec où le corriger
  const k = p.data.days?.mode ? null : deskNtDayKcal(p.data);
  const gapNote = k?.gap ? `${k.gap < 0 ? `Il manque ${fmtNum(-k.gap)} kcal dans les repas pour atteindre l'objectif` : `Les repas dépassent l'objectif de ${fmtNum(k.gap)} kcal`} : « Modifier ce plan » pour les ajuster.` : '';
  return `<div class="head nt-head"><div class="grow"><h2 class="ed-t">${esc(`Plan « ${p.data.name} »`)}</h2><div class="sub" id="nt-plan-line">${esc(line)}</div></div>${btn}</div>
    ${gapNote ? `<p class="gfoot pg-note warn" id="nt-plan-gap">${esc(gapNote)}</p>` : ''}
    ${nt.via === 'doc' ? `<p class="gfoot pg-note">${esc('Plan lu sur ton compte : le serveur ne rend pas encore la version envoyée (mise à jour à venir).')}</p>` : ''}
    ${p.data.consigne ? `<p class="gfoot pg-note">${esc(`Consigne : « ${p.data.consigne} »`)}</p>` : ''}`;
}

function deskNtHtml(r, d) {
  // …/nutrition/<edit | new | plan> : l'éditeur des plans diète, dans l'onglet (js/desk/diet-editor.js)
  if (deskRoute().part) return deskDtFrameHtml(r);
  if (nt.id !== r.id || nt.loading) return '<div class="empty" role="status">Chargement de la nutrition…</div>';
  if (nt.kind) return `<div class="empty" role="alert">${esc(deskErrorText(nt.kind))}<br><button type="button" class="btn tint" data-nt="retry">Réessayer</button></div>`;
  const plan = deskNtPlanHtml(r);
  if (d.loading || !d.weeks) return `${plan}<div class="empty" role="status">Chargement de la semaine…</div>`;
  const diet = d.diet;
  if (!diet) return `${plan}<div class="empty">Le suivi de la diète n'est pas encore ouvert sur le serveur : le plan envoyé reste visible ici.</div>`;
  if (!diet.shared) {
    return `${plan}<div class="empty"><b>${esc(`${r.name} ne partage pas le suivi de sa diète.`)}</b><br>${esc(`Tu ne vois ni ses repas cochés ni ses calories. ${r.name} peut l'activer dans l'app : Réglages › Coach › Partager avec mon coach › Suivi de ma diète.`)}</div>`;
  }
  const now = d.now || Date.now();
  const days = deskNtWeek(diet, nt.back, now);
  const firstDay = days[0].ts;
  const sel = days.find(x => x.day === nt.sel) || [...days].reverse().find(x => x.status !== 'future' && x.x) || days.find(x => x.status !== 'future') || days[0];
  const pdata = nt.diets[0]?.data || null;
  const word = { ok: 'Suivi', part: 'Partiel', off: 'Pas suivi', none: 'Rien de noté', today: 'En cours', future: 'À venir' };
  const dot = s => (s === 'future' ? '<i class="f"></i>' : `<i class="${{ ok: 's', part: 'p', off: 'n', none: 'z', today: 'c' }[s]}"></i>`);
  const strip = `<div class="group nt-days" role="radiogroup" aria-label="Jours de la semaine">${days.map(x => `<button type="button" role="radio" class="nt-day${x.day === sel.day ? ' on' : ''}" aria-checked="${x.day === sel.day}" data-nt="day" data-v="${x.day}" ${x.status === 'future' ? 'aria-disabled="true"' : ''}
      aria-label="${esc(`${deskCap(fmtDate(x.ts, 'day'))} : ${word[x.status]}`)}"><span class="t2">${x.dow}</span><b class="tnum">${x.num}</b><span class="dp big">${dot(x.status)}</span></button>`).join('')}</div>
    <div class="legend"><span><span class="dp"><i class="s"></i></span> Suivi</span><span><span class="dp"><i class="p"></i></span> Partiel</span><span><span class="dp"><i class="n"></i></span> Pas suivi</span><span><span class="dp"><i class="z"></i></span> Rien de noté</span></div>`;
  const wk = `<div class="nt-tools"><div class="wksel group"><button type="button" class="btn link ic" data-nt="older" ${nt.back >= DESK_NT_WEEKS - 1 ? 'aria-disabled="true"' : ''} aria-label="Semaine d'avant">${deskIcon('back', 'sm')}</button>
      <span class="lab" aria-live="polite"><b>Semaine ${deskIsoWeek(firstDay)}</b> <small class="muted">${esc(deskWeekRange(deskDayStart(firstDay)))}</small></span>
      <button type="button" class="btn link ic" data-nt="newer" ${nt.back === 0 ? 'aria-disabled="true"' : ''} aria-label="Semaine suivante">${deskIcon('chevron', 'sm')}</button></div>
      <span class="muted">${esc(deskNtWeekText(days))}</span></div>`;
  const x = sel.x, title = deskCap(fmtDate(sel.ts, 'day'));
  const pday = deskNtPlanDay(pdata, x, sel.ts);
  const meals = deskNtMeals(x, pday);
  const head = [title, x?.kind ? DESK_NT_KIND[x.kind] : '', word[sel.status].toLowerCase()].filter(Boolean).join(' · ');
  const mealsHtml = !x ? `<div class="group"><div class="row"><span class="grow muted">${sel.status === 'today' ? 'Rien de coché aujourd\'hui pour l\'instant.' : 'Rien de noté ce jour-là.'}</span></div></div>`
    : meals.length ? `<ul class="group" aria-labelledby="h-nt-day">${meals.map(m => `<li><div class="row nt-meal"><span class="${m.ok ? 'green' : 'faint'} nt-ck" aria-hidden="true">${m.ok ? deskIcon('check') : '…'}</span>
        <span class="grow"><b>${esc(m.name)}</b>${m.items ? `<span class="t2 blk">${esc(m.items)}</span>` : ''}</span>${m.kcal !== null ? `<span class="v num">${esc(fmtNum(m.kcal))} kcal</span>` : ''}<span class="v nt-st ${m.ok ? 'green' : 'warn'}">${m.ok ? 'Coché' : 'Pas coché'}</span></div></li>`).join('')}</ul>`
      : '<div class="group"><div class="row"><span class="grow muted">Eau ou sel notés, sans repas cochés.</span></div></div>';
  // Deux chiffres, chacun nommé : ce que prévoit le plan pour les repas cochés, ce que l'élève a noté (aliments
  // remplacés ou ajoutés compris, que le coach ne voit pas)
  const ck = x ? deskNtCheckedKcal(meals) : null;
  const eatGap = ck && x.kcal > 0 && Math.abs(x.kcal - ck.kcal) > ck.kcal * 0.1 ? x.kcal - ck.kcal : null;
  const ckHtml = ck ? `<div class="gfoot" id="nt-ck-kcal"><b>${esc(`Repas cochés : ${fmtNum(ck.kcal)} kcal prévus par ton plan.`)}</b>${eatGap !== null
    ? ` ${esc(`${r.name} a noté ${fmtNum(x.kcal)} kcal ce jour-là, ${fmtNum(Math.abs(eatGap))} de ${eatGap > 0 ? 'plus' : 'moins'} : des aliments remplacés ou ${eatGap > 0 ? 'ajoutés' : 'retirés'}.`)}` : ''}</div>` : '';
  const left = `<div class="nt-main">${wk}${strip}<h3 class="gh gap" id="h-nt-day">${esc(head)}</h3>${mealsHtml}${ckHtml}
    <div class="gfoot">${esc(`${r.name} coche les repas de ton plan. Tu ne vois ni les aliments remplacés ni les heures.`)}</div></div>`;
  const macros = deskNtMacros(x);
  const gap = x ? dietShareGap(x) : null;
  const unit = m => (m.unit === 'g' ? ' g' : ' kcal');
  const dayPanel = x ? `<section class="gblock" aria-labelledby="h-nt-mac"><h3 class="gh" id="h-nt-mac">${esc(`${title} : noté par ${r.name}`)}</h3><ul class="group mac" aria-labelledby="h-nt-mac">
      ${macros.map(m => `<li><div class="row blk-row"><div class="mac-l"><span class="grow">${esc(m.label)}${m.key === 'kcal' && gap !== null ? ` <span class="muted sm-t">${esc(`${gap > 0 ? '+' : gap < 0 ? '−' : '±'}${Math.abs(gap)} %`)}</span>` : m.pct !== null ? ` <span class="muted sm-t">${m.pct} %</span>` : ''}</span>
        <span class="num"><span class="strong">${esc(`${fmtNum(m.v)}${unit(m)}`)}</span>${m.goal ? ` <span class="muted">${esc(`objectif ${fmtNum(m.goal)}${unit(m)}`)}</span>` : ''}</span></div>${m.goal ? deskNtBar(m.pct) : ''}</div></li>`).join('')}
      <li><div class="row">${deskIcon('water', 'sm')}<span class="grow">Eau</span><span class="v num"><span class="strong">${esc(deskNtL(x.water))}</span>${x.waterGoal ? ` <span class="muted">${esc(`objectif ${deskNtL(x.waterGoal)}`)}</span>` : ''}</span></div></li>
      ${x.salt !== null ? `<li><div class="row"><span class="grow">Sel</span><span class="v num"><span class="strong">${esc(fmtNum(x.salt, 1))} g</span>${x.saltMax ? ` <span class="muted">${esc(`au plus ${fmtNum(x.saltMax, 1)} g`)}</span>` : ''}</span></div></li>` : ''}
    </ul></section>` : '';
  const av = deskNtAverages(days);
  const avPanel = av ? `<section class="gblock" aria-labelledby="h-nt-av"><h3 class="gh" id="h-nt-av">${esc(`Moyenne de la semaine ${deskIsoWeek(firstDay)}`)} <span class="r muted">${esc(plural(av.n, 'jour noté', 'jours notés'))}</span></h3><ul class="group" aria-labelledby="h-nt-av">
      <li><div class="row"><span class="grow">Calories${av.gap !== null ? ` <span class="muted sm-t">${esc(`${av.gap > 0 ? '+' : av.gap < 0 ? '−' : '±'}${Math.abs(av.gap)} %`)}</span>` : ''}</span><span class="v num"><span class="strong">${esc(`${fmtNum(av.kcal)} kcal`)}</span>${av.goalKcal ? ` <span class="muted">${esc(`objectif ${fmtNum(av.goalKcal)} kcal`)}</span>` : ''}</span></div></li>
      <li><div class="row"><span class="grow">Protéines${av.goalP ? ` <span class="muted sm-t">${esc(deskNtPctTxt(av.p, av.goalP))}</span>` : ''}</span><span class="v num"><span class="strong">${esc(fmtNum(av.p))} g</span>${av.goalP ? ` <span class="muted">${esc(`objectif ${fmtNum(av.goalP)} g`)}</span>` : ''}</span></div></li>
      ${av.water !== null ? `<li><div class="row"><span class="grow">Eau${av.waterGoal ? ` <span class="muted sm-t">${esc(deskNtPctTxt(av.water, av.waterGoal))}</span>` : ''}</span><span class="v num"><span class="strong">${esc(fmtNum(av.water, 1))} L</span>${av.waterGoal ? ` <span class="muted">${esc(`objectif ${fmtNum(av.waterGoal, 1)} L`)}</span>` : ''}</span></div></li>` : ''}
      ${av.salt !== null ? `<li><div class="row"><span class="grow">Sel</span><span class="v num"><span class="strong">${esc(fmtNum(av.salt, 1))} g</span>${av.saltMax ? ` <span class="muted">${esc(`au plus ${fmtNum(av.saltMax, 1)} g`)}</span>` : ''}</span></div></li>` : ''}
    </ul><div class="gfoot">${esc(`Jour suivi : calories à ±${DIET_SHARE_OK_PCT} % de l'objectif et protéines à ${Math.round(DIET_SHARE_PROT_SHARE * 100)} % au moins. Partiel : jusqu'à ${DIET_SHARE_PART_PCT} % d'écart.`)}</div></section>` : '';
  const write = sel.status !== 'future' ? `<a class="btn tint wide gap-t" href="#/eleve/${encodeURIComponent(r.id)}/messages" data-nt="write" data-v="${sel.day}">${deskIcon('messages', 'sm')}${esc(`Écrire à ${r.name} à propos de ${fmtDate(sel.ts, 'day').split(' ')[0]}`)}</a>` : '';
  return `${plan}<div class="cols nut">${left}<div class="side-panel nt-side">${dayPanel}${avPanel}${write}</div></div>`;
}

// ── Gestes ──────────────────────────────────────────────────

async function deskNtSend(id) {
  if (nt.busy) return;
  const name = deskChatRow(id)?.name || 'ton élève';
  const doc = await deskDoc();
  const ids = doc.data ? coachSendableDiets(doc.data) : [];
  if (!ids.length) {
    deskToast(doc.kind ? deskErrorText(doc.kind) : 'Aucun plan sur ton compte : « Créer un plan » en prépare un ici, ou dans l\'app iPhone (onglet Nutrition).');
    return;
  }
  const plans = doc.data.dietPlans;
  const sentIds = new Set(nt.diets.map(x => x.id));
  const choice = await deskChoose({ title: 'Envoyer un plan', text: `Choisis un de tes plans pour ${name}. Un plan déjà envoyé est remplacé chez ${name}.`,
    options: ids.map(k => [k, plans[k].name, [deskNtPlanLine(plans[k]), sentIds.has(dietSentId(k)) ? 'déjà envoyé' : ''].filter(Boolean).join(' · ')]), ok: 'Envoyer' });
  if (!choice) return;
  const v = coachDietPayload(doc.data, choice);
  if (!v.ok) { deskToast(coachErrorText(v.kind)); return; }
  nt.busy = true; deskRender();
  const r = await deskSendProg(id, v.progId, v.data);
  nt.busy = false;
  if (!r.ok) { if (r.kind === 'signed_out') return deskEndSession(); deskToast(coachErrorText(r.kind)); deskRender(); return; }
  deskToast(`Plan « ${v.data.diet.name} » envoyé à ${name}`);
  await deskNtOpen(id, { force: true });
  deskRefresh({ force: true });
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-nt]');
  if (!el) return;
  const route = deskRoute();
  if (route.tab !== 'nutrition' || el.getAttribute('aria-disabled') === 'true') { if (el.getAttribute('aria-disabled') === 'true') e.preventDefault(); return; }
  const a = el.dataset.nt;
  if (a === 'retry') deskNtOpen(route.id, { force: true });
  else if (a === 'send') deskNtSend(route.id);
  else if (a === 'day') { nt.sel = el.dataset.v; deskRender(); document.querySelector(`[data-nt="day"][data-v="${el.dataset.v}"]`)?.focus(); }
  else if (a === 'older' || a === 'newer') {
    nt.back = Math.max(0, Math.min(DESK_NT_WEEKS - 1, nt.back + (a === 'older' ? 1 : -1))); nt.sel = null; deskRender(); document.querySelector(`[data-nt="${a}"]`)?.focus();
  } else if (a === 'write') {
    // Brouillon du message, rien n'est envoyé : le coach le complète dans l'onglet Messages
    const ts = new Date(`${el.dataset.v}T12:00:00`).getTime();
    if (!ms.drafts[route.id]) ms.drafts[route.id] = `À propos de ${fmtDate(ts, 'day')} : `;
    setTimeout(() => { const t = document.getElementById('chat-in'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 0);
  }
});
