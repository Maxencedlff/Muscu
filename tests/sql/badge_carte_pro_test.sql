-- Vérifications de 20261117090000_badge_carte_pro.sql (badge « Carte pro déclarée »), lancées par tests/sql/run.sh.
-- Comptes simulés …00000000caXX : A coach qui déclare, B coach sans carte, S et O deux autres comptes, K bloqué
-- par A, N pas coach. Rien n'est appliqué en production : Postgres local jetable.

create function pg_temp.cerr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.cu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000ca' || c)::uuid $$;
create function pg_temp.clogin(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, false) $$;
grant execute on function pg_temp.cerr(text), pg_temp.cu(text), pg_temp.clogin(uuid) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.cu(c) from unnest(array['a1', 'b1', '51', '01', 'c1', '11']) c;
insert into public.user_profiles (user_id, username, avatar_emoji) values
  (pg_temp.cu('a1'), 'carte.a1', '🦁'), (pg_temp.cu('b1'), 'carte.b1', '🦊'), (pg_temp.cu('51'), 'carte.s1', '🐼'),
  (pg_temp.cu('01'), 'carte.o1', '⭐'), (pg_temp.cu('c1'), 'carte.k1', '🦉'), (pg_temp.cu('11'), 'carte.n1', '🐺');
update public.user_profiles set coach_at = now() where user_id in (pg_temp.cu('a1'), pg_temp.cu('b1'));
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.cu('a1'), pg_temp.cu('c1'));

-- ── Droits : aucune lecture ni écriture directe, administration fermée ──
set role authenticated;
do $$
begin
  perform pg_temp.clogin(pg_temp.cu('a1'));
  if pg_temp.cerr($q$ select * from public.coach_cards $q$) not like 'permission denied%' then raise 'lecture directe'; end if;
  if pg_temp.cerr($q$ insert into public.coach_cards (user_id, card_number) values (auth.uid(), '04912ED0123') $q$) not like 'permission denied%' then raise 'écriture directe'; end if;
  if pg_temp.cerr(format('select private.coach_card_restore(%L)', pg_temp.cu('a1'))) not like 'permission denied%' then raise 'restauration par le client'; end if;
  if pg_temp.cerr(format('select private.coach_card_remove(%L, %L)', pg_temp.cu('b1'), 'x')) not like 'permission denied%' then raise 'retrait par le client'; end if;
  if pg_temp.cerr($q$ select * from private.coach_cards_review $q$) not like 'permission denied%' then raise 'vue de revue lisible'; end if;
end $$;
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.coach_card_badge(uuid)', 'execute') then raise 'anon peut lire un badge'; end if;
  if has_function_privilege('anon', 'public.report_coach_card(uuid, text)', 'execute') then raise 'anon peut signaler'; end if;
  if has_table_privilege('service_role', 'public.coach_cards', 'select') then raise 'service_role lit les numéros'; end if;
  if not has_function_privilege('authenticated', 'public.coach_card_declare(text)', 'execute') then raise 'déclaration fermée'; end if;
end $$;

