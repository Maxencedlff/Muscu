// Appels à Strava et à la base pour les fonctions strava-connect, strava-export, strava-disconnect et
// delete-account. Règles pures : strava-policy.js ; chiffrement : strava-crypto.js. Contrat : docs/STRAVA.md.
//
// Secrets du projet (jamais dans le dépôt) : STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET (application créée
// sur strava.com/settings/api) et STRAVA_TOKEN_KEY (32 octets aléatoires en base64, chiffrement des jetons).
// Aucun jeton n'est jamais écrit dans les journaux : seuls les codes HTTP le sont.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { env } from './http.ts';
import { needsRefresh, parseTokens } from './strava-policy.js';
import { openTokens, sealTokens, tokenKey } from './strava-crypto.js';

const TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';
// Révocation recommandée depuis le 1er juin 2026 (seule acceptée à partir du 1er juin 2027) ; l'ancienne
// adresse sert de repli tant qu'elle existe
const REVOKE_URL = 'https://www.strava.com/oauth/revoke';
const DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/activities';
const TIMEOUT_MS = 10_000;

export type Tokens = { access: string; refresh: string };
export type Access = { ok: true; access: string; scope: string } | { ok: false; error: 'not_connected' | 'strava_down' | 'not_configured' };

export const stravaConfigured = () => !!(env('STRAVA_CLIENT_ID') && env('STRAVA_CLIENT_SECRET') && env('STRAVA_TOKEN_KEY'));
export const key = () => tokenKey(env('STRAVA_TOKEN_KEY'));

async function form(url: string, params: Record<string, string>, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

// Échange du code reçu au retour (usage unique) : jetons, droits accordés, athlète
export async function exchangeCode(code: string) {
  try {
    const res = await form(TOKEN_URL, { client_id: env('STRAVA_CLIENT_ID'), client_secret: env('STRAVA_CLIENT_SECRET'), code, grant_type: 'authorization_code' });
    if (!res.ok) { console.error('strava: échange du code refusé', res.status); return null; }
    return parseTokens(await res.json());
  } catch (e) { console.error('strava: échange du code impossible', e instanceof Error ? e.name : 'erreur'); return null; }
}

// Renouvellement : { tokens } ; { revoked: true } si Strava refuse le jeton (accès retiré chez Strava) ;
// { down: true } si Strava est injoignable
async function refreshTokens(refresh: string) {
  try {
    const res = await form(TOKEN_URL, { client_id: env('STRAVA_CLIENT_ID'), client_secret: env('STRAVA_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: refresh });
    if (res.status === 400 || res.status === 401) return { revoked: true as const };
    if (!res.ok) { console.error('strava: renouvellement refusé', res.status); return { down: true as const }; }
    const t = parseTokens(await res.json());
    return t ? { tokens: t } : { down: true as const };
  } catch { return { down: true as const }; }
}

// Révoque l'accès de l'app chez Strava (jeton d'accès et de renouvellement) : true si Strava l'a confirmé
export async function revokeAtStrava(tokens: Tokens): Promise<boolean> {
  const basic = btoa(`${env('STRAVA_CLIENT_ID')}:${env('STRAVA_CLIENT_SECRET')}`);
  try {
    const res = await form(REVOKE_URL, { token: tokens.refresh, token_type_hint: 'refresh_token' }, { Authorization: `Basic ${basic}` });
    if (res.ok) return true;
    console.error('strava: révocation refusée', res.status);
  } catch { /* repli ci-dessous */ }
  try {
    const res = await form(DEAUTHORIZE_URL, { access_token: tokens.access });
    // 401 : jeton déjà invalide, l'accès n'existe plus
    return res.ok || res.status === 401;
  } catch { return false; }
}

// Jeton d'accès valable pour le compte (renouvelé et réenregistré s'il expire dans moins de 5 minutes).
// Liaison illisible ou accès retiré chez Strava : la liaison est effacée (not_connected).
export async function stravaAccess(admin: SupabaseClient, userId: string): Promise<Access> {
  if (!stravaConfigured()) return { ok: false, error: 'not_configured' };
  const k = await key();
  if (!k) return { ok: false, error: 'not_configured' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await admin.rpc('strava_link_get', { p_user: userId });
    if (error) { console.error('strava: liaison illisible', error.code); return { ok: false, error: 'strava_down' }; }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return { ok: false, error: 'not_connected' };
    const tokens = await openTokens(k, userId, row.tokens);
    if (!tokens) {
      console.error('strava: jetons indéchiffrables (clé changée ?), liaison effacée');
      await admin.rpc('strava_link_delete', { p_user: userId });
      return { ok: false, error: 'not_connected' };
    }
    if (!needsRefresh(row.expires_at)) return { ok: true, access: tokens.access, scope: row.scope };
    const r = await refreshTokens(tokens.refresh);
    if ('tokens' in r && r.tokens) {
      const sealed = await sealTokens(k, userId, { access: r.tokens.access, refresh: r.tokens.refresh });
      const { error: upErr } = await admin.rpc('strava_link_tokens', { p_user: userId, p_tokens: sealed, p_expires_at: new Date(r.tokens.expiresAt * 1000).toISOString() });
      if (upErr) console.error('strava: jetons renouvelés non enregistrés', upErr.code);
      return { ok: true, access: r.tokens.access, scope: row.scope };
    }
    if ('down' in r) return { ok: false, error: 'strava_down' };
    // Refusé : soit l'accès a été retiré chez Strava, soit un autre envoi vient de renouveler (l'ancien jeton
    // de renouvellement ne vaut plus). Relecture une fois : si les jetons ont changé, on reprend avec eux.
    const again = await admin.rpc('strava_link_get', { p_user: userId });
    const now = Array.isArray(again.data) ? again.data[0] : null;
    if (attempt === 0 && now && now.tokens !== row.tokens) continue;
    await forgetLink(admin, userId);
    return { ok: false, error: 'not_connected' };
  }
  return { ok: false, error: 'strava_down' };
}

// Efface la liaison sans révoquer (accès déjà retiré chez Strava)
export async function forgetLink(admin: SupabaseClient, userId: string) {
  const { error } = await admin.rpc('strava_link_delete', { p_user: userId });
  if (error) console.error('strava: liaison non effacée', error.code);
}

// Déconnexion : liaison effacée en base, puis accès révoqué chez Strava au mieux.
// { ok, revoked } : ok faux seulement si la base a refusé ; revoked faux si Strava n'a pas confirmé
// (l'app explique alors comment retirer l'accès dans strava.com/settings/apps).
export async function disconnectStrava(admin: SupabaseClient, userId: string): Promise<{ ok: boolean; revoked: boolean }> {
  const { data, error } = await admin.rpc('strava_link_delete', { p_user: userId });
  if (error) { console.error('strava: déconnexion refusée par la base', error.code); return { ok: false, revoked: false }; }
  if (typeof data !== 'string' || !data) return { ok: true, revoked: true };   // rien n'était relié
  const k = await key();
  const tokens = k ? await openTokens(k, userId, data) : null;
  return { ok: true, revoked: tokens && stravaConfigured() ? await revokeAtStrava(tokens) : false };
}

// Création de l'activité : { status, text } (201 : créée)
export async function createActivity(access: string, fields: Record<string, string>) {
  try {
    const res = await form(ACTIVITIES_URL, fields, { Authorization: `Bearer ${access}` });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    console.error('strava: création injoignable', e instanceof Error ? e.name : 'erreur');
    return { status: 0, text: '' };
  }
}
