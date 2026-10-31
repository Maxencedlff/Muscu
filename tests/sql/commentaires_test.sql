-- Vérifications de supabase/migrations/20261031500000_commentaires.sql (lancées par tests/sql/run.sh) :
-- qui commente et qui lit, nettoyage et longueur, mots interdits, suppression, signalements et
-- masquage, blocages, activité de Mon profil, limites, droits. Chaque bloc échoue (raise) si la règle
-- n'est pas tenue. Comptes à part (…00000000090x, pseudos k…) : indépendant des autres fichiers.
--
-- A kana.k publie ; B kben.k, C kcyr.k et E keve.k sont ses abonnés acceptés ; D kdan.k ne le suit
-- pas ; F kfab.k n'a pas activé le social ; G kgus.k sert aux limites (abonné accepté).

create function pg_temp.err(stmt text) returns text language plpgsql as
$$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end $$;
create function pg_temp.u(c text) returns uuid language sql immutable as
$$ select ('00000000-0000-0000-0000-00000000090' || c)::uuid $$;
create function pg_temp.login(c text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', pg_temp.u(c)::text, false) $$;
grant execute on function pg_temp.err(text), pg_temp.u(text), pg_temp.login(text) to authenticated, anon, service_role;

insert into auth.users (id) select pg_temp.u(c) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', '1']) c;

set role authenticated;
do $$
declare c text; names text[] := array['kana.k', 'kben.k', 'kcyr.k', 'kdan.k', 'keve.k', 'kfab.k', 'kgus.k'];
begin
  foreach c in array array['a', 'b', 'c', 'd', 'e', 'f', '1'] loop
    perform pg_temp.login(c);
    insert into public.user_profiles (username) values (names[array_position(array['a', 'b', 'c', 'd', 'e', 'f', '1'], c)]);
    if c <> 'f' then perform public.social_enable(true); end if;
  end loop;
  perform pg_temp.login('a');
  insert into public.sessions (id, data) values
    ('a-1', '{"date": 1780000000000, "category": "legs", "label": "Legs", "exercises": []}'),
    ('a-2', '{"date": 1780000100000, "category": "push", "label": "Push", "exercises": []}'),
    ('a-hid', '{"date": 1780000200000, "hidden": true, "category": "pull", "exercises": []}'),
    ('a-del', '{"date": 1780000300000, "category": "pull", "exercises": []}');
  update public.sessions set deleted_at = now() where id = 'a-del';
  foreach c in array array['b', 'c', 'e', '1'] loop
    perform pg_temp.login(c); perform public.request_follow(pg_temp.u('a'));
  end loop;
  perform pg_temp.login('a');
  foreach c in array array['b', 'c', 'e', '1'] loop perform public.respond_follow(pg_temp.u(c), true); end loop;
  perform public.mark_activity_seen();
end $$;

-- ── Écrire : qui, où, quoi ───────────────────────────────
do $$
declare j jsonb;
begin
  perform pg_temp.login('b');
  j := public.add_comment(pg_temp.u('a'), 'a-1', '  Belle séance !  ');
  if j ->> 'body' <> 'Belle séance !' or (j ->> 'mine')::boolean is not true or (j ->> 'can_delete')::boolean is not true
     or (j ->> 'masked')::boolean or j ->> 'username' <> 'kben.k' or j ->> 'user_id' <> pg_temp.u('b')::text or j -> 'id' is null
    then raise 'commentaire posé : %', j; end if;
  -- Nettoyage : \r retirés, trois retours à la ligne ou plus → deux
  j := public.add_comment(pg_temp.u('a'), 'a-2', E'Ligne 1\r\n\n\n\n\nLigne 2');
  if j ->> 'body' <> E'Ligne 1\n\nLigne 2' then raise 'nettoyage : %', j ->> 'body'; end if;
  -- Longueur : 500 caractères au plus (en caractères, pas en octets), vide refusé
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', repeat('é', 500)) $q$) <> 'ok' then raise '500 caractères refusés'; end if;
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', repeat('a', 501)) $q$) is distinct from 'too_long' then raise '501 caractères'; end if;
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', E'  \n\t ') $q$) is distinct from 'empty_comment' then raise 'vide'; end if;
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', null) $q$) is distinct from 'empty_comment' then raise 'null'; end if;
  -- Séance masquée, supprimée ou inconnue : not_found
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-hid', 'yo') $q$) is distinct from 'not_found' then raise 'séance masquée'; end if;
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-del', 'yo') $q$) is distinct from 'not_found' then raise 'séance supprimée'; end if;
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'zzz', 'yo') $q$) is distinct from 'not_found' then raise 'séance inconnue'; end if;
  -- Quelqu'un qui ne suit pas : not_found, et il ne lit rien
  perform pg_temp.login('d');
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', 'yo') $q$) is distinct from 'not_found' then raise 'non abonné écrit'; end if;
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-1')) then raise 'non abonné lit'; end if;
  -- Sans social : social_not_enabled
  perform pg_temp.login('f');
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', 'yo') $q$) is distinct from 'social_not_enabled' then raise 'sans social'; end if;
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-1')) then raise 'sans social : lit'; end if;
  -- Le propriétaire répond sur sa séance, pas sur une séance masquée
  perform pg_temp.login('a');
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', 'Merci !') $q$) <> 'ok' then raise 'propriétaire'; end if;
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-hid', 'Note') $q$) is distinct from 'not_found' then raise 'propriétaire : séance masquée'; end if;
  perform pg_temp.login('c');
  perform public.add_comment(pg_temp.u('a'), 'a-1', 'Costaud');
