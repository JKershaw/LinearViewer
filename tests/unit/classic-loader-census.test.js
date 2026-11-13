/**
 * LIN-4471: the classic-loader census, a ratchet on the suites that run browser scripts as classic scripts. A suite counts
 * when it calls `loadWorld` (tests/unit/helpers/client-world.js, a vm over the fake DOM), runs a `public/` source
 * through a vm itself, or runs a classic script through the import helper's `runClassic`
 * (tests/unit/helpers/import-world.js) with any file other than the two named IIFE siblings, RUN_CLASSIC_SIBLINGS below.
 * Those two (`chart-helpers.js`, `close-out.js`) are what a converted page reads beside its imports, so a module suite
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
  'brief-recap-ai-not-configured-contract.test.js',
  'brief-recap-autogenerate.test.js',
  'chart-helpers.test.js',
  'chat-append-options.test.js',
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
  'cost-format-consumers.test.js',
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
  'lin-3833-copy-first-view.test.js',
  'lin-3833-home-mount-needs-you.test.js',
  'lin-3833-run-control.test.js',
  'lin-3968-home-polish.test.js',
  'lin-3975-proposal-refresh.test.js',
  'lin-3975-summary-and-time.test.js',
  'lin-3975-task-run-control.test.js',
  'lin-3975-task-run-links.test.js',
  'lin-4010-home-opened-task.test.js',
  'lin-4016-browser-follows-server.test.js',
  'lin-4016-sessions-fold-parked.test.js',
  'lin-4024-home-description.test.js',
  'lin-4024-look.test.js',
  'lin-4040-close-out.test.js',
  'lin-4042-finished-no-run-to-pr.test.js',
  'lin-4114-dismiss-order.test.js',
  'lin-4114-inflight-lock.test.js',
  'lin-4241-settled-ruling-client.test.js',
  'lin-4242-waiting-live.test.js',
  'lin-4242-waiting-merge.test.js',
  'lin-4243-placement.test.js',
  'lin-4246-opened-task-repaint-keep.test.js',
  'lin-4293-tidy-after-repaint.test.js',
  'lin-4296-dispatch-reader.test.js',
  'lin-4296-scope-pick.test.js',
  'observation-basis-check.test.js',
  'observation-bulk-scan.test.js',
  'observation-card-order.test.js',
  'observation-card-words.test.js',
  'observation-lineage-fold.test.js',
  'observation-render.test.js',
  'observation-ruling-delivery.test.js',
  'observation-scan-due.test.js',
  'observation-scope.test.js',
  'observation-waiting-block.test.js',
  'observation-waiting-host.test.js',
  'prompt-section-go.test.js',
  'prompt-section-look-alike.test.js',
  'prompt-section-p0.test.js',
  'prompt-section-preserve.test.js',
  'prompt-section-recommend-url.test.js',
  'prompt-section-run-quota.test.js',
  'prompt-section-runner-link.test.js',
  'prompt-section-task-mode.test.js',
  'question-card-task-bound.test.js',
  'reply-delivery-contract.test.js',
  'rulings-badge-client.test.js',
  'run-limit-gating.test.js',
  'runner-link-surfaces.test.js',
  'scan-post-signal.test.js',
  'scan-retire-ui.test.js',
  'segment-bar-pill-parity.test.js',
  'session-pr-state-poll.test.js',
  'session-question-card-effect.test.js',
  'session-run-transcript-entries.test.js',
  'ship-biscuit-parity.test.js',
  'ship-journey-geometry.test.js',
  'ship-layout-parity.test.js',
  'state-map.test.js',
  'swim-client-state-labels.test.js',
  'task-chat-flight-companion-sentinel-mask.test.js',
  'task-page-client.test.js',
  'task-page-href.test.js',
  'task-page-link-client-surfaces.test.js',
  'task-page-question.test.js',
  'task-timeline-client.test.js',
  'vendor-assets.test.js',
];

/**
 * The classic scripts `importWorld().runClassic` may run without the suite counting: the IIFE siblings the plan blesses
 * (they declare nothing that could collide), which a converted page reads beside its imports.
 */
export const RUN_CLASSIC_SIBLINGS = ['chart-helpers.js', 'close-out.js'];

/** True when the source of a suite runs a browser script as a classic script, by the census rule. */
export function loadsClassic(src) {
  if (/\bloadWorld\(/.test(src)) return true;
  if (/public\//.test(src) && /node:vm|vm\.(runIn|Script|createContext)/.test(src)) return true;
  const calls = [...src.matchAll(/\brunClassic\(\s*([^)]*?)\s*\)/g)];
  return calls.some(([, arg]) => {
    const literal = /^(['"])([^'"]+)\1$/.exec(arg);
    return !(literal && RUN_CLASSIC_SIBLINGS.includes(literal[2]));
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

test('the baseline is recorded at 102 suites (the count that must not rise)', () => {
  assert.equal(CLASSIC_LOADER_SUITES.length, 102);
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
});

test('the real suites that run a sibling through runClassic are not counted, and the siblings list is the two IIFEs', () => {
  assert.deepEqual(RUN_CLASSIC_SIBLINGS, ['chart-helpers.js', 'close-out.js']);
  const found = classicLoaderSuites(['workspace-kpis-module.test.js', 'import-world.test.js']);
  assert.deepEqual(found, []);
});
