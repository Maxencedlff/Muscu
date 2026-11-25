// ═══════════════════════════════════════════════════════════
//  Partage avec le coach, écrans. Données et appels : js/data/coach-share.js.
//
//  - Élève : Réglages › Social et coach › « Partager avec mon coach » (seulement s'il a un coach) →
//    écran `coach-share` : une case par donnée ouverte (Poids du corps ; Mensurations si le serveur les
//    accepte), toutes décochées par défaut, et ce que le coach verra, dit en clair.
//  - Coach : sur la fiche d'un élève qui partage son poids, la courbe de ses pesées (composant de
//    Progrès, js/features/progress-chart.js) ; le volume des séances compte alors son poids du corps
//    (js/data/session-review.js, pied de page dans renderCoachSession). Mensurations partagées : une
//    cellule « Mensurations » → `coach-measures:UID` (dernière valeur de chaque mesure) →
//    `coach-measure:UID:CLÉ` (courbe et historique, en lecture seule).
//  Tout texte venu du serveur passe par esc(). Rien au pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_WEIGHT_CHART_MAX = 90;   // pesées sur la courbe du coach (les plus récentes)

// ── Élève : Réglages › Partager avec mon coach ──────────────

// Cellule de Réglages › Social et coach (élève suivi seulement)
function coachShareSettingsCell() {
  if (!account.user || !coachRole().hasCoach) return '';
  const value = coachShareSummary();
  return `
          <button class="cell cell--nav" data-action="coach-open-share">
            ${cellIco('square.and.arrow.up', 'blue')}
            <span class="cell__body"><span class="cell__title">Partager avec ${myCoachWord('mon')}</span></span>
            ${value !== null ? `<span class="cell__value">${esc(value)}</span>` : ''}
            ${icon('chevron.right', 16)}
          </button>`;
}

// « 12 pesées partagées depuis le 30 oct. », « 8 mesures partagées depuis le 5 nov. »
function coachShareStatusText(st, kind = 'weight') {
  if (!st) return '';
  const since = st.grantedAt ? ` depuis le ${fmtDate(st.grantedAt, 'short')}` : '';
  const [one, many, none] = kind === 'measures' ? ['mesure partagée', 'mesures partagées', 'aucune mensuration']
    : kind === 'diet_log' || kind === 'health' ? ['jour partagé', 'jours partagés', 'aucun jour'] : ['pesée partagée', 'pesées partagées', 'aucune pesée'];
  // Diète : la date dit quand le partage a commencé, le nombre ce que le coach voit (jours d'avant compris, panel nutri-final t1)
  if (kind === 'diet_log' || kind === 'health') return st.n ? `Partagé${since} · ${plural(st.n, 'jour visible', 'jours visibles')}` : `Partagé${since}, ${none} pour l'instant`;
  return st.n ? `${plural(st.n, one, many)}${since}` : `Partagé${since}, ${none} pour l'instant`;
}
const SHARE_OFF_SUB = { weight: 'Tes pesées saisies dans l\'app', measures: 'Taille, bras, cuisses… notés dans Progrès › Mensurations',
  diet_log: 'Repas cochés, calories et macros, eau, sel. Tes 90 derniers jours partent aussi',
  health: 'Lus dans Santé : pas, heures de sommeil et minutes de cardio de chaque jour. Tes 90 derniers jours partent aussi' };

