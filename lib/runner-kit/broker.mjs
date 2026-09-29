#!/usr/bin/env node
/**
 * LIN-3098 S1 — the runner kit's per-item credential broker.
 *
 * A person's Claude Code session becomes their Harbour runner (LIN-3098). It
 * runs each dispatched item in its own subagent, and the item's prompt assumes
 * a local broker at `$HARBOUR_LOCAL_BASE` that injects the credential, so the
 * subagent never holds a token (LIN-1155/LIN-1375). This is that broker: the
 * person-run analogue of Simple Dispatcher's `harbour-token-mcp-server.js`,
 * grown from the LIN-3080 spike's `broker.mjs`.
 *
 * The file is self-contained (Node built-ins only, Node 18+) because the served
 * runner prompt (S3) hands it to the person's machine as-is, to run from
 * `~/.harbour-runner/`.
 *
 * WHAT IT DOES
 *   - Reads the item's bootstrap on STDIN and exchanges it itself
 *     (`POST /api/proxy/token`). The working token then lives only in this
 *     process's memory (`credentialStore`): never on disk, in argv, in env, or
 *     in a log line.
 *   - Listens on a Unix domain socket (`brokerTransport`): mode 600, inside a
 *     mode-700 directory, `~/.harbour-runner/s/<itemId8>.sock`. The directory
 *     is the portable control (BSD-derived kernels don't reliably enforce a
 *     socket's own mode on connect); the socket mode is kept as well.
 *   - Refuses any `Host` but `harbour-runner.invalid` (403), any path outside
 *     `/api/proxy/*` or equal to the mint endpoint (404), and any write verb
 *     without `X-Harbour-Intent: write` (403). Everything else is forwarded to
 *     the Harbour base with the bearer injected.
 *   - Logs `method path status` only.
 *   - Exits on its own when the runner's heartbeat goes stale (two consecutive
 *     normal-length checks; a sleep gap restarts the grace window), at the
 *     48h cap (the worker token's lifetime), or on SIGTERM.
 *   - Writes a pid file with no token, `<urlKey>/brokers/<itemId>.json`, which
 *     `stopBroker` uses.
 *
 * A subagent reaches it with
 *   HARBOUR_LOCAL_BASE=http://harbour-runner.invalid
 *   curl --unix-socket <socket> "$HARBOUR_LOCAL_BASE/api/proxy/..."
 * A curl without `--unix-socket` fails closed: `.invalid` never resolves.
 *
 * SWAPPABLE: John's ruling `lin3098-same-user-boundary` is pending. Token
 * storage sits behind `credentialStore` and the transport behind
 * `brokerTransport`, so either can change in one place.
 *
 * CLI
 *   node broker.mjs serve --base <harbourBase> --url-key <urlKey> --item <itemId> [--home <dir>]  < bootstrap
 *   node broker.mjs stop  --url-key <urlKey> --item <itemId> [--home <dir>]
 * `serve` prints one JSON line `{"ready":true,"pid":…,"socket":…,"pidFile":…}`
 * on stdout once it is listening.
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BROKER_HOST = 'harbour-runner.invalid';
// The runner's heartbeat must be older than this on two consecutive checks.
export const BROKER_STALE_MS = 10 * 60 * 1000;
export const BROKER_CHECK_MS = 60 * 1000;
// A gap between checks this much longer than one tick means the machine slept.
export const BROKER_SLEEP_GAP_MS = 3 * BROKER_CHECK_MS;
// The worker token's lifetime (LIFETIME_PROFILES.worker in lib/proxy-scopes.js).
export const BROKER_MAX_LIFETIME_MS = 48 * 60 * 60 * 1000;
// macOS's sun_path is 104 bytes including the terminating NUL (Linux's is 108).
export const SUN_PATH_MAX_BYTES = 103;

const PROXY_PREFIX = '/api/proxy/';
const TOKEN_MINT_PATH = '/api/proxy/token';
const READ_METHODS = new Set(['GET', 'HEAD']);
// Response headers passed back to the caller. Everything else is dropped;
// the body is already decoded, so content-encoding must not be forwarded.
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'retry-after', 'location'];
const ITEM_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const URL_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The kit's default home: `~/.harbour-runner`. */
export function defaultHome() {
  return path.join(os.homedir(), '.harbour-runner');
}

