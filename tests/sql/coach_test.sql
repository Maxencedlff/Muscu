-- Vérifications de supabase/migrations/20261027100000_coach.sql (lancées par tests/sql/run.sh).
-- Chaque bloc échoue (raise) si la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.cu('k') → …00000000060a, l → b, s → c, t → d, u → e, v → f) : K kevin.c1 et L laura.c1 sont coachs
-- (coach_at posé par l'administrateur, ici postgres) ; S sam.c1 et T theo.c1 sont élèves de K ;
-- U ugo.c1 n'est ni l'un ni l'autre ; V sert aux limites. pg_temp.cu50(i) → …0000006100ii : les
-- 50 élèves de L (équipe pleine). Aucun n'active le social : le coach n'en dépend pas.
-- pg_temp.clogin change d'utilisateur (auth.uid()) sans changer de rôle, comme un autre jeton.

create function pg_temp.cerr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.cu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000060' || translate(c, 'klstuv', 'abcdef'))::uuid $$;
create function pg_temp.cu50(i int) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-0000006100' || lpad(i::text, 2, '0'))::uuid $$;
create function pg_temp.clogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.cu(c)::text, false) $$;
create function pg_temp.clogin50(i int) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.cu50(i)::text, false) $$;
grant execute on function pg_temp.cerr(text), pg_temp.cu(text), pg_temp.cu50(int), pg_temp.clogin(text), pg_temp.clogin50(int)
  to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.cu(c) from unnest(array['k', 'l', 's', 't', 'u', 'v']) c;
insert into auth.users (id) select pg_temp.cu50(i) from generate_series(1, 51) i;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.cu('k'), 'kevin.c1', '🦁'), (pg_temp.cu('l'), 'laura.c1', '🦊'), (pg_temp.cu('s'), 'sam.c1', '🦅'),
  (pg_temp.cu('t'), 'theo.c1', '🐼'), (pg_temp.cu('u'), 'ugo.c1', '⭐');
-- V a un profil sans pseudo : il ne peut pas rejoindre un coach tant qu'il n'en a pas choisi un
insert into public.user_profiles (user_id, avatar_emoji) values (pg_temp.cu('v'), '🦉');
-- Les 50 élèves de L ont un pseudo
insert into public.user_profiles (user_id, username, avatar_emoji)
  select pg_temp.cu50(i), 'eleve' || lpad(i::text, 2, '0') || '.c1', '🐺' from generate_series(1, 51) i;

-- ── Le rôle coach : administrateur seulement ─────────────
set role authenticated;
do $$
declare st jsonb;
begin
  perform pg_temp.clogin('k');
  if pg_temp.cerr($q$ update public.user_profiles set coach_at = now() $q$) not like 'permission denied%' then raise 'coach_at modifiable'; end if;
  perform pg_temp.clogin('v');
  if pg_temp.cerr($q$ insert into public.user_profiles (username, coach_at) values ('vic.c1', now()) $q$) not like 'permission denied%' then raise 'coach_at à l''insertion'; end if;
  perform pg_temp.clogin('k');
  if pg_temp.cerr($q$ select public.coach_create_invite() $q$) is distinct from 'not_coach' then raise 'invitation sans être coach'; end if;
  st := public.coach_state();
  if st is distinct from '{"is_coach": false, "coach": null, "students": [], "removed": [], "invites": [], "badge": 0, "badge_coach": 0, "badge_student": 0}'::jsonb then raise 'état vide : %', st; end if;
  -- Aucune fonction du schéma public ne pose coach_at
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%coach_at%') then
    raise 'une RPC écrit ou lit coach_at directement';
  end if;
end $$;
reset role;
update public.user_profiles set coach_at = now() where user_id in (pg_temp.cu('k'), pg_temp.cu('l'));
set role authenticated;

-- ── Séances des élèves ───────────────────────────────────
do $$ begin
  perform pg_temp.clogin('s');
  insert into public.sessions (id, data) values
    ('s-1', jsonb_build_object(
      'date', 1780000000000, 'duration', 3600, 'programme', 'u_c00000000_progA', 'category', 'push', 'label', 'Push A',
      'notes', 'genou un peu sensible', 'bodyKg', 80.5, 'healthSaved', true, 'cleInventee', 'secret-futur',
      'exercises', jsonb_build_array(
        jsonb_build_object('name', 'Squat', 'measure', 'reps', 'ss', 'g1', 'note', 'secret-ex',
          'sets', jsonb_build_array(jsonb_build_object('weight', '100', 'reps', '5', 'rpe', 'secret-set'))),
        jsonb_build_object('name', jsonb_build_object('fuite', 'secret-objet'))))),
    ('s-masquee', '{"date": 1780000001000, "hidden": true, "category": "pull", "label": "Pull", "notes": "masquée mais vue du coach", "exercises": []}'),
    ('s-supprimee', '{"date": 1780000002000, "category": "legs", "exercises": []}'),
    ('s-sans-date', '{"category": "legs", "exercises": []}'),
    ('s-notes-objet', '{"date": 1700000000000, "notes": {"fuite": "secret-objet"}, "exercises": []}'),
    ('s-futur', jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint + 2 * 86400000, 'exercises', '[]'::jsonb));
  update public.sessions set deleted_at = now() where id = 's-supprimee';
  -- 31 séances anciennes, dont 3 à la même milliseconde : pagination
  insert into public.sessions (id, data)
    select 's-old-' || lpad(i::text, 2, '0'), jsonb_build_object('date', 1700000000000 + least(i, 29), 'exercises', '[]'::jsonb)
    from generate_series(1, 31) i;
  perform pg_temp.clogin('t');
  insert into public.sessions (id, data) values ('t-1', '{"date": 1780000000500, "category": "legs", "notes": "note de theo", "exercises": []}');
  perform pg_temp.clogin('u');
  insert into public.sessions (id, data) values ('u-1', '{"date": 1780000000600, "notes": "note d''ugo", "exercises": []}');
end $$;

-- ── Codes d'invitation ───────────────────────────────────
create temp table codes (who text, code text);
grant all on codes to authenticated, anon;
do $$
declare c text; st jsonb;
begin
  perform pg_temp.clogin('k');
  c := public.coach_create_invite();
  if c !~ '^[A-HJ-NP-Z2-9]{8}$' then raise 'format du code : %', c; end if;
  insert into codes values ('k1', c);
  st := public.coach_state();
  if not (st ->> 'is_coach')::boolean or st -> 'invites' -> 0 ->> 'code' is distinct from c then raise 'codes actifs : %', st; end if;
  if (st -> 'invites' -> 0 ->> 'expires_at')::timestamptz not between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute' then raise 'validité de 7 jours'; end if;
  -- 6 codes de plus : 5 actifs au plus, les plus anciens remplacés
  for i in 1..6 loop perform public.coach_create_invite(); perform pg_sleep(0.002); end loop;
  st := public.coach_state();
  if jsonb_array_length(st -> 'invites') is distinct from 5 then raise '5 codes actifs : %', st -> 'invites'; end if;
  if exists (select 1 from jsonb_array_elements(st -> 'invites') e where e ->> 'code' = c) then raise 'le plus ancien gardé'; end if;
  insert into codes select 'k-actif', e ->> 'code' from jsonb_array_elements(st -> 'invites') e;
  -- Révocation : seulement un de mes codes ; silencieux sinon
  c := st -> 'invites' -> 4 ->> 'code';
  perform pg_temp.clogin('l');
  perform public.coach_revoke_invite(c);
  perform public.coach_revoke_invite('ZZZZZZZZ');
  perform public.coach_revoke_invite(null);
  perform pg_temp.clogin('k');
  if jsonb_array_length(public.coach_state() -> 'invites') is distinct from 5 then raise 'code révoqué par un autre coach'; end if;
  perform public.coach_revoke_invite(lower(substr(c, 1, 4)) || '-' || substr(c, 5));
  if jsonb_array_length(public.coach_state() -> 'invites') is distinct from 4 then raise 'révocation (saisie normalisée)'; end if;
  insert into codes values ('k-revoque', c);
  perform pg_temp.clogin('l');
  insert into codes values ('l1', public.coach_create_invite());
