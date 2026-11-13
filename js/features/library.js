// ═══════════════════════════════════════════════════════════
//  Bibliothèque d'exercices : recherche, filtres par matériel et par muscle, progressions
//  Programme › Bibliothèque (« library ») puis la fiche d'un exercice (« library-ex:NOM »)
// ═══════════════════════════════════════════════════════════
'use strict';

let libQuery = '';       // recherche en cours (gardée en revenant d'une fiche)
let libEquip = 'all';    // filtre de matériel de l'écran (indépendant de la feuille d'ajout)

let libMuscle = NO_MUSCLE_FILTER;   // filtre par muscle de l'écran (groupe, muscle précis)

// Sections de la liste, dans l'ordre du corps : rangement par le premier muscle principal (MUSCLE_GROUPS)
function libSection(e) {
  if (e.equip === 'cardio') return 'Cardio';
  return MUSCLE_GROUPS.find(g => g.muscles.includes(e.primary[0]))?.label || 'Autres';
}

// Une ligne par exercice, même mise en page que les groupes : nom et détails à gauche, personnage 3D à
// droite avec le muscle principal en rouge (retour de Maxence, 13/11 : « une liste, ce n'est ni pratique ni
// joli »). Cardio ou muscle sans image : la ligne garde son texte seul.
function libRowHtml(e) {
  const equip = EQUIPMENT.find(q => q.id === e.equip)?.label || '';
  const m = exerciseMuscles({ name: e.name }), id = m.primary?.[0];
  return `<button class="cell mgc mgc--ex" data-action="open-library-ex" data-name="${esc(e.name)}">
      <span class="mgc__text"><span class="mgc__title">${esc(e.name)}</span>
        <span class="mgc__sub">${esc([musclesLine(m, 3), equip].filter(Boolean).join(' · '))}</span></span>
      ${isMuscleId(id) ? muscleImgHtml(id, true) : ''}
    </button>`;
}

// ── Groupes de muscles en liste illustrée (filtre sans groupe choisi) ─
// Sans groupe choisi, les pastilles des groupes deviennent une liste iOS : nom et nombre d'exercices à
// gauche, personnage 3D maison à droite, muscles du groupe en rouge (img/muscles/<id>.webp, dépôt
// mdlf-perso, src/cartes.py). Toucher une ligne = toucher la pastille du groupe (même action, même
// ordre). Un groupe choisi : retour aux pastilles, pour garder la liste des exercices en haut.
function libMatches(f) {
  return EXERCISE_CATALOGUE.filter(e => (libEquip === 'all' || e.equip === libEquip)
    && muscleFilterMatch(exerciseMuscles({ name: e.name }), f));
}
function exercisesCountLabel(n) { return n ? `${n} exercice${n > 1 ? 's' : ''}` : 'Aucun exercice'; }

// Image décorative (alt vide) : VoiceOver lit le libellé de la ligne ; sans fichier, la ligne garde son texte
function muscleImgHtml(id, lazy = false) {
  return `<img class="mgc__img" src="img/muscles/${id}.webp" alt="" width="300" height="200" decoding="async"${lazy ? ' loading="lazy"' : ''}>`;
}

function muscleGroupsHtml(action) {
  const rows = MUSCLE_GROUPS.map(g => {
    const count = exercisesCountLabel(libMatches({ group: g.id, muscle: null }).length);
    return `<button class="cell mgc" data-action="${action}" data-group="${g.id}" aria-label="${esc(g.label)}, ${count}">
        <span class="mgc__text"><span class="mgc__title">${esc(g.label)}</span><span class="mgc__sub">${count}</span></span>
        ${muscleImgHtml(g.id)}
      </button>`;
  }).join('');
  return `<div class="mf mgcs group" data-mf="${action}" role="group" aria-label="Groupes de muscles"${libQuery.trim() ? ' hidden' : ''}>${rows}</div>`;
}
function libMuscleBoxHtml() {
  return libMuscle.group ? muscleFilterHtml('lib-muscle', libMuscle) : muscleGroupsHtml('lib-muscle');
}
// focus : après un toucher, VoiceOver reste sur le choix (pastille du groupe, ou première ligne)
function refreshLibMuscleBox(focus = false) {
  const box = $('.library .mf');
  if (!box) return;
  box.outerHTML = libMuscleBoxHtml();
  if (!focus) return;
  const g = libMuscle.group;
  const target = g ? $(`.library .mf [data-group="${g}"]${libMuscle.muscle ? `[data-muscle="${libMuscle.muscle}"]` : ':not([data-muscle])'}`)
    : $('.library .mgc');
  target?.focus({ preventScroll: true });
}

