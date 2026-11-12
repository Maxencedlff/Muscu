// Règles du signalement (logique pure, sans réseau), appliquées par index.ts (Deno) et testées par
// tests/unit/report.mjs (Node). Contrat : docs/SOCIAL_V1.md, fonction Edge report.
//
// 1. Entrée : { target_user: uuid, kind: 'profile' | 'session', target_ref?: texte (1 à 64 caractères),
//    reason: un motif de REPORT_REASONS, details?: texte (500 caractères au plus) }. Les mêmes bornes
//    sont vérifiées par la table public.reports (contraintes check) : la validation ici donne une
//    erreur claire (400) avant d'écrire, la base reste la dernière barrière.
// 2. On ne se signale pas soi-même. Clés inconnues ignorées (jamais recopiées).
// 2 bis. Alerte d'un signalement déjà enregistré par le serveur (report_comment, report_chat : copie
//    du commentaire ou des messages gardée côté serveur) : { report_id: entier > 0 } seul
//    (validateAlert). La ligne doit appartenir à l'appelant (vérifié par index.ts).
// 3. E-mail d'alerte à l'équipe : texte brut en français, pseudo signalé, motif, référence et rappel
//    du délai de 24 h. Aucune ligne ne commence par un tiret. Les détails écrits par l'utilisateur
//    restent dans le corps du texte (jamais dans l'objet) et sont aplatis sur une ligne.

export const REPORT_REASONS = Object.freeze({
  spam: 'Spam',
  harcelement: 'Harcèlement',
  sexuel: 'Contenu sexuel',
  violence: 'Violence',
  haine: 'Haine',
  autre: 'Autre',
});
export const REPORT_KINDS = Object.freeze({ profile: 'Profil', session: 'Séance' });
export const DETAILS_MAX = 500;
export const TARGET_REF_MAX = 64;
export const REPORTS_PER_DAY = 10;
export const RESPONSE_DELAY_H = 24;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Longueur en caractères (points de code), comme char_length côté Postgres
const length = (s) => [...s].length;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Texte facultatif : absent, null ou vide après nettoyage → null ; sinon chaîne nettoyée, ou
// undefined si le type ou la longueur est faux.
function optionalText(v, max) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return null;
  return length(t) <= max ? t : undefined;
}

// { ok: true, value: { target_user, kind, target_ref, reason, details } } ou { ok: false, error, field }
/**
 * Types lus par `deno check` (fonctions Edge) ; aucun effet à l'exécution.
 * @param {any} body
 * @param {string} [callerId]
 * @returns {{ ok: false, error: 'invalid', field: string } | { ok: true, value: { target_user: string, kind: string,
 *   target_ref: string | null, reason: string, details: string | null } }}
 */
export function validateReport(body, callerId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid', field: 'body' };
  const target = body.target_user;
  if (typeof target !== 'string' || !UUID_RE.test(target)) return { ok: false, error: 'invalid', field: 'target_user' };
  if (callerId && target.toLowerCase() === String(callerId).toLowerCase()) return { ok: false, error: 'invalid', field: 'target_user' };
  if (typeof body.kind !== 'string' || !own(REPORT_KINDS, body.kind)) return { ok: false, error: 'invalid', field: 'kind' };
  if (typeof body.reason !== 'string' || !own(REPORT_REASONS, body.reason)) return { ok: false, error: 'invalid', field: 'reason' };
  const targetRef = optionalText(body.target_ref, TARGET_REF_MAX);
  if (targetRef === undefined) return { ok: false, error: 'invalid', field: 'target_ref' };
  const details = optionalText(body.details, DETAILS_MAX);
  if (details === undefined) return { ok: false, error: 'invalid', field: 'details' };
  return { ok: true, value: { target_user: target.toLowerCase(), kind: body.kind, target_ref: targetRef, reason: body.reason, details } };
}

// Demande d'alerte : { ok: true, value: { report_id } } si body est exactement { report_id: entier > 0 },
// null si body n'en est pas une (c'est alors un signalement complet, validateReport), sinon
// { ok: false, error: 'invalid', field: 'report_id' }
/**
 * Types lus par `deno check` (fonctions Edge) ; aucun effet à l'exécution.
 * @param {any} body
 * @returns {null | { ok: false, error: 'invalid', field: 'report_id' } | { ok: true, value: { report_id: number } }}
 */
export function validateAlert(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !own(body, 'report_id')) return null;
  const id = body.report_id;
  if (!Number.isSafeInteger(id) || id <= 0 || Object.keys(body).length !== 1) return { ok: false, error: 'invalid', field: 'report_id' };
  return { ok: true, value: { report_id: id } };
}

// Une ligne : retours à la ligne et caractères de contrôle remplacés par des espaces
// eslint-disable-next-line no-control-regex -- les caractères de contrôle sont justement ceux à retirer
const oneLine = (s) => String(s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();

// E-mail d'alerte : { subject, text }. report : ligne insérée (id, reporter_id, target_user,
// target_username, kind, target_ref, reason, details, created_at).
export function reportEmail(report) {
  const who = report.target_username ? `@${report.target_username}` : 'compte sans pseudo';
  const reason = REPORT_REASONS[report.reason] ?? oneLine(report.reason);
  const kind = REPORT_KINDS[report.kind] ?? oneLine(report.kind);
  const lines = [
    `Nouveau signalement n° ${report.id} dans MDLF Training.`,
    '',
    `Compte signalé : ${who} (identifiant ${report.target_user})`,
    `Motif : ${reason}`,
    `Type : ${kind}`,
    `Référence : ${report.target_ref ? oneLine(report.target_ref) : 'aucune'}`,
    `Détails : ${report.details ? oneLine(report.details) : 'aucun'}`,
    `Signalé par : identifiant ${report.reporter_id}`,
    `Reçu le : ${report.created_at}`,
    '',
    `Rappel : nous nous sommes engagés à traiter chaque signalement sous ${RESPONSE_DELAY_H} h (règles de la communauté et page de confidentialité).`,
    'Le détail est dans la table public.reports du projet Supabase.',
  ];
  return { subject: `Signalement : ${who}, ${reason.toLowerCase()}`, text: lines.join('\n') };
}