end $$;

-- ── Aperçu et adhésion ───────────────────────────────────
do $$
declare c text := (select code from codes where who = 'k-actif' limit 1); p jsonb; st jsonb;
begin
  perform pg_temp.clogin('s');
  -- Aperçu : le coach, rien de créé ; saisie en minuscules avec espace et tiret acceptée
  p := public.coach_preview(' ' || lower(substr(c, 1, 4)) || '-' || substr(c, 5) || ' ');
  if p is distinct from jsonb_build_object('user_id', pg_temp.cu('k'), 'username', 'kevin.c1', 'avatar', '🦁', 'since', null) then raise 'aperçu : %', p; end if;
  if public.coach_state() -> 'coach' is distinct from 'null'::jsonb then raise 'aperçu a créé un lien'; end if;
  -- Codes inconnus, révoqués, mal formés, vides
  if pg_temp.cerr($q$ select public.coach_preview('ZZZZZZZZ') $q$) is distinct from 'invalid_code' then raise 'aperçu code inconnu'; end if;
  if pg_temp.cerr(format('select public.coach_preview(%L)', (select code from codes where who = 'k-revoque'))) is distinct from 'invalid_code' then raise 'aperçu code révoqué'; end if;
  if pg_temp.cerr($q$ select public.coach_join('ABC') $q$) is distinct from 'invalid_code' then raise 'code trop court'; end if;
  if pg_temp.cerr($q$ select public.coach_join(null) $q$) is distinct from 'invalid_code' then raise 'code null'; end if;
  if pg_temp.cerr($q$ select public.coach_join('O0I1O0I1') $q$) is distinct from 'invalid_code' then raise 'symboles exclus'; end if;
  -- Rejoindre
  p := public.coach_join(c);
  if p ->> 'user_id' is distinct from pg_temp.cu('k')::text or p ->> 'username' is distinct from 'kevin.c1' or p ->> 'since' is null then raise 'adhésion : %', p; end if;
  -- Rejouée (coupure réseau) : même réponse, sans erreur ni doublon
  if public.coach_join(c) ->> 'user_id' is distinct from pg_temp.cu('k')::text then raise 'adhésion rejouée'; end if;
  st := public.coach_state();
  if st -> 'coach' ->> 'username' is distinct from 'kevin.c1' or (st ->> 'is_coach')::boolean or st -> 'students' is distinct from '[]'::jsonb
     or (st ->> 'badge')::int is distinct from 0 then raise 'état élève : %', st; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(st) k) is distinct from array['badge', 'badge_coach', 'badge_student', 'coach', 'invites', 'is_coach', 'removed', 'students'] then raise 'clés de coach_state : %', st; end if;
  -- Déjà un coach : un code de L est refusé (aperçu et adhésion)
  if pg_temp.cerr(format('select public.coach_preview(%L)', (select code from codes where who = 'l1'))) is distinct from 'already_coached' then raise 'aperçu déjà suivi'; end if;
  if pg_temp.cerr(format('select public.coach_join(%L)', (select code from codes where who = 'l1'))) is distinct from 'already_coached' then raise 'deux coachs'; end if;
  -- Le même code sert à un autre élève (jusqu'à expiration)
  perform pg_temp.clogin('t'); perform public.coach_join(c);
  -- Sans pseudo : username_required (aperçu et adhésion), rien de créé ; avec un pseudo : accepté
  perform pg_temp.clogin('v');
  if pg_temp.cerr(format('select public.coach_preview(%L)', c)) is distinct from 'username_required' then raise 'aperçu sans pseudo'; end if;
  if pg_temp.cerr(format('select public.coach_join(%L)', c)) is distinct from 'username_required' then raise 'adhésion sans pseudo'; end if;
  if pg_temp.cerr($q$ select public.coach_join('ZZZZZZZZ') $q$) is distinct from 'username_required' then raise 'pseudo vérifié avant le code'; end if;
  if public.coach_state() -> 'coach' is distinct from 'null'::jsonb then raise 'lien créé sans pseudo'; end if;
  perform pg_temp.clogin('u');   -- sans ligne de profil du tout : pareil
  reset role;
  delete from public.user_profiles where user_id = pg_temp.cu('u');
  set role authenticated;
  if pg_temp.cerr(format('select public.coach_join(%L)', c)) is distinct from 'username_required' then raise 'adhésion sans profil'; end if;
  reset role;
  insert into public.user_profiles (user_id, username, avatar_emoji) values (pg_temp.cu('u'), 'ugo.c1', '⭐');
  update public.user_profiles set username = 'vic.c1' where user_id = pg_temp.cu('v');
  set role authenticated;
  perform pg_temp.clogin('v'); perform public.coach_join(c);
  -- Son propre code : not_found
  perform pg_temp.clogin('k');
  if pg_temp.cerr(format('select public.coach_join(%L)', c)) is distinct from 'not_found' then raise 'rejoindre son propre code'; end if;
  if pg_temp.cerr(format('select public.coach_preview(%L)', c)) is distinct from 'not_found' then raise 'aperçu de son propre code'; end if;
  -- Un coach peut être l'élève d'un autre coach (il garde les fonctions d'un utilisateur normal)
  perform pg_temp.clogin('k'); perform public.coach_join((select code from codes where who = 'l1'));
  perform public.coach_leave();
end $$;

-- ── Ce que voit le coach ─────────────────────────────────
do $$
declare st jsonb; r record; n int; last record; ids text[]; stu jsonb;
begin
  perform pg_temp.clogin('k');
  st := public.coach_state();
  if jsonb_array_length(st -> 'students') is distinct from 3 then raise 'élèves : %', st -> 'students'; end if;
  select e into stu from jsonb_array_elements(st -> 'students') e where e ->> 'user_id' = pg_temp.cu('s')::text;
  if stu ->> 'username' is distinct from 'sam.c1' or stu ->> 'avatar' is distinct from '🦅' or stu ->> 'since' is null
     or (stu ->> 'last_session_at')::bigint is distinct from 1780000001000 or (stu ->> 'sessions_7d')::int is distinct from 0
     or stu -> 'last_session' is distinct from '{"done_at": 1780000001000, "label": "Pull", "programme": null}'::jsonb
     then raise 'élève S : %', stu; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(stu) k)
     is distinct from array['avatar', 'last_session', 'last_session_at', 'new_sessions', 'sent', 'sessions_7d', 'since', 'user_id', 'username'] then raise 'clés d''un élève : %', stu; end if;
  -- Séances d'avant l'adhésion : pas « nouvelles »
  if (stu ->> 'new_sessions')::int is distinct from 0 or (st ->> 'badge')::int is distinct from 0 then raise 'nouvelles séances d''avant l''adhésion : %', st; end if;
  -- V, sans séance
  select e into stu from jsonb_array_elements(st -> 'students') e where e ->> 'user_id' = pg_temp.cu('v')::text;
  if stu ->> 'username' is distinct from 'vic.c1' or stu ->> 'avatar' is distinct from '🦉' or stu -> 'last_session' is distinct from 'null'::jsonb or stu -> 'last_session_at' is distinct from 'null'::jsonb then raise 'élève V : %', stu; end if;

  -- Séances : 30 par page, masquée comprise ; supprimée, sans date et futur lointain exclus
  select count(*) into n from public.coach_student_sessions(pg_temp.cu('s'));
  if n is distinct from 30 then raise 'page de 30 : %', n; end if;
  select * into r from public.coach_student_sessions(pg_temp.cu('s')) limit 1;
  if r.id is distinct from 's-masquee' or r.done_at is distinct from 1780000001000 then raise 'tri : %', r; end if;
  if r.s ->> 'hidden' is distinct from 'true' or r.s ->> 'notes' is distinct from 'masquée mais vue du coach' then raise 'masquée : %', r.s; end if;
  if exists (select 1 from public.coach_student_sessions(pg_temp.cu('s')) where id in ('s-supprimee', 's-sans-date', 's-futur')) then raise 'séance non montrable'; end if;
  -- Liste blanche exacte
  select * into r from public.coach_student_sessions(pg_temp.cu('s')) where id = 's-1';
  if (select array_agg(k order by k) from jsonb_object_keys(r.s) k)
     is distinct from array['category', 'date', 'duration', 'exercises', 'id', 'label', 'notes', 'programme'] then raise 'clés de la séance : %', r.s; end if;
  if r.s ->> 'id' is distinct from 's-1' or r.s ->> 'notes' is distinct from 'genou un peu sensible' or r.s ->> 'programme' is distinct from 'u_c00000000_progA' then raise 'valeurs : %', r.s; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(r.s -> 'exercises' -> 0) k) is distinct from array['measure', 'name', 'sets', 'ss'] then raise 'clés de l''exercice : %', r.s; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(r.s -> 'exercises' -> 0 -> 'sets' -> 0) k) is distinct from array['reps', 'weight'] then raise 'clés de la série : %', r.s; end if;
  if r.s::text ~ '(bodyKg|healthSaved|secret|cleInventee|rpe|hidden)' then raise 'fuite : %', r.s; end if;
  -- notes qui n'est pas un texte : omise
  if (select s ? 'notes' from public.coach_student_sessions(pg_temp.cu('s'), 1700000000001) where id = 's-notes-objet') is not false then raise 'notes objet'; end if;
  if (select s::text from public.coach_student_sessions(pg_temp.cu('s'), 1700000000001) where id = 's-notes-objet') ~ 'secret' then raise 'fuite notes objet'; end if;
  -- Aucune page ne contient de clé interdite
  if exists (select 1 from public.coach_student_sessions(pg_temp.cu('s')) where s::text ~ '(bodyKg|healthSaved|cleInventee)') then raise 'fuite dans la page'; end if;

  -- Curseur complet : 30 + 4 = 34 séances montrables (s-1, s-masquee, s-notes-objet, 31 anciennes), sans doublon
  select * into last from public.coach_student_sessions(pg_temp.cu('s')) offset 29 limit 1;
  select array_agg(id) into ids from (
    select id from public.coach_student_sessions(pg_temp.cu('s'))
    union all
    select id from public.coach_student_sessions(pg_temp.cu('s'), last.done_at, last.id)) x;
  if cardinality(ids) is distinct from 34 or (select count(distinct i) from unnest(ids) i) is distinct from 34 then raise 'pages : %', ids; end if;
  -- before_at seul : strictement plus anciennes
  if exists (select 1 from public.coach_student_sessions(pg_temp.cu('s'), 1700000000029) where done_at >= 1700000000029) then raise 'before_at seul'; end if;

  -- Pas l'élève de K : not_found (U, un élève absent, soi-même, null)
  if pg_temp.cerr($q$ select * from public.coach_student_sessions(pg_temp.cu('u')) $q$) is distinct from 'not_found' then raise 'séances d''un non-élève'; end if;
  if pg_temp.cerr($q$ select * from public.coach_student_sessions(pg_temp.cu('k')) $q$) is distinct from 'not_found' then raise 'ses propres séances'; end if;
  if pg_temp.cerr($q$ select * from public.coach_student_sessions(null) $q$) is distinct from 'not_found' then raise 'élève null'; end if;
  -- L (autre coach) ne voit pas les élèves de K
  perform pg_temp.clogin('l');
  if pg_temp.cerr($q$ select * from public.coach_student_sessions(pg_temp.cu('s')) $q$) is distinct from 'not_found' then raise 'L voit S'; end if;
  if public.coach_state() -> 'students' is distinct from '[]'::jsonb then raise 'L voit les élèves de K'; end if;
  if pg_temp.cerr($q$ select public.coach_mark_seen(pg_temp.cu('s')) $q$) is distinct from 'not_found' then raise 'L marque S vu'; end if;
  -- Un élève ne voit pas les séances d'un autre élève du même coach
  perform pg_temp.clogin('t');
  if pg_temp.cerr($q$ select * from public.coach_student_sessions(pg_temp.cu('s')) $q$) is distinct from 'not_found' then raise 'T voit S'; end if;
  st := public.coach_state();
  if st -> 'students' is distinct from '[]'::jsonb or st::text ~ 'sam.c1' then raise 'T voit les autres élèves : %', st; end if;
  if public.student_inbox()::text ~ 'sam' then raise 'boîte de T'; end if;
