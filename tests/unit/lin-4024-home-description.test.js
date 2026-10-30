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
import vm from 'node:vm';
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

// An element that answers any property with another element, so app.js's init can run over it. The tests below hand
// the click handler its own small nodes (the fold, the show-more block) and read what they become.
function stand_in() {
  const target = function () {};
  target.dataset = {};
  return new Proxy(target, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === 'then' || typeof p === 'symbol') return undefined;
      if (p in t) return t[p];
      if (p === 'length') return 0;
      if (p === 'closest' || p === 'querySelector') return () => null;
      if (p === 'querySelectorAll') return () => [];
      if (p === 'getAttribute') return () => null;
      if (p === 'classList') return { toggle: () => false, add() {}, remove() {}, contains: () => false };
      return stand_in();
    },
    apply() { return stand_in(); },
    set(t, p, v) { t[p] = v; return true; },
  });
}

// Loads public/app.js for real, runs its DOMContentLoaded init (which registers the delegated click handler), and
// returns a `click(target)` that dispatches a click through every registered handler. `renders` records each
// markdown render, so a test counts renders, not calls to a helper.
function loadAppJs() {
  const renders = [];
  const listeners = {};
  const doc = stand_in();
  doc.readyState = 'complete';
  doc.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
  const win = stand_in();
  win.addEventListener = () => {};
  const context = vm.createContext({
    document: doc,
    window: win,
    console: { log() {}, error() {}, warn() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: () => new Promise(() => {}),
    renderMarkdown: (text) => { renders.push(text); return `<p>${text}</p>`; },
    location: win.location, navigator: stand_in(), history: stand_in(),
  });
  vm.runInContext(APP, context, { filename: 'public/app.js' });
  for (const fn of listeners.DOMContentLoaded || []) fn({});
  const click = (target) => {
    const event = { target, stopPropagation() {}, preventDefault() {} };
    for (const fn of listeners.click || []) fn(event);
  };
  return { click, renders };
}

// A fold's click target: `closest` answers only the selectors the handler asks for.
const clickTargetFor = (answers) => ({ closest: (selector) => answers[selector] ?? null });

describe('Home description — the client renders the markdown on first open (public/app.js, run)', () => {
  const encoded = Buffer.from(DESCRIPTION).toString('base64');

  test('Home\'s description fold renders its markdown the first time it opens, and not again', () => {
    const { click, renders } = loadAppJs();
    const home = stand_in();
    home.dataset = { rawDesc: encoded, urlKey: 'ws' };
    const content = { classList: hiddenFlag(true), querySelector: (sel) => (sel === '.home-description' ? home : null) };
    const details = { querySelector: (sel) => (sel === '[data-content="description"]' ? content : null) };
    const foldToggle = { dataset: { toggle: 'description' }, textContent: '▶ Description', closest: (sel) => (sel === '.details' ? details : null) };
    const target = clickTargetFor({ '.detail-toggle': foldToggle });

    click(target);
    assert.equal(renders.length, 1, 'the first open renders the description');
    assert.equal(renders[0], DESCRIPTION, 'it renders the description exactly');
    assert.equal(home.dataset.rendered, 'true', 'the body is marked rendered');
    assert.ok(home.innerHTML.includes(DESCRIPTION), 'the rendered markdown is what the fold shows');

    click(target); // close
    click(target); // open again
    assert.equal(renders.length, 1, 'a second open does not render it again');
  });

  test('the show-more block and Home\'s fold share one renderer, each rendering on its first open', () => {
    const { click, renders } = loadAppJs();
    const fullContent = stand_in();
    fullContent.dataset = { rawDesc: encoded, urlKey: 'ws' };
    const truncated = { classList: hiddenFlag(false) };
    const full = { classList: hiddenFlag(true) };
    const container = {
      dataset: { rawDesc: encoded, urlKey: 'ws' },
      querySelector: (sel) => ({ '.desc-truncated': truncated, '.desc-full': full, '.desc-full-content': fullContent })[sel] ?? null,
    };
    const showMore = { closest: (sel) => (sel === '.issue-description' ? container : null) };
    const showMoreTarget = clickTargetFor({ '.issue-desc-toggle': showMore, '.issue-description': container });

    click(showMoreTarget);
    assert.equal(renders.length, 1, 'show more renders on its first expansion');
    click(showMoreTarget);
    click(showMoreTarget);
    assert.equal(renders.length, 1, 'and does not render again on a later expansion');
  });
});

/** A `classList` whose `toggle('hidden')` flips a flag and returns the new state, as the browser does. */
function hiddenFlag(hidden) {
  let state = hidden;
  return { toggle: () => { state = !state; return state; }, contains: () => state };
}
