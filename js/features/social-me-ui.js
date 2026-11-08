// ═══════════════════════════════════════════════════════════
//  Social › Mon profil (mon avatar en haut à droite de l'onglet) : carte d'athlète (avatar, pseudo, membre
//  depuis, chiffres : séances visibles, abonnés, abonnements ; régularité sur 12 semaines), Mes séances
//  (la dernière en grand avec ses réactions, trois en aperçu, « Tout voir »), Records récents, Activité
//  (réactions groupées par séance, commentaires, nouveaux abonnés, demandes, du plus récent au plus
//  ancien ; trois lignes puis « Tout voir »), Inviter un ami, puis Gérer (demandes envoyées, bloqués, désactivation).
//  Abonnés et Abonnements : écrans à part (social-people), ouverts depuis les chiffres.
//  Ouvrir Mon profil vaut « activité vue » (mark_activity_seen) : la pastille de l'onglet s'éteint, les
//  nouveautés gardent leur point bleu jusqu'à la prochaine ouverture.
//  Données : js/data/social.js (socialActivity, SOCIAL_ME, socialMarkActivitySeen). Tout texte venu du
//  serveur passe par esc().
// ═══════════════════════════════════════════════════════════
'use strict';

const ME_ACTIVITY_SHOWN = 3;   // lignes d'activité avant « Tout voir »
const ME_SESSIONS_SHOWN = 3;   // séances en aperçu sous la dernière, avant « Tout voir »
let meActivityAll = false;     // « Tout voir » touché (jusqu'à la sortie de Mon profil)
let meSessionsAll = false;     // idem pour Mes séances

// Bouton de l'onglet Social (en haut à droite) : mon avatar, avec un point s'il y a du nouveau
function meButtonHtml() {
  const n = socialActivityNew();
  return `<button class="navbar__icon navbar__avatar me-btn" data-action="social-me" aria-label="${esc(n ? `Mon profil, ${plural(n, 'nouveauté', 'nouveautés')}` : 'Mon profil')}">
      ${avatarHtml('s')}${n ? '<span class="me-btn__dot" aria-hidden="true"></span>' : ''}
    </button>`;
}
// Le point suit l'état sans redessiner l'onglet (la recherche garde le clavier)
function refreshMeButton() {
  const btn = $('.me-btn');
  if (btn) btn.outerHTML = meButtonHtml();
}

// Une de mes séances, si cet appareil l'a (null sinon)
function myHistoryEntry(sessionId) {
  return (sessionId && (data.history || []).find(h => h.id === sessionId)) || null;
}
// Nom d'une de mes séances : celui de cet appareil s'il la connaît (le serveur n'a que son libellé)
function mySessionLabel(sessionId) {
  const h = myHistoryEntry(sessionId);
  return h ? rawLabel(h.category, entryProg(h)) : '';
}

// Ligne de l'activité : avatar, « pseudo a réagi 🔥 à ta séance Legs » (ou « a commenté ta séance Legs :
// « … » »), depuis quand ; point bleu si nouvelle. Réaction, commentaire : vers ma séance (Historique,
// avec ses commentaires) si cet appareil l'a, sinon le profil de la personne.
// Demande reçue : Accepter et Refuser, comme dans l'onglet.
function activityRowHtml(a) {
  const name = personName(a);
  const text = activityText(a, mySessionLabel(a.sessionId));
  const local = (a.kind === 'reaction' || a.kind === 'comment') && !!myHistoryEntry(a.sessionId);
  const open = local ? `data-action="social-open-my-session" data-id="${esc(a.sessionId)}"` : `data-action="social-open-profile" data-uid="${esc(a.user_id)}"`;
  const trailing = a.kind === 'request' && socialRelation(a.user_id, social.state).pendingIn
    ? pill('social-accept', a.user_id, 'Accepter', { fill: true, aria: `Accepter ${name}` })
      + `<button class="social-x" data-action="social-refuse" data-uid="${esc(a.user_id)}" aria-label="${esc(`Refuser ${name}`)}">${icon('xmark', 14)}</button>`
    : '';
  return `
    <div class="cell social-row activity-row">
      <button class="social-row__main" ${open}>
        ${personAvatar(a)}
        <span class="social-row__text">
          <span class="activity-row__text"><b>${esc(name)}</b> ${esc(text)}</span>
          <span class="cell__sub">${esc(fmtAgo(a.at))}</span>
        </span>
        ${a.isNew ? '<span class="activity-row__new" role="img" aria-label="Nouveau"></span>' : ''}
      </button>
      ${trailing}
    </div>`;
}

