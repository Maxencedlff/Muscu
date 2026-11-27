// ═══════════════════════════════════════════════════════════
//  Importer un programme : « Lire avec l'aide de l'IA » (docs/IMPORT_IA.md), sur l'écran « Vérifier l'import ».
//  Le moteur gratuit a déjà lu le texte sur le téléphone. Quand il hésite (planAiAdvice, js/data/plan-ai.js), un
//  bouton plein est proposé en haut ; sinon un simple lien neutre en bas. Un toucher envoie à la fonction serveur
//  plan-import-ai seulement les lignes douteuses (ou tout le texte quand presque rien n'est sûr), sans nom d'élève.
//  La photo ne part qu'avec un accord donné à chaque fois, réduite à 1600 px. Le résultat revient dans le même écran
//  « Vérifier » ; hors ligne, sans compte, au-delà du quota ou en panne : un message clair, le résultat du moteur reste.
// ═══════════════════════════════════════════════════════════
'use strict';

// Phrase demandée par Maxence, précisée : Anthropic efface les entrées sous 30 jours, l'app ne garde rien (privacy.html)
const PAI_PHOTO_CONSENT = 'La photo est envoyée à Anthropic pour être lue, puis n\'est pas gardée par MDLF Training (Anthropic l\'efface sous 30 jours).';
const PAI_IMAGE_EDGE = 1600, PAI_IMAGE_MAX = 2_000_000;
const PAI_KEEP = 'Le résultat du moteur reste.';
const PAI_ERRORS = {
  auth: `Connecte-toi pour utiliser l'aide de l'IA. ${PAI_KEEP}`,
  offline: `Hors ligne : l'aide de l'IA demande Internet. ${PAI_KEEP}`,
  quota_user: `Tu as utilisé tes 20 lectures avec l'IA aujourd'hui. ${PAI_KEEP} Réessaie demain.`,
  quota_global: `L'aide de l'IA est en pause pour le moment. ${PAI_KEEP}`,
  ai_off: `L'aide de l'IA est indisponible pour le moment. ${PAI_KEEP}`,
  too_large: `Ce texte est trop long pour l'aide de l'IA. ${PAI_KEEP}`,
  failed: `L'aide de l'IA n'a pas pu lire ce programme. ${PAI_KEEP}`,
};

// Conseil du moteur pour le brouillon affiché (recalculé à chaque rendu : une correction du coach le change)
const pimpAiAdvice = st => (st?.draft ? planAiAdvice(st.draft, { text: st.text }) : { propose: false, mode: null, targets: [], doubtful: 0 });
const pimpAiProposed = st => !st?.ai && pimpAiAdvice(st).propose;
const pimpHasPhoto = st => st?.source === 'photo-fichier' || st?.source === 'photo' || st?.source === 'camera' || st?.source === 'photos' || st?.source === 'scan';

function pimpAiHtml(st, where) {
  if (!st?.draft) return '';
  if (st.ai?.busy) {
    return where === 'top' ? `<div class="group pimp-ai"><div class="cell"><span class="cell__body"><span class="cell__title" role="status" aria-live="polite">Lecture avec l'aide de l'IA…</span>
      <span class="cell__sub">Quelques secondes. Tu peux attendre ici.</span></span></div></div>` : '';
  }
  if (st.ai?.done) {
    return where === 'top' ? `<p class="pimp-lead pimp-ai-done" role="status">Relu avec l'aide de l'IA${st.ai.changed ? ` : ${plural(st.ai.changed, 'ligne corrigée', 'lignes corrigées')}` : ', rien à changer'}. Vérifie comme d'habitude.</p>` : '';
  }
  const adv = pimpAiAdvice(st);
  const foot = `${pimpAiWhat(adv)}, après ton accord, sans ton nom ni celui d'un élève.`;
  if (where === 'top' && adv.propose) {
    return `<div class="prog-info__actions pimp-ai">
          <button class="btn btn--primary btn--full" data-action="pimp-ai">Lire avec l'aide de l'IA</button>
        </div>
        <div class="group-foot">Le moteur hésite sur ${plural(adv.doubtful || 1, 'ligne', 'lignes')}. ${esc(foot)}</div>`;
  }
  if (where === 'bottom' && !adv.propose) {
    return `<div class="pimp-ai-more"><button class="pimp-ai-link" data-action="pimp-ai">Lire avec l'aide de l'IA</button></div>`;
  }
  return '';
}

// Ce qui part, en clair : « Les 3 lignes douteuses sont envoyées à Anthropic (Claude) pour être lues »
function pimpAiWhat(adv) {
  const n = adv.targets.length;
  if (adv.mode !== 'lines') return 'Le texte lu est envoyé à Anthropic (Claude) pour être lu';
  return n > 1 ? `Les ${n} lignes douteuses sont envoyées à Anthropic (Claude) pour être lues` : 'La ligne douteuse est envoyée à Anthropic (Claude) pour être lue';
}

