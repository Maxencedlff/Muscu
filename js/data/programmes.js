// ═══════════════════════════════════════════════════════════
//  Programmes intégrés et bibliothèque d'exercices
// ═══════════════════════════════════════════════════════════
'use strict';

const PROGRAMMES = {
  ppl: {
    name: 'PPL', desc: 'Pousser · Tirer · Jambes', icon: icon('dumbbell'),
    sessions: {
      push: { label: 'Push', icon: '💪', desc: 'Pectoraux · Épaules · Triceps', color: 'var(--orange)' },
      pull: { label: 'Pull', icon: '🦾', desc: 'Dos · Biceps · Trapèzes',       color: 'var(--indigo)' },
      legs: { label: 'Legs', icon: '🦵', desc: 'Quadriceps · Ischio · Mollets', color: 'var(--teal)' },
    },
    defaults: {
      push: [['Développé couché haltères',4],['Développé incliné haltères',3],['Écarté haltères plat',3],['Développé militaire haltères',4],['Élévations latérales',4],['Extension triceps poulie',3]],
      pull: [['Rowing haltère unilatéral',4],['Tirage vertical prise large',4],['Tirage horizontal câble',3],['Curl biceps haltères',3],['Curl marteau',3]],
      legs: [['Squat barre',4],['Presse à cuisses',4],['Fentes marchées haltères',3],['Leg curl machine',3],['Extension quadriceps',3],['Mollets debout',4]],
    },
  },
  upper_lower: {
    name: 'Upper / Lower', desc: 'Haut · Bas du corps', icon: icon('dumbbell'),
    sessions: {
      upper: { label: 'Upper', icon: '💪', desc: 'Pecs · Dos · Épaules · Bras',              color: 'var(--orange)' },
      lower: { label: 'Lower', icon: '🦵', desc: 'Quadriceps · Ischio · Mollets · Fessiers', color: 'var(--indigo)' },
    },
    defaults: {
      upper: [['Développé couché haltères',4],['Tirage vertical prise large',4],['Rowing haltère unilatéral',3],['Développé militaire haltères',3],['Curl biceps haltères',3],['Extension triceps poulie',3]],
      lower: [['Squat barre',4],['Presse à cuisses',4],['Fentes marchées haltères',3],['Leg curl machine',3],['Extension quadriceps',3],['Mollets debout',4]],
    },
  },
  fullbody: {
    name: 'Full Body', desc: 'Corps entier · 3×/semaine', icon: icon('dumbbell'),
    sessions: {
      fullbody: { label: 'Full Body', icon: '⚡', desc: 'Corps entier', color: 'var(--teal)' },
    },
    defaults: {
      fullbody: [['Squat barre',3],['Développé couché haltères',3],['Rowing haltère unilatéral',3],['Développé militaire haltères',3],['Curl biceps haltères',3],['Extension triceps poulie',3],['Mollets debout',3]],
    },
  },
  bro: {
    name: 'Bro Split', desc: 'Un muscle par jour : pecs, dos, épaules, bras, jambes', icon: icon('dumbbell'),
    sessions: {
      chest:     { label: 'Pecs',      icon: '💪', desc: 'Pectoraux',           color: 'var(--orange)' },
      back:      { label: 'Dos',       icon: '🦾', desc: 'Dos · Trapèzes',       color: 'var(--indigo)' },
      shoulders: { label: 'Épaules',   icon: '🏔️', desc: 'Épaules',             color: 'var(--yellow)' },
      arms:      { label: 'Bras',      icon: '🦾', desc: 'Biceps · Triceps',    color: 'var(--purple)' },
      legs:      { label: 'Jambes',    icon: '🦵', desc: 'Quadriceps · Ischio', color: 'var(--teal)' },
    },
    defaults: {
      chest:     [['Développé couché haltères',4],['Développé incliné haltères',4],['Écarté haltères plat',3],['Dips',3]],
      back:      [['Tractions pronation',4],['Tirage vertical prise large',4],['Rowing barre',4],['Rowing haltère unilatéral',3]],
      shoulders: [['Développé militaire haltères',4],['Élévations latérales',4],['Élévations frontales',3],['Oiseau (élévations arrière)',3]],
      arms:      [['Curl biceps haltères',4],['Curl marteau',3],['Extension triceps poulie',4],['Extension triceps unilatéral',3]],
      legs:      [['Squat barre',4],['Presse à cuisses',4],['Fentes marchées haltères',3],['Leg curl machine',3],['Extension quadriceps',3],['Mollets debout',4]],
    },
  },
  arnold: {
    name: 'Arnold Split', desc: 'Pecs+Dos · Épaules+Bras · Jambes', icon: icon('dumbbell'),
    sessions: {
      chest_back:     { label: 'Pecs & Dos',       icon: '💪', desc: 'Pectoraux · Dos',              color: 'var(--orange)' },
      shoulders_arms: { label: 'Épaules & Bras',   icon: '🤙', desc: 'Épaules · Biceps · Triceps',   color: 'var(--yellow)' },
      legs:           { label: 'Jambes',           icon: '🦵', desc: 'Quadriceps · Ischio · Mollets', color: 'var(--teal)' },
    },
    defaults: {
      chest_back:     [['Développé couché haltères',4],['Écarté haltères plat',3],['Tirage vertical prise large',4],['Rowing haltère unilatéral',4],['Tractions pronation',3]],
      shoulders_arms: [['Développé militaire haltères',4],['Élévations latérales',4],['Curl biceps haltères',3],['Curl marteau',3],['Extension triceps poulie',3]],
      legs:           [['Squat barre',4],['Presse à cuisses',4],['Fentes marchées haltères',3],['Leg curl machine',3],['Mollets debout',4]],
    },
  },
  custom: {
    name: 'Perso', desc: 'Séances personnalisées', icon: icon('pencil'),
    sessions: {}, defaults: {},
  },
};

// Bibliothèque : exercices déjà faits (les plus récents d'abord), puis ceux des programmes et du
// catalogue des muscles (js/data/muscles.js)
function exerciseLibrary() {
  const seen = new Map();
  const add  = n => { const k = normName(n); if (n && !seen.has(k)) seen.set(k, n); };
  (data.history || []).slice().sort((a, b) => b.date - a.date).forEach(h => (h.exercises || []).forEach(e => add(e.name)));
  const rest = [];
  Object.values(PROGRAMMES).forEach(p => Object.values(p.defaults || {}).forEach(list => list.forEach(([n]) => rest.push(n))));
  Object.values(data.programmes || {}).forEach(p => Object.values(p.exercises || {}).forEach(list => (list || []).forEach(e => rest.push(e.name))));
  rest.push(...catalogueNames());
  rest.sort((a, b) => a.localeCompare(b, 'fr')).forEach(add);
  return [...seen.values()];
}
