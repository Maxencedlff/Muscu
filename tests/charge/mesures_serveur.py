"""Mesure des appels du coach sur la base de charge (tests/charge/serveur.sh) : Postgres LOCAL uniquement.

Pour chaque coach (50, 150, 300 élèves) et chaque appel de l'app côté coach :
- temps d'exécution médian sur 5 passages (EXPLAIN (ANALYZE, BUFFERS)), chaque passage dans une transaction
  annulée (les limites de débit ne s'accumulent pas, rien n'est écrit) ;
- taille de la réponse (Ko de JSON renvoyé à l'app) ;
- plans imbriqués (auto_explain) : parcours séquentiels de plus de 1 000 lignes et requêtes internes lentes.

    PGHOST=<dossier du socket> PGPORT=<port> PGDATABASE=charge python3 tests/charge/mesures_serveur.py [--json sortie.json]
"""
import json
import os
import re
import statistics
import subprocess
import sys

COACHS = {50: 'c0000000-0000-4000-8000-000000000050',
          150: 'c0000000-0000-4000-8000-000000000150',
          300: 'c0000000-0000-4000-8000-000000000300'}
SEUIL_MS = 200
PASSAGES = 5


def psql(sql):
    r = subprocess.run(['psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], input=sql,
                       capture_output=True, text=True, env=os.environ)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-2000:])
    return r.stdout, r.stderr


def student_of(n):
    """Un élève au milieu de la liste (historique complet), de ce coach."""
    out, _ = psql(f"select student_id from public.coach_links where coach_id = '{COACHS[n]}' order by created_at offset {n // 2} limit 1")
    return out.strip()


def calls(n, s):
    """(nom affiché, rôle, SQL de l'appel) : ce que l'app appelle côté coach."""
    out, _ = psql(f"select done_at || ',' || id from public.sessions where user_id = '{s}' and deleted_at is null "
                  f"order by done_at desc, id desc offset 119 limit 1")
    p5_at, p5_id = out.strip().split(',')
    out, _ = psql(f"select id from public.coach_messages where student_id = '{s}' order by id desc offset 250 limit 1")
    msg_old, msg_max = out.strip(), psql(f"select max(id) from public.coach_messages where student_id = '{s}'")[0].strip()
    return [
        ('coach_state (coachRefresh)', 'auth', 'select public.coach_state()'),
        ('coach_tier_state', 'auth', 'select public.coach_tier_state()'),
        ('coach_plans (planning, coachRefresh)', 'auth', 'select public.coach_plans()'),
        ('coach_progress (cadrans « qui décroche »)', 'auth', 'select public.coach_progress()'),
        ('chat_threads (coachRefresh)', 'auth', 'select public.chat_threads()'),
        ('coach_student_sessions page 1', 'auth', f"select jsonb_agg(t) from public.coach_student_sessions('{s}') t"),
        ('coach_student_sessions page 5', 'auth',
         f"select jsonb_agg(t) from public.coach_student_sessions('{s}', {p5_at}, '{p5_id}') t"),
        ('session_for_coach (1 séance)', 'pg',
         f"select private.session_for_coach(id, data) from public.sessions where user_id = '{s}' and id = 'h0002'"),
        ('coach_mark_seen', 'auth', f"select public.coach_mark_seen('{s}')"),
        ('chat_messages page 1', 'auth', f"select jsonb_agg(t) from public.chat_messages('{s}') t"),
        ('chat_messages page ancienne', 'auth', f"select jsonb_agg(t) from public.chat_messages('{s}', {msg_old}) t"),
        ('chat_mark_read', 'auth',
         f"select public.chat_mark_read('{s}', {msg_max})"),
        ('coach_student_weights (156 pesées)', 'auth', f"select public.coach_student_weights('{s}')"),
        ('coach_student_measures (120 mesures)', 'auth', f"select public.coach_student_measures('{s}')"),
        ('coach_student_diet (90 jours)', 'auth', f"select public.coach_student_diet('{s}')"),
        ('coach_diet_overview (Mes élèves)', 'auth', 'select public.coach_diet_overview()'),
        ('push_claim (50 lignes, nettoyage compris)', 'pg', 'select public.push_claim(50)'),
    ]


