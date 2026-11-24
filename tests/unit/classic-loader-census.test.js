/**
 * LIN-4471: the classic-loader census, a ratchet on the suites that run browser scripts as classic scripts. A suite counts
 * when it calls `loadWorld` (tests/unit/helpers/client-world.js, a vm over the fake DOM), runs a `public/` source
 * through a vm itself, or runs a classic script through the import helper's `runClassic`
 * (tests/unit/helpers/import-world.js), or a world helper's `classic:` list, with any file other than the named IIFE siblings,
 * RUN_CLASSIC_SIBLINGS below. Those (`chart-helpers.js`, `close-out.js`, `question-cards.js`) are what a converted page reads beside its imports, so a module suite
 * that runs one of them is not a classic suite. Any other file loaded through `runClassic`, `observation.js` say, or a
 * `runClassic` call whose argument is not a literal sibling name, counts: the helper must not be a way round the ratchet.
 * A converted page is tested by a plain import instead (tests/unit/helpers/import-world.js), and it does not count. The list below is the baseline, written out by name as fake-dom-census.test.js does, so that "the
 * tests get simpler" is a number that moves: a new suite that loads browser scripts as classic fails, and so does a
 * listed suite that no longer does, until the list is lowered in the same change. Runs over tests/unit/*.js.
 *
 * Run with: node --test tests/unit/classic-loader-census.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNIT = dirname(fileURLToPath(import.meta.url));

/** Suites (file names under tests/unit/) that load browser scripts as classic scripts today. Sorted. */
export const CLASSIC_LOADER_SUITES = [
  'chart-helpers.test.js',
  'chat-identifiers.test.js',
  'chat-render-markdown-text.test.js',
  'chat-tool-rows.test.js',
  'client-world.test.js',
  'close-out-client.test.js',
  'common-assignee-filter-nav.test.js',
  'common-local-time.test.js',
  'common-read-sse-stream.test.js',
  'common-render-markdown.test.js',
  'common-team-filter-nav.test.js',
  'decision-panel-client-hints.test.js',
  'dispatch-feedback-entries.test.js',
  'dispatch-prompt-stop-at.test.js',
  'dispatch-surface-forward.test.js',
  'fake-dom-census.test.js',
  'fake-dom.test.js',
  'fetch-autopilot-kickoff-url.test.js',
  'flight-companion-client.test.js',
  'form-behaviours.test.js',
  'http-keepalive.test.js',
  'lin-2122-history-outcome-pill.test.js',
  'lin-2370-browser-copy-prompt-provider-identity.test.js',
  'lin-2933-cross-seam-witness.test.js',
  'lin-2944-p3-proxy-toggle-post.test.js',
  'lin-3131-runner-bootstrap-client.test.js',
  'lin-3136-driver-copy-client.test.js',
  'lin-3136-settings-take-predicate.test.js',
  'lin-3254-session-run-toggles.test.js',
  'lin-3618-dispatch-token-expiry-display.test.js',
  'lin-3833-client-harness.test.js',
  'lin-3975-proposal-refresh.test.js',
  'lin-3975-summary-and-time.test.js',
  'lin-3975-task-run-links.test.js',
  'lin-4016-sessions-fold-parked.test.js',
  'lin-4024-look.test.js',
  'lin-4114-inflight-lock.test.js',
  'lin-4242-waiting-live.test.js',
  'lin-4243-placement.test.js',
  'lin-4296-dispatch-reader.test.js',
  'lin-4296-scope-pick.test.js',
  'prompt-section-run-quota.test.js',
  'prompt-section-runner-link.test.js',
  'reply-delivery-contract.test.js',
  'rulings-badge-client.test.js',
  'segment-bar-pill-parity.test.js',
  'session-pr-state-poll.test.js',
  'session-run-transcript-entries.test.js',
  'ship-biscuit-parity.test.js',
  'ship-journey-geometry.test.js',
  'ship-layout-parity.test.js',
  'state-map.test.js',
  'swim-client-state-labels.test.js',
  'task-chat-flight-companion-sentinel-mask.test.js',
  'task-page-href.test.js',
  'task-page-link-client-surfaces.test.js',
  'vendor-assets.test.js',
];

/**
 * The classic scripts `importWorld().runClassic` may run without the suite counting: the IIFE siblings the plan blesses
 * (they declare nothing that could collide), which a converted page reads beside its imports. question-cards.js joined in
 * LIN-4463 piece 5: the PromptSection module reads its window.QuestionCards when it draws, as the task page reads
 * close-out.js's window.CloseOut.
 */
export const RUN_CLASSIC_SIBLINGS = ['chart-helpers.js', 'close-out.js', 'question-cards.js'];

