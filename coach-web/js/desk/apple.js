// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : « Se connecter avec Apple » (docs/COACH_WEB.md, « Connexion avec Apple »)
//
//  - Sign in with Apple JS (script officiel d'Apple, appleid.cdn-apple.com) en mode usePopup : la fenêtre d'Apple
//    rend un id_token à la page, échangé par supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce }).
//    Aucun secret côté site ni côté Supabase (le secret client Apple, à refaire tous les 6 mois, ne sert qu'au flux
//    OAuth par redirection, pas utilisé ici) : Supabase vérifie la signature du jeton avec les clés publiques d'Apple
//    et son audience (le Services ID doit être dans external_apple_client_id).
//  - Nonce : un nonce brut aléatoire (32 octets, base64url) ; Apple reçoit son SHA-256 (hex) et le met dans le jeton,
//    Supabase reçoit le nonce brut et compare son SHA-256 à celui du jeton (jeton rejoué : refusé). Un nonce et un
//    `state` neufs à chaque essai, préparés AVANT le clic : AppleID.auth.signIn() ouvre la fenêtre et doit partir
//    dans le geste de l'utilisateur, sans attente (Safari bloque sinon la fenêtre).
//  - Le bouton est dessiné par la page (règles d'Apple : logo, « Se connecter avec Apple », noir sur fond clair,
//    blanc sur fond sombre) : celui que dessine le script d'Apple pose des styles en ligne, refusés par la CSP.
//  - Sans le script (bloqueur, réseau, navigateur sans Web Crypto) : le bouton disparaît, l'e-mail reste.
// ═══════════════════════════════════════════════════════════
'use strict';

const DESK_APPLE = Object.freeze({
  script: 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/fr_FR/appleid.auth.js',
  clientId: 'com.mdlf.training.coach',   // Services ID (developer.apple.com), aussi dans external_apple_client_id
  loadMs: 10_000,
  newAccountMs: 5 * 60_000,              // compte créé il y a moins de 5 min : identifiant Apple inconnu de MDLF
});
// state : 'loading' (script ou nonce en préparation), 'ready', 'off' (indisponible : e-mail seulement)
const deskApple = { state: 'loading', pending: null, onChange: () => {} };

async function deskSha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// { raw (pour Supabase), hashed (pour Apple), state } ; neufs à chaque appel
async function deskAppleNonce() {
  const raw = plinkB64u(crypto.getRandomValues(new Uint8Array(32)));
  return { raw, hashed: await deskSha256Hex(raw), state: plinkB64u(crypto.getRandomValues(new Uint8Array(16))) };
}

function deskAppleSet(state) { deskApple.state = state; deskApple.onChange(); }

// Prépare l'essai suivant : nonce neuf, AppleID.auth.init (l'adresse de retour doit être déclarée chez Apple)
async function deskApplePrepare() {
  try {
    const p = await deskAppleNonce();
    window.AppleID.auth.init({ clientId: DESK_APPLE.clientId, redirectURI: location.origin + '/', state: p.state, nonce: p.hashed, usePopup: true });
    deskApple.pending = p;
    deskAppleSet('ready');
  } catch { deskApple.pending = null; deskAppleSet('off'); }
}

// Charge le script d'Apple (une fois, au démarrage) ; tout échec laisse la page sur l'e-mail seul
function deskAppleLoad() {
  if (!window.crypto?.subtle || !window.TextEncoder) { deskAppleSet('off'); return; }
  if (window.AppleID?.auth) { deskApplePrepare(); return; }
  deskPhMarkThirdParty();   // script tiers dans la page : les photos la rechargeront d'abord (js/desk/photo-device.js)
  const s = document.createElement('script');
  const timer = setTimeout(() => { if (deskApple.state === 'loading') deskAppleSet('off'); }, DESK_APPLE.loadMs);
  s.src = DESK_APPLE.script;
  s.async = true;
  s.onload = () => { clearTimeout(timer); if (window.AppleID?.auth) deskApplePrepare(); else deskAppleSet('off'); };
  s.onerror = () => { clearTimeout(timer); deskAppleSet('off'); };
  document.head.appendChild(s);
}

