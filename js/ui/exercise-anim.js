// ═══════════════════════════════════════════════════════════
//  Mannequin animé du « Comment faire » (SVG dessiné par l'app, sans vidéo)
//  Données : js/data/exercise-moves.js. Couleurs du thème ; muscles principaux en couleur.
// ═══════════════════════════════════════════════════════════
'use strict';

// Longueurs des segments (unités du repère 200 × 200)
const SEG = { torso: 50, upperArm: 28, forearm: 26, thigh: 38, shin: 36, neck: 13, head: 9, foot: 13 };
const MOVE_MS = 2600;   // aller-retour : 1,3 s par phase, avec un temps d'arrêt en bout de course

// Segments colorés selon les muscles principaux de l'exercice
const SEG_MUSCLES = {
  torso: ['chest', 'lats', 'abs', 'lower_back', 'traps'], upperArm: ['biceps', 'triceps', 'front_delts', 'side_delts', 'rear_delts'],
  forearm: ['forearms'], thigh: ['quads', 'hamstrings', 'glutes', 'adductors'], shin: ['calves'],
};

const toRad = d => d * Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpPt = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];

// Cinématique inverse à 2 segments : position de l'articulation entre a et la cible b
function ik(a, b, l1, l2, bend) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.01);
  const angle = Math.atan2(dy, dx) + bend * Math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d));
  const joint = [a[0] + l1 * Math.cos(angle), a[1] + l1 * Math.sin(angle)];
  const end = Math.atan2(b[1] - joint[1], b[0] - joint[0]);
  return { joint, end: [joint[0] + l2 * Math.cos(end), joint[1] + l2 * Math.sin(end)] };
}

// Squelette d'une position intermédiaire t ∈ [0, 1] le long des positions clés (2 ou plus : une position
// du milieu fait suivre un arc à la main, sans quoi le coude bougerait pendant un curl)
function movePose(move, t) {
  const n = move.poses.length - 1, i = Math.min(n - 1, Math.floor(t * n));
  const p = move.poses[i], q = move.poses[i + 1];
  t = t * n - i;
  const hip = lerpPt(p.hip, q.hip, t), torso = toRad(lerp(p.torso, q.torso, t));
  const shoulder = [hip[0] + SEG.torso * Math.cos(torso), hip[1] + SEG.torso * Math.sin(torso)];
  const head = [shoulder[0] + SEG.neck * Math.cos(torso), shoulder[1] + SEG.neck * Math.sin(torso)];
  const arm = ik(shoulder, lerpPt(p.hand, q.hand, t), SEG.upperArm, SEG.forearm, move.bend.elbow);
  const leg = ik(hip, lerpPt(p.ankle, q.ankle, t), SEG.thigh, SEG.shin, move.bend.knee);
  return { hip, shoulder, head, elbow: arm.joint, hand: arm.end, knee: leg.joint, ankle: leg.end };
}

// Aller-retour adouci, avec un arrêt de 15 % en haut et en bas
function moveProgress(ms) {
  const phase = (ms % MOVE_MS) / MOVE_MS;
  const x = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  const k = Math.min(1, Math.max(0, (x - 0.15) / 0.7));
  return k * k * (3 - 2 * k);
}

function moveSvgInner(move, pose, working) {
  const line = (a, b, seg) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" class="mv-seg${working.has(seg) ? ' mv-seg--on' : ''}"/>`;
  const toe = [pose.ankle[0] + SEG.foot, pose.ankle[1] + 4];
  const equip = move.equip === 'dumbbell'
    ? `<rect x="${(pose.hand[0] - 9).toFixed(1)}" y="${(pose.hand[1] - 4).toFixed(1)}" width="18" height="8" rx="3" class="mv-equip"/>`
    : move.equip === 'barbell' ? `<circle cx="${pose.hand[0].toFixed(1)}" cy="${pose.hand[1].toFixed(1)}" r="14" class="mv-equip"/>` : '';
  return `<line x1="0" y1="172" x2="200" y2="172" class="mv-ground"/>
    ${line(pose.ankle, toe, 'foot')}${line(pose.knee, pose.ankle, 'shin')}${line(pose.hip, pose.knee, 'thigh')}
    ${line(pose.hip, pose.shoulder, 'torso')}${line(pose.shoulder, pose.elbow, 'upperArm')}${line(pose.elbow, pose.hand, 'forearm')}
    <circle cx="${pose.head[0].toFixed(1)}" cy="${pose.head[1].toFixed(1)}" r="${SEG.head}" class="mv-head"/>${equip}`;
}

// Cadre du dessin ajusté au mouvement (toutes les positions), sol compris : pas de vide autour
function moveViewBox(move) {
  const pts = [0, 0.25, 0.5, 0.75, 1].flatMap(t => Object.values(movePose(move, t)));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const pad = 16, top = Math.min(...ys) - SEG.head - pad, bottom = 176;
  const left = Math.max(0, Math.min(...xs) - pad - 10), right = Math.min(200, Math.max(...xs) + pad + 14);
  return `${left.toFixed(0)} ${top.toFixed(0)} ${(right - left).toFixed(0)} ${(bottom - top).toFixed(0)}`;
}

function workingSegments(name) {
  const primary = musclesOf(name).primary;
  return new Set(Object.entries(SEG_MUSCLES).filter(([, ids]) => ids.some(id => primary.includes(id))).map(([seg]) => seg));
}

// Carte « Comment faire » : animation si le mouvement est prêt (ou deux positions superposées quand les
// animations sont réduites), puis consignes et erreur fréquente ; '' si l'exercice n'en a pas
function howToHtml(name) {
  const how = exerciseHowTo(name), move = exerciseMove(name);
  if (!how && !move) return '';
  const working = move ? workingSegments(name) : null;
  return `
    <div class="group-title">Comment faire</div>
    <div class="group howto">
      ${move ? `<svg class="howto__anim" viewBox="${moveViewBox(move)}" role="img" aria-label="Animation du mouvement : ${esc(name)}" data-move="${esc(name)}">
        <g class="mv-ghost">${moveSvgInner(move, movePose(move, 1), working)}</g>
        <g class="mv-live">${moveSvgInner(move, movePose(move, 0), working)}</g>
      </svg>` : ''}
      ${how ? `<ol class="howto__cues">${how.cues.map(c => `<li>${esc(c)}</li>`).join('')}</ol>
      <p class="howto__mistake"><strong>Erreur fréquente :</strong> ${esc(how.mistake)}</p>` : ''}
    </div>`;
}

// Lance l'animation des cartes affichées ; s'arrête d'elle-même quand l'écran change
function mountHowTo() {
  const svg = document.querySelector('.howto__anim[data-move]');
  if (!svg || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  svg.classList.add('howto__anim--live');
  const name = svg.dataset.move, move = exerciseMove(name), working = workingSegments(name);
  const g = svg.querySelector('.mv-live'), t0 = performance.now();
  const frame = now => {
    if (!svg.isConnected) return;
    g.innerHTML = moveSvgInner(move, movePose(move, moveProgress(now - t0)), working);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