/**
 * Every path the broker touches, derived from the kit home, the workspace
 * urlKey and the item id. Ids are validated so neither can escape the kit dir.
 */
export function kitPaths({ home = defaultHome(), urlKey, itemId }) {
  if (typeof urlKey !== 'string' || !URL_KEY_RE.test(urlKey)) throw new Error('invalid urlKey');
  if (typeof itemId !== 'string' || !ITEM_ID_RE.test(itemId)) throw new Error('invalid itemId');
  const socketDir = path.join(home, 's');
  const workspaceDir = path.join(home, urlKey);
  const brokersDir = path.join(workspaceDir, 'brokers');
  return {
    home,
    socketDir,
    socket: path.join(socketDir, `${itemId.slice(0, 8)}.sock`),
    workspaceDir,
    heartbeat: path.join(workspaceDir, 'runner.heartbeat'),
    brokersDir,
    pidFile: path.join(brokersDir, `${itemId}.json`),
    logFile: path.join(brokersDir, `${itemId}.log`)
  };
}

/**
 * The one place the broker keeps its working token: this process's memory.
 * The value lives in a closure, so it can't surface through JSON, `String()`
 * or the returned object's own properties.
 */
export function credentialStore() {
  let token = null;
  return Object.freeze({
    set(value) { token = value; },
    get() { return token; },
    clear() { token = null; },
    toJSON() { return '[credential]'; },
    toString() { return '[credential]'; }
  });
}

// Create `dir` (and parents) owned by us with mode 700, tightening it if it
// already exists. Throws if it can't be made private.
function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error(`${dir} is not owned by this user`);
  }
  if ((st.mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700);
  if ((fs.statSync(dir).mode & 0o777) !== 0o700) throw new Error(`${dir} could not be made mode 700`);
}

// Resolve true if something is accepting connections on the socket path.
function socketIsLive(socketPath) {
  return new Promise((resolve) => {
    const s = net.connect({ path: socketPath });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

/**
 * The broker's transport: bind `server` to a mode-600 Unix socket inside a
 * mode-700 directory. Fails closed on a path over the sun_path limit, on a
 * directory that can't be made private, and on a live socket already at the
 * path; a dead socket left by a crashed broker is replaced.
 *
 * @returns {Promise<{socketPath: string, close: () => Promise<void>}>}
 */
export async function brokerTransport({ server, socketDir, socketPath }) {
  if (Buffer.byteLength(socketPath) > SUN_PATH_MAX_BYTES) {
    throw new Error(`socket path too long for sun_path (${Buffer.byteLength(socketPath)} > ${SUN_PATH_MAX_BYTES} bytes): ${socketPath}`);
  }
  ensurePrivateDir(socketDir);
  if (fs.existsSync(socketPath)) {
    if (!fs.lstatSync(socketPath).isSocket()) throw new Error(`${socketPath} exists and is not a socket`);
    if (await socketIsLive(socketPath)) throw new Error(`a broker is already listening on ${socketPath}`);
    fs.unlinkSync(socketPath);
  }
  const previous = process.umask(0o177);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => { server.off('error', reject); resolve(); });
    });
  } finally {
    process.umask(previous);
  }
  fs.chmodSync(socketPath, 0o600);
  if ((fs.statSync(socketPath).mode & 0o777) !== 0o600) {
    await new Promise((resolve) => server.close(resolve));
    throw new Error(`${socketPath} could not be made mode 600`);
  }
  let closed = null;
  return {
    socketPath,
    close() {
      if (!closed) {
        closed = new Promise((resolve) => {
          server.close(() => resolve());
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        }).then(() => { fs.rmSync(socketPath, { force: true }); });
      }
      return closed;
    }
  };
}

/**
 * Is this request target one the broker forwards? Only `/api/proxy/*` after
 * normalisation, and never the mint endpoint: reaching it through the broker
 * would hand the caller a live credential.
 *
 * The mint check compares the pathname lowercased, with repeated slashes
 * collapsed and trailing slashes stripped, because Harbour's Express 4 router
 * is case-insensitive and non-strict: `/api/proxy/Token` and
 * `/api/proxy/token/` both reach `POST /api/proxy/token` there.
 */
