// ═══════════════════════════════════════════════════════════
//  Commentaires sur une séance (Social V1.2) : appels au serveur et logique pure, sans affichage
//
//  - Contrat : docs/SOCIAL_V1.md, section « Commentaires » ; serveur :
//    supabase/migrations/20261031500000_commentaires.sql. Tout passe par les RPC list_comments,
//    add_comment, delete_comment et report_comment (socialRpc de js/data/social.js : même compte,
//    mêmes erreurs traduites).
//  - Qui écrit et qui lit : le propriétaire de la séance et ses abonnés acceptés, sur une séance
//    visible ; un commentaire disparaît quand son auteur ne voit plus la séance ; blocage respecté
//    dans les deux sens. Le serveur décide : l'app n'affiche que ce qu'il renvoie, nettoyé
//    (cleanComment), et l'écran échappe tout texte (esc).
//  - Texte : nettoyé comme le serveur (commentClean), 500 caractères au plus (COMMENT_MAX, compté en
//    caractères comme char_length). Mots interdits : liste tenue côté serveur seulement (refus
//    comment_forbidden, traduit), jamais copiée dans l'app.
//  - Fils par séance : { rows (du plus ancien au plus récent), end (rien de plus ancien), loading,
//    error, loadedAt, triedAt }, clé owner/id. Pas de temps réel : relus à l'ouverture de la séance (30 s au plus).
//  - Supprimer : affiché tout de suite, remis si le serveur refuse. Signaler : masqué tout de suite ici
//    pour celui qui signale ; list_comments ne le lui renvoie plus ensuite (même après redémarrage), et le
//    serveur le masque pour tous au 3e signalement.
//  - L'écran (js/features/comments-ui.js) s'abonne par onSocialChange : chaque changement appelle
//    notifySocial.
// ═══════════════════════════════════════════════════════════
'use strict';

const COMMENT_MAX = 500;           // caractères (comme la contrainte du serveur)
const COMMENT_PAGE = 30;           // commentaires par page (comme list_comments)
const COMMENT_WARN = 450;          // compteur affiché à partir de là
const COMMENTS_REFRESH_MS = 30_000;

// threads : fils par clé owner/id ; reported : commentaires que j'ai signalés (cachés ici tout de suite ; le serveur ne me les renvoie plus)
const comments = { userId: null, threads: {}, reported: new Set(), busy: false };
let commentsSeq = 0;   // +1 au changement de compte : une réponse arrivée après n'écrit plus rien

// ── Logique pure ────────────────────────────────────────────

// Texte tel que le serveur le gardera : \r retirés, trois retours à la ligne ou plus → deux, espaces,
// tabulations et retours à la ligne retirés autour (private.comment_clean)
function commentClean(t) {
  return String(t ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/^[ \t\n]+|[ \t\n]+$/g, '');
}
// Longueur en caractères (points de code), comme char_length côté Postgres
function commentLength(t) { return [...commentClean(t)].length; }
// Problème du brouillon avant envoi : 'empty', 'too_long' ou null
function commentProblem(t) {
  const n = commentLength(t);
  return !n ? 'empty' : n > COMMENT_MAX ? 'too_long' : null;
}

// Brouillon à garder après un envoi réussi (commentaire ou message) : le champ reste modifiable
// pendant l'envoi, ce qui a été tapé après le texte envoyé n'est jamais effacé. current : le champ au
// retour du serveur ; sent : le texte envoyé. Champ inchangé : vide ; texte ajouté à la suite : la suite ;
// texte envoyé modifié entre-temps : tout le champ (rien de perdu, l'utilisateur choisit).
function draftAfterSend(current, sent) {
  const now = String(current ?? ''), was = String(sent ?? '');
  if (now === was) return '';
  if (was && now.startsWith(was)) return now.slice(was.length).replace(/^[ \t\n]+/, '');
  return now;
}

// Ligne de list_comments (ou réponse d'add_comment) : { id, user_id, username, avatar, body, at, mine,
// canDelete, masked }, null si inutilisable
function cleanComment(r) {
  if (!r || typeof r !== 'object') return null;
  const id = Number(r.id);
  const p = cleanPerson(r);
  const at = Date.parse(r.at);
  if (!Number.isSafeInteger(id) || id <= 0 || !p || typeof r.body !== 'string' || !r.body || !Number.isFinite(at)) return null;
  return { id, user_id: p.user_id, username: p.username, avatar: p.avatar, body: [...r.body].slice(0, COMMENT_MAX).join(''), at,
    mine: r.mine === true, canDelete: r.can_delete === true, masked: r.masked === true };
}

function commentKey(owner, id) { return `${owner}/${id}`; }

// Réponses rapides sous la séance d'un ami : un toucher envoie un commentaire ordinaire (add_comment :
// mêmes règles, mots interdits, limites et blocage que le texte tapé). « Gros record ! » seulement quand
// la séance bat un record. Une réponse que j'ai déjà laissée sur cette séance n'est plus proposée.
// Toute phrase ajoutée ici entre aussi dans tests/sql/commentaires_test.sql (acceptée par le filtre du
// serveur ; tests/unit/comments.mjs le vérifie).
const COMMENT_QUICK = ['Belle séance 💪', 'Régulier 🔥', 'Respect', 'Lâche rien'];
const COMMENT_QUICK_RECORD = 'Gros record !';
function quickComments(rows, { record = false } = {}) {
  const said = new Set((rows || []).filter(c => c?.mine).map(c => commentClean(c.body)));
  return [...(record ? [COMMENT_QUICK_RECORD] : []), ...COMMENT_QUICK].filter(t => !said.has(t));
}

