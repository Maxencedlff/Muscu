package com.mdlf.training

import android.graphics.Color
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

/**
 * Politique de confidentialité montrée par Health Connect (lien « Règles de confidentialité » de sa
 * fenêtre d'autorisation). Exigée par Health Connect : sans cette activité, il refuse d'afficher la
 * fenêtre. C'est la page privacy.html embarquée avec l'app (dist/, copiée par cap sync) : la même
 * que sur le web et sur iOS, lisible hors ligne. JavaScript coupé : la page n'en a pas besoin.
 */
class PermissionsRationaleActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = false
            settings.allowFileAccess = false
            // Liens de la page : restent dans cette vue (aucune navigation vers l'extérieur)
            webViewClient = WebViewClient()
            loadUrl("file:///android_asset/public/privacy.html")
        }
        setContentView(web)
    }
}
