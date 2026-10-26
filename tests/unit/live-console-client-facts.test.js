/**
 * LIN-3977 — what the client writes for a lane, and how it follows reduced motion.
 *
 * Run with: node --test tests/unit/live-console-client-facts.test.js
 *
 * The lane's words (title, stage, "waiting on you", the run link) are driven through
 * the real updateLaneNode in a vm sandbox, the same seam the LIN-3331 test uses.
 * Reduced motion is pinned at the source: the one-shot constant is gone and a live
 * `change` listener re-applies it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { withHarnessModels } from '../fixtures/harness-models.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const COMMON_SRC = read('public/common.js');
const CLIENT_SRC = read('public/live-console.js');

function makeEl() {
  return {
    innerHTML: '', textContent: '', hidden: false, className: '', dataset: {}, style: {},
    _attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] ?? null; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener() {}, remove() {}, appendChild() {}, insertAdjacentHTML() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

function laneHarness() {
  const els = new Map();
  const el = (key) => { if (!els.has(key)) els.set(key, makeEl()); return els.get(key); };
  const sandbox = {
    location: { search: '', href: '' },
    document: {
      title: '', hidden: false,
      getElementById: (id) => el(`#${id}`),
      querySelector: (sel) => el(sel),
      querySelectorAll: () => [],
      createElement: () => makeEl(),
      addEventListener() {},
    },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false }),
    addEventListener() {}, removeEventListener() {},
    module: { exports: {} },
    console,
    __LIVE_CONSOLE_DATA__: { urlKey: 'ws', workspaces: [] },
    PULSE_SPAN_RUNGS_MS: [180000],
    api: async () => new Promise(() => {}),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(withHarnessModels(COMMON_SRC), sandbox, { filename: 'common.js' });
  vm.runInContext(CLIENT_SRC, sandbox, { filename: 'live-console.js' });
  const { updateLaneNode } = sandbox.module.exports;
  const anchors = {};
  const li = { classList: { toggle() {} }, querySelector: (sel) => { if (!anchors[sel]) anchors[sel] = makeEl(); return anchors[sel]; } };
  return { updateLaneNode, li, anchors };
}

const base = { task: 'LIN-5', workspaceUrlKey: 'ws', workspaceName: 'WS', summary: '', heartbeat: null };

describe('a lane says what it is doing, in words', () => {
  test('a waiting lane reads "waiting on you", with its time and its question', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { ...base, waiting: true, waitingSince: Date.parse('2026-10-25T11:55:00Z'), waitingFor: 'Which branch?' });
    assert.match(anchors['.lc-lane-action'].textContent, /^waiting on you since /);
    assert.equal(anchors['.lc-lane-action'].getAttribute('data-waiting'), '1');
    assert.equal(anchors['.lc-lane-summary'].textContent, 'Which branch?');
  });

  test('a waiting lane with no time says "waiting on you" alone', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { ...base, waiting: true, waitingSince: null });
    assert.equal(anchors['.lc-lane-action'].textContent, 'waiting on you');
  });

  test('a working lane reads "working", never "waiting"', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { ...base, waiting: false, action: 'implementation' });
    assert.equal(anchors['.lc-lane-action'].textContent, 'working');
    assert.equal(anchors['.lc-lane-action'].getAttribute('data-waiting'), null);
  });

  test('the title and the plain stage word are written as given (the server names them)', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { ...base, title: 'Ship the thing', stage: 'Build', action: 'implementation' });
    assert.equal(anchors['.lc-lane-title'].textContent, 'Ship the thing');
    assert.equal(anchors['.lc-lane-title'].hidden, false);
    assert.equal(anchors['.lc-lane-stage'].textContent, 'Build');
  });

  test('no title: the title element is hidden, the task still shows', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { ...base, title: null, stage: 'Build' });
    assert.equal(anchors['.lc-lane-title'].hidden, true);
    assert.equal(anchors['.lc-lane-task'].textContent, 'LIN-5');
  });

  test('a credential that is not dead does not show ("credential unknown" never appears)', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { ...base, credential: { state: 'unknown', label: null } });
    assert.equal(anchors['.lc-lane-cred'].hidden, true);
    assert.equal(anchors['.lc-lane-cred'].textContent, '');
  });

  test('a dead credential shows, with the re-issue words', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { ...base, credential: { state: 'dead', label: null } });
    assert.equal(anchors['.lc-lane-cred'].hidden, false);
    assert.match(anchors['.lc-lane-cred'].textContent, /re-issue/);
  });
});

describe('every run-related lane links to its run page', () => {
  test('a lane with a session id links the run page; the task links the task page; there is no second task link', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { ...base, sessionId: 'S1', issueSource: 'linear' });
    assert.equal(anchors['.lc-lane-run'].getAttribute('href'), '/workspace/ws/observation/session/S1');
    assert.equal(anchors['.lc-lane-run'].hidden, false);
    assert.equal(anchors['.lc-lane-task'].getAttribute('href'), '/workspace/ws/task/LIN-5?source=linear');
    assert.equal(anchors['.lc-lane-task-page'], undefined, 'the separate "task ↗" link is gone');
  });

  test('a lane with no session id has no run link to offer', () => {
    const { updateLaneNode, li, anchors } = laneHarness();
    updateLaneNode(li, { ...base, sessionId: null });
    assert.equal(anchors['.lc-lane-run'].hidden, true);
    assert.equal(anchors['.lc-lane-run'].getAttribute('href'), null);
  });
});

describe('reduced motion is read live, not once at load', () => {
  test('no bare REDUCED_MOTION constant is left in the client', () => {
    assert.equal(/\bREDUCED_MOTION\b/.test(CLIENT_SRC), false);
  });

  test('a change of the motion query re-applies it to the reused nodes and the strip', () => {
    assert.match(CLIENT_SRC, /motionQuery\.addEventListener\('change'/);
    assert.match(CLIENT_SRC, /function applyMotion\(\)/);
    assert.match(CLIENT_SRC, /classList\.toggle\('lc-lane--pulse', !reducedMotion\)/);
  });

  test('the lane node reads the live flag, so a reused node follows the change', () => {
    const { updateLaneNode, li } = laneHarness();
    const toggled = [];
    li.classList.toggle = (cls, on) => toggled.push([cls, on]);
    updateLaneNode(li, base);
    assert.deepEqual(toggled.find(([c]) => c === 'lc-lane--pulse'), ['lc-lane--pulse', true]);
  });
});