// ── Fils ────────────────────────────────────────────────────

function commentsOf(owner, id) {
  return comments.threads[commentKey(owner, id)] ||= { rows: [], end: false, loading: false, error: null, loadedAt: 0, triedAt: 0 };
}
// Commentaires montrés (sans ceux que j'ai signalés)
function commentsShown(owner, id) {
  return commentsOf(owner, id).rows.filter(c => !comments.reported.has(c.id));
}

function commentsReset(userId) {
  commentsSeq++;
  Object.assign(comments, { userId, threads: {}, reported: new Set(), busy: false });
}

// Première page (les plus récents) ou la suivante (more : plus anciens que le plus ancien affiché).
// minAge : pas de relecture si le fil a moins de minAge ms. Renvoie { ok } ou { ok: false, kind }.
async function commentsLoad(owner, id, { more = false, minAge = 0 } = {}) {
  const t = commentsOf(owner, id);
  if (t.loading || (more && t.end)) return { ok: true };
  // minAge compte aussi depuis le dernier essai : un fil en erreur ne se relance pas à chaque dessin
  if (!more && minAge && Date.now() - Math.max(t.loadedAt, t.triedAt) < minAge) return { ok: true };
  t.loading = true;
  t.triedAt = Date.now();
  const seq = commentsSeq;
  notifySocial();
  const args = { owner, session_id: id };
  if (more && t.rows.length) args.before_id = t.rows[0].id;
  const r = await socialRpc('list_comments', args);
  if (seq !== commentsSeq) return { ok: false, kind: 'signed_out' };
  t.loading = false;
  if (!r.ok) { t.error = r.kind; notifySocial(); return r; }
  const raw = Array.isArray(r.data) ? r.data : [];
  const page = raw.map(cleanComment).filter(Boolean).sort((a, b) => a.id - b.id);
  rememberPeople(page);
  if (more) {
    const known = new Set(t.rows.map(c => c.id));
    t.rows = [...page.filter(c => !known.has(c.id)), ...t.rows];
    t.end = raw.length < COMMENT_PAGE;
  } else if (raw.length < COMMENT_PAGE) {
    // Tout le fil tient dans la page
    t.rows = page;
    t.end = true;
  } else {
    // Relecture d'un long fil : la page des plus récents remplace ce qu'elle couvre, les plus anciens
    // déjà chargés restent (et « Afficher les précédents » garde son état)
    const older = t.rows.filter(c => c.id < page[0].id);
    t.rows = [...older, ...page];
    if (!older.length) t.end = false;
  }
  t.error = null;
  t.loadedAt = Date.now();
  notifySocial();
  return { ok: true };
}

// Envoyer : vérifié ici (vide, trop long), puis par le serveur (mots interdits, limites, séance encore
// visible). Le commentaire arrive en bas du fil. Renvoie { ok, data: commentaire } ou { ok: false, kind }.
async function commentsAdd(owner, id, text) {
  const problem = commentProblem(text);
  if (problem) return { ok: false, kind: problem === 'empty' ? 'empty_comment' : 'too_long' };
  if (comments.busy) return { ok: false, kind: 'busy' };
  comments.busy = true;
  const seq = commentsSeq;
  const r = await socialRpc('add_comment', { owner, session_id: id, body: commentClean(text) });
  if (seq !== commentsSeq) return { ok: false, kind: 'signed_out' };
  comments.busy = false;
  if (!r.ok) { notifySocial(); return r; }
  const c = cleanComment(r.data);
  if (!c) { notifySocial(); return { ok: false, kind: 'server' }; }
  const t = commentsOf(owner, id);
  if (!t.rows.some(x => x.id === c.id)) t.rows = [...t.rows, c].sort((a, b) => a.id - b.id);
  notifySocial();
  return { ok: true, data: c };
}

// Supprimer (le mien, ou n'importe lequel sur ma séance) : retiré tout de suite, remis si le serveur refuse
async function commentsDelete(owner, id, commentId) {
  const t = commentsOf(owner, id);
  const before = t.rows;
  t.rows = t.rows.filter(c => c.id !== commentId);
  notifySocial();
  const r = await socialRpc('delete_comment', { comment_id: commentId });
  if (!r.ok || r.data !== true) {
    t.rows = before;
    notifySocial();
    return r.ok ? { ok: false, kind: 'not_found' } : r;
  }
  return { ok: true };
}

// Signaler un commentaire d'un autre : caché ici pour moi tout de suite. Le serveur garde une copie du
// texte et renvoie l'id du signalement (null : déjà signalé par moi) ; l'alerte par e-mail est demandée
// ensuite à la fonction Edge report, au mieux (socialReportAlert)
async function commentsReport(owner, id, commentId, reason) {
  if (!REPORT_REASONS.some(x => x.reason === reason)) return { ok: false, kind: 'server' };
  const r = await socialRpc('report_comment', { comment_id: commentId, reason });
  if (!r.ok) return r.kind === 'rate_limited' ? { ok: false, kind: 'report_rate' } : r;
  comments.reported.add(commentId);
  notifySocial();
  if (Number.isSafeInteger(r.data)) socialReportAlert(r.data);
  return { ok: true };
}

// Personne bloquée ou abonné retiré : ses commentaires partent tout de suite de tous les fils (le
// serveur fait de même à la relecture)
function commentsForget(uid) {
  for (const t of Object.values(comments.threads)) t.rows = t.rows.filter(c => c.user_id !== uid);
}

// ── Déclencheurs ────────────────────────────────────────────

onAccountChange(() => {
  const id = account.user?.id || null;
  if (id !== comments.userId) commentsReset(id);
});
