// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : fiche d'un élève, onglet « Semaines » (docs/COACH_WEB.md, maquette 2-fiche-semaines)
//
//  Un tableau semaine par semaine avec ce que l'élève partage déjà avec son coach : poids (pesées partagées),
//  séances faites, volume, records, diète et eau (suivi de la diète partagé), mensurations partagées. Les défis ne
//  sont pas partagés avec le coach (docs/DEFIS.md) : le pied du tableau le dit. Courbe du poids sur 90 jours.
//  Colonnes en plus (vague 2) : les suivis échelle, nombre ou automatiques du bilan le plus récent de l'élève, avec
//  la valeur du bilan dont la période tombe dans la semaine (deskCkWeekColumns, deskCkWeekValues).
//  Pas, sommeil et cardio (vague 3) : trois colonnes seulement si l'élève les partage (health.shared), moyennes de la
//  semaine sur les jours relevés (deskHealthWeek) ; sinon une phrase dans le pied du tableau ; serveur d'avant : rien.
//  Onglet « Bilans » : js/desk/review.js ; vague 4 : « Programme » (js/desk/programme.js), « Nutrition »
//  (js/desk/nutrition.js), « Messages » (js/desk/messages.js).
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_TABS = [['weeks', 'Semaines'], ['checkins', 'Bilans'], ['programme', 'Programme'], ['nutrition', 'Nutrition'], ['messages', 'Messages']];