// Fiche sans vidéo ni animation 3D : le muscle principal sur le personnage, en tête (rien pour le cardio)
function muscleHeroHtml(name) {
  if (exerciseVideo(name) || exerciseAnim(name)) return '';
  const id = exerciseMuscles({ name }).primary?.[0];
  if (!isMuscleId(id)) return '';
  return `<div class="group mgcs mgcs--hero"><div class="cell mgc mgc--hero">
      <span class="mgc__text"><span class="mgc__sub">Muscle principal</span><span class="mgc__title">${esc(muscleLabel(id))}</span></span>
      ${muscleImgHtml(id)}
    </div></div>`;
}

function libListHtml() {
  const q = libQuery.trim();
  const items = libMatches(libMuscle)
    .map(e => ({ e, score: q ? exerciseMatchScore(e.name, q) : 2 })).filter(x => x.score > 0);
  if (!items.length) {
    const why = q ? ` pour « ${esc(q)} »` : muscleFilterTargets(libMuscle) ? ' pour ce muscle avec ce matériel' : '';
    return `<div class="empty-note">Aucun exercice${why}. Tu peux le créer depuis une séance.</div>`;
  }
  // Recherche : liste à plat, les meilleurs d'abord ; sinon par grande zone du corps, dans l'ordre alphabétique
  if (q) {
    items.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name, 'fr'));
    return `<div class="group">${items.map(x => libRowHtml(x.e)).join('')}</div>`;
  }
  // Filtre par muscle : une seule section, nommée comme la pastille (un soulevé de terre rangé en Jambes
  // reste visible sous « Dos » sans ouvrir de section Jambes)
  if (muscleFilterTargets(libMuscle)) {
    const g = MUSCLE_GROUP_BY_ID.get(libMuscle.group);
    const list = items.map(x => x.e).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return `<div class="group-title">${esc(libMuscle.muscle ? muscleLabel(libMuscle.muscle) : g.label)} · ${list.length}</div><div class="group">${list.map(libRowHtml).join('')}</div>`;
  }
  const order = [...MUSCLE_GROUPS.map(g => g.label), 'Cardio', 'Autres'];
  return order.map(title => {
    const list = items.filter(x => libSection(x.e) === title).map(x => x.e).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return list.length ? `<div class="group-title">${title} · ${list.length}</div><div class="group">${list.map(libRowHtml).join('')}</div>` : '';
  }).join('');
}

function renderLibrary() {
  return `
    <div class="view library view--grouped">
      ${navBar({ title: 'Bibliothèque' })}
      <div class="scr">
        <div class="hist-tools">
          <input type="search" id="libSearch" class="search" placeholder="Nom, muscle ou matériel" value="${esc(libQuery)}"
                 autocomplete="off" enterkeyhint="search" aria-label="Rechercher un exercice">
          <div class="ax__equip lib__equip" role="group" aria-label="Matériel">
            ${[{ id: 'all', label: 'Tout' }, ...EQUIPMENT].map(({ id, label }) =>
              `<button class="ax__chip" aria-pressed="${libEquip === id}" data-action="lib-equip" data-equip="${id}">${label}</button>`).join('')}
          </div>
          ${libMuscleBoxHtml()}
        </div>
        <div id="libList">${libListHtml()}</div>
      </div>
    </div>`;
}

