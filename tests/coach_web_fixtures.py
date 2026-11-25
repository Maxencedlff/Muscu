"""Outils des tests de l'appli web du coach (coach-web/, docs/COACH_WEB.md).

- Serveur statique local du dépôt sur un port libre (jamais 8731, celui de la suite de l'app) ;
- faux Supabase de tests/fake_account.py injecté avant le chargement (window.supabase factice : aucun réseau, aucun
  vrai secret : code e-mail factice 123456, adresse en exemple.test) ;
- COACH_WEB_SEED : un coach factice et dix élèves réalistes (séances, records, pesées, mensurations, diète, eau,
  phases, messages), datés depuis l'horloge figée de la page (mardi 24 novembre 2026, 15 h, Europe/Paris) ;
- FAKE_APPLE_JS : faux Sign in with Apple JS servi à la place de celui d'Apple (aucun réseau) : init() garde la
  configuration, signIn() rend un faux id_token qui porte le nonce reçu (comme Apple), ou rejette avec
  window.__appleFail ('popup_closed_by_user'…) ;
- faux serveur des bilans (tests/fake_checkins.py) toujours chargé, vide ; COACH_WEB_CHECKINS_SEED (checkins=True) :
  trois modèles, un groupe, des plannings, quatre bilans répondus de Léa (le dernier pas encore répondu par le coach),
  un de Tom déjà répondu, un en attente chez Karim ;
- open_desk() : contexte, horloge, thème, seed, faux Apple JS (apple='blocked' : script injoignable), connexion par code.
"""
import contextlib
import datetime
import functools
import http.server
import os
import socket
import threading
from zoneinfo import ZoneInfo

from fake_account import FAKE_ACCOUNT
from fake_checkins import FAKE_CHECKINS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = ZoneInfo('Europe/Paris')
# Mardi 24 novembre 2026, 15 h à Paris : semaine 48, lundi 23
NOW = datetime.datetime(2026, 11, 24, 15, 0, tzinfo=TZ)
COACH_EMAIL = 'coach@exemple.test'
FAKE_CODE = '123456'   # code factice du faux serveur (tests/fake_account.py), jamais un vrai

