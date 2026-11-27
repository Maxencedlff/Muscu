// ═══════════════════════════════════════════════════════════
//  Textes propres au système : iOS (App Store, iCloud, identifiant Apple) ou Android (Google Play, sauvegarde
//  Google). Panel Android du 26/11/2026 : l'app Android ne doit jamais parler d'Apple, d'iPhone ou d'iCloud là où
//  ce n'est pas vrai (règle Abonnements de Google Play : où le prix est débité, comment résilier).
//
//  - Une seule règle choisit la variante : byPlatform (js/platform/native.js). L'app iOS ET le navigateur
//    prennent la variante iOS : leurs textes sont exactement ceux d'avant (test tests/unit/platform-texts.mjs).
//  - Les deux variantes ont les mêmes clés. Une valeur est un texte, ou une fonction quand le texte dépend de
//    l'écran (prix, date, nom du coach) ou de l'état du module d'achat (Native.store).
//  - Achat sur Android : tant que le serveur ne vérifie pas les achats Google Play (Native.store.soon,
//    docs/ANDROID.md), rien ne s'achète sur Android ; un abonnement actif y vient forcément d'un iPhone (App
//    Store) ou d'un code. Les textes Android le disent, sans promettre Google Play avant qu'il soit ouvert.
//  Donnée seule, aucun écran : les écrans lisent PT.<clé>.
// ═══════════════════════════════════════════════════════════
'use strict';

// Page Google Play de gestion des abonnements (https://developer.android.com/google/play/billing/subscriptions#deep-link),
// sur l'abonnement donné quand il est connu
const PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';
function playSubscriptionsUrl(sku = null, pkg = 'com.mdlf.training') {
  const q = new URLSearchParams(sku ? { sku, package: pkg } : {});
  return sku ? `${PLAY_SUBSCRIPTIONS_URL}?${q}` : PLAY_SUBSCRIPTIONS_URL;
}
// Google Play ouvert aux achats sur cet appareil (sinon : bientôt sur Android)
const playOpen = () => Native.store.available;

