/**
 * LIN-4518 (finding-fe88ac6d, part 1): the two terminal PR rules read a run's report through one shared terminal cut
 * (feedbackUpToTerminal in lib/dispatch-wake.js). These witnesses pin where that cut ends a report, for both rules,
 * so the rules cannot drift apart. Each case goes red when the cut is reverted to the whole feedback.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4518-terminal-cut.test.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { terminalPrUrlOfFeedback, terminalReportedPrUrlOfFeedback, prUrlOfFeedback } from '../../lib/dispatch-wake.js';

const OWN = 'https://github.com/acme/widget/pull/41';
const FOREIGN = 'https://github.com/acme/widget/pull/99';

describe('the terminal cut ends the report for both PR rules (LIN-4518 finding-fe88ac6d)', () => {
  test('terminalReportedPrUrlOfFeedback: a DONE: line after [done] is not the run\'s report', () => {
    const feedback = [
      { kind: 'assistant', message: `DONE: ${OWN}` },
      { kind: 'system', message: '[done] Shipped.' },
      { kind: 'assistant', message: `DONE: ${FOREIGN}` },
    ];
    assert.equal(terminalReportedPrUrlOfFeedback(feedback), OWN);
  });

  test('terminalPrUrlOfFeedback: an entry after [done] carrying a url cannot win the fallback', () => {
    const feedback = [
      { kind: 'system', message: '[done] Shipped.', url: OWN },
      { kind: 'system', message: 'sibling evidence', url: FOREIGN },
    ];
    assert.equal(terminalPrUrlOfFeedback(feedback), OWN);
  });

  test('terminalPrUrlOfFeedback: a report line after [done] is not read either', () => {
    const feedback = [
      { kind: 'system', message: '[done] Shipped.' },
      { kind: 'assistant', message: `DONE: ${FOREIGN}` },
    ];
    assert.equal(terminalPrUrlOfFeedback(feedback), null);
  });

  test('with no terminal entry (a stage parked [pending]) both rules read the whole feedback', () => {
    const feedback = [
      { kind: 'assistant', message: `DONE: ${OWN}` },
      { kind: 'system', message: 'still working', url: FOREIGN },
    ];
    assert.equal(terminalReportedPrUrlOfFeedback(feedback), OWN);
    assert.equal(terminalPrUrlOfFeedback(feedback), OWN);
  });

  test('the untruncated rule still reads past the terminal entry (prUrlOfFeedback is not cut)', () => {
    const feedback = [
      { kind: 'system', message: '[done] Shipped.' },
      { kind: 'assistant', message: `DONE: ${FOREIGN}` },
    ];
    assert.equal(prUrlOfFeedback(feedback), FOREIGN);
  });

  test('non-array input reads nothing', () => {
    assert.equal(terminalPrUrlOfFeedback(null), null);
    assert.equal(terminalReportedPrUrlOfFeedback(undefined), null);
    assert.equal(prUrlOfFeedback('nope'), null);
  });
});
