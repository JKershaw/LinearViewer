/**
 * Unit tests for lib/prompts/ship-biscuit-editor.js — the editor-in-chief parsing +
 * the deterministic quiet/mock edition builders (LIN-818, V1).
 *
 * Run with: node --test tests/unit/ship-biscuit-editor.test.js
 *
 * Focuses on the grounding guard (stub sourceRefs must resolve to real model source
 * ids; hallucinated ids are dropped and an ungrounded stub is discarded), the §B
 * snapshot-by-value contract, weight ordering, and the deterministic quiet/mock
 * edition builders (quiet honesty is guaranteed OUTSIDE the LLM).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildEditionModel } from '../../lib/ship-biscuit.js';
import {
  parseEditorResponse,
  buildQuietEdition,
  buildMockEdition,
  buildEditorMessages
} from '../../lib/prompts/ship-biscuit-editor.js';

const NOW = Date.UTC(2026, 6, 9, 12, 0, 0);

function modelWithSources() {
  return buildEditionModel({
    window: 'month', now: NOW, workspaceName: 'Acme',
    sessions: [{
      sessionId: 'sess-1', seedIssue: 'LIN-1', tasksTouched: ['LIN-1'],
      dispatchedAt: new Date(NOW - 86400000).toISOString(),
      completedAt: new Date(NOW - 86400000).toISOString(),
      loops: [{ loopId: 'l1', issueIdentifier: 'LIN-1', issueTitle: 'Task', agentState: 'complete', agentSummary: 'Done it.' }]
    }],
    agentStatusItems: [{ id: 'st-1', taskIdentifier: 'LIN-2', action: 'fix', status: 'completed', summary: 'Fixed the bug.', timestamp: new Date(NOW - 2 * 86400000).toISOString() }],
    llmStats: null
  });
}

describe('buildEditorMessages', () => {
  test('produces a system + user pair grounded in the model context', () => {
    const msgs = buildEditorMessages(modelWithSources());
    assert.strictEqual(msgs.length, 2);
    assert.strictEqual(msgs[0].role, 'system');
    assert.strictEqual(msgs[1].role, 'user');
    assert.match(msgs[1].content, /session:sess-1/);
  });
});

describe('parseEditorResponse — grounding guard', () => {
  test('resolves valid sourceRefs and snapshots them by value (§B)', () => {
    const model = modelWithSources();
    const raw = JSON.stringify({
      frontPage: { lede: 'A busy month.' },
      index: [
        { section: 'The Wire', headline: 'LIN-1 shipped', dek: 'The autopilot finished it.', weight: 5, sourceRefs: ['session:sess-1'] }
      ]
    });
    const out = parseEditorResponse(raw, model);
    assert.strictEqual(out.frontPage.lede, 'A busy month.');
    assert.strictEqual(out.index.length, 1);
    const stub = out.index[0];
    assert.strictEqual(stub.id, 'art-1');
    assert.strictEqual(stub.sourceRefs.length, 1);
    // Snapshotted by value — the full content, not a bare id.
    assert.strictEqual(stub.sourceRefs[0].id, 'session:sess-1');
    assert.ok(stub.sourceRefs[0].snapshot && Array.isArray(stub.sourceRefs[0].snapshot.beats));
  });

  test('drops hallucinated source ids and discards a stub with none left', () => {
    const model = modelWithSources();
    const raw = JSON.stringify({
      frontPage: { lede: 'x' },
      index: [
        { section: 'The Wire', headline: 'Real', weight: 3, sourceRefs: ['session:sess-1', 'session:GHOST'] },
        { section: 'The Wire', headline: 'Fabricated', weight: 3, sourceRefs: ['session:NOPE'] }
      ]
    });
    const out = parseEditorResponse(raw, model);
    assert.strictEqual(out.index.length, 1, 'the ungrounded stub is dropped');
    assert.strictEqual(out.index[0].headline, 'Real');
    assert.strictEqual(out.index[0].sourceRefs.length, 1, 'the ghost id is dropped');
    assert.strictEqual(out.index[0].sourceRefs[0].id, 'session:sess-1');
  });

  test('orders the index by descending weight and re-ids deterministically', () => {
    const model = modelWithSources();
    const raw = JSON.stringify({
      frontPage: { lede: 'x' },
      index: [
        { headline: 'low', weight: 1, sourceRefs: ['status:st-1'] },
        { headline: 'high', weight: 5, sourceRefs: ['session:sess-1'] }
      ]
    });
    const out = parseEditorResponse(raw, model);
    assert.deepStrictEqual(out.index.map(s => s.headline), ['high', 'low']);
    assert.deepStrictEqual(out.index.map(s => s.id), ['art-1', 'art-2']);
  });

  test('a malformed / non-JSON reply yields an empty body (caller falls back to quiet)', () => {
    const model = modelWithSources();
    const out = parseEditorResponse('the model rambled without JSON', model);
    assert.strictEqual(out.index.length, 0);
    assert.strictEqual(out.frontPage.lede, '');
  });

  test('tolerates a ```json fenced reply', () => {
    const model = modelWithSources();
    const raw = '```json\n' + JSON.stringify({ frontPage: { lede: 'Fenced.' }, index: [] }) + '\n```';
    assert.strictEqual(parseEditorResponse(raw, model).frontPage.lede, 'Fenced.');
  });
});

describe('buildQuietEdition', () => {
  test('is an honest slow-news-day edition with an empty index', () => {
    const model = buildEditionModel({ window: 'week', now: NOW, sessions: [], agentStatusItems: [], llmStats: null });
    const q = buildQuietEdition(model);
    assert.strictEqual(q.index.length, 0);
    assert.match(q.frontPage.lede, /slow news day|quiet/i);
  });
});

describe('buildMockEdition', () => {
  test('synthesises grounded headlines from the model sources (for tests/local)', () => {
    const model = modelWithSources();
    const mock = buildMockEdition(model);
    assert.ok(mock.index.length >= 1);
    for (const stub of mock.index) {
      assert.ok(stub.headline.length > 0);
      assert.ok(stub.sourceRefs.length >= 1);
      assert.ok(model.sources.some(s => s.id === stub.sourceRefs[0].id), 'headline is grounded in a real source');
    }
  });

  test('degrades to the honest quiet edition when the model is quiet', () => {
    const model = buildEditionModel({ window: 'week', now: NOW, sessions: [], agentStatusItems: [], llmStats: null });
    const mock = buildMockEdition(model);
    assert.strictEqual(mock.index.length, 0);
    assert.match(mock.frontPage.lede, /slow news day|quiet/i);
  });
});
