// ═══════════════════════════════════════════════════════════
//  Niveau de force, écrans : Bibliothèque › Exercice, Progrès › Exercice, bilan, et choix des repères
//  (Réglages › Entraînement). Logique : js/data/strength-levels.js ; méthode et source : docs/ENTRAINEMENT.md
// ═══════════════════════════════════════════════════════════
'use strict';

const STRENGTH_SEX_LABELS = { male: 'Homme', female: 'Femme', none: 'Non précisé' };

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

// Bibliothèque › Exercice et Progrès › Exercice. Sans repères choisis : le 1RM estimé et le rapport au poids
// du corps, sans palier (les repères hommes et femmes diffèrent trop pour en choisir un à la place de la
// personne) ; tant qu'elle n'a rien répondu, une ligne propose de choisir.
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
  const best = liftBestE1rm(data.history, lift);
  if (!best) {
    return `${title}<div class="group"><div class="cell"><span class="cell__body"><span class="cell__title">Pas encore de 1RM estimé</span>
      <span class="cell__sub">Une série de 1 à 12 reps ces 90 derniers jours suffit</span></span></div></div>`;
  }
  const sex = strengthSex();
  const st = sex && strengthStanding(lift, best.e1rm, kg, sex);
  const ratio = Math.round(best.e1rm / kg * 100) / 100;
  const info = '<button class="info-btn" data-action="strength-info" aria-label="D\'où viennent ces repères ?">i</button>';
  if (!st) {
    const ask = data.strengthSex === undefined
      ? `<button class="cell cell--nav" data-action="set-strength-sex"><span class="cell__body"><span class="cell__title">Indiquer mon sexe</span>
          <span class="cell__sub">Les repères hommes et femmes diffèrent</span></span>${icon('chevron.right', 16)}</button>` : '';
    return `${title}
    <div class="group">
      <div class="cell"><span class="cell__body"><span class="cell__title num">1RM est. ~${fmtW(best.e1rm)} ${unitLbl()}</span>
        <span class="cell__sub num">${fmtNum(ratio, 2)} × ton poids</span></span>${info}</div>
      ${ask}
    </div>
    ${ask ? '' : '<div class="group-foot">Pas de palier sans sexe indiqué : Réglages › Entraînement › Sexe.</div>'}`;
  }
  const next = st.next ? `${st.next.label} à ${fmtW(st.next.kg)} ${unitLbl()}` : 'Plus haut repère atteint';
  return `${title}
    <div class="group">
      <div class="cell"><span class="cell__body"><span class="cell__title ti-level">${esc(st.label)}</span>
        <span class="cell__sub num">1RM est. ~${fmtW(best.e1rm)} ${unitLbl()} · ${fmtNum(st.ratio, 2)} × ton poids</span></span>${info}</div>
      <div class="cell ti-scale-cell"><div class="ti-scale-box">${strengthScaleHtml(st)}<div class="ti-scale__next num">${esc(next)}</div></div></div>
    </div>
    <div class="group-foot">Repères ${sex === 'female' ? 'femmes' : 'hommes'} pour ${fmtW(kg)} ${unitLbl()}. Source : OpenPowerlifting.</div>`;
}

// ── Bilan : niveau des exercices principaux de la séance (rien sans repères choisis) ──
function summaryStrengthHtml(h) {
  const kg = currentBodyKg(), sex = strengthSex();
  const rows = kg && sex ? sessionStrengthLevels(h, data.history, kg, sex) : [];
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

// ── Réglages › Entraînement › Sexe (repères de force) ──
function strengthSexSettingHtml() {
  const v = data.strengthSex;
  return `<button class="cell cell--nav" data-action="set-strength-sex">
            <span class="cell__body"><span class="cell__title">Sexe</span>
              <span class="cell__sub">Repères du niveau de force, facultatif</span></span>
            <span class="cell__value"${v ? '' : ' aria-label="Non renseigné"'}>${v ? STRENGTH_SEX_LABELS[v] : '—'}</span>
            ${icon('chevron.right', 16)}
          </button>`;
}

registerActions({
  'set-strength-sex': async () => {
    const v = await dialog({ type: 'sheet', title: 'Sexe',
      message: 'Sert seulement à choisir les repères du niveau de force, hommes ou femmes. Reste sur cet appareil.',
      actions: [
        { label: 'Homme', value: 'male' },
        { label: 'Femme', value: 'female' },
        { label: 'Ne pas préciser', value: 'none' },
        { label: 'Annuler', value: null, style: 'cancel' },
      ] });
    if (!STRENGTH_SEXES.includes(v)) return;
    data.strengthSex = v;
    save(); render();
  },
  'strength-info': async () => {
    await dialog({ title: 'Niveau de force',
      message: 'Ton 1RM estimé (meilleure série de ces 90 jours) divisé par ton poids du corps, comparé à des centaines de milliers '
        + 'de compétiteurs de force athlétique, sans équipement et contrôlés antidopage, à leur première compétition, de ton sexe et '
        + 'de ta catégorie de poids (données publiques d\'OpenPowerlifting). Intermédiaire : le niveau d\'un pratiquant régulier depuis '
        + 'quelques années ; Avancé : le compétiteur médian ; Élite : les 10 % les plus forts. C\'est un repère, pas un examen.',
      actions: [{ label: 'OK', value: true, style: 'preferred' }] });
  },
});
