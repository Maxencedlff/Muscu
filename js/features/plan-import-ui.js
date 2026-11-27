// ═══════════════════════════════════════════════════════════
//  Importer un programme (docs/IMPORT_PROGRAMME.md) : le coach colle son programme (message, tableau, texte d'un
//  PDF) ou choisit un fichier, l'app le comprend et le montre à vérifier avant de l'enregistrer.
//  Routes : plan-import:texte[:élève] (coller ou choisir un fichier), plan-import:verifier[:élève] (« Vérifier
//  l'import » : ligne source au-dessus, ce qui est compris dessous ; « À vérifier » et « Pas compris » sur un fond
//  gris, jamais en orange, réservé aux boutons). Un toucher sur une ligne : changer l'exercice, les séries et reps,
//  ou la retirer. Chaque exercice corrigé est retenu (js/data/plan-aliases.js) pour le prochain import.
//  Accès : Programme › Ajouter un programme, et la fiche d'un élève (coach). Logique : js/data/plan-*.js ;
//  lecture d'un PDF : js/features/plan-pdf.js.
// ═══════════════════════════════════════════════════════════
'use strict';

const PIMP_TEXT_MAX = 20000;   // caractères collés (un programme de 6 séances tient en 3 000)
const PIMP_FILE_MAX = 15 * 1024 * 1024;
// Import en cours : texte collé, brouillon compris, nom, élève (coach), corrections à retenir { brut: nom }
let pimp = null;

function pimpState(student = null) {
  if (!pimp || pimp.student !== student) pimp = { text: '', draft: null, name: '', student, learn: {}, source: 'texte' };
  return pimp;
}
function openPlanImport(student = null) {
  pimpState(student);
  navigate(makeRoute('plan-import', 'texte', ...(student ? [student] : [])));
}

// Lecture par l'iPhone (Apple Vision, dictée sur l'appareil : js/platform/plan-reader.js, vague 2) : proposée seulement
// quand le module natif est là ; sinon l'écran reste sur Coller et Choisir un fichier
const pimpReader = () => typeof PlanReader !== 'undefined' && PlanReader.available === true;
const pimpDictation = () => typeof PlanReader !== 'undefined' && PlanReader.dictation?.available === true;

