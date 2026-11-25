-- Retour arrière de supabase/migrations/20261127030000_bilans_accord_majeur.sql (à lancer à la main, rôle postgres).
-- Les accords datés pour les bilans sont EFFACÉS (table checkin_health_consents) ; student_checkins,
-- student_checkin_answer et student_checkin_cycle reprennent le texte de 20261125010000_bilans_coach.sql : plus
-- d'accord exigé avant l'envoi, libido et cycle de nouveau rendus sans la déclaration des 18 ans (le cycle garde son
-- propre accord, qui l'exige). Les déclarations « 18 ans ou plus » enregistrées par un accord du cycle dans
-- coach_photo_adults restent : ce sont de vraies déclarations de l'élève, valables pour les photos de bilan.
-- Une app qui appelle student_checkin_consent reçoit PGRST202 et envoie sans accord, comme avant.
begin;
drop function if exists public.student_checkin_consent(boolean, int);
create or replace function public.student_checkins() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  coach uuid;
  consented boolean;
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  select l.coach_id into coach from public.coach_links l where l.student_id = me;
  consented := exists (select 1 from public.checkin_cycle_consents c where c.student_id = me and c.coach_id = coach);
  if coach is null or private.blocked_between(me, coach) then
    return jsonb_build_object('requests', '[]'::jsonb, 'cycle', jsonb_build_object('consented', consented, 'asked', false));
  end if;
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'coach_id', r.coach_id, 'name', r.name,
               'items', coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(r.items) with ordinality z(e, o)
                                  where consented or e ->> 'kind' <> 'cycle'), '[]'::jsonb),
               'period_start', r.period_start, 'sent_at', r.sent_at, 'due_at', r.due_at, 'answered_at', r.answered_at,
               'review', (select jsonb_build_object('reply', v.reply, 'reviewed_at', v.sent_at)
                          from public.coach_checkin_reviews v where v.request_id = r.id and v.sent_at is not null))
             order by r.grp, r.sent_at desc, r.id)
      from ((select x.*, 0 as grp from public.coach_checkin_requests x
             where x.student_id = me and x.coach_id = coach and x.answered_at is null and x.cancelled_at is null)
            union all
            (select x.*, 1 as grp from public.coach_checkin_requests x
             where x.student_id = me and x.coach_id = coach and x.answered_at is not null
             order by x.sent_at desc, x.id limit 5)) r
    ), '[]'::jsonb),
    'cycle', jsonb_build_object('consented', consented, 'asked', not consented and exists (
      select 1 from public.coach_checkin_requests x, jsonb_array_elements(x.items) e
      where x.student_id = me and x.coach_id = coach and x.answered_at is null and x.cancelled_at is null and e ->> 'kind' = 'cycle')));
end
$$;

create or replace function public.student_checkin_answer(request uuid, answers jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  rq public.coach_checkin_requests%rowtype;
  consented boolean;
  e record;
  it jsonb;
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  select * into rq from public.coach_checkin_requests x where x.id = student_checkin_answer.request and x.student_id = me for update;
  if rq.id is null or private.blocked_between(me, rq.coach_id)
     or not exists (select 1 from public.coach_links l where l.student_id = me and l.coach_id = rq.coach_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if rq.answered_at is not null then return jsonb_build_object('answered_at', rq.answered_at); end if;
  if rq.cancelled_at is not null then raise exception 'closed' using errcode = 'P0001'; end if;
  if student_checkin_answer.answers is null or jsonb_typeof(student_checkin_answer.answers) <> 'object' then
    raise exception 'invalid_answer' using errcode = 'P0001';
  end if;
  consented := exists (select 1 from public.checkin_cycle_consents c where c.student_id = me and c.coach_id = rq.coach_id);
  for e in select a.key, a.value from jsonb_each(student_checkin_answer.answers) a loop
    select x into it from jsonb_array_elements(rq.items) x where x ->> 'key' = e.key;
    if it is null or not private.checkin_value_ok(it, e.value) then raise exception 'invalid_answer' using errcode = 'P0001'; end if;
    if it ->> 'kind' = 'cycle' and not consented then raise exception 'no_consent' using errcode = 'P0001'; end if;
    if it ->> 'type' = 'photo' and exists (
         select 1 from jsonb_array_elements_text(e.value -> 'ids') pid
         where not exists (select 1 from public.coach_photos p
                           where p.id = pid::uuid and p.student_id = me and p.coach_id = rq.coach_id and p.state = 'ready')) then
      raise exception 'invalid_answer' using errcode = 'P0001';
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(rq.items) x
             where x -> 'required' = 'true'::jsonb and not (student_checkin_answer.answers ? (x ->> 'key'))
               and (consented or x ->> 'kind' <> 'cycle')) then
    raise exception 'invalid_answer' using errcode = 'P0001';
  end if;
  insert into public.coach_checkin_answers (request_id, item_key, value)
    select rq.id, a.key, a.value from jsonb_each(student_checkin_answer.answers) a;
  update public.coach_checkin_requests x set answered_at = now() where x.id = rq.id returning * into rq;
  return jsonb_build_object('answered_at', rq.answered_at);
end
$$;

create or replace function public.student_checkin_cycle(accept boolean, adult boolean default false) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  coach uuid;
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  select l.coach_id into coach from public.coach_links l where l.student_id = me;
  if coach is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if coalesce(student_checkin_cycle.accept, false) then
    if student_checkin_cycle.adult is not true then raise exception 'not_adult' using errcode = 'P0001'; end if;
    insert into public.checkin_cycle_consents (student_id, coach_id, adult_declared_at, consented_at)
      values (me, coach, now(), now())
      on conflict (student_id) do update
        set coach_id = excluded.coach_id, adult_declared_at = excluded.adult_declared_at, consented_at = excluded.consented_at;
    return jsonb_build_object('consented', true);
  end if;
  delete from public.checkin_cycle_consents c where c.student_id = me;
  delete from public.coach_checkin_answers a using public.coach_checkin_requests r
    where a.request_id = r.id and r.student_id = me and a.item_key = 'cycle';
  return jsonb_build_object('consented', false);
end
$$;

drop function if exists private.checkin_item_shown(jsonb, boolean, boolean);
drop function if exists private.checkin_health_ok(uuid, uuid);
drop function if exists private.checkin_is_adult(uuid);
drop function if exists private.checkin_adult_kinds();
drop function if exists private.checkin_health_version();
drop table if exists public.checkin_health_consents;
commit;