function renderCoachShare() {
  const head = navBar({ title: 'Partager', large: false });
  const view = body => `<div class="view view--grouped coach-share-view">${head}<div class="scr">${body}</div></div>`;
  if (!account.user || !coachRole().hasCoach) {
    return view(`<div class="empty-note">Rejoins d'abord ${coachWord('un')} dans Réglages › Coach.</div>`);
  }
  const st = coachShare.state, name = esc(coachName() || myCoachWord('ton'));
  if (!st) {
    return view(coachShare.error ? coachOfflineNote(coachShare.error, 'Pas d\'Internet. Le partage demande du réseau.') : '<div class="empty-note">Chargement…</div>');
  }
  const kinds = coachShareKindsShown(), withM = kinds.some(k => k.kind === 'measures'), withD = kinds.some(k => k.kind === 'diet_log'), withH = kinds.some(k => k.kind === 'health');
  const cells = kinds.map(k => {
    const on = coachShareOn(k.kind), busy = coachShare.busy === k.kind;
    const sub = on ? coachShareStatusText(st.shares[k.kind], k.kind) : SHARE_OFF_SUB[k.kind] || '';
    return `
          <button class="cell" data-action="coach-share-toggle" data-kind="${k.kind}" role="switch" aria-checked="${on}"${busy ? ' aria-busy="true" disabled' : ''}>
            <span class="cell__body"><span class="cell__title">${esc(k.label)}</span>${sub ? `<span class="cell__sub">${esc(sub)}</span>` : ''}</span>
            ${switchHtml(on)}
          </button>`;
  }).join('');
  // Santé activée : ses pesées ne partent jamais ; sans pesée saisie, le coach n'aurait rien
  const fromHealth = typeof healthEnabled === 'function' && healthEnabled();
  const empty = coachShareOn('weight') && !sharedWeightsPayload().length;
  const emptyM = coachShareOn('measures') && !Object.keys(sharedMeasuresPayload()).length;
  const emptyD = coachShareOn('diet_log') && !dietActivePlan(data);
  // Santé n'a rien rendu (lecture refusée dans Réglages, ou rien d'enregistré) : iOS ne dit pas laquelle
  const emptyH = coachShareOn('health') && Array.isArray(healthDays.list) && !healthDays.list.length;
  const hint = fromHealth || empty || emptyM || emptyD || emptyH ? `<div class="group-foot">${[
    fromHealth ? 'Les pesées lues dans Santé ne sont jamais partagées.' : '',
    emptyH ? 'Rien de lu dans Santé pour l\'instant. Vérifie Réglages › Santé › Accès aux données et appareils › MDLF Training : Pas, Sommeil et Entraînements doivent être activés.' : '',
    empty ? 'Aucune pesée saisie dans l\'app. Ajoute ton poids dans Réglages › Entraînement › Poids du corps.' : '',
    emptyM ? 'Aucune mensuration. Ajoute-les dans Progrès › Mensurations.' : '',
    emptyD ? `Aucun plan de nutrition suivi. ${myCoachWord('Ton')} verra ta diète dès que tu en suis un (Entraînement › Nutrition).` : '',
  ].filter(Boolean).join(' ')}</div>` : '';
  // Serveur à jour (mensurations annoncées) : trois paragraphes courts, ce que le coach voit, ce qui ne part jamais,
  // comment arrêter (panel du 18/11 : le bloc d'un seul tenant n'était pas lu), puis « En savoir plus »
  const foot = withM ? `
        <div class="group-foot"><b>${name} voit</b> seulement ce que tu actives : la date et le poids de chaque pesée saisie dans l'app, la date et la valeur de chaque mensuration${withD ? ', et chaque jour de ta diète : repas cochés, calories, macros, eau, sel et écart avec l\'objectif' : ''}${withH ? ', et pour chaque jour lu dans Santé : le nombre de pas, la durée de sommeil et les minutes de cardio' : ''}. Avec les pesées, le volume des exercices au poids du corps inclut ton poids.</div>
        <div class="group-foot"><b>Jamais</b> : ${withH ? 'le reste de Santé (fréquence cardiaque, phases et heures de tes nuits, lieux, appareils), tes pesées lues dans Santé' : 'tes données Santé'}${withD ? ', le détail de tes aliments, les heures' : ''}. Tes photos ne partent que si tu les envoies. Tes amis ne voient rien.</div>
        <div class="group-foot"><b>Retirer</b> : tu peux arrêter à tout moment, donnée par donnée. Ce que tu désactives est supprimé du serveur et ${name} ne le voit plus, même les anciennes valeurs. Quitter ${myCoachWord('ton')} arrête aussi le partage.${withD || withH ? ` ${withD && withH ? 'Ta diète, tes pas, ton sommeil et ton cardio sont gardés' : withD ? 'Ta diète est gardée' : 'Tes pas, ton sommeil et ton cardio sont gardés'} 90 jours au plus.` : ''}</div>
        <div class="group coach-share-more"><button class="cell cell--action" data-action="open-legal" data-page="coachShare"><span>En savoir plus sur le partage</span></button></div>`
    : `
        <div class="group-foot">${name} verra la date et le poids de chaque pesée saisie dans l'app. Le volume des exercices au poids du corps sera calculé avec ton poids. Jamais tes données Santé. Tes amis ne voient rien.</div>
        <div class="group-foot">Tu peux arrêter à tout moment : tes pesées sont supprimées du serveur et ${name} ne les voit plus, même les anciennes. Quitter ${myCoachWord('ton')} arrête aussi le partage.</div>`;
  return view(`
        ${coachTitle(`Avec ${name}`)}
        <div class="group">${cells}
        </div>${foot}
        ${hint}
        ${cphMineCellHtml()}`);
}
SCREENS.set('coach-share', { render: () => renderCoachShare(), enter: () => { if (coach.state) coachShareRefresh(); else coachRefresh(); cphRefresh({ minAge: 30_000 }); } });