def measure(n, name, role, call):
    sub = COACHS[n]
    pre = "set local role authenticated; select set_config('request.jwt.claim.sub', '%s', true);\n" % sub if role == 'auth' else ''
    plan_sql = ("load 'auto_explain'; set auto_explain.log_min_duration = 0; set auto_explain.log_nested_statements = on;\n"
                "set auto_explain.log_analyze = on; set auto_explain.log_buffers = on; set auto_explain.log_level = notice;\n"
                f"set client_min_messages = notice; begin; {pre}{call}; rollback;\n")
    _, notices = psql(plan_sql)
    seq = sorted({f'{m.group(1)} ({m.group(2)} lignes lues)'
                  for m in re.finditer(r'Seq Scan on (\S+)[^\n]*actual time=[^\n]*rows=(\d+) loops=(\d+)', notices)
                  if int(m.group(2)) * int(m.group(3)) >= 1000})
    timed = ''.join(f"begin; {pre}explain (analyze, buffers, format json) {call}; rollback;\n" for _ in range(PASSAGES))
    out, _ = psql(timed)
    plans = [json.loads(x) for x in re.findall(r'^\[.*?^\]$', out, re.M | re.S)]
    times = [p[0]['Execution Time'] for p in plans]
    reads = [p[0]['Plan'].get('Shared Hit Blocks', 0) + p[0]['Plan'].get('Shared Read Blocks', 0) for p in plans]
    size_out, _ = psql(f"begin; {pre} select coalesce(octet_length(({call})::text), 0); rollback;")
    return {'appel': name, 'eleves': n, 'ms': round(statistics.median(times), 1), 'ms_max': round(max(times), 1),
            'blocs': int(statistics.median(reads)), 'ko': round(int(size_out.strip().splitlines()[-1]) / 1024, 1),
            'seq_scans': seq}


def trigger_burst(n):
    """n élèves finissent une séance dans l'heure : coût de l'insertion (déclencheur de notification compris),
    lignes mises en file pour le coach, puis push_claim de toute la file. Tout est annulé à la fin."""
    sql = f"""
begin;
create temp table t0 as select clock_timestamp() as t;
insert into public.sessions (user_id, id, data)
  select l.student_id, 'charge-' || l.student_id, jsonb_build_object('date', (extract(epoch from now()) * 1000)::bigint - 600000,
         'label', 'Push', 'duration', 3000000, 'exercises', '[]'::jsonb)
  from public.coach_links l where l.coach_id = '{COACHS[n]}';
select extract(epoch from clock_timestamp() - t) * 1000 from t0;
select count(*) from private.push_outbox where recipient = '{COACHS[n]}' and kind = 'student_session';
update t0 set t = clock_timestamp();
select jsonb_array_length(public.push_claim(200)) + jsonb_array_length(public.push_claim(200));
select extract(epoch from clock_timestamp() - t) * 1000 from t0;
rollback;
"""
    out, _ = psql(sql)
    ins_ms, queued, claimed, claim_ms = out.split()
    return {'eleves': n, 'insert_ms': round(float(ins_ms), 1), 'notifs_en_file': int(queued),
            'claim_lignes': int(claimed), 'claim_ms': round(float(claim_ms), 1)}


def walk(n, per_student, label):
    """Exécute per_student (SQL avec %s = élève) pour chaque élève du coach, dans l'ordre, en tant que le coach,
    dans une seule transaction annulée ; renvoie le nombre d'élèves traités avant le premier refus."""
    ids, _ = psql(f"select string_agg(student_id::text, ',' order by created_at) from public.coach_links where coach_id = '{COACHS[n]}'")
    sql = f"""
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '{COACHS[n]}', true);
do $do$
declare s uuid; i int := 0; err text;
begin
  foreach s in array string_to_array('{ids.strip()}', ',')::uuid[] loop
    begin
      {per_student}
    exception when others then
      raise notice 'BLOQUE % %', i + 1, sqlerrm;
      return;
    end;
    i := i + 1;
  end loop;
  raise notice 'TOUS %', i;
end
$do$;
rollback;
"""
    _, notices = psql(sql)
    m = re.search(r'BLOQUE (\d+) (\w+)', notices)
    if m:
        return {'eleves': n, 'quoi': label, 'bloque': True, 'au_eleve': int(m.group(1)), 'motif': m.group(2)}
    return {'eleves': n, 'quoi': label, 'bloque': False}


