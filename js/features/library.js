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
// Sous-titre sur une seule ligne, pour un rythme régulier (panel du 13/11) : deux muscles au plus et le
// matériel en court, un seul muscle si c'est encore trop long, points de suspension en dernier recours (CSS).
// Le muscle filtré passe devant. VoiceOver lit tout : nom, tous les muscles principaux, matériel entier.
// Le matériel n'est jamais coupé (« Mollets · Quadriceps · Car… » sur iPhone SE, panel du 13/11) : il a sa propre
// boîte qui ne rétrécit pas, seuls les muscles peuvent finir en « … ». Le choix deux muscles / un muscle se fait
// sur la largeur réelle, après le rendu (fitLibSubs).
function libSubHtml(m, equip) {
  // Un seul muscle qui ne tient toujours pas (iPhone SE) : nom court plutôt que « Ischio-jam… »
  const two = musclesLine(m, 2), one = musclesLine(m, 1).replace('Ischio-jambiers', 'Ischios');
  const mus = `<span class="mgc__mus"${one !== two ? ` data-short="${esc(one)}"` : ''}>${esc(two)}</span>`;
  if (!equip) return mus;
  return `${two ? mus : ''}<span class="mgc__eq">${two ? '\u00a0· ' : ''}${esc(equip)}</span>`;
}
// Deux muscles qui ne tiennent pas en entier : un seul (texte agrandi : rien à faire). Mesure tout de suite, puis
// à l'image suivante et une fois les polices chargées : la police de secours, plus étroite, faisait tout tenir à tort
// Largeur voulue mesurée sans rétrécir la boîte : WebKit donne scrollWidth = clientWidth sous des « … »
function libSubOverflows(mus) {
  const sub = mus.parentElement;
  mus.style.flexShrink = '0';
  const need = mus.getBoundingClientRect().width + (sub.querySelector('.mgc__eq')?.getBoundingClientRect().width || 0);
  mus.style.flexShrink = '';
  return need > sub.clientWidth - 2;   // 2 px de marge : à la limite, WebKit pose déjà les « … » (arrondis)
}
function fitLibSubsNow(scope) {
  scope.querySelectorAll('.library .mgc__mus[data-short]').forEach(el => {
    if (libSubOverflows(el)) { el.textContent = el.dataset.short; el.removeAttribute('data-short'); }
  });
}
function fitLibSubs(scope = document) {
  fitLibSubsNow(scope);
  requestAnimationFrame(() => fitLibSubsNow(scope));
  document.fonts?.ready.then(() => fitLibSubsNow(scope));
}
window.addEventListener('resize', () => fitLibSubsNow(document));
function libRowHtml(e) {
  const q = EQUIPMENT.find(x => x.id === e.equip);
  const m = exerciseMuscles({ name: e.name }), id = m.primary?.[0];
  const f = libMuscle.muscle, shown = f && m.primary.includes(f) ? { ...m, primary: [f, ...m.primary.filter(x => x !== f)] } : m;
  const muscles = [...new Set(m.primary.map(muscleLabel))];
  const label = [e.name, ...muscles, q?.label].filter(Boolean).join(', ');
  return `<button class="cell mgc mgc--ex" data-action="open-library-ex" data-name="${esc(e.name)}" aria-label="${esc(label)}">
      <span class="mgc__text"><span class="mgc__title">${esc(e.name)}</span>
        <span class="mgc__sub">${libSubHtml(shown, q?.short || q?.label || '')}</span></span>
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
// Groupe choisi : la rangée du matériel se replie en une pastille « Matériel : Tout » en tête des groupes
// (trois rangées de pastilles mangeaient un tiers de l'écran, panel du 13/11) ; elle ouvre une feuille d'actions
function libEquipLabel() { return libEquip === 'all' ? 'Tout' : EQUIPMENT.find(q => q.id === libEquip)?.label || 'Tout'; }
function libEquipMenuChip() {
  return `<button class="ax__chip lib__equip-menu${libEquip === 'all' ? '' : ' is-on'}" data-action="lib-equip-menu" aria-haspopup="dialog">Matériel : ${esc(libEquipLabel())}${icon('chevron.down', 12)}</button>`;
}
function libMuscleBoxHtml() {
  return libMuscle.group ? muscleFilterHtml('lib-muscle', libMuscle, libEquipMenuChip()) : muscleGroupsHtml('lib-muscle');
}
// focus : après un toucher, VoiceOver reste sur le choix (pastille du groupe, ou première ligne)
function refreshLibMuscleBox(focus = false) {
  const box = $('.library .mf');
  if (!box) return;
  box.outerHTML = libMuscleBoxHtml();
  const equip = $('.library .lib__equip');
  if (equip) equip.hidden = !!libMuscle.group;
  if (!focus) return;
  const g = libMuscle.group;
  const target = g ? $(`.library .mf__row--sub [data-muscle="${libMuscle.muscle || ''}"]`)
    : $('.library .mgc');
  target?.focus({ preventScroll: true });
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

// Groupe choisi = un niveau de navigation iOS, sans nouvelle route (panel du 13/11 : le retour disait « Programme »
// et sortait de la Bibliothèque) : titre du groupe, retour « ‹ Bibliothèque » qui remet le filtre à zéro
function libNavBar() {
  const g = MUSCLE_GROUP_BY_ID.get(libMuscle.group);
  if (!g) return navBar({ title: 'Bibliothèque' });
  const back = `<button class="navbar__back" data-action="lib-muscle" data-group="" aria-label="Retour : Bibliothèque">
      ${icon('chevron.left', 22)}<span class="navbar__back-label" data-full="Bibliothèque">Bibliothèque</span>
    </button>`;
  return navBar({ title: esc(g.label), large: false, left: back });
}

function renderLibrary() {
  return `
    <div class="view library view--grouped">
      ${libNavBar()}
      <div class="scr">
        <div class="hist-tools">
          <input type="search" id="libSearch" class="search" placeholder="Nom, muscle ou matériel" value="${esc(libQuery)}"
                 autocomplete="off" enterkeyhint="search" aria-label="Rechercher un exercice">
          <div class="ax__equip lib__equip" role="group" aria-label="Matériel"${libMuscle.group ? ' hidden' : ''}>
            ${[{ id: 'all', label: 'Tout' }, ...EQUIPMENT].map(({ id, label }) =>
              `<button class="ax__chip" aria-pressed="${libEquip === id}" data-action="lib-equip" data-equip="${id}">${label}</button>`).join('')}
          </div>
          ${libMuscleBoxHtml()}
        </div>
        <div id="libList">${libListHtml()}</div>
      </div>
    </div>`;
}

// ── Fiche d'un exercice ─────────────────────────────────────
// Grande illustration en tête (vidéo du coach, sinon animation 3D, sinon le muscle principal sur le personnage ; rien
// pour le cardio sans image), nom en grand titre et « muscles · matériel », puis des onglets : À propos (conseil, consignes,
// muscles, matériel, progression, force), Historique, Courbe et Records (écran de Progrès d'un exercice, js/features/
// progress-chart.js : mêmes calculs). Onglet gardé pendant la session, À propos pour un autre exercice.
// name : nom de la bibliothèque ou nom tapé par la personne (« Comment faire » d'un alias) : les muscles
// sont ceux qu'elle a choisis pour ce nom, sinon les muscles vérifiés
const LIB_EX_TABS = [['about', 'À propos'], ['history', 'Historique'], ['chart', 'Courbe'], ['records', 'Records']];
let libExTab = 'about';
let libExTabOf = null;   // exercice de l'onglet gardé

// Image décorative : le titre et la ligne « muscles · matériel » disent déjà tout (VoiceOver ne la lit pas)
function libExHeroHtml(name) {
  const media = exerciseVideoHtml(name);
  if (media) return `<div class="exhero exhero--media">${media}</div>`;
  const id = exerciseMuscles({ name }).primary?.[0];
  if (!isMuscleId(id)) return '';
  return `<div class="exhero"><img class="exhero__img" src="img/muscles/${id}.webp" alt="" width="600" height="400" decoding="async"></div>`;
}

// Historique, Courbe ou Records d'un exercice jamais fait : un état vide qui dit quoi faire
function libExEmptyHtml(what) {
  return `<div class="exempty">${icon(what === 'chart' ? 'chart' : 'clock.history', 28)}
      <p class="exempty__title">Pas encore fait</p>
      <p class="exempty__sub">${what === 'records' ? 'Tes records' : what === 'chart' ? 'Ta courbe' : 'Tes séances'} de cet exercice ${what === 'chart' ? 's\'affichera' : 's\'afficheront'} ici après ta première séance.</p>
    </div>`;
}

function libExAboutHtml(e, name) {
  const { easier, harder } = progressionOf(e.name);
  const link = (n, lbl) => n ? `<button class="cell cell--nav" data-action="open-library-ex" data-name="${esc(n)}">
      <span class="cell__body"><span class="cell__sub">${lbl}</span><span class="cell__title">${esc(n)}</span></span>${icon('chevron.right', 16)}</button>` : '';
  const share = bodyShare(e);
  return `${howToTipHtml(e.name)}
        ${howToHtml(e.name)}
        ${exMusclesGroupHtml({ name }, 'Muscles', { textOnly: !exerciseVideoHtml(name) })}
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
        ${e.aliases.length ? `<div class="group-foot">Aussi appelé : ${esc(e.aliases.join(', '))}</div>` : ''}`;
}

function renderLibraryEx(name) {
  const e = catalogueEntry(name);
  if (!e) return `<div class="view library-ex view--grouped">${navBar({ title: 'Exercice' })}<div class="scr"><div class="empty-note">Exercice introuvable.</div></div></div>`;
  if (libExTabOf !== e.name) { libExTab = 'about'; libExTabOf = e.name; statsMode = 'charge'; }
  const done = [...exerciseIndex().values()].find(it => catalogueEntry(it.name)?.name === e.name);
  const st = done ? exStatsParts(done, { fiche: true }) : null;
  const more = done ? `<div class="group"><button class="cell cell--nav" data-action="open-stats-ex" data-ex="${esc(done.exId)}">
            <span class="cell__body"><span class="cell__title">Voir mes progrès</span></span>${icon('chevron.right', 16)}</button></div>` : '';
  const panels = {
    about: libExAboutHtml(e, name),
    history: st ? `<div class="group">${st.sessions}</div>${more}` : libExEmptyHtml('history'),
    chart: st ? st.chart : libExEmptyHtml('chart'),
    records: st ? `${st.records}${st.target}` : libExEmptyHtml('records'),
  };
  const q = EQUIPMENT.find(x => x.id === e.equip);
  const sub = [[...new Set(exerciseMuscles({ name }).primary.map(muscleLabel))].join(', '), q?.label].filter(Boolean).join('\u00a0· ');   // « · » collé au mot d'avant : le matériel ne se lit pas comme un muscle
  const title = catalogueAliasOf(name) ? name : e.name;
  return `
    <div class="view library-ex view--grouped">
      ${navBar({ title: '' })}
      <div class="scr">
        ${libExHeroHtml(name)}
        <h1 class="scr-title exhead__title">${esc(title)}</h1>
        ${sub ? `<p class="exhead__sub">${esc(sub)}</p>` : ''}
        ${aliasNoteHtml(name, 'scr-sub ex-alias library-ex__alias')}
        <div class="segmented seg-full extabs" role="tablist" aria-label="Fiche de l'exercice">
          ${LIB_EX_TABS.map(([k, l]) => `<button class="segmented__btn${libExTab === k ? ' segmented__btn--active' : ''}" role="tab" id="extab-${k}"
            aria-selected="${libExTab === k}" aria-controls="expanel-${k}" data-action="lib-ex-tab" data-tab="${k}">${l}</button>`).join('')}
        </div>
        ${LIB_EX_TABS.map(([k]) => `<div class="expanel" role="tabpanel" id="expanel-${k}" aria-labelledby="extab-${k}"${libExTab === k ? '' : ' hidden'}>${panels[k]}</div>`).join('')}
      </div>
    </div>`;
}

// Onglet choisi : les panneaux sont déjà là, seul l'affichage change (l'animation de l'en-tête continue) ;
// la courbe se dessine quand son panneau devient visible (largeur nulle tant qu'il est caché)
function setLibExTab(k) {
  libExTab = k;
  document.querySelectorAll('.library-ex .extabs [role="tab"]').forEach(b => {
    const on = b.dataset.tab === k;
    b.classList.toggle('segmented__btn--active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.library-ex .expanel').forEach(p => { p.hidden = p.id !== `expanel-${k}`; });
  if (k === 'chart') drawCharts();
}

SCREENS.set('library', { render: () => renderLibrary(), mount: () => fitLibSubs() });
SCREENS.set('library-ex', { render: name => renderLibraryEx(name), mount: () => { mountHowTo(); if (libExTab === 'chart') drawCharts(); } });

// Recherche : seule la liste est redessinée (le champ garde le focus et le clavier)
document.addEventListener('input', e => {
  if (e.target.id !== 'libSearch') return;
  libQuery = e.target.value;
  const groups = $('.library .mgcs');
  if (groups) groups.hidden = !!libQuery.trim();   // en recherche, les résultats viennent tout de suite
  const list = $('#libList');
  if (list) { list.innerHTML = libListHtml(); fitLibSubs(list); }
});

// Nouveau matériel : pastilles de la rangée, pastille repliée, nombres des groupes et liste à jour
function setLibEquip(id) {
  libEquip = id;
  document.querySelectorAll('[data-action="lib-equip"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.equip === id)));
  refreshLibMuscleBox();
  $('.library .mf__row--sub [aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const list = $('#libList');
  if (list) { list.innerHTML = libListHtml(); fitLibSubs(list); }
}

registerActions({
  // Ouverture depuis Programme : on repart des groupes musculaires (les filtres ne restent qu'en revenant d'une fiche)
  'go-library': () => { libQuery = ''; libEquip = 'all'; libMuscle = NO_MUSCLE_FILTER; navigate('library'); },
  'open-library-ex': (e, el) => navigate(makeRoute('library-ex', el.dataset.name)),
  'lib-ex-tab': (e, el) => { if (el.dataset.tab !== libExTab) { setLibExTab(el.dataset.tab); haptic(); } },
  'lib-muscle': (e, el) => {
    const before = libMuscle.group;
    libMuscle = muscleFilterTap(el, libMuscle);
    // Groupe changé : toute la vue est redessinée (barre : titre et retour), en haut de page pour voir le titre,
    // les filtres et le 1er exercice. VoiceOver : sur le retour en entrant dans un groupe, sur la ligne du groupe
    // quitté en revenant à la liste des groupes.
    if (libMuscle.group !== before) {
      paint(0);
      const target = libMuscle.group ? $('.library .navbar__back') : $(`.library .mgcs [data-group="${before}"]`);
      target?.focus({ preventScroll: true });
      return;
    }
    refreshLibMuscleBox(true);
    const list = $('#libList');
    if (list) { list.innerHTML = libListHtml(); fitLibSubs(list); }
    $('.library .mf__row--sub [aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },
  'lib-equip': (e, el) => { setLibEquip(el.dataset.equip); haptic(); },
  // Feuille d'actions iOS (comme les autres choix de l'app) : le choix en cours en gras
  'lib-equip-menu': async () => {
    const choice = await dialog({ type: 'sheet', title: 'Matériel', actions: [
      ...[{ id: 'all', label: 'Tout' }, ...EQUIPMENT].map(({ id, label }) => ({ label, value: id, style: libEquip === id ? 'preferred' : '' })),
      { label: 'Annuler', style: 'cancel' },
    ] });
    if (!choice || !$('.library')) return;
    setLibEquip(choice);
    $('.library .lib__equip-menu')?.focus({ preventScroll: true });
  },
});
