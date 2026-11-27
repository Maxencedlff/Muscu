// ═══════════════════════════════════════════════════════════
//  Bilans configurables, écrans de l'élève (docs/BILANS.md, « App iPhone (élève) ») : carte « Bilan à remplir » de
//  l'accueil, écran du bilan (route `checkin:ID`, ouvert aussi par les notifications checkin et checkin_reminder),
//  accord pour le cycle menstruel. Données et envoi : js/data/checkin-student.js ; formes : js/data/checkins.js.
//
//  - Rubriques dans l'ordre de la maquette : Corps, Photos, Ta semaine, Plan et activité, Question(s) du coach ;
//    dans une rubrique, l'ordre choisi par le coach. Suivis figés à l'envoi (items de la demande).
//  - Rien au pointerdown : tout se fait au clic (un seul toucher sur iOS). Un choix redessine seulement son suivi,
//    le focus revient sur le bouton touché (VoiceOver garde sa place).
//  - Chaque réponse touchée est gardée en brouillon sur l'iPhone ; « Plus tard » revient en arrière, le brouillon
//    reste. Rien ne part avant « Envoyer » (confirmation : un bilan envoyé ne se modifie plus).
//  - Photos : le circuit existant des photos de bilan chiffrées (coffre, cphSend) ; le bilan joint les photos
//    envoyées au coach depuis l'arrivée de la demande. Mêmes règles d'âge (cphAgeBlocked).
//  Tout texte venu du serveur passe par esc().
// ═══════════════════════════════════════════════════════════
'use strict';

// Réponses en cours (écran ouvert) : answers (valeurs telles que saisies), skipped (« Passer »), from (source du
// préremplissage), touched (clés touchées : seules elles vont au brouillon, le reste suit ce que l'app sait)
let ckForm = { id: null, answers: {}, skipped: new Set(), from: {}, touched: new Set(), bad: new Set() };
let ckShown = '';   // empreinte de l'état dessiné (redessin seulement s'il change : jamais pendant la saisie)

const CK_ICONS = { weight: 'bathroom.scale', measures: 'ruler', photos: 'camera', diet_adherence: 'fork.knife', training_adherence: 'dumbbell',
  steps: 'figure.run', cardio: 'heart', cycle: 'calendar' };
const CK_UNITS = { kg: 'kg', cm: 'cm', steps: 'pas', min: 'min', h: 'h' };
// Rubriques de l'écran (maquette 8) : clé, titre
const CK_SECTIONS = [['body', 'Corps'], ['photos', 'Photos'], ['feel', 'Ta semaine'], ['activity', 'Plan et activité'], ['custom', '']];
const ckWho = () => esc(coachName() || myCoachWord('ton'));
const ckDomKey = k => String(k).replace(/[^a-z0-9_]/gi, '');
const ckSection = it => (it.kind === 'photos' ? 'photos' : it.kind === 'custom' ? 'custom' : checkinKind(it.kind)?.group || 'custom');

// ── Accueil ─────────────────────────────────────────────────

// Carte « Bilan à remplir » (la demande la plus pressée), sinon « Alex a répondu à ton bilan » tant qu'elle n'est pas lue
function checkinHomeCard() {
  if (!account.user || !myCoach() || ck.available === false) return '';
  const open = checkinOpen(), who = ckWho();
  if (open.length) {
    const r = open[0], due = checkinDueText(r);
    return `
    <section class="home-card account-card ck-home" aria-labelledby="ckHomeTitle">
      <div class="account-card__text">
        <h2 class="account-card__title" id="ckHomeTitle">${open.length > 1 ? `${open.length} bilans à remplir` : 'Bilan à remplir'}</h2>
        <p class="account-card__sub">${esc(r.name)}, ${elide('de', who)}${due ? `, ${esc(due)}` : ''}</p>
      </div>
      <button class="account-card__btn" data-action="ck-open" data-id="${esc(r.id)}" aria-label="Remplir le bilan ${esc(r.name)}">Remplir</button>
    </section>`;
  }
  const rv = checkinUnreadReview();
  if (!rv) return '';
  return `
    <section class="home-card account-card ck-home" aria-labelledby="ckHomeTitle">
      <div class="account-card__text">
        <h2 class="account-card__title" id="ckHomeTitle">${who} a répondu à ton bilan</h2>
        <p class="account-card__sub">${esc(rv.name)}</p>
      </div>
      <button class="account-card__btn" data-action="ck-open" data-id="${esc(rv.id)}" aria-label="Lire la réponse ${elide('de', who)}">Lire</button>
    </section>`;
}
// Réponse du coach pas encore lue sur cet iPhone (lue = écran du bilan ouvert)
const CK_SEEN_KEY = 'mdlf_checkin_seen';   // { userId, seen: { [demande]: date de la réponse lue } }
function checkinSeenMap() { return ckRead(CK_SEEN_KEY, 'seen')?.seen || {}; }
function checkinUnreadReview() {
  const seen = checkinSeenMap();
  return checkinList().find(r => r.answeredAt && r.review?.reply && (r.review.at || 1) !== seen[r.id]) || null;
}
function checkinMarkSeen(req) {
  if (!req?.review?.reply) return;
  const seen = checkinSeenMap();
  if (seen[req.id] === (req.review.at || 1)) return;
  const kept = Object.entries({ ...seen, [req.id]: req.review.at || 1 }).slice(-20);
  ckWrite(CK_SEEN_KEY, 'seen', Object.fromEntries(kept));
}
// Déconnexion : rien ne reste (comme les autres clés des bilans)
onAccountChange(() => { if (!account.user) { try { localStorage.removeItem(CK_SEEN_KEY); } catch { /* rien */ } } });

// Mon coach : cellule « Bilans » (à poser dans renderCoachMine, js/features/coach-ui.js), avec l'accord du cycle
function checkinMineCellHtml() {
  const list = checkinList();
  if (!list.length) return '';
  const open = checkinOpen();
  const cycle = !checkinCycleBlocked() && (ck.cycle || ck.cycleAsked) ? `
          <button class="cell cell--nav" data-action="${ck.cycle ? 'ck-cycle-withdraw' : 'ck-cycle-offer'}">
            ${icon('calendar', 20)}
            <span class="cell__body"><span class="cell__title">Cycle menstruel</span>
              <span class="cell__sub">${ck.cycle ? 'Partagé dans tes bilans' : 'Pas partagé'}</span></span>
            ${icon('chevron.right', 16)}
          </button>` : '';
  // Accord daté pour l'envoi des bilans (serveur qui le connaît) : donné (avec sa date) ou à donner, retrait ici
  const health = ck.health ? `
          <button class="cell cell--nav" data-action="${ck.health.consented ? 'ck-health-withdraw' : 'ck-health-offer'}">
            ${icon('checkmark.seal', 20)}
            <span class="cell__body"><span class="cell__title">Accord pour mes bilans</span>
              <span class="cell__sub">${ck.health.consented ? esc(ck.health.at ? `Donné le ${fmtDate(ck.health.at, 'short')}` : 'Donné') : 'Pas donné : tes bilans ne partent pas'}</span></span>
            ${icon('chevron.right', 16)}
          </button>` : '';
  return `
        <div class="group-title">Bilans</div>
        <div class="group">
          <button class="cell cell--nav" data-action="ck-open" data-id="${esc((open[0] || list[0]).id)}">
            ${icon('doc.text', 20)}
            <span class="cell__body"><span class="cell__title">${esc((open[0] || list[0]).name)}</span>
              <span class="cell__sub">${open.length ? esc(checkinDueText(open[0]) || 'À remplir') : 'Envoyé'}</span></span>
            ${icon('chevron.right', 16)}
          </button>${health}${cycle}
        </div>`;
}

