/**
 * LIN-3680 — public/swim.js state-label maps say 'Cancelled'.
 *
 * The server twin (lib/swim-lanes.js groupByStatus) is pinned in
 * swim-lanes.test.js; this is the witness for the two client copies, which no
 * other unit test loads: the `groupByStatus` lane label and `flowStateLabel`
 * (the fallback when an issue has no stateName). Both follow getStateDisplay
 * (lib/providers/state-map.js): canceled and duplicate read 'Cancelled'.
 *
 * public/swim.js is a browser script that cannot be imported, so each function
 * is cut out of the real shipped source by brace matching and run in a vm.
 *
 * Run with: node --test tests/unit/swim-client-state-labels.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/swim.js'), 'utf8');

/** The full text of `function <name>(...) { ... }`, matched by braces. */
function extractFunction(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in public/swim.js`);
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${extractFunction('flowStateLabel')}\n${extractFunction('groupByStatus')}`, sandbox, {
  filename: 'swim.js',
});
const { flowStateLabel, groupByStatus } = sandbox;

describe('public/swim.js flowStateLabel', () => {
  test('canceled and duplicate both read Cancelled', () => {
    assert.equal(flowStateLabel('canceled'), 'Cancelled');
    assert.equal(flowStateLabel('duplicate'), 'Cancelled');
  });

  test('Done, Todo and the other labels are unchanged', () => {
    assert.equal(flowStateLabel('completed'), 'Done');
    assert.equal(flowStateLabel('unstarted'), 'Todo');
    assert.equal(flowStateLabel('started'), 'In Progress');
    assert.equal(flowStateLabel('backlog'), 'Backlog');
    assert.equal(flowStateLabel(undefined), 'Todo');
  });
});

describe('public/swim.js groupByStatus', () => {
  test('canceled and duplicate share one lane labelled Cancelled', () => {
    const lanes = groupByStatus([
      { id: 'a', stateType: 'canceled' },
      { id: 'b', stateType: 'duplicate' },
    ]);
    assert.equal(lanes.length, 1);
    assert.equal(lanes[0].label, 'Cancelled');
    assert.deepEqual(Array.from(lanes[0].items, (i) => i.id), ['a', 'b']);
  });

  test('Done and Todo lane labels are unchanged', () => {
    const lanes = groupByStatus([
      { id: 'a', stateType: 'completed' },
      { id: 'b', stateType: 'unstarted' },
    ]);
    assert.deepEqual(Array.from(lanes, (l) => l.label), ['Todo', 'Done']);
  });
});
