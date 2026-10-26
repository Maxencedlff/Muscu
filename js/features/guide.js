// ═══════════════════════════════════════════════════════════
//  Réglages › Guide de l'app : liste des sujets, recherche, page d'un sujet
// ═══════════════════════════════════════════════════════════
'use strict';

// Contenus : js/data/guide.js. Deux écrans inscrits dans SCREENS : « guide » (liste) et
// « guide-topic:ID » (un sujet). « Voir aussi » remplace le sujet affiché : le retour mène
// toujours à la liste, jamais à une pile de sujets.

let guideQuery = '';   // recherche en cours (gardée en revenant d'un sujet)

// Typographie française : espace insécable avant « : ; ! ? » et « % », dans les guillemets, entre un
// nombre et son unité (« 3 s » ne se coupe jamais en fin de ligne)
function guideTypo(str) {
  return str.replace(/ ([:;!?»%›])/g, '\u00a0$1').replace(/« /g, '«\u00a0')
    .replace(/(\d) (s|h|kg|lbs|km|min|jours|minutes|secondes|séances)(?![\p{L}])/gu, '$1\u00a0$2');
}

// « [Réglages] › [Repos par défaut] » : libellés de l'app mis en valeur, le reste échappé
function guideRich(str) {
  return guideTypo(esc(str)).replace(/\[([^\]]+)\]/g, '<span class="guide-ui">$1</span>');
}

function guideIconHtml(t) {
  return `<span class="guide-ic guide-ic--${t.color}" aria-hidden="true">${icon(t.icon, 18)}</span>`;
}

function guideRowHtml(t) {
  return `
    <button class="cell cell--nav guide-row" data-action="open-guide-topic" data-id="${esc(t.id)}">
      ${guideIconHtml(t)}
      <span class="cell__body">
        <span class="cell__title">${esc(t.title)}</span>
        ${t.iphone ? '<span class="cell__sub">App iPhone</span>' : ''}
      </span>
      ${icon('chevron.right', 16)}
    </button>`;
}

function guideListHtml() {
  if (guideQuery.trim()) {
    const found = guideSearch(guideQuery);
    return found.length
      ? `<h2 class="group-title">${plural(found.length, 'sujet', 'sujets')}</h2><div class="group">${found.map(guideRowHtml).join('')}</div>`
      : '<div class="empty-note">Aucun sujet ne correspond.</div>';
  }
  return GUIDE_SECTIONS.map(s => `
        <h2 class="group-title">${esc(s.title)}</h2>
        <div class="group">${s.topics.map(guideRowHtml).join('')}</div>`).join('');
}

function renderGuide() {
  return `
    <div class="view guide-view view--grouped">
      ${navBar({ title: 'Guide' })}
      <div class="scr">
        <div class="hist-tools">
          <input type="search" id="guideSearch" class="search" placeholder="Rechercher un sujet" value="${esc(guideQuery)}"
                 autocomplete="off" enterkeyhint="search" aria-label="Rechercher dans le guide">
        </div>
        <div id="guideList">${guideListHtml()}</div>
      </div>
    </div>`;
}

function renderGuideTopic(id) {
  const t = guideTopic(id);
  if (!t) {
    return `<div class="view guide-topic view--grouped">${navBar({ title: 'Guide' })}
      <div class="scr"><div class="empty-note">Sujet introuvable.</div></div></div>`;
  }
  const tag = t.ordered ? 'ol' : 'ul';
  const related = (t.related || []).map(guideTopic).filter(Boolean);
  return `
    <div class="view guide-topic view--grouped">
      ${navBar({ title: esc(t.title), large: true })}
      <div class="scr">
        ${t.iphone ? '<p class="guide-badge">Réservé à l\'app iPhone</p>' : ''}
        <div class="group guide-card">
          <p class="guide-lead">${guideRich(t.lead)}</p>
          ${t.steps?.length ? `<${tag} class="guide-steps guide-steps--${tag}">${t.steps.map(s => `<li>${guideRich(s)}</li>`).join('')}</${tag}>` : ''}
        </div>
        ${related.length ? `
        <h2 class="group-title">Voir aussi</h2>
        <div class="group">${related.map(guideRowHtml).join('')}</div>` : ''}
      </div>
    </div>`;
}

SCREENS.set('guide', { render: () => renderGuide() });
SCREENS.set('guide-topic', { render: id => renderGuideTopic(id) });

// Recherche : seule la liste est redessinée (le champ garde le focus et le clavier)
document.addEventListener('input', e => {
  if (e.target.id !== 'guideSearch') return;
  guideQuery = e.target.value;
  const list = $('#guideList');
  if (list) list.innerHTML = guideListHtml();
});

registerActions({
  'go-guide': () => { guideQuery = ''; navigate('guide'); },
  'open-guide-topic': (e, el) => {
    if (!guideTopic(el.dataset.id)) return;
    document.activeElement?.blur?.();   // clavier de la recherche refermé
    // Depuis un sujet (« Voir aussi ») : le nouveau sujet prend sa place
    navigate(makeRoute('guide-topic', el.dataset.id), { replace: currentView() === 'guide-topic' });
  },
});