// ── Coach : pesées d'un élève sur sa fiche ──────────────────

// Groupe « Poids du corps » de la fiche. Pose la courbe (chartState) ; dessinée par drawCharts au montage
// de l'écran. L'élève ne partage pas : le groupe le dit, sans aucun chiffre (avant : groupe absent, sans explication)
function coachWeightGroupHtml(uid, who) {
  const f = coachWeightsOf(uid);
  if (!f.shared) {
    // Pas encore lu, ou lecture en échec (serveur sans la fonction, hors ligne) : rien, plutôt qu'un « ne partage pas » faux
    if (!f.loadedAt || f.error) return '';
    return `
        <div class="group-title">Poids du corps</div>
        <div class="group"><div class="cell coach-weight-off"><span class="cell__body"><span class="cell__sub">${who} ne partage pas son poids. Le réglage est de son côté : Réglages › Social et coach › Partager avec ${coachWord('mon', myOwnCoachForm())}.</span></span></div></div>`;
  }
  const unit = unitLbl();
  const since = f.since ? ` depuis le ${esc(fmtDate(f.since, 'short'))}` : '';
  const foot = `<div class="group-foot">${who} partage son poids avec toi. Ces données disparaissent si le partage s'arrête.${since ? ` Partagé${since}.`.replace('..', '.') : ''}</div>`;
  if (!f.weights.length) {
    return `
        <div class="group-title">Poids du corps</div>
        <div class="group"><div class="cell"><span class="cell__body"><span class="cell__sub">Aucune pesée pour l'instant.</span></span></div></div>
        ${foot}`;
  }
  const series = f.weights.slice(0, COACH_WEIGHT_CHART_MAX).reverse();
  const last = f.weights[0];
  const month = f.weights.filter(w => w.date >= last.date - 30 * 86_400_000);
  const delta = toUnitW(last.kg) - toUnitW(month[month.length - 1].kg);
  const trend = month.length > 1 && Math.abs(delta) >= 0.05 ? `${delta > 0 ? '+' : '−'}${fmtNum(Math.abs(delta), 1)} ${unit} sur 30 jours` : 'Stable sur 30 jours';
  const val = kg => `${fmtNum(toUnitW(kg), 1)} ${unit}`;
  chartState = series.length > 1 ? {
    vals: series.map(w => toUnitW(w.kg)), dates: series.map(w => w.date), points: series, bw: false, mode: 'weight', color: 'var(--teal)',
    xLabels: [], sel: null, name: 'Poids du corps', fromZero: false,
    fmtVal: v => `${fmtNum(v, 1)} ${unit}`, axisFmt: v => fmtNum(Math.round(v * 10) / 10), bubble: p => `${fmtDate(p.date, 'short')} · ${val(p.kg)}`,
  } : null;
  return `
        <div class="group-title">Poids du corps</div>
        <div class="group"><div class="cell"><span class="cell__body">
          <span class="cell__title num">${val(last.kg)}</span>
          <span class="cell__sub">${esc(trend)} · ${esc(fmtDate(last.date))}</span>
        </span></div></div>
        ${chartState ? `<div class="chart" id="exChart">
          <canvas class="stats-canvas" role="img" aria-label=""></canvas>
          <div class="chart-bubble num" hidden></div>
        </div>` : ''}
        ${foot}`;
}

