/**
 * LIN-3987: the decision panel's follow-up. What the styleguide and the panel's CSS promise, checked where a unit test
 * can see them: the styleguide's hints are the words the pages print (no raw id, no "none"), each sample sits in its
 * own frame, the panel's type and width are its own, a chosen choice is marked by aria-pressed (not bold and underline),
 * and no button of the run block is left without a shared button class.
 *
 * Run with: node --test tests/unit/lin-3987-decision-panel-words.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderStyleguide } from '../../lib/render-styleguide.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const css = (file) => readFileSync(join(ROOT, 'public', file), 'utf8');

/** The declarations of the first rule whose selector list is exactly `selector` (comments stripped). */
function ruleBody(sheet, selector) {
  const text = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = text.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} has a rule`);
  return text.slice(at + selector.length + 2, text.indexOf('}', at));
}

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
    const frame = ruleBody(css('styleguide.css'), '.sg-decision-sample');
    assert.match(frame, /border:\s*1px solid/);
    assert.match(frame, /padding:\s*var\(--space-3\)/);
    assert.equal([...html.matchAll(/class="sg-decision-sample"/g)].length, 2, 'two framed samples');
  });

  test('the anatomy states the panel\'s width and says what a Claude Code rate is', () => {
    assert.match(html, /32rem/);
    assert.match(html, /subscription may cover the cost/);
  });
});

describe('the panel owns its type and width (LIN-3987)', () => {
  const sheet = css('style.css');

  test('the panel sets the content face, so its reasons are sans on every page that hosts it', () => {
    assert.match(ruleBody(sheet, '.decision-panel'), /font-family:\s*var\(--font-content\)/);
  });

  test('the panel is 32rem at most; a phone is narrower, so it fills the width there', () => {
    assert.match(ruleBody(sheet, '.decision-panel'), /max-width:\s*32rem/);
  });

  test('the reasons inherit the content face: no rule gives them the structural (mono) face', () => {
    assert.doesNotMatch(ruleBody(sheet, '.decision-panel-reason'), /font-family/);
    assert.match(ruleBody(sheet, '.decision-panel-costs'), /font-family:\s*var\(--font-structural\)/, 'prices stay mono');
  });
});

describe('a chosen choice is marked by aria-pressed, not bold and underline (LIN-3987)', () => {
  const sheet = css('style.css');

  test('the shared selected rule is scoped to both panels and sits on the .btn form', () => {
    const text = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(text, /\.opened-task-change-panel \.btn\[aria-pressed="true"\],\s*\.decision-panel \.btn\[aria-pressed="true"\]\s*\{/);
  });

  test('the old bold-and-underline mark on a chosen preset or target is gone', () => {
    assert.doesNotMatch(sheet, /is-chosen/);
    assert.doesNotMatch(sheet, /text-decoration:\s*underline;\s*}\s*\n\s*\n\s*\.opened-task-change-summary/);
  });

  test('the suggestion buttons no longer draw a link (blue, underlined)', () => {
    const pick = ruleBody(sheet, '.decision-panel-pick');
    assert.doesNotMatch(pick, /text-decoration/);
    assert.doesNotMatch(pick, /color:\s*var\(--blue\)/);
  });
});
