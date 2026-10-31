// ═══════════════════════════════════════════════════════════
//  Entraînement intelligent, écrans : carte de l'accueil (semaine plus légère conseillée, en cours, reprise),
//  niveau de force (Bibliothèque › Exercice, Progrès › Exercice, bilan), stagnation (Progrès › Exercice)
//  et actions. Logique : js/data/training-insights.js ; sources et règles : docs/ENTRAINEMENT.md
// ═══════════════════════════════════════════════════════════
'use strict';

// « Développé couché barre et Squat barre », « A, B et 2 autres »
function tiNames(names) {
  if (names.length <= 2) return names.join(' et ');
  return `${names.slice(0, 2).join(', ')} et ${names.length - 2} autre${names.length - 2 > 1 ? 's' : ''}`;
}
// « Environ 5 séries par séance au lieu de 9 » (rien sans séance récente)
function tiSetsLine(a) {
  return a.usualSets ? `Environ ${plural(a.targetSets, 'série', 'séries')} par séance au lieu de ${a.usualSets}` : '';
}

// Pourquoi la semaine plus légère est conseillée : uniquement ce que montrent les séances de la personne
function deloadReasons(a) {
  const out = [`${a.streak} semaines chargées d'affilée`];
  if (a.stalled.length) out.push(`Plus de progrès sur ${tiNames(a.stalled)}`);
  if (a.effort) out.push(`Effort noté en hausse : RPE ${fmtNum(a.effort.prior, 1)} → ${fmtNum(a.effort.recent, 1)}`);
  return out;
}

// ── Accueil ──
function trainingHomeCard() {
  const a = trainingAdvice(data, Date.now());
  if (!a) return '';
  if (a.kind === 'deload') {
    const reasons = deloadReasons(a);
    const plan = [tiSetsLine(a), 'mêmes charges, arrête-toi plus loin de l\'échec'].filter(Boolean).join(', ');
    return `
    <section class="home-card ti-card" aria-labelledby="tiCardTitle">
      <h2 class="home-card__title">Conseil d'entraînement</h2>
      <p class="ti-card__head" id="tiCardTitle">Semaine plus légère conseillée</p>
      <ul class="ti-card__reasons">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="ti-card__plan">${esc(plan.charAt(0).toUpperCase() + plan.slice(1))}. Pendant 7 jours.</p>
      <button class="ti-card__why" data-action="training-why">Pourquoi ce conseil ?</button>
      <div class="ti-card__btns">
        <button class="ti-card__btn ti-card__btn--primary" data-action="deload-start">Commencer</button>
        <button class="ti-card__btn" data-action="deload-later">Pas maintenant</button>
      </div>
    </section>`;
  }
  if (a.kind === 'deload-active') {
    const line = tiSetsLine(a);
    return `
    <section class="home-card ti-card" aria-labelledby="tiCardTitle">
      <h2 class="home-card__title">Semaine plus légère</h2>
      <p class="ti-card__head" id="tiCardTitle">${esc(line || 'Moins de séries cette semaine')}</p>
      <p class="ti-card__plan">Mêmes charges, arrête-toi plus loin de l'échec. Jusqu'au ${esc(fmtDate(a.end - 1, 'day'))}.</p>
      <div class="ti-card__btns"><button class="ti-card__btn" data-action="deload-stop">Terminer la décharge</button></div>
    </section>`;
  }
  // Reprise : les charges d'avant la décharge, exercice par exercice
  const rows = a.sets.map(s => `<li class="targets__row"><span class="targets__name">${esc(s.name)}</span>`
    + `<span class="targets__val num">${esc(setTxt({ w: s.weight, r: s.reps, weight: String(s.weight), reps: String(s.reps) }))}</span></li>`).join('');
  return `
    <section class="home-card ti-card" aria-labelledby="tiCardTitle">
      <h2 class="home-card__title">Reprise
        <button class="ti-card__close" data-action="deload-resume-hide" aria-label="Masquer la carte">${icon('xmark', 16)}</button></h2>
      <p class="ti-card__head" id="tiCardTitle">Reprends tes charges d'avant</p>
      <ul class="targets__list">${rows}</ul>
    </section>`;
}

// ── Niveau de force : Bibliothèque › Exercice et Progrès › Exercice ──
// Cinq segments, un par niveau : pleins jusqu'au niveau atteint, celui-ci rempli selon l'avance vers le suivant
function strengthScaleHtml(st) {
  const segs = STRENGTH_LEVELS.map((l, i) => {
    const fill = i < st.index ? 1 : i === st.index ? (st.next ? st.progress : 1) : 0;
    return `<span class="ti-scale__seg"><span class="ti-scale__fill" style="width:${Math.round(fill * 100)}%"></span></span>`;
  }).join('');
  const label = st.next ? `${st.label}, ${Math.round(st.progress * 100)} % du chemin vers ${st.next.label}` : st.label;
  return `<div class="ti-scale" role="img" aria-label="${esc(label)}">${segs}</div>
    <div class="ti-scale__ends" aria-hidden="true"><span>${STRENGTH_LEVELS[0]}</span><span>${STRENGTH_LEVELS[STRENGTH_LEVELS.length - 1]}</span></div>`;
}

