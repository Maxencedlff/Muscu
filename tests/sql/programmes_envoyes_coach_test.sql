-- Vérifications de supabase/migrations/20261126010000_programmes_envoyes_coach.sql (lancées par tests/sql/run.sh) :
-- coach_student_programmes rend, pour un élève de ce coach seulement, les programmes et plans diète que CE coach lui a
-- envoyés (données exactes, du plus récent, « vu » de l'élève) ; rien d'un autre coach ; refus pour un autre coach,
-- un ex-coach, un non-élève, un élève, anon ; plan diète effacé quand l'élève retire son accord ; limite de lectures.
-- Comptes simulés : K coach, L autre coach (ancien coach de T), S et T élèves de K, A ni coach ni élève.

create function pg_temp.pu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000000004' || translate(c, 'klsta', '12345') || '0')::uuid $$;
create function pg_temp.plogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.pu(c)::text, ''), false) $$;
create function pg_temp.perr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.pu(text), pg_temp.plogin(text), pg_temp.perr(text) to authenticated, anon;

insert into auth.users (id) select pg_temp.pu(c) from unnest(array['k', 'l', 's', 't', 'a']) c;
insert into public.user_profiles (user_id, username, avatar_emoji, coach_at) values
  (pg_temp.pu('k'), 'kim.p4', '🦁', now()), (pg_temp.pu('l'), 'lou.p4', '🦊', now()), (pg_temp.pu('s'), 'sol.p4', '🦅', null),
  (pg_temp.pu('t'), 'tom.p4', '🐼', null), (pg_temp.pu('a'), 'ami.p4', '⭐', null);
insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('s'), pg_temp.pu('k')), (pg_temp.pu('t'), pg_temp.pu('l'));
-- S accepte les plans diète de K
insert into public.coach_shares (student_id, coach_id, kind) values (pg_temp.pu('s'), pg_temp.pu('k'), 'diet');

-- ── Droits ───────────────────────────────────────────────
do $$ begin
  if has_function_privilege('anon', 'public.coach_student_programmes(uuid)', 'execute') then raise 'anon exécute coach_student_programmes'; end if;
  if not has_function_privilege('authenticated', 'public.coach_student_programmes(uuid)', 'execute') then raise 'authenticated ne l''exécute pas'; end if;
  if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.coach_student_programmes(uuid)'::regprocedure) then
    raise 'security definer / search_path'; end if;
end $$;
set role anon;
do $$ begin
  if pg_temp.perr(format('select public.coach_student_programmes(%L)', pg_temp.pu('s'))) not like 'permission denied%' then raise 'anon : lecture'; end if;
end $$;
reset role;

set role authenticated;
do $$
declare r jsonb; prog jsonb := '{"name": "Sèche 4 jours", "sessions": [{"key": "push", "label": "Haut A", "color": "#FF9F0A",
  "exercises": [{"name": "Développé couché", "sets": 4, "repMin": 6, "repMax": 8, "loads": [45, 40, 40, 40], "intens": "topback"}]}]}';