// Erreur d'Apple ({ error }) ou de Supabase : un kind de DESK_APPLE_TEXT, sinon celui de authErrorKind ;
// null : rien à dire (un nouvel essai a remplacé celui-ci)
function deskAppleErrorKind(e) {
  const code = e && typeof e === 'object' ? String(e.error || '') : '';
  if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') return 'apple_cancel';
  if (code === 'popup_blocked_by_browser') return 'apple_blocked';
  if (code === 'user_trigger_new_signin_flow') return null;
  const msg = String(e?.message || '');
  // Services ID absent de external_apple_client_id (« Unacceptable audience in id_token »), ou Apple coupé
  if (/audience/i.test(msg) || e?.code === 'provider_disabled') return 'apple_config';
  return authErrorKind(e) || 'server';
}
const DESK_APPLE_TEXT = {
  apple_cancel: 'Connexion avec Apple annulée. Si la fenêtre d\'Apple affichait une erreur, la connexion avec Apple n\'est pas encore ouverte : reçois un code par e-mail en attendant.',
  apple_blocked: 'Ton navigateur a bloqué la fenêtre d\'Apple. Autorise les fenêtres surgissantes pour ce site, puis réessaie.',
  apple_config: 'La connexion avec Apple n\'est pas encore ouverte sur ce site. Reçois un code par e-mail en attendant.',
};

// Clic sur le bouton : AppleID.auth.signIn() appelé tout de suite (geste de l'utilisateur), puis échange du jeton.
// Rend { ok: true, user, isNew } ou { ok: false, kind } (kind null : rien à afficher)
async function deskAppleSignIn(now = () => Date.now()) {
  const p = deskApple.pending, c = deskClient();
  if (deskApple.state !== 'ready' || !p || !c || !window.AppleID?.auth) return { ok: false, kind: 'server' };
  deskApple.pending = null;
  deskApple.state = 'loading';
  let popup;
  try { popup = window.AppleID.auth.signIn(); } catch (e) { deskApplePrepare(); return { ok: false, kind: deskAppleErrorKind(e) }; }
  try {
    const res = await popup;
    const a = res?.authorization;
    if (!a || typeof a.id_token !== 'string' || !a.id_token || a.state !== p.state) return { ok: false, kind: 'server' };
    const { data, error } = await c.auth.signInWithIdToken({ provider: 'apple', token: a.id_token, nonce: p.raw });
    if (error) return { ok: false, kind: deskAppleErrorKind(error) };
    const user = data?.user || data?.session?.user || null;
    if (!user) return { ok: false, kind: 'server' };
    desk.user = user;
    deskTouch();
    const created = Date.parse(user.created_at || '');
    return { ok: true, user, isNew: Number.isFinite(created) && now() - created < DESK_APPLE.newAccountMs };
  } catch (e) { return { ok: false, kind: deskAppleErrorKind(e) }; }
  finally { deskApplePrepare(); }
}

// Logo Apple (tracé de Sign in with Apple JS) et bouton, noir ou blanc selon le thème (desk.css, .apple-btn)
const DESK_APPLE_LOGO = '<svg class="apple-logo" viewBox="20 16 15.5 19" aria-hidden="true" focusable="false"><path fill="currentColor" d="M28.2226562,20.3846154 C29.0546875,20.3846154 30.0976562,19.8048315 30.71875,19.0317864 C31.28125,18.3312142 31.6914062,17.352829 31.6914062,16.3744437 C31.6914062,16.2415766 31.6796875,16.1087095 31.65625,16 C30.7304687,16.0362365 29.6171875,16.640178 28.9492187,17.4494596 C28.421875,18.06548 27.9414062,19.0317864 27.9414062,20.0222505 C27.9414062,20.1671964 27.9648438,20.3121424 27.9765625,20.3604577 C28.0351562,20.3725366 28.1289062,20.3846154 28.2226562,20.3846154 Z M25.2929688,35 C26.4296875,35 26.9335938,34.214876 28.3515625,34.214876 C29.7929688,34.214876 30.109375,34.9758423 31.375,34.9758423 C32.6171875,34.9758423 33.4492188,33.792117 34.234375,32.6325493 C35.1132812,31.3038779 35.4765625,29.9993643 35.5,29.9389701 C35.4179688,29.9148125 33.0390625,28.9122695 33.0390625,26.0979021 C33.0390625,23.6579784 34.9140625,22.5588048 35.0195312,22.474253 C33.7773438,20.6382708 31.890625,20.5899555 31.375,20.5899555 C29.9804688,20.5899555 28.84375,21.4596313 28.1289062,21.4596313 C27.3554688,21.4596313 26.3359375,20.6382708 25.1289062,20.6382708 C22.8320312,20.6382708 20.5,22.5950413 20.5,26.2911634 C20.5,28.5861411 21.3671875,31.013986 22.4335938,32.5842339 C23.3476562,33.9129053 24.1445312,35 25.2929688,35 Z"/></svg>';
function deskAppleButtonHtml(busy) {
  if (deskApple.state === 'off') return '';
  const off = busy || deskApple.state !== 'ready';
  return `<button type="button" class="apple-btn" id="apple-signin" data-action="apple" ${off ? 'disabled' : ''} ${busy ? 'aria-busy="true"' : ''}>${DESK_APPLE_LOGO}<span>Se connecter avec Apple</span></button>
    <div class="or" role="separator" aria-label="ou"><span aria-hidden="true">ou</span></div>`;
}
