/**
 * LIN-4024 step 3 (look): Home's opened task reads its description as rendered markdown, never as a raw preview, and
 * its Edit link is a plain link, not a fold toggle.
 *
 * Witnesses: the Home markup carries the description base64 for the client to render on first open (no raw lines in
 * the fold); the client renders it through the one shared renderer the "show more" block also uses; and the Home
 * description fold renders its markdown when it opens (public/app.js, real source).
 *
 * The page is the server's own markup (renderDetailsContent) drawn on the shared fake DOM, and app.js runs its init over it
 * (LIN-4307): its document listeners are bound as they are in a browser, and a click is delivered to them with
 * `clickDelegated`. There is no stand-in for document or window.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderDetailsContent } from '../../lib/render.js';
import { loadWorld, clickDelegated, fireDOMContentLoaded } from './helpers/client-world.js';

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

// Home's page for `issue`: the server's markup drawn on the fake DOM, then public/app.js run over it and its
// DOMContentLoaded init fired, so its document listeners are bound as in a browser. `renders` records each markdown
// render: renderMarkdown is common.js's, and a stub stands in for it here.
async function loadPage(issue, options) {
  const renders = [];
  const world = loadWorld({
    scripts: [],
    window: { addEventListener() {} },
    globals: {
      renderMarkdown: (text) => { renders.push(text); return `<p>${text}</p>`; },
      atob: (s) => Buffer.from(s, 'base64').toString('binary'),
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      setInterval: () => 0, clearInterval() {},
      fetch: () => new Promise(() => {}),
      console: { log() {}, error() {}, warn() {} },
    },
  });
  // The details the server renders are injected into the row's `.details` wrapper, as the client does on expand
  // (public/app.js fills the lazy `.details`); the fold's handler looks its content up from that wrapper.
  const details = renderDetailsContent(issue, { urlKey: 'ws', featureFlags: {}, provider: EDITABLE, ...options });
  world.document.body.innerHTML = `<div class="details" data-details-for="${issue.id}" data-section="">${details}</div>`;
  world.run(APP);
  await fireDOMContentLoaded(world.document);
  return { world, renders };
}

describe('Home description — the client renders the markdown on first open (public/app.js, run)', () => {
  test('Home\'s description fold renders its markdown the first time it opens, and not again', async () => {
    const { world, renders } = await loadPage(issue, { layout: 'home' });
    const toggle = world.document.querySelector('[data-testid="issue-description-toggle"]');
    const home = world.document.querySelector('.home-description');

    await clickDelegated(toggle);
    assert.equal(renders.length, 1, 'the first open renders the description');
    assert.equal(renders[0], DESCRIPTION, 'it renders the description exactly');
    assert.equal(home.dataset.rendered, 'true', 'the body is marked rendered');
    assert.ok(home.innerHTML.includes(DESCRIPTION), 'the rendered markdown is what the fold shows');

    await clickDelegated(toggle); // close
    await clickDelegated(toggle); // open again
    assert.equal(renders.length, 1, 'a second open does not render it again');
  });

  test('the show-more block renders on its first expansion, and not again', async () => {
    const { world, renders } = await loadPage(issue, {});
    const showMore = world.document.querySelector('.issue-desc-toggle');
    assert.ok(showMore, 'the long description has a show-more toggle');

    await clickDelegated(showMore);
    assert.equal(renders.length, 1, 'show more renders on its first expansion');
    await clickDelegated(showMore);
    await clickDelegated(showMore);
    assert.equal(renders.length, 1, 'and does not render again on a later expansion');
  });
});
