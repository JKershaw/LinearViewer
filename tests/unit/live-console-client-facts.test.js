/**
 * LIN-3977 — what the client writes for a lane, and how it follows reduced motion.
 *
 * Run with: node --test tests/unit/live-console-client-facts.test.js
 *
 * The lane's words (title, stage, "waiting on you", the run link) are driven through the real updateLaneNode in a
 * vm world over the shared fake DOM (tests/unit/helpers/fake-dom.js, through client-world.js), loaded by the Live
 * Console loader in helpers/live-console-world.js. The lane is supplied as markup (makeLaneNode), pinned to the client
 * source (pinLaneMarkupToClient). Reduced motion is pinned at the source: the one-shot constant is gone and a live
 * `change` listener re-applies it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_SRC, loadLiveConsole, makeLaneNode, pinLaneMarkupToClient } from './helpers/live-console-world.js';

describe('a lane says what it is doing, in words', () => {
  function laneHarness() {
    pinLaneMarkupToClient();
    const { api, world } = loadLiveConsole();
    return { updateLaneNode: api.updateLaneNode, li: makeLaneNode(world) };
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
    // Start the title hidden, so the `hidden === false` below is the client's write and not the fixture's.
    li.querySelector('.lc-lane-title').hidden = true;
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
    pinLaneMarkupToClient();
    const { api, world } = loadLiveConsole();
    return { updateLaneNode: api.updateLaneNode, li: makeLaneNode(world) };
  }
  const base = { task: 'LIN-5', workspaceUrlKey: 'ws', workspaceName: 'WS', summary: '', heartbeat: null };

  test('a lane with a session id links the run page; the task links the task page; there is no second task link', () => {
    const { updateLaneNode, li } = laneHarness();
    // Start the run link hidden, so the `hidden === false` below is the client's write and not the fixture's.
    li.querySelector('.lc-lane-run').hidden = true;
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
    const { api, world } = loadLiveConsole();
    const li = makeLaneNode(world);
    // The lane starts without the pulse class, so the class on the node is the client's write, not the fixture's.
    api.updateLaneNode(li, { task: 'LIN-5', workspaceUrlKey: 'ws', workspaceName: 'WS', summary: '', heartbeat: null });
    assert.equal(li.classList.contains('lc-lane--pulse'), true);
  });
});