export function isProxiablePath(target) {
  if (typeof target !== 'string' || !target.startsWith(PROXY_PREFIX)) return false;
  let pathname;
  try {
    pathname = new URL(target, `http://${BROKER_HOST}`).pathname;
  } catch {
    return false;
  }
  if (!pathname.startsWith(PROXY_PREFIX)) return false;
  if (/%2e/i.test(pathname) || /%2f/i.test(pathname)) return false;
  const canonical = pathname.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return canonical !== TOKEN_MINT_PATH;
}

// The broker's own checks, in order. Returns a refusal or null.
function refusal({ method, url, headers }) {
  if (headers.host !== BROKER_HOST) {
    return { status: 403, body: `This broker only answers Host: ${BROKER_HOST}.\n` };
  }
  if (!isProxiablePath(url)) {
    return { status: 404, body: 'This broker only forwards /api/proxy/*.\n' };
  }
  if (!READ_METHODS.has(method) && String(headers['x-harbour-intent'] || '').trim().toLowerCase() !== 'write') {
    return {
      status: 403,
      body: `A ${method} is a write and needs an explicit opt-in. Retry with the header:\n\n  X-Harbour-Intent: write\n\nThis is not an auth failure.\n`
    };
  }
  return null;
}

/**
 * Exchange a single-use bootstrap for a working token. Errors name the HTTP
 * status only, never a token.
 */
export async function exchangeBootstrap({ base, bootstrap, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(`${base}${TOKEN_MINT_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bootstrap}` },
      redirect: 'manual'
    });
  } catch {
    throw new Error('bootstrap exchange failed: Harbour unreachable');
  }
  if (!res.ok) throw new Error(`bootstrap exchange failed: HTTP ${res.status}`);
  let json;
  try { json = await res.json(); } catch { json = null; }
  if (!json || typeof json.token !== 'string' || !json.token) {
    throw new Error('bootstrap exchange failed: no token in the response');
  }
  return { token: json.token, expiresAt: json.expiresAt || null };
}

/**
 * Is the runner's heartbeat stale, as seen on this check? A check that follows
 * a sleep gap (or a clock step backwards) never counts as stale: the runner
 * was asleep too, and deserves a fresh grace window. A missing heartbeat on a
 * normal tick is stale (fail closed). Shared with the runner helper (S2).
 *
 * @param {number|null} mtimeMs - heartbeat mtime, or null if missing
 * @param {number} nowMs
 * @param {number} maxAgeMs
 * @param {number} lastTickGapMs - time since the previous check
 */
export function isHeartbeatStale(mtimeMs, nowMs, maxAgeMs, lastTickGapMs, { sleepGapMs = BROKER_SLEEP_GAP_MS } = {}) {
  if (lastTickGapMs < 0 || lastTickGapMs > sleepGapMs) return false;
  if (mtimeMs == null) return true;
  return nowMs - mtimeMs > maxAgeMs;
}

/**
 * The broker's self-exit rule, as a pure state machine over checks.
 * `tick({nowMs, heartbeatMtimeMs})` returns null to keep running, or the
 * reason to exit: 'max-lifetime' or 'heartbeat-stale'.
 *
 * The heartbeat's age is measured from the later of its mtime and the start of
 * the current grace window. The window opens at start and reopens after every
 * sleep gap, so a machine waking from sleep gives the runner a full
 * `staleMs` to refresh before anything closes.
 */
export function createLifetimeWatch({
  startedAtMs,
  staleMs = BROKER_STALE_MS,
  sleepGapMs = BROKER_SLEEP_GAP_MS,
  maxLifetimeMs = BROKER_MAX_LIFETIME_MS
}) {
  let lastTickMs = startedAtMs;
  let graceFromMs = startedAtMs;
  let staleStreak = 0;
  return {
    tick({ nowMs, heartbeatMtimeMs }) {
      if (nowMs - startedAtMs >= maxLifetimeMs) return 'max-lifetime';
      const gap = nowMs - lastTickMs;
      lastTickMs = nowMs;
      if (gap < 0 || gap > sleepGapMs) {
        graceFromMs = nowMs;
        staleStreak = 0;
        return null;
      }
      const effective = Math.max(heartbeatMtimeMs ?? -Infinity, graceFromMs);
      staleStreak = isHeartbeatStale(effective, nowMs, staleMs, gap, { sleepGapMs }) ? staleStreak + 1 : 0;
      return staleStreak >= 2 ? 'heartbeat-stale' : null;
    }
  };
}

