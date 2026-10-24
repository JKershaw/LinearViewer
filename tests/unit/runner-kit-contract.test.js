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
  resolveRepo,
  capFeedbackMessage,
  runCommand,
  dispatchEvidence,
  SESSION_TARGETS
} from '../../lib/runner-kit/runner.mjs';
import { credentialStore } from '../../lib/runner-kit/broker.mjs';
import { SESSION_TARGETS as HARBOUR_SESSION_TARGETS } from '../../lib/dispatch-targets.js';
import { HALT_MODES } from '../../lib/workspace-halt.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TABLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'runner-kit', 'contract.json'), 'utf8'));

const OWNER = 'acct-owner-1111';
const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const LIVE = '11111111-1111-4111-8111-111111111111';
const GONE = '99999999-9999-4999-8999-999999999999';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';
const ROOT_DIR = '/work/root';

const ledger = { items: { [LIVE]: { itemId: LIVE, agentId: 'agent-live', rootItemId: LIVE, state: 'running' } } };

function itemFor(d) {
  const it = {
    id: ITEM_ID, prompt: 'do the step', kind: 'custom', dispatchedBy: OWNER, harness: null,
    followUpTo: null, abort: false, abortTo: null, sessionId: null
  };
  if (d.target !== undefined) it.target = d.target;
  if (d.repo !== undefined) it.repo = d.repo;
  if (d.route === 'abort') Object.assign(it, { abort: true, abortTo: LIVE, prompt: null });
  if (d.route === 'follow-up') it.followUpTo = d.session === 'live' ? LIVE : GONE;
  return it;
}

const ctxFor = (halt) => ({
  ownerAccountId: OWNER, halt, ledger, wakeRoot: null, otherConsumerLastSeenAt: null, now: NOW,
  tokenExpiresAt: new Date(NOW + 20 * 3600_000).toISOString()
});

// What the kit does with a polled item, in the contract's vocabulary: `left`
// stays queued; `failed` is taken and closed with [failed]; `claimed` is run.
function kitOutcome(row) {
  const it = itemFor(row.item);
  const pre = preConfirmDecision(it, ctxFor(row.halt));
  if (pre.decision !== 'take') return 'left';
  if (row.item.route === 'follow-up' && row.item.session === 'none') return 'failed';
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
    default:
      throw new Error(`unknown area ${row.area}`);
  }
}

describe('contract table shape', () => {
  test('is versioned and every row has the declared fields', () => {
    assert.equal(TABLE.version, 1);
    for (const r of TABLE.rows) {
      for (const k of ['area', 'case', 'halt', 'item', 'sd', 'kit']) assert.ok(k in r, `${r.case}: missing ${k}`);
    }
  });

  test('every row where the kit differs from SD says why', () => {
    for (const r of TABLE.rows) {
      if (r.kit !== r.sd) assert.ok(r.difference, `${r.area}: ${r.case} differs from SD with no difference note`);
    }
  });

  test('the table records the deliberate differences it was written to carry', () => {
    const diffs = TABLE.rows.filter((r) => r.kit !== r.sd).map((r) => r.case);
    assert.ok(diffs.some((c) => /abort row under an unknown halt mode/.test(c)));
    assert.ok(diffs.some((c) => /line posted/.test(c)));
    assert.ok(diffs.some((c) => /decision message/.test(c)));
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

describe('the kit follows the contract table', () => {
  for (const row of TABLE.rows) {
    test(`${row.area}: ${row.case}`, async () => {
      assert.equal(await kitFor(row), row.kit);
    });
  }
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

  test('a follow-up carrying an unknown repo is continued, not refused', async () => {
    const taken = { ...itemFor({ route: 'follow-up', session: 'live' }), repo: 'no-such-repo-dir' };
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
