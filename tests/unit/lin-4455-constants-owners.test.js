/**
 * LIN-4455 (piece 5 of LIN-4447), beat 3: each restated constant comes from its owner.
 *
 *   - `NEVER_RAN` (the archived statuses of a row that left the queue without running) is
 *     declared once, in `lib/dispatch-terminal.js`, beside the terminal history statuses that
 *     contain it. Every module that asks "did this row never run?" imports it. That includes
 *     the store and the leftover decision, and neither learns "leftover" from it.
 *   - The halt modes come from `HALT_MODES` (`lib/workspace-halt.js`), so a new mode stops
 *     a leftover without an edit here (beat 1's witness iterates them).
 *   - The leftover's resumable-target check is `followUpTarget` (`lib/dispatch-targets.js`),
 *     the one follow-up target rule, not a second `['cli', 'web']` set.
 *
 * The census below fails wherever one of those sets is written out again in `lib/`,
 * `routes/` or `server.js`, outside its owner. `lib/runner-kit/` is exempt: the kit is
 * self-contained by design (it is served to the runner) and `runner-kit-contract.test.js`
 * pins its copies. Single-mode sites (`halt?.mode === 'stop'` in the store's stopped-run
 * gate) name one mode on purpose and are not a restated set, so the census does not see them.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

import { NEVER_RAN } from '../../lib/dispatch-terminal.js';
import { DISPATCH_TARGETS, followUpTarget } from '../../lib/dispatch-targets.js';
import { decideLeftover } from '../../lib/dispatch-leftover.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { classifyLoop } from '../../lib/observer-sweep.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

// ─── The owners' contents ────────────────────────────────────────────────────

test('NEVER_RAN is exactly the two archive statuses of a row that never ran', () => {
  assert.deepEqual([...NEVER_RAN].sort(), ['cancelled', 'expired']);
});

// ─── Behaviour driven by the owners ─────────────────────────────────────────

describe('the leftover decision reads its constants from their owners', () => {
  const PR = 'https://github.com/o/r/pull/12';
  const done = { message: `[done] Built LIN-7. PR ${PR} is green.` };
  const root = { _id: 'b', kind: 'implementation', promptName: 'implementation', target: 'cli', issueIdentifier: 'LIN-7', sessionId: 'a', feedback: [done] };
  const decide = (over = {}) => decideLeftover({ doc: root, entry: done, chain: [root], leftoverRows: [], ...over });

  for (const target of [...DISPATCH_TARGETS, null, undefined, '', 'some-future-target']) {
    const resumable = followUpTarget(target) != null;
    test(`target ${JSON.stringify(target)}: ${resumable ? 'resumable' : 'target-not-resumable'}, as followUpTarget says`, () => {
      const doc = { ...root, target };
      const d = decide({ doc, chain: [doc] });
      if (resumable) assert.equal(d.outcome, 'queue');
      else assert.deepEqual(d, { outcome: 'not-eligible', reason: 'target-not-resumable' });
    });
  }

  for (const status of ['queued', 'taken', ...NEVER_RAN]) {
    test(`a held row with status ${status}: release ${NEVER_RAN.has(status) ? 'names it' : 'is null'}`, () => {
      const own = { _id: 'l', heldWakeFor: 'b', status };
      const d = decide({ leftoverRows: [own] });
      assert.equal(d.outcome, 'hold');
      assert.equal(d.release, NEVER_RAN.has(status) ? own : null);
    });
  }
});

describe('the store releases a held wake exactly for a NEVER_RAN archive', () => {
  for (const status of ['taken', ...NEVER_RAN]) {
    test(`_releaseIfHeld on a ${status} archive ${NEVER_RAN.has(status) ? 'releases' : 'does nothing'}`, async () => {
      const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
      const calls = [];
      store.releaseHeldWake = async (urlKey, doc, opts) => { calls.push({ urlKey, id: doc._id, opts }); return null; };
      await store._releaseIfHeld({ _id: 'h', urlKey: 'acme', heldWakeFor: 'b' }, status);
      assert.deepEqual(calls, NEVER_RAN.has(status) ? [{ urlKey: 'acme', id: 'h', opts: { status } }] : []);
    });
  }
});

describe('the observer sweep files a NEVER_RAN history row as resolved', () => {
  const loop = (historyStatus) => ({ loopId: 'l1', terminalStatus: null, wakeMarker: null, agentState: null, historyStatus, source: 'history' });
  for (const status of NEVER_RAN) {
    test(`historyStatus ${status} is resolved`, () => {
      assert.equal(classifyLoop(loop(status), { now: Date.now(), staleMs: 60_000 }), 'resolved');
    });
  }
  test('a taken history row is not', () => {
    assert.notEqual(classifyLoop(loop('taken'), { now: Date.now(), staleMs: 60_000 }), 'resolved');
  });
});

// ─── Census: no restated set outside its owner ──────────────────────────────

const GROUPS = [
  { name: 'NEVER_RAN', pair: ['cancelled', 'expired'], owner: 'lib/dispatch-terminal.js' },
  { name: 'HALT_MODES', pair: ['pause', 'stop'], owner: 'lib/workspace-halt.js' },
  { name: 'the resumable targets (followUpTarget)', pair: ['cli', 'web'], owner: 'lib/dispatch-targets.js' },
];
const EXEMPT_PREFIX = 'lib/runner-kit/';

/**
 * Array literals, and `===`/`!==` chains, in `source` that name both values of a group's
 * pair: the shape every retired copy had.
 *
 * @param {string} file - for the report
 * @param {string} source
 * @param {Array<string>} pair
 * @returns {Array<string>}
 */
