// ═══════════════════════════════════════════════════════════
//  « Relier un ordinateur », côté iPhone du coach (sans DOM) : lecture du QR, vérifications, code de vérification,
//  puis, après comparaison des codes et Face ID, clé des photos confiée à l'ordinateur, chiffrée pour lui seul.
//  Liste des ordinateurs reliés et retrait. Protocole : js/data/photo-link.js ; écrans : js/features/photo-link-ui.js ;
//  contrat et modèle de menace : docs/PHOTOS_WEB.md.
//
//  Ordre voulu : rien de secret n'est sorti du trousseau avant que le coach ait vu le même code sur les deux écrans
//  ET passé Face ID. La clé privée en clair (PKCS#8) n'existe que le temps de la chiffrer, puis est effacée.
// ═══════════════════════════════════════════════════════════
'use strict';

// devices : null (pas lus) ou [{ id, label, createdAt, usedAt, expiresAt }] ; missing : serveur sans la migration
const plink = { devices: null, loading: false, error: null, missing: false, busy: false };

// Ordinateurs reliés : affichés seulement à un coach qui reçoit déjà les photos (clé publiée)
function plinkShown() { return cphCoachShown() && !!cphCoach.key; }

async function plinkDevicesRefresh() {
  if (!account.user || !coachRole().isCoach || plink.loading) return false;
  plink.loading = true;
  const r = await coachRpc('coach_photo_devices');
  plink.loading = false;
  if (!r.ok) { plink.error = r.kind; plink.missing = r.kind === 'missing' || r.kind === 'disabled'; notifyCoach(); return false; }
  plink.devices = cleanPlinkDevices(r.data);
  plink.error = null; plink.missing = false;
  notifyCoach();
  return true;
}
async function plinkRevoke(id) {
  if (!PLINK_UUID_RE.test(id || '')) return { ok: false, kind: 'not_found' };
  const r = await coachRpc('coach_photo_device_revoke', { device: id });
  if (!r.ok) return r;
  if (plink.devices) plink.devices = plink.devices.filter(d => d.id !== id);
  notifyCoach();
  return { ok: true };
}

// Étape 1, juste après la lecture du QR : rien de secret ici (ni Face ID, ni la clé du coach).
// → { ok: true, link } (link : { pair, label, sas, finish(), cancel() }) ou { ok: false, kind } avec kind :
//   bad_qr (pas un QR de MDLF Coach), other_account (QR d'un ordinateur connecté à un autre compte), no_key (réception
//   des photos pas activée), expired (appairage inconnu, expiré ou d'un autre compte côté serveur), mismatch (le serveur
//   ne donne pas la clé du QR : rien ne part), used (déjà servi), et les erreurs habituelles (offline, server…).
async function plinkPhoneStart(text) {
  const q = plinkQrParse(text);
  if (!q) return { ok: false, kind: 'bad_qr' };
  const me = account.user?.id;
  if (!me) return { ok: false, kind: 'signed_out' };
  if (q.coach !== me) return { ok: false, kind: 'other_account' };
  if (cphCoach.key === undefined) await cphCoachRefresh();
  const key = cphCoach.key;
  if (!key) return { ok: false, kind: 'no_key' };
  const peek = await coachRpc('coach_photo_pair_peek', { pair: q.pair });
  if (!peek.ok) return { ok: false, kind: peek.kind === 'not_found' ? 'expired' : peek.kind };
  const pk = cleanPlinkPeek(peek.data);
  if (!pk) return { ok: false, kind: 'server' };
  if (pk.devicePub !== q.pub) return { ok: false, kind: 'mismatch' };
  if (pk.state !== 'waiting') return { ok: false, kind: 'used' };
  try {
    const eph = await crypto.subtle.generateKey(PLINK_P256, false, ['deriveBits']);
    const epk = bytesToB64(new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey)));
    const ctx = { pair: q.pair, coach: me, devicePub: q.pub, epk, secret: q.secret };
    const { wrapKey, sas } = await plinkDerive(eph.privateKey, q.pub, ctx, 'encrypt');
    const offer = await coachRpc('coach_photo_pair_offer', { pair: q.pair, verifier: await plinkVerifier(q.secret), epk });
    if (!offer.ok) return { ok: false, kind: offer.kind === 'not_found' ? 'expired' : offer.kind === 'already_used' ? 'used' : offer.kind };
    q.secret.fill(0);
    let done = false;
    const link = {
      pair: q.pair, label: pk.label, sas, keyId: key.key_id,
      // Étape 2 : le coach a vu le même code sur l'ordinateur et touche « Relier » : Face ID, clé chiffrée, envoyée
      async finish() {
        if (done) return { ok: false, kind: 'used' };
        done = true;
        return plinkPhoneFinish(ctx, wrapKey, key);
      },
      async cancel() { if (!done) { done = true; await coachRpc('coach_photo_pair_cancel', { pair: q.pair }); } },
    };
    return { ok: true, link };
  } catch { return { ok: false, kind: 'server' }; }
}