function heartbeatMtime(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return null; }
}

function assertBase(base) {
  let u;
  try { u = new URL(base); } catch { throw new Error('invalid Harbour base URL'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) return u.origin;
  throw new Error('the Harbour base must be https (http only for loopback)');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function writePidFile(file, record) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Start a broker for one item. The socket is bound before the bootstrap is
 * exchanged, so a transport failure (a live broker already on the path, a path
 * too long) never spends the single-use bootstrap; a failed exchange then
 * closes the socket again, leaving no socket and no pid file. Requests that
 * arrive mid-exchange get 503.
 *
 * @param {Object} opts
 * @param {string} opts.base - Harbour base URL
 * @param {string} opts.urlKey
 * @param {string} opts.itemId
 * @param {string} opts.bootstrap - the item's single-use bootstrap
 * @param {string} [opts.home] - kit home (default ~/.harbour-runner)
 * @param {(line: string) => void} [opts.log]
 * @param {() => number} [opts.now] - clock, for tests
 * @param {boolean} [opts.autoTick=true] - run the lifetime check on a timer
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function startBroker({
  base, urlKey, itemId, bootstrap,
  home = defaultHome(),
  log = () => {},
  now = Date.now,
  autoTick = true,
  checkIntervalMs = BROKER_CHECK_MS,
  staleMs = BROKER_STALE_MS,
  sleepGapMs = BROKER_SLEEP_GAP_MS,
  maxLifetimeMs = BROKER_MAX_LIFETIME_MS,
  fetchImpl = fetch
}) {
  const paths = kitPaths({ home, urlKey, itemId });
  const origin = assertBase(base);
  const secret = typeof bootstrap === 'string' ? bootstrap.trim() : '';
  if (!secret) throw new Error('no bootstrap on stdin');

  const creds = credentialStore();

  const server = http.createServer(async (req, res) => {
    const method = String(req.method).toUpperCase();
    const pathname = String(req.url).split('?')[0];
    const reply = (status, body, headers = { 'Content-Type': 'text/plain' }) => {
      res.writeHead(status, headers);
      res.end(body);
      log(`${new Date(now()).toISOString()} ${method} ${pathname} ${status}`);
    };
    // The body is read before any reply, refusals included: a response sent
    // before the request is consumed makes Node drop the keep-alive
    // connection, and the client's next request fails with EPIPE.
    const body = await readBody(req).catch(() => Buffer.alloc(0));
    const refused = refusal({ method, url: req.url, headers: req.headers });
    if (refused) return reply(refused.status, refused.body);
    const token = creds.get();
    if (!token) return reply(503, 'This broker has no credential (starting up or shutting down).\n');
    const headers = { Authorization: `Bearer ${token}` };
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    if (req.headers.accept) headers.Accept = req.headers.accept;
    const target = new URL(req.url, origin);
    let up;
    try {
      up = await fetchImpl(`${origin}${target.pathname}${target.search}`, {
        method,
        headers,
        redirect: 'manual',
        ...(!READ_METHODS.has(method) && body.length ? { body } : {})
      });
    } catch {
      return reply(502, 'The broker could not reach Harbour.\n');
    }
    let upBody;
    try { upBody = Buffer.from(await up.arrayBuffer()); } catch { upBody = Buffer.alloc(0); }
    const out = {};
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = up.headers.get(name);
      if (value) out[name] = value;
    }
    reply(up.status, upBody, out);
  });

  const transport = await brokerTransport({ server, socketDir: paths.socketDir, socketPath: paths.socket });
  try {
    creds.set((await exchangeBootstrap({ base: origin, bootstrap: secret, fetchImpl })).token);
  } catch (err) {
    await transport.close();
    throw err;
  }
  ensurePrivateDir(paths.brokersDir);
  const startedAtMs = now();
  writePidFile(paths.pidFile, {
    pid: process.pid,
    socket: paths.socket,
    itemId,
    urlKey,
    startedAt: new Date(startedAtMs).toISOString()
  });
  log(`${new Date(startedAtMs).toISOString()} broker for ${itemId} listening`);

  const watch = createLifetimeWatch({ startedAtMs, staleMs, sleepGapMs, maxLifetimeMs });
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  let stopping = null;
  let timer = null;

  const broker = {
    socketPath: paths.socket,
    pidFile: paths.pidFile,
    closed,
    stopped: false,
    /** Close the socket, drop the token, remove the pid file. Idempotent. */
    stop(reason) {
      if (stopping) return stopping;
      broker.stopped = true;
      if (timer) clearInterval(timer);
      creds.clear();
      log(`${new Date(now()).toISOString()} broker for ${itemId} stopping: ${reason}`);
      stopping = transport.close()
        .finally(() => { fs.rmSync(paths.pidFile, { force: true }); resolveClosed(reason); });
      return stopping;
    },
    /** One lifetime check; exits the broker if it's time. */
    async tick() {
      if (broker.stopped) return null;
      const reason = watch.tick({ nowMs: now(), heartbeatMtimeMs: heartbeatMtime(paths.heartbeat) });
      if (reason) await broker.stop(reason);
      return reason;
    }
  };
  if (autoTick) {
    timer = setInterval(() => { broker.tick(); }, checkIntervalMs);
    timer.unref();
  }
  return broker;
}

// Does `pid` still look like the broker for this item? Checked before any
// signal, so a pid the OS has reused for something else is never signalled.
function pidOwnsBroker(pid, itemId, socketPath) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch { return false; }
  if (!fs.existsSync(socketPath)) return false;
  let command;
  try {
    command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  } catch {
    return false;
  }
  return /broker\.mjs\s+serve\b/.test(command) && command.includes(itemId);
}

