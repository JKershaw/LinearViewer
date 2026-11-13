/**
 * LIN-3983 PR 2, decision 4: the Observation feed opens on this workspace, as Live Console does. "All
 * workspaces" widens it and the chips filter inside it. The waiting block ignores the scope, so a question
 * waiting in another workspace is still on it.
 *
 * `public/observation.js` is a native ES module (LIN-4463 piece 4), loaded fresh per test through `importWorld`
 * (tests/unit/helpers/import-world.js) over the shared fake DOM. The page boots the way a browser boots it: its data
 * is on `window` and its own DOMContentLoaded init runs. The scope buttons and the workspace chips are real elements
 * in the world's document, pressed and read back the way a person sees them (`hidden`, `classList`, `dataset`).
 *
 * Run with: node --test tests/unit/observation-scope.test.js
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { importWorld } from './helpers/import-world.js';
import { clickOn, fireDOMContentLoaded } from './helpers/client-world.js';

// Every world a test makes is put back after the test, last made first, so a stub a later world installed
// is removed before the earlier world's snapshot is restored.
const worlds = [];
afterEach(() => {
  while (worlds.length) worlds.pop().restore();
});

const WORKSPACES = [{ urlKey: 'acme', name: 'Acme' }, { urlKey: 'other', name: 'Other' }];

// The scope control and the workspace chips, as the page draws them: the chips start hidden, and
// the scope buttons and chips are real buttons in the document.
const SCOPE_MARKUP = `
  <div id="obs-scope">
    <button data-scope="current">This workspace</button>
    <button data-scope="all">All workspaces</button>
  </div>
  <div id="obs-chips" hidden>
    <button class="obs-chip" data-ws="acme">Acme</button>
    <button class="obs-chip" data-ws="other">Other</button>
  </div>`;

// observation.js booted in a world over the shared fake DOM. The location and history are the browser's, not DOM, so
// they stay as window stubs. replaceState writes the URL the way a browser does, and the tests read it back from
// `location.href`. The boot runs with the tab hidden, as a background tab's does, so the page's pollers make no read.
async function makeWorld() {
  const location = { href: 'https://harbour.test/workspace/acme/observation' };
  const history = {
    state: null,
    replaceState(state, title, url) { location.href = new URL(url, location.href).href; }
  };
  const world = importWorld({
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      ChatUI: { appendOptions() {}, resolveCaption: () => '' },
      sourceQuery: () => '',
      location,
      history
    },
    globals: {
      escapeHtml: (s) => (s == null ? '' : String(s)),
      relativeTime: () => '',
      console: { warn() {}, error() {}, log() {} },
      fetch: async () => { throw new Error('no fetch'); }
    },
    timers: [],
  });
  worlds.push(world);
  world.document.body.innerHTML = SCOPE_MARKUP;
  world.window.__OBSERVATION_DATA__ = { urlKey: 'acme', workspaces: WORKSPACES };
  world.page = await world.importPage('observation.js');
  world.document.hidden = true;
  await fireDOMContentLoaded(world.document);
  world.document.hidden = false;
  return world;
}

// Presses a scope button as a person does: the page's own click handler runs (the scope, then the URL).
async function pressScope(world, scope) {
  await clickOn(world.document.getElementById('obs-scope'), world.document.querySelector(`#obs-scope [data-scope="${scope}"]`));
}

const byId = (world, id) => world.document.getElementById(id);
const chipEls = (world) => [...world.document.querySelectorAll('#obs-chips .obs-chip')];
const scopeBtns = (world) => [...world.document.querySelectorAll('#obs-scope [data-scope]')];
// The workspaces the feed hides, as the chips show them: applyWorkspaceScope sets each chip's `is-on` from the
// page's hidden set, so a chip that is off is a hidden workspace. (The set itself is module-private.)
const hidden = (world) => chipEls(world).filter(c => !c.classList.contains('is-on')).map(c => c.dataset.ws).sort();

// The scope rides in the URL like the view and filter: scope=all reopens All workspaces, and This workspace
// (the default) writes nothing. replaceState keeps the history clean, as for the view.
describe('the scope in the URL (LIN-3983 PR 2)', () => {
  const scopeOf = (world, qs) => world.page.scopeFromParams(new URLSearchParams(qs));
  const written = (world) => new URL(world.window.location.href).searchParams;

  test('scope=all opens All workspaces; a bare or unknown scope opens This workspace', async () => {
    const world = await makeWorld();
    assert.equal(scopeOf(world, 'scope=all'), 'all');
    assert.equal(scopeOf(world, ''), 'current');
    assert.equal(scopeOf(world, 'scope=garbage'), 'current');
  });

  test('pressing All workspaces writes scope=all, and going back to This workspace drops it', async () => {
    const world = await makeWorld();
    await pressScope(world, 'all');
    assert.equal(written(world).get('scope'), 'all');
    await pressScope(world, 'current');
    assert.equal(written(world).has('scope'), false, 'the default is a bare scope');
  });

  test('the scope survives a reload: the URL a press writes reopens All workspaces', async () => {
    const world = await makeWorld();
    await pressScope(world, 'all');
    assert.equal(scopeOf(world, written(world).toString()), 'all');
  });

  test('the scope and the view are written together, and the view keeps its own parameter', async () => {
    const world = await makeWorld();
    world.page.switchView('rulings');
    await pressScope(world, 'all');
    assert.equal(written(world).get('view'), 'rulings');
    assert.equal(written(world).get('scope'), 'all');
  });
});

describe('the workspace scope (LIN-3983 PR 2)', () => {
  test('the feed opens on this workspace: the others are hidden and their chips are off', async () => {
    const world = await makeWorld();
    await pressScope(world, 'current');
    assert.deepEqual(hidden(world), ['other']);
    assert.equal(chipEls(world)[0].classList.contains('is-on'), true, 'this workspace is on');
    assert.equal(chipEls(world)[1].classList.contains('is-on'), false, 'the other is off');
    assert.equal(byId(world, 'obs-chips').hidden, true, 'the chips are not offered until All workspaces is chosen');
  });

  test('All workspaces shows every workspace, with the chips on and offered', async () => {
    const world = await makeWorld();
    await pressScope(world, 'all');
    assert.deepEqual(hidden(world), [], 'nothing is hidden');
    assert.equal(byId(world, 'obs-chips').hidden, false);
    assert.ok(chipEls(world).every(c => c.classList.contains('is-on')));
    assert.equal(scopeBtns(world)[1].classList.contains('is-on'), true);
    assert.equal(scopeBtns(world)[0].classList.contains('is-on'), false);
  });

  test('going back to This workspace hides the others again', async () => {
    const world = await makeWorld();
    await pressScope(world, 'all');
    await pressScope(world, 'current');
    assert.deepEqual(hidden(world), ['other']);
  });

  test('the waiting block ignores the scope: a question in another workspace is still a candidate for it', async () => {
    const world = await makeWorld();
    await pressScope(world, 'current');
    // compactWaitSessions reads every session it is given, never the scope.
    const rows = world.page.compactWaitSessions([{ sessionId: 's', workspaceUrlKey: 'other', workspaceName: 'Other', status: 'waiting', waitingLoopIds: ['p'], producerLoopId: 'p', waitingMessage: '[blocked] hi' }], new Set());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].workspaceUrlKey, 'other');
  });
});
