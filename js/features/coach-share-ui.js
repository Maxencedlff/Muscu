// ═══════════════════════════════════════════════════════════
//  Partage avec le coach, écrans. Données et appels : js/data/coach-share.js.
//
//  - Élève : Réglages › Amis et coach › « Partager avec mon coach » (seulement s'il a un coach) →
//    écran `coach-share` : une case par donnée ouverte (aujourd'hui : Poids du corps), toutes
//    décochées par défaut, et ce que le coach verra, dit en clair.
//  - Coach : sur la fiche d'un élève qui partage son poids, la courbe de ses pesées (composant de
//    Progrès, js/features/progress-chart.js) ; le volume des séances compte alors son poids du corps
//    (js/data/session-review.js, pied de page dans renderCoachSession).
//  Tout texte venu du serveur passe par esc(). Rien au pointerdown : actions au clic seulement.
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_WEIGHT_CHART_MAX = 90;   // pesées sur la courbe du coach (les plus récentes)

// ── Élève : Réglages › Partager avec mon coach ──────────────

// Cellule de Réglages › Amis et coach (élève suivi seulement)
function coachShareSettingsCell() {
  if (!account.user || !coachRole().hasCoach) return '';
  const value = coachShareSummary();
  return `
          <button class="cell cell--nav" data-action="coach-open-share">
            <span class="cell__body"><span class="cell__title">Partager avec mon coach</span></span>
            ${value !== null ? `<span class="cell__value">${esc(value)}</span>` : ''}
            ${icon('chevron.right', 16)}
          </button>`;
}

// « 12 pesées partagées depuis le 30 oct. »
function coachShareStatusText(st) {
  if (!st) return '';
  const since = st.grantedAt ? ` depuis le ${fmtDate(st.grantedAt, 'short')}` : '';
  return st.n ? `${plural(st.n, 'pesée partagée', 'pesées partagées')}${since}` : `Partagé${since}, aucune pesée pour l'instant`;
}

function renderCoachShare() {
  const head = navBar({ title: 'Partager', large: false });
  const view = body => `<div class="view view--grouped coach-share-view">${head}<div class="scr">${body}</div></div>`;
  if (!account.user || !coachRole().hasCoach) {
    return view('<div class="empty-note">Rejoins d\'abord un coach dans Réglages › Coach.</div>');
  }
  const st = coachShare.state, name = esc(coachName() || 'ton coach');
  if (!st) {
    return view(coachShare.error ? coachOfflineNote(coachShare.error, 'Pas d\'Internet. Le partage demande du réseau.') : '<div class="empty-note">Chargement…</div>');
  }
  const cells = coachShareKindsShown().map(k => {
    const on = coachShareOn(k.kind), busy = coachShare.busy === k.kind;
    const sub = k.kind === 'weight' ? (on ? coachShareStatusText(st.shares.weight) : 'Tes pesées saisies dans l\'app') : '';
    return `
          <button class="cell" data-action="coach-share-toggle" data-kind="${k.kind}" role="switch" aria-checked="${on}"${busy ? ' aria-busy="true" disabled' : ''}>
            <span class="cell__body"><span class="cell__title">${esc(k.label)}</span>${sub ? `<span class="cell__sub">${esc(sub)}</span>` : ''}</span>
            ${switchHtml(on)}
          </button>`;
  }).join('');
  // Santé activée : ses pesées ne partent jamais ; sans pesée saisie, le coach n'aurait rien
  const fromHealth = typeof healthEnabled === 'function' && healthEnabled();
  const empty = coachShareOn('weight') && !sharedWeightsPayload().length;
  const hint = fromHealth || empty ? `<div class="group-foot">${[
    fromHealth ? 'Les pesées lues dans Santé ne sont jamais partagées.' : '',
    empty ? 'Aucune pesée saisie dans l\'app pour l\'instant : ajoute ton poids dans Réglages › Entraînement › Poids du corps.' : '',
  ].filter(Boolean).join(' ')}</div>` : '';
  return view(`
        ${coachTitle(`Avec ${name}`)}
        <div class="group">${cells}
        </div>
        <div class="group-foot">${name} verra la date et le poids de chaque pesée que tu saisis dans l'app, et le volume de tes séances comptera ton poids du corps. Rien d'autre : ni mensurations, ni photos, ni données de Santé. Tes amis ne voient rien de tout ça.</div>
        <div class="group-foot">Tout est décoché tant que tu ne le coches pas. Tu peux arrêter à tout moment : tes pesées sont alors effacées du serveur et ${name} ne les voit plus, même celles qu'il avait déjà vues. Quitter ton coach arrête aussi le partage.</div>
        ${hint}`);
}
SCREENS.set('coach-share', { render: () => renderCoachShare(), enter: () => { if (coach.state) coachShareRefresh(); else coachRefresh(); } });

// ── Coach : pesées d'un élève sur sa fiche ──────────────────

// Groupe « Poids du corps » de la fiche (vide si l'élève ne partage pas). Pose la courbe (chartState) ;
// dessinée par drawCharts au montage de l'écran.
function coachWeightGroupHtml(uid, who) {
  const f = coachWeightsOf(uid);
  if (!f.shared) return '';
  const unit = unitLbl();
  const since = f.since ? ` depuis le ${esc(fmtDate(f.since, 'short'))}` : '';
  const foot = `<div class="group-foot">${who} partage son poids avec toi et peut arrêter à tout moment : tout disparaît alors.${since ? ` Partagé${since}.`.replace('..', '.') : ''}</div>`;
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

// ── Actions ─────────────────────────────────────────────────

registerActions({
  'coach-open-share': () => navigate('coach-share'),
  'coach-share-toggle': async (e, el) => {
    const kind = el.dataset.kind;
    if (coachShare.busy) return;
    const on = !coachShareOn(kind);
    haptic();
    const r = await coachShareSet(kind, on);
    if (!r.ok) { if (r.kind !== 'busy') showToast(coachErrorText(r.kind), { error: true }); return; }
    if (r.uploadFailed) showToast(r.uploadFailed === 'offline' ? 'Partage activé. Tes pesées partiront avec du réseau.' : coachErrorText(r.uploadFailed), { error: r.uploadFailed !== 'offline' });
    else showToast(on ? 'Poids partagé avec ton coach' : 'Partage arrêté, pesées effacées du serveur');
  },
});
