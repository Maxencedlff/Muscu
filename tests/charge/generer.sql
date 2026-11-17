-- Jeu de données de charge côté coach (tests/charge/serveur.sh). Postgres local jetable UNIQUEMENT :
-- jamais sur le projet Supabase. Trois coachs « illimités » (coachmax) suivent 50, 150 et 300 élèves ;
-- chaque élève a un an d'historique réaliste : ~150 séances (6 à 8 exercices, 3 à 5 séries, notes,
-- records), pesées, mensurations, 200 à 400 messages, programmes envoyés, commentaires du coach,
-- phases de planification. Déterministe (setseed) : mêmes volumes à chaque lancement.
\set ON_ERROR_STOP 1
select setseed(0.2026);

create temp table gen_coach (coach_id uuid primary key, n int, name text);
insert into gen_coach values
  ('c0000000-0000-4000-8000-000000000050', 50,  'coach50'),
  ('c0000000-0000-4000-8000-000000000150', 150, 'coach150'),
  ('c0000000-0000-4000-8000-000000000300', 300, 'coach300');

create temp table gen_student as
  select g.coach_id, g.name as coach_name, i,
         md5(g.name || '-' || i)::uuid as student_id,
         left(g.name || 'e' || i, 20) as username
  from gen_coach g, generate_series(1, g.n) i;

-- ── Comptes ──────────────────────────────────────────────
insert into auth.users (id, email)
  select coach_id, name || '@exemple.test' from gen_coach
  union all select student_id, username || '@exemple.test' from gen_student;
insert into public.user_profiles (user_id, username, coach_at, social_at)
  select coach_id, name, now() - interval '400 days', now() - interval '400 days' from gen_coach
  union all select student_id, username, null, case when i % 3 = 0 then now() - interval '300 days' end from gen_student;
-- Abonnement coach illimité (coachmax annuel) en cours
insert into public.entitlement_claims (original_transaction_id, user_id, product_id, kind, expires_at)
  select 'charge-' || name, coach_id, 'com.mdlf.training.coachmax.yearly', 'sub', now() + interval '200 days' from gen_coach;

-- Liens : élèves arrivés au fil de l'année (le plus récent il y a 2 jours), coach passé il y a 0 à 10 jours
insert into public.coach_links (student_id, coach_id, created_at, coach_seen_at)
  select student_id, coach_id, now() - interval '380 days' + (i * interval '1 hour'),
         now() - (random() * interval '10 days')
  from gen_student;

-- ── Séances : ~150 par élève sur un an ───────────────────
-- Un élève sur 10 a décroché (dernière séance il y a 3 à 6 semaines) : cadran « qui décroche »
create temp table gen_ex (k int primary key, name text, base numeric);
insert into gen_ex values
  (1, 'Développé couché haltères', 24), (2, 'Développé incliné haltères', 20), (3, 'Écarté haltères plat', 10),
  (4, 'Développé militaire haltères', 16), (5, 'Élévations latérales', 7), (6, 'Extension triceps poulie', 22.5),
  (7, 'Rowing haltère unilatéral', 26), (8, 'Tirage vertical prise large', 50), (9, 'Tirage horizontal câble', 45),
  (10, 'Curl biceps haltères', 11), (11, 'Curl marteau', 12), (12, 'Squat barre', 65), (13, 'Presse à cuisses', 130),
  (14, 'Fentes marchées haltères', 14), (15, 'Leg curl machine', 32.5), (16, 'Extension quadriceps', 40),
  (17, 'Mollets debout', 0), (18, 'Face pull', 15), (19, 'Dips', 0), (20, 'Crunch câble', 25);

create temp table gen_session as
  select s.student_id, s.coach_id, k,
         ((extract(epoch from now()) * 1000)::bigint
           - (case when s.i % 10 = 0 then 25 else 0 end) * 86400000::bigint   -- décrocheurs
           - ((k - 1) * 365 * 86400000::bigint / 150)
           - (random() * 20 * 3600000)::bigint) as at,
         (k % 3) as cat
  from gen_student s, generate_series(1, 150) k;

