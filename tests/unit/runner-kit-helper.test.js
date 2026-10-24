/**
 * LIN-3098 S2 — the runner helper (`lib/runner-kit/runner.mjs`): its pure
 * decisions, table-tested, and its commands against a fake Harbour.
 *
 * The helper is what a person's Claude Code session runs, through Bash, to be
 * the runner for their workspace. Each decision below is a pure function the
 * commands call, so the rules are pinned here rather than in prose:
 *
 *   - pollDecision: another consumer (NB2) → harness (N2) → owner attribution
 *     (Q4/B1) → halt → token life (NB3) → prompt confirmation. A refusal
 *     LEAVES the item queued; it is never taken and then failed.
 *   - postTakeCheck: a take/poll mismatch closes with `[skipped] refused:`,
 *     which is terminal but never a wake.
 *   - haltAction / haltSweep, resolveFollowUp (N4 stop parity), abortAction
 *     (B5), recoverAction (B4, plus NB3's re-login), watchdogAction and
 *     isHeartbeatStale (N1), sumTranscriptUsage and subagentModelFor (NB5),
 *     and feedbackBody (NB1: every post carries the lineage's rootItemId).
 *
 * Every marker is checked against the real parsers (lib/dispatch-terminal.js,
 * lib/session-telemetry.js, lib/task-cost.js), never against a copy of their
 * regexes. The command tests run against a fake Harbour on 127.0.0.1 and keep
 * every socket in a short `mkdtemp` dir, so the file stays hermetic.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdtempSync, rmSync, statSync, existsSync, readFileSync, writeFileSync,
  mkdirSync, chmodSync, utimesSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MangoClient } from '@jkershaw/mangodb';

import {
  OTHER_CONSUMER_RECENT_MS,
  FRESH_TAKE_MIN_TOKEN_LIFE_MS,
  WATCHDOG_STALL_MIN,
  WATCHDOG_FAIL_MIN,
  WAIT_CAP_MS,
  RUNNER_HARNESS,
  attributeItem,
  harnessDecision,
  confirmItem,
  haltAction,
  haltSweep,
  pollDecision,
  preConfirmDecision,
  postTakeCheck,
  resolveFollowUp,
  abortAction,
  recoverAction,
  watchdogAction,
  watchdogSweep,
  stallCandidates,
  transcriptFinished,
  dispatchEvidence,
  canPost,
  wakeRootFrom,
  sumTranscriptUsage,
  usageMessage,
  subagentModelFor,
  handoffMessage,
  feedbackBody,
  parseCredentialBlock,
  tokenFingerprint,
  promptDigest,
  isHeartbeatStale,
  runCommand
} from '../../lib/runner-kit/runner.mjs';
import { isHeartbeatStale as brokerIsHeartbeatStale, credentialStore } from '../../lib/runner-kit/broker.mjs';
import { findTerminalFeedback, findWakeEvent } from '../../lib/dispatch-terminal.js';
import { parseUsage } from '../../lib/session-telemetry.js';
import { buildTaskCost } from '../../lib/task-cost.js';
import { HALT_MODES } from '../../lib/workspace-halt.js';
import { NOBODY_LISTENING_MS } from '../../lib/consumer-poll-warning.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
// LIN-3211: the guard is read off the namespace, so its absence at HEAD fails
// only the LIN-3211 tests rather than the whole file's import.
import * as runnerKit from '../../lib/runner-kit/runner.mjs';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { attachProxyContext } from '../../lib/proxy-preamble.js';
import { buildCollectiveParticipantPrompt } from '../../lib/prompts/collective-participant.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'runner-kit', 'subagent.jsonl');
const RUNNER_SRC = join(ROOT, 'lib', 'runner-kit', 'runner.mjs');

const OWNER = 'acct-owner-1111';
const STRANGER = 'acct-stranger-2222';
const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const TIMEOUT = { timeout: 20_000 };
const PRICED_MODEL = 'claude-sonnet-4-6';

const K = '11111111-1111-4111-8111-111111111111';
const W1 = '22222222-2222-4222-8222-222222222222';
const W2 = '33333333-3333-4333-8333-333333333333';
const F1 = '44444444-4444-4444-8444-444444444444';
const X = '55555555-5555-4555-8555-555555555555';

function item(over = {}) {
  return {
    id: X,
    prompt: 'do the step',
    kind: 'custom',
    dispatchedBy: OWNER,
    harness: null,
    followUpTo: null,
    abort: false,
    abortTo: null,
    sessionId: null,
    ...over
  };
}

function ctx(over = {}) {
  return {
    ownerAccountId: OWNER,
    halt: null,
    ledger: { items: {} },
    promptRead: { id: X, prompt: 'do the step', followUpTo: null },
    wakeRoot: null,
    otherConsumerLastSeenAt: null,
    now: NOW,
    tokenExpiresAt: new Date(NOW + 20 * 3600_000).toISOString(),
    ...over
  };
}

function ledgerWith(rows) {
  return { items: Object.fromEntries(rows.map((r) => [r.itemId, r])) };
}

const fb = (message, kind = 'status') => [{ message, kind, timestamp: new Date(NOW).toISOString() }];

describe('constants', () => {
  test('the other-consumer window is named and no wider than Harbour\'s own "nobody is listening" limit', () => {
    assert.ok(OTHER_CONSUMER_RECENT_MS > 0);
    assert.ok(OTHER_CONSUMER_RECENT_MS <= NOBODY_LISTENING_MS);
  });

  test('the fresh-take margin is a named constant well inside the 24h runner token life', () => {
    assert.ok(FRESH_TAKE_MIN_TOKEN_LIFE_MS >= 3600_000);
    assert.ok(FRESH_TAKE_MIN_TOKEN_LIFE_MS < 24 * 3600_000);
  });

  test('the watchdog blocks before it fails; wait exits at the 25-minute cap', () => {
    assert.ok(WATCHDOG_STALL_MIN < WATCHDOG_FAIL_MIN);
    assert.equal(WAIT_CAP_MS, 25 * 60_000);
    assert.equal(RUNNER_HARNESS, 'claude-code');
  });

  test('isHeartbeatStale is the broker\'s, imported, not re-implemented (N1)', () => {
    assert.equal(isHeartbeatStale, brokerIsHeartbeatStale);
  });

  test('runner.mjs imports credentialStore from broker.mjs and defines no storage of its own', () => {
    const src = readFileSync(RUNNER_SRC, 'utf8');
    assert.match(src, /import\s*\{[^}]*\bcredentialStore\b[^}]*\}\s*from\s*'\.\/broker\.mjs'/);
    assert.doesNotMatch(src, /function\s+credentialStore\b/);
    assert.doesNotMatch(src, /writeFileSync\([^)]*runner\.token/);
  });
});

describe('attributeItem (Q4)', () => {
  const rows = [
    ['owner-dispatched item passes', item(), null, true],
    ['another account\'s item is left', item({ dispatchedBy: STRANGER }), null, false],
    ['a non-wake with null dispatchedBy is left', item({ dispatchedBy: null }), null, false],
    ['an owner wake passes (root read says owner)', item({ kind: 'wake', dispatchedBy: null, followUpTo: K }), { id: K, dispatchedBy: OWNER }, true],
    ['a wake whose root is foreign is left', item({ kind: 'wake', dispatchedBy: null, followUpTo: K }), { id: K, dispatchedBy: STRANGER }, false],
    ['a wake whose root has null dispatchedBy is left', item({ kind: 'wake', dispatchedBy: null, followUpTo: K }), { id: K, dispatchedBy: null }, false],
    ['a wake whose root could not be read is left', item({ kind: 'wake', dispatchedBy: null, followUpTo: K }), null, false],
    ['a wake-kind row carrying an enqueuer\'s id is judged on that id', item({ kind: 'wake', dispatchedBy: STRANGER, followUpTo: K }), { id: K, dispatchedBy: OWNER }, false],
    // F1: only a server-minted WAKE may borrow its root's attribution. An
    // ownerless/legacy proxy token enqueues with dispatchedBy:null, so a
    // non-wake follow-up at the owner's kickoff must not pass as owner-wake
    // (it would continue the owner's subagent with that row's prompt).
    ['F1: a NON-wake with null dispatchedBy following up the owner\'s kickoff is left', item({ kind: 'implementation', dispatchedBy: null, followUpTo: K }), { id: K, dispatchedBy: OWNER }, false]
  ];
  for (const [name, it, root, pass] of rows) {
    test(name, () => {
      assert.equal(attributeItem(it, { ownerAccountId: OWNER, wakeRoot: root }).pass, pass);
    });
  }

  test('F4: wakeRootFrom never invents the root id, so the id check in the wake rule means something', () => {
    assert.deepEqual(wakeRootFrom({ status: 200, json: { id: K, dispatchedBy: OWNER } }), { id: K, dispatchedBy: OWNER });
    assert.deepEqual(wakeRootFrom({ status: 200, json: { dispatchedBy: OWNER } }), { id: null, dispatchedBy: OWNER });
    assert.equal(wakeRootFrom({ status: 404, json: { id: K } }), null);
    assert.equal(wakeRootFrom(null), null);
    const wake = item({ kind: 'wake', dispatchedBy: null, followUpTo: K });
    assert.equal(attributeItem(wake, { ownerAccountId: OWNER, wakeRoot: wakeRootFrom({ status: 200, json: { dispatchedBy: OWNER } }) }).pass, false);
    assert.equal(attributeItem(wake, { ownerAccountId: OWNER, wakeRoot: wakeRootFrom({ status: 200, json: { id: W1, dispatchedBy: OWNER } }) }).pass, false);
    assert.equal(attributeItem(wake, { ownerAccountId: OWNER, wakeRoot: wakeRootFrom({ status: 200, json: { id: K, dispatchedBy: OWNER } }) }).pass, true);
  });

  test('no owner id at all fails closed', () => {
    assert.equal(attributeItem(item(), { ownerAccountId: null }).pass, false);
  });
});

describe('harnessDecision (N2)', () => {
  const rows = [[null, null], ['claude-code', null], ['opencode', 'harness:opencode'], ['codex', 'harness:codex']];
  for (const [harness, want] of rows) {
    test(`harness ${harness} → ${want ?? 'pass'}`, () => {
      assert.equal(harnessDecision(item({ harness })), want);
    });
  }
});

describe('confirmItem', () => {
  test('an identical /prompt read confirms', () => {
    assert.equal(confirmItem(item(), { id: X, prompt: 'do the step', followUpTo: null }).ok, true);
  });
  test('a byte difference is refused', () => {
    const r = confirmItem(item(), { id: X, prompt: 'do the step ', followUpTo: null });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'prompt-mismatch');
  });
  test('a different followUpTo is refused', () => {
    assert.equal(confirmItem(item({ followUpTo: K }), { id: X, prompt: 'do the step', followUpTo: W1 }).ok, false);
  });
  test('an unreadable /prompt is refused', () => {
    assert.equal(confirmItem(item(), null).ok, false);
  });
  test('an abort row has no prompt to confirm', () => {
    assert.equal(confirmItem(item({ abort: true, abortTo: K, prompt: null }), null).ok, true);
  });
});

describe('pollDecision (order: other consumer, harness, attribution, halt, token life, confirm)', () => {
  const rows = [
    ['an owner item with a matching prompt is taken', item(), ctx(), 'take'],
    ['B1: a non-owner child whose sessionId is the owner\'s kickoff is left, never taken',
      item({ dispatchedBy: STRANGER, sessionId: K }), ctx(), 'leave'],
    ['a wake whose root is foreign is left', item({ kind: 'wake', dispatchedBy: null, followUpTo: K }), ctx({ wakeRoot: { id: K, dispatchedBy: STRANGER } }), 'leave'],
    ['a non-wake with null dispatchedBy is left', item({ dispatchedBy: null }), ctx(), 'leave'],
    ['F1: a NON-wake with null dispatchedBy following up the owner\'s kickoff is left',
      item({ kind: 'implementation', dispatchedBy: null, followUpTo: K }),
      ctx({ wakeRoot: { id: K, dispatchedBy: OWNER }, promptRead: { id: X, prompt: 'do the step', followUpTo: K } }), 'leave'],
    ['N2: harness opencode is left', item({ harness: 'opencode' }), ctx(), 'leave'],
    ['N2: harness claude-code passes', item({ harness: 'claude-code' }), ctx(), 'take'],
    ['a prompt mismatch is left', item(), ctx({ promptRead: { id: X, prompt: 'changed', followUpTo: null } }), 'leave'],
    ['NB2: another consumer seen within the window aborts the runner',
      item(), ctx({ otherConsumerLastSeenAt: new Date(NOW - OTHER_CONSUMER_RECENT_MS + 1000).toISOString() }), 'abort'],
    ['NB2: another consumer last seen long ago does not',
      item(), ctx({ otherConsumerLastSeenAt: new Date(NOW - OTHER_CONSUMER_RECENT_MS - 1000).toISOString() }), 'take'],
    ['NB3: a fresh item near token expiry is left',
      item(), ctx({ tokenExpiresAt: new Date(NOW + FRESH_TAKE_MIN_TOKEN_LIFE_MS - 1000).toISOString() }), 'leave'],
    ['NB3: a follow-up near token expiry is still taken',
      item({ followUpTo: K }), ctx({
        tokenExpiresAt: new Date(NOW + FRESH_TAKE_MIN_TOKEN_LIFE_MS - 1000).toISOString(),
        promptRead: { id: X, prompt: 'do the step', followUpTo: K }
      }), 'take'],
    ['a halt stop leaves an owner item', item(), ctx({ halt: { mode: 'stop' } }), 'leave'],
    ['a halt pause leaves a fresh owner item', item(), ctx({ halt: { mode: 'pause' } }), 'leave']
  ];
  for (const [name, it, c, want] of rows) {
    test(name, () => {
      assert.equal(pollDecision(it, c).decision, want);
    });
  }

  test('reasons name the rule that refused', () => {
    assert.equal(pollDecision(item({ harness: 'opencode' }), ctx()).reason, 'harness:opencode');
    assert.equal(pollDecision(item({ dispatchedBy: STRANGER }), ctx()).reason, 'not-owner');
    assert.equal(pollDecision(item(), ctx({ halt: { mode: 'stop' } })).reason, 'halt:stop');
    assert.equal(pollDecision(item(), ctx({ promptRead: { id: X, prompt: 'x' } })).reason, 'prompt-mismatch');
  });

  test('harness is checked before attribution; attribution before halt', () => {
    assert.equal(pollDecision(item({ harness: 'opencode', dispatchedBy: STRANGER }), ctx()).reason, 'harness:opencode');
    assert.equal(pollDecision(item({ dispatchedBy: STRANGER }), ctx({ halt: { mode: 'stop' } })).reason, 'not-owner');
  });

  test('preConfirmDecision is pollDecision without the /prompt read (what `wait` uses)', () => {
    assert.equal(preConfirmDecision(item(), ctx({ promptRead: undefined })).decision, 'take');
    assert.equal(preConfirmDecision(item({ dispatchedBy: STRANGER }), ctx()).decision, 'leave');
  });
});

// LIN-3211: a runner-taken item never carries a token in prose. Every fixture
// prompt comes from a real emitter, with a real minted token, so the guard is
// tested against what Harbour actually writes rather than a copy of it.
describe('credentialInProseRefusal and preConfirmDecision (LIN-3211: no credential in prose)', () => {
  const BASE_URL = 'http://localhost:3001';
  const TOKEN_LINE_RE = /curl -X POST -H "Authorization: Bearer ((?:hbp_)?[A-Za-z0-9_-]{43})" \S+\/api\/proxy\/token/;
  let dbDir, client, tokens;
  const f = {};

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'rk-3211-'));
    client = new MangoClient(dbDir);
    await client.connect();
    tokens = new ProxyTokenStore({ collection: client.db('lin3211').collection('proxy_tokens') });
    // Emitter 1 (lib/proxy-preamble.js): what the session route attached for the
    // rung's harness:null item on HEAD, and for a claude-code item.
    f.prose = await attachProxyContext({ proxyTokenStore: tokens, urlKey: 'acme', baseUrl: BASE_URL, prompt: 'do the step', harness: null, createdBy: OWNER });
    f.mcp = await attachProxyContext({ proxyTokenStore: tokens, urlKey: 'acme', baseUrl: BASE_URL, prompt: 'do the step', harness: 'claude-code', createdBy: OWNER });
    // Emitter 4 (lib/prompts/collective-participant.js), with its own real mint.
    f.collectiveToken = (await tokens.createToken('acme', { kind: 'bootstrap', scope: 'readWrite', label: 'collective', createdBy: OWNER })).token;
    f.collective = buildCollectiveParticipantPrompt({
      channel: '#Collective', nick: 'alpha', yapBaseUrl: 'https://yap.test', proxyBaseUrl: BASE_URL, proxyToken: f.collectiveToken
    });
    // Emitters 2 and 3 (public/common.js buildBlock, public/proxy.js
    // buildAgentPrompt) are closures inside browser IIFEs, so no vm sandbox
    // reaches them cheaply. Their curl line is rendered here from a literal, and
    // the drift test below pins that literal to the source line.
    f.clientToken = (await tokens.createToken('acme', { kind: 'bootstrap', scope: 'readWrite', label: 'copy', createdBy: OWNER })).token;
    f.commonCopy = `do the step\n\n## Workspace API access\n\nFirst, exchange your single-use bootstrap token for a working token:\n\n  curl -X POST -H "Authorization: Bearer ${f.clientToken}" ${BASE_URL}/api/proxy/token\n`;
    f.settingsCopy = `First, exchange your single-use bootstrap token for a working token:\n\ncurl -X POST -H "Authorization: Bearer ${f.clientToken}" ${BASE_URL}/api/proxy/token\n`;
  });
  after(async () => {
    if (client?.close) await client.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  test('the fixtures are what the emitters really write (preconditions)', () => {
    // Prose branch: token in the text, no structured field ("one credential, one channel").
    assert.match(f.prose.prompt, TOKEN_LINE_RE);
    assert.equal(f.prose.bootstrapToken, null);
    // MCP branch: structured field, no token and no exchange line in the text.
    assert.equal(typeof f.mcp.bootstrapToken, 'string');
    assert.ok(!f.mcp.prompt.includes(f.mcp.bootstrapToken));
    assert.doesNotMatch(f.mcp.prompt, /api\/proxy\/token/);
    assert.match(f.collective, TOKEN_LINE_RE);
    // A real bootstrap is hbp_ + randomBytes(32).toString('base64url') (LIN-3795; lib/harbour-token-format.js).
    for (const t of [f.prose.prompt.match(TOKEN_LINE_RE)[1], f.mcp.bootstrapToken, f.collectiveToken, f.clientToken]) {
      assert.match(t, /^hbp_[A-Za-z0-9_-]{43}$/);
    }
  });

  test('drift: the client emitters still write the exchange curl line these literals copy', () => {
    const common = readFileSync(join(ROOT, 'public', 'common.js'), 'utf8');
    const proxy = readFileSync(join(ROOT, 'public', 'proxy.js'), 'utf8');
    assert.ok(common.includes('curl -X POST -H "Authorization: Bearer ${token}" ${baseUrl}/api/proxy/token'), 'public/common.js buildBlock changed: update f.commonCopy');
    assert.ok(proxy.includes('curl -X POST -H "Authorization: Bearer ${token}" ${tokenUrl}'), 'public/proxy.js buildAgentPrompt changed: update f.settingsCopy');
    assert.ok(proxy.includes('const tokenUrl = `${baseUrl}/api/proxy/token`;'));
  });

  test('credentialInProseRefusal is exported from the runner kit', () => {
    assert.equal(typeof runnerKit.credentialInProseRefusal, 'function');
  });

  // [name, item builder, expected decision]
  const rows = [
    ['prose curl line (attachProxyContext, harness null), no bootstrapToken → leave',
      () => item({ prompt: f.prose.prompt, bootstrapToken: f.prose.bootstrapToken }), 'leave'],
    ['prose curl line AND bootstrapToken set (a pasted copy block on a claude-code item) → leave',
      () => item({ harness: 'claude-code', prompt: f.prose.prompt, bootstrapToken: f.mcp.bootstrapToken }), 'leave'],
    ['Collective participant prompt (its Harbour bootstrap) → leave',
      () => item({ kind: 'collective', prompt: f.collective, bootstrapToken: null }), 'leave'],
    ['ProxyToggle copy/download block (public/common.js) pasted into a prompt → leave',
      () => item({ prompt: f.commonCopy, bootstrapToken: null }), 'leave'],
    ['Settings copy (public/proxy.js) pasted into a prompt → leave',
      () => item({ prompt: f.settingsCopy, bootstrapToken: null }), 'leave'],
    ['MCP block (attachProxyContext, claude-code) with bootstrapToken → take',
      () => item({ harness: 'claude-code', prompt: f.mcp.prompt, bootstrapToken: f.mcp.bootstrapToken }), 'take'],
    ['no access block at all → take',
      () => item({ prompt: 'do the step', bootstrapToken: null }), 'take'],
    ['an abort row (no prompt) → take path unchanged',
      () => item({ abort: true, abortTo: K, prompt: null, bootstrapToken: null }), 'take'],
    ['a non-Harbour Bearer that is not 43 characters → take',
      () => item({ prompt: 'call it:\n  curl -X POST -H "Authorization: Bearer sk-abc123" https://api.example.com/api/proxy/token\n' }), 'take']
  ];

  for (const [name, build, want] of rows) {
    test(`credentialInProseRefusal: ${name}`, () => {
      assert.equal(typeof runnerKit.credentialInProseRefusal, 'function', 'credentialInProseRefusal is not exported');
      assert.equal(Boolean(runnerKit.credentialInProseRefusal(build())), want === 'leave');
    });
    test(`preConfirmDecision: ${name}`, () => {
      const d = preConfirmDecision(build(), ctx());
      assert.equal(d.decision, want);
      if (want === 'leave') assert.equal(d.reason, 'credential-in-prose');
    });
  }

  test('pollDecision leaves it too (poll uses the same pre-confirm step)', () => {
    const it = item({ prompt: f.prose.prompt });
    const d = pollDecision(it, ctx({ promptRead: { id: X, prompt: f.prose.prompt, followUpTo: null } }));
    assert.deepEqual({ decision: d.decision, reason: d.reason }, { decision: 'leave', reason: 'credential-in-prose' });
  });

  test('placed after owner attribution and before halt', () => {
    assert.equal(preConfirmDecision(item({ prompt: f.prose.prompt, dispatchedBy: STRANGER }), ctx()).reason, 'not-owner');
    assert.equal(preConfirmDecision(item({ prompt: f.prose.prompt }), ctx({ halt: { mode: 'stop' } })).reason, 'credential-in-prose');
  });

  test('the decision never contains the token or the exchange line', () => {
    const cases = [
      [item({ prompt: f.prose.prompt }), f.prose.prompt.match(TOKEN_LINE_RE)[1]],
      [item({ harness: 'claude-code', prompt: f.prose.prompt, bootstrapToken: f.mcp.bootstrapToken }), f.mcp.bootstrapToken],
      [item({ kind: 'collective', prompt: f.collective }), f.collectiveToken]
    ];
    for (const [it, token] of cases) {
      const d = preConfirmDecision(it, ctx());
      assert.equal(d.reason, 'credential-in-prose');
      const text = JSON.stringify(d);
      assert.ok(!text.includes(token), 'decision carries the token');
      assert.ok(!text.includes(f.prose.prompt.match(TOKEN_LINE_RE)[1]), 'decision carries a token');
      assert.doesNotMatch(text, /api\/proxy\/token/);
    }
  });
});

describe('haltAction and haltSweep (Simple Dispatcher\'s halt meaning)', () => {
  const live = ledgerWith([{ itemId: K, agentId: 'agent-k', rootItemId: K, state: 'running' }]);

  // LIN-3650: an unknown mode leaves an abort (`halt:<mode>`), a known one lets it flow,
  // so a mode added to HALT_MODES fails here until haltAction has a branch for it.
  test('every HALT_MODES value has an explicit kit branch (aborts flow)', () => {
    for (const mode of HALT_MODES) {
      const r = haltAction({ mode }, item({ abort: true, abortTo: K, prompt: null }), live);
      assert.equal(r.decision, 'take', `${mode}: abort must be taken`);
      assert.ok(r.reason.endsWith(':abort-flows'), `${mode}: reason ${r.reason}`);
    }
  });

  test('no halt takes', () => {
    assert.equal(haltAction(null, item(), live).decision, 'take');
  });

  test('pause: fresh items are held; follow-ups and wakes for ledger subagents flow; aborts flow', () => {
    assert.equal(haltAction({ mode: 'pause' }, item(), live).decision, 'leave');
    assert.equal(haltAction({ mode: 'pause' }, item({ followUpTo: K }), live).decision, 'take');
    assert.equal(haltAction({ mode: 'pause' }, item({ kind: 'wake', followUpTo: K }), live).decision, 'take');
    assert.equal(haltAction({ mode: 'pause' }, item({ abort: true, abortTo: K, prompt: null }), live).decision, 'take');
  });

  test('stop: fresh items and resumable follow-ups are held; aborts flow as in Simple Dispatcher (LIN-3451)', () => {
    assert.equal(haltAction({ mode: 'stop' }, item(), live).decision, 'leave');
    assert.equal(haltAction({ mode: 'stop' }, item({ followUpTo: K }), live).decision, 'leave');
    assert.equal(haltAction({ mode: 'stop' }, item({ abort: true, abortTo: K, prompt: null }), live).decision, 'take');
  });

  test('stop: a follow-up with no live session is taken so it is failed; one that can resume is held (LIN-3670)', () => {
    assert.deepEqual(haltAction({ mode: 'stop' }, item({ followUpTo: W2 }), live), { decision: 'take', reason: 'halt:stop:follow-up-rejects' });
    assert.equal(haltAction({ mode: 'stop' }, item({ followUpTo: X }), live).decision, 'take');
    const resumable = ledgerWith([
      { itemId: W1, agentId: 'agent-w', rootItemId: W1, state: 'done' },
      { itemId: F1, agentId: 'agent-f', rootItemId: F1, state: 'stopped' }
    ]);
    assert.equal(haltAction({ mode: 'stop' }, item({ followUpTo: K }), live).decision, 'leave');
    assert.equal(haltAction({ mode: 'stop' }, item({ followUpTo: W1 }), resumable).decision, 'leave');
    assert.equal(haltAction({ mode: 'stop' }, item({ followUpTo: F1 }), resumable).decision, 'leave');
  });

  test('pause: a follow-up with no live session is taken so it is failed, not left queued (LIN-3451)', () => {
    assert.equal(haltAction({ mode: 'pause' }, item({ followUpTo: W2 }), live).decision, 'take');
    assert.equal(haltAction({ mode: 'pause' }, item({ followUpTo: X }), live).decision, 'take');
  });

  test('an unknown halt mode leaves every item, aborts included; a named difference from Simple Dispatcher, which reads it as pause', () => {
    assert.equal(haltAction({ mode: 'drain' }, item(), live).decision, 'leave');
    assert.equal(haltAction({ mode: 'drain' }, item({ abort: true, abortTo: K, prompt: null }), live).decision, 'leave');
  });

  test('stop sweeps every running subagent with Simple Dispatcher\'s [aborted] line and keeps it in the ledger as stopped (N4)', () => {
    const ledger = ledgerWith([
      { itemId: K, agentId: 'agent-k', rootItemId: K, state: 'running' },
      { itemId: W1, agentId: 'agent-w', rootItemId: W1, state: 'done' },
      { itemId: F1, agentId: 'agent-f', rootItemId: F1, state: 'stopped' }
    ]);
    const sweep = haltSweep({ mode: 'stop' }, ledger);
    assert.equal(sweep.posts.length, 1);
    assert.equal(sweep.posts[0].itemId, K);
    assert.equal(sweep.posts[0].message, `[aborted] Cancelled running session ${K.slice(0, 8)} (stopped by operator).`);
    assert.equal(findTerminalFeedback(fb(sweep.posts[0].message)).status, 'aborted');
    assert.deepEqual(sweep.stopAgents, ['agent-k']);
    assert.equal(sweep.ledger.items[K].state, 'stopped', 'kept, not deleted');
    assert.equal(haltSweep({ mode: 'pause' }, ledger).posts.length, 0);
    assert.equal(haltSweep(null, ledger).posts.length, 0);
  });
});

describe('F2: rows taken under an earlier runner token are never posted to', () => {
  const OLD = 'sha256:0000000000000000';
  const CUR = 'sha256:1111111111111111';

  test('canPost: the current token, or a row with no recorded token', () => {
    assert.equal(canPost({ tokenId: CUR }, CUR), true);
    assert.equal(canPost({ tokenId: null }, CUR), true);
    assert.equal(canPost({ tokenId: OLD }, CUR), false);
    assert.equal(canPost({ tokenId: CUR }, null), false, 'no live token: nothing can be posted');
  });

  test('haltSweep: an old-token row is stopped and kept, but listed as unposted, not posted', () => {
    const ledger = ledgerWith([
      { itemId: K, agentId: 'agent-old', rootItemId: K, state: 'running', tokenId: OLD },
      { itemId: W1, agentId: 'agent-cur', rootItemId: W1, state: 'running', tokenId: CUR }
    ]);
    const sweep = haltSweep({ mode: 'stop' }, ledger, { currentTokenId: CUR });
    assert.deepEqual(sweep.posts.map((p) => p.itemId), [W1]);
    assert.deepEqual(sweep.unposted.map((p) => p.itemId), [K]);
    assert.deepEqual(sweep.stopAgents.sort(), ['agent-cur', 'agent-old']);
    assert.equal(sweep.ledger.items[K].state, 'stopped');
  });

  test('abortAction: an old-token target is stopped and acked, but its child post is listed, not made', () => {
    const ledger = ledgerWith([{ itemId: K, agentId: 'agent-old', rootItemId: K, state: 'running', tokenId: OLD }]);
    const r = abortAction(item({ id: X, abort: true, abortTo: K, prompt: null }), ledger, { currentTokenId: CUR });
    assert.equal(r.ack, `[aborted] Cancelled running session ${K.slice(0, 8)} (running).`);
    assert.equal(r.childPost, null);
    assert.equal(r.unpostedChild.itemId, K);
    assert.equal(r.stopAgent, 'agent-old');
    assert.equal(r.ledger.items[K].state, 'stopped');
  });

  test('watchdogSweep: an old-token stall is recorded locally with post:false', () => {
    const now = NOW;
    const ledger = ledgerWith([
      { itemId: K, agentId: 'agent-old', rootItemId: K, state: 'running', tokenId: OLD, takenAt: new Date(now - 30 * 60_000).toISOString() },
      { itemId: W1, agentId: 'agent-cur', rootItemId: W1, state: 'running', tokenId: CUR, takenAt: new Date(now - 30 * 60_000).toISOString() }
    ]);
    const r = watchdogSweep(ledger, now, { currentTokenId: CUR, transcriptMtimeFor: () => null });
    const by = Object.fromEntries(r.actions.map((a) => [a.itemId, a]));
    assert.equal(by[K].action, 'block');
    assert.equal(by[K].post, false);
    assert.equal(by[W1].post, true);
    assert.ok(r.ledger.items[K].blockedAt, 'the local ledger change is kept');
  });
});

describe('resolveFollowUp', () => {
  const ledger = ledgerWith([
    { itemId: K, agentId: 'agent-k', rootItemId: K, state: 'done' },
    { itemId: W1, agentId: 'agent-k', rootItemId: K, state: 'running' },
    { itemId: F1, agentId: 'agent-f', rootItemId: F1, state: 'stopped' },
    { itemId: W2, agentId: 'agent-l', rootItemId: W2, state: 'lost' }
  ]);

  test('no followUpTo starts a new subagent', () => {
    assert.equal(resolveFollowUp(item(), ledger).action, 'new');
  });
  test('a follow-up to a finished item continues its subagent (the ordinary case)', () => {
    const r = resolveFollowUp(item({ followUpTo: K }), ledger);
    assert.equal(r.action, 'continue');
    assert.equal(r.agentId, 'agent-k');
    assert.equal(r.rootItemId, K);
  });
  test('it keys on every item id handed to the subagent, not only the first', () => {
    const r = resolveFollowUp(item({ followUpTo: W1 }), ledger);
    assert.equal(r.agentId, 'agent-k');
    assert.equal(r.rootItemId, K);
  });
  test('N4: a follow-up after a stop continues the stopped subagent', () => {
    const r = resolveFollowUp(item({ followUpTo: F1 }), ledger);
    assert.equal(r.action, 'continue');
    assert.equal(r.agentId, 'agent-f');
  });
  test('a lost subagent (runner restarted) cannot be continued', () => {
    assert.equal(resolveFollowUp(item({ followUpTo: W2 }), ledger).action, 'reject');
  });
  test('a miss posts Simple Dispatcher\'s failure line, which reads as failed', () => {
    const r = resolveFollowUp(item({ followUpTo: X }), ledger);
    assert.equal(r.action, 'reject');
    assert.equal(r.message, `[failed] No live session to resume for follow-up (original dispatch ${X} not found or already archived).`);
    assert.equal(findTerminalFeedback(fb(r.message)).status, 'failed');
  });
});

describe('abortAction (B5)', () => {
  const ABORT = '66666666-6666-4666-8666-666666666666';
  const abortRow = (to) => item({ id: ABORT, abort: true, abortTo: to, prompt: null });

  test('target running: ack plus the same line on the target row, subagent stopped, kept as stopped', () => {
    const ledger = ledgerWith([{ itemId: K, agentId: 'agent-k', rootItemId: K, state: 'running' }]);
    const r = abortAction(abortRow(K), ledger);
    const line = `[aborted] Cancelled running session ${K.slice(0, 8)} (running).`;
    assert.equal(r.ack, line);
    assert.deepEqual(r.childPost, { itemId: K, message: line, rootItemId: K });
    assert.equal(r.stopAgent, 'agent-k');
    assert.equal(r.ledger.items[K].state, 'stopped');
    assert.equal(findTerminalFeedback(fb(r.ack)).status, 'aborted');
  });

  test('a running follow-up row in the lineage is the one aborted', () => {
    const ledger = ledgerWith([
      { itemId: K, agentId: 'agent-k', rootItemId: K, state: 'done' },
      { itemId: W1, agentId: 'agent-k', rootItemId: K, state: 'running' }
    ]);
    const r = abortAction(abortRow(K), ledger);
    assert.equal(r.childPost.itemId, W1);
    assert.equal(r.ledger.items[W1].state, 'stopped');
  });

  test('target already terminal: only the ack, which never overwrites a real completion', () => {
    const ledger = ledgerWith([{ itemId: K, agentId: 'agent-k', rootItemId: K, state: 'done' }]);
    const r = abortAction(abortRow(K), ledger);
    assert.equal(r.ack, `[aborted] Closed finished session ${K.slice(0, 8)} (done).`);
    assert.equal(r.childPost, null);
    assert.equal(r.stopAgent, null);
    assert.equal(findTerminalFeedback(fb(r.ack)).status, 'aborted');
  });

  test('target unknown: a failed ack on the abort row', () => {
    const r = abortAction(abortRow(X), ledgerWith([]));
    assert.equal(r.ack, `[failed] No session to abort (${X}).`);
    assert.equal(r.childPost, null);
    assert.equal(findTerminalFeedback(fb(r.ack)).status, 'failed');
  });
});

describe('recoverAction (B4, NB3)', () => {
  const ledger = ledgerWith([
    { itemId: K, agentId: 'a1', rootItemId: K, state: 'running', tokenId: 'tok-A', session: 's-old' },
    { itemId: W1, agentId: 'a2', rootItemId: W1, state: 'stopped', tokenId: 'tok-A', session: 's-old' },
    { itemId: W2, agentId: 'a3', rootItemId: W2, state: 'running', tokenId: 'tok-OLD', session: 's-old' },
    { itemId: F1, agentId: 'a4', rootItemId: F1, state: 'done', tokenId: 'tok-A', session: 's-old' }
  ]);

  test('a restart: same-token running/stopped rows fail, other-token rows are orphans, finished ones are lost', () => {
    const r = recoverAction(ledger, { currentTokenId: 'tok-A', sessionId: 's-new' });
    assert.deepEqual(r.fail.sort(), [K, W1].sort());
    assert.deepEqual(r.orphans, [W2]);
    assert.deepEqual(r.lost, [F1]);
    assert.deepEqual(r.live, []);
    assert.equal(r.message, '[failed] runner restarted: subagent lost');
    assert.equal(findTerminalFeedback(fb(r.message)).status, 'failed');
    assert.equal(r.ledger.items[K].state, 'lost');
    assert.equal(r.ledger.items[W2].state, 'lost');
  });

  test('NB3: a re-login inside the live session keeps every subagent, including old-token ones', () => {
    const r = recoverAction(ledger, { currentTokenId: 'tok-B', sessionId: 's-old' });
    assert.deepEqual(r.fail, []);
    assert.deepEqual(r.orphans, []);
    assert.deepEqual(r.live.sort(), [K, W1, W2].sort());
    assert.equal(r.ledger.items[K].state, 'running');
  });

  test('no current token: nothing can be posted, so every running row from another session is an orphan', () => {
    const r = recoverAction(ledger, { currentTokenId: null, sessionId: 's-new' });
    assert.deepEqual(r.fail, []);
    assert.deepEqual(r.orphans.sort(), [K, W1, W2].sort());
  });

  test('the orphan copy is honest: rows stay taken, a waiting Autopilot hangs, re-dispatch the task', () => {
    const r = recoverAction(ledger, { currentTokenId: 'tok-A', sessionId: 's-new' });
    assert.match(r.orphanCopy, /stay `taken`/);
    // LIN-3163 (LIN-3157 B): history is lifetime-retained, so the copy must not
    // claim the rows expire on a 30-day timer.
    assert.doesNotMatch(r.orphanCopy, /30 days/, 'no 30-day expiry claim in the orphan copy');
    assert.match(r.orphanCopy, /re-dispatch/i);
  });
});

describe('watchdogAction', () => {
  const inflight = { itemId: K, agentId: 'agent-k', takenAt: new Date(NOW - 90 * 60_000).toISOString() };
  const opts = (mins) => ({ stallMin: WATCHDOG_STALL_MIN, failMin: WATCHDOG_FAIL_MIN, transcriptMtime: NOW - mins * 60_000 });

  test('recent activity: nothing', () => {
    assert.equal(watchdogAction(inflight, NOW, opts(1)), null);
  });
  test('silent past the stall threshold: [blocked] stalled, which wakes but is not terminal', () => {
    const r = watchdogAction(inflight, NOW, opts(WATCHDOG_STALL_MIN + 1));
    assert.equal(r.action, 'block');
    assert.equal(r.message, `[blocked] stalled: subagent agent-k silent for ${WATCHDOG_STALL_MIN + 1} min`);
    assert.equal(findWakeEvent(fb(r.message)).marker, 'blocked');
    assert.equal(findTerminalFeedback(fb(r.message)), null);
  });
  test('already blocked: no second [blocked]', () => {
    assert.equal(watchdogAction({ ...inflight, blockedAt: new Date(NOW - 60_000).toISOString() }, NOW, opts(WATCHDOG_STALL_MIN + 1)), null);
  });
  test('silent past the fail threshold: [failed] stalled and a stop', () => {
    const r = watchdogAction(inflight, NOW, opts(WATCHDOG_FAIL_MIN + 1));
    assert.equal(r.action, 'fail');
    assert.equal(r.stop, true);
    assert.match(r.message, /^\[failed\] stalled: subagent agent-k silent for \d+ min$/);
    assert.equal(findTerminalFeedback(fb(r.message)).status, 'failed');
  });
  test('F3: a taken row never handed to a subagent is measured from the take and blocked', () => {
    const r = watchdogAction({ itemId: K, agentId: null, takenAt: new Date(NOW - (WATCHDOG_STALL_MIN + 1) * 60_000).toISOString() }, NOW, opts(WATCHDOG_STALL_MIN + 1));
    assert.equal(r.action, 'block');
    assert.equal(r.message, `[blocked] stalled: no subagent took item ${K} (silent for ${WATCHDOG_STALL_MIN + 1} min)`);
    assert.equal(findWakeEvent(fb(r.message)).marker, 'blocked');
  });
  test('F3: … and failed past the fail threshold', () => {
    const r = watchdogAction({ itemId: K, agentId: null, takenAt: new Date(NOW - 90 * 60_000).toISOString() }, NOW, { transcriptMtime: null });
    assert.equal(r.action, 'fail');
    assert.equal(findTerminalFeedback(fb(r.message)).status, 'failed');
  });
  test('F3: activity after a [blocked] clears it', () => {
    const blockedAt = new Date(NOW - 10 * 60_000).toISOString();
    const r = watchdogAction({ ...inflight, blockedAt }, NOW, opts(1));
    assert.equal(r.action, 'clear');
    assert.equal(r.message, null);
  });
  test('F3: a second stall after recovering gets a second [blocked]', () => {
    const blockedAt = new Date(NOW - 60 * 60_000).toISOString();
    // Active 55 min ago (after the block), silent since.
    const r = watchdogAction({ ...inflight, blockedAt }, NOW, opts(WATCHDOG_STALL_MIN + 5));
    assert.equal(r.action, 'block');
  });
  test('F3: watchdogSweep covers rows with no agentId and clears blockedAt on activity', () => {
    const ledger = ledgerWith([
      { itemId: K, agentId: null, rootItemId: K, state: 'running', tokenId: 't', takenAt: new Date(NOW - 30 * 60_000).toISOString() },
      { itemId: W1, agentId: 'agent-w', rootItemId: W1, state: 'running', tokenId: 't', takenAt: new Date(NOW - 90 * 60_000).toISOString(), blockedAt: new Date(NOW - 30 * 60_000).toISOString() }
    ]);
    const r = watchdogSweep(ledger, NOW, { currentTokenId: 't', transcriptMtimeFor: (row) => (row.agentId === 'agent-w' ? NOW - 60_000 : null) });
    const by = Object.fromEntries(r.actions.map((a) => [a.itemId, a]));
    assert.equal(by[K].action, 'block');
    assert.equal(by[W1].action, 'clear');
    assert.equal(r.ledger.items[W1].blockedAt, undefined);
    assert.ok(r.ledger.items[K].blockedAt);
  });
  test('no transcript: silence is measured from the take', () => {
    const r = watchdogAction(inflight, NOW, { stallMin: WATCHDOG_STALL_MIN, failMin: WATCHDOG_FAIL_MIN, transcriptMtime: null });
    assert.equal(r.action, 'fail');
  });
});

// LIN-3669: the watchdog judged silence alone, so a run that had already finished
// (Harbour settled it, or the subagent printed its outcome and the parent never
// posted the marker) was failed at minute 60, and Harbour's last-wins terminal
// read let that [failed] override an earlier [done]. Evidence is injected into
// the pure decision; with none, every case above is unchanged.
describe('watchdogAction with dispatch evidence (LIN-3669)', () => {
  const inflight = { itemId: K, agentId: 'agent-k', takenAt: new Date(NOW - 90 * 60_000).toISOString() };
  const at = (mins, evidence, row = inflight) => watchdogAction(row, NOW, { transcriptMtime: NOW - mins * 60_000, evidence });
  const LATE = WATCHDOG_FAIL_MIN + 1;
  const FINISHED_MSG = '[blocked] stalled: subagent agent-k finished but its outcome was never posted';

  for (const [status, dispatch] of [['done', 'terminal'], ['closed', 'terminal']]) {
    test(`silent 61 min, Harbour already ${status}: settled, nothing posted`, () => {
      const r = at(LATE, { dispatch, finished: false });
      assert.equal(r.action, 'settle');
      assert.equal(r.message, null);
      assert.equal(r.stop, true);
    });
  }
  test('settled wins over finished, and also over a would-be [blocked]', () => {
    assert.equal(at(LATE, { dispatch: 'terminal', finished: true }).action, 'settle');
    assert.equal(at(WATCHDOG_STALL_MIN + 1, { dispatch: 'terminal', finished: false }).action, 'settle');
  });
  test('a finished transcript gets the non-terminal [blocked], never [failed]', () => {
    for (const mins of [WATCHDOG_STALL_MIN + 1, LATE]) {
      const r = at(mins, { dispatch: 'open', finished: true });
      assert.equal(r.action, 'block');
      assert.equal(r.finished, true);
      assert.equal(r.stop, false);
      assert.equal(r.message, FINISHED_MSG);
      assert.equal(findTerminalFeedback(fb(r.message)), null);
      assert.equal(findWakeEvent(fb(r.message)).marker, 'blocked');
    }
  });
  test('finished with [blocked] already posted: nothing posted again', () => {
    const blockedAt = new Date(NOW - 5 * 60_000).toISOString();
    assert.equal(at(LATE, { dispatch: 'open', finished: true }, { ...inflight, blockedAt }), null);
  });
  test('unreadable read at 61 min: defer (nothing terminal), at 21 min: today\'s [blocked]', () => {
    const d = at(LATE, { dispatch: 'unreadable', finished: false });
    assert.equal(d.action, 'defer');
    assert.equal(d.message, null);
    assert.equal(d.stop, false);
    const b = at(WATCHDOG_STALL_MIN + 1, { dispatch: 'unreadable', finished: false });
    assert.equal(b.action, 'block');
    assert.match(b.message, /^\[blocked\] stalled: subagent agent-k silent for 21 min$/);
  });
  test('a genuinely silent row with a non-terminal status still gets [failed] stalled', () => {
    const r = at(LATE, { dispatch: 'open', finished: false });
    assert.equal(r.action, 'fail');
    assert.equal(findTerminalFeedback(fb(r.message)).status, 'failed');
  });
  test('evidence never creates a stall: recent activity stays null / clear', () => {
    assert.equal(at(1, { dispatch: 'terminal', finished: true }), null);
    const blockedAt = new Date(NOW - 10 * 60_000).toISOString();
    assert.equal(at(1, { dispatch: 'terminal', finished: true }, { ...inflight, blockedAt }).action, 'clear');
  });
  test('watchdogSweep: settle marks the row done without posting; defer leaves the ledger alone', () => {
    const ledger = ledgerWith([
      { itemId: K, agentId: 'agent-k', rootItemId: K, state: 'running', tokenId: 't', takenAt: new Date(NOW - 90 * 60_000).toISOString() },
      { itemId: W1, agentId: 'agent-w', rootItemId: W1, state: 'running', tokenId: 't', takenAt: new Date(NOW - 90 * 60_000).toISOString() }
    ]);
    const r = watchdogSweep(ledger, NOW, {
      currentTokenId: 't', transcriptMtimeFor: () => null,
      evidenceFor: (row) => (row.itemId === K ? { dispatch: 'terminal', finished: false } : { dispatch: 'unreadable', finished: false })
    });
    const by = Object.fromEntries(r.actions.map((a) => [a.itemId, a]));
    assert.equal(by[K].action, 'settle');
    assert.equal(by[K].post, false);
    assert.equal(r.ledger.items[K].state, 'done');
    assert.equal(by[W1].action, 'defer');
    assert.equal(by[W1].post, false);
    assert.deepEqual(r.ledger.items[W1], ledger.items[W1]);
  });
  test('watchdogSweep: a finished block sets blockedAt and carries finished', () => {
    const ledger = ledgerWith([{ itemId: K, agentId: 'agent-k', rootItemId: K, state: 'running', tokenId: 't', takenAt: new Date(NOW - 90 * 60_000).toISOString() }]);
    const r = watchdogSweep(ledger, NOW, { currentTokenId: 't', transcriptMtimeFor: () => null, evidenceFor: () => ({ dispatch: 'open', finished: true }) });
    assert.equal(r.actions[0].action, 'block');
    assert.equal(r.actions[0].finished, true);
    assert.equal(r.actions[0].post, true);
    assert.equal(r.ledger.items[K].state, 'running');
    assert.ok(r.ledger.items[K].blockedAt);
  });
  test('stallCandidates: only running rows past a threshold', () => {
    const ledger = ledgerWith([
      { itemId: K, agentId: 'agent-k', rootItemId: K, state: 'running', tokenId: 't', takenAt: new Date(NOW - 90 * 60_000).toISOString() },
      { itemId: W1, agentId: 'agent-w', rootItemId: W1, state: 'running', tokenId: 't', takenAt: new Date(NOW - 90 * 60_000).toISOString() },
      { itemId: 'dddddddd', agentId: 'agent-d', rootItemId: 'dddddddd', state: 'done', tokenId: 't', takenAt: new Date(NOW - 90 * 60_000).toISOString() }
    ]);
    const rows = stallCandidates(ledger, NOW, { transcriptMtimeFor: (row) => (row.itemId === W1 ? NOW - 60_000 : null) });
    assert.deepEqual(rows.map((r) => r.itemId), [K]);
  });
});

describe('transcriptFinished (LIN-3669)', () => {
  const entry = (type, content) => JSON.stringify({ type, message: { role: type, content } });
  const text = (t) => entry('assistant', [{ type: 'text', text: t }]);
  test('ends with each closing-contract outcome line (a DECISION: line may precede it)', () => {
    for (const line of ['DONE: shipped', 'FAILED: no repro', 'BLOCKED: needs a key']) {
      assert.equal(transcriptFinished([entry('user', 'go'), text(`DECISION: x\n${line}\n`), '']), true, line);
    }
  });
  test('ends with a tool_use or a user entry: not finished, even after an earlier DONE:', () => {
    assert.equal(transcriptFinished([text('DONE: x'), entry('assistant', [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }])]), false);
    assert.equal(transcriptFinished([text('DONE: x'), entry('user', 'carry on')]), false);
  });
  test('prose mentioning DONE: mid-line, empty and garbage lines: not finished', () => {
    assert.equal(transcriptFinished([text('I am not DONE: yet')]), false);
    assert.equal(transcriptFinished([]), false);
    assert.equal(transcriptFinished(['', 'not json', '{']), false);
  });
});

describe('dispatchEvidence (LIN-3669)', () => {
  test('200 with a terminal status is terminal; skipped and live statuses are open', () => {
    for (const s of ['done', 'failed', 'aborted', 'closed']) assert.equal(dispatchEvidence({ status: 200, json: { status: s } }), 'terminal', s);
    for (const s of ['skipped', 'taken', 'queued', 'running']) assert.equal(dispatchEvidence({ status: 200, json: { status: s } }), 'open', s);
  });
  test('a 404 is gone (LIN-3676); any other non-200, a missing body or a thrown call is unreadable', () => {
    assert.equal(dispatchEvidence({ status: 404, json: { error: 'nf' } }), 'gone');
    assert.equal(dispatchEvidence({ status: 500, json: { error: 'boom' } }), 'unreadable');
    assert.equal(dispatchEvidence({ status: 500, json: null }), 'unreadable');
    assert.equal(dispatchEvidence(null), 'unreadable');
  });
});

describe('isHeartbeatStale (N1, shared with the broker)', () => {
  const MAX = 10 * 60_000;
  test('fresh', () => assert.equal(isHeartbeatStale(NOW - 60_000, NOW, MAX, 30_000), false));
  test('stale', () => assert.equal(isHeartbeatStale(NOW - MAX - 1, NOW, MAX, 30_000), true));
  test('sleep gap', () => assert.equal(isHeartbeatStale(NOW - MAX - 1, NOW, MAX, 60 * 60_000), false));
});

describe('sumTranscriptUsage and [usage] (NB5: the realised model)', () => {
  const lines = readFileSync(FIXTURE, 'utf8').split('\n');

  test('sums each message once (repeated blocks share an id) and picks the model with the most output', () => {
    const u = sumTranscriptUsage(lines);
    assert.deepEqual(u, {
      harness: 'claude-code',
      model: 'claude-opus-5-5',
      inputTokens: 130,
      outputTokens: 1050,
      cacheCreationInputTokens: 1500,
      cacheCreation1hInputTokens: 200,
      cacheReadInputTokens: 12300
    });
  });

  test('round-trips through parseUsage with harness and the realised model', () => {
    const msg = usageMessage(sumTranscriptUsage(lines));
    assert.ok(msg.startsWith('[usage] {'));
    assert.ok(msg.length <= 2000);
    const parsed = parseUsage([{ kind: 'usage', message: msg }]);
    assert.equal(parsed.harness, 'claude-code');
    assert.equal(parsed.model, 'claude-opus-5-5');
    assert.equal(parsed.outputTokens, 1050);
  });

  test('no readable transcript: harness only, which reads unpriced, never a false $0', () => {
    const u = sumTranscriptUsage([]);
    assert.deepEqual(u, { harness: 'claude-code' });
    const parsed = parseUsage([{ kind: 'usage', message: usageMessage(u) }]);
    assert.equal(parsed.harness, 'claude-code');
    assert.equal(parsed.costUsd, null);
  });

  test('the realised model wins over the item\'s requested one', () => {
    const msg = usageMessage(sumTranscriptUsage(lines), { requestedModel: 'claude-sonnet-5-5' });
    assert.equal(parseUsage([{ kind: 'usage', message: msg }]).model, 'claude-opus-5-5');
  });
});

describe('sumTranscriptUsage on the LIN-3098 witness subagent (LIN-3212)', () => {
  // Redacted copy of the real agent-a010f7d2462c56e56.jsonl behind the witness's `output 8`.
  const lines = readFileSync(join(ROOT, 'tests', 'fixtures', 'runner-kit', 'subagent-report.jsonl'), 'utf8').split('\n');
  const assistant = lines.filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === 'assistant');

  test('reproduces the witness [usage] exactly', () => {
    assert.deepEqual(sumTranscriptUsage(lines), {
      harness: 'claude-code',
      model: 'claude-opus-5-5',
      inputTokens: 4,
      outputTokens: 8,
      cacheCreationInputTokens: 28668,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 26344
    });
  });

  test('every line is an unfinished (message_start) snapshot, and repeats are identical', () => {
    // No line ever got its final usage (stop_reason stays null), so the transcript
    // itself under-records output; no per-id fold (first, last or max) can recover it.
    assert.ok(assistant.every((e) => e.message.stop_reason === null));
    const usageById = new Map();
    for (const e of assistant) {
      const usage = JSON.stringify(e.message.usage);
      if (usageById.has(e.message.id)) assert.equal(usage, usageById.get(e.message.id));
      else usageById.set(e.message.id, usage);
    }
    assert.equal(usageById.size, 2);
  });
});

describe('sumTranscriptUsage folds repeated snapshots per message.id (LIN-3212)', () => {
  // Redacted copy of a real subagent transcript (agent-a71d290649df73567.jsonl,
  // Claude Code 2.1.286, this host). Shape A: the report message is written across
  // several lines sharing one message.id while the streamed usage grows
  // (`output_tokens` 4 → 4 → 535). Keeping the FIRST snapshot under-counts it.
  const lines = readFileSync(join(ROOT, 'tests', 'fixtures', 'runner-kit', 'subagent-streamed.jsonl'), 'utf8').split('\n');
  const assistant = lines.filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === 'assistant');

  test('keeps the largest snapshot per repeated message.id, not the first', () => {
    assert.deepEqual(sumTranscriptUsage(lines), {
      harness: 'claude-code',
      model: 'claude-sonnet-5-5',
      inputTokens: 6,
      outputTokens: 1108,
      cacheCreationInputTokens: 11490,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 66045
    });
  });

  test('the fixture really is shape A: a repeated id whose later snapshot is larger', () => {
    const byId = new Map();
    for (const e of assistant) {
      if (!e.message.id) continue;
      if (!byId.has(e.message.id)) byId.set(e.message.id, []);
      byId.get(e.message.id).push(e.message.usage.output_tokens);
    }
    const growing = [...byId.values()].find((outs) => new Set(outs).size > 1);
    assert.ok(growing, 'expected at least one message.id with differing snapshots');
    assert.equal(growing[0], 4); // first-wins would record this
    assert.equal(Math.max(...growing), 535); // max-per-id records this
  });

  test('takes the MAX of each field, not the last snapshot, and a line with no id is its own message', () => {
    // Synthetic (review 2363ff88, ledger items 3 and 4): the real fixture is
    // monotonic, so last-wins passes it. Here msg_a's fields peak on different
    // snapshots, so first-wins, last-wins and max all disagree.
    const line = (id, [input, output, cacheCreation, cacheCreation1h, cacheRead]) => JSON.stringify({
      type: 'assistant',
      message: {
        ...(id ? { id } : {}),
        model: 'claude-sonnet-5-5',
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_creation_input_tokens: cacheCreation,
          cache_creation: { ephemeral_1h_input_tokens: cacheCreation1h },
          cache_read_input_tokens: cacheRead
        }
      }
    });
    const u = sumTranscriptUsage([
      line('msg_a', [10, 4, 500, 200, 1000]),
      line('msg_a', [12, 300, 500, 200, 900]),
      line('msg_a', [11, 250, 0, 0, 1200]), // later and lower on input, output and cache creation
      line('msg_b', [3, 50, 0, 0, 100]),
      line(null, [2, 7, 0, 0, 0]),
      line(null, [2, 7, 0, 0, 0]) // identical, but no id: a second message, not a repeat
    ]);
    assert.deepEqual(u, {
      harness: 'claude-code',
      model: 'claude-sonnet-5-5',
      inputTokens: 12 + 3 + 2 + 2,
      outputTokens: 300 + 50 + 7 + 7,
      cacheCreationInputTokens: 500,
      cacheCreation1hInputTokens: 200,
      cacheReadInputTokens: 1200 + 100
    });
  });
});

describe('subagentModelFor (NB5: map model onto the subagent, ignore effort)', () => {
  const rows = [
    [null, null],
    ['claude-opus-5-5', 'opus'],
    ['claude-sonnet-5-5', 'sonnet'],
    ['claude-haiku-4-5-20251001', 'haiku'],
    ['opus', 'opus'],
    ['gpt-5', null],
    ['', null],
    // LIN-3857 (D3): `fable` stays unmapped (inherit) until a recorded runner-kit run settles it.
    ['fable', null],
    ['claude-fable-5-1', null]
  ];
  for (const [model, want] of rows) {
    test(`model ${JSON.stringify(model)} → ${want ?? 'inherit'}`, () => {
      assert.equal(subagentModelFor(item({ model })).model, want);
    });
  }
  test('effort is recorded as not applied', () => {
    const r = subagentModelFor(item({ model: 'claude-opus-5-5', effort: 'high' }));
    assert.equal(r.effort, null);
    assert.match(r.note, /effort/);
  });
});

describe('subagentModelFor names what it dropped (LIN-3857)', () => {
  test('an unmapped model is named in the note and flagged dropped; a mapped one is not', () => {
    const fable = subagentModelFor(item({ model: 'fable' }));
    assert.equal(fable.model, null);
    assert.equal(fable.dropped, true);
    assert.match(fable.note, /inherit \(runner session's own\); "fable" is not a mapped Task-tool alias/);
    assert.equal(subagentModelFor(item({ model: 'claude-opus-5-5' })).dropped, false);
    assert.equal(subagentModelFor(item({})).dropped, false, 'nothing asked for, nothing dropped');
  });
  test('an effort alone is flagged dropped', () => {
    assert.equal(subagentModelFor(item({ model: 'sonnet', effort: 'high' })).dropped, true);
  });
});

describe('markers', () => {
  test('[subagent] (LIN-3857) matches neither the terminal nor the wake parser', () => {
    const m = `[subagent] ${subagentModelFor(item({ model: 'fable', effort: 'high' })).note}`;
    assert.equal(findTerminalFeedback(fb(m)), null);
    assert.equal(findWakeEvent(fb(m)), null);
  });

  test('[handoff] matches neither the terminal nor the wake parser', () => {
    for (const m of [handoffMessage(K, 'agent-1', null), handoffMessage(W1, 'agent-1', K)]) {
      assert.equal(findTerminalFeedback(fb(m)), null);
      assert.equal(findWakeEvent(fb(m)), null);
    }
    assert.equal(handoffMessage(K, 'agent-1', null), `[handoff] item ${K} → subagent agent-1 (new)`);
    assert.equal(handoffMessage(W1, 'agent-1', K), `[handoff] item ${W1} → subagent agent-1 (continued from ${K})`);
  });

  test('postTakeCheck: an equal take passes; a mismatch is [skipped] refused, terminal but not a wake (B1)', () => {
    const polled = { id: X, promptSha256: promptDigest('do the step'), followUpTo: null, abort: false, abortTo: null, dispatchedBy: OWNER };
    assert.equal(postTakeCheck(polled, item()), null);
    const msg = postTakeCheck(polled, item({ prompt: 'swapped' }));
    assert.match(msg, /^\[skipped\] refused: /);
    assert.equal(findTerminalFeedback(fb(msg)).status, 'skipped');
    assert.equal(findWakeEvent(fb(msg)), null);
    assert.match(postTakeCheck(polled, item({ dispatchedBy: STRANGER })), /^\[skipped\] refused: /);
    assert.match(postTakeCheck(polled, item({ followUpTo: K })), /^\[skipped\] refused: /);
  });
});

describe('feedbackBody (NB1: every post carries the lineage rootItemId)', () => {
  test('a wake continuing the orchestrator posts with the kickoff as rootItemId', () => {
    const ledger = ledgerWith([
      { itemId: K, agentId: 'orch', rootItemId: K, state: 'done' },
      { itemId: W1, agentId: 'orch', rootItemId: K, state: 'running' }
    ]);
    assert.deepEqual(feedbackBody(ledger, W1, 'usage', '[usage] {}'), { message: '[usage] {}', kind: 'usage', rootItemId: K });
  });
  test('an item not in the ledger anchors on itself', () => {
    assert.deepEqual(feedbackBody(ledgerWith([]), X, 'status', '[done]'), { message: '[done]', kind: 'status', rootItemId: X });
  });
});

describe('NB1 against the real store and buildTaskCost: kickoff + two wakes count once', () => {
  let dbDir, client;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'rk-nb1-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  async function runLineage({ tagged }) {
    const db = client.db(`nb1_${tagged ? 'tagged' : 'untagged'}`);
    const store = new DispatchQueueStore({ collection: db.collection('q'), historyCollection: db.collection('h') });
    const urlKey = 'acme';
    const tokenId = 'runner-token-id';
    const snapshots = [
      { outputTokens: 1000, inputTokens: 10 },
      { outputTokens: 2000, inputTokens: 20 },
      { outputTokens: 3000, inputTokens: 30 }
    ];
    // addItem returns the stored doc, keyed `_id`.
    const kick = await store.addItem(urlKey, { prompt: 'kickoff', kind: 'autopilot', dispatchedBy: OWNER });
    const ids = [kick._id];
    for (let i = 0; i < 2; i++) {
      const w = await store.addItem(urlKey, { prompt: `wake ${i}`, kind: 'wake', followUpTo: kick._id });
      ids.push(w._id);
    }
    let ledger = { items: {} };
    for (const [i, id] of ids.entries()) {
      await store.takeItem(id, urlKey, 'runner', tokenId);
      ledger.items[id] = { itemId: id, agentId: 'orch', rootItemId: kick._id, state: 'running' };
      // A priced model, so "counts once" compares real dollar figures
      // (claude-opus-5-5 stays unpriced until LIN-3094).
      const usage = { harness: 'claude-code', model: PRICED_MODEL, ...snapshots[i] };
      const body = tagged
        ? feedbackBody(ledger, id, 'usage', usageMessage(usage))
        : { message: usageMessage(usage), kind: 'usage' };
      const res = await store.addFeedback(id, urlKey, body, 'runner', null, { takenByTokenId: tokenId });
      assert.ok(res, 'feedback accepted');
    }
    const rows = [];
    for (const id of ids) rows.push({ ...(await store.getItemFeedback(urlKey, id)), status: 'taken' });
    return buildTaskCost({ ownRows: rows });
  }

  const costOf = (snap) => parseUsage([{ kind: 'usage', message: usageMessage({ harness: 'claude-code', model: PRICED_MODEL, ...snap }) }]).costUsd;

  test('tagged (the runner): one worker session, costed once at the last cumulative snapshot', TIMEOUT, async () => {
    const cost = await runLineage({ tagged: true });
    assert.equal(cost.workerSessions.length, 1);
    const last = costOf({ outputTokens: 3000, inputTokens: 30 });
    assert.equal(typeof last, 'number');
    assert.equal(cost.workerSessions[0].costUsd, last);
    assert.equal(cost.totalUsd, last);
  });

  test('untagged (the bug NB1 prevents): three sessions, every snapshot summed', TIMEOUT, async () => {
    const cost = await runLineage({ tagged: false });
    assert.equal(cost.workerSessions.length, 3);
    const summed = costOf({ outputTokens: 1000, inputTokens: 10 }) + costOf({ outputTokens: 2000, inputTokens: 20 }) + costOf({ outputTokens: 3000, inputTokens: 30 });
    assert.ok(Math.abs(cost.totalUsd - summed) < 1e-9);
    assert.ok(cost.totalUsd > costOf({ outputTokens: 3000, inputTokens: 30 }));
  });
});

describe('parseCredentialBlock', () => {
  const boot = randomBytes(24).toString('base64url');
  test('reads the /runner credential block', () => {
    const text = [
      '## Your runner credential',
      '- baseUrl: https://harbour.cat',
      '- urlKey: acme',
      `- ownerAccountId: ${OWNER}`,
      `- bootstrap: \`${boot}\``,
      '- expiresAt: 2026-09-29T13:00:00.000Z',
      '',
      'Pipe this into `runner.mjs login`; never echo it.'
    ].join('\n');
    assert.deepEqual(parseCredentialBlock(text), {
      baseUrl: 'https://harbour.cat', urlKey: 'acme', ownerAccountId: OWNER, bootstrap: boot, expiresAt: '2026-09-29T13:00:00.000Z'
    });
  });
  test('a bare token is the bootstrap', () => {
    assert.equal(parseCredentialBlock(`${boot}\n`).bootstrap, boot);
  });
});

describe('tokenFingerprint', () => {
  test('stable, short, and not the token', () => {
    const t = randomBytes(32).toString('base64url');
    assert.equal(tokenFingerprint(t), tokenFingerprint(t));
    assert.match(tokenFingerprint(t), /^sha256:[0-9a-f]{16}$/);
    assert.ok(!tokenFingerprint(t).includes(t));
  });
});

describe('credentialStore file backend (the runner\'s own credential at rest)', () => {
  test('mode-600 file inside a mode-700 dir; get/clear round-trip', () => {
    const tmp = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'rk-'));
    try {
      const file = join(tmp, 'acme', 'runner.token');
      const store = credentialStore({ file });
      const t = randomBytes(32).toString('base64url');
      store.set(t);
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(file)).mode & 0o777, 0o700);
      assert.equal(credentialStore({ file }).get(), t);
      assert.ok(!JSON.stringify(store).includes(t));
      store.clear();
      assert.equal(existsSync(file), false);
      assert.equal(store.get(), null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a token file readable by others is refused (fail closed)', () => {
    const tmp = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'rk-'));
    try {
      const file = join(tmp, 'acme', 'runner.token');
      credentialStore({ file }).set('x'.repeat(43));
      chmodSync(file, 0o644);
      assert.throws(() => credentialStore({ file }).get(), /mode 600/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ─── Commands against a fake Harbour ─────────────────────────────────────────

const token = () => randomBytes(32).toString('base64url');

/** A fake Harbour with the runner surface, the watch and /prompt reads, and the exchange. */
async function fakeHarbour() {
  const state = {
    runnerBootstrap: token(),
    runnerWorking: token(),
    itemBootstraps: new Map(), // bootstrap -> working
    queue: [],
    history: new Map(),
    feedback: [],
    halt: null,
    otherConsumerLastSeenAt: null,
    takes: [],
    watch: new Map(),
    watchFail: new Map(), // id -> HTTP status the dispatch read answers instead (LIN-3676: 500 is unreadable, 404 is gone)
    watchReads: [], // every id the dispatch read was asked for
    promptOverride: new Map()
  };
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const auth = req.headers.authorization || '';
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/proxy/token') {
      const presented = auth.slice(7);
      if (presented === state.runnerBootstrap) {
        state.runnerBootstrap = null;
        return json(res, 200, { token: state.runnerWorking, scope: 'readWrite', grants: ['take', 'dispatch'], expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() });
      }
      if (state.itemBootstraps.has(presented)) {
        const working = state.itemBootstraps.get(presented);
        state.itemBootstraps.delete(presented);
        return json(res, 200, { token: working, scope: 'readWrite', expiresAt: '2099-01-01T00:00:00.000Z' });
      }
      return json(res, 401, { error: 'spent' });
    }
    const isRunner = auth === `Bearer ${state.runnerWorking}`;
    const isItemWorker = [...state.history.values()].some((h) => h.workerToken && auth === `Bearer ${h.workerToken}`);
    if (!isRunner && !isItemWorker) return json(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && url.pathname === '/api/proxy/runner/poll') {
      return json(res, 200, { items: state.queue, ...(state.halt ? { halt: state.halt } : {}), otherConsumerLastSeenAt: state.otherConsumerLastSeenAt });
    }
    let m;
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/proxy\/runner\/take\/(.+)$/))) {
      const idx = state.queue.findIndex((i) => i.id === m[1]);
      if (idx === -1) return json(res, 404, { error: 'gone' });
      const [it] = state.queue.splice(idx, 1);
      const taken = { ...it, ...(state.promptOverride.get(it.id) || {}) };
      state.history.set(it.id, { ...taken, workerToken: taken.bootstrapToken ? state.itemBootstraps.get(taken.bootstrapToken) : null });
      state.takes.push(it.id);
      return json(res, 200, { item: taken, dispatchId: it.id });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/proxy\/runner\/feedback\/(.+)$/))) {
      if (!state.history.has(m[1])) return json(res, 404, { error: 'not taken' });
      state.feedback.push({ itemId: m[1], body: JSON.parse(raw) });
      return json(res, 200, { success: true });
    }
    if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/proxy\/dispatch\/([^/]+)\/prompt$/))) {
      const it = state.queue.find((i) => i.id === m[1]) || state.history.get(m[1]);
      if (!it) return json(res, 404, { error: 'nf' });
      return json(res, 200, { id: it.id, prompt: it.prompt, followUpTo: it.followUpTo || null, kind: it.kind });
    }
    if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/proxy\/dispatch\/([^/]+)$/))) {
      state.watchReads.push(m[1]);
      if (state.watchFail.has(m[1])) return json(res, state.watchFail.get(m[1]), { error: 'fail' });
      // A taken item is live on Harbour unless a test says otherwise; an id it never saw is gone (404).
      const w = state.watch.get(m[1]) || (state.history.has(m[1]) ? { id: m[1], status: 'taken' } : null);
      return w ? json(res, 200, w) : json(res, 404, { error: 'nf' });
    }
    return json(res, 200, { ok: true, url: req.url });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    base: `http://127.0.0.1:${server.address().port}`,
    enqueue(over = {}) {
      const bootstrap = over.bootstrapToken === null ? null : token();
      if (bootstrap) state.itemBootstraps.set(bootstrap, token());
      const it = item({ id: randomUUID(), bootstrapToken: bootstrap, ...over });
      state.queue.push(it);
      return it;
    },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); })
  };
}

