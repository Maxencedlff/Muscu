'use strict';

// Pont vers les fonctions natives d'iOS quand l'app tourne dans sa coquille Capacitor (App Store).
// Dans le navigateur (PWA), Native.isNative vaut false et chaque fonction ne fait rien :
// l'app web garde exactement son comportement.
//
// Les modules natifs sont joints sans bundler : window.Capacitor (injecté par la coquille iOS)
// fournit registerPlugin(nom), qui relaie les appels vers le code Swift du module.

const Native = (() => {
  const cap      = window.Capacitor;
  // Sans le runtime JS de Capacitor (registerPlugin), l'app se comporte comme la version web
  const isNative = !!cap?.isNativePlatform?.() && typeof cap.registerPlugin === 'function';
  const plugin   = name => (isNative ? cap.registerPlugin(name) : null);

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
  const Push               = plugin('MdlfPush');      // module Swift de l'app (ios/App/App/PushPlugin.swift), build qui suit le 31/10/2026
  const Watch              = plugin('MdlfWatch');     // module Swift de l'app (ios/App/AppExtras/WatchPlugin.swift), build avec l'Apple Watch
  const Widget             = plugin('MdlfWidget');    // module Swift de l'app (ios/App/AppExtras/WidgetPlugin.swift), même build
  const Shortcuts          = plugin('MdlfShortcuts'); // module Swift de l'app (ios/App/AppExtras/ShortcutsPlugin.swift), même build
  const Vault              = plugin('MdlfVault');     // module Swift de l'app (ios/App/App/VaultPlugin.swift), build qui suit la 31
  // Module présent dans la coquille installée (une mise à jour à chaud peut arriver avant la build qui l'apporte)
  const has          = name => isNative && !!cap.isPluginAvailable?.(name);
  const hasWatch     = has('MdlfWatch');
  const hasWidget    = has('MdlfWidget');
  const hasShortcuts = has('MdlfShortcuts');
  const hasVault     = has('MdlfVault');
  const Updater            = plugin('CapacitorUpdater'); // @capgo/capacitor-updater (mises à jour à chaud)
  const AppInfo            = plugin('App');              // @capacitor/app : numéro de build installé

  // Un module natif indisponible ou en erreur ne doit jamais casser l'app web
  const quiet = promise => { promise?.catch?.(() => {}); };

  // Coffre à photos : appel au module, réponse réduite à { key } ou à la raison de l'échec
  const VAULT_ERRORS = { CANCELED: 'canceled', NOT_FOUND: 'missing', NO_PASSCODE: 'nopasscode' };
  const vaultCall = async (method, reason) => {
    if (!hasVault) return { failed: true };
    try {
      const r = await Vault[method]({ reason });
      return typeof r?.key === 'string' && r.key ? { key: r.key } : { failed: true };
    } catch (e) { return { [VAULT_ERRORS[e?.code] || 'failed']: true }; }
  };

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
  let cloudReady     = isNative && (getItem(CLOUD_READY) === '1' || sessionCount(localAtStart) > 0);
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
        quiet(Filesystem.writeFile({ path: BACKUP_FILE, data: json, directory: 'DOCUMENTS', encoding: 'utf8' }));
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
        if (!file) {
          const { json, synced } = await readCloud(CLOUD_WAIT_MS);
          if (json && restore(json)) return true;
          if (synced) openCloud();
        }
        backupEnabled = true;
      }
      // Changement venu d'iCloud (autre iPhone, autre compte) : l'empreinte ne dit plus ce
      // qu'iCloud contient, le prochain enregistrement renverra la donnée de cet iPhone
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

    // Apple Santé : autorisation, entraînement « Musculation », pesées (kg), courses et sorties vélo. Hors app : rien.
    health: {
      // workouts : false pour ne demander que le poids et l'écriture (sans la lecture des courses et du vélo)
      async authorize({ workouts = true } = {}) {
        if (!isNative) return { available: false, workouts: false };
        try { return await Health.requestAuthorization({ workouts }); } catch { return { available: false, workouts: false }; }
      },
      // Fenêtre d'autorisation encore à montrer pour un type : 'shouldRequest', 'unnecessary' (tout a été
      // demandé) ou 'unknown' (échec, build antérieure sans la méthode, navigateur). Ne montre rien.
      // which : 'request' (poids, écriture, courses et vélo) ou 'extra' (sommeil et distances du cardio,
      // build qui suit le 31/10/2026 : 'unknown' sur une build antérieure).
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

    // Notifications push (APNs). Hors app, ou build antérieure sans le module : available() vaut false et rien
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

    // Apple Music : morceau en cours et commandes du lecteur de l'app Musique. Hors app : rien.
    music: {
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

    // Apple Watch (WatchConnectivity) : la séance en cours part vers la montre, ses gestes reviennent.
    // available : faux dans le navigateur et dans une coquille plus ancienne que le module (une mise à
    // jour à chaud peut arriver avant la build) : rien n'est alors envoyé ni écouté.
    //   send(json)   : état de la séance (JSON de watchState, js/features/watch.js)
    //   onAction(cb) : geste de la montre { type, at, ei?, si?, d? } ; onRequest(cb) : la montre redemande l'état
  //   (écoutés seulement une fois la séance restaurée : watchBoot, js/features/watch.js)
    watch: {
      available: hasWatch,
      send(json) { if (hasWatch) quiet(Watch.send({ state: json })); },
      onAction(cb) {
        if (hasWatch) quiet(Watch.addListener('action', a => { try { cb(a); } catch { /* geste ignoré */ } }));
      },
      onRequest(cb) {
        if (hasWatch) quiet(Watch.addListener('request', () => { try { cb(); } catch { /* rien à renvoyer */ } }));
      },
    },

    // Widget (écran d'accueil, écran verrouillé) : instantané JSON laissé dans le trousseau partagé (js/features/home-widget.js)
    widget: {
      available: hasWidget,
      setSnapshot(json) { if (hasWidget) quiet(Widget.setSnapshot({ snapshot: json })); },
    },

    // Siri et Raccourcis : demande laissée par « Démarrer ma séance » (js/features/siri.js).
    //   takeRequest() : { action, at } une seule fois, puis null ; null aussi hors app ou sans le module
    //   onRequest(cb) : une demande vient d'arriver, app déjà ouverte
    shortcuts: {
      available: hasShortcuts,
      async takeRequest() {
        if (!hasShortcuts) return null;
        try { const r = await Shortcuts.takeRequest(); return r?.action ? { action: String(r.action), at: Number(r.at) } : null; }
        catch { return null; }
      },
      onRequest(cb) {
        if (hasShortcuts) quiet(Shortcuts.addListener('request', () => { try { cb(); } catch { /* app ouverte simplement */ } }));
      },
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

    // Coffre à photos (js/data/photo-vault.js) : clé du coffre dans le trousseau d'iOS, rendue après Face ID
    // ou le code de l'iPhone, et écran de confidentialité. available : faux dans le navigateur et dans une
    // coquille sans le module ; le coffre est alors indisponible (aucune clé ailleurs que dans le trousseau).
    vault: {
      available: hasVault,
      // { biometry: 'faceID' | 'touchID' | 'opticID' | 'none', passcode: code de l'iPhone en place } ; en cas
      // d'erreur, passcode vrai : l'ouverture dira elle-même ce qui manque
      async status() {
        if (!hasVault) return { biometry: 'none', passcode: false };
        try { const r = await Vault.status(); return { biometry: r?.biometry || 'none', passcode: r?.passcode !== false }; }
        catch { return { biometry: 'none', passcode: true }; }
      },
      // Création (create) ou ouverture (unlock) : { key } (base64, 32 octets) ; sinon { canceled } (annulé,
      // app quittée), { missing } (pas de clé sur cet iPhone), { nopasscode } (aucun code sur l'iPhone),
      // { failed } (le reste, module absent compris)
      async create(reason) { return vaultCall('create', reason); },
      async unlock(reason) { return vaultCall('unlock', reason); },
      async forget() { if (hasVault) { try { await Vault.forget(); } catch { /* déjà absente */ } } },
      // Écran de confidentialité natif (flou posé par iOS avant la capture du sélecteur d'apps)
      shield(on) { if (hasVault) quiet(Vault.shield({ on: !!on })); },
    },

    // App active ou non (@capacitor/app, appStateChange : false dès le sélecteur d'apps ou le Centre de
    // contrôle, avant l'arrière-plan). Hors app : rien (le navigateur a visibilitychange).
    onActiveChange(cb) {
      if (isNative && AppInfo) quiet(AppInfo.addListener('appStateChange', s => { try { cb(!!s?.isActive); } catch { /* écran redessiné ensuite */ } }));
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

    async readBackup() {
      if (!isNative) return null;
      try {
        const r = await Filesystem.readFile({ path: BACKUP_FILE, directory: 'DOCUMENTS', encoding: 'utf8' });
        return typeof r.data === 'string' && r.data.length > 2 ? r.data : null;
      } catch { return null; }
    },
  };
})();