function strengthGroupHtml(name) {
  const lift = strengthLiftOf(name);
  if (!lift) return '';
  const title = '<div class="group-title">Niveau de force</div>';
  const kg = currentBodyKg();
  if (!kg) {
    return `${title}<div class="group"><button class="cell cell--nav" data-action="set-body-weight">
      <span class="cell__body"><span class="cell__title">Ajoute ton poids du corps</span>
        <span class="cell__sub">Pour situer ton 1RM estimé</span></span>${icon('chevron.right', 16)}</button></div>`;
  }
  const sex = strengthSex();
  const best = liftBestE1rm(data.history, lift);
  const st = best && strengthStanding(lift, best.e1rm, kg, sex);
  if (!st) {
    return `${title}<div class="group"><div class="cell"><span class="cell__body"><span class="cell__title">Pas encore de 1RM estimé</span>
      <span class="cell__sub">Une série de 1 à 12 reps ces 90 derniers jours suffit</span></span></div></div>`;
  }
  const next = st.next ? `${st.next.label} à ${fmtW(st.next.kg)} ${unitLbl()}` : 'Plus haut repère atteint';
  return `${title}
    <div class="group">
      <div class="cell"><span class="cell__body"><span class="cell__title ti-level">${esc(st.label)}</span>
        <span class="cell__sub num">1RM est. ~${fmtW(best.e1rm)} ${unitLbl()} · ${fmtNum(st.ratio, 2)} × ton poids</span></span>
        <button class="info-btn" data-action="strength-info" aria-label="D'où viennent ces repères ?">i</button></div>
      <div class="cell ti-scale-cell"><div class="ti-scale-box">${strengthScaleHtml(st)}<div class="ti-scale__next num">${esc(next)}</div></div></div>
    </div>
    <div class="group-foot">Repères ${sex === 'female' ? 'femmes' : 'hommes'} pour ${fmtW(kg)} ${unitLbl()}${data.silhouette ? '' : ' (silhouette Homme par défaut, Réglages › Apparence)'}. Source : Strength Level.</div>`;
}

// ── Progrès › Exercice : progrès qui stagnent ──
function stallGroupHtml(key) {
  if (data.trainingTipsOff === true) return '';
  const t = exerciseStall(data.history, key);
  if (!t) return '';
  const head = t.status === 'down'
    ? '1RM est. en baisse sur les 2 dernières séances'
    : `Pas de nouveau 1RM est. depuis ${plural(t.sinceBest, 'séance', 'séances')}`;
  return `
    <div class="group-title">Conseil d'entraînement</div>
    <div class="group"><div class="cell"><span class="cell__body"><span class="cell__title">${esc(head)}</span>
      <span class="cell__sub num">Meilleur : ~${fmtW(t.best)} ${unitLbl()} (${esc(fmtDate(t.bestDate, 'short'))}). Une semaine plus légère ou une autre fourchette de reps peut relancer les progrès.</span></span></div></div>`;
}

// ── Bilan : niveau des exercices principaux de la séance ──
function summaryStrengthHtml(h) {
  const kg = currentBodyKg();
  const rows = kg ? sessionStrengthLevels(h, data.history, kg, strengthSex()) : [];
  if (!rows.length) return '';
  return `
        <div class="sum-section-title">Niveau de force</div>
        <div class="sum-list">
          ${rows.map(r => `
            <div class="sum-row">
              <div class="sum-row__main"><div class="sum-row__name">${esc(r.name)}</div>${r.up ? '<div class="sum-row__sub ti-up">Nouveau palier</div>' : ''}</div>
              <div class="sum-row__val">${esc(r.standing.label)}</div>
            </div>`).join('')}
        </div>`;
}

registerActions({
  'deload-start': () => {
    const now = Date.now();
    data.deload = { start: now, end: now + DELOAD_DAYS * TI_DAY };
    delete data.deloadSnooze;
    haptic(); save(); render();
    showToast(`Semaine plus légère jusqu'au ${fmtDate(data.deload.end - 1, 'short')}`);
  },
  'deload-later': () => {
    data.deloadSnooze = Date.now() + SNOOZE_DAYS * TI_DAY;
    save(); render();
    showToast('On en reparle dans une semaine');
  },
  'deload-stop': () => {
    const dl = cleanDeload(data.deload);
    if (!dl) return;
    const now = Date.now();
    data.deload = { ...dl, start: Math.min(dl.start, now - 1), end: now };   // fin = maintenant : la reprise s'affiche
    save(); render();
  },
  'deload-resume-hide': () => {
    const dl = cleanDeload(data.deload);
    if (!dl) return;
    data.deload = { ...dl, seen: true };
    save(); render();
  },
  'training-why': async () => {
    await dialog({ title: 'Semaine plus légère',
      message: 'Conseillée quand tes séances montrent au moins 4 semaines chargées d\'affilée et des progrès qui stagnent, ou un effort noté qui monte. '
        + 'Les coachs de force la placent en général toutes les 4 à 6 semaines, pendant environ 7 jours (consensus de Bell et al., 2023). '
        + 'Tu peux couper ces conseils dans Réglages › Entraînement.',
      actions: [{ label: 'OK', value: true, style: 'preferred' }] });
  },
  'strength-info': async () => {
    await dialog({ title: 'Niveau de force',
      message: 'Ton 1RM estimé (meilleure série de ces 90 jours) divisé par ton poids du corps, comparé aux repères de Strength Level, '
        + 'tirés de millions de performances : Débutant, Novice, Intermédiaire, Avancé et Élite font mieux que 5, 20, 50, 80 et 95 % des pratiquants. '
        + 'C\'est un repère, pas un examen.',
      actions: [{ label: 'OK', value: true, style: 'preferred' }] });
  },
  'setting-training-tips': () => {
    if (data.trainingTipsOff === true) delete data.trainingTipsOff; else data.trainingTipsOff = true;
    save(); render();
  },
});
