-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261117000000_reaction_jaime.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide d'annuler la réaction « J'aime »). Pas dans migrations/ :
--  Supabase ne l'applique jamais de lui-même.
--
--  Effet : chaque ❤️ redevient un 👏 (la ligne reste, sa date aussi : rien ne se perd et rien ne redevient
--  « nouveau ») ; la contrainte bravos_kind, set_reaction et reaction_top reprennent leur texte de
--  20261031200000_reactions_profil.sql ; push_claim reprend celui de 20261116020000 (plus de champs reaction
--  ni label pour une réaction).
--  L'app à jour reste utilisable mais ne peut plus aimer : le cœur et le double toucher envoient like, refusé
--  (invalid_reaction : réaction annulée, message d'erreur du serveur) ; « + », l'appui long et la rangée
--  marchent. Remettre d'abord l'OTA d'avant (supabase/rollback/ORDRE.md).
--  push-send peut rester tel quel : sans reaction, il dit « lea a aimé ta séance ».
--  À démonter AVANT 20261116020000_notifications_seances_eleves_down.sql et avant
--  20261031200000_reactions_profil_down.sql (supabase/rollback/ORDRE.md).
--  Vérifié par tests/sql/rollback_nuit_check.sh (pg_dump identique à la base d'avant) et
--  tests/sql/rollback_reaction_jaime_check.sh (un ❤️ posé redevient un 👏).
-- ═══════════════════════════════════════════════════════════

begin;

-- ❤️ → 👏 avant de remettre la liste d'avant (updated_at gardé : pas une nouvelle réaction)
update public.bravos set kind = 'clap' where kind = 'like';
alter table public.bravos drop constraint bravos_kind;
alter table public.bravos add constraint bravos_kind check (kind in ('clap', 'fire', 'strong', 'trophy', 'wow'));

-- Textes de 20261031200000_reactions_profil.sql
create or replace function private.reaction_top(counts jsonb) returns text
  language sql immutable set search_path = '' as
$$
  select v.key from jsonb_each_text(coalesce(counts, '{}'::jsonb)) v
  order by v.value::int desc, array_position(array['clap', 'fire', 'strong', 'trophy', 'wow'], v.key)
  limit 1
$$;

create or replace function public.set_reaction(owner uuid, session_id text, kind text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  cur text;
  counts jsonb;
begin
  if set_reaction.kind is not null and set_reaction.kind not in ('clap', 'fire', 'strong', 'trophy', 'wow') then
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

-- Texte de 20261116020000_notifications_seances_eleves.sql
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
      order by o.created_at
      limit least(greatest(coalesce(max_rows, 50), 1), 200)
      for update skip locked
  ), claimed as (
    update private.push_outbox o set claimed_at = now(), attempts = o.attempts + 1
      from picked where o.id = picked.id
      returning o.*
  ), checked as (
    select c.*, private.push_wanted(c.recipient, c.kind) and not private.blocked_between(c.recipient, c.actor)
                and private.push_valid(c.kind, c.recipient, c.actor, c.ref) as ok
    from claimed c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind,
           'ref', case when not c.ok then ''
                       when c.kind = 'student_session' then
                         case when char_length(c.actor::text || '/' || c.ref) <= 64 then c.actor::text || '/' || c.ref else c.actor::text end
                       else private.push_open_ref(c.kind, c.ref, c.recipient) end,
           'token', d.token, 'env', d.env,
           'actor_name', up.username,
           'wanted', c.ok)
           || case when c.ok and c.kind = 'student_session' then jsonb_strip_nulls(jsonb_build_object(
                'label', case when jsonb_typeof(x.data -> 'label') = 'string' then nullif(left(btrim(x.data ->> 'label'), 40), '') end,
                'minutes', case when jsonb_typeof(x.data -> 'duration') = 'number'
                                     and (x.data ->> 'duration')::numeric between 60000 and 86400000
                                then round((x.data ->> 'duration')::numeric / 60000)::int end))
              else '{}'::jsonb end
           order by c.id), '[]'::jsonb)
    into res
    from checked c
    left join public.push_devices d on d.user_id = c.recipient
    left join public.user_profiles up on up.user_id = c.actor
    left join public.sessions x on c.kind = 'student_session' and x.user_id = c.actor and x.id = c.ref;
  return res;
end
$$;

commit;
