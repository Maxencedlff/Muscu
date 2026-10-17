"""Jeu de données réaliste : 6 mois d'entraînement d'un pratiquant régulier (tests, captures App Store, audit).

    python3 tests/donnees_realistes.py            → écrit tests/donnees/mdlf-6-mois.json (importable dans l'app :
                                                    Réglages › Importer)
    from donnees_realistes import six_mois_json   → chaîne JSON à injecter dans localStorage ppl_v2

Déterministe (graine fixe) : mêmes données à chaque génération, donc captures et tests reproductibles.
Modèle :
- PPL 3 à 4 séances par semaine, avec semaines incomplètes, vacances (2 semaines en août) et un arrêt maladie ;
- double progression : +1 rep par séance jusqu'au haut de la fourchette, puis +2,5 kg (petits muscles +1 kg)
  et retour au bas de la fourchette ; une semaine allégée (−10 %) toutes les 6 semaines ; plateaux sur le
  développé couché ;
- dernière série parfois en échec (−1 à −2 reps), notes de séance occasionnelles, exercices ajoutés à la main ;
- programme perso « Bras & épaules » pendant 5 semaines ; poids de secours 74,5 kg.
Format : ppl_v2 sans champ « schema » : l'app le migre au chargement (exId, records), comme une vraie donnée.
"""
import json
import os
import random

DAY = 86_400_000
HOUR = 3_600_000

# id, nom, séries, charge de départ (None : poids du corps), fourchette de reps, pas de progression (kg)
PUSH = [('p1dcouch', 'Développé couché haltères', 4, 24, (6, 10), 2.0),
        ('p2dincli', 'Développé incliné haltères', 3, 20, (8, 12), 2.0),
        ('p3ecarte', 'Écarté haltères plat', 3, 10, (10, 15), 1.0),
        ('p4milita', 'Développé militaire haltères', 4, 16, (6, 10), 2.0),
        ('p5elevat', 'Élévations latérales', 4, 7, (12, 15), 1.0),
        ('p6extric', 'Extension triceps poulie', 3, 22.5, (10, 12), 2.5)]
PULL = [('l1rowing', 'Rowing haltère unilatéral', 4, 26, (8, 12), 2.0),
        ('l2tirver', 'Tirage vertical prise large', 4, 50, (8, 12), 2.5),
        ('l3tirhor', 'Tirage horizontal câble', 3, 45, (10, 12), 2.5),
        ('l4curlbi', 'Curl biceps haltères', 3, 11, (8, 12), 1.0),
        ('l5curlma', 'Curl marteau', 3, 12, (10, 12), 1.0)]
LEGS = [('g1squatb', 'Squat barre', 4, 65, (5, 8), 2.5),
        ('g2presse', 'Presse à cuisses', 4, 130, (8, 12), 5.0),
        ('g3fentes', 'Fentes marchées haltères', 3, 14, (10, 12), 2.0),
        ('g4legcur', 'Leg curl machine', 3, 32.5, (10, 12), 2.5),
        ('g5extqua', 'Extension quadriceps', 3, 40, (10, 15), 2.5),
        ('g6mollet', 'Mollets debout', 4, None, (15, 20), 0)]
SESSIONS = {'push': PUSH, 'pull': PULL, 'legs': LEGS}
BRAS_ID = 'u_bras2026'
BRAS = [('b1curlpu', 'Curl pupitre', 3, 20, (8, 12), 2.5),
        ('b2barfro', 'Barre au front', 3, 22.5, (8, 12), 2.5),
        ('b3oiseau', 'Oiseau haltères', 3, 6, (12, 15), 1.0)]
NOTES = ['Grosse forme aujourd\'hui', 'Épaule droite un peu sensible, charges prudentes', 'Salle bondée, repos raccourcis',
         'Nouveau record au squat !', 'Mal dormi, séance moyenne', 'Bonne séance, focus sur la technique',
         'Échauffement plus long, genou raide', 'Superbe pump']
EXTRAS = [('Dips', None, 3, (8, 12)), ('Face pull', 15, 3, (12, 15)), ('Crunch câble', 25, 3, (12, 15))]


def fmt_w(w):
    if w is None:
        return ''
    return str(int(w)) if float(w).is_integer() else str(round(w, 2))


