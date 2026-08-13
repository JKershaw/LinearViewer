/**
 * Live↔mirror structural-parity test for the Ship radial view's segment/ring
 * classification (LIN-1208, closing the gap research flagged: the previously
 * unit-tested-only `skipBacklogProjects` opt-out in ship-layout.test.js:575
 * asserted behaviour no user could reach, because `lib/ship-layout.js` is
 * tests-only and `public/ship.js` is the actual live render seam).
 *
 * `buildSegments` / `computeProximityRings` / `computeShipReachableIds` exist
 * twice — the hand-maintained client mirror in `public/ship.js` ("inlined here
 * so the page has no build step") and the unit-tested copy in
 * `lib/ship-layout.js`. This test runs a shared battery of card fixtures
 * through BOTH and asserts identical segment/ring output, with particular
 * emphasis on the LIN-1208 backlog-visibility filter (showBacklog default,
 * showBacklog: true, skipBacklogProjects interaction, blocker/parent
 * exemption) since that is the behaviour this ticket adds to both copies.
 *
 * public/ship.js is a browser IIFE (not an ES module), so — following the
 * established tests/unit/ship-biscuit-parity.test.js pattern — we evaluate its
 * source in a vm sandbox with `document.readyState = 'loading'` (so `init()`
 * never runs — it's registered as a DOMContentLoaded listener that's never
 * fired, so no real DOM is needed at all) and capture its test-only
 * `module.exports`.
 *
 * Run with: node --test tests/unit/ship-layout-parity.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import {
  buildSegments as libBuildSegments,
  computeProximityRings as libComputeProximityRings,
  computeShipReachableIds as libComputeShipReachableIds
} from '../../lib/ship-layout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Load the client copy out of the browser IIFE -----------------------------------
const sandbox = {
  module: { exports: {} },
  window: { __SHIP_DATA__: {} },
  document: {
    readyState: 'loading', // init() is registered as a listener, never invoked
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  },
  console
};
vm.runInNewContext(readFileSync(join(__dirname, '../../public/ship.js'), 'utf8'), sandbox, {
  filename: 'ship.js'
});
const {
  buildSegments: clientBuildSegments,
  computeProximityRings: clientComputeProximityRings,
  computeShipReachableIds: clientComputeShipReachableIds
} = sandbox.module.exports;

// --- Helpers -------------------------------------------------------------------------

let cardCounter = 0;
function card(overrides = {}) {
  cardCounter++;
  return {
    id: `c-${cardCounter}`,
    identifier: `T-${cardCounter}`,
    title: `Task ${cardCounter}`,
    priority: 0,
    stateType: 'unstarted',
    labels: [],
    projectName: 'Project Alpha',
    ...overrides
  };
}

// Normalize a buildSegments() result (Map- or object-keyed byProject already
// flattened into `segments`, plus bucket arrays) into a plain, order-stable
// shape comparable across the Map-based (lib) and object-based (client) impls.
// The client side's values are built by code running in a separate vm
// context (a different JS realm). `Array.prototype.map`/`.sort` on a
// cross-realm array construct their result via that array's OWN realm
// (species), so even a `.map()` called from this file can still hand back a
// foreign-realm array — and assert.deepStrictEqual treats same-shape
// cross-realm values as unequal (different prototype identity). A
// JSON round-trip forces everything through this realm's plain
// object/array/string/number primitives, which is safe here since every
// normalized shape below is already JSON-safe.
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBuilt(built) {
  return clone({
    segments: built.segments.map(s => ({
      id: s.id,
      label: s.label,
      sector: s.sector,
      range: { start: s.range.start, end: s.range.end },
      cardIds: s.cards.map(c => c.id)
    })),
    shipCardIds: built.shipCards.map(c => c.id).sort(),
    driftCardIds: built.driftCards.map(c => c.id).sort(),
    headingCardIds: (built.headingCards || []).map(c => c.id).sort()
  });
}

function normalizeRing(ring) {
  // lib returns a Map<id, ring>; client returns a plain { id: ring } object.
  const out = {};
  if (ring instanceof Map) {
    for (const [id, r] of ring) out[id] = r;
  } else {
    for (const id of Object.keys(ring)) out[id] = ring[id];
  }
  return clone(out);
}

function normalizeIdSet(set) {
  // lib returns a Set<id>; client returns a plain { id: true } object.
  const ids = set instanceof Set ? [...set] : Object.keys(set);
  return clone(ids.sort());
}

function assertBuildSegmentsParity(cards, config, label) {
  const lib = normalizeBuilt(libBuildSegments(cards, config));
  const client = normalizeBuilt(clientBuildSegments(cards, config));
  assert.deepStrictEqual(client, lib, `buildSegments diverged for: ${label}`);
}

function assertReachableParity(allCards, shipCards, label) {
  const lib = normalizeIdSet(libComputeShipReachableIds(allCards, shipCards));
  const client = normalizeIdSet(clientComputeShipReachableIds(allCards, shipCards));
  assert.deepStrictEqual(client, lib, `computeShipReachableIds diverged for: ${label}`);
}

function assertProximityRingsParity(orbitCards, shipCards, label) {
  const lib = normalizeRing(libComputeProximityRings(orbitCards, shipCards));
  const client = normalizeRing(clientComputeProximityRings(orbitCards, shipCards));
  assert.deepStrictEqual(client, lib, `computeProximityRings diverged for: ${label}`);
}

// --- Shared fixtures -------------------------------------------------------------------

describe('Ship view — live↔mirror structural parity (LIN-1208)', () => {
  test('mixed workspace: heading, bugs, projects, drift — default (backlog hidden)', () => {
    const cards = [
      card({ id: 'wip', stateType: 'started' }),
      card({ id: 'goal-1', projectName: 'Goal', stateType: 'backlog' }),
      card({ id: 'goal-2', projectName: 'Goal', stateType: 'unstarted' }),
      card({ id: 'bug-1', stateType: 'unstarted', labels: ['bug'] }),
      card({ id: 'bug-2', stateType: 'backlog', labels: ['bug'] }),
      card({ id: 'p1-a', projectName: 'Alpha', stateType: 'backlog' }),
      card({ id: 'p1-b', projectName: 'Alpha', stateType: 'unstarted' }),
      card({ id: 'p2-a', projectName: 'Beta', stateType: 'backlog' }),
      card({ id: 'drift-1', stateType: 'unstarted', projectName: null }),
      card({ id: 'drift-2', stateType: 'backlog', projectName: null })
    ];
    const config = { heading: { kind: 'project', name: 'Goal' } };
    assertBuildSegmentsParity(cards, config, 'mixed workspace, default');
  });

  test('mixed workspace: showBacklog true (bypasses filter and skipBacklogProjects)', () => {
    const cards = [
      card({ id: 'wip', stateType: 'started' }),
      card({ id: 'p1-a', projectName: 'Alpha', stateType: 'backlog' }),
      card({ id: 'p1-b', projectName: 'Alpha', stateType: 'unstarted' }),
      card({ id: 'p2-a', projectName: 'Beta', stateType: 'backlog' }), // all-backlog project
      card({ id: 'drift-1', stateType: 'backlog', projectName: null })
    ];
    assertBuildSegmentsParity(cards, { showBacklog: true }, 'mixed workspace, showBacklog true');
  });

  test('skipBacklogProjects: false — drained project persists as an empty segment', () => {
    const cards = [
      card({ id: 'b1', projectName: 'Dormant', stateType: 'backlog' }),
      card({ id: 'b2', projectName: 'Dormant', stateType: 'backlog' })
    ];
    assertBuildSegmentsParity(cards, { skipBacklogProjects: false }, 'skipBacklogProjects: false');
  });

  test('skipBacklogProjects: true (default) — drained project is deleted', () => {
    const cards = [
      card({ id: 'b1', projectName: 'Dormant', stateType: 'backlog' }),
      card({ id: 'b2', projectName: 'Dormant', stateType: 'backlog' })
    ];
    assertBuildSegmentsParity(cards, {}, 'skipBacklogProjects: true (default)');
  });

  test('blocker exemption: backlog card blocking in-progress work stays visible in both copies', () => {
    const cards = [
      card({ id: 'wip', stateType: 'started' }),
      card({ id: 'blocker', projectName: 'Active', stateType: 'backlog', blocksIds: ['wip'] }),
      card({ id: 'other', projectName: 'Active', stateType: 'backlog' })
    ];
    assertBuildSegmentsParity(cards, {}, 'blocker exemption');
  });

  test('transitive blocker chain exemption', () => {
    const cards = [
      card({ id: 'wip', stateType: 'started' }),
      card({ id: 'mid', stateType: 'backlog', blocksIds: ['wip'] }),
      card({ id: 'root', projectName: 'Active', stateType: 'backlog', blocksIds: ['mid'] })
    ];
    assertBuildSegmentsParity(cards, {}, 'transitive blocker exemption');
  });

  test('parent exemption: backlog card parenting an in-progress descendant stays visible', () => {
    const cards = [
      card({ id: 'wip', stateType: 'started', parentId: 'epic' }),
      card({ id: 'epic', projectName: 'Active', stateType: 'backlog' })
    ];
    assertBuildSegmentsParity(cards, {}, 'parent exemption');
  });

  test('a project group left with only an exempt backlog card is not swept by the drained-project cleanup', () => {
    const cards = [
      card({ id: 'wip', stateType: 'started' }),
      card({ id: 'onlyExempt', projectName: 'Solo', stateType: 'backlog', blocksIds: ['wip'] })
    ];
    assertBuildSegmentsParity(cards, {}, 'exempt-only project group');
  });

  test('degenerate: all-backlog workspace with the filter on', () => {
    const cards = [
      card({ id: 'b1', projectName: 'Solo', stateType: 'backlog' }),
      card({ id: 'b2', stateType: 'backlog' }) // drift
    ];
    assertBuildSegmentsParity(cards, {}, 'all-backlog workspace');
  });

  test('degenerate: empty card list', () => {
    assertBuildSegmentsParity([], {}, 'empty card list');
  });

  test('computeShipReachableIds parity: transitive blocker + parent walk', () => {
    const ship = [card({ id: 'wip', stateType: 'started', parentId: 'epic' })];
    const cards = [
      ...ship,
      card({ id: 'epic' }),
      card({ id: 'a', blocksIds: ['b'] }),
      card({ id: 'b', blocksIds: ['wip'] }),
      card({ id: 'ghost', blocksIds: ['does-not-exist'] }),
      card({ id: 'unrelated' })
    ];
    assertReachableParity(cards, ship, 'transitive blocker + parent walk');
  });

  test('computeProximityRings parity over a backlog-filtered orbit', () => {
    // Feed the FILTERED result of buildSegments into computeProximityRings,
    // matching how runLayout/layout() actually chain the two — proves the
    // downstream ring computation stays in parity too, not just the filter.
    const cards = [
      card({ id: 'wip', stateType: 'started' }),
      card({ id: 'blocker', projectName: 'Active', stateType: 'backlog', blocksIds: ['wip'] }),
      card({ id: 'idle', projectName: 'Active', priority: 4, stateType: 'unstarted' })
    ];
    const built = libBuildSegments(cards, {});
    const orbitCards = built.driftCards.concat(built.segments.flatMap(s => s.cards));
    assertProximityRingsParity(orbitCards, built.shipCards, 'ring parity over filtered orbit');
  });
});