const PLATFORM_TEXTS = {
  ios: {
    // ── Abonnement (js/features/paywall-ui.js) ──
    payCodeNote: 'Un code MDLF se saisit ici, avec « J\'ai un code ». Un code d\'offre reçu d\'Apple s\'ouvre dans la fenêtre d\'Apple.',
    payOfferCode: 'J\'ai un code d\'offre Apple',
    payOfferCodeToast: 'Saisis le code dans la fenêtre d\'Apple',
    payManage: 'Gérer chez Apple',
    payManageUrl: () => 'https://apps.apple.com/account/subscriptions',
    payManageFoot: () => 'Formule et résiliation se gèrent dans les réglages de l\'identifiant Apple.',
    payTrialFoot: 'Un seul essai gratuit par identifiant Apple. Un abonnement ne sert qu\'à un compte MDLF.',
    payLifetimeNote: 'Avec l\'accès à vie, l\'abonnement Apple ne sert plus. S\'il se renouvelle encore, résilie-le dans « Gérer chez Apple ».',
    payCoachBenefits: 'Tes élèves ne paient rien : l\'abonnement coach comprend ton accès et le leur. Tu peux changer de palier à tout moment chez Apple.',
    payGraceMine: ', puis ton abonnement Apple reprend et sera facturé',
    payTaken: 'Cet abonnement Apple est rattaché à un autre compte MDLF. Connecte-toi à ce compte pour le retrouver.',
    // Sous le titre de l'écran d'abonnement (durée déjà échappée)
    payHeroTrial: dur => `${dur} gratuits, puis l'abonnement continue sauf si tu le résilies au moins 24 heures avant la fin de l'essai.`,
    payHeroPromo: dur => `Essai coach : ${dur} offerts, puis l'abonnement continue sauf si tu le résilies au moins 24 heures avant la fin de l'essai.`,
    payTermsTrial: (dur, prices) => `Essai gratuit de ${dur}, puis ${prices} selon la formule choisie. Le paiement est débité sur ton compte Apple à la fin de l'essai, sauf si tu le résilies au moins 24 heures avant la fin de l'essai.`,
    payTermsPromo: (dur, prices) => `Essai coach : ${dur} offerts, puis ${prices} selon la formule choisie. Le paiement est débité sur ton compte Apple à la fin de l'essai, sauf si tu le résilies au moins 24 heures avant la fin de l'essai.`,
    payTermsPlain: prices => `${prices} selon la formule choisie, débité sur ton compte Apple à la confirmation de l'achat.`,
    payTermsRenew: 'L\'abonnement se renouvelle automatiquement pour la même période, sauf si tu le résilies au moins 24 heures avant la fin de la période en cours. Tu peux le résilier à tout moment dans les réglages de ton identifiant Apple.',
    payPromoRule: 'Essai coach réservé aux coachs vérifiés qui n\'ont jamais eu d\'abonnement coach, une seule fois par compte. Si Apple ne l\'accepte pas, rien n\'est débité.',
    payMissingPending: 'Les formules ne sont pas encore proposées par Apple.',
    payMissingFailed: 'Les formules n\'ont pas pu être lues chez Apple.',
    payNoStore: ['Les abonnements s\'achètent dans l\'app MDLF Training sur iPhone.', 'Séances et progrès restent accessibles ici.'],
    payBlocked: () => [`Les achats sont bloqués sur ${thisPhone()}.`, 'Regarde dans Réglages, Temps d\'écran, Restrictions, Achats intégrés.'],
    payDoubleTrial: (who, date) => `${who} t'offre l'accès. Ton propre essai devient payant le ${date} : résilie-le dans « Gérer chez Apple » pour ne pas être prélevé.`,
    // Suppression du compte avec un abonnement en cours (js/features/account-ui.js)
    payDeleteActive: 'Supprimer le compte n\'arrête pas l\'abonnement : Apple continuera de le facturer. Résilie-le d\'abord dans « Gérer chez Apple ».',
    // Réglages › Informations légales (js/features/settings.js)
    legalFoot: () => 'Pages du site mdlf.app, ouvertes dans Safari. L\'abonnement est vendu et remboursé par Apple.',
    // Erreurs d'achat qui nomment la boutique (js/data/access.js, ACCESS_ERROR_TEXT)
    accessErrors: {
      invalid_jws: 'Cet achat n\'a pas pu être vérifié auprès d\'Apple.',
      not_found: 'Apple ne retrouve pas cet achat. Réessaie dans un moment.',
      not_purchased: 'Cet achat n\'est pas rattaché à ton identifiant Apple. Le partage familial n\'est pas accepté.',
      invalid_transaction: 'Apple n\'a pas reconnu cette transaction.',
      promo_refused: 'Apple n\'a pas accepté l\'essai coach offert. Rien n\'a été débité.',
      blocked: 'Les achats sont bloqués sur cet iPhone. Regarde dans Réglages, Temps d\'écran.',
      retry: 'Apple ne répond pas. L\'achat n\'est pas perdu : l\'app réessaiera toute seule, inutile de racheter.',
      pending: 'Achat en attente d\'autorisation. L\'accès s\'ouvrira dès qu\'Apple l\'aura validé.',
      no_products: 'Les formules ne sont pas encore proposées par Apple. Réessaie plus tard.',
      no_store: 'Les achats se font dans l\'app MDLF Training sur iPhone.',
      nothing: 'Aucun achat à restaurer sur cet identifiant Apple.',
    },

    // ── Compte (js/features/account-ui.js, js/data/account-auth.js) ──
    // Moyens de connexion, du plus au moins recommandé (Google seulement si son client est configuré)
    signInProviders: ['apple', 'google', 'email'],
    accountFoot: () => `Avec Apple, tu peux masquer ton e‑mail. Poids du corps et données Santé restent sur ${thePhone()}.`,
    appleManualRevoke: 'Pour retirer aussi l\'accès côté Apple : Réglages de l\'iPhone › ton nom › Connexion et sécurité › Se connecter avec Apple › MDLF Training › Arrêter d\'utiliser.',
    sessionsStayHere: 'Les séances restent sur cet iPhone.',
    emailClosedHint: 'Utilise Apple.',

    // ── Données gardées sur l'appareil et copie de l'app ──
    minBuildText: 'Une nouvelle version de MDLF Training est nécessaire pour continuer. Tes séances restent enregistrées sur cet iPhone.',
    generatorFoot: 'Facultatif, repris des Réglages et gardé sur cet iPhone. L\'âge réduit le volume après 60 ans.',
    waterNote: 'Ce que tu bois reste sur cet iPhone et dans tes exports.',
    waterFoot: 'Ce que tu bois reste sur cet iPhone et dans tes exports : ni copie iCloud, ni serveur, ni coach.',
    dietFoot: () => `Les plans sont sur ${thisPhone()}, dans la copie iCloud de l'app et dans les exports. Les repas cochés et les aliments remplacés restent seulement sur ${thisPhone()} et dans les exports.`,
    dietCoachRemove: who => `Les plans envoyés par ${who} sont supprimés du serveur. Ceux déjà pris restent sur cet iPhone.`,
    coachKeyExists: 'La réception des photos est déjà activée sur un autre iPhone.',
    coachAgeLimited: 'Le contrôle parental de cet iPhone limite les échanges : les messages ne sont pas disponibles.',

    // ── Fonctions absentes de l'app (navigateur, ou Android tant que le module n'existe pas) ──
    socialUnavailable: 'Le social demande un compte MDLF, dans l\'app iPhone.',
    pushUnavailable: 'Les notifications demandent l\'app iPhone et un compte.',
    vaultCellSub: 'Photos de progression, dans l\'app iPhone seulement',
    vaultUnavailable: 'Le coffre n\'existe pour l\'instant que dans l\'app iPhone. Tes photos déjà prises restent sur ce téléphone.',
    checkinPhotosUnavailable: 'Les photos de bilan s\'envoient depuis l\'app iPhone, avec ton coffre à photos.',
    // Image de partage (js/features/recap-canvas.js)
    recapTagline: 'Suivi de musculation sur iPhone',

    // ── Mises à jour de l'app (js/app/updates.js, js/data/min-build.js) ──
    minBuildKey: 'min_build',          // ligne de app_config : build native minimale
    minBuildStore: null,               // page de mise à jour : App Store ou TestFlight (minBuildUpdateUrl)
    latestNativeBuild: 24,             // bannière « Nouvelle version dans TestFlight »
  },

  android: {
    // Rien ne s'achète encore sur Android (Native.store.soon) : aucun code promo Google Play à saisir
    payCodeNote: 'Un code MDLF se saisit ici, avec « J\'ai un code ».',
    payOfferCode: 'J\'ai un code Google Play',
    payOfferCodeToast: 'Saisis le code dans le Play Store',
    payManage: 'Gérer dans Google Play',
    payManageUrl: sku => playSubscriptionsUrl(sku),
    payManageFoot: () => (playOpen()
      ? 'Formule et résiliation se gèrent dans le Play Store, Paiements et abonnements. Un abonnement pris sur iPhone se gère sur l\'iPhone.'
      : 'L\'abonnement n\'est pas encore proposé sur Android. Un abonnement pris sur iPhone se gère sur l\'iPhone, dans les réglages de l\'identifiant Apple.'),
    payTrialFoot: 'Un seul essai gratuit par compte Google. Un abonnement ne sert qu\'à un compte MDLF.',
    payLifetimeNote: 'Avec l\'accès à vie, l\'abonnement ne sert plus. S\'il se renouvelle encore, résilie-le dans « Gérer dans Google Play ».',
    payCoachBenefits: 'Tes élèves ne paient rien : l\'abonnement coach comprend ton accès et le leur. Tu peux changer de palier à tout moment dans Google Play.',
    payGraceMine: ', puis ton abonnement reprend et sera facturé',
    payTaken: 'Cet abonnement Google Play est rattaché à un autre compte MDLF. Connecte-toi à ce compte pour le retrouver.',
    // Google Play : résiliation possible jusqu'à la fin de l'essai ou de la période (pas de délai de 24 heures)
    payHeroTrial: dur => `${dur} gratuits, puis l'abonnement continue sauf si tu le résilies avant la fin de l'essai.`,
    payHeroPromo: dur => `Essai coach : ${dur} offerts, puis l'abonnement continue sauf si tu le résilies avant la fin de l'essai.`,
    payTermsTrial: (dur, prices) => `Essai gratuit de ${dur}, puis ${prices} selon la formule choisie. Le paiement est débité sur ton compte Google Play à la fin de l'essai, sauf si tu le résilies avant la fin de l'essai.`,
    payTermsPromo: (dur, prices) => `Essai coach : ${dur} offerts, puis ${prices} selon la formule choisie. Le paiement est débité sur ton compte Google Play à la fin de l'essai, sauf si tu le résilies avant la fin de l'essai.`,
    payTermsPlain: prices => `${prices} selon la formule choisie, débité sur ton compte Google Play à la confirmation de l'achat.`,
    payTermsRenew: 'L\'abonnement se renouvelle automatiquement pour la même période, sauf si tu le résilies avant la fin de la période en cours. Tu peux le résilier à tout moment dans le Play Store, Paiements et abonnements, Abonnements.',
    payPromoRule: 'Essai coach réservé aux coachs vérifiés qui n\'ont jamais eu d\'abonnement coach, une seule fois par compte. Si Google Play ne l\'accepte pas, rien n\'est débité.',
    payMissingPending: 'Les formules ne sont pas encore proposées dans Google Play.',
    payMissingFailed: 'Les formules n\'ont pas pu être lues dans Google Play.',
    // Pas de compte MDLF sur Android pour l'instant : rien à « reconnecter » (audit du 27/11)
    payNoStore: ['L\'abonnement n\'est pas encore proposé sur Android. Il arrivera avec Google Play.',
      'Séances et progrès restent accessibles ici.'],
    payBlocked: () => ['Google Play ne permet pas d\'acheter sur ce téléphone.', 'Vérifie que le Play Store est à jour et qu\'un compte Google y est connecté.'],
    payDoubleTrial: (who, date) => `${who} t'offre l'accès. Ton propre essai devient payant le ${date} : résilie-le dans le Play Store, ou sur l'iPhone s'il y a été pris, pour ne pas être prélevé.`,
    payDeleteActive: 'Supprimer le compte n\'arrête pas l\'abonnement : il reste facturé par la boutique où tu l\'as pris (Google Play, ou Apple s\'il vient d\'un iPhone). Résilie-le d\'abord.',
    legalFoot: () => (playOpen()
      ? 'Pages du site mdlf.app, ouvertes dans le navigateur. L\'abonnement est vendu et remboursé par Google Play.'
      : 'Pages du site mdlf.app, ouvertes dans le navigateur.'),
    accessErrors: {
      invalid_jws: 'Cet achat n\'a pas pu être vérifié auprès de Google Play.',
      not_found: 'Google Play ne retrouve pas cet achat. Réessaie dans un moment.',
      not_purchased: 'Cet achat n\'est pas rattaché à ton compte Google. Le partage familial n\'est pas accepté.',
      invalid_transaction: 'Google Play n\'a pas reconnu cet achat.',
      promo_refused: 'Google Play n\'a pas accepté l\'essai coach offert. Rien n\'a été débité.',
      blocked: 'Google Play ne permet pas d\'acheter sur ce téléphone.',
      retry: 'Google Play ne répond pas. L\'achat n\'est pas perdu : l\'app réessaiera toute seule, inutile de racheter.',
      pending: 'Achat en attente. L\'accès s\'ouvrira dès que Google Play l\'aura validé.',
      no_products: 'Les formules ne sont pas encore proposées dans Google Play. Réessaie plus tard.',
      no_store: 'L\'abonnement n\'est pas encore proposé sur Android.',
      nothing: 'Aucun achat à restaurer sur ce compte Google.',
    },

    // Pas de « Continuer avec Apple » sur Android (docs/ANDROID.md, 4) : Google d'abord, puis l'e-mail
    signInProviders: ['google', 'email'],
    accountFoot: () => 'Poids du corps et données Health Connect restent sur le téléphone.',
    appleManualRevoke: 'Pour retirer aussi l\'accès côté Apple : sur appleid.apple.com, Connexion et sécurité › Se connecter avec Apple › MDLF Training › Arrêter d\'utiliser.',
    sessionsStayHere: 'Les séances restent sur ce téléphone.',
    emailClosedHint: 'Utilise Google.',

    minBuildText: 'Une nouvelle version de MDLF Training est nécessaire pour continuer. Tes séances restent enregistrées sur ce téléphone.',
    generatorFoot: 'Facultatif, repris des Réglages et gardé sur ce téléphone. L\'âge réduit le volume après 60 ans.',
    waterNote: 'Ce que tu bois reste sur ce téléphone et dans tes exports.',
    waterFoot: 'Ce que tu bois reste sur ce téléphone et dans tes exports : ni sauvegarde Google, ni serveur, ni coach.',
    dietFoot: () => 'Les plans sont sur ce téléphone, dans la sauvegarde Google de l\'app et dans les exports. Les repas cochés et les aliments remplacés restent seulement sur ce téléphone et dans les exports.',
    dietCoachRemove: who => `Les plans envoyés par ${who} sont supprimés du serveur. Ceux déjà pris restent sur ce téléphone.`,
    coachKeyExists: 'La réception des photos est déjà activée sur un autre appareil.',
    coachAgeLimited: 'Le contrôle parental de ce téléphone limite les échanges : les messages ne sont pas disponibles.',

    socialUnavailable: 'Le compte MDLF n\'est pas encore disponible sur Android : le social arrive avec lui.',
    pushUnavailable: 'Les notifications ne sont pas encore disponibles sur Android.',
    vaultCellSub: 'Photos de progression, bientôt sur Android',
    vaultUnavailable: 'Le coffre à photos n\'est pas encore disponible sur Android. Tes photos déjà prises restent sur ce téléphone.',
    checkinPhotosUnavailable: 'Les photos de bilan ne s\'envoient pas encore depuis Android : passe cette partie.',
    recapTagline: 'Suivi de musculation',

    // Pas de version minimale Android publiée : jamais bloqué ; pas de TestFlight sur Android
    minBuildKey: 'min_build_android',
    minBuildStore: { url: 'https://play.google.com/store/apps/details?id=com.mdlf.training', label: 'le Play Store' },
    latestNativeBuild: 0,
  },
};

const PT = byPlatform(PLATFORM_TEXTS);
