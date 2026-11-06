/**
 * LIN-3254 review nit — `public/session.js`'s `initRunToggles` whole-card click
 * must not collapse a run when the click lands inside an interactive
 * descendant. It already excluded `.sess-inline-reply` (and buttons/links/
 * textareas); a proposal row (`.sess-proposals`) was missed, so clicking a
 * proposal's text collapsed the run out from under the reader.
 *
 * The REAL `toggleRun`/`initRunToggles` source is sliced out of public/session.js
 * (LIN-4307: on the shared fake DOM through loadWorld, with no private vm), and run
 * over the run page the server renders (renderSessionPage: one run with a pending proposal
 * and its reply box), so the shipped selector decides over the shipped markup.
 *
 * Run with: node --test tests/unit/lin-3254-session-run-toggles.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorld, clickOn } from './helpers/client-world.js';
import { renderSessionPageOf } from '../fixtures/cost-read-cores.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_JS_SRC = readFileSync(join(__dirname, '../../public/session.js'), 'utf8');

function extractToggleSrc() {
  const start = SESSION_JS_SRC.indexOf('function toggleRun(');
  assert.notEqual(start, -1, 'toggleRun found in public/session.js');
  const end = SESSION_JS_SRC.indexOf('function renderRunTranscripts(', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return SESSION_JS_SRC.slice(start, end);
}

// The run page as the server renders it: one run the owner can reply to, with one pending proposal (renderSessionPage,
// through the fixture that builds its run view). Body only: the fake parser takes no doctype.
const T = '2026-01-01T00:00:00.000Z';
function runPageBody() {
  const html = renderSessionPageOf({
    session: {
      sessionId: 'run-1', seedIssue: 'TEST-1', tasksTouched: ['TEST-1'], dispatchedAt: T, completedAt: T,
      telemetry: { runtime: { ms: 60000 }, metrics: [], producedArtifacts: [] },
      loops: [{
        loopId: 'loop-1', issueIdentifier: 'TEST-1', issueId: 'uuid-1', issueTitle: 'Seed task', iteration: 1,
        kind: 'autopilot', dispatchedAt: T, terminalStatus: 'done', terminalCompletedAt: T, feedback: [], telemetry: null,
      }],
    },
    sessionId: 'run-1', urlKey: 'ws', issueContext: [], canReply: true,
    proposals: [{ id: 'p1', runId: 'run-1', stepLoopId: 'loop-1', prompt: 'add a test', status: 'proposed' }],
  });
  return html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
}

// The world the slice runs in: the server's run page drawn, then initRunToggles run over it. The click targets are
// plain text inside each excluded region (the proposal's prompt, the reply box's thread), never a button or textarea,
// which the selector excludes on their own.
function makeWorld() {
  const world = loadWorld({ scripts: [] });
  world.document.body.innerHTML = runPageBody();
  world.run(extractToggleSrc());
  world.run('initRunToggles()');
  const runs = world.document.querySelectorAll('.sess-run');
  assert.equal(runs.length, 1, 'the page has the one run');
  const run = runs[0];
  const found = {
    run,
    head: run.querySelector('[data-testid="session-run-toggle"]'),
    proposal: run.querySelector('.sess-proposals .sess-proposal-prompt'),
    reply: run.querySelector('.sess-inline-reply [data-testid="session-inline-reply-thread"]'),
  };
  for (const [name, el] of Object.entries(found)) assert.ok(el, `the server's run card has its ${name}`);
  return found;
}

test('initRunToggles ignores a click inside .sess-proposals (LIN-3254 nit)', async () => {
  const { run, head, proposal } = makeWorld();
  assert.equal(run.listenersOf('click').length, 1, 'the run registered one click handler');

  await clickOn(run, proposal);

  assert.equal(run.classList.contains('sess-run--expanded'), false, 'a click on a proposal must not collapse the run');
  assert.equal(head.getAttribute('aria-expanded'), 'false', 'aria-expanded must be left alone');
});

test('initRunToggles still toggles on a plain card click, and still ignores the reply box', async () => {
  const { run, head, reply } = makeWorld();

  await clickOn(run, reply);
  assert.equal(run.classList.contains('sess-run--expanded'), false, 'the reply box stays excluded');

  await clickOn(run);
  assert.equal(run.classList.contains('sess-run--expanded'), true, 'a plain click on the card toggles the run');
  assert.equal(head.getAttribute('aria-expanded'), 'true');
});