// ── Écran du bilan ──────────────────────────────────────────

function ckStateKey(req) {
  return req ? `${req.id}|${checkinState(req)}|${req.review?.reply || ''}|${ck.cycle}|${ck.cycleAsked}|${ck.adult}|${ck.adultAsked}|${ck.health?.consented}|${checkinItemsShown(req).map(i => i.key).join(',')}` : `none|${ck.loading}|${ck.available}|${ck.error}`;
}
function ckFormFor(req) {
  if (ckForm.id === req.id) return ckForm;
  const st = checkinStart(req);
  const dr = checkinDraft(req.id);
  ckForm = { id: req.id, answers: st.answers, skipped: st.skipped, from: st.from, touched: new Set(Object.keys(dr?.answers || {})), bad: new Set() };
  return ckForm;
}
function ckSaveDraft() {
  if (!ckForm.id) return;
  const answers = Object.fromEntries(Object.entries(ckForm.answers).filter(([k]) => ckForm.touched.has(k)));
  checkinDraftSave(ckForm.id, { answers, skipped: [...ckForm.skipped] });
}

function renderCheckin(id) {
  const req = checkinById(id);
  ckShown = ckStateKey(req);
  if (!req) return renderCheckinMissing();
  const state = checkinState(req);
  if (state !== 'open') return renderCheckinDone(req, state);
  const f = ckFormFor(req), who = ckWho();
  const items = checkinItemsShown(req);
  const busy = ck.sending.has(req.id);
  const left = `<button class="navbar__text" data-action="ck-later">Plus tard</button>`;
  const right = `<button class="navbar__text navbar__text--bold" data-action="ck-send" data-id="${esc(req.id)}" ${busy ? 'disabled aria-busy="true"' : ''} aria-label="Envoyer le bilan à ${who}">Envoyer</button>`;
  const due = checkinDueText(req);
  const meta = [checkinPeriodText(req), `environ ${plural(checkinMinutes(items), 'minute', 'minutes')}`, due].filter(Boolean).join(', ');
  const sections = CK_SECTIONS.map(([sec, title]) => {
    const list = items.filter(it => ckSection(it) === sec);
    const offer = sec === 'feel' ? ckAdultOfferHtml() + ckCycleOfferHtml(req) : '';
    if (!list.length && !offer) return '';
    if (sec === 'photos') return list.map(it => ckPhotoHtml(req, it)).join('');
    const head = sec === 'custom' ? `${list.length > 1 ? 'Questions' : 'Question'} ${elide('de', who)}` : title;
    return `${list.length ? `<h2 class="group-title">${head}</h2><div class="group ck-group">${list.map(it => ckItemHtml(req, it, f)).join('')}</div>` : ''}${offer}`;
  }).join('');
  return `
    <div class="view view--grouped ck-view" data-id="${esc(req.id)}">
      ${navBar({ title: '', large: false, left, right })}
      <div class="scr">
        <h1 class="scr-title ck-title" id="ckTitle" tabindex="-1" data-bar-title="${esc(ckBarTitle(req))}">${esc(req.name)}</h1>
        <div class="ck-head">
          ${personAvatar(myCoach(), 'm')}
          <div class="ck-head__text">
            <p class="ck-head__title">${who} t'a demandé ton bilan</p>
            <p class="ck-head__sub">${esc(meta)}.</p>
          </div>
        </div>
        ${sections}
        <p class="group-foot ck-privacy">${who} voit tes réponses dès que tu envoies ce bilan, avec leur date. Rien ne part avant. Un suivi passé ne lui est pas envoyé. Si tu quittes ${myCoachWord('ton')}, tes bilans lui sont retirés.</p>
        <button class="ck-send" data-action="ck-send" data-id="${esc(req.id)}" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? 'Envoi…' : `Envoyer à ${who}`}</button>
      </div>
    </div>`;
}

// Titre repris par la barre au défilement : le nom s'il est court, sinon « Bilan » (entre « Plus tard » et « Envoyer »,
// il ne tient pas sur un iPhone SE : jamais un titre coupé)
function ckBarTitle(req) { return Array.from(req.name).length <= 12 ? req.name : 'Bilan'; }

function renderCheckinMissing() {
  const head = navBar({ title: 'Bilan', large: false });
  const loading = ck.loading || (ck.available === null && !ck.error);
  const offline = ck.error === 'offline';
  const body = loading ? '<div class="empty-note">Chargement…</div>' : `
        <div class="ck-empty">
          <h1 class="ck-empty__title" id="ckTitle" tabindex="-1">${offline ? 'Pas d\'Internet' : 'Bilan introuvable'}</h1>
          <p class="ck-empty__text">${offline ? `Ce bilan s'affichera quand ton ${phoneName()} sera connecté.` : `${ckWho()} l'a peut-être fermé, ou en a envoyé un nouveau.`}</p>
          <button class="btn btn--secondary ck-empty__btn" data-action="${offline ? 'ck-retry' : 'go-home'}">${offline ? 'Réessayer' : 'Revenir à l\'accueil'}</button>
        </div>`;
  return `<div class="view view--grouped ck-view">${head}<div class="scr">${body}</div></div>`;
}

