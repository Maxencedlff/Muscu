// Règles de l'envoi des notifications push (logique pure, sans réseau), appliquées par index.ts (Deno) et
// testées par tests/unit/push.mjs (Node). Contrat : docs/NOTIFICATIONS.md.
//
// 1. Contenu : un titre et une phrase en français, avec le seul pseudo de l'auteur (jamais le texte d'un
//    commentaire, d'un message ni le nom d'un programme : l'écran verrouillé est visible par d'autres ; la
//    file n'en a d'ailleurs pas copie). Pseudo absent : « Quelqu'un ». Clé « mdlf » : { kind, ref } pour
//    ouvrir le bon écran au toucher (PushPlugin.swift) ; ref : séance, programme, ou élève de la conversation.
// 2. Requête APNs (documentation Apple « Sending notification requests to APNs ») : HTTP/2, POST
//    /3/device/<jeton>, en-têtes authorization (jeton du fournisseur), apns-push-type alert, apns-topic
//    (identifiant de l'app), apns-priority 10, apns-expiration (24 h : après, la notification n'a plus de
//    sens). Hôte de production ou de sandbox selon l'environnement du jeton.
// 3. Jeton du fournisseur : JWT ES256 signé par la clé .p8 (en-tête kid, revendications iss = Team ID et
//    iat) ; Apple le refuse au-delà d'une heure et demande de ne pas le renouveler plus d'une fois toutes
//    les 20 minutes : il est gardé 40 minutes, dans la base, et signé une seule fois pour tous les envois
//    (providerTokenCache).
// 4. Réponse d'APNs → suite : 200 envoyée ; 410 Unregistered, 400 BadDeviceToken ou
//    DeviceTokenNotForTopic : jeton mort, retiré ; 403 sur le jeton du fournisseur, 429, 5xx, réseau :
//    nouvel essai plus tard (la ligne reste en file, 5 essais au plus) ; autre 4xx : abandon (journalisé).

export const APNS_HOSTS = Object.freeze({
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
});
export const PUSH_EXPIRATION_S = 24 * 3600;
export const PROVIDER_TOKEN_TTL_S = 40 * 60;
export const NAME_MAX = 40;

const TOKEN_RE = /^[0-9a-f]{64,200}$/;
export const validDeviceToken = (t) => typeof t === 'string' && TOKEN_RE.test(t);

// Pseudo affiché : texte brut, une ligne, borné ; sinon « Quelqu'un »
function actorName(name) {
  const s = typeof name === 'string' ? [...name].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').trim() : '';
  return s ? [...s].slice(0, NAME_MAX).join('') : 'Quelqu’un';
}

export const PUSH_KINDS = Object.freeze({
  reaction:        (who) => ({ title: 'Bravo !', body: `${who} t\u2019a dit bravo pour ta séance` }),
  follow_request:  (who) => ({ title: 'Nouvelle demande', body: `${who} veut suivre tes séances` }),
  coach_note:      (who) => ({ title: 'Ton coach', body: `${who} a commenté ta séance` }),
  coach_programme: (who) => ({ title: 'Ton coach', body: `${who} t’a envoyé un programme` }),
  comment:         (who) => ({ title: 'Nouveau commentaire', body: `${who} a commenté ta séance` }),
  chat_message:    (who) => ({ title: 'Nouveau message', body: `${who} t’a envoyé un message` }),
});

// Ligne de push_claim → { skip } ou { title, body, kind, ref }
export function pushMessage(row) {
  if (!row || row.wanted !== true) return { skip: 'unwanted' };
  if (!validDeviceToken(row.token)) return { skip: 'no_device' };
  const make = PUSH_KINDS[row.kind];
  if (!make) return { skip: 'unknown_kind' };
  const ref = typeof row.ref === 'string' ? row.ref.slice(0, 64) : '';
  return { ...make(actorName(row.actor_name)), kind: row.kind, ref };
}

