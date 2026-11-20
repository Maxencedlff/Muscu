#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
//  Inventaire des champs de saisie : règles du client et du serveur, champ par champ, sans navigateur (~1 s)
//
//  node tools/champs/inventaire.mjs [racine du dépôt] [--json] [--tout]
//    → tableau champ / fichier:ligne / règle client / règle serveur / problème ; code 1 s'il reste un problème.
//    --tout : aussi les champs sans remarque ; --json : le résultat brut (pour un autre outil).
//
//  Signale : un champ sans limite de longueur, une limite client différente de celle du serveur, une borne
//  illogique (négative, max sous min, charge à 0 refusée), un nom obligatoire sans trim (espaces seuls), un champ
//  numérique qui refuse la virgule française (type="number"), une validation annoncée introuvable, un champ absent
//  du registre (tools/champs/registre.mjs) ou une entrée du registre qui ne correspond plus à rien.
//  Le comportement réel (pires valeurs tapées ou collées) est vérifié par tests/test_pires_testeurs.py.
// ═══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { champsDuCode, constantesDu, resoudre, bornesSql } from './extraction.mjs';
import { REGISTRE } from './registre.mjs';

const TEXTES = ['texte', 'texte-long', 'recherche', 'email', 'code'];
const NOMBRES = ['charge', 'reps', 'nombre', 'entier'];
const SANS_REGLE = ['aide', 'case', 'date', 'fichier', 'curseur'];

export function lireDepot(racine) {
  const fichiers = [];
  (function parcours(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) parcours(p);
      else if (p.endsWith('.js')) fichiers.push({ chemin: path.relative(racine, p).split(path.sep).join('/'), src: fs.readFileSync(p, 'utf8') });
    }
  })(path.join(racine, 'js'));
  const dm = path.join(racine, 'supabase', 'migrations');
  const migrations = fs.existsSync(dm) ? fs.readdirSync(dm).filter(f => f.endsWith('.sql')).sort()
    .map(f => ({ fichier: f, texte: fs.readFileSync(path.join(dm, f), 'utf8') })) : [];
  return { fichiers, migrations };
}

const fmt = (min, max, unite = '') => (min != null && max != null ? `${min} à ${max}${unite}` : max != null ? `≤ ${max}${unite}` : min != null ? `≥ ${min}${unite}` : '');

