// ═══════════════════════════════════════════════════════════
//  Pages juridiques publiques (site mdlf.app, dossier web-public/ publié par la CI) : une seule liste
//  d'adresses pour toute l'app. Les pages elles-mêmes sont à la racine du dépôt (privacy.html,
//  mentions-legales.html, cgu.html, cgv.html, avec legal.css) ; contenu et emplacements à compléter :
//  docs/JURIDIQUE.md. Ouvertes dans Safari (window.open, _blank), jamais dans l'app.
// ═══════════════════════════════════════════════════════════
'use strict';

const LEGAL_SITE = 'https://mdlf.app';
const LEGAL_URLS = Object.freeze({
  privacy:    `${LEGAL_SITE}/privacy.html`,
  newsletter: `${LEGAL_SITE}/privacy.html#newsletter`,
  mentions:   `${LEGAL_SITE}/mentions-legales.html`,
  terms:      `${LEGAL_SITE}/cgu.html`,
  sales:      `${LEGAL_SITE}/cgv.html`,
  refund:     `${LEGAL_SITE}/cgv.html#remboursement`,
});
