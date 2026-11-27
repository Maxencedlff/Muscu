'use strict';
// Écouteurs des erreurs non rattrapées (docs/ERREURS_PROD.md), posés au tout début de index.html pour voir
// aussi celles du chargement des scripts suivants. Le rapport et son nettoyage : js/data/error-report.js.
// Une erreur de chargement d'image ou de son ne remonte pas jusqu'à window : seules les erreurs de script
// arrivent ici.
window.addEventListener('error', ev => {
  if (!ev || typeof ev.target?.tagName === 'string' || (!ev.error && !ev.message)) return;   // image, son, script absent
  errReportCapture(ev.error || { name: 'Error', message: ev.message, stack: ev.filename ? `@${ev.filename}:${ev.lineno}:${ev.colno}` : '' }, 'error');
});
window.addEventListener('unhandledrejection', ev => errReportCapture(ev?.reason, 'rejection'));
