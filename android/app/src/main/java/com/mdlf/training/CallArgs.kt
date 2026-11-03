package com.mdlf.training

import com.getcapacitor.PluginCall

/*
 * Lecture des nombres envoyés par le web, commune aux modules maison.
 *
 * Pourquoi pas PluginCall.getDouble / getLong : dans Capacitor 8.5.3 (PluginCall.java), getDouble ne
 * convertit que Double, Float et Integer, getLong que Long, et tous deux rendent la valeur par défaut
 * (null) pour le reste. Or org.json lit un nombre JSON sans virgule en Integer s'il tient sur 32 bits,
 * en Long sinon : un horodatage Date.now() (≈ 1,76e12, entier) arrive en Long, et getDouble rend null.
 * JSONObject.optDouble accepte tout Number (et une chaîne numérique) : c'est la seule lecture sûre.
 * Le test unitaire « android : nombres lus sans getDouble » (tests/unit/android.mjs) interdit le retour
 * de ces appels dans les fichiers .kt.
 */

/** Horodatage en millisecondes depuis 1970 (entier ou décimal côté web) ; null s'il manque ou n'est pas > 0. */
internal fun PluginCall.epochMillis(key: String): Long? {
    val value = data.optDouble(key, Double.NaN)
    return if (value.isFinite() && value > 0) value.toLong() else null
}

/** Nombre quelconque (entier ou décimal côté web) ; [fallback] s'il manque ou n'est pas un nombre fini. */
internal fun PluginCall.number(key: String, fallback: Double): Double {
    val value = data.optDouble(key, Double.NaN)
    return if (value.isFinite()) value else fallback
}
