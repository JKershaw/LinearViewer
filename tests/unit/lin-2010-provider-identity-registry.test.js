/**
 * LIN-2010 — provider identity registry, barrel guard.
 *
 * Beat 1 of 4: only the barrel's registration guard. Deliberately NOT
 * co-located with tests/unit/providers.test.js (registers stub providers into
 * the shared registry Map at :156/:180) or tests/unit/render-provider-strings.test.js
 * (same problem) — both would poison this file's live `getAllProviders()` read.
 *
 * Beats 2-4 extend this same file with the landing-order, addProvider-gate,
 * and entryCta assertions named in the plan's step 8.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { getAllProviders } from '../../lib/providers/index.js';

describe('LIN-2010 provider identity registry — barrel guard', () => {
  test('the barrel registers exactly the five known providers', () => {
    const names = getAllProviders().map((p) => p.name).sort();
    assert.deepEqual(names, ['github', 'github-projects', 'jira', 'linear', 'local']);
    assert.equal(getAllProviders().length, 5);
  });
});
