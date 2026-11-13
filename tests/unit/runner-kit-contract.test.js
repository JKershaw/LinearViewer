/**
 * LIN-3451 — the runner kit against the cross-repo contract table
 * (`lib/runner-kit/contract.json`).
 *
 * Simple Dispatcher (SD) is the reference for what a halt, a target, a repo and
 * the 2000-character cap mean; the kit (`lib/runner-kit/runner.mjs`) re-implements
 * them. Each row of the table says what SD does (`sd`) and what the kit does
 * (`kit`); a row where they differ must carry a `difference` saying why. This
 * test drives the kit's own deciders over every row and pins `kit`. The SD repo
 * copies the table byte for byte and pins `sd` the same way
 * (test/runner-contract.test.js there).
 *
 * The table is a test fixture: the kit never loads it at runtime.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  haltAction,
  haltSweep,
  preConfirmDecision,
  resolveFollowUp,
  transcriptRequestRecords,
  TRANSCRIPT_TOKEN_FIELDS,
  resolveRepo,
  capFeedbackMessage,
  runCommand,
  dispatchEvidence,
  transcriptFinished,
  SESSION_TARGETS
} from '../../lib/runner-kit/runner.mjs';
import { prUrlOfFeedback } from '../../lib/dispatch-wake.js';
import http from 'node:http';
import { credentialStore, exchangeBootstrap, startBroker, BROKER_HOST } from '../../lib/runner-kit/broker.mjs';
import { SESSION_TARGETS as HARBOUR_SESSION_TARGETS } from '../../lib/dispatch-targets.js';
import { HALT_MODES } from '../../lib/workspace-halt.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACT_PATH = path.join(ROOT, 'lib', 'runner-kit', 'contract.json');
const TABLE = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));

// LIN-4384: the sha256 of contract.json's own bytes. simple-dispatcher pins the same value
// (FIXTURE_SHA256 beside LV_COMMIT in test/runner-contract.test.js), so an edit here that is not
// re-copied there would go unnoticed on this side without this tripwire.
const CONTRACT_SHA256 = '871ca615f627a02611957489f3abc83498f1dca64af07259800a174148ba23a2';

const OWNER = 'acct-owner-1111';
const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const LIVE = '11111111-1111-4111-8111-111111111111';
const GONE = '99999999-9999-4999-8999-999999999999';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';
const ROOT_DIR = '/work/root';

// The take-driven tests and the halt-text rows keep this running ledger (setup() writes it too).
const ledger = { items: { [LIVE]: { itemId: LIVE, agentId: 'agent-live', rootItemId: LIVE, state: 'running' } } };

// LIN-4475: the contract's session vocabulary, and the kit ledger state each value stands for
// (`none` has no row). The retired `live` is not a key, so a row that still says it throws.
const SESSION_LEDGER_STATE = { running: 'running', finished: 'done', stopped: 'stopped', none: null };

/** The ledger a follow-up row is judged against: the row's own session, and nothing else. */
function sessionLedger(session) {
  if (!Object.prototype.hasOwnProperty.call(SESSION_LEDGER_STATE, session)) {
    throw new Error(`unknown session value "${session}" in contract.json: the vocabulary is running | finished | stopped | none`);
  }
  const state = SESSION_LEDGER_STATE[session];
  if (!state) return { items: {} };
  return { items: { [LIVE]: { itemId: LIVE, agentId: `agent-${session}`, rootItemId: LIVE, state } } };
}

function itemFor(d) {
  const it = {
    id: ITEM_ID, prompt: 'do the step', kind: 'custom', dispatchedBy: OWNER, harness: null,
    followUpTo: null, abort: false, abortTo: null, sessionId: null
  };
  if (d.target !== undefined) it.target = d.target;
  if (d.repo !== undefined) it.repo = d.repo;
  if (d.route === 'abort') Object.assign(it, { abort: true, abortTo: LIVE, prompt: null });
  if (d.route === 'follow-up') {
    sessionLedger(d.session); // throws on `live` and on any value outside the vocabulary
    it.followUpTo = d.session === 'none' ? GONE : LIVE;
  }
  return it;
}

const ctxFor = (halt, useLedger = ledger) => ({
  ownerAccountId: OWNER, halt, ledger: useLedger, wakeRoot: null, otherConsumerLastSeenAt: null, now: NOW,
  tokenExpiresAt: new Date(NOW + 20 * 3600_000).toISOString()
});

// What the kit does with a polled item, in the contract's vocabulary: `left`
// stays queued; `failed` is taken and closed with [failed]; `claimed` is run.
function kitOutcome(row) {
  const it = itemFor(row.item);
  // LIN-4475: a follow-up is judged against its own session's ledger; every other row keeps the running ledger.
  const useLedger = row.item.route === 'follow-up' ? sessionLedger(row.item.session) : ledger;
  const pre = preConfirmDecision(it, ctxFor(row.halt, useLedger));
  if (pre.decision !== 'take') return 'left';
  // A follow-up the kit cannot continue is closed with [failed] (resolveFollowUp's reject), not claimed.
  if (row.item.route === 'follow-up') return resolveFollowUp(it, useLedger).action === 'reject' ? 'failed' : 'claimed';
  return 'claimed';
}