# Coach et élèves factices. Tout est calculé dans la page, depuis son horloge figée (jours du calendrier locaux).
COACH_WEB_SEED = r"""
(() => {
  const sb = window.__sb, co = sb.co, now = Date.now();
  const at = (k, h = 18, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); d.setDate(d.getDate() - k); return d.getTime(); };
  const iso = k => { const d = new Date(at(k, 12)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const coach = sb.addPerson({ username: 'max.coach' });
  sb.users[coach].email = 'coach@exemple.test';
  sb.makeCoach(coach);
  // Verrou de l'abonnement allumé (faux StoreKit absent : seul ce drapeau est lu) et formule 25 élèves
  window.__st = window.__st || { paywallOn: true };
  sb.setTier(coach, 'com.mdlf.training.coach20.monthly');
  window.__coachId = coach;
  const EX = [['Squat', 80], ['Développé couché', 55], ['Rowing barre', 50], ['Hip thrust', 90]];
  let n = 0;
  const session = (k, label, scale = 1, recs = [], h = 18) => ({ id: 's' + (++n), date: at(k, h), duration: 3900000, label, programme: 'u_c' + coach.replace(/[^a-z0-9]/gi, '').slice(0, 8) + '_seche4', category: 'push',
    exercises: EX.map(([name, kg]) => ({ name, measure: 'reps', sets: [0, 1, 2].map(() => ({ weight: String(Math.round(kg * scale * 2) / 2), reps: '8' })) })),
    records: recs });
  const rec = (ex, after) => ({ ex, kind: 'charge', before: after - 2.5, after });
  // days : jours d'entraînement (il y a k jours) ; chaque semaine plus ancienne un peu plus léger
  const sessions = (days, recs = {}) => days.map(k => session(k, ['Haut du corps', 'Bas du corps'][k % 2], 1 - k / 400, recs[k] || [], k % 3 ? 18 : 7));
  const dietDay = (k, kcal, okMeals = 4, water = 2200) => ({ day: iso(k), plan: 'diet_seche', name: 'Sèche', kind: k % 2 ? 't' : 'r',
    meals: ['Petit-déjeuner', 'Déjeuner', 'Collation', 'Dîner'].map((x, i) => ({ n: x, ok: i < okMeals })), kcal, p: Math.round(kcal / 15), c: Math.round(kcal / 10), f: 55,
    goal: { kcal: 1800, p: 120, c: 180, f: 60 }, water, waterGoal: 2500, waterMin: null, salt: null, saltMin: null, saltMax: null });
  const prog = (student, seen = true) => co.progs.push({ coach, student, id: 'seche4', data: { name: 'Sèche 4 jours', sessions: [] }, sent_at: new Date(at(40)).toISOString(), seen });
  const weekly = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const P = [];
  const add = (username, o = {}) => {
    const id = sb.addPerson({ username, social: false, sessions: o.sessions || [] });
    sb.link(coach, id, o.since ?? at(90));
    const l = co.links.find(x => x.student === id); l.seen = o.seen ?? at(1);
    if (o.prog !== false) prog(id);
    (o.phases || []).forEach(p => sb.addPhase(id, p));
    if (o.weights) sb.share(id, o.weights);
    if (o.measures) sb.shareMeasures(id, o.measures);
    if (o.diet) sb.shareDiet(id, o.diet);
    (o.msgs || []).forEach(([k, txt]) => sb.msg(id, false, txt, at(k, 20)));
    P.push(id); return id;
  };
  // Léa : sèche semaine 5 sur 8, tout partagé, 2 messages non lus
  window.__lea = add('lea', {
    sessions: sessions([1, 2, 7, 9, 10, 12, 14, 16, 17, 19, 21, 23, 24, 26, 28, 30, 31, 33, 35, 37, 38, 40, 44, 47, 51, 54], { 9: [rec('Hip thrust', 95)], 23: [rec('Squat', 82.5)] }),
    phases: [{ goal: 'maintain', start: iso(65), weeks: 4 }, { goal: 'cut', start: iso(29 + 7), weeks: 8, prog_name: 'Sèche 4 jours' }],
    weights: weekly(40, i => ({ date: at(i * 2, 7), kg: Math.round((61.6 + i * 0.045 + ((i * 7) % 5) * 0.08) * 10) / 10 })),
    measures: { waist: weekly(6, i => ({ date: at(2 + i * 7, 8), cm: 68.5 + i * 0.5 })), hips: weekly(6, i => ({ date: at(2 + i * 7, 8), cm: 94.5 + i * 0.3 })), thighL: weekly(6, i => ({ date: at(2 + i * 7, 8), cm: 54.5 + i * 0.2 })) },
    diet: weekly(60, i => dietDay(i, i % 7 === 3 ? 2300 : 1780 + (i % 4) * 15, i % 7 === 3 ? 2 : 4, 1900 + (i % 5) * 150)).filter((_, i) => i % 9 !== 5),
    msgs: [[0, 'Je peux remplacer le riz par des pâtes ce soir ?'], [0, 'Et merci pour le programme !']],
  });
  // Tom : prise de masse, 2 records cette semaine, 1 message
  add('tom', { sessions: sessions([0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25], { 0: [rec('Squat', 120)], 2: [rec('Développé couché', 92.5)] }),
    phases: [{ goal: 'bulk', start: iso(56), weeks: 12 }], weights: weekly(20, i => ({ date: at(i * 3, 7), kg: 78.4 - i * 0.12 })),
    diet: weekly(30, i => dietDay(i, 2900 + (i % 3) * 20, 4, 3000)).map(d => ({ ...d, goal: { kcal: 2900, p: 160, c: 380, f: 80 }, p: 165 })), msgs: [[1, 'Le squat est passé !']] });
  // Karim : sèche, plus de séance depuis 9 jours, diète pas suivie
  add('karim', { sessions: sessions([9, 11, 14, 16, 18, 21]), phases: [{ goal: 'cut', start: iso(10), weeks: 6 }],
    diet: [dietDay(6, 2500, 1), dietDay(7, 2600, 1), dietDay(8, 1800, 4)] });
  // Inès : mini cut, diète pas suivie les 3 derniers jours
  add('ines', { sessions: sessions([1, 3, 6, 8, 10, 13, 15, 17, 20, 22, 24]), phases: [{ goal: 'mini_cut', start: iso(23), weeks: 4 }],
    diet: [dietDay(0, 900, 1), dietDay(1, 2600, 1), dietDay(2, 2700, 1), dietDay(3, 2650, 2), dietDay(4, 1800, 4), dietDay(5, 1790, 4), dietDay(6, 1810, 4)] });
  // Jade : reprise, diète non partagée, 1 nouvelle séance
  add('jade', { sessions: sessions([0, 3, 8]), phases: [{ goal: 'comeback', start: iso(1), weeks: 4 }], seen: at(2) });
  // Hugo : aucun programme, aucune phase
  add('hugo', { sessions: sessions([3, 6, 10, 13]), prog: false });
  // Sarah : force, 3 nouvelles séances
  add('sarah', { sessions: sessions([0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23]), phases: [{ goal: 'strength', start: iso(24), weeks: 6 }], seen: at(5),
    weights: weekly(10, i => ({ date: at(i * 4, 7), kg: 64.2 })) });
  // Nathan : prise de masse, rien à traiter
  add('nathan', { sessions: sessions([1, 3, 5, 8, 10, 12, 15, 17, 19, 22]), phases: [{ goal: 'bulk', start: iso(10), weeks: 10 }],
    diet: weekly(10, i => dietDay(i, 1800, 4)) });
  // Camille : maintien, un record
  add('camille', { sessions: sessions([0, 2, 5, 7, 9, 12, 14, 16, 19], { 0: [rec('Hip thrust', 110)] }), phases: [{ goal: 'maintain', start: iso(37), weeks: 8 }] });
  // Yanis : décharge, phase suivante dans 6 jours
  add('yanis', { sessions: sessions([2, 6, 9, 13, 16]), phases: [{ goal: 'deload', start: iso(1), weeks: 1 }, { goal: 'strength', start: iso(-6), weeks: 6 }] });
  window.__students = P;
})();
"""


