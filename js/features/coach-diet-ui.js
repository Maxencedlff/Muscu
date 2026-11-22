// ═══════════════════════════════════════════════════════════
//  Coach : carte « Diète » de la fiche d'un élève (suivi de la diète partagé). Données : js/data/diet-share.js.
//
//  - 7 jours en pastilles (suivi, partiel, pas suivi, rien de noté ; aujourd'hui : en cours), seuils d'écart de
//    calories dits sous la bande ; un toucher sur un jour montre son détail dessous (repas cochés, calories et
//    écart, macros, eau, sel). Semaines d'avant : chevrons, 12 semaines au plus (le serveur garde 90 jours).
//  - Élève qui ne partage pas : « Diète non partagée » et où l'activer, sans aucun chiffre. Serveur sans la fonction, ou
//    lecture en échec : rien (jamais un « non partagé » faux).
//  - Couleurs : vert de l'avancée (--check-on, comme la nutrition) ; jamais l'orange des actions ni le rouge des
//    muscles. Tout texte venu du serveur passe par esc(). Rien au pointerdown.
// ═══════════════════════════════════════════════════════════
'use strict';

// Ma / Me : deux « M » de suite ne disaient pas lequel est aujourd'hui (panel nutri-final t1)
const CDIET_WD = ['L', 'Ma', 'Me', 'J', 'V', 'S', 'D'];
const cdietWeekday = day => (new Date(`${day}T12:00:00`).getDay() + 6) % 7;
const cdietTs = day => new Date(`${day}T12:00:00`).getTime();
const cdietGr = v => `${fmtNum(Math.round(v))} g`;
const cdietL = ml => `${fmtNum(Math.round(ml / 10) / 100, 2)} L`;

function cdietDotHtml(st) {
  const inner = st === 'ok' ? icon('checkmark', 14) : st === 'off' ? icon('minus', 14) : '';
  return `<span class="cdiet__dot cdiet__dot--${st}" aria-hidden="true">${inner}</span>`;
}

// Écart dit en clair : « 20 % sous l'objectif », « 12 % au-dessus de l'objectif », « pile l'objectif »
function cdietGapText(gap) {
  if (gap === null) return '';
  if (gap === 0) return 'pile l\'objectif';
  return `${Math.abs(gap)} % ${gap < 0 ? 'sous' : 'au-dessus de'} l'objectif`;
}
const cdietPct = (v, goal) => (goal > 0 ? Math.round((v - goal) / goal * 100) : null);
// Dans une fourchette : « dans l'objectif », « sous l'objectif », « au-dessus de l'objectif »
// fmt : écart chiffré (« 0,5 L sous l'objectif », « 0,8 g au-dessus de l'objectif », panel du 18/11)
// ref : le mot du repère (« objectif » pour l'eau, « repère » pour le sel, comme chez l'élève)
function cdietRangeWord(v, lo, hi, fmt = null, ref = 'objectif') {
  const le = ref === 'repère' ? 'le repère' : 'l\'objectif', du = ref === 'repère' ? 'du repère' : 'de l\'objectif';
  // Sans signe : « 0,5 L sous l'objectif » (le mot dit déjà le sens, panel nutri-final t1)
  if (lo != null && v < lo) return `${fmt ? `${fmt(lo - v)} ` : ''}sous ${le}`;
  if (hi != null && v > hi) return `${fmt ? `${fmt(v - hi)} ` : ''}au-dessus ${du}`;
  return lo != null || hi != null ? `dans ${le}` : '';
}
// Pourquoi un jour est partiel ou pas suivi : ce qui manque, en mots
function cdietWhy(x, status) {
  if (!['part', 'off'].includes(status)) return '';
  const gap = dietShareGap(x), g = x.goal || {};
  if (gap !== null && Math.abs(gap) > DIET_SHARE_OK_PCT) return `calories ${cdietGapText(gap)}`;
  if (g.p > 0 && x.p < g.p * DIET_SHARE_PROT_SHARE) return `protéines ${cdietGapText(cdietPct(x.p, g.p))}`;
  const miss = x.meals.filter(m => !m.ok).length;
  return miss ? plural(miss, 'repas pas coché', 'repas pas cochés') : '';
}

