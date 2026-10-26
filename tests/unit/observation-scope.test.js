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
  const sandbox = {
    module: { exports: {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }), ChatUI: { appendOptions() {}, resolveCaption: () => '' }, sourceQuery: () => '' },
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