// Envoyé, en attente du réseau, ou fermé : récapitulatif et réponse du coach
function renderCheckinDone(req, state) {
  const who = ckWho();
  const head = navBar({ title: '', large: false });
  const title = state === 'sent' ? `Envoyé à ${who}` : state === 'queued' ? 'En attente du réseau' : 'Bilan fermé';
  const sub = state === 'sent' ? `Le ${esc(fmtDate(req.answeredAt, 'day'))} à ${esc(fmtTime(req.answeredAt))}. ${who} voit tes réponses.`
    : state === 'queued' ? `Ton bilan est gardé sur ${thePhone()}. Il partira tout seul dès que tu seras connecté.`
    : `${who} a fermé ce bilan. Tu recevras le prochain ici.`;
  const items = checkinItemsShown(req);
  const local = state === 'queued' ? checkinOutbox()[req.id]?.answers || {} : req.answers || {};
  const rows = items.filter(it => Object.hasOwn(local, it.key)).map(it => `
          <div class="cell ck-recap"><span class="cell__body"><span class="cell__title">${esc(it.label)}</span><span class="cell__sub">${esc(checkinValueText(it, local[it.key]))}</span></span></div>`).join('');
  const reply = req.review?.reply ? `
        <h2 class="group-title">Réponse ${elide('de', who)}</h2>
        <div class="group"><div class="cell ck-reply"><span class="cell__body"><span class="cell__title ck-reply__text">${esc(req.review.reply)}</span>${req.review.at ? `<span class="cell__sub">Le ${esc(fmtDate(req.review.at, 'day'))}</span>` : ''}</span></div></div>` : state === 'sent'
    ? `<p class="group-foot">${who} te répondra ici. Tu recevras une notification si tu les as activées.</p>` : '';
  return `
    <div class="view view--grouped ck-view ck-view--done">
      ${head}
      <div class="scr">
        <div class="ck-done">
          <span class="ck-done__mark ck-done__mark--${state}" aria-hidden="true">${icon(state === 'sent' ? 'checkmark' : state === 'queued' ? 'clock.history' : 'xmark', 22)}</span>
          <h1 class="ck-done__title" id="ckTitle" tabindex="-1" data-echo-title data-bar-title="${esc(ckBarTitle(req))}">${title}</h1>
          <p class="ck-done__name">${esc(req.name)}</p>
          <p class="ck-done__sub" role="status">${sub}</p>
        </div>
        ${reply}
        ${rows ? `<h2 class="group-title">Tes réponses</h2><div class="group">${rows}</div>` : ''}
      </div>
    </div>`;
}

// ── Suivis ──────────────────────────────────────────────────

