// Live unit-test tier for router replays (replay-kit/lib/router).
// Per side, an OVERLAY of the origin/main snapshot: `routes/`, `tests/` and
// `server.js` are real copies (so relative imports AND source-text reads made
// from tests resolve to the overlay), with the side's target file(s) — and any
// helper files from the side's source folder — written into overlay/routes/;
// every other top-level entry (lib, node_modules, docs, public, …) is a
// symlink to the snapshot. Each selected unit-test file then runs once per
// side (cwd = overlay, NODE_ENV=test, proxies scrubbed, TZ=UTC) and the two
// sides' per-test TAP verdicts and exit codes are compared. This is the
// witness for tests that drive the router WITHOUT an HTTP server (direct
// handler calls) and for every source-text test that reads the target file.
//
//   await runLiveTests({ snapshotDir, sides: [{label, srcFiles: {relDest: absSrc}}], testFiles, jobs, workDir })
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const COPY = new Set(['routes', 'tests', 'server.js', 'package.json']);

export function buildOverlay(snapshotDir, dir, srcFiles) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const e of fs.readdirSync(snapshotDir)) {
    const from = path.join(snapshotDir, e);
    const to = path.join(dir, e);
    if (COPY.has(e)) fs.cpSync(from, to, { recursive: true, dereference: false });
    else fs.symlinkSync(fs.realpathSync(from), to);
  }
  for (const [rel, src] of Object.entries(srcFiles)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(src, path.join(dir, rel));
  }
  return dir;
}

export function parseTap(out) {
  const res = [];
  const stack = [];
  const lines = out.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^(\s*)# Subtest: (.*)$/);
    if (m) { const lvl = m[1].length / 4; stack.length = lvl; stack[lvl] = m[2]; continue; }
    const t = l.match(/^(\s*)(not ok|ok) \d+ - (.*?)(\s+#\s*(SKIP|TODO).*)?$/);
    if (t) {
      const lvl = t[1].length / 4;
      const name = [...stack.slice(0, lvl), t[3]].join(' > ');
      let error = null;
      if (t[2] === 'not ok') {
        for (let j = i + 1; j < Math.min(lines.length, i + 60); j++) {
          const em = lines[j].match(/^\s*error:\s*(.*)$/);
          if (em) { error = em[1].slice(0, 300); break; }
          if (/^\s*(not ok|ok) \d+/.test(lines[j])) break;
        }
      }
      res.push({ path: name, ok: t[2] === 'ok', directive: t[5] || null, error });
      stack.length = lvl;
    }
  }
  return res;
}

function runFile(cwd, file, timeoutMs) {
  return new Promise((resolve) => {
    const env = { ...process.env, NODE_ENV: 'test', TZ: 'UTC' };
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NODE_OPTIONS', 'NODE_TEST_CONTEXT', 'OPENROUTER_API_KEY', 'MONGODB_URI']) delete env[k];
    const p = spawn(process.execPath, ['--test', '--test-reporter=tap', file], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', () => {});
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ exit: code, tests: parseTap(out) }); });
  });
}

export async function runLiveTests({ snapshotDir, sides, testFiles, jobs = 6, workDir, timeoutMs = 240_000, log = (s) => process.stderr.write(s) }) {
  const overlays = {};
  for (const s of sides) overlays[s.label] = buildOverlay(snapshotDir, path.join(workDir, `live-${s.label}`), s.srcFiles);
  const queue = [];
  for (const f of testFiles) for (const s of sides) queue.push({ f, label: s.label });
  const results = {};
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < queue.length) {
      const { f, label } = queue[next++];
      (results[f] ||= {})[label] = await runFile(overlays[label], f, timeoutMs);
      if (next % 20 === 0) log('.');
    }
  }));
  const diffs = [];
  let tests = 0; let failingOld = 0; const failingOnOldList = [];
  for (const f of testFiles) {
    const a = results[f].old; const b = results[f].new;
    const map = (r) => new Map(r.tests.map(t => [t.path, t]));
    const ma = map(a); const mb = map(b);
    tests += ma.size;
    for (const t of ma.values()) if (!t.ok && !t.directive) { failingOld++; failingOnOldList.push(`${f} :: ${t.path}`); }
    const fileDiffs = [];
    for (const k of new Set([...ma.keys(), ...mb.keys()])) {
      const x = ma.get(k); const y = mb.get(k);
      if (!x || !y || x.ok !== y.ok) fileDiffs.push({ test: k, old: x ? (x.ok ? 'ok' : `not ok: ${x.error}`) : '<absent>', new: y ? (y.ok ? 'ok' : `not ok: ${y.error}`) : '<absent>' });
    }
    if (a.exit !== b.exit || fileDiffs.length) diffs.push({ file: f, exit: { old: a.exit, new: b.exit }, tests: fileDiffs });
  }
  for (const s of sides) fs.rmSync(overlays[s.label], { recursive: true, force: true });
  return { files: testFiles.length, tests, failingOnOld: failingOld, failingOnOldList, differingFiles: diffs.length, diffs };
}
