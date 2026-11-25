// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : « Se connecter avec Google » (docs/COACH_WEB.md, « Connexion avec Google »)
//
//  Méthode : flux OAuth de Supabase avec PKCE, par redirection (supabase.auth.signInWithOAuth, puis
//  exchangeCodeForSession au retour). Pourquoi pas Google Identity Services (script de Google + signInWithIdToken,
//  comme Apple) : essayé le 27/11/2026, son script pose des styles en ligne que la CSP du site refuse (style-src 'self'),
//  demande un cadre de Google (frame-src) et des connexions vers Google ; et ce serait un script tiers de plus dans la
//  page qui tient la clé des photos. La redirection ne charge rien de Google dans la page : la CSP ne change pas.
//  - PKCE : supabase-js tire le vérificateur (gardé le temps de l'aller-retour dans le stockage de la session, effacé à
//    l'échange) ; le code rendu dans l'adresse ne sert qu'une fois et seulement avec ce vérificateur.
//  - Côté Supabase : le secret du client Web Google est déjà réglé (external_google_secret, vérifié le 27/11/2026, sans
//    rien modifier) ; il manque l'adresse de retour du site dans « Redirect URLs » (uri_allow_list, vide aujourd'hui) :
//    sans elle, Supabase renvoie sur site_url (https://mdlf.app) et le site dit « pas encore ouverte ».
//  - Seul un coach validé entre ensuite (coach_state), comme pour l'e-mail et Apple. Identifiant Google inconnu :
//    Supabase crée un compte vide (écran « Réservé aux coachs ») ; une adresse Google déjà vérifiée sur un compte MDLF
//    est rattachée à ce compte par Supabase.
//  - Bouton dessiné par la page selon les règles de Google (logo « G » en couleurs, « Se connecter avec Google »).
// ═══════════════════════════════════════════════════════════
'use strict';

const deskGoogle = { busy: false };

// Aller : Supabase, puis Google, puis retour sur cette page avec ?code=…
async function deskGoogleStart() {
  const c = deskClient();
  if (!c || deskGoogle.busy) return { ok: false, kind: 'server' };
  deskGoogle.busy = true;
  try {
    const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/`, queryParams: { prompt: 'select_account' } } });
    if (error) { deskGoogle.busy = false; return { ok: false, kind: deskGoogleErrorKind(error) }; }
    return { ok: true };   // la page part chez Google
  } catch (e) { deskGoogle.busy = false; return { ok: false, kind: deskGoogleErrorKind(e) }; }
}

// Retour de Google : ?code=… (ou ?error=…) dans l'adresse. Rend null (rien à faire), { ok: true, user, isNew } ou
// { ok: false, kind }. L'adresse est nettoyée dans tous les cas (le code ne reste ni dans l'historique ni à l'écran).
async function deskGoogleReturn(now = () => Date.now()) {
  let q;
  try { q = new URLSearchParams(location.search); } catch { return null; }
  const code = q.get('code'), error = q.get('error');
  if (!code && !error) return null;
  try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* adresse laissée */ }
  if (error) return { ok: false, kind: error === 'access_denied' ? 'google_cancel' : 'google_config' };
  const c = deskClient();
  if (!c || !/^[A-Za-z0-9._~-]{8,512}$/.test(code)) return { ok: false, kind: 'server' };
  try {
    const { data, error: e } = await c.auth.exchangeCodeForSession(code);
    if (e) return { ok: false, kind: deskGoogleErrorKind(e) };
    const user = data?.user || data?.session?.user || null;
    if (!user) return { ok: false, kind: 'server' };
    desk.user = user;
    deskTouch();
    const created = Date.parse(user.created_at || '');
    return { ok: true, user, isNew: Number.isFinite(created) && now() - created < DESK_APPLE.newAccountMs };
  } catch (e) { return { ok: false, kind: deskGoogleErrorKind(e) }; }
}

function deskGoogleErrorKind(e) {
  const msg = String(e?.message || ''), code = String(e?.code || '');
  if (code === 'provider_disabled' || /provider is not enabled|redirect/i.test(msg)) return 'google_config';
  if (code === 'flow_state_not_found' || code === 'flow_state_expired' || /code verifier|flow state/i.test(msg)) return 'google_expired';
  return authErrorKind(e) || 'server';
}
const DESK_GOOGLE_TEXT = {
  google_cancel: 'Connexion avec Google annulée.',
  google_config: 'La connexion avec Google n\'est pas encore ouverte sur ce site. Reçois un code par e-mail en attendant.',
  google_expired: 'La connexion avec Google a expiré ou a été ouverte dans un autre navigateur. Réessaie depuis ce navigateur.',
};

// Logo « G » de Google (quatre couleurs, imposé par ses règles de marque) et bouton clair ou sombre (desk.css, .google-btn)
const DESK_GOOGLE_LOGO = '<svg class="google-logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
function deskGoogleButtonHtml(busy) {
  return `<button type="button" class="google-btn" id="google-signin" data-action="google" ${busy || deskGoogle.busy ? 'disabled aria-busy="true"' : ''}>${DESK_GOOGLE_LOGO}<span>Se connecter avec Google</span></button>`;
}
