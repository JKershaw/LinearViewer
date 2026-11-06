/**
 * LIN-4280 — the shared world helper's own seam, `world.run(code)` (tests/unit/helpers/client-world.js).
 *
 * A `let` at the top of a loaded script is a script-scope binding: it is not a property of the vm context, so
 * `world.sandbox` cannot read or set it. `run` evaluates in that scope, which is how a suite drives client state that
 * has no other entry point (observation.js's `currentView`). These tests pin the seam itself: a no-op `run` fails them.
 *
 * Run with: node --test tests/unit/client-world.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld, clickOn, clickDelegated, fireDOMContentLoaded } from './helpers/client-world.js';

describe('loadWorld — run(code) reaches script-scope bindings', () => {
  test('reads and writes a top-level let of a loaded script', () => {
    // observation.js registers a window listener at load; the stub is the only window dependency it has at load time.
    const world = loadWorld({ window: { addEventListener() {} }, scripts: ['observation.js'] });
    assert.equal(world.run('currentView'), 'runs', 'observation.js declares currentView as a script-scope let, initially "runs"');
    world.run('currentView = "rulings";');
    assert.equal(world.run('currentView'), 'rulings');
  });

  test('evaluates in the world it belongs to: the document in scope is that world\'s document', () => {
    const world = loadWorld({ scripts: [] });
    assert.equal(world.run('document'), world.document);
  });

  test('bindings persist across calls within a world and are not shared between worlds', () => {
    const a = loadWorld({ scripts: [] });
    const b = loadWorld({ scripts: [] });
    a.run('let probe = 1;');
    assert.equal(a.run('probe + 1'), 2);
    // Matched by name: an error thrown inside a vm context is that context's ReferenceError, not the host's, so `instanceof` fails.
    assert.throws(() => b.run('probe'), { name: 'ReferenceError' }, 'a binding made in one world is not visible in another');
  });
});

describe('loadWorld — window is the global object, as in a browser (LIN-4307)', () => {
  test('a script\'s window.X = … is the bare X a later script reads', () => {
    const world = loadWorld({ scripts: [] });
    world.run('window.shared = function () { return "from the first script"; };');
    assert.equal(world.run('shared()'), 'from the first script', 'a later script calls the bare name');
    assert.equal(world.run('window === this'), true, 'window is the global object');
  });

  test('a window stub is a global too, and a later write to window.X replaces it', () => {
    const world = loadWorld({ window: { relativeTime: () => 'stub' }, scripts: [] });
    assert.equal(world.run('relativeTime()'), 'stub', 'the stub is readable bare');
    world.run('window.relativeTime = () => "defined by a script";');
    assert.equal(world.run('relativeTime()'), 'defined by a script', 'one binding, as in a browser');
    assert.equal(world.window, world.sandbox);
  });
});

describe('loadWorld — delegated clicks and DOMContentLoaded (LIN-4307)', () => {
  test('clickDelegated gives the click to document listeners with the target, and not to the target\'s own listeners', async () => {
    const { document } = loadWorld({ scripts: [] });
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const own = [];
    const delegated = [];
    btn.addEventListener('click', (e) => own.push(e));
    document.addEventListener('click', (e) => delegated.push(e));
    await clickDelegated(btn);
    assert.equal(own.length, 0, 'the target\'s own listener is not given a delegated click');
    assert.equal(delegated.length, 1, 'the document listener gets one click');
    assert.equal(delegated[0].target, btn, 'the event names the element that was clicked');
    assert.equal(typeof delegated[0].stopPropagation, 'function', 'the event has stopPropagation, as a browser event does');
  });

  test('clickOn(ancestor, target) gives the ancestor\'s listeners a click whose target is the descendant', async () => {
    const { document } = loadWorld({ scripts: [] });
    const run = document.createElement('div');
    const inner = document.createElement('span');
    run.appendChild(inner);
    document.body.appendChild(run);
    const seen = [];
    run.addEventListener('click', (e) => seen.push(e.target));
    await clickOn(run, inner);
    assert.deepEqual(seen, [inner], 'the listener on the card sees the span that was clicked');
  });

  test('fireDOMContentLoaded runs the DOMContentLoaded listeners a script registered on document', async () => {
    const world = loadWorld({ scripts: [] });
    world.run('document.addEventListener("DOMContentLoaded", () => { window.ran = (window.ran || 0) + 1; });');
    assert.equal(world.window.ran, undefined, 'nothing runs until the page is parsed');
    await fireDOMContentLoaded(world.document);
    assert.equal(world.window.ran, 1, 'the registered listener ran once');
  });
});
