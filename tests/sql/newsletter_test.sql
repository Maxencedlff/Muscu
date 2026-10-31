-- Vérifications de 20261031230000_newsletter.sql (lettre d'information : consentement explicite
-- horodaté par le serveur, désinscription toujours possible, rien pour un autre compte ni pour anon),
-- lancées par tests/sql/run.sh. Comptes simulés …00000000a0xx : A s'inscrit, B est un autre compte,
-- C n'a pas d'adresse. Rien n'est appliqué en production : Postgres local jetable.

create function pg_temp.terr(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.tu(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000a0' || c)::uuid $$;
create function pg_temp.tlogin(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false) $$;
grant execute on function pg_temp.terr(text), pg_temp.tu(text), pg_temp.tlogin(uuid) to authenticated, anon, service_role;

insert into auth.users (id, email) values
  (pg_temp.tu('10'), 'alice@example.test'), (pg_temp.tu('11'), 'bruno@example.test'), (pg_temp.tu('12'), null);

-- ── Rien n'est coché d'avance ; inscription horodatée par le serveur ──
set role authenticated;
do $$
declare st jsonb; t0 timestamptz := now();
begin
  perform pg_temp.tlogin(pg_temp.tu('10'));
  st := public.newsletter_state();
  if (st ->> 'subscribed')::boolean or st ->> 'consented_at' is not null then raise 'inscrit sans geste : %', st; end if;
  if pg_temp.terr($q$ select public.newsletter_subscribe('') $q$) is distinct from 'invalid_version' then raise 'version vide'; end if;
  if pg_temp.terr($q$ select public.newsletter_subscribe('2026') $q$) is distinct from 'invalid_version' then raise 'version mal formée'; end if;
  if pg_temp.terr($q$ select public.newsletter_subscribe(null) $q$) is distinct from 'invalid_version' then raise 'version nulle'; end if;
  st := public.newsletter_subscribe(' v1 ');
  if not (st ->> 'subscribed')::boolean or st ->> 'version' <> 'v1' or (st ->> 'consented_at')::timestamptz < t0 then raise 'inscription : %', st; end if;
  -- Une seconde inscription (nouveau texte) refait l'horodatage, une seule ligne
  st := public.newsletter_subscribe('v2');
  if st ->> 'version' <> 'v2' then raise 'nouvelle version'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.newsletter_subscriptions where user_id = pg_temp.tu('10')) <> 1 then raise 'une ligne par compte'; end if;
  if (select source from public.newsletter_subscriptions where user_id = pg_temp.tu('10')) <> 'app' then raise 'source'; end if;
end $$;

-- ── Un autre compte ne voit ni ne touche rien ──
set role authenticated;
do $$
declare st jsonb;
begin
  perform pg_temp.tlogin(pg_temp.tu('11'));
  st := public.newsletter_state();
  if (st ->> 'subscribed')::boolean then raise 'B voit l''inscription de A'; end if;
  perform public.newsletter_unsubscribe();   -- ne désinscrit que lui-même
  if pg_temp.terr($q$ select count(*) from public.newsletter_subscriptions $q$) not like 'permission denied%' then raise 'table lisible'; end if;
  if pg_temp.terr(format('delete from public.newsletter_subscriptions where user_id = %L', pg_temp.tu('10'))) not like 'permission denied%' then raise 'table modifiable'; end if;
  if pg_temp.terr(format('insert into public.newsletter_subscriptions (user_id, consent_version) values (%L, %L)', pg_temp.tu('11'), 'v1')) not like 'permission denied%' then raise 'insertion directe'; end if;
  if pg_temp.terr($q$ select * from public.newsletter_recipients() $q$) not like 'permission denied%' then raise 'liste des destinataires lisible'; end if;
  if pg_temp.terr(format('select public.newsletter_unsubscribe_token(%L)', gen_random_uuid())) not like 'permission denied%' then raise 'jeton appelable par l''app'; end if;
  -- Sans session : refusé
  perform pg_temp.tlogin(null);
  if pg_temp.terr($q$ select public.newsletter_subscribe('v1') $q$) is distinct from 'not_found' then raise 'inscription sans compte'; end if;
  if pg_temp.terr($q$ select public.newsletter_state() $q$) is distinct from 'not_found' then raise 'état sans compte'; end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.newsletter_subscriptions where user_id = pg_temp.tu('10')) then raise 'A désinscrit par B'; end if;
