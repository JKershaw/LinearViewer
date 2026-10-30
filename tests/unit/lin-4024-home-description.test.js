/**
 * LIN-4024 step 3 (look): Home's opened task reads its description as rendered markdown, never as a raw preview, and
 * its Edit link is a plain link, not a fold toggle.
 *
 * Witnesses: the Home markup carries the description base64 for the client to render on first open (no raw lines in
 * the fold); the client renders it through the one shared renderer the "show more" block also uses; and the Home
 * description fold renders its markdown when it opens (public/app.js, real source).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderDetailsContent } from '../../lib/render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(__dirname, '../../public/app.js'), 'utf8');

const DESCRIPTION = '## Why\n\nSome **bold** text.\n\n- one\n- two';

const issue = {
  id: 'issue-1',
  identifier: 'LIN-1',
  title: 'A task',
  description: DESCRIPTION,
  url: 'https://example.com/LIN-1',
  state: { name: 'Todo', type: 'unstarted' },
};

// A provider whose UI can edit inline, so the Edit link is rendered.
const EDITABLE = { name: 'local', ui: { inlineEdit: true, comments: false, attachments: false, displayName: 'Local' } };

function descriptionBody(html) {
  const start = html.indexOf('data-content="description"');
  assert.ok(start >= 0, 'the Home opened task has a description fold');
  return html.slice(start, html.indexOf('</div></div>', start) + 12);
}

describe('Home description — rendered markdown on open, no raw preview', () => {
  test('the fold carries the description base64 and no raw line of it', () => {
    const html = renderDetailsContent(issue, { urlKey: 'ws', featureFlags: {}, provider: EDITABLE, layout: 'home' });
    const body = descriptionBody(html);
    assert.match(body, /class="home-description" data-raw-desc="[A-Za-z0-9+/=]+"/, 'the markdown source rides along as base64');
    assert.equal(
      Buffer.from(body.match(/data-raw-desc="([^"]+)"/)[1], 'base64').toString('utf8'),
      DESCRIPTION,
      'the base64 decodes to the description exactly',
    );
    assert.ok(!body.includes('Some **bold** text'), 'no raw markdown line is written into the fold');
    assert.ok(!body.includes('## Why'), 'no raw heading is written into the fold');
  });

  test('a description-less task has no description fold body', () => {
    const html = renderDetailsContent({ ...issue, description: '' }, { urlKey: 'ws', featureFlags: {}, provider: EDITABLE, layout: 'home' });
    assert.ok(!html.includes('home-description'));
  });

  test('Edit is a plain link in the description fold, not a fold toggle', () => {
    const html = renderDetailsContent(issue, { urlKey: 'ws', featureFlags: {}, provider: EDITABLE, layout: 'home' });
    const edit = html.match(/<a [^>]*data-testid="issue-edit-link"[^>]*>Edit ↗<\/a>/);
    assert.ok(edit, 'the Edit link is rendered');
    assert.match(edit[0], /class="detail-link"/, 'Edit leaves the page, so it is styled as a link');
    assert.ok(!/nested-toggle/.test(edit[0]), 'Edit does not borrow the fold toggle class');
  });
});

describe('Home description — the client renders the markdown on first open (public/app.js)', () => {
  test('one shared renderer serves the "show more" block and Home\'s fold', () => {
    assert.match(APP, /function renderDescriptionMarkdown\(target, rawDescBase64, urlKey\) \{/);
    assert.equal(APP.split('renderDescriptionMarkdown(').length - 1, 3, 'declared once, called by the show-more path and the Home hook');
  });

  test('the Home description fold renders its markdown when it opens, and only once', () => {
    const hook = APP.indexOf("if (toggleType === 'description') {");
    assert.ok(hook > 0, 'the fold toggle handler has a description hook');
    const block = APP.slice(hook, hook + 400);
    assert.match(block, /content\.querySelector\('\.home-description'\)/, 'it finds the Home description body');
    assert.match(block, /if \(home && !home\.dataset\.rendered\)/, 'it renders once, on the first open');
  });
});
