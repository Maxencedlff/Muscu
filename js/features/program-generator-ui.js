// ═══════════════════════════════════════════════════════════
//  Programme sur mesure : questions courtes façon iOS, puis l'aperçu du programme généré
//
//  Accès principal : Programme › Mes programmes › Ajouter un programme › « Créer mon programme sur mesure ».
//  Au premier lancement, seulement un lien discret sous le programme conseillé : rien n'est imposé, « Plus tard »
//  ne relance rien. Une question par écran (route prog-gen:<étape>), le retour d'iOS revient à la précédente.
//  Âge, taille, poids et sexe : ceux des Réglages (mêmes clés et mêmes actions : set-profile-age,
//  set-profile-height, set-body-weight, set-strength-sex), modifiables ici. Les autres réponses restent sur
//  l'appareil (GEN_ANSWERS_KEY), jamais sur le compte. Règles : js/data/program-generator.js.
//  Rien n'est remplacé sans confirmation : le programme s'ajoute à Mes programmes, l'ancien y reste.
// ═══════════════════════════════════════════════════════════
'use strict';

const GEN_ANSWERS_KEY = 'mdlf_gen_answers';
const GEN_STEPS = ['toi', 'objectif', 'niveau', 'jours', 'duree', 'materiel', 'options', 'apercu'];
const GEN_QUESTIONS = GEN_STEPS.length - 1;
let genAns = null;

