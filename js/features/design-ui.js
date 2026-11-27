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
  const cur = designAccent(data), links = designLinksColor(data);
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
        <div class="group-foot">Les boutons et les récaps prennent cette couleur, sur tous tes appareils.</div>
        <div class="group">
          <button class="cell" data-action="design-links" role="switch" aria-checked="${links}">
            <span class="cell__body"><span class="cell__title">Liens en couleur</span>
              <span class="cell__sub">${links ? 'Les liens et les actions prennent aussi cette couleur.' : 'Les liens restent de la couleur du texte, en gras.'}</span></span>
            ${switchHtml(links)}
          </button>
        </div>
${renderAppIconGroup()}
      </div>
    </div>`;
}

registerActions({
  'go-design': () => navigate('settings-design'),
  'set-design': (e, el) => {
    const val = el.dataset.val;
    if (!DESIGN_ACCENTS.includes(val) || val === designAccent(data)) return;
    data.design = { accent: val, at: Date.now(), ...(designLinksColor(data) ? { links: true } : {}) };   // daté : le choix le plus récent gagne (synchro)
    save();
    applyDesign();
    render();
    // Le rendu remplace les boutons : le focus revient sur le choix (VoiceOver annonce « sélectionné »)
    $(`.design-opt[data-val="${val}"]`)?.focus({ preventScroll: true });
  },
  // « Liens en couleur » (27/11) : éteint par défaut, l'accent n'est qu'aux boutons pleins ; allumé, liens et actions en
  // texte reprennent la couleur choisie au-dessus
  'design-links': () => {
    const on = !designLinksColor(data);
    data.design = { accent: designAccent(data), at: Date.now(), ...(on ? { links: true } : {}) };
    save(); haptic('light');
    applyDesign();
    render();
    $('[data-action="design-links"]')?.focus({ preventScroll: true });
  },
});
