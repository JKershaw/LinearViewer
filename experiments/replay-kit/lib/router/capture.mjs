// One-time capture of the requests the existing unit tests send to a router
// (replay-kit/lib/router; generalised from rung5c/replay/capture-tests.mjs).
//   captureTests({ repo, files, routeKeyModule, outFile, jobs, workDir })
// Each test file runs once, cwd = repo (an origin/main snapshot), under
// capture-preload.mjs. Returns { files: {file: {calls, exit, escapes}}, calls }.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function captureTests({ repo, files, routeKeyModule, outFile, jobs = 6, workDir }) {
  const tmp = path.join(workDir, `capture-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  const results = [];
  let next = 0;
  const runOne = (f) => new Promise((resolve) => {
    const out = path.join(tmp, f.replace(/\W/g, '_') + '.json');
    const env = { ...process.env, REPLAY_CAPTURE_FILE: f, REPLAY_CAPTURE_OUT: out, REPLAY_ROUTEKEY_MODULE: pathToFileURL(routeKeyModule).href, NODE_ENV: 'test', TMPDIR: tmp };
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NODE_OPTIONS', 'NODE_TEST_CONTEXT']) delete env[k];
    const p = spawn(process.execPath, ['--import', pathToFileURL(path.join(HERE, 'capture-preload.mjs')).href, '--test', '--test-reporter=dot', f], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => p.kill('SIGKILL'), 240_000);
    p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
    p.on('close', (code) => { clearTimeout(timer); const r = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { file: f, calls: [], escapes: [] }; resolve({ ...r, file: f, exit: code }); });
  });
  await Promise.all(Array.from({ length: jobs }, async () => { while (next < files.length) { const f = files[next++]; results.push(await runOne(f)); process.stderr.write('.'); } }));
  results.sort((a, b) => a.file.localeCompare(b.file));
  const calls = results.flatMap(r => r.calls);
  const summary = Object.fromEntries(results.map(r => [r.file, { calls: r.calls.length, exit: r.exit, escapes: r.escapes.length }]));
  writeFileSync(outFile, JSON.stringify({ repo, capturedAt: new Date().toISOString(), files: summary, calls }, null, 1));
  rmSync(tmp, { recursive: true, force: true });
  process.stderr.write(`\n${files.length} files, ${calls.length} calls captured, ${results.filter(r => r.exit !== 0).length} test files exited non-zero, ${results.reduce((s, r) => s + r.escapes.length, 0)} blocked sockets\n`);
  return { files: summary, calls };
}
