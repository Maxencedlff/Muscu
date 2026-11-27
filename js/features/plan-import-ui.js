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

// Lecture sur l'appareil, iPhone ou iPad (Apple Vision, dictée hors ligne : js/platform/plan-reader.js) : proposée seulement
// quand le module natif est là ; sinon l'écran reste sur Coller et Choisir un fichier
const pimpReader = () => typeof PlanReader !== 'undefined' && PlanReader.available === true;
// Dicter n'est proposé que si la dictée marche hors ligne sur cet appareil (status().onDevice, demandé une fois sans rien
// autoriser) : jamais de bascule vers les serveurs d'Apple (texte de NSSpeechRecognitionUsageDescription, Info.plist)
let pimpDictOnDevice = null;
const pimpDictation = () => {
  if (typeof PlanReader === 'undefined' || PlanReader.dictation?.available !== true) return false;
  if (pimpDictOnDevice === null) {
    pimpDictOnDevice = false;
    Promise.resolve(PlanReader.dictation.status()).then(r => {
      pimpDictOnDevice = r?.available === true && r?.onDevice === true;
      if (pimpDictOnDevice && routeName(currentRoute()) === 'plan-import') render();
    }).catch(() => {});
  }
  return pimpDictOnDevice === true;
};

// ── Écran 1 : coller le texte ou choisir un fichier ──────────
function renderPimpText(student) {
  const st = pimpState(student || null);
  const who = student ? personName(coachStudent(student)) : '';
  return `
    <div class="view view--grouped pimp-view">
      ${navBar({ title: 'Importer un programme' })}
      <div class="scr">
        <p class="pimp-lead">${who ? `Le programme de ${esc(who)}, tel que tu l'as déjà : ` : 'Ton programme tel que tu l\'as déjà : '}${pimpReader() ? 'une feuille, même écrite à la main, ' : ''}un message, un tableau, le texte d'un PDF. L'app le lit, puis tu vérifies.</p>
        ${pimpReader() || pimpDictation() ? `<div class="group pimp-sources">
          ${pimpReader() ? `<button class="cell cell--action" data-action="pimp-photo">${icon('camera', 20)}<span>Photo</span></button>
          <button class="cell cell--action" data-action="pimp-scan">${icon('doc.on.doc', 20)}<span>Scanner une feuille</span></button>` : ''}
          ${pimpDictation() ? `<button class="cell cell--action" data-action="pimp-dictate">${icon('waveform', 20)}<span>Dicter</span></button>` : ''}
        </div>
        <div class="group-title">Ou colle le texte</div>` : ''}
        <div class="group group--pad">
          <label class="sr-text" for="pimpText">Texte du programme</label>
          <textarea id="pimpText" class="pimp-text" rows="10" autocapitalize="sentences" spellcheck="false"
            placeholder="Lundi : Push&#10;Développé couché 4x8-10, repos 2 min&#10;Élévations latérales 3x15&#10;&#10;Mercredi : Pull&#10;Tractions 4 × max">${esc(st.text)}</textarea>
        </div>
        <div class="group-foot">Une séance par titre (« Lundi », « Push », « Séance A »), un exercice par ligne. Les abréviations de salle (DC, SDT, RDL…) sont comprises.</div>
        <div class="prog-info__actions">
          <button class="btn btn--primary btn--full" data-action="pimp-read">Lire le programme</button>
        </div>
        <div class="group group--gap">
          <button class="cell cell--action" data-action="pimp-file">${icon('doc.text', 20)}<span>Choisir un fichier</span></button>
        </div>
        <div class="group-foot">PDF, texte, ou export de Hevy ou Strong. ${esc(pimpPrivacyText())}</div>
      </div>
    </div>`;
}

// Ce qui part, en clair (privacy.html, « corrections retenues à l'import d'un programme ») : la photo, la voix et le
// texte sont lus sur l'appareil ; avec un compte, le programme enregistré et les corrections y sont copiés
function pimpPrivacyText() {
  const what = pimpReader() ? (pimpDictation() ? 'La photo, la voix et le texte' : 'La photo et le texte') : 'Le texte';
  return `${what} sont lus sur ${thisPhone()}, sans être envoyés. ${typeof account !== 'undefined' && account.user ? 'Le programme enregistré et tes corrections sont copiés sur ton compte.' : 'Avec un compte, le programme enregistré et tes corrections y sont copiés.'}`;
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
  if (p.weighted) bits.push('lesté');
  return bits.join(' · ');
}
function pimpWhyText(it) {
  if (it.level === 'unknown') return it.guess ? `Pas dans la bibliothèque. Peut-être ${it.guess} ?` : 'Pas dans la bibliothèque : touche pour choisir';
  const w = it.why || [];
  if (w.includes('nom')) return 'Nom proche : vérifie l\'exercice';
  if (w.includes('matériel')) return 'Matériel différent de ta ligne : vérifie l\'exercice';
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
  const cut = pimpCutText(st);
  return `
    <div class="view view--grouped pimp-view">
      ${navBar({ title: 'Vérifier l\'import' })}
      <div class="scr">
        <p class="pimp-lead" role="status">${esc(summary)}${items.length ? ' Touche une ligne pour la corriger.' : ''}</p>
        ${cut ? `<div class="group pimp-cut"><div class="cell"><span class="cell__body"><span class="cell__title">Programme incomplet</span><span class="cell__sub">${esc(cut)}</span></span></div></div>` : ''}
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
        <div class="group-foot">${st.student ? `Ajouté à tes programmes, prêt à envoyer à ${esc(personName(coachStudent(st.student)))}. Tes séances ne changent pas.` : 'Le programme s\'ajoute à Mes programmes.'} Tes corrections sont retenues pour le prochain import (Réglages › Programmes › Corrections retenues).</div>
      </div>
    </div>`;
}
// Limites atteintes : texte coupé à PIMP_TEXT_MAX ou par le moteur, 300 exercices, 14 séances (plan-parser.js) : dit en clair
function pimpCutText(st) {
  const c = st?.draft?.cut || {}, out = [];
  if (st?.pagesCut) out.push(`seules les ${st.pagesCut.pagesRead} premières pages sur ${st.pagesCut.pageCount} sont lues`);
  if (st?.textCut || c.text) out.push(`le texte est coupé après ${fmtNum(PIMP_TEXT_MAX)} caractères`);
  if (c.items) out.push(`${PARSE_MAX_ITEMS} exercices au plus sont repris`);
  if (c.sessions) out.push(`${PARSE_MAX_SESSIONS} séances au plus sont reprises`);
  if (!out.length) return '';
  const t = out.join(', ');
  return `${t[0].toUpperCase()}${t.slice(1)} : la fin manque. Importe-la à part, dans un second programme.`;
}
const pimpName = () => (pimp?.name || pimp?.draft?.title || 'Programme importé').slice(0, SESSION_LABEL_MAX);
SCREENS.set('plan-import', { render: (step, student) => (step === 'verifier' ? renderPimpReview(student) : renderPimpText(student)) });

// ── Lecture ─────────────────────────────────────────────────
function pimpRead(text, source = 'texte', { pagesRead = 0, pageCount = 0 } = {}) {
  const st = pimpState(pimp?.student || null);
  const full = String(text ?? '');
  st.text = full.slice(0, PIMP_TEXT_MAX);
  st.textCut = full.length > PIMP_TEXT_MAX;
  st.pagesCut = pagesRead && pageCount > pagesRead ? { pagesRead, pageCount } : null;
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
  // Pas de maxlength sur la zone : un texte collé trop long serait coupé sans rien dire ; il l'est à la lecture, et dit
  else if (ev.target?.id === 'pimpText' && pimp) pimp.text = ev.target.value.slice(0, PIMP_TEXT_MAX + 1);
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
  showToast(student ? `« ${name} » ajouté à tes programmes, prêt à envoyer à ${personName(coachStudent(student))}`
    : `« ${name} » enregistré${learned ? `, ${plural(learned, 'correction retenue', 'corrections retenues')}` : ''}`);
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
        const r = await pimpReading(onProgress => PlanReader.readFile(file, { customWords: planDictationWords('exercice'), onProgress }), true);
        if (r.ok) pimpRead(planTextFromPages(r.pages), 'photo'); else if (r.message) showToast(r.message, { error: r.reason !== 'canceled' });
        return;
      }
      if (isPdf) {
        showToast('Lecture du PDF…');
        const r = await planPdfText(await file.arrayBuffer());
        if (!r.text.trim() && pimpReader()) {
          const scan = await pimpReading(onProgress => PlanReader.readFile(file, { customWords: planDictationWords('exercice'), onProgress }), true);
          if (scan.ok) { pimpRead(planTextFromPages(scan.pages), 'scan', scan.truncated ? { pagesRead: scan.pages.length, pageCount: scan.pageCount } : {}); return; }
          if (scan.message) showToast(scan.message, { error: scan.reason !== 'canceled' });
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

// Lecture par Vision, page par page : feuille « Page N sur M » avec Annuler (PlanReader.cancelRead, la lecture s'arrête
// avant la page suivante). Ouverte tout de suite pour un fichier, à la première page lue pour Photo et Scanner (le
// sélecteur d'Apple passe d'abord)
async function pimpReading(task, eager = false) {
  let root = null, over = false;
  const open = () => {
    if (root || over) return;
    sheet({ title: 'Lecture du programme', cancel: 'Annuler', confirm: '',
      body: '<p class="pimp-dict" id="pimpProgress" role="status" aria-live="polite">Lecture en cours…</p>' })
      .then(() => { if (!over) PlanReader.cancelRead?.(); });
    const roots = document.querySelectorAll('.sheet-root:not(.sheet-root--out)');
    root = roots[roots.length - 1] || null;
  };
  if (eager) open();
  const onProgress = ({ done, total } = {}) => {
    open();
    const el = $('#pimpProgress');
    if (el && total > 1) el.textContent = `Page ${Math.min(done + 1, total)} sur ${total}`;
  };
  try { return await task(onProgress); } finally { over = true; root?._close?.(null); }
}
// Photo, appareil photo ou feuille numérisée : pages lues par Vision, mises en lignes et colonnes par planTextFromPages
async function pimpFromReader(source) {
  const r = await pimpReading(onProgress => PlanReader.pick(source, { limit: 5, customWords: planDictationWords('exercice'), onProgress }));
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
  const mode = await dialog({ type: 'sheet', title: 'Dicter le programme', message: `Sur ${thisPhone()}, sans Internet.`, actions: [
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
    // « J'ai fini » à la question suivante : ce qui vient d'être dit n'est pas gardé, le reste est lu.
    // Annuler : toute la dictée est abandonnée, rien n'est lu
    if (done === null) {
      await PlanReader.dictation.cancel();
      const end = pimpDictEnd;
      pimpDictEnd = false;
      if (!end) return;
      break;
    }
    const r = await PlanReader.dictation.stop();
    const said = (r.ok ? r.text : partial).trim();
    // Réponse vide : la même question revient (l'exercice et ses séries ne se décalent pas)
    if (!said) { showToast('Rien entendu, redis-le'); continue; }
    lines.push(said);
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
    const t = ($('#pimpText')?.value ?? pimp?.text ?? '').slice(0, PIMP_TEXT_MAX + 1);
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
      { label: it.level === 'unknown' ? 'Choisir l\'exercice' : 'Changer l\'exercice', value: 'ex', style: it.level === 'unknown' || it.why?.includes('nom') || it.why?.includes('matériel') ? 'preferred' : 'default' },
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

// ── Réglages › Corrections retenues ─────────────────────────
// Les corrections apprises à l'import (mots lus → nom de l'exercice, js/data/plan-aliases.js), copiées sur le compte
// (privacy.html) : listées, les plus récentes d'abord ; chacune s'oublie (pierre tombale datée : la synchro ne la
// ramène pas d'un autre appareil), ou toutes d'un coup
function renderPlanAliases() {
  const list = planAliasesList();
  const rows = list.map(a => `
          <button class="cell cell--nav" data-action="pimp-alias" data-key="${esc(a.key)}" aria-label="${esc(`« ${a.key} » lu comme ${a.name}`)}">
            <span class="cell__body"><span class="cell__sub">« ${esc(clipText(a.key, 60))} »</span><span class="cell__title">${esc(a.name)}</span></span>
            ${icon('chevron.right', 16)}
          </button>`).join('');
  return `
    <div class="view view--grouped pimp-view">
      ${navBar({ title: 'Corrections retenues' })}
      <div class="scr">
        <p class="pimp-lead">Quand tu corriges un exercice à l'import d'un programme, l'app retient les mots lus et l'exercice choisi, pour le reconnaître la prochaine fois.${account.user ? ' Elles sont copiées sur ton compte, pour tes autres appareils.' : ''}</p>
        ${list.length ? `<div class="group">${rows}</div>
        <div class="group">
          <button class="cell cell--destructive" data-action="pimp-aliases-forget"><span class="cell__title">Tout oublier</span></button>
        </div>` : '<div class="group"><div class="cell"><span class="cell__body"><span class="cell__sub">Aucune correction retenue.</span></span></div></div>'}
      </div>
    </div>`;
}
SCREENS.set('plan-aliases', { render: () => renderPlanAliases() });
// Cellule de Réglages (js/features/settings.js), seulement quand il y a quelque chose à voir
function planAliasesSettingsHtml() {
  const n = planAliasesList().length;
  if (!n) return '';
  return `
        <div class="group-title">Programmes</div>
        <div class="group">
          <button class="cell cell--nav" data-action="go-plan-aliases">
            ${cellIco('square.and.arrow.down', 'gray')}
            <span class="cell__body"><span class="cell__title">Corrections retenues</span></span>
            <span class="cell__value num">${n}</span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
        <div class="group-foot">Les exercices corrigés à l'import d'un programme.</div>`;
}

registerActions({
  'go-plan-aliases': () => navigate('plan-aliases'),
  'pimp-alias': async (e, el) => {
    const key = el.dataset.key, name = planLearnedAliases()[key];
    if (typeof name !== 'string') return;
    const v = await dialog({ type: 'sheet', title: `« ${clipText(key, 60)} »`, message: `Lu comme ${name} au prochain import.`, actions: [
      { label: 'Oublier cette correction', value: 'rm', style: 'destructive' }, { label: 'Annuler', style: 'cancel' }] });
    if (v !== 'rm' || !planForgetAliasKey(key)) return;
    save(); haptic(); render();
  },
  'pimp-aliases-forget': async () => {
    const n = planAliasesList().length;
    if (!n) return;
    const v = await dialog({ title: 'Tout oublier ?', message: `${plural(n, 'correction retenue sera oubliée', 'corrections retenues seront oubliées')}, aussi sur tes autres appareils. Tes programmes ne changent pas.`,
      actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Tout oublier', value: 'rm', style: 'destructive' }] });
    if (v !== 'rm') return;
    const now = Date.now();
    planAliasesList().forEach(a => planForgetAliasKey(a.key, data, now));
    save(); haptic(); render();
  },
});