end $$;

-- ── Nouvelles séances et coach_mark_seen ─────────────────
do $$
declare st jsonb; stu jsonb; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  -- Lien créé il y a une heure, deux séances depuis (dans le passé : now() est figé dans le bloc)
  reset role;
  update public.coach_links set created_at = now() - interval '1 hour' where student_id = pg_temp.cu('s');
  set role authenticated;
  perform pg_temp.clogin('s');
  insert into public.sessions (id, data) values
    ('s-new-1', jsonb_build_object('date', now_ms - 60000, 'category', 'push', 'label', 'Push', 'programme', 'u_c00000000_progA', 'exercises', '[]'::jsonb)),
    ('s-new-2', jsonb_build_object('date', now_ms - 30000, 'category', 'legs', 'label', 'Legs', 'programme', 'u_c00000000_progA', 'exercises', '[]'::jsonb));
  perform pg_temp.clogin('k');
  st := public.coach_state();
  select e into stu from jsonb_array_elements(st -> 'students') e where e ->> 'user_id' = pg_temp.cu('s')::text;
  if (stu ->> 'new_sessions')::int is distinct from 2 or (stu ->> 'sessions_7d')::int is distinct from 2 or (st ->> 'badge')::int is distinct from 2
     or stu -> 'last_session' is distinct from jsonb_build_object('done_at', now_ms - 30000, 'label', 'Legs', 'programme', 'u_c00000000_progA')
     then raise 'nouvelles séances : %', st; end if;
  -- Un autre coach (L) ne compte rien ; T ne voit pas le compteur de S
  perform pg_temp.clogin('l');
  if (public.coach_state() ->> 'badge')::int is distinct from 0 then raise 'badge de L'; end if;
  perform pg_temp.clogin('t');
  if (public.coach_state() ->> 'badge')::int is distinct from 0 then raise 'badge de T'; end if;
  -- K coach (2 nouvelles séances de S) et élève de L (1 programme non vu) : deux badges séparés
  perform pg_temp.clogin('k'); perform public.coach_join((select code from codes where who = 'l1'));
  perform pg_temp.clogin('l'); perform public.coach_send_programme(pg_temp.cu('k'), 'progK', '{"name": "K"}');
  perform pg_temp.clogin('k');
  st := public.coach_state();
  if (st ->> 'badge_coach')::int is distinct from 2 or (st ->> 'badge_student')::int is distinct from 1 or (st ->> 'badge')::int is distinct from 3
     then raise 'badges coach et élève : %', st; end if;
  perform public.student_mark_seen('programme', 'progK');
  st := public.coach_state();
  if (st ->> 'badge_coach')::int is distinct from 2 or (st ->> 'badge_student')::int is distinct from 0 or (st ->> 'badge')::int is distinct from 2
     then raise 'badge élève vu : %', st; end if;
  -- L : son élève K n'a aucune séance ; les séances de S ne comptent pas chez lui
  perform pg_temp.clogin('l');
  st := public.coach_state();
  if (st ->> 'badge_coach')::int is distinct from 0 or (st ->> 'badge_student')::int is distinct from 0 then raise 'badges de L : %', st; end if;
  perform pg_temp.clogin('s');
  st := public.coach_state();
  if (st ->> 'badge_coach')::int is distinct from 0 or (st ->> 'badge_student')::int is distinct from 0 then raise 'badges de S : %', st; end if;
  perform pg_temp.clogin('k'); perform public.coach_leave();
  -- Marquer vu remet à zéro
  perform pg_temp.clogin('k');
  perform public.coach_mark_seen(pg_temp.cu('s'));
  st := public.coach_state();
  select e into stu from jsonb_array_elements(st -> 'students') e where e ->> 'user_id' = pg_temp.cu('s')::text;
  if (stu ->> 'new_sessions')::int is distinct from 0 or (st ->> 'badge')::int is distinct from 0 or (st ->> 'badge_coach')::int is distinct from 0 then raise 'après coach_mark_seen : %', st; end if;
  if pg_temp.cerr($q$ select public.coach_mark_seen(pg_temp.cu('u')) $q$) is distinct from 'not_found' then raise 'mark_seen d''un non-élève'; end if;
  if pg_temp.cerr($q$ select public.coach_mark_seen(null) $q$) is distinct from 'not_found' then raise 'mark_seen null'; end if;
  -- Une séance supprimée ne compte plus
  perform pg_temp.clogin('s');
  update public.sessions set deleted_at = now() where id in ('s-new-1', 's-new-2');