end $$;

-- ── Mots interdits (français et anglais) ─────────────────
do $$
declare t text;
begin
  perform pg_temp.login('e');
  foreach t in array array['Quel connard', 'espèce d''ENCULÉ', 'c o n n a r d', 'f.u.c.k', 'FUUUUCK this', 'sh1t', 'what a b1tch',
                           'putaiiiin', 't''es con', 'les cons', 'sale pédé', 'emmerdeur', 'nique ta mère', 'kys', 'n1gger', 'tue-toi', 'sa lope', 'kill your self',
                           'tuetoi', 'Tue toi', 'salopes', 'gros porc', 'pauvre conne', 'conne', 'faggot', 'nigger du niger', 'you retarded', 'rapist'] loop
    if pg_temp.err(format('select public.add_comment(pg_temp.u(%L), %L, %L)', 'a', 'a-1', t)) is distinct from 'comment_forbidden' then
      raise 'mot interdit accepté : %', t;
    end if;
  end loop;
  -- Mots courants qui contiennent un radical court : acceptés
  foreach t in array array['Technique propre', 'Belle concentration', 'Bon contrôle', 'Conseil : respire', 'Shitake au repas',
                           'Bitesize', 'Classe', 'Assis-toi', 'Dickens', '100 kg x 5', 'Ça déconne pas', 'Tu es tout fort', 'Pas de souci', 'Kill it'] loop
    if pg_temp.err(format('select public.add_comment(pg_temp.u(%L), %L, %L)', 'a', 'a-2', t)) <> 'ok' then
      raise 'mot courant refusé : %', t;
    end if;
  end loop;
end $$;
reset role;
-- Phrases courantes refusées à tort avant (filtre lu directement : add_comment est limité à 30 par
-- heure) : mot français homographe d'un mot anglais (retard), verbe en -tue suivi de « toi », mots
-- voisins recollés (youpi + n…), lettres répétées ramenées à une (cône, fagot), radical dans un mot
do $$
declare t text;
begin
  foreach t in array array['Désolé du retard, grosse séance', 'Je suis en retard sur mon programme', 'J''ai du retard sur mon programme',
                           'Situe-toi par rapport à ton max', 'Effectue toi-même', 'Habitue-toi à la charge, ça viendra', 'Constitue-toi un plan',
                           'Youpi ! Nouveau record', 'Youpi nickel', 'Belle salopette', 'Mets un cône', 'Trois cônes', 'Mon therapist dit repos',
                           'physiotherapist', 'chili con carne', 'Week-end à Pornic', 'Quel nigaud', 'Je suis nigérian', 'Un fagot de bois',
                           'Pain bâtard au petit déj', 'Super retardé ce bus', 'Tapette à mouche', 'Bite-size',
                           -- mots voisins courants qui, recollés, forment un mot interdit (crevé + toi, chat + te, bas + tard)
                           'T''es crevé toi aussi ?', 'Bien joué, crevé toi ?', 'Le chat te regarde', 'Mon chat tes croquettes',
                           'Courir bas tard le soir', 'La cuisine mongole', 'Les steppes mongoles'] loop
    if private.comment_forbidden(t) then raise 'phrase courante refusée : %', t; end if;
  end loop;
  -- Un mot accepté ne protège que lui-même, mot entier
  foreach t in array array['cone de merde', 'conne', 'connne', 'niggers', 'Pornographie',
                           -- hors recollage, le mot reste refusé écrit d'un bloc ou lettre à lettre
                           'crevetoi', 'CRÈVETOI', 'c r e v e t o i', 'sale chatte', 'you bastard', 'b a s t a r d', 'mongol'] loop
    if not private.comment_forbidden(t) then raise 'mot interdit accepté : %', t; end if;
  end loop;
