/**
 * LIN-2992 — pins the GENERATED socket watcher's proxy-endpoint behaviour.
 *
 * `network-guard-sockets.test.js` pins `defaultIsLoopback` and `guardSockets`,
 * but the instrument CI actually gates on is the watcher that
 * `scripts/assert-unit-suite-hermetic.mjs` writes out and `--import`s into every
 * test process. Its proxy awareness rests on one argument at its own call site
 * (`loopback(host, port)`). Review mutated that call to `loopback(host)` and the
 * whole unit suite stayed green while the gate went blind to 32 real tunnels:
 * CI runs keyless with no live proxy, so nothing else exercises it.
 *
 * So this file builds the watcher from the script's OWN template, not from a
 * copy, loads it into a child process whose HTTPS_PROXY points at a local
 * listener, and checks what it records. Both listeners are loopback, so the
 * file stays hermetic.
 *
 * Run with: node --test tests/unit/hermetic-watcher-proxy-endpoint.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'assert-unit-suite-hermetic.mjs');
const GUARD = join(ROOT, 'tests', 'fixtures', 'network-guard.js');

/**
 * Render the watcher exactly as the script does. The template body is the
 * text between `writeFileSync(watcherPath, \`` and the closing `` `); ``, and
 * it interpolates only `logPath`, `installedPath` and `guardPath` — so
 * evaluating it as a template literal with those three bound reproduces the
 * script's output byte-for-byte. Fails loudly if the script's shape changes,
 * rather than silently testing nothing.
 */
function renderWatcher({ logPath, installedPath }) {
  const src = readFileSync(SCRIPT, 'utf8');
  const open = 'writeFileSync(watcherPath, `';
  const start = src.indexOf(open);
  assert.notEqual(start, -1, `could not find the watcher template in ${SCRIPT}`);
  const bodyStart = start + open.length;
  const end = src.indexOf('`);', bodyStart);
  assert.notEqual(end, -1, 'could not find the end of the watcher template');
  const body = src.slice(bodyStart, end);
  return new Function('logPath', 'installedPath', 'guardPath', `return \`${body}\`;`)(
    logPath, installedPath, GUARD
  );
}

function listen() {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => sock.end());
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('LIN-2992: the generated hermetic watcher reports proxy-endpoint connects', () => {
  test('a connect to the configured HTTPS_PROXY endpoint is logged; a loopback server on another port is not', async () => {
    const proxy = await listen();
    const other = await listen();
    const proxyPort = proxy.address().port;
    const otherPort = other.address().port;
    const dir = mkdtempSync(join(tmpdir(), 'lin-2992-watcher-'));
    try {
      const logPath = join(dir, 'sockets.log');
      const installedPath = join(dir, 'installed.log');
      const watcherPath = join(dir, 'socket-watcher.mjs');
      writeFileSync(watcherPath, renderWatcher({ logPath, installedPath }));

      const childPath = join(dir, 'child.mjs');
      writeFileSync(childPath, `
import net from 'node:net';
const connectOnce = (port) => new Promise((resolve, reject) => {
  const s = net.connect(port, '127.0.0.1', () => { s.end(); resolve(); });
  s.on('error', reject);
});
await connectOnce(${proxyPort});
await connectOnce(${otherPort});
`);

      // Async on purpose: a synchronous spawn would block this process's event
      // loop, and with it the two listeners the child connects to. A minimal
      // env, also on purpose: no NODE_OPTIONS, so the enclosing test:hermetic
      // watcher is not loaded into the child. It would otherwise see the same
      // proxy-endpoint connect and report this file as an escape.
      await promisify(execFile)(
        process.execPath,
        ['--import', pathToFileURL(watcherPath).href, childPath],
        { env: { PATH: process.env.PATH, HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` } }
      );

      // Positive control: an empty log only means something if the watcher ran.
      assert.ok(existsSync(installedPath), 'the watcher did not load in the child');

      const rows = existsSync(logPath)
        ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
      assert.deepEqual(
        rows.map((r) => `${r.host}:${r.port}`),
        [`127.0.0.1:${proxyPort}`],
        'only the connect to the configured proxy endpoint is an escape'
      );
    } finally {
      proxy.close();
      other.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
