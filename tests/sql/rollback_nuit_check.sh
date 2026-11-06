#!/usr/bin/env bash
# Retours arrière des migrations de la nuit du 31/10 (supabase/rollback/*_down.sql), sur un Postgres
# local jetable comme run.sh. Rien n'est envoyé au projet Supabase.
#
# « État identique » = même pg_dump (schéma, droits, politiques, déclencheurs ET données) que la base où
# la migration n'a jamais été appliquée. Seules différences admises, normalisées avant comparaison :
# horodatages, ordre des colonnes d'une table (une colonne recréée part en dernier) et tables d'archive
# laissées exprès par un retour arrière (private.*_archive_*, private.payant_plus_*).
#
#  1. Référence : les migrations une à une, un instantané après chacune.
#  2. Chaque retour arrière seul, juste après sa migration : retour arrière = état d'avant, puis nouvelle
#     montée = état d'après (la migration repasse).
#  3. Démontage complet dans l'ordre inverse (supabase/rollback/ORDRE.md), depuis toutes les migrations :
#     après chaque retour arrière, état identique à la référence d'avant sa migration.
#  4. Gardes : tarifs et modèle B refusent (sans rien changer) tant que la migration qui les réécrit est là.
#  5. Retours arrière indépendants (parrainage du payant, notifications, Strava, lettre, records, planification du
#     coach, mensurations partagées, progression des élèves ; le partage du poids n'est plus seul depuis les mensurations, qui s'y appuient)
#     lancés SEULS sur la pile complète :
#     les tests des autres lots (*_test.sql) passent encore.
#  6. Démontage complet AVEC des données (comptes, coach, codes, achats, parrainage, pesées), contrôles
#     des archives, puis toutes les migrations remontées par-dessus.
# Lancer : bash tests/sql/rollback_nuit_check.sh   (Postgres 15+, python3)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mig="$root/supabase/migrations"
down="$root/supabase/rollback"
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
tmp=$(mktemp -d)
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
psql() { db=$1; shift; command psql -X -q -v ON_ERROR_STOP=1 -h "$tmp" -p "$port" -U postgres -d "$db" "$@"; }
clone() { psql postgres -c "create database $2 template $1"; }

