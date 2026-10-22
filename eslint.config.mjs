// ESLint (configuration « flat ») : erreurs réelles seulement, sans changer le style du code.
// L'app est faite de scripts classiques chargés dans l'ordre d'index.html, qui partagent leurs
// fonctions par la portée globale : no-undef et no-unused-vars n'y ont pas de sens (une fonction
// d'un fichier est utilisée par un autre), ils sont donc coupés pour js/. Les tests et scripts Node
// sont des modules ES ordinaires et gardent les règles recommandées complètes.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'ios/**', 'node_modules/**', 'tests/shots/**', 'ota-site/**'] },
  js.configs.recommended,
  // Espaces insécables voulus dans les textes (typographie française : « 57 min », « 12 % »)
  { rules: { 'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipRegExps: true }] } },
  {
    files: ['js/**/*.js', 'sw.js', 'web-public/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, ...globals.serviceworker } },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off', 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
];
