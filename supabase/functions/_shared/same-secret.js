// Comparaison en temps constant du secret de la planification (pg_cron + pg_net) : push-send et
// coach-photos-purge, réexportée par leur fichier de règles (push-policy.js, purge-policy.js).
export function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''));
  if (!x.length || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