end $$;
-- Liste tenue côté serveur : un mot ajouté (éditeur SQL) est refusé tout de suite, sans migration
insert into private.comment_words (word, lang, mode) values ('motinterdit', 'fr', 'word');
set role authenticated;
do $$ begin
  perform pg_temp.login('e');
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', 'un motinterdit ici') $q$) is distinct from 'comment_forbidden' then raise 'mot ajouté'; end if;
end $$;
reset role;
delete from private.comment_words where word = 'motinterdit';
-- Tous les commentaires de E sur a-2 (mots courants) : retirés pour la suite
delete from public.session_comments where author_id = '00000000-0000-0000-0000-00000000090e';
set role authenticated;

-- ── Lire ─────────────────────────────────────────────────
do $$
declare r record; n int;
begin
  perform pg_temp.login('b');
  -- Du plus récent au plus ancien : C, A, le 500 « é », B
  if (select array_agg(username order by id desc) from public.list_comments(pg_temp.u('a'), 'a-1'))
     is distinct from array['kcyr.k', 'kana.k', 'kben.k', 'kben.k'] then raise 'ordre : %', (select array_agg(username) from public.list_comments(pg_temp.u('a'), 'a-1')); end if;
  -- Mes droits : supprimer le mien seulement
  for r in select * from public.list_comments(pg_temp.u('a'), 'a-1') loop
    if r.can_delete is distinct from (r.user_id = pg_temp.u('b')) or r.mine is distinct from (r.user_id = pg_temp.u('b')) or r.masked then
      raise 'droits de B : %', r; end if;
  end loop;
  -- Le propriétaire peut tout supprimer
  perform pg_temp.login('a');
  select count(*) into n from public.list_comments(pg_temp.u('a'), 'a-1') where can_delete;
  if n <> 4 then raise 'propriétaire : % supprimables', n; end if;
  -- Il lit aussi sa séance masquée (vide ici), jamais une séance supprimée
  if pg_temp.err($q$ select * from public.list_comments(pg_temp.u('a'), 'a-hid') $q$) <> 'ok' then raise 'masquée : lecture'; end if;
end $$;
-- Pagination : 30 par page, before_id = id du dernier reçu
reset role;
insert into public.session_comments (session_owner, session_id, author_id, body)
  select '00000000-0000-0000-0000-00000000090a', 'a-2', '00000000-0000-0000-0000-00000000090a', 'page ' || i from generate_series(1, 35) i;
set role authenticated;
do $$
declare last bigint; n int;
begin
  perform pg_temp.login('b');
  select count(*), min(id) into n, last from public.list_comments(pg_temp.u('a'), 'a-2');
  if n <> 30 then raise 'page 1 : %', n; end if;
  select count(*) into n from public.list_comments(pg_temp.u('a'), 'a-2', last);
  -- 35 de A + « Ligne 1 » de B
  if n <> 6 then raise 'page 2 : % au lieu de 6', n; end if;
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-2', last) where id >= last) then raise 'page 2 : doublon'; end if;
end $$;

