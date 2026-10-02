/**
 * LIN-3254 review nit — `public/session.js`'s `initRunToggles` whole-card click
 * must not collapse a run when the click lands inside an interactive
 * descendant. It already excluded `.sess-inline-reply` (and buttons/links/
 * textareas); a proposal row (`.sess-proposals`) was missed, so clicking a
 * proposal's text collapsed the run out from under the reader.
 *
 * Same vm-sandbox technique as session-run-transcript-entries.test.js: slice
 * the REAL `toggleRun`/`initRunToggles` source out of public/session.js and
 * drive it with minimal element stubs, so this exercises the shipped selector
 * rather than a reimplementation.
 *
 * Run with: node --test tests/unit/lin-3254-session-run-toggles.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_JS_SRC = readFileSync(join(__dirname, '../../public/session.js'), 'utf8');

function extractToggleSrc() {
  const start = SESSION_JS_SRC.indexOf('function toggleRun(');
  assert.notEqual(start, -1, 'toggleRun found in public/session.js');
  const end = SESSION_JS_SRC.indexOf('function renderRunTranscripts(', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return SESSION_JS_SRC.slice(start, end);
}

function makeSandbox() {
  const calls = { toggled: 0, ariaSet: [] };
  const head = {
    addEventListener() {},
    setAttribute(name, value) { calls.ariaSet.push([name, value]); },
  };
  const run = {
    classList: { toggle: () => { calls.toggled++; return true; } },
    querySelector: () => head,
  };
  const clickHandlers = [];
  run.addEventListener = (type, handler) => { if (type === 'click') clickHandlers.push(handler); };

  const sandbox = {
    document: { querySelectorAll: (sel) => (sel === '.sess-run' ? [run] : []) },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractToggleSrc(), sandbox, { filename: 'session.js-toggle-slice' });
  sandbox.initRunToggles();
  return { sandbox, calls, clickHandlers };
}

// A click whose `closest` matches `selector` only for the entries it contains.
function clickOn(...matchedSelectors) {
  return {
    target: { closest: (sel) => matchedSelectors.some((m) => sel.includes(m)) },
  };
}

test('initRunToggles ignores a click inside .sess-proposals (LIN-3254 nit)', () => {
  const { calls, clickHandlers } = makeSandbox();
  assert.equal(clickHandlers.length, 1, 'the run registered one click handler');

  clickHandlers[0](clickOn('.sess-proposals'));

  assert.equal(calls.toggled, 0, 'a click on a proposal must not collapse the run');
  assert.equal(calls.ariaSet.length, 0, 'aria-expanded must be left alone');
});

test('initRunToggles still toggles on a plain card click, and still ignores the reply box', () => {
  const { calls, clickHandlers } = makeSandbox();

  clickHandlers[0](clickOn('.sess-inline-reply'));
  assert.equal(calls.toggled, 0, 'the reply box stays excluded');

  clickHandlers[0](clickOn());
  assert.equal(calls.toggled, 1, 'a plain click on the card toggles the run');
  assert.deepEqual(calls.ariaSet, [['aria-expanded', 'true']]);
});
