/**
 * LIN-3163 (LIN-3157 B): only the agent-status and proxy-events cleanup
 * schedulers were removed from the hourly loop; the other seven stay. The four
 * evidence-store evictors are deleted outright.
 *
 * LIN-3424: the loop body moved out of server.js into lib/hourly-cleanup.js, so
 * the roster is now asserted by running the factory over recording stubs. A
 * source grep of server.js cannot witness the loop (it reads green under a
 * boot-only fix); server.js is asserted for wiring only.
 *
 * Run with: node --test tests/unit/server-lifetime-retention-wiring.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PromptTraceStore } from '../../lib/prompt-trace-store.js';
import { LlmCallLogStore } from '../../lib/llm-call-log.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { ProxyEventStore } from '../../lib/proxy-events.js';
import { createHourlyCleanupRun } from '../../lib/hourly-cleanup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const HOURLY_SRC = readFileSync(join(__dirname, '../../lib/hourly-cleanup.js'), 'utf8');

// Store key -> the exact log / error lines the loop printed before the move.
const ROSTER = [
  ['dispatchQueueStore', n => `Dispatch queue cleanup: removed ${n} expired items`, 'Dispatch queue cleanup error:'],
  ['freeTierStore', n => `Free tier cleanup: removed ${n} expired records`, 'Free tier cleanup error:'],
  ['proxyTokenStore', n => `Proxy token cleanup: removed ${n} expired/consumed tokens`, 'Proxy token cleanup error:'],
  ['observationSessionsStore', n => `Observation sessions cleanup: removed ${n} expired derived docs`, 'Observation sessions cleanup error:'],
  ['harbourFeedbackTokenStore', n => `Harbour feedback token cleanup: removed ${n} expired tokens`, 'Harbour feedback token cleanup error:'],
  ['observerStateStore', n => `Observer state cleanup: removed ${n} decommissioned instance(s)`, 'Observer state cleanup error:'],
  ['observerShadowLogStore', n => `Observer shadow log cleanup: removed ${n} aged entries`, 'Observer shadow log cleanup error:'],
  // LIN-3424: the 8th block, appended last.
  ['sessionStore', n => `Session cleanup: removed ${n} expired sessions`, 'Session cleanup error:'],
  // LIN-1952: the 9th block, appended last.
  ['consumerHeartbeatStore', n => `Consumer heartbeat cleanup: removed ${n} expired heartbeats`, 'Consumer heartbeat cleanup error:']
];

// Recording stubs: each cleanup() counts its calls and returns / throws on cue.
function harness(behaviour = {}) {
  const calls = {};
  const stores = {};
  for (const [key] of ROSTER) {
    calls[key] = 0;
    stores[key] = {
      cleanup: async () => {
        calls[key]++;
        const b = behaviour[key];
        if (b instanceof Error) throw b;
        return b ?? 0;
      }
    };
  }
  const logs = [];
  const errors = [];
  const logger = { log: (...a) => logs.push(a), error: (...a) => errors.push(a) };
  return { calls, stores, logs, errors, run: createHourlyCleanupRun({ ...stores, logger }) };
}

describe('hourly cleanup loop roster (LIN-3163 B, LIN-3424)', () => {
  test('the agent-status and proxy-events blocks are gone', () => {
    for (const [name, src] of [['server.js', SERVER_SRC], ['lib/hourly-cleanup.js', HOURLY_SRC]]) {
      assert.ok(!src.includes('proxyEventStore.cleanup()'), `${name}: the proxy-events cleanup block must be removed`);
      assert.ok(!src.includes('agentStatusStore.cleanup()'), `${name}: the agent-status cleanup block must be removed`);
    }
  });

  test('one tick calls each store\'s cleanup exactly once and is silent for 0', async () => {
    const h = harness();
    await h.run();
    for (const [key] of ROSTER) assert.equal(h.calls[key], 1, `${key}.cleanup() runs once per tick`);
    assert.deepEqual(h.logs, []);
    assert.deepEqual(h.errors, []);
  });

  for (const [key, line, errLine] of ROSTER) {
    test(`${key}: exact log line on a count above 0`, async () => {
      const h = harness({ [key]: 3 });
      await h.run();
      assert.deepEqual(h.logs, [[line(3)]]);
    });

    test(`${key}: exact error line on throw, and the other blocks still run`, async () => {
      const boom = new Error('boom');
      const h = harness({ [key]: boom });
      await h.run();
      assert.deepEqual(h.errors, [[errLine, boom]]);
      for (const [other] of ROSTER) assert.equal(h.calls[other], 1, `${other} still ran after ${key} threw`);
    });
  }
});

describe('server.js arms the hourly cleanup run (wiring only, not the witness)', () => {
  test('setInterval arms the run at CLEANUP_INTERVAL_MS, holds the timer, and the run gets sessionStore', () => {
    assert.match(SERVER_SRC, /cleanupTimer = setInterval\(runHourlyCleanup, CLEANUP_INTERVAL_MS\)/);
    assert.match(SERVER_SRC, /clearInterval\(cleanupTimer\)/);
    const call = SERVER_SRC.match(/createHourlyCleanupRun\(\{([\s\S]*?)\}\)/);
    assert.ok(call, 'server.js must build the run with createHourlyCleanupRun');
    for (const [key] of ROSTER) assert.ok(new RegExp(`\\b${key}\\b`).test(call[1]), `${key} must be passed to the run`);
  });
});

describe('evidence-store evictors are deleted (LIN-3163 B)', () => {
  test('none of the four evictor-bearing evidence stores expose a cleanup method', () => {
    for (const Store of [PromptTraceStore, LlmCallLogStore, AgentStatusStore, ProxyEventStore]) {
      assert.equal(typeof Store.prototype.cleanup, 'undefined', `${Store.name} must not define cleanup`);
    }
  });
});