-- ── Activité de Mon profil ───────────────────────────────
do $$
declare r record; n int;
begin
  perform pg_temp.login('a');
  -- Commentaires de B (2 sur a-1, 1 sur a-2) et de C (1) ; jamais les miens
  select count(*) into n from public.my_activity() where kind = 'comment';
  if n <> 4 then raise 'activité : % commentaires', n; end if;
  if exists (select 1 from public.my_activity() where kind = 'comment' and user_id = pg_temp.u('a')) then raise 'activité : le mien'; end if;
  select * into r from public.my_activity() where kind = 'comment' and user_id = pg_temp.u('c');
  if r.session_id <> 'a-1' or r.session_label <> 'Legs' or r.comment_text <> 'Costaud' or not r.is_new or r.comment_id is null then raise 'ligne : %', r; end if;
  if (public.social_state() ->> 'activity_new')::int <> 4 then raise 'pastille : %', public.social_state() ->> 'activity_new'; end if;
  -- Texte coupé à 120 caractères
  if exists (select 1 from public.my_activity() where kind = 'comment' and char_length(comment_text) > 120) then raise 'texte non coupé'; end if;
  perform public.mark_activity_seen();
end $$;
do $$ begin
  perform pg_temp.login('a');
  if (public.social_state() ->> 'activity_new')::int <> 0 then raise 'vue : pastille'; end if;
  if exists (select 1 from public.my_activity() where is_new) then raise 'vue : encore nouveau'; end if;
end $$;
-- Pagination de l'activité : deux commentaires à la même date ne sont ni perdus ni doublés
reset role;
update public.session_comments set created_at = '2026-10-31 12:00:00+00' where author_id = '00000000-0000-0000-0000-00000000090b';
set role authenticated;
do $$
declare r record; seen text[] := '{}'; k text; at timestamptz; n int := 0;
begin
  perform pg_temp.login('a');
  -- Page de 50 : on reprend après chaque ligne, une à la fois, avec la clé de départage de l'app
  for r in select * from public.my_activity() where kind = 'comment' and user_id = pg_temp.u('b') loop n := n + 1; end loop;
  if n <> 3 then raise 'activité B : %', n; end if;
  select a.at, 'comment:' || a.user_id || ':' || a.session_id || ':' || a.comment_id into at, k
    from public.my_activity() a where a.kind = 'comment' and a.user_id = pg_temp.u('b') order by a.at desc, ('comment:' || a.user_id || ':' || a.session_id || ':' || a.comment_id) collate "C" limit 1;
  select count(*) into n from public.my_activity(at, k) where kind = 'comment' and user_id = pg_temp.u('b');
  if n <> 2 then raise 'curseur à date égale : % au lieu de 2', n; end if;
end $$;

-- ── Blocage et abonnement retiré ─────────────────────────
do $$
declare n int;
begin
  -- C bloque B : chacun ne voit plus les commentaires de l'autre ; A voit tout
  perform pg_temp.login('c');
  perform public.block_user(pg_temp.u('b'));
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-1') where user_id = pg_temp.u('b')) then raise 'C voit B'; end if;
  perform pg_temp.login('b');
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-1') where user_id = pg_temp.u('c')) then raise 'B voit C'; end if;
  perform pg_temp.login('a');
  select count(*) into n from public.list_comments(pg_temp.u('a'), 'a-1');
  if n <> 4 then raise 'A : %', n; end if;
  perform pg_temp.login('c');
  perform public.unblock_user(pg_temp.u('b'));
  -- A retire C : ses commentaires disparaissent pour tous et de l'activité ; il ne lit plus rien
  perform pg_temp.login('a');
  perform public.remove_follower(pg_temp.u('c'));
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-1') where user_id = pg_temp.u('c')) then raise 'abonné retiré : visible'; end if;
  if exists (select 1 from public.my_activity() where kind = 'comment' and user_id = pg_temp.u('c')) then raise 'abonné retiré : activité'; end if;
  perform pg_temp.login('c');
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-1')) then raise 'abonné retiré : lit'; end if;
  -- De nouveau accepté : sa ligne revient
  perform public.request_follow(pg_temp.u('a'));
  perform pg_temp.login('a');
  perform public.respond_follow(pg_temp.u('c'), true);
  if not exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-1') where user_id = pg_temp.u('c')) then raise 'réaccepté : absent'; end if;
  -- A bloque C : plus rien de C, ni chez A ni chez les autres
  perform public.block_user(pg_temp.u('c'));
  perform pg_temp.login('b');
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-1') where user_id = pg_temp.u('c')) then raise 'bloqué par A : visible'; end if;
  perform pg_temp.login('c');
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', 'yo') $q$) is distinct from 'not_found' then raise 'bloqué : écrit'; end if;
  perform pg_temp.login('a');
  perform public.unblock_user(pg_temp.u('c'));
  perform pg_temp.login('c');
  perform public.request_follow(pg_temp.u('a'));
  perform pg_temp.login('a');
  perform public.respond_follow(pg_temp.u('c'), true);
  -- Social du propriétaire désactivé : plus personne ne lit
  perform public.social_disable();
  perform pg_temp.login('b');
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-1')) then raise 'social du propriétaire éteint'; end if;
  perform pg_temp.login('a');
  perform public.social_enable(true);