// Photo réduite (1600 px sur le grand côté, JPEG) en base64 ; null si l'image ne se lit pas
async function pimpAiShrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, PAI_IMAGE_EDGE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    for (const q of [0.85, 0.7, 0.55]) {
      const url = c.toDataURL('image/jpeg', q);
      const data = url.slice(url.indexOf(',') + 1);
      if (data.length * 3 / 4 <= PAI_IMAGE_MAX) return data;
    }
  } catch { /* image illisible */ }
  return null;
}
function pimpAiPickImage() {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = ev => resolve(ev.target.files?.[0] || null);
    inp.oncancel = () => resolve(null);
    inp.click();
  });
}

// Appel de la fonction serveur : { ok, data } ou { ok: false, kind } (clé de PAI_ERRORS)
async function pimpAiInvoke(body) {
  if (typeof sb === 'undefined' || !sb || !account?.user) return { ok: false, kind: 'auth' };
  if (navigator.onLine === false) return { ok: false, kind: 'offline' };
  try {
    const { data, error } = await sb.functions.invoke('plan-import-ai', { body });
    if (!error) return data?.ok ? { ok: true, data } : { ok: false, kind: 'failed' };
    const status = error.context?.status;
    let info = {};
    try { info = await error.context.json(); } catch { /* corps illisible */ }
    if (!status) return { ok: false, kind: isNetworkError(error) ? 'offline' : 'failed' };
    if (status === 401) return { ok: false, kind: 'auth' };
    if (status === 404) return { ok: false, kind: 'ai_off' };   // fonction pas encore déployée
    if (status === 413) return { ok: false, kind: 'too_large' };
    const code = String(info?.error || '');
    return { ok: false, kind: Object.hasOwn(PAI_ERRORS, code) ? code : 'failed' };
  } catch (e) {
    return { ok: false, kind: isNetworkError(e) ? 'offline' : 'failed' };
  }
}

async function pimpAskAi() {
  const st = pimp;
  if (!st?.draft || st.ai?.busy) return;
  if (typeof account === 'undefined' || !account.user) { await dialog({ title: 'Aide de l\'IA', message: PAI_ERRORS.auth, actions: [{ label: 'OK', style: 'preferred' }] }); return; }
  if (navigator.onLine === false) { showToast(PAI_ERRORS.offline, { error: true }); return; }
  // Accord explicite à CHAQUE envoi (règle 5.1.2(i) d'Apple : données envoyées à une IA tierce) : qui reçoit, quoi.
  // Photo : proposée seulement si l'import vient d'une photo, jamais cochée d'office, second accord avec sa phrase
  const v = await dialog({ type: 'sheet', title: 'Lire avec l\'aide de l\'IA',
    message: `${pimpAiWhat(pimpAiAdvice(st))}, sans ton nom ni celui d'un élève. MDLF Training n'en garde rien ; Anthropic l'efface sous 30 jours.`,
    actions: [
      { label: pimpHasPhoto(st) ? 'Envoyer le texte lu' : 'Envoyer', value: 'text', style: 'preferred' },
      ...(pimpHasPhoto(st) ? [{ label: 'Envoyer la photo pour une meilleure lecture', value: 'photo', sub: 'Un second accord est demandé' }] : []),
      { label: 'Annuler', style: 'cancel' }] });
  if (!v) return;
  let withPhoto = false;
  if (v === 'photo') {
    const ok = await dialog({ title: 'Envoyer la photo ?', message: PAI_PHOTO_CONSENT, actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Envoyer la photo', value: 'yes', style: 'preferred' }] });
    if (ok !== 'yes') return;
    withPhoto = true;
  }
  const names = st.student ? [personName(coachStudent(st.student))].filter(n => n && n !== 'Compte masqué') : [];
  const adv = pimpAiAdvice(st);
  let body;
  if (withPhoto) {
    const file = st.image || await pimpAiPickImage();
    if (!file) return;
    const data = await pimpAiShrink(file);
    if (!data) { showToast('Photo illisible', { error: true }); return; }
    body = { mode: 'image', consent: true, image: { media_type: 'image/jpeg', data } };
  } else if (adv.mode === 'lines') body = planAiLinesBody(st.draft, adv.targets, { names });
  else body = planAiPlanBody(st.text, { names });
  st.ai = { busy: true };
  haptic(); render();
  const r = await pimpAiInvoke(body);
  if (pimp !== st) return;
  if (!r.ok) { st.ai = null; render(); showToast(PAI_ERRORS[r.kind] || PAI_ERRORS.failed, { error: true }); return; }
  let changed = 0;
  if (body.mode === 'lines') changed = planAiApplyLines(st.draft, adv.targets, r.data.results);
  else {
    const d = planAiAdopt(r.data.draft, planLearnedAliases());
    if (!d || !d.sessions.length) { st.ai = null; render(); showToast(PAI_ERRORS.failed, { error: true }); return; }
    d.cut.text = !!st.draft.cut?.text;
    changed = d.stats.items;
    st.draft = d;
  }
  st.ai = { done: true, changed };
  haptic(); render();
}
