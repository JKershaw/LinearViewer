#!/usr/bin/env node
// One-time capture of the requests the existing unit tests send to the three
// routers (see lib/test-capture-preload.mjs) → pinned/test-calls.json.
//   node capture-tests.mjs [--repo /home/user/LinearViewer] [--jobs 6]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const TOOL = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const repo = args.includes('--repo') ? path.resolve(args[args.indexOf('--repo') + 1]) : '/home/user/LinearViewer';
const jobs = args.includes('--jobs') ? Number(args[args.indexOf('--jobs') + 1]) : 6;
const RE_PATH = /\/api\/dispatch|\/api\/proxy\/dispatch|recommend-and-dispatch|autopilot\/kickoff|wake-shadow|passage-runner\/prompt|autopilot\/manual/;
const RE_MOUNT = /createDispatchRoutes|createProxyRoutes|createKickoffRoutes|routes\/dispatch|routes\/proxy/;
const files = readdirSync(path.join(repo, 'tests/unit')).filter(f => f.endsWith('.test.js')).map(f => `tests/unit/${f}`)
  .filter(f => { const t = readFileSync(path.join(repo, f), 'utf8'); return RE_PATH.test(t) && RE_MOUNT.test(t); });
const tmp = path.join(TOOL, 'work', `capture-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const results = [];
let next = 0;
const runOne = (f) => new Promise((resolve) => {
  const outFile = path.join(tmp, f.replace(/\W/g, '_') + '.json');
  const env = { ...process.env, REPLAY_CAPTURE_FILE: f, REPLAY_CAPTURE_OUT: outFile, NODE_ENV: 'test', TMPDIR: tmp };
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) delete env[k];
  const p = spawn(process.execPath, ['--import', path.join(TOOL, 'lib/test-capture-preload.mjs'), '--test', '--test-reporter=dot', f], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => p.kill('SIGKILL'), 180_000);
  p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
  p.on('close', (code) => { clearTimeout(timer); const r = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : { file: f, calls: [], escapes: [] }; resolve({ ...r, file: f, exit: code }); });
});
await Promise.all(Array.from({ length: jobs }, async () => { while (next < files.length) { const f = files[next++]; results.push(await runOne(f)); process.stderr.write('.'); } }));
const calls = results.flatMap(r => r.calls);
const summary = Object.fromEntries(results.sort((a, b) => a.file.localeCompare(b.file)).map(r => [r.file, { calls: r.calls.length, exit: r.exit, escapes: r.escapes.length }]));
writeFileSync(path.join(TOOL, 'pinned', 'test-calls.json'), JSON.stringify({ repo, capturedAt: new Date().toISOString(), files: summary, calls }, null, 1));
rmSync(tmp, { recursive: true, force: true });
process.stderr.write(`\n${files.length} files, ${calls.length} calls captured, ${results.filter(r => r.exit !== 0).length} test files exited non-zero, ${results.reduce((s, r) => s + r.escapes.length, 0)} blocked sockets\n`);
