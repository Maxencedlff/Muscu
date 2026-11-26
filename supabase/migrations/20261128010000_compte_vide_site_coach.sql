-- ═══════════════════════════════════════════════════════════
--  Site du coach (coach.mdlf.app) : compte vide créé par « Se connecter avec Google » (ou Apple) effacé aussitôt
--  (docs/COACH_WEB.md, « Identifiant inconnu : aucun compte laissé »)
--
--  Le problème (26/11/2026) : sur le site, un identifiant Google encore relié à aucun compte MDLF fait créer par
--  Supabase un compte neuf et vide, qui garde cette identité Google : la relier ensuite au vrai compte depuis l'app
--  (linkIdentity) échoue, l'identité appartient déjà au compte vide.
--
--  Pourquoi pas un Auth Hook « Before User Created » qui refuserait la création : sa charge utile (metadata : uuid,
--  time, ip_address, name ; user : app_metadata.provider, identities…) ne dit pas d'où vient la connexion ; une
--  inscription Google du site (OAuth par redirection) et une de l'app (signInWithIdToken, la voie normale des
--  nouveaux élèves) y sont identiques. Refuser Google refuserait aussi les inscriptions de l'app.
--  Pourquoi pas une suppression en SQL : la voie documentée par Supabase est l'API d'administration
--  (auth.admin.deleteUser, qui ferme aussi les sessions) ; auth.users appartient à supabase_auth_admin.
--
--  Donc : la fonction serveur coach-web-orphan (clé serveur) appelle public.coach_web_orphan_claim(uid, sid) juste
--  après la connexion du site, puis supprime le compte par l'API seulement si la réponse est 'orphan'.
--  Un compte n'est « orphelin » que si TOUT est vrai (sinon 'kept', rien n'est touché) :
--   1. créé il y a moins de 10 minutes ;
--   2. une seule identité, Google ou Apple (ni e-mail, ni deux moyens) ;
--   3. une seule session au total, celle de l'appelant (sid, claim session_id du jeton vérifié), ouverte dans la
--      minute de la création : le compte est né de CETTE connexion du site. Un compte créé dans l'app a la session
--      de l'app : il a au moins deux sessions dès que le site s'y connecte ;
--   4. aucune donnée : aucune ligne, hors schéma auth, dans une table qui pointe vers auth.users (toutes les clés
--      étrangères, relues à chaque appel : une table ajoutée plus tard est comptée sans rien changer ici ; seul
--      private.identity_events, écrit par la création elle-même, est ignoré), ni dans les colonnes connues sans clé
--      étrangère (chat_reports, tarifs_ex_coach_team), ni aucun fichier dans Storage (propriétaire ou dossier).
--  Pas d'IDOR : uid et sid viennent du jeton relu par la fonction serveur, jamais d'un paramètre de la page ; la
--  fonction n'est exécutable que par service_role.
--  Limite de fréquence : 30 suppressions par heure pour tout le projet (verrou consultatif : deux appels simultanés
--  ne la dépassent pas) ; au-delà, 'limit' et rien n'est supprimé. Elle borne l'effet d'une erreur de logique.
--  Journal private.coach_web_orphans : fournisseur et heure seulement (rien qui désigne la personne), 30 jours.
-- ═══════════════════════════════════════════════════════════

create table private.coach_web_orphans (
  id       bigint generated always as identity primary key,
  provider text not null check (provider in ('google', 'apple')),
  at       timestamptz not null default now()
);
create index coach_web_orphans_at on private.coach_web_orphans (at);
alter table private.coach_web_orphans enable row level security;
revoke all on private.coach_web_orphans from public, anon, authenticated, service_role;

create function public.coach_web_orphan_claim(uid uuid, sid uuid) returns text
  language plpgsql volatile security definer set search_path = '' as
$$
declare
  created timestamptz;
  n int;
  prov text;
  t record;
  hit boolean;
begin
  if uid is null or sid is null then return 'kept'; end if;
  select u.created_at into created from auth.users u where u.id = uid for update;
  if not found or created is null or created < now() - interval '10 minutes' then return 'kept'; end if;

  select count(*), min(i.provider) into n, prov from auth.identities i where i.user_id = uid;
  if n <> 1 or prov not in ('google', 'apple') then return 'kept'; end if;

  if (select count(*) from auth.sessions s where s.user_id = uid) <> 1
     or not exists (select 1 from auth.sessions s where s.id = sid and s.user_id = uid
                    and s.created_at <= created + interval '1 minute') then
    return 'kept';
  end if;

  -- Données : toutes les clés étrangères vers auth.users hors schéma auth (une colonne chacune)
  for t in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class k on k.oid = c.conrelid
    join pg_catalog.pg_namespace s on s.oid = k.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and array_length(c.conkey, 1) = 1
      and s.nspname <> 'auth' and c.conrelid is distinct from to_regclass('private.identity_events')
    union all
    -- Colonnes qui désignent un compte sans clé étrangère
    select x.tbl, x.col from (values ('public.chat_reports', 'coach_id'), ('public.chat_reports', 'student_id'),
      ('public.chat_reports', 'target_user'), ('private.tarifs_ex_coach_team', 'coach_id')) as x(tbl, col)
    where to_regclass(x.tbl) is not null
  loop
    execute format('select exists (select 1 from %s where %I = $1)', t.tbl, t.col) into hit using uid;
    if hit then return 'kept'; end if;
  end loop;
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects o where o.owner_id = $1::text or o.owner = $1 or o.name like $1::text || ''/%'')'
      into hit using uid;
    if hit then return 'kept'; end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('coach_web_orphans'));
  if (select count(*) from private.coach_web_orphans o where o.at > now() - interval '1 hour') >= 30 then return 'limit'; end if;
  delete from private.coach_web_orphans o where o.at < now() - interval '30 days';
  insert into private.coach_web_orphans (provider) values (prov);
  return 'orphan';
end
$$;

revoke all on function public.coach_web_orphan_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.coach_web_orphan_claim(uuid, uuid) to service_role;