end $$;

-- ── Commentaires ─────────────────────────────────────────
do $$
declare st jsonb; ib jsonb;
begin
  perform pg_temp.clogin('k');
  perform public.coach_set_note(pg_temp.cu('s'), 's-1', '  Belle séance, garde le dos droit  ');
  if (select note from public.coach_student_sessions(pg_temp.cu('s')) where id = 's-1') is distinct from 'Belle séance, garde le dos droit' then raise 'commentaire dans les séances'; end if;
  perform public.coach_set_note(pg_temp.cu('s'), 's-masquee', repeat('x', 1000));
  if pg_temp.cerr($q$ select public.coach_set_note(pg_temp.cu('s'), 's-1', repeat('x', 1001)) $q$) is distinct from 'too_long' then raise '1001 caractères'; end if;
  if pg_temp.cerr($q$ select public.coach_set_note(pg_temp.cu('s'), 'nexiste-pas', 'x') $q$) is distinct from 'not_found' then raise 'séance inexistante'; end if;
  if pg_temp.cerr($q$ select public.coach_set_note(pg_temp.cu('s'), 's-supprimee', 'x') $q$) is distinct from 'not_found' then raise 'séance supprimée'; end if;
  if pg_temp.cerr($q$ select public.coach_set_note(pg_temp.cu('u'), 'u-1', 'x') $q$) is distinct from 'not_found' then raise 'commentaire chez un non-élève'; end if;
  -- La séance d'un autre élève sous l'identifiant de S
  if pg_temp.cerr($q$ select public.coach_set_note(pg_temp.cu('s'), 't-1', 'x') $q$) is distinct from 'not_found' then raise 'séance de T sous S'; end if;
  perform pg_temp.clogin('l');
  if pg_temp.cerr($q$ select public.coach_set_note(pg_temp.cu('s'), 's-1', 'x') $q$) is distinct from 'not_found' then raise 'L commente S'; end if;
  perform pg_temp.clogin('u');
  if pg_temp.cerr($q$ select public.coach_set_note(pg_temp.cu('s'), 's-1', 'x') $q$) is distinct from 'not_coach' then raise 'U commente'; end if;

  -- Côté élève : boîte, badge, vu
  perform pg_temp.clogin('s');
  st := public.coach_state();
  if (st ->> 'badge')::int is distinct from 2 then raise 'badge élève : %', st; end if;
  ib := public.student_inbox();
  if (select array_agg(k order by k) from jsonb_object_keys(ib) k) is distinct from array['notes', 'programmes'] then raise 'clés de la boîte : %', ib; end if;
  if jsonb_array_length(ib -> 'notes') is distinct from 2 or ib -> 'notes' -> 0 ->> 'session_id' is distinct from 's-masquee'
     or (ib -> 'notes' -> 1 ->> 'seen')::boolean or ib -> 'notes' -> 1 ->> 'text' is distinct from 'Belle séance, garde le dos droit' then raise 'boîte : %', ib; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(ib -> 'notes' -> 0) k) is distinct from array['seen', 'session_id', 'text', 'updated_at'] then raise 'clés d''un commentaire'; end if;
  perform public.student_mark_seen('note', 's-1');
  perform public.student_mark_seen('note', 'nexiste-pas');
  perform public.student_mark_seen('autre', 's-masquee');
  perform public.student_mark_seen(null, null);
  if (public.coach_state() ->> 'badge')::int is distinct from 1 then raise 'badge après vu'; end if;
  if not (select (e ->> 'seen')::boolean from jsonb_array_elements(public.student_inbox() -> 'notes') e where e ->> 'session_id' = 's-1') then raise 'vu'; end if;
  -- T ne peut pas marquer vu le commentaire de S
  perform pg_temp.clogin('t');
  perform public.student_mark_seen('note', 's-masquee');
  if public.student_inbox() is distinct from '{"programmes": [], "notes": []}'::jsonb then raise 'boîte de T : %', public.student_inbox(); end if;
  perform pg_temp.clogin('s');
  if (public.coach_state() ->> 'badge')::int is distinct from 1 then raise 'vu par T'; end if;

  -- Modifier : seen_at remis à null ; texte vide : supprimé
  perform pg_temp.clogin('k');
  perform public.coach_set_note(pg_temp.cu('s'), 's-1', 'Corrigé');
  perform public.coach_set_note(pg_temp.cu('s'), 's-masquee', '   ');
  perform pg_temp.clogin('s');
  ib := public.student_inbox();
  if jsonb_array_length(ib -> 'notes') is distinct from 1 or ib -> 'notes' -> 0 ->> 'text' is distinct from 'Corrigé' or (ib -> 'notes' -> 0 ->> 'seen')::boolean then raise 'modification : %', ib; end if;
  perform pg_temp.clogin('k');
  perform public.coach_set_note(pg_temp.cu('s'), 's-masquee', null);   -- déjà absent : sans effet
