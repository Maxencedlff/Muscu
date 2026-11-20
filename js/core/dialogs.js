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

// ── Toast : une seule place, rien dessous ───────────────────
// Règle (docs/ERGONOMIE.md §4, panels de la vague 3) : en séance, ce qui s'annule l'est en ligne, à sa place
// (sessionUndo, js/features/session.js) ; il ne reste ici que des messages. Le toast a UNE place, en bas, au-dessus de la
// barre d'onglets, de la mini-barre de séance ou du repos (css/navigation.css, css/session.css), fond opaque. Le temps
// qu'il est là, la page garde sous son contenu la hauteur du toast (classe has-toast, --toast-room) : on peut toujours
// faire défiler la fin de la page au-dessus de lui. Il part au changement d'écran.
const TOAST_ACTION_MIN_MS = 6000;   // le temps de lire et de toucher « Annuler » (WCAG 2.2.1)
const TOAST_RESUME_MS = 3000;       // après un toucher ou le focus de VoiceOver qui l'a retenu
// Changement d'écran (js/ui/router.js) : le toast ne suit pas sur l'écran suivant. Celui qui naît pendant la navigation
// même (supprimer puis revenir en arrière) est gardé : moins de 800 ms.
function dropScreenToast() {
  document.querySelectorAll('.toast').forEach(t => { if (Date.now() - Number(t.dataset.at || 0) > 800) removeToast(t); });
}
function removeToast(el) {
  el?.remove();
  if (!document.querySelector('.toast')) { document.body.classList.remove('has-toast'); document.body.style.removeProperty('--toast-room'); }
}

