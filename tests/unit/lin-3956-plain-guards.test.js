// LIN-3956 close-out guards (plan T6): the pieces the judge covers but CI does not. The column rule, the
// deleted `.local-workspace-*` CSS, and the not-found page carrying the shared form each get a witness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderStyleguide } from '../../lib/render-styleguide.js';
import { renderWorkspaceNotFoundPage } from '../../lib/render-pages.js';

const css = readFileSync(new URL('../../public/style.css', import.meta.url), 'utf8');

test('the Plain column rule caps the measure and centres it, and /styleguide never gets the class', () => {
  assert.match(css, /\.plain-page\.plain-column \{\s*max-width: 40em;\s*margin-inline: auto;\s*\}/);
  assert.doesNotMatch(renderStyleguide(), /plain-column/);
});

test('no .local-workspace-* selector remains in style.css (the class is a no-style hook)', () => {
  assert.doesNotMatch(css, /\.local-workspace-/);
});

test('the workspace-not-found page carries the shared form markup, with no separator', () => {
  const html = renderWorkspaceNotFoundPage('x', []);
  assert.ok(html.includes('<form action="/workspace/new" method="POST" class="local-workspace-cta">'));
  assert.ok(html.includes(
    '<input name="name" type="text" class="token-label-input" aria-label="Workspace name" value="" placeholder="Local Workspace" maxlength="50">',
  ));
  assert.doesNotMatch(html, /local-workspace-cta-sep/);
});
