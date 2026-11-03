// Règles de l'alerte « nouvelle demande du rôle coach » (logique pure, sans réseau), appliquées par
// index.ts (Deno) et testées par tests/unit/coach-request.mjs (Node). Contrat : docs/PAYANT_V1.md,
// « Rôle coach : demande vérifiée à la main ».
//
// 1. On n'alerte que pour une demande EN ATTENTE et pas encore signalée (notified_at nul) : l'appel est
//    fait par l'app juste après coach_request_submit, et le rejouer n'envoie pas deux e-mails.
// 2. E-mail en texte brut, en français : pseudo, nom sur la carte, numéro de carte, diplôme, lien de
//    vérification du ministère des Sports et les deux commandes SQL à lancer. Aucune ligne ne
//    commence par un tiret. Les champs écrits par l'utilisateur sont aplatis sur une ligne et ne vont
//    jamais dans l'objet (seulement le pseudo, déjà borné par la base).

export const VERIFY_URL = 'https://recherche-educateur.sports.gouv.fr';
export const ANSWER_DELAY_H = 48;

// eslint-disable-next-line no-control-regex -- les caractères de contrôle sont justement ceux à retirer
const oneLine = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();

// Ligne de demande (colonnes lues par la fonction) → faut-il alerter ?
export function shouldAlert(row) {
  return !!row && typeof row === 'object' && row.status === 'pending' && !row.notified_at;
}

// { subject, text } de l'e-mail à l'administrateur
export function requestEmail(row, username) {
  const who = oneLine(username) || 'sans pseudo';
  const uid = oneLine(row.user_id);
  const lines = [
    'Nouvelle demande du rôle coach dans MDLF Training.',
    '',
    `Compte : ${who} (${uid})`,
    `Nom sur la carte : ${oneLine(row.card_name)}`,
    `Numéro de carte professionnelle : ${oneLine(row.card_number)}`,
    `Diplôme : ${oneLine(row.diploma)}`,
    `Demande du : ${oneLine(row.created_at)}`,
    '',
    `À vérifier sur ${VERIFY_URL} (nom et numéro de carte, validité, diplôme), réponse promise sous ${ANSWER_DELAY_H} h.`,
    '',
    'Puis, dans l\'éditeur SQL de Supabase :',
    `select private.approve_coach('${uid}', 'carte vérifiée le …');`,
    `select private.reject_coach('${uid}', 'Motif montré à la personne.');`,
  ];
  return { subject: `Demande coach : ${who}`, text: lines.join('\n') };
}
