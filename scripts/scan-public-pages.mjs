#!/usr/bin/env node
/**
 * Scheduled secret scanner for served public pages on harbour.cat (LIN-2573).
 *
 * Fetches public pages:
 * - Landing: /
 * - KPIs: /kpis
 * - Numbered archive documents: /archive/:n
 *
 * Extracts and scans all served JavaScript (inline scripts and external JS assets).
 * Any secret hit is treated as a P1 incident and exits non-zero.
 * Any unreachable page or fetch failure also exits non-zero.
 *
 * Usage:
 *   node scripts/scan-public-pages.mjs
 *   node scripts/scan-public-pages.mjs --base-url https://harbour.cat
 *   npm run scan:public-pages
 *
 * Exit 0 on clean scan, exit 1 on secret hit (P1) or fetch/scan failure.
 */

import { scanPublicPages } from '../lib/scan-public-pages.js';

let baseUrl = 'https://harbour.cat';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base-url' && args[i + 1]) {
    baseUrl = args[i + 1];
    i++;
  }
}

console.log(`[scan-public-pages] Fetching and scanning public pages from ${baseUrl}...`);
const start = Date.now();

try {
  const result = await scanPublicPages({ baseUrl });
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`[scan-public-pages] Scanned ${result.scannedPages.length} pages (${result.scannedPages.join(', ')})`);
  console.log(`[scan-public-pages] Analyzed ${result.scannedScripts.length} JavaScript asset(s) in ${elapsed}s`);

  if (!result.clean) {
    if (result.findings.length > 0) {
      console.error(`\n🚨 [P1 SECRET EXPOSURE] Found ${result.findings.length} secret(s) in served public pages on ${baseUrl}!\n`);
      for (const f of result.findings) {
        console.error(`  - [P1] [${f.ruleName}] in ${f.filePath} (on page ${f.pageUrl})`);
        console.error(`    Line ${f.line}, Col ${f.column}: ${f.redacted}`);
      }
      console.error('\nThis is a P1 security incident. Investigate and revoke exposed credentials immediately.\n');
    }
    if (result.errors && result.errors.length > 0) {
      console.error(`\n❌ [SCAN FAILURE] Errors encountered during public page scan on ${baseUrl}:\n`);
      for (const err of result.errors) {
        console.error(`  - [${err.type}] ${err.message || err.error || err.url}`);
      }
      console.error('');
    }
    process.exit(1);
  } else {
    console.log(`[scan-public-pages] ✅ Clean: 0 secrets found across all served public pages.`);
    process.exit(0);
  }
} catch (err) {
  console.error(`[scan-public-pages] Error executing scan: ${err.message}`);
  process.exit(1);
}