function cdietDetailHtml(x, day, status) {
  const title = capitalize(fmtDate(cdietTs(day), 'day'));
  if (!x) {
    return `
          <div class="cell cdiet__detail"><span class="cell__body"><span class="cell__title">${esc(title)}</span>
            <span class="cell__sub">${status === 'today' ? 'Rien de coché aujourd\'hui.' : 'Rien de noté ce jour-là.'}</span></span></div>`;
  }
  const sub = [x.name, x.kind ? dietKindWord(x.kind) : ''].filter(Boolean).join(' · ');
  const done = x.meals.filter(m => m.ok), miss = x.meals.filter(m => !m.ok);
  const meals = x.meals.length
    ? [done.length ? done.map(m => m.n).join(', ') : '', miss.length ? `pas coché : ${miss.map(m => m.n).join(', ')}` : ''].filter(Boolean).join(' · ')
    : 'Aucun repas prévu ce jour-là';
  const gap = dietShareGap(x), g = x.goal || {}, live = status === 'today';
  // Aujourd'hui pas fini : pas d'écart en %, la journée n'est pas jugée (panel du 18/11 : « 51 % sous » à midi trompait)
  const gapTxt = (v, goal) => (live ? 'en cours' : cdietGapText(cdietPct(v, goal)));
  const kcal = `${fmtNum(x.kcal)}${g.kcal ? ` / ${fmtNum(g.kcal)}` : ''} kcal`;
  const water = x.waterGoal ? [`objectif ${x.waterMin ? `${fmtNum(x.waterMin / 1000, 2)} à ` : ''}${cdietL(x.waterGoal)}`,
    live ? '' : cdietRangeWord(x.water, x.waterMin ?? x.waterGoal, x.waterMin != null ? x.waterGoal : null, ml => cdietL(ml))].filter(Boolean).join(' · ') : '';
  const salt = x.saltMin != null || x.saltMax != null
    // Sel : « repère 3 à 5 g », « 5 g au plus », comme chez l'élève (panel nutri-final, tour ciblé)
    ? [x.saltMin != null && x.saltMax != null ? `repère ${fmtNum(x.saltMin, 1)} à ${fmtNum(x.saltMax, 1)} g` : x.saltMax != null ? `${fmtNum(x.saltMax, 1)} g au plus` : `${fmtNum(x.saltMin, 1)} g au moins`,
      live ? '' : cdietRangeWord(x.salt ?? 0, x.saltMin, x.saltMax, g2 => `${fmtNum(Math.round(g2 * 10) / 10, 1)} g`, 'repère')].filter(Boolean).join(' · ') : '';
  const row = (t, v, s) => `
          <div class="cell cdiet__detail"><span class="cell__body"><span class="cell__title">${t}</span>${s ? `<span class="cell__sub">${esc(s)}</span>` : ''}</span>${v ? `<span class="cell__value cdiet__val">${esc(v)}</span>` : ''}</div>`;
  return `
          <div class="cell cdiet__detail"><span class="cell__body"><span class="cell__title">${esc(title)}</span>${sub ? `<span class="cell__sub">${esc(sub)}</span>` : ''}${cdietWhy(x, status) ? `<span class="cell__sub cdiet__why">${esc(capitalize(DIET_SHARE_WORDS[status]))} : ${esc(cdietWhy(x, status))}</span>` : ''}</span>
            <span class="cdiet__state cdiet__state--${status}">${esc(capitalize(DIET_SHARE_WORDS[status]))}</span></div>
          ${x.plan ? row('Repas cochés', x.meals.length ? `${done.length} sur ${x.meals.length}` : '', meals) : ''}
          ${x.plan ? row('Calories', kcal, live ? 'en cours, pas encore jugé' : cdietGapText(gap)) : ''}
          ${x.plan ? [['Protéines', x.p, g.p], ['Glucides', x.c, g.c], ['Lipides', x.f, g.f]].map(([l, v, goal]) =>
    row(l, goal ? `${fmtNum(Math.round(v))} / ${cdietGr(goal)}` : cdietGr(v), goal ? gapTxt(v, goal) : '')).join('') : ''}
          ${row('Eau', cdietL(x.water), water)}
          ${x.salt != null ? row('Sel', `${fmtNum(x.salt, 1)} g`, salt) : ''}`;
}

