// ═══════════════════════════════════════════════════════════
//  Coach : carte « Diète » de la fiche d'un élève (suivi de la diète partagé). Données : js/data/diet-share.js.
//
//  - 7 jours en pastilles (suivi, partiel, pas suivi, rien de noté ; aujourd'hui : en cours), seuils d'écart de
//    calories dits sous la bande ; un toucher sur un jour montre son détail dessous (repas cochés, calories et
//    écart, macros, eau, sel). Semaines d'avant : chevrons, 12 semaines au plus (le serveur garde 90 jours).
//  - Élève qui ne partage pas : « Non partagé par l'élève », sans aucun chiffre. Serveur sans la fonction, ou
//    lecture en échec : rien (jamais un « non partagé » faux).
//  - Couleurs : vert de l'avancée (--check-on, comme la nutrition) ; jamais l'orange des actions ni le rouge des
//    muscles. Tout texte venu du serveur passe par esc(). Rien au pointerdown.
// ═══════════════════════════════════════════════════════════
'use strict';

const CDIET_WD = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const cdietWeekday = day => (new Date(`${day}T12:00:00`).getDay() + 6) % 7;
const cdietTs = day => new Date(`${day}T12:00:00`).getTime();
const cdietGr = v => `${fmtNum(Math.round(v))} g`;
const cdietL = ml => `${fmtNum(Math.round(ml / 10) / 100, 2)} L`;

function cdietDotHtml(st) {
  const inner = st === 'ok' ? icon('checkmark', 14) : st === 'off' ? icon('minus', 14) : '';
  return `<span class="cdiet__dot cdiet__dot--${st}" aria-hidden="true">${inner}</span>`;
}

// Écart dit en clair : « 20 % sous l'objectif », « 12 % au-dessus », « dans l'objectif »
function cdietGapText(gap) {
  if (gap === null) return '';
  if (gap === 0) return 'pile l\'objectif';
  return `${Math.abs(gap)} % ${gap < 0 ? 'sous' : 'au-dessus de'} l'objectif`;
}

