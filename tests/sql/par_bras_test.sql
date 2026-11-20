-- Vérifications de supabase/migrations/20261120010000_seance_publique_par_bras.sql (lancées par tests/sql/run.sh) :
-- le second côté d'une série notée par bras et le premier bras passent, bornés ; une séance sans eux sort comme avant.
-- Appels directs de private.session_public (super-utilisateur) : le fil et le coach l'appellent tels quels.
do $$
declare s jsonb; st jsonb;
begin
  -- Séries : 0 second côté simple (clé inconnue retirée) ; 1 drop set des deux côtés ; 2 sous-séries du second côté sans
  -- technique (retirées) ; 3 à 5 bornes (charge aberrante, reps à 0, pas un objet) ; 6 échauffement (jamais)
  s := private.session_public($j${"date": 1, "category": "pull", "exercises": [
    {"name": "Curl concentration", "sideFirst": "droit", "sets": [
      {"weight": "14", "reps": "10", "side2": {"weight": "14", "reps": "9", "secret": "fuite"}},
      {"weight": "14", "reps": "8", "tech": "drop", "sub": [{"weight": "10", "reps": "6"}],
       "side2": {"weight": "14", "reps": "8", "sub": [{"weight": "10", "reps": "5"}]}},
      {"weight": "14", "reps": "8", "side2": {"weight": "14", "reps": "8", "sub": [{"weight": "9", "reps": "9"}]}},
      {"weight": "14", "reps": "8", "side2": {"weight": "1e9", "reps": "8"}},
      {"weight": "14", "reps": "8", "side2": {"weight": "14", "reps": "0"}},
      {"weight": "14", "reps": "8", "side2": "x"},
      {"weight": "6", "reps": "12", "warmup": true, "side2": {"weight": "6", "reps": "12"}}]},
    {"name": "Autre", "sideFirst": "gauche", "sets": []}]}$j$::jsonb);
  st := s -> 'exercises' -> 0 -> 'sets';
  if s -> 'exercises' -> 0 ->> 'sideFirst' is distinct from 'droit' then raise 'premier bras droit absent : %', s; end if;
  if (s -> 'exercises' -> 1) ? 'sideFirst' then raise 'premier bras inconnu gardé'; end if;
  if st -> 0 -> 'side2' is distinct from '{"weight": "14", "reps": "9"}'::jsonb then raise 'second côté simple : %', st -> 0; end if;
  if st -> 1 -> 'side2' is distinct from '{"weight": "14", "reps": "8", "sub": [{"weight": "10", "reps": "5"}]}'::jsonb then raise 'drop du bras droit : %', st -> 1; end if;
  if st -> 2 -> 'side2' is distinct from '{"weight": "14", "reps": "8"}'::jsonb then raise 'sous-séries sans technique gardées : %', st -> 2; end if;
  if (st -> 3) ? 'side2' or (st -> 4) ? 'side2' or (st -> 5) ? 'side2' then raise 'second côté illisible gardé'; end if;
  if (st -> 6) ? 'side2' then raise 'second côté sur un échauffement'; end if;
  -- Séance sans second côté : identique (pas de clé vide ajoutée)
  s := private.session_public('{"date": 2, "category": "push", "exercises": [{"name": "Développé", "sets": [{"weight": "80", "reps": "8"}]}]}');
  if s -> 'exercises' -> 0 -> 'sets' -> 0 is distinct from '{"weight": "80", "reps": "8"}'::jsonb then raise 'ancienne séance changée : %', s; end if;
end $$;
