#!/usr/bin/env bash
# Mise en production du payant dans l'ORDRE RÉEL de la production (supabase/rollback/ORDRE.md, « Mise en
# production »), sur un Postgres local jetable comme run.sh. Rien n'est envoyé au projet Supabase.
#
# La production a déjà : toutes les migrations de main (lot 3 et notifications push compris) et
# 20261028000000_payant.sql. Les migrations du payant datées d'AVANT le lot 3 (modèle B, tarifs, payant
# plus) et la lettre d'information y arrivent donc APRÈS des migrations plus récentes qu'elles.
#  1. Production simulée : migrations de prod_applied, des données réalistes (seed_20261028.sql).
#  2. Les migrations à appliquer, dans l'ordre de la liste to_apply, chacune dans une transaction.
#  3. Le schéma obtenu (pg_dump --schema-only normalisé) est identique à celui d'une base neuve qui a
#     tout reçu dans l'ordre des dates (sans Strava) : aucune fonction réécrite par le lot 3 n'est
#     écrasée par une version plus ancienne.
#  4. Les tests SQL de tous les lots (*_test.sql, sauf Strava) passent sur la base de production simulée.
#  5. Retours arrière dans l'ordre inverse de to_apply : après chacun, schéma ET données identiques à la
#     base d'avant (pg_dump complet, archives private.*_archive_* exclues), jusqu'à la production de départ.
#     Seule exception, documentée (supabase/rollback/ORDRE.md) : l'« Accès offert » d'Apple effacé par le
#     modèle B ne revient pas.
# Lancer : bash tests/sql/prod_order_test.sh   (Postgres 15+, python3)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mig="$root/supabase/migrations"
down="$root/supabase/rollback"
# Déjà en production (main 384390b + le payant du 28/10), dans l'ordre où elles y sont passées
prod_applied=(20261025000000 20261026000000 20261026010000 20261026020000 20261026030000 20261026040000
  20261026050000 20261027000000 20261027100000 20261027110000 20261028000000 20261031100000 20261031200000
  20261031300000 20261031400000 20261031500000 20261031510000 20261031900000 20261031910000)
# À appliquer, dans cet ordre (Strava, 20261031620000, reste en sommeil : jamais appliquée au lancement)
to_apply=(20261029000000 20261030000000 20261031000000 20261031230000 20261101000000 20261105000000 20261105010000 20261106000000 20261106200000)
skip_tests=" strava_test.sql "
bin=$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | sort -V | tail -1)")
tmp=$(mktemp -d)
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$bin/initdb" -D "$tmp/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -o "-p $port -k $tmp -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null
psql() { db=$1; shift; command psql -X -q -v ON_ERROR_STOP=1 -h "$tmp" -p "$port" -U postgres -d "$db" "$@"; }
file() { ls "$1/$2"_*.sql; }
run_test() { sed "s/dbname=postgres/dbname=$1/" "$2" | psql "$1" >/dev/null; }