end $$;

-- ── Supprimer ────────────────────────────────────────────
do $$
declare mine bigint; other bigint; own bigint;
begin
  perform pg_temp.login('b');
  select id into mine from public.list_comments(pg_temp.u('a'), 'a-1') where user_id = pg_temp.u('b') order by id limit 1;
  select id into own from public.list_comments(pg_temp.u('a'), 'a-1') where user_id = pg_temp.u('a') limit 1;
  -- Celui d'un autre : refusé sans rien révéler ; inconnu : pareil
  if public.delete_comment(own) then raise 'B supprime celui de A'; end if;
  if public.delete_comment(-1) then raise 'inconnu'; end if;
  if not public.delete_comment(mine) then raise 'B ne supprime pas le sien'; end if;
  -- Le propriétaire supprime celui d'un autre sur sa séance
  other := (public.add_comment(pg_temp.u('a'), 'a-2', 'À supprimer par A') ->> 'id')::bigint;
  perform pg_temp.login('a');
  if not public.delete_comment(other) then raise 'propriétaire'; end if;
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-2') where id = other) then raise 'encore là'; end if;
end $$;

-- ── Signaler, masquer au 3e ──────────────────────────────
do $$
declare cid bigint; r record; rid bigint;
begin
  perform pg_temp.login('c');
  cid := (public.add_comment(pg_temp.u('a'), 'a-2', 'Commentaire limite') ->> 'id')::bigint;
  if pg_temp.err(format('select public.report_comment(%s, %L)', cid, 'spam')) is distinct from 'not_found' then raise 'le sien'; end if;
  perform pg_temp.login('b');
  if pg_temp.err(format('select public.report_comment(%s, %L)', cid, 'insulte')) is distinct from 'invalid_reason' then raise 'motif inconnu'; end if;
  if pg_temp.err(format('select public.report_comment(%s, null)', cid)) is distinct from 'invalid_reason' then raise 'motif nul'; end if;
  if pg_temp.err('select public.report_comment(-1, ''spam'')') is distinct from 'not_found' then raise 'inconnu'; end if;
  rid := public.report_comment(cid, 'harcelement');
  if rid is null then raise 'signalement : id de public.reports attendu'; end if;
  -- deux fois la même personne : un seul compte, aucune nouvelle alerte
  if public.report_comment(cid, 'harcelement') is not null then raise 'deuxième signalement : nouvelle ligne'; end if;
  perform pg_temp.login('d');
  if pg_temp.err(format('select public.report_comment(%s, %L)', cid, 'spam')) is distinct from 'not_found' then raise 'non abonné signale'; end if;
  perform pg_temp.login('e');
  perform public.report_comment(cid, 'haine');
  perform pg_temp.login('b');
  if not exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-2') where id = cid) then raise 'masqué trop tôt'; end if;
  -- 3e personne (le propriétaire) : masqué pour tous sauf l'auteur
  perform pg_temp.login('a');
  perform public.report_comment(cid, 'autre');
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-2') where id = cid) then raise 'A voit le masqué'; end if;
  if exists (select 1 from public.my_activity() where comment_id = cid) then raise 'activité : masqué'; end if;
  perform pg_temp.login('b');
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-2') where id = cid) then raise 'B voit le masqué'; end if;
  perform pg_temp.login('c');
  select * into r from public.list_comments(pg_temp.u('a'), 'a-2') where id = cid;
  if r.id is null or not r.masked then raise 'auteur : %', r; end if;
  -- Supprimé par son auteur : le signalement reste, avec la copie du texte
  if not public.delete_comment(cid) then raise 'auteur supprime'; end if;
