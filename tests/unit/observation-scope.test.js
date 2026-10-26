/**
 * LIN-3983 PR 2, decision 4: the Observation feed opens on this workspace, as Live Console does. "All
 * workspaces" widens it and the chips filter inside it. The waiting block ignores the scope, so a question
 * waiting in another workspace is still on it.
 *
 * Run with: node --test tests/unit/observation-scope.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FakeElement } from '../fixtures/observation-dom-shim.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBSERVATION_JS_SRC = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');
const WORKSPACES = [{ urlKey: 'acme', name: 'Acme' }, { urlKey: 'other', name: 'Other' }];

function makeSandbox() {
  const chips = new FakeElement('div');
  chips.hidden = true;
  const chipEls = WORKSPACES.map(w => { const c = new FakeElement('button'); c.dataset.ws = w.urlKey; c.classList.add('obs-chip'); return c; });
  chips.querySelectorAll = (sel) => (sel === '.obs-chip' ? chipEls : []);
  const scopeBtns = ['current', 'all'].map(s => { const b = new FakeElement('button'); b.dataset.scope = s; return b; });
  const scope = new FakeElement('div');
  scope.querySelectorAll = (sel) => (sel === '#obs-scope [data-scope]' || sel === '[data-scope]' ? scopeBtns : []);
  const elements = { 'obs-chips': chips, 'obs-scope': scope };
  const win = {
      addEventListener() {}, matchMedia: () => ({ matches: false }), ChatUI: { appendOptions() {}, resolveCaption: () => '' }, sourceQuery: () => '',
      location: { href: 'https://harbour.test/workspace/acme/observation' },
      history: { state: null, replaceState: (state, title, url) => { win.location.href = new URL(url, win.location.href).href; } },
    };
  const sandbox = {
    module: { exports: {} },
    window: win,
    URL, URLSearchParams,
    document: {
      createElement: (tag) => new FakeElement(tag),
      addEventListener() {},
      getElementById: (id) => elements[id] || null,
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === '#obs-scope [data-scope]' ? scopeBtns : []),
    },
    escapeHtml: (s) => (s == null ? '' : String(s)),
    relativeTime: () => '',
    console: { warn() {}, error() {}, log() {} },
    fetch: async () => { throw new Error('no fetch'); },
    setTimeout, clearTimeout,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(OBSERVATION_JS_SRC, sandbox, { filename: 'observation.js' });
  vm.runInContext(`observationData = { urlKey: "acme", workspaces: ${JSON.stringify(WORKSPACES)} };`, sandbox);
  return { sandbox, chips, chipEls, scopeBtns };
}

// Values made inside the vm carry that realm's prototypes; a JSON copy compares structurally here.
const hidden = (sandbox) => JSON.parse(vm.runInContext('JSON.stringify([...hiddenWorkspaces].sort())', sandbox));

// The scope rides in the URL like the view and filter: scope=all reopens All workspaces, and This workspace
// (the default) writes nothing. replaceState keeps the history clean, as for the view.
describe('the scope in the URL (LIN-3983 PR 2)', () => {
  const scopeOf = (sandbox, qs) => vm.runInContext(`scopeFromParams(new URLSearchParams(${JSON.stringify(qs)}))`, sandbox);
  const written = (sandbox) => new URL(sandbox.window.location.href).searchParams;

  test('scope=all opens All workspaces; a bare or unknown scope opens This workspace', () => {
    const { sandbox } = makeSandbox();
    assert.equal(scopeOf(sandbox, 'scope=all'), 'all');
    assert.equal(scopeOf(sandbox, ''), 'current');
    assert.equal(scopeOf(sandbox, 'scope=garbage'), 'current');
  });

  test('pressing All workspaces writes scope=all, and going back to This workspace drops it', () => {
    const { sandbox } = makeSandbox();
    vm.runInContext("applyWorkspaceScope('all'); writeViewToUrl()", sandbox);
    assert.equal(written(sandbox).get('scope'), 'all');
    vm.runInContext("applyWorkspaceScope('current'); writeViewToUrl()", sandbox);
    assert.equal(written(sandbox).has('scope'), false, 'the default is a bare scope');
  });

  test('the scope survives a reload: the URL a press writes reopens All workspaces', () => {
    const { sandbox } = makeSandbox();
    vm.runInContext("applyWorkspaceScope('all'); writeViewToUrl()", sandbox);
    assert.equal(scopeOf(sandbox, written(sandbox).toString()), 'all');
  });

  test('the scope and the view are written together, and the view keeps its own parameter', () => {
    const { sandbox } = makeSandbox();
    vm.runInContext("applyWorkspaceScope('all'); currentView = 'rulings'; writeViewToUrl()", sandbox);
    assert.equal(written(sandbox).get('view'), 'rulings');
    assert.equal(written(sandbox).get('scope'), 'all');
  });
});

describe('the workspace scope (LIN-3983 PR 2)', () => {
  test('the feed opens on this workspace: the others are hidden and their chips are off', () => {
    const { sandbox, chips, chipEls } = makeSandbox();
    vm.runInContext("applyWorkspaceScope('current')", sandbox);
    assert.deepEqual(hidden(sandbox), ['other']);
    assert.equal(chipEls[0].classList.contains('is-on'), true, 'this workspace is on');
    assert.equal(chipEls[1].classList.contains('is-on'), false, 'the other is off');
    assert.equal(chips.hidden, true, 'the chips are not offered until All workspaces is chosen');
  });

  test('All workspaces shows every workspace, with the chips on and offered', () => {
    const { sandbox, chips, chipEls, scopeBtns } = makeSandbox();
    vm.runInContext("applyWorkspaceScope('all')", sandbox);
    assert.deepEqual(hidden(sandbox), [], 'nothing is hidden');
    assert.equal(chips.hidden, false);
    assert.ok(chipEls.every(c => c.classList.contains('is-on')));
    assert.equal(scopeBtns[1].classList.contains('is-on'), true);
    assert.equal(scopeBtns[0].classList.contains('is-on'), false);
  });

  test('going back to This workspace hides the others again', () => {
    const { sandbox } = makeSandbox();
    vm.runInContext("applyWorkspaceScope('all')", sandbox);
    vm.runInContext("applyWorkspaceScope('current')", sandbox);
    assert.deepEqual(hidden(sandbox), ['other']);
  });

  test('the waiting block ignores the scope: a question in another workspace is still a candidate for it', () => {
    const { sandbox } = makeSandbox();
    vm.runInContext("applyWorkspaceScope('current')", sandbox);
    // compactWaitSessions reads every session it is given, never the scope.
    const rows = vm.runInContext(`compactWaitSessions([{ sessionId: 's', workspaceUrlKey: 'other', workspaceName: 'Other', status: 'waiting', waitingLoopIds: ['p'], producerLoopId: 'p', waitingMessage: '[blocked] hi' }], new Set())`, sandbox);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].workspaceUrlKey, 'other');
  });
});
