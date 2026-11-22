-- ═══════════════════════════════════════════════════════════
--  Accord du mot « coach » : « Ma coach » pour une coach (22/11/2026). Contrat : docs/COACH_FORME.md.
--  ÉCRITE, PAS APPLIQUÉE EN PRODUCTION (feu vert de Maxence attendu). Retour arrière :
--  supabase/rollback/20261122010000_forme_coach_down.sql. Indépendante : aucune fonction existante réécrite.
--
--  1. Le coach choisit sa forme dans Réglages › Coach (« Tes élèves lisent ») : 'il' (« Mon coach »), 'elle'
--     (« Ma coach ») ou 'neutre' (« Ne pas préciser »). coach_set_form, coach validé seulement. Une ligne par coach,
--     remplacée. Jamais déduite d'autre chose (prénom, silhouette).
--  2. Lue par coach_form(coach) : par le coach lui-même et par ses élèves (public.coach_links), personne d'autre ;
--     rien en cas de blocage, ni si le compte n'est plus coach (mêmes règles que coach_poster_name). Aucun GRANT
--     client sur la table.
--  3. Notifications push : push_actor_forms(ids) rend, pour les lignes de la file prises par push-send (clé serveur
--     seulement), la forme de l'auteur quand c'est le coach du destinataire (« Commentaire de la coach »). push_claim
--     n'est pas touché ; sans cette fonction, push-send garde le texte d'avant.
--  Sans cette migration, l'app écrit « ton coach » comme avant (la lecture échoue sans rien dire).
-- ═══════════════════════════════════════════════════════════

create table public.coach_forms (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  form       text not null check (form in ('il', 'elle', 'neutre')),
  updated_at timestamptz not null default now()
);
alter table public.coach_forms enable row level security;
revoke all on public.coach_forms from public, anon, authenticated, service_role;

create function public.coach_set_form(form text) returns jsonb
  language plpgsql volatile security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null or not private.is_coach(me) then raise exception 'not_coach' using errcode = 'P0001'; end if;
  if coach_set_form.form is null or coach_set_form.form not in ('il', 'elle', 'neutre') then
    raise exception 'invalid_form' using errcode = 'P0001';
  end if;
  insert into public.coach_forms as c (user_id, form) values (me, coach_set_form.form)
    on conflict (user_id) do update set form = excluded.form, updated_at = now()
    where c.form is distinct from excluded.form;
  return jsonb_build_object('form', coach_set_form.form);
end
$$;

create function public.coach_form(coach uuid) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if coach_form.coach is null or not private.is_coach(coach_form.coach)
     or (me <> coach_form.coach and (
           not exists (select 1 from public.coach_links l where l.coach_id = coach_form.coach and l.student_id = me)
           or private.blocked_between(me, coach_form.coach))) then
    return jsonb_build_object('form', null);
  end if;
  return jsonb_build_object('form', (select c.form from public.coach_forms c where c.user_id = coach_form.coach));
end
$$;

-- push-send (clé serveur) : { "<id de la file>": forme } pour les lignes dont l'auteur est le coach du destinataire
create function public.push_actor_forms(ids bigint[]) returns jsonb
  language sql stable security definer set search_path = '' as
$$
  select coalesce(jsonb_object_agg(o.id::text, f.form), '{}'::jsonb)
  from private.push_outbox o
  join public.coach_forms f on f.user_id = o.actor
  where o.id = any ((coalesce(push_actor_forms.ids, '{}'::bigint[]))[1:500])
    and private.is_coach(o.actor)
    and exists (select 1 from public.coach_links l where l.coach_id = o.actor and l.student_id = o.recipient)
$$;

revoke all on function public.coach_set_form(text) from public, anon, authenticated;
revoke all on function public.coach_form(uuid) from public, anon, authenticated;
revoke all on function public.push_actor_forms(bigint[]) from public, anon, authenticated;
grant execute on function public.coach_set_form(text) to authenticated;
grant execute on function public.coach_form(uuid) to authenticated;
grant execute on function public.push_actor_forms(bigint[]) to service_role;
