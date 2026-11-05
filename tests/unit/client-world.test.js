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
import { loadWorld } from './helpers/client-world.js';

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
