// ═══════════════════════════════════════════════════════════
//  Bibliothèque d'exercices : recherche, muscles, matériel, progressions
//  Programme › Bibliothèque (« library ») puis la fiche d'un exercice (« library-ex:NOM »)
// ═══════════════════════════════════════════════════════════
'use strict';

let libQuery = '';       // recherche en cours (gardée en revenant d'une fiche)
let libEquip = 'all';    // filtre de matériel de l'écran (indépendant de la feuille d'ajout)

// Sections de la liste, dans l'ordre du corps : rangement par le premier muscle principal
const LIB_SECTIONS = [
  ['Pectoraux', ['chest']], ['Dos', ['lats', 'traps', 'lower_back']], ['Épaules', ['front_delts', 'side_delts', 'rear_delts']],
  ['Bras', ['biceps', 'triceps', 'forearms']], ['Abdominaux', ['abs']], ['Jambes', ['quads', 'hamstrings', 'glutes', 'adductors', 'calves']],
];
function libSection(e) {
  if (e.equip === 'cardio') return 'Cardio';
  return LIB_SECTIONS.find(([, ids]) => ids.includes(e.primary[0]))?.[0] || 'Autres';
}

function libRowHtml(e) {
  const equip = EQUIPMENT.find(q => q.id === e.equip)?.label || '';
  return `<button class="cell cell--nav" data-action="open-library-ex" data-name="${esc(e.name)}">
      <span class="cell__body"><span class="cell__title">${esc(e.name)}</span>
        <span class="cell__sub">${esc([musclesLine(e, 3), equip].filter(Boolean).join(' · '))}</span></span>
      ${icon('chevron.right', 16)}
    </button>`;
}

function libListHtml() {
  const q = libQuery.trim();
  const items = EXERCISE_CATALOGUE.filter(e => libEquip === 'all' || e.equip === libEquip)
    .map(e => ({ e, score: q ? exerciseMatchScore(e.name, q) : 2 })).filter(x => x.score > 0);
  if (!items.length) return `<div class="empty-note">Aucun exercice${q ? ` pour « ${esc(q)} »` : ''}. Tu peux le créer depuis une séance.</div>`;
  // Recherche : liste à plat, les meilleurs d'abord ; sinon par grande zone du corps, dans l'ordre alphabétique
  if (q) {
    items.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name, 'fr'));
    return `<div class="group">${items.map(x => libRowHtml(x.e)).join('')}</div>`;
  }
  const order = [...LIB_SECTIONS.map(([t]) => t), 'Cardio', 'Autres'];
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
        </div>
        <div id="libList">${libListHtml()}</div>
      </div>
    </div>`;
}

// Fiche : silhouette et muscles, matériel, mesure, versions plus facile / plus dure, progrès si déjà fait
function renderLibraryEx(name) {
  const e = catalogueEntry(name);
  if (!e) return `<div class="view library-ex view--grouped">${navBar({ title: 'Exercice' })}<div class="scr"><div class="empty-note">Exercice introuvable.</div></div></div>`;
  const m = musclesOf(e.name);
  const { easier, harder } = progressionOf(e.name);
  const done = [...exerciseIndex().values()].find(it => catalogueEntry(it.name)?.name === e.name);
  const link = (n, lbl) => n ? `<button class="cell cell--nav" data-action="open-library-ex" data-name="${esc(n)}">
      <span class="cell__body"><span class="cell__sub">${lbl}</span><span class="cell__title">${esc(n)}</span></span>${icon('chevron.right', 16)}</button>` : '';
  const share = bodyShare(e);
  return `
    <div class="view library-ex view--grouped">
      ${navBar({ title: e.name })}
      <div class="scr">
        ${howToHtml(e.name)}
        <div class="group-title">Muscles</div>
        <div class="group">${exMusclesPanelHtml(m)}</div>
        <div class="group-foot">En couleur pleine les muscles principaux, atténués les secondaires.</div>
        <div class="group">
          <div class="cell"><span class="cell__body"><span class="cell__title">Matériel</span></span>
            <span class="cell__value">${esc(EQUIPMENT.find(q => q.id === e.equip)?.label || '—')}</span></div>
          <div class="cell"><span class="cell__body"><span class="cell__title">Mesure</span></span>
            <span class="cell__value">${MEASURES[measureOf(e)].label}</span></div>
          ${share ? `<div class="cell"><span class="cell__body"><span class="cell__title">Poids du corps soulevé</span></span>
            <span class="cell__value num">≈ ${Math.round(share * 100)} %</span></div>` : ''}
        </div>
        ${easier || harder ? `<div class="group-title">Progression</div><div class="group">${link(easier, 'Plus facile')}${link(harder, 'Plus dur')}</div>` : ''}
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
  const list = $('#libList');
  if (list) list.innerHTML = libListHtml();
});

registerActions({
  'go-library': () => navigate('library'),
  'open-library-ex': (e, el) => navigate(makeRoute('library-ex', el.dataset.name)),
  'lib-equip': (e, el) => {
    libEquip = el.dataset.equip;
    document.querySelectorAll('[data-action="lib-equip"]').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
    const list = $('#libList');
    if (list) list.innerHTML = libListHtml();
    haptic();
  },
});