/** True when the source of a suite runs a browser script as a classic script, by the census rule. */
export function loadsClassic(src) {
  if (/\bloadWorld\(/.test(src)) return true;
  if (/public\//.test(src) && /node:vm|vm\.(runIn|Script|createContext)/.test(src)) return true;
  const calls = [...src.matchAll(/\brunClassic\(\s*([^)]*?)\s*\)/g)];
  if (calls.some(([, arg]) => {
    const literal = /^(['"])([^'"]+)\1$/.exec(arg);
    return !(literal && RUN_CLASSIC_SIBLINGS.includes(literal[2]));
  })) return true;
  // A world helper's `classic: [...]` option runs each name through runClassic inside the helper (task-page-world.js,
  // prompt-section-world.js, swipe-world.js), so a non-sibling named there counts too. The option is read to the end of
  // its line: every quoted name in it must be a sibling, and an option with no literal list at all counts.
  return [...src.matchAll(/\bclassic\s*:\s*([^\n]*)/g)].some(([, rest]) => {
    if (!rest.trim().startsWith('[') && !/\?\s*\[/.test(rest)) return true;
    return [...rest.matchAll(/(['"])([^'"]+)\1/g)].some(([, , name]) => !RUN_CLASSIC_SIBLINGS.includes(name));
  });
}

/** The suites that load browser scripts as classic scripts, by the census rule. */
export function classicLoaderSuites(files) {
  return files.filter((f) => {
    if (f === 'classic-loader-census.test.js') return false; // this file names the rule's words, and is not a suite
    return loadsClassic(readFileSync(join(UNIT, f), 'utf8'));
  });
}

test('the classic-loader census matches its baseline: no new classic suite, and no stale entry', () => {
  const found = classicLoaderSuites(readdirSync(UNIT).filter((f) => f.endsWith('.js')).sort());
  const added = found.filter((f) => !CLASSIC_LOADER_SUITES.includes(f));
  const gone = CLASSIC_LOADER_SUITES.filter((f) => !found.includes(f));
  assert.deepEqual(added, [], `new suites load browser scripts as classic. Test a converted page by plain import (tests/unit/helpers/import-world.js) instead, or add the suite here in the same change: ${added.join(', ')}`);
  assert.deepEqual(gone, [], `listed suites no longer load browser scripts as classic: lower the baseline in this change: ${gone.join(', ')}`);
});

test('the baseline is recorded at 57 suites (the count that must not rise; LIN-4540 deleted the two scan suites, LIN-4537 the two brief/recap widget suites, LIN-4541 the six ruling-card and ruling-row suites, LIN-4463 piece 5 the two app.js suites and the eighteen prompt-section suites, LIN-4549 the waiting-merge suite, now a module import)', () => {
  assert.equal(CLASSIC_LOADER_SUITES.length, 57);
});

test('runClassic is counted unless it runs a named sibling: observation.js counts, chart-helpers.js does not', () => {
  assert.equal(loadsClassic("const w = importWorld(); w.runClassic('observation.js');"), true);
  assert.equal(loadsClassic('importWorld().runClassic("observation.js")'), true);
  assert.equal(loadsClassic("world.runClassic('chart-helpers.js');"), false);
  assert.equal(loadsClassic("world.runClassic('close-out.js');"), false);
  assert.equal(loadsClassic("world.runClassic('chart-helpers.js'); world.runClassic('prompt-section.js');"), true, 'one non-sibling call is enough');
  assert.equal(loadsClassic('world.runClassic(name);'), true, 'a non-literal argument cannot be shown to be a sibling');
  assert.equal(loadsClassic("world.runClassic('./chart-helpers.js');"), true, 'only the bare sibling name is exempt');
  assert.equal(loadsClassic("await world.importPage('workspace-kpis.js');"), false, 'importing a module is not a classic load');
  assert.equal(loadsClassic("await promptSectionWorld(t, { classic: ['question-cards.js'] });"), false, 'a world helper naming a sibling');
  assert.equal(loadsClassic("await pageWorld(t, { classic: ['common.js'] });"), true, 'a world helper naming a non-sibling counts');
  assert.equal(loadsClassic("await pageWorld(t, { classic: names });"), true, 'a non-literal classic list counts');
  assert.equal(loadsClassic("await pageWorld(t, { classic: real ? ['close-out.js'] : [] });"), false, 'a choice between sibling lists');
  assert.equal(loadsClassic("await pageWorld(t, { classic: ['close-out.js', 'common.js'] });"), true, 'one non-sibling in a list is enough');
});

test('the real suites that run a sibling through runClassic are not counted, and the siblings list is the three IIFEs', () => {
  assert.deepEqual(RUN_CLASSIC_SIBLINGS, ['chart-helpers.js', 'close-out.js', 'question-cards.js']);
  const found = classicLoaderSuites(['workspace-kpis-module.test.js', 'import-world.test.js']);
  assert.deepEqual(found, []);
});
