-- ═══════════════════════════════════════════════════════════
--  Nom de l'affiche du coach montré à ses élèves (20/11/2026). Contrat : docs/AFFICHE_COACH.md, « Mon coach ».
--  ÉCRITE, PAS APPLIQUÉE EN PRODUCTION (feu vert de Maxence attendu). Retour arrière :
--  supabase/rollback/20261120020000_nom_affiche_coach_down.sql.
--
--  1. Le coach écrit son nom sur son affiche (Mes élèves › Mon affiche de coach). Ce nom part ici seulement quand il
--     PARTAGE l'affiche (l'app le dit sous les réglages) : coach_set_poster_name. Une ligne par coach, remplacée.
--  2. Lu par coach_poster_name(coach) : par le coach lui-même et par ses élèves (public.coach_links), personne
--     d'autre ; rien en cas de blocage, ni si le compte n'est plus coach. Aucun GRANT client sur la table.
--  3. Nom : 1 à 40 caractères, sans caractère de contrôle, espaces resserrés (comme posterName côté app).
--  Sans cette migration, l'app reste comme avant : Mon coach montre le pseudo seul.
-- ═══════════════════════════════════════════════════════════

create table public.coach_poster_names (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40 and name !~ '[[:cntrl:]]' and name = btrim(name)),
  updated_at timestamptz not null default now()
);
alter table public.coach_poster_names enable row level security;
revoke all on public.coach_poster_names from public, anon, authenticated, service_role;

create function public.coach_set_poster_name(name text) returns jsonb
  language plpgsql volatile security definer set search_path = '' as
$$
declare
  me uuid := (select auth.uid());
  n text := btrim(regexp_replace(regexp_replace(coalesce(coach_set_poster_name.name, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
begin
  if me is null or not private.is_coach(me) then raise exception 'not_coach' using errcode = 'P0001'; end if;
  if char_length(n) < 1 or char_length(n) > 40 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  insert into public.coach_poster_names as c (user_id, name) values (me, n)
    on conflict (user_id) do update set name = excluded.name, updated_at = now()
    where c.name is distinct from excluded.name;
  return jsonb_build_object('name', n);
end
$$;

create function public.coach_poster_name(coach uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if coach_poster_name.coach is null or not private.is_coach(coach_poster_name.coach)
     or (me <> coach_poster_name.coach and (
           not exists (select 1 from public.coach_links l where l.coach_id = coach_poster_name.coach and l.student_id = me)
           or private.blocked_between(me, coach_poster_name.coach))) then
    return jsonb_build_object('name', null);
  end if;
  return jsonb_build_object('name', (select c.name from public.coach_poster_names c where c.user_id = coach_poster_name.coach));
end
$$;

revoke all on function public.coach_set_poster_name(text) from public, anon, authenticated;
revoke all on function public.coach_poster_name(uuid) from public, anon, authenticated;
grant execute on function public.coach_set_poster_name(text) to authenticated;
grant execute on function public.coach_poster_name(uuid) to authenticated;
