/* global module, fetch -- fonction Node de Vercel, hors de l'app */
// Réveil quotidien du serveur des comptes (cron Vercel, ota-site/vercel.json) : un projet Supabase gratuit
// sans requête pendant 7 jours est mis en pause, et la synchro des comptes s'arrêterait. Appelle la fonction
// public.ping() (supabase/migrations), qui ne lit aucune donnée. Clé publique seulement.
const URL = 'https://yopptmdjtnezmccdvaxf.supabase.co/rest/v1/rpc/ping';
// Même clé publique que js/data/account.js (ACCOUNT_CONFIG) : fonction Vercel à part, sans accès au code de l'app
const KEY = 'sb_publishable_9L0-y5dhw7V8LVm5PuxG5g_Hd7ExHkS';   // clé publique gitleaks:allow

module.exports = async (req, res) => {
  try {
    const r = await fetch(URL, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' });
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, at: r.ok ? await r.json() : null });
  } catch {
    res.status(502).json({ ok: false });
  }
};
