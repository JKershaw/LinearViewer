/**
 * LIN-3254 review nit — `public/session.js`'s `initRunToggles` whole-card click
 * must not collapse a run when the click lands inside an interactive
 * descendant. It already excluded `.sess-inline-reply` (and buttons/links/
 * textareas); a proposal row (`.sess-proposals`) was missed, so clicking a
 * proposal's text collapsed the run out from under the reader.
 *
 * The REAL `toggleRun`/`initRunToggles` source is sliced out of public/session.js
 * (LIN-4307: on the shared fake DOM through loadWorld, with no private vm), and run
 * over a run card that the test draws as markup, so the shipped selector is what decides.
 *
 * Run with: node --test tests/unit/lin-3254-session-run-toggles.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorld, clickOn } from './helpers/client-world.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_JS_SRC = readFileSync(join(__dirname, '../../public/session.js'), 'utf8');

function extractToggleSrc() {
  const start = SESSION_JS_SRC.indexOf('function toggleRun(');
  assert.notEqual(start, -1, 'toggleRun found in public/session.js');
  const end = SESSION_JS_SRC.indexOf('function renderRunTranscripts(', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return SESSION_JS_SRC.slice(start, end);
}

// One run card: the toggle head, a proposal row, and an inline reply box, as the run's own markup lays them out.
const RUN_CARD = `<div class="sess-run">
  <div data-testid="session-run-toggle" aria-expanded="false">Run</div>
  <div class="sess-proposals"><span class="sess-proposal-text">Proposal</span></div>
  <div class="sess-inline-reply"><span class="sess-reply-text">Reply</span></div>
</div>`;

// The world the slice runs in: the run card drawn on the page, then initRunToggles run over it.
function makeWorld() {
  const world = loadWorld({ scripts: [] });
  world.document.body.innerHTML = RUN_CARD;
  world.run(extractToggleSrc());
  world.run('initRunToggles()');
  const run = world.document.querySelector('.sess-run');
  return {
    run,
    head: run.querySelector('[data-testid="session-run-toggle"]'),
    proposal: world.document.querySelector('.sess-proposal-text'),
    reply: world.document.querySelector('.sess-reply-text'),
  };
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
