// ═══════════════════════════════════════════════════════════
//  Widget de l'écran d'accueil et de l'écran verrouillé (app iOS)
// ═══════════════════════════════════════════════════════════
'use strict';

// Le widget n'exécute pas l'app : il lit un petit instantané qu'elle lui laisse dans un espace partagé
// (App Group), puis iOS le redessine seul aux heures prévues. Côté natif : ios/App/AppExtras/WidgetPlugin.swift
// (écriture) et ios/App/Widgets/ (dessin). Rien ne part au serveur.
//
// L'instantané est écrit quand l'app passe en arrière-plan (c'est là que l'écran d'accueil réapparaît)
// et au démarrage ; il n'est réécrit que s'il a changé.

const WIDGET_VERSION = 1;
const WIDGET_MAX_TITLE = 40;

// Instantané du widget (logique pure, testée dans tests/unit/companions.mjs). Textes bruts et bornés.
//   next   : prochaine séance (celle de l'accueil), readyAt = heure où ses muscles seront reposés (0 : prête)
//   week   : séances de la semaine (lundi → dimanche) face à l'objectif, une couleur par jour fait ;
//            end = lundi suivant, où le widget repart à zéro sans attendre l'app
//   active : séance en cours, le widget propose alors de la reprendre
function widgetSnapshot(now = Date.now()) {
  const keys = sessionKeys(), cat = nextSessionCat(keys);
  const st = cat ? catStatus(cat, now) : null;
  const ws = weekStats(now), monday = weekStart(now);
  const tint = (c, p) => restActivityTint(sessionMeta(c, p).color);
  return {
    v: WIDGET_VERSION,
    at: now,
    next: cat ? {
      title: rawLabel(cat).slice(0, WIDGET_MAX_TITLE),
      tint: tint(cat),
      exercises: (prog().exercises[cat] || []).length,
      readyAt: st && !st.ready ? Math.round(st.readyAt) : 0,
    } : null,
    week: {
      count: ws.count,
      goal: weeklyGoal(),
      days: ws.days.map(d => (d[0] ? tint(d[0].category, entryProg(d[0])) : null)),
      start: monday,
      end: addDays(monday, 7),
    },
    active: activeSession ? {
      title: rawLabel(activeSession.category, activeSession.programme).slice(0, WIDGET_MAX_TITLE),
      tint: tint(activeSession.category, activeSession.programme),
      startedAt: activeSession.startedAt,
    } : null,
  };
}

// Instantané sans l'heure d'écriture : sert à ne rien réécrire (ni faire redessiner) s'il n'a pas changé
let widgetLastKey = '';

function syncWidget() {
  if (!Native.widget.available || dataBroken) return;
  let snap;
  try { snap = widgetSnapshot(); } catch { return; }   // le widget garde alors son dernier instantané
  const key = JSON.stringify({ ...snap, at: 0 });
  if (key === widgetLastKey) return;
  widgetLastKey = key;
  Native.widget.setSnapshot(JSON.stringify(snap));
}

// Écouteurs posés seulement avec un vrai document (les tests unitaires chargent ce fichier sans)
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') syncWidget(); });
  // Démarrage : après le chargement de tous les scripts et la restauration de la séance (init.js)
  document.addEventListener('DOMContentLoaded', () => setTimeout(syncWidget, 0));
}