async function plinkPhoneFinish(ctx, wrapKey, key) {
  const me = account.user?.id;
  if (!me || me !== ctx.coach) return { ok: false, kind: 'signed_out' };
  // La clé du serveur doit être encore celle vue au début (changée entre-temps sur un autre iPhone : on s'arrête)
  if (!cphSameKey(cphCoach.key, key)) return { ok: false, kind: 'key_changed' };
  const s = await cphSecret(false, 'Relier un ordinateur', key.key_id);
  if (s.refused) {
    await coachRpc('coach_photo_pair_cancel', { pair: ctx.pair });
    return { ok: false, ...s.refused };
  }
  const pkcs8 = await coachKeyPkcs8(s.secret, me, key);
  if (!pkcs8) { await coachRpc('coach_photo_pair_cancel', { pair: ctx.pair }); return { ok: false, mismatch: true }; }
  let sealed;
  try { sealed = await plinkWrap(wrapKey, pkcs8, { device: ctx.pair, coach: me, keyId: key.key_id, coachPub: key.public_key }); }
  catch { return { ok: false, kind: 'server' }; }
  finally { pkcs8.fill(0); }
  const r = await coachRpc('coach_photo_pair_complete', { pair: ctx.pair, key_id: key.key_id, wrapped: sealed.wrapped, iv: sealed.iv });
  if (!r.ok) return { ok: false, kind: r.kind === 'not_found' ? 'expired' : r.kind === 'already_used' ? 'used' : r.kind };
  cphTouchedIds.add(key.key_id);
  await plinkDevicesRefresh();
  return { ok: true };
}

const PLINK_ERRORS = {
  bad_qr: 'Ce n\'est pas un code de MDLF Coach. Ouvre coach.mdlf.app sur l\'ordinateur, puis « Relier cet ordinateur ».',
  other_account: 'Ce code a été affiché sur un ordinateur connecté à un autre compte MDLF. Connecte-toi d\'abord avec ton compte sur l\'ordinateur.',
  no_key: 'Active d\'abord la réception des photos de bilan (Coach › Mes élèves).',
  expired: 'Ce code a expiré ou a déjà servi. Affiche un nouveau code sur l\'ordinateur.',
  used: 'Ce code a déjà servi. Affiche un nouveau code sur l\'ordinateur.',
  mismatch: 'Le serveur ne donne pas la même clé que le code : rien n\'a été envoyé. Réessaie avec un nouveau code.',
  key_changed: 'Ta clé des photos a changé entre-temps. Recommence.',
  too_many: 'Tu as déjà 5 ordinateurs reliés. Retire-en un d\'abord.',
  rate_limited: 'Trop d\'essais en une heure. Réessaie plus tard.',
  disabled: 'Les photos de bilan sont suspendues pour l\'instant.',
  missing: 'Le serveur de MDLF n\'a pas encore reçu cette fonction. Réessaie plus tard.',
};
function plinkErrorText(kind) { return PLINK_ERRORS[kind] || coachErrorText(kind); }

onAccountChange(() => { Object.assign(plink, { devices: null, loading: false, error: null, missing: false, busy: false }); });