end $$;
reset role;
do $$
declare r record;
begin
  if (select count(*) from public.comment_reports where body = 'Commentaire limite' and comment_id is null) <> 3 then raise 'preuve perdue'; end if;
  -- Chaque signalement de commentaire entre dans la file commune (alerte par e-mail de la fonction Edge
  -- report, rattrapage des notified_at nuls) : auteur visé, pseudo, texte copié, référence de la copie
  if (select count(*) from public.reports q where q.target_ref like 'comment_reports:%'
        and q.details = 'Commentaire limite') <> 3 then raise 'file de modération : % lignes',
     (select count(*) from public.reports q where q.target_ref like 'comment_reports:%'); end if;
  for r in select x.*, cr.reporter_id as cr_by, cr.reason as cr_reason from public.reports x
           join public.comment_reports cr on x.target_ref = 'comment_reports:' || cr.id where x.details = 'Commentaire limite' loop
    if r.kind <> 'session' or r.target_user <> pg_temp.u('c') or r.target_username <> 'kcyr.k' or r.notified_at is not null
       or r.reporter_id <> r.cr_by or r.reason <> r.cr_reason then raise 'ligne de file : %', r; end if;
  end loop;
  if (select count(distinct reason) from public.comment_reports where body = 'Commentaire limite') <> 3 then raise 'motifs'; end if;
end $$;
-- Signalements de plus de 12 mois purgés au signalement suivant
update public.comment_reports set created_at = now() - interval '13 months' where body = 'Commentaire limite';
set role authenticated;
do $$
declare cid bigint;
begin
  perform pg_temp.login('e');
  cid := (public.add_comment(pg_temp.u('a'), 'a-1', 'Encore un') ->> 'id')::bigint;
  perform pg_temp.login('b');
  perform public.report_comment(cid, 'spam');
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.comment_reports where body = 'Commentaire limite') then raise 'purge des 12 mois'; end if;
end $$;

-- ── Limites ──────────────────────────────────────────────
delete from private.social_rate where user_id::text like '00000000-0000-0000-0000-00000000090_';
set role authenticated;
do $$
declare i int; ids bigint[];
begin
  perform pg_temp.login('1');
  for i in 1..30 loop perform public.add_comment(pg_temp.u('a'), 'a-1', 'Bravo ' || i); end loop;
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', 'Un de plus') $q$) is distinct from 'rate_limited' then raise '31e par heure'; end if;
  -- Supprimer n'est jamais limité
  select array_agg(id) into ids from public.list_comments(pg_temp.u('a'), 'a-1') where mine;
  for i in 1..array_length(ids, 1) loop perform public.delete_comment(ids[i]); end loop;
  -- Signalements : ceux de public.reports, 10 par 24 h tous types confondus (les commentaires de A sur a-2)
  select array_agg(id) into ids from (select id from public.list_comments(pg_temp.u('a'), 'a-2') where user_id = pg_temp.u('a') limit 11) t;
  for i in 1..10 loop perform public.report_comment(ids[i], 'spam'); end loop;
  if pg_temp.err(format('select public.report_comment(%s, %L)', ids[11], 'spam')) is distinct from 'rate_limited' then raise '11e signalement'; end if;
  -- Refusé : rien de gardé (ni copie, ni compte pour le masquage)
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-2') where id = ids[11] and masked) then raise '11e : masqué'; end if;
end $$;
reset role;
-- 150 par 24 h : la fenêtre d'une heure remise à zéro
delete from private.social_rate where user_id = '00000000-0000-0000-0000-000000000901' and action = 'comment_h';
update private.social_rate set at = now() - interval '2 hours' where user_id = '00000000-0000-0000-0000-000000000901' and action = 'comment';
insert into private.social_rate (user_id, action, at)
  select '00000000-0000-0000-0000-000000000901', 'comment', now() - interval '2 hours' from generate_series(1, 120);
set role authenticated;
do $$ begin
  perform pg_temp.login('1');
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', 'Le 151e') $q$) is distinct from 'rate_limited' then raise '151e par jour'; end if;
end $$;
-- Lectures : 600 par heure
do $$
declare i int;
begin
  perform pg_temp.login('e');
  for i in 1..600 loop perform public.list_comments(pg_temp.u('a'), 'a-1'); end loop;
  if pg_temp.err($q$ select * from public.list_comments(pg_temp.u('a'), 'a-1') $q$) is distinct from 'rate_limited' then raise 'lecture sans limite'; end if;
end $$;
reset role;

