/**
 * LIN-2361 Item 3 — dispatched-prompt workflow-state wording.
 *
 * `applyPromptCapabilities` already renamed the tracker NOUN ("Linear" → "GitHub Issues",
 * LIN-2353/2354) but not the workflow-state VERB: every dispatched GitHub prompt opened with
 * `Set #55 status to "In Progress"` — a state `githubStateIdToCanonicalType` (github/index.js)
 * 422s on, since GitHub's real vocabulary (GITHUB_STATES) is only open/closed. `ui.fixedStates`
 * (interface.js) is a SYNCHRONOUS-only workflow-state vocabulary — `null` for a provider whose
 * real states need an async/per-team fetch (Linear), a fixed array for one that doesn't
 * (GitHub) — threaded through `resolvePromptUi`/`applyPromptCapabilities`.
 *
 * Run with: node --test tests/unit/lin-2361-workflow-state-wording.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolvePromptUi, applyPromptCapabilities, DEFAULT_PROMPT_UI } from '../../lib/prompt-formatters.js';
import { GitHubProvider, githubStateIdToCanonicalType } from '../../lib/providers/github/index.js';
import { ProviderInterface } from '../../lib/providers/interface.js';
import { linearProvider } from '../../lib/providers/linear/index.js';
import { providerContextVerdict } from '../../lib/prompt-trace-store.js';

const GITHUB_UI = new GitHubProvider().ui;

const START_LINE = '1. **Start**: Set #55 status to "In Progress" in Linear (if not already)';
const COMPLETE_LINE = '5. **Complete**: Set #55 status to "Done" and add summary comment';

describe('ui.fixedStates (LIN-2361 Item 3)', () => {
  test('base ProviderInterface declares fixedStates: null (opt-in, no fixed vocabulary by default)', () => {
    assert.strictEqual(new ProviderInterface().ui.fixedStates, null);
  });

  test('GitHub declares a fixed, synchronous open/closed vocabulary', () => {
    assert.deepStrictEqual(GITHUB_UI.fixedStates, [
      { id: 'open', name: 'Open', type: 'unstarted', position: 0 },
      { id: 'closed', name: 'Closed', type: 'completed', position: 1 },
    ]);
  });

  test('Linear stays null — states() is async/per-team, never synchronously available', () => {
    assert.strictEqual(linearProvider.ui.fixedStates, null);
  });

  test('resolvePromptUi threads fixedStates through from provider.ui', () => {
    assert.strictEqual(resolvePromptUi({}, GITHUB_UI).fixedStates, GITHUB_UI.fixedStates);
    assert.strictEqual(resolvePromptUi({}, null).fixedStates, null);
    assert.strictEqual(resolvePromptUi({}, { write: true }).fixedStates, null);
  });
});

describe('applyPromptCapabilities — state-wording shaping (LIN-2361 Item 3)', () => {
  test('Linear (fixedStates: null): the line is left EXACTLY as today — no regression, no silent gap', () => {
    const caps = resolvePromptUi({}, null);
    const shaped = applyPromptCapabilities(START_LINE, caps);
    assert.strictEqual(shaped, START_LINE);
  });

  test('GitHub: "In Progress" has no matching fixedStates entry (no "started" state exists) → provider-neutral wording naming no specific state', () => {
    const caps = resolvePromptUi({}, GITHUB_UI);
    const shaped = applyPromptCapabilities(START_LINE, caps);
    assert.doesNotMatch(shaped, /"In Progress"/);
    assert.match(shaped, /status to reflect that work has started/);
    assert.match(shaped, /GitHub Issues/); // the pre-existing tracker-noun rename still applies
  });

  test('GitHub: "Done" maps to the matching "Closed" state (canonical type completed)', () => {
    const caps = resolvePromptUi({}, GITHUB_UI);
    const shaped = applyPromptCapabilities(COMPLETE_LINE, caps);
    assert.match(shaped, /status to "Closed"/);
    assert.doesNotMatch(shaped, /"Done"/);
  });

  test('the shaped "Closed" state name is exactly what githubStateIdToCanonicalType accepts — never a state GitHub\'s own write path would 422 on', () => {
    const caps = resolvePromptUi({}, GITHUB_UI);
    const shaped = applyPromptCapabilities(COMPLETE_LINE, caps);
    const [, stateName] = shaped.match(/status to "([^"]+)"/);
    const matchingId = GITHUB_UI.fixedStates.find(s => s.name === stateName)?.id;
    assert.ok(matchingId, `"${stateName}" must be a real GITHUB_STATES name`);
    assert.doesNotThrow(() => githubStateIdToCanonicalType(matchingId));
  });

  test('an unrecognised quoted wording (not one of the two known literals) is left untouched, never guessed at', () => {
    const caps = resolvePromptUi({}, GITHUB_UI);
    const line = 'Set #55 status to "Backlog" (if not already)';
    assert.strictEqual(applyPromptCapabilities(line, caps), applyPromptCapabilities(line, { ...caps, fixedStates: null }));
  });

  test('a "Set status" line already dropped by the write gate needs no wording fix (order: gate before shape)', () => {
    const readOnlyCaps = { ...resolvePromptUi({}, GITHUB_UI), write: false };
    const prompt = `## Workflow\n${START_LINE}\n2. **Fetch details**: Get full issue details for #55`;
    const shaped = applyPromptCapabilities(prompt, readOnlyCaps);
    assert.doesNotMatch(shaped, /status to/); // the whole "Set status" step was gated out entirely
  });

  test('DEFAULT_PROMPT_UI has no fixedStates key, so resolvePromptUi floors it to null (no crash on a bare-floor caller)', () => {
    assert.strictEqual(DEFAULT_PROMPT_UI.fixedStates, undefined);
    assert.strictEqual(resolvePromptUi({}, {}).fixedStates, null);
  });
});

describe('providerContextVerdict is unaffected by fixedStates (LIN-2361 plan-review G2)', () => {
  // prompt-trace-store.js's providerContextVerdict compares resolvePromptUi's WHOLE OUTPUT via
  // JSON.stringify — adding a field to that output is exactly the kind of change that comparison
  // is sensitive to. These pin that today's verdicts do not move.
  test('a null-providerUi trace against the real Linear floor stays benign (fixedStates: null on both sides)', () => {
    const traces = [{ providerUi: null, featureFlags: {}, timestamp: new Date() }];
    const result = providerContextVerdict(traces, linearProvider.ui);
    assert.strictEqual(result.divergent, 0);
    assert.strictEqual(result.benign, 1);
  });

  test('a null-providerUi trace against the real GitHub ui stays divergent (already divergent on displayName; unchanged by fixedStates)', () => {
    const traces = [{ providerUi: null, featureFlags: {}, timestamp: new Date() }];
    const result = providerContextVerdict(traces, GITHUB_UI);
    assert.strictEqual(result.divergent, 1);
    assert.strictEqual(result.benign, 0);
  });
});
