// ═══════════════════════════════════════════════════════════
//  Coach › Mes élèves › « Ordinateurs reliés » : voir les photos de bilan sur coach.mdlf.app (docs/PHOTOS_WEB.md).
//  Liste des ordinateurs reliés (nom, date, dernier usage, « Retirer »), et « Relier un ordinateur » : lecteur de QR
//  code natif (MdlfScanner.scanQr, nouvelle build), code de vérification comparé avec l'écran de l'ordinateur, puis
//  Face ID. Logique : js/data/photo-link-phone.js.
// ═══════════════════════════════════════════════════════════
'use strict';

// Cellule sous « Réception des photos : Activée » (js/features/coach-photos-ui.js, cphTeamSetupHtml)
function plinkCellHtml() {
  if (!plinkShown()) return '';
  const n = plink.devices?.length || 0;
  return `
          <button class="cell cell--nav" data-action="plink-open">
            ${icon('desktopcomputer', 20)}
            <span class="cell__body"><span class="cell__title">Ordinateurs reliés</span>
              <span class="cell__sub">${n ? plural(n, 'ordinateur', 'ordinateurs') : 'Voir les photos sur coach.mdlf.app'}</span></span>
            ${icon('chevron.right', 16)}
          </button>`;
}

function plinkUsedText(d) {
  if (!d.usedAt || (d.createdAt && Math.abs(d.usedAt - d.createdAt) < 60_000)) return d.createdAt ? `Relié le ${fmtDate(d.createdAt, 'short')}` : 'Relié';
  return `Relié le ${fmtDate(d.createdAt, 'short')} · utilisé le ${fmtDate(d.usedAt, 'short')}`;
}

function renderPlink() {
  const head = navBar({ title: 'Ordinateurs reliés', large: false });
  const view = body => `<div class="view view--grouped plink-view">${head}<div class="scr">${body}</div></div>`;
  if (!plinkShown()) return view('<div class="empty-note">Active d\'abord la réception des photos de bilan dans Coach › Mes élèves.</div>');
  if (plink.missing) return view(`<div class="empty-note">${esc(plinkErrorText('missing'))}</div>`);
  const list = plink.devices;
  const rows = list ? list.map(d => `
          <div class="cell plink-row">
            <span class="cell__body"><span class="cell__title">${esc(d.label)}</span><span class="cell__sub">${esc(plinkUsedText(d))}</span></span>
            <button class="cph-remove" data-action="plink-revoke" data-id="${esc(d.id)}" aria-label="Retirer ${esc(d.label)}">Retirer</button>
          </div>`).join('') : '';
  const full = (list?.length || 0) >= PLINK_DEVICE_MAX;
  return view(`
        <div class="group">
          <button class="cell cell--action" data-action="plink-scan" ${plink.busy || full ? 'disabled' : ''}>${icon('qrcode', 20)}<span>Relier un ordinateur</span></button>
        </div>
        <div class="group-foot">${full ? 'Tu as 5 ordinateurs reliés : retires-en un pour en relier un autre.' : 'Sur l\'ordinateur, ouvre coach.mdlf.app, connecte-toi, puis « Relier cet ordinateur » : vise le QR code affiché. Ne relie pas un ordinateur partagé.'}</div>
        <div class="group-title">Reliés</div>
        <div class="group">${list ? rows || '<div class="cell"><span class="cell__sub">Aucun ordinateur relié.</span></div>' : `<div class="cell"><span class="cell__sub">${plink.error ? esc(plinkErrorText(plink.error)) : 'Chargement…'}</span></div>`}</div>
        <div class="group-foot">Un ordinateur relié ouvre les photos de tes élèves sans ton iPhone. Il est retiré tout seul après 30 jours sans usage, et au plus tard 90 jours après.</div>
        <div class="group">
          <button class="cell cell--destructive" data-action="cph-rekey" ${plink.busy || cphCoach.busy ? 'disabled' : ''}>Créer une nouvelle clé de photos…</button>
        </div>
        <div class="group-foot">Ordinateur perdu ou volé : retire-le, puis crée une nouvelle clé. Une copie de son disque ne servira plus. Les photos déjà reçues sont supprimées (elles s'ouvrent seulement avec l'ancienne clé) et tous les ordinateurs sont retirés ; tes élèves pourront te renvoyer leurs photos.</div>`);
}
SCREENS.set('coach-devices', { render: () => renderPlink(), enter: () => { plinkDevicesRefresh(); } });

async function plinkScanFlow() {
  if (plink.busy) return;
  const scan = await Native.scanner.scanQr();
  if (scan.canceled) return;
  if (scan.outdated || scan.unavailable) { showToast('Mets à jour l\'app MDLF Training pour relier un ordinateur.', { error: true }); return; }
  if (scan.denied) { showToast('Autorise l\'appareil photo dans Réglages › MDLF Training.', { error: true }); return; }
  if (!scan.code) { showToast('Le QR code n\'a pas pu être lu. Réessaie.', { error: true }); return; }
  plink.busy = true; render();
  try {
    const r = await plinkPhoneStart(scan.code);
    if (!r.ok) { showToast(plinkErrorText(r.kind), { error: true }); return; }
    const asked = r.link.askedAt ? ` à ${fmtTime(r.link.askedAt)}` : '';
    const ok = await dialog({ title: `Code de vérification : ${r.link.sas}`,
      message: `Code demandé${asked} par « ${r.link.label} ». Relie seulement un ordinateur devant toi, où tu as ouvert toi-même coach.mdlf.app : même code à l'écran, et l'adresse coach.mdlf.app dans la barre du navigateur. Sinon, Annuler : rien ne sera envoyé.`,
      actions: [{ label: 'Annuler', style: 'cancel' }, { label: 'Relier', value: true, style: 'preferred' }] });
    if (ok !== true) { await r.link.cancel(); announce('Rien n\'a été envoyé'); return; }
    const f = await r.link.finish();
    if (!f.ok) {
      if (!f.canceled) showToast(f.mismatch ? CPH_MISMATCH_TITLE : f.nopasscode ? 'Active d\'abord le code de verrouillage de ton iPhone' : f.missing ? 'Ta clé n\'est pas sur cet iPhone.' : plinkErrorText(f.kind), { error: true });
      return;
    }
    haptic('success');
    showToast('Ordinateur relié');
  } finally { plink.busy = false; render(); }
}

onCoachChange(() => { if (currentView() === 'coach-devices' && !document.activeElement?.matches?.('input, textarea, select')) render(); });

registerActions({
  'plink-open': () => navigate('coach-devices'),
  'plink-scan': () => plinkScanFlow(),
  'plink-revoke': async (e, el) => {
    const d = plink.devices?.find(x => x.id === el.dataset.id);
    if (!d || !(await confirmSheet(`Retirer ${d.label} ?`, 'Cet ordinateur ne pourra plus ouvrir les photos de tes élèves. Ordinateur perdu ou volé ? Crée aussi une nouvelle clé de photos (plus bas sur cet écran) : une copie de son disque ne servira plus.', 'Retirer'))) return;
    const r = await plinkRevoke(d.id);
    if (!r.ok) { showToast(coachErrorText(r.kind), { error: true }); return; }
    showToast('Ordinateur retiré');
  },
});