-- ── Tables fermées, anonyme sans rien ────────────────────
set role authenticated;
do $$ begin
  perform pg_temp.login('a');
  if pg_temp.err('select * from public.session_comments') not like 'permission denied%' then raise 'session_comments lisible'; end if;
  if pg_temp.err('select * from public.comment_reports') not like 'permission denied%' then raise 'comment_reports lisible'; end if;
  if pg_temp.err($q$ insert into public.session_comments (session_owner, session_id, author_id, body) values (pg_temp.u('a'), 'a-1', pg_temp.u('a'), 'x') $q$) not like 'permission denied%' then raise 'écriture directe'; end if;
  if pg_temp.err('select * from private.comment_words') not like 'permission denied%' then raise 'mots lisibles'; end if;
  if pg_temp.err($q$ select private.comment_forbidden('x') $q$) not like 'permission denied%' then raise 'fonction privée'; end if;
end $$;
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $$
declare f text;
begin
  foreach f in array array[
    '* from public.list_comments(pg_temp.u(''a''), ''a-1'')', 'public.add_comment(pg_temp.u(''a''), ''a-1'', ''yo'')',
    'public.delete_comment(1)', 'public.report_comment(1, ''spam'')', '* from public.my_activity()'] loop
    if pg_temp.err('select ' || f) not like 'permission denied%' then raise 'anon : %', f; end if;
  end loop;
  if pg_temp.err('select * from public.session_comments') not like 'permission denied%' then raise 'anon : table'; end if;
end $$;
reset role;

-- ── Droits déclarés ──────────────────────────────────────
do $$
declare f regprocedure; t text;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('list_comments', 'add_comment', 'delete_comment', 'report_comment', 'my_activity') loop
    if not has_function_privilege('authenticated', f, 'execute') then raise '% : authenticated sans droit', f; end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('public', f, 'execute') then raise '% : anon ou public a le droit', f; end if;
    if not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = f) then raise '% : security definer et search_path vide', f; end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('list_comments', 'add_comment', 'delete_comment', 'report_comment', 'my_activity')) <> 5 then raise 'fonctions manquantes ou en double'; end if;
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'private'::regnamespace
             and p.proname in ('comment_norm', 'comment_squeeze', 'comment_forbidden', 'comment_clean', 'comments_readable',
                               'comments_writable', 'comment_shown', 'comment_row', 'comment_report_before_insert', 'activity_new') loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute') then raise '% : exécutable depuis l''API', f; end if;
  end loop;
  foreach t in array array['public.session_comments', 'public.comment_reports', 'private.comment_words', 'private.comment_allowed'] loop
    if has_table_privilege('authenticated', t, 'select') or has_table_privilege('anon', t, 'select')
       or has_table_privilege('authenticated', t, 'insert') or has_table_privilege('service_role', t, 'select') then raise '% : GRANT', t; end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = t::regclass) then raise '% : RLS', t; end if;
  end loop;
end $$;

-- ── Séance et compte supprimés : tout part avec ──────────
update public.sessions set deleted_at = now() where user_id = '00000000-0000-0000-0000-00000000090a' and id = 'a-1';
delete from private.social_rate where user_id::text like '00000000-0000-0000-0000-00000000090_';
set role authenticated;
do $$ begin
  perform pg_temp.login('c');
  if exists (select 1 from public.list_comments(pg_temp.u('a'), 'a-1')) then raise 'séance supprimée : lisible'; end if;
  if pg_temp.err($q$ select public.add_comment(pg_temp.u('a'), 'a-1', 'yo') $q$) is distinct from 'not_found' then raise 'séance supprimée : écrite'; end if;
  perform pg_temp.login('a');
  if exists (select 1 from public.my_activity() where kind = 'comment' and session_id = 'a-1') then raise 'séance supprimée : activité'; end if;
end $$;
reset role;
do $$ begin
  delete from auth.users where id = pg_temp.u('b');
  if exists (select 1 from public.session_comments where author_id = pg_temp.u('b')) then raise 'cascade auteur'; end if;
  if exists (select 1 from public.comment_reports where reporter_id = pg_temp.u('b')) then raise 'cascade signalements'; end if;
  delete from auth.users where id = pg_temp.u('a');
  if exists (select 1 from public.session_comments where session_owner = pg_temp.u('a')) then raise 'cascade propriétaire'; end if;
  delete from auth.users where id::text like '00000000-0000-0000-0000-00000000090_';
end $$;
