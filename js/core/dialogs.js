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

// toast simple, ou avec action : showToast('Import réussi', { action: 'Annuler', onAction, duration: 6000 })
// { error: true } : annoncé en assertif et affiché au moins 4 s
function showToast(msg, opts = {}) {
  const existing = $('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  const duration = Math.max(opts.duration || 2200, opts.error ? 4000 : 0);
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
  setTimeout(() => el.remove(), duration);
}

// actions : [{ label, value, style: 'default' | 'destructive' | 'cancel' | 'preferred' }]
// type 'sheet' = feuille d'actions en bas, 'alert' = alerte centrée
function dialog({ type = 'alert', title = '', message = '', actions, input = null }) {
  return new Promise(resolve => {
    document.querySelector('.ios-dialog')?.remove();
    const root = document.createElement('div');
    root.className = `ios-dialog ios-dialog--${type}`;
    root.setAttribute('role', type === 'sheet' ? 'dialog' : 'alertdialog');
    root.setAttribute('aria-modal', 'true');
    const dlgId = 'dlg-' + uid();
    if (title) root.setAttribute('aria-labelledby', dlgId + '-t');
    if (message) root.setAttribute('aria-describedby', dlgId + '-m');

    const main   = actions.filter(a => a.style !== 'cancel');
    const cancel = actions.find(a => a.style === 'cancel');
    const btn = a => `<button class="ios-dialog__btn ios-dialog__btn--${a.style || 'default'}" data-i="${actions.indexOf(a)}">${esc(a.label)}</button>`;
    const head = (title || message) ? `
      <div class="ios-dialog__head">
        ${title   ? `<div class="ios-dialog__title" id="${dlgId}-t" tabindex="-1">${esc(title)}</div>` : ''}
        ${message ? `<div class="ios-dialog__msg" id="${dlgId}-m">${esc(message)}</div>` : ''}
        ${input   ? `<div class="ios-dialog__field">
            <input class="ios-dialog__input" ${input.text ? 'type="text" autocomplete="off" autocapitalize="sentences" maxlength="40"'
              : input.decimal ? 'type="text" inputmode="decimal" autocomplete="off"'   // « 70,5 » : la virgule du clavier français
              : 'type="number" inputmode="numeric"'}
                   value="${esc(input.value)}" placeholder="${esc(input.placeholder || '')}">
            ${input.unit ? `<span class="ios-dialog__unit">${esc(input.unit)}</span>` : ''}
          </div>` : ''}
      </div>` : '';

    root.innerHTML = type === 'sheet'
      ? `<div class="ios-dialog__backdrop"></div>
         <div class="ios-dialog__panel">
           <div class="ios-dialog__group">${head}${main.map(btn).join('')}</div>
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
    if (field) setTimeout(() => { field.focus(); field.select(); }, 60);
  });
}

// Dialogues, feuilles et feuilles de séance : tant qu'une est ouverte, le reste de l'app est inerte
// (VoiceOver et clavier restent dans la fenêtre). À la fermeture, le focus revient au déclencheur.
const MODAL_SEL = '.ios-dialog, .sheet-root, .sess-sheet';
let modalOpener = null;
let modalOpen   = false;
function syncModal() {
  const top = [...document.querySelectorAll(MODAL_SEL)].pop();
  const outside = [$('#app'), $('.tabbar'), $('.livebar')].filter(Boolean);
  if (top) {
    if (!modalOpen) { modalOpen = true; modalOpener = document.activeElement; }
    outside.forEach(el => { el.inert = true; });
    if (!top.contains(document.activeElement)) {
      const tgt = top.querySelector('.ios-dialog__title, .sheet__title, .rs__title, .sess-sheet__body [tabindex="-1"]') || top.querySelector('.sess-sheet__panel, .ios-dialog__panel, .sheet');
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
