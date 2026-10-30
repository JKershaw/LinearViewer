// LIN-3956 close-out guards (plan T6): the pieces the judge covers but CI does not. The column rule, the
// deleted `.local-workspace-*` CSS, and the not-found page carrying the shared form each get a witness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStyleguide } from '../../lib/render-styleguide.js';
import { renderWorkspaceNotFoundPage } from '../../lib/render-pages.js';
import { readSheets, declOf, parseSheet } from '../helpers/css-rules.js';

const STYLE = readSheets(['/style.css']);

test('the Plain column rule caps the measure and centres it, and /styleguide never gets the class', () => {
  assert.equal(declOf(STYLE, '.plain-page.plain-column', 'max-width'), '40em');
  assert.equal(declOf(STYLE, '.plain-page.plain-column', 'margin-inline'), 'auto');
  assert.doesNotMatch(renderStyleguide(), /plain-column/);
});

test('no .local-workspace-* selector remains in style.css (the class is a no-style hook)', () => {
  const selectors = STYLE.flatMap((sheet) => sheet.rules).flatMap((rule) => rule.selectors);
  assert.deepEqual(selectors.filter((s) => /\.local-workspace-/.test(s)), []);
});

test('the workspace-not-found page carries the shared form markup, with no separator', () => {
  const html = renderWorkspaceNotFoundPage('x', []);
  assert.ok(html.includes('<form action="/workspace/new" method="POST" class="local-workspace-cta">'));
  assert.ok(html.includes(
    '<input name="name" type="text" class="token-label-input" aria-label="Workspace name" value="" placeholder="Local Workspace" maxlength="50">',
  ));
  assert.doesNotMatch(html, /local-workspace-cta-sep/);
});