# Toutes les migrations du dépôt sont dans l'une des deux listes (ou Strava) : une migration oubliée échoue
for m in "$mig"/*.sql; do
  t=$(basename "$m" | cut -c1-14)
  case " ${prod_applied[*]} ${to_apply[*]} 20261031620000 " in *" $t "*) ;; *) echo "ÉCHEC : $(basename "$m") dans aucune liste"; exit 1 ;; esac
done

# Instantané normalisé : $1 base, $2 « schema » ou « full »
snap() {
  local opt=(); [ "$2" = schema ] && opt=(--schema-only)
  "$bin/pg_dump" -h "$tmp" -p "$port" -U postgres --no-comments "${opt[@]}" -T 'private.*_archive_*' -T 'private.payant_plus_*' "$1" | python3 -I -c '
import re, sys
out, block, copy = [], None, None
for line in sys.stdin.read().splitlines():
    if not line or line.startswith("--") or re.match(r"\\(un)?restrict ", line):
        continue
    line = re.sub(r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?[+-]\d\d", "TS", line)
    if block is not None:
        if line == ");":
            out += sorted(block) + [line]; block = None
        else:
            block.append(line.rstrip(","))
        continue
    if copy is not None:
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
# Un pg_dump range les objets par type puis par nom, mais les identités (sequences) gardent leur ordre :
# on compare un ensemble de blocs, pas un texte
blocks, cur = [], []
for l in out:
    cur.append(l)
    if l.endswith(";") and not l.startswith(" ") or l == "\\.":
        blocks.append("\n".join(cur)); cur = []
if cur: blocks.append("\n".join(cur))
print("\n\n".join(sorted(blocks)))'
}
same() {  # same <base> <mode> <instantané attendu> <libellé>
  snap "$1" "$2" > "$tmp/now.sql"
  if ! diff -u "$3" "$tmp/now.sql" > "$tmp/diff.txt"; then
    echo "ÉCHEC : $4"; head -80 "$tmp/diff.txt"; exit 1
  fi
}

# Socle Supabase (les rôles sont communs à tout le serveur : créés une fois, les bases sont des copies)
psql postgres -c "create database socle"
psql socle -f "$here/supabase_stub.sql"
# Référence : base neuve, tout dans l'ordre des dates, sans Strava
psql postgres -c "create database neuve template socle"
for m in "$mig"/*.sql; do
  [ "$(basename "$m" | cut -c1-14)" = 20261031620000 ] && continue
  psql neuve -f "$m"
done
snap neuve schema > "$tmp/neuve.sql"

# ── 1. Production simulée ───────────────────────────────
psql postgres -c "create database prod template socle"
for t in "${prod_applied[@]}"; do
  psql prod -f "$(file "$mig" "$t")"
  [ "$t" = 20261028000000 ] && psql prod -f "$here/upgrade/seed_20261028.sql" >/dev/null
done
snap prod full > "$tmp/F_depart.sql"
snap prod schema > "$tmp/F_depart.schema"
echo "OK : production simulée (main + 20261028000000_payant.sql, données réalistes)"

# ── 2. Migrations à appliquer, dans l'ordre ─────────────
prev="$tmp/F_depart.sql"
for t in "${to_apply[@]}"; do
  echo "$prev" > "$tmp/P_$t"
  psql prod -1 -f "$(file "$mig" "$t")"
  snap prod full > "$tmp/F_$t.sql"; snap prod schema > "$tmp/F_$t.schema"; prev="$tmp/F_$t.sql"
  echo "OK : $(basename "$(file "$mig" "$t")")"
done
psql postgres -c "create database apres template prod"

# ── 3. Même schéma qu'une base neuve ────────────────────
same prod schema "$tmp/neuve.sql" "schéma de la production après mise à jour ≠ base neuve"
echo "OK : schéma identique à une base neuve (aucune fonction écrasée par une version plus ancienne)"

# ── 4. Données de la production gardées, puis tests de tous les lots ─
psql apres -c "create function pg_temp.perr(stmt text) returns text language plpgsql as \$\$ begin execute stmt; return 'ok'; exception when others then return sqlerrm; end \$\$;" \
     -f "$here/upgrade/check_modele_b.sql" >/dev/null
echo "OK : données de la production après mise à jour (upgrade/check_modele_b.sql)"
# Les tests SQL partent d'une base sans comptes (mêmes identifiants factices que le jeu de données)
psql postgres -c "create database essais template apres"
psql essais -c "delete from auth.users; delete from public.gift_codes;" >/dev/null
for f in "$here"/*_test.sql; do
  case "$skip_tests" in *" $(basename "$f") "*) continue ;; esac
  run_test essais "$f"
done
echo "OK : tests SQL de tous les lots verts sur la production mise à jour (Strava exclu)"

# ── 5. Retours arrière dans l'ordre inverse ─────────────
for (( i=${#to_apply[@]}-1; i>=0; i-- )); do
  t=${to_apply[$i]}
  psql apres -f "$(file "$down" "$t")" 2>&1 | { /usr/bin/grep -v 'transaction in progress' || true; }
  if [ "$t" = 20261029000000 ]; then
    # Modèle B : ce qui ne revient pas (supabase/rollback/ORDRE.md) : l'« Accès offert » d'Apple effacé par
    # la migration (902 repart en essai maison). Schéma identique, et seules ces lignes de données diffèrent.
    same apres schema "$(sed 's/\.sql$/.schema/' "$tmp/P_$t")" "retour arrière du modèle B : schéma d'avant"
    snap apres full > "$tmp/now.sql"
    extra=$(diff "$(cat "$tmp/P_$t")" "$tmp/now.sql" | /usr/bin/grep '^[<>]' \
            | /usr/bin/grep -v -P '^< .*\tG-902\tcom\.mdlf\.training\.access\.gift\t' \
            | /usr/bin/grep -v -P '^> \\N\tf\t\\N\tf\t\\N\t\\N\ttrial\tTS\tTS\t00000000-0000-0000-0000-000000000902$' || true)
    [ -z "$extra" ] || { echo "ÉCHEC : retour arrière du modèle B, données inattendues :"; echo "$extra" | head -20; exit 1; }
  else
    same apres full "$(cat "$tmp/P_$t")" "retour arrière $(basename "$(file "$down" "$t")") : état d'avant"
  fi
  echo "OK : $(basename "$(file "$down" "$t")"), état d'avant retrouvé"
done
echo "OK : retour à la production de départ (sauf l'« Accès offert » effacé par le modèle B, ORDRE.md)"
