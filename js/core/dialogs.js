// ═══════════════════════════════════════════════════════════
//  Annonces, toasts et dialogues natifs façon iOS
// ═══════════════════════════════════════════════════════════
'use strict';

// Annonce VoiceOver / TalkBack via les régions aria-live (#sr-polite, #sr-assert, posées dans index.html)
function announce(msg, assertive = false) {
  const el = document.getElementById(assertive ? 'sr-assert' : 'sr-polite');
  if (!el) return;
  el.textContent = '';
  // vidée puis remplie : un même message répété est annoncé à nouveau
  setTimeout(() => { el.textContent = msg; }, 30);
}

// Ce que le toast ne cache jamais : la série en cours (aria-current="step") et les boutons de sa carte
// (« + Série », « Plus tard » : data-toast-avoid), ni « Reps en réserve » de la série validée (.rir : en haut, il
// cachait son titre sur iPhone SE, panel du 07/11). S'il les couvre, il passe en haut de l'écran.
const TOAST_AVOID = '[data-toast-avoid], [aria-current="step"], .rir';
const TOAST_ACTION_MIN_MS = 6000;   // le temps de lire et de toucher « Annuler » (WCAG 2.2.1)
const TOAST_RESUME_MS = 3000;       // après un toucher ou le focus de VoiceOver qui l'a retenu
let toastPlace = null;              // placement du toast affiché, revu quand une feuille de la séance s'ouvre (placeToast)
function placeToast() { toastPlace?.(); }

function toastCovers(el, avoid = document.querySelectorAll(TOAST_AVOID)) {
  const r = el.getBoundingClientRect();
  return [...avoid].some(a => {
    const b = a.getBoundingClientRect();
    return b.height > 0 && b.bottom > r.top && b.top < r.bottom && b.right > r.left && b.left < r.right;
  });
}