def rate_limits(n):
    """Un coach parcourt tous ses élèves d'affilée (fiche, conversation lue) : appels limités refusés ?
    Par élève, l'app fait 1 chat_messages à l'ouverture, 1 chat_mark_read, et relit la conversation toutes les
    15 s (2 relectures comptées : 30 s par élève). Séances, pesées et mensurations n'ont pas de limite."""
    return walk(n, "perform count(*) from public.chat_messages(s); "
                   "perform count(*) from public.chat_messages(s, null, 0); perform count(*) from public.chat_messages(s, null, 0); "
                   "perform public.chat_mark_read(s, 1);", 'parcours des conversations (30 s chacune)')


def send_limit(n):
    """Envoyer un programme à chacun de ses n élèves (coach_send_programme, l'un après l'autre)."""
    return walk(n, "perform public.coach_send_programme(s, 'charge1', '{\"name\": \"Bloc été\", \"sessions\": {}}'::jsonb);",
                'programme envoyé à chaque élève')


def diet_upload(n):
    """Un élève renvoie ses 90 jours de diète (student_share_diet_days), dans une transaction annulée."""
    s = student_of(n)
    days, _ = psql(f"select jsonb_agg(private.diet_day_json(d) order by d.day desc) from public.coach_shared_diet_days d where d.student_id = '{s}'")
    out, _ = psql(f"""begin; create temp table t0 on commit drop as select clock_timestamp() as t; grant select on t0 to authenticated;
set local role authenticated; select set_config('request.jwt.claim.sub', '{s}', true);
select public.student_share_diet_days($j${days.strip()}$j$::jsonb);
select extract(epoch from clock_timestamp() - t) * 1000 from t0; rollback;""")
    kept, ms = out.split()[-2:]
    return {'eleves': n, 'jours_gardes': int(kept), 'ms': round(float(ms), 1)}


def main():
    res = {'appels': [], 'rafale': [], 'limites_chat': [], 'envoi_programmes': [], 'envoi_diete': []}
    for n in COACHS:
        s = student_of(n)
        for name, role, call in calls(n, s):
            r = measure(n, name, role, call)
            res['appels'].append(r)
            print(f"{n:>3} | {name:<45} | {r['ms']:>8} ms | {r['ko']:>8} Ko | {', '.join(r['seq_scans'])}", flush=True)
        res['rafale'].append(trigger_burst(n))
        print(n, res['rafale'][-1], flush=True)
        res['limites_chat'].append(rate_limits(n))
        print(n, res['limites_chat'][-1], flush=True)
        res['envoi_programmes'].append(send_limit(n))
        print(n, res['envoi_programmes'][-1], flush=True)
        res['envoi_diete'].append(diet_upload(n))
        print(n, res['envoi_diete'][-1], flush=True)
    slow = [r for r in res['appels'] if r['ms'] > SEUIL_MS]
    print(f"\nAu-delà de {SEUIL_MS} ms : " + (', '.join(f"{r['appel']} à {r['eleves']} élèves ({r['ms']} ms)" for r in slow) or 'aucun'))
    blocked = [r for r in res['limites_chat'] + res['envoi_programmes'] if r['bloque']]
    slow += [r for r in res['envoi_diete'] if r['ms'] > SEUIL_MS]
    if '--json' in sys.argv:
        with open(sys.argv[sys.argv.index('--json') + 1], 'w', encoding='utf-8') as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
    if '--strict' in sys.argv and (slow or blocked):
        sys.exit(1)


if __name__ == '__main__':
    main()
