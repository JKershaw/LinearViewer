/**
 * LIN-4114 — the decision's options are real sans buttons, and `recommended` is the one main button.
 *
 * Witnesses 1, 3 and 4 (plan rev 2). The NEW tests describe behaviour to build and must FAIL against the
 * unmodified code; the GUARD tests pass before and after and must keep passing.
 *
 * Markup only, from the real `renderDecisionCard`. Press semantics (what a press sends, double press, in-flight
 * lock) are browser behaviour and are covered end to end in tests/e2e/lin-4114-waiting-on-you.spec.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderDecisionCard } from '../../lib/question-card.js';
import { RENDER_OPTS, LOOP_BACKED_ROWS } from '../fixtures/question-card-rows.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const OPTIONS = [
  { id: 'opt-a', label: 'Ship it now' },
  { id: 'opt-b', label: 'Wait for review' },
  { id: 'opt-c', label: 'Split the change' },
];
const row = (over = {}) => ({
  ...LOOP_BACKED_ROWS['loop-with-options'],
  decision: { decision_id: 'd-rec', question: 'What next?', options: OPTIONS, ...over.decision },
  ...over.row,
});

/** The option buttons in document order: `{ optionId, classes, recommended, html }`. */
function optionButtons(html) {
  const out = [];
  for (const m of html.matchAll(/<button\b([^>]*)data-option-id="([^"]*)"([^>]*)>/g)) {
    const attrs = `${m[1]} ${m[3]}`;
    out.push({
      optionId: m[2],
      classes: (attrs.match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/).filter(Boolean),
      recommended: /data-recommended="true"/.test(attrs),
      type: (attrs.match(/type="([^"]*)"/) || [, ''])[1],
      html: m[0],
    });
  }
  return out;
}

describe('LIN-4114 witness 1: the options are buttons, and a valid recommended is the one main button', () => {
  test('NEW: with a valid recommended, the recommended option is the single btn--primary and comes first', () => {
    const html = renderDecisionCard(row({ decision: { recommended: 'opt-b' } }), RENDER_OPTS);
    const buttons = optionButtons(html);
    assert.equal(buttons.length, 3, 'one button per option');
    assert.equal(buttons[0].optionId, 'opt-b', 'the recommended option comes first');
    assert.ok(buttons[0].classes.includes('btn--primary'), 'the recommended option is the main button');
    assert.equal(buttons[0].recommended, true, 'the main button carries data-recommended="true"');
    assert.equal(html.split('btn--primary').length - 1, 1, 'exactly one btn--primary on the card');
    for (const other of buttons.slice(1)) {
      assert.ok(other.classes.includes('btn'), `${other.optionId} is a shared button`);
      assert.ok(!other.classes.includes('btn--primary'), `${other.optionId} is secondary`);
      assert.equal(other.recommended, false);
    }
  });

  test('NEW: the other options keep their given order after the recommended one', () => {
    const html = renderDecisionCard(row({ decision: { recommended: 'opt-b' } }), RENDER_OPTS);
    assert.deepEqual(optionButtons(html).map(b => b.optionId), ['opt-b', 'opt-a', 'opt-c']);
  });

  test('NEW: every option is a type="button" carrying data-option-id and the option testid, and the group is labelled', () => {
    const html = renderDecisionCard(row({ decision: { recommended: 'opt-a' } }), RENDER_OPTS);
    for (const b of optionButtons(html)) {
      assert.equal(b.type, 'button');
      assert.match(b.html, /data-testid="session-question-card-option"/);
    }
    assert.match(html, /<[^>]*role="group"[^>]*aria-label="[^"]+"/, 'the option row is a labelled group');
  });

  test('NEW: no radio inputs remain anywhere on the card', () => {
    const html = renderDecisionCard(row({ decision: { recommended: 'opt-a' } }), RENDER_OPTS);
    assert.ok(!html.includes('type="radio"'), 'no radio input');
    assert.ok(!html.includes('sess-qcard-option-input'), 'no radio class');
  });

  test('NEW: with no recommended, every option is a secondary button and none is primary', () => {
    const html = renderDecisionCard(row(), RENDER_OPTS);
    const buttons = optionButtons(html);
    assert.equal(buttons.length, 3);
    for (const b of buttons) {
      assert.ok(b.classes.includes('btn'), `${b.optionId} is a shared button`);
      assert.ok(!b.classes.includes('btn--primary'), `${b.optionId} is not primary`);
      assert.equal(b.recommended, false);
    }
    assert.ok(!html.includes('btn--primary'), 'no primary button on the card');
  });

  test('GUARD: "your own answer" and Answer stay beside the buttons', () => {
    const html = renderDecisionCard(row({ decision: { recommended: 'opt-a' } }), RENDER_OPTS);
    assert.match(html, /data-testid="session-question-card-input"[^>]*placeholder="your own answer…"/);
    assert.match(html, /data-testid="session-question-card-answer"[^>]*>Answer</);
  });
});

describe('LIN-4114 witness 3: an invalid recommended reads as none, and a non-interactive card has no buttons', () => {
  test('GUARD: a recommended that names no option renders exactly as no recommended', () => {
    const stray = renderDecisionCard(row({ decision: { recommended: 'opt-zzz' } }), RENDER_OPTS);
    const none = renderDecisionCard(row(), RENDER_OPTS);
    assert.equal(stray, none, 'a stray recommended is treated as absent, byte for byte');
  });

  test('GUARD: a mid-turn (read-only) card with options has no buttons and no input', () => {
    const html = renderDecisionCard(
      { ...row({ decision: { recommended: 'opt-a' } }), disposition: 'mid-turn' },
      RENDER_OPTS
    );
    assert.ok(!/<button/.test(html.replace(/<button[^>]*sess-qcard-dismiss[\s\S]*?<\/button>/, '')), 'no option or answer button');
    assert.ok(!html.includes('<textarea'), 'no input');
  });

  test('GUARD: canReply:false with options has no buttons and no input', () => {
    const html = renderDecisionCard(row({ decision: { recommended: 'opt-a' }, row: { canReply: false } }), RENDER_OPTS);
    assert.ok(!html.includes('<button'), 'no buttons');
    assert.ok(!html.includes('<textarea'), 'no input');
  });
});

describe('LIN-4114 witness 4: the task-page golden carries a deliberate open-ruling-with-recommended case', () => {
  test('NEW: some golden case renders an option card whose recommended option is the main button', () => {
    const golden = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/render-task-page-golden.json'), 'utf8'));
    const withCard = Object.entries(golden).filter(([, html]) => html.includes('session-question-card-option'));
    assert.ok(withCard.length > 0, 'the task-page golden has an open-ruling case with options (none today)');
    assert.ok(
      withCard.some(([, html]) => /btn--primary[^>]*data-option-id=|data-option-id="[^"]*"[^>]*btn--primary/.test(html)),
      'that case renders the recommended option as btn--primary'
    );
  });
});
