-- ═══════════════════════════════════════════════════════════
--  Journal des moyens de connexion (ajouts et retraits), lu par la fonction delete-account
--
--  Faille fermée : avec un jeton de session volé, relier son propre Google (link_identity donne une
--  session « oauth » toute neuve) puis RETIRER aussitôt cette identité. La règle « aucun moyen relié
--  depuis moins de 24 h » de delete-account ne lisait que les identités présentes (identity.created_at) :
--  une identité retirée n'y apparaissait plus, et la session « récente » suffisait à supprimer le compte.
--
--  1. private.identity_events (schéma non exposé à l'API) : un événement 'linked' ou 'unlinked' par
--     ajout ou retrait d'une ligne de auth.identities, écrit par un déclencheur AFTER INSERT / AFTER
--     DELETE. Supabase autorise les déclencheurs sur auth.identities (changelog « Restricting access on
--     auth, storage and realtime schemas », 21/04/2025 : triggers et RLS permis sur auth.users,
--     auth.identities, auth.sessions…) ; la fonction du déclencheur est dans private, pas dans auth (créer
--     des fonctions dans auth est interdit). Une erreur du déclencheur fait échouer l'ajout ou le retrait :
--     voulu, un retrait non journalisé rouvrirait la faille.
--  2. Purge : les événements de plus de 30 jours sont effacés à chaque nouvel événement (la règle ne
--     regarde que 24 h ; rien n'est gardé plus que nécessaire). Le compte supprimé emporte ses événements
--     (on delete cascade), et la suppression du compte n'en écrit pas.
--  3. public.recent_identity_change(uid, since) : date du dernier ajout ou retrait depuis « since », ou
--     null. Exécutable seulement par service_role (delete-account, clé serveur). Elle est dans public et
--     non dans private parce que l'API (PostgREST, .rpc de supabase-js) n'appelle que les schémas
--     exposés, et private ne doit pas l'être ; anon et authenticated n'ont aucun droit dessus (revoke
--     explicite, y compris celui que Supabase donne par défaut aux nouvelles fonctions de public).
--     Elle renvoie une date et non un booléen : delete-account en déduit retry_at.
--     Seule tolérance (la même qu'aujourd'hui) : le tout premier ajout du compte, à moins de 10 minutes
--     de sa création (inscription par code e-mail, Apple ou Google). Un retrait n'est jamais toléré.
-- ═══════════════════════════════════════════════════════════

create table private.identity_events (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  event    text not null check (event in ('linked', 'unlinked')),
  at       timestamptz not null default now()
);
create index identity_events_user_at on private.identity_events (user_id, at desc);
create index identity_events_at on private.identity_events (at);
-- Défense en profondeur : aucun rôle de l'API n'a de droit ni de politique sur cette table
alter table private.identity_events enable row level security;
revoke all on private.identity_events from public, anon, authenticated, service_role;

-- Déclencheur : security definer (propriétaire postgres) car le serveur d'authentification écrit avec
-- le rôle supabase_auth_admin, qui n'a pas accès au schéma private. search_path vide : noms qualifiés.
create function private.log_identity_event() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if tg_op = 'INSERT' then
    insert into private.identity_events (user_id, provider, event) values (new.user_id, new.provider, 'linked');
  -- Retrait. Suppression du compte entier (cascade depuis auth.users, déjà effacé) : rien à journaliser,
  -- et une ligne vers un compte disparu ferait échouer la suppression (clé étrangère).
  elsif exists (select 1 from auth.users u where u.id = old.user_id) then
    insert into private.identity_events (user_id, provider, event) values (old.user_id, old.provider, 'unlinked');
  end if;
  delete from private.identity_events where at < now() - interval '30 days';
  return null;
end
$$;

create trigger identities_journal after insert or delete on auth.identities
  for each row execute function private.log_identity_event();

create function public.recent_identity_change(uid uuid, since interval) returns timestamptz
  language sql stable security definer set search_path = '' as
$$
  select max(e.at)
  from private.identity_events e
  join auth.users u on u.id = e.user_id
  where e.user_id = uid
    and e.at > now() - since
    -- Tolérance : premier ajout du compte, à moins de 10 minutes de sa création
    and not (
      abs(extract(epoch from (e.at - u.created_at))) <= 600
      and e.id = (select f.id from private.identity_events f
                  where f.user_id = uid and f.event = 'linked' order by f.at, f.id limit 1)
    )
$$;

revoke all on function private.log_identity_event() from public, anon, authenticated, service_role;
revoke all on function public.recent_identity_change(uuid, interval) from public, anon, authenticated;
grant execute on function public.recent_identity_change(uuid, interval) to service_role;