function ckIcon(it) { const n = CK_ICONS[it.kind]; return n ? `<span class="ck-ico" aria-hidden="true">${icon(n, 20)}</span>` : ''; }
// « Passer » (suivi facultatif) ou « Obligatoire »
function ckSkipHtml(it) {
  if (it.required) return `<span class="ck-req">Obligatoire</span>`;
  return `<button class="ck-skip" data-action="ck-skip" data-key="${esc(it.key)}" aria-label="Passer : ${esc(it.label)}">Passer</button>`;
}
function ckItemHtml(req, it, f) {
  const k = ckDomKey(it.key);
  const inner = f.skipped.has(it.key) ? ckSkippedHtml(it)
    : it.type === 'number' && it.kind === 'measures' ? ckMeasuresHtml(it, f)
    : it.type === 'number' ? ckNumberHtml(it, f)
    : it.type === 'scale' ? ckScaleHtml(it, f)
    : it.type === 'yesno' ? ckYesNoHtml(it, f)
    : it.type === 'text' ? ckTextHtml(it, f)
    : it.type === 'auto' ? ckAutoHtml(req, it, f)
    : it.type === 'choice' ? ckCycleHtml(it, f) : '';
  return `<div class="ck-item ck-item--${it.type}${f.bad.has(it.key) ? ' ck-item--bad' : ''}" data-key="${esc(it.key)}" id="ck-i-${k}">${inner}</div>`;
}
function ckSkippedHtml(it) {
  return `<div class="ck-row">${ckIcon(it)}<span class="ck-label" id="ck-l-${ckDomKey(it.key)}">${esc(it.label)}</span>
      <span class="ck-passed">Passé</span>
      <button class="ck-skip" data-action="ck-unskip" data-key="${esc(it.key)}" aria-label="Répondre : ${esc(it.label)}">Répondre</button></div>`;
}
function ckFmtNum(v) { return typeof v === 'number' ? String(v).replace('.', ',') : typeof v === 'string' ? v : ''; }
function ckNumField(id, it, value, unit, label, describedBy) {
  const int = it.unit === 'steps' || it.unit === 'min';
  return `<span class="ck-field"><input id="${id}" class="ck-input num" type="text" inputmode="${int ? 'numeric' : 'decimal'}" autocomplete="off" enterkeyhint="done"
      data-ck="num" data-key="${esc(it.key)}" value="${esc(ckFmtNum(value))}" aria-label="${esc(label)}${unit ? `, en ${esc(unit === 'pas' ? 'pas par jour' : unit === 'min' ? 'minutes' : unit === 'h' && it.kind === 'sleep' ? 'heures par nuit' : unit)}` : ''}"${describedBy ? ` aria-describedby="${describedBy}"` : ''}>${unit ? `<span class="ck-unit" aria-hidden="true">${esc(unit)}</span>` : ''}</span>`;
}
function ckHelpWeight(f, it) {
  if (f.from[it.key] !== 'weight') return '';
  const last = sharedWeightsPayload(data)[0];
  if (!last) return '';
  const n = daysAgo(last.date);
  return `Ta dernière pesée, ${n === 0 ? 'aujourd\'hui' : n === 1 ? 'hier' : `le ${fmtDate(last.date, 'short')}`}. Touche pour corriger.`;
}
function ckNumberHtml(it, f) {
  const k = ckDomKey(it.key);
  const unit = it.kind === 'custom' ? it.unit || '' : CK_UNITS[it.unit] || '';
  const fromHealth = f.from[it.key] === 'health';
  const help = it.kind === 'weight' ? ckHelpWeight(f, it) : it.kind === 'steps' ? (fromHealth ? 'Moyenne lue dans Santé. Touche pour corriger.' : 'Moyenne de tes pas par jour sur la période.')
    : it.kind === 'cardio' ? (fromHealth ? 'Minutes de cardio lues dans Santé sur la période. Touche pour corriger.' : 'Minutes de cardio sur la période.')
    : it.kind === 'sleep' ? (fromHealth ? `${ckSleepHealthText() || 'Moyenne lue dans Santé'}. Touche pour corriger.` : 'Heures de sommeil par nuit, en moyenne (7,5 pour 7 h 30).') : '';
  const bad = f.bad.has(it.key) ? ckNumberError(it) : '';
  return `<div class="ck-row ck-row--num">${ckIcon(it)}<label class="ck-label" for="ck-in-${k}" id="ck-l-${k}">${esc(it.label)}</label>
      ${ckNumField(`ck-in-${k}`, it, f.answers[it.key], unit, it.label, help || bad ? `ck-h-${k}` : '')}</div>
    <div class="ck-foot"><p class="ck-help${bad ? ' ck-help--bad' : ''}" id="ck-h-${k}">${esc(bad || help)}</p>${ckSkipHtml(it)}</div>`;
}
// « 7 h 05 par nuit en moyenne sur 6 nuits, d'après Santé » : sommeil lu pour CE bilan, ou ''
function ckSleepHealthText() {
  const h = ck.hk?.id === ckForm.id && checkinHealthAllowed() ? ck.hk : null;
  if (!h || !Number.isFinite(h.sleepMin) || !h.nights) return '';
  return `${checkinHoursText(h.sleepMin / 60)} par nuit en moyenne sur ${plural(h.nights, 'nuit', 'nuits')}, d'après Santé`;
}
function ckNumberError(it) {
  const [lo, hi] = CHECKIN_NUMBER_RANGE[it.kind === 'custom' ? 'custom' : it.unit] || CHECKIN_NUMBER_RANGE.custom;
  const u = it.kind === 'custom' ? it.unit || '' : CK_UNITS[it.unit] || '';
  return `Écris un nombre entre ${fmtNum(lo)} et ${fmtNum(hi)}${u ? ` ${u}` : ''}.`;
}
function ckMeasuresHtml(it, f) {
  const k = ckDomKey(it.key), v = f.answers[it.key] && typeof f.answers[it.key] === 'object' ? f.answers[it.key] : {};
  const rows = (it.options?.keys || []).map((mk, i) => `
    <div class="ck-row ck-row--num${i ? ' ck-row--sub' : ''}">${i ? '<span class="ck-ico" aria-hidden="true"></span>' : ckIcon(it)}<label class="ck-label" for="ck-in-${k}-${mk}">${esc(bodyMeasureLabel(mk) || CHECKIN_MEASURE_LABELS[mk] || mk)}</label>
      ${ckNumField(`ck-in-${k}-${mk}`, { ...it, mk }, v[mk], 'cm', bodyMeasureLabel(mk) || mk, '').replace('data-ck="num"', `data-ck="measure" data-mk="${esc(mk)}"`)}</div>`).join('');
  const bad = f.bad.has(it.key) ? 'Écris des mesures entre 10 et 250 cm.' : '';
  const help = bad || (f.from[it.key] === 'measures' ? 'Tes dernières mesures. Touche pour corriger.' : 'Mesure-toi le matin, à jeun.');
  return `<span class="visually-hidden" id="ck-l-${k}">${esc(it.label)}</span>${rows}
    <div class="ck-foot"><p class="ck-help${bad ? ' ck-help--bad' : ''}">${esc(help)}</p>${ckSkipHtml(it)}</div>`;
}
function ckScaleHtml(it, f) {
  const k = ckDomKey(it.key), n = it.scale === 10 ? 10 : 5, cur = f.answers[it.key];
  const segs = Array.from({ length: n }, (_, i) => {
    const v = i + 1, on = cur === v;
    const bound = v === 1 && it.lo ? `, ${it.lo}` : v === n && it.hi ? `, ${it.hi}` : '';
    return `<button type="button" role="radio" aria-checked="${on}" class="ck-seg${on ? ' ck-seg--on' : ''}" data-action="ck-pick" data-key="${esc(it.key)}" data-v="${v}" aria-label="${v} sur ${n}${esc(bound)}">${v}</button>`;
  }).join('');
  return `<div class="ck-row ck-row--head">${ckIcon(it)}<span class="ck-label" id="ck-l-${k}">${esc(it.label)}</span>${ckSkipHtml(it)}</div>
    <div class="ck-scale ck-scale--${n}" role="radiogroup" aria-labelledby="ck-l-${k}">${segs}</div>
    ${it.lo || it.hi ? `<div class="ck-bounds" aria-hidden="true"><span><span class="ck-bound-n">1\u00a0: </span>${esc(it.lo)}</span><span><span class="ck-bound-n">${n}\u00a0: </span>${esc(it.hi)}</span></div>` : ''}
    ${it.kind === 'sleep' && ckSleepHealthText() ? `<p class="ck-help ck-help--health">${esc(ckSleepHealthText())}. À toi de dire comment tu as dormi.</p>` : ''}`;
}
function ckYesNoHtml(it, f) {
  const k = ckDomKey(it.key), v = f.answers[it.key], yes = v?.yes === true, no = v?.yes === false;
  const seg = (val, label, on) => `<button type="button" role="radio" aria-checked="${on}" class="ck-seg${on ? ' ck-seg--on' : ''}" data-action="ck-yesno" data-key="${esc(it.key)}" data-v="${val}">${label}</button>`;
  const ph = it.kind === 'pain' ? 'Où, depuis quand ?' : 'Ajoute un mot si tu veux';
  return `<div class="ck-row ck-row--yesno">${ckIcon(it)}<span class="ck-label" id="ck-l-${k}">${esc(it.label)}</span>
      <div class="ck-yesno" role="radiogroup" aria-labelledby="ck-l-${k}">${seg('no', 'Non', no)}${seg('yes', 'Oui', yes)}</div></div>
    ${yes ? `<textarea class="ck-text" data-ck="note" data-key="${esc(it.key)}" rows="2" maxlength="${CHECKIN_TEXT_MAX}" placeholder="${esc(ph)}" aria-label="${esc(it.label)} : précise">${esc(v.note || '')}</textarea>` : ''}
    <div class="ck-foot"><p class="ck-help"></p>${ckSkipHtml(it)}</div>`;
}
function ckTextHtml(it, f) {
  const k = ckDomKey(it.key), v = typeof f.answers[it.key] === 'string' ? f.answers[it.key] : '';
  return `<label class="ck-label ck-label--q" for="ck-in-${k}" id="ck-l-${k}">${esc(it.label)}</label>
    <textarea id="ck-in-${k}" class="ck-text" data-ck="text" data-key="${esc(it.key)}" rows="3" maxlength="${CHECKIN_TEXT_MAX}" placeholder="Ta réponse">${esc(v)}</textarea>
    <div class="ck-foot"><p class="ck-help"></p>${ckSkipHtml(it)}</div>`;
}
function ckAutoHtml(req, it, f) {
  const k = ckDomKey(it.key), v = checkinValueClean(it, f.answers[it.key]);
  const txt = v ? checkinValueText(it, v) : 'À remplir';
  const help = it.kind === 'diet_adherence' ? (f.from[it.key] === 'diet' ? 'D\'après tes repas cochés dans Nutrition. Touche pour corriger.' : 'Jours où tu as suivi ton plan diète.')
    : (f.from[it.key] === 'sessions' ? 'D\'après tes séances notées et ton objectif de la semaine. Touche pour corriger.' : 'Séances faites sur les séances prévues.');
  return `<div class="ck-row ck-row--auto">${ckIcon(it)}<span class="ck-label" id="ck-l-${k}">${esc(it.label)}</span>
      <button class="ck-auto num" data-action="ck-auto" data-key="${esc(it.key)}" aria-label="${esc(it.label)} : ${esc(txt)}. Modifier" aria-describedby="ck-h-${k}">${esc(txt)}</button></div>
    <div class="ck-foot"><p class="ck-help" id="ck-h-${k}">${esc(help)}</p>${ckSkipHtml(it)}</div>`;
}
function ckCycleHtml(it, f) {
  const k = ckDomKey(it.key), cur = f.answers[it.key];
  const rows = CHECKIN_CYCLE_PHASES.map(([v, label]) => `
      <button type="button" role="radio" aria-checked="${cur === v}" class="ck-choice${cur === v ? ' ck-choice--on' : ''}" data-action="ck-pick" data-key="${esc(it.key)}" data-v="${v}">
        <span class="ck-choice__label">${esc(label)}</span>${cur === v ? icon('checkmark', 18) : ''}</button>`).join('');
  return `<div class="ck-row ck-row--head">${ckIcon(it)}<span class="ck-label" id="ck-l-${k}">${esc(it.label)}</span>${ckSkipHtml(it)}</div>
    <div class="ck-choices" role="radiogroup" aria-labelledby="ck-l-${k}">${rows}</div>
    <div class="ck-foot ck-foot--cycle"><p class="ck-help">${ckWho()} voit seulement la phase choisie, dans ce bilan.</p>
      <button class="ck-skip" data-action="ck-cycle-withdraw">Retirer mon accord</button></div>`;
}
// Le bilan a des questions réservées aux 18 ans et plus (libido, cycle), pas montrées tant que rien n'est déclaré
function ckAdultOfferHtml() {
  if (!checkinAdultOffer()) return '';
  return `
        <div class="group ck-group ck-offer ck-offer--adult">
          <div class="ck-row">${icon('shield', 20)}<span class="ck-label">Questions intimes</span>
            <button class="ck-skip" data-action="ck-adult">J'ai 18 ans ou plus</button></div>
          <div class="ck-foot"><p class="ck-help">${ckWho()} a mis dans ce bilan des questions plus intimes (libido, cycle), réservées aux 18 ans et plus. Elles restent facultatives.</p></div>
        </div>`;
}
// Le coach suit le cycle et l'élève n'a pas encore répondu : proposé, jamais imposé (jamais si l'âge l'interdit)
function ckCycleOfferHtml(req) {
  if (ck.cycle || !ck.cycleAsked || checkinCycleBlocked()) return '';
  return `
        <div class="group ck-group ck-offer">
          <div class="ck-row">${icon('calendar', 20)}<span class="ck-label">Cycle menstruel</span>
            <button class="ck-skip" data-action="ck-cycle-offer">Choisir</button></div>
          <div class="ck-foot"><p class="ck-help">${ckWho()} te propose de partager ta phase du cycle. C'est facultatif.</p></div>
        </div>`;
}

