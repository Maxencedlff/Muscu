// ═══════════════════════════════════════════════════════════
//  Mode coach grand écran (iPad, tablettes) : carte de l'onglet Coach et écran hôte (docs/COACH_IPAD.md)
//
//  L'appli web du coach (coach-web/, la même que coach.mdlf.app) est embarquée dans le contenu de l'app
//  (dist/coach/, scripts/embed-coach-web.mjs) et s'ouvre ici, par-dessus l'app, dans un cadre (iframe) de MÊME
//  ORIGINE : jamais chargée depuis le site, l'app reste vivante dessous (séance, repos, minuteries), et le retour
//  est immédiat. Choix et alternatives : docs/COACH_IPAD.md, « Iframe plutôt que navigation ».
//  - Session : celle de l'app (js/data/account.js), passée au cadre par window.MDLF_COACH_PARENT, lu par le
//    premier script de la page (coach-embed/bridge-start.js) ; aucun écran de connexion, aucune copie.
//  - Un seul rafraîchisseur des jetons (l'app) : ses jetons neufs sont posés dans le cadre, ceux que le cadre a dû
//    renouveler (sortie de veille) reviennent à l'app (coach-embed/bridge-end.js explique pourquoi).
//  - « Revenir à l'appli » toujours visible : celui de l'appli web du coach (barre latérale, barre d'onglets) dès
//    qu'il est à l'écran ; sinon (chargement, page en erreur, version sans ce bouton) la barre de l'hôte, en haut.
//  - Photos de bilan : point d'accroche `photos` (déchiffrées ici, la clé privée ne quitte jamais l'app).
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_DESK_SRC = 'coach/index.html';
const coachDesk = { open: false, root: null, frame: null, observer: null, unsub: null, opener: null, urls: new Set() };

function coachDeskShown() {
  return !!(account.user && coachRole().isCoach) && coachDeskEligible({
    native: Native.isNative, platform: Native.platform, ua: navigator.userAgent || '',
    touchPoints: navigator.maxTouchPoints || 0, width: window.innerWidth || 0,
  });
}

// En tête de Mes élèves (segment Élèves de l'onglet Coach) : carte au premier passage, ligne ensuite, rien si masqué
function coachDeskCardHtml() {
  if (!coachDeskShown()) return '';
  const pref = coachDeskPref();
  if (pref === 'hidden') return '';
  if (pref === 'used') return `
        <div class="group coach-desk-card">
          <button class="cell cell--nav" data-action="coach-desk-open">
            ${icon('arrow.up.left.and.arrow.down.right', 20)}
            <span class="cell__body"><span class="cell__title">Mode grand écran</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>`;
  return `
        <div class="group-title">Grand écran</div>
        <div class="group coach-desk-card">
          <div class="cell coach-desk-card__intro">
            ${icon('arrow.up.left.and.arrow.down.right', 20)}
            <span class="cell__body"><span class="cell__title">Tes élèves sur tout l'écran</span><span class="cell__sub">Le tableau de tes élèves, leurs semaines et leurs bilans, comme sur coach.mdlf.app. Tu restes connecté.</span></span>
          </div>
          <button class="cell cell--action" data-action="coach-desk-open"><span class="cell__title">Ouvrir le mode grand écran</span></button>
          <button class="cell cell--action coach-desk-card__hide" data-action="coach-desk-hide"><span class="cell__title">Masquer</span></button>
        </div>
        <div class="group-foot">« Revenir à l'appli » te ramène ici. Le mode grand écran reste dans Réglages › Coach.</div>`;
}

// Réglages › Coach (« Tu es coach ») : toujours là sur grand écran, même masqué de l'onglet
function coachDeskSettingsCell() {
  if (!coachDeskShown()) return '';
  return `
          <button class="cell cell--nav" data-action="coach-desk-open">
            <span class="cell__body"><span class="cell__title">Mode grand écran</span><span class="cell__sub">Tes élèves sur tout l'écran</span></span>
            ${icon('chevron.right', 16)}
          </button>`;
}

// ── Écran hôte ──────────────────────────────────────────────