function waitForExit(pid, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      try { process.kill(pid, 0); } catch { return resolve(true); }
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(poll, 25);
    };
    poll();
  });
}

/**
 * Stop an item's broker using its pid file: check the pid still owns the
 * socket, SIGTERM it, wait for it to exit, then remove the pid file and the
 * socket (the broker removes both itself; this covers a crashed one).
 *
 * @returns {Promise<{found: boolean, signalled: boolean, exited: boolean}>}
 */
export async function stopBroker({ home = defaultHome(), urlKey, itemId, timeoutMs = 5000 }) {
  const paths = kitPaths({ home, urlKey, itemId });
  let record;
  try {
    record = JSON.parse(fs.readFileSync(paths.pidFile, 'utf8'));
  } catch {
    return { found: false, signalled: false, exited: false };
  }
  const socketPath = typeof record.socket === 'string' ? record.socket : paths.socket;
  let signalled = false;
  let exited = false;
  if (record.itemId === itemId && pidOwnsBroker(record.pid, itemId, socketPath)) {
    process.kill(record.pid, 'SIGTERM');
    signalled = true;
    exited = await waitForExit(record.pid, timeoutMs);
  }
  fs.rmSync(paths.pidFile, { force: true });
  if (socketPath === paths.socket && (!signalled || exited)) fs.rmSync(paths.socket, { force: true });
  return { found: true, signalled, exited };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!key || !key.startsWith('--') || rest[i + 1] === undefined) throw new Error(`bad argument: ${key}`);
    opts[key.slice(2)] = rest[i + 1];
  }
  return { command, opts };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return reject(new Error('pipe the bootstrap on stdin; never pass it as an argument'));
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

async function main(argv) {
  const { command, opts } = parseArgs(argv);
  const home = opts.home || defaultHome();
  if (command === 'stop') {
    const result = await stopBroker({ home, urlKey: opts['url-key'], itemId: opts.item });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command !== 'serve') throw new Error('usage: broker.mjs serve|stop --url-key <k> --item <id> [--base <url>] [--home <dir>]');

  const paths = kitPaths({ home, urlKey: opts['url-key'], itemId: opts.item });
  ensurePrivateDir(paths.brokersDir);
  const logFd = fs.openSync(paths.logFile, 'a', 0o600);
  const log = (line) => { try { fs.writeSync(logFd, `${line}\n`); } catch { /* logging never kills the broker */ } };

  const broker = await startBroker({ base: opts.base, urlKey: opts['url-key'], itemId: opts.item, home, bootstrap: await readStdin(), log });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.once(signal, () => { broker.stop(signal.toLowerCase()); });
  }
  broker.closed.then(() => process.exit(0));
  process.stdout.write(`${JSON.stringify({ ready: true, pid: process.pid, socket: broker.socketPath, pidFile: broker.pidFile })}\n`);
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`broker: ${err.message}\n`);
    process.exit(1);
  });
}