// ── Coach : mensurations d'un élève ─────────────────────────

// Groupe « Mensurations » de la fiche (vide si l'élève ne partage pas, ou serveur sans les mensurations) :
// nombre de mesures, date de la dernière, et l'écart du tour de taille depuis le début (le repère d'une sèche)
function coachMeasuresGroupHtml(uid) {
  const f = coachMeasuresOf(uid);
  if (!f.shared) return '';
  const keys = BODY_MEASURE_KEYS.filter(k => f.measures[k]?.length);
  const last = Math.max(0, ...keys.map(k => f.measures[k][0].date));
  const waist = f.measures.waist?.length > 1 ? bodyMeasureDelta(coachMeasureSeries(uid, 'waist')) : null;
  const sub = keys.length ? [fmtDate(last), waist && fmtLenDelta(waist.dFirst) ? `taille ${fmtLenDelta(waist.dFirst)} depuis le début` : ''].filter(Boolean).join(' · ')
    : 'Aucune mensuration pour l\'instant';
  return `
        <div class="group-title">Mensurations</div>
        <div class="group">
          <button class="cell cell--nav" data-action="coach-open-measures" data-uid="${esc(uid)}">
            ${icon('ruler', 22)}
            <span class="cell__body"><span class="cell__title">${keys.length ? plural(keys.length, 'mesure partagée', 'mesures partagées') : 'Partagées avec toi'}</span><span class="cell__sub">${esc(sub)}</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
}
// Bilan de la fiche : poids du corps (courbe), puis mensurations
function coachBilanHtml(uid, who) { return coachWeightGroupHtml(uid, who) + coachMeasuresGroupHtml(uid) + cphCoachGroupHtml(uid); }

// Série d'une mesure partagée, dans l'ordre chronologique
function coachMeasureSeries(uid, key) { return (coachMeasuresOf(uid).measures[key] || []).slice().reverse(); }

function renderCoachMeasures(uid) {
  const p = coachStudent(uid), f = coachMeasuresOf(uid), unit = lenUnitLbl();
  const head = navBar({ title: 'Mensurations', large: false });
  const view = body => `<div class="view view--grouped coach-measures-view">${head}<div class="scr">${body}</div></div>`;
  if (!p) return view(`<div class="empty-note">${coach.state ? 'Cette personne ne fait plus partie de tes élèves.' : 'Chargement…'}</div>`);
  if (!f.loadedAt) return view(f.error ? coachOfflineNote(f.error, 'Pas d\'Internet. Ses mensurations s\'afficheront quand le réseau reviendra.') : '<div class="empty-note">Chargement…</div>');
  const who = esc(personName(p));
  if (!f.shared) return view(`<div class="empty-note">${who} ne partage plus ses mensurations.</div>`);
  const rows = BODY_MEASURES.filter(m => f.measures[m.key]?.length).map(m => {
    const d = bodyMeasureDelta(coachMeasureSeries(uid, m.key));
    const value = `${fmtLen(d.last.cm)} ${unit}`, delta = fmtLenDelta(d.dFirst);
    return `
          <button class="cell cell--nav bm-cell" data-action="coach-open-measure" data-uid="${esc(uid)}" data-key="${m.key}"
            aria-label="${m.label} : ${esc(`${value}${delta ? `, ${delta} depuis la première mesure` : ''}, ${fmtDate(d.last.date)}`)}">
            <span class="cell__body"><span class="cell__title">${m.label}</span>
              <span class="cell__sub">${esc(fmtDate(d.last.date))}${delta ? ` · ${delta} depuis le début` : ''}</span></span>
            <span class="cell__value num">${value}</span>
            ${icon('chevron.right', 16)}
          </button>`;
  }).join('');
  return view(`
        ${coachTitle(`Bilan ${elide('de', who)}`)}
        <div class="group">${rows || '<div class="cell"><span class="cell__sub">Aucune mensuration pour l\'instant.</span></div>'}</div>
        <div class="group-foot">${who} partage ses mensurations avec toi${f.since ? ` depuis le ${esc(fmtDate(f.since, 'short'))}` : ''}. Elles disparaissent si le partage s'arrête. En ${unit === 'in' ? 'pouces' : 'centimètres'}.</div>`);
}
SCREENS.set('coach-measures', {
  render: uid => renderCoachMeasures(uid),
  enter: () => { const uid = routeParams(currentRoute())[0]; if (uid) coachLoadMeasures(uid); },
});

