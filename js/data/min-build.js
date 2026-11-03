// ═══════════════════════════════════════════════════════════
//  Version minimale de l'app (app_config.min_build)
// ═══════════════════════════════════════════════════════════
//
// Le jour où le verrou de l'abonnement s'allume, une build trop ancienne ne saurait rien proposer
// quand le serveur refuse ses séances. Le serveur publie donc la build native minimale (ligne
// `min_build` de `app_config`, lisible sans compte comme `paywall_on`, voir docs/PAYANT_V1.md) ; une
// app plus ancienne affiche l'écran « Mets à jour l'app » (js/app/updates.js).
//
// Ce fichier ne décide que sur des faits ; il n'affiche rien. Règles :
//  - hors de l'app iOS (navigateur) : jamais bloqué (pas de build native) ;
//  - serveur injoignable, réponse illisible, valeur absente ou à 0 : jamais bloqué. Aucune valeur
//    n'est gardée sur l'appareil exprès : hors ligne, l'app reste entièrement utilisable ;
//  - le lien de mise à jour est la fiche App Store pour une app installée par l'App Store, et
//    TestFlight sinon (TestFlight, build Xcode, environnement inconnu).
'use strict';

// Lien public TestFlight : iOS l'ouvre hors de l'app, TestFlight propose la mise à jour
const TESTFLIGHT_URL = 'https://testflight.apple.com/join/qxpdFN6Z';
// Fiche App Store de l'app (même identifiant que les codes d'offre, js/data/plans.js)
const MIN_BUILD_APP_STORE_URL = `https://apps.apple.com/app/id${PLAN_APP_STORE_ID}`;

// Valeur de app_config.min_build → entier positif, ou 0 (aucune version minimale). jsonb rend un
// nombre ('30'::jsonb) ; une chaîne de chiffres ('"30"'::jsonb, faute de frappe probable) vaut aussi.
function minBuildValue(raw) {
  const v = typeof raw === 'string' && /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  return Number.isSafeInteger(v) && v > 0 ? v : 0;
}

// Vrai seulement si la build installée est connue ET plus ancienne que le minimum du serveur
function minBuildBlocks(build, min) {
  return Number.isSafeInteger(build) && build > 0 && min > 0 && build < min;
}

// Environnement StoreKit ('production' = App Store) → page qui propose la nouvelle version
function minBuildUpdateUrl(env) {
  return env === 'production' ? MIN_BUILD_APP_STORE_URL : TESTFLIGHT_URL;
}

// Lit min_build sur le serveur : { ok: true, min } si le serveur a répondu, { ok: false } sinon
// (pas de client Supabase, hors ligne, erreur). Une ligne absente vaut 0 (aucune version minimale).
async function minBuildFetch() {
  if (typeof sb === 'undefined' || !sb) return { ok: false };
  try {
    const { data: row, error } = await sb.from('app_config').select('value').eq('key', 'min_build').maybeSingle();
    if (error) return { ok: false };
    return { ok: true, min: minBuildValue(row?.value) };
  } catch { return { ok: false }; }
}