function genStored() {
  try { const v = JSON.parse(localStorage.getItem(GEN_ANSWERS_KEY)); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function genStore() {
  try { localStorage.setItem(GEN_ANSWERS_KEY, JSON.stringify(genAns)); } catch { /* facultatif : réponses redemandées */ }
}
// Réponses en cours : celles gardées sur l'appareil, sinon déduites de l'app (objectif de la semaine, niveau)
function genAnswers() {
  if (genAns) return genAns;
  const s = genStored();
  const fromHist = genLevelFromHistory(data.history);
  const level = s.level || fromHist || (data.level === 'debutant' ? 'debutant' : data.level === 'confirme' ? 'intermediaire' : null);
  genAns = {
    goal: s.goal || null, level, levelGuess: !s.level && !!fromHist,
    days: s.days || (GEN_DAYS.includes(data.weeklyGoal) ? data.weeklyGoal : null), minutes: s.minutes || null,
    gym: typeof s.gym === 'boolean' ? s.gym : !(data.exEquip === 'aucun' || data.exEquip === 'halteres'),
    equip: Array.isArray(s.equip) ? s.equip : data.exEquip === 'halteres' ? ['halteres', 'banc'] : [],
    dbLoads: Array.isArray(s.dbLoads) ? s.dbLoads : [],
    zones: Array.isArray(s.zones) ? s.zones : [], limits: Array.isArray(s.limits) ? s.limits : [],
  };
  return genAns;
}
// Profil des Réglages (lu à chaque fois : modifiable ici comme là-bas)
function genProfile() {
  return { age: profileAge(), heightCm: data.heightCm ?? null, kg: currentBodyKg(), sex: strengthSex() || data.dietEstSex || null };
}
// Salle complète seulement si cochée : décochée sans rien d'autre, le programme se fait au poids du corps
function genInputs() { const a = genAnswers(); return { ...a, gym: a.gym === true, ...genProfile() }; }

// Ouverture du générateur ; prefill : réponses du premier lancement (lieu, fréquence, niveau)
function openProgGen(prefill = null) {
  genAnswers();
  if (prefill) {
    if (prefill.place === 'salle') { genAns.gym = true; }
    else if (prefill.place === 'halteres') { genAns.gym = false; genAns.equip = ['halteres', 'banc']; }
    else if (prefill.place === 'rien') { genAns.gym = false; genAns.equip = []; }
    if (prefill.perWeek) genAns.days = Math.min(6, Math.max(2, prefill.perWeek));
    if (prefill.level) { genAns.level = prefill.level === 'debutant' ? 'debutant' : 'intermediaire'; genAns.levelGuess = false; }
  }
  navigate(makeRoute('prog-gen', 'toi'));
}
function genNext(step) {
  genStore();
  haptic();
  navigate(makeRoute('prog-gen', GEN_STEPS[GEN_STEPS.indexOf(step) + 1] || 'apercu'));
}

// ── Gabarits ─────────────────────────────────────────────────
function genOption(action, value, label, sub, on) {
  return `
    <button class="cell cell--nav gen-opt" data-action="${action}" data-val="${esc(String(value))}" aria-pressed="${on}">
      <span class="cell__body">
        <span class="cell__title gen-opt__title">${label}</span>
        ${sub ? `<span class="cell__sub">${sub}</span>` : ''}
      </span>
      ${on ? `<span class="cell__check">${icon('checkmark', 20)}</span>` : icon('chevron.right', 16)}
    </button>`;
}
// Case à cocher (choix multiples) : coche à droite, aria-pressed
function genCheck(action, value, label, sub, on) {
  return `
    <button class="cell cell--pick gen-opt" data-action="${action}" data-val="${esc(String(value))}" aria-pressed="${on}">
      <span class="cell__body">
        <span class="cell__title">${label}</span>
        ${sub ? `<span class="cell__sub">${sub}</span>` : ''}
      </span>
      <span class="cell__check">${on ? icon('checkmark', 20) : ''}</span>
    </button>`;
}
function genScreen(step, title, body, { lead = '' } = {}) {
  const q = GEN_STEPS.indexOf(step) + 1;
  return `
    <div class="view prog-gen view--grouped">
      ${navBar({ title, large: true })}
      <div class="scr">
        ${q <= GEN_QUESTIONS ? `<p class="gen-step">Question ${q} sur ${GEN_QUESTIONS}</p>` : ''}
        ${lead ? `<p class="prog-info__why gen-lead">${lead}</p>` : ''}
        ${body}
      </div>
    </div>`;
}
function genNextBtn(step, label = 'Suivant') {
  return `<div class="prog-info__actions"><button class="btn btn--primary prog-info__btn" data-action="gen-next" data-step="${step}">${label}</button></div>`;
}

const GEN_SCREENS = {
  toi: () => {
    const p = genProfile();
    const cell = (action, ico, title, value) => `
      <button class="cell cell--nav" data-action="${action}">
        ${cellIco(ico, 'gray')}
        <span class="cell__body"><span class="cell__title">${title}</span></span>
        <span class="cell__value num"${value ? '' : ' aria-label="Non renseigné"'}>${value ? esc(value) : '—'}</span>
        ${icon('chevron.right', 16)}
      </button>`;
    const sex = p.sex === 'male' ? 'Homme' : p.sex === 'female' ? 'Femme' : '';
    return genScreen('toi', 'Sur mesure', `
      <div class="group">
        ${cell('set-profile-age', 'calendar', 'Âge', p.age ? `${p.age} ans` : '')}
        ${cell('set-profile-height', 'ruler', 'Taille', p.heightCm ? `${fmtNum(p.heightCm)} cm` : '')}
        ${cell('set-body-weight', 'bathroom.scale', 'Poids', p.kg ? `${fmtW(p.kg)} ${unitLbl()}` : '')}
        ${cell('set-strength-sex', 'sex', 'Sexe', sex)}
      </div>
      <div class="group-foot">Facultatifs, déjà repris des Réglages. L'âge dose le volume à partir de 60 ans ; le poids et la taille
        choisissent entre tractions et tractions assistées. Le sexe ne change rien au programme. Tout reste sur cet iPhone.</div>
      ${genNextBtn('toi', 'Commencer')}`,
    { lead: 'Quelques questions courtes, puis un programme fait pour toi, que tu pourras modifier comme les autres.' });
  },
  objectif: () => genScreen('objectif', 'Ton objectif', `<div class="group">${Object.entries(GEN_GOALS)
    .map(([k, g]) => genOption('gen-set', k, g.label, g.sub, genAns.goal === k)).join('')}</div>`),
  niveau: () => genScreen('niveau', 'Ton niveau', `<div class="group">${Object.entries(GEN_LEVELS)
    .map(([k, l]) => genOption('gen-set', k, l.label, genAns.levelGuess && genAns.level === k ? `${l.sub} · d'après ton historique` : l.sub, genAns.level === k)).join('')}</div>`),
  jours: () => genScreen('jours', 'Jours par semaine', `<div class="group">${GEN_DAYS
    .map(n => genOption('gen-set', n, `${n} jours`, '', genAns.days === n)).join('')}</div>`, { lead: 'Sur une semaine normale, ceux où tu peux vraiment venir.' }),
  duree: () => genScreen('duree', 'Temps par séance', `<div class="group">${GEN_MINUTES
    .map(n => genOption('gen-set', n, `${n} min`, '', genAns.minutes === n)).join('')}</div>`, { lead: 'Échauffement compris. Les séances ne le dépasseront pas.' }),
  materiel: () => {
    const a = genAnswers(), gym = a.gym === true;
    const fixed = a.equip.includes('halteres_fixes');
    const loads = a.dbLoads.length ? `Charges : ${a.dbLoads.map(v => fmtNum(v)).join(', ')} kg` : 'Touche pour donner leurs charges';
    return genScreen('materiel', 'Ton matériel', `
      <div class="group">${genCheck('gen-gym', 'salle', 'Salle complète', 'Barres, haltères, machines, poulies', gym)}</div>
      <div class="group-title">Ou ce que tu as</div>
      <div class="group">${GEN_EQUIP.map(e => genCheck('gen-equip', e.id, e.label, e.id === 'halteres_fixes' && fixed && !gym ? loads : '', !gym && a.equip.includes(e.id))).join('')}</div>
      ${fixed && !gym ? '<div class="group"><button class="cell cell--action" data-action="gen-db-loads"><span>Charges des haltères fixes</span></button></div>' : ''}
      <div class="group-foot">Le poids du corps compte toujours : sans rien cocher, le programme se fait sans matériel.</div>
      ${genNextBtn('materiel')}`);
  },
  options: () => {
    const a = genAnswers();
    return genScreen('options', 'Priorités et limites', `
      <div class="group-title">Zones à travailler plus, facultatif</div>
      <div class="group">${Object.entries(GEN_ZONES).map(([k, z]) => genCheck('gen-zone', k, z.label, '', a.zones.includes(k))).join('')}</div>
      <div class="group-title">Douleurs ou limites, facultatif</div>
      <div class="group">${Object.entries(GEN_LIMITS).map(([k, l]) => genCheck('gen-limit', k, l.label, l.sub, a.limits.includes(k))).join('')}</div>
      <div class="group-foot">Les exercices qui chargent la zone sont retirés ou remplacés. Ce n'est pas un avis médical : si une douleur persiste, parles-en à un professionnel de santé.</div>
      ${genNextBtn('options', 'Voir mon programme')}`);
  },
  apercu: () => renderGenPreview(),
};

// Aperçu : pourquoi, muscles en rouge sur le personnage, séries par muscle et par semaine, séances
function renderGenPreview() {
  const r = generateProgramme(genInputs());
  const name = genProgrammeName();
  const max = Math.max(1, ...GEN_TRACKED.map(k => r.weekly[k]));
  const levels = {};
  MUSCLES.forEach(m => { if (r.weekly[m.id] > 0) levels[m.id] = Math.max(0.25, Math.min(1, r.weekly[m.id] / max)); });
  const vol = GEN_TRACKED.filter(k => r.weekly[k] > 0).map(k => {
    const n = Math.round(r.weekly[k]);
    return `<div class="cell"><span class="cell__body"><span class="cell__title">${esc(muscleLabel(k))}</span></span>
      <span class="cell__value num">${plural(n, 'série', 'séries')}</span></div>`;
  }).join('');
  const reps = ex => `${ex.sets} × ${ex.repMin} à ${ex.repMax} reps`;
  const sessions = r.sessions.map(s => `
      <div class="group-title gen-sess-title"><span>${esc(s.label)}</span><span class="num" aria-label="environ ${s.minutes} minutes">≈ ${s.minutes} min</span></div>
      <div class="group">${s.exercises.map(ex => `
        <div class="cell gen-ex">
          <span class="cell__body">
            <span class="cell__title">${esc(ex.name)}</span>
            <span class="cell__sub num" aria-label="${ex.sets} séries de ${ex.repMin} à ${ex.repMax} répétitions, repos ${fmtRestSpoken(ex.rest)}">${reps(ex)} · repos ${fmtRest(ex.rest)}</span>
          </span>
        </div>`).join('')}</div>`).join('');
  return `
    <div class="view prog-gen view--grouped">
      ${navBar({ title: name, large: true })}
      <div class="scr">
        <div class="gen-why">${r.why.map(l => `<p>${esc(l)}</p>`).join('')}</div>
        <div class="group group--pad prog-info__map">
          ${bodyMapHtml(levels, { captions: true, label: `Muscles travaillés par ${name}` })}
        </div>
        <div class="group-title">Séries par muscle et par semaine</div>
        <div class="group">${vol}</div>
        <div class="group-foot">Une série compte entière pour les muscles principaux de l'exercice, pour moitié pour les secondaires, comme dans Progrès.</div>
        ${sessions}
        ${r.notes.length ? `<div class="group-foot gen-notes">${r.notes.map(n => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
        <div class="prog-info__actions">
          <button class="btn btn--primary prog-info__btn" data-action="gen-use">Utiliser ce programme</button>
          <button class="btn btn--secondary prog-info__btn" data-action="gen-edit">Modifier mes réponses</button>
        </div>
      </div>
    </div>`;
}

function renderProgGen(step) {
  genAnswers();
  return (GEN_SCREENS[step] || GEN_SCREENS.toi)();
}
SCREENS.set('prog-gen', { render: step => renderProgGen(step) });

// Choix d'un écran à réponse unique (la valeur vient de l'écran courant)
const GEN_SET = {
  objectif: v => { if (Object.hasOwn(GEN_GOALS, v)) genAns.goal = v; },
  niveau:   v => { if (Object.hasOwn(GEN_LEVELS, v)) { genAns.level = v; genAns.levelGuess = false; } },
  jours:    v => { if (GEN_DAYS.includes(+v)) genAns.days = +v; },
  duree:    v => { if (GEN_MINUTES.includes(+v)) genAns.minutes = +v; },
};
// Charges des haltères fixes, en kilos (« 4 8 12 », virgule décimale acceptée)
async function genAskLoads() {
  const raw = await askText({ title: 'Haltères fixes', message: 'Leurs charges en kilos, séparées par des espaces. Exemple : 4 8 12',
    value: genAns.dbLoads.map(v => fmtNum(v)).join(' '), placeholder: '4 8 12' });
  if (raw === null) return;
  const loads = raw.replace(/(\d),(\d)/g, '$1.$2').split(/[\s,;]+/).map(Number).filter(v => v > 0 && v <= 80);
  genAns.dbLoads = [...new Set(loads)].sort((a, b) => a - b).slice(0, 20);
  genStore(); render();
}
const genToggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

registerActions({
  'go-prog-gen': () => openProgGen(),
  'gen-next': (e, el) => genNext(el.dataset.step),
  'gen-set': (e, el) => {
    const step = routeParams(currentRoute())[0];
    GEN_SET[step]?.(el.dataset.val);
    genNext(step);
  },
  'gen-gym': () => { genAns.gym = genAns.gym !== true; haptic(); render(); },
  'gen-equip': (e, el) => {
    if (!GEN_EQUIP_IDS.includes(el.dataset.val)) return;
    genAns.equip = genToggle(genAns.gym === true ? [] : genAns.equip, el.dataset.val);
    genAns.gym = false;
    haptic(); render();
    if (el.dataset.val === 'halteres_fixes' && genAns.equip.includes('halteres_fixes') && !genAns.dbLoads.length) genAskLoads();
  },
  'gen-db-loads': () => genAskLoads(),
  'gen-zone': (e, el) => { if (Object.hasOwn(GEN_ZONES, el.dataset.val)) { genAns.zones = genToggle(genAns.zones, el.dataset.val); haptic(); render(); } },
  'gen-limit': (e, el) => { if (Object.hasOwn(GEN_LIMITS, el.dataset.val)) { genAns.limits = genToggle(genAns.limits, el.dataset.val); haptic(); render(); } },
  'gen-edit': () => routeTo(makeRoute('prog-gen', 'toi')),
  // Jamais de remplacement sans confirmation : le nouveau programme s'ajoute, l'ancien reste dans Mes programmes
  'gen-use': async () => {
    const r = generateProgramme(genInputs());
    const name = genProgrammeName();
    const cur = progMeta(data.activeProgramme).name;
    if (!(await confirmSheet(`Utiliser « ${name} » ?`,
      `Il s'ajoute à Mes programmes et devient ton programme actif. ${cur} y reste, avec son historique.`, 'Utiliser ce programme', false))) return;
    const id = 'u_' + uid();
    const { up, pd } = genProgrammeData(r, name);
    data.userProgrammes[id] = up;
    data.programmes[id] = pd;
    addMyProgramme(id);
    activateProgramme(id);
    genStore();
    save();
    haptic();
    routeTo(nav.stacks[nav.tab][0]);
    showToast(`Programme : ${name}`);
  },
});
