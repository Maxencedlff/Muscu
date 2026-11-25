// ═══════════════════════════════════════════════════════════
//  Mode coach grand écran (iPad, tablettes) : carte de l'onglet Coach et écran hôte (docs/COACH_IPAD.md)
//
//  L'appli web du coach (coach-web/, la même que coach.mdlf.app) est embarquée dans le contenu de l'app
//  (dist/coach/, scripts/embed-coach-web.mjs) et s'ouvre ici, par-dessus l'app, dans un cadre (iframe) de MÊME
//  ORIGINE : jamais chargée depuis le site, l'app reste vivante dessous (séance, repos, minuteries), et le retour
//  est immédiat. Choix et alternatives : docs/COACH_IPAD.md, « Iframe plutôt que navigation ».
//  - Session : celle de l'app (js/data/account.js), envoyée au cadre par message quand il est prêt ; aucun écran de
//    connexion, aucune copie.
//  - Un seul rafraîchisseur des jetons (l'app) : ses jetons neufs partent au cadre, ceux que le cadre a dû
//    renouveler (sortie de veille) reviennent à l'app (coach-embed/bridge-end.js explique pourquoi).
//  - « Revenir à l'appli » toujours visible : celui de l'appli web du coach (barre latérale, barre d'onglets) dès
//    que le cadre dit l'afficher ; sinon (chargement, page en erreur) la barre de l'hôte, en haut.
//  - Sous 678 points (Slide Over, Split View au tiers), le mode ouvert se referme.
//  - Cadre ISOLÉ (sandbox sans allow-same-origin, audit M1) : aucun accès à la fenêtre de l'app ; session et retour
//    par postMessage (coach-embed/bridge-start.js), messages lus seulement s'ils viennent de la fenêtre du cadre.
//  - Photos de bilan : rien pour l'instant (vague 5).
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_DESK_SRC = 'coach/index.html';
const coachDesk = { open: false, root: null, frame: null, unsub: null, opener: null, tokens: null };

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

