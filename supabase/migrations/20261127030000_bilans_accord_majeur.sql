-- ═══════════════════════════════════════════════════════════
--  Bilans : accord daté pour les données de santé, questions intimes réservées aux 18 ans et plus (audit du site
--  coach, 25/11/2026, décision de Maxence). ÉCRITE, PAS APPLIQUÉE : attend le feu vert de Maxence.
--  Retour arrière : supabase/rollback/20261127030000_bilans_accord_majeur_down.sql.
--  Tests : tests/sql/bilans_accord_majeur_test.sql, tests/sql/bilans_accord_majeur_rollback_test.sh.
--
--  1. Accord daté (art. 9.2.a du RGPD) : avant son premier envoi, l'élève accepte « J'accepte d'envoyer à mon coach
--     mes réponses de bilan (données de santé) ». public.checkin_health_consents garde la date et la version du
--     texte accepté (private.checkin_health_version, 1 aujourd'hui), pour SON coach actuel : clé étrangère vers
--     coach_links on delete cascade (quitter, être retiré, bloquer, supprimer un compte efface l'accord).
--     student_checkin_answer refuse sans accord à la version en vigueur (no_health_consent). Retirer l'accord
--     (student_checkin_consent(false)) arrête les envois ; les bilans déjà envoyés restent chez le coach jusqu'à la
--     fin du suivi ou la purge des 24 mois (le retrait ne vaut que pour la suite, art. 7.3).
--  2. Majorité : la libido et le cycle menstruel (private.checkin_adult_kinds) ne sont rendus qu'à un élève qui a
--     déclaré avoir 18 ans ou plus. Déclaration EXISTANTE : public.coach_photo_adults (student_photo_adult, celle des
--     photos de bilan), ou un accord du cycle déjà donné (il exigeait la même déclaration). Accepter le cycle
--     l'enregistre désormais aussi dans coach_photo_adults (une seule déclaration pour tout). Une réponse à ces
--     suivis sans déclaration : not_adult. Le coach peut les mettre dans un modèle : ils sont sautés pour l'élève
--     qui n'a rien déclaré (jamais obligatoires : sensibles), et student_checkins dit adult_asked pour que l'app
--     propose la déclaration. Le coach ne sait pas qui est mineur (rien de plus ne lui est rendu).
--  student_checkins rend en plus { adult, adult_asked, health: { consented, version, current, at } } ; une app
--  d'avant ignore ces champs (et son envoi est refusé sans accord : elle affiche l'erreur du serveur).
-- ═══════════════════════════════════════════════════════════

create table public.checkin_health_consents (
  student_id   uuid primary key,
  coach_id     uuid not null,
  version      int not null check (version >= 1),
  consented_at timestamptz not null default now(),
  foreign key (student_id, coach_id) references public.coach_links (student_id, coach_id) on delete cascade
);
alter table public.checkin_health_consents enable row level security;
revoke all on public.checkin_health_consents from public, anon, authenticated, service_role;

-- Version du texte de l'accord (js/data/checkin-student.js, CK_HEALTH_VERSION) : + 1 si le texte change, chacun
-- réaccepte alors avant son envoi suivant
create function private.checkin_health_version() returns int
  language sql immutable set search_path = '' as $$ select 1 $$;

-- Suivis réservés aux 18 ans et plus
create function private.checkin_adult_kinds() returns text[]
  language sql immutable set search_path = '' as $$ select array['libido', 'cycle'] $$;

-- « J'ai 18 ans ou plus » déclaré (photos de bilan, ou accord du cycle qui l'exigeait)
create function private.checkin_is_adult(u uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.coach_photo_adults a where a.user_id = u)
      or exists (select 1 from public.checkin_cycle_consents c where c.student_id = u)
$$;

create function private.checkin_health_ok(student uuid, coach uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from public.checkin_health_consents h
                 where h.student_id = student and h.coach_id = coach and h.version >= private.checkin_health_version())
$$;

-- Suivi montré à l'élève : cycle avec son accord et sa majorité, libido avec sa majorité, le reste toujours
create function private.checkin_item_shown(item jsonb, adult boolean, cycle_ok boolean) returns boolean
  language sql immutable set search_path = '' as
$$
  select case when item ->> 'kind' = 'cycle' then adult and cycle_ok
              when item ->> 'kind' = any (private.checkin_adult_kinds()) then adult
              else true end
$$;

revoke all on function private.checkin_health_version(), private.checkin_adult_kinds(), private.checkin_is_adult(uuid),
  private.checkin_health_ok(uuid, uuid), private.checkin_item_shown(jsonb, boolean, boolean) from public, anon, authenticated, service_role;