function cdietDetailHtml(x, day, status) {
  const title = capitalize(fmtDate(cdietTs(day), 'day'));
  if (!x) {
    return `
          <div class="cell cdiet__detail"><span class="cell__body"><span class="cell__title">${esc(title)}</span>
            <span class="cell__sub">${status === 'today' ? 'Rien de coché pour l\'instant aujourd\'hui.' : 'Rien de noté ce jour-là.'}</span></span></div>`;
  }
  const sub = [x.name, x.kind ? dietKindWord(x.kind) : ''].filter(Boolean).join(' · ');
  const done = x.meals.filter(m => m.ok), miss = x.meals.filter(m => !m.ok);
  const meals = x.meals.length
    ? [done.length ? done.map(m => m.n).join(', ') : '', miss.length ? `pas coché : ${miss.map(m => m.n).join(', ')}` : ''].filter(Boolean).join(' · ')
    : 'Aucun repas prévu ce jour-là';
  const gap = dietShareGap(x), g = x.goal || {};
  const kcal = `${fmtNum(x.kcal)}${g.kcal ? ` / ${fmtNum(g.kcal)}` : ''} kcal`;
  const macro = (l, v, goal) => `${l} ${goal ? `${fmtNum(Math.round(v))}/${cdietGr(goal)}` : cdietGr(v)}`;
  const water = x.waterGoal ? `objectif ${x.waterMin ? `${fmtNum(x.waterMin / 1000, 2)} à ` : ''}${cdietL(x.waterGoal)}` : '';
  const salt = x.saltMin != null || x.saltMax != null
    ? `objectif ${x.saltMin != null && x.saltMax != null ? `${fmtNum(x.saltMin, 1)} à ${fmtNum(x.saltMax, 1)}` : x.saltMax != null ? `au plus ${fmtNum(x.saltMax, 1)}` : `au moins ${fmtNum(x.saltMin, 1)}`} g` : '';
  const row = (t, v, s) => `
          <div class="cell cdiet__detail"><span class="cell__body"><span class="cell__title">${t}</span>${s ? `<span class="cell__sub">${esc(s)}</span>` : ''}</span>${v ? `<span class="cell__value cdiet__val">${esc(v)}</span>` : ''}</div>`;
  return `
          <div class="cell cdiet__detail"><span class="cell__body"><span class="cell__title">${esc(title)}</span>${sub ? `<span class="cell__sub">${esc(sub)}</span>` : ''}</span>
            <span class="cdiet__state cdiet__state--${status}">${esc(capitalize(DIET_SHARE_WORDS[status]))}</span></div>
          ${x.plan ? row('Repas cochés', x.meals.length ? `${done.length} sur ${x.meals.length}` : '', meals) : ''}
          ${x.plan ? row('Calories', kcal, cdietGapText(gap)) : ''}
          ${x.plan ? row('Macros', '', [macro('Prot.', x.p, g.p), macro('Gluc.', x.c, g.c), macro('Lip.', x.f, g.f)].join(' · ')) : ''}
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
        <div class="group"><div class="cell cdiet-off"><span class="cell__body"><span class="cell__title">Non partagé par l'élève</span>
          <span class="cell__sub">${who} peut partager le suivi de sa diète (repas cochés, eau, sel) dans Réglages › Social et coach › Partager avec mon coach.</span></span></div></div>`;
  }
  const now = Date.now(), today = dietDayKey(now);
  const weeks = Math.min(DIET_SHARE_WEEKS - 1, Math.max(0, f.weeks | 0));
  const days = dietShareWeekDays(weeks, now);
  const withData = days.filter(d => f.days[d]);
  const sel = days.includes(f.sel) ? f.sel : (weeks === 0 ? today : withData[withData.length - 1] || days[6]);
  const stOf = d => dietShareStatus(f.days[d] || null, { today: d === today });
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
  return `
        <div class="group-title">Diète</div>
        <div class="cdiet">
          <div class="cdiet__head">
            ${nav(1, 'Semaine d\'avant', weeks >= DIET_SHARE_WEEKS - 1)}
            <span class="cdiet__range"><span class="cdiet__range-t">${esc(range)}</span><span class="cdiet__count num">${plural(counts.ok, 'jour suivi', 'jours suivis')}${counts.part ? ` · ${counts.part} partiel${counts.part > 1 ? 's' : ''}` : ''}</span></span>
            ${nav(-1, 'Semaine d\'après', weeks === 0)}
          </div>
          <div class="cdiet__days" role="group" aria-label="${esc(range)}">${dots}</div>
          <p class="cdiet__legend"><span class="cdiet__key">${cdietDotHtml('ok')}suivi, à ${DIET_SHARE_OK_PCT} % de l'objectif</span> <span class="cdiet__key">${cdietDotHtml('part')}partiel, à ${DIET_SHARE_PART_PCT} %</span> <span class="cdiet__key">${cdietDotHtml('off')}pas suivi</span></p>
          <div class="group cdiet__group">${cdietDetailHtml(f.days[sel] || null, sel, stOf(sel))}
          </div>
        </div>
        <div class="group-foot">${who} partage le suivi de sa diète avec toi${since} et peut arrêter à tout moment : tout disparaît alors. Gardé 90 jours. Ni le détail des aliments, ni les heures.</div>`;
}

registerActions({
  'coach-diet-day': (e, el) => { const f = coachDietOf(el.dataset.uid); f.sel = el.dataset.day; haptic('light'); render(); },
  'coach-diet-week': (e, el) => {
    const f = coachDietOf(el.dataset.uid);
    f.weeks = Math.min(DIET_SHARE_WEEKS - 1, Math.max(0, (f.weeks | 0) + Number(el.dataset.dir)));
    f.sel = null;
    render();
  },
});
