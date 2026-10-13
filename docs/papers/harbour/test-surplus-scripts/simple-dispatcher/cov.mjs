// LIN-3551: per-test-file line coverage of production code via raw NODE_V8_COVERAGE (block coverage), one file at a time.
// A line counts as covered when the innermost V8 range containing its first non-blank character has count > 0.
// Blank and comment-only lines are ignored. Production = any .js under the worktree outside test/ and node_modules/.
import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath, fileURLToPath as f2p } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const work = resolve(here, 'sd-wt');
const outDir = resolve(here, 'covlines'); mkdirSync(outDir, { recursive: true });
const tests = readdirSync(resolve(work, 'test')).filter((f) => f.endsWith('.test.js')).sort();
const srcCache = new Map();
function lineStarts(src) { const s = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') s.push(i + 1); return s; }
function prodFile(url) {
  if (!url.startsWith('file://')) return null;
  const p = f2p(url);
  if (!p.startsWith(work + '/')) return null;
  const rel = p.slice(work.length + 1);
  if (rel.startsWith('test/') || rel.startsWith('node_modules/') || !rel.endsWith('.js')) return null;
  return { p, rel };
}
for (const t of tests) {
  const dest = resolve(outDir, `${t}.json`);
  if (existsSync(dest)) continue;
  const raw = resolve(here, 'covraw', t); rmSync(raw, { recursive: true, force: true }); mkdirSync(raw, { recursive: true });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--require', './test/isolate-local-halt.js', '--test', `test/${t}`], { cwd: work, encoding: 'utf8', timeout: 300_000, env: { ...process.env, HARBOUR_LOCAL_BASE: '', NODE_V8_COVERAGE: raw } });
  const wallMs = Date.now() - t0;
  const covered = new Map(); // rel -> Set(line)
  for (const f of readdirSync(raw)) {
    let j; try { j = JSON.parse(readFileSync(resolve(raw, f), 'utf8')); } catch { continue; }
    for (const script of j.result || []) {
      const pf = prodFile(script.url); if (!pf) continue;
      if (!srcCache.has(pf.p)) { const src = readFileSync(pf.p, 'utf8'); srcCache.set(pf.p, { src, starts: lineStarts(src), lines: src.split('\n') }); }
      const { starts, lines } = srcCache.get(pf.p);
      const ranges = script.functions.flatMap((fn) => fn.ranges);
      const set = covered.get(pf.rel) || new Set(); covered.set(pf.rel, set);
      lines.forEach((line, i) => {
        const code = line.trim();
        if (!code || /^(\/\/|\*|\/\*)/.test(code)) return;
        if (set.has(i + 1)) return;
        const off = starts[i] + (line.length - line.trimStart().length);
        let best = null;
        for (const rg of ranges) if (rg.startOffset <= off && off < rg.endOffset && (!best || rg.endOffset - rg.startOffset < best.endOffset - best.startOffset)) best = rg;
        if (best && best.count > 0) set.add(i + 1);
      });
    }
  }
  rmSync(raw, { recursive: true, force: true });
  writeFileSync(dest, JSON.stringify({ test: `test/${t}`, wallMs, status: r.status, covered: Object.fromEntries([...covered].map(([k, v]) => [k, [...v].sort((a, b) => a - b)])) }));
  process.stderr.write(`${t} ${wallMs}ms status=${r.status} lines=${[...covered.values()].reduce((a, s) => a + s.size, 0)}\n`);
}