// Groupe « Diète » de la fiche (vide tant que rien n'est lu, si la lecture échoue ou si le serveur ne le connaît pas)
function coachDietTrackHtml(uid, who) {
  const f = coachDietOf(uid);
  if (!f.loadedAt || f.error) return '';
  if (!f.shared) {
    return `
        <div class="group-title">Diète</div>
        <div class="group"><div class="cell cdiet-off"><span class="cell__body"><span class="cell__title">Diète non partagée</span>
          <span class="cell__sub">${who} choisit de la partager ou non, dans Réglages › Social et coach › Partager avec ${coachWord('mon', myOwnCoachForm())} › Suivi de ma diète.</span></span></div>${cdietWriteBtn(uid, who, 'share')}</div>`;
  }
  const now = Date.now(), today = dietDayKey(now);
  const weeks = Math.min(DIET_SHARE_WEEKS - 1, Math.max(0, f.weeks | 0));
  const days = dietShareWeekDays(weeks, now);
  const withData = days.filter(d => f.days[d]);
  const stOf = d => dietShareStatus(f.days[d] || null, { today: d === today });
  // Jour montré d'office : aujourd'hui s'il est déjà suivi, sinon hier (une journée finie, panel du 18/11)
  const sel = days.includes(f.sel) ? f.sel : weeks === 0 ? (stOf(today) === 'ok' ? today : days[5]) : withData[withData.length - 1] || days[6];
  const counts = { ok: 0, part: 0, off: 0 };
  days.forEach(d => { const s = stOf(d); if (counts[s] !== undefined) counts[s]++; });
  const dots = days.map(d => {
    const st = stOf(d), x = f.days[d];
    const said = `${capitalize(fmtDate(cdietTs(d), 'day'))} : ${DIET_SHARE_WORDS[st]}${x?.goal?.kcal ? `, ${fmtNum(x.kcal)} sur ${fmtNum(x.goal.kcal)} kilocalories` : ''}`;
    return `<button class="cdiet__day${d === sel ? ' cdiet__day--sel' : ''}${d === today ? ' cdiet__day--today' : ''}" data-action="coach-diet-day" data-uid="${esc(uid)}" data-day="${d}" aria-pressed="${d === sel}" aria-label="${esc(said)}">
              <span class="cdiet__wd" aria-hidden="true">${CDIET_WD[cdietWeekday(d)]}</span>${cdietDotHtml(st)}</button>`;
  }).join('');
  const range = weeks === 0 ? '7 derniers jours' : `Du ${fmtDate(cdietTs(days[0]), 'short')} au ${fmtDate(cdietTs(days[6]), 'short')}`;
  const nav = (dir, label, off) => `<button class="cdiet__nav" data-action="coach-diet-week" data-uid="${esc(uid)}" data-dir="${dir}" aria-label="${label}"${off ? ' disabled' : ''}>${icon(dir > 0 ? 'chevron.left' : 'chevron.right', 18)}</button>`;
  const since = f.since ? ` depuis le ${esc(fmtDate(f.since, 'short'))}` : '';
  const warn = weeks === 0 && coachDietWarn(uid, now);
  const writeBtn = cdietWriteBtn(uid, who, 'warn');
  // Moyenne des jours notés et finis de la semaine (aujourd'hui en cours exclu) : la tendance d'un coup d'œil
  const past = days.filter(d => f.days[d] && !(d === today && stOf(d) === 'today')).map(d => f.days[d]);
  const mean = k => past.reduce((a, x) => a + (Number(x[k]) || 0), 0) / past.length;
  // Avec l'objectif moyen et l'écart (panel du 18/11, tour 3 : « je dois faire le calcul de tête »)
  const gmean = k => { const l = past.filter(x => x.goal?.[k] > 0); return l.length === past.length ? l.reduce((a, x) => a + x.goal[k], 0) / l.length : 0; };
  const vs = (v, g, unit) => `${fmtNum(Math.round(v))}${g ? ` / ${fmtNum(Math.round(g))}` : ''} ${unit}${g && cdietPct(v, g) ? ` (${cdietPct(v, g) > 0 ? '+' : '−'}${Math.abs(cdietPct(v, g))} %)` : ''}`;
  // Moyenne en lignes libellé / valeur, comme le détail d'un jour (panel nutri-final t1 : le paragraphe centré se lisait mal)
  const arow = (t, v, sub) => `
          <div class="cell cdiet__detail"><span class="cell__body"><span class="cell__title">${t}</span>${sub ? `<span class="cell__sub">${esc(sub)}</span>` : ''}</span><span class="cell__value cdiet__val num">${esc(v)}</span></div>`;
  const vsRow = (t, k, unit) => { const v = mean(k), g = gmean(k), pc = g ? cdietPct(v, g) : null;
    return arow(t, `${fmtNum(Math.round(v))}${g ? ` / ${fmtNum(Math.round(g))}` : ''} ${unit}`, pc === null ? '' : cdietGapText(pc)); };
  const avg = past.length >= 2 ? `
          <div class="group cdiet__avg">
          <div class="cell cdiet__detail"><span class="cell__body"><span class="cell__title">Moyenne</span><span class="cell__sub">${plural(past.length, 'jour noté', 'jours notés')}, chacun comparé à son objectif</span></span></div>
          ${vsRow('Calories', 'kcal', 'kcal')}${vsRow('Protéines', 'p', 'g')}${arow('Eau', cdietL(mean('water')), '')}${past.some(x => x.salt != null) ? arow('Sel', `${fmtNum(Math.round(mean('salt') * 10) / 10, 1)} g`, '') : ''}
          </div>` : '';
  return `
        <div class="group-title">Diète</div>
        <div class="cdiet">
          <div class="cdiet__head">
            ${nav(1, 'Semaine d\'avant', weeks >= DIET_SHARE_WEEKS - 1)}
            <span class="cdiet__range"><span class="cdiet__range-t">${esc(range)}</span><span class="cdiet__count num">${plural(counts.ok, 'jour suivi', 'jours suivis')}${counts.part ? ` · ${counts.part} partiel${counts.part > 1 ? 's' : ''}` : ''}</span></span>
            ${nav(-1, 'Semaine d\'après', weeks === 0)}
          </div>
          <div class="cdiet__days" role="group" aria-label="${esc(range)}">${dots}</div>
          <p class="cdiet__legend"><span class="cdiet__key">${cdietDotHtml('ok')}Suivi</span> <span class="cdiet__key">${cdietDotHtml('part')}Partiel</span> <span class="cdiet__key">${cdietDotHtml('off')}Pas suivi</span> <span class="cdiet__key">${cdietDotHtml('none')}Rien noté</span> <span class="cdiet__key">${cdietDotHtml('today')}En cours</span></p>
          <details class="cdiet__rule"><summary>Comment c'est compté</summary><p>Suivi : calories à ${DIET_SHARE_OK_PCT} % près de l'objectif du jour et protéines à ${Math.round(DIET_SHARE_PROT_SHARE * 100)} % au moins. Partiel : calories à ${DIET_SHARE_PART_PCT} % près. Au-delà : pas suivi. Sans objectif de calories : les repas cochés.</p></details>
          ${avg}
          ${warn ? `<div class="group cdiet__warn"><div class="cell"><span class="cell__body"><span class="cell__title">${who} n'a pas suivi sa diète ces 3 derniers jours</span></span></div>${writeBtn}</div>` : ''}
          <div class="group cdiet__group">${cdietDetailHtml(f.days[sel] || null, sel, stOf(sel))}
          </div>
        </div>
        <div class="group-foot">${who} partage le suivi de sa diète avec toi${since} et peut arrêter à tout moment : tout disparaît alors. Gardé 90 jours. Ni le détail des aliments, ni les heures.</div>`;
}

// « Écrire à lea » : la conversation avec l'élève (Messages), un message déjà écrit dans le champ, jamais envoyé seul
// (panel du 18/11 : le coach débutant ne savait pas quoi écrire). Brouillon déjà commencé : gardé tel quel
const CDIET_MSG = {
  warn: who => `Salut ${who}, ça se passe comment avec la diète ces derniers jours ?`,
  share: () => `Salut, si tu veux que je suive ta diète, active « Suivi de ma diète » dans Réglages › Social et coach › Partager avec ${coachWord('mon', myOwnCoachForm())}. Tu peux l'arrêter quand tu veux.`,
};
function cdietWriteBtn(uid, who, kind) {
  if (typeof chatAvailable !== 'function' || !chatAvailable()) return '';
  return `<button class="cell cell--action cdiet__write" data-action="coach-diet-write" data-uid="${esc(uid)}" data-kind="${kind}">${icon('text.bubble', 20)}<span class="cell__body"><span>Écrire à ${who}</span><span class="cell__sub">Message déjà écrit, à relire avant d'envoyer</span></span></button>`;
}

registerActions({
  'coach-diet-write': (e, el) => {
    const uid = el.dataset.uid, p = coachStudent(uid), mk = CDIET_MSG[el.dataset.kind];
    if (mk && !chatDrafts[uid]) chatDrafts[uid] = mk(p ? personName(p) : '');
    navigate(makeRoute('coach-chat', uid));
  },
  'coach-diet-day': (e, el) => { const f = coachDietOf(el.dataset.uid); f.sel = el.dataset.day; haptic('light'); render(); },
  'coach-diet-week': (e, el) => {
    const f = coachDietOf(el.dataset.uid);
    f.weeks = Math.min(DIET_SHARE_WEEKS - 1, Math.max(0, (f.weeks | 0) + Number(el.dataset.dir)));
    f.sel = null;
    render();
  },
});