end $$;

-- ── Envoi de programmes ──────────────────────────────────
do $$
declare ib jsonb; sent jsonb; prog jsonb := '{"name": "Force 5x5", "consigne": "Pas d''échec", "sessions": [{"key": "a", "label": "A", "color": "#f00", "exercises": [{"name": "Squat", "sets": 5, "consigne": "Lent"}]}]}';
begin
  perform pg_temp.clogin('k');
  perform public.coach_send_programme(pg_temp.cu('s'), 'progA', prog);
  perform pg_temp.clogin('s');
  ib := public.student_inbox();
  if jsonb_array_length(ib -> 'programmes') is distinct from 1 or ib -> 'programmes' -> 0 ->> 'id' is distinct from 'progA'
     or ib -> 'programmes' -> 0 -> 'data' is distinct from prog or (ib -> 'programmes' -> 0 ->> 'seen')::boolean
     or ib -> 'programmes' -> 0 ->> 'sent_at' is null then raise 'programme reçu : %', ib; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(ib -> 'programmes' -> 0) k) is distinct from array['data', 'id', 'seen', 'sent_at'] then raise 'clés d''un programme'; end if;
  if (public.coach_state() ->> 'badge')::int is distinct from 2 then raise 'badge programme + commentaire'; end if;
  -- Le coach voit l'envoi, pas encore vu
  perform pg_temp.clogin('k');
  sent := (select e -> 'sent' from jsonb_array_elements(public.coach_state() -> 'students') e where e ->> 'user_id' = pg_temp.cu('s')::text);
  if jsonb_array_length(sent) is distinct from 1 or sent -> 0 ->> 'id' is distinct from 'progA' or (sent -> 0 ->> 'seen')::boolean is not false
     or sent -> 0 ->> 'sent_at' is null then raise 'sent : %', sent; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(sent -> 0) k) is distinct from array['id', 'seen', 'sent_at'] then raise 'clés de sent : %', sent; end if;
  -- Les autres élèves n'ont rien reçu
  if exists (select 1 from jsonb_array_elements(public.coach_state() -> 'students') e
             where e ->> 'user_id' <> pg_temp.cu('s')::text and e -> 'sent' is distinct from '[]'::jsonb) then raise 'sent chez un autre élève'; end if;
  -- Un autre coach, l'élève lui-même, un autre élève : rien
  perform pg_temp.clogin('l');
  if public.coach_state()::text ~ 'progA' then raise 'L voit l''envoi de K'; end if;
  perform pg_temp.clogin('t');
  if public.coach_state()::text ~ 'progA' or public.coach_state() -> 'students' is distinct from '[]'::jsonb then raise 'T voit l''envoi à S'; end if;
  perform pg_temp.clogin('s');
  if public.coach_state() -> 'students' is distinct from '[]'::jsonb then raise 'S voit sent'; end if;
  perform public.student_mark_seen('programme', 'progA');
  if (public.coach_state() ->> 'badge')::int is distinct from 1 then raise 'programme vu'; end if;
  -- seen passe à vrai chez le coach
  perform pg_temp.clogin('k');
  sent := (select e -> 'sent' from jsonb_array_elements(public.coach_state() -> 'students') e where e ->> 'user_id' = pg_temp.cu('s')::text);
  if (sent -> 0 ->> 'seen')::boolean is not true then raise 'seen après student_mark_seen : %', sent; end if;
  perform pg_temp.clogin('s');
  -- Nouvel envoi du même prog_id : mis à jour, à revoir
  perform pg_temp.clogin('k');
  perform public.coach_send_programme(pg_temp.cu('s'), 'progA', prog || '{"name": "Force 5x5 v2"}');
  perform public.coach_send_programme(pg_temp.cu('s'), 'progB', '{"name": "B", "sessions": []}');
  perform pg_temp.clogin('s');
  ib := public.student_inbox();
  if jsonb_array_length(ib -> 'programmes') is distinct from 2 then raise 'deux programmes : %', ib; end if;
  if (select e -> 'data' ->> 'name' from jsonb_array_elements(ib -> 'programmes') e where e ->> 'id' = 'progA') is distinct from 'Force 5x5 v2'
     or (select (e ->> 'seen')::boolean from jsonb_array_elements(ib -> 'programmes') e where e ->> 'id' = 'progA') then raise 'mise à jour : %', ib; end if;
  -- Chez le coach : deux envois, le plus récent d'abord, progA de nouveau non vu
  perform pg_temp.clogin('k');
  sent := (select e -> 'sent' from jsonb_array_elements(public.coach_state() -> 'students') e where e ->> 'user_id' = pg_temp.cu('s')::text);
  if jsonb_array_length(sent) is distinct from 2 or sent -> 0 ->> 'id' is distinct from 'progB'
     or (select (x ->> 'seen')::boolean from jsonb_array_elements(sent) x where x ->> 'id' = 'progA') is not false then raise 'sent après renvoi : %', sent; end if;
  -- Refus
  perform pg_temp.clogin('k');
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('u'), 'p', '{}') $q$) is distinct from 'not_found' then raise 'envoi à un non-élève'; end if;
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('s'), 'p', '[1]') $q$) is distinct from 'invalid_programme' then raise 'data liste'; end if;
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('s'), 'p', null) $q$) is distinct from 'invalid_programme' then raise 'data null'; end if;
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('s'), 'a b', '{}') $q$) is distinct from 'invalid_programme' then raise 'prog_id espace'; end if;
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('s'), '', '{}') $q$) is distinct from 'invalid_programme' then raise 'prog_id vide'; end if;
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('s'), repeat('p', 65), '{}') $q$) is distinct from 'invalid_programme' then raise 'prog_id long'; end if;
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('s'), 'gros', jsonb_build_object('name', repeat('x', 204800))) $q$) is distinct from 'too_long' then raise '200 Ko'; end if;
  perform pg_temp.clogin('l');
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('s'), 'p', '{}') $q$) is distinct from 'not_found' then raise 'L envoie à S'; end if;
  perform pg_temp.clogin('u');
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('s'), 'p', '{}') $q$) is distinct from 'not_coach' then raise 'U envoie'; end if;
  -- T ne voit ni ne marque les programmes de S
  perform pg_temp.clogin('t');
  perform public.student_mark_seen('programme', 'progB');
  if public.student_inbox() -> 'programmes' is distinct from '[]'::jsonb then raise 'T voit les programmes de S'; end if;
end $$;