# Instantané normalisé d'une base (voir l'en-tête)
snap() {
  "$bin/pg_dump" -h "$tmp" -p "$port" -U postgres --no-comments \
      -T 'private.*_archive_*' -T 'private.payant_plus_*' "$1" | python3 -I -c '
import re, sys
out, block, copy = [], None, None
for line in sys.stdin.read().splitlines():
    if not line or line.startswith("--") or re.match(r"\\(un)?restrict ", line):
        continue
    line = re.sub(r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?[+-]\d\d", "TS", line)
    if block is not None:                       # colonnes d une table : triées
        if line == ");":
            out += sorted(block) + [line]; block = None
        else:
            block.append(line.rstrip(","))
        continue
    if copy is not None:                        # données : colonnes dans l ordre trié
        if line == "\\.":
            out += sorted(copy) + [line]; copy = None
        else:
            cells = line.split("\t"); copy.append("\t".join(cells[i] for i in order))
        continue
    m = re.match(r"COPY (\S+) \((.*)\) FROM stdin;$", line)
    if m:
        cols = m.group(2).split(", "); order = sorted(range(len(cols)), key=lambda i: cols[i])
        out.append("COPY %s (%s) FROM stdin;" % (m.group(1), ", ".join(cols[i] for i in order))); copy = []
        continue
    out.append(line)
    if re.match(r"CREATE TABLE \S+ \($", line):
        block = []
print("\n".join(out))'
}
same() {  # same <base> <instantané attendu> <libellé>
  snap "$1" > "$tmp/now.sql"
  if ! diff -u "$2" "$tmp/now.sql" > "$tmp/diff.txt"; then
    echo "ÉCHEC : $3"; head -60 "$tmp/diff.txt"; exit 1
  fi
}
ts() { basename "$1" | cut -c1-14; }
# Un fichier de tests sur une base donnée (le test de concurrence ouvre ses connexions dblink sur « postgres »)
run_test() { sed "s/dbname=postgres/dbname=$1/" "$2" | psql "$1" >/dev/null; }

psql postgres -c "create database base"
psql base -f "$here/supabase_stub.sql"

# ── 1 et 2 ──────────────────────────────────────────────
clone base ref
snap ref > "$tmp/S_initial.sql"
prev="$tmp/S_initial.sql"
for m in "$mig"/*.sql; do
  t=$(ts "$m")
  psql ref -f "$m"
  snap ref > "$tmp/S_$t.sql"
  echo "$prev" > "$tmp/P_$t"           # instantané d'avant cette migration
  d=$(ls "$down/${t}"_*_down.sql 2>/dev/null || true)
  if [ -n "$d" ] && [ "$t" \> 20261029000000 -o "$t" = 20261029000000 ]; then
    clone ref "iso_$t"
    psql "iso_$t" -f "$d"
    same "iso_$t" "$prev" "$(basename "$d") seul : état d'avant la migration"
    psql "iso_$t" -f "$m"
    same "iso_$t" "$tmp/S_$t.sql" "$(basename "$m") remontée après son retour arrière"
    echo "OK : $(basename "$d") seul, puis nouvelle montée"
  fi
  prev="$tmp/S_$t.sql"
done
last="$prev"

# Ordre de démontage : inverse des migrations, de la plus récente à 20261029000000 (supabase/rollback/ORDRE.md)
order=()
for m in $(ls "$mig"/*.sql | sort -r); do
  t=$(ts "$m"); [ "$t" \< 20261029000000 ] && break
  d=$(ls "$down/${t}"_*_down.sql 2>/dev/null || true)
  [ -n "$d" ] || { echo "ÉCHEC : pas de retour arrière pour $(basename "$m")"; exit 1; }
  order+=("$d")
done

# ── 3. Démontage complet ────────────────────────────────
clone ref pile
for d in "${order[@]}"; do
  t=$(ts "$d")
  psql pile -f "$d"
  same pile "$(cat "$tmp/P_$t")" "démontage : $(basename "$d")"
done
echo "OK : démontage complet dans l'ordre inverse, état identique à chaque marche"

# ── 4. Gardes ───────────────────────────────────────────
clone ref garde
for d in "$down"/20261030000000_*_down.sql "$down"/20261029000000_*_down.sql; do
  if psql garde -f "$d" >/dev/null 2>&1; then echo "ÉCHEC : $(basename "$d") passe sur la pile complète"; exit 1; fi
  same garde "$last" "$(basename "$d") refusé sans rien changer"
done
psql garde -f "$down/20261031000000_payant_plus_down.sql"
if psql garde -f "$down/20261029000000_payant_modele_b_down.sql" >/dev/null 2>&1; then
  echo "ÉCHEC : modèle B démonté avant les tarifs"; exit 1
fi
if psql garde -f "$down/20261031400000_parrainage_down.sql" >/dev/null 2>&1; then
  echo "ÉCHEC : parrainage démonté avant le parrainage du payant"; exit 1
fi
echo "OK : tarifs, modèle B et parrainage refusent tant que la migration du dessus est en place"

# ── 5. Retours arrière indépendants, seuls sur la pile complète ──
for pair in "20261031910000:push_messages_test.sql push_test.sql" \
            "20261031620000:strava_test.sql" \
            "20261031230000:newsletter_test.sql" \
            "20261031100000:records_test.sql coach_progress_test.sql" \
            "20261105000000:coach_planning_test.sql coach_planning_concurrence_test.sql" \
            "20261105010000:partage_mensurations_test.sql" \
            "20261106000000:coach_progress_test.sql" \
            "20261101000000:parrainage_payant_test.sql" \
            "20261031000000:payant_plus_test.sql"; do
  t=${pair%%:*}; skip=" ${pair#*:} "
  clone ref "seul_$t"
  psql "seul_$t" -f "$(ls "$down/${t}"_*_down.sql)"
  for f in "$here"/*_test.sql; do
    case "$skip" in *" $(basename "$f") "*) continue ;; esac
    run_test "seul_$t" "$f"
  done
  echo "OK : $(basename "$(ls "$down/${t}"_*_down.sql)") seul sur la pile complète, tests des autres lots verts"
done

# ── 6. Démontage complet avec des données, puis nouvelle montée ──
clone ref data
psql data >/dev/null <<'SQL'
insert into auth.users (id, created_at) values
  ('00000000-0000-0000-0000-00000000d001', now()), ('00000000-0000-0000-0000-00000000d002', now()),
  ('00000000-0000-0000-0000-00000000d003', now()), ('00000000-0000-0000-0000-00000000d004', now());
insert into public.user_profiles (user_id, username, avatar_emoji) values
  ('00000000-0000-0000-0000-00000000d001', 'coach.rb', '🦁'), ('00000000-0000-0000-0000-00000000d002', 'eleve.rb', '🦊'),
  ('00000000-0000-0000-0000-00000000d003', 'abonne.rb', '🐻');
-- Coach validé (code permanent), un élève lié par son code (attribution et parrainage)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d001', false);
set role authenticated;
select public.coach_request_submit('Jean Test', 'AB123456', 'BPJEPS');
reset role;
select private.approve_coach('00000000-0000-0000-0000-00000000d001', 'carte factice');
create table public.rb_code as select x ->> 'code' as code from public.coach_my_code() x;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d002', false);
set role authenticated;
select public.coach_join((select code from public.rb_code));
select public.student_set_share('weight', true);
select public.student_share_weights('[{"date": 1780000000000, "kg": 80.5}]'::jsonb);
insert into public.sessions (id, data) values ('r1', '{"date": 1780000000000, "duration": 60, "exercises": [],
  "records": [{"ex": "Squat", "kind": "charge", "before": 100, "after": 105}]}');
reset role;
-- Un partenaire et un abonné qui a saisi son code ; un achat d'abonnement ; un accès à vie offert puis retiré
select private.make_partner_code('LUCAS', 'Lucas', 0.25, 12);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d003', false);
set role authenticated;
select public.referral_apply('lucas');
reset role;
select public.srv_access_purchase('00000000-0000-0000-0000-00000000d003', 'com.mdlf.training.pro.monthly',
  now() + interval '20 days', 'rb-sub', false, now(), true, 'Sandbox');
select public.srv_subscription_payment('rb-sub-1', 'rb-sub', 'com.mdlf.training.pro.monthly', 'Production', now(),
  now() + interval '1 month', 6490, 'EUR', 'FRA');
select private.grant_lifetime('00000000-0000-0000-0000-00000000d004', 'retiré ensuite');
select private.revoke_lifetime('00000000-0000-0000-0000-00000000d004', 'retiré');
insert into public.coach_offer_codes (code, environment, expires_at, batch)
  values ('FAUXCODE0001', 'Sandbox', now() + interval '30 days', 'lot factice');
drop table public.rb_code;
do $$ begin
  if (select count(*) from public.referral_attributions) <> 2 then raise 'jeu de départ : attributions'; end if;
  if (select count(*) from public.coach_shared_weights) <> 1 then raise 'jeu de départ : pesée'; end if;
  if not exists (select 1 from public.coach_invites where permanent) then raise 'jeu de départ : code permanent'; end if;
end $$;
SQL
for d in "${order[@]}"; do psql data -f "$d" >/dev/null; done
psql data >/dev/null <<'SQL'
do $$ begin
  if (select count(*) from private.parrainage_payant_archive_payments where attribution_id is not null) <> 1
    then raise 'paiements non archivés'; end if;
  if (select count(*) from private.parrainage_archive_attributions) <> 2
     or (select count(*) from private.parrainage_archive_partners) <> 1 then raise 'parrainage non archivé'; end if;
  if (select count(*) from private.tarifs_archive_coach_requests where status = 'approved') <> 1
     or (select count(*) from private.tarifs_archive_coach_offer_codes) <> 1 then raise 'tarifs non archivés'; end if;
  if (select intro_offer from private.modele_b_archive_claims where original_transaction_id = 'rb-sub') is not true
     then raise 'offre de lancement non archivée'; end if;
  if exists (select 1 from public.coach_invites where char_length(code) <> 8) then raise 'code permanent resté'; end if;
  if (select coach_at is null from public.user_profiles where user_id = '00000000-0000-0000-0000-00000000d001')
     then raise 'coach validé : rôle perdu'; end if;
  -- Retour au 28/10 : élève lié = gratuit, abonné = actif, les autres en essai maison
  if (select status from public.entitlements where user_id = '00000000-0000-0000-0000-00000000d002') <> 'coach_team'
     then raise 'élève : %', (select status from public.entitlements where user_id = '00000000-0000-0000-0000-00000000d002'); end if;
  if (select status from public.entitlements where user_id = '00000000-0000-0000-0000-00000000d003') <> 'active'
     then raise 'abonné : %', (select status from public.entitlements where user_id = '00000000-0000-0000-0000-00000000d003'); end if;
  if (select count(*) from public.sessions where id = 'r1') <> 1 then raise 'séance perdue'; end if;
  -- Accès à vie offert puis retiré : mis de côté, il ne revit pas
  if (select count(*) from private.payant_plus_revoked_redemptions) <> 1 then raise 'retrait d''accès offert non mis de côté'; end if;
  if exists (select 1 from public.gift_redemptions where user_id = '00000000-0000-0000-0000-00000000d004')
     then raise 'accès offert retiré revenu'; end if;
end $$;
-- Les tests de la nouvelle montée comptent sur une table de codes vierge (payant_test.sql)
delete from public.gift_codes where note = 'attribué : retiré ensuite';
SQL
echo "OK : démontage complet avec des données, archives et droits d'accès vérifiés"
for m in "$mig"/*.sql; do
  [ "$(ts "$m")" \< 20261029000000 ] && continue
  psql data -f "$m" >/dev/null
done
for f in "$here"/*_test.sql; do run_test data "$f"; done
echo "OK : migrations remontées sur la base démontée avec des données, tous les tests verts"