// Avatars empilés (3 au plus), sans doublon
function stackHtml(people) {
  const seen = new Set(), list = people.filter(p => !seen.has(p.user_id) && seen.add(p.user_id)).slice(0, 3);
  return `<span class="stack" aria-hidden="true">${list.map(p => personAvatar(p, 's')).join('')}</span>`;
}
// Ligne de plusieurs réactions à une même séance (groupActivity, js/data/social.js) :
// « 3 réactions sur Push de vendredi », puis qui et depuis quand. Vers ma séance si cet appareil l'a.
function reactionsGroupHtml(g) {
  const first = g.rows[0], local = myHistoryEntry(g.sessionId);
  const label = mySessionLabel(g.sessionId) || first.label;
  const text = reactionsGroupText(g.rows.length, label, local ? local.date : first.sessionAt);
  const open = local ? `data-action="social-open-my-session" data-id="${esc(g.sessionId)}"` : `data-action="social-open-profile" data-uid="${esc(first.user_id)}"`;
  const isNew = g.rows.some(a => a.isNew);
  return `
    <div class="cell social-row activity-row activity-row--group">
      <button class="social-row__main" ${open}>
        ${stackHtml(g.rows)}
        <span class="social-row__text">
          <span class="activity-row__text"><b>${esc(text)}</b></span>
          <span class="cell__sub">${esc(reactorsLine(g.rows.map(personName)))} · ${esc(fmtAgo(first.at))}</span>
        </span>
        ${isNew ? '<span class="activity-row__new" role="img" aria-label="Nouveau"></span>' : ''}
      </button>
    </div>`;
}

function meActivityHtml() {
  const a = socialActivity();
  if (!a.rows.length) {
    if (a.loading || (!a.loadedAt && !a.error)) return '<div class="group"><div class="cell"><span class="cell__sub">Chargement…</span></div></div>';
    if (a.error) return offlineNote(a.error === 'offline' ? 'Pas d\'Internet : l\'activité s\'affichera quand le réseau reviendra.' : socialErrorText(a.error));
    return '<div class="group"><div class="cell"><span class="cell__sub social-empty">Rien pour l\'instant. Les réactions et commentaires sur tes séances et les personnes qui commencent à te suivre s\'afficheront ici.</span></div></div>';
  }
  const groups = groupActivity(a.rows);
  const shown = meActivityAll ? groups : groups.slice(0, ME_ACTIVITY_SHOWN);
  // Tout voir : des lignes masquées ici, ou d'autres encore sur le serveur (!a.end)
  const more = (meActivityAll ? !a.end : groups.length > ME_ACTIVITY_SHOWN || !a.end)
    ? `<button class="see-all" data-action="social-activity-more" ${a.loading ? 'disabled' : ''}>${a.loading ? 'Chargement…' : meActivityAll ? 'Afficher plus<span class="sr-text"> d\'activité</span>' : 'Tout voir<span class="sr-text"> l\'activité</span>'}${icon('chevron.right', 12)}</button>` : '';
  return `<div class="group activity">${shown.map(g => (g.kind === 'single' ? activityRowHtml(g.row) : reactionsGroupHtml(g))).join('')}</div>${more}`;
}