class Lift:
    """État de progression d'un exercice (double progression)."""

    def __init__(self, base, rng, step):
        self.w, self.lo, self.hi = base, rng[0], rng[1]
        self.reps = rng[0]
        self.step = step

    def sets(self, n, rnd, deload=False, stalled=False):
        w = None if self.w is None else round(self.w * (0.9 if deload else 1) / 0.5) * 0.5
        out = []
        for i in range(n):
            r = self.reps - (1 if i == n - 1 and rnd.random() < 0.45 else 0) - (1 if i == n - 1 and rnd.random() < 0.15 else 0)
            out.append({'weight': fmt_w(w), 'reps': str(max(1, r))})
        if not deload and not stalled:
            if self.reps >= self.hi and self.w is not None:
                self.w += self.step
                self.reps = self.lo
            else:
                self.reps = min(self.hi, self.reps + (1 if rnd.random() < 0.7 else 0))
        return out


def six_mois(now_ms=None, semaines=26):
    rnd = random.Random(2026)
    now = now_ms or 1_792_200_000_000          # date de référence fixe (16/10/2026) pour des captures stables
    start = now - semaines * 7 * DAY
    lifts = {eid: Lift(base, rng, step) for lst in [*SESSIONS.values(), BRAS] for eid, _, _, base, rng, step in lst}
    history, order, k = [], ['push', 'pull', 'legs'], 0
    for week in range(semaines):
        if week in (17, 18) or week == 9:          # vacances d'août, arrêt maladie
            continue
        deload = week % 6 == 5
        per_week = 4 if rnd.random() < 0.45 else 3
        if rnd.random() < 0.12:
            per_week = 2                            # semaine chargée
        days = sorted(rnd.sample(range(7), per_week))
        for d in days:
            date = start + (week * 7 + d) * DAY + int((17.5 + rnd.random() * 3) * HOUR)
            if date > now - 2 * HOUR:
                continue
            bras = 20 <= week <= 24 and d == days[-1] and per_week == 4
            cat, prog, lst = (BRAS_ID, BRAS_ID, BRAS) if bras else (order[k % 3], 'ppl', SESSIONS[order[k % 3]])
            if not bras:
                k += 1
            exercises = []
            for eid, name, n, _base, _rng, _step in lst:
                stalled = eid == 'p1dcouch' and 12 <= week <= 15
                exercises.append({'exId': eid, 'name': name, 'sets': lifts[eid].sets(n, rnd, deload, stalled)})
            if not bras and rnd.random() < 0.18:
                name, w, n, rng = rnd.choice(EXTRAS)
                exercises.append({'name': name, 'sets': [{'weight': fmt_w(w), 'reps': str(rnd.randint(*rng))} for _ in range(n)]})
            history.append({'id': 'h%03d' % len(history), 'programme': prog, 'category': cat, 'date': date,
                            'duration': int((48 + rnd.random() * 30) * 60_000),
                            'notes': rnd.choice(NOTES) if rnd.random() < 0.15 else '', 'exercises': exercises})
    history.sort(key=lambda h: -h['date'])

    def prog_ex(lst):
        return [{'id': eid, 'name': name, 'sets': n, 'lastWeight': '', 'lastReps': '', 'pr': None, 'est1RM': None,
                 'target': None, 'rest': 120 if n == 4 else None, 'repMax': rng[1]} for eid, name, n, _b, rng, _s in lst]

    timers = lambda prog, cats: {c: max([h['date'] for h in history if h['programme'] == prog and h['category'] == c] or [None], key=lambda x: x or 0) for c in cats}
    return {
        'activeProgramme': 'ppl',
        'programmes': {
            'ppl': {'exercises': {c: prog_ex(l) for c, l in SESSIONS.items()}, 'timers': timers('ppl', SESSIONS),
                    'cooldowns': {'push': 72, 'pull': 72, 'legs': 72}},
            BRAS_ID: {'exercises': {BRAS_ID: prog_ex(BRAS)}, 'timers': timers(BRAS_ID, [BRAS_ID]), 'cooldowns': {BRAS_ID: 96}},
        },
        'customSessions': {},
        'userProgrammes': {BRAS_ID: {'name': 'Bras & épaules', 'archived': False,
                                     'sessions': {BRAS_ID: {'label': 'Bras', 'icon': '💪', 'desc': 'Biceps · Triceps · Épaules', 'color': '#AF52DE'}}}},
        'defaultRest': 90, 'unit': 'kg', 'soundOn': True, 'vibrateOn': True,
        'healthOn': False, 'musicOn': False, 'bodyWeightKg': 74.5,
        'history': history,
    }


def six_mois_json(**kw):
    return json.dumps(six_mois(**kw), ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    d = six_mois()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'donnees', 'mdlf-6-mois.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({**d, '_theme': 'auto'}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    sq = [s for h in reversed(d['history']) for e in h['exercises'] if e.get('exId') == 'g1squatb' for s in e['sets'][:1]]
    print(f"{len(d['history'])} séances, squat {sq[0]['weight']} → {sq[-1]['weight']} kg ; écrit dans {out}")
