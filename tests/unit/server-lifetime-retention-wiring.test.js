/**
 * LIN-3163 (LIN-3157 B): only the agent-status and proxy-events cleanup
 * schedulers were removed from server.js; the other seven hourly cleanup loops
 * stay. The four evidence-store evictors are deleted outright.
 *
 * server.js is not import-safe in a unit test (Mongo connect + listen), so the
 * scheduler roster is asserted as a source grep — the same convention
 * tests/unit/canonical-account-resolution.test.js uses.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('server.js cleanup scheduler roster (LIN-3163 B)', () => {
  test('the agent-status and proxy-events schedulers are gone', () => {
    assert.ok(!SERVER_SRC.includes('proxyEventStore.cleanup()'), 'the proxy-events cleanup block must be removed');
    assert.ok(!SERVER_SRC.includes('agentStatusStore.cleanup()'), 'the agent-status cleanup block must be removed');
  });

  test('the other seven cleanup loops remain', () => {
    const kept = [
      'dispatchQueueStore.cleanup()',
      'freeTierStore.cleanup()',
      'proxyTokenStore.cleanup()',
      'observationSessionsStore.cleanup()',
      'harbourFeedbackTokenStore.cleanup()',
      'observerStateStore.cleanup()',
      'observerShadowLogStore.cleanup()'
    ];
    for (const call of kept) {
      assert.ok(SERVER_SRC.includes(call), `${call} must remain scheduled`);
    }
  });
});

describe('evidence-store evictors are deleted (LIN-3163 B)', () => {
  test('none of the four evictor-bearing evidence stores expose a cleanup method', () => {
    for (const Store of [PromptTraceStore, LlmCallLogStore, AgentStatusStore, ProxyEventStore]) {
      assert.equal(typeof Store.prototype.cleanup, 'undefined', `${Store.name} must not define cleanup`);
    }
  });
});