// Régularité : séances par semaine sur 12 semaines, monochrome, la semaine en cours en accent. La moyenne
// et sa période sont écrites à côté du chiffre ; VoiceOver lit un résumé.
function regularityHtml() {
  const { weeks, avg, span } = regularity(12);
  if (!span) return '';
  const max = Math.max(1, ...weeks.map(w => w.n)), cur = weeks[weeks.length - 1].n;
  const avgTxt = fmtNum(avg, 1), period = plural(span, 'semaine', 'semaines');
  const unit = avg >= 2 ? 'séances' : 'séance';   // « 1,5 séance », « 2 séances » (pluriel français dès 2)
  const bars = weeks.map((w, i) => `<span class="reg__bar${i === weeks.length - 1 ? ' reg__bar--now' : ''}" style="height:${w.n ? Math.max(12, Math.round(w.n / max * 100)) : 6}%"></span>`).join('');
  // Aucune séance dans la fenêtre (historique plus ancien) : un constat neutre plutôt qu'un « 0 » en grand
  const none = `Aucune séance ces ${span} dernières semaines`;
  const spoken = avg ? `${avgTxt} ${unit} par semaine en moyenne sur ${period}, ${plural(cur, 'séance', 'séances')} cette semaine` : none;
  const head = avg
    ? `<p class="reg__head" aria-hidden="true"><span class="reg__val num">${avgTxt}</span><span class="reg__lbl">${unit} par semaine</span></p>
      <p class="reg__period" aria-hidden="true">en moyenne sur ${period}</p>`
    : `<p class="reg__period" aria-hidden="true">${none}</p>`;
  return `
    <div class="reg" role="img" aria-label="${esc(spoken)}">
      ${head}
      <div class="reg__bars" aria-hidden="true">${bars}</div>
      <p class="reg__axis" aria-hidden="true"><span>${esc(fmtDate(weeks[0].start, 'short'))}</span><span>cette semaine</span></p>
    </div>`;
}

// Dernière séance visible, mise en avant : durée, séries, volume, qui a réagi, le dernier commentaire
function lastSessionHtml(row) {
  const s = row.s, local = myHistoryEntry(row.id);
  const acts = socialActivity().rows.filter(a => a.sessionId === row.id);
  const reacts = acts.filter(a => a.kind === 'reaction'), comment = acts.find(a => a.kind === 'comment' && a.text);
  // [libellé affiché, valeur, phrase lue par VoiceOver]
  const n = seriesCount(s), vol = local ? fmtVolume(sessionVolume(local.exercises, entryBodyKg(local))) : '';
  const facts = [s.duration ? ['Durée', fmtDuration(s.duration), `durée ${fmtDuration(s.duration)}`] : null,
    ['Séries', String(n), plural(n, 'série', 'séries')],
    local ? ['Volume', vol, `volume ${vol}`] : ['Exercices', String(s.exercises.length), plural(s.exercises.length, 'exercice', 'exercices')]].filter(Boolean);
  const who = reacts.length ? `${stackHtml(reacts)}<span class="last__who-text"><b>${esc(reactorsLine(reacts.map(personName), 1))}</b></span>`
    : '<span class="last__who-text">Aucune réaction pour l\'instant</span>';
  return `
    <article class="last">
      <button class="last__main" data-action="social-open-session" data-owner="${esc(row.owner)}" data-id="${esc(row.id)}">
        <span class="last__eyebrow">Dernière séance · ${esc(fmtDate(row.doneAt))}</span>
        <span class="last__title">${esc(s.label)}</span>
        <span class="sr-text">${esc(`, ${facts.map(f => f[2]).join(', ')}.`)}</span>
        <span class="last__facts" aria-hidden="true">${facts.map(([l, v]) => `<span class="last__fact"><span class="last__fact-val num">${esc(v)}</span><span class="last__fact-lbl">${l}</span></span>`).join('')}</span>
        ${s.exercises.length ? `<span class="last__sum">${esc(feedExercisesLine(s))}</span>` : ''}
        ${feedRecordHtml(s)}
      </button>
      <div class="last__foot">
        <span class="last__who">${who}</span>
        ${reactionsSummaryHtml(row.reactions, 'last__count')}
      </div>
      ${comment ? `<p class="last__comment"><b>${esc(personName(comment))}</b> ${esc(comment.text.replace(/\s+/g, ' '))}</p>` : ''}
    </article>`;
}