// ── Écran 1 : coller le texte ou choisir un fichier ──────────
function renderPimpText(student) {
  const st = pimpState(student || null);
  const who = student ? personName(coachStudent(student)) : '';
  return `
    <div class="view view--grouped pimp-view">
      ${navBar({ title: 'Importer un programme' })}
      <div class="scr">
        <p class="pimp-lead">${who ? `Le programme de ${esc(who)}, tel que tu l'as déjà : ` : 'Ton programme tel que tu l\'as déjà : '}un message, un tableau, le texte d'un PDF. L'app le lit, puis tu vérifies.</p>
        <div class="group group--pad">
          <label class="sr-text" for="pimpText">Texte du programme</label>
          <textarea id="pimpText" class="pimp-text" maxlength="${PIMP_TEXT_MAX}" rows="10" autocapitalize="sentences" spellcheck="false"
            placeholder="Lundi : Push&#10;Développé couché 4x8-10, repos 2 min&#10;Élévations latérales 3x15&#10;&#10;Mercredi : Pull&#10;Tractions 4 × max">${esc(st.text)}</textarea>
        </div>
        <div class="group-foot">Une séance par titre (« Lundi », « Push », « Séance A »), un exercice par ligne. Les abréviations de salle (DC, SDT, RDL…) sont comprises.</div>
        <div class="prog-info__actions">
          <button class="btn btn--primary btn--full" data-action="pimp-read">Lire le programme</button>
        </div>
        <div class="group group--gap">
          ${pimpReader() ? `<button class="cell cell--action" data-action="pimp-photo">${icon('camera', 20)}<span>Photo</span></button>
          <button class="cell cell--action" data-action="pimp-scan">${icon('doc.on.doc', 20)}<span>Scanner une feuille</span></button>` : ''}
          ${pimpDictation() ? `<button class="cell cell--action" data-action="pimp-dictate">${icon('waveform', 20)}<span>Dicter</span></button>` : ''}
          <button class="cell cell--action" data-action="pimp-file">${icon('doc.text', 20)}<span>Choisir un fichier</span></button>
        </div>
        <div class="group-foot">${pimpReader() ? 'Photo ou scan d\'une feuille, même écrite à la main, dictée, ' : ''}PDF, texte, ou export de Hevy ou Strong. Tout est lu sur ${esc(thisPhone())}, rien n'est envoyé.</div>
      </div>
    </div>`;
}

// ── Écran 2 : Vérifier l'import ──────────────────────────────
const PIMP_LEVEL = { check: 'À vérifier', unknown: 'Pas compris' };
// Ce qui est compris d'une ligne, en clair : « 4 × 8 à 12 · repos 2 min · dernière série en drop set »
function pimpPrescText(p) {
  const bits = [];
  const reps = p.amrap ? 'max' : p.seconds ? `${fmtNum(p.seconds)} s` : p.repMax !== undefined ? (p.repMin !== undefined && p.repMin < p.repMax ? `${p.repMin} à ${p.repMax}` : `${p.repMax}`) : '';
  if (p.sets !== undefined && reps) bits.push(`${p.sets} × ${reps}`);
  else if (p.sets !== undefined) bits.push(plural(p.sets, 'série', 'séries'));
  else if (reps) bits.push(p.seconds ? reps : `${reps} reps`);
  if (p.rest > 0) bits.push(`repos ${fmtRest(p.rest)}`);
  if (p.rest === 0) bits.push('sans repos');
  if (p.load) bits.push(`${fmtNum(p.load)} kg`);
  if (p.pct) bits.push(`${fmtNum(p.pct)} %`);
  if (p.rpe) bits.push(`RPE ${fmtNum(p.rpe)}`);
  if (p.rir !== undefined) bits.push(`RIR ${p.rir}`);
  if (p.tempo) bits.push(`tempo ${p.tempo}`);
  if (p.tech) bits.push(p.tech === 'topback' ? '1re lourde, puis allégées' : `${p.techWhere === 'all' ? 'toutes' : 'dernière'} en ${TECHS[p.tech].label.toLowerCase()}`);
  if (p.uni) bits.push('par côté');
  return bits.join(' · ');
}
function pimpWhyText(it) {
  if (it.level === 'unknown') return it.guess ? `Pas dans la bibliothèque. Peut-être ${it.guess} ?` : 'Pas dans la bibliothèque : touche pour choisir';
  const w = it.why || [];
  if (w.includes('nom')) return 'Nom proche : vérifie l\'exercice';
  if (w.includes('séries')) return 'Nombre de séries non lu : 3 par défaut';
  if (w.includes('reps')) return 'Reps non lues';
  return '';
}
function pimpRowHtml(it) {
  const presc = pimpPrescText(it.presc);
  const lvl = PIMP_LEVEL[it.level];
  const why = pimpWhyText(it);
  const name = it.name || it.raw || 'Exercice';
  const label = `${name}${presc ? `, ${presc}` : ''}${lvl ? `, ${lvl}` : ''}. Ligne : ${it.src.trim()}`;
  return `
    <button class="cell cell--nav pimp-row${it.level !== 'sure' ? ` pimp-row--${it.level}` : ''}" data-action="pimp-line" data-id="${esc(it.id)}" aria-label="${esc(label)}">
      <span class="cell__body">
        <span class="pimp-src" aria-hidden="true">${esc(clipText(it.src.trim(), 140))}</span>
        <span class="cell__title">${it.ss ? `<span class="pimp-ss" aria-hidden="true">${esc(it.ssTag || '')}</span>` : ''}${esc(name)}</span>
        ${presc ? `<span class="cell__sub num">${esc(presc)}</span>` : ''}
        ${lvl ? `<span class="cell__sub pimp-why">${esc(lvl)}${why ? ` · ${esc(why)}` : ''}</span>` : ''}
      </span>
      ${icon('chevron.right', 16)}
    </button>`;
}
function renderPimpReview(student) {
  const st = pimpState(student || null);
  const d = st.draft;
  if (!d) return renderPimpText(student);
  const items = d.sessions.flatMap(s => s.items).filter(it => !it.removed);
  const nCheck = items.filter(x => x.level === 'check').length, nUnk = items.filter(x => x.level === 'unknown').length;
  const summary = !items.length ? 'Aucun exercice compris. Reviens au texte pour l\'écrire autrement.'
    : `${plural(items.length, 'exercice compris', 'exercices compris')}${nCheck ? `, ${nCheck} à vérifier` : ''}${nUnk ? `, ${plural(nUnk, 'pas compris', 'pas compris')}` : ''}.`;
  const sessions = d.sessions.map((s, si) => {
    const list = s.items.filter(it => !it.removed);
    if (!list.length) return '';
    const tags = ssTags(list.map(it => ({ ss: it.ss })));
    list.forEach((it, k) => { it.ssTag = tags[k] || ''; });
    return `
        <div class="group-title pimp-sess"><span>${esc(s.label)}</span>
          <button class="pimp-sess__btn" data-action="pimp-session" data-i="${si}" aria-label="Renommer la séance ${esc(s.label)}">Renommer</button></div>
        <div class="group">${list.map(pimpRowHtml).join('')}</div>`;
  }).join('');
  const notes = d.lines.filter(l => l.role === 'note' && l.text.trim()).map(l => l.text.trim());
  return `
    <div class="view view--grouped pimp-view">
      ${navBar({ title: 'Vérifier l\'import' })}
      <div class="scr">
        <p class="pimp-lead" role="status">${esc(summary)}${items.length ? ' Touche une ligne pour la corriger.' : ''}</p>
        <div class="group">
          <button class="cell cell--nav" data-action="pimp-name">
            <span class="cell__body"><span class="cell__sub">Nom du programme</span><span class="cell__title">${esc(pimpName())}</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
        ${sessions}
        ${notes.length ? `
        <div class="group-title">Lignes non reprises (${notes.length})</div>
        <div class="group pimp-notes">${notes.slice(0, 30).map(n => `<div class="cell"><span class="cell__body"><span class="cell__sub">${esc(clipText(n, 160))}</span></span></div>`).join('')}</div>
        <div class="group-foot">Titres, conseils et échauffement ne deviennent pas des exercices. Ajoute un exercice oublié ensuite, dans la séance.</div>` : ''}
        <div class="prog-info__actions">
          <button class="btn btn--primary btn--full" data-action="pimp-save" ${items.length ? '' : 'disabled'}>Enregistrer le programme</button>
          <button class="btn btn--secondary btn--full" data-action="pimp-edit-text">Modifier le texte</button>
        </div>
        <div class="group-foot">${st.student ? `Le programme est créé pour ${esc(personName(coachStudent(st.student)))}, tu pourras l'envoyer ensuite. Tes séances ne changent pas.` : 'Le programme s\'ajoute à Mes programmes.'} Tes corrections sont retenues pour le prochain import.</div>
      </div>
    </div>`;
}
const pimpName = () => (pimp?.name || pimp?.draft?.title || 'Programme importé').slice(0, SESSION_LABEL_MAX);
SCREENS.set('plan-import', { render: (step, student) => (step === 'verifier' ? renderPimpReview(student) : renderPimpText(student)) });

// ── Lecture ─────────────────────────────────────────────────
function pimpRead(text, source = 'texte') {
  const st = pimpState(pimp?.student || null);
  st.text = String(text ?? '').slice(0, PIMP_TEXT_MAX);
  st.source = source;
  st.draft = planParse(st.text, { learned: planLearnedAliases() });
  st.name = '';
  st.learn = {};
  const route = makeRoute('plan-import', 'verifier', ...(st.student ? [st.student] : []));
  if (routeName(currentRoute()) === 'plan-import' && routeParams(currentRoute())[0] === 'verifier') render(); else navigate(route);
}
function pimpItem(id) {
  for (const s of pimp?.draft?.sessions || []) { const it = s.items.find(x => x.id === id); if (it) return it; }
  return null;
}

// Changer l'exercice : les plus proches d'abord (supposition du moteur, puis recherche approchée), recherche libre,
// ou garder le nom écrit (exercice créé sous ce nom)
let pimpPickFor = null;
function pimpPickListHtml(q) {
  const it = pimpItem(pimpPickFor);
  if (!it) return '';
  const names = catalogueNames();
  const query = String(q || '').trim();
  let list;
  if (!query) {
    const near = closestExercises(names, it.raw, 6);
    list = [...new Set([it.name, it.guess, ...near].filter(n => n && catalogueEntry(n)))];
  } else {
    list = names.map(n => ({ n, score: exerciseMatchScore(n, query) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.n);
    if (!list.length) list = closestExercises(names, query, 6);
  }
  const rows = list.slice(0, 40).map(n => `<button class="imp-pick" data-action="pimp-pick" data-name="${esc(n)}"><span class="imp-row__body"><span>${esc(n)}</span>${exMusclesSubHtml({ name: n }, 'imp-row__sub')}</span></button>`).join('');
  const keep = it.raw ? `<button class="imp-pick imp-pick--keep" data-action="pimp-pick" data-name="" data-keep="1">Garder « ${esc(clipText(it.raw, 40))} » comme nouvel exercice</button>` : '';
  return `${!query && list.length ? '<div class="imp__hint">Les plus proches</div>' : ''}${rows || '<div class="sheet-empty">Aucun exercice</div>'}${keep}`;
}
async function pimpPickExercise(it) {
  pimpPickFor = it.id;
  await sheet({ title: 'Quel exercice ?', cancel: 'Annuler', confirm: '', focus: '#pimpSearch',
    body: `<p class="imp__lead">« ${esc(clipText(it.raw || it.src, 80))} » dans ton texte est :</p>
      <input type="search" id="pimpSearch" maxlength="${SEARCH_MAX}" class="search" placeholder="Rechercher dans la bibliothèque" autocomplete="off" aria-label="Rechercher un exercice">
      <div class="sheet-list imp-pick-list" id="pimpPickList">${pimpPickListHtml('')}</div>` });
  pimpPickFor = null;
}
document.addEventListener('input', ev => {
  if (ev.target?.id === 'pimpSearch') { const l = $('#pimpPickList'); if (l) l.innerHTML = pimpPickListHtml(ev.target.value.slice(0, SEARCH_MAX)); }
  else if (ev.target?.id === 'pimpText' && pimp) pimp.text = ev.target.value.slice(0, PIMP_TEXT_MAX);
});

// Séries et reps : la même grammaire que l'import (« 4x10 », « 3 × 8-12 repos 90 s », « 3 × 45 s »)
function pimpPrescInput(p) {
  const reps = p.amrap ? 'max' : p.seconds ? `${p.seconds} s` : p.repMax !== undefined ? (p.repMin !== undefined && p.repMin < p.repMax ? `${p.repMin}-${p.repMax}` : `${p.repMax}`) : '';
  return [p.sets !== undefined || reps ? `${p.sets ?? 3} x ${reps || 10}` : '', p.rest > 0 ? `repos ${fmtRest(p.rest)}` : ''].filter(Boolean).join(' ');
}
async function pimpEditPresc(it) {
  const v = await askText({ title: 'Séries et reps', message: 'Exemples : 4x10, 3 × 8-12 repos 90 s, 3 × 45 s.', value: pimpPrescInput(it.presc),
    placeholder: '4x10 repos 90 s', max: 60, confirm: 'OK',
    validate: s => (planHasWork(planReadLine(s).presc) ? null : 'Écris au moins les séries et les reps, par exemple 4x10') });
  if (v === null) return;
  const r = planReadLine(v).presc;
  // Ce qui n'est pas réécrit (technique, tempo, charge) reste ; séries, reps et repos sont remplacés
  const keep = { ...it.presc };
  ['sets', 'repMin', 'repMax', 'amrap', 'seconds', 'rest', 'pyramid'].forEach(k => delete keep[k]);
  it.presc = { ...keep, ...r };
  planGrade(it);
  haptic(); render();
}

// Enregistrement : programme perso (ou pour l'élève), corrections retenues dans le dictionnaire appris
function pimpSave() {
  const st = pimp;
  if (!st?.draft) return;
  const name = pimpName();
  const { up, pd } = planDraftProgramme(st.draft, name);
  if (!up.order.length) return;
  const previous = JSON.stringify(data);
  const id = 'u_' + uid();
  data.userProgrammes[id] = up;
  data.programmes[id] = pd;
  addMyProgramme(id);
  let learned = 0;
  Object.entries(st.learn).forEach(([raw, nm]) => { if (planLearnAlias(raw, nm)) learned++; });
  // Programme actif jamais fait (le PPL d'office) et import pour soi : le programme importé devient l'actif
  const untouched = !st.student && !isUserProg(data.activeProgramme) && !(data.history || []).some(h => h.programme === data.activeProgramme);
  if (untouched) activateProgramme(id);
  if (!save()) { data = JSON.parse(previous); showToast('Stockage plein : programme non enregistré', { error: true }); return; }
  const student = st.student;
  pimp = null;
  haptic();
  // Les deux écrans de l'import cèdent la place à la page du programme : le retour mène à l'écran d'avant l'import
  const next = navClone(nav), s = next.stacks[next.tab];
  while (s.length > 1 && routeName(s[s.length - 1]) === 'plan-import') s.pop();
  const page = id === data.activeProgramme ? 'programmes' : makeRoute('programmes', id);
  if (next.tab === 'program') next.stacks.program = [TABS.program.root, page]; else s.push(page);
  navCommit(next, 'push', 'replace');
  showToast(`« ${name} » enregistré${learned ? `, ${plural(learned, 'correction retenue', 'corrections retenues')}` : ''}${student ? '. Tes séances ne changent pas.' : ''}`);
}

// Fichier : PDF (texte lu par pdf.js), texte, ou export CSV de Hevy et Strong (import des séances, js/features/import-ui.js)
function pimpChooseFile() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = `.pdf,application/pdf,.txt,text/plain,.csv,text/csv,.md${pimpReader() ? ',image/*' : ''}`;
  inp.onchange = async ev => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (file.size > PIMP_FILE_MAX) { showToast('Fichier trop gros (15 Mo au plus)', { error: true }); return; }
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    try {
      // Image (capture d'écran, photo enregistrée) : lue par Vision
      if (/^image\//.test(file.type) && pimpReader()) {
        const r = await PlanReader.readFile(file, { customWords: planDictationWords('exercice') });
        if (r.ok) pimpRead(planTextFromPages(r.pages), 'photo'); else if (r.message) showToast(r.message, { error: true });
        return;
      }
      if (isPdf) {
        showToast('Lecture du PDF…');
        const r = await planPdfText(await file.arrayBuffer());
        if (!r.text.trim() && pimpReader()) {
          const scan = await PlanReader.readFile(file, { customWords: planDictationWords('exercice') });
          if (scan.ok) { pimpRead(planTextFromPages(scan.pages), 'scan'); return; }
          if (scan.message) showToast(scan.message, { error: true });
          return;
        }
        if (!r.text.trim()) { await dialog({ title: 'Pas de texte dans ce PDF', message: 'C\'est sans doute une photo ou un scan. La lecture des photos arrive dans une prochaine version. En attendant, copie le texte du programme et colle-le ici.', actions: [{ label: 'OK', style: 'preferred' }] }); return; }
        pimpRead(r.text, 'pdf');
        return;
      }
      const text = await file.text();
      if (/\.csv$/i.test(file.name) || detectCsvFormat(parseCsv(text.slice(0, 4000), 2).header)) { importOtherAppText(text); return; }
      pimpRead(text, 'fichier');
    } catch {
      showToast('Fichier illisible', { error: true });
    }
  };
  inp.click();
}

// Photo, appareil photo ou feuille numérisée : pages lues par Vision, mises en lignes et colonnes par planTextFromPages
async function pimpFromReader(source) {
  const r = await PlanReader.pick(source, { limit: 5, customWords: planDictationWords('exercice') });
  if (!r.ok) { if (r.message) showToast(r.message, { error: r.reason !== 'canceled' }); return; }
  const text = planTextFromPages(r.pages);
  if (!text.trim()) { showToast('Aucun texte lu sur cette image'); return; }
  pimpRead(text, source);
}
// Dictée : « Tout d'un coup » (le texte reconnu au fil de la voix), ou « Pas à pas » : l'app demande « Quel exercice ? »
// puis « Combien de séries et de reps ? », avec un vocabulaire réduit à chaque question (dictée plus fiable)
const PIMP_STEPS = [{ q: 'Quel exercice ?', words: 'exercice', hint: 'Exemple : développé couché' },
  { q: 'Combien de séries et de reps ?', words: 'prescription', hint: 'Exemple : 4 séries de 10, repos 2 minutes' }];
async function pimpDictate() {
  const mode = await dialog({ type: 'sheet', title: 'Dicter le programme', message: 'Sur ton iPhone, sans Internet.', actions: [
    { label: 'Pas à pas', value: 'guide', style: 'preferred', sub: 'L\'app te demande l\'exercice, puis les séries et les reps' },
    { label: 'Tout d\'un coup', value: 'libre', sub: 'Dis « séance push », puis chaque exercice' },
    { label: 'Annuler', style: 'cancel' }] });
  if (!mode) return;
  const lines = [];
  let step = 0;
  for (;;) {
    const guide = mode === 'guide', st = PIMP_STEPS[step % 2];
    let partial = '';
    const go = await PlanReader.dictation.start({ contextualStrings: planDictationWords(guide ? st.words : 'tout'),
      onPartial: t => { partial = t; const el = $('#pimpDict'); if (el) el.textContent = t; } });
    if (!go.ok) { if (go.message) showToast(go.message, { error: go.reason !== 'canceled' }); return; }
    const done = await sheet({ title: guide ? st.q : 'Dicte ton programme', cancel: 'Annuler', confirm: guide ? 'Suivant' : 'Terminé',
      body: `<p class="imp__lead">${esc(guide ? st.hint : 'Exemple : séance push, développé couché 4 séries de 10, ensuite élévations latérales 3 fois 15.')}</p>
        <p class="pimp-dict" id="pimpDict" role="status" aria-live="polite">${esc(lines.length ? `${lines.length} ligne${lines.length > 1 ? 's' : ''} dictée${lines.length > 1 ? 's' : ''}` : '')}</p>
        ${guide && lines.length ? '<button class="imp-pick imp-pick--keep" data-action="pimp-dict-end">J\'ai fini</button>' : ''}` });
    // Annuler, ou « J'ai fini » à la question suivante : ce qui vient d'être dit n'est pas gardé
    if (done === null) { await PlanReader.dictation.cancel(); if (!pimpDictEnd && !lines.length) return; break; }
    const r = await PlanReader.dictation.stop();
    const said = (r.ok ? r.text : partial).trim();
    if (said) lines.push(said);
    if (!guide) break;
    step++;
  }
  pimpDictEnd = false;
  if (!lines.length) return;
  pimpRead(lines.join('\n'), 'dictee');
}
let pimpDictEnd = false;

registerActions({
  'pimp-photo': async () => {
    const v = await dialog({ type: 'sheet', title: 'Photo du programme', actions: [{ label: 'Prendre une photo', value: 'camera', style: 'preferred' },
      { label: 'Choisir dans Photos', value: 'photos' }, { label: 'Annuler', style: 'cancel' }] });
    if (v) await pimpFromReader(v);
  },
  'pimp-scan': () => pimpFromReader('scan'),
  'pimp-dictate': () => pimpDictate(),
  'pimp-dict-end': () => { pimpDictEnd = true; closeTopSheet(); },
  'plan-import': (e, el) => openPlanImport(el?.dataset?.uid || null),
  'pimp-read': () => {
    const t = ($('#pimpText')?.value ?? pimp?.text ?? '').slice(0, PIMP_TEXT_MAX);
    if (!t.trim()) { showToast('Colle d\'abord le texte du programme'); $('#pimpText')?.focus(); return; }
    haptic();
    pimpRead(t);
  },
  'pimp-file': () => pimpChooseFile(),
  'pimp-edit-text': () => { if (pimp) navigate(makeRoute('plan-import', 'texte', ...(pimp.student ? [pimp.student] : []))); },
  'pimp-line': async (e, el) => {
    const it = pimpItem(el.dataset.id);
    if (!it) return;
    const v = await dialog({ type: 'sheet', title: it.name || it.raw || 'Ligne', message: it.src.trim().slice(0, 200), actions: [
      { label: it.level === 'unknown' ? 'Choisir l\'exercice' : 'Changer l\'exercice', value: 'ex', style: it.level === 'unknown' || it.why?.includes('nom') ? 'preferred' : 'default' },
      { label: 'Modifier séries et reps', value: 'presc' },
      { label: 'Retirer cette ligne', value: 'rm', style: 'destructive' },
      { label: 'Annuler', style: 'cancel' }] });
    if (v === 'ex') await pimpPickExercise(it);
    else if (v === 'presc') await pimpEditPresc(it);
    else if (v === 'rm') { it.removed = true; haptic(); render(); }
  },
  'pimp-pick': (e, el) => {
    const it = pimpItem(pimpPickFor);
    if (!it) return;
    const name = el.dataset.keep ? it.raw : catalogueEntry(el.dataset.name)?.name;
    if (!name) return;
    it.name = name.slice(0, EX_NAME_MAX); it.score = 1; it.how = 'manual';
    if (it.raw) pimp.learn[it.raw] = it.name;
    planGrade(it);
    closeTopSheet();
    haptic(); render();
  },
  'pimp-name': async () => {
    const v = await askText({ title: 'Nom du programme', value: pimpName(), max: SESSION_LABEL_MAX, placeholder: 'Ex : Force 5×5' });
    if (v && pimp) { pimp.name = v; render(); }
  },
  'pimp-session': async (e, el) => {
    const s = pimp?.draft?.sessions[+el.dataset.i];
    if (!s) return;
    const v = await askText({ title: 'Nom de la séance', value: s.label, max: SESSION_LABEL_MAX, placeholder: 'Ex : Push' });
    if (v) { s.label = v; render(); }
  },
  'pimp-save': () => pimpSave(),
});
