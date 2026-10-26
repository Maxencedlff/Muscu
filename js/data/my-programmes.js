// ═══════════════════════════════════════════════════════════
//  Mes programmes : liste ordonnée (data.myProgrammes) et catalogue des programmes intégrés
//
//  La liste est nettoyée et migrée par cleanMyProgrammes (store.js) ; ici, les changements faits par
//  la personne (ajouter, retirer, déplacer) et ce que le catalogue affiche (fréquence conseillée,
//  muscles travaillés). Aucun effet d'écran ni d'écriture : l'appelant enregistre et redessine.
// ═══════════════════════════════════════════════════════════
'use strict';

// Fréquence conseillée de chaque programme intégré (catalogue), et niveau pour la phrase
// d'explication (recommendReason, js/data/onboarding.js) : le Full Body est présenté aux débutants
const PROGRAMME_ADVICE = {
  fullbody:        { perWeek: 3, level: 'debutant' },
  upper_lower:     { perWeek: 4, level: 'confirme' },
  ppl:             { perWeek: 3, level: 'confirme' },
  arnold:          { perWeek: 3, level: 'confirme' },
  bro:             { perWeek: 5, level: 'confirme' },
  maison:          { perWeek: 3, level: 'confirme' },
  maison_halteres: { perWeek: 3, level: 'confirme' },
};

// Programmes du catalogue « Tous les programmes » : les intégrés, sans « Perso » (ancien programme unique)
function catalogueProgrammeIds() { return Object.keys(PROGRAMMES).filter(id => id !== 'custom'); }

// Muscles travaillés par un programme intégré, d'après ses exercices par défaut : ceux choisis par la
// personne pour ces noms, sinon la bibliothèque (exerciseMuscles, js/data/muscles.js) : { muscle: 1 } pour un muscle principal d'au moins un exercice,
// 0.4 s'il n'est que secondaire (atténué sur la silhouette, comme dans les fiches d'exercice)
function programmeMuscleLevels(id) {
  const levels = {};
  Object.values(PROGRAMMES[id]?.defaults || {}).forEach(list => list.forEach(([name]) => {
    const m = exerciseMuscles({ name });
    m.secondary.forEach(k => { levels[k] = Math.max(levels[k] || 0, 0.4); });
    m.primary.forEach(k => { levels[k] = 1; });
  }));
  return levels;
}

function inMyProgrammes(id, d = data) { return (d.myProgrammes || []).includes(id); }

// Ajouté en fin de liste (rien si déjà dedans)
function addMyProgramme(id, d = data) {
  if (!PROGRAMMES[id] && !d.userProgrammes?.[id]) return false;
  if (inMyProgrammes(id, d)) return false;
  (d.myProgrammes ||= []).push(id);
  return true;
}

// Retiré de la liste, sans rien effacer : un programme intégré reste dans le catalogue avec ses
// exercices et son historique. Refusé pour l'actif et pour un programme créé (il se supprime : archivé,
// cleanMyProgrammes le remettrait sinon dans la liste)
function removeMyProgramme(id, d = data) {
  if (id === d.activeProgramme || !PROGRAMMES[id] || !inMyProgrammes(id, d)) return false;
  d.myProgrammes = d.myProgrammes.filter(x => x !== id);
  return true;
}

// Déplacement (mode Modifier, poignée ≡) : index de la liste affichée, qui est data.myProgrammes
function moveMyProgramme(from, to, d = data) {
  const list = d.myProgrammes || [];
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return false;
  const [id] = list.splice(from, 1);
  list.splice(to, 0, id);
  return true;
}