-- Demandes de l'élève (comme 20261125010000), suivis filtrés par private.checkin_item_shown, plus adult,
-- adult_asked et health
create or replace function public.student_checkins() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  coach uuid;
  consented boolean;
  adult boolean;
  h public.checkin_health_consents%rowtype;
  health jsonb;
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  select l.coach_id into coach from public.coach_links l where l.student_id = me;
  consented := exists (select 1 from public.checkin_cycle_consents c where c.student_id = me and c.coach_id = coach);
  adult := private.checkin_is_adult(me);
  select * into h from public.checkin_health_consents x where x.student_id = me and x.coach_id = coach;
  health := jsonb_build_object('consented', coalesce(h.version >= private.checkin_health_version(), false), 'version', h.version,
                               'current', private.checkin_health_version(), 'at', h.consented_at);
  if coach is null or private.blocked_between(me, coach) then
    return jsonb_build_object('requests', '[]'::jsonb, 'cycle', jsonb_build_object('consented', consented, 'asked', false),
                              'adult', adult, 'adult_asked', false, 'health', health);
  end if;
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'coach_id', r.coach_id, 'name', r.name,
               'items', coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(r.items) with ordinality z(e, o)
                                  where private.checkin_item_shown(e, adult, consented)), '[]'::jsonb),
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
    'cycle', jsonb_build_object('consented', consented, 'asked', adult and not consented and exists (
      select 1 from public.coach_checkin_requests x, jsonb_array_elements(x.items) e
      where x.student_id = me and x.coach_id = coach and x.answered_at is null and x.cancelled_at is null and e ->> 'kind' = 'cycle')),
    'adult', adult,
    'adult_asked', not adult and exists (
      select 1 from public.coach_checkin_requests x, jsonb_array_elements(x.items) e
      where x.student_id = me and x.coach_id = coach and x.answered_at is null and x.cancelled_at is null
        and e ->> 'kind' = any (private.checkin_adult_kinds())),
    'health', health);
end
$$;

-- Répondre à un bilan (comme 20261125010000), plus : sans accord à la version en vigueur, no_health_consent ;
-- libido ou cycle sans la déclaration des 18 ans, not_adult ; un suivi sauté pour l'élève n'est jamais exigé
create or replace function public.student_checkin_answer(request uuid, answers jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  rq public.coach_checkin_requests%rowtype;
  consented boolean;
  adult boolean;
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
  if not private.checkin_health_ok(me, rq.coach_id) then raise exception 'no_health_consent' using errcode = 'P0001'; end if;
  if student_checkin_answer.answers is null or jsonb_typeof(student_checkin_answer.answers) <> 'object' then
    raise exception 'invalid_answer' using errcode = 'P0001';
  end if;
  consented := exists (select 1 from public.checkin_cycle_consents c where c.student_id = me and c.coach_id = rq.coach_id);
  adult := private.checkin_is_adult(me);
  for e in select a.key, a.value from jsonb_each(student_checkin_answer.answers) a loop
    select x into it from jsonb_array_elements(rq.items) x where x ->> 'key' = e.key;
    if it is null or not private.checkin_value_ok(it, e.value) then raise exception 'invalid_answer' using errcode = 'P0001'; end if;
    if it ->> 'kind' = any (private.checkin_adult_kinds()) and not adult then raise exception 'not_adult' using errcode = 'P0001'; end if;
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
               and private.checkin_item_shown(x, adult, consented)) then
    raise exception 'invalid_answer' using errcode = 'P0001';
  end if;
  insert into public.coach_checkin_answers (request_id, item_key, value)
    select rq.id, a.key, a.value from jsonb_each(student_checkin_answer.answers) a;
  update public.coach_checkin_requests x set answered_at = now() where x.id = rq.id returning * into rq;
  return jsonb_build_object('answered_at', rq.answered_at);
end
$$;

-- Accord du cycle (comme 20261125010000), plus : la déclaration des 18 ans est aussi gardée dans
-- coach_photo_adults (une seule déclaration, qui reste si l'accord du cycle est retiré)
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
    insert into public.coach_photo_adults (user_id) values (me) on conflict (user_id) do nothing;
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

-- Accord daté pour les bilans (données de santé), donné à mon coach actuel (pas de coach : not_found). Accepter
-- exige la version du texte en vigueur (sinon invalid_version : l'app a montré un autre texte). Retirer arrête
-- les envois. Rend { consented, version, current, at }.
create function public.student_checkin_consent(accept boolean, version int default null) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  coach uuid;
  h public.checkin_health_consents%rowtype;
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  select l.coach_id into coach from public.coach_links l where l.student_id = me;
  if coach is null or private.blocked_between(me, coach) then raise exception 'not_found' using errcode = 'P0001'; end if;
  if coalesce(student_checkin_consent.accept, false) then
    if student_checkin_consent.version is distinct from private.checkin_health_version() then
      raise exception 'invalid_version' using errcode = 'P0001';
    end if;
    insert into public.checkin_health_consents as c (student_id, coach_id, version, consented_at)
      values (me, coach, student_checkin_consent.version, now())
      on conflict (student_id) do update set coach_id = excluded.coach_id, version = excluded.version, consented_at = excluded.consented_at
      returning * into h;
  else
    delete from public.checkin_health_consents c where c.student_id = me;
  end if;
  return jsonb_build_object('consented', h.student_id is not null, 'version', h.version,
                            'current', private.checkin_health_version(), 'at', h.consented_at);
end
$$;

revoke all on function public.student_checkin_consent(boolean, int) from public, anon, authenticated, service_role;
grant execute on function public.student_checkin_consent(boolean, int) to authenticated;