function renderCoachMeasure(uid, key) {
  const label = bodyMeasureLabel(key), p = coachStudent(uid), f = coachMeasuresOf(uid);
  chartState = null;
  const head = navBar({ title: '' });
  if (!label || !p || !f.shared) {
    return `<div class="view view--grouped coach-measure-view">${head}<div class="scr"><div class="empty-note">${!label ? 'Mesure inconnue.' : 'Plus rien de partagé ici.'}</div></div></div>`;
  }
  const series = coachMeasureSeries(uid, key), unit = lenUnitLbl(), d = bodyMeasureDelta(series);
  if (series.length) {
    chartState = {
      vals: series.map(x => x.cm), dates: series.map(x => x.date), points: series, bw: false, mode: 'len', color: 'var(--teal)',
      xLabels: [], sel: null, name: label, fromZero: false,
      fmtVal: v => `${fmtLen(v)} ${unit}`, axisFmt: v => fmtLen(v), bubble: x => `${fmtDate(x.date, 'short')} · ${fmtLen(x.cm)} ${unit}`,
    };
  }
  const entries = series.slice().reverse().map(x => `
          <div class="cell"><span class="cell__body"><span class="cell__title">${esc(fmtDate(x.date))}</span></span><span class="cell__value num">${fmtLen(x.cm)} ${unit}</span></div>`).join('');
  return `
    <div class="view view--grouped coach-measure-view">
      ${head}
      <div class="scr">
        <h1 class="scr-title">${label}</h1>
        <p class="scr-sub">${esc(personName(p))}</p>
        ${d ? `
        <div class="chart-head">
          <span class="chart-head__val num">${fmtLen(d.last.cm)} ${unit}</span>
          ${fmtLenDelta(d.dPrev) ? `<span class="chart-head__trend num" aria-label="${fmtLenDelta(d.dPrev)} depuis la mesure d'avant">${fmtLenDelta(d.dPrev)}</span>` : ''}
        </div>
        <div class="chart" id="exChart">
          <canvas class="stats-canvas" role="img" aria-label=""></canvas>
          <div class="chart-bubble num" hidden></div>
        </div>
        <div class="group">
          <div class="cell"><span class="cell__body"><span class="cell__title">Depuis la première mesure</span>
            <span class="cell__sub">${esc(fmtDate(series[0].date))} · ${fmtLen(series[0].cm)} ${unit}</span></span>
            <span class="cell__value num">${fmtLenDelta(d.dFirst) || (series.length > 1 ? 'Pareil' : '—')}</span></div>
        </div>
        <div class="group-title">Historique</div>
        <div class="group">${entries}</div>` : '<div class="empty-note">Aucune valeur pour cette mesure.</div>'}
      </div>
    </div>`;
}
SCREENS.set('coach-measure', {
  render: (uid, key) => renderCoachMeasure(uid, key),
  mount: () => { if ($('#exChart')) drawCharts(); },
});