// Photos : celles envoyées au coach depuis l'arrivée de la demande (coffre › Envoyer à mon coach), par pose
function ckPhotosSent(req) {
  if (!cphStudentListed()) return [];
  const since = (req.sentAt || 0) - 86400e3;   // une photo envoyée juste avant la demande compte aussi
  return cph.state.photos.filter(p => (p.sentAt || 0) >= since);
}
function ckPhotoHtml(req, it) {
  const who = ckWho();
  const poses = it.options?.poses || CHECKIN_POSES;
  const head = `<h2 class="group-title">Photos : ${poses.map(p => CHECKIN_POSE_LABELS[p].toLowerCase()).join(', ')}</h2>`;
  const note = txt => `${head}<div class="group ck-group"><div class="ck-item" data-key="${esc(it.key)}"><div class="ck-row">${ckIcon(it)}<span class="ck-label">${esc(it.label)}</span>${ckSkipHtml(it)}</div>
    <div class="ck-foot"><p class="ck-help">${txt}</p></div></div></div>`;
  if (ckForm.skipped.has(it.key)) return `${head}<div class="group ck-group"><div class="ck-item" data-key="${esc(it.key)}">${ckSkippedHtml(it)}</div></div>`;
  if (cphAgeBlocked()) return note('Les photos de bilan sont réservées aux 18 ans et plus : passe cette partie.');
  if (!vaultAvailable()) return note(PT.checkinPhotosUnavailable);
  if (!cph.state) return note(cph.error === 'offline' ? 'Pas d\'Internet : les photos s\'afficheront avec du réseau.' : 'Chargement…');
  if (cphDisabled()) return note('L\'envoi de photos de bilan est suspendu en ce moment.');
  if (!cph.state.ready) return note(`${who} n'a pas encore activé la réception des photos.`);
  const sent = ckPhotosSent(req);
  const tiles = poses.map(pose => {
    const p = sent.find(x => x.pose === pose), label = CHECKIN_POSE_LABELS[pose];
    if (p) return `<div class="ck-tile ck-tile--done" role="img" aria-label="${label} : envoyée le ${esc(fmtDate(p.sentAt || Date.now(), 'short'))}">
        <span class="ck-tile__mark" aria-hidden="true">${icon('checkmark', 20)}</span><span class="ck-tile__pose">${label}</span><span class="ck-tile__sub">Envoyée</span></div>`;
    return `<button class="ck-tile" data-action="ck-photo" data-pose="${pose}" ${cph.busy ? 'disabled' : ''} aria-label="${label} : ajouter depuis mon coffre">
        <span class="ck-tile__plus" aria-hidden="true">${icon('plus', 22)}</span><span class="ck-tile__pose">${label}</span></button>`;
  }).join('');
  return `${head}<div class="ck-item ck-item--photo" data-key="${esc(it.key)}">
      <div class="ck-tiles">${tiles}</div>
      <div class="ck-foot ck-foot--photo"><p class="ck-help">Chiffrées avant l'envoi : seul ${myCoachWord('ton')}, ${who}, pourra les ouvrir. Tu choisis chaque photo dans ton coffre, et tu peux la retirer.</p>${ckSkipHtml(it)}</div>
    </div>`;
}

// ── Saisie ──────────────────────────────────────────────────

