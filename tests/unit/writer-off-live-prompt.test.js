/**
 * LIN-3300 fix round: the writer-off (full meta) path is unchanged by the stage selector.
 *
 * The stage-router snapshots render the full template with placeholder `aiHints`, so
 * they could not see the Action Types Reference change that slipped into PR #1750's
 * first head. This renders the REAL writer-off prompt for one eval fixture through
 * getRecommendation (stubbed transport, no network) and compares it byte-for-byte with
 * tests/fixtures/writer-off-live/LIN-420.txt, which was rendered by main's code
 * (3ad34935) for the same fixture. The one-path change (PR 2) deletes this path and
 * this test with it.
 *
 * Run with: node --test tests/unit/writer-off-live-prompt.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getRecommendation, setFetchImpl } from '../../lib/openrouter.js';
import { loadCases } from '../../scripts/eval/jev-routing-eval.mjs';

describe('the writer-off prompt is byte-identical to main (LIN-3300)', () => {
  test('LIN-420 renders exactly as main rendered it', async () => {
    const expected = readFileSync(new URL('../fixtures/writer-off-live/LIN-420.txt', import.meta.url), 'utf8');
    const b = loadCases().find((c) => c.id === 'LIN-420').bundle;
    let sent = null;
    setFetchImpl(async (url, opts = {}) => {
      sent = JSON.parse(opts.body).messages[0].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '## Reasoning\n→ **review**\n\n## Prompt\nbody' }, finish_reason: 'stop' }], usage: {} }) };
    });
    try {
      await getRecommendation(b.issue, {
        parent: b.parent, siblings: b.siblings || [], siblingsTotal: b.siblingsTotal || 0, project: b.project,
        children: b.children || [], comments: b.comments || [], focusedChild: b.focusedChild || null
      }, { apiKey: 'stub', model: 'x', featureFlags: {} });
    } finally {
      setFetchImpl(null);
    }
    assert.ok(sent, 'the full path sent a prompt');
    assert.equal(sent, expected, 'the writer-off prompt drifted from main');
  });
});
