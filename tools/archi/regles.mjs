// ═══════════════════════════════════════════════════════════
//  Règles du contrôle d'architecture (check.mjs) : fonctions pures sur un projet déjà lu
//
//  projet = {
//    fichiers: Map(chemin → analyse de analyse.mjs),   // js/** et coach-web/js/**
//    css:      Map(chemin → nombre de lignes),
//    pages:    [{ page, scripts: [chemins dans l'ordre des <script src>] }],
//    docs:     { 'ARCHITECTURE.md': texte, 'docs/COACH_WEB.md': texte },
//  }
//  Chaque règle rend des violations { regle, fichier, ligne?, cible?, page?, message }.
//  Les exceptions (exceptions.mjs) sont appliquées ensuite par appliquerExceptions.
// ═══════════════════════════════════════════════════════════

/** Couche d'un fichier, d'après ARCHITECTURE.md (« Arborescence ») */
export function coucheDe(chemin) {
  if (chemin.startsWith('coach-web/js/desk/')) return 'desk';
  if (chemin.startsWith('coach-web/js/')) return 'coach-web';
  const m = chemin.match(/^js\/([^/]+)\//);
  return m ? m[1] : 'autre';
}

// Ce que chaque couche basse peut lire hors d'elle-même (« La donnée ne connaît pas l'écran » : js/data n'appelle
// que js/core ; js/core : briques sans écran ; js/platform : le pont natif, sans rien de l'app). Les couches
// d'écran (ui, features, app, desk) ne sont pas bornées : elles s'appellent entre elles par la portée globale.
export const COUCHES_PERMISES = {
  platform: ['platform'],
  core: ['core', 'platform'],
  data: ['data', 'core', 'platform'],
};

/** Index des déclarations de premier niveau : nom → [chemins] */
export function indexDesNoms(fichiers) {
  const index = new Map();
  for (const [chemin, a] of fichiers) for (const d of a.decls) {
    if (!index.has(d.nom)) index.set(d.nom, []);
    if (!index.get(d.nom).includes(chemin)) index.get(d.nom).push(chemin);
  }
  return index;
}

// ── 1. Couches ─────────────────────────────────────────────

export function regleDomDansData(projet) {
  const v = [];
  for (const [chemin, a] of projet.fichiers) {
    if (coucheDe(chemin) !== 'data') continue;
    for (const u of a.dom) v.push({ regle: 'couche-dom', fichier: chemin, ligne: u.ligne, cible: u.quoi, message: `js/data/ touche au DOM (${u.quoi}) : l'écran appelant affiche, la donnée renvoie un résultat` });
  }
  return v;
}

export function regleDependancesDeCouche(projet, index = indexDesNoms(projet.fichiers)) {
  const v = [];
  for (const [chemin, a] of projet.fichiers) {
    const couche = coucheDe(chemin), permises = COUCHES_PERMISES[couche];
    if (!permises) continue;
    for (const [nom, ligne] of a.refs) {
      const ailleurs = (index.get(nom) || []).filter(c => c !== chemin);
      if (!ailleurs.length || ailleurs.some(c => permises.includes(coucheDe(c)))) continue;
      v.push({ regle: 'couche-dependance', fichier: chemin, ligne, cible: nom,
        message: `js/${couche}/ lit ${nom} de ${ailleurs.join(', ')} (couche ${[...new Set(ailleurs.map(coucheDe))].join(', ')}) ; permis : ${permises.join(', ')}` });
    }
  }
  return v;
}

export function regleCapacitor(projet) {
  const v = [];
  for (const [chemin, a] of projet.fichiers) {
    if (coucheDe(chemin) === 'platform') continue;
    for (const u of a.capacitor) v.push({ regle: 'capacitor', fichier: chemin, ligne: u.ligne, cible: u.quoi, message: `Capacitor hors de js/platform/ (${u.quoi}) : passer par Native (js/platform/native.js)` });
  }
  return v;
}

/** coach-web/js/desk ne réécrit pas une fonction de js/data : même nom de premier niveau, ou même logique. */
export function regleDeskReutilise(projet) {
  const v = [];
  const nomsData = new Map(), empreintesData = new Map();
  for (const [chemin, a] of projet.fichiers) {
    if (coucheDe(chemin) !== 'data') continue;
    for (const d of a.decls) if (!nomsData.has(d.nom)) nomsData.set(d.nom, `${chemin}:${d.ligne}`);
    for (const f of a.fonctions) if (!empreintesData.has(f.empreinte)) empreintesData.set(f.empreinte, `${chemin}:${f.ligne} ${f.nom}`);
  }
  for (const [chemin, a] of projet.fichiers) {
    if (coucheDe(chemin) !== 'desk') continue;
    for (const d of a.decls) if (nomsData.has(d.nom)) {
      v.push({ regle: 'desk-reutilise', fichier: chemin, ligne: d.ligne, cible: d.nom, message: `${d.nom} est déjà déclaré dans ${nomsData.get(d.nom)} : charger ce fichier dans coach-web/index.html plutôt que le réécrire` });
    }
    for (const f of a.fonctions) if (empreintesData.has(f.empreinte)) {
      v.push({ regle: 'desk-reutilise', fichier: chemin, ligne: f.ligne, cible: f.nom, message: `${f.nom} recopie la logique de ${empreintesData.get(f.empreinte)} : réutiliser la fonction de js/data/` });
    }
  }
  return v;
}

// ── 2. Taille ──────────────────────────────────────────────

/**
 * limites = { js: n, css: n, strictes: { chemin: n } } : au-delà, le fichier est signalé ; une exception de taille
 * porte un plafond (lignes) que le fichier ne doit pas dépasser non plus.
 */
export function regleTaille(projet, limites) {
  const v = [];
  const tailles = [...[...projet.fichiers].map(([c, a]) => [c, a.lignes]), ...projet.css];
  for (const [chemin, n] of tailles) {
    const limite = limites.strictes[chemin] ?? (chemin.endsWith('.css') ? limites.css : limites.js);
    if (n > limite) v.push({ regle: 'taille', fichier: chemin, cible: String(n), lignes: n, message: `${n} lignes (limite ${limite}) : découper par responsabilité` });
  }
  return v;
}

// ── 3. Dépendances : ordre de chargement ────────────────────

/**
 * Pour chaque page, le code exécuté au chargement (hors fonction, IIFE, fonctions appelées au premier niveau,
 * fonctions d'un autre fichier appelées à ce moment, de proche en proche) ne lit que des noms déclarés par un
 * fichier chargé AVANT (ARCHITECTURE.md, « L'ordre de index.html compte »). Les dépendances au chargement forment
 * donc un graphe sans cycle dans l'ordre des <script>. Les appels faits plus tard (rendu, écouteurs) sont libres.
 */
export function regleOrdreDeChargement(projet, index = indexDesNoms(projet.fichiers)) {
  const v = [];
  for (const { page, scripts } of projet.pages) {
    const rang = new Map(scripts.map((s, i) => [s, i]));
    const signales = new Set();
    scripts.forEach((fichier, i) => {
      const suivies = new Set();   // fonctions déjà suivies pendant le chargement de ce fichier
      // u : lecture faite pendant le chargement de `fichier` ; lieu : où elle est écrite ; via : appels qui y mènent
      const lire = (u, lieu, via, racine) => {
        const decl = index.get(u.nom) || [];
        if (!decl.length) return;   // globale du navigateur (window, Date…) ou de la coquille
        const avant = decl.filter(c => rang.has(c) && rang.get(c) <= i);
        if (!avant.length) {
          const cle = `${fichier}|${u.nom}`;
          if (signales.has(cle)) return;
          signales.add(cle);
          const ou = decl.map(c => `${c} (${rang.has(c) ? 'chargé après' : 'pas chargé par cette page'})`).join(', ');
          v.push({ regle: 'ordre-chargement', page, fichier, ligne: racine, cible: u.nom,
            message: `${page} : ${u.nom} lu au chargement (${lieu}:${u.ligne}${via.length ? `, via ${via.join(' → ')}` : ''}) mais déclaré dans ${ou}` });
          return;
        }
        // Appel d'une fonction déjà chargée : son corps s'exécute maintenant (la dernière déclarée gagne)
        if (u.appel) corps(avant.reduce((x, y) => (rang.get(y) > rang.get(x) ? y : x)), u.nom, [...via, u.nom], racine);
      };
      const corps = (source, fn, via, racine) => {
        const cle = `${source}|${fn}`;
        if (suivies.has(cle)) return;
        suivies.add(cle);
        const a = projet.fichiers.get(source);
        for (const w of a?.parFonction.get(fn) || []) lire(w, source, via, racine);
        for (const g of a?.internes.get(fn) || []) corps(source, g, [...via, g], racine);
      };
      for (const u of projet.fichiers.get(fichier)?.chargement || []) lire(u, fichier, u.via ? [u.via] : [], u.ligne);
    });
  }
  return v;
}

// ── 4. Duplication app / site ───────────────────────────────

/** Même nom déclaré par deux fichiers d'une page : le dernier chargé écrase l'autre sans rien dire. */
export function regleCollisions(projet) {
  const v = [];
  for (const { page, scripts } of projet.pages) {
    const premier = new Map();
    for (const f of scripts) for (const d of projet.fichiers.get(f)?.decls || []) {
      if (!premier.has(d.nom)) premier.set(d.nom, f);
      else if (premier.get(d.nom) !== f) v.push({ regle: 'collision', page, fichier: f, ligne: d.ligne, cible: d.nom, message: `${page} : ${d.nom} déjà déclaré par ${premier.get(d.nom)}, chargé avant` });
    }
  }
  return v;
}

/** Fonction de coach-web/js/ dont la logique est celle d'une fonction de js/ (AST normalisé identique). */
export function regleDuplicationAppSite(projet) {
  const v = [];
  const app = new Map();
  for (const [chemin, a] of projet.fichiers) if (chemin.startsWith('js/')) for (const f of a.fonctions) {
    if (!app.has(f.empreinte)) app.set(f.empreinte, `${chemin}:${f.ligne} ${f.nom}`);
  }
  for (const [chemin, a] of projet.fichiers) if (chemin.startsWith('coach-web/')) for (const f of a.fonctions) {
    // js/data a déjà sa règle (desk-reutilise) : ici, le reste de l'app (core, ui, features…)
    if (app.has(f.empreinte) && !app.get(f.empreinte).startsWith('js/data/')) {
      v.push({ regle: 'duplication', fichier: chemin, ligne: f.ligne, cible: f.nom, message: `${f.nom} recopie ${app.get(f.empreinte)} : partager la fonction (js/core ou js/data) au lieu de la copier` });
    }
  }
  return v;
}

// ── 5. Docs ────────────────────────────────────────────────

/** Sections « ### js/xxx/ » d'ARCHITECTURE.md : dossier → texte de la section */
export function sectionsArchitecture(texte) {
  const sections = new Map();
  let dossier = null;
  for (const ligne of texte.split('\n')) {
    const m = ligne.match(/^#{2,3}\s+`?(js\/[\w/.-]*)`?\s*$/);
    if (m) dossier = m[1].replace(/[^/]*\.js$/, '');
    else if (/^#{1,3}\s/.test(ligne)) dossier = null;
    if (dossier) sections.set(dossier, (sections.get(dossier) || '') + ligne + '\n');
  }
  return sections;
}

/**
 * Un fichier de js/ est documenté si son chemin complet est cité (ARCHITECTURE.md ou docs/COACH_WEB.md), ou si son
 * nom est cité en `code` dans la section de son dossier d'ARCHITECTURE.md ; un fichier de coach-web/js/ si son nom
 * est cité dans docs/COACH_WEB.md.
 */
export function regleDocs(projet) {
  const arch = projet.docs['ARCHITECTURE.md'] || '', coach = projet.docs['docs/COACH_WEB.md'] || '';
  const sections = sectionsArchitecture(arch);
  const v = [];
  for (const chemin of projet.fichiers.keys()) {
    const nom = chemin.split('/').pop(), dossier = chemin.slice(0, -nom.length);
    let ok = arch.includes(chemin) || coach.includes(chemin);
    if (!ok && chemin.startsWith('js/')) ok = (sections.get(dossier) || '').includes('`' + nom + '`');
    if (!ok && chemin.startsWith('coach-web/')) ok = new RegExp(`(^|[^\\w-])${nom.replace(/[.]/g, '\\.')}`).test(coach);
    if (!ok) v.push({ regle: 'docs', fichier: chemin, message: chemin.startsWith('js/') ? `absent d'ARCHITECTURE.md : une ligne dans la table « ### ${dossier} »` : 'absent de docs/COACH_WEB.md' });
  }
  return v;
}

// ── Exceptions ─────────────────────────────────────────────

/**
 * Une exception couvre les violations de même règle et même fichier (et même cible et même page si elle en donne).
 * Une exception de taille donne un plafond : au-delà, la violation reste. Une exception qui ne couvre plus rien
 * est périmée : elle est signalée, pour que la liste reste vraie.
 */
export function appliquerExceptions(violations, exceptions) {
  const utilisees = new Set();
  const restantes = violations.filter(x => {
    const i = exceptions.findIndex(e => e.regle === x.regle && e.fichier === x.fichier
      && (e.cible === undefined || x.regle === 'taille' || e.cible === x.cible) && (e.page === undefined || e.page === x.page));
    if (i < 0) return true;
    const e = exceptions[i];
    utilisees.add(i);
    if (x.regle === 'taille' && x.lignes > e.plafond) {
      x.message = `${x.lignes} lignes, au-delà du plafond de son exception (${e.plafond}) : découper, ou relever le plafond avec une raison`;
      return true;
    }
    return false;
  });
  const perimees = exceptions.filter((_, i) => !utilisees.has(i));
  return { restantes, perimees, utilisees: utilisees.size };
}

/** Problèmes de forme de la liste d'exceptions elle-même (raison, date, plafond de taille). */
export function verifierExceptions(exceptions) {
  const p = [];
  exceptions.forEach((e, i) => {
    const qui = `exception ${i + 1} (${e.regle} ${e.fichier}${e.cible ? ' ' + e.cible : ''})`;
    if (!e.regle || !e.fichier) p.push(`${qui} : regle et fichier obligatoires`);
    if (!e.raison || e.raison.length < 20) p.push(`${qui} : raison manquante ou trop courte`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) p.push(`${qui} : date AAAA-MM-JJ obligatoire`);
    if (e.regle === 'taille' && !(Number.isInteger(e.plafond) && e.plafond > 0)) p.push(`${qui} : plafond (lignes) obligatoire`);
  });
  return p;
}

/** Toutes les règles ; rend { violations, perimees, problemesExceptions, exceptionsUtilisees } */
export function verifierProjet(projet, { limites, exceptions }) {
  const index = indexDesNoms(projet.fichiers);
  const violations = [
    ...regleDomDansData(projet), ...regleDependancesDeCouche(projet, index), ...regleCapacitor(projet),
    ...regleDeskReutilise(projet), ...regleTaille(projet, limites), ...regleOrdreDeChargement(projet, index),
    ...regleCollisions(projet), ...regleDuplicationAppSite(projet), ...regleDocs(projet),
  ];
  const { restantes, perimees, utilisees } = appliquerExceptions(violations, exceptions);
  return { violations: restantes, perimees, problemesExceptions: verifierExceptions(exceptions), exceptionsUtilisees: utilisees };
}