function ckReq() { return ckForm.id ? checkinById(ckForm.id) : null; }
function ckItem(key) { return checkinItemsShown(ckReq()).find(it => it.key === key) || null; }
function ckTouch(key) { ckForm.touched.add(key); ckForm.bad.delete(key); ckSaveDraft(); }
// Redessine un seul suivi ; le focus revient sur l'élément équivalent (même action, même clé, même valeur)
function ckRepaint(key, focusSel = null) {
  const req = ckReq(), it = ckItem(key);
  const el = document.querySelector(`.ck-view .ck-item[data-key="${CSS.escape(key)}"]`);
  if (!req || !it || !el) { render(); return; }
  if (it.type === 'photo') { render(); return; }
  const wrap = document.createElement('div');
  wrap.innerHTML = ckItemHtml(req, it, ckForm);
  const fresh = wrap.firstElementChild;
  if (typeof frTypoNode === 'function') frTypoNode(fresh);
  el.replaceWith(fresh);
  if (focusSel) { try { fresh.querySelector(focusSel)?.focus({ preventScroll: true }); } catch { /* sélecteur refusé */ } }
}
function ckValueFromInput(t) {
  const key = t.dataset.key;
  if (t.dataset.ck === 'measure') {
    const o = { ...(ckForm.answers[key] && typeof ckForm.answers[key] === 'object' ? ckForm.answers[key] : {}) };
    if (t.value.trim()) o[t.dataset.mk] = t.value.trim(); else delete o[t.dataset.mk];
    if (Object.keys(o).length) ckForm.answers[key] = o; else delete ckForm.answers[key];
  } else if (t.dataset.ck === 'note') {
    ckForm.answers[key] = { yes: true, note: t.value };
  } else if (t.value.trim()) ckForm.answers[key] = t.dataset.ck === 'num' ? t.value.trim() : t.value;
  else delete ckForm.answers[key];
  delete ckForm.from[key];
  ckTouch(key);
}
// Nombre écrit hors des bornes : signalé sous le champ (jamais tronqué ni jeté en silence)
function ckCheckNumber(key) {
  const it = ckItem(key);
  if (!it || it.type !== 'number') return true;
  const v = ckForm.answers[key];
  const ok = v === undefined || (it.kind === 'measures'
    ? Object.entries(v).every(([mk, x]) => checkinNumber(x, 'cm') !== null && it.options.keys.includes(mk))
    : checkinValueClean(it, v) !== undefined);
  if (ok) ckForm.bad.delete(key); else ckForm.bad.add(key);
  return ok;
}
document.addEventListener('input', e => {
  const t = e.target;
  if (!t?.dataset?.ck || !t.closest('.ck-view')) return;
  ckValueFromInput(t);
});
// Champ quitté : un nombre hors bornes est dit tout de suite (sous le champ, lu par VoiceOver)
document.addEventListener('change', e => {
  const t = e.target;
  if (!t?.dataset?.ck || !t.closest('.ck-view') || !['num', 'measure'].includes(t.dataset.ck)) return;
  const key = t.dataset.key, was = ckForm.bad.has(key), ok = ckCheckNumber(key);
  if (ok !== !was) {
    const help = t.closest('.ck-item')?.querySelector('.ck-help');
    const it = ckItem(key);
    if (help && it) {
      help.classList.toggle('ck-help--bad', !ok);
      help.textContent = ok ? (it.kind === 'measures' ? 'Mesure-toi le matin, à jeun.' : '') : it.kind === 'measures' ? 'Écris des mesures entre 10 et 250 cm.' : ckNumberError(it);
      if (!ok) { t.setAttribute('aria-invalid', 'true'); announce(help.textContent); } else t.removeAttribute('aria-invalid');
    }
  }
});

async function ckAutoEdit(key) {
  const req = ckReq(), it = ckItem(key);
  if (!req || !it) return;
  const cur = checkinValueClean(it, ckForm.answers[key]);
  const ctx = checkinContext(req);
  const of = cur?.of || (it.kind === 'diet_adherence' ? checkinPeriod(req).days : ctx.planned);
  const diet = it.kind === 'diet_adherence';
  const n = await askNumber({ title: it.label, message: diet ? `Combien de jours as-tu suivi ton plan, sur ${of} ?` : `Combien de séances as-tu faites, sur ${of} prévues ?`,
    value: cur ? String(cur.done) : '', min: 0, max: 31, label: diet ? 'Jours suivis' : 'Séances faites' });
  if (n === null) { document.querySelector(`.ck-item[data-key="${CSS.escape(key)}"] [data-action="ck-auto"]`)?.focus({ preventScroll: true }); return; }
  ckForm.answers[key] = { done: n, of: Math.min(31, Math.max(of, n, 1)) };
  delete ckForm.from[key];
  ckTouch(key);
  ckRepaint(key, '[data-action="ck-auto"]');
}

const CK_ERROR_TEXT = {
  get closed() { return `Ce bilan est fermé : ${ckWho()} en a envoyé un nouveau ou l'a annulé.`; },
  invalid_answer: 'Une réponse n\'est pas acceptée : vérifie les chiffres, puis renvoie.',
  no_consent: 'Ton accord pour le cycle n\'est plus actif : la question du cycle est retirée. Renvoie le bilan.',
  not_found: 'Ce bilan n\'est plus disponible.',
  get not_adult() { return 'Ces questions (libido, cycle) sont réservées aux 18 ans et plus.'; },
  no_health_consent: 'Ton accord pour envoyer tes bilans n\'est pas donné : accepte-le, puis renvoie le bilan.',
  invalid_version: 'Le texte de l\'accord a changé : relis-le, puis accepte-le de nouveau.',
};
function ckErrorText(kind) { return CK_ERROR_TEXT[kind] || coachErrorText(kind); }

