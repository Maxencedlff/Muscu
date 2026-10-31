-- ═══════════════════════════════════════════════════════════
--  Lettre d'information (newsletter) : inscription par consentement explicite, désinscription.
--  Contrat : docs/NEWSLETTER.md. Retour arrière : supabase/rollback/20261031230000_newsletter_down.sql.
--
--  Règles (RGPD art. 6.1.a et 7, article L34-5 du Code des postes et des communications électroniques) :
--  1. Rien n'est coché d'avance : une ligne n'existe que si la personne a touché elle-même
--     « Recevoir la lettre d'information » dans l'app (newsletter_subscribe). Aucune inscription
--     automatique, ni à la création du compte, ni par un achat.
--  2. Le consentement est horodaté À L'HEURE DU SERVEUR (consented_at = now()) avec la version du
--     texte montré (consent_version, texte dans js/data/newsletter.js et docs/NEWSLETTER.md) et la
--     source (app). L'appareil ne fournit jamais la date.
--  3. Se désinscrire est toujours possible, sans limite d'appels : la ligne est SUPPRIMÉE (plus rien
--     n'est gardé, on n'envoie plus rien). Supprimer le compte la supprime aussi (on delete cascade).
--  4. L'adresse n'est pas recopiée : c'est celle du compte (auth.users.email), lue au moment de l'envoi.
--     Un compte sans adresse (créé seulement avec Apple : l'app ne demande pas l'e-mail à Apple) ne peut
--     pas s'inscrire (no_email) : on n'enregistre pas un consentement qu'on ne pourrait pas honorer.
--     newsletter_json dit has_email pour que l'app l'explique au lieu d'afficher l'interrupteur.
--  5. L'ENVOI N'EST PAS BRANCHÉ. Deux fonctions sont prêtes pour le futur service d'envoi, clé serveur
--     seulement : newsletter_recipients() (la liste) et newsletter_unsubscribe_token(token) (lien de
--     désinscription en un clic de chaque e-mail, RFC 8058). Aucune n'est appelable par l'app.
--  Sécurité : RLS activée sans politique, aucun GRANT sur la table ; RPC en security definer,
--  search_path vide, auth.uid() ; REVOKE public/anon, GRANT authenticated seulement (sauf les deux
--  fonctions du serveur : service_role seulement).
-- ═══════════════════════════════════════════════════════════

create table public.newsletter_subscriptions (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  consented_at      timestamptz not null default now(),
  consent_version   text not null check (consent_version ~ '^v[0-9]{1,3}$'),
  source            text not null default 'app' check (source in ('app')),
  unsubscribe_token uuid not null unique default gen_random_uuid()
);

alter table public.newsletter_subscriptions enable row level security;
revoke all on public.newsletter_subscriptions from public, anon, authenticated, service_role;

-- Le compte a-t-il une adresse où envoyer la lettre ?
create function private.newsletter_has_email(uid uuid) returns boolean
  language sql stable security definer set search_path = '' as
$$
  select exists (select 1 from auth.users u where u.id = uid and coalesce(btrim(u.email), '') <> '')
$$;

-- État de l'inscription du compte connecté
create function private.newsletter_json(uid uuid) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object(
    'subscribed',   n.user_id is not null,
    'consented_at', n.consented_at,
    'version',      n.consent_version,
    'has_email',    private.newsletter_has_email(me.id)
  )
  from (select uid as id) me
  left join public.newsletter_subscriptions n on n.user_id = me.id
$$;

create function public.newsletter_state() returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  return private.newsletter_json(me);
end
$$;

-- Inscription : geste explicite de la personne, version du texte qu'elle a lu. Une nouvelle
-- inscription (après une désinscription, ou un nouveau texte) refait l'horodatage.
create function public.newsletter_subscribe(consent_version text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  v  text := btrim(coalesce(newsletter_subscribe.consent_version, ''));
begin
  if me is null or not exists (select 1 from auth.users u where u.id = me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not private.newsletter_has_email(me) then raise exception 'no_email' using errcode = 'P0001'; end if;
  if v !~ '^v[0-9]{1,3}$' then raise exception 'invalid_version' using errcode = 'P0001'; end if;
  perform private.rate_limit_window(me, 'newsletter_subscribe', 20, interval '24 hours');
  insert into public.newsletter_subscriptions as n (user_id, consented_at, consent_version, source)
    values (me, now(), v, 'app')
  on conflict (user_id) do update set consented_at = now(), consent_version = excluded.consent_version,
    source = excluded.source;
  return private.newsletter_json(me);
end
$$;

-- Désinscription : jamais limitée, rien n'est gardé
create function public.newsletter_unsubscribe() returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  delete from public.newsletter_subscriptions n where n.user_id = me;
  return private.newsletter_json(me);
end
$$;

-- ── Préparé pour le service d'envoi (pas branché), clé serveur seulement ──

-- Destinataires : comptes inscrits qui ont une adresse. Le jeton sert au lien de désinscription.
create function public.newsletter_recipients()
  returns table (user_id uuid, email text, consent_version text, unsubscribe_token uuid)
  language sql stable security definer set search_path = '' as
$$
  select n.user_id, u.email, n.consent_version, n.unsubscribe_token
  from public.newsletter_subscriptions n
  join auth.users u on u.id = n.user_id
  where private.newsletter_has_email(n.user_id)
  order by n.consented_at
$$;

-- Lien de désinscription en un clic : vrai si une inscription a été retirée. Un jeton inconnu
-- (déjà désinscrit, compte supprimé) rend faux, sans dire s'il a existé.
create function public.newsletter_unsubscribe_token(token uuid) returns boolean
  language plpgsql security definer set search_path = '' as
$$
begin
  delete from public.newsletter_subscriptions n where n.unsubscribe_token = newsletter_unsubscribe_token.token;
  return found;
end
$$;

revoke all on function private.newsletter_has_email(uuid) from public, anon, authenticated, service_role;
revoke all on function private.newsletter_json(uuid) from public, anon, authenticated, service_role;
revoke all on function public.newsletter_state() from public, anon, authenticated, service_role;
revoke all on function public.newsletter_subscribe(text) from public, anon, authenticated, service_role;
revoke all on function public.newsletter_unsubscribe() from public, anon, authenticated, service_role;
revoke all on function public.newsletter_recipients() from public, anon, authenticated, service_role;
revoke all on function public.newsletter_unsubscribe_token(uuid) from public, anon, authenticated, service_role;

grant execute on function public.newsletter_state() to authenticated;
grant execute on function public.newsletter_subscribe(text) to authenticated;
grant execute on function public.newsletter_unsubscribe() to authenticated;
grant execute on function public.newsletter_recipients() to service_role;
grant execute on function public.newsletter_unsubscribe_token(uuid) to service_role;

-- Administration (éditeur SQL, lecture seule) :
--   select count(*), max(consented_at) from public.newsletter_subscriptions;
--   select consent_version, count(*) from public.newsletter_subscriptions group by 1;
