// ═══════════════════════════════════════════════════════════
//  Réglages › Apparence › Design : couleur de l'app et icône de l'app
// ═══════════════════════════════════════════════════════════
'use strict';

// Deux réglages séparés sur un même écran :
// - la couleur (js/data/design.js, data.design daté, synchronisé) : deux vignettes de l'accueil dans le thème affiché,
//   une coche sur le choix ; l'app change aussitôt (classe body.design-bleu, css/theme-sobre.css) ;
// - l'icône (js/features/app-icon.js) : app iOS seulement, absente dans le navigateur.
// Vignettes : captures de l'accueil sur iPhone 13 (img/design/, une par design et par thème).

const DESIGN_OPTIONS = Object.freeze([
  { id: 'orange', label: 'Orange', sub: 'Par défaut' },
  { id: 'bleu',   label: 'Bleu',   sub: 'Accent bleu d\'iOS' },
]);
const designLabel = id => DESIGN_OPTIONS.find(o => o.id === id)?.label || 'Orange';

function renderDesign() {
  const cur = designAccent(data);
  const theme = document.body.classList.contains('light') ? 'light' : 'dark';
  const opts = DESIGN_OPTIONS.map(o => {
    const on = o.id === cur;
    return `<button class="design-opt" data-action="set-design" data-val="${o.id}" aria-pressed="${on}"
              aria-label="${esc(o.label)}, ${esc(o.sub)}">
              <span class="design-opt__img"><img src="img/design/${o.id}-${theme}.webp" alt="" width="150" height="260">
                ${on ? `<span class="design-opt__check">${icon('checkmark', 15)}</span>` : ''}</span>
              <span class="design-opt__name">${esc(o.label)}</span>
              <span class="design-opt__sub">${esc(o.sub)}</span>
            </button>`;
  }).join('');
  return `
    <div class="view settings-design view--grouped">
      ${navBar({ title: 'Design' })}
      <div class="scr">
        <div class="group-title" id="designColorTitle">Couleur de l'app</div>
        <div class="group group--pad">
          <div class="design-opts" role="group" aria-labelledby="designColorTitle">${opts}</div>
        </div>
        <div class="group-foot">Boutons, liens et récaps prennent cette couleur, sur tous tes appareils.</div>
${renderAppIconGroup()}
      </div>
    </div>`;
}

registerActions({
  'go-design': () => navigate('settings-design'),
  'set-design': (e, el) => {
    const val = el.dataset.val;
    if (!DESIGN_ACCENTS.includes(val) || val === designAccent(data)) return;
    data.design = { accent: val, at: Date.now() };   // daté : le choix le plus récent gagne (synchro)
    save();
    applyDesign();
    render();
    // Le rendu remplace les boutons : le focus revient sur le choix (VoiceOver annonce « sélectionné »)
    $(`.design-opt[data-val="${val}"]`)?.focus({ preventScroll: true });
  },
});