-- ── Aucune écriture ni lecture directe ───────────────────
do $$
declare t text;
begin
  perform pg_temp.clogin('k');
  if pg_temp.cerr($q$ insert into public.coach_links (student_id, coach_id) values (pg_temp.cu('u'), pg_temp.cu('k')) $q$) not like 'permission denied%' then raise 'insert coach_links'; end if;
  if pg_temp.cerr($q$ insert into public.coach_invites (code, coach_id, expires_at) values ('ABCDEFGH', pg_temp.cu('k'), now() + interval '1 year') $q$) not like 'permission denied%' then raise 'insert coach_invites'; end if;
  if pg_temp.cerr($q$ update public.coach_invites set expires_at = now() + interval '1 year' $q$) not like 'permission denied%' then raise 'update coach_invites'; end if;
  if pg_temp.cerr($q$ insert into public.coach_programmes (student_id, coach_id, id, data) values (pg_temp.cu('s'), pg_temp.cu('k'), 'x', '{}') $q$) not like 'permission denied%' then raise 'insert coach_programmes'; end if;
  if pg_temp.cerr($q$ insert into public.coach_notes (student_id, coach_id, session_id, text) values (pg_temp.cu('s'), pg_temp.cu('k'), 's-1', 'x') $q$) not like 'permission denied%' then raise 'insert coach_notes'; end if;
  perform pg_temp.clogin('s');
  if pg_temp.cerr($q$ delete from public.coach_links $q$) not like 'permission denied%' then raise 'delete coach_links'; end if;
  if pg_temp.cerr($q$ update public.coach_notes set seen_at = now() $q$) not like 'permission denied%' then raise 'update coach_notes'; end if;
  if pg_temp.cerr($q$ update public.coach_programmes set seen_at = now() $q$) not like 'permission denied%' then raise 'update coach_programmes'; end if;
  if pg_temp.cerr($q$ update public.coach_links set coach_seen_at = now() $q$) not like 'permission denied%' then raise 'update coach_links'; end if;
  if pg_temp.cerr($q$ insert into public.coach_removed (coach_id, student_id) values (pg_temp.cu('l'), pg_temp.cu('s')) $q$) not like 'permission denied%' then raise 'insert coach_removed'; end if;
  if pg_temp.cerr($q$ delete from public.coach_removed $q$) not like 'permission denied%' then raise 'delete coach_removed'; end if;
  foreach t in array array['public.coach_invites', 'public.coach_links', 'public.coach_programmes', 'public.coach_notes', 'public.coach_removed'] loop
    if pg_temp.cerr(format('select * from %s', t)) not like 'permission denied%' then raise 'lecture directe de %', t; end if;
  end loop;
  foreach t in array array['private.session_for_coach(''x'', ''{}'')', 'private.is_coach(pg_temp.cu(''k''))', 'private.coach_new_code()',
                           'private.coach_check_code(pg_temp.cu(''s''), ''ABCDEFGH'')', 'private.coach_code_norm(''x'')',
                           'private.coach_require_student(pg_temp.cu(''k''), pg_temp.cu(''s''))',
                           'private.rate_limit_window(pg_temp.cu(''s''), ''coach_code'', 0, ''1 hour'')'] loop
    if pg_temp.cerr('select ' || t) not like 'permission denied%' then raise '% appelable', t; end if;
  end loop;
  -- Les séances des autres restent illisibles en direct (RLS de sessions)
  if exists (select 1 from public.sessions where user_id <> pg_temp.cu('s')) then raise 'sessions : RLS'; end if;
end $$;
-- La clé serveur ne lit pas non plus les tables du coach
set role service_role;
do $$ begin
  if pg_temp.cerr($q$ select * from public.coach_links $q$) not like 'permission denied%' then raise 'service_role lit coach_links'; end if;
  if pg_temp.cerr($q$ select * from public.coach_notes $q$) not like 'permission denied%' then raise 'service_role lit coach_notes'; end if;
end $$;
reset role;
set role authenticated;

-- ── Quitter et retirer : l'accès tombe aussitôt ──────────
do $$
declare c text;
begin
  -- S quitte : séances, commentaires et programmes inaccessibles et supprimés
  perform pg_temp.clogin('s');
  perform public.coach_leave();
  if public.coach_state() -> 'coach' is distinct from 'null'::jsonb or public.student_inbox() is distinct from '{"programmes": [], "notes": []}'::jsonb
     or (public.coach_state() ->> 'badge')::int is distinct from 0 then raise 'après départ : %', public.student_inbox(); end if;
  perform public.coach_leave();   -- deux fois : sans effet
  perform pg_temp.clogin('k');
  if pg_temp.cerr($q$ select * from public.coach_student_sessions(pg_temp.cu('s')) $q$) is distinct from 'not_found' then raise 'séances après départ'; end if;
  if pg_temp.cerr($q$ select public.coach_set_note(pg_temp.cu('s'), 's-1', 'x') $q$) is distinct from 'not_found' then raise 'commentaire après départ'; end if;
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('s'), 'p', '{}') $q$) is distinct from 'not_found' then raise 'envoi après départ'; end if;
  if exists (select 1 from jsonb_array_elements(public.coach_state() -> 'students') e where e ->> 'user_id' = pg_temp.cu('s')::text) then raise 'S encore listé'; end if;
  reset role;
  if exists (select 1 from public.coach_programmes where student_id = pg_temp.cu('s')) or exists (select 1 from public.coach_notes where student_id = pg_temp.cu('s')) then raise 'données gardées après départ'; end if;
  set role authenticated;
  -- S revient : rien de l'ancien lien ne réapparaît
  perform pg_temp.clogin('s');
  perform public.coach_join((select code from codes where who = 'k-actif' limit 1));
  if public.student_inbox() is distinct from '{"programmes": [], "notes": []}'::jsonb then raise 'anciens envois revenus'; end if;
  -- Quitter de soi-même n'interdit rien
  perform pg_temp.clogin('k');
  if public.coach_state() -> 'removed' is distinct from '[]'::jsonb then raise 'départ volontaire inscrit comme retrait'; end if;

  -- K retire T (avec un commentaire et un programme)
  perform pg_temp.clogin('k');
  perform public.coach_set_note(pg_temp.cu('t'), 't-1', 'ok');
  perform public.coach_send_programme(pg_temp.cu('t'), 'progT', '{"name": "T"}');
  perform pg_temp.clogin('l');
  perform public.coach_remove_student(pg_temp.cu('t'));   -- pas son élève : sans effet
  perform pg_temp.clogin('t');
  if public.coach_state() -> 'coach' ->> 'username' is distinct from 'kevin.c1' then raise 'L a retiré T'; end if;
  perform public.coach_remove_student(pg_temp.cu('t'));   -- soi-même : sans effet
  perform pg_temp.clogin('k');
  perform public.coach_remove_student(pg_temp.cu('t'));
  if pg_temp.cerr($q$ select * from public.coach_student_sessions(pg_temp.cu('t')) $q$) is distinct from 'not_found' then raise 'séances après retrait'; end if;
  perform pg_temp.clogin('t');
  if public.coach_state() -> 'coach' is distinct from 'null'::jsonb or public.student_inbox() is distinct from '{"programmes": [], "notes": []}'::jsonb then raise 'après retrait'; end if;

  -- Retiré : aucun code de K ne marche pour T, même un code créé après ; même réponse qu'un code faux
  if pg_temp.cerr(format('select public.coach_preview(%L)', (select code from codes where who = 'k-actif' limit 1))) is distinct from 'invalid_code' then raise 'aperçu après retrait'; end if;
  if pg_temp.cerr(format('select public.coach_join(%L)', (select code from codes where who = 'k-actif' limit 1))) is distinct from 'invalid_code' then raise 'retour après retrait'; end if;
  perform pg_temp.clogin('k'); c := public.coach_create_invite();
  perform pg_temp.clogin('t');
  if pg_temp.cerr(format('select public.coach_join(%L)', c)) is distinct from 'invalid_code' then raise 'retour avec un nouveau code'; end if;
  -- Les autres élèves ne sont pas touchés
  perform pg_temp.clogin('u');
  if public.coach_preview(c) ->> 'username' is distinct from 'kevin.c1' then raise 'U touché par le retrait de T'; end if;
  -- K voit T dans removed ; L ne voit rien (son « retrait » de T n'a rien inscrit)
  perform pg_temp.clogin('k');
  if jsonb_array_length(public.coach_state() -> 'removed') is distinct from 1
     or public.coach_state() -> 'removed' -> 0 ->> 'user_id' is distinct from pg_temp.cu('t')::text
     or public.coach_state() -> 'removed' -> 0 ->> 'username' is distinct from 'theo.c1'
     or public.coach_state() -> 'removed' -> 0 ->> 'since' is null then raise 'removed : %', public.coach_state() -> 'removed'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(public.coach_state() -> 'removed' -> 0) k) is distinct from array['avatar', 'since', 'user_id', 'username'] then raise 'clés de removed'; end if;
  perform public.coach_remove_student(pg_temp.cu('t'));   -- déjà retiré : sans effet
  if jsonb_array_length(public.coach_state() -> 'removed') is distinct from 1 then raise 'retrait doublé'; end if;
  perform pg_temp.clogin('l');
  if public.coach_state() -> 'removed' is distinct from '[]'::jsonb then raise 'removed de L'; end if;
  perform pg_temp.clogin('t');
  if public.coach_state() -> 'removed' is distinct from '[]'::jsonb then raise 'T voit removed'; end if;
  -- Autoriser : L (pas son élève), T lui-même et un inconnu ne lèvent rien ; seul K lève l'interdiction
  perform pg_temp.clogin('l'); perform public.coach_allow_student(pg_temp.cu('t'));
  perform pg_temp.clogin('t'); perform public.coach_allow_student(pg_temp.cu('t'));
  if pg_temp.cerr(format('select public.coach_join(%L)', c)) is distinct from 'invalid_code' then raise 'interdiction levée par un autre'; end if;
  perform pg_temp.clogin('k');
  if pg_temp.cerr($q$ select public.coach_allow_student(gen_random_uuid()) $q$) is distinct from 'ok' then raise 'autoriser un inconnu'; end if;
  if pg_temp.cerr($q$ select public.coach_allow_student(null) $q$) is distinct from 'ok' then raise 'autoriser null'; end if;
  perform public.coach_allow_student(pg_temp.cu('t'));
  if public.coach_state() -> 'removed' is distinct from '[]'::jsonb then raise 'removed après autorisation'; end if;
  perform pg_temp.clogin('t');
  if public.coach_join(c) ->> 'username' is distinct from 'kevin.c1' then raise 'retour après autorisation'; end if;
  -- T quitte de lui-même puis revient : aucune interdiction
  perform public.coach_leave();
  if public.coach_join(c) ->> 'username' is distinct from 'kevin.c1' then raise 'retour après départ volontaire'; end if;
  perform public.coach_leave();
