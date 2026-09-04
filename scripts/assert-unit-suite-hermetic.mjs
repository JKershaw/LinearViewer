#!/usr/bin/env node
/**
 * LIN-1880 — the acceptance witness: a full unit-suite run must open ZERO
 * non-loopback sockets.
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST. The property is about the SUITE, not
 * about any file in it: "no test, anywhere, reaches the network." A test cannot
 * assert that about its own siblings without running them, and a test that ran
 * the suite inside the suite would recurse. So the assertion lives one level
 * up, where it can wrap the whole run.
 *
 * WHY IT WRAPS RATHER THAN IMPORTS. `tests/fixtures/network-guard.js`'s
 * `guardSockets` observes the process that installs it. `node --test` runs each
 * file in a CHILD process, so a guard installed in the parent would see nothing
 * — the exact shape of blindness this ticket is about, reproduced one level up.
 * This uses `--import` via NODE_OPTIONS instead, which Node propagates to every
 * child, so the watcher is present in each one.
 *
 * WHAT COUNTS AS AN ESCAPE. Non-loopback `net.connect` / `net.createConnection`
 * / `tls.connect`. Loopback is excluded because the suite's own house pattern is
 * `app.listen(0, '127.0.0.1')` plus a real `fetch` against it (CLAUDE.md), which
 * is legitimate and would otherwise drown the signal.
 *
 * MEASURED BASELINE, for anyone who wants to know this works. At `44ffe713`,
 * before the fix, this reported 8 connections to `api.linear.app:443` from 8
 * distinct files. The ticket recorded 2 and predicted its own figure was stale.
 *
 * Usage:
 *   node scripts/assert-unit-suite-hermetic.mjs          # runs the unit suite
 *   node scripts/assert-unit-suite-hermetic.mjs --proxy  # same, with proxy env set
 *
 * Exit 0 when the run is hermetic, 1 when it is not (or when the suite itself
 * fails — a red suite makes the socket count meaningless, so it is not reported
 * as a hermeticity pass).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const workDir = mkdtempSync(join(tmpdir(), 'hermetic-'));
const logPath = join(workDir, 'sockets.log');
// Separate file, appended on watcher LOAD. Without it an empty socket log is
// indistinguishable from "the watcher never ran" — a `--import` dropped by a
// future Node/npm change, or an unwritable path, would silently print PASS.
// That is the exact shape of vacuous guard this ticket exists to end, and it
// would have been in the instrument that certifies the fix.
const installedPath = join(workDir, 'installed.log');
const watcherPath = join(workDir, 'socket-watcher.mjs');

// The watcher is written out rather than kept as a repo file because it must be
// loadable by `--import` in every child process, and because it is inert
// instrumentation with no place in the shipped tree.
const guardPath = join(ROOT, 'tests', 'fixtures', 'network-guard.js');

writeFileSync(watcherPath, `
import net from 'node:net';
import fs from 'node:fs';

const OUT = ${JSON.stringify(logPath)};
const INSTALLED = ${JSON.stringify(installedPath)};
try { fs.appendFileSync(INSTALLED, process.argv.slice(1).join(' ') + '\\n'); } catch {}
const hits = [];
// Imported, never re-implemented. A local copy drifted from
// tests/fixtures/network-guard.js the moment that one learned unix sockets are
// not escapes, and this script then failed a legitimate test. Two instruments
// disagreeing about what they measure is exactly this ticket's defect class.
import { defaultIsLoopback as loopback } from ${JSON.stringify(guardPath)};

function destinationOf(args) {
  // Node's net.createConnection runs normalizeArgs and calls
  // Socket.prototype.connect with the resulting ARRAY [options, cb]. Without
  // unwrapping it every host reads undefined, and a missing host counts as
  // loopback - so the watcher would report zero escapes for everything.
  const a = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (a && typeof a === 'object') return { host: a.host || a.hostname || null, port: a.port ?? null };
  if (typeof a === 'number') return { host: typeof args[1] === 'string' ? args[1] : null, port: a };
  if (typeof a === 'string') return { host: a, port: null };
  return { host: null, port: null };
}

// net.Socket.prototype.connect is the single choke point every transport
// funnels through: http.request on any Node version, undici's fetch, tls, and
// a bare new net.Socket(). Wrapping the MODULE functions instead is
// Node-version dependent (Node 20's http Agent captures net.createConnection
// at module load), which is how a green local run and a red CI run disagreed
// about the same code. No backticks in this comment on purpose - it lives
// inside a template literal.
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const { host, port } = destinationOf(args);
  if (!loopback(host)) {
    hits.push({ kind: 'net.Socket.connect', host, port, argv: process.argv.slice(1).join(' ') });
  }
  return originalConnect.apply(this, args);
};

process.on('exit', () => {
  if (!hits.length) return;
  try {
    fs.appendFileSync(OUT, hits.map((h) => JSON.stringify(h)).join('\\n') + '\\n');
  } catch (err) {
    // Never swallow: a lost write turns a real escape into a silent PASS.
    process.stderr.write('[hermetic] FATAL: could not record socket escapes: ' + err.message + '\\n');
    process.exitCode = 1;
  }
});
`);

const withProxy = process.argv.includes('--proxy');
const env = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import ${JSON.stringify(watcherPath)}`].filter(Boolean).join(' '),
};
if (withProxy) {
  // Deliberately a dead loopback port. The point is only that the env vars are
  // SET: the original investigation showed the escape count is identical with
  // and without them, because native `fetch` ignores them entirely.
  env.HTTPS_PROXY = 'http://127.0.0.1:9';
  env.HTTP_PROXY = 'http://127.0.0.1:9';
}

console.log(`[hermetic] running the unit suite${withProxy ? ' with proxy env set' : ''}…`);

const child = spawn('npm', ['run', 'test:unit'], { cwd: ROOT, env, stdio: 'inherit' });

// Without this an ENOENT on `npm` emits an unhandled 'error' and throws a raw
// stack instead of this script's own message.
child.on('error', (err) => {
  console.error(`\n[hermetic] could not start the unit suite: ${err.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  const rows = existsSync(logPath)
    ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const installs = existsSync(installedPath)
    ? readFileSync(installedPath, 'utf8').split('\n').filter(Boolean).length
    : 0;

  const cleanup = () => { try { rmSync(workDir, { recursive: true, force: true }); } catch {} };

  if (code !== 0) {
    console.error(`\n[hermetic] the unit suite FAILED (exit ${code}). A red suite makes the socket count meaningless — fix the suite first.`);
    cleanup();
    process.exit(1);
  }

  // POSITIVE CONTROL. A zero-length socket log only means "no escapes" if the
  // watcher was actually present in the processes that ran the tests.
  //
  // The threshold is the FILE COUNT, not zero, and the difference is the whole
  // point. `node --test` runs a process per file, and the npm parent gets the
  // watcher too — so a run where `--import` reached the parent but NOT the
  // children lands on exactly one install. That is the precise regression this
  // check names, and an `installs === 0` threshold would have printed PASS for
  // it. (Review caught that: the guard's message described coverage the guard
  // did not have — the same overclaiming this ticket is about.)
  const expected = readdirSync(join(ROOT, 'tests', 'unit')).filter((f) => f.endsWith('.test.js')).length;
  if (installs < expected) {
    console.error(
      `\n[hermetic] FAIL — the socket watcher loaded in ${installs} process(es) but there are ${expected} unit test files,\n` +
      'so some of them ran unmeasured and a zero here would be misleading. Check that NODE_OPTIONS `--import`\n' +
      'still propagates to `node --test` children in this Node version.'
    );
    cleanup();
    process.exit(1);
  }

  if (rows.length === 0) {
    console.log(`\n[hermetic] PASS — the unit suite opened zero non-loopback sockets (watcher installed in ${installs} processes, ${expected} test files).`);
    cleanup();
    process.exit(0);
  }

  console.error(`\n[hermetic] FAIL — the unit suite opened ${rows.length} non-loopback socket(s) (watcher installed in ${installs} processes):`);
  const byDestination = new Map();
  for (const r of rows) {
    const file = (r.argv.match(/tests\/unit\/[\w.-]+/g) || []).pop() || r.argv.slice(0, 80);
    const key = `${r.host}:${r.port}  <-  ${file}`;
    byDestination.set(key, (byDestination.get(key) || 0) + 1);
  }
  for (const [key, n] of [...byDestination].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${String(n).padStart(4)}  ${key}`);
  }
  console.error(
    '\nA test that reaches the network is not verifying what it claims to: it can pass or fail\n' +
    'on live data, and on a machine with a real LINEAR_ACCESS_TOKEN it does so with a real\n' +
    'credential. Close the call site behind an injectable seam — see\n' +
    'tests/fixtures/hermetic-linear.js for the pattern — rather than mocking globalThis.fetch,\n' +
    'which module-scope transports capture before any test body runs.'
  );
  cleanup();
  process.exit(1);
});
