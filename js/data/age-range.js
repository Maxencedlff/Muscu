// ═══════════════════════════════════════════════════════════
//  Tranche d'âge partagée par Apple (Declared Age Range, iOS 26), sans affichage
//  - Demandée à l'ouverture de l'onglet Social (ageRangeCheck), jamais au lancement : la fenêtre d'iOS
//    arrive avec son contexte. Module natif MdlfAgeRange (ios/App/App/AgeRangePlugin.swift), seuils
//    13, 15 et 18 ans (au plus trois seuils, tranches de deux ans au moins : doc Apple).
//  - Réponse ramenée à une catégorie (ageBand) : 'adult' (18 ans ou plus), 'teen' (15-17 ans : prudence,
//    séances masquées par défaut), 'young' (tranche qui n'exclut pas moins de 15 ans : Social et « Rejoindre
//    un coach » masqués, comme la règle des 15 ans), 'limited' (mineur avec le contrôle parental « Limites
//    de communication » : Social et messages du coach masqués), null (refus, indisponible, navigateur,
//    Android, iOS antérieur au 26 : comportement inchangé).
//  - Gardée sur l'appareil (mdlf_age_range), pas dans le compte : Apple répond pour le compte iCloud de
//    l'iPhone. La tranche n'est jamais envoyée au serveur (social activé puis masqué : seul social_disable part,
//    js/features/social-ui.js). Tranche partagée relue au bout de 30 jours (un anniversaire
//    peut changer la tranche), indisponible au bout de 7 jours, refus jamais redemandé.
//  - Ne bloque jamais l'app : sans réponse, rien ne change ; l'écran suit onAgeRangeChange.
// ═══════════════════════════════════════════════════════════
'use strict';

const AGE_RANGE_KEY = 'mdlf_age_range';
const AGE_RANGE_TTL = { sharing: 30 * 86400e3, unavailable: 7 * 86400e3, declined: Infinity };
const AGE_RANGE_STATUSES = ['sharing', 'declined', 'unavailable'];

// Réponse du module natif, nettoyée : { status, lowerBound?, upperBound?, communicationLimits }
function cleanAgeRange(r) {
  const status = AGE_RANGE_STATUSES.includes(r?.status) ? r.status : 'unavailable';
  if (status !== 'sharing') return { status };
  const age = v => (Number.isInteger(v) && v >= 0 && v < 150 ? v : null);
  return { status, lowerBound: age(r.lowerBound), upperBound: age(r.upperBound), communicationLimits: r.communicationLimits === true };
}

// Catégorie de la tranche (voir l'en-tête). Bornes : lowerBound absent = sous le plus petit seuil,
// upperBound absent = au-dessus du plus grand. La région peut imposer d'autres seuils (Texas : 13, 16, 18),
// d'où un calcul sur les bornes plutôt que sur nos seuils. Mineur dont la tranche n'exclut pas un âge sous
// 15 ans (13-15 au Texas, moins de 13 ans) : 'young', par prudence ; 'teen' seulement si 15 ans est sûr.
function ageBand(r) {
  if (r?.status !== 'sharing') return null;
  const lo = r.lowerBound ?? null, up = r.upperBound ?? null;
  if (lo === null && up === null) return null;               // réponse incohérente : rien ne change
  if (lo !== null && lo >= 18) return 'adult';
  if ((lo === null || lo < 15) && up !== null && up <= 17) return 'young';
  if (r.communicationLimits) return 'limited';
  return 'teen';
}

const ageRange = { stored: readAgeRange(), asking: false, askedThisLaunch: false };
const ageRangeListeners = [];
function onAgeRangeChange(fn) { ageRangeListeners.push(fn); }
function notifyAgeRange() { for (const fn of ageRangeListeners) { try { fn(); } catch { /* écran absent */ } } }

function readAgeRange() {
  try {
    const c = JSON.parse(localStorage.getItem(AGE_RANGE_KEY));
    if (!c || !Number.isFinite(c.at)) return null;
    return { ...cleanAgeRange(c), at: c.at };
  } catch { return null; }
}
function writeAgeRange(r) {
  try { localStorage.setItem(AGE_RANGE_KEY, JSON.stringify(r)); } catch { /* facultatif : redemandé au prochain lancement */ }
}

// Réponse encore valable ? (now : horloge de l'appareil, suffisante pour savoir quand redemander)
function ageRangeFresh(r, now = Date.now()) {
  return !!r && now - r.at >= 0 && now - r.at < AGE_RANGE_TTL[r.status];
}

// Catégorie connue sur cet appareil, null sinon
function currentAgeBand() { return ageBand(ageRange.stored); }
// Social masqué : tranche partagée de moins de 15 ans, ou contrôle parental qui limite les échanges
// (js/data/social.js, socialEnabled : point unique pour les écrans du social, bilan et Historique compris)
function socialHiddenByAge() { const b = currentAgeBand(); return b === 'young' || b === 'limited'; }
// Rejoindre un coach : 15 ans ou plus (privacy.html) ; un coach déjà suivi reste
function coachJoinHiddenByAge() { return currentAgeBand() === 'young'; }
// Messages avec le coach : coupés par le contrôle parental « Limites de communication »
function chatHiddenByAge() { return currentAgeBand() === 'limited'; }
// 15-17 ans : séances masquées aux abonnés par défaut (js/data/social.js, sessionsVisibleByDefault)
function socialTeenByAge() { return currentAgeBand() === 'teen'; }

// Demande à iOS (une fois par lancement au plus, et seulement si la dernière réponse est périmée).
// Renvoie la catégorie connue ensuite ; jamais d'exception.
async function ageRangeCheck() {
  if (!Native.ageRange?.available || ageRange.asking || ageRange.askedThisLaunch) return currentAgeBand();
  if (ageRangeFresh(ageRange.stored)) return currentAgeBand();
  ageRange.asking = true;
  ageRange.askedThisLaunch = true;
  try {
    const before = currentAgeBand();
    const r = { ...cleanAgeRange(await Native.ageRange.request()), at: Date.now() };
    // Indisponible après une tranche connue (réseau, compte) : la tranche connue reste, redemandée dans 7 jours
    if (r.status === 'unavailable' && ageRange.stored?.status === 'sharing') {
      ageRange.stored = { ...ageRange.stored, at: r.at - AGE_RANGE_TTL.sharing + AGE_RANGE_TTL.unavailable };
    } else {
      ageRange.stored = r;
    }
    writeAgeRange(ageRange.stored);
    if (currentAgeBand() !== before) notifyAgeRange();
  } catch { /* module en erreur : rien ne change */ }
  finally { ageRange.asking = false; }
  return currentAgeBand();
}