// Messages du cadre : seulement de SA fenêtre (event.source). Un cadre isolé a l'origine « null » : la source est la
// seule preuve ; l'origine n'est pas lue.
function coachDeskPost(msg) {
  // « * » : un cadre isolé n'a pas d'origine nommable. Il ne peut contenir que nos fichiers : la CSP de l'app
  // (frame-src 'self') refuse toute navigation du cadre vers un autre site.
  try { coachDesk.frame?.contentWindow?.postMessage(msg, '*'); } catch { /* cadre en cours de fermeture */ }
}
function coachDeskMessage(e) {
  if (!coachDesk.open || !coachDesk.frame || e.source !== coachDesk.frame.contentWindow) return;
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'mdlf-coach-ready') coachDeskPost({ type: 'mdlf-coach-session', session: { ...coachDesk.tokens } });
  else if (d.type === 'mdlf-coach-exit') coachDeskClose(d.reason === 'session' ? 'Connexion perdue, réessaie.' : '');
  else if (d.type === 'mdlf-coach-exit-shown') coachDeskBar(d.shown !== true);
  else if (d.type === 'mdlf-coach-tokens') coachDeskFrameTokens(d.tokens);
  else if (d.type === 'mdlf-coach-foods') coachDeskFoods();
}
// Base Ciqual des plans diète (data/foods.json) pour l'éditeur du cadre : un cadre isolé (origine opaque) ne peut pas
// la lire lui-même (requête refusée, CORS) ; l'app, de même origine que ses fichiers, la lit et la lui passe telle quelle
async function coachDeskFoods() {
  let foods = null;
  try { const r = await fetch(FOODS_URL); foods = r.ok ? await r.json() : null; } catch { foods = null; }
  if (coachDesk.open) coachDeskPost({ type: 'mdlf-coach-foods', foods });
}
// Jetons renouvelés dans le cadre : l'app les reprend (gardés dans le Trousseau par supabase-js) seulement s'ils sont
// ceux du même compte (coachDeskSameAccount), et ne les retient que si supabase-js les a acceptés
async function coachDeskFrameTokens(t) {
  const next = coachDeskTokens(t);
  if (!next || !coachDesk.open || next.refresh_token === coachDesk.tokens?.refresh_token) return;
  // Autre compte que celui de l'app : jamais posé ; le cadre est fermé, rien ne change dans l'app
  if (!coachDeskSameAccount(next, account.user?.id)) { coachDeskClose('Connexion perdue, réessaie.'); return; }
  try {
    const { error } = await sb.auth.setSession(next);
    if (!error && coachDesk.open) coachDesk.tokens = next;
  } catch { /* hors ligne : l'app réessaiera au prochain renouvellement */ }
}

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
  coachDesk.tokens = tokens;
  window.addEventListener('message', coachDeskMessage);
  // Jetons renouvelés par l'app : envoyés au cadre
  const sub = sb.auth.onAuthStateChange((event, session) => {
    if (!coachDesk.open) return;
    if (event === 'SIGNED_OUT') { coachDeskClose(); return; }
    const next = coachDeskTokens(session);
    if (!next || next.refresh_token === coachDesk.tokens?.refresh_token) return;
    coachDesk.tokens = next;
    coachDeskPost({ type: 'mdlf-coach-tokens', tokens: next });
  });
  coachDesk.unsub = () => { try { sub?.data?.subscription?.unsubscribe(); } catch { /* rien */ } };

  const root = document.createElement('div');
  root.className = 'coach-desk';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'MDLF Coach, mode grand écran');
  // Cadre isolé (audit M1) : scripts et formulaires seulement, SANS allow-same-origin (origine opaque : ni la fenêtre
  // de l'app, ni Capacitor, ni le coffre des photos, ni son stockage) ; ni fenêtres surgissantes, ni navigation de l'app
  root.innerHTML = `
    <div class="coach-desk__bar" id="coachDeskBar">
      <button type="button" class="coach-desk__back" data-action="coach-desk-close">${icon('chevron.left', 20)}<span>Revenir à l'appli</span></button>
    </div>
    <iframe class="coach-desk__frame" title="MDLF Coach" sandbox="allow-scripts allow-forms" src="${COACH_DESK_SRC}" referrerpolicy="no-referrer"></iframe>`;
  document.body.appendChild(root);
  coachDesk.root = root;
  coachDesk.frame = root.querySelector('iframe');
  const app = $('#app');
  if (app) { app.inert = true; app.setAttribute('aria-hidden', 'true'); }
  document.body.classList.add('coach-desk-on');
  // Barre d'état : celle du thème de l'appli web du coach (elle suit le réglage du système)
  Native.statusBar(window.matchMedia?.('(prefers-color-scheme: dark)').matches !== false);
  coachDesk.frame.focus();
}

// Barre de l'hôte : montrée tant que le cadre ne dit pas afficher son propre « Revenir à l'appli »
// (message 'mdlf-coach-exit-shown' de js/embed/bridge-end.js ; page en erreur ou qui ne répond pas : barre montrée)
function coachDeskBar(show) {
  const bar = coachDesk.root?.querySelector('#coachDeskBar');
  if (bar) bar.hidden = !show;
}

function coachDeskClose(message = '') {
  if (!coachDesk.open) return;
  coachDesk.open = false;
  window.removeEventListener('message', coachDeskMessage);
  coachDesk.unsub?.();
  coachDesk.unsub = null;
  coachDesk.tokens = null;
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
  if (message) showToast(message);
}

// Photos de bilan : pas d'accès depuis le cadre tant que les écrans de photos de coach-web n'existent pas (vague 5,
// audit m3). Le jour venu : demande par message, déchiffrement ici (clé du trousseau après Face ID), octets de l'image
// transférés au cadre (docs/COACH_IPAD.md, « Photos de bilan »).

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
  // Slide Over, Split View au tiers : trop étroit pour l'appli web du coach, le mode se referme
  if (coachDesk.open && (window.innerWidth || 0) < COACH_DESK_MIN_OPEN) coachDeskClose('Agrandis la fenêtre pour le mode grand écran.');
  const now = coachDeskShown();
  if (now === coachDeskWide) return;
  coachDeskWide = now;
  if (typeof refreshCoachCell === 'function') refreshCoachCell();
});