// toast simple, ou avec action : showToast('Import réussi', { action: 'Annuler', onAction, duration: 6000 })
// { error: true } : annoncé en assertif et affiché au moins 4 s. Avec action : 6 s au moins, et retenu tant
// qu'on le touche ou que VoiceOver est dessus (sinon « Annuler » disparaîtrait sous le doigt)
function showToast(msg, opts = {}) {
  const existing = $('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  const duration = Math.max(opts.duration || 2200, opts.error ? 4000 : 0, opts.action ? TOAST_ACTION_MIN_MS : 0);
  announce(opts.action ? `${msg}. ${opts.action} disponible` : msg, !!opts.error);
  el.style.setProperty('--toast-duration', duration + 'ms');
  const text = document.createElement('span');
  text.textContent = msg;
  el.appendChild(text);
  if (opts.action) {
    el.classList.add('toast--action');
    const b = document.createElement('button');
    b.className = 'toast__action';
    b.textContent = opts.action;
    b.addEventListener('click', ev => { ev.stopPropagation(); el.remove(); opts.onAction?.(); });
    el.appendChild(b);
  }
  document.body.appendChild(el);
  // Placement : en bas d'habitude (css/session.css, css/navigation.css) ; en haut s'il cache la série en cours
  // ou les boutons de sa carte, vérifié aussi pendant le défilement qui suit une validation (scrollToCurrent)
  // Revu à chaque défilement dans les deux sens : passé en haut pendant le défilement, il y restait et
  // cachait « Reps en réserve » une fois la série centrée, alors que le bas était redevenu libre (iPhone SE)
  // Feuille de la séance ouverte (Repos, machine…) : la série est cachée dessous ; le toast évite alors les boutons et
  // champs de la feuille : en bas (ligne « Ensuite » de Repos) s'ils sont libres, sinon en haut ; ni sur « Réduire »
  // (iPhone SE, panel Apple du 08/11) ni sur « Arrêter » d'une machine
  const place = () => {
    if (!el.isConnected) return;
    el.classList.remove('toast--top');
    const sheetEl = document.querySelector('.sess-sheet:not(.sess-sheet--out)');
    const covers = () => toastCovers(el, sheetEl ? sheetEl.querySelectorAll('button, input') : undefined);
    let top = false;
    // Feuille : les deux places gênent → en haut, sur l'en-tête de la feuille (« Annuler ») plutôt que sur son action
    // principale, toujours en bas (« Arrêter » d'une machine)
    if (covers()) { el.classList.add('toast--top'); top = sheetEl ? true : !covers(); }
    el.classList.toggle('toast--top', top);
  };
  toastPlace = place;
  place();
  requestAnimationFrame(place);   // écran redessiné juste après le toast (render qui suit la validation)
  // Retiré d'ailleurs (autre toast, dialogue, « Annuler ») : l'écouteur s'en va au défilement suivant
  const onScroll = () => { if (!el.isConnected) window.removeEventListener('scroll', onScroll); else requestAnimationFrame(place); };
  window.addEventListener('scroll', onScroll, { passive: true });
  let timer = 0;
  const close = () => { el.remove(); window.removeEventListener('scroll', onScroll); };
  const arm = ms => { clearTimeout(timer); timer = setTimeout(close, ms); };
  arm(duration);
  if (opts.action) {
    const hold = () => { clearTimeout(timer); el.classList.add('toast--held'); };
    const release = () => {
      if (!el.isConnected) return;
      el.classList.remove('toast--held');
      el.style.setProperty('--toast-duration', TOAST_RESUME_MS + 'ms');
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';   // la disparition repart de zéro
      arm(TOAST_RESUME_MS);
    };
    el.addEventListener('pointerdown', hold);
    el.addEventListener('focusin', hold);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('focusout', release);
  }
}

// Nom du champ d'un dialogue pour VoiceOver (il n'avait ni label ni aria-label) : input.label, sinon le titre,
// et l'unité en toutes lettres (« Riz cuit, en grammes »)
const DIALOG_UNIT_SPOKEN = { g: 'grammes', kg: 'kilos', lbs: 'livres', km: 'kilomètres', min: 'minutes', s: 'secondes', reps: 'répétitions', t: 'tonnes', 'tr/min': 'tours par minute', 'étages': 'étages' };
function dialogInputLabel(input, title = '') {
  const name = String(input?.label || title || 'Valeur').trim(), u = input?.unit;
  return u ? `${name}, en ${DIALOG_UNIT_SPOKEN[u] || u}` : name;
}

// actions : [{ label, value, style: 'default' | 'destructive' | 'cancel' | 'preferred', section, apart }]
// type 'sheet' = feuille d'actions en bas, 'alert' = alerte centrée
// Feuille seulement : section = titre du groupe de choix qui commence là (long menu rangé en sections) ;
// apart = choix posé dans son propre bloc, au-dessus d'« Annuler », hors de la liste qui défile (action destructive)
function dialog({ type = 'alert', title = '', message = '', actions, input = null }) {
  return new Promise(resolve => {
    document.querySelector('.ios-dialog')?.remove();
    // Une alerte prend toute l'attention : un toast encore affiché (action précédente) disparaît
    document.querySelector('.toast')?.remove();
    const root = document.createElement('div');
    root.className = `ios-dialog ios-dialog--${type}`;
    root.setAttribute('role', type === 'sheet' ? 'dialog' : 'alertdialog');
    root.setAttribute('aria-modal', 'true');
    const dlgId = 'dlg-' + uid();
    if (title) root.setAttribute('aria-labelledby', dlgId + '-t');
    if (message) root.setAttribute('aria-describedby', dlgId + '-m');

    const main   = actions.filter(a => a.style !== 'cancel' && !(type === 'sheet' && a.apart));
    const apart  = type === 'sheet' ? actions.filter(a => a.apart && a.style !== 'cancel') : [];
    const cancel = actions.find(a => a.style === 'cancel');
    const btn = a => `<button class="ios-dialog__btn ios-dialog__btn--${a.style || 'default'}" data-i="${actions.indexOf(a)}">${esc(a.label)}</button>`;
    // Titre de section avant le premier choix de chaque section (feuille), annoncé comme un en-tête
    const sectioned = list => list.map((a, i) => (a.section && a.section !== list[i - 1]?.section
      ? `<div class="ios-dialog__sect" role="heading" aria-level="3">${esc(a.section)}</div>` : '') + btn(a)).join('');
    const head = (title || message) ? `
      <div class="ios-dialog__head">
        ${title   ? `<div class="ios-dialog__title" id="${dlgId}-t" tabindex="-1">${esc(title)}</div>` : ''}
        ${message ? `<div class="ios-dialog__msg" id="${dlgId}-m">${esc(message)}</div>` : ''}
        ${input   ? `<div class="ios-dialog__field">
            <input class="ios-dialog__input" ${input.text ? 'type="text" autocomplete="off" autocapitalize="sentences" maxlength="40"'
              : input.decimal ? 'type="text" inputmode="decimal" autocomplete="off"'   // « 70,5 » : la virgule du clavier français
              : 'type="number" inputmode="numeric"'}
                   value="${esc(input.value)}" placeholder="${esc(input.placeholder || '')}" aria-label="${esc(dialogInputLabel(input, title))}">
            ${input.unit ? `<span class="ios-dialog__unit" aria-hidden="true">${esc(input.unit)}</span>` : ''}
          </div>` : ''}
      </div>` : '';

    root.innerHTML = type === 'sheet'
      ? `<div class="ios-dialog__backdrop"></div>
         <div class="ios-dialog__panel">
           <div class="ios-dialog__group">${head}${sectioned(main)}</div>
           ${apart.length ? `<div class="ios-dialog__group">${apart.map(btn).join('')}</div>` : ''}
           ${cancel ? `<div class="ios-dialog__group">${btn(cancel)}</div>` : ''}
         </div>`
      : `<div class="ios-dialog__backdrop"></div>
         <div class="ios-dialog__panel">
           ${head}
           <div class="ios-dialog__row ${actions.length > 2 ? 'ios-dialog__row--stack' : ''}">${actions.map(btn).join('')}</div>
         </div>`;

    const field = root.querySelector('.ios-dialog__input');
    const close = value => {
      if (root._closed) return;
      root._closed = true;
      root.classList.add('ios-dialog--out');
      setTimeout(() => root.remove(), 200);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const pick = a => {
      if (!a || a.style === 'cancel') return close(null);
      close(field ? field.value : a.value);
    };
    const onKey = ev => {
      if (ev.key === 'Escape') close(null);
      if (ev.key === 'Enter' && field) { ev.preventDefault(); pick(main[main.length - 1]); }
    };
    root.addEventListener('click', ev => {
      ev.stopPropagation();
      const b = ev.target.closest('.ios-dialog__btn');
      if (b) { haptic(); return pick(actions[+b.dataset.i]); }
      if (ev.target.classList.contains('ios-dialog__backdrop') && type === 'sheet') close(null);
    });
    root._close = () => close(null); // retour système : vaut « Annuler »
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    // Feuille plus haute que l'écran (menu ⋯ sur iPhone SE) : le bas des choix s'estompe tant qu'il en
    // reste sous le pli, pour dire qu'on peut défiler (panel du 07/11 : dernier choix coupé sans indice)
    const list = type === 'sheet' && root.querySelector('.ios-dialog__group');
    if (list) {
      const more = () => list.classList.toggle('ios-dialog__group--more', list.scrollHeight - list.scrollTop - list.clientHeight > 2);
      list.addEventListener('scroll', more, { passive: true });
      requestAnimationFrame(more);
    }
    // Curseur en fin de texte, jamais de sélection automatique (iOS : un tap doit suffire, sans menu de sélection)
    if (field) setTimeout(() => { field.focus(); try { field.setSelectionRange(field.value.length, field.value.length); } catch { /* type number */ } }, 60);
  });
}

// Dialogues, feuilles et feuilles de séance : tant qu'une est ouverte, le reste de l'app est inerte
// (VoiceOver et clavier restent dans la fenêtre). À la fermeture, le focus revient au déclencheur.
const MODAL_SEL = '.auth, .onb, .ios-dialog, .sheet-root, .sess-sheet, .min-build';
let modalOpener = null;
let modalOpen   = false;
function syncModal() {
  // L'écran « Mets à jour l'app » passe devant tout (z-index) : il reste la fenêtre active même si une feuille s'ouvre après lui
  const top = document.querySelector('.min-build') || [...document.querySelectorAll(MODAL_SEL)].pop();
  const outside = [$('#app'), $('.tabbar'), $('.livebar')].filter(Boolean);
  if (top) {
    if (!modalOpen) { modalOpen = true; modalOpener = document.activeElement; }
    outside.forEach(el => { el.inert = true; });
    if (!top.contains(document.activeElement)) {
      const tgt = top.querySelector('.ios-dialog__title, .sheet__title, .rs__title, .sess-sheet__body [tabindex="-1"], .auth__title, .min-build__title') || top.querySelector('.sess-sheet__panel, .ios-dialog__panel, .sheet');
      if (tgt) { if (!tgt.hasAttribute('tabindex')) tgt.setAttribute('tabindex', '-1'); tgt.focus({ preventScroll: true }); }
    }
  } else if (modalOpen) {
    modalOpen = false;
    outside.forEach(el => { el.inert = false; });
    let o = modalOpener;
    modalOpener = null;
    // Déclencheur redessiné entre-temps : on retrouve son équivalent par son action
    if (o && !o.isConnected && o.dataset?.action) {
      const d = o.dataset;
      o = document.querySelector(`[data-action="${d.action}"]${d.ei ? `[data-ei="${d.ei}"]` : ''}${d.si ? `[data-si="${d.si}"]` : ''}`);
    }
    if (o && o.isConnected && o !== document.body && !document.activeElement?.matches?.('input, textarea')) o.focus?.({ preventScroll: true });
  }
}
new MutationObserver(syncModal).observe(document.body, { childList: true });

function confirmSheet(title, message, label, destructive = true) {
  return dialog({ type: 'sheet', title, message, actions: [
    { label, value: true, style: destructive ? 'destructive' : 'preferred' },
    { label: 'Annuler', style: 'cancel' },
  ] }).then(v => v === true);
}

async function askNumber({ title, message, value, unit, min, max, decimal = false }) {
  const raw = await dialog({ title, message, input: { value, unit, decimal }, actions: [
    { label: 'Annuler', style: 'cancel' },
    { label: 'OK', style: 'preferred' },
  ] });
  if (raw === null || raw === '') return null;
  const v = decimal ? num(raw, -Infinity, Infinity) ?? NaN : parseInt(raw, 10);   // num() accepte la virgule
  if (isNaN(v) || v < min || v > max) { showToast(`Valeur entre ${min} et ${max}`, { error: true }); return null; }
  return v;
}

async function askText({ title, message, value = '', placeholder = '', confirm = 'OK' }) {
  const raw = await dialog({ title, message, input: { value, placeholder, text: true }, actions: [
    { label: 'Annuler', style: 'cancel' },
    { label: confirm, style: 'preferred' },
  ] });
  const v = (raw ?? '').trim();
  return v || null;
}
