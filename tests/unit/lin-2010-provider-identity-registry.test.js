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
import { renderLandingPage } from '../../lib/render-landing.js';
import { renderSettingsPage } from '../../lib/render-settings.js';

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

describe('LIN-2010 provider identity registry — step 8 (beat 4)', () => {
  test('the landing strip renders providers in the pinned literal sequence (carried correction N2)', () => {
    // Deliberately NOT `getAllProviders().sort(...).map(p => p.ui.displayName)`
    // — recomputing the expectation with the same rule the renderer uses would
    // let a silent reorder (a changed declared `order`) move both sides
    // together and still pass. Pinning the literal array is what the plan's
    // F4 resolution ("exact array equality") actually promises; this is the
    // assertion that would have caught Jira's original landing-strip omission.
    const html = renderLandingPage({ deployInfo: {}, githubEnabled: true, jiraEnabled: true, freeTierEnabled: false });
    const names = [...html.matchAll(/lx-provider__name">([^<]+)</g)].map((m) => m[1]);
    assert.deepEqual(names, ['Linear', 'GitHub Issues', 'GitHub Projects', 'Jira', 'Local']);
  });

  test('the Settings add-row sequence is pinned (carried correction N3) — derived from barrel import order, otherwise unpinned', () => {
    // render-settings.test.js asserts presence of each row, never sequence.
    // The barrel's import order (lib/providers/index.js) is what determines
    // this order at runtime — nothing else pins it without this assertion.
    const html = renderSettingsPage('Acme', { urlKey: 'acme', workspaces: [], currentModel: 'x', availableModels: [] });
    const rows = [...html.matchAll(/data-testid="settings-provider-add-([a-z-]+)"/g)]
      .map((m) => m[1])
      .filter((name) => !name.startsWith('hint-') && !name.startsWith('btn'));
    assert.deepEqual(rows, ['linear', 'github', 'github-projects', 'jira']);
    assert.ok(!rows.includes('local'), 'local must never appear in the add-row set');
  });
});
