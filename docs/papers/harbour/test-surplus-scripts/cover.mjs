// Per-test-file line coverage: run each unit test file alone with NODE_V8_COVERAGE,
// reduce the V8 block ranges to covered line numbers per repo source file, record wall time + exit.
// Usage: node cover.mjs <worktree> <out.json> [concurrency]
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';

const work = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
const conc = Number(process.argv[4] || 6);
const files = process.env.ONLY ? process.env.ONLY.split(',') : [
  ...readdirSync(join(work, 'tests/unit')).filter((f) => f.endsWith('.test.js')).sort().map((f) => `tests/unit/${f}`),
  'scripts/eval/eval-dense.test.mjs',
];
const tmpRoot = join(work, '..', 'covtmp');
mkdirSync(tmpRoot, { recursive: true });

const srcCache = new Map();
function lineStarts(abs) {
  if (srcCache.has(abs)) return srcCache.get(abs);
  let v = null;
  try {
    const s = readFileSync(abs, 'utf8');
    const starts = [0];
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) starts.push(i + 1);
    v = { starts, len: s.length };
  } catch {}
  srcCache.set(abs, v);
  return v;
}
// V8 offsets are UTF-16 code-unit offsets, matching JS string indices.
function lineOf(starts, off) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
  return lo + 1;
}

function reduce(dir) {
  const acc = {}; // rel -> Set(lines)
  if (!existsSync(dir)) return acc;
  for (const f of readdirSync(dir)) {
    let j;
    try { j = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
    for (const sc of j.result || []) {
      if (!sc.url.startsWith('file://')) continue;
      const abs = fileURLToPath(sc.url);
      if (!abs.startsWith(work + '/')) continue;
      const rel = abs.slice(work.length + 1);
      if (rel.startsWith('node_modules/') || rel.startsWith('tests/')) continue;
      const ls = lineStarts(abs);
      if (!ls) continue;
      const ranges = [];
      for (const fn of sc.functions) for (const r of fn.ranges) ranges.push(r);
      ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
      // Paint counts per line-segment: track per-line max count after nested override, by painting offsets.
      const paint = new Int32Array(ls.len + 1).fill(-1);
      for (const r of ranges) paint.fill(r.count > 0 ? 1 : 0, r.startOffset, Math.min(r.endOffset, ls.len));
      const set = acc[rel] || (acc[rel] = new Set());
      // A line is covered if any non-whitespace char in it is painted 1.
      const src = readFileSync(abs, 'utf8');
      for (let li = 0; li < ls.starts.length; li++) {
        const a = ls.starts[li], b = li + 1 < ls.starts.length ? ls.starts[li + 1] : ls.len;
        for (let k = a; k < b; k++) { if (paint[k] === 1 && src.charCodeAt(k) > 32) { set.add(li + 1); break; } }
      }
    }
  }
  return acc;
}

const results = {};
let idx = 0, done = 0;
async function worker() {
  while (idx < files.length) {
    const f = files[idx++];
    const dir = join(tmpRoot, f.replace(/[\/]/g, '__'));
    rmSync(dir, { recursive: true, force: true });
    const t0 = Date.now();
    const code = await new Promise((res) => {
      const p = spawn(process.execPath, ['--test', '--test-reporter=dot', f], { cwd: work, env: { ...process.env, NODE_V8_COVERAGE: dir, HARBOUR_LOCAL_BASE: '' }, stdio: 'ignore' });
      const to = setTimeout(() => p.kill('SIGKILL'), 300_000);
      p.on('exit', (c) => { clearTimeout(to); res(c); });
    });
    const ms = Date.now() - t0;
    const cov = reduce(dir);
    rmSync(dir, { recursive: true, force: true });
    results[f] = { ms, code, cov: Object.fromEntries(Object.entries(cov).map(([k, s]) => [k, [...s].sort((a, b) => a - b)])) };
    done++;
    if (done % 25 === 0) process.stderr.write(`${done}/${files.length}\n`);
  }
}
await Promise.all(Array.from({ length: conc }, worker));
writeFileSync(out, JSON.stringify(results));
console.log('done', Object.keys(results).length);
