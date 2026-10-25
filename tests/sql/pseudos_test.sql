-- Vérifications de supabase/migrations/20261026010000_pseudos_renforces.sql (lancées par tests/sql/run.sh,
-- après profils_test.sql). Chaque bloc échoue (raise) si la règle n'est pas tenue.

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');

create function pg_temp.err2(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.err2(text) to authenticated;

-- ── Compte C ─────────────────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';

do $$
declare n text;
begin
  insert into public.user_profiles (avatar_emoji) values ('🦊');   -- sans pseudo (« Plus tard »)
  -- Chiffres « leet », variantes, mots réservés en préfixe ou suivis de chiffres : refusés
  foreach n in array array['fvck', 'fvck_off', 'sh1t', 'h1tler', 'c0nnard', 'gros.c0nn4rd', 'admin2', 'admin_team',
                           'support1', 'staff.max', 'pute69', 'b1te', 'n1que', 'mdlf_coach', 'm.d.l.f'] loop
    if pg_temp.err2(format('update public.user_profiles set username = %L', n)) <> 'username_forbidden' then
      raise 'pseudo accepté : %', n;
    end if;
    if public.username_available(n) then raise 'annoncé disponible : %', n; end if;
  end loop;
  -- Faux positifs à éviter : mots courants qui contiennent un radical, chiffres ordinaires
  foreach n in array array['technique', 'badminton42', 'testosterone', 'aiden', 'helpful', 'max1', 'violet', 'leo_2007'] loop
    if not public.username_available(n) then raise 'refusé à tort : %', n; end if;
  end loop;
  -- Premier choix
  update public.user_profiles set username = 'max.dlf';
end $$;

-- ── Compte D : mêmes lettres que C, points et tirets bas mis à part ───
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ begin
  if public.username_available('maxdlf') or public.username_available('max_dlf') or public.username_available('m.a.x.d.l.f') then
    raise 'maxdlf annoncé libre alors que max.dlf est pris';
  end if;
  if pg_temp.err2($q$ insert into public.user_profiles (username) values ('maxdlf') $q$) not like '%user_profiles_username_plain_key%' then
    raise 'maxdlf accepté à côté de max.dlf';
  end if;
  if pg_temp.err2($q$ insert into public.user_profiles (username) values ('max_dlf') $q$) not like '%user_profiles_username_plain_key%' then
    raise 'max_dlf accepté à côté de max.dlf';
  end if;
  insert into public.user_profiles (username) values ('maxdlf2');   -- autre pseudo : permis (écrit par authenticated)
  if (select username from public.user_profiles) <> 'maxdlf2' then raise 'pseudo de D'; end if;
end $$;

-- C garde le droit à son propre pseudo, sous une autre graphie
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  if not public.username_available('maxdlf') then raise 'sa propre forme comptée comme prise'; end if;
end $$;

-- Fonctions privées toujours hors de portée du client
do $$ begin
  if pg_temp.err2($q$ select private.username_plain('x') $q$) not like 'permission denied%' then raise 'username_plain appelable'; end if;
  if pg_temp.err2($q$ select private.username_leet('x') $q$) not like 'permission denied%' then raise 'username_leet appelable'; end if;
end $$;
reset role;
