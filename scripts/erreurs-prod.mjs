#!/usr/bin/env node
// Lire les erreurs reçues de l'app (docs/ERREURS_PROD.md), en LECTURE SEULE, par l'API de gestion de Supabase.
//   node scripts/erreurs-prod.mjs [--jours 7] [--version 2026.11.29-abc1234] [--json]
// Jeton : fichier ~/.config/mdlf/supabase_token (ou $SUPABASE_JETON_FICHIER), jamais affiché ni écrit ailleurs.
// Sortie : une ligne par erreur (occurrences, dernière fois, version, plateforme, type, message, premier fichier
// de l'app dans la pile). Code 0 même s'il y a des erreurs : c'est une lecture, pas un contrôle bloquant.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REF = 'yopptmdjtnezmccdvaxf';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const jours = Math.max(1, Math.min(90, parseInt(opt('--jours', '7'), 10) || 7));
const version = opt('--version', null);
if (version !== null && !/^[A-Za-z0-9._+-]{1,40}$/.test(version)) { console.error('version illisible'); process.exit(2); }

const tokenFile = process.env.SUPABASE_JETON_FICHIER || path.join(os.homedir(), '.config/mdlf/supabase_token');
let token = '';
try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch { console.error(`jeton introuvable : ${tokenFile}`); process.exit(2); }

// Valeurs contrôlées ci-dessus (entier borné, version au format strict) : pas d'injection possible
const sql = `select hits, last_at, first_at, build, platform, kind, name, message,
  (select f from jsonb_array_elements(frames) f where f->>'file' <> '<ext>' limit 1) as lieu
  from public.error_reports where last_at > now() - interval '${jours} days'
  ${version ? `and build = '${version}'` : ''} order by hits desc, last_at desc limit 200`;
const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql, read_only: true }),
});
if (!res.ok) { console.error(`API de gestion : ${res.status} ${(await res.text()).slice(0, 200)}`); process.exit(1); }
const rows = await res.json();
if (args.includes('--json')) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
if (!rows.length) { console.log(`Aucune erreur reçue sur ${jours} jour(s)${version ? ` pour ${version}` : ''}.`); process.exit(0); }
console.log(`${rows.length} erreur(s) distincte(s) sur ${jours} jour(s) :`);
for (const r of rows) {
  const lieu = r.lieu ? `${r.lieu.file}:${r.lieu.l}:${r.lieu.c}${r.lieu.f && r.lieu.f !== '?' ? ` (${r.lieu.f})` : ''}` : 'pile vide';
  console.log(`${String(r.hits).padStart(5)} × ${String(r.last_at).slice(0, 16)}  ${r.build} ${r.platform}  ${r.kind === 'rejection' ? '[promesse] ' : ''}${r.name}: ${r.message}\n        ${lieu}`);
}
