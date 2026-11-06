// Contrôles simples exécutés dans la page après chaque étape (capture_parcours.py).
// Complètent ux.js de verif-ui (zones de toucher, textes coupés « … », icônes, axe) quand il est
// disponible, et le remplacent sinon (avecUx = false : zones de toucher et textes coupés faits ici).
// Rend { constats: [texte], ecran: { vue, hash, calque, feuille, dialogue } }.
({ cibleMini, policeMini, exemples, avecUx }) => {
  const constats = [];
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0 && !el.closest('[aria-hidden=true],[inert]');
  };
  const nom = el => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const c = el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${c}${t ? ` « ${t} »` : ''}`;
  };
  const resume = (titre, liste) => {
    liste = [...new Set(liste)];
    if (!liste.length) return;
    const suite = liste.length > exemples ? ` … et ${liste.length - exemples} autre(s)` : '';
    constats.push(`${titre} (${liste.length}) : ${liste.slice(0, exemples).join(' ; ')}${suite}`);
  };
  const CLIQUABLES = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=switch],[role=tab],[data-action]';
  const cliquables = [...document.querySelectorAll(CLIQUABLES)]
    .filter(el => visible(el) && !el.disabled && !el.parentElement?.closest(CLIQUABLES));

  // 1. Débordement horizontal de la page
  const large = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (large > innerWidth + 1) constats.push(`débordement horizontal : page de ${large} px pour un écran de ${innerWidth} px`);

  // 2. Police sous le seuil (texte visible uniquement)
  const petits = [];
  for (const el of document.body.querySelectorAll('*')) {
    // Barre d'onglets exclue : 10 pt est la taille standard d'iOS pour ses libellés
    if (!visible(el) || el.matches('svg, svg *, script, style') || el.closest('.tabbar')) continue;
    const texte = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    if (!texte) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < policeMini) petits.push(`« ${texte.slice(0, 30)} » ${fs.toFixed(1)} px`);
  }
  resume(`police sous ${policeMini} px`, petits);

  // 3. Élément touchable fixe (barre de saisie, bouton collé en bas…) recouvert par la barre d'onglets.
  //    Le contenu qui défile sous la barre est normal ; la fin d'écran est vérifiée à part (DERNIER_JS).
  const bar = document.querySelector('.tabbar');
  const fixe = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  if (bar && visible(bar)) {
    const b = bar.getBoundingClientRect();
    const sous = [];
    for (const el of cliquables) {
      if (bar.contains(el) || !fixe(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= b.top + 1 || r.top >= b.bottom) continue;
      const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), y = Math.min(r.top + r.height / 2, innerHeight - 1);
      const dessus = document.elementFromPoint(x, y);
      if (dessus && bar.contains(dessus)) sous.push(nom(el));
    }
    resume("touchable caché sous la barre d'onglets", sous);
  }

  // 4. Sans ux.js : zones de toucher et textes coupés, version simple
  if (!avecUx) {
    const petites = cliquables.filter(el => { const r = el.getBoundingClientRect(); return r.width < cibleMini || r.height < cibleMini; })
      .map(el => { const r = el.getBoundingClientRect(); return `${nom(el)} ${Math.round(r.width)}×${Math.round(r.height)}`; });
    resume(`zones de toucher sous ${cibleMini}×${cibleMini} px`, petites);
  }
  // Textes plus larges que leur boîte (feuilles du DOM, hors champs) : couvre aussi les coupes sans « … »
  const coupes = [...document.body.querySelectorAll('*')].filter(e => e.children.length === 0 && visible(e)
      && e.textContent.trim() && !e.matches('input, textarea, select, svg, svg *, .visually-hidden') && getComputedStyle(e).display !== 'inline'
      && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible')
    .map(e => `« ${e.textContent.trim().slice(0, 40)} »`);
  resume('textes coupés (plus larges que leur boîte)', coupes);

  // Écran affiché : route de l'app, calque plein écran, feuille ou dialogue ouverts
  const lbl = el => el ? (el.getAttribute('aria-label') || el.querySelector('h1,h2,.ios-dialog__title,.sheet__title,.ax__title')?.textContent || '').trim().slice(0, 50) : '';
  const feuille = document.querySelector('.sess-sheet:not(.sess-sheet--out), .sheet-root:not(.sheet-root--out)');
  const dialogue = document.querySelector('.ios-dialog:not(.ios-dialog--out)');
  const calque = document.querySelector('.auth') ? 'Bienvenue / compte' : document.querySelector('.onb') ? 'Questions du premier lancement' : '';
  let vue = '';
  try { vue = window.view || ''; } catch {}
  return { constats, ecran: { vue, hash: location.hash, calque, feuille: lbl(feuille), dialogue: dialogue ? (lbl(dialogue) || 'dialogue') : '' } };
}
