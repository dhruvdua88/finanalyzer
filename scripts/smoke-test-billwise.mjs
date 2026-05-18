#!/usr/bin/env node
// Smoke-test the bill-wise outstanding query against a real export.
// Run: npx tsx scripts/smoke-test-billwise.mjs <zip>

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const zipPath = process.argv[2];

if (!zipPath || !existsSync(zipPath)) {
  console.error('Usage: npx tsx scripts/smoke-test-billwise.mjs <path-to-tally-export.zip>');
  process.exit(1);
}

const { TallyStore, getBillwiseOutstanding, summariseAgeing } =
  await import(pathToFileURL(resolve(root, 'services/tally/index.ts')).href);

const store = await TallyStore.fromZip(new Blob([readFileSync(zipPath)]));

for (const primary of ['Sundry Debtors', 'Sundry Creditors']) {
  console.log(`── ${primary} ─────────────────────────────────────────`);
  const open = getBillwiseOutstanding(store, { primary, openOnly: true });
  const all  = getBillwiseOutstanding(store, { primary, openOnly: false });
  console.log(`  Bills total:    ${all.length}`);
  console.log(`  Bills open:     ${open.length}`);
  console.log(`  Fully settled:  ${all.length - open.length}`);

  console.log('\n  Sample open bills (top 8 by amount):');
  const sorted = open.slice().sort((a, b) => Math.abs(b.netOutstanding) - Math.abs(a.netOutstanding));
  for (const r of sorted.slice(0, 8)) {
    console.log(
      `    ${r.billDate.padEnd(10)} ${(r.party || '').slice(0, 32).padEnd(32)} ` +
      `${(r.billName || '').slice(0, 18).padEnd(18)} ` +
      `${r.netOutstanding.toFixed(2).padStart(14)} ${r.daysOutstanding.toString().padStart(4)}d ${r.ageingBucket.padEnd(8)} [${r.status}]`,
    );
  }

  const summary = summariseAgeing(open);
  console.log(`\n  Ageing summary (${summary.length} parties):`);
  console.log('    Party                              Total          0-30         31-60         61-90         91-180        181-365       >365');
  for (const s of summary.slice(0, 6)) {
    console.log(
      `    ${(s.party || '').slice(0, 32).padEnd(32)}  ${s.total.toFixed(2).padStart(14)}  ` +
      `${s.buckets['0-30'].toFixed(2).padStart(12)}  ${s.buckets['31-60'].toFixed(2).padStart(12)}  ` +
      `${s.buckets['61-90'].toFixed(2).padStart(12)}  ${s.buckets['91-180'].toFixed(2).padStart(12)}  ` +
      `${s.buckets['181-365'].toFixed(2).padStart(12)}  ${s.buckets['>365'].toFixed(2).padStart(8)}`,
    );
  }
  console.log('');
}
