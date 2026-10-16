/**
 * Pins for behaviour fixed by the LIN-3591 rebuild of lib/kpi-stats.js.
 *
 * Run with: node --test tests/unit/kpi-stats-pins.test.js
 *
 * Each test pins one fix. The module is the privacy boundary of the public
 * /kpis page, so the canaries here are plain words that must never reach its
 * output.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { collectKpiStats, FREE_TIER_WINDOW_DAYS } from '../../lib/kpi-stats.js';

const NOW = new Date('2026-06-10T12:00:00.000Z');
const TODAY = '2026-06-10';
const YESTERDAY = '2026-06-09';

function mockCollection(docs = []) {
  return {
    find: () => ({ toArray: async () => docs }),
    countDocuments: async () => docs.length
  };
}

async function freeTierOf(freeTierDocs) {
  const names = [
    'sessions', 'userPreferences', 'workspacePreferences', 'customPrompts', 'localIssues',
    'dispatchQueue', 'dispatchHistory', 'dispatchTokens', 'proxyTokens', 'proxyEvents',
    'agentStatus', 'recapCache', 'briefCache', 'reportHistory'
  ];
  const collections = Object.fromEntries(names.map(name => [name, mockCollection()]));
  collections.freeTier = mockCollection(freeTierDocs);
  const stats = await collectKpiStats(collections, { now: NOW, milestoneFunnelDeps: {} });
  return stats.freeTier;
}

describe('free-tier counts (LIN-3591)', () => {
  test('a count that is not a finite number is never emitted, only numeric counts add up', async () => {
    const freeTier = await freeTierOf([
      { urlKey: 'ws-a', date: TODAY, count: 3 },
      { urlKey: 'ws-b', date: TODAY, count: 'leakword' },
      { urlKey: 'ws-c', date: TODAY, count: { text: 'leakword' } },
      { urlKey: 'ws-d', date: TODAY, count: 2 },
      { urlKey: 'ws-e', date: YESTERDAY, count: '7' },
      { urlKey: 'ws-f', date: YESTERDAY, count: true },
      { urlKey: 'ws-g', date: YESTERDAY, count: NaN },
      { urlKey: 'ws-h', date: YESTERDAY, count: Infinity },
      { urlKey: 'ws-i', date: YESTERDAY, count: null },
      { urlKey: 'ws-j', date: YESTERDAY }
    ]);

    assert.strictEqual(freeTier.days.length, FREE_TIER_WINDOW_DAYS);
    assert.ok(freeTier.counts.every(count => typeof count === 'number' && Number.isFinite(count)),
      `free-tier counts must be finite numbers, got ${JSON.stringify(freeTier.counts)}`);
    assert.doesNotMatch(JSON.stringify(freeTier), /leakword/);
    const at = date => freeTier.counts[freeTier.days.indexOf(date)];
    assert.strictEqual(at(TODAY), 5);
    assert.strictEqual(at(YESTERDAY), 0);
  });
});