// Résultat : [{ cle, nom, ou, client, serveur, problemes: [{ grave, texte }] }]
export function verifier({ fichiers, migrations }, registre = REGISTRE) {
  const consts = constantesDu(fichiers);
  const champs = champsDuCode(fichiers);
  const src = Object.fromEntries(fichiers.map(f => [f.chemin.replace(/^js\//, ''), f.src]));
  const parCle = new Map(registre.map(e => [e.cle, e]));
  const out = [];
  for (const c of champs) {
    const e = parCle.get(c.cle);
    const ou = `${c.fichier}:${c.lignes.join(',')}`;
    if (!e) {
      out.push({ cle: c.cle, nom: '?', ou, client: attrsTexte(c.a, consts), serveur: '', problemes: [{ grave: true,
        texte: 'champ absent du registre (tools/champs/registre.mjs) : décrire ses règles' }] });
      continue;
    }
    out.push(verifierChamp(c, e, { consts, src, migrations, ou }));
  }
  const vus = new Set(champs.map(c => c.cle));
  for (const e of registre) {
    if (!vus.has(e.cle)) out.push({ cle: e.cle, nom: e.nom, ou: '—', client: '', serveur: '', problemes: [{ grave: true,
      texte: 'entrée du registre qui ne correspond plus à aucun champ du code (renommé ou retiré ?)' }] });
  }
  return out;
}

function attrsTexte(a, consts) {
  const p = [];
  if (a.type && a.type !== 'text') p.push(`type=${a.type}`);
  if (a.inputmode) p.push(`clavier ${String(a.inputmode).replace(/^\$\{|\}$/g, '')}`);
  if (a.maxlength) p.push(`maxlength ${resoudre(a.maxlength, consts) ?? a.maxlength}`);
  if (a.minlength) p.push(`minlength ${resoudre(a.minlength, consts) ?? a.minlength}`);
  if (a.pattern) p.push(`pattern ${a.pattern}`);
  for (const k of ['min', 'max', 'step']) if (a[k] !== undefined && a[k] !== true) p.push(`${k} ${a[k]}`);
  return p.join(', ');
}

function verifierChamp(c, e, { consts, src, migrations, ou }) {
  const pb = [];
  const probleme = t => pb.push({ grave: true, texte: t });
  const avert = t => pb.push({ grave: false, texte: t });
  const r = v => (v === undefined ? null : resoudre(v, consts));
  const ml = r(c.a.maxlength);
  const longMax = r(e.longueur?.max), longMin = r(e.longueur?.min);
  if (e.longueur?.max !== undefined && longMax === null) probleme(`borne de longueur ${e.longueur.max} introuvable dans js/`);
  const effMax = [ml, longMax].filter(x => x !== null).reduce((a, b) => (a === null ? b : Math.min(a, b)), null);
  const bMin = r(e.bornes?.min), bMax = r(e.bornes?.max);
  if (e.bornes && ((e.bornes.min !== undefined && bMin === null) || (e.bornes.max !== undefined && bMax === null))) probleme('borne de valeur du registre introuvable dans js/');
  const client = [attrsTexte(c.a, consts), longMax !== null || longMin !== null ? `longueur JS ${fmt(longMin, longMax)}` : '',
    bMin !== null || bMax !== null ? `valeur ${fmt(bMin, bMax)}` : '', e.vide ? `vide ${e.vide === 'refuse' ? 'refusé' : 'permis'}` : ''].filter(Boolean).join(' ; ');
  const serveurs = [];

  if (!SANS_REGLE.includes(e.genre)) {
    // Preuve : la validation annoncée est bien dans le code du champ
    const lieux = e.preuveDans || [c.fichier.replace(/^js\//, '')];
    const texteLieux = lieux.map(l => src[l] ?? '').join('\n');
    for (const p of e.preuve || []) if (!texteLieux.includes(p)) probleme(`validation annoncée introuvable : « ${p} » (${lieux.join(', ')})`);

    // Longueur
    if ((TEXTES.includes(e.genre) || NOMBRES.includes(e.genre)) && ml === null && !e.exemption?.longueur) {
      probleme('sans limite de longueur (aucun maxlength) : 5 000 caractères collés passent');
    }
    if (ml !== null && longMax !== null && ml < longMax) avert(`maxlength ${ml} plus court que la limite JS ${longMax}`);

    // Espaces seuls
    // (un code est normalisé : espaces retirés, puis forme vérifiée)
    if (TEXTES.includes(e.genre) && e.genre !== 'code' && e.vide === 'refuse' && c.a.aide !== 'askText' && !/trim\(|\.trim\b|hasVisible\(/.test(texteLieux)) {
      probleme('nom obligatoire sans trim : des espaces seuls seraient acceptés');
    }

    // Nombres : virgule française, type="number"
    if (NOMBRES.includes(e.genre) || e.virgule) {
      if (c.a.type === 'number') probleme('type="number" : « 12,5 » devient vide et « 1e3 » passe (clavier français, collage)');
      if (e.virgule && c.a.inputmode && !/decimal|\$\{/.test(String(c.a.inputmode))) probleme(`clavier ${c.a.inputmode} : pas de virgule pour un nombre décimal`);
    }

    // Bornes illogiques
    if (e.bornes) {
      if (bMin !== null && bMin < 0) probleme(`borne basse négative (${bMin})`);
      if (bMin !== null && bMax !== null && bMax <= bMin) probleme(`borne haute ${bMax} sous la basse ${bMin}`);
      if (e.genre === 'charge' && bMin !== null && bMin > 0 && !e.exemption?.zero) probleme(`charge à 0 refusée (minimum ${bMin}) alors que le poids du corps est permis`);
    }
    if (e.avertir) avert(e.avertir);

    // Serveur
    for (const s of e.serveur || []) {
      if (s.tronque) {
        serveurs.push(`coupé à ${s.tronque} (${s.ou})`);
        if (effMax === null || effMax > s.tronque) probleme(`le serveur coupe à ${s.tronque} caractères, le client en accepte ${effMax ?? 'sans limite'}`);
        continue;
      }
      const b = bornesSql(migrations, s);
      const nomCible = s.fonction ? `${s.fonction}(${s.variable ?? '…'})` : `${s.table}.${s.colonne}`;
      if (!b) { probleme(`contrainte serveur introuvable : ${nomCible} (registre périmé ?)`); continue; }
      serveurs.push(`${nomCible} : ${[b.longMin != null || b.longMax != null ? `longueur ${fmt(b.longMin, b.longMax)}` : '',
        b.min != null || b.max != null ? `valeur ${fmt(b.min, b.max)}` : '', b.motif ? `motif ^${b.motif}$` : ''].filter(Boolean).join(', ')} (${b.ou})`);
      if (b.longMax != null) {
        if (effMax === null) probleme(`le serveur refuse au-delà de ${b.longMax} caractères, le client n'a pas de limite`);
        else if (effMax > b.longMax) probleme(`limite client ${effMax} au-dessus du serveur ${b.longMax} : refus du serveur après coup`);
        else if (effMax < b.longMax) avert(`limite client ${effMax} plus stricte que le serveur (${b.longMax})`);
      }
      if (b.longMin != null) {
        const cMin = longMin ?? (e.vide === 'refuse' ? 1 : 0);
        if (cMin < b.longMin) probleme(`le client accepte ${cMin} caractère(s), le serveur en veut ${b.longMin} au moins`);
      }
      if (b.max != null && bMax !== null) {
        if (bMax > b.max) probleme(`valeur client jusqu'à ${bMax}, le serveur refuse au-delà de ${b.max}`);
        else if (bMax < b.max) avert(`valeur client ${bMax} au plus, le serveur ${b.max}`);
      }
      if (b.min != null && bMin !== null && bMin < b.min) probleme(`valeur client dès ${bMin}, le serveur refuse sous ${b.min}`);
    }
  }
  return { cle: c.cle, nom: e.nom, ou, client, serveur: e.serveur === null ? 'appareil seulement' : serveurs.join(' ; '), problemes: pb };
}

export function rapport(res, { tout = false } = {}) {
  const graves = res.filter(x => x.problemes.some(p => p.grave));
  const lignes = res.filter(x => tout || x.problemes.length);
  const out = [`Inventaire des champs : ${res.length} champs, ${graves.length} avec un problème, `
    + `${res.filter(x => x.problemes.length && !x.problemes.some(p => p.grave)).length} avec un avertissement`, ''];
  out.push('| Champ | Fichier:ligne | Règle client | Règle serveur | Problème |', '|---|---|---|---|---|');
  const cell = s => String(s || '—').replace(/\|/g, '\\|');
  for (const x of lignes) {
    const p = x.problemes.map(q => `${q.grave ? 'PROBLÈME' : 'avertissement'} : ${q.texte}`).join(' ; ') || 'OK';
    out.push(`| ${cell(x.nom)} | ${cell(x.ou)} | ${cell(x.client)} | ${cell(x.serveur)} | ${cell(p)} |`);
  }
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const racine = path.resolve(args.find(a => !a.startsWith('--')) || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const res = verifier(lireDepot(racine));
  if (args.includes('--json')) console.log(JSON.stringify(res, null, 2));
  else console.log(rapport(res, { tout: args.includes('--tout') }));
  process.exit(res.some(x => x.problemes.some(p => p.grave)) ? 1 : 0);
}
