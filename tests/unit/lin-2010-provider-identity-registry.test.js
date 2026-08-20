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

import { getAllProviders, getProvider } from '../../lib/providers/index.js';

describe('LIN-2010 provider identity registry — barrel guard', () => {
  test('the barrel registers exactly the five known providers', () => {
    const names = getAllProviders().map((p) => p.name).sort();
    assert.deepEqual(names, ['github', 'github-projects', 'jira', 'linear', 'local']);
    assert.equal(getAllProviders().length, 5);
  });
});

describe('LIN-2010 provider identity registry — step-3 declarations (beat 2)', () => {
  test('github and github-projects share the identical addProvider.configPredicate reference (F1)', () => {
    const github = getProvider('github');
    const githubProjects = getProvider('github-projects');
    assert.equal(typeof github.addProvider.configPredicate, 'function');
    assert.equal(github.addProvider.configPredicate, githubProjects.addProvider.configPredicate);
  });

  test('local declares no addProvider — its onboarding door is POST /workspace/new, not /providers/add', () => {
    assert.equal(getProvider('local').addProvider, null);
  });

  test('github-projects declares no entryCta — a declared absence, not derived from capability', () => {
    assert.equal(getProvider('github-projects').entryCta, null);
  });
});
