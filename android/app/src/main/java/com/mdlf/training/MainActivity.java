package com.mdlf.training;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Modules maison (Kotlin), enregistrés avant super.onCreate comme le demande Capacitor.
        // Même nom côté web que sur iOS : js/platform/native.js n'a qu'une liste de modules.
        registerPlugin(HealthPlugin.class);        // MdlfHealth : Health Connect
        registerPlugin(LiveActivityPlugin.class);  // MdlfLiveActivity : repos en cours (notification)
        registerPlugin(StorePlugin.class);         // MdlfStore : Google Play Billing (non branché au serveur)
        super.onCreate(savedInstanceState);
    }
}