insert into public.sessions (user_id, id, data)
  select gs.student_id, 'h' || lpad(gs.k::text, 4, '0'),
    jsonb_strip_nulls(jsonb_build_object(
      'id', 'h' || lpad(gs.k::text, 4, '0'),
      'date', gs.at,
      'duration', (45 + (random() * 35)::int) * 60000,
      'programme', 'ppl',
      'category', (array['push', 'pull', 'legs'])[gs.cat + 1],
      'label', (array['Push', 'Pull', 'Legs'])[gs.cat + 1],
      'notes', case when random() < 0.2 then (array['Grosse forme aujourd''hui', 'Épaule droite un peu sensible, charges prudentes',
                     'Salle bondée, repos raccourcis', 'Nouveau record au squat !', 'Mal dormi, séance moyenne',
                     'Bonne séance, focus sur la technique'])[1 + (random() * 5)::int] end,
      'records', case when random() < 0.3 then jsonb_build_array(jsonb_build_object(
                     'ex', 'Squat barre', 'kind', 'charge', 'before', 60 + (gs.k % 20), 'after', 62.5 + (gs.k % 20))) end,
      'exercises', (
        select jsonb_agg(jsonb_build_object(
          'exId', 'x' || ex.k, 'name', ex.name,
          'sets', (select jsonb_agg(jsonb_build_object(
                      'weight', case when ex.base = 0 then '' else (ex.base + (150 - gs.k) / 10)::text end,
                      'reps', (6 + (random() * 6)::int)::text,
                      'rir', case when random() < 0.3 then to_jsonb((random() * 3)::int) end)
                    order by n)
                   from generate_series(1, 3 + ((gs.k + e) % 3)) n))
          order by e)
        from generate_series(1, 6 + (gs.k % 3)) e
        join gen_ex ex on ex.k = 1 + ((gs.cat * 7 + e + gs.k) % 20))
    ))
  from gen_session gs;

-- ── Partages : poids (3 pesées par semaine) et mensurations (10 mesures, 1 par mois) ──
insert into public.coach_shares (student_id, coach_id, kind, granted_at)
  select student_id, coach_id, kd, now() - interval '370 days' from gen_student, unnest(array['weight', 'measures']) kd;
insert into public.coach_shared_weights (student_id, at, kg)
  select student_id, (extract(epoch from now()) * 1000)::bigint - d * 86400000::bigint * 7 / 3,
         round((70 + (i % 20) + sin(d / 20.0) * 2)::numeric, 2)
  from gen_student, generate_series(0, 155) d;
insert into public.coach_shared_measures (student_id, part, at, cm)
  select student_id, p, (extract(epoch from now()) * 1000)::bigint - m * 30 * 86400000::bigint,
         round((30 + (i % 15) + m * 0.1)::numeric, 1)
  from gen_student, unnest(array['chest', 'waist', 'hips', 'shoulders', 'neck', 'armL', 'armR', 'thighL', 'thighR', 'calf']) p,
       generate_series(0, 11) m;

-- ── Messages : 200 à 400 par élève, dans l'ordre chronologique ──
insert into public.coach_messages (student_id, coach_id, from_coach, body, created_at)
  select student_id, coach_id, random() < 0.5,
         (array['Salut coach, séance faite !', 'Top, on monte de 2,5 kg la semaine prochaine.',
                'J''ai eu mal au genou sur les fentes, je remplace par quoi ?', 'Fais de la presse à la place, amplitude contrôlée.',
                'Ok merci 🙏', 'Pense à m''envoyer tes mensurations dimanche.'])[1 + (random() * 5)::int],
         now() - interval '360 days' + (m * interval '360 days' / cnt)
  from (select student_id, coach_id, 200 + (i * 37 % 201) as cnt from gen_student) s,
       generate_series(1, s.cnt) m
  order by 5;