begin
  -- K envoie un programme puis un plan diète à S (par la fonction existante, comme l'app)
  perform pg_temp.plogin('k');
  if jsonb_array_length(public.coach_student_programmes(pg_temp.pu('s'))) <> 0 then raise 'rien d''envoyé : liste vide attendue'; end if;
  perform public.coach_send_programme(pg_temp.pu('s'), 'u_seche4', prog);
  perform pg_sleep(0.01);
  perform public.coach_send_programme(pg_temp.pu('s'), 'diet_seche', '{"kind": "diet", "v": 1, "diet": {"name": "Sèche", "meals": []}}');
  r := public.coach_student_programmes(pg_temp.pu('s'));
  if jsonb_array_length(r) <> 2 then raise 'deux envois attendus : %', r; end if;
  if r -> 0 ->> 'id' <> 'diet_seche' or r -> 1 ->> 'id' <> 'u_seche4' then raise 'ordre : du plus récent'; end if;
  if r -> 1 -> 'data' <> prog then raise 'donnée envoyée différente'; end if;
  if (r -> 1 ->> 'seen')::boolean then raise 'pas encore vu'; end if;
  if (r -> 1 ->> 'sent_at') is null then raise 'date d''envoi absente'; end if;
  -- Même forme que coach_state().students[].sent (id, sent_at, seen), plus data
  if exists (select 1 from jsonb_array_elements(r) e where (select count(*) from jsonb_object_keys(e)) <> 4) then raise 'champs en trop'; end if;
  -- L'élève a ouvert le programme
  perform pg_temp.plogin('s');
  perform public.student_mark_seen('programme', 'u_seche4');
  perform pg_temp.plogin('k');
  if not (select (e ->> 'seen')::boolean from jsonb_array_elements(public.coach_student_programmes(pg_temp.pu('s'))) e where e ->> 'id' = 'u_seche4') then
    raise 'vu par l''élève'; end if;
  -- Refus : élève d'un autre coach, non-élève, soi-même
  if pg_temp.perr(format('select public.coach_student_programmes(%L)', pg_temp.pu('t'))) <> 'not_found' then raise 'K lit l''élève de L'; end if;
  if pg_temp.perr(format('select public.coach_student_programmes(%L)', pg_temp.pu('a'))) <> 'not_found' then raise 'non-élève lu'; end if;
  if pg_temp.perr(format('select public.coach_student_programmes(%L)', pg_temp.pu('k'))) <> 'not_found' then raise 'soi-même'; end if;
  perform pg_temp.plogin('l');
  if pg_temp.perr(format('select public.coach_student_programmes(%L)', pg_temp.pu('s'))) <> 'not_found' then raise 'autre coach lit S'; end if;
  perform pg_temp.plogin('s');
  if pg_temp.perr(format('select public.coach_student_programmes(%L)', pg_temp.pu('s'))) <> 'not_found' then raise 'l''élève lit (il n''est pas coach)'; end if;
  perform set_config('request.jwt.claim.sub', '', false);
  if pg_temp.perr(format('select public.coach_student_programmes(%L)', pg_temp.pu('s'))) <> 'not_found' then raise 'sans compte'; end if;
end $$;
reset role;

-- T passe de L à K : K ne voit jamais ce que L avait envoyé (lien rompu : cascade ; et filtre coach_id)
set role authenticated;
do $$ begin
  perform pg_temp.plogin('l');
  perform public.coach_send_programme(pg_temp.pu('t'), 'u_force', '{"name": "Force", "sessions": []}');
end $$;
reset role;
delete from public.coach_links where student_id = pg_temp.pu('t');
insert into public.coach_links (student_id, coach_id) values (pg_temp.pu('t'), pg_temp.pu('k'));
set role authenticated;
do $$ begin
  perform pg_temp.plogin('k');
  if jsonb_array_length(public.coach_student_programmes(pg_temp.pu('t'))) <> 0 then raise 'K voit l''envoi de l''ancien coach'; end if;
end $$;
reset role;

-- Accord diète retiré par S : le plan diète disparaît, le programme reste
delete from public.coach_shares where student_id = pg_temp.pu('s') and kind = 'diet';
set role authenticated;
do $$ declare r jsonb; begin
  perform pg_temp.plogin('k');
  r := public.coach_student_programmes(pg_temp.pu('s'));
  if jsonb_array_length(r) <> 1 or r -> 0 ->> 'id' <> 'u_seche4' then raise 'plan diète encore rendu après le retrait : %', r; end if;
end $$;
reset role;

-- Ex-coach : rôle retiré, le lien existe encore
update public.user_profiles set coach_at = null where user_id = pg_temp.pu('k');
set role authenticated;
do $$ begin
  perform pg_temp.plogin('k');
  if pg_temp.perr(format('select public.coach_student_programmes(%L)', pg_temp.pu('s'))) <> 'not_found' then raise 'ex-coach lit encore'; end if;
end $$;
reset role;
update public.user_profiles set coach_at = now() where user_id = pg_temp.pu('k');

-- Limite : 600 lectures par heure
insert into private.social_rate (user_id, action) select pg_temp.pu('k'), 'coach_progs_read' from generate_series(1, 600);
set role authenticated;
do $$ begin
  perform pg_temp.plogin('k');
  if pg_temp.perr(format('select public.coach_student_programmes(%L)', pg_temp.pu('s'))) <> 'rate_limited' then raise 'limite de lectures'; end if;
end $$;
reset role;
delete from private.social_rate where user_id = pg_temp.pu('k');