// Requête HTTP vers APNs pour une ligne (message déjà construit par pushMessage)
export function apnsRequest(row, msg, { topic, providerToken, nowS }) {
  const host = APNS_HOSTS[row.env] || APNS_HOSTS.production;
  const payload = {
    aps: { alert: { title: msg.title, body: msg.body }, sound: 'default', 'thread-id': msg.kind },
    mdlf: { kind: msg.kind, ref: msg.ref },
  };
  return {
    url: `${host}/3/device/${row.token}`,
    init: {
      method: 'POST',
      headers: {
        authorization: `bearer ${providerToken}`,
        'apns-push-type': 'alert',
        'apns-topic': topic,
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(nowS) + PUSH_EXPIRATION_S),
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  };
}

// Réponse d'APNs → 'sent' | 'dead_token' | 'retry' | 'drop'
export function apnsOutcome(status, reason = '') {
  if (status === 200) return 'sent';
  if (status === 410) return 'dead_token';
  if (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic')) return 'dead_token';
  if (status === 403 || status === 429 || status >= 500 || !status) return 'retry';
  return 'drop';
}

// Une notification (id) est soldée quand tous ses appareils sont traités sans « retry »
export function settledIds(results) {
  const byId = new Map();
  for (const r of results) byId.set(r.id, (byId.get(r.id) ?? true) && r.outcome !== 'retry');
  return [...byId].filter(([, done]) => done).map(([id]) => id);
}

// ── Jeton du fournisseur (JWT ES256) ─────────────────────

const b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlText = (text) => b64url(new TextEncoder().encode(text));

// Clé .p8 (PEM PKCS#8) → octets DER
export function pemToDer(pem) {
  const body = String(pem || '').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  if (!body) throw new Error('clé APNs vide');
  const bin = atob(body);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// subtle : crypto.subtle (Deno, Node 22). La signature WebCrypto ECDSA est déjà au format JWS (r || s).
export async function providerToken({ keyP8, keyId, teamId, nowS, subtle = globalThis.crypto.subtle }) {
  if (!keyId || !teamId) throw new Error('APNS_KEY_ID ou APNS_TEAM_ID absent');
  const key = await subtle.importKey('pkcs8', pemToDer(keyP8), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64urlText(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64urlText(JSON.stringify({ iss: teamId, iat: Math.floor(nowS) }));
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(new Uint8Array(sig))}`;
}

// Jeton du fournisseur partagé par tous les envois. Apple : pas plus d'un nouveau jeton toutes les 20 min
// (sinon 429 TooManyProviderTokenUpdates), jamais plus d'une heure. Les instances de la fonction Edge vivent
// peu : le jeton est gardé dans la base (private.push_apns_auth, une ligne, lue et écrite par service_role
// seulement) et repris par chaque nouvelle instance. Dans une instance, la promesse en cours est partagée :
// 10 envois simultanés attendent la même signature. Renouvelé après 40 min par un échange conditionnel
// (swap : remplacé seulement si la ligne est encore celle lue) : deux instances qui renouvellent en même
// temps gardent toutes deux celui de la première. 403 InvalidProviderToken ou ExpiredProviderToken : ce
// jeton-là est écarté, une fois (une réponse tardive pour un jeton déjà remplacé ne change rien). Base
// injoignable : signé et gardé en mémoire, l'envoi continue.
//   load() → { token, iat, key_id } | null ; swap(attendu, nouveau) → la ligne gagnante ; sign(iat) → JWT
export const PROVIDER_TOKEN_REFUSED = Object.freeze(['InvalidProviderToken', 'ExpiredProviderToken']);
export function providerTokenCache({ keyId, now, sign, load, swap, ttlS = PROVIDER_TOKEN_TTL_S }) {
  let current = null, pending = null, refusedToken = null;
  const usable = (r) => !!r && typeof r.token === 'string' && r.token !== refusedToken && r.key_id === keyId
    && Number.isFinite(r.iat) && now() - r.iat < ttlS && now() - r.iat > -60;
  async function refresh() {
    let row = null;
    try { row = await load(); } catch { /* base injoignable : signé ici */ }
    if (usable(row)) return row;
    const iat = Math.floor(now());
    const next = { token: await sign(iat), iat, key_id: keyId };
    try { const won = await swap(row?.token ?? null, next); if (usable(won)) return won; } catch { /* gardé en mémoire */ }
    return next;
  }
  return {
    get() {
      if (usable(current)) return Promise.resolve(current.token);
      pending ||= refresh().then((r) => { current = r; return r.token; }).finally(() => { pending = null; });
      return pending;
    },
    refused(token, reason) {
      if (!PROVIDER_TOKEN_REFUSED.includes(reason) || !current || token !== current.token) return;
      refusedToken = token;
      current = null;
    },
  };
}

// Comparaison du secret de la planification en temps constant
export function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a ?? '')), y = new TextEncoder().encode(String(b ?? ''));
  if (!x.length || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
