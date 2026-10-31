'use strict';

// Pont vers les fonctions natives quand l'app tourne dans sa coquille Capacitor : iOS (App Store) ou,
// en préparation, Android (Google Play, docs/ANDROID.md). Dans le navigateur (PWA), Native.isNative vaut
// false et chaque fonction ne fait rien : l'app web garde exactement son comportement.
//
// Android reprend les mêmes noms de modules qu'iOS quand l'équivalent existe (MdlfHealth : Health Connect,
// MdlfLiveActivity : notification du repos, MdlfStore : Google Play). Ce qui n'existe que sur iOS
// (copie iCloud, Apple Music, icônes alternatives, compte Apple) est coupé ici sur Android, d'après
// Native.platform, sans rien changer pour iOS.
//
// Les modules natifs sont joints sans bundler : window.Capacitor (injecté par la coquille iOS)
// fournit registerPlugin(nom), qui relaie les appels vers le code Swift du module.

const Native = (() => {
  const cap      = window.Capacitor;
  // Sans le runtime JS de Capacitor (registerPlugin), l'app se comporte comme la version web
  const isNative = !!cap?.isNativePlatform?.() && typeof cap.registerPlugin === 'function';
  const plugin   = name => (isNative ? cap.registerPlugin(name) : null);
  // 'ios', 'android' ou 'web'. Une coquille sans getPlatform (jamais vu) est une coquille iOS.
  const platform  = isNative ? (cap.getPlatform?.() === 'android' ? 'android' : 'ios') : 'web';
  const isAndroid = platform === 'android';
  // Copie iCloud de l'app : iOS seulement (Android : sauvegarde Google du fichier de copie, voir backup)
  const hasCloud  = isNative && !isAndroid;
  // Copie de sécurité ppl_v2.json : Documents de l'app sur iOS ; sur Android, le dossier privé de l'app
  // (« DATA »), seul inclus dans la sauvegarde Google (android/app/src/main/res/xml/data_extraction_rules.xml).
  // « DOCUMENTS » y serait le dossier Documents partagé du téléphone, illisible après une réinstallation.
  const BACKUP_DIR = isAndroid ? 'DATA' : 'DOCUMENTS';

  const Haptics            = plugin('Haptics');
  const LocalNotifications = plugin('LocalNotifications');
  const KeepAwake          = plugin('KeepAwake');
  const StatusBar          = plugin('StatusBar');
  const SplashScreen       = plugin('SplashScreen');
  const Filesystem         = plugin('Filesystem');
  const Share              = plugin('Share');
  const Health             = plugin('MdlfHealth');   // module Swift de l'app (ios/App/App/HealthPlugin.swift)
  const Music              = plugin('MdlfMusic');    // module Swift de l'app (ios/App/App/MusicPlugin.swift)
  const LiveActivity       = plugin('MdlfLiveActivity'); // module Swift de l'app (ios/App/App/LiveActivityPlugin.swift)
  const AppIcon            = plugin('MdlfAppIcon');   // module Swift de l'app (ios/App/App/AppIconPlugin.swift)
  const Cloud              = plugin('MdlfCloudBackup'); // module Swift de l'app (ios/App/App/CloudBackupPlugin.swift)
  const Sound              = plugin('MdlfSound');     // module Swift de l'app (ios/App/App/SoundPlugin.swift), build 22 et suivantes
  const Account            = plugin('MdlfAccount');   // module Swift de l'app (ios/App/App/AccountPlugin.swift), build 25 et suivantes
  const Store              = plugin('MdlfStore');     // module Swift de l'app (ios/App/App/StorePlugin.swift), abonnements StoreKit 2
  const Push               = plugin('MdlfPush');      // module Swift de l'app (ios/App/App/PushPlugin.swift), build qui suit le 31/10/2026
  const Updater            = plugin('CapacitorUpdater'); // @capgo/capacitor-updater (mises à jour à chaud)
  const AppInfo            = plugin('App');              // @capacitor/app : numéro de build installé

  // Un module natif indisponible ou en erreur ne doit jamais casser l'app web
  const quiet = promise => { promise?.catch?.(() => {}); };

  const getItem = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const setItem = (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } };

  // Nombre de séances d'un JSON de ppl_v2 (0 si illisible)
  const sessionCount = json => {
    try { const h = JSON.parse(json)?.history; return Array.isArray(h) ? h.length : 0; } catch { return 0; }
  };

  // Empreinte d'un texte (longueur + FNV-1a 32 bits) : sert à ne pas renvoyer à iCloud ce qu'il a déjà
  const fingerprint = text => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return `${text.length}:${(h >>> 0).toString(16)}`;
  };

  const REST_NOTIF_ID = 1;           // une seule notification de repos à la fois
  const BACKUP_FILE   = 'ppl_v2.json';
  const CLOUD_WAIT_MS = 2500;        // premier lancement : attente de la copie iCloud (écran de démarrage)
  const CLOUD_READY   = 'ppl_cloud_ready'; // '1' : la copie iCloud peut être écrite (gardé d'un lancement à l'autre)
  const CLOUD_SENT    = 'ppl_cloud_sent';  // empreinte du dernier JSON accepté par iCloud
  let notifPermission = null;        // 'granted' | 'denied' | null (pas encore demandé)
  let backupTimer     = null;

  // Lu avant que store.js ne crée une donnée par défaut : sans donnée locale au démarrage,
  // la copie de sécurité ne doit pas être écrasée avant d'avoir tenté de la restaurer (boot).
  const localAtStart = getItem('ppl_v2');
  const hadLocalData = !!localAtStart;
  let backupEnabled  = hadLocalData;
  // Copie iCloud : jamais écrasée par une donnée sans séance tant qu'on ne sait pas ce qu'elle
  // contient (réinstallation, iCloud lent ou hors ligne). Ouverte une fois pour toutes quand iCloud
  // a répondu, dès la première séance, ou d'emblée pour qui avait déjà des séances.
  let cloudReady     = hasCloud && (getItem(CLOUD_READY) === '1' || sessionCount(localAtStart) > 0);
  let cloudErase     = false;   // « Supprimer toutes les données » : vider aussi la copie iCloud
  if (cloudReady) setItem(CLOUD_READY, '1');

  const openCloud = () => { if (!cloudReady) { cloudReady = true; setItem(CLOUD_READY, '1'); } };

  // Lancement qui suit une restauration (Documents ou iCloud) : l'écran Bienvenue n'est pas montré
  // (js/data/account-auth.js, firstScreen). Marque lue une fois puis effacée.
  const RESTORED_MARK = 'ppl_restored';
  const restoredAtBoot = (() => {
    try { const v = sessionStorage.getItem(RESTORED_MARK) === '1'; sessionStorage.removeItem(RESTORED_MARK); return v; }
    catch { return false; }
  })();

  // Remet une copie dans le stockage web puis recharge l'app ; plus aucune écriture d'ici là
  const restore = json => {
    clearTimeout(backupTimer);
    const was = backupEnabled;
    backupEnabled = false;
    if (setItem('ppl_v2', json)) {
      try { sessionStorage.setItem(RESTORED_MARK, '1'); } catch { /* écran Bienvenue évité par les séances restaurées */ }
      location.reload(); return true;
    }
    backupEnabled = was;
    return false;
  };

  // Copie iCloud : attend au plus waitMs la première synchronisation (réinstallation).
  // Renvoie { json, synced } ; json null si iCloud n'a pas de copie (ou n'a pas encore répondu).
  const readCloud = async waitMs => {
    try {
      const r = await Cloud.load({ waitMs });
      const json = typeof r?.data === 'string' && r.data.length > 2 ? r.data : null;
      return { json, synced: !!r?.synced || !!json };
    } catch { return { json: null, synced: false }; }
  };

  // Copie iCloud arrivée (ou lue) alors que l'écriture était encore fermée : reprise si elle a des
  // séances et l'iPhone aucune (une séance en cours, gardée à part, reprend après le rechargement)
  const adoptCloud = json => {
    if (sessionCount(json) > 0 && sessionCount(getItem('ppl_v2')) === 0 && restore(json)) return;
    openCloud();
  };

  // Envoi à iCloud : rien tant que l'écriture est fermée, rien si iCloud a déjà ce JSON (ex.
  // l'enregistrement de chaque démarrage, qui ferait gagner un vieil iPhone juste ouvert)
  const pushCloud = json => {
    if (!hasCloud) return;
    const sessions = sessionCount(json);
    if (sessions > 0) openCloud();
    if (!cloudReady) return;
    const print = fingerprint(json);
    if (!cloudErase && print === getItem(CLOUD_SENT)) return;
    const force = cloudErase;
    cloudErase = false;
    Promise.resolve(Cloud.save({ data: json, sessions, force }))
      .then(r => { if (r?.saved) setItem(CLOUD_SENT, print); })
      .catch(() => {});
  };

  // Filet de sécurité : l'écran de démarrage disparaît même si le rendu échoue
  if (isNative) setTimeout(() => quiet(SplashScreen.hide()), 4000);

  return {
    isNative,
    platform,
    restoredAtBoot,

    // Retour haptique du Taptic Engine : 'light' au toucher, 'success' en fin de repos ou de séance
    haptic(kind = 'light') {
      if (!isNative) return false;
      if (kind === 'success') quiet(Haptics.notification({ type: 'SUCCESS' }));
      else quiet(Haptics.impact({ style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' }));
      return true;
    },

    // Écran toujours allumé pendant une séance (remplace le Wake Lock du navigateur)
    keepAwake(on) {
      if (!isNative) return false;
      quiet(on ? KeepAwake.keepAwake() : KeepAwake.allowSleep());
      return true;
    },

    // Texte de la barre d'état : clair sur fond sombre, sombre sur fond clair
    statusBar(darkBackground) {
      if (isNative) quiet(StatusBar.setStyle({ style: darkBackground ? 'DARK' : 'LIGHT' }));
    },

    hideSplash() {
      if (isNative) quiet(SplashScreen.hide({ fadeOutDuration: 200 }));
    },

    // Notification de fin de repos, même téléphone verrouillé ou app en arrière-plan.
    // L'autorisation est demandée la première fois qu'un repos démarre (au moment où elle a du sens).
    async scheduleRestEnd(endTime, body, title = 'Repos terminé') {
      if (!isNative || !(endTime > Date.now() + 1000)) return;
      try {
        if (notifPermission === null) {
          const cur = await LocalNotifications.checkPermissions();
          notifPermission = cur.display === 'granted' ? 'granted'
            : (await LocalNotifications.requestPermissions()).display;
        }
        if (notifPermission !== 'granted') return;
        await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIF_ID }] });
        await LocalNotifications.schedule({ notifications: [{
          id: REST_NOTIF_ID,
          title,
          body,
          // Sans « sound », iOS présente la notification en silence (plugin : content.sound reste vide).
          // Nom sans fichier correspondant : iOS joue le son de notification par défaut.
          sound: 'default',
          schedule: { at: new Date(endTime), allowWhileIdle: true },
        }] });
      } catch {}
    },

    cancelRestEnd() {
      if (isNative) quiet(LocalNotifications.cancel({ notifications: [{ id: REST_NOTIF_ID }] }));
    },

    // Deux copies de sécurité des données :
    //  - ppl_v2.json dans les Documents de l'app (le stockage web d'iOS peut être vidé dans de rares
    //    cas), inclus dans la sauvegarde iCloud de l'iPhone ;
    //  - la copie iCloud de l'app (MdlfCloudBackup), qui survit à la suppression de l'app et revient
    //    sur un nouvel iPhone. Une donnée sans séance n'y est écrite qu'une fois iCloud consulté.
    backup(json) {
      if (!isNative || !backupEnabled) return;
      clearTimeout(backupTimer);
      backupTimer = setTimeout(() => {
        quiet(Filesystem.writeFile({ path: BACKUP_FILE, data: json, directory: BACKUP_DIR, encoding: 'utf8' }));
        pushCloud(json);
      }, 800);
    },

    // « Supprimer toutes les données » : le prochain enregistrement vide aussi la copie iCloud
    // (sans ce drapeau, iOS refuse d'écrire une donnée sans séance par-dessus une copie qui en a)
    eraseCloudOnNextSave() {
      if (isNative) cloudErase = true;
    },

    // Au démarrage, stockage web vide (premier lancement, réinstallation, stockage vidé par iOS) :
    // la copie des Documents, sinon la copie iCloud, est remise en place et l'app recharge.
    // Renvoie true si un rechargement est lancé. Tant que l'écriture iCloud est fermée, une copie
    // iCloud arrivée plus tard (ou au lancement suivant) est encore reprise s'il n'y a aucune séance.
    async boot() {
      if (!isNative) return false;
      if (!hadLocalData) {
        const file = await this.readBackup();
        if (file && restore(file)) return true;
        if (!file && hasCloud) {
          const { json, synced } = await readCloud(CLOUD_WAIT_MS);
          if (json && restore(json)) return true;
          if (synced) openCloud();
        }
        backupEnabled = true;
      }
      // Changement venu d'iCloud (autre iPhone, autre compte) : l'empreinte ne dit plus ce
      // qu'iCloud contient, le prochain enregistrement renverra la donnée de cet iPhone
      if (!hasCloud) return false;
      quiet(Cloud.addListener?.('change', ({ data } = {}) => {
        setItem(CLOUD_SENT, '');
        if (!cloudReady) adoptCloud(data);
      }));
      if (!cloudReady) {
        if (hadLocalData) {
          readCloud(0).then(({ json, synced }) => {
            if (cloudReady) return;
            if (json) adoptCloud(json);
            else if (synced) openCloud();
          });
        }
      }
      return false;
    },

    // Apple Santé (iOS) ou Health Connect (Android) : autorisation, entraînement « Musculation », pesées
    // (kg), courses et sorties vélo. Mêmes réponses sur les deux. Hors app : rien.
    health: {
      // Nom montré dans les Réglages
      name: isAndroid ? 'Health Connect' : 'Apple Santé',
      // workouts : false pour ne demander que le poids et l'écriture (sans la lecture des courses et du vélo).
      // → { available, workouts } (écriture des séances accordée) ; Android ajoute workoutsRead (lecture
      // des courses et du vélo accordée), qu'iOS ne peut pas dire.
      async authorize({ workouts = true } = {}) {
        if (!isNative) return { available: false, workouts: false };
        try { return await Health.requestAuthorization({ workouts }); } catch { return { available: false, workouts: false }; }
      },
      // Fenêtre d'autorisation encore à montrer pour un type : 'shouldRequest', 'unnecessary' (tout a été
      // demandé, quelle que soit la réponse, sur iOS comme sur Android) ou 'unknown' (échec, build
      // antérieure sans la méthode, navigateur). Ne montre rien.
      // which : 'request' (poids, écriture, courses et vélo) ou 'extra' (sommeil et distances du cardio,
      // build iOS qui suit le 31/10/2026 : 'unknown' sur une build antérieure et sur Android).
      async requestStatus(which = 'request') {
        if (!isNative) return 'unknown';
        try { return (await Health.authorizationStatus())[which] || 'unknown'; } catch { return 'unknown'; }
      },
      async saveWorkout({ start, end, kcal = 0 }) {
        if (!isNative) return false;
        try { return !!(await Health.saveWorkout({ start, end, kcal })).saved; } catch { return false; }
      },
      // Séance détaillée (js/data/health-export.js : un entraînement par type, pauses, énergie, distance).
      // → { saved, total } ; 'unimplemented' sur une build antérieure (l'appelant écrit alors la séance
      // comme avant, en un seul entraînement « Musculation ») ; null en cas d'échec.
      async saveWorkouts(id, workouts) {
        if (!isNative) return null;
        try { const r = await Health.saveWorkouts({ id, workouts }); return { saved: r.saved | 0, total: r.total | 0 }; }
        catch (e) { return e?.code === 'UNIMPLEMENTED' ? 'unimplemented' : null; }
      },
      // Sommeil des `days` dernières nuits : [{ start, end, stage }] ; null si la lecture a échoué. Build
      // antérieure (méthode absente) : liste vide.
      async sleep(days = 8) {
        if (!isNative) return [];
        try { return (await Health.sleep({ days })).samples || []; }
        catch (e) { return e?.code === 'UNIMPLEMENTED' ? [] : null; }
      },
      // Pesées des `days` derniers jours, la plus récente d'abord ; null si la lecture a échoué
      // (Santé pas encore prête au lancement…) : l'appelant ne doit pas garder ce résultat
      async bodyMass(days = 90) {
        if (!isNative) return [];
        try { return (await Health.bodyMass({ days })).samples || []; } catch { return null; }
      },
      // Courses et sorties vélo des `days` derniers jours (Apple Watch, Strava…), la plus récente d'abord ;
      // null si la lecture a échoué. Module d'une build antérieure (méthode absente) : liste vide.
      async workouts(days = 60) {
        if (!isNative) return [];
        try { return (await Health.workouts({ days })).workouts || []; }
        catch (e) { return e?.code === 'UNIMPLEMENTED' ? [] : null; }
      },
    },

    // Notifications push (APNs). Hors app, sur Android (pas de module) ou build antérieure sans le module :
    // available() vaut false et rien
    // ne se passe. permission() : 'prompt' | 'granted' | 'denied' | 'unavailable' (sans rien montrer) ;
    // requestPermission() ouvre la fenêtre d'iOS si elle n'a jamais été montrée (appelé seulement après un
    // toucher sur un interrupteur de Réglages › Notifications). register() : { token, environment } ou null.
    push: {
      async available() {
        if (!isNative) return false;
        try { await Push.permission(); return true; } catch { return false; }
      },
      async permission() {
        if (!isNative) return 'unavailable';
        try { return (await Push.permission()).permission || 'prompt'; } catch { return 'unavailable'; }
      },
      async requestPermission() {
        if (!isNative) return 'unavailable';
        try { return (await Push.requestPermission()).permission || 'denied'; } catch { return 'unavailable'; }
      },
      async register() {
        if (!isNative) return null;
        try {
          const r = await Push.register();
          return typeof r?.token === 'string' ? { token: r.token, environment: r.environment === 'sandbox' ? 'sandbox' : 'production' } : null;
        } catch { return null; }
      },
      async openSettings() {
        if (!isNative) return false;
        try { return !!(await Push.openSettings()).opened; } catch { return false; }
      },
      // Toucher d'une notification ({ kind, ref }) : gardé par iOS jusqu'à cet abonnement (lancement à froid)
      onTap(cb) { if (isNative && Push) quiet(Push.addListener('tap', cb)); },
      // Notification reçue app ouverte : l'état (badges) est relu
      onReceive(cb) { if (isNative && Push) quiet(Push.addListener('received', cb)); },
    },

    // Apple Music : morceau en cours et commandes du lecteur de l'app Musique. Hors app et sur Android : rien.
    music: {
      available: isNative && !isAndroid,
      async authorize() {
        if (!isNative) return false;
        try { return !!(await Music.requestAuthorization()).granted; } catch { return false; }
      },
      async nowPlaying() {
        if (!isNative) return null;
        try { return await Music.nowPlaying(); } catch { return null; }
      },
      async command(name) {   // 'play' | 'pause' | 'next' | 'previous'
        if (!isNative) return null;
        try { return await Music[name](); } catch { return null; }
      },
      onChange(cb) {
        if (isNative) quiet(Music.addListener('change', cb));
      },
    },

    // Live Activity du repos (écran verrouillé, Dynamic Island). Hors app : rien.
    // state = { endTime (ms), total (s), title, color, next: { exercise, set, load } | null }
    liveActivity: {
      start(state)  { if (!isNative) return false; quiet(LiveActivity.start(state)); return true; },
      update(state) { if (!isNative) return false; quiet(LiveActivity.update(state)); return true; },
      end()         { if (!isNative) return false; quiet(LiveActivity.end()); return true; },
    },

    // Icône de l'app (icônes alternatives d'iOS). Nom natif d'un jeu d'icônes ; null = icône par défaut.
    // get() : { supported, name } (hors app : { supported: false, name: null }).
    // set(name) : true une fois changée (iOS affiche lui-même une alerte), false sinon ou hors app.
    // Bips joués par iOS (audibles en mode silencieux, par-dessus la musique sans la couper).
    // available : faux dans le navigateur et dans une coquille plus ancienne que le module
    // (une mise à jour à chaud peut arriver avant la nouvelle build) : l'appelant garde alors le Web Audio.
    sound: {
      available: isNative && !!cap.isPluginAvailable?.('MdlfSound'),
      play(notes) { if (isNative) quiet(Sound.play({ notes })); },
    },

    // Compte MDLF : connexion avec Apple ou Google et session gardée dans le Trousseau (js/data/account.js).
    // available : faux dans le navigateur et dans une coquille plus ancienne que le module (une mise
    // à jour à chaud peut arriver avant la nouvelle build) : la rubrique Compte est alors masquée.
    account: {
      available: isNative && !!cap.isPluginAvailable?.('MdlfAccount'),
      // { identityToken, authorizationCode, user } ; null si l'utilisateur ferme la fenêtre d'Apple.
      // Autre échec : exception avec le message d'iOS.
      async signIn(nonce) {
        try { return await Account.signIn({ nonce }); }
        catch (e) { if (e?.code === 'CANCELED') return null; throw e; }
      },
      // Connexion Google (SDK GoogleSignIn) : { idToken } ; null si la fenêtre est fermée. Autre
      // échec : exception. Le nonce brut part haché vers Google, brut vers Supabase (comme Apple).
      async signInGoogle(nonce) {
        try { return await Account.signInGoogle({ nonce }); }
        catch (e) { if (e?.code === 'CANCELED') return null; throw e; }
      },
      // Bouton Google proposé ? Faux si le client Google n'est pas configuré (GIDClientID absent ou
      // valeur de remplacement dans Info.plist), dans une build sans la méthode, ou hors app.
      async googleAvailable() {
        if (!isNative) return false;
        try { return (await Account.googleStatus())?.available === true; } catch { return false; }
      },
      // 'authorized' | 'revoked' | 'notFound' | 'transferred' | 'unknown' (erreur : 'unknown')
      async credentialState(user) {
        try { return (await Account.credentialState({ user })).state || 'unknown'; } catch { return 'unknown'; }
      },
      // Stockage de la session pour supabase-js (getItem / setItem / removeItem, async). Une erreur de
      // lecture vaut « pas de session » : supabase-js n'attrape pas une exception de son stockage.
      storage: {
        async getItem(key) { try { return (await Account.getItem({ key })).value ?? null; } catch { return null; } },
        async setItem(key, value) { try { await Account.setItem({ key, value }); } catch { /* session gardée en mémoire */ } },
        async removeItem(key) { try { await Account.removeItem({ key }); } catch { /* déjà absente */ } },
      },
    },

    // Abonnements (StoreKit 2, docs/PAYANT_V1.md). L'app ne décide jamais d'un droit d'accès : elle ne
    // fait que transmettre au serveur la transaction signée par Apple (JWS), vérifiée par la fonction
    // Edge verify-purchase. available : faux dans le navigateur et dans une coquille plus ancienne que
    // le module (une mise à jour à chaud peut arriver avant la nouvelle build) : aucun achat proposé,
    // l'écran invite alors à utiliser l'app iPhone.
    store: {
      available: isNative && !!cap.isPluginAvailable?.('MdlfStore'),
      // { products: [{ id, displayName, description, displayPrice, price (nombre), currency,
      // period, introEligible }], missing: [identifiants inconnus d'Apple], canMakePayments }.
      // Le prix AFFICHABLE est `displayPrice` (déjà formaté par Apple dans la monnaie de la
      // boutique) ; `price` est un nombre. Tant que le contrat Paid Apps n'est pas signé, products
      // est VIDE et missing contient les deux identifiants : l'écran le dit, sans prix, sans planter.
      async products() {
        if (!this.available) return { products: [], missing: [], canMakePayments: false };
        try {
          const r = await Store.products();
          return { products: r?.products || [], missing: r?.missing || [],
            canMakePayments: r?.canMakePayments !== false };
        } catch { return { products: [], missing: [], canMakePayments: true }; }
      },
      // Ne rejette jamais sur annulation : { status: 'success' | 'userCancelled' | 'pending' }, avec
      // { jws, transactionId } quand status vaut 'success'. La transaction n'est PAS terminée ici :
      // c'est finish() qui le fait, une fois le serveur d'accord (un achat perdu par le réseau
      // revient au lancement suivant).
      async purchase(productId, appAccountToken = null) {
        if (!this.available) return null;
        try { return await Store.purchase({ productId, ...(appAccountToken ? { appAccountToken } : {}) }); }
        catch { return null; }
      },
      // OBLIGATOIRE après la vérification par le serveur : sans cet appel, Apple réannonce la même
      // transaction à chaque lancement.
      async finish(transactionId) {
        if (!this.available || transactionId == null) return false;
        try { await Store.finish({ transactionId }); return true; } catch { return false; }
      },
      // AppStore.sync() (mot de passe Apple demandé) puis les droits en cours :
      // { synced, cancelled, entitlements: [{ jws, transactionId, productId, … }], unverified }.
      // Le JWS est dans CHAQUE droit, jamais à la racine.
      async restore() {
        if (!this.available) return null;
        try { return await Store.restore(); } catch { return null; }
      },
      // Droits en cours (Transaction.currentEntitlements), sans rien demander à l'utilisateur :
      // { entitlements: [...], unverified }
      async current() {
        if (!this.available) return null;
        try { return await Store.current(); } catch { return null; }
      },
      // { canMakePayments, subscriptionIds }, sans aucun appel réseau. canMakePayments est
      // faux quand les achats sont bloqués (Temps d'écran) : l'écran ne doit rien proposer.
      async status() {
        if (!this.available) return null;
        try { return await Store.status(); } catch { return null; }
      },
      // Ouvre la feuille de codes d'offre d'ABONNEMENT d'Apple (un code cadeau MDLF, lui, se saisit
      // dans l'app). Renvoie { presented: true }, ou { presented: false, cancelled: true } si la
      // fenêtre est fermée : ce n'est PAS un succès. Le code utilisé revient par l'écouteur.
      async redeemCode() {
        if (!this.available) return null;
        try { return await Store.redeemCode(); } catch { return null; }
      },
      // Environnement de l'app selon StoreKit (AppTransaction) : 'production' (App Store), 'sandbox'
      // (TestFlight, ou Xcode avec un compte Sandbox), 'other' ou 'unknown'. null hors app iOS, ou dans
      // une coquille plus ancienne que la méthode (mise à jour à chaud arrivée avant la build). Sert
      // seulement à choisir l'environnement d'un code d'offre élève : aucune décision d'accès.
      async environment() {
        if (!this.available) return null;
        try { const r = await Store.environment(); return typeof r?.environment === 'string' ? r.environment : null; }
        catch { return null; }
      },
      // Écouteur permanent Transaction.updates : renouvellement, code utilisé, achat sur un autre
      // appareil. Le module émet le même événement sous deux noms ('transaction' et 'change') :
      // on s'abonne à UN SEUL, sinon chaque transaction serait traitée deux fois.
      onTransaction(cb) {
        if (this.available) quiet(Store.addListener('transaction', cb));
      },
    },

    appIcon: {
      async get() {
        if (!isNative) return { supported: false, name: null };
        try {
          const r = await AppIcon.getName();
          return { supported: r?.supported !== false, name: r?.name ?? null };
        } catch { return { supported: false, name: null }; }
      },
      async set(name) {
        if (!isNative) return false;
        try { await AppIcon.change({ name: name ?? null }); return true; } catch { return false; }
      },
    },

    // Mises à jour à chaud du contenu web (@capgo/capacitor-updater, mode manuel). Hors app : rien.
    // Numéro de build de l'app installée (CFBundleVersion, ex. 23) ; null hors app ou illisible
    async appBuild() {
      if (!isNative) return null;
      try { return parseInt((await AppInfo.getInfo()).build) || null; } catch { return null; }
    },

    ota: {
      // Confirme que le contenu en place démarre : sans cet appel sous 10 s, retour à la version précédente
      ready() { if (isNative) quiet(Updater.notifyAppReady()); },
      async current() {
        if (!isNative) return null;
        try { return await Updater.current(); } catch { return null; }
      },
      async list() {
        if (!isNative) return [];
        try { return (await Updater.list()).bundles || []; } catch { return []; }
      },
      async download({ url, version, checksum }) {
        if (!isNative) return null;
        try { return await Updater.download({ url, version, checksum }); } catch { return null; }
      },
      // Mise en file : installée quand les conditions de setMultiDelay sont remplies (voir
      // otaDelayConditions dans js/app/live-update.js), jamais pendant qu'on s'en sert
      async applyAtNextLaunch(id, delayConditions) {
        if (!isNative) return false;
        try {
          await Updater.next({ id });
          await Updater.setMultiDelay({ delayConditions });
          return true;
        } catch { return false; }
      },
      // Change les conditions d'une mise à jour déjà en file (début ou fin de séance)
      async setDelay(delayConditions) {
        if (!isNative) return false;
        try { await Updater.setMultiDelay({ delayConditions }); return true; } catch { return false; }
      },
      // Mise à jour en file ? (null sinon)
      async pending() {
        if (!isNative) return null;
        try { return await Updater.getNextBundle(); } catch { return null; }
      },
      // Appliquée tout de suite (l'app se recharge)
      async applyNow(id) {
        if (!isNative) return false;
        try { await Updater.set({ id }); return true; } catch { return false; }
      },
    },

    // Partage d'une image (story de fin de séance) par la feuille de partage d'iOS : Instagram,
    // Messages, Photos… L'image est écrite dans le dossier cache de l'app, puis son URL file://
    // est passée à Share.share({ files }) (capacitorjs.com/docs/apis/share : « Array of file://
    // URLs of the files to be shared » ; Filesystem.writeFile sans encoding attend du base64).
    // Renvoie 'shared', 'cancelled' (feuille fermée) ou 'failed' ; hors app : false, sans effet.
    async shareImage(dataUrl, fileName) {
      if (!isNative) return false;
      try {
        const base64 = String(dataUrl).replace(/^data:[^,]*,/, '');
        const { uri } = await Filesystem.writeFile({ path: fileName, data: base64, directory: 'CACHE' });
        await Share.share({ files: [uri] });
        return 'shared';
      } catch (e) {
        // Fermeture de la feuille sans choisir d'app : rejet « Share canceled » du module
        return /cancel/i.test(String(e?.message || e)) ? 'cancelled' : 'failed';
      }
    },

    // Partage d'un texte (programme envoyé à un ami) par la feuille de partage d'iOS.
    // Mêmes retours que shareImage : 'shared', 'cancelled' ou 'failed' ; hors app : false.
    async shareText(text, title) {
      if (!isNative) return false;
      try { await Share.share({ text, title }); return 'shared'; }
      catch (e) { return /cancel/i.test(String(e?.message || e)) ? 'cancelled' : 'failed'; }
    },

    // Ouvre une adresse https dans Safari, même APRÈS un appel réseau ou une feuille de confirmation.
    // window.open ne convient pas alors : WKWebView ne l'accepte que pendant le geste de l'utilisateur
    // (javaScriptCanOpenWindowsAutomatically, que Capacitor laisse à false sur iOS ; WebKit bloquait aussi
    // window.open dans un fetch().then() lancé par un clic, bug 302803 corrigé fin 2025, l'app vise iOS 16.4).
    // Dans l'app, une navigation de premier niveau vers un autre domaine est annulée par Capacitor et
    // confiée à Safari (WebViewDelegationHandler, decidePolicyFor : UIApplication.shared.open), sans
    // condition de geste : l'app reste sur sa page. Hors app : nouvel onglet. Adresse non https : rien.
    openOutside(url) {
      const u = String(url ?? '');
      if (!/^https:\/\/[^\s]+$/.test(u)) return false;
      if (isNative) window.location.assign(u);
      else window.open(u, '_blank');
      return true;
    },

    async readBackup() {
      if (!isNative) return null;
      try {
        const r = await Filesystem.readFile({ path: BACKUP_FILE, directory: BACKUP_DIR, encoding: 'utf8' });
        return typeof r.data === 'string' && r.data.length > 2 ? r.data : null;
      } catch { return null; }
    },
  };
})();
