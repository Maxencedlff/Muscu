-- ═══════════════════════════════════════════════════════════
--  Retour arrière de supabase/migrations/20261106200000_plans_diete_coach.sql (à lancer à la main, dans
--  l'éditeur SQL, seulement si Maxence décide de retirer l'accord « plans diète du coach »). Pas dans
--  migrations/ : Supabase ne l'applique jamais de lui-même.
--
--  Avant : revenir à une version de l'app qui ne demande pas student_set_share('diet') (sinon l'accord
--  « Recevoir les plans diète de mon coach » répond invalid_kind et l'app retombe sur son accord local).
--
--  Effet : les accords 'diet' (public.coach_shares) sont SUPPRIMÉS ; leur déclencheur, encore en place à
--  ce moment, efface donc les plans diète gardés sur le serveur pour ces élèves (coach_programmes 'diet_…'),
--  ce qui respecte le retrait de l'accord. Puis la contrainte de coach_shares.kind, private.share_kind_open
--  et coach_send_programme reprennent leur texte d'avant (20261031300000_partage_coach.sql et
--  20261027100000_coach.sql) : un coach peut de nouveau envoyer un plan diète sans accord.
--
--  Ordre : à défaire AVANT 20261031300000_partage_coach_down.sql (qui supprime coach_shares) ; indépendant
--  des autres (vérifié par tests/sql/rollback_nuit_check.sh).
-- ═══════════════════════════════════════════════════════════

begin;

delete from public.coach_shares where kind = 'diet';

drop trigger coach_shares_diet_revoked on public.coach_shares;
drop function private.coach_shares_diet_revoked();

alter table public.coach_shares drop constraint coach_shares_kind_check;
alter table public.coach_shares add constraint coach_shares_kind_check
  check (kind in ('weight', 'sleep', 'steps', 'resting_hr'));

create or replace function private.share_kind_open(kind text) returns boolean
  language sql immutable set search_path = '' as
$$ select kind = 'weight' $$;

-- Texte de 20261027100000_coach.sql
create or replace function public.coach_send_programme(student uuid, prog_id text, data jsonb) returns void
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or not private.is_coach(me) then
    raise exception 'not_coach' using errcode = 'P0001';
  end if;
  perform private.coach_require_student(me, student);
  if prog_id is null or prog_id !~ '^[A-Za-z0-9_-]{1,64}$' or data is null or jsonb_typeof(data) <> 'object' then
    raise exception 'invalid_programme' using errcode = 'P0001';
  end if;
  if octet_length(data::text) > 204800 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;
  perform private.rate_limit_window(me, 'coach_send', 30, interval '24 hours');
  begin
    insert into public.coach_programmes (student_id, coach_id, id, data, sent_at)
      values (student, me, prog_id, data, clock_timestamp())
      on conflict on constraint coach_programmes_pkey do update
        set data = excluded.data, coach_id = excluded.coach_id, sent_at = excluded.sent_at, seen_at = null;
  exception when foreign_key_violation then
    -- L'élève est parti entre la vérification et l'écriture
    raise exception 'not_found' using errcode = 'P0001';
  end;
end
$$;

commit;
