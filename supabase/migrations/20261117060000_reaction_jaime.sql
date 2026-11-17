-- ═══════════════════════════════════════════════════════════
--  Réaction « J'aime » ❤️ (décision de Maxence du 17/11/2026, contrat : docs/SOCIAL_V1.md, section
--  « J'aime (17/11/2026) »). 20261031200000_reactions_profil.sql est déjà en production : elle ne change pas,
--  tout le changement est ici. Retour arrière : supabase/rollback/20261117060000_reaction_jaime_down.sql.
--
--  - Liste fermée : like ❤️ s'ajoute en tête (like, clap, fire, strong, trophy, wow), toujours sans texte.
--    C'est la réaction d'un simple toucher dans l'app à jour ; 👏 reste la valeur par défaut de la colonne
--    (toggle_bravo des anciennes versions, inchangé : il pose un 👏).
--  - set_reaction accepte like ; reaction_top (Historique, my_reactions) départage les égalités dans le
--    nouvel ordre : ❤️ d'abord.
--  - Notification d'une réaction : push_claim relit maintenant, à l'envoi, la réaction de l'auteur sur la
--    séance (reaction : sa sorte, ou absente si elle a été retirée entre-temps) et le nom de MA séance (label,
--    40 caractères au plus, absent sans nom). push-send en fait « lea a réagi ❤️ à ta séance Push » ; sans ces
--    champs (push_claim d'avant), il dit « lea a aimé ta séance ». La file ne garde toujours que l'id de la
--    séance : rien de plus n'est stocké.
--  - Anciennes versions de l'app : elles ne connaissent pas like. Elles l'écartent sans planter (comptes,
--    qui a réagi et activité ignorent une sorte inconnue ; js/data/social.js, cleanReactionCounts,
--    cleanWhoRow, cleanActivityRow) : un ❤️ n'y apparaît simplement pas, jusqu'à l'OTA.
--  - Ordre de mise en production : APRÈS 20261117050000_messages_coach.sql, dont elle reprend push_claim
--    (résumé des séances) ; puis push-send, puis l'OTA (supabase/rollback/ORDRE.md).
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

alter table public.bravos drop constraint bravos_kind;
alter table public.bravos add constraint bravos_kind check (kind in ('like', 'clap', 'fire', 'strong', 'trophy', 'wow'));

-- ── Briques privées ──────────────────────────────────────

-- Réaction la plus fréquente ; à égalité, la première de la liste (❤️, 👏, 🔥, 💪, 🏆, 😮)
create or replace function private.reaction_top(counts jsonb) returns text
  language sql immutable set search_path = '' as
$$
  select v.key from jsonb_each_text(coalesce(counts, '{}'::jsonb)) v
  order by v.value::int desc, array_position(array['like', 'clap', 'fire', 'strong', 'trophy', 'wow'], v.key)
  limit 1
$$;

-- ── Fonctions RPC ────────────────────────────────────────

-- Comme 20261031200000_reactions_profil.sql, avec like dans la liste fermée
create or replace function public.set_reaction(owner uuid, session_id text, kind text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  cur text;
  counts jsonb;
begin
  if set_reaction.kind is not null and set_reaction.kind not in ('like', 'clap', 'fire', 'strong', 'trophy', 'wow') then
    raise exception 'invalid_reaction' using errcode = 'P0001';
  end if;
  if not private.can_see(me, set_reaction.owner) or not exists (
    select 1 from public.sessions x
    where x.user_id = set_reaction.owner and x.id = set_reaction.session_id
      and private.session_shown(x.data, x.deleted_at, x.done_at)
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select b.kind into cur from public.bravos b
    where b.session_owner = set_reaction.owner and b.session_id = set_reaction.session_id and b.user_id = me
    for update;
  if set_reaction.kind is null then
    delete from public.bravos b
      where b.session_owner = set_reaction.owner and b.session_id = set_reaction.session_id and b.user_id = me;
  elsif cur is distinct from set_reaction.kind then
    perform private.rate_limit(me, 'bravo', 200);
    insert into public.bravos as b (session_owner, session_id, user_id, kind, updated_at)
      values (set_reaction.owner, set_reaction.session_id, me, set_reaction.kind, now())
      on conflict on constraint bravos_pkey
      do update set kind = excluded.kind, updated_at = excluded.updated_at;
  end if;
  counts := private.reaction_counts(set_reaction.owner, set_reaction.session_id);
  return jsonb_build_object(
    'bravos', private.reaction_total(counts),
    'mine', set_reaction.kind is not null,
    'my_reaction', set_reaction.kind,
    'reactions', counts);
end
$$;

-- Comme 20261117050000_messages_coach.sql (séances des élèves et leur résumé), plus, pour une réaction : reaction (la sorte posée
-- par l'auteur sur ma séance, relue maintenant ; absente si elle a été retirée) et label (nom de ma séance,
-- 40 caractères au plus ; absent sans nom ou si la séance est supprimée)
create or replace function public.push_claim(max_rows int) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare res jsonb;
begin
  delete from private.push_outbox o where o.created_at < now() - interval '7 days';
  delete from public.push_devices d where d.seen_at < now() - interval '60 days';
  with picked as (
    select o.id from private.push_outbox o
      where o.sent_at is null and o.attempts < 5 and o.created_at > now() - interval '24 hours'
        and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
        and (o.kind <> 'student_digest'
             or (o.created_at <= now() - interval '15 minutes'
                 and not exists (select 1 from private.push_outbox p
                                 where p.recipient = o.recipient and p.kind = 'student_digest' and p.id <> o.id
                                   and coalesce(p.sent_at, p.claimed_at) > now() - interval '1 hour')))
      order by o.created_at
      limit least(greatest(coalesce(max_rows, 50), 1), 200)
      for update skip locked
  ), claimed as (
    update private.push_outbox o set claimed_at = now(), attempts = o.attempts + 1
      from picked where o.id = picked.id
      returning o.*
  ), counted as (
    select c.*, case when c.kind = 'student_digest' then private.push_digest_count(c.recipient, c.actors) end as n
    from claimed c
  ), checked as (
    select c.*, private.push_wanted(c.recipient, c.kind) and not private.blocked_between(c.recipient, c.actor)
                and private.push_valid(c.kind, c.recipient, c.actor, c.ref)
                and (c.kind <> 'student_digest' or c.n >= 1) as ok
    from counted c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind,
           'ref', case when not c.ok then ''
                       when c.kind = 'student_digest' then ''
                       when c.kind = 'student_session' then
                         case when char_length(c.actor::text || '/' || c.ref) <= 64 then c.actor::text || '/' || c.ref else c.actor::text end
                       else private.push_open_ref(c.kind, c.ref, c.recipient) end,
           'token', d.token, 'env', d.env,
           'actor_name', case when c.kind = 'student_digest' then null else up.username end,
           'wanted', c.ok)
           || case when c.ok and c.kind = 'student_session' then jsonb_strip_nulls(jsonb_build_object(
                'label', case when jsonb_typeof(x.data -> 'label') = 'string' then nullif(left(btrim(x.data ->> 'label'), 40), '') end,
                'minutes', case when jsonb_typeof(x.data -> 'duration') = 'number'
                                     and (x.data ->> 'duration')::numeric between 60000 and 86400000
                                then round((x.data ->> 'duration')::numeric / 60000)::int end))
                   when c.ok and c.kind = 'student_digest' then jsonb_build_object('count', c.n)
                   when c.ok and c.kind = 'reaction' then jsonb_strip_nulls(jsonb_build_object(
                'reaction', b.kind,
                'label', case when x.deleted_at is null and jsonb_typeof(x.data -> 'label') = 'string'
                              then nullif(left(btrim(x.data ->> 'label'), 40), '') end))
              else '{}'::jsonb end
           order by c.id), '[]'::jsonb)
    into res
    from checked c
    left join public.push_devices d on d.user_id = c.recipient
    left join public.user_profiles up on up.user_id = c.actor
    left join public.sessions x on x.id = c.ref
      and ((c.kind = 'student_session' and x.user_id = c.actor) or (c.kind = 'reaction' and x.user_id = c.recipient))
    left join public.bravos b on c.kind = 'reaction'
      and b.session_owner = c.recipient and b.session_id = c.ref and b.user_id = c.actor;
  return res;
end
$$;