update public.coach_links l set chat_coach_read = coalesce((
  select max(m.id) from public.coach_messages m where m.student_id = l.student_id and m.coach_id = l.coach_id
    and m.created_at < now() - interval '2 days'), 0)
  where l.coach_id in (select coach_id from gen_coach);

-- ── Programmes envoyés (8 par élève, ~6 Ko chacun) et commentaires de séance (1 séance sur 4) ──
insert into public.coach_programmes (student_id, coach_id, id, data, sent_at, seen_at)
  select s.student_id, s.coach_id, 'cp' || p,
         jsonb_build_object('name', 'Bloc ' || p, 'sessions', (
           select jsonb_object_agg('s' || j, jsonb_build_object('label', 'Séance ' || j, 'exercises', (
             select jsonb_agg(jsonb_build_object('name', ex.name, 'sets', 4, 'repMax', 12, 'rest', 120, 'note', 'Contrôle la descente'))
             from gen_ex ex where ex.k <= 8)))
           from generate_series(1, 4) j)),
         now() - (p * interval '45 days'), case when p > 1 then now() - (p * interval '44 days') end
  from gen_student s, generate_series(1, 8) p;
insert into public.coach_notes (student_id, coach_id, session_id, text, updated_at, seen_at)
  select gs.student_id, gs.coach_id, 'h' || lpad(gs.k::text, 4, '0'), 'Bien joué, garde ce tempo sur le squat.',
         now(), case when gs.k > 3 then now() end
  from gen_session gs where gs.k % 4 = 0;
insert into public.session_comments (session_owner, session_id, author_id, body, created_at)
  select gs.student_id, 'h' || lpad(gs.k::text, 4, '0'), gs.coach_id, 'Belle séance 💪', now() - (gs.k * interval '2 days')
  from gen_session gs where gs.k % 10 = 0;

-- ── Planification : 5 phases de 8 semaines par élève ──
insert into public.coach_phases (student_id, coach_id, goal, start_on, weeks, note)
  select student_id, coach_id, (array['bulk', 'cut', 'mini_cut', 'maintain', 'strength'])[p],
         current_date - 280 + (p - 1) * 56, 8, 'Phase ' || p
  from gen_student, generate_series(1, 5) p;

-- ── Notifications : le coach veut « séance d'élève », un appareil enregistré ──
insert into public.push_prefs (user_id, coach, messages, student_sessions)
  select coach_id, true, true, true from gen_coach;
insert into public.push_devices (token, user_id, env)
  select repeat(substr(md5(name), 1, 16), 4), coach_id, 'production' from gen_coach;

-- Bruit de fond : 2 000 autres comptes, 60 séances chacun (les grosses tables ne sont pas que les nôtres)
insert into auth.users (id, email)
  select md5('autre-' || i)::uuid, 'autre' || i || '@exemple.test' from generate_series(1, 2000) i;
insert into public.sessions (user_id, id, data)
  select md5('autre-' || i)::uuid, 'h' || k,
         jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint - k * 86400000::bigint * 3, 'label', 'Push',
                            'exercises', jsonb_build_array(jsonb_build_object('name', 'Squat barre',
                              'sets', jsonb_build_array(jsonb_build_object('weight', '60', 'reps', '8')))))
  from generate_series(1, 2000) i, generate_series(1, 60) k;

analyze;
select 'élèves' as quoi, count(*) from public.coach_links
union all select 'séances', count(*) from public.sessions
union all select 'messages', count(*) from public.coach_messages
union all select 'pesées', count(*) from public.coach_shared_weights
union all select 'mensurations', count(*) from public.coach_shared_measures
union all select 'programmes', count(*) from public.coach_programmes
union all select 'commentaires coach', count(*) from public.coach_notes
union all select 'Mo séances', (pg_total_relation_size('public.sessions') / 1048576)::bigint;
