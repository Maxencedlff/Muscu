// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : cadre commun des écrans (barre latérale, barre d'onglets, icônes, annonces)
//
//  Tout texte reçu du serveur passe par esc() (js/core/util.js) ; la typographie française (espaces insécables)
//  est posée après chaque rendu par frTypoNode. Rien ne dépend du survol : chaque action est un bouton ou un lien
//  visible, d'au moins 44 px de côté.
// ═══════════════════════════════════════════════════════════
'use strict';

// Icônes au trait (celles de la maquette), décoratives : le libellé vient du texte voisin
const DESK_ICONS = {
  students: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.5" cy="9" r="2.6"/><path d="M15.5 14.2c2.6-.3 4.5 1.4 5 4.3"/>',
  messages: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5z"/>',
  checkins: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 4.5-4 3.5 3 3-2.5 5 4"/>',
  templates: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="m3.5 6.5 1.2 1.2 2-2.2M3.5 12l1.2 1.2 2-2.2M3.5 17.5l1.2 1.2 2-2.2"/>',
  planning: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  programmes: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  diet: '<path d="M7 3v7a2 2 0 0 0 4 0V3M9 12v9M16.5 21V3c-2 1.5-3 4-3 7v3h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9.5 5 7 7-7 7"/>',
  back: '<path d="m14.5 5-7 7 7 7"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3M12 13v4M8.5 20h7M9.5 17h5"/>',
  weight: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9.5a4 4 0 0 1 6 0l-2 2"/>',
  water: '<path d="M12 3.5c3 3.6 5.5 6.8 5.5 10a5.5 5.5 0 0 1-11 0c0-3.2 2.5-6.4 5.5-10z"/>',
  tape: '<path d="m4 15 11-11 5 5L9 20z"/><path d="m8 11 2 2M11 8l2 2M14 5l2 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  signout: '<path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14M10 8l-4 4 4 4M6 12h10"/>',
  check: '<path d="m7 12.5 3.2 3.2L17 9"/>',
  grip: '<circle cx="9" cy="6.5" r="1.1"/><circle cx="15" cy="6.5" r="1.1"/><circle cx="9" cy="12" r="1.1"/><circle cx="15" cy="12" r="1.1"/><circle cx="9" cy="17.5" r="1.1"/><circle cx="15" cy="17.5" r="1.1"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  pen: '<path d="m5 19 1-4L16 5l3 3L9 18z"/>',
  group: '<circle cx="9" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.4"/><path d="M3.5 19c.6-3 2.7-4.6 5.5-4.6s4.9 1.6 5.5 4.6M15 14.6c2.5-.2 4.3 1.3 4.8 4"/>',
  moon: '<path d="M18.5 14.5A7 7 0 0 1 9.5 5.5a7 7 0 1 0 9 9z"/>',
  bolt: '<path d="M13 3 5.5 13H12l-1 8 7.5-10H12z"/>',
  brain: '<path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.5A3 3 0 0 0 9 18.5V4.5zM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.5 3 3 0 0 1-4.5 5.5V4.5z"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7"/>',
  battery: '<rect x="3.5" y="8" width="15" height="8" rx="2"/><path d="M20.5 11v2M6.5 11h4v2h-4z"/>',
  smile: '<circle cx="12" cy="12" r="8"/><path d="M9 14.5c1.6 1.6 4.4 1.6 6 0M9.5 10h.01M14.5 10h.01"/>',
  heart: '<path d="M12 19s-7-4.3-7-9.2A3.8 3.8 0 0 1 12 7.6a3.8 3.8 0 0 1 7 2.2C19 14.7 12 19 12 19z"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  photo: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 4.5-4 3.5 3 3-2.5 5 4"/>',
  steps: '<path d="M8 4c1.8 0 2.5 2.5 2.2 5S8.5 12.5 7 12 5 9.5 5.3 7.5 6.5 4 8 4zM16 9c1.5 0 2.7 2.5 2.4 4.6s-1.6 3.4-3 3-2-2.6-1.7-4.6S14.5 9 16 9zM6.5 14.5l3.2.6-.4 2.6a1.6 1.6 0 0 1-3.2-.6zM14.3 19l3.1.5-.3 1.4a1.6 1.6 0 0 1-3.1-.5z"/>',
  bandage: '<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="M11 11h.01M13 13h.01M13 11h.01M11 13h.01"/>',
};
function deskIcon(name, cls = '') { return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${DESK_ICONS[name] || ''}</svg>`; }

// Navigation : Élèves, Bilans reçus, Mes bilans et Réglages sont ouverts (vagues 1 et 2), le reste est annoncé « bientôt »
const DESK_NAV = [
  { id: 'students', label: 'Élèves', icon: 'students', href: '#/' },
  { id: 'messages', label: 'Messages', icon: 'messages', soon: true },
  { id: 'checkins', label: 'Bilans reçus', short: 'Reçus', icon: 'checkins', href: '#/bilans-recus' },
  { id: 'templates', label: 'Mes bilans', icon: 'templates', href: '#/bilans' },
  { id: 'planning', label: 'Planning', icon: 'planning', soon: true, wide: true },
  { id: 'programmes', label: 'Mes programmes', short: 'Programmes', icon: 'programmes', soon: true },
  { id: 'diet', label: 'Plans diète', icon: 'diet', soon: true, wide: true },
];

function deskNavItem(n, on, { badge = 0, count = null, bar = false } = {}) {
  const label = bar && n.short ? n.short : n.label;
  const extra = n.soon ? '<span class="soon">bientôt</span>' : badge ? `<span class="badge" aria-label="${badge} non lus">${badge}</span>` : count !== null && count !== undefined ? `<span class="count">${count}</span>` : '';
  if (n.soon) return `<button type="button" class="nav-i soon-i${n.wide && bar ? ' wide' : ''}" data-action="soon" data-what="${esc(n.label)}" aria-disabled="true">${deskIcon(n.icon)}<span class="lbl">${esc(label)}</span>${extra}</button>`;
  return `<a class="nav-i${on ? ' on' : ''}" href="${n.href}"${on ? ' aria-current="page"' : ''}>${deskIcon(n.icon)}<span class="lbl">${esc(label)}</span>${extra}</a>`;
}

// Cadre : barre latérale (900 px et plus) ou barre d'onglets en bas (tablette en portrait), puis le contenu
// counts : { checkins (bilans à répondre), templates (modèles) }, null quand le serveur ne les donne pas
function deskFrame({ active, main, students = null, counts = null }) {
  const cnt = { students, checkins: counts?.checkins ?? null, templates: counts?.templates ?? null };
  const items = DESK_NAV.map(n => deskNavItem(n, n.id === active, { count: cnt[n.id] ?? null })).join('');
  const barItems = DESK_NAV.filter(n => !n.wide).map(n => deskNavItem(n, n.id === active, { bar: true })).join('')
    + `<a class="nav-i${active === 'settings' ? ' on' : ''}" href="#/reglages"${active === 'settings' ? ' aria-current="page"' : ''}>${deskIcon('settings')}<span class="lbl">Réglages</span></a>`;
  return `<div class="app">
  <aside class="side" aria-label="Navigation">
    <div class="brand">MDLF <span>Coach</span></div>
    <nav class="nav" aria-label="Rubriques">${items}</nav>
    <nav class="nav foot" aria-label="Compte">
      <a class="nav-i${active === 'settings' ? ' on' : ''}" href="#/reglages"${active === 'settings' ? ' aria-current="page"' : ''}>${deskIcon('settings')}<span class="lbl">Réglages</span></a>
    </nav>
  </aside>
  <main class="main" id="main" tabindex="-1">${main}</main>
  <nav class="tabbar" aria-label="Rubriques">${barItems}</nav>
</div>`;
}

// Annonce pour les lecteurs d'écran (zone aria-live d'index.html) et bandeau bref à l'écran
let deskToastTimer = 0;
function deskToast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(deskToastTimer);
  deskToastTimer = setTimeout(() => { el.hidden = true; el.textContent = ''; }, 3200);
}

// Confirmation (supprimer, quitter avec des changements) : dialogue modal hors de #app (jamais effacé par un rendu),
// focus sur « Annuler », Échap annule. Rend une promesse : true si confirmé.
function deskConfirm({ title, text = '', ok = 'Confirmer', danger = false }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm';
    dlg.setAttribute('aria-labelledby', 'cf-title');
    dlg.innerHTML = `<h2 id="cf-title" class="dlg-t">${esc(title)}</h2>${text ? `<p class="dlg-p">${esc(text)}</p>` : ''}
      <div class="dlg-f"><button type="button" class="btn" data-cf="no">Annuler</button><button type="button" class="btn ${danger ? 'danger' : 'tint'}" data-cf="yes">${esc(ok)}</button></div>`;
    frTypoNode(dlg);
    document.body.appendChild(dlg);
    let answer = false;
    dlg.addEventListener('click', e => { const b = e.target.closest('[data-cf]'); if (b) { answer = b.dataset.cf === 'yes'; dlg.close(); } });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
    dlg.showModal();
    dlg.querySelector('[data-cf="no"]').focus();
  });
}
// Annonce aux lecteurs d'écran seulement (zone aria-live d'index.html), sans bandeau
function deskAnnounce(text) {
  const el = document.getElementById('live');
  if (!el) return;
  // Même phrase deux fois de suite : une espace insécable en plus, pour qu'elle soit relue
  el.textContent = el.textContent === text ? `${text}\u00a0` : text;
}
