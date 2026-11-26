-- Vérifications de supabase/migrations/20261129010000_seance_publique_blocs.sql (lancées par tests/sql/run.sh) :
-- rôle et rang d'un bloc passent en liste blanche ; une séance sans eux sort comme avant.
do $$
declare s jsonb; x jsonb;
begin
  s := private.session_public($j${"date": 1, "category": "legs", "exercises": [
    {"name": "Extension quadriceps", "exId": "secret", "occ": 2, "role": "prefat", "sets": [{"weight": "20", "reps": "15", "warmup": true}]},
    {"name": "Extension quadriceps", "sets": [{"weight": "60", "reps": "10"}]},
    {"name": "A", "occ": 1, "role": "fun", "sets": []},
    {"name": "B", "occ": "3", "role": 7, "sets": []},
    {"name": "C", "occ": 21, "role": "warmup", "sets": []},
    {"name": "D", "occ": 2.5, "sets": []}]}$j$::jsonb);
  x := s -> 'exercises';
  if x -> 0 ->> 'role' is distinct from 'prefat' or x -> 0 -> 'occ' is distinct from '2'::jsonb then raise 'rôle et rang du bloc absents : %', x -> 0; end if;
  if (x -> 0) ? 'exId' then raise 'exId transmis'; end if;
  if x -> 0 -> 'sets' -> 0 is distinct from '{"weight": "20", "reps": "15", "warmup": true}'::jsonb then raise 'séries changées : %', x -> 0; end if;
  if (x -> 1) ? 'role' or (x -> 1) ? 'occ' then raise 'bloc normal : clé ajoutée'; end if;
  if (x -> 2) ? 'role' or (x -> 2) ? 'occ' then raise 'rang 1 ou rôle inconnu gardé : %', x -> 2; end if;
  if (x -> 3) ? 'role' or (x -> 3) ? 'occ' then raise 'types illisibles gardés : %', x -> 3; end if;
  if (x -> 4) ? 'occ' or x -> 4 ->> 'role' is distinct from 'warmup' then raise 'rang 21 gardé ou échauffement perdu : %', x -> 4; end if;
  if (x -> 5) ? 'occ' then raise 'rang décimal gardé'; end if;
  s := private.session_public('{"date": 2, "category": "push", "exercises": [{"name": "Développé", "sets": [{"weight": "80", "reps": "8"}]}]}');
  if s -> 'exercises' -> 0 is distinct from '{"name": "Développé", "sets": [{"weight": "80", "reps": "8"}]}'::jsonb then raise 'ancienne séance changée : %', s; end if;
end $$;