async function coachDeskOpen(opener = null) {
  if (coachDesk.open || !coachDeskShown() || !sb) return;
  if (navigator.onLine === false) { showToast('Pas d\'Internet : le mode grand écran a besoin du réseau.'); return; }
  let tokens = null;
  try {
    // getSession renouvelle les jetons s'ils ont expiré (app restée longtemps en arrière-plan)
    const { data } = await sb.auth.getSession();
    tokens = coachDeskTokens(data?.session);
  } catch { tokens = null; }
  if (!tokens) { showToast('Session à rouvrir : reconnecte-toi dans Réglages › Compte.'); return; }
  if (coachDesk.open) return;
  if (coachDeskPref() === '') coachDeskSetPref('used');

  coachDesk.open = true;
  coachDesk.opener = opener;
  let current = tokens;
  window.MDLF_COACH_PARENT = Object.freeze({
    session: () => ({ ...current }),
    exit: () => coachDeskClose(),
    // Jetons renouvelés par le cadre : l'app les reprend (gardés dans le Trousseau par supabase-js)
    onSession: t => {
      const next = coachDeskTokens(t);
      if (!next || !coachDesk.open || next.refresh_token === current.refresh_token) return;
      current = next;
      sb.auth.setSession(next).catch(() => { /* hors ligne : l'app réessaiera au prochain renouvellement */ });
    },
    photos: coachDeskPhotos,
  });
  // Jetons renouvelés par l'app : posés dans le cadre
  const sub = sb.auth.onAuthStateChange((event, session) => {
    if (!coachDesk.open) return;
    if (event === 'SIGNED_OUT') { coachDeskClose(); return; }
    const next = coachDeskTokens(session);
    if (!next || next.refresh_token === current.refresh_token) return;
    current = next;
    try { coachDesk.frame?.contentWindow?.MDLF_COACH_EMBED?.setSession(next); } catch { /* cadre en cours de fermeture */ }
  });
  coachDesk.unsub = () => { try { sub?.data?.subscription?.unsubscribe(); } catch { /* rien */ } };

  const root = document.createElement('div');
  root.className = 'coach-desk';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'MDLF Coach, mode grand écran');
  root.innerHTML = `
    <div class="coach-desk__bar" id="coachDeskBar">
      <button type="button" class="coach-desk__back" data-action="coach-desk-close">${icon('chevron.left', 20)}<span>Revenir à l'appli</span></button>
    </div>
    <iframe class="coach-desk__frame" title="MDLF Coach" src="${COACH_DESK_SRC}" referrerpolicy="no-referrer"></iframe>`;
  document.body.appendChild(root);
  coachDesk.root = root;
  coachDesk.frame = root.querySelector('iframe');
  const app = $('#app');
  if (app) { app.inert = true; app.setAttribute('aria-hidden', 'true'); }
  document.body.classList.add('coach-desk-on');
  // Barre d'état : celle du thème de l'appli web du coach (elle suit le réglage du système)
  Native.statusBar(window.matchMedia?.('(prefers-color-scheme: dark)').matches !== false);
  coachDesk.frame.addEventListener('load', coachDeskWatch);
  coachDesk.frame.focus();
}

// Barre de l'hôte montrée tant que l'appli web n'affiche pas son propre « Revenir à l'appli »
function coachDeskWatch() {
  coachDesk.observer?.disconnect();
  coachDesk.observer = null;
  let doc = null;
  try { doc = coachDesk.frame?.contentDocument; } catch { doc = null; }
  const update = () => coachDeskBar(!coachDeskOwnExit(doc));
  update();
  if (!doc?.body || typeof MutationObserver !== 'function') return;
  coachDesk.observer = new MutationObserver(update);
  coachDesk.observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  coachDesk.frame.contentWindow?.addEventListener('resize', update);
}
// Bouton « Revenir à l'appli » de l'appli web du coach (data-action="host-exit", docs/COACH_WEB.md) visible à l'écran
function coachDeskOwnExit(doc) {
  if (!doc) return false;
  const win = doc.defaultView;
  return [...doc.querySelectorAll('[data-action="host-exit"]')].some(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < (win?.innerHeight || 0) && r.left < (win?.innerWidth || 0)
      && win?.getComputedStyle(el).visibility !== 'hidden';
  });
}
function coachDeskBar(show) {
  const bar = coachDesk.root?.querySelector('#coachDeskBar');
  if (bar) bar.hidden = !show;
}

