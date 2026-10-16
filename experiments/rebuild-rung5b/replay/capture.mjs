#!/usr/bin/env node
// Re-run the unit-test input capture on its own:  node capture.mjs [--now ISO] [--jobs 4]
import path from 'node:path';
import { runCapture } from './lib/capture.mjs';
import { DEFAULT_NOW } from './lib/hermetic.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const a = process.argv.slice(2);
const now = a.includes('--now') ? a[a.indexOf('--now') + 1] : DEFAULT_NOW;
const jobs = a.includes('--jobs') ? Number(a[a.indexOf('--jobs') + 1]) : undefined;
const r = await runCapture({ workDir: path.join(HERE, 'work'), now, jobs });
const by = {};
for (const f of r.files) for (const x of f.records) by[`${x.mod}.${x.name}`] = (by[`${x.mod}.${x.name}`] || 0) + 1;
console.log(JSON.stringify(by, null, 1));
const bad = r.files.filter(f => f.exit !== 0 || f.signal);
console.log(`files ${r.files.length}, non-zero exit ${bad.length}: ${bad.map(f => `${f.file}(${f.signal || f.exit},fail ${f.testsFail})`).join(' ')}`);
console.log(`frozen-clock fallback (ran unfrozen): ${r.files.filter(f => !f.frozenClock).map(f => f.file).join(' ') || 'none'}`);