// Séance de l'aperçu : nom, date et durée ; les réactions en mots à droite (« 3 réactions »)
function mySessionRowHtml(row) {
  const s = row.s, n = reactionTotal(row.reactions);
  return `
    <button class="cell cell--nav mysess" data-action="social-open-session" data-owner="${esc(row.owner)}" data-id="${esc(row.id)}">
      <span class="cell__body"><span class="cell__title">${esc(s.label)}</span><span class="cell__sub num">${esc(fmtDate(row.doneAt))} · ${esc(publicMetaLine(s))}</span></span>
      ${n ? `<span class="mysess__count num">${plural(n, 'réaction', 'réactions')}</span>` : ''}
      ${icon('chevron.right', 16)}
    </button>`;
}

// Mes séances : la dernière en grand, trois en aperçu, puis « Tout voir · 78 séances » (toutes, en cartes du fil)
function meSessionsHtml(st) {
  const f = socialFeed(SOCIAL_ME);
  if (meSessionsAll || !f.rows.length) {
    return feedListHtml(SOCIAL_ME, { owner: false, empty: 'Aucune séance visible pour l\'instant. Une séance apparaît ici quand « Visible sur mon profil » est allumé.' });
  }
  const rest = f.rows.slice(1, 1 + ME_SESSIONS_SHOWN);
  const total = Math.max(st.shown_sessions ?? 0, f.rows.length);
  // Hors ligne ou erreur : l'aperçu reste, avec la même note que le fil (feedErrorNote, js/features/social-ui.js)
  const err = feedErrorNote(f.error);
  // Tout voir : des séances masquées ici, ou d'autres encore sur le serveur (!f.end)
  const all = total > 1 + rest.length || !f.end
    ? `<button class="see-all" data-action="social-me-sessions-all">Tout voir · ${plural(total, 'séance', 'séances')}${icon('chevron.right', 12)}</button>` : '';
  return `${err}${lastSessionHtml(f.rows[0])}
    ${rest.length ? `<div class="group mysess-list">${rest.map(mySessionRowHtml).join('')}</div>` : ''}
    ${all}`;
}

// Records récents (recentRecords, js/data/records.js ; lignes recordRowsHtml, js/ui/medal.js)
function meRecordsHtml() {
  const recs = recentRecords();
  if (!recs.length) return '';
  return `<h2 class="group-title group-title--large">Records</h2><div class="group">${recordRowsHtml(recs)}</div>`;
}

function renderSocialMe() {
  const st = social.state || cleanSocialState({});
  const name = account.profile?.username || st.username || 'Mon profil';
  const since = memberSince(account.user?.created_at);
  const stat = (n, one, many, action, extra = '') => `
          <button class="me-stat" data-action="${action}" ${extra}>
            <span class="me-stat__val num">${n == null ? '—' : n}</span><span class="me-stat__lbl">${n === 1 ? one : many}</span>
          </button>`;
  return `
    <div class="view view--grouped social-me-view">
      ${navBar({ title: 'Mon profil', large: false })}
      <div class="scr">
        ${reactHintHtml()}
        <section class="athlete" aria-label="Mon profil">
          <div class="athlete__id">
            ${avatarHtml('l')}
            <span class="athlete__text"><h2 class="athlete__name">${esc(name)}</h2>${since ? `<span class="athlete__sub">Membre depuis ${esc(fmtDate(since, 'month'))}</span>` : ''}</span>
            <button class="social-pill athlete__edit" data-action="social-edit-profile" aria-label="Modifier mon pseudo et mon avatar">Modifier</button>
          </div>
          <div class="me-stats">
            ${stat(st.shown_sessions, 'séance visible', 'séances visibles', 'social-me-sessions')}
            ${stat(st.followers.length, 'te suit', 'te suivent', 'social-people', 'data-list="followers"')}
            ${stat(st.following.length, 'suivi', 'suivis', 'social-people', 'data-list="following"')}
          </div>
          ${regularityHtml()}
        </section>
        <h2 class="group-title group-title--large" id="meSessions">Mes séances</h2>
        ${meSessionsHtml(st)}
        <p class="group-foot">Compte privé : seules les personnes que tu acceptes voient tes séances, avec le nom, la date, la durée et les séries. Jamais tes notes ni ton poids.</p>
        ${meRecordsHtml()}
        <h2 class="group-title group-title--large">Activité</h2>
        ${meActivityHtml()}
        <div class="group group--gap">
          <button class="cell cell--action" data-action="social-invite">${icon('square.and.arrow.up', 20)}<span>Inviter un ami</span></button>
        </div>
        <div class="group">
          <button class="cell cell--nav" data-action="social-manage">
            <span class="cell__body"><span class="cell__title">Gérer</span><span class="cell__sub">Demandes envoyées, comptes bloqués, désactiver</span></span>
            ${icon('chevron.right', 16)}
          </button>
        </div>
      </div>
    </div>`;
}

