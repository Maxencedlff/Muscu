#!/usr/bin/env node
// Rapport mensuel de parrainage en CSV (docs/PARRAINAGE.md) : par parrain (partenaire ou coach) et par
// mois, comptes parrainés et abonnés actifs, d'après public.referral_report() (clé serveur seulement).
//
//   SUPABASE_URL=https://<projet>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
//     node tools/rapport-parrainage.mjs --mois 2026-11 [--sortie parrainage-2026-11.csv]
//   node tools/rapport-parrainage.mjs --de 2026-01 --a 2026-12          (plusieurs mois)
//   node tools/rapport-parrainage.mjs --json reponse.json --mois 2026-11  (réponse déjà enregistrée)
//
// La clé service_role ne se tape jamais dans la commande ni dans un fichier du dépôt : variable
// d'environnement seulement. Le CSV ne contient aucune donnée personnelle (des nombres par code).
// Séparateur « ; » et virgule décimale : s'ouvre tel quel dans Excel ou Numbers en français.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const COLUMNS = [
  ['mois', r => String(r.month).slice(0, 7)],
  ['type', r => (r.kind === 'coach' ? 'coach' : 'partenaire')],
  ['code', r => r.code ?? ''],
  ['coach_id', r => r.coach_id ?? ''],
  ['nom', r => r.display_name ?? ''],
  ['actif', r => (r.active ? 'oui' : 'non')],
  ['taux_commission', r => (r.commission_rate == null ? '' : frNum(Number(r.commission_rate) * 100) + ' %')],
  ['duree_mois', r => r.commission_months ?? ''],
  ['nouveaux_comptes', r => r.new_accounts],
  ['comptes_total', r => r.total_accounts],
  // null : inconnu (private.referral_subscribers)
  ['abonnes_actifs', r => (r.active_subscribers == null ? '' : r.active_subscribers)],
  // Argent (euros) : vide quand c'est inconnu (paiement dans une autre devise, docs/PARRAINAGE.md)
  ['revenu_net_eur', r => euros(r.net_cents)],
  ['abonnement_coach_actif', r => (r.coach_active == null ? '' : r.coach_active ? 'oui' : 'non')],
  ['commission_mois_eur', r => euros(r.commission_cents)],
  ['deja_verse_eur', r => euros(r.paid_cents)],
  ['reste_du_eur', r => euros(r.balance_cents)],
  // Virement dès 20 € cumulés, sinon reporté au mois suivant
  ['a_verser', r => (r.payable == null ? '' : r.payable ? 'oui' : 'non, reporté')],
];

const euros = c => (c == null || !Number.isFinite(Number(c)) ? '' : (Number(c) / 100).toFixed(2).replace('.', ','));

const frNum = n => (Number.isFinite(n) ? String(Math.round(n * 100) / 100).replace('.', ',') : '');

// « 2026-11 » → « 2026-11-01 », sinon null
export function monthStart(s) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(s ?? ''));
  return m ? `${m[1]}-${m[2]}-01` : null;
}

// Une cellule : guillemets si besoin ; jamais de formule (=, +, -, @ en tête : injection dans un tableur)
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  const lines = [COLUMNS.map(([h]) => h).join(';')];
  for (const r of rows) lines.push(COLUMNS.map(([, f]) => csvCell(f(r))).join(';'));
  return lines.join('\r\n') + '\r\n';
}

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`argument inattendu : ${k}`);
    o[k.slice(2)] = argv[++i];
  }
  const from = monthStart(o.mois ?? o.de), to = monthStart(o.mois ?? o.a ?? o.de);
  if (!from || !to) throw new Error('--mois AAAA-MM (ou --de AAAA-MM --a AAAA-MM) obligatoire');
  if (from > to) throw new Error('--de après --a');
  return { from, to, out: o.sortie || null, json: o.json || null };
}

async function fetchReport({ from, to }) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY à définir dans l\'environnement');
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/referral_report`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_month: from, to_month: to }),
  });
  if (!res.ok) throw new Error(`referral_report : HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = args.json ? JSON.parse(fs.readFileSync(args.json, 'utf8')) : await fetchReport(args);
  if (!Array.isArray(rows)) throw new Error('réponse inattendue (tableau attendu)');
  const kept = rows.filter(r => String(r.month) >= args.from && String(r.month).slice(0, 10) <= args.to);
  const csv = toCsv(kept);
  if (args.out) { fs.writeFileSync(args.out, '﻿' + csv); console.error(`${kept.length} lignes → ${args.out}`); }
  else process.stdout.write(csv);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