function coachDeskClose() {
  if (!coachDesk.open) return;
  coachDesk.open = false;
  coachDesk.observer?.disconnect();
  coachDesk.observer = null;
  coachDesk.unsub?.();
  coachDesk.unsub = null;
  coachDeskPhotosRelease();
  try { delete window.MDLF_COACH_PARENT; } catch { window.MDLF_COACH_PARENT = undefined; }
  // Le cadre est vidé avant d'être retiré : ses minuteries et ses requêtes s'arrêtent avec lui
  try { coachDesk.frame?.setAttribute('src', 'about:blank'); } catch { /* rien */ }
  coachDesk.root?.remove();
  coachDesk.root = coachDesk.frame = null;
  const app = $('#app');
  if (app) { app.inert = false; app.removeAttribute('aria-hidden'); }
  document.body.classList.remove('coach-desk-on');
  applyTheme(themePref());
  // Ce qui a changé là-bas (messages lus, bilans répondus) : relu ici
  coachRefresh();
  const back = coachDesk.opener?.isConnected ? coachDesk.opener : $('[data-action="coach-desk-open"]');
  coachDesk.opener = null;
  back?.focus?.();
}

// ── Photos de bilan : point d'accroche (docs/COACH_IPAD.md, « Photos de bilan ») ──
// Les écrans de photos de l'appli web n'existent pas encore (vague 5). Le jour venu, ils passeront par
// window.MDLF_COACH_HOST.photos : la clé privée du coach reste dans l'app (secret du trousseau après Face ID,
// js/data/coach-photos.js) ; le cadre ne reçoit que des adresses blob: d'images déjà déchiffrées, libérées à la
// fermeture des photos (une minute sans toucher, cphLock) ou du mode grand écran.
const coachDeskPhotos = Object.freeze({
  available: () => cphCoachShown() && !!cphCoach.key,
  isOpen: () => cphIsOpen(),
  // Face ID (dans l'app) ; { ok } ou { missing } / { mismatch } / { refused }
  unlock: async () => {
    const r = await cphCoachUnlock();
    return { ok: !!r?.ok, missing: !!r?.missing, mismatch: !!r?.mismatch, refused: !r?.ok && !r?.missing && !r?.mismatch };
  },
  // Photos d'un élève : métadonnées seulement (rien de déchiffré)
  list: async student => {
    const r = await cphCoachLoad(student);
    if (!r?.ok) return { ok: false, kind: r?.kind || 'server' };
    return { ok: true, photos: cphStudentOf(student).photos.map(p => ({ id: p.id, takenOn: p.takenOn, pose: p.pose })) };
  },
  // Une photo déchiffrée : adresse blob: (null si fermé ou illisible)
  open: async (student, id) => {
    if (!coachDesk.open || !cphIsOpen()) return null;
    cphTouch();
    const p = cphStudentOf(student).photos.find(x => x.id === id);
    const blob = p ? await cphCoachFetch(student, p) : null;
    if (!blob || !coachDesk.open) return null;
    const url = URL.createObjectURL(blob);
    coachDesk.urls.add(url);
    return url;
  },
  release: url => { if (coachDesk.urls.delete(url)) URL.revokeObjectURL(url); },
  touch: () => cphTouch(),
  lock: () => { cphLock('manual'); },
});
function coachDeskPhotosRelease() {
  coachDesk.urls.forEach(u => URL.revokeObjectURL(u));
  coachDesk.urls.clear();
}
onCphLock(() => coachDeskPhotosRelease());

registerActions({
  'coach-desk-open': (e, el) => coachDeskOpen(el),
  'coach-desk-close': () => coachDeskClose(),
  'coach-desk-hide': () => {
    coachDeskSetPref('hidden');
    refreshCoachCell();
    showToast('Masqué. Le mode grand écran reste dans Réglages › Coach.');
  },
});

// Fenêtre redimensionnée (Split View, rotation) : la carte suit la largeur ; le mode ouvert reste ouvert
let coachDeskWide = null;
window.addEventListener('resize', () => {
  const now = coachDeskShown();
  if (now === coachDeskWide) return;
  coachDeskWide = now;
  if (typeof refreshCoachCell === 'function') refreshCoachCell();
});
