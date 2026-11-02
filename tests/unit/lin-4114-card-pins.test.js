/**
 * LIN-4114 — characterization pins: the cards this ticket must NOT change.
 *
 * Witness 2 (plan rev 2): a free-text card (no options), `renderBareBlockedCard`, a read-only card (`mid-turn`,
 * `indeterminate`) and `canReply: false` render exactly as they did at `38b5040a`. The expected bytes live in
 * tests/fixtures/lin-4114-card-pins.json, generated once from the unmodified code (the LIN-4140 pattern). These
 * pins PASS before the change and must keep passing after it.
 *
 * Note: the options cards are NOT pinned here. Their markup is the change (radios become buttons), and they are
 * covered by lin-4114-question-card-buttons.test.js (witnesses 1 and 3).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  renderDecisionCard, renderBareBlockedCard, renderQuestionCards
} from '../../lib/question-card.js';
import {
  LOOP_BACKED_ROWS, RENDER_OPTS, TASK_BOUND_ROW
} from '../fixtures/question-card-rows.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PINS = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/lin-4114-card-pins.json'), 'utf8'));

// The same free-text task-bound row the pins were generated from: TASK_BOUND_ROW with its options removed.
const FREE_TASK_BOUND = { ...TASK_BOUND_ROW, decision: { decision_id: 'd-tb', question: 'Ship the scanned fix?' } };

describe('LIN-4114 witness 2: cards that must render byte-for-byte as before', () => {
  test('a free-text loop-backed card (no options) is unchanged', () => {
    assert.equal(renderDecisionCard(LOOP_BACKED_ROWS['loop-plain-no-options'], RENDER_OPTS), PINS['loop-plain-no-options']);
  });

  test('a free-text task-bound card (no options) is unchanged', () => {
    assert.equal(renderDecisionCard(FREE_TASK_BOUND, RENDER_OPTS), PINS['task-bound-no-options']);
  });

  test('a read-only mid-turn card is unchanged and has no buttons and no input', () => {
    const html = renderDecisionCard(LOOP_BACKED_ROWS['loop-readonly-mid-turn'], RENDER_OPTS);
    assert.equal(html, PINS['loop-readonly-mid-turn']);
    assert.ok(!/<button|<input|<textarea/.test(html), 'a read-only card offers no control');
  });

  test('a canReply:false card is unchanged and has no buttons and no input', () => {
    const html = renderDecisionCard(LOOP_BACKED_ROWS['loop-cannot-reply'], RENDER_OPTS);
    assert.equal(html, PINS['loop-cannot-reply']);
    assert.ok(!/<button|<input|<textarea/.test(html), 'a canReply:false card offers no control');
  });

  test('renderBareBlockedCard (interactive) is unchanged', () => {
    const html = renderBareBlockedCard({
      waitingMessage: '[blocked] which API key?', decisionCase: ['Two keys exist.'],
      producer: { loopId: 'lp-9', target: 'cli', issueId: 'x', issueIdentifier: 'LIN-9' },
      urlKey: 'w', canReply: true, sessionTerminal: false
    });
    assert.equal(html, PINS['bare-blocked-interactive']);
  });

  test('renderBareBlockedCard (cannot reply, session ended) is unchanged', () => {
    const html = renderBareBlockedCard({
      waitingMessage: '[blocked] which API key?', decisionCase: [], producer: { loopId: 'lp-9' },
      urlKey: 'w', canReply: false, sessionTerminal: true
    });
    assert.equal(html, PINS['bare-blocked-cannot-reply']);
  });

  test('the wrapper around a free-text card is unchanged', () => {
    const html = renderQuestionCards({
      decisions: [LOOP_BACKED_ROWS['loop-plain-no-options']], waiting: true, urlKey: 'w', canReply: true, sessionTerminal: false
    });
    assert.equal(html, PINS['wrapper-free-text']);
  });
});