describe('openItems (LIN-3213)', () => {
  const row = (state, over = {}) => ({ itemId: `${state}-1`, rootItemId: `${state}-1`, state, ...over });
  const ledger = (...rs) => ({ items: Object.fromEntries(rs.map((r) => [r.itemId, r])) });
  const cases = [
    { name: 'a running row is listed', ledger: ledger(row('running')), ids: ['running-1'] },
    { name: 'done is not listed', ledger: ledger(row('done')), ids: [] },
    { name: 'lost is not listed', ledger: ledger(row('lost')), ids: [] },
    { name: 'stopped is not listed', ledger: ledger(row('stopped')), ids: [] },
    { name: 'only the running rows of a mixed ledger are listed', ledger: ledger(row('running'), row('done'), row('lost'), row('stopped')), ids: ['running-1'] },
    { name: 'an empty ledger lists nothing', ledger: { items: {} }, ids: [] },
    { name: 'a missing ledger lists nothing', ledger: undefined, ids: [] }
  ];
  for (const c of cases) {
    test(c.name, () => assert.deepEqual(runnerKit.openItems(c.ledger).map((r) => r.itemId), c.ids));
  }
});

describe('debounceWork (LIN-3213)', () => {
  const W = 120_000;
  const NOW = 1_000_000_000;
  const cases = [
    { name: 'new id is reported and recorded', ids: ['a'], seen: {}, report: ['a'], next: { a: NOW } },
    { name: 'young entry is suppressed and nothing is written', ids: ['a'], seen: { a: NOW - 1000 }, report: [], next: null },
    { name: 'entry exactly at the window is reported again', ids: ['a'], seen: { a: NOW - W }, report: ['a'], next: { a: NOW } },
    { name: 'expired entry is reported again and refreshed', ids: ['a'], seen: { a: NOW - W - 1 }, report: ['a'], next: { a: NOW } },
    { name: 'expired entries for other ids are dropped on write', ids: ['b'], seen: { a: NOW - W - 1, c: NOW - 5 }, report: ['b'], next: { c: NOW - 5, b: NOW } },
    { name: 'mixed: young suppressed, new reported', ids: ['a', 'b'], seen: { a: NOW - 5 }, report: ['b'], next: { a: NOW - 5, b: NOW } },
    { name: 'nothing reported means no write', ids: ['a'], seen: { a: NOW - 5 }, report: [], next: null }
  ];
  for (const c of cases) {
    test(c.name, () => {
      const r = runnerKit.debounceWork(c.ids, c.seen, NOW, W);
      assert.deepEqual(r.report, c.report);
      assert.deepEqual(r.next, c.next);
    });
  }
  test('the window is 2 minutes', () => assert.equal(runnerKit.WAIT_DEBOUNCE_MS, 2 * 60 * 1000));
});

