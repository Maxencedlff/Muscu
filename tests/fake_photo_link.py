"""Faux serveur de « Relier un ordinateur » (supabase/migrations/20261127010000_photos_web_appairage.sql, docs/PHOTOS_WEB.md).

FAKE_PHOTO_LINK est injecté APRÈS FAKE_ACCOUNT (et FAKE_CHECKINS s'il est là) : il ajoute ses RPC à __sb.extraRpc avec
les règles de la migration (coach validé, clé de photos, un appairage à la fois, 2 minutes, waiting → offered → done une
seule fois, preuve du QR, 5 ordinateurs, enveloppe rendue au seul coach, retrait). État dans __sb.pl :
{ pairs: [{ id, coach, device_pub, verifier, label, state, epk, device, expires }], devices: [{ id, coach, key_id, label,
wrapped, iv, created, used }] }.

Attaques jouées par les tests (le serveur compromis) : __sb.pl.evil = { peekPub } (rend au téléphone une autre clé que
celle du QR), { epk } (relaie au navigateur une autre clé que celle du téléphone), { coachPub } (sert au navigateur une
autre clé publique du coach) ; __sb.fail.pairing = 'missing' : serveur sans la migration (PGRST202).

Deux pages (l'iPhone du coach et son ordinateur) ont chacune leur faux serveur : le test recopie __sb.pl (et les clés
et photos) de l'une à l'autre, comme le vrai serveur partagé.
"""

FAKE_PHOTO_LINK = r"""
(() => {
  const sb = window.__sb;
  if (!sb) return;
  const err = message => ({ data: null, error: { code: 'P0001', message, details: null, hint: null } });
  const PUB = /^B[A-P][A-Za-z0-9+/]{84}[AEIMQUYcgkosw048]=$/;
  const pl = sb.pl = { pairs: [], devices: [], evil: {} };
  const iso = t => new Date(t).toISOString();
  const live = p => p.expires > Date.now();
  const coachOk = me => !!sb.co.coachAt[me];
  const keyOf = me => sb.co.pkeys[me];
  const purge = me => { pl.devices = pl.devices.filter(d => d.coach !== me || (d.used > Date.now() - 30 * 86400e3 && keyOf(me)?.key_id === d.key_id)); };
  const rpc = {
    coach_photo_pair_start: (me, a) => {
      if (!PUB.test(a.device_pub || '') || !/^[A-Za-z0-9+/]{43}=$/.test(a.verifier || '')) return err('invalid_device');
      if (!keyOf(me)) return err('no_key');
      purge(me);
      if (pl.devices.filter(d => d.coach === me).length >= 5) return err('too_many');
      pl.pairs = pl.pairs.filter(p => p.coach !== me);
      const p = { id: crypto.randomUUID(), coach: me, device_pub: a.device_pub, verifier: a.verifier, label: String(a.label || 'Ordinateur').slice(0, 60),
        state: 'waiting', epk: null, device: null, expires: Date.now() + 120e3 };
      pl.pairs.push(p);
      return { pair: p.id, expires_at: iso(p.expires) };
    },
    coach_photo_pair_peek: (me, { pair }) => {
      const p = pl.pairs.find(x => x.id === pair && x.coach === me && live(x));
      return p ? { device_pub: pl.evil.peekPub || p.device_pub, label: p.label, state: p.state, expires_at: iso(p.expires) } : err('not_found');
    },
    coach_photo_pair_offer: (me, { pair, verifier, epk }) => {
      if (!PUB.test(epk || '')) return err('invalid_device');
      const p = pl.pairs.find(x => x.id === pair && x.coach === me && live(x));
      if (!p || p.verifier !== verifier) return err('not_found');
      if (p.state !== 'waiting') return err('already_used');
      Object.assign(p, { state: 'offered', epk });
      return { expires_at: iso(p.expires) };
    },
    coach_photo_pair_complete: (me, { pair, key_id, wrapped, iv }) => {
      if (!/^[0-9a-f]{32}$/.test(key_id || '') || !/^[A-Za-z0-9+/]+={0,2}$/.test(wrapped || '') || wrapped.length < 40 || !/^[A-Za-z0-9+/]{16}$/.test(iv || '')) return err('invalid_device');
      const p = pl.pairs.find(x => x.id === pair && x.coach === me && live(x));
      if (!p) return err('not_found');
      if (p.state !== 'offered') return err('already_used');
      if (keyOf(me)?.key_id !== key_id) return err('key_changed');
      purge(me);
      if (pl.devices.filter(d => d.coach === me).length >= 5) return err('too_many');
      const d = { id: p.id, coach: me, key_id, label: p.label, wrapped, iv, created: Date.now(), used: Date.now() };
      pl.devices.push(d);
      Object.assign(p, { state: 'done', device: d.id });
      return { device: d.id, label: d.label, created_at: iso(d.created), expires_at: iso(d.created + 90 * 86400e3) };
    },
    coach_photo_pair_status: (me, { pair }) => {
      const p = pl.pairs.find(x => x.id === pair && x.coach === me && live(x));
      return p ? { state: p.state, epk: p.epk && (pl.evil.epk || p.epk), device: p.device } : err('not_found');
    },
    coach_photo_pair_cancel: (me, { pair }) => { pl.pairs = pl.pairs.filter(p => !(p.id === pair && p.coach === me && p.state !== 'done')); return null; },
    coach_photo_devices: me => {
      purge(me);
      return pl.devices.filter(d => d.coach === me).sort((a, b) => b.created - a.created)
        .map(d => ({ id: d.id, label: d.label, created_at: iso(d.created), last_used_at: iso(d.used), expires_at: iso(d.created + 90 * 86400e3) }));
    },
    coach_photo_device_key: (me, { device }) => {
      purge(me);
      const d = pl.devices.find(x => x.id === device && x.coach === me);
      if (!d) return err('not_found');
      d.used = Date.now();
      return { id: d.id, key_id: d.key_id, wrapped: d.wrapped, iv: d.iv, expires_at: iso(d.created + 90 * 86400e3) };
    },
    coach_photo_device_revoke: (me, { device }) => { pl.devices = pl.devices.filter(d => !(d.id === device && d.coach === me)); return null; },
  };
  const gated = Object.fromEntries(Object.entries(rpc).map(([fn, f]) => [fn, (me, a = {}) => {
    if (sb.fail.pairing === 'missing') return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}`, details: null, hint: null } };
    if (!['coach_photo_pair_cancel', 'coach_photo_device_revoke'].includes(fn) && !coachOk(me)) return err('not_coach');
    return f(me, a);
  }]));
  // coach_photo_key servi au navigateur : une autre clé publique si le test joue le serveur qui la glisse
  gated.coach_photo_key = me => {
    if (!coachOk(me)) return err('not_coach');
    const k = keyOf(me);
    return k ? { ...k, public_key: pl.evil.coachPub || k.public_key } : null;
  };
  sb.extraRpc = Object.assign(sb.extraRpc || {}, gated);
})();
"""
