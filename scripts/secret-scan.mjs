#!/usr/bin/env node
/**
 * Secret scan CLI over repository source in CI (LIN-2573).
 *
 * Scans the codebase for high-confidence secrets (API keys, private keys, tokens).
 * Fails CI build on any high-confidence match.
 *
 * Usage:
 *   node scripts/secret-scan.mjs
 *   npm run secret-scan
 *
 * Exit 0 when clean, exit 1 when secrets detected.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanDirectory } from '../lib/secret-scan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('[secret-scan] Scanning repository source for secrets...');
const start = Date.now();
const result = scanDirectory(ROOT);
const elapsed = ((Date.now() - start) / 1000).toFixed(2);

if (result.findings.length > 0) {
  console.error(`\n[secret-scan] ❌ FAIL: Found ${result.findings.length} secret(s) in source code (${elapsed}s, ${result.scannedFiles} files checked):\n`);
  for (const f of result.findings) {
    console.error(`  - [${f.ruleName}] at ${f.filePath}:${f.line}:${f.column}`);
    console.error(`    Matched: ${f.redacted}`);
  }
  console.error('\nPlease remove exposed secrets before committing or merging.\n');
  process.exit(1);
} else {
  console.log(`[secret-scan] ✅ PASS: ${result.scannedFiles} files scanned in ${elapsed}s. 0 secrets found.`);
  process.exit(0);
}