APPLE_JS_URL = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/fr_FR/appleid.auth.js'
APPLE_SUB = '001234.facticeapple.0001'   # identifiant Apple factice du coach
FAKE_APPLE_JS = r"""
window.AppleID = { auth: {
  init(o) { window.__appleInit = o; },
  signIn() {
    window.__appleCalls = (window.__appleCalls || 0) + 1;
    if (window.__appleFail) return Promise.reject({ error: window.__appleFail });
    const o = window.__appleInit, b64 = x => btoa(JSON.stringify(x)).replace(/=+$/, '');
    return Promise.resolve({ authorization: { id_token: 'apple.' + b64({ sub: window.__appleSub, nonce: o.nonce, aud: o.clientId }) + '.sig', state: o.state, code: 'code-factice' } });
  },
} };
"""


# Connexion avec Google par redirection (js/desk/google.js) : signInWithOAuth enregistre la demande et « revient » sur
# l'adresse demandée avec ?code=… (aucun réseau, code factice), exchangeCodeForSession ouvre la session du compte qui
# porte l'identité Google __googleSub (sessionStorage, comme le vérificateur PKCE gardé par supabase-js) ;
# window.__googleFail : 'access_denied' (refus chez Google) ou 'flow_state_not_found' (vérificateur perdu).
FAKE_GOOGLE = r"""
(() => {
  const sb = window.__sb, cc = window.supabase.createClient, KEY = '__fakeGoogle';
  window.supabase.createClient = (u, k, o) => {
    const c = cc(u, k, o);
    c.auth.signInWithOAuth = async ({ provider, options }) => {
      sessionStorage.setItem(KEY, JSON.stringify({ provider, redirectTo: options?.redirectTo, flow: o?.auth?.flowType, code: 'codefactice' + Date.now() }));
      const g = JSON.parse(sessionStorage.getItem(KEY));
      const back = window.__googleFail === 'access_denied' ? '?error=access_denied&error_description=refus' : `?code=${g.code}`;
      setTimeout(() => { location.href = options.redirectTo + back + location.hash; }, 0);
      return { data: { provider, url: 'https://yopptmdjtnezmccdvaxf.supabase.co/auth/v1/authorize?provider=google' }, error: null };
    };
    c.auth.exchangeCodeForSession = async code => {
      const g = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      sessionStorage.removeItem(KEY);
      if (!g || g.code !== code || window.__googleFail === 'flow_state_not_found') return { data: { session: null, user: null }, error: { code: 'flow_state_not_found', message: 'invalid flow state, no valid flow state found', status: 404 } };
      const b64 = x => btoa(JSON.stringify(x)).replace(/=+$/, '');
      return c.auth.signInWithIdToken({ provider: 'google', token: 'g.' + b64({ sub: window.__googleSub || 'google-inconnu' }) + '.s' });
    };
    return c;
  };
})();
"""