function ckFocusItem(key) {
  const el = document.querySelector(`.ck-view .ck-item[data-key="${CSS.escape(key)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  (el.querySelector('input, textarea, [role="radio"], .ck-auto') || el).focus?.({ preventScroll: true });
}

async function ckSendFlow(id) {
  const req = checkinById(id), who = coachName() || myCoachWord('ton');
  if (!req || ck.sending.has(id)) return;
  const items = checkinItemsShown(req);
  // Chiffres hors bornes : rien ne part, le premier est montré
  const bad = items.filter(it => !ckForm.skipped.has(it.key) && !ckCheckNumber(it.key));
  if (bad.length) {
    bad.forEach(it => ckRepaint(it.key));
    ckFocusItem(bad[0].key);
    showToast(`Vérifie « ${bad[0].label} » : ${ckNumberError(bad[0]).toLowerCase()}`, { error: true });
    return;
  }
  const src = { ...ckForm.answers };
  // Photos : celles envoyées au coach depuis l'arrivée de la demande, des poses demandées (9 au plus)
  items.filter(it => it.type === 'photo').forEach(it => {
    const ids = ckPhotosSent(req).filter(p => (it.options?.poses || CHECKIN_POSES).includes(p.pose)).map(p => p.id).slice(0, 9);
    if (ids.length) src[it.key] = { ids }; else delete src[it.key];
  });
  ckForm.skipped.forEach(k => delete src[k]);
  const { answers, missing } = checkinAnswersClean(items, src);
  if (missing.length) {
    const it = items.find(x => x.key === missing[0]);
    if (ckForm.skipped.has(it.key)) { ckForm.skipped.delete(it.key); ckRepaint(it.key); }
    ckFocusItem(it.key);
    showToast(`Réponds à « ${it.label} » : ${who} en a besoin.`, { error: true });
    return;
  }
  // Premier envoi : accord daté pour les données de santé, demandé une fois (sans lui, rien ne part)
  if (checkinHealthNeeded() && !(await ckHealthOffer())) return;
  const empty = items.filter(it => !Object.hasOwn(answers, it.key)).length;
  const msg = `${empty ? `${plural(empty, 'suivi passé', 'suivis passés')} : ${who} ne ${empty > 1 ? 'les' : 'le'} verra pas. ` : ''}Une fois envoyé, ton bilan ne se modifie plus.`;
  if (!(await confirmSheet(`Envoyer ton bilan à ${who} ?`, msg, `Envoyer à ${who}`, false))) return;
  const r = await checkinSend(id, src, [...ckForm.skipped]);
  // L'écran dit lui-même « Envoyé » ou « En attente du réseau » : pas de toast par-dessus le récapitulatif, VoiceOver
  // l'entend (le focus va sur ce titre)
  if (r.ok && !r.queued) { haptic('success'); announce(`Bilan envoyé à ${who}`); }
  else if (r.ok) announce('Pas d\'Internet : ton bilan partira dès que tu seras connecté.');
  else {
    if (r.kind === 'no_consent' || r.kind === 'not_adult') await checkinRefresh();
    showToast(ckErrorText(r.kind), { error: true });
  }
  if (currentView() === 'checkin') { window.scrollTo(0, 0); render(); ckFocusTitle(); }
}
// Focus sur l'état de l'écran (Envoyé, en attente) : après la fermeture de la feuille, qui rend le focus au bouton touché
function ckFocusTitle() {
  const go = () => { if (currentView() === 'checkin') document.getElementById('ckTitle')?.focus({ preventScroll: true }); };
  go(); setTimeout(go, 260);
}

// Accord daté pour les bilans (données de santé) : texte court, « J'accepte » ; rend true si l'accord est enregistré
async function ckHealthOffer() {
  const who = coachName() || myCoachWord('ton');
  const ok = await dialog({ type: 'sheet', title: 'Accord pour tes bilans',
    // Texte de la version CK_HEALTH_VERSION : le changer, c'est passer à la version suivante (serveur compris)
    message: `Tu acceptes d'envoyer à ${who} tes réponses de bilan (données de santé) : sommeil, stress, douleurs, poids… Seul ${who} les voit, dès que tu envoies un bilan ; elles sont hébergées chez Supabase (Union européenne). Tu peux retirer ton accord dans ${myCoachWord('Mon')} : plus rien ne part ensuite.`,
    actions: [{ label: 'J\'accepte', value: true, style: 'preferred' }, { label: 'Annuler', style: 'cancel' }] });
  if (ok !== true) return false;
  const r = await checkinHealthSet(true);
  if (!r.ok) { showToast(ckErrorText(r.kind), { error: true }); if (r.kind === 'invalid_version') await checkinRefresh(); return false; }
  return true;
}
async function ckHealthWithdraw() {
  const who = coachName() || myCoachWord('ton');
  if (!(await confirmSheet('Retirer ton accord ?', `Tes prochains bilans ne partiront plus chez ${who}. Ceux déjà envoyés restent chez ${who} jusqu'à la fin du suivi, et au plus 24 mois : ils sont ensuite effacés automatiquement.`, 'Retirer mon accord'))) return;
  const r = await checkinHealthSet(false);
  showToast(r.ok ? 'Accord retiré' : ckErrorText(r.kind), r.ok ? undefined : { error: true });
  if (['checkin', 'coach-mine'].includes(currentView())) render();
}
async function ckAdultDeclare() {
  const who = ckWho();
  if (!(await confirmSheet('As-tu 18 ans ou plus ?', `Les questions sur la libido et le cycle ne sont posées qu'aux élèves de 18 ans et plus. ${who} ne voit que tes réponses, jamais ta déclaration.`, 'J\'ai 18 ans ou plus', false))) return;
  const r = await checkinAdultDeclare();
  if (!r.ok) { showToast(ckErrorText(r.kind), { error: true }); return; }
  showToast('Déclaration enregistrée');
  if (currentView() === 'checkin') { render(); ckFocusTitle(); }
}

// Accord pour le cycle : case « J'ai 18 ans ou plus » à cocher, puis le bouton s'active
async function ckCycleOffer() {
  if (checkinCycleBlocked()) { showToast(ckErrorText('not_adult'), { error: true }); return; }
  const who = ckWho();
  let adult = false;
  const body = `
    <p class="ckc__lead">Si tu acceptes, les bilans ${elide('de', who)} qui suivent le cycle te demandent ta phase : règles, après les règles, ovulation, avant les règles, ou « je ne sais pas ».</p>
    <p class="ckc__lead">${who} voit seulement la phase que tu choisis, dans chaque bilan envoyé à partir de maintenant. Tu peux passer la question à chaque bilan.</p>
    <p class="ckc__lead">Pour arrêter : « Retirer mon accord », dans un bilan. Tes réponses sur le cycle sont alors effacées de chez ${who}.</p>
    <button type="button" class="ckc__check" role="checkbox" aria-checked="false" data-ckc="adult">
      <span class="ckc__box" aria-hidden="true">${icon('checkmark', 16)}</span><span>J'ai 18 ans ou plus</span></button>
    <button class="btn btn--primary btn--full ckc__go" data-ckc="go" disabled>Partager ma phase du cycle</button>`;
  const p = sheet({ title: 'Cycle menstruel', cancel: 'Annuler', confirm: '', body });
  const root = [...document.querySelectorAll('.sheet-root')].pop();
  root?.addEventListener('click', async e => {
    const b = e.target.closest('[data-ckc]');
    if (!b) return;
    if (b.dataset.ckc === 'adult') {
      adult = !adult;
      b.setAttribute('aria-checked', String(adult));
      b.classList.toggle('ckc__check--on', adult);
      root.querySelector('.ckc__go').disabled = !adult;
      return;
    }
    if (b.dataset.ckc === 'go' && adult) {
      b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Enregistrement…';
      const r = await checkinCycleSet(true, true);
      root._close?.(r.ok);
      if (r.ok) showToast('Accord enregistré');
      else showToast(ckErrorText(r.kind), { error: true });
    }
  });
  await p;
  if (['checkin', 'coach-mine'].includes(currentView())) render();
}
async function ckCycleWithdraw() {
  const who = coachName() || myCoachWord('ton');
  if (!(await confirmSheet('Retirer ton accord ?', `Le cycle n'apparaîtra plus dans tes bilans, et tes réponses sur le cycle seront effacées de chez ${who}.`, 'Retirer mon accord'))) return;
  const r = await checkinCycleSet(false);
  if (!r.ok) { showToast(ckErrorText(r.kind), { error: true }); return; }
  // Phases du cycle retirées du formulaire ouvert
  const req = ckReq();
  (req?.items || []).filter(it => it.kind === 'cycle').forEach(it => { delete ckForm.answers[it.key]; ckForm.skipped.delete(it.key); });
  ckSaveDraft();
  showToast('Accord retiré');
  if (['checkin', 'coach-mine'].includes(currentView())) { render(); ckFocusTitle(); }
}

