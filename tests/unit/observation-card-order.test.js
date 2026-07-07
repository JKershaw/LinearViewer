// LIN-964: Session cards must NOT reorder when a card is expanded.
//
// The defect: the LIN-783 freeze guard skipped only the expanded card while
// re-appending every OTHER card each poll, which floated the expanded card to
// the top of its section on the first poll after expand ([A,B,C,D] + expand B
// → [B,A,C,D]). The fix freezes the whole list order while any card is open.
//
// public/observation.js is a browser script (not an ES module), so we evaluate
// its source in a vm sandbox (as observation-render.test.js does). We drive the
// REAL `diffSessionList` ordering logic against a minimal fake DOM that models
// the one primitive that governs order — `appendChild(existing)` = remove-then-
// push-to-end — and stub the heavy per-card DOM helpers via the sandbox global
// object so no full DOM is needed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');

// --- Minimal fake DOM: only the ordering-relevant semantics ---------------
function makeCard(id) {
  return {
    __id: id,
    parentNode: null,
    classList: { add() {}, remove() {}, toggle() {} },
    remove() {
      if (this.parentNode) {
        const i = this.parentNode.children.indexOf(this);
        if (i >= 0) this.parentNode.children.splice(i, 1);
        this.parentNode = null;
      }
    },
  };
}
function makeList() {
  return {
    children: [],
    classList: { toggle() {} },
    // appendChild moves an already-attached node to the end (DOM semantics).
    appendChild(el) {
      if (el.parentNode) el.remove();
      this.children.push(el);
      el.parentNode = this;
      return el;
    },
  };
}

function loadSandbox() {
  const nodes = new Map(); // elementId → fake node
  const list = makeList();
  const empty = { classList: { toggle() {} } };
  nodes.set('obs-active', list);
  nodes.set('obs-active-empty', empty);
  const sandbox = {
    module: { exports: {} },
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById: (id) => nodes.get(id) || null },
    setTimeout: () => {},
    escapeHtml: (s) => (s == null ? '' : String(s)),
    console,
  };
  vm.runInNewContext(src, sandbox, { filename: 'observation.js' });

  // Override the heavy per-card DOM helpers with no-op stubs. Top-level function
  // declarations in a sloppy-mode Script become global-object properties, and
  // `diffSessionList` resolves these names dynamically through that object — so
  // reassigning them here takes effect at call time.
  sandbox.makeSessionCard = (s) => makeCard(s.sessionId);
  sandbox.fillSessionHead = () => {};
  sandbox.wireSummaryGen = () => {};
  sandbox.applySessionState = () => {};
  sandbox.maybeFetchSummary = () => {};

  return { sandbox, list };
}

const order = (list) => list.children.map((el) => el.__id);
const sessions = (...ids) => ids.map((id) => ({ sessionId: id }));

test.describe('diffSessionList — card-list ordering (LIN-964)', () => {
  test('order is preserved across polls when nothing is expanded (baseline)', () => {
    const { sandbox, list } = loadSandbox();
    const { diffSessionList } = sandbox.module.exports;
    const cardMap = new Map();

    // `renderFeeds` always feeds this seam sessions in `sessionIndex` INSERTION
    // order (a Map, iterated with no sort), so a persisting card keeps its slot
    // even when the server re-ranks it — the re-rank never changes this array's
    // order. With nothing expanded, re-appending in that same order is a no-op.
    diffSessionList('obs-active', 'obs-active-empty', cardMap, sessions('A', 'B', 'C', 'D'));
    assert.deepEqual(order(list), ['A', 'B', 'C', 'D']);

    diffSessionList('obs-active', 'obs-active-empty', cardMap, sessions('A', 'B', 'C', 'D'));
    assert.deepEqual(order(list), ['A', 'B', 'C', 'D']);
  });

  test('expanding a card does NOT reorder the list on the next poll', () => {
    const { sandbox, list } = loadSandbox();
    const { diffSessionList, expandedSessions } = sandbox.module.exports;
    const cardMap = new Map();

    diffSessionList('obs-active', 'obs-active-empty', cardMap, sessions('A', 'B', 'C', 'D'));
    assert.deepEqual(order(list), ['A', 'B', 'C', 'D']);

    // User expands B (mid-list), then a poll lands within POLL_MS.
    expandedSessions.add('B');
    diffSessionList('obs-active', 'obs-active-empty', cardMap, sessions('A', 'B', 'C', 'D'));

    // Pre-fix this returned [B,A,C,D] — B floated to the top. It must stay put.
    assert.deepEqual(order(list), ['A', 'B', 'C', 'D']);
  });

  test('a genuinely new session still appends at the end while a card is expanded', () => {
    const { sandbox, list } = loadSandbox();
    const { diffSessionList, expandedSessions } = sandbox.module.exports;
    const cardMap = new Map();

    diffSessionList('obs-active', 'obs-active-empty', cardMap, sessions('A', 'B', 'C'));
    expandedSessions.add('B');
    diffSessionList('obs-active', 'obs-active-empty', cardMap, sessions('A', 'B', 'C', 'E'));

    assert.deepEqual(order(list), ['A', 'B', 'C', 'E']);
  });

  test('a session that ends still leaves the list while a card is expanded', () => {
    const { sandbox, list } = loadSandbox();
    const { diffSessionList, expandedSessions } = sandbox.module.exports;
    const cardMap = new Map();

    diffSessionList('obs-active', 'obs-active-empty', cardMap, sessions('A', 'B', 'C', 'D'));
    expandedSessions.add('B');
    // C drops out of the feed; remaining order is otherwise untouched.
    diffSessionList('obs-active', 'obs-active-empty', cardMap, sessions('A', 'B', 'D'));

    assert.deepEqual(order(list), ['A', 'B', 'D']);
  });
});
