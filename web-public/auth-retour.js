// Retour d'une connexion par redirection qui a échoué chez Supabase (docs/COACH_WEB.md, « Connexion avec Google »).
// Quand Supabase ne retrouve plus la demande (bad_oauth_state : demande déjà servie ou effacée, par exemple le bouton
// Retour vers la page de Google), il ne sait plus d'où elle venait et renvoie sur son site_url, cette page, avec
// ?error=…&error_code=…&error_description=… (et la même chose dans l'ancre). La seule connexion par redirection du
// projet est celle du site du coach : la page y renvoie, pour qu'il dise quoi faire.
// Pas de redirection ouverte : destination fixe ; seuls error et error_code passent, et seulement s'ils sont faits de
// minuscules, chiffres et « _ » (64 caractères au plus) ; error_description (texte libre) n'est jamais repris.
(function () {
  var DEST = 'https://coach.mdlf.app/';
  var TOKEN = /^[a-z0-9_]{1,64}$/;
  function params(s) { try { return new URLSearchParams(s); } catch (e) { return null; } }
  var q = params(location.search), h = params(location.hash.slice(1));
  function pick(k) { var v = (q && q.get(k)) || (h && h.get(k)) || ''; return TOKEN.test(v) ? v : ''; }
  var error = pick('error');
  if (!error) return;
  var code = pick('error_code');
  location.replace(DEST + '?error=' + error + (code ? '&error_code=' + code : ''));
})();