// toast simple, ou avec action : showToast('Import réussi', { action: 'Annuler', onAction, duration: 6000 })
// { error: true } : annoncé en assertif et affiché au moins 4 s. Avec action : 6 s au moins, et retenu tant
// qu'on le touche ou que VoiceOver est dessus (sinon « Annuler » disparaîtrait sous le doigt)
function showToast(msg, opts = {}) {
  // En séance (hors feuille) : jamais de toast flottant, la confirmation en ligne (sessionNotice, js/features/session.js)
  if (typeof sessionNotice === 'function' && sessionNotice(msg, opts)) return;
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = opts.error ? 'toast toast--error' : 'toast';
  el.dataset.at = String(Date.now());
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
    b.addEventListener('click', ev => { ev.stopPropagation(); removeToast(el); opts.onAction?.(); });
    el.appendChild(b);
  }
  document.body.appendChild(el);
  document.body.style.setProperty('--toast-room', `${Math.ceil(el.offsetHeight) + 16}px`);
  document.body.classList.add('has-toast');
  let timer = 0;
  const close = () => removeToast(el);
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
// input : { value, placeholder, text | digits | decimal, max (longueur d'un texte, 40 par défaut), unit, label }
// type 'sheet' = feuille d'actions en bas, 'alert' = alerte centrée
// Feuille seulement : section = titre du groupe de choix qui commence là (long menu rangé en sections) ; group = groupe
// séparé du précédent par une bande, sans titre (menu court) ;
// apart = choix posé dans son propre bloc, au-dessus d'« Annuler », hors de la liste qui défile (action destructive)
// messageXl : explication plus courte en texte très grand (AX33 : la longue ne tenait pas, coupée au milieu d'une ligne)
function dialog({ type = 'alert', title = '', message = '', messageXl = '', actions, input = null }) {
  if (messageXl && document.documentElement.classList.contains('type-xl')) message = messageXl;
  return new Promise(resolve => {
    document.querySelector('.ios-dialog')?.remove();
    // Une alerte prend toute l'attention : un toast encore affiché (action précédente) disparaît
    removeToast(document.querySelector('.toast'));
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
      ? `<div class="ios-dialog__sect" role="heading" aria-level="3">${esc(a.section)}</div>`
      : i && a.group && a.group !== list[i - 1]?.group ? '<div class="ios-dialog__band" aria-hidden="true"></div>' : '') + btn(a)).join('');
    const head = (title || message) ? `
      <div class="ios-dialog__head">
        <div class="ios-dialog__text">
        ${title   ? `<div class="ios-dialog__title" id="${dlgId}-t" tabindex="-1">${esc(title)}</div>` : ''}
        ${message ? `<div class="ios-dialog__msg" id="${dlgId}-m">${esc(message)}</div>` : ''}
        </div>
        ${input   ? `<div class="ios-dialog__field">
            <input class="ios-dialog__input" ${input.digits ? 'type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="20"'   // code-barres : zéros de tête gardés
              : input.text ? `type="text" autocomplete="off" autocapitalize="sentences" maxlength="${input.max || 40}"`
              : input.decimal ? 'type="text" inputmode="decimal" autocomplete="off" maxlength="12"'   // « 70,5 » : la virgule du clavier français
              // Entier : jamais type="number" (« 175,5 » y devient vide, donc effacé ; « 1e3 » y passe) ; num() juge
              : 'type="text" inputmode="numeric" autocomplete="off" maxlength="12"'}
                   value="${esc(input.value)}" placeholder="${esc(input.placeholder || '')}" aria-label="${esc(dialogInputLabel(input, title))}">
            ${input.unit ? `<span class="ios-dialog__unit" aria-hidden="true">${esc(input.unit)}</span>` : ''}
          </div>
          <p class="ios-dialog__err" id="${dlgId}-e" role="alert" hidden></p>` : ''}
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
    // Valeur refusée (input.validate rend un message) : la fenêtre reste ouverte avec ce qui a été tapé, le champ
    // entouré de rouge et le message dessous (panel du 20/11 : refermer et dire l'erreur en toast faisait tout retaper)
    const err = root.querySelector('.ios-dialog__err');
    const showErr = msg => {
      err.textContent = msg; err.hidden = !msg;
      field.closest('.ios-dialog__field').classList.toggle('ios-dialog__field--error', !!msg);
      if (msg) { field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', err.id); field.focus(); haptic('medium'); }
      else { field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby'); }
    };
    field?.addEventListener('input', () => { if (!err.hidden) showErr(''); });
    const pick = a => {
      if (!a || a.style === 'cancel') return close(null);
      if (field && a.value === undefined && typeof input.validate === 'function') {
        const msg = input.validate(field.value);
        if (msg) return showErr(msg);
      }
      // Avec un champ, le choix rend le texte saisi ; un choix qui porte sa propre valeur (« Effacer ») la rend
      close(field && a.value === undefined ? field.value : a.value);
    };
    const onKey = ev => {
      if (ev.key === 'Escape') close(null);
      if (ev.key === 'Enter' && field) { ev.preventDefault(); pick(main.find(a => a.style === 'preferred') || main[main.length - 1]); }
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
    // Alerte à deux boutons dont un libellé passe sur deux lignes (« J'ai 18 ans ou plus » sur iPhone SE) : boutons
    // empilés, comme iOS, « Annuler » / le refus en bas (panels de la vague 3)
    const row = type !== 'sheet' && root.querySelector('.ios-dialog__row:not(.ios-dialog__row--stack)');
    if (row && [...row.children].some(b => b.scrollWidth > b.clientWidth + 1 || b.offsetHeight > 50)) row.classList.add('ios-dialog__row--stack', 'ios-dialog__row--wrapped');
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

// num() : virgule acceptée, et rien d'autre qu'un nombre écrit simplement (parseInt lisait « 1e3 » 1 et « 60abc » 60).
// Refus dit sous le champ, fenêtre ouverte (input.validate) ; label : nom du champ dans le message (le titre sinon)
async function askNumber({ title, message, messageXl, value, unit, min, max, decimal = false, label = title }) {
  const ok = raw => String(raw).trim() === '' || num(raw, min, max, !decimal) !== null;
  const raw = await dialog({ title, message, messageXl, input: { value, unit, decimal,
    validate: raw => (ok(raw) ? null : fieldNumMsg(label, min, max, !decimal, unit)) }, actions: [
    { label: 'Annuler', style: 'cancel' },
    { label: 'OK', style: 'preferred' },
  ] });
  if (raw === null || String(raw).trim() === '') return null;
  return num(raw, min, max, !decimal);
}

// max : longueur du champ (40 par défaut, celle du dialogue). Espaces et caractères invisibles seuls : null (rien saisi)
// validate : message d'un texte refusé, dit sous le champ sans fermer la fenêtre (null : accepté)
async function askText({ title, message, value = '', placeholder = '', confirm = 'OK', max, validate }) {
  const raw = await dialog({ title, message, input: { value, placeholder, text: true, max, validate }, actions: [
    { label: 'Annuler', style: 'cancel' },
    { label: confirm, style: 'preferred' },
  ] });
  const v = (raw ?? '').trim();
  return v && hasVisible(v) ? v : null;
}
