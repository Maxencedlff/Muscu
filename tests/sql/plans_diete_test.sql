-- Vérifications de supabase/migrations/20261106200000_plans_diete_coach.sql (lancées par tests/sql/run.sh) :
-- un coach n'écrit un plan diète chez un élève qu'avec son accord ('diet' dans coach_shares) ; retirer
-- l'accord, quitter le coach ou être retiré efface les plans diète gardés pour l'élève ; les programmes
-- d'entraînement ne changent pas. Chaque bloc échoue (raise) si la règle n'est pas tenue.
--
-- Comptes simulés (pg_temp.du('k') → …000000000e9a, l → b, s → c, t → d) : K kim.d1 et L lea.d1 sont
-- coachs ; S sol.d1 et T tom.d1 sont élèves de K.

create function pg_temp.derr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.du(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-000000000e9' || translate(c, 'klst', 'abcd'))::uuid $$;
create function pg_temp.dlogin(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(pg_temp.du(c)::text, ''), false) $$;
grant execute on function pg_temp.derr(text), pg_temp.du(text), pg_temp.dlogin(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.du(c) from unnest(array['k', 'l', 's', 't']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.du('k'), 'kim.d1', '🦁'), (pg_temp.du('l'), 'lea.d1', '🦊'), (pg_temp.du('s'), 'sol.d1', '🦅'), (pg_temp.du('t'), 'tom.d1', '🐼');
update public.user_profiles set coach_at = now() where user_id in (pg_temp.du('k'), pg_temp.du('l'));
insert into public.coach_links (student_id, coach_id) values (pg_temp.du('s'), pg_temp.du('k')), (pg_temp.du('t'), pg_temp.du('k'));

-- ── Droits : rien de nouveau d'exposé ───────────────────
do $$ begin
  if has_function_privilege('authenticated', 'private.coach_shares_diet_revoked()', 'execute')
     or has_function_privilege('anon', 'private.coach_shares_diet_revoked()', 'execute') then raise 'déclencheur exécutable par l''API'; end if;
  if has_function_privilege('anon', 'public.coach_send_programme(uuid, text, jsonb)', 'execute') then raise 'anon envoie'; end if;
  if not has_function_privilege('authenticated', 'public.coach_send_programme(uuid, text, jsonb)', 'execute') then raise 'authenticated n''envoie plus'; end if;
  if not private.share_kind_open('diet') or not private.share_kind_open('weight') or private.share_kind_open('sleep') then raise 'données ouvertes'; end if;
end $$;

set role authenticated;

-- ── Sans accord : plan diète refusé, programme accepté ──
do $$ begin
  perform pg_temp.dlogin('k');
  if pg_temp.derr($q$ select public.coach_send_programme(pg_temp.du('s'), 'diet_abc12345', '{"kind": "diet", "v": 1, "diet": {"name": "Sèche", "meals": []}}') $q$)
     is distinct from 'diet_not_accepted' then raise 'plan diète écrit sans accord'; end if;
  perform public.coach_send_programme(pg_temp.du('s'), 'progA', '{"name": "Force", "sessions": []}');
  -- Un identifiant qui commence seulement par « diet » (sans tiret bas) reste un programme
  perform public.coach_send_programme(pg_temp.du('s'), 'dietA', '{"name": "Programme dietA", "sessions": []}');
end $$;

-- ── L'élève accepte : le plan passe ; student_shares le dit ──
do $$
declare st jsonb;
begin
  perform pg_temp.dlogin('s');
  st := public.student_set_share('diet', true);
  if st -> 'shares' -> 'diet' -> 'granted_at' is null then raise 'accord diète non daté : %', st; end if;
  perform pg_temp.dlogin('k');
  perform public.coach_send_programme(pg_temp.du('s'), 'diet_abc12345', '{"kind": "diet", "v": 1, "diet": {"name": "Sèche", "meals": []}}');
  -- Accord donné à SON coach, pas aux autres élèves : T n'a rien accepté
  if pg_temp.derr($q$ select public.coach_send_programme(pg_temp.du('t'), 'diet_abc12345', '{"kind": "diet"}') $q$)
     is distinct from 'diet_not_accepted' then raise 'accord d''un élève valable pour un autre'; end if;
  -- Un autre coach : pas son élève
  perform pg_temp.dlogin('l');
  if pg_temp.derr($q$ select public.coach_send_programme(pg_temp.du('s'), 'diet_x', '{"kind": "diet"}') $q$) not in ('not_found') then raise 'autre coach'; end if;
  perform pg_temp.dlogin('s');
  if (select count(*) from jsonb_array_elements(public.student_inbox() -> 'programmes') x where x ->> 'id' = 'diet_abc12345') <> 1 then raise 'plan absent de la boîte'; end if;
end $$;

-- ── Retrait : plans diète effacés du serveur, programmes gardés ──
do $$ begin
  perform pg_temp.dlogin('s');
  perform public.student_set_share('diet', false);
  reset role;
  if exists (select 1 from public.coach_programmes where student_id = pg_temp.du('s') and id like 'diet\_%') then raise 'plan diète resté après le retrait'; end if;
  if (select count(*) from public.coach_programmes where student_id = pg_temp.du('s') and id in ('progA', 'dietA')) <> 2 then raise 'programmes effacés à tort'; end if;
  set role authenticated;
  perform pg_temp.dlogin('k');
  if pg_temp.derr($q$ select public.coach_send_programme(pg_temp.du('s'), 'diet_abc12345', '{"kind": "diet"}') $q$)
     is distinct from 'diet_not_accepted' then raise 'envoi après retrait'; end if;
end $$;

-- ── Quitter le coach : accord et plans partent avec le lien ──
do $$ begin
  perform pg_temp.dlogin('s');
  perform public.student_set_share('diet', true);
  perform pg_temp.dlogin('k');
  perform public.coach_send_programme(pg_temp.du('s'), 'diet_def67890', '{"kind": "diet"}');
  perform pg_temp.dlogin('s');
  perform public.coach_leave();
  reset role;
  if exists (select 1 from public.coach_shares where student_id = pg_temp.du('s')) then raise 'accord resté après le départ'; end if;
  if exists (select 1 from public.coach_programmes where student_id = pg_temp.du('s') and id like 'diet\_%') then raise 'plan diète resté après le départ'; end if;
  set role authenticated;
end $$;

reset role;
