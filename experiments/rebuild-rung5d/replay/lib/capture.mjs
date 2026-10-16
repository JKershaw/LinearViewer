// Capture the pipeline-loops calls the existing unit tests make (directly, or
// through the lib/routes modules they exercise) by running each test file in
// place under the capture preload (frozen clock, network tripwire, recording
// shim). Read-only on the repo: the run verifies `git status` is unchanged.
// Output: work/captured-<now>.v8 = { summary, scenarios[] }.
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

export const REPO = '/home/user/LinearViewer';
const here = path.dirname(new URL(import.meta.url).pathname);

export function testFiles() {
  const dir = path.join(REPO, 'tests/unit');
  const direct = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.test.js')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/lib\/pipeline-loops\.js['"]/.test(src)) direct.push(`tests/unit/${f}`);
  }
  // Indirect consumers whose tests drive pipeline-loops through real modules.
  const indirect = ['dashboard-routes', 'observation-sessions-materializer', 'observer-sweep', 'chat-tools', 'ticket-close-closer',
    'liveness-real-lean-sweep', 'sessions-feed-cache', 'session-summary', 'run-summary', 'task-page-loader', 'proxy-rulings-routes',
    'live-console-events-route', 'escalation-kpis', 'render-session', 'unanswered-decisions', 'observation-ruling-delivery']
    .map(b => `tests/unit/${b}.test.js`).filter(f => fs.existsSync(path.join(REPO, f)));
  return [...new Set([...direct, ...indirect])];
}

function runOne(rel, now, outFile, timeoutMs) {
  return new Promise((resolve) => {
    fs.rmSync(outFile, { force: true });
    const t0 = Date.now();
    const child = spawn(process.execPath, ['--import', path.join(here, 'capture-preload.mjs'), path.join(REPO, rel)], {
      cwd: REPO,
      env: { ...process.env, TZ: 'UTC', REPLAY_NOW: now, REPLAY_CAPTURE_OUT: outFile, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', d => { out += d; if (out.length > 2e6) out = out.slice(-1e6); });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const num = (re) => Number((out.match(re) || [])[1] ?? NaN);
      resolve({ file: rel, exit: code, signal, seconds: +((Date.now() - t0) / 1000).toFixed(1), pass: num(/^# pass (\d+)/m), fail: num(/^# fail (\d+)/m) });
    });
  });
}

function readRecords(file) {
  if (!fs.existsSync(file)) return [];
  const buf = fs.readFileSync(file);
  const out = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const len = buf.readUInt32LE(off); off += 4;
    if (off + len > buf.length) break;
    try { out.push(v8.deserialize(buf.subarray(off, off + len))); } catch { /* torn tail */ }
    off += len;
  }
  return out;
}

export async function runCapture({ capturePath, now, log = console.error, jobs = 4, timeoutMs = 240000 }) {
  const gitBefore = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
  const tmp = path.join(path.dirname(capturePath), 'capture-tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const files = testFiles();
  const runs = [];
  const queue = files.map((f, i) => ({ f, i }));
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (queue.length) {
      const { f, i } = queue.shift();
      const r = await runOne(f, now, path.join(tmp, `${i}.bin`), timeoutMs);
      r.records = readRecords(path.join(tmp, `${i}.bin`));
      runs.push(r);
      log(`  captured ${String(r.records.length).padStart(4)} calls from ${f} (pass ${r.pass}, fail ${r.fail}, exit ${r.exit}${r.signal ? ' ' + r.signal : ''}, ${r.seconds}s)`);
    }
  }));
  runs.sort((a, b) => a.file.localeCompare(b.file));
  const gitAfter = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
  if (gitAfter !== gitBefore) log(`WARNING: repo working tree changed during capture:\n${gitAfter}`);
  const seen = new Set();
  const scenarios = [];
  const byFn = {};
  let dupes = 0; let unserializable = 0;
  for (const r of runs) {
    for (const rec of r.records) {
      if (rec.error) { unserializable++; continue; }
      const key = crypto.createHash('sha1').update(v8.serialize({ fn: rec.fn, args: rec.args, calls: rec.calls, env: rec.env, expected: rec.expected })).digest('hex');
      if (seen.has(key)) { dupes++; continue; }
      seen.add(key);
      const args = v8.deserialize(rec.args);
      const hasStores = Object.keys(rec.stores).length > 0;
      const env = rec.env.OBSERVATION_FEED_TIMING != null ? { OBSERVATION_FEED_TIMING: rec.env.OBSERVATION_FEED_TIMING } : {};
      scenarios.push({ id: `test:${scenarios.length}`, tier: 'test', site: `${r.file.replace('tests/unit/', '')} ← ${rec.site}`, env, world: hasStores ? { kind: 'script', stores: rec.stores, calls: rec.calls } : null, steps: [{ fn: rec.fn, args }], expected: rec.expected });
      byFn[rec.fn] = (byFn[rec.fn] || 0) + 1;
    }
  }
  const summary = {
    now,
    files: runs.map(({ records, ...r }) => ({ ...r, calls: records.length })),
    rawCalls: runs.reduce((s, r) => s + r.records.length, 0),
    unique: scenarios.length, duplicatesDropped: dupes, unserializable, byFn,
    repoUnchanged: gitAfter === gitBefore,
  };
  fs.writeFileSync(capturePath, v8.serialize({ summary, scenarios }));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { summary, scenarios };
}

export async function loadCapture({ capturePath, now, recapture = false, log }) {
  if (!recapture && fs.existsSync(capturePath)) return v8.deserialize(fs.readFileSync(capturePath));
  log?.(`capturing unit-test inputs (clock ${now})`);
  return runCapture({ capturePath, now, log });
}
