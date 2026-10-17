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
  const Health             = plugin('MdlfHealth');   // module Swift de l'app (ios/App/App/HealthPlugin.swift)
  const Music              = plugin('MdlfMusic');    // module Swift de l'app (ios/App/App/MusicPlugin.swift)
  const LiveActivity       = plugin('MdlfLiveActivity'); // module Swift de l'app (ios/App/App/LiveActivityPlugin.swift)
  const Updater            = plugin('CapacitorUpdater'); // @capgo/capacitor-updater (mises à jour à chaud)

  // Un module natif indisponible ou en erreur ne doit jamais casser l'app web
  const quiet = promise => { promise?.catch?.(() => {}); };

  const REST_NOTIF_ID = 1;           // une seule notification de repos à la fois
  const BACKUP_FILE   = 'ppl_v2.json';
  let notifPermission = null;        // 'granted' | 'denied' | null (pas encore demandé)
  let backupTimer     = null;

  // Lu avant que store.js ne crée une donnée par défaut : sans donnée locale au démarrage,
  // la copie de sécurité ne doit pas être écrasée avant d'avoir tenté de la restaurer (boot).
  const hadLocalData = (() => { try { return !!localStorage.getItem('ppl_v2'); } catch { return false; } })();
  let backupEnabled  = hadLocalData;

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
    async scheduleRestEnd(endTime, body) {
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
          title: 'Repos terminé',
          body,
          schedule: { at: new Date(endTime), allowWhileIdle: true },
        }] });
      } catch {}
    },

    cancelRestEnd() {
      if (isNative) quiet(LocalNotifications.cancel({ notifications: [{ id: REST_NOTIF_ID }] }));
    },

    // Copie de sécurité des données dans les Documents de l'app (sauvegardés par iCloud).
    // Le stockage web d'iOS peut être vidé dans de rares cas ; ce fichier permet de tout retrouver.
    backup(json) {
      if (!isNative || !backupEnabled) return;
      clearTimeout(backupTimer);
      backupTimer = setTimeout(() => {
        quiet(Filesystem.writeFile({ path: BACKUP_FILE, data: json, directory: 'DOCUMENTS', encoding: 'utf8' }));
      }, 800);
    },

    // Au démarrage : stockage web vide mais copie présente (réinstallation, stockage vidé par iOS)
    // → la copie est remise en place et l'app recharge. Renvoie true si un rechargement est lancé.
    async boot() {
      if (!isNative) return false;
      if (!hadLocalData) {
        const json = await this.readBackup();
        if (json) {
          try { localStorage.setItem('ppl_v2', json); location.reload(); return true; } catch {}
        }
        backupEnabled = true;
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

    // Mises à jour à chaud du contenu web (@capgo/capacitor-updater, mode manuel). Hors app : rien.
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

    async readBackup() {
      if (!isNative) return null;
      try {
        const r = await Filesystem.readFile({ path: BACKUP_FILE, directory: 'DOCUMENTS', encoding: 'utf8' });
        return typeof r.data === 'string' && r.data.length > 2 ? r.data : null;
      } catch { return null; }
    },
  };
})();
