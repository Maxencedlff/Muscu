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
--
--  Ce qui protège un compte créé dans l'app : seul son titulaire peut le faire effacer (uid et sid viennent de SON
--  jeton, relu par la fonction serveur ; aucun paramètre de la page ; la RPC n'est exécutable que par service_role),
--  et seul le site appelle la fonction. Les règles ci-dessous bornent ensuite ce que ce titulaire peut effacer : un
--  compte tout neuf, né de cette connexion, sans rien dedans. Un compte n'est « orphelin » que si TOUT est vrai
--  (sinon 'kept', rien n'est touché) :
--   1. créé il y a moins de 10 minutes ;
--   2. une seule identité, Google ou Apple (ni e-mail, ni deux moyens) ;
--   3. une seule session au total, celle de l'appelant (sid, claim session_id du jeton vérifié), ouverte dans la
--      minute de la création ;
--   4. vide (private.coach_web_account_empty) : aucune ligne, hors schéma auth, dans une table qui pointe vers
--      auth.users (toutes les clés étrangères, relues à chaque appel : une table ajoutée plus tard est comptée sans
--      rien changer ici ; seul private.identity_events, écrit par la création elle-même, est ignoré), ni dans les
--      colonnes connues sans clé étrangère (chat_reports, tarifs_ex_coach_team), ni aucun fichier dans Storage.
--  Cas limite accepté : un élève qui s'inscrit dans l'app, s'y déconnecte (sa session part), puis ouvre le site avec
--  le même identifiant dans la minute voit ce compte vide effacé ; il n'y perd rien (aucune donnée, par la règle 4).
--
--  Limites de fréquence (verrou consultatif : deux appels simultanés ne les dépassent pas ; au-delà, 'limit' et rien
--  n'est supprimé) :
--   - 3 par heure pour une même identité (empreinte SHA-256 de « fournisseur:identifiant chez le fournisseur ») :
--     chaque suppression libère l'identité, et la connexion suivante recrée un compte ; sans elle, un seul compte
--     Google épuiserait la limite du projet ;
--   - 30 par heure pour tout le projet : borne l'effet d'une erreur de logique.
--  Journal private.coach_web_orphans : fournisseur, heure et empreinte de l'identité (jamais l'identifiant lui-même ;
--  l'empreinte est effacée après 24 h, la ligne après 30 jours). Une ligne est un ticket : écrite par la décision
--  (sous le verrou, pour que la limite tienne), retirée par public.coach_web_orphan_release si la suppression échoue
--  (le quota n'est consommé que par les suppressions faites).
--  Comptes vides restés en place (limite atteinte, panne) : requête d'administration dans docs/COACH_WEB.md.
-- ═══════════════════════════════════════════════════════════

create table private.coach_web_orphans (
  id       bigint generated always as identity primary key,
  provider text not null check (provider in ('google', 'apple')),
  identity_hash text check (identity_hash ~ '^[0-9a-f]{64}$'),
  at       timestamptz not null default now()
);
create index coach_web_orphans_at on private.coach_web_orphans (at);
create index coach_web_orphans_identity on private.coach_web_orphans (identity_hash, at);
alter table private.coach_web_orphans enable row level security;
revoke all on private.coach_web_orphans from public, anon, authenticated, service_role;

-- Compte sans aucune donnée (règle 4) ; aussi pour la requête d'administration (éditeur SQL, rôle postgres)
create function private.coach_web_account_empty(uid uuid) returns boolean
  language plpgsql stable security definer set search_path = '' as
$$
declare
  t record;
  hit boolean;
begin
  for t in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class k on k.oid = c.conrelid
    join pg_catalog.pg_namespace s on s.oid = k.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and array_length(c.conkey, 1) = 1
      and s.nspname <> 'auth' and c.conrelid is distinct from to_regclass('private.identity_events')
      and c.conrelid is distinct from to_regclass('private.coach_web_orphans')
    union all
    -- Colonnes qui désignent un compte sans clé étrangère
    select x.tbl, x.col from (values ('public.chat_reports', 'coach_id'), ('public.chat_reports', 'student_id'),
      ('public.chat_reports', 'target_user'), ('private.tarifs_ex_coach_team', 'coach_id')) as x(tbl, col)
    where to_regclass(x.tbl) is not null
  loop
    execute format('select exists (select 1 from %s where %I = $1)', t.tbl, t.col) into hit using uid;
    if hit then return false; end if;
  end loop;
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects o where o.owner_id = $1::text or o.owner = $1 or o.name like $1::text || ''/%'')'
      into hit using uid;
    if hit then return false; end if;
  end if;
  return true;
end
$$;

-- Décision : { "result": "orphan", "ticket": id } (ligne du journal, à rendre si la suppression échoue),
-- { "result": "limit" } ou { "result": "kept" }
create function public.coach_web_orphan_claim(uid uuid, sid uuid) returns jsonb
  language plpgsql volatile security definer set search_path = '' as
$$
declare
  created timestamptz;
  n int;
  prov text;
  pid text;
  h text;
  ticket bigint;
begin
  if uid is null or sid is null then return '{"result": "kept"}'; end if;
  select u.created_at into created from auth.users u where u.id = uid for update;
  if not found or created is null or created < now() - interval '10 minutes' then return '{"result": "kept"}'; end if;

  select count(*), min(i.provider), min(i.provider_id) into n, prov, pid from auth.identities i where i.user_id = uid;
  if n <> 1 or prov not in ('google', 'apple') or pid is null then return '{"result": "kept"}'; end if;

  if (select count(*) from auth.sessions s where s.user_id = uid) <> 1
     or not exists (select 1 from auth.sessions s where s.id = sid and s.user_id = uid
                    and s.created_at <= created + interval '1 minute') then
    return '{"result": "kept"}';
  end if;

  if not private.coach_web_account_empty(uid) then return '{"result": "kept"}'; end if;

  h := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prov || ':' || pid, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('coach_web_orphans'));
  if (select count(*) from private.coach_web_orphans o where o.identity_hash = h and o.at > now() - interval '1 hour') >= 3
     or (select count(*) from private.coach_web_orphans o where o.at > now() - interval '1 hour') >= 30 then
    return '{"result": "limit"}';
  end if;
  delete from private.coach_web_orphans o where o.at < now() - interval '30 days';
  update private.coach_web_orphans o set identity_hash = null where o.identity_hash is not null and o.at < now() - interval '24 hours';
  insert into private.coach_web_orphans (provider, identity_hash) values (prov, h) returning id into ticket;
  return pg_catalog.jsonb_build_object('result', 'orphan', 'ticket', ticket);
end
$$;

-- Suppression refusée par l'API : le ticket est rendu (le quota n'est pas consommé). Seulement un ticket de moins de
-- 5 minutes : rien d'autre du journal ne peut être effacé par cette voie.
create function public.coach_web_orphan_release(ticket bigint) returns boolean
  language sql volatile security definer set search_path = '' as
$$
  with gone as (
    delete from private.coach_web_orphans o where o.id = ticket and o.at > now() - interval '5 minutes' returning 1
  ) select exists (select 1 from gone)
$$;

revoke all on function private.coach_web_account_empty(uuid) from public, anon, authenticated, service_role;
revoke all on function public.coach_web_orphan_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.coach_web_orphan_release(bigint) from public, anon, authenticated;
grant execute on function public.coach_web_orphan_claim(uuid, uuid) to service_role;
grant execute on function public.coach_web_orphan_release(bigint) to service_role;