end $$;

-- ── Coach dont l'administrateur retire le rôle ───────────
reset role;
update public.user_profiles set coach_at = null where user_id = pg_temp.cu('k');
set role authenticated;
do $$ begin
  perform pg_temp.clogin('k');
  if pg_temp.cerr($q$ select * from public.coach_student_sessions(pg_temp.cu('s')) $q$) is distinct from 'not_found' then raise 'séances sans rôle'; end if;
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('s'), 'p', '{}') $q$) is distinct from 'not_coach' then raise 'envoi sans rôle'; end if;
  if pg_temp.cerr($q$ select public.coach_create_invite() $q$) is distinct from 'not_coach' then raise 'invitation sans rôle'; end if;
  if public.coach_state() -> 'students' is distinct from '[]'::jsonb or public.coach_state() -> 'invites' is distinct from '[]'::jsonb then raise 'état sans rôle'; end if;
  perform pg_temp.clogin('u');
  if pg_temp.cerr(format('select public.coach_preview(%L)', (select code from codes where who = 'k-actif' limit 1))) is distinct from 'invalid_code' then raise 'code d''un ex-coach'; end if;
  -- L'élève voit encore le lien pour pouvoir le quitter
  perform pg_temp.clogin('s');
  if public.coach_state() -> 'coach' ->> 'username' is distinct from 'kevin.c1' then raise 'lien invisible pour l''élève'; end if;
end $$;
reset role;
update public.user_profiles set coach_at = now() where user_id = pg_temp.cu('k');
set role authenticated;

-- ── Codes expirés ────────────────────────────────────────
do $$
declare c text;
begin
  perform pg_temp.clogin('k');
  c := public.coach_create_invite();
  reset role;
  update public.coach_invites set expires_at = now() - interval '1 second' where code = c;
  set role authenticated;
  perform pg_temp.clogin('u');
  if pg_temp.cerr(format('select public.coach_preview(%L)', c)) is distinct from 'invalid_code' then raise 'aperçu code expiré'; end if;
  if pg_temp.cerr(format('select public.coach_join(%L)', c)) is distinct from 'invalid_code' then raise 'adhésion code expiré'; end if;
  perform pg_temp.clogin('k');
  if exists (select 1 from jsonb_array_elements(public.coach_state() -> 'invites') e where e ->> 'code' = c) then raise 'code expiré listé'; end if;
  -- Purgé à la création suivante
  perform public.coach_create_invite();
  reset role;
  if exists (select 1 from public.coach_invites where code = c) then raise 'code expiré non purgé'; end if;
  set role authenticated;
end $$;

-- ── Équipe pleine : 50 élèves ────────────────────────────
do $$
declare c text; i int;
begin
  perform pg_temp.clogin('l');
  c := (select code from codes where who = 'l1');
  for i in 1..50 loop
    perform pg_temp.clogin50(i);
    perform public.coach_join(c);
  end loop;
  perform pg_temp.clogin50(51);
  if pg_temp.cerr(format('select public.coach_preview(%L)', c)) is distinct from 'team_full' then raise 'aperçu équipe pleine'; end if;
  if pg_temp.cerr(format('select public.coach_join(%L)', c)) is distinct from 'team_full' then raise '51e élève'; end if;
  -- Un élève déjà dans l'équipe rejoue son adhésion sans erreur
  perform pg_temp.clogin50(1);
  if public.coach_join(c) ->> 'username' is distinct from 'laura.c1' then raise 'adhésion rejouée équipe pleine'; end if;
  -- Une place libérée : le 51e entre
  perform public.coach_leave();
  perform pg_temp.clogin50(51);
  perform public.coach_join(c);
  perform pg_temp.clogin('l');
  if jsonb_array_length(public.coach_state() -> 'students') is distinct from 50 then raise '50 élèves'; end if;
end $$;

