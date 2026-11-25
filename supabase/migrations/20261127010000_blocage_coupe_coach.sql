-- ═══════════════════════════════════════════════════════════
--  Un blocage coupe le lien coach (audit du site coach, 25/11/2026, constat M1). ÉCRITE, PAS APPLIQUÉE : attend
--  le feu vert de Maxence. Retour arrière : supabase/rollback/20261127010000_blocage_coupe_coach_down.sql.
--  Tests : tests/sql/blocage_coupe_coach_test.sql, tests/sql/blocage_coupe_coach_rollback_test.sh.
--
--  Avant : un élève qui bloquait son coach (ou l'inverse) restait lié. Seuls les bilans (20261125010000) et les
--  notifications regardaient private.blocked_between ; séances, poids, mensurations, diète, photos, programmes,
--  phases, notes et messages restaient lisibles et écrivables par le coach (matrice IDOR de l'audit).
--
--  Une seule règle, posée sur les données plutôt que dans chaque RPC : un blocage entre un élève et son coach, dans
--  un sens ou dans l'autre (le blocage coupe tout dans les deux sens, docs/SOCIAL_V1.md), supprime leur ligne de
--  public.coach_links. C'est exactement le chemin de « Quitter mon coach » (coach_leave) : les clés étrangères
--  (student_id, coach_id) → coach_links on delete cascade effacent ce qui n'existe que sous le lien, comme
--  aujourd'hui quand l'élève part :
--    coach_programmes (programmes et plans diète envoyés), coach_notes, coach_shares (et par elles les jours de
--    diète partagés ; leur déclencheur retire le plan diète), coach_messages (la conversation ; un signalement fait
--    avant garde sa copie dans chat_reports), coach_phases, coach_photos (leur déclencheur met les fichiers à la
--    corbeille de coach-photos-purge), et des bilans : appartenance aux groupes, plannings à son nom, demandes
--    (réponses et retours avec elles) et accord du cycle. Les modèles et groupes restent au coach.
--  Rien de l'élève lui-même n'est touché (séances, pesées, compte). Débloquer ne recrée pas le lien : il faut un
--  nouveau code, comme après avoir quitté.
--  Pourquoi pas blocked_between dans private.coach_require_student : il ne couvrirait pas chat_thread, coach_state,
--  student_inbox, les partages ni les lectures de l'élève, et laisserait des données de santé partagées avec quelqu'un
--  qu'on a bloqué. Couper le lien ferme tout d'un coup, y compris les RPC écrites plus tard.
--
--  - Déclencheur after insert sur public.blocks : supprime le lien dans les deux sens, sous private.lock_pair.
--  - Déclencheur before insert sur public.coach_links : refuse de (re)lier deux comptes bloqués (invalid_code,
--    la réponse d'un code faux : rien n'est révélé), sous le même verrou que block_user (pas de course entre un
--    blocage et un coach_join simultanés).
--  - Nettoyage : les liens déjà bloqués aujourd'hui sont supprimés (même cascade).
--  Fonctions de déclencheur dans private, exécutables par aucun rôle de l'API.
-- ═══════════════════════════════════════════════════════════

create function private.block_cuts_coach() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  perform private.lock_pair(new.blocker_id, new.blocked_id);
  delete from public.coach_links l
    where (l.student_id = new.blocker_id and l.coach_id = new.blocked_id)
       or (l.student_id = new.blocked_id and l.coach_id = new.blocker_id);
  return null;
end
$$;

create function private.coach_link_not_blocked() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  perform private.lock_pair(new.student_id, new.coach_id);
  if private.blocked_between(new.student_id, new.coach_id) then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger blocks_cut_coach after insert on public.blocks
  for each row execute function private.block_cuts_coach();
create trigger coach_links_not_blocked before insert on public.coach_links
  for each row execute function private.coach_link_not_blocked();

revoke all on function private.block_cuts_coach() from public, anon, authenticated, service_role;
revoke all on function private.coach_link_not_blocked() from public, anon, authenticated, service_role;

-- Liens déjà bloqués : coupés maintenant (même cascade que coach_leave)
delete from public.coach_links l
  where private.blocked_between(l.student_id, l.coach_id);
