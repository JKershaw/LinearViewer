#!/usr/bin/env node
// Capture each caller's real arguments from the unit tests at <sha>.
//   node capture.mjs <repo> <sha> <captureDir(fresh)> [out=captured.jsonl] [perCallerCap=1500]
// Exports <sha> into a FRESH folder (refuses an existing one), appends a recording wrapper
// to each caller module (no new import statements, so source-text tests still see the same
// imports), runs every unit test file that imports a caller module, and writes deduped
// tagged-JSON argument lists. Never touches <repo> beyond `git archive`.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALLERS } from './callers.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const [repo, sha, dir, out = join(HERE, 'captured.jsonl'), capArg = '1500'] = process.argv.slice(2);
if (!repo || !sha || !dir) { console.error('usage: capture.mjs <repo> <sha> <freshDir> [out] [cap]'); process.exit(2); }
if (existsSync(dir)) { console.error(`refusing: ${dir} exists (pin each SHA into a fresh folder)`); process.exit(2); }
mkdirSync(dir, { recursive: true });
execFileSync('sh', ['-c', `git -C "${repo}" archive "${sha}" | tar -x -C "${dir}"`]);
writeFileSync(join(dir, '.pinned-sha'), execFileSync('git', ['-C', repo, 'rev-parse', sha]).toString());
symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
const codec = readFileSync(join(HERE, 'codec.mjs'), 'utf8').replace(/export /g, '');
const raw = join(dir, '.capture-raw.jsonl');
const byFile = new Map();
for (const c of CALLERS) { if (!byFile.has(c.file)) byFile.set(c.file, []); byFile.get(c.file).push(c); }
for (const [file, cs] of byFile) {
  let add = `\n;// ── replay capture (appended) ──\nconst __cap = (() => {\n${codec}\nconst fs = process.getBuiltinModule('node:fs');\nconst counts = new Map();\n` +
    `return (id, fn) => function (...args) { const f = process.env.CAPTURE_FILE; if (f) { const n = counts.get(id) || 0; if (n < 400) { counts.set(id, n + 1); try { fs.appendFileSync(f, JSON.stringify({ id, args: toTagged(args) }) + '\\n'); } catch {} } } return fn.apply(this, args); };\n})();\n`;
  for (const c of cs) {
    const name = c.path[c.path.length - 1];
    add += `${name} = __cap(${JSON.stringify(c.id)}, ${name});\n`;
    if (c.path.length > 1) add += `try { ${c.path.join('.')} = ${name}; } catch {}\n`;
  }
  appendFileSync(join(dir, file), add);
}
const mods = [...new Set(CALLERS.map(c => basename(c.file, '.js')))];
const rx = new RegExp(`from '\\.\\./\\.\\./(lib|routes)/(${mods.join('|')})\\.js'`);
const tests = readdirSync(join(dir, 'tests/unit')).filter(f => f.endsWith('.test.js') && rx.test(readFileSync(join(dir, 'tests/unit', f), 'utf8'))).map(f => `tests/unit/${f}`);
console.log(`running ${tests.length} unit test files under capture`);
const t0 = Date.now();
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...tests], { cwd: dir, env: { ...process.env, NODE_ENV: 'test', TZ: 'UTC', CAPTURE_FILE: raw }, encoding: 'utf8', maxBuffer: 1 << 28 });
const summary = (r.stdout || '').split('\n').filter(l => /^# (tests|pass|fail|cancelled)/.test(l));
console.log(summary.join(' | '), `(${Math.round((Date.now() - t0) / 1000)} s)`);
const seen = new Set(); const per = new Map(); const lines = [];
for (const line of (existsSync(raw) ? readFileSync(raw, 'utf8') : '').split('\n')) {
  if (!line) continue;
  let rec; try { rec = JSON.parse(line); } catch { continue; }
  const key = rec.id + JSON.stringify(rec.args);
  if (seen.has(key)) continue; seen.add(key);
  const n = per.get(rec.id) || 0; if (n >= Number(capArg)) continue;
  per.set(rec.id, n + 1); lines.push(JSON.stringify(rec));
}
writeFileSync(out, lines.join('\n') + '\n');
for (const c of CALLERS) console.log(`${c.id.padEnd(50)} ${per.get(c.id) || 0}`);