-- ── Limites de débit ─────────────────────────────────────
do $$
declare i int; c text;
begin
  -- 10 aperçus ou adhésions réussis par heure (les essais en échec sont annulés avec la transaction,
  -- voir l'en-tête de la migration)
  perform pg_temp.clogin('k');
  c := public.coach_create_invite();
  reset role;
  delete from private.social_rate where user_id = pg_temp.cu('u') and action = 'coach_code';   -- U a déjà fait un aperçu
  set role authenticated;
  perform pg_temp.clogin('u');
  for i in 1..10 loop perform public.coach_preview(c); end loop;
  if pg_temp.cerr(format('select public.coach_preview(%L)', c)) is distinct from 'rate_limited' then raise '11e aperçu'; end if;
  if pg_temp.cerr(format('select public.coach_join(%L)', c)) is distinct from 'rate_limited' then raise 'adhésion après 10 aperçus'; end if;
  reset role;
  update private.social_rate set at = now() - interval '61 minutes' where user_id = pg_temp.cu('u') and action = 'coach_code';
  set role authenticated;
  if public.coach_join(c) ->> 'username' is distinct from 'kevin.c1' then raise 'limite horaire non libérée'; end if;

  -- 30 envois de programme par 24 h, mises à jour comprises (compteur remis à zéro : K a déjà envoyé)
  reset role;
  delete from private.social_rate where user_id = pg_temp.cu('k') and action = 'coach_send';
  set role authenticated;
  perform pg_temp.clogin('k');
  for i in 1..30 loop perform public.coach_send_programme(pg_temp.cu('u'), 'p' || (i % 3), '{"name": "x"}'); end loop;
  if pg_temp.cerr($q$ select public.coach_send_programme(pg_temp.cu('u'), 'p1', '{"name": "x"}') $q$) is distinct from 'rate_limited' then raise '31e envoi'; end if;
  reset role;
  update private.social_rate set at = now() - interval '25 hours' where user_id = pg_temp.cu('k') and action = 'coach_send';
  set role authenticated;
  perform public.coach_send_programme(pg_temp.cu('u'), 'p1', '{"name": "x"}');

  -- 20 codes créés par 24 h
  reset role;
  delete from private.social_rate where user_id = pg_temp.cu('k') and action = 'coach_invite';
  set role authenticated;
  for i in 1..20 loop perform public.coach_create_invite(); end loop;
  if pg_temp.cerr($q$ select public.coach_create_invite() $q$) is distinct from 'rate_limited' then raise '21e code'; end if;
  if jsonb_array_length(public.coach_state() -> 'invites') is distinct from 5 then raise '5 codes après 20 créations'; end if;
end $$;
reset role;

-- ── Anonyme : rien ───────────────────────────────────────
set role anon;
set request.jwt.claim.sub = '';
do $$
declare f text;
begin
  foreach f in array array[
    'public.coach_state()', 'public.coach_create_invite()', 'public.coach_revoke_invite(''ABCDEFGH'')',
    'public.coach_preview(''ABCDEFGH'')', 'public.coach_join(''ABCDEFGH'')', 'public.coach_leave()',
    'public.coach_remove_student(pg_temp.cu(''s''))', '* from public.coach_student_sessions(pg_temp.cu(''s''))',
    'public.coach_mark_seen(pg_temp.cu(''s''))', 'public.coach_send_programme(pg_temp.cu(''s''), ''p'', ''{}'')',
    'public.coach_set_note(pg_temp.cu(''s''), ''s-1'', ''x'')', 'public.student_inbox()', 'public.student_mark_seen(''note'', ''s-1'')',
    '* from public.coach_invites', '* from public.coach_links', '* from public.coach_programmes', '* from public.coach_notes', '* from public.coach_removed',
    'public.coach_allow_student(pg_temp.cu(''s''))'] loop
    if pg_temp.cerr('select ' || f) not like 'permission denied%' then raise 'anon : %', f; end if;
  end loop;
end $$;
reset role;

-- ── Droits déclarés : chaque RPC exécutable par authenticated seulement ──
do $$
declare f regprocedure;
  names text[] := array['coach_state', 'coach_create_invite', 'coach_revoke_invite', 'coach_preview', 'coach_join', 'coach_leave',
                        'coach_remove_student', 'coach_allow_student', 'coach_student_sessions', 'coach_mark_seen', 'coach_send_programme', 'coach_set_note',
                        'student_inbox', 'student_mark_seen'];
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (names) loop
    if not has_function_privilege('authenticated', f, 'execute') then raise '% : authenticated sans droit', f; end if;
    if has_function_privilege('anon', f, 'execute') then raise '% : anon a le droit', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (names)) <> 14 then raise 'fonctions du contrat manquantes'; end if;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'private'::regnamespace
             and p.proname in ('is_coach', 'rate_limit_window', 'coach_code_norm', 'coach_new_code', 'coach_check_code', 'session_for_coach', 'coach_require_student') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable par l''API', f; end if;
  end loop;
  -- Aucune politique RLS sur les tables du coach, RLS activée
  if exists (select 1 from pg_policies where tablename in ('coach_invites', 'coach_links', 'coach_programmes', 'coach_notes', 'coach_removed')) then raise 'politique RLS inattendue'; end if;
  if exists (select 1 from pg_class where relname in ('coach_invites', 'coach_links', 'coach_programmes', 'coach_notes', 'coach_removed') and not relrowsecurity) then raise 'RLS désactivée'; end if;
end $$;

-- ── Suppression du compte : tout part en cascade ─────────
do $$
declare k uuid := pg_temp.cu('k'); s uuid := pg_temp.cu('s');
begin
  -- Un élève supprimé : son lien, ses envois et commentaires
  set local role authenticated;
  perform pg_temp.clogin('k');
  perform public.coach_send_programme(s, 'progS', '{"name": "S"}');
  perform public.coach_set_note(s, 's-1', 'ok');
  reset role;
  delete from auth.users where id = s;
  if exists (select 1 from public.coach_links where student_id = s) or exists (select 1 from public.coach_programmes where student_id = s)
     or exists (select 1 from public.coach_notes where student_id = s) then raise 'cascade élève'; end if;
  -- Retraits : K retire V (V supprimé ensuite) ; T, retiré lui aussi (écrit ici par le serveur), part avec K
  set local role authenticated;
  perform pg_temp.clogin('k');
  perform public.coach_remove_student(pg_temp.cu('v'));
  reset role;
  insert into public.coach_removed (coach_id, student_id) values (k, pg_temp.cu('t'));
  if (select count(*) from public.coach_removed where coach_id = k) is distinct from 2 then raise 'retraits avant suppression'; end if;
  delete from auth.users where id = pg_temp.cu('v');
  if exists (select 1 from public.coach_removed where student_id = pg_temp.cu('v')) then raise 'cascade coach_removed (élève)'; end if;
  -- Le coach supprimé : codes, liens, envois, retraits, journal des limites
  if not exists (select 1 from public.coach_links where coach_id = k) or not exists (select 1 from public.coach_invites where coach_id = k)
     or not exists (select 1 from public.coach_programmes where coach_id = k) then raise 'données de K absentes avant la suppression'; end if;
  delete from auth.users where id = k;
  if exists (select 1 from public.coach_links where coach_id = k) then raise 'cascade coach_links'; end if;
  if exists (select 1 from public.coach_invites where coach_id = k) then raise 'cascade coach_invites'; end if;
  if exists (select 1 from public.coach_removed where coach_id = k) then raise 'cascade coach_removed (coach)'; end if;
  if exists (select 1 from public.coach_programmes where coach_id = k) or exists (select 1 from public.coach_notes where coach_id = k) then raise 'cascade envois'; end if;
  if exists (select 1 from private.social_rate where user_id = k) then raise 'cascade social_rate'; end if;
  -- Ses anciens élèves n'ont plus de coach
  set local role authenticated;
  perform pg_temp.clogin('u');
  if public.coach_state() -> 'coach' is distinct from 'null'::jsonb or public.student_inbox() is distinct from '{"programmes": [], "notes": []}'::jsonb then raise 'élève d''un coach supprimé'; end if;
  reset role;
end $$;
-- Nettoyage : les tests suivants (social_test.sql…) partent d'une base sans ces comptes
delete from auth.users where id in (select pg_temp.cu(c) from unnest(array['l', 't', 'u', 'v']) c) or id in (select pg_temp.cu50(i) from generate_series(1, 51) i);