// LIN-3699: what the kit's `wait` makes of an auth reply, in the contract's vocabulary: the
// reason it returns is its own (`credential` = the 401, `error` = any other non-200). Driven
// through a real login-shaped state dir and an injected fetch, so no socket is opened.
async function kitAuthOutcome(row) {
  const home = fs.mkdtempSync(path.join(fs.existsSync('/tmp') ? '/tmp' : os.tmpdir(), 'rkc-auth-'));
  try {
    const dir = path.join(home, 'acme');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    credentialStore({ file: path.join(dir, 'runner.token') }).set('runner-working-token');
    fs.writeFileSync(path.join(dir, 'runner.json'), JSON.stringify({
      baseUrl: 'http://127.0.0.1:1', urlKey: 'acme', ownerAccountId: OWNER,
      expiresAt: new Date(Date.now() + 20 * 3600_000).toISOString()
    }));
    const { status, code, retryable } = row.item;
    const fetchImpl = async () => new Response(JSON.stringify({ error: 'x', code, retryable }), { status });
    const out = await runCommand(['wait', '--url-key', 'acme'], {
      home, now: () => Date.now(), fetchImpl, waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 60
    });
    return out.reason;
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

// LIN-3805: what the kit does with a 503 DISPATCH_STORE_UNAVAILABLE on each lane surface, in the
// contract's vocabulary: `error` (wait's reason), `retry` (the thrown message tells the caller
// to retry, never "already taken, or gone"), `unreadable` (the settled-evidence read defers).
async function kitStoreOutcome(row) {
  const { surface, status, code, retryable } = row.item;
  if (surface === 'poll') return kitAuthOutcome(row);
  if (surface === 'status') return dispatchEvidence({ status, json: { error: 'x', code, retryable } });
  const fresh = { ...itemFor({ route: 'fresh' }), repo: 'no-such-repo-dir' };
  const s = setup(fresh);
  try {
    const reply503 = () => ({ status, ok: false, json: async () => ({ error: 'x', code, retryable }) });
    const fetchImpl = async (url, init) => {
      if (surface === 'take' || url.includes('/runner/feedback/')) return reply503();
      return s.fetchImpl(url, init);
    };
    let message = null;
    await runCommand(['take', fresh.id, '--url-key', 'acme'], { home: s.home, cwd: ROOT, fetchImpl, now: () => Date.now() })
      .catch((err) => { message = err.message; });
    if (message === null) return 'no error';
    return /retry/.test(message) && !/already taken, or gone/.test(message) ? 'retry' : `unexpected: ${message}`;
  } finally { s.cleanup(); }
}

const isDir = (repo) => (dir) => repo === 'found' && dir === path.join(ROOT_DIR, 'found');

// LIN-4384: the `report` and `sentinel` rows read one assistant message, `item.message`. A
// transcript holds it as one assistant JSONL line, which is how the kit reads it here and how
// simple-dispatcher's `sessionPrs` reads it there. The `sd` cells were filled by running SD's
// readers at simple-dispatcher cb79e00. Here they are data: simple-dispatcher's own contract test
// asserts them (LIN-4385), as it does `sd` on every other area.
const assistantLine = (message) => JSON.stringify({
  type: 'assistant', isSidechain: false,
  message: { role: 'assistant', content: [{ type: 'text', text: message }] }
});

// Is the turn over, in the contract's vocabulary: the kit's watchdog reading of the transcript.
const kitSentinelOutcome = (row) => (transcriptFinished([assistantLine(row.item.message)]) ? 'finished' : 'not finished');

// LIN-4378: the brokers' 429 policy, in the contract's vocabulary. `item.replies` scripts Harbour's
// answers to the bootstrap exchange (the last one repeats); the outcome is how the exchange ended,
// how many times it asked, and how long it waited between asks. simple-dispatcher drives its own
// broker (`makeTokenProvider`) over the same rows.
const TOKEN_MINT = '/api/proxy/token';
function exchangeReply(r) {
  if (r.error) throw Object.assign(new Error('connect failed'), { code: r.error });
  const headers = r.retryAfter === undefined ? {} : { 'retry-after': r.retryAfter };
  const body = r.status === 200 ? JSON.stringify({ token: 'contract-working-token', expiresAt: null }) : '{}';
  return new Response(body, { status: r.status, headers });
}
function scriptedExchange(replies) {
  const w = { fetches: 0, sleeps: [] };
  w.fetchImpl = async () => exchangeReply(replies[Math.min(w.fetches++, replies.length - 1)]);
  w.sleep = async (ms) => { w.sleeps.push(ms); };
  return w;
}
const waitsText = (sleeps) => (sleeps.length ? sleeps.map((ms) => `${ms / 1000}s`).join(', ') : 'none');
const refusalText = (message) => {
  const m = /HTTP (\d+)/.exec(message);
  return m ? `refused HTTP ${m[1]}` : 'refused: no connection';
};

async function kitExchangeOutcome(row) {
  const w = scriptedExchange(row.item.replies);
  let result;
  try {
    await exchangeBootstrap({ base: 'http://127.0.0.1:1', bootstrap: 'contract-bootstrap', fetchImpl: w.fetchImpl, sleep: w.sleep });
    result = 'token';
  } catch (err) { result = refusalText(err.message); }
  return `${result}; fetches ${w.fetches}; waits ${waitsText(w.sleeps)}`;
}

// What reaches the agent through the kit's broker: `item.exchange` scripts the bootstrap exchange,
// `item.upstream` Harbour's answer to the forwarded request. Driven through the real `startBroker`
// and its socket; only fetch and sleep are injected.
function socketGet(socketPath, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, method: 'GET', path: reqPath, headers: { Host: BROKER_HOST } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
const forwardedText = (status, headers, names, calls) =>
  `${status}; ${names.filter((n) => headers[n] !== undefined).map((n) => `${n} ${headers[n]}`).join(', ')}; upstream calls ${calls}`;

async function kitForwardOutcome(row) {
  const { exchange, upstream } = row.item;
  const home = fs.mkdtempSync(path.join(fs.existsSync('/tmp') ? '/tmp' : os.tmpdir(), 'rkc-fw-'));
  const ex = scriptedExchange(exchange);
  let calls = 0;
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith(TOKEN_MINT)) return ex.fetchImpl(url, init);
    calls += 1;
    return new Response('{}', { status: upstream.status, headers: upstream.headers });
  };
  let broker;
  try {
    try {
      broker = await startBroker({
        base: 'http://127.0.0.1:1', urlKey: 'acme', itemId: ITEM_ID, home, bootstrap: 'contract-bootstrap',
        autoTick: false, fetchImpl, sleep: ex.sleep
      });
    } catch (err) {
      const wait = /Retry-After: ([^)]+)\)/.exec(err.message);
      return `start fails naming ${refusalText(err.message).replace('refused ', '')}${wait ? ` and Retry-After: ${wait[1]}` : ''}`;
    }
    if (!upstream) return 'started';
    const r = await socketGet(broker.socketPath, '/api/proxy/agent/status');
    return forwardedText(r.status, r.headers, Object.keys(upstream.headers), calls);
  } finally {
    await broker?.stop('contract-done');
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// Which PR did the run open, as Harbour reads it: the message as one feedback entry, read by the
// wake's PR pick (`prUrlOfFeedback`, whose report lines are `reportLinesOf`'s).
function harbourFor(row) {
  switch (row.area) {
    case 'report':
      return prUrlOfFeedback([{ message: row.item.message }]);
    default:
      throw new Error(`unknown harbour area ${row.area}`);
  }
}

function kitFor(row) {
  switch (row.area) {
    case 'halt':
      return kitOutcome(row);
    case 'halt-text': {
      const sweep = haltSweep(row.halt, ledger);
      return sweep.posts[0].message.replace(LIVE.slice(0, 8), '<id8>');
    }
    case 'target':
      return kitOutcome(row);
    case 'repo': {
      // Only a fresh item is repo-checked; the follow-up and abort rows are driven through `take` below.
      if (row.item.route !== 'fresh') return 'not-checked';
      const r = resolveRepo(itemFor(row.item), ROOT_DIR, { isDir: isDir(row.item.repo) });
      return r && r.failed ? 'failed' : 'claimed';
    }
    case 'cap': {
      const message = 'x'.repeat(row.item.length);
      try {
        const capped = capFeedbackMessage(message, row.item.kind);
        return capped.length === 2000 && capped.endsWith('...') ? 'truncated' : 'unexpected';
      } catch {
        return 'error';
      }
    }
    case 'auth':
      return kitAuthOutcome(row);
    case 'store':
      return kitStoreOutcome(row);
    case 'heartbeat':
      return 'not sent (the runner-kit producer, POST /api/proxy/runner/heartbeat, is a follow-up)';
    case 'sentinel':
      return kitSentinelOutcome(row);
    case 'exchange':
      return kitExchangeOutcome(row);
    case 'forward':
      return kitForwardOutcome(row);
    case 'fold':
      return kitFoldOutcome(row);
    default:
      throw new Error(`unknown area ${row.area}`);
  }
}

// LIN-4475 (W8): the transcript fold, as one deterministic text per side. The records come in first-seen
// order and each renders as [requestId, model, at, the five token fields]; an absent value renders null,
// and "" stays "". Harness, agent, effort and the skipped counts are not rendered (the area note says so).
const FOLD_FIELDS = ['requestId', 'model', 'at', ...TRANSCRIPT_TOKEN_FIELDS];
const renderFold = (records) => JSON.stringify(records.map((r) => FOLD_FIELDS.map((f) => (r[f] === undefined ? null : r[f]))));

// A corpus row names `<case>/<phase>` and the file's sha256. The file is read from the one existing
// copy (tests/fixtures/runner-kit/transcript-corpus, no second set), and its bytes are checked before
// they fold. The check is the pin: a changed byte fails here, not silently.
const CORPUS_DIR = path.join(ROOT, 'tests', 'fixtures', 'runner-kit', 'transcript-corpus');
function corpusLines(id, sha256, dir = CORPUS_DIR) {
  const bytes = fs.readFileSync(path.join(dir, `${id.replace('/', '--')}.jsonl`));
  const got = crypto.createHash('sha256').update(bytes).digest('hex');
  if (got !== sha256) throw new Error(`${id}: the corpus file's sha256 is ${got}, the row pins ${sha256}`);
  return bytes.toString('utf8').split('\n');
}
function kitFoldOutcome(row) {
  const lines = row.item.lines ? row.item.lines.map((o) => JSON.stringify(o)) : corpusLines(row.item.id, row.item.sha256);
  return renderFold(transcriptRequestRecords(lines, { agent: 'a1b2c3d4' }).records);
}

// LIN-4384: what each area's rows carry besides `area`, `case`, `item` and `sd`. `inputs` are
// the further keys a reader is driven with; `columns` are the readers pinned against `sd`. The
// runner areas compare SD with the kit under a halt. `report` (which PR did the run open?) is
// read by Harbour, and the kit picks no PR. `sentinel` (is the turn over?) is read by the kit.
// Both read one assistant message, `item: {message}`, so a halt has no part in them.
const RUNNER_AREA = { inputs: ['halt'], columns: ['kit'] };
const AREA_SHAPES = {
  halt: RUNNER_AREA,
  'halt-text': RUNNER_AREA,
  target: RUNNER_AREA,
  repo: RUNNER_AREA,
  cap: RUNNER_AREA,
  auth: RUNNER_AREA,
  store: RUNNER_AREA,
  heartbeat: RUNNER_AREA,
  report: { inputs: [], columns: ['harbour'] },
  sentinel: { inputs: [], columns: ['kit'] },
  // LIN-4378: the brokers' 429 policy. The rows are its one owner: the kit's broker.mjs and
  // simple-dispatcher's harbour-token-mcp-server.js each keep their own constants (the kit loads
  // no fixture at runtime) and are pinned against these rows.
  exchange: { inputs: [], columns: ['kit'] },
  forward: { inputs: [], columns: ['kit'] },
  // LIN-4475 (W8): the transcript fold. Inputs none; the kit's rendered records are the one column.
  fold: { inputs: [], columns: ['kit'] }
};
const COLUMNS = ['kit', 'harbour'];

/**
 * The problems with one contract row's shape; an empty list means the row is well formed.
 * Each row needs `sd` and at least one of `kit`/`harbour`; its area names the columns it
 * carries, and any column that differs from `sd` needs a `difference` saying why.
 *
 * @param {object} row
 * @returns {string[]}
 */
function checkRowShape(row) {
  const name = `${row?.area}: ${row?.case}`;
  const problems = [];
  for (const k of ['area', 'case', 'item', 'sd']) if (!(k in row)) problems.push(`${name}: missing ${k}`);
  if (!COLUMNS.some((c) => c in row)) problems.push(`${name}: has sd but neither kit nor harbour`);
  for (const c of COLUMNS) {
    if (c in row && row[c] !== row.sd && !row.difference) problems.push(`${name}: ${c} differs from sd with no difference`);
  }
  const shape = AREA_SHAPES[row.area];
  if (!shape) return [...problems, `${name}: unknown area ${row.area}`];
  for (const k of [...shape.inputs, ...shape.columns]) if (!(k in row)) problems.push(`${name}: missing ${k}`);
  const allowed = new Set(['area', 'case', 'item', 'sd', 'difference', ...shape.inputs, ...shape.columns]);
  for (const k of Object.keys(row)) if (!allowed.has(k)) problems.push(`${name}: ${k} is not a key of area ${row.area}`);
  return problems;
}

describe('contract table shape', () => {
  test('contract.json matches its pinned sha256 (the copy in simple-dispatcher must follow it)', () => {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(CONTRACT_PATH)).digest('hex');
    assert.equal(sha, CONTRACT_SHA256,
      'lib/runner-kit/contract.json changed: re-copy into simple-dispatcher `test/fixtures/runner-contract.json` and re-pin `LV_COMMIT`/`FIXTURE_SHA256` there, then update CONTRACT_SHA256 here');
  });

  test('is versioned and every row has the declared fields', () => {
    assert.equal(TABLE.version, 1);
    for (const r of TABLE.rows) assert.deepEqual(checkRowShape(r), [], `${r.area}: ${r.case}`);
  });

  test('every row where a column differs from SD says why', () => {
    for (const r of TABLE.rows) {
      assert.deepEqual(checkRowShape(r).filter((p) => /no difference/.test(p)), [], `${r.area}: ${r.case}`);
    }
  });

  test('the table records the deliberate differences it was written to carry', () => {
    const diffs = TABLE.rows.filter((r) => 'kit' in r && r.kit !== r.sd).map((r) => r.case);
    assert.ok(diffs.some((c) => /abort row under an unknown halt mode/.test(c)));
    assert.ok(diffs.some((c) => /line posted/.test(c)));
    assert.ok(diffs.some((c) => /decision message/.test(c)));
    // LIN-4384: SD's hook reads a DONE: inside a DECISION block as the turn's end; the kit does not.
    assert.ok(TABLE.rows.some((r) => r.area === 'sentinel' && /only inside a DECISION block/.test(r.case) && r.kit !== r.sd));
    // LIN-4378: a final exchange 429 reaches whoever asked for the exchange: the runner at the kit's
    // `start`, the agent's first request in SD.
    assert.ok(TABLE.rows.some((r) => r.area === 'forward' && /refused 429/.test(r.case) && r.kit !== r.sd));
    // LIN-4475: an http-scheme DONE: line is read by SD as https and by Harbour not at all.
    assert.ok(TABLE.rows.some((r) => r.area === 'report' && /http URL and a #x fragment/.test(r.case) && r.harbour !== r.sd));
    // LIN-4475 (W8): the two fold corners are the declared differences: a first line whose model or timestamp is "".
    assert.ok(TABLE.rows.some((r) => r.area === 'fold' && /first line with model ""/.test(r.case) && r.kit !== r.sd));
    assert.ok(TABLE.rows.some((r) => r.area === 'fold' && /first line with timestamp ""/.test(r.case) && r.kit !== r.sd));
  });

  // LIN-4384: the cases both repos must read the same way, each in both areas.
  // LIN-4475 replaces the exact count with a check by name: the seven stay, each with harbour === sd
  // and a sentinel twin on the same message. New report rows may differ from sd only with a difference
  // (checkRowShape), so the count is no longer the census.
  test('report keeps the seven LIN-4384 cases by name: each has harbour === sd and a sentinel twin', () => {
    const SEVEN = [
      'one DONE: line naming one PR',
      'two PRs on one DONE: line: the first PR named on it',
      'an indented DONE: line still counts',
      'two DONE: lines: the PR on the newest line',
      'a DONE: inside a DECISION block, then a real DONE: line: the real (newest) line\'s PR',
      'a DONE: only inside a DECISION block: its PR, not one mentioned before it',
      'the session\'s own PR on its DONE: line beats a PR it mentioned more often (LIN-4375)'
    ];
    const report = TABLE.rows.filter((r) => r.area === 'report');
    const sentinel = TABLE.rows.filter((r) => r.area === 'sentinel');
    for (const name of SEVEN) {
      const row = report.find((r) => r.case === name);
      assert.ok(row, `no report row named "${name}"`);
      assert.equal(row.harbour, row.sd, `${name}: the PR readers agree`);
      assert.ok(sentinel.some((s) => s.item.message === row.item.message), `${name}: no sentinel twin on the same message`);
    }
  });

  // LIN-3650: adding a mode to HALT_MODES fails here until the table says what each side does with it.
  test('every HALT_MODES value has halt rows for abort, fresh and follow-up', () => {
    for (const mode of HALT_MODES) {
      for (const route of ['abort', 'fresh', 'follow-up']) {
        assert.ok(
          TABLE.rows.some((r) => r.area === 'halt' && r.halt?.mode === mode && r.item?.route === route),
          `contract.json has no halt row for mode '${mode}' on the ${route} route`
        );
      }
    }
  });
});

// LIN-4384: the shape check loosened from "sd and kit on every row" to "sd plus kit and/or
// harbour", so it is fed bad rows (each must be rejected, for its own reason) and good rows of
// each new area (each must be accepted).
describe('checkRowShape rejects a half-specified row and accepts each area\'s shape', () => {
  const PR = 'https://github.com/JKershaw/LinearViewer/pull/101';
  const reportRow = (extra) => ({ area: 'report', case: 'c', item: { message: `DONE: opened ${PR}` }, sd: PR, ...extra });
  const sentinelRow = (extra) => ({ area: 'sentinel', case: 'c', item: { message: `DONE: opened ${PR}` }, sd: 'finished', ...extra });
  const rejects = (row, reason) => {
    const problems = checkRowShape(row);
    assert.ok(problems.some((p) => reason.test(p)), `expected ${reason} in ${JSON.stringify(problems)}`);
  };

  test('a row with sd only is rejected: it pins no reader against sd', () => {
    rejects(reportRow(), /has sd but neither kit nor harbour/);
    rejects(sentinelRow(), /has sd but neither kit nor harbour/);
    rejects({ area: 'halt', case: 'c', halt: null, item: { route: 'fresh' }, sd: 'claimed' }, /has sd but neither kit nor harbour/);
  });

  test('a column that differs from sd with no difference is rejected', () => {
    rejects(reportRow({ harbour: `${PR}0` }), /harbour differs from sd with no difference/);
    rejects(sentinelRow({ kit: 'not finished' }), /kit differs from sd with no difference/);
    rejects({ area: 'halt', case: 'c', halt: null, item: { route: 'fresh' }, sd: 'claimed', kit: 'left' }, /kit differs from sd with no difference/);
  });

  test('an unknown area is rejected', () => {
    rejects({ area: 'no-such-area', case: 'c', item: {}, sd: 'x', kit: 'x' }, /unknown area no-such-area/);
  });

  test('a column, or a halt, that the area does not declare is rejected', () => {
    rejects(reportRow({ harbour: PR, kit: PR }), /kit is not a key of area report/);
    rejects(sentinelRow({ kit: 'finished', harbour: 'finished' }), /harbour is not a key of area sentinel/);
    rejects(reportRow({ harbour: PR, halt: null }), /halt is not a key of area report/);
    rejects({ area: 'halt', case: 'c', item: { route: 'fresh' }, sd: 'claimed', kit: 'claimed' }, /missing halt/);
  });

  test('good rows of each new area are accepted, with and without a difference', () => {
    assert.deepEqual(checkRowShape(reportRow({ harbour: PR })), []);
    assert.deepEqual(checkRowShape(sentinelRow({ kit: 'finished' })), []);
    assert.deepEqual(checkRowShape(sentinelRow({ kit: 'not finished', difference: 'the kit reads only the last line' })), []);
    assert.deepEqual(checkRowShape(reportRow({ harbour: `${PR}0`, difference: 'each side picks its own' })), []);
  });
});

// Every row of a runner area carries `kit` (checkRowShape), so only `report` rows skip this loop.
describe('the kit follows the contract table', () => {
  for (const row of TABLE.rows.filter((r) => 'kit' in r)) {
    test(`${row.area}: ${row.case}`, async () => {
      assert.equal(await kitFor(row), row.kit);
    });
  }
});

describe('Harbour follows the contract table (LIN-4384)', () => {
  for (const row of TABLE.rows.filter((r) => 'harbour' in r)) {
    test(`${row.area}: ${row.case}`, () => {
      assert.equal(harbourFor(row), row.harbour);
    });
  }
});

// LIN-4475 witnesses, written before the change. W-1: each session value has an unhalted follow-up
// row on the halt lifecycle (the `repo` row is a repo-gate fixture, not a lifecycle outcome, so it
// does not count). W-2: the driver refuses the retired `live` and any value outside the vocabulary.
// W-3: the two new report rows (http scheme; a DONE: line after U+2028) are present.
describe('LIN-4475 witnesses (session vocabulary and report rows)', () => {
  const reportRowLike = (re) => TABLE.rows.find((r) => r.area === 'report' && re.test(r.case));

  // The census runs over the driver's own vocabulary (SESSION_LEDGER_STATE), so a value the table
  // never names cannot pass by being absent from the rows. The second test is the reverse: a value a
  // follow-up row names must be in the vocabulary.
  test('W-1: every session value has an unhalted follow-up row on the halt lifecycle', () => {
    for (const session of Object.keys(SESSION_LEDGER_STATE)) {
      assert.ok(
        TABLE.rows.some((r) => r.area === 'halt' && r.item?.route === 'follow-up' && r.item.session === session && r.halt === null),
        `no unhalted halt follow-up row for session "${session}"`
      );
    }
  });

  test('W-1: every session a follow-up row names is in the vocabulary', () => {
    for (const r of TABLE.rows.filter((x) => x.item?.route === 'follow-up')) {
      assert.ok(Object.hasOwn(SESSION_LEDGER_STATE, r.item.session), `${r.area}: ${r.case} names "${r.item.session}"`);
    }
  });

  test('W-2: the driver throws on the retired `live` and on any value outside the vocabulary', () => {
    for (const session of ['live', 'lost', 'bogus']) {
      assert.throws(() => kitFor({ area: 'halt', case: 'w2', halt: null, item: { route: 'follow-up', session } }), /session/, session);
    }
  });

  test('W-3: an http-scheme DONE: line has a row: SD canonical https, Harbour none, with a difference', () => {
    const row = reportRowLike(/http URL and a #x fragment/);
    assert.ok(row, 'no report row for the http-scheme case');
    assert.equal(row.sd, 'https://github.com/JKershaw/LinearViewer/pull/101');
    assert.equal(row.harbour, null);
    assert.ok(typeof row.difference === 'string' && row.difference.length > 0);
  });

  test('W-3: a DONE: line after U+2028 has a row where both readers give the PR', () => {
    const row = reportRowLike(/after U\+2028/);
    assert.ok(row, 'no report row for the U+2028 case');
    assert.equal(row.sd, 'https://github.com/JKershaw/LinearViewer/pull/101');
    assert.equal(row.harbour, row.sd);
  });
});

// LIN-4475 (W-5): the corpus rows pin the bytes they fold. A one-byte change in a temp copy must fail the
// row's sha256 check; the repository's own copy is never written.
describe('LIN-4475 witness W-5: a corpus row pins its bytes', () => {
  test('a one-byte change to a corpus file in a temp copy fails its sha256 check', () => {
    const row = TABLE.rows.find((r) => r.area === 'fold' && r.case === 'corpus mixed-model/final');
    assert.ok(row, 'no corpus row for mixed-model/final');
    const dir = fs.mkdtempSync(path.join(fs.existsSync('/tmp') ? '/tmp' : os.tmpdir(), 'rkc-tamper-'));
    try {
      const original = fs.readFileSync(path.join(CORPUS_DIR, 'mixed-model--final.jsonl'));
      const tampered = Buffer.from(original);
      const at = tampered.findIndex((b) => b >= 0x31 && b <= 0x38); // a digit 1-8: XOR 1 keeps it a digit
      tampered[at] ^= 0x01;
      fs.writeFileSync(path.join(dir, 'mixed-model--final.jsonl'), tampered);
      assert.equal(tampered.length, original.length);
      assert.equal([...tampered].filter((b, i) => b !== original[i]).length, 1, 'exactly one byte differs');
      assert.throws(() => corpusLines(row.item.id, row.item.sha256, dir), /sha256/, 'the tampered copy must not fold');
      // The same call on the untouched file passes, so the throw above is the byte change alone.
      assert.ok(corpusLines(row.item.id, row.item.sha256).length > 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('targets', () => {
  test('the kit\'s target list is Harbour\'s SESSION_TARGETS (copied in: the kit is self-contained)', () => {
    assert.deepEqual([...SESSION_TARGETS], [...HARBOUR_SESSION_TARGETS]);
  });
});

// Harbour stub shared by the `take` and `feedback` rows: records every feedback message posted.
function setup(taken) {
  const home = fs.mkdtempSync(path.join(fs.existsSync('/tmp') ? '/tmp' : os.tmpdir(), 'rkc-'));
  const dir = path.join(home, 'acme');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  credentialStore({ file: path.join(dir, 'runner.token') }).set('runner-working-token');
  fs.writeFileSync(path.join(dir, 'runner.json'), JSON.stringify({
    baseUrl: 'http://127.0.0.1:1', urlKey: 'acme', ownerAccountId: OWNER,
    expiresAt: new Date(Date.now() + 20 * 3600_000).toISOString()
  }));
  fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify(ledger));
  fs.writeFileSync(path.join(dir, 'poll.json'), JSON.stringify({
    [taken.id]: {
      id: taken.id, promptSha256: crypto.createHash('sha256').update(taken.prompt ?? '').digest('hex'),
      followUpTo: taken.followUpTo || null, abort: taken.abort === true, abortTo: taken.abortTo || null, dispatchedBy: OWNER
    }
  }));
  const posts = [];
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.includes('/runner/feedback/')) posts.push(body.message);
    const json = url.includes('/runner/take/') ? { item: taken } : { success: true };
    return { status: 200, ok: true, json: async () => json };
  };
  return { home, posts, fetchImpl, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

// The route rows: `resolveRepo` is pure, so it cannot show WHERE the gate sits.
// Drive `take` with a stubbed Harbour and an item carrying a repo that has no directory.
describe('repo is checked on the fresh route only (take)', () => {
  const run = async (taken, cwd) => {
    const s = setup(taken);
    try {
      const out = await runCommand(['take', taken.id, '--url-key', 'acme'], { home: s.home, cwd, fetchImpl: s.fetchImpl, now: () => Date.now() });
      return { out, posts: s.posts };
    } finally { s.cleanup(); }
  };

  test('an abort carrying an unknown repo is processed, not refused', async () => {
    const taken = { ...itemFor({ route: 'abort' }), repo: 'no-such-repo-dir' };
    const { out, posts } = await run(taken, ROOT);
    assert.ok(out.abort, JSON.stringify(out));
    assert.ok(!posts.some((m) => /Unknown repo/.test(m)));
  });

  // LIN-4475: this take-driven test keeps setup()'s running ledger (its own session is `running`), so the
  // ledger it reads is the one setup() writes; a `finished` row would need a done ledger setup() does not write.
  test('a follow-up carrying an unknown repo is continued (its session is running), not refused', async () => {
    const taken = { ...itemFor({ route: 'follow-up', session: 'running' }), repo: 'no-such-repo-dir' };
    const { out, posts } = await run(taken, ROOT);
    assert.equal(out.handoff?.mode, 'continue', JSON.stringify(out));
    assert.ok(!posts.some((m) => /Unknown repo/.test(m)));
  });

  test('a fresh item carrying an unknown repo is failed with the kit\'s text and never run', async () => {
    const taken = { ...itemFor({ route: 'fresh' }), repo: 'no-such-repo-dir' };
    const { out, posts } = await run(taken, ROOT);
    assert.equal(out.rejected, `[failed] Unknown repo "no-such-repo-dir": no directory with that name under ${ROOT}.`);
    assert.deepEqual(posts, [out.rejected]);
    assert.equal(out.prompt, undefined);
  });

  test('a fresh item whose repo is a directory under the working directory carries repoDir', async () => {
    const taken = { ...itemFor({ route: 'fresh' }), repo: 'lib' };
    const { out } = await run(taken, ROOT);
    assert.equal(out.repoDir, path.join(ROOT, 'lib'));
  });
});

describe('resolveRepo', () => {
  const yes = () => true;
  test('no repo: nothing to resolve', () => assert.equal(resolveRepo({}, ROOT_DIR, { isDir: yes }), null));
  test('a name that is a directory resolves to its absolute path', () => {
    assert.deepEqual(resolveRepo({ repo: 'found' }, ROOT_DIR, { isDir: yes }), { repoDir: path.join(ROOT_DIR, 'found') });
  });
  test('a path that could leave the root is refused whether or not it exists', () => {
    for (const repo of ['../found', 'a/b', '.', '..', '/etc']) {
      const r = resolveRepo({ repo }, ROOT_DIR, { isDir: yes });
      assert.match(r.failed, /^\[failed\] Unknown repo /, repo);
    }
  });
});

describe('capFeedbackMessage', () => {
  test('a message at the cap is unchanged', () => {
    const m = 'y'.repeat(2000);
    assert.equal(capFeedbackMessage(m, 'status'), m);
  });
  test('over the cap: first 1997 characters plus "..." (Simple Dispatcher\'s feedback.js)', () => {
    const m = 'a'.repeat(1997) + 'bcdef';
    assert.equal(capFeedbackMessage(m, 'status'), 'a'.repeat(1997) + '...');
  });
  test('a [done] prefix survives truncation', () => {
    assert.match(capFeedbackMessage('[done] ' + 'z'.repeat(3000), 'status'), /^\[done\] z+\.\.\.$/);
  });
});

// Row 7 on the real post path: the pure helper above cannot show that `post` applies it.
describe('feedback is capped where it is posted (runCommand feedback)', () => {
  const feedback = async (kind, message) => {
    const s = setup({ id: ITEM_ID, prompt: 'x' });
    try {
      const args = ['feedback', ITEM_ID, kind, message, '--url-key', 'acme'];
      let error = null;
      try { await runCommand(args, { home: s.home, cwd: ROOT, fetchImpl: s.fetchImpl, now: () => Date.now() }); } catch (err) { error = err; }
      return { posts: s.posts, error };
    } finally { s.cleanup(); }
  };

  test('a status message over the cap is posted truncated to 2000 characters ending in "..."', async () => {
    const { posts, error } = await feedback('status', 'x'.repeat(2500));
    assert.equal(error, null);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].length, 2000);
    assert.ok(posts[0].endsWith('...'));
  });

  test('a decision message over the cap still errors and posts nothing (a cut ruling is malformed JSON)', async () => {
    const { posts, error } = await feedback('decision', 'x'.repeat(2500));
    assert.match(error.message, /decision exceeds 2000/);
    assert.deepEqual(posts, []);
  });
});

// LIN-3857 (D3): a subagent model/effort the kit drops or inherits is posted to the ITEM (a status
// feedback on the lineage root), not only handed to the runner session in `take`'s note.
describe('take posts what it dropped to the item (LIN-3857)', () => {
  const run = async (taken, fetchWrap) => {
    const s = setup(taken);
    try {
      const fetchImpl = fetchWrap ? fetchWrap(s.fetchImpl) : s.fetchImpl;
      const out = await runCommand(['take', taken.id, '--url-key', 'acme'], { home: s.home, cwd: ROOT, fetchImpl, now: () => Date.now() });
      return { out, posts: s.posts };
    } finally { s.cleanup(); }
  };
  const fresh = (extra) => ({ ...itemFor({ route: 'fresh' }), ...extra });

  test('an unmapped model (fable) and an effort are posted as a status on the item', async () => {
    const { out, posts } = await run(fresh({ model: 'fable', effort: 'high' }));
    assert.equal(out.subagent.model, null);
    const note = posts.filter((m) => m.startsWith('[subagent]'));
    assert.equal(note.length, 1, JSON.stringify(posts));
    assert.match(note[0], /"fable" is not a mapped Task-tool alias/);
    assert.match(note[0], /effort "high" not applied/);
  });

  test('the post carries status kind and the lineage rootItemId', async () => {
    const bodies = [];
    await run(fresh({ effort: 'low' }), (inner) => async (url, init) => {
      if (url.includes('/runner/feedback/')) bodies.push(JSON.parse(init.body));
      return inner(url, init);
    });
    const b = bodies.find((x) => x.message.startsWith('[subagent]'));
    assert.equal(b.kind, 'status');
    assert.equal(b.rootItemId, ITEM_ID);
  });

  test('nothing is dropped, nothing is posted', async () => {
    const { out, posts } = await run(fresh({ model: 'claude-opus-5-5' }));
    assert.equal(out.subagent.model, 'opus');
    assert.deepEqual(posts.filter((m) => m.startsWith('[subagent]')), []);
    assert.equal('noteError' in out, false);
  });

  test('a failing post does not fail the take; it comes back as noteError', async () => {
    const { out } = await run(fresh({ effort: 'high' }), (inner) => async (url, init) => {
      if (url.includes('/runner/feedback/') && JSON.parse(init.body).message.startsWith('[subagent]')) {
        return { status: 503, ok: false, json: async () => ({ error: 'x' }) };
      }
      return inner(url, init);
    });
    assert.ok(out.item && out.subagent, 'the take still returns');
    assert.match(out.noteError, /HTTP 503/);
  });
});