// ── Actions ─────────────────────────────────────────────────

registerActions({
  'coach-open-share': () => navigate('coach-share'),
  'coach-open-measures': (e, el) => navigate(makeRoute('coach-measures', el.dataset.uid)),
  'coach-open-measure': (e, el) => navigate(makeRoute('coach-measure', el.dataset.uid, el.dataset.key)),
  'coach-share-toggle': async (e, el) => {
    const kind = el.dataset.kind;
    if (coachShare.busy) return;
    const on = !coachShareOn(kind);
    // Arrêter le suivi de la diète supprime jusqu'à 90 jours chez le coach : confirmation d'abord (panel nutri-final t1)
    if (!on && kind === 'diet_log') {
      const n = coachShare.state?.shares?.diet_log?.n || 0;
      if (!(await confirmSheet('Arrêter le partage de ta diète ?', `${coachName()} ne verra plus ${n ? plural(n, 'jour partagé', 'jours partagés') : 'tes jours partagés'}. ${n === 1 ? 'Il est supprimé' : 'Ils sont supprimés'} du serveur.`, 'Arrêter'))) return;
    }
    // Pas, sommeil, cardio : données de santé (RGPD art. 9) : accord explicite, ce qui part dit avant, et la fenêtre
    // d'iOS annoncée ; arrêter supprime jusqu'à 90 jours chez le coach : confirmation aussi
    if (kind === 'health') {
      const who = coachName() || myCoachWord('ton');
      const n = coachShare.state?.shares?.health?.n || 0;
      const ok = on
        ? await confirmSheet(`Partager tes pas, ton sommeil et ton cardio avec ${who} ?`,
          `Chaque jour, ${who} verra ton nombre de pas, ta durée de sommeil et tes minutes de cardio, lus dans Santé, sur tes 90 derniers jours. Rien d'autre de Santé. Santé va te demander l'accès : active Pas, Sommeil et Entraînements. Tu peux arrêter à tout moment.`, 'Partager', false)
        : await confirmSheet('Arrêter le partage de Santé ?', `${who} ne verra plus ${n ? plural(n, 'jour partagé', 'jours partagés') : 'tes jours partagés'}. ${n === 1 ? 'Il est supprimé' : 'Ils sont supprimés'} du serveur.`, 'Arrêter');
      if (!ok) return;
    }
    haptic();
    const r = await coachShareSet(kind, on);
    if (!r.ok) { if (r.kind !== 'busy') showToast(coachErrorText(r.kind), { error: true }); return; }
    const m = kind === 'measures', dl = kind === 'diet_log', hk = kind === 'health';
    const what = m ? 'mensurations' : dl || hk ? 'journées' : 'pesées';
    if (r.uploadFailed) showToast(r.uploadFailed === 'offline' ? `Partage activé. Tes ${what} partiront avec du réseau.` : coachErrorText(m && r.uploadFailed === 'invalid_data' ? 'invalid_measures' : r.uploadFailed), { error: r.uploadFailed !== 'offline' });
    // Partage donné : Annuler d'un toucher (panel du 18/11 : une donnée sensible se reprend aussi vite qu'elle se donne)
    else if (on) showToast(`${m ? 'Mensurations partagées' : dl ? 'Diète partagée' : hk ? 'Pas, sommeil et cardio partagés' : 'Poids partagé'} avec ${myCoachWord('ton')}`,
      { action: 'Annuler', onAction: () => coachShareSet(kind, false).then(u => { if (!u.ok && u.kind !== 'busy') showToast(coachErrorText(u.kind), { error: true }); }) });
    else showToast(`Partage arrêté, ${what} supprimées du serveur`);
  },
});
