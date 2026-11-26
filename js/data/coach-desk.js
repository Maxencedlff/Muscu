// ═══════════════════════════════════════════════════════════
//  Mode coach grand écran (iPad, tablettes) : règles sans DOM (docs/COACH_IPAD.md)
//
//  Sur un grand écran, l'onglet Coach propose d'ouvrir l'appli web du coach (la même que coach.mdlf.app),
//  embarquée dans l'app (dist/coach/, scripts/embed-coach-web.mjs), avec la session déjà ouverte. Écran et
//  liaison : js/features/coach-desk-ui.js.
//  - Proposé seulement dans l'app iOS (pas les tablettes Android tant qu'aucun test ne les couvre, audit M2), jamais
//    sur un iPhone, et seulement si la fenêtre est assez large pour la mise en page tablette du site : 768 points sur
//    iPad (iPad Air en portrait), 900 sinon (la vue web d'iPadOS en mode « ordinateur » se dit Macintosh, reconnue
//    au toucher). Mode ouvert : il reste ouvert jusqu'à 678 points (Split View à moitié sur un 13 pouces) et se
//    referme en dessous (Slide Over, Split View au tiers ; audit M3).
//  - Jamais ouvert d'office : le coach choisit. Choix retenu sur l'appareil (COACH_DESK_KEY) : '' (jamais ouvert :
//    carte qui explique), 'used' (déjà ouvert : simple ligne), 'hidden' (« Masquer » : plus rien dans l'onglet,
//    la ligne reste dans Réglages › Coach).
// ═══════════════════════════════════════════════════════════
'use strict';

const COACH_DESK_KEY = 'mdlf_coach_desk';
const COACH_DESK_PREFS = ['', 'used', 'hidden'];
const COACH_DESK_MIN_IPAD = 768;
const COACH_DESK_MIN = 900;
const COACH_DESK_MIN_OPEN = 678;

// { native, platform ('ios' | 'android' | 'web'), ua, touchPoints, width } → bool (iOS seulement)
function coachDeskEligible({ native, platform, ua = '', touchPoints = 0, width = 0 }) {
  if (!native || platform !== 'ios') return false;
  if (/iPhone|iPod/.test(ua)) return false;
  return width >= (isIPad(ua, touchPoints) ? COACH_DESK_MIN_IPAD : COACH_DESK_MIN);   // js/platform/native.js
}

function coachDeskPref() {
  try {
    const v = localStorage.getItem(COACH_DESK_KEY) || '';
    return COACH_DESK_PREFS.includes(v) ? v : '';
  } catch { return ''; }
}
function coachDeskSetPref(v) {
  if (!COACH_DESK_PREFS.includes(v)) return;
  try { if (v) localStorage.setItem(COACH_DESK_KEY, v); else localStorage.removeItem(COACH_DESK_KEY); } catch { /* stockage plein : redemandé */ }
}

// Jetons d'une session supabase-js, rien d'autre (ni l'utilisateur, ni ses identités) ; null si incomplète
function coachDeskTokens(session) {
  const a = session?.access_token, r = session?.refresh_token;
  return typeof a === 'string' && a && typeof r === 'string' && r ? { access_token: a, refresh_token: r } : null;
}

// Jetons venus du cadre : acceptés seulement s'ils sont ceux du compte connecté dans l'app (claim sub du jeton
// d'accès, jwtPayload de js/data/account-auth.js). Sans ce contrôle, un script injecté dans le cadre pourrait faire
// basculer l'app sur un autre compte (contre-audit du 25/11). La signature n'est pas vérifiée ici : supabase-js et le
// serveur la vérifient ; ce contrôle refuse seulement un AUTRE compte.
function coachDeskSameAccount(tokens, userId) {
  if (!tokens || typeof userId !== 'string' || !userId) return false;
  const sub = jwtPayload(tokens.access_token)?.sub;
  return typeof sub === 'string' && sub === userId;
}
