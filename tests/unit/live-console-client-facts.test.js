/**
 * LIN-3977 — what the client writes for a lane, and how it follows reduced motion.
 *
 * Run with: node --test tests/unit/live-console-client-facts.test.js
 *
 * The lane's words (title, stage, "waiting on you", the run link) are driven through the real updateLaneNode in a
 * vm world over the shared fake DOM (tests/unit/helpers/fake-dom.js, through client-world.js). The page is the
 * server's own markup, with its initial state removed, so every hidden or written value is the client's write. The
 * lane is supplied as markup, because laneNode is not exported and it only runs once a feed resolves (see LANE_CONTENTS).
 * Reduced motion is pinned at the source: the one-shot constant is gone and a live `change` listener re-applies it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorld } from './helpers/client-world.js';
import { harnessModelsBlock } from '../../lib/model-routing-harnesses.js';
import { renderLiveConsolePage } from '../../lib/render-live-console.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const CLIENT_SRC = read('public/live-console.js');

// The server's page, body only. The fake parser rejects `<!doctype …>`, so the doctype is removed first. Every
// `hidden` and `aria-expanded="false"` the server ships is removed too, so each hidden value a test reads is the client's.
function pageBody() {
  const html = renderLiveConsolePage({ urlKey: 'ws' }).replace(/<!doctype[^>]*>/i, '');
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
  return body.replace(/<[^>]*>/g, (tag) => tag.replace(/\shidden(?=[\s>])/g, '').replace(/\saria-expanded="false"/g, ''));
}

// The lane markup laneNode builds (live-console.js, `function laneNode`), with its initial `hidden` attributes removed
// so updateLaneNode's writes are what the tests see. laneNode is not exported, and it only runs once a feed resolves,
// which the pending feed keeps out of reach, so the suite supplies the lane. pinLaneMarkupToClient ties its classes
// to the client source, and counts its anchors: drift in laneNode turns the test that uses it red.
const LANE_CONTENTS = `
        <span class="lc-lane-bar" aria-hidden="true"></span>
        <span class="lc-lane-head">
          <a class="lc-lane-task" data-testid="live-console-lane-task" href="#"></a>
          <span class="lc-lane-title-sep" aria-hidden="true">·</span>
          <span class="lc-lane-title" data-testid="live-console-lane-title"></span>
          <a class="lc-lane-run" data-testid="live-console-lane-run" href="#">open run ↗</a>
          <span class="lc-lane-ws"></span>
        </span>
        <span class="lc-lane-stage-row">
          <span class="lc-lane-stage" data-testid="live-console-lane-stage"></span>
          <span class="lc-lane-since" data-testid="live-console-lane-since"></span>
          <span class="lc-lane-action" data-testid="live-console-lane-action"></span>
          <span class="lc-lane-tickets" data-testid="live-console-lane-tickets"></span>
        </span>
        <span class="lc-lane-mid">
          <span class="lc-lane-cred" data-testid="live-console-lane-credential"></span>
          <span class="lc-lane-hb" data-testid="live-console-heartbeat"></span>
          <span class="lc-lane-summary"></span>
        </span>`;

// Loads the real common.js, then the real live-console.js, into one world over the server's page. Storage is an
// empty stub on both the window and the global, as the old suite had it.
function loadClient() {
  const storageStub = { getItem: () => null, setItem() {} };
  const storageProps = {};
  Object.defineProperty(storageProps, 'localStorage', { enumerable: true, configurable: true, get: () => storageStub });
  const world = loadWorld({
    window: Object.defineProperties({
      __LIVE_CONSOLE_DATA__: { urlKey: 'ws', workspaces: [] },
      __HARNESS_MODELS__: harnessModelsBlock(),
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      removeEventListener() {},
      // PENDING FEED. window.api never resolves, so poll() never reaches applyFeed. applyFeed's `style` writes
      // (live-console.js:338-340, :408, :482, :489, :516-519) stay out of reach. A later test that resolves this
      // feed has hit that stop: it must not add `style` to the fake. See LIN-4271.
      api: async () => new Promise(() => {}),
    }, Object.getOwnPropertyDescriptors(storageProps)),
    scripts: ['common.js'],
    // The client's setTimeout calls are collected, not run, so no timer outlives the test.
    timers: [],
    globals: Object.defineProperties({
      module: { exports: {} },
      requestAnimationFrame: () => 0,
      cancelAnimationFrame() {},
      setInterval: () => 0,
      clearInterval() {},
    }, Object.getOwnPropertyDescriptors(storageProps)),
  });
  // The page is in place before the client boots, so every id it looks up at load is a real element.
  world.document.body.innerHTML = pageBody();
  world.run(CLIENT_SRC);
  return world;
}

// The lane's classes and anchors, pinned to laneNode and to updateLaneNode's own selectors. A class that laneNode drops,
// or that updateLaneNode queries and the fixture lacks, is red here. The anchor count also goes red if laneNode emits a
// second task link: laneNode has exactly two anchors, the task link and the run link.
function pinLaneMarkupToClient() {
  const start = CLIENT_SRC.indexOf('function laneNode(lane)');
  const template = CLIENT_SRC.slice(start, CLIENT_SRC.indexOf('updateLaneNode(li, lane);', start));
  assert.ok(template.includes('<li class="lc-lane'), 'laneNode still builds the lane the fixture mirrors');
  assert.equal((template.match(/<a class=/g) || []).length, 2, 'laneNode emits one task link and one run link, nothing else');
  const queried = [...CLIENT_SRC.matchAll(/li\.querySelector\('\.([a-z-]+)'\)/g)].map(m => m[1]);
  assert.ok(queried.length > 0, 'updateLaneNode queries its lane parts');
  for (const cls of queried) {
    assert.ok(template.includes(`class="${cls}"`), `laneNode builds .${cls}`);
    assert.ok(LANE_CONTENTS.includes(`class="${cls}"`), `the lane fixture carries .${cls}`);
  }
}

describe('a lane says what it is doing, in words', () => {
  function laneHarness() {
    const world = loadClient();
    const li = world.document.createElement('li');
    li.setAttribute('class', 'lc-lane');
    li.innerHTML = LANE_CONTENTS;
    pinLaneMarkupToClient();
    return { updateLaneNode: world.sandbox.module.exports.updateLaneNode, li };
  }
  const base = { task: 'LIN-5', workspaceUrlKey: 'ws', workspaceName: 'WS', summary: '', heartbeat: null };

  test('a waiting lane reads "waiting on you", with its time and its question', () => {
    const { updateLaneNode, li } = laneHarness();
    updateLaneNode(li, { ...base, waiting: true, waitingSince: Date.parse('2026-10-25T11:55:00Z'), waitingFor: 'Which branch?' });
    assert.match(li.querySelector('.lc-lane-action').textContent, /^waiting on you since /);
    assert.equal(li.querySelector('.lc-lane-action').getAttribute('data-waiting'), '1');
    assert.equal(li.querySelector('.lc-lane-summary').textContent, 'Which branch?');
  });

  test('a waiting lane with no time says "waiting on you" alone', () => {
    const { updateLaneNode, li } = laneHarness();
    updateLaneNode(li, { ...base, waiting: true, waitingSince: null });
    assert.equal(li.querySelector('.lc-lane-action').textContent, 'waiting on you');
  });

  test('a working lane reads "working", never "waiting"', () => {
    const { updateLaneNode, li } = laneHarness();
    updateLaneNode(li, { ...base, waiting: false, action: 'implementation' });
    assert.equal(li.querySelector('.lc-lane-action').textContent, 'working');
    assert.equal(li.querySelector('.lc-lane-action').getAttribute('data-waiting'), null);
  });

  test('the title and the plain stage word are written as given (the server names them)', () => {
    const { updateLaneNode, li } = laneHarness();
    updateLaneNode(li, { ...base, title: 'Ship the thing', stage: 'Build', action: 'implementation' });
    assert.equal(li.querySelector('.lc-lane-title').textContent, 'Ship the thing');
    assert.equal(li.querySelector('.lc-lane-title').hidden, false);
    assert.equal(li.querySelector('.lc-lane-stage').textContent, 'Build');
  });

  test('no title: the title element is hidden, the task still shows', () => {
    const { updateLaneNode, li } = laneHarness();
    updateLaneNode(li, { ...base, title: null, stage: 'Build' });
    assert.equal(li.querySelector('.lc-lane-title').hidden, true);
    assert.equal(li.querySelector('.lc-lane-task').textContent, 'LIN-5');
  });

  test('a credential that is not dead does not show ("credential unknown" never appears)', () => {
    const { updateLaneNode, li } = laneHarness();
    updateLaneNode(li, { ...base, credential: { state: 'unknown', label: null } });
    assert.equal(li.querySelector('.lc-lane-cred').hidden, true);
    assert.equal(li.querySelector('.lc-lane-cred').textContent, '');
  });

  test('a dead credential shows, with the re-issue words', () => {
    const { updateLaneNode, li } = laneHarness();
    updateLaneNode(li, { ...base, credential: { state: 'dead', label: null } });
    assert.equal(li.querySelector('.lc-lane-cred').hidden, false);
    assert.match(li.querySelector('.lc-lane-cred').textContent, /re-issue/);
  });
});

describe('every run-related lane links to its run page', () => {
  function laneHarness() {
    const world = loadClient();
    const li = world.document.createElement('li');
    li.setAttribute('class', 'lc-lane');
    li.innerHTML = LANE_CONTENTS;
    pinLaneMarkupToClient();
    return { updateLaneNode: world.sandbox.module.exports.updateLaneNode, li };
  }
  const base = { task: 'LIN-5', workspaceUrlKey: 'ws', workspaceName: 'WS', summary: '', heartbeat: null };

  test('a lane with a session id links the run page; the task links the task page; there is no second task link', () => {
    const { updateLaneNode, li } = laneHarness();
    updateLaneNode(li, { ...base, sessionId: 'S1', issueSource: 'linear' });
    assert.equal(li.querySelector('.lc-lane-run').getAttribute('href'), '/workspace/ws/observation/session/S1');
    assert.equal(li.querySelector('.lc-lane-run').hidden, false);
    assert.equal(li.querySelector('.lc-lane-task').getAttribute('href'), '/workspace/ws/task/LIN-5?source=linear');
    // "the separate 'task ↗' link is gone" is checked against the client source, not against the fixture: the fixture
    // can never carry a link the client does not emit. pinLaneMarkupToClient's anchor count also pins it to two anchors.
    assert.equal(/lc-lane-task-page/.test(CLIENT_SRC), false, 'the separate "task ↗" link is gone');
  });

  test('a lane with no session id has no run link to offer', () => {
    const { updateLaneNode, li } = laneHarness();
    updateLaneNode(li, { ...base, sessionId: null });
    assert.equal(li.querySelector('.lc-lane-run').hidden, true);
    assert.equal(li.querySelector('.lc-lane-run').getAttribute('href'), null);
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
    const world = loadClient();
    const li = world.document.createElement('li');
    // The lane starts without the pulse class, so the class on the node is the client's write, not the fixture's.
    li.setAttribute('class', 'lc-lane');
    li.innerHTML = LANE_CONTENTS;
    world.sandbox.module.exports.updateLaneNode(li, { task: 'LIN-5', workspaceUrlKey: 'ws', workspaceName: 'WS', summary: '', heartbeat: null });
    assert.equal(li.classList.contains('lc-lane--pulse'), true);
  });
});
