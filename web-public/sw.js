// Fin de la version web (PWA) : remplace l'ancien service worker. Installé à la prochaine visite,
// il vide les caches de l'ancienne app, se désinscrit et recharge les onglets ouverts, qui affichent
// alors la page « l'app est sur iPhone ». Les données (localStorage) ne sont pas touchées.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) await caches.delete(key);
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
})()));
