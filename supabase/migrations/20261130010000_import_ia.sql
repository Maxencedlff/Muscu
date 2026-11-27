-- Import d'un programme aidé par l'IA (docs/IMPORT_IA.md) : quotas, plafond de dépense et cache de résultats de la
-- fonction Edge plan-import-ai. PAS APPLIQUÉE EN PRODUCTION sans le feu vert de Maxence.
--
-- 1. Chaque appel au modèle est d'abord RÉSERVÉ (plan_ai_reserve) au coût du pire cas, puis RÉGLÉ (plan_ai_settle) au
--    coût réel calculé ici à partir des tokens facturés renvoyés par Anthropic (entrée, sortie, écriture et lecture
--    du cache) et des prix de private.plan_ai_prices. Un appel jamais réglé (fonction coupée) reste compté au pire cas.
-- 2. Quota par compte : 20 imports aidés par jour (jour de Paris) ; un import = une demande, même si la cascade fait
--    deux appels. Une réponse servie par le cache ne compte pas (aucun appel).
-- 3. Plafond global : la dépense du mois (UTC, comme la facture d'Anthropic), convertie en euros au taux prudent de
--    private.plan_ai_settings (1 $ = 1 € par défaut : surestime le coût), ne dépasse jamais month_cap_eur (15 €) :
--    au-delà, plan_ai_reserve refuse (quota_global) et l'app garde le résultat du moteur gratuit.
-- 4. Cache de résultats : clé = empreinte SHA-256 (64 hex) calculée par la fonction ; valeur = la réponse structurée
--    du modèle (numéros de ligne, noms de la bibliothèque, nombres), JAMAIS le texte importé. 30 jours.
-- 5. Données personnelles : l'identifiant du compte seulement, pour le quota du jour ; mis à null si le compte est
--    effacé (la dépense reste comptée) ; lignes effacées après 70 jours. Aucun texte, aucune image.
-- Droits : tables dans private (aucun rôle de l'API n'y accède) ; les quatre fonctions ne sont exécutables que par
-- service_role (la fonction Edge), jamais par anon ni par un compte connecté.
-- Retour arrière : supabase/rollback/20261130010000_import_ia_down.sql.

create table private.plan_ai_settings (
  id boolean primary key default true check (id),
  daily_per_user integer not null default 20 check (daily_per_user between 1 and 1000),
  month_cap_eur numeric(10, 2) not null default 15 check (month_cap_eur between 0 and 1000),
  usd_to_eur numeric(6, 4) not null default 1 check (usd_to_eur > 0 and usd_to_eur <= 2)
);
insert into private.plan_ai_settings default values;

-- Prix publics par million de tokens, en dollars (https://platform.claude.com/docs/en/about-claude/pricing)
create table private.plan_ai_prices (
  model text primary key check (model ~ '^claude-[a-z0-9-]{1,40}$'),
  in_usd numeric(8, 4) not null check (in_usd >= 0),
  out_usd numeric(8, 4) not null check (out_usd >= 0),
  cache_write_usd numeric(8, 4) not null check (cache_write_usd >= 0),
  cache_read_usd numeric(8, 4) not null check (cache_read_usd >= 0)
);
insert into private.plan_ai_prices values
  ('claude-haiku-5-5', 0.10, 0.50, 0.125, 0.01),
  ('claude-sonnet-5-5', 2.00, 10.00, 2.50, 0.10);

create table private.plan_ai_calls (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  import_id uuid not null,
  model text not null references private.plan_ai_prices (model),
  at timestamptz not null default now(),
  status text not null default 'reserved' check (status in ('reserved', 'ok', 'failed')),
  reserved_usd numeric(12, 6) not null check (reserved_usd between 0 and 5),
  input_tokens integer check (input_tokens between 0 and 2000000),
  output_tokens integer check (output_tokens between 0 and 2000000),
  cache_write_tokens integer check (cache_write_tokens between 0 and 2000000),
  cache_read_tokens integer check (cache_read_tokens between 0 and 2000000),
  cost_usd numeric(12, 6) check (cost_usd >= 0)
);
create index plan_ai_calls_user on private.plan_ai_calls (user_id, at);
create index plan_ai_calls_at on private.plan_ai_calls (at);

create table private.plan_ai_cache (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  value jsonb not null check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 65536),
  at timestamptz not null default now()
);
create index plan_ai_cache_at on private.plan_ai_cache (at);

revoke all on table private.plan_ai_settings, private.plan_ai_prices, private.plan_ai_calls, private.plan_ai_cache
  from public, anon, authenticated, service_role;

-- Dépense du mois en cours (UTC), en dollars : réglé au coût réel, réservé ou en échec sans tokens au pire cas
create function private.plan_ai_month_usd() returns numeric
  language sql stable set search_path = '' as
$$
  select coalesce(sum(case when c.status = 'ok' then c.cost_usd else coalesce(c.cost_usd, c.reserved_usd) end), 0)
  from private.plan_ai_calls c
  where c.at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')
$$;

-- Réserve un appel : quota du compte (un nouvel import seulement), puis plafond du mois, pire cas compris
create function public.plan_ai_reserve(p_user uuid, p_import uuid, p_model text, p_worst_usd numeric) returns bigint
  language plpgsql security definer set search_path = '' as
$$
declare
  s private.plan_ai_settings;
  day_start timestamptz := date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  new_id bigint;
begin
  if p_user is null or p_import is null or p_worst_usd is null or p_worst_usd < 0 or p_worst_usd > 5
     or not exists (select 1 from private.plan_ai_prices p where p.model = p_model) then
    raise exception 'invalid' using errcode = '22023';
  end if;
  -- Un seul calcul du plafond à la fois : deux imports simultanés ne passent pas tous deux sous la barre
  perform pg_advisory_xact_lock(hashtextextended('plan_ai_budget', 0));
  select * into s from private.plan_ai_settings;
  delete from private.plan_ai_calls c where c.at < now() - interval '70 days';
  if not exists (select 1 from private.plan_ai_calls c where c.user_id = p_user and c.import_id = p_import) then
    if (select count(distinct c.import_id) from private.plan_ai_calls c where c.user_id = p_user and c.at >= day_start) >= s.daily_per_user then
      raise exception 'quota_user' using errcode = 'P0001';
    end if;
  elsif (select count(*) from private.plan_ai_calls c where c.import_id = p_import) >= 4 then
    raise exception 'quota_user' using errcode = 'P0001';
  end if;
  if (private.plan_ai_month_usd() + p_worst_usd) * s.usd_to_eur > s.month_cap_eur then
    raise exception 'quota_global' using errcode = 'P0001';
  end if;
  insert into private.plan_ai_calls (user_id, import_id, model, reserved_usd) values (p_user, p_import, p_model, p_worst_usd)
    returning id into new_id;
  return new_id;
end
$$;

-- Règle un appel réservé : tokens facturés et coût réel (dollars) ; un appel en échec sans tokens garde le pire cas
create function public.plan_ai_settle(p_id bigint, p_ok boolean, p_input integer, p_output integer, p_cache_write integer, p_cache_read integer)
  returns numeric
  language plpgsql security definer set search_path = '' as
$$
declare cost numeric;
begin
  update private.plan_ai_calls c set
    status = case when p_ok then 'ok' else 'failed' end,
    input_tokens = p_input, output_tokens = p_output, cache_write_tokens = p_cache_write, cache_read_tokens = p_cache_read,
    cost_usd = case when p_input is null and p_output is null then null else
      round((coalesce(p_input, 0) * p.in_usd + coalesce(p_output, 0) * p.out_usd + coalesce(p_cache_write, 0) * p.cache_write_usd
        + coalesce(p_cache_read, 0) * p.cache_read_usd) / 1000000, 6) end
  from private.plan_ai_prices p
  where c.id = p_id and c.status = 'reserved' and p.model = c.model
  returning c.cost_usd into cost;
  return cost;
end
$$;

-- Cache de résultats : lecture de 60 clés au plus, entrées de moins de 30 jours
create function public.plan_ai_cache_get(p_keys text[]) returns table (key text, value jsonb)
  language sql stable security definer set search_path = '' as
$$
  select c.key, c.value from private.plan_ai_cache c
  where c.key = any (p_keys[1:60]) and c.at > now() - interval '30 days'
$$;

-- Écriture de 60 entrées au plus [{ key, value }] ; purge des entrées de plus de 30 jours
create function public.plan_ai_cache_put(p_entries jsonb) returns void
  language plpgsql security definer set search_path = '' as
$$
begin
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 60 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  delete from private.plan_ai_cache c where c.at < now() - interval '30 days';
  insert into private.plan_ai_cache (key, value)
    select e ->> 'key', e -> 'value' from jsonb_array_elements(p_entries) e
  on conflict (key) do update set value = excluded.value, at = now();
end
$$;

revoke all on function private.plan_ai_month_usd() from public, anon, authenticated, service_role;
revoke all on function public.plan_ai_reserve(uuid, uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.plan_ai_settle(bigint, boolean, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.plan_ai_cache_get(text[]) from public, anon, authenticated;
revoke all on function public.plan_ai_cache_put(jsonb) from public, anon, authenticated;
grant execute on function public.plan_ai_reserve(uuid, uuid, text, numeric) to service_role;
grant execute on function public.plan_ai_settle(bigint, boolean, integer, integer, integer, integer) to service_role;
grant execute on function public.plan_ai_cache_get(text[]) to service_role;
grant execute on function public.plan_ai_cache_put(jsonb) to service_role;
