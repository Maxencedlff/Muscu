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
  let cloudReady     = isNative && (getItem(CLOUD_READY) === '1' || sessionCount(localAtStart) > 0);
  let cloudErase     = false;   // « Supprimer toutes les données » : vider aussi la copie iCloud
  if (cloudReady) setItem(CLOUD_READY, '1');

  const openCloud = () => { if (!cloudReady) { cloudReady = true; setItem(CLOUD_READY, '1'); } };

  // Remet une copie dans le stockage web puis recharge l'app ; plus aucune écriture d'ici là
  const restore = json => {
    clearTimeout(backupTimer);
    const was = backupEnabled;
    backupEnabled = false;
    if (setItem('ppl_v2', json)) { location.reload(); return true; }
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

    // Apple Santé : autorisation, entraînement « Musculation », pesées (kg). Hors app : rien.
    health: {
      async authorize() {
        if (!isNative) return { available: false, workouts: false };
        try { return await Health.requestAuthorization(); } catch { return { available: false, workouts: false }; }
      },
      async saveWorkout({ start, end, kcal = 0 }) {
        if (!isNative) return false;
        try { return !!(await Health.saveWorkout({ start, end, kcal })).saved; } catch { return false; }
      },
      async bodyMass(days = 90) {
        if (!isNative) return [];
        try { return (await Health.bodyMass({ days })).samples || []; } catch { return []; }
      },
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
      // Appliquée au prochain lancement de l'app (jamais pendant qu'on s'en sert)
      async applyAtNextLaunch(id) {
        if (!isNative) return false;
        try {
          await Updater.next({ id });
          await Updater.setMultiDelay({ delayConditions: [{ kind: 'kill' }] });
          return true;
        } catch { return false; }
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

    async readBackup() {
      if (!isNative) return null;
      try {
        const r = await Filesystem.readFile({ path: BACKUP_FILE, directory: 'DOCUMENTS', encoding: 'utf8' });
        return typeof r.data === 'string' && r.data.length > 2 ? r.data : null;
      } catch { return null; }
    },
  };
})();