-- ── Déclaration : format, rôle, limites ──
set role authenticated;
do $$
declare st jsonb;
begin
  perform pg_temp.clogin(pg_temp.cu('11'));
  if pg_temp.cerr($q$ select public.coach_card_declare('04912ED0123') $q$) is distinct from 'not_coach' then raise 'non-coach accepté'; end if;

  perform pg_temp.clogin(pg_temp.cu('a1'));
  if public.coach_card_state() ->> 'status' is distinct from 'none' then raise 'état initial'; end if;
  foreach st in array array['"12345"', '"04912XX0123"', '"0491ED0123"', '"04912ED012"', '"04912ED012345"', '"ABCDEFGHIJK"', '""']::jsonb[] loop
    if pg_temp.cerr(format('select public.coach_card_declare(%L)', st #>> '{}')) is distinct from 'invalid_card' then raise 'format accepté : %', st; end if;
  end loop;
  st := public.coach_card_declare(' 049 12-ed.0123 ');
  if st ->> 'status' <> 'declared' or st ->> 'card_number' <> '04912ED0123' or st ->> 'declared_at' is null then raise 'déclaration : %', st; end if;
  -- Corse, outre-mer, numéro d'ordre à 5 chiffres
  if public.coach_card_declare('02A24ED0042') ->> 'card_number' <> '02A24ED0042' then raise 'Corse'; end if;
  if public.coach_card_declare('97123ED10042') ->> 'card_number' <> '97123ED10042' then raise 'outre-mer, 5 chiffres'; end if;
  st := public.coach_card_declare('04912ED0123');
  -- Même numéro : rien ne change, rien n'est compté
  if (public.coach_card_declare('04912ED0123') ->> 'declared_at') <> st ->> 'declared_at' then raise 'date changée par le même numéro'; end if;
  perform public.coach_card_declare('04912ED0124');
  if pg_temp.cerr($q$ select public.coach_card_declare('04912ED0125') $q$) is distinct from 'rate_limited' then raise '6e déclaration'; end if;
  perform public.coach_card_declare('04912ED0124');   -- même numéro : toujours accepté
end $$;
reset role;
do $$ begin
  -- 5 déclarations comptées : le même numéro et le refus ne comptent pas
  if (select count(*) from private.social_rate r where r.user_id = pg_temp.cu('a1') and r.action = 'coach_card') <> 5 then raise 'comptage des déclarations'; end if;
end $$;
set role authenticated;

-- ── Badge public : jamais le numéro ; blocage ; coach sans carte ──
do $$
declare b jsonb;
begin
  perform pg_temp.clogin(pg_temp.cu('51'));
  b := public.coach_card_badge(pg_temp.cu('a1'));
  if not (b ->> 'shown')::boolean or b ->> 'declared_at' is null then raise 'badge non montré : %', b; end if;
  if b::text ~ 'ED0' or b ? 'card_number' then raise 'numéro visible du public'; end if;
  if (public.coach_card_badge(pg_temp.cu('b1')) ->> 'shown')::boolean then raise 'badge sans carte'; end if;
  if (public.coach_card_badge(pg_temp.cu('11')) ->> 'shown')::boolean then raise 'badge d''un non-coach'; end if;
  if public.coach_card_state() ->> 'status' <> 'none' or public.coach_card_state()::text ~ 'ED0' then raise 'fuite de la déclaration de A'; end if;
  perform pg_temp.clogin(pg_temp.cu('c1'));
  if (public.coach_card_badge(pg_temp.cu('a1')) ->> 'shown')::boolean then raise 'badge montré à un compte bloqué'; end if;
  if pg_temp.cerr(format('select public.report_coach_card(%L)', pg_temp.cu('a1'))) is distinct from 'not_found' then raise 'signalement par un bloqué'; end if;
  perform pg_temp.clogin(pg_temp.cu('a1'));
  if not (public.coach_card_badge(pg_temp.cu('a1')) ->> 'shown')::boolean then raise 'le coach ne voit pas son badge'; end if;
  if pg_temp.cerr(format('select public.report_coach_card(%L)', pg_temp.cu('a1'))) is distinct from 'not_found' then raise 'se signaler soi-même'; end if;
  perform pg_temp.clogin(pg_temp.cu('51'));
  if pg_temp.cerr(format('select public.report_coach_card(%L)', pg_temp.cu('b1'))) is distinct from 'not_found' then raise 'signaler un badge absent'; end if;
end $$;

-- ── Signalement : suspendu dès le premier, file commune, une fois par compte ──
do $$
declare id1 bigint; id2 bigint; b jsonb;
begin
  perform pg_temp.clogin(pg_temp.cu('51'));
  id1 := public.report_coach_card(pg_temp.cu('a1'), E'  Ce numéro   est\ncelui de mon frère  ');
  if id1 is null then raise 'premier signalement'; end if;
  if (public.coach_card_badge(pg_temp.cu('a1')) ->> 'shown')::boolean then raise 'badge encore montré après signalement'; end if;
  if public.report_coach_card(pg_temp.cu('a1')) is not null then raise 'deuxième signalement du même compte'; end if;
  perform pg_temp.clogin(pg_temp.cu('01'));
  id2 := public.report_coach_card(pg_temp.cu('a1'));
  if id2 is null or id2 = id1 then raise 'signalement d''un autre compte sur un badge suspendu'; end if;
  perform pg_temp.clogin(pg_temp.cu('a1'));
  b := public.coach_card_state();
  if b ->> 'status' <> 'suspended' or b ->> 'suspended_at' is null or b ->> 'card_number' <> '04912ED0124' then raise 'état du coach : %', b; end if;
  if (public.coach_card_badge(pg_temp.cu('a1')) ->> 'shown')::boolean then raise 'badge montré au coach suspendu'; end if;
  if pg_temp.cerr($q$ select public.coach_card_declare('04912ED0999') $q$) is distinct from 'card_suspended' then raise 'changer de numéro efface la suspension'; end if;
  if pg_temp.cerr($q$ select public.coach_card_withdraw() $q$) is distinct from 'card_suspended' then raise 'retirer efface la suspension'; end if;
end $$;
reset role;
do $$
declare r public.reports;
begin
  select * into r from public.reports x where x.reporter_id = pg_temp.cu('51') and x.target_ref = 'coach_card';
  if r.kind <> 'profile' or r.reason <> 'autre' or r.target_username <> 'carte.a1'
     or r.details <> 'Badge « Carte pro déclarée » signalé : Ce numéro est celui de mon frère' then raise 'ligne du signalement : %', row_to_json(r); end if;
  if r.details ~ '04912' then raise 'numéro recopié dans le signalement'; end if;
  if (select reports from private.coach_cards_review where user_id = pg_temp.cu('a1')) <> 2 then raise 'vue de revue'; end if;
  -- Revue : badge rendu
  if private.coach_card_restore(pg_temp.cu('a1'), 'carte trouvée') ->> 'status' <> 'declared' then raise 'restauration'; end if;
  if exists (select 1 from private.coach_cards_review) then raise 'revue encore listée'; end if;
  if pg_temp.cerr(format('select private.coach_card_restore(%L)', pg_temp.cu('a1'))) is distinct from 'not_found' then raise 'restaurer un badge non suspendu'; end if;
end $$;

-- ── Après la revue : les signalements d'avant ne comptent plus qu'une fois par déclaration ──
set role authenticated;
do $$
begin
  perform pg_temp.clogin(pg_temp.cu('51'));
  if not (public.coach_card_badge(pg_temp.cu('a1')) ->> 'shown')::boolean then raise 'badge non rendu'; end if;
  -- Même déclaration déjà signalée par S : rejoué, rien ne change
  if public.report_coach_card(pg_temp.cu('a1')) is not null then raise 'signalement rejoué après revue'; end if;
  if not (public.coach_card_badge(pg_temp.cu('a1')) ->> 'shown')::boolean then raise 'suspendu par un signalement rejoué'; end if;
end $$;
reset role;

-- ── Perte du rôle : badge masqué ; rôle rendu : badge revenu ──
update public.user_profiles set coach_at = null where user_id = pg_temp.cu('a1');
set role authenticated;
do $$
begin
  perform pg_temp.clogin(pg_temp.cu('51'));
  if (public.coach_card_badge(pg_temp.cu('a1')) ->> 'shown')::boolean then raise 'badge d''un ex-coach'; end if;
  if pg_temp.cerr(format('select public.report_coach_card(%L)', pg_temp.cu('a1'))) is distinct from 'not_found' then raise 'signaler un ex-coach'; end if;
end $$;
reset role;
update public.user_profiles set coach_at = now() where user_id = pg_temp.cu('a1');

-- ── Retrait par l'administrateur : définitif sans lui ──
do $$
begin
  if private.coach_card_remove(pg_temp.cu('a1'), 'Numéro d''une autre personne.') ->> 'status' <> 'removed' then raise 'retrait'; end if;
end $$;
set role authenticated;
do $$
declare st jsonb;
begin
  perform pg_temp.clogin(pg_temp.cu('a1'));
  st := public.coach_card_state();
  if st ->> 'status' <> 'removed' or st ->> 'removed_reason' <> 'Numéro d''une autre personne.' then raise 'état retiré : %', st; end if;
  if pg_temp.cerr($q$ select public.coach_card_declare('04912ED0777') $q$) is distinct from 'card_removed' then raise 'redéclarer après retrait'; end if;
  if pg_temp.cerr($q$ select public.coach_card_withdraw() $q$) is distinct from 'card_removed' then raise 'effacer un retrait'; end if;
  perform pg_temp.clogin(pg_temp.cu('01'));
  if (public.coach_card_badge(pg_temp.cu('a1')) ->> 'shown')::boolean then raise 'badge retiré montré'; end if;
  -- B : déclare puis retire lui-même
  perform pg_temp.clogin(pg_temp.cu('b1'));
  perform public.coach_card_declare('07519ED0001');
  if public.coach_card_withdraw() ->> 'status' <> 'none' then raise 'retrait par le coach'; end if;
  if public.coach_card_withdraw() ->> 'status' <> 'none' then raise 'retrait rejoué'; end if;
end $$;
reset role;

-- ── Plus tard : vérification FranceConnect (colonnes prêtes, pas d'écriture client) ──
do $$
begin
  insert into public.coach_cards (user_id, card_number) values (pg_temp.cu('b1'), '07519ED0001');
  if pg_temp.cerr(format($q$ update public.coach_cards set status = 'verified' where user_id = %L $q$, pg_temp.cu('b1'))) !~ 'coach_cards_verified_state' then raise 'vérifié sans date'; end if;
  if pg_temp.cerr(format($q$ update public.coach_cards set verified_at = now() where user_id = %L $q$, pg_temp.cu('b1'))) !~ 'coach_cards_verified_pair' then raise 'date sans méthode'; end if;
  if pg_temp.cerr(format($q$ update public.coach_cards set verified_at = now(), verify_method = 'photo' where user_id = %L $q$, pg_temp.cu('b1'))) !~ 'verify_method' then raise 'méthode inconnue'; end if;
  update public.coach_cards set status = 'verified', verified_at = now(), verify_method = 'franceconnect' where user_id = pg_temp.cu('b1');
end $$;
set role authenticated;
do $$
declare st jsonb;
begin
  perform pg_temp.clogin(pg_temp.cu('51'));
  if not (public.coach_card_badge(pg_temp.cu('b1')) ->> 'shown')::boolean then raise 'badge vérifié masqué'; end if;
  if public.coach_card_badge(pg_temp.cu('b1'))::text ~ 'verif' then raise 'vérification annoncée au public'; end if;
  perform public.report_coach_card(pg_temp.cu('b1'));
  perform pg_temp.clogin(pg_temp.cu('b1'));
  st := public.coach_card_state();
  if st ->> 'status' <> 'suspended' then raise 'badge vérifié non suspendu'; end if;
end $$;
reset role;
do $$
begin
  if private.coach_card_restore(pg_temp.cu('b1')) ->> 'status' <> 'verified' then raise 'vérification perdue à la revue'; end if;
end $$;
set role authenticated;
do $$
begin
  perform pg_temp.clogin(pg_temp.cu('b1'));
  -- Changer de numéro efface la vérification
  if public.coach_card_declare('07519ED0002') ->> 'status' <> 'declared' then raise 'vérification gardée après changement'; end if;
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.coach_cards where user_id = pg_temp.cu('b1') and (verified_at is not null or verify_method is not null)) then
    raise 'colonnes de vérification gardées';
  end if;
end $$;

-- ── Suppression du compte : déclaration effacée ──
delete from auth.users where id = pg_temp.cu('b1');
do $$ begin if exists (select 1 from public.coach_cards where user_id = pg_temp.cu('b1')) then raise 'déclaration restée'; end if; end $$;