// Ouverture : état, activité et mes séances relus, puis activité vue (la pastille s'éteint)
async function socialMeEnter() {
  meActivityAll = false;
  meSessionsAll = false;
  socialRefresh({ minAge: 5000 });
  socialLoadFeed(SOCIAL_ME);
  await socialLoadActivity();
  if (currentView() === 'social-me' && !socialActivity().error) socialMarkActivitySeen();
}
SCREENS.set('social-me', { render: () => renderSocialMe(), enter: () => { socialMeEnter(); } });

// ── Te suivent, Suivis (« abonné » est réservé à l'abonnement payant : docs/ERGONOMIE.md §3) ──

function renderSocialPeople(list) {
  const st = social.state || cleanSocialState({});
  const followers = list === 'followers';
  const people = followers ? st.followers : st.following;
  const chevron = `<span class="social-row__chev" aria-hidden="true">${icon('chevron.right', 16)}</span>`;
  const rows = people.map(p => personRowHtml(p, followers
    ? pill('social-remove-follower', p.user_id, 'Retirer', { aria: `Retirer ${personName(p)} : ne plus te suivre` })
    : chevron)).join('');
  return `
    <div class="view view--grouped social-people-view">
      ${navBar({ title: followers ? 'Te suivent' : 'Suivis', large: false })}
      <div class="scr">
        <div class="group social-people">${rows || `<div class="cell"><span class="cell__sub social-empty">${followers ? 'Personne ne te suit pour l\'instant.' : 'Tu ne suis personne pour l\'instant.'}</span></div>`}</div>
        <div class="group-foot">${followers ? 'Les personnes qui te suivent voient tes séances visibles. En retirer une ne la prévient pas.' : 'Tu vois les séances visibles des personnes que tu suis.'}</div>
      </div>
    </div>`;
}
SCREENS.set('social-people', { render: list => renderSocialPeople(list), enter: () => { socialRefresh({ minAge: 5000 }); } });

registerActions({
  'social-me': () => navigate('social-me'),
  // Pseudo et avatar : l'écran du compte, empilé dans l'onglet (retour : Mon profil)
  'social-edit-profile': () => navigate('account'),
  'social-people': (e, el) => navigate(makeRoute('social-people', el.dataset.list)),
  'social-me-sessions': () => {
    $('#meSessions')?.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  },
  'social-me-sessions-all': () => { meSessionsAll = true; render(); },
  // Tout voir : déplie les lignes masquées ; s'il n'y en a pas mais que le serveur a d'autres pages, le
  // même tap charge aussi la suite (sinon il ne ferait que changer le libellé en « Afficher plus »)
  'social-activity-more': () => {
    const a = socialActivity();
    if (!meActivityAll) {
      meActivityAll = true; render();
      if (a.end || groupActivity(a.rows).length > ME_ACTIVITY_SHOWN) return;
    }
    socialLoadActivity({ more: true });
  },
  // Ma séance (Historique › séance), empilée dans l'onglet Social
  'social-open-my-session': (e, el) => navigate(makeRoute('history-detail', el.dataset.id)),
});