// Une décimale toujours (« 62,0 », « 71,0 ») : les colonnes s'alignent
const DESK_NF1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const deskKg = v => DESK_NF1.format(v);
const deskSigned = (v, unit = '') => (v === null || v === undefined ? '' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${DESK_NF1.format(Math.abs(v))}${unit}`);
// Couleur d'un écart de poids : neutre (le sens voulu dépend de la phase, l'app ne le devine pas)
const deskNa = '<span class="faint" aria-label="Pas de donnée">—</span>';

// Case Pas, Sommeil ou Cardio : valeur, nombre de jours comptés (title et lecteurs d'écran), « — » sans valeur
function deskHealthTd(kind, w) {
  const c = deskHealthCell(kind, w.health?.[kind] || null);
  return c ? `<td title="${esc(c.title)}">${esc(c.text)}${c.small ? `<small aria-hidden="true">${esc(c.small)}</small>` : ''}<span class="sr"> ${esc(c.sr)}</span></td>` : `<td>${deskNa}</td>`;
}

function deskWeekRowHtml(w, cols, ctx, ckCols = [], ckReq = null, hCols = []) {
  const name = `<b class="wn">S${w.week}</b>${w.current ? ' <span class="tag">en cours</span>' : ''}<small>${esc(w.range)}${w.phase ? ` · ${esc(w.phase)}` : ''}</small>`;
  const weight = !ctx.weightShared ? deskNa : w.weight ? `${deskKg(w.weight.avg)}${w.weight.delta !== null ? `<small>${esc(deskSigned(w.weight.delta))}</small>` : ''}` : deskNa;
  const vol = w.volume ? `${fmtNum(Math.round(w.volume / 10) / 100, 2)} t` : deskNa;
  const rec = w.records ? `<span class="gold-t">${deskIcon('trophy', 'xs gold')} ${w.records}</span>` : '<span class="faint">0</span>';
  const diet = !ctx.dietShared ? deskNa : w.diet && w.diet.noted ? `${w.diet.ok} sur ${w.diet.noted}${w.diet.kcal ? `<small>${esc(fmtNum(w.diet.kcal))} kcal</small>` : ''}` : deskNa;
  const water = !ctx.dietShared ? deskNa : w.water !== null ? `${deskKg(w.water)} L` : deskNa;
  const ms = cols.map(k => `<td>${w.measures[k] !== undefined ? esc(deskKg(w.measures[k])) : deskNa}</td>`).join('');
  const ckv = ckCols.length ? deskCkWeekValues(w, ckReq, ckCols) : {};
  const ck = ckCols.map(c => `<td>${ckv[c.key] ? esc(ckv[c.key].text) : deskNa}</td>`).join('');
  const hl = hCols.map(([k]) => deskHealthTd(k, w)).join('');
  return `<tr class="${w.current ? 'cur' : ''}"><th scope="row">${name}</th><td>${weight}</td><td>${w.sessions || '<span class="faint">0</span>'}</td><td>${vol}</td><td>${rec}</td><td>${diet}</td><td>${water}</td>${hl}${ms}${ck}</tr>`;
}

function deskChartHtml(chart, weights) {
  if (!weights?.shared) return '<div class="group"><div class="row"><div class="grow muted">Poids non partagé : l\'élève peut le cocher dans l\'app, Réglages › Coach › Partager avec mon coach.</div></div></div>';
  if (!chart) return '<div class="group"><div class="row"><div class="grow muted">Pas assez de pesées sur 90 jours pour une courbe.</div></div></div>';
  const pts = chart.points.map(p => `${p.x},${p.y}`).join(' ');
  return `<figure class="group chart"><svg viewBox="0 0 ${chart.w} ${chart.h}" role="img" aria-label="${esc(chart.desc)}">
    ${chart.ticks.map(t => `<line class="gl" x1="4" x2="${chart.right}" y1="${t.y}" y2="${t.y}"/><text class="ax" x="${chart.right + 4}" y="${t.y + 3.5}">${esc(fmtNum(t.kg, 1))}</text>`).join('')}
    ${chart.labels.map(l => `<text class="ax" x="${l.x}" y="${chart.h - 5}" text-anchor="${l.anchor}">${esc(l.text)}</text>`).join('')}
    <polyline class="ln" points="${pts}"/>
    ${chart.points.map((p, i) => `<circle class="pt${i === chart.points.length - 1 ? ' last' : ''}" cx="${p.x}" cy="${p.y}" r="${i === chart.points.length - 1 ? 3.2 : 2}"/>`).join('')}
  </svg></figure><div class="gfoot">${esc(plural(chart.n, 'pesée', 'pesées'))} · ${esc(deskSigned(chart.delta, ' kg'))} depuis le ${esc(fmtDate(chart.first.date, 'short'))}</div>`;
}

const DESK_TAB_PATH = { weeks: '', checkins: '/bilans', programme: '/programme', nutrition: '/nutrition', messages: '/messages' };

// tab : 'weeks' (Semaines), 'checkins' (Bilans), 'programme', 'nutrition' ou 'messages'
function deskStudentHtml(d, ui, tab = 'weeks') {
  const r = d.row;
  if (!r) return `<div class="crumb"><a href="#/">${deskIcon('back', 'xs')}Élèves</a></div><div class="empty">Cet élève ne te suit plus, ou le lien est faux.</div>`;
  const base = `#/eleve/${encodeURIComponent(r.id)}`;
  const badge = (k) => k === 'checkins' && r.ckToAnswer ? ` <span class="badge" aria-label="${esc(plural(r.ckToAnswer, 'bilan à répondre', 'bilans à répondre'))}">${r.ckToAnswer}</span>`
    : k === 'messages' && r.unread ? ` <span class="badge" aria-label="${esc(plural(r.unread, 'message non lu', 'messages non lus'))}">${r.unread}</span>` : '';
  const tabs = DESK_TABS.map(([k, l]) => `<a role="tab" href="${base}${DESK_TAB_PATH[k]}" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" id="tab-${k}"${tab === k ? ` aria-controls="panel-${k}"` : ''}>${esc(l)}${badge(k)}</a>`).join('');
  const sinceTxt = r.st.since ? `suivi depuis le ${fmtDate(Date.parse(r.st.since), 'short')}` : '';
  const sub = [r.phase?.text, sinceTxt].filter(Boolean).join(' · ');
  const head = `<div class="crumb"><a href="#/">${deskIcon('back', 'xs')}Élèves</a></div>
  <div class="head st-head">${deskAvatar(r.name, 'lg')}<div class="grow"><h1>${esc(r.name)}</h1><div class="sub">${esc(sub)}</div></div>
    <div class="head-btns">${tab === 'messages' ? '' : `<a class="btn" href="${base}/messages">${deskIcon('messages', 'sm')}Écrire</a>`}
      <button type="button" class="btn tint" data-pg="send-mine">${deskIcon('send', 'sm')}Envoyer un programme</button></div></div>
  <div class="tabs"><div class="seg" role="tablist" aria-label="Fiche de ${esc(r.name)}">${tabs}</div></div>`;
  if (tab === 'messages') return `${head}<div role="tabpanel" id="panel-messages" aria-labelledby="tab-messages">${deskStudentMessagesHtml(r.id)}</div>`;
  if (tab === 'programme') return `${head}<div role="tabpanel" id="panel-programme" aria-labelledby="tab-programme">${deskPgHtml(r)}</div>`;
  if (tab === 'nutrition') return `${head}<div role="tabpanel" id="panel-nutrition" aria-labelledby="tab-nutrition">${deskNtHtml(r, d)}</div>`;
  if (tab === 'checkins') {
    const body = d.loading ? '<div class="empty" role="status">Chargement des bilans…</div>' : d.error ? `<div class="empty" role="alert">${esc(deskErrorText(d.error))}<br><button type="button" class="btn tint" data-action="reload">Réessayer</button></div>` : deskRvPanelHtml(d, r);
    return `${head}<div role="tabpanel" id="panel-checkins" aria-labelledby="tab-checkins">${body}</div>`;
  }
  if (d.loading) return `${head}<div class="empty" role="status">Chargement des semaines…</div>`;
  if (d.error) return `${head}<div class="empty" role="alert">${esc(deskErrorText(d.error))}<br><button type="button" class="btn tint" data-action="reload">Réessayer</button></div>`;
  const w = d.weeks.slice(0, ui.weeks);
  const cols = deskMeasureColumns(d.measures);
  const ctx = { weightShared: !!d.weights?.shared, dietShared: !!d.diet?.shared };
  const ckCols = d.checkins ? deskCkWeekColumns(d.checkins) : [];
  const hCols = deskHealthColumns(d.health);
  const s = deskStudentStats(d.weeks, d.weights, d.now);
  const waist = deskMeasureSummary(d.measures).find(m => m.key === 'waist') || deskMeasureSummary(d.measures)[0] || null;
  const stats = `<div class="stats" aria-label="En bref">
    <div class="stat"><span class="l">${deskIcon('weight', 'xs')}Poids moyen (7 j)</span>${s.weight ? `<b>${deskKg(s.weight.avg)}<small>kg</small></b><span class="d muted">${s.weight.delta !== null ? `${esc(deskSigned(s.weight.delta, ' kg'))} en 1 sem.` : 'pas de pesée la semaine d\'avant'}</span>` : `<b class="faint">—</b><span class="d muted">${ctx.weightShared ? 'aucune pesée en 7 jours' : 'non partagé'}</span>`}</div>
    <div class="stat"><span class="l">${deskIcon('programmes', 'xs')}Séances</span><b>${s.sessions}</b><span class="d muted">semaine en cours</span></div>
    <div class="stat"><span class="l">${deskIcon('diet', 'xs')}Diète suivie</span>${s.diet ? `<b>${s.diet.ok}<small>j sur 7</small></b><span class="d muted">semaine ${s.diet.week}</span>` : `<b class="faint">—</b><span class="d muted">${ctx.dietShared ? 'rien de noté' : 'non partagée'}</span>`}</div>
    <div class="stat"><span class="l">${deskIcon('water', 'xs')}Eau</span>${s.water !== null ? `<b>${deskKg(s.water)}<small>L par jour</small></b><span class="d muted">semaine dernière</span>` : `<b class="faint">—</b><span class="d muted">${ctx.dietShared ? 'rien de noté' : 'non partagée'}</span>`}</div>
    <div class="stat"><span class="l">${deskIcon('trophy', 'xs')}Records</span><b>${s.records}</b><span class="d muted">en 4 semaines</span></div>
    <div class="stat"><span class="l">${deskIcon('tape', 'xs')}${esc(waist ? waist.label : 'Mensurations')}</span>${waist ? `<b>${deskKg(waist.cm)}<small>cm</small></b><span class="d muted">${waist.delta !== null ? `${esc(deskSigned(waist.delta))} depuis le ${esc(fmtDate(waist.from, 'short'))}` : `le ${esc(fmtDate(waist.at, 'short'))}`}</span>` : `<b class="faint">—</b><span class="d muted">${d.measures?.shared ? 'aucune mesure' : 'non partagées'}</span>`}</div>
  </div>`;
  const table = `<div class="group tscroll" tabindex="0" role="region" aria-label="Semaine par semaine"><table class="wk">
    <caption class="sr">Semaine par semaine, de la semaine en cours vers le passé</caption>
    <thead><tr><th scope="col">Semaine</th><th scope="col">Poids (kg)</th><th scope="col">Séances</th><th scope="col">Volume</th><th scope="col">Records</th><th scope="col">Diète (jours)</th><th scope="col">Eau</th>${hCols.map(([, l, u]) => `<th scope="col">${esc(l)}<small>${esc(u)}</small></th>`).join('')}${cols.map(k => `<th scope="col">${esc(bodyMeasureLabel(k))} (cm)</th>`).join('')}${ckCols.map(c => `<th scope="col" class="ckh">${esc(c.head)}</th>`).join('')}</tr></thead>
    <tbody>${w.map(x => deskWeekRowHtml(x, cols, ctx, ckCols, d.checkins, hCols)).join('')}</tbody></table></div>
    ${ui.weeks < d.weeks.length ? `<button type="button" class="btn link more" data-action="more-weeks">Afficher les semaines précédentes</button>` : ''}
    <div class="gfoot">Tout se remplit seul avec ce que ${esc(r.name)} partage : pesées, séances, repas cochés, eau, mensurations${hCols.length ? ', pas, sommeil et cardio' : ''}. Poids : moyenne des pesées de la semaine et écart avec la semaine pesée d'avant. Diète : jours suivis sur les jours notés.${hCols.length ? ' Pas, sommeil et cardio : moyenne des jours relevés par son iPhone dans la semaine.' : ''}${deskHealthStale(d.health, d.now) ? ` <span class="h-stale">Pas, sommeil et cardio : dernier jour reçu le ${esc(fmtDate(deskHealthStale(d.health, d.now), 'short'))}.</span>` : ''} Défis : pas encore partagés avec le coach.${d.health && d.health.shared === false ? ` <span class="h-off">${esc(r.name)} ne partage pas ses pas, son sommeil ni son cardio (réglage dans l'app iPhone : Partager avec mon coach).</span>` : ''}${ckCols.length ? ' Dernières colonnes : réponses à ses bilans, semaine où commence la période du bilan.' : ''}</div>`;
  const panel = `<div class="side-panel">
    <section class="gblock" aria-labelledby="h-chart"><h2 class="gh" id="h-chart">Poids au quotidien <span class="r muted">90 jours</span></h2>${deskChartHtml(d.chart, d.weights)}</section>
    <section class="gblock" aria-labelledby="h-meas"><h2 class="gh" id="h-meas">Mensurations</h2>${d.measures?.shared && deskMeasureSummary(d.measures).length
      ? `<div class="group">${deskMeasureSummary(d.measures).map(m => `<div class="row"><div class="grow">${esc(m.label)}</div><div class="v num"><span class="strong">${esc(fmtNum(m.cm, 1))} cm</span>${m.delta !== null ? ` <span class="muted">${esc(deskSigned(m.delta))}</span>` : ''}</div></div>`).join('')}</div><div class="gfoot">Dernière mesure et écart depuis la première partagée.</div>`
      : `<div class="group"><div class="row"><div class="grow muted">${d.measures?.shared ? 'Aucune mesure partagée pour l\'instant.' : 'Mensurations non partagées.'}</div></div></div>`}</section>
  </div>`;
  return `${head}<div role="tabpanel" id="panel-weeks" aria-labelledby="tab-weeks">${stats}<div class="cols wkc"><div class="tbl-col"><h2 class="gh">Semaine par semaine</h2>${table}</div>${panel}</div></div>`;
}
