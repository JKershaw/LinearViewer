/**
 * LIN-3098 S3 — marker pins. The served runner prompt carries a fenced
 * ```markers block of literal example lines. Each one is fed through the real
 * parsers Harbour reads feedback with, and must classify as intended:
 *
 *   findTerminalFeedback (lib/dispatch-terminal.js) — does it end the run?
 *   findWakeEvent        (lib/dispatch-terminal.js) — does it wake a parent?
 *   parseUsage           (lib/session-telemetry.js, kind:'usage') — cost
 *
 * The two that matter most: `[skipped] refused:` is terminal and NOT a wake;
 * `[blocked]` is a wake and NOT terminal. The kit-authored lines are also
 * compared byte-for-byte with what lib/runner-kit/runner.mjs actually emits,
 * so the prompt can't drift from the kit.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildRunnerKickoff } from '../../lib/prompts/runner-kickoff.js';
import { findTerminalFeedback, findWakeEvent } from '../../lib/dispatch-terminal.js';
import { parseUsage } from '../../lib/session-telemetry.js';
import {
  handoffMessage, recoverAction, resolveFollowUp, abortAction, haltSweep, watchdogAction, postTakeCheck, promptDigest
} from '../../lib/runner-kit/runner.mjs';

const prompt = buildRunnerKickoff({ baseUrl: 'https://harbour.example' });
const block = prompt.match(/```markers\n([\s\S]*?)```/);
const lines = block ? block[1].split('\n').filter((l) => l.trim()) : [];

const K = '0f3a9c2e-1b4d-4e8f-9a7b-2c6d8e0f1a3b';
const W = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const AGENT = 'a1b2c3d4';
const at = (message, kind = 'status') => [{ message, kind, timestamp: '2026-09-29T12:00:00.000Z' }];

// The intended classification of each marker family, by leading prefix.
const CLASSES = [
  { prefix: '[handoff]', terminal: null, wake: null },
  { prefix: '[usage]', terminal: null, wake: null, usage: true },
  { prefix: '[done]', terminal: 'done', wake: 'done' },
  { prefix: '[failed]', terminal: 'failed', wake: 'failed' },
  { prefix: '[aborted]', terminal: 'aborted', wake: 'aborted' },
  { prefix: '[skipped] refused:', terminal: 'skipped', wake: null },
  { prefix: '[blocked]', terminal: null, wake: 'blocked' }
];

describe('the prompt\'s markers block', () => {
  test('exists and has a line for every marker family', () => {
    assert.ok(block, 'a ```markers block');
    for (const c of CLASSES) assert.ok(lines.some((l) => l.startsWith(c.prefix)), `no ${c.prefix} example`);
  });

  test('every line belongs to a known family', () => {
    for (const line of lines) assert.ok(CLASSES.some((c) => line.startsWith(c.prefix)), `unclassified: ${line}`);
  });

  for (const c of CLASSES) {
    test(`${c.prefix} → terminal ${c.terminal}, wake ${c.wake}`, () => {
      for (const line of lines.filter((l) => l.startsWith(c.prefix))) {
        const kind = c.usage ? 'usage' : 'status';
        assert.equal(findTerminalFeedback(at(line, kind))?.status ?? null, c.terminal, line);
        assert.equal(findWakeEvent(at(line, kind))?.marker ?? null, c.wake, line);
      }
    });
  }

  test('[skipped] refused: is terminal and not a wake; [blocked] is a wake and not terminal', () => {
    const skipped = lines.find((l) => l.startsWith('[skipped] refused:'));
    assert.equal(findTerminalFeedback(at(skipped)).status, 'skipped');
    assert.equal(findWakeEvent(at(skipped)), null);
    for (const blocked of lines.filter((l) => l.startsWith('[blocked]'))) {
      assert.equal(findWakeEvent(at(blocked)).marker, 'blocked');
      assert.equal(findTerminalFeedback(at(blocked)), null);
    }
  });

  test('the [usage] example parses with kind:\'usage\': harness claude-code and a realised model', () => {
    const usage = lines.find((l) => l.startsWith('[usage]'));
    const parsed = parseUsage(at(usage, 'usage'));
    assert.equal(parsed.harness, 'claude-code');
    assert.equal(parsed.model, 'claude-opus-5-5');
    assert.equal(parsed.outputTokens, 1050);
    assert.equal(parseUsage(at(usage, 'status')), null, 'only kind:\'usage\' is read as usage');
  });
});

describe('every marker the prose quotes matches a pinned markers-block line', () => {
  // Prose quotes markers as templates: `[aborted] Cancelled running session <id8> (running).`
  // Each <placeholder> and "…" becomes a wildcard; the rest must match a block
  // line exactly, so the prose can't drift from the block (or the block from the kit).
  const body = prompt.replace(/```markers[\s\S]*?```/, '');
  const quoted = [...body.matchAll(/`(\[(?:handoff|done|failed|aborted|skipped|blocked)\][^`]*)`/g)].map((m) => m[1]);
  const specific = quoted.filter((q) => q.replace(/<[^>]+>|…/g, '').trim().length > q.indexOf(']') + 3);

  test('the prose quotes marker templates', () => {
    assert.ok(specific.length >= 5, `found ${specific.length}: ${specific.join(' | ')}`);
  });

  for (const q of specific) {
    test(q, () => {
      const escaped = q.split(/(<[^>]+>|…)/).map((part) => (/^<[^>]+>$|^…$/.test(part) ? '.+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
      const re = new RegExp(`^${escaped}`);
      assert.ok(lines.some((l) => re.test(l)), `no markers-block line matches the prose's ${q}`);
    });
  }
});

describe('the kit-authored lines are exactly what runner.mjs emits', () => {
  const has = (line) => assert.ok(lines.includes(line), `the markers block lacks the kit's own line:\n  ${line}`);
  const row = (over) => ({ items: { [over.itemId]: { rootItemId: over.itemId, ...over } } });

  test('[handoff] new and continued', () => {
    has(handoffMessage(K, AGENT, null));
    has(handoffMessage(W, AGENT, K));
  });
  test('recover\'s restart line', () => {
    has(recoverAction({ items: {} }, { currentTokenId: null, sessionId: null }).message);
  });
  test('a follow-up miss', () => {
    has(resolveFollowUp({ followUpTo: K }, { items: {} }).message);
  });
  test('the three abort outcomes and the stop sweep', () => {
    has(abortAction({ abort: true, abortTo: K }, row({ itemId: K, agentId: AGENT, state: 'running' })).ack);
    has(abortAction({ abort: true, abortTo: K }, row({ itemId: K, agentId: AGENT, state: 'done' })).ack);
    has(abortAction({ abort: true, abortTo: K }, { items: {} }).ack);
    has(haltSweep({ mode: 'stop' }, row({ itemId: K, agentId: AGENT, state: 'running' })).posts[0].message);
  });
  test('the watchdog\'s stall lines', () => {
    const now = Date.parse('2026-09-29T12:00:00.000Z');
    const taken = (min) => ({ itemId: K, agentId: AGENT, takenAt: new Date(now - min * 60_000).toISOString() });
    has(watchdogAction(taken(21), now, { transcriptMtime: null }).message);
    has(watchdogAction(taken(61), now, { transcriptMtime: null }).message);
  });
  test('the take-time refusal', () => {
    const polled = { id: K, promptSha256: promptDigest('a'), followUpTo: null, abort: false, abortTo: null, dispatchedBy: 'o' };
    has(postTakeCheck(polled, { id: K, prompt: 'b', followUpTo: null, abort: false, abortTo: null, dispatchedBy: 'o' }));
  });
});

// S6 (post-T3): a grant-less enqueue now answers 403 DISPATCH_GRANT_REQUIRED.
// The rule lives in the prompt (the kit has no enqueue path), so its `[failed]`
// line is pinned in the markers block and in the prose that quotes it.
describe('S6: the enqueue 403 marker', () => {
  const LINE = '[failed] enqueue blocked: DISPATCH_GRANT_REQUIRED';

  test('the markers block carries the enqueue-403 [failed] line', () => {
    assert.ok(lines.includes(LINE), `the markers block lacks:\n  ${LINE}`);
  });

  test('it reads as a terminal failure', () => {
    assert.equal(findTerminalFeedback(at(LINE)).status, 'failed');
  });

  test('the prose quotes it, so the block and the prose cannot drift', () => {
    const body = prompt.replace(/```markers[\s\S]*?```/, '');
    assert.match(body, /\[failed\] enqueue blocked: DISPATCH_GRANT_REQUIRED/);
  });
});