function restatementsIn(file, source, pair) {
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch {
    return [];
  }
  const lit = (node) => (node && node.type === 'Literal' && typeof node.value === 'string' ? node.value : null);
  const hits = [];
  walk.full(ast, (node) => {
    let values = null;
    if (node.type === 'ArrayExpression') values = node.elements.map(lit).filter(Boolean);
    if (node.type === 'LogicalExpression') {
      values = [];
      const collect = (e) => {
        if (e.type === 'LogicalExpression') { collect(e.left); collect(e.right); }
        else if (e.type === 'BinaryExpression' && /^[!=]==?$/.test(e.operator)) values.push(lit(e.right) ?? lit(e.left));
      };
      collect(node);
      values = values.filter(Boolean);
    }
    if (values && pair.every((v) => values.includes(v))) hits.push(`${file}:${node.loc.start.line} [${values.join(', ')}]`);
  });
  return hits;
}

describe('no restated constant outside its owner', () => {
  test('the census sees an array, an || chain and an && chain, and ignores one value (self-check)', () => {
    const src = [
      "const a = new Set(['cancelled', 'expired']);",
      "const b = (s) => s === 'pause' || s === 'stop';",
      "const c = (s) => s !== 'cancelled' && s !== 'expired';",
      "const d = (h) => h?.mode === 'stop';"
    ].join('\n');
    assert.deepEqual(restatementsIn('s.js', src, ['cancelled', 'expired']), ['s.js:1 [cancelled, expired]', 's.js:3 [cancelled, expired]']);
    assert.deepEqual(restatementsIn('s.js', src, ['pause', 'stop']), ['s.js:2 [pause, stop]']);
  });

  const files = execFileSync('git', ['ls-files', 'lib', 'routes', 'server.js'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.m?js$/.test(f) && !f.startsWith(EXEMPT_PREFIX));

  for (const { name, pair, owner } of GROUPS) {
    test(`${name}: [${pair.join(', ')}] is written only in ${owner}`, () => {
      assert.ok(files.length > 100, `the census reads the tree (${files.length} files)`);
      const hits = files
        .filter((f) => f !== owner)
        .flatMap((f) => restatementsIn(f, readFileSync(join(REPO, f), 'utf8'), pair));
      assert.deepEqual(hits, [], `${name} restated outside ${owner}; import it instead:\n${hits.join('\n')}`);
    });
  }
});