describe('commands (against a fake Harbour)', () => {
  let home, harbour, outputs;
  const run = async (argv, extra = {}) => {
    const out = await runCommand(argv, { home, now: () => Date.now(), transcriptRoot: join(home, 'transcripts'), ...extra });
    outputs.push(JSON.stringify(out));
    return out;
  };

  before(async () => {
    home = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'rk-'));
    harbour = await fakeHarbour();
    outputs = [];
  }, TIMEOUT);

  // Teardown never throws before the fake server is closed: a leaked
  // listener would keep the file alive instead of failing it.
  after(async () => {
    try {
      const ledger = JSON.parse(readFileSync(join(home, 'acme', 'ledger.json'), 'utf8'));
      for (const id of Object.keys(ledger.items || {})) {
        await runCommand(['stop-broker', id, '--url-key', 'acme'], { home }).catch(() => {});
      }
    } catch { /* no ledger: nothing was taken */ }
    await harbour?.close();
    if (home) rmSync(home, { recursive: true, force: true });
  });

  test('recover before any login mints a session and has nothing to do', TIMEOUT, async () => {
    const r = await run(['recover', '--url-key', 'acme']);
    assert.match(r.session, /^[0-9a-f]{16}$/);
    assert.deepEqual(r.fail, []);
  });

  test('login exchanges the stdin credential block itself; the token lands mode 600, never in output', TIMEOUT, async () => {
    const block = `- baseUrl: ${harbour.base}\n- urlKey: acme\n- ownerAccountId: ${OWNER}\n- bootstrap: ${harbour.state.runnerBootstrap}\n`;
    const r = await run(['login'], { stdin: block });
    assert.equal(r.ok, true);
    assert.deepEqual(r.grants, ['take', 'dispatch']);
    const file = join(home, 'acme', 'runner.token');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(home, 'acme')).mode & 0o777, 0o700);
    const stateFile = readFileSync(join(home, 'acme', 'runner.json'), 'utf8');
    assert.ok(!stateFile.includes(harbour.state.runnerWorking));
    assert.equal(JSON.parse(stateFile).ownerAccountId, OWNER);
  });

  test('poll decides per item, leaves refused items queued, and prints no prompt or bootstrap', TIMEOUT, async () => {
    const mine = harbour.enqueue();
    const foreign = harbour.enqueue({ dispatchedBy: STRANGER, sessionId: mine.id });
    const oc = harbour.enqueue({ harness: 'opencode' });
    const r = await run(['poll']);
    const by = Object.fromEntries(r.decisions.map((d) => [d.id, d]));
    assert.equal(by[mine.id].decision, 'take');
    assert.equal(by[foreign.id].decision, 'leave');
    assert.equal(by[foreign.id].reason, 'not-owner');
    assert.equal(by[oc.id].decision, 'leave');
    const printed = JSON.stringify(r);
    assert.ok(!printed.includes(mine.bootstrapToken));
    assert.ok(!printed.includes('do the step'), 'no prompt text on poll');
    assert.deepEqual(harbour.state.takes, [], 'poll never takes');
  });

  test('take refuses an item poll did not approve (B1: refused items are never taken)', TIMEOUT, async () => {
    const foreign = harbour.state.queue.find((i) => i.dispatchedBy === STRANGER);
    await assert.rejects(run(['take', foreign.id]), /poll/);
    assert.ok(harbour.state.queue.some((i) => i.id === foreign.id), 'still queued');
  });

  test('take starts the item\'s broker and prints the prompt and environment, never the bootstrap', TIMEOUT, async () => {
    const mine = harbour.state.queue.find((i) => i.dispatchedBy === OWNER && !i.harness);
    const r = await run(['take', mine.id]);
    assert.equal(r.prompt, 'do the step');
    assert.equal(r.handoff.mode, 'new');
    assert.ok(r.broker && r.broker.socket);
    assert.match(r.environment, /HARBOUR_LOCAL_BASE=http:\/\/harbour-runner\.invalid/);
    assert.match(r.environment, /--unix-socket/);
    assert.ok(!JSON.stringify(r).includes(mine.bootstrapToken));
    // The broker answers over its socket with the item's own worker token.
    const res = await new Promise((resolve, reject) => {
      const req = http.request({ socketPath: r.broker.socket, path: '/api/proxy/issues/LIN-1', headers: { Host: 'harbour-runner.invalid' } }, (s) => { s.resume(); s.on('end', () => resolve(s.statusCode)); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(res, 200);
  });

  test('handoff records the subagent and posts the [handoff] marker with rootItemId', TIMEOUT, async () => {
    const itemId = harbour.state.takes.at(-1);
    await run(['handoff', itemId, 'agent-1']);
    const post = harbour.state.feedback.at(-1);
    assert.equal(post.itemId, itemId);
    assert.equal(post.body.message, `[handoff] item ${itemId} → subagent agent-1 (new)`);
    assert.equal(post.body.kind, 'status');
    assert.equal(post.body.rootItemId, itemId);
  });

  test('usage posts the realised model from the subagent transcript, kind usage, with rootItemId', TIMEOUT, async () => {
    const itemId = harbour.state.takes.at(-1);
    const dir = join(home, 'transcripts', 'proj', 'sess', 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent-agent-1.jsonl'), readFileSync(FIXTURE));
    await run(['usage', 'agent-1']);
    const post = harbour.state.feedback.at(-1);
    assert.equal(post.body.kind, 'usage');
    assert.equal(post.body.rootItemId, itemId);
    assert.equal(parseUsage([{ kind: 'usage', message: post.body.message }]).model, 'claude-opus-5-5');
  });

  test('feedback [done] posts with rootItemId, marks the row done and stops its broker', TIMEOUT, async () => {
    const itemId = harbour.state.takes.at(-1);
    const socket = JSON.parse(readFileSync(join(home, 'acme', 'ledger.json'), 'utf8')).items[itemId].socket;
    await run(['feedback', itemId, 'status', '[done]']);
    const post = harbour.state.feedback.at(-1);
    assert.deepEqual(post.body, { message: '[done]', kind: 'status', rootItemId: itemId });
    const ledger = JSON.parse(readFileSync(join(home, 'acme', 'ledger.json'), 'utf8'));
    assert.equal(ledger.items[itemId].state, 'done');
    assert.equal(existsSync(socket), false, 'broker stopped at the terminal');
  });

  test('a follow-up continues the same subagent and its posts anchor on the first item (NB1)', TIMEOUT, async () => {
    const first = harbour.state.takes.at(-1);
    const fu = harbour.enqueue({ followUpTo: first });
    const polled = await run(['poll']);
    assert.equal(polled.decisions.find((d) => d.id === fu.id).decision, 'take');
    const r = await run(['take', fu.id]);
    assert.equal(r.handoff.mode, 'continue');
    assert.equal(r.handoff.agentId, 'agent-1');
    await run(['handoff', fu.id, 'agent-1']);
    const post = harbour.state.feedback.at(-1);
    assert.equal(post.body.message, `[handoff] item ${fu.id} → subagent agent-1 (continued from ${first})`);
    assert.equal(post.body.rootItemId, first);
    await run(['feedback', fu.id, 'status', '[done]']);
    assert.equal(harbour.state.feedback.at(-1).body.rootItemId, first);
  });

  test('a take whose item changed after poll closes with [skipped] refused and starts nothing', TIMEOUT, async () => {
    const it = harbour.enqueue();
    await run(['poll']);
    harbour.state.promptOverride.set(it.id, { prompt: 'swapped after poll' });
    const r = await run(['take', it.id]);
    assert.match(r.refused, /^\[skipped\] refused: /);
    assert.equal(r.prompt, undefined);
    const post = harbour.state.feedback.at(-1);
    assert.equal(post.itemId, it.id);
    assert.match(post.body.message, /^\[skipped\] refused: /);
  });

  test('a broker that cannot start closes the taken row with [failed], never leaving it silently taken', TIMEOUT, async () => {
    const it = harbour.enqueue();
    await run(['poll']);
    harbour.state.itemBootstraps.delete(it.bootstrapToken); // its exchange will 401
    const r = await run(['take', it.id]);
    assert.match(r.failed, /^\[failed\] runner could not start this item's broker/);
    assert.equal(r.prompt, undefined);
    const post = harbour.state.feedback.at(-1);
    assert.equal(post.itemId, it.id);
    assert.equal(post.body.message, r.failed);
    assert.ok(!r.failed.includes(it.bootstrapToken));
    const ledger = JSON.parse(readFileSync(join(home, 'acme', 'ledger.json'), 'utf8'));
    assert.equal(ledger.items[it.id], undefined);
  });

  test('an abort row stops a running subagent: ack on the abort row, same line on the target', TIMEOUT, async () => {
    const target = harbour.enqueue();
    await run(['poll']);
    await run(['take', target.id]);
    await run(['handoff', target.id, 'agent-2']);
    const abortRow = harbour.enqueue({ abort: true, abortTo: target.id, prompt: null, bootstrapToken: null });
    await run(['poll']);
    const r = await run(['take', abortRow.id]);
    assert.equal(r.abort.stopAgent, 'agent-2');
    const line = `[aborted] Cancelled running session ${target.id.slice(0, 8)} (running).`;
    const posts = harbour.state.feedback.slice(-2);
    assert.deepEqual(posts.map((p) => [p.itemId, p.body.message]), [[abortRow.id, line], [target.id, line]]);
  });

  test('NB2: poll aborts when another consumer polled recently', TIMEOUT, async () => {
    harbour.state.otherConsumerLastSeenAt = new Date().toISOString();
    const r = await run(['poll']);
    assert.equal(r.abort, true);
    assert.ok(r.decisions.every((d) => d.decision !== 'take'));
    harbour.state.otherConsumerLastSeenAt = null;
  });

  test('a stop halt sweeps running subagents and keeps them in the ledger as stopped (N4)', TIMEOUT, async () => {
    const it = harbour.enqueue();
    await run(['poll']);
    await run(['take', it.id]);
    await run(['handoff', it.id, 'agent-3']);
    harbour.state.halt = { mode: 'stop', setAt: new Date().toISOString(), setBy: OWNER };
    const r = await run(['poll']);
    assert.ok(r.stopAgents.includes('agent-3'));
    const ledger = JSON.parse(readFileSync(join(home, 'acme', 'ledger.json'), 'utf8'));
    assert.equal(ledger.items[it.id].state, 'stopped');
    assert.equal(harbour.state.feedback.at(-1).body.message, `[aborted] Cancelled running session ${it.id.slice(0, 8)} (stopped by operator).`);
    harbour.state.halt = null;
    // After the stop clears, a follow-up continues the stopped subagent.
    const fu = harbour.enqueue({ followUpTo: it.id });
    await run(['poll']);
    const t = await run(['take', fu.id]);
    assert.equal(t.handoff.mode, 'continue');
    assert.equal(t.handoff.agentId, 'agent-3');
  });

  test('a stop halt takes a follow-up with no live session and fails it; one that can resume stays queued (LIN-3670)', TIMEOUT, async () => {
    const first = harbour.enqueue();
    await run(['poll']);
    await run(['take', first.id]);
    await run(['handoff', first.id, 'agent-4']);
    await run(['feedback', first.id, 'status', '[done]']);
    harbour.state.halt = { mode: 'stop', setAt: new Date().toISOString(), setBy: OWNER };
    const orphan = harbour.enqueue({ followUpTo: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
    const resumable = harbour.enqueue({ followUpTo: first.id });
    const polled = await run(['poll']);
    assert.equal(polled.decisions.find((d) => d.id === orphan.id).decision, 'take');
    assert.equal(polled.decisions.find((d) => d.id === resumable.id).decision, 'leave');
    const t = await run(['take', orphan.id]);
    assert.equal(t.rejected, '[failed] No live session to resume for follow-up (original dispatch ffffffff-ffff-4fff-8fff-ffffffffffff not found or already archived).');
    const post = harbour.state.feedback.at(-1);
    assert.equal(post.itemId, orphan.id);
    assert.equal(post.body.message, t.rejected);
    harbour.state.halt = null;
    await run(['poll']); // records the cleared halt, as the stop test above does, so a later `wait` sees no change
  });

  test('wait refreshes the heartbeat and exits on work', TIMEOUT, async () => {
    harbour.enqueue();
    const hb = join(home, 'acme', 'runner.heartbeat');
    rmSync(hb, { force: true });
    const r = await run(['wait'], { waitPollMs: 20, waitHeartbeatMs: 10 });
    assert.equal(r.reason, 'work');
    assert.ok(existsSync(hb));
  });

  test('wait exits when the halt changes', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    await run(['poll']);
    harbour.state.halt = { mode: 'pause', setAt: new Date().toISOString(), setBy: OWNER };
    const r = await run(['wait'], { waitPollMs: 20, waitHeartbeatMs: 10 });
    assert.equal(r.reason, 'halt');
    harbour.state.halt = null;
    await run(['poll']);
  });

  test('wait exits at its cap when nothing happens', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    const r = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 60 });
    assert.equal(r.reason, 'cap');
  });

  // LIN-3667: `credential` is the 401 only; a call that failed before any reply is `network` (transient, re-arm).
  test('wait on a refused connection returns network, with the cause in the message', TIMEOUT, async () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }) });
    const r = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 60, fetchImpl: async () => { throw refused; } });
    assert.equal(r.reason, 'network');
    assert.match(r.message, /ECONNREFUSED/);
  });

  test('wait on a 401 returns credential', TIMEOUT, async () => {
    const r = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 60, fetchImpl: async () => new Response('{"error":"unauthorized"}', { status: 401 }) });
    assert.equal(r.reason, 'credential');
    assert.match(r.message, /rejected \(expired or revoked\)/);
  });

  // LIN-3685: the wake item's root read (`GET /api/proxy/dispatch/:id`) follows a good poll; it classifies like the poll does.
  test('wait returns network when the wake root read is refused after a good poll', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    const root = harbour.enqueue();
    harbour.enqueue({ kind: 'wake', dispatchedBy: null, followUpTo: root.id });
    const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }) });
    const fetchImpl = async (url, init) => {
      if (/\/api\/proxy\/dispatch\/[^/]+$/.test(String(url))) throw refused;
      return fetch(url, init);
    };
    const r = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 60, fetchImpl });
    assert.equal(r.reason, 'network');
    assert.match(r.message, /ECONNREFUSED/);
    harbour.state.queue.length = 0;
  });

  test('wait returns credential when the wake root read gets a 401 after a good poll', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    const root = harbour.enqueue();
    harbour.enqueue({ kind: 'wake', dispatchedBy: null, followUpTo: root.id });
    const fetchImpl = async (url, init) => {
      if (/\/api\/proxy\/dispatch\/[^/]+$/.test(String(url))) return new Response('{"error":"unauthorized"}', { status: 401 });
      return fetch(url, init);
    };
    const r = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 60, fetchImpl });
    assert.equal(r.reason, 'credential');
    assert.match(r.message, /rejected \(expired or revoked\)/);
    harbour.state.queue.length = 0;
  });

  // LIN-3451: the target gate lives in preConfirmDecision, which wait calls too; a dash item is not work.
  test('wait does not report a dash-target item as work (left queued, target:dash)', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    const dash = harbour.enqueue({ target: 'dash' });
    assert.deepEqual(preConfirmDecision(dash, ctx()), { decision: 'leave', reason: 'target:dash' });
    const r = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 60 });
    assert.equal(r.reason, 'cap');
    harbour.state.queue.length = 0;
  });

  describe('wait debounce (LIN-3213)', () => {
    const seenFile = () => join(home, 'acme', 'wait-seen.json');
    const quick = { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 80 };

    test('wait returns work, and an immediate second wait returns cap, not work', TIMEOUT, async () => {
      harbour.state.queue.length = 0;
      rmSync(seenFile(), { force: true });
      const a = harbour.enqueue();
      const first = await run(['wait'], quick);
      assert.equal(first.reason, 'work');
      assert.deepEqual(first.items, [a.id]);
      assert.ok(typeof JSON.parse(readFileSync(seenFile(), 'utf8'))[a.id] === 'number');
      const second = await run(['wait'], quick);
      assert.equal(second.reason, 'cap');
    });

    test('a different id is still reported while the first is suppressed', TIMEOUT, async () => {
      const a = harbour.state.queue[0];
      const b = harbour.enqueue();
      const r = await run(['wait'], quick);
      assert.equal(r.reason, 'work');
      assert.deepEqual(r.items, [b.id]);
      assert.ok(!r.items.includes(a.id));
    });

    test('after the window the same id is reported again', TIMEOUT, async () => {
      const skew = runnerKit.WAIT_DEBOUNCE_MS + 1000;
      const r = await run(['wait'], { ...quick, now: () => Date.now() + skew });
      assert.equal(r.reason, 'work');
      assert.deepEqual([...r.items].sort(), harbour.state.queue.map((q) => q.id).sort());
    });

    test('a corrupt wait-seen.json reads as empty', TIMEOUT, async () => {
      writeFileSync(seenFile(), '{ not json');
      const r = await run(['wait'], quick);
      assert.equal(r.reason, 'work');
      assert.equal(r.items.length, harbour.state.queue.length);
      harbour.state.queue.length = 0;
    });
  });

  test('status reports heartbeat staleness', TIMEOUT, async () => {
    const hb = join(home, 'acme', 'runner.heartbeat');
    writeFileSync(hb, '');
    const old = (Date.now() - 60 * 60_000) / 1000;
    utimesSync(hb, old, old);
    const r = await run(['status']);
    assert.equal(r.heartbeat.stale, true);
  });

  test('recover in a new session fails this token\'s live rows; the same session keeps them (NB3)', TIMEOUT, async () => {
    const it = harbour.enqueue();
    await run(['poll']);
    await run(['take', it.id]);
    await run(['handoff', it.id, 'agent-4']);
    const session = JSON.parse(readFileSync(join(home, 'acme', 'runner.json'), 'utf8')).session;
    const same = await run(['recover', '--session', session]);
    assert.ok(same.live.includes(it.id));
    assert.ok(!same.fail.includes(it.id));
    harbour.state.watch.set(it.id, { id: it.id, status: 'taken' }); // LIN-3675: recover reads the dispatch first
    const fresh = await run(['recover']);
    assert.ok(fresh.fail.includes(it.id));
    const post = harbour.state.feedback.filter((p) => p.itemId === it.id).at(-1);
    assert.deepEqual(post.body, { message: '[failed] runner restarted: subagent lost', kind: 'status', rootItemId: it.id });
  });

  // F2: after a re-login inside a live session, rows the OLD runner token took
  // are still running. Harbour refuses the new token's posts on them (the fake
  // 404s: these ids are not in its history), so a post would throw. Each path
  // must finish, keep its local ledger change and stop the subagent.
  const plantOldTokenRow = (over = {}) => {
    const file = join(home, 'acme', 'ledger.json');
    const ledger = JSON.parse(readFileSync(file, 'utf8'));
    const id = randomUUID();
    ledger.items[id] = {
      itemId: id, agentId: `agent-old-${id.slice(0, 4)}`, rootItemId: id, state: 'running',
      tokenId: 'sha256:0000000000000000', session: null, takenAt: new Date().toISOString(), socket: null, ...over
    };
    writeFileSync(file, JSON.stringify(ledger));
    harbour.state.watch.set(id, { id, status: 'taken' }); // live on Harbour (an unknown id would read 404: gone)
    return ledger.items[id];
  };
  const ledgerNow = () => JSON.parse(readFileSync(join(home, 'acme', 'ledger.json'), 'utf8'));

  test('F2: a stop halt with an old-token row finishes: stopped locally, listed unposted, not thrown', TIMEOUT, async () => {
    const row = plantOldTokenRow();
    const before = harbour.state.feedback.length;
    harbour.state.halt = { mode: 'stop', setAt: new Date().toISOString(), setBy: OWNER };
    try {
      const r = await run(['poll']);
      assert.ok(r.stopAgents.includes(row.agentId));
      assert.ok(r.unposted.some((u) => u.itemId === row.itemId));
      assert.equal(ledgerNow().items[row.itemId].state, 'stopped');
      assert.ok(!harbour.state.feedback.slice(before).some((f) => f.itemId === row.itemId));
    } finally {
      harbour.state.halt = null;
      await run(['poll']);
    }
  });

  // LIN-3675: recover and the stop halt read Harbour before a terminal post (Harbour reads
  // markers last-wins, so a late [failed]/[aborted] would override an earlier [done]).
  const takeRunning = async () => {
    const it = harbour.enqueue();
    await run(['poll']);
    await run(['take', it.id]);
    await run(['handoff', it.id, `agent-${it.id.slice(0, 6)}`]);
    harbour.state.queue.length = 0;
    return it;
  };
  const stopHalt = async () => {
    harbour.state.halt = { mode: 'stop', setAt: new Date().toISOString(), setBy: OWNER };
    try { return await run(['poll']); } finally { harbour.state.halt = null; await run(['poll']); }
  };

  test('LIN-3675: recover on a row whose dispatch is already done posts nothing, settles it and stops its broker', TIMEOUT, async () => {
    const it = await takeRunning();
    const socket = ledgerNow().items[it.id].socket;
    assert.equal(existsSync(socket), true);
    harbour.state.watch.set(it.id, { id: it.id, status: 'done' });
    const before = harbour.state.feedback.length;
    const r = await run(['recover']);
    assert.ok(r.settled.includes(it.id));
    assert.ok(!r.fail.includes(it.id));
    // Review: the row stays `lost` (the restart killed its subagent), so a follow-up is rejected, not continued.
    assert.equal(ledgerNow().items[it.id].state, 'lost');
    assert.equal(resolveFollowUp({ followUpTo: it.id }, ledgerNow()).action, 'reject');
    assert.equal(existsSync(socket), false, 'broker stopped');
    assert.ok(!harbour.state.feedback.slice(before).some((f) => f.itemId === it.id));
  });

  test('LIN-3676: recover on a dropped item (404) posts nothing and settles it, row stays lost', TIMEOUT, async () => {
    const it = await takeRunning();
    harbour.state.watchFail.set(it.id, 404); // gone
    const before = harbour.state.feedback.length;
    const r = await run(['recover']);
    assert.ok(r.settled.includes(it.id));
    assert.equal(ledgerNow().items[it.id].state, 'lost');
    assert.ok(!harbour.state.feedback.slice(before).some((f) => f.itemId === it.id));
  });

  test('LIN-3676: a stop halt on a dropped item (404) posts no [aborted] but still stops it', TIMEOUT, async () => {
    const it = await takeRunning();
    harbour.state.watchFail.set(it.id, 404);
    const before = harbour.state.feedback.length;
    const r = await stopHalt();
    assert.ok(r.stopAgents.includes(`agent-${it.id.slice(0, 6)}`));
    assert.equal(ledgerNow().items[it.id].state, 'stopped');
    assert.ok(!harbour.state.feedback.slice(before).some((f) => f.itemId === it.id));
  });

  test('LIN-3675: an abort row on a running target whose dispatch is already done posts no child [aborted] but stops it', TIMEOUT, async () => {
    const target = await takeRunning();
    const socket = ledgerNow().items[target.id].socket;
    harbour.state.watch.set(target.id, { id: target.id, status: 'done' });
    const abortRow = harbour.enqueue({ abort: true, abortTo: target.id, prompt: null, bootstrapToken: null });
    await run(['poll']);
    const before = harbour.state.feedback.length;
    const r = await run(['take', abortRow.id]);
    assert.equal(r.abort.stopAgent, `agent-${target.id.slice(0, 6)}`);
    assert.equal(ledgerNow().items[target.id].state, 'stopped');
    assert.equal(existsSync(socket), false, 'broker stopped');
    const posts = harbour.state.feedback.slice(before);
    assert.deepEqual(posts.map((f) => f.itemId), [abortRow.id], 'only the ack on the abort row');
    assert.match(posts[0].body.message, /^\[aborted\] Closed finished session/);
  });

  test('LIN-3675: an abort row on a running target with an unreadable dispatch still posts the child [aborted]', TIMEOUT, async () => {
    const target = await takeRunning();
    harbour.state.watchFail.set(target.id, 500);
    const abortRow = harbour.enqueue({ abort: true, abortTo: target.id, prompt: null, bootstrapToken: null });
    await run(['poll']);
    const before = harbour.state.feedback.length;
    await run(['take', abortRow.id]);
    assert.deepEqual(harbour.state.feedback.slice(before).map((f) => f.itemId), [abortRow.id, target.id]);
  });

  test('LIN-3675: recover on an unreadable dispatch defers: no post, the row stays so a later recover retries', TIMEOUT, async () => {
    const it = await takeRunning();
    harbour.state.watchFail.set(it.id, 500); // LIN-3676: a 500 is unreadable (a 404 is gone)
    const before = harbour.state.feedback.length;
    const r = await run(['recover']);
    assert.ok(r.deferred.includes(it.id));
    assert.ok(!r.fail.includes(it.id));
    assert.equal(ledgerNow().items[it.id].state, 'running');
    assert.ok(!harbour.state.feedback.slice(before).some((f) => f.itemId === it.id));
    harbour.state.watchFail.delete(it.id);
    harbour.state.watch.set(it.id, { id: it.id, status: 'taken' });
    const again = await run(['recover']);
    assert.ok(again.fail.includes(it.id), 'a later recover retries');
  });

  test('LIN-3675: recover treats skipped as not terminal and fails the row as before', TIMEOUT, async () => {
    const it = await takeRunning();
    harbour.state.watch.set(it.id, { id: it.id, status: 'skipped' });
    const r = await run(['recover']);
    assert.ok(r.fail.includes(it.id));
    assert.equal(harbour.state.feedback.filter((f) => f.itemId === it.id).at(-1).body.message, '[failed] runner restarted: subagent lost');
  });

  test('LIN-3675: a stop halt on a row whose dispatch is already done posts no [aborted] but still stops it', TIMEOUT, async () => {
    const it = await takeRunning();
    const socket = ledgerNow().items[it.id].socket;
    harbour.state.watch.set(it.id, { id: it.id, status: 'done' });
    const before = harbour.state.feedback.length;
    const r = await stopHalt();
    assert.ok(r.stopAgents.includes(`agent-${it.id.slice(0, 6)}`));
    assert.equal(ledgerNow().items[it.id].state, 'stopped');
    assert.equal(existsSync(socket), false, 'broker stopped');
    assert.ok(!harbour.state.feedback.slice(before).some((f) => f.itemId === it.id));
  });

  test('LIN-3675: a stop halt on an unreadable dispatch still stops the row and posts [aborted]', TIMEOUT, async () => {
    const it = await takeRunning();
    harbour.state.watchFail.set(it.id, 500);
    const before = harbour.state.feedback.length;
    await stopHalt();
    assert.equal(ledgerNow().items[it.id].state, 'stopped');
    const posted = harbour.state.feedback.slice(before).filter((f) => f.itemId === it.id);
    assert.equal(posted.length, 1);
    assert.match(posted[0].body.message, /^\[aborted\] Cancelled running session/);
  });

  test('LIN-3675: haltSweep lists a terminal-evidence row as settled, not posted', () => {
    const ledger = { items: { [K]: { itemId: K, agentId: 'agent-k', rootItemId: K, state: 'running' } } };
    const sweep = haltSweep({ mode: 'stop' }, ledger, { evidenceFor: () => 'terminal' });
    assert.deepEqual(sweep.posts, []);
    assert.deepEqual(sweep.settled, [{ itemId: K }]);
    assert.deepEqual(sweep.stopAgents, ['agent-k']);
    assert.equal(sweep.ledger.items[K].state, 'stopped');
  });

  test('F2: the watchdog in wait records an old-token stall without posting or throwing', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    const row = plantOldTokenRow({ takenAt: new Date(Date.now() - (WATCHDOG_STALL_MIN + 2) * 60_000).toISOString() });
    const before = harbour.state.feedback.length;
    const r = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10 });
    assert.equal(r.reason, 'stall');
    const mine = r.stalls.find((x) => x.itemId === row.itemId);
    assert.equal(mine.action, 'block');
    assert.equal(mine.posted, false);
    assert.ok(ledgerNow().items[row.itemId].blockedAt);
    assert.ok(!harbour.state.feedback.slice(before).some((f) => f.itemId === row.itemId));
  });

  // A row this token took and handed off (so Harbour accepts its posts), aged `mins` back.
  const takeAged = async (mins) => {
    const it = harbour.enqueue();
    await run(['poll']);
    await run(['take', it.id]);
    await run(['handoff', it.id, `agent-${it.id.slice(0, 6)}`]);
    const file = join(home, 'acme', 'ledger.json');
    const ledger = JSON.parse(readFileSync(file, 'utf8'));
    ledger.items[it.id].takenAt = new Date(Date.now() - mins * 60_000).toISOString();
    writeFileSync(file, JSON.stringify(ledger));
    harbour.state.queue.length = 0;
    return ledger.items[it.id];
  };

  // LIN-3669: the watchdog reads Harbour before a terminal post. The fake's watch
  // entry is the dispatch the kit reads; a row silent 61 minutes whose item is
  // already settled must not get [failed] stalled over that finish.
  test('LIN-3669: a row silent 61 min whose dispatch is done posts nothing, ends done, and wait does not stall', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    const row = await takeAged(61);
    harbour.state.watch.set(row.itemId, { id: row.itemId, status: 'done' });
    const before = harbour.state.feedback.length;
    const r = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 400 });
    assert.equal(r.reason, 'cap');
    assert.equal(ledgerNow().items[row.itemId].state, 'done');
    assert.ok(!harbour.state.feedback.slice(before).some((f) => f.itemId === row.itemId));
  });

  // LIN-3669 review: settle must stop the item's broker, like fail does (the terminal-stop
  // assertion of the `feedback [done]` test). Red when settle is dropped from the stop line.
  test('LIN-3669: a settled row also has its broker stopped', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    const row = await takeAged(61);
    const socket = row.socket;
    assert.ok(socket, 'the taken row has a broker socket');
    assert.equal(existsSync(socket), true, 'broker is live before the sweep');
    harbour.state.watch.set(row.itemId, { id: row.itemId, status: 'closed' });
    await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 400 });
    assert.equal(ledgerNow().items[row.itemId].state, 'done');
    assert.equal(existsSync(socket), false, 'broker stopped on settle');
  });

  // LIN-3669 review: a pass whose only action is `defer` (unreadable read at 61 min) must
  // keep polling, not exit as a stall. Red when `defer` is dropped from the waitLoop skip.
  test('LIN-3669: an unreadable dispatch read defers: no post, row stays running, wait ends on cap not stall', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    const row = await takeAged(61);
    harbour.state.watchFail.set(row.itemId, 500); // LIN-3676: 500 is unreadable; 404 is the gone test below
    const before = harbour.state.feedback.length;
    const r = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 300 });
    assert.equal(r.reason, 'cap');
    assert.ok(!harbour.state.feedback.slice(before).some((f) => f.itemId === row.itemId));
    assert.equal(ledgerNow().items[row.itemId].state, 'running');
  });

  // LIN-3676: a 404 is a dropped item: settle locally, post nothing, report no stall, and do
  // not read Harbour again for that row on the next pass.
  test('LIN-3676: a row silent 61 min whose dispatch read is 404 ends done, posts nothing, no stall, one read', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    const row = await takeAged(61);
    harbour.state.watchFail.set(row.itemId, 404); // gone
    const before = harbour.state.feedback.length;
    const reads = harbour.state.watchReads.length;
    const r = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 400 });
    assert.equal(r.reason, 'cap');
    assert.equal(ledgerNow().items[row.itemId].state, 'done');
    assert.ok(!harbour.state.feedback.slice(before).some((f) => f.itemId === row.itemId));
    assert.equal(harbour.state.watchReads.slice(reads).filter((id) => id === row.itemId).length, 1);
  });

  test('LIN-3676: the evidence of a still-deferred row is cached between passes', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    const row = await takeAged(61);
    harbour.state.watchFail.set(row.itemId, 500);
    const reads = harbour.state.watchReads.length;
    const r = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 400 });
    assert.equal(r.reason, 'cap');
    assert.equal(ledgerNow().items[row.itemId].state, 'running');
    assert.equal(harbour.state.watchReads.slice(reads).filter((id) => id === row.itemId).length, 1, 'many passes, one read');
  });

  test('LIN-3669: a transcript ending in DONE: gets exactly one [blocked] … finished …, stays running, never [failed]', TIMEOUT, async () => {
    harbour.state.queue.length = 0;
    const row = await takeAged(61);
    harbour.state.watch.set(row.itemId, { id: row.itemId, status: 'taken' });
    const dir = join(home, 'transcripts');
    mkdirSync(dir, { recursive: true });
    const tfile = join(dir, `agent-${row.agentId}.jsonl`);
    writeFileSync(tfile, `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'DONE: shipped' }] } })}\n`);
    const old = new Date(Date.now() - 61 * 60_000);
    utimesSync(tfile, old, old);
    const before = harbour.state.feedback.length;
    const first = await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10 });
    assert.equal(first.reason, 'stall');
    assert.equal(first.stalls.find((x) => x.itemId === row.itemId).finished, true);
    await run(['wait'], { waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 300 });
    const posts = harbour.state.feedback.slice(before).filter((f) => f.itemId === row.itemId);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.message, `[blocked] stalled: subagent ${row.agentId} finished but its outcome was never posted`);
    assert.equal(ledgerNow().items[row.itemId].state, 'running');
  });

  test('F2: an abort of an old-token target acks, stops it, and skips the child post', TIMEOUT, async () => {
    const row = plantOldTokenRow();
    const abortRow = harbour.enqueue({ abort: true, abortTo: row.itemId, prompt: null, bootstrapToken: null });
    await run(['poll']);
    const r = await run(['take', abortRow.id]);
    assert.equal(r.abort.stopAgent, row.agentId);
    assert.equal(r.abort.unpostedChild.itemId, row.itemId);
    assert.equal(harbour.state.feedback.at(-1).itemId, abortRow.id);
    assert.equal(ledgerNow().items[row.itemId].state, 'stopped');
  });

  test('ledger prints ids and states only', TIMEOUT, async () => {
    const r = await run(['ledger']);
    assert.ok(Object.keys(r.items).length > 0);
  });

  describe('open (LIN-3213)', () => {
    const ledgerFile = () => join(home, 'acme', 'ledger.json');
    const rows = {
      aaaaaaaa: { itemId: 'aaaaaaaa', rootItemId: 'aaaaaaaa', agentId: 'ag-1', state: 'running' },
      bbbbbbbb: { itemId: 'bbbbbbbb', rootItemId: 'bbbbbbbb', agentId: 'ag-2', state: 'done' }
    };
    let saved;
    before(() => { saved = readFileSync(ledgerFile(), 'utf8'); });
    after(() => { writeFileSync(ledgerFile(), saved); });

    test('prints each open id and the options text exactly once', TIMEOUT, async () => {
      writeFileSync(ledgerFile(), JSON.stringify({ items: { ...rows, cccccccc: { itemId: 'cccccccc', rootItemId: 'cccccccc', state: 'running' } } }));
      const r = await run(['open']);
      assert.deepEqual(r.open.map((x) => x.itemId).sort(), ['aaaaaaaa', 'cccccccc']);
      assert.equal(r.options.split(runnerKit.OPEN_OPTIONS_COPY).length - 1, 1);
      assert.ok(r.options.includes(runnerKit.ORPHAN_COPY));
      assert.match(r.options, /follow-up/);
      assert.match(r.options, /abort/);
      assert.match(r.options, /\[blocked\]/);
      assert.ok(!/DELETE/.test(r.options));
    });

    test('with nothing open it lists nothing and prints no options', TIMEOUT, async () => {
      writeFileSync(ledgerFile(), JSON.stringify({ items: { bbbbbbbb: rows.bbbbbbbb } }));
      const r = await run(['open']);
      assert.deepEqual(r, { open: [] });
    });

    test('ledger output is unchanged by open', TIMEOUT, async () => {
      const ledger = { items: rows };
      writeFileSync(ledgerFile(), JSON.stringify(ledger));
      await run(['open']);
      assert.deepEqual(await run(['ledger']), ledger);
    });

    test('the usage string lists open', TIMEOUT, async () => {
      await assert.rejects(() => run(['no-such-command']), /\|open\|/);
    });
  });

  test('no command\'s output ever contains a bootstrap or working token', () => {
    const all = outputs.join('\n');
    assert.ok(!all.includes(harbour.state.runnerWorking));
    for (const h of harbour.state.history.values()) {
      if (h.bootstrapToken) assert.ok(!all.includes(h.bootstrapToken), 'item bootstrap printed');
      if (h.workerToken) assert.ok(!all.includes(h.workerToken), 'item worker token printed');
    }
  });
});
