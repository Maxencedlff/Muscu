-- ═══════════════════════════════════════════════════════════
--  Social V1.2 : commentaires libres sur une séance (contrat : docs/SOCIAL_V1.md, section
--  « Commentaires »). Les migrations du social déjà en production ne changent pas : tout est ici.
--  Retour arrière : supabase/rollback/20261031500000_commentaires_down.sql.
--
--  - Qui commente : le propriétaire de la séance et les personnes qui la voient dans leur fil
--    (private.can_see : abonnement accepté, social activé des deux côtés, aucun blocage), seulement
--    sur une séance montrable (private.session_shown : non supprimée, non masquée, datée). Le social
--    de l'appelant est requis (social_not_enabled).
--  - Qui lit : les mêmes. Un commentaire n'est montré que tant que son auteur voit encore la séance
--    (même règle que les réactions : un abonné retiré, désabonné, bloqué ou qui a désactivé le social
--    disparaît ; sa ligne reste et revient s'il est de nouveau accepté). Blocage respecté entre le
--    lecteur et l'auteur, dans les deux sens (un abonné de A ne voit pas les commentaires de quelqu'un
--    qu'il a bloqué, ni l'inverse). Rien n'est révélé : une séance qu'on ne voit pas répond une liste
--    vide (lecture) ou not_found (écriture, signalement).
--  - Texte : 1 à 500 caractères après nettoyage (espaces autour retirés, \r retirés, plus de deux
--    retours à la ligne de suite ramenés à deux). Vide : empty_comment ; trop long : too_long.
--  - Mots interdits : liste private.comment_words (français et anglais), tenue côté serveur et
--    complétable sans migration (insert depuis l'éditeur SQL). Comparaison après minuscules, accents
--    retirés, chiffres « leet » lus (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s), lettres répétées
--    ramenées à une (« fuuuck »), lettres isolées recollées (« c o n n a r d »). Mode word : le mot
--    entier (pluriel et féminin simples compris) ; mode contains : n'importe où dans un mot (radicaux
--    qui ne se trouvent dans aucun mot courant). Deux ou trois mots voisins recollés doivent former
--    exactement un mot interdit de 6 lettres ou plus (« tue-toi », « kill your self ») : « situe-toi »
--    ou « youpi nouveau » passent, et jamais à travers une ponctuation de phrase (« ça tue, toi ? »). Mots courants qui ressemblent à un mot interdit une fois les
--    lettres répétées ramenées à une (« cône », « fagot », « Niger ») : liste private.comment_allowed,
--    retirés du texte avant la comparaison. Un mot anglais qui est aussi un mot français courant
--    (« retard ») n'est pas dans la liste. Refus : comment_forbidden (rien n'est écrit).
--  - Modération : signalement par report_comment (motifs de la fonction Edge report), une fois par
--    personne et par commentaire, avec une copie du texte (le signalement survit à la suppression du
--    commentaire) et une ligne dans public.reports, la file commune, pour l'alerte par e-mail. Au 3e signalement de personnes différentes, le commentaire est masqué
--    automatiquement (masked_at) : plus personne ne le voit, sauf son auteur (marqué masked). Le
--    propriétaire de la séance peut supprimer n'importe quel commentaire de sa séance, l'auteur le sien.
--    Signalements gardés 12 mois : purge quotidienne pg_cron (purge-comment-reports-12-mois, comme
--    reports et chat_reports), plus une purge à chaque nouveau signalement (filet sans pg_cron).
--  - Activité de Mon profil : my_activity gagne la sorte comment (commentaire d'un autre sur une de
--    mes séances) et deux colonnes à la fin (comment_id, comment_text : 120 premiers caractères) ;
--    private.activity_new les compte (pastille de l'onglet). Une ancienne version de l'app ignore les
--    lignes d'une sorte qu'elle ne connaît pas (cleanActivityRow).
--  - Limites : 30 commentaires par heure et 150 par 24 h ; signalements : ceux de public.reports
--    (10 par 24 h, tous types confondus) ; lectures
--    (list_comments) 600 par heure. Supprimer n'est jamais limité.
--  - Erreurs lisibles (P0001) : empty_comment, too_long, comment_forbidden, social_not_enabled,
--    not_found, invalid_reason, rate_limited.
--  - Sécurité : tables sans GRANT client (RLS activée, aucune politique) ; RPC security definer,
--    search_path vide, utilisateur pris dans auth.uid() ; public et anon perdent le droit d'exécution,
--    seul authenticated le reçoit ; fonctions de private exécutables par aucun rôle de l'API.
--  - Suppression du compte : commentaires et signalements partent en cascade (auteur, propriétaire de
--    la séance ou séance).
-- ═══════════════════════════════════════════════════════════

-- ── Données ──────────────────────────────────────────────

create table public.session_comments (
  id            bigint generated always as identity primary key,
  session_owner uuid not null,
  session_id    text not null,
  author_id     uuid not null references auth.users(id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 500),
  created_at    timestamptz not null default now(),
  -- Masqué automatiquement après 3 signalements (report_comment) ; null = visible
  masked_at     timestamptz,
  -- La séance existe (supprimée avec le compte) ; ses commentaires partent avec elle
  foreign key (session_owner, session_id) references public.sessions(user_id, id) on delete cascade
);
-- Commentaires d'une séance, du plus récent au plus ancien (pagination par id)
create index session_comments_session on public.session_comments (session_owner, session_id, id desc);
-- Activité : commentaires reçus sur mes séances
create index session_comments_owner_at on public.session_comments (session_owner, created_at desc);
-- Suppression du compte de l'auteur (cascade)
create index session_comments_author on public.session_comments (author_id);

-- Signalements de commentaires. body : copie du texte au moment du signalement (preuve gardée même si
-- l'auteur supprime son commentaire, comment_id passe alors à null). Une fois par personne et par commentaire.
create table public.comment_reports (
  id            bigint generated always as identity primary key,
  comment_id    bigint references public.session_comments(id) on delete set null,
  reporter_id   uuid not null references auth.users(id) on delete cascade,
  author_id     uuid not null references auth.users(id) on delete cascade,
  session_owner uuid not null references auth.users(id) on delete cascade,
  session_id    text not null,
  body          text not null,
  reason        text not null check (reason in ('spam', 'harcelement', 'sexuel', 'violence', 'haine', 'autre')),
  created_at    timestamptz not null default now(),
  constraint comment_reports_once unique (comment_id, reporter_id),
  constraint comment_reports_not_self check (reporter_id <> author_id)
);
create index comment_reports_at on public.comment_reports (created_at);
create index comment_reports_comment on public.comment_reports (comment_id);

-- Mots interdits dans un commentaire (schéma non exposé). word : le mot entier (avec s, e, es ou x
-- à la fin) ; contains : n'importe où dans un mot. Forme stockée : minuscules sans accents, a-z et 0-9.
-- joinable : cherché aussi dans deux ou trois mots voisins recollés (« sa lope ») ; false pour un mot qui
-- est aussi la suite de mots courants (« chat te » → chatte, « bas tard » → bastard, « crevé toi »).
create table private.comment_words (
  word text primary key check (word ~ '^[a-z0-9]{2,40}$'),
  lang text not null check (lang in ('fr', 'en')),
  mode text not null check (mode in ('word', 'contains')),
  joinable boolean not null default true
);

-- Mots et expressions courants acceptés malgré leur ressemblance avec un mot interdit (forme de
-- comment_norm : minuscules sans accents ; mots séparés par une espace). Retirés du texte, mot entier,
-- avant la comparaison ; complétable sans migration (insert depuis l'éditeur SQL).
create table private.comment_allowed (
  phrase text primary key check (phrase ~ '^[a-z0-9]{2,40}( [a-z0-9]{1,40}){0,3}$')
);

alter table public.session_comments enable row level security;
alter table public.comment_reports enable row level security;
alter table private.comment_words enable row level security;
alter table private.comment_allowed enable row level security;
-- Aucune politique : RLS fermée (défense en profondeur, en plus des GRANT)
revoke all on public.session_comments, public.comment_reports from public, anon, authenticated, service_role;
revoke all on private.comment_words, private.comment_allowed from public, anon, authenticated, service_role;

insert into private.comment_words (word, lang, mode) values
  -- Français : insultes et injures
  ('connard', 'fr', 'contains'), ('connasse', 'fr', 'contains'), ('encule', 'fr', 'contains'),
  ('enkule', 'fr', 'contains'), ('salope', 'fr', 'word'), ('salaud', 'fr', 'word'),
  ('putain', 'fr', 'contains'), ('pute', 'fr', 'word'), ('batard', 'fr', 'contains'),
  ('fdp', 'fr', 'word'), ('ntm', 'fr', 'word'), ('niquer', 'fr', 'word'), ('nique', 'fr', 'word'),
  ('niktamer', 'fr', 'contains'), ('nikta', 'fr', 'word'), ('pede', 'fr', 'word'), ('tapette', 'fr', 'word'),
  ('gouine', 'fr', 'contains'), ('negre', 'fr', 'word'), ('negro', 'fr', 'word'), ('bougnoul', 'fr', 'contains'),
  ('youpin', 'fr', 'contains'), ('bicot', 'fr', 'word'), ('bite', 'fr', 'word'), ('couille', 'fr', 'word'),
  ('chatte', 'fr', 'word'), ('merde', 'fr', 'contains'), ('con', 'fr', 'word'), ('conne', 'fr', 'word'),
  ('debile', 'fr', 'word'), ('abruti', 'fr', 'word'), ('mongol', 'fr', 'word'), ('gogol', 'fr', 'word'),
  ('trisomique', 'fr', 'word'), ('grosporc', 'fr', 'contains'), ('grossetruie', 'fr', 'contains'),
  ('suicidetoi', 'fr', 'contains'), ('crevetoi', 'fr', 'contains'), ('tuetoi', 'fr', 'word'),
  ('nazi', 'fr', 'contains'), ('hitler', 'fr', 'contains'), ('pedo', 'fr', 'word'), ('pedophile', 'fr', 'contains'),
  ('violeur', 'fr', 'contains'), ('terroriste', 'fr', 'contains'),
  -- Anglais
  ('fuck', 'en', 'contains'), ('fck', 'en', 'word'), ('fvck', 'en', 'contains'), ('phuck', 'en', 'contains'),
  ('shit', 'en', 'word'), ('bullshit', 'en', 'word'), ('bitch', 'en', 'contains'), ('cunt', 'en', 'contains'),
  ('asshole', 'en', 'contains'), ('dick', 'en', 'word'), ('dickhead', 'en', 'contains'), ('pussy', 'en', 'contains'),
  ('whore', 'en', 'contains'), ('slut', 'en', 'contains'), ('nigger', 'en', 'contains'), ('nigga', 'en', 'contains'),
  ('faggot', 'en', 'contains'), ('fag', 'en', 'word'), ('retarded', 'en', 'word'), ('rapist', 'en', 'word'),
  ('porn', 'en', 'contains'), ('kys', 'en', 'word'), ('killyourself', 'en', 'contains'), ('bastard', 'en', 'word'),
  ('motherfucker', 'en', 'contains'), ('wanker', 'en', 'contains'), ('twat', 'en', 'word');
-- Hors recollage : « T'es crevé toi aussi ? », « Le chat te regarde », « bas tard le soir », « Tape tes
-- séries » (tape + tes = tapette une fois les lettres doublées ramenées à une ; sans accents ni tirets,
-- « crevé toi » et « crève-toi » donnent le même texte : seul le mot écrit d'un bloc reste refusé)
update private.comment_words set joinable = false where word in ('crevetoi', 'chatte', 'bastard', 'tapette');

-- « cône » (conne), « fagot » (faggot), « nigaud », « Niger » (nigga, nigger), « Pornic » (porn),
-- « chili con carne » (con), « pain bâtard », « tapette à mouche », « bite-size », « cuisine mongole » (mongol)
insert into private.comment_allowed (phrase) values
  ('cone'), ('cones'), ('fagot'), ('fagots'), ('nigaud'), ('nigauds'), ('nigaude'), ('nigaudes'),
  ('niger'), ('nigeria'), ('nigerian'), ('nigeriane'), ('nigerians'), ('nigerianes'),
  ('nigerien'), ('nigerienne'), ('nigeriens'), ('nigeriennes'), ('pornic'), ('chili con carne'),
  ('pain batard'), ('pains batards'), ('tapette a mouche'), ('tapettes a mouches'), ('bite size'),
  ('mongole'), ('mongoles');

-- ── Briques privées ──────────────────────────────────────

-- Texte comparé aux mots interdits : minuscules, accents retirés, chiffres « leet » lus
create function private.comment_norm(t text) returns text
  language sql immutable set search_path = '' as
$$
  select translate(
    replace(replace(lower(coalesce(t, '')), 'œ', 'oe'), 'æ', 'ae'),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ013457@$',
    'aaaaaaceeeeiiiinooooouuuuyyoieastas')
$$;

-- Lettres répétées ramenées à une (« fuuuck » → « fuck », « connard » → « conard » : les deux côtés
-- de la comparaison passent par là)
create function private.comment_squeeze(t text) returns text
  language sql immutable set search_path = '' as
$$ select regexp_replace(t, '(.)\1+', '\1', 'g') $$;

-- Le commentaire contient-il un mot interdit ? Mots courants acceptés (comment_allowed) retirés
-- d'abord, mot entier. Mots = suites de a-z et 0-9 ; une suite de lettres isolées (« c o n n a r d »,
-- « f.u.c.k ») est recollée en un mot. Deux ou trois mots voisins recollés sont refusés seulement
-- s'ils forment exactement un mot interdit de 6 lettres ou plus marqué joinable (« tue-toi »,
-- « kill your self », « sa lope ») : jamais un morceau de mot (« situe-toi », « youpi nouveau » passent),
-- jamais à travers une ponctuation de phrase (« Le squat ça tue, toi tu en fais combien ? » passe).
create function private.comment_forbidden(body text) returns boolean
  language plpgsql stable security definer set search_path = '' as
$$
declare
  -- Ponctuation de phrase (, . ; : ! ? …) gardée comme limite « | » : elle coupe le recollage des mots
  -- voisins (« ça tue, toi ? » n'est pas « tue-toi »), pas celui des lettres isolées (« f.u.c.k »)
  t text := regexp_replace(regexp_replace(regexp_replace(private.comment_norm(body), '[,.;:!?…]+', '|', 'g'),
                                          '[^a-z0-9|]+', ' ', 'g'), '\|', ' | ', 'g');
  allowed text;
  tok text;
  run text := '';
  seg int := 0;
  words text[] := '{}';
  segs int[] := '{}';
  joined text[] := '{}';
  n int;
  i int;
begin
  select string_agg(a.phrase, '|' order by char_length(a.phrase) desc) into allowed from private.comment_allowed a;
  if allowed is not null then t := regexp_replace(t, '\m(' || allowed || ')\M', ' ', 'g'); end if;
  foreach tok in array regexp_split_to_array(t, ' +') loop
    if tok = '|' then
      seg := seg + 1;
    elsif char_length(tok) = 1 then
      run := run || tok;
    else
      if char_length(run) > 1 then words := words || run; segs := segs || seg; end if;
      run := '';
      if tok <> '' then words := words || tok; segs := segs || seg; end if;
    end if;
  end loop;
  if char_length(run) > 1 then words := words || run; segs := segs || seg; end if;
  n := coalesce(array_length(words, 1), 0);
  -- Recollage seulement entre mots d'un même segment
  for i in 1 .. n - 1 loop
    if segs[i] = segs[i + 1] then
      joined := joined || (words[i] || words[i + 1]);
      if i + 2 <= n and segs[i + 1] = segs[i + 2] then joined := joined || (words[i] || words[i + 1] || words[i + 2]); end if;
    end if;
  end loop;
  return exists (
    select 1
    from unnest(words) as k(v), private.comment_words w
    where (w.mode = 'word'
           and private.comment_squeeze(k.v) ~ ('^' || private.comment_squeeze(w.word) || '(s|e|es|x)?$'))
       or (w.mode = 'contains'
           and position(private.comment_squeeze(w.word) in private.comment_squeeze(k.v)) > 0)
  ) or exists (
    select 1
    from unnest(joined) as k(v), private.comment_words w
    where w.joinable and char_length(w.word) >= 6
      and private.comment_squeeze(k.v) ~ ('^' || private.comment_squeeze(w.word) || '(s|e|es|x)?$')
  );
end
$$;

-- Texte nettoyé : \r retirés, plus de deux retours à la ligne de suite ramenés à deux, espaces autour retirés
create function private.comment_clean(t text) returns text
  language sql immutable set search_path = '' as
$$ select btrim(regexp_replace(replace(coalesce(t, ''), E'\r', ''), E'\n{3,}', E'\n\n', 'g'), E' \t\n') $$;

-- viewer peut-il lire les commentaires de cette séance ? Le propriétaire (social activé, séance non
-- supprimée, même masquée) ou quelqu'un qui la voit dans son fil.
create function private.comments_readable(viewer uuid, owner uuid, sid text) returns boolean
  language sql stable set search_path = '' as
$$
  select viewer is not null and exists (
    select 1 from public.sessions x
    where x.user_id = owner and x.id = sid and x.deleted_at is null
      and ((viewer = owner and private.social_on(viewer))
           or (private.can_see(viewer, owner) and private.session_shown(x.data, x.deleted_at, x.done_at)))
  )
$$;

-- viewer peut-il écrire sur cette séance ? Elle doit être montrable aux abonnés, pour tout le monde
-- (le propriétaire compris : répondre sur une séance que personne ne voit n'a pas de sens).
create function private.comments_writable(viewer uuid, owner uuid, sid text) returns boolean
  language sql stable set search_path = '' as
$$
  select viewer is not null and exists (
    select 1 from public.sessions x
    where x.user_id = owner and x.id = sid and private.session_shown(x.data, x.deleted_at, x.done_at)
      and ((viewer = owner and private.social_on(viewer)) or private.can_see(viewer, owner))
  )
$$;

-- Un commentaire est-il montré à viewer ? Son auteur voit encore la séance (ou en est le
-- propriétaire), aucun blocage entre viewer et l'auteur, et pas masqué (sauf pour son auteur).
create function private.comment_shown(viewer uuid, owner uuid, author uuid, masked_at timestamptz) returns boolean
  language sql stable set search_path = '' as
$$
  select (author = owner or private.can_see(author, owner))
     and not private.blocked_between(viewer, author)
     and (masked_at is null or author = viewer)
$$;

-- Ligne renvoyée à l'app (add_comment) : mêmes champs que list_comments
create function private.comment_row(c public.session_comments, viewer uuid) returns jsonb
  language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'id', c.id, 'user_id', c.author_id, 'username', p.username, 'avatar', p.avatar_emoji,
    'body', c.body, 'at', c.created_at, 'mine', c.author_id = viewer,
    'can_delete', c.author_id = viewer or c.session_owner = viewer, 'masked', c.masked_at is not null)
  from (select 1) one left join public.user_profiles p on p.user_id = c.author_id
$$;

-- Signalements de plus de 12 mois purgés à chaque nouveau signalement (durée annoncée dans privacy.html ;
-- la tâche pg_cron purge-comment-reports-12-mois, en fin de fichier, purge même sans nouveau signalement)
create function private.comment_report_before_insert() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  new.created_at := now();
  delete from public.comment_reports r where r.created_at < now() - interval '12 months';
  return new;
end
$$;
create trigger comment_reports_before_insert before insert on public.comment_reports
  for each row execute function private.comment_report_before_insert();

-- ── Fonctions RPC (authenticated seulement) ──────────────

-- Commentaires d'une séance (list_comments), du plus récent au plus ancien, 30 par page (before_id : id du dernier
-- reçu). Séance que je ne vois pas : liste vide (rien n'est révélé). mine : le mien ; can_delete : le
-- mien ou ma séance ; masked : masqué après signalements (seul son auteur le reçoit encore).
create function public.list_comments(owner uuid, session_id text, before_id bigint default null)
  returns table (id bigint, user_id uuid, username text, avatar text, body text, at timestamptz,
                 mine boolean, can_delete boolean, masked boolean)
  language plpgsql security definer set search_path = '' as
$$
#variable_conflict use_column
declare me uuid := (select auth.uid());
begin
  if me is null or not private.comments_readable(me, list_comments.owner, list_comments.session_id) then return; end if;
  perform private.rate_limit_window(me, 'comments_read', 600, interval '1 hour');
  return query
    select c.id, c.author_id, p.username, p.avatar_emoji, c.body, c.created_at,
      c.author_id = me, c.author_id = me or c.session_owner = me, c.masked_at is not null
    from public.session_comments c
    left join public.user_profiles p on p.user_id = c.author_id
    where c.session_owner = list_comments.owner and c.session_id = list_comments.session_id
      and (list_comments.before_id is null or c.id < list_comments.before_id)
      and private.comment_shown(me, c.session_owner, c.author_id, c.masked_at)
    order by c.id desc
    limit 30;
end
$$;

-- Écrire un commentaire. Renvoie la ligne telle que list_comments la donnerait.
create function public.add_comment(owner uuid, session_id text, body text) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  t text := private.comment_clean(add_comment.body);
  c public.session_comments;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if t = '' then raise exception 'empty_comment' using errcode = 'P0001'; end if;
  if char_length(t) > 500 then raise exception 'too_long' using errcode = 'P0001'; end if;
  if not private.social_on(me) then raise exception 'social_not_enabled' using errcode = 'P0001'; end if;
  if not private.comments_writable(me, add_comment.owner, add_comment.session_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if private.comment_forbidden(t) then raise exception 'comment_forbidden' using errcode = 'P0001'; end if;
  perform private.rate_limit_window(me, 'comment_h', 30, interval '1 hour');
  perform private.rate_limit(me, 'comment', 150);
  insert into public.session_comments (session_owner, session_id, author_id, body)
    values (add_comment.owner, add_comment.session_id, me, t)
    returning * into c;
  return private.comment_row(c, me);
end
$$;

-- Supprimer un commentaire : le mien, ou n'importe lequel sur ma séance. Renvoie true s'il a été
-- supprimé ; false sinon (inconnu, ou pas à moi : rien n'est révélé). Jamais limité.
create function public.delete_comment(comment_id bigint) returns boolean
  language plpgsql security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then return false; end if;
  delete from public.session_comments c
    where c.id = delete_comment.comment_id and (c.author_id = me or c.session_owner = me);
  return found;
end
$$;

-- Signaler un commentaire que je vois (pas le mien) : une fois par commentaire (refaire ne fait
-- rien et renvoie null). Copie du texte dans comment_reports, et une ligne dans public.reports (la
-- file de modération commune, kind session, target_ref comment_reports:<id>, details : le texte) dont
-- l'app demande l'alerte par e-mail à la fonction Edge report ({ report_id }) ; sans alerte partie,
-- notified_at reste nul (requête de rattrapage de 20261026050000_social.sql). Limite : celle de
-- public.reports, 10 signalements par 24 h et par compte, tous types confondus (rate_limited). Au 3e
-- signalement de personnes différentes, le commentaire est masqué pour tous sauf son auteur.
-- Renvoie l'id de la ligne de public.reports.
create function public.report_comment(comment_id bigint, reason text) returns bigint
  language plpgsql security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  c public.session_comments;
  cr_id bigint;
  rep_id bigint;
begin
  if report_comment.reason is null
     or report_comment.reason not in ('spam', 'harcelement', 'sexuel', 'violence', 'haine', 'autre') then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;
  select * into c from public.session_comments x where x.id = report_comment.comment_id for update;
  if me is null or c.id is null or c.author_id = me
     or not private.comments_readable(me, c.session_owner, c.session_id)
     or not private.comment_shown(me, c.session_owner, c.author_id, c.masked_at) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.comment_reports r where r.comment_id = c.id and r.reporter_id = me) then return null; end if;
  insert into public.comment_reports (comment_id, reporter_id, author_id, session_owner, session_id, body, reason)
    values (c.id, me, c.author_id, c.session_owner, c.session_id, c.body, report_comment.reason)
    on conflict on constraint comment_reports_once do nothing
    returning id into cr_id;
  if cr_id is null then return null; end if;
  -- File commune (déclencheur de public.reports : 10 par 24 h, pseudo visé, purge à 12 mois)
  insert into public.reports (reporter_id, target_user, kind, target_ref, reason, details)
    values (me, c.author_id, 'session', 'comment_reports:' || cr_id, report_comment.reason, left(c.body, 500))
    returning id into rep_id;
  if c.masked_at is null
     and (select count(distinct r.reporter_id) from public.comment_reports r where r.comment_id = c.id) >= 3 then
    update public.session_comments x set masked_at = now() where x.id = c.id;
  end if;
  return rep_id;
end
$$;

-- Nouveautés de l'activité : comme 20261031200000_reactions_profil.sql, plus les commentaires des
-- autres sur mes séances (visibles, non masqués) plus récents que l'activité vue. Même signature.
create or replace function private.activity_new(uid uuid) returns int
  language sql stable set search_path = '' as
$$
  with seen as (select private.activity_seen(uid) as at)
  select case when not private.social_on(uid) then 0 else (
    (select count(*)::int from seen, public.bravos b
       join public.sessions x on x.user_id = b.session_owner and x.id = b.session_id and x.deleted_at is null
     where b.session_owner = uid and b.updated_at > seen.at and private.can_see(b.user_id, uid))
    + (select count(*)::int from seen, public.follows f
       join public.user_profiles op on op.user_id = f.followee_id and op.social_at is not null
     where f.follower_id = uid and f.status = 'accepted' and f.responded_at > seen.at
       and not private.blocked_between(uid, f.followee_id))
    + (select count(*)::int from seen, public.session_comments c
       join public.sessions x on x.user_id = c.session_owner and x.id = c.session_id and x.deleted_at is null
     where c.session_owner = uid and c.author_id <> uid and c.created_at > seen.at and c.masked_at is null
       and private.can_see(c.author_id, uid))
  ) end
$$;

-- Activité de Mon profil : comme 20261031200000_reactions_profil.sql, plus la sorte comment
-- (commentaire d'un autre sur une de mes séances, visible et non masqué ; is_new comme une réaction)
-- et deux colonnes à la fin : comment_id et comment_text (120 premiers caractères). Clé de départage
-- d'un commentaire : comment:user_id:session_id:comment_id (deux commentaires de la même personne sur
-- la même séance restent distincts) ; les autres sortes gardent kind:user_id:session_id.
-- Le type de retour change : la fonction est supprimée puis recréée, ses droits redonnés en bas.
drop function public.my_activity(timestamptz, text);
create function public.my_activity(before_at timestamptz default null, before_key text default null)
  returns table (kind text, user_id uuid, username text, avatar text, at timestamptz, reaction text,
                 session_id text, session_label text, session_at bigint, is_new boolean,
                 comment_id bigint, comment_text text)
  language plpgsql security definer set search_path = '' as
$$
#variable_conflict use_column
declare
  me uuid := (select auth.uid());
  seen timestamptz;
begin
  if me is null or not private.social_on(me) then return; end if;
  perform private.rate_limit_window(me, 'activity', 120, interval '1 hour');
  seen := private.activity_seen(me);
  return query
    select a.kind, a.uid, p.username, p.avatar_emoji, a.at, a.reaction, a.sid, a.label, a.sat,
      coalesce(a.kind in ('reaction', 'accepted', 'comment') and a.at > seen, false), a.cid, a.ctext
    from (
      select 'reaction'::text as kind, b.user_id as uid, b.updated_at as at, b.kind as reaction, b.session_id as sid,
        case when jsonb_typeof(x.data -> 'label') = 'string' then left(x.data ->> 'label', 60) end as label, x.done_at as sat,
        null::bigint as cid, null::text as ctext,
        'reaction:' || b.user_id::text || ':' || b.session_id as k
      from public.bravos b
      join public.sessions x on x.user_id = b.session_owner and x.id = b.session_id and x.deleted_at is null
      where b.session_owner = me and private.can_see(b.user_id, me)
      union all
      select 'comment', c.author_id, c.created_at, null, c.session_id,
        case when jsonb_typeof(x.data -> 'label') = 'string' then left(x.data ->> 'label', 60) end, x.done_at,
        c.id, left(c.body, 120),
        'comment:' || c.author_id::text || ':' || c.session_id || ':' || c.id::text
      from public.session_comments c
      join public.sessions x on x.user_id = c.session_owner and x.id = c.session_id and x.deleted_at is null
      where c.session_owner = me and c.author_id <> me and c.masked_at is null and private.can_see(c.author_id, me)
      union all
      select 'follower', f.follower_id, f.responded_at, null, null, null, null, null, null,
        'follower:' || f.follower_id::text || ':'
      from public.follows f
      join public.user_profiles op on op.user_id = f.follower_id and op.social_at is not null
      where f.followee_id = me and f.status = 'accepted' and f.responded_at is not null
        and not private.blocked_between(me, f.follower_id)
      union all
      select 'accepted', f.followee_id, f.responded_at, null, null, null, null, null, null,
        'accepted:' || f.followee_id::text || ':'
      from public.follows f
      join public.user_profiles op on op.user_id = f.followee_id and op.social_at is not null
      where f.follower_id = me and f.status = 'accepted' and f.responded_at is not null
        and not private.blocked_between(me, f.followee_id)
      union all
      select 'request', f.follower_id, f.created_at, null, null, null, null, null, null,
        'request:' || f.follower_id::text || ':'
      from public.follows f
      where f.followee_id = me and f.status = 'pending'
        and not private.blocked_between(me, f.follower_id)
    ) a
    left join public.user_profiles p on p.user_id = a.uid
    where my_activity.before_at is null or a.at < my_activity.before_at
       or (my_activity.before_key is not null and a.at = my_activity.before_at
           and a.k collate "C" > my_activity.before_key collate "C")
    order by a.at desc, a.k collate "C"
    limit 50;
end
$$;

-- ── Droits des fonctions ─────────────────────────────────

revoke all on function private.comment_norm(text) from public, anon, authenticated, service_role;
revoke all on function private.comment_squeeze(text) from public, anon, authenticated, service_role;
revoke all on function private.comment_forbidden(text) from public, anon, authenticated, service_role;
revoke all on function private.comment_clean(text) from public, anon, authenticated, service_role;
revoke all on function private.comments_readable(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.comments_writable(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.comment_shown(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.comment_row(public.session_comments, uuid) from public, anon, authenticated, service_role;
revoke all on function private.comment_report_before_insert() from public, anon, authenticated, service_role;
revoke all on function private.activity_new(uuid) from public, anon, authenticated, service_role;

revoke all on function public.list_comments(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.add_comment(uuid, text, text) from public, anon, authenticated;
revoke all on function public.delete_comment(bigint) from public, anon, authenticated;
revoke all on function public.report_comment(bigint, text) from public, anon, authenticated;
revoke all on function public.my_activity(timestamptz, text) from public, anon, authenticated;

grant execute on function public.list_comments(uuid, text, bigint) to authenticated;
grant execute on function public.add_comment(uuid, text, text) to authenticated;
grant execute on function public.delete_comment(bigint) to authenticated;
grant execute on function public.report_comment(bigint, text) to authenticated;
grant execute on function public.my_activity(timestamptz, text) to authenticated;

-- Modération (éditeur SQL, rôle postgres) : signalements des 7 derniers jours, les plus signalés d'abord
--   select r.comment_id, r.author_id, r.body, count(*) as n, array_agg(r.reason) as motifs, max(r.created_at)
--   from public.comment_reports r where r.created_at > now() - interval '7 days'
--   group by 1, 2, 3 order by n desc, max(r.created_at) desc;
-- Ajouter un mot : insert into private.comment_words (word, lang, mode) values ('mot', 'fr', 'word');
-- Accepter un mot courant refusé à tort : insert into private.comment_allowed (phrase) values ('mot');

-- Purge quotidienne des signalements de commentaires de plus de 12 mois (03:23 UTC) avec pg_cron,
-- comme public.reports (20261026050000_social.sql) et chat_reports : sans nouveau signalement, le
-- déclencheur ne passe jamais. Sans l'extension (tests locaux), seule la purge du déclencheur reste.
do $cron$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-comment-reports-12-mois', '23 3 * * *',
      $job$delete from public.comment_reports where created_at < now() - interval '12 months'$job$);
  end if;
end
$cron$;
