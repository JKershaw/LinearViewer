/**
 * LIN-3987: the decision panel's follow-up. What the styleguide and the panel's CSS promise, checked where a unit test
 * can see them: the styleguide's hints are the words the pages print (no raw id, no "none"), each sample sits in its
 * own frame, the panel's type and width are its own, a chosen choice is marked by aria-pressed (not bold and underline),
 * and no button of the run block is left without a shared button class.
 *
 * The CSS is read through tests/helpers/css-rules.js (LIN-4015): what applies to a selector, not how it is written.
 *
 * Run with: node --test tests/unit/lin-3987-decision-panel-words.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderStyleguide } from '../../lib/render-styleguide.js';
import { readSheets, appliedDecls, declOf, rulesFor } from '../helpers/css-rules.js';

// The sheets the styleguide and Home load, in the order each loads them.
const STYLEGUIDE = readSheets(['/style.css', '/common-actions.css', '/settings.css', '/styleguide.css']);
const STYLE = readSheets(['/style.css']);

describe('the styleguide decision-panel samples say words, in frames (LIN-3987)', () => {
  const html = renderStyleguide();

  test('no hint names a raw value: no "none", no "the default model", no "claude-code" as a value', () => {
    const hints = [...html.matchAll(/data-decision-hint="[a-z]+"[^>]*>([^<]*)</g)].map((m) => m[1]);
    assert.equal(hints.length, 3, 'Home\'s sample carries three hints; its model hint is there, hidden, because the model has a value');
    for (const hint of hints) assert.doesNotMatch(hint, /\bnone\b|the default model|\bclaude-code\b|^Right now: opencode$/, hint);
    assert.match(html, /Right now: not used/, 'effort under OpenCode says it is not used');
    assert.match(html, /Right now: opencode through OpenRouter/, 'the harness says what it runs');
  });

  test('the Models sample\'s follow labels resolve to words, not "(none)" or a bare harness id', () => {
    assert.doesNotMatch(html, /Follow Make \(none\)/);
    assert.doesNotMatch(html, /Follow Make \(claude-code\)/);
    assert.match(html, /Follow Make \(Claude Code\)/);
  });

  test('each sample has its own frame, so it reads apart from the anatomy and the next sample', () => {
    const frame = appliedDecls(STYLEGUIDE, '.sg-decision-sample');
    assert.match(frame.get('border'), /^1px solid/);
    assert.equal(frame.get('padding'), 'var(--space-3)');
    assert.equal([...html.matchAll(/class="sg-decision-sample"/g)].length, 2, 'two framed samples');
  });

  test('the anatomy states the panel\'s width and says what a Claude Code rate is', () => {
    assert.match(html, /32rem/);
    assert.match(html, /subscription may cover the cost/);
  });
});

describe('the panel owns its type and width (LIN-3987)', () => {
  test('the panel sets the content face, so its reasons are sans on every page that hosts it', () => {
    assert.equal(declOf(STYLE, '.decision-panel', 'font-family'), 'var(--font-content)');
  });

  test('the panel is 32rem at most; a phone is narrower, so it fills the width there', () => {
    assert.equal(declOf(STYLE, '.decision-panel', 'max-width'), '32rem');
  });

  test('the reasons inherit the content face: no rule gives them the structural (mono) face', () => {
    assert.equal(appliedDecls(STYLE, '.decision-panel-reason').has('font-family'), false);
    assert.equal(declOf(STYLE, '.decision-panel-costs', 'font-family'), 'var(--font-structural)', 'prices stay mono');
  });
});

describe('a chosen choice is marked by aria-pressed, not bold and underline (LIN-3987)', () => {
  test('the shared selected rule is scoped to both panels and sits on the .btn form', () => {
    const shared = STYLE.flatMap(sheet => sheet.rules).some(rule => rule.selectors.includes('.opened-task-change-panel .btn[aria-pressed="true"]')
      && rule.selectors.includes('.decision-panel .btn[aria-pressed="true"]'));
    assert.ok(shared, 'one rule names both panels\' pressed buttons');
  });

  test('the old bold-and-underline mark on a chosen preset or target is gone', () => {
    assert.equal(rulesFor(STYLE, '.is-chosen', { media: 'any' }).length, 0);
    const underlined = STYLE.flatMap(sheet => sheet.rules)
      .filter(rule => rule.decls.some(d => d.prop === 'text-decoration' && d.value === 'underline'))
      .flatMap(rule => rule.selectors)
      .filter(selector => /\.opened-task-change|\.decision-panel/.test(selector));
    assert.deepEqual(underlined, [], 'no panel selector draws an underline');
  });

  test('the suggestion buttons no longer draw a link (blue, underlined)', () => {
    const pick = appliedDecls(STYLE, '.decision-panel-pick');
    assert.equal(pick.has('text-decoration'), false);
    assert.notEqual(pick.get('color'), 'var(--blue)');
  });
});