end $$;

-- ── anon : rien ──
set role anon;
do $$ begin
  if pg_temp.terr($q$ select public.newsletter_subscribe('v1') $q$) not like 'permission denied%' then raise 'anon s''inscrit'; end if;
  if pg_temp.terr($q$ select public.newsletter_state() $q$) not like 'permission denied%' then raise 'anon lit'; end if;
  if pg_temp.terr($q$ select public.newsletter_unsubscribe() $q$) not like 'permission denied%' then raise 'anon désinscrit'; end if;
  if pg_temp.terr($q$ select * from public.newsletter_recipients() $q$) not like 'permission denied%' then raise 'anon liste'; end if;
  if pg_temp.terr($q$ select count(*) from public.newsletter_subscriptions $q$) not like 'permission denied%' then raise 'anon lit la table'; end if;
end $$;
reset role;

-- ── Service d'envoi (clé serveur) : destinataires avec adresse, lien de désinscription ──
set role authenticated;
do $$ begin
  perform pg_temp.tlogin(pg_temp.tu('12'));
  perform public.newsletter_subscribe('v1');   -- compte sans adresse : inscrit, mais jamais destinataire
end $$;
reset role;
set role service_role;
do $$
declare tok uuid;
begin
  if (select count(*) from public.newsletter_recipients()) <> 1
     or (select email from public.newsletter_recipients()) <> 'alice@example.test' then raise 'destinataires'; end if;
  if pg_temp.terr($q$ select count(*) from public.newsletter_subscriptions $q$) not like 'permission denied%' then raise 'clé serveur lit la table'; end if;
  select r.unsubscribe_token into tok from public.newsletter_recipients() r;
  if public.newsletter_unsubscribe_token(gen_random_uuid()) then raise 'jeton inconnu accepté'; end if;
  if not public.newsletter_unsubscribe_token(tok) then raise 'lien de désinscription'; end if;
  if public.newsletter_unsubscribe_token(tok) then raise 'jeton réutilisé'; end if;
  if (select count(*) from public.newsletter_recipients()) <> 0 then raise 'encore destinataire'; end if;
  if pg_temp.terr($q$ select public.newsletter_subscribe('v1') $q$) not like 'permission denied%' then raise 'clé serveur inscrit'; end if;
end $$;
reset role;

-- ── Désinscription dans l'app : rien n'est gardé, jamais limitée ; débit des inscriptions ──
set role authenticated;
do $$
declare st jsonb;
begin
  perform pg_temp.tlogin(pg_temp.tu('11'));
  for i in 1..20 loop perform public.newsletter_subscribe('v1'); perform public.newsletter_unsubscribe(); end loop;
  if pg_temp.terr($q$ select public.newsletter_subscribe('v1') $q$) is distinct from 'rate_limited' then raise '21e inscription'; end if;
  st := public.newsletter_unsubscribe();
  if (st ->> 'subscribed')::boolean or st ->> 'version' is not null then raise 'désinscription : %', st; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.newsletter_subscriptions where user_id = pg_temp.tu('11')) then raise 'ligne gardée'; end if;
end $$;

-- ── Suppression du compte : l'inscription part avec lui ──
set role authenticated;
do $$ begin perform pg_temp.tlogin(pg_temp.tu('10')); perform public.newsletter_subscribe('v1'); end $$;
reset role;
delete from auth.users where id = pg_temp.tu('10');
do $$ begin
  if exists (select 1 from public.newsletter_subscriptions where user_id = pg_temp.tu('10')) then raise 'inscription restée après suppression'; end if;
end $$;

-- ── Droits et forme des fonctions ──
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('newsletter_state', 'newsletter_subscribe', 'newsletter_unsubscribe') loop
    if not has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise '% : droits', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('newsletter_recipients', 'newsletter_unsubscribe_token') loop
    if not has_function_privilege('service_role', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute') then raise '% : serveur seulement', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.newsletter_json(uuid)', 'execute') then raise 'newsletter_json exécutable'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.newsletter_subscriptions'::regclass) then raise 'RLS'; end if;
  if has_table_privilege('authenticated', 'public.newsletter_subscriptions', 'select') or has_table_privilege('anon', 'public.newsletter_subscriptions', 'select')
     or has_table_privilege('service_role', 'public.newsletter_subscriptions', 'select') then raise 'table lisible'; end if;
end $$;