// ── Écran, déclencheurs, actions ────────────────────────────

SCREENS.set('checkin', {
  render: id => renderCheckin(id),
  enter: () => {
    const id = routeParams(currentRoute())[0];
    checkinRefresh({ minAge: 30_000 });
    const req = checkinById(id);
    if (req && checkinState(req) === 'sent') checkinMarkSeen(req);
    if (req?.items.some(it => it.kind === 'photos')) cphRefresh({ minAge: 30_000 });
    // Pas, sommeil et cardio lus dans Santé (si la coquille le sait) : posés s'ils ne sont ni touchés ni passés ; un
    // sommeil en échelle reçoit seulement l'indication de Santé (un ressenti ne se devine pas)
    const hk = req?.items.filter(it => it.kind === 'steps' || it.kind === 'cardio' || it.kind === 'sleep') || [];
    if (hk.length && checkinState(req) !== 'sent' && checkinHealthAllowed()) {
      checkinReadHealth(req).then(h => {
        if (!h || ckForm.id !== req.id || currentView() !== 'checkin') return;
        const pre = checkinPrefill(hk, checkinContext(req)).values;
        hk.forEach(it => {
          if (Object.hasOwn(pre, it.key) && !ckForm.touched.has(it.key) && !ckForm.skipped.has(it.key)) { ckForm.answers[it.key] = pre[it.key]; ckForm.from[it.key] = 'health'; }
          const el = document.querySelector(`.ck-view .ck-item[data-key="${CSS.escape(it.key)}"]`);
          if (el && !el.contains(document.activeElement)) ckRepaint(it.key);   // jamais sous le doigt d'une saisie
        });
      }).catch(() => {});
    }
  },
  leave: () => { ckSaveDraft(); ckForm = { id: null, answers: {}, skipped: new Set(), from: {}, touched: new Set(), bad: new Set() }; },
});

// État changé (lecture, envoi, accord) : l'écran du bilan est redessiné seulement si ce qu'il montre change (jamais
// pendant une saisie pour rien) ; l'accueil, si sa carte change
let ckHomeShown = null;
onCheckinChange(() => {
  const v = currentView();
  if (v === 'checkin') {
    const id = routeParams(currentRoute())[0], req = checkinById(id);
    if (ckStateKey(req) !== ckShown) { render(); if (req && checkinState(req) === 'sent') checkinMarkSeen(req); }
  } else if (v === 'dashboard') {
    const card = checkinHomeCard();
    if (card !== ckHomeShown) { ckHomeShown = card; render(); }
  }
});
// Photos de bilan (envoi depuis le coffre, réception activée par le coach) : la rubrique Photos suit
if (typeof onCoachChange === 'function') {
  onCoachChange(() => {
    if (currentView() !== 'checkin') return;
    const req = ckReq();
    if (req?.items.some(it => it.kind === 'photos') && !document.activeElement?.matches?.('.ck-view input, .ck-view textarea')) {
      const y = window.scrollY; render(); window.scrollTo(0, y);
    }
  });
}

registerActions({
  'ck-open': (e, el) => { if (el.dataset.id) navigate(makeRoute('checkin', el.dataset.id)); },
  // Brouillon gardé (il l'est déjà à chaque réponse) ; retour à l'écran d'avant
  'ck-later': () => {
    const kept = ckForm.touched.size || ckForm.skipped.size;
    ckSaveDraft();
    goBack();
    if (kept) showToast('Brouillon gardé : reprends-le depuis l\'accueil.');
  },
  'ck-send': async (e, el) => { await ckSendFlow(el.dataset.id || ckForm.id); },
  'ck-pick': (e, el) => {
    const key = el.dataset.key, it = ckItem(key);
    if (!it) return;
    ckForm.answers[key] = it.type === 'scale' ? Number(el.dataset.v) : el.dataset.v;
    ckTouch(key);
    haptic();
    ckRepaint(key, `[data-action="ck-pick"][data-v="${CSS.escape(el.dataset.v)}"]`);
  },
  'ck-yesno': (e, el) => {
    const key = el.dataset.key, yes = el.dataset.v === 'yes', cur = ckForm.answers[key];
    ckForm.answers[key] = yes ? { yes: true, note: cur?.note || '' } : { yes: false };
    ckTouch(key);
    haptic();
    ckRepaint(key, `[data-action="ck-yesno"][data-v="${el.dataset.v}"]`);
  },
  'ck-auto': async (e, el) => { await ckAutoEdit(el.dataset.key); },
  'ck-skip': (e, el) => {
    const key = el.dataset.key;
    ckForm.skipped.add(key); ckForm.bad.delete(key);
    ckSaveDraft();
    const it = ckItem(key);
    announce(`${it?.label || 'Suivi'} passé`);
    ckRepaint(key, '[data-action="ck-unskip"]');
  },
  'ck-unskip': (e, el) => {
    const key = el.dataset.key;
    ckForm.skipped.delete(key);
    ckSaveDraft();
    ckRepaint(key, '[data-action="ck-skip"], input, [role="radio"], textarea, .ck-auto');
  },
  // Photo d'une pose : le coffre s'ouvre (Face ID) sur la feuille d'envoi au coach ; au retour, la rubrique la montre
  'ck-photo': () => { ckSaveDraft(); if (cphStudentShown() && cph.state?.ready) pvSendToCoach(); },
  'ck-cycle-offer': async () => { await ckCycleOffer(); },
  'ck-health-offer': async () => { if (await ckHealthOffer()) { showToast('Accord enregistré'); render(); } },
  'ck-health-withdraw': async () => { await ckHealthWithdraw(); },
  'ck-adult': async () => { await ckAdultDeclare(); },
  'ck-cycle-withdraw': async () => { await ckCycleWithdraw(); },
  'ck-retry': async () => { await checkinRefresh(); render(); },
});