def route_apple(ctx, mode='fake'):
    """Script d'Apple : faux (mode 'fake') ou injoignable ('blocked'), jamais le vrai."""
    if mode == 'blocked':
        ctx.route('https://appleid.cdn-apple.com/**', lambda r: r.abort())
    else:
        ctx.route('https://appleid.cdn-apple.com/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=FAKE_APPLE_JS))


# Bilans configurables (tests/fake_checkins.py) : modèles, groupe, plannings et bilans réalistes. Clés des questions
# libres fixes (« q » + 8 caractères) pour que les tests les retrouvent.
COACH_WEB_CHECKINS_SEED = r"""
// Après le chargement des scripts de la page (checkinDefaultItem, CHECKIN_STARTERS de js/data/checkins.js)
document.addEventListener('DOMContentLoaded', () => {
  const sb = window.__sb, ck = sb.ck, coach = window.__coachId, now = Date.now();
  const at = (k, h = 18, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); d.setDate(d.getDate() - k); return d.getTime(); };
  const iso = k => { const d = new Date(at(k, 12)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const [lea, tom, karim, ines] = window.__students;
  const hebdo = [...CHECKIN_STARTERS[0].kinds.map(checkinDefaultItem), { kind: 'custom', key: 'qdifficul', type: 'text', label: 'Ta plus grande difficulté cette semaine ?' }];
  const tHebdo = sb.ckTemplate(coach, { name: 'Hebdo sèche', items: hebdo });
  const tMois = sb.ckTemplate(coach, { name: 'Complet du mois', items: checkinStarterItems(CHECKIN_STARTERS[1], () => 0.5) });
  const tExpress = sb.ckTemplate(coach, { name: 'Express', items: CHECKIN_STARTERS[2].kinds.map(checkinDefaultItem) });
  window.__tpl = { hebdo: tHebdo, mois: tMois, express: tExpress };
  const g = sb.ckGroup(coach, 'Sèche', [lea, karim, ines]);
  window.__group = g;
  const sched = (template, student, group, freq, o = {}) => ck.schedules.push({ id: crypto.randomUUID(), coach, template, student, group, freq, weekday: 0, monthday: 1,
    send_hour: 18, timezone: 'Europe/Paris', remind_after_h: 24, due_after_h: 48, paused: false, next_at: null, ...o });
  sched(tHebdo, null, g, 'week');
  sched(tHebdo, karim, null, '2weeks');
  sched(tMois, tom, null, 'month', { remind_after_h: null, due_after_h: 72 });
  // Léa : bilans des semaines 44 à 47 (période du lundi, envoyé le dimanche 18 h, répondu le soir), avec 3 photos en S47
  const items = [...hebdo, checkinDefaultItem('photos')];
  const ids = [];
  [[29, 62.9, 70.5, 95.5, 55.2, 3, 3], [22, 62.6, 70, 95.2, 55, 4, 3], [15, 62.4, 69.2, 94.9, 54.8, 3, 4], [8, 62.2, 68.5, 94.5, 54.5, 3, 4]].forEach(([k, kg, waist, hips, thigh, sleep, energy], i) => {
    const sent = at(k - 6, 18);
    const id = sb.ckRequest(coach, lea, { name: 'Hebdo sèche', items, template: tHebdo, sentAt: sent, dueAt: sent + 48 * 3600e3, periodStart: iso(k) });
    const ans = { weight: kg, measures: { waist, hips, thighL: thigh }, diet_adherence: { done: 5 + (i % 2), of: 7 }, training_adherence: { done: 4, of: 4 },
      steps: 8200 + i * 230, sleep, energy, hunger: 4, stress: 2 + (i % 2), pain: { yes: false },
      qdifficul: i === 3 ? 'La collation de 16 h au travail, je n\'ai pas toujours le temps.' : 'Rien de spécial.' };
    if (i === 3) ans.photos = { ids: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] };
    sb.ckAnswer(id, ans, sent + 2 * 3600e3);
    if (i < 3) sb.ckReview(id, { reply: 'Bien joué, on continue.', score: 7 });
    ids.push(id);
  });
  window.__leaLast = ids[3];
  // Tom : un bilan du mois, déjà répondu par le coach
  const tr = sb.ckRequest(coach, tom, { name: 'Complet du mois', items: checkinStarterItems(CHECKIN_STARTERS[1], () => 0.5), template: tMois, sentAt: at(23, 9), periodStart: iso(23) });
  sb.ckAnswer(tr, { weight: 78.1, sleep: 4, energy: 4 }, at(22, 12));
  sb.ckReview(tr, { reply: 'Parfait.', score: 8 });
  // Karim : bilan envoyé dimanche, pas encore rempli
  sb.ckRequest(coach, karim, { name: 'Hebdo sèche', items: hebdo, template: tHebdo, sentAt: at(2, 18), dueAt: at(0, 18) + 3600e3, periodStart: iso(8) });
});
"""


# Vague 4 (v4=True) : programme complet envoyé à Léa (top set et back-off, drop set, consignes), compte du coach
# (profiles.doc : ses programmes et ses plans diète), plan diète envoyé à Léa (elle accepte les plans), une conversation
# suivie avec Léa (messages du coach et de l'élève, du plus ancien au plus récent ; les 2 derniers restent non lus) et
# un commentaire de séance. Après COACH_WEB_SEED (mêmes élèves, même horloge).
COACH_WEB_V4_SEED = r"""
(() => {
  const sb = window.__sb, co = sb.co, now = Date.now(), coach = window.__coachId, [lea, tom] = window.__students;
  const at = (k, h = 18, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); d.setDate(d.getDate() - k); return d.getTime(); };
  const ex = (name, sets, lo, hi, o = {}) => ({ name, sets, repMin: lo, repMax: hi, ...o });
  const seche = { name: 'Sèche 4 jours', consigne: 'Garde 1 à 2 reps en réserve, sauf sur le top set.', sessions: [
    { key: 'haut-a', label: 'Haut A', color: '#FF9F0A', exercises: [
      ex('Développé couché', 4, 6, 8, { loads: [45, 40, 40, 40], intens: 'topback', rest: 150, consigne: '2 reps en réserve sur le top set' }),
      ex('Rowing barre', 4, 8, 10, { load: 50, rest: 120, consigne: 'Dos gainé, tirer vers le nombril' }),
      ex('Développé militaire haltères', 3, 8, 10, { load: 12, rest: 120 }),
      ex('Élévations latérales', 3, 12, 15, { load: 6, rest: 60, intens: 'drop-last', consigne: 'Descendre à 4 kg sur la dernière' }),
      ex('Curl incliné haltères', 3, 10, 12, { load: 8, rest: 90 }) ] },
    { key: 'bas-a', label: 'Bas A', color: '#30D158', exercises: [
      ex('Squat', 4, 6, 8, { load: 80, rest: 180 }), ex('Hip thrust', 3, 8, 12, { load: 90, rest: 120, intens: 'cluster-last', intensOn: { plan: 'cluster-last', sets: [1] } }),
      ex('Leg curl allongé', 3, 10, 12, { load: 30, rest: 90 }) ] },
    { key: 'haut-b', label: 'Haut B', color: '#FF9F0A', exercises: [ex('Tirage vertical', 3, 10, 12, { load: 40 }), ex('Dips', 3, 8, 12)] },
    { key: 'bas-b', label: 'Bas B', color: '#30D158', exercises: [ex('Soulevé de terre roumain', 3, 8, 10, { load: 60 }), ex('Fentes bulgares', 3, 10, 12)] } ] };
  const p = co.progs.find(x => x.student === lea && x.id === 'seche4');
  p.data = JSON.parse(JSON.stringify(seche)); p.sent_at = new Date(at(30, 9)).toISOString(); p.seen = true;
  // Compte du coach : le programme « seche4 » (sans les charges de Léa) et « force3 », deux plans diète
  const item = (id, name, g, per) => ({ id, name, food: null, fam: 'autre', g, per, src: 'perso' });
  const meal = (id, name, items) => ({ id, name, items });
  const plan = { name: 'Sèche', targets: { kcal: 1800, p: 120, c: 180, f: 60, water: 2.5 }, meals: [
    meal('m1', 'Petit-déjeuner', [item('a1', 'Flocons d\'avoine', 60, { k: 370, p: 13, c: 60, f: 7 }), item('a2', 'Skyr', 150, { k: 60, p: 11, c: 4, f: 0 })]),
    meal('m2', 'Déjeuner', [item('a3', 'Riz basmati cru', 80, { k: 350, p: 8, c: 77, f: 1 }), item('a4', 'Poulet', 150, { k: 120, p: 23, c: 0, f: 2 })]),
    meal('m3', 'Collation', [item('a5', 'Fromage blanc 0 %', 200, { k: 45, p: 8, c: 4, f: 0 }), item('a6', 'Amandes', 15, { k: 600, p: 21, c: 8, f: 52 })]),
    meal('m4', 'Dîner', [item('a7', 'Saumon', 120, { k: 200, p: 20, c: 0, f: 13 }), item('a8', 'Patate douce', 200, { k: 86, p: 2, c: 20, f: 0 })]) ] };
  const strip = s => ({ ...s, exercises: s.exercises.map(({ load, loads, ...e }) => ({ ...e, id: e.name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10) })) });
  sb.docs = { [coach]: {
    myProgrammes: ['u_seche4', 'u_force3'],
    userProgrammes: { u_seche4: { name: 'Sèche 4 jours', sessions: Object.fromEntries(seche.sessions.map(s => [s.key, { label: s.label, color: s.color }])), order: seche.sessions.map(s => s.key) },
      u_force3: { name: 'Force 3 jours', sessions: { a: { label: 'Jour A', color: '#FF9F0A' }, b: { label: 'Jour B', color: '#30D158' } }, order: ['a', 'b'] } },
    programmes: { u_seche4: { exercises: Object.fromEntries(seche.sessions.map(s => [s.key, strip(s).exercises])) },
      u_force3: { exercises: { a: [{ id: 'sq', name: 'Squat', sets: 5, repMax: 5, repFixed: true }], b: [{ id: 'dc', name: 'Développé couché', sets: 5, repMax: 5, repFixed: true }] } } },
    dietPlans: { d_seche: plan, d_masse: { ...plan, name: 'Masse', targets: { kcal: 2900, p: 160, c: 380, f: 80, water: 3 } } },
  } };
  // Plan diète envoyé à Léa (elle accepte les plans de son coach)
  co.shares.push({ student: lea, coach, kind: 'diet', granted_at: new Date(at(40)).toISOString() });
  co.progs.push({ coach, student: lea, id: 'diet_seche', data: { kind: 'diet', v: 1, diet: plan }, sent_at: new Date(at(30, 10)).toISOString(), seen: true });
  // Conversation suivie avec Léa, dans l'ordre ; tout lu sauf les 2 derniers messages de Léa
  co.msgs = co.msgs.filter(m => m.student !== lea);
  [[9, 19, 14, false, 'Bilan envoyé ! Grosse semaine, j\'ai eu du mal à tenir la collation mercredi et vendredi.'],
   [8, 13, 40, true, 'Très beau bilan Léa, les charges tiennent en sèche. On garde les calories.'],
   [8, 13, 41, true, 'Ajoute la collation de 16 h les jours de séance, c\'est elle qui manque le plus souvent.'],
   [8, 14, 1, false, 'Ok pour la collation, je la prépare la veille alors'],
   [2, 9, 5, true, 'Comment s\'est passé le développé couché hier ?']].forEach(([k, h, m, fromCoach, body]) => sb.msg(lea, fromCoach, body, at(k, h, m)));
  const lastRead = co.msgs.filter(m => m.student === lea).at(-1).id;
  co.reads[lea] = { coach: lastRead, student: lastRead };
  sb.msg(lea, false, 'Je peux remplacer le riz par des pâtes ce soir ?', at(0, 11, 2));
  sb.msg(lea, false, 'Et pour le militaire je suis restée à 12 kg, je n\'arrivais pas à 8 reps', at(0, 11, 4));
  // Commentaire du coach sur l'avant-dernière séance de Léa
  // (séances de Léa : s1 il y a 1 jour, s2 il y a 2 jours, créées en premier par COACH_WEB_SEED)
  co.notes.push({ coach, student: lea, sid: 's2', text: 'Belle séance, garde ce tempo sur le squat.', updated_at: new Date(at(2, 20)).toISOString(), seen: true });
  window.__v4 = { lastRead };
})();
"""


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


@contextlib.contextmanager
def static_server():
    """Sert le dépôt sur un port libre de localhost (jamais 8731) ; rend l'adresse de coach-web/."""
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    if port == 8731:
        port = 8733
    handler = functools.partial(_Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield f'http://127.0.0.1:{port}/coach-web/'
    finally:
        srv.shutdown()


def launch(pw, engine):
    """Navigateur sans fenêtre ; Chromium muet (--mute-audio)."""
    args = ['--mute-audio'] if engine == 'chromium' else []
    return getattr(pw, engine).launch(headless=True, args=args)


def open_desk(browser, url, *, width, height=900, theme='dark', touch=False, seed=True, login=True, fake_opts=None, apple='fake', checkins=False, v4=False, host=False, pre=None):
    """Page de l'appli web du coach, horloge figée, faux serveur injecté, coach connecté (sauf login=False)."""
    ctx = browser.new_context(viewport={'width': width, 'height': height}, color_scheme=theme, locale='fr-FR',
                              timezone_id='Europe/Paris', has_touch=touch, device_scale_factor=1)
    route_apple(ctx, apple)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.clock.install(time=NOW)
    opts = fake_opts or {}
    page.add_init_script('window.__fakeOpts = ' + __import__('json').dumps(opts) + ';')
    page.add_init_script("window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));")
    page.add_init_script(FAKE_ACCOUNT)
    page.add_init_script(FAKE_GOOGLE)
    page.add_init_script(FAKE_CHECKINS)
    if seed:
        page.add_init_script(COACH_WEB_SEED)
    if seed and checkins:
        page.add_init_script(COACH_WEB_CHECKINS_SEED)
    if seed and v4:
        page.add_init_script(COACH_WEB_V4_SEED)
    if pre:
        page.add_init_script(pre)   # état du faux serveur posé après les données (pannes, renommages)
    if host:
        # App hôte (docs/COACH_WEB.md, « Embarquer dans l'app ») : session du faux serveur, bouton « Revenir à l'appli »
        page.add_init_script("window.MDLF_COACH_HOST = { session: { access_token: 'h.' + btoa(JSON.stringify({ sub: window.__coachId })) + '.s', refresh_token: 'r' }, exit() { window.__exited = true; } };")
    page.goto(url)
    page.wait_for_selector('#app > *')
    if login:
        page.fill('#login-email', COACH_EMAIL)
        page.click('form[data-form="email"] button')
        page.wait_for_selector('#login-code')
        page.fill('#login-code', FAKE_CODE)
        page.click('form[data-form="code"] button')
        page.wait_for_selector('.lst, .empty:not([role="status"])')
    page.errors = errors
    return ctx, page