// Fiche : silhouette et muscles, matériel, mesure, versions plus facile / plus dure, progrès si déjà fait.
// name : nom de la bibliothèque ou nom tapé par la personne (« Comment faire » d'un alias) : les muscles
// sont ceux qu'elle a choisis pour ce nom, sinon les muscles vérifiés
function renderLibraryEx(name) {
  const e = catalogueEntry(name);
  if (!e) return `<div class="view library-ex view--grouped">${navBar({ title: 'Exercice' })}<div class="scr"><div class="empty-note">Exercice introuvable.</div></div></div>`;
  const { easier, harder } = progressionOf(e.name);
  const done = [...exerciseIndex().values()].find(it => catalogueEntry(it.name)?.name === e.name);
  const link = (n, lbl) => n ? `<button class="cell cell--nav" data-action="open-library-ex" data-name="${esc(n)}">
      <span class="cell__body"><span class="cell__sub">${lbl}</span><span class="cell__title">${esc(n)}</span></span>${icon('chevron.right', 16)}</button>` : '';
  const share = bodyShare(e);
  return `
    <div class="view library-ex view--grouped">
      ${navBar({ title: esc(catalogueAliasOf(name) ? name : e.name), large: false })}
      <div class="scr">
        ${aliasNoteHtml(name, 'scr-sub ex-alias library-ex__alias')}
        ${muscleHeroHtml(name)}
        ${howToHtml(e.name)}
        ${exMusclesGroupHtml({ name }, 'Muscles')}
        <div class="group">
          <div class="cell"><span class="cell__body"><span class="cell__title">Matériel</span></span>
            <span class="cell__value">${esc(EQUIPMENT.find(q => q.id === e.equip)?.label || '—')}</span></div>
          <div class="cell"><span class="cell__body"><span class="cell__title">Mesure</span></span>
            <span class="cell__value">${MEASURES[measureOf(e)].label}</span></div>
          ${share ? `<div class="cell"><span class="cell__body"><span class="cell__title">Poids du corps soulevé</span></span>
            <span class="cell__value num">≈ ${Math.round(share * 100)} %</span></div>` : ''}
        </div>
        ${easier || harder ? `<div class="group-title">Progression</div><div class="group">${link(easier, 'Plus facile')}${link(harder, 'Plus dur')}</div>` : ''}
        ${strengthGroupHtml(e.name)}
        ${done ? `<div class="group"><button class="cell cell--nav" data-action="open-stats-ex" data-ex="${esc(done.exId)}">
            <span class="cell__body"><span class="cell__title">Voir mes progrès</span></span>${icon('chevron.right', 16)}</button></div>` : ''}
        ${e.aliases.length ? `<div class="group-foot">Aussi appelé : ${esc(e.aliases.join(', '))}</div>` : ''}
      </div>
    </div>`;
}

SCREENS.set('library', { render: () => renderLibrary() });
SCREENS.set('library-ex', { render: name => renderLibraryEx(name), mount: () => mountHowTo() });

// Recherche : seule la liste est redessinée (le champ garde le focus et le clavier)
document.addEventListener('input', e => {
  if (e.target.id !== 'libSearch') return;
  libQuery = e.target.value;
  const groups = $('.library .mgcs');
  if (groups) groups.hidden = !!libQuery.trim();   // en recherche, les résultats viennent tout de suite
  const list = $('#libList');
  if (list) list.innerHTML = libListHtml();
});

registerActions({
  // Ouverture depuis Programme : on repart des groupes musculaires (les filtres ne restent qu'en revenant d'une fiche)
  'go-library': () => { libQuery = ''; libEquip = 'all'; libMuscle = NO_MUSCLE_FILTER; navigate('library'); },
  'open-library-ex': (e, el) => navigate(makeRoute('library-ex', el.dataset.name)),
  'lib-muscle': (e, el) => {
    libMuscle = muscleFilterTap(el, libMuscle);
    refreshLibMuscleBox(true);
    const list = $('#libList');
    if (list) list.innerHTML = libListHtml();
  },
  'lib-equip': (e, el) => {
    libEquip = el.dataset.equip;
    document.querySelectorAll('[data-action="lib-equip"]').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
    if (!libMuscle.group) refreshLibMuscleBox();   // nombres d'exercices des groupes
    const list = $('#libList');
    if (list) list.innerHTML = libListHtml();
    haptic();
  },
});
