// ═══════════════════════════════════════════════════════════
//  MDLF Coach sur ordinateur : environnement des scripts partagés avec l'app iPhone (docs/COACH_WEB.md)
//
//  L'appli web charge, dans l'ordre d'index.html de l'app, un sous-ensemble de js/data/ (calculs, nettoyage de ce
//  que rend le serveur, formats, accords). Ces scripts attendent trois noms de js/data/account.js, qui n'est PAS
//  chargé ici (il porte la synchro des séances de l'iPhone, le Trousseau, les copies sur l'appareil) :
//  - `sb` : le client Supabase, posé par js/desk/api.js à la connexion ;
//  - `account` : laissé à { user: null } exprès. Les écouteurs des modules partagés (coachRefresh au retour au
//    premier plan, envoi des pesées d'un élève, caches mdlf_* en localStorage) ne font rien sans `account.user` :
//    aucune donnée d'élève n'est copiée sur un ordinateur parfois partagé. L'appli web lit le serveur par ses
//    propres appels (deskRpc) et ne garde rien hors de la mémoire de l'onglet ;
//  - `onAccountChange` : sans effet (une connexion ou une déconnexion recharge la page, la mémoire repart de zéro).
//  Et un nom de js/data/age-range.js (pas chargé non plus) : `chatHiddenByAge`, toujours faux. Le contrôle parental
//  « Limites de communication » est une réponse d'Apple propre à un iPhone d'enfant ; un compte coach validé sur un
//  ordinateur n'en a pas (les règles de la messagerie, js/data/coach-chat.js, restent sinon les mêmes).
//  Test : tests/unit/coach-web.mjs (chargement de cette liste exacte, aucune écriture dans localStorage).
// ═══════════════════════════════════════════════════════════
'use strict';

let sb = null;
const account = Object.freeze({ user: null });
function onAccountChange() { /* voir l'en-tête : la page se recharge à chaque changement de compte */ }
function chatHiddenByAge() { return false; }
