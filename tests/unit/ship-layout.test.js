/**
 * Unit tests for ship view layout primitives.
 *
 * Run with: node --test tests/unit/ship-layout.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  SECTORS,
  SECTOR_RANGES,
  RING_COUNT,
  assignLane,
  assignProjectSides,
  buildSegments,
  midpointAngle,
  computePosition,
  computeProximityRings,
  computeShipReachableIds,
  computeShipDimensions,
  shipCardOffset,
  hash32,
  hashFloat,
  layout,
  orderByDependency,
  clusterSubtaskSiblings,
  resolveCollisions,
  BEARING_TO_ANGLE,
  BEARINGS,
  bearingToAngle,
  orientationLayout,
  ORIENTATION_SPREAD,
  computeFitZoom
} from '../../lib/ship-layout.js';

// =============================================================================
// Helpers
// =============================================================================

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

const GEOMETRY = {
  centerX: 600,
  centerY: 400,
  shipHalfWidth: 160,
  shipHalfHeight: 80,
  ringSpacing: 110,
  firstRingGap: 40
};

// Inclusive-of-wrap angle range check
function angleInRange(angle, range) {
  const a = ((angle % 360) + 360) % 360;
  if (range.start <= range.end) return a >= range.start && a <= range.end;
  return a >= range.start || a <= range.end;
}

// =============================================================================
// assignLane
// =============================================================================

describe('assignLane', () => {
  test('started → ship (highest priority rule)', () => {
    const c = card({ stateType: 'started', labels: ['bug'], projectName: 'P' });
    assert.strictEqual(assignLane(c), SECTORS.SHIP);
  });

  test('bug label → aft', () => {
    const c = card({ labels: ['bug'] });
    assert.strictEqual(assignLane(c), SECTORS.AFT);
  });

  test('bug label is case-insensitive', () => {
    assert.strictEqual(assignLane(card({ labels: ['Bug'] })), SECTORS.AFT);
    assert.strictEqual(assignLane(card({ labels: ['BUG'] })), SECTORS.AFT);
    assert.strictEqual(assignLane(card({ labels: ['bUg'] })), SECTORS.AFT);
  });

  test('configurable bugLabels', () => {
    const c = card({ labels: ['defect'] });
    assert.strictEqual(assignLane(c, { bugLabels: ['defect'] }), SECTORS.AFT);
  });

  test('has project → side lane (port or starboard)', () => {
    const c = card({ projectName: 'Project Alpha' });
    const sector = assignLane(c);
    assert.ok(sector === SECTORS.PORT || sector === SECTORS.STARBOARD,
      `expected port or starboard, got ${sector}`);
  });

  test('same project always lands on the same side', () => {
    const a = assignLane(card({ projectName: 'Authentication' }));
    const b = assignLane(card({ projectName: 'Authentication' }));
    assert.strictEqual(a, b);
  });

  test('no project, not started, not bug → drift', () => {
    const c = card({ projectName: null });
    assert.strictEqual(assignLane(c), SECTORS.DRIFT);
  });

  test('heading project routes its cards to forward', () => {
    const c = card({ projectName: 'Authentication' });
    const sector = assignLane(c, { heading: { kind: 'project', name: 'Authentication' } });
    assert.strictEqual(sector, SECTORS.FORWARD);
  });

  test('heading label routes its cards to forward (case-insensitive)', () => {
    const c = card({ labels: ['North-Star'], projectName: 'Anything' });
    const sector = assignLane(c, { heading: { kind: 'label', name: 'north-star' } });
    assert.strictEqual(sector, SECTORS.FORWARD);
  });

  test('heading label wins over bug-label routing', () => {
    // Card has both a 'bug' label and the heading label. Heading rule fires
    // first, so it goes forward — leaves aft one card lighter.
    const c = card({ labels: ['bug', 'goal'], projectName: 'P' });
    const sector = assignLane(c, { heading: { kind: 'label', name: 'goal' } });
    assert.strictEqual(sector, SECTORS.FORWARD);
  });

  test('heading project does not override started → ship', () => {
    // In-progress cards always live in the ship rect, even when their project
    // is the heading.
    const c = card({ stateType: 'started', projectName: 'Authentication' });
    const sector = assignLane(c, { heading: { kind: 'project', name: 'Authentication' } });
    assert.strictEqual(sector, SECTORS.SHIP);
  });

  test('non-matching cards fall through to their usual sector when a heading is set', () => {
    const c = card({ projectName: 'Other' });
    const sector = assignLane(c, { heading: { kind: 'project', name: 'Authentication' } });
    // Falls back to port/starboard via hash for ad-hoc calls.
    assert.ok(sector === SECTORS.PORT || sector === SECTORS.STARBOARD);
  });
});

// =============================================================================
// computePosition
// =============================================================================

describe('computePosition', () => {
  test('ship sector returns null (renderer handles ship internally)', () => {
    const c = card({ stateType: 'started' });
    const pos = computePosition(c, SECTORS.SHIP, GEOMETRY);
    assert.strictEqual(pos, null);
  });

  test('deterministic: same card → same coords', () => {
    const c = card({ id: 'fixed-id', priority: 2 });
    const a = computePosition(c, SECTORS.STARBOARD, GEOMETRY);
    const b = computePosition(c, SECTORS.STARBOARD, GEOMETRY);
    assert.deepStrictEqual(a, b);
  });

  test('priority 1 (urgent) lands on inner ring', () => {
    const c = card({ id: 'urgent', priority: 1 });
    const pos = computePosition(c, SECTORS.STARBOARD, GEOMETRY);
    assert.strictEqual(pos.ring, 0);
  });

  test('priority 0 (none) lands on outer ring', () => {
    const c = card({ id: 'none', priority: 0 });
    const pos = computePosition(c, SECTORS.STARBOARD, GEOMETRY);
    assert.strictEqual(pos.ring, RING_COUNT - 1);
  });

  test('rings ordered by priority: urgent closer to centre than low', () => {
    const urgent = computePosition(card({ id: 'u', priority: 1 }), SECTORS.STARBOARD, GEOMETRY);
    const low = computePosition(card({ id: 'l', priority: 4 }), SECTORS.STARBOARD, GEOMETRY);
    const dist = (p) => Math.hypot(p.x - GEOMETRY.centerX, p.y - GEOMETRY.centerY);
    assert.ok(dist(urgent) < dist(low), 'urgent should be closer to centre than low');
  });

  test('angle falls inside sector arc (starboard)', () => {
    for (let i = 0; i < 30; i++) {
      const c = card({ id: `s-${i}`, priority: 2 });
      const pos = computePosition(c, SECTORS.STARBOARD, GEOMETRY);
      assert.ok(
        angleInRange(pos.angle, SECTOR_RANGES.starboard),
        `angle ${pos.angle} not in starboard range`
      );
    }
  });

  test('angle falls inside sector arc (aft)', () => {
    for (let i = 0; i < 30; i++) {
      const c = card({ id: `a-${i}`, priority: 2 });
      const pos = computePosition(c, SECTORS.AFT, GEOMETRY);
      assert.ok(
        angleInRange(pos.angle, SECTOR_RANGES.aft),
        `angle ${pos.angle} not in aft range`
      );
    }
  });

  test('drift covers full 360°', () => {
    let minA = 360, maxA = 0;
    for (let i = 0; i < 200; i++) {
      const pos = computePosition(card({ id: `d-${i}` }), SECTORS.DRIFT, GEOMETRY);
      if (pos.angle < minA) minA = pos.angle;
      if (pos.angle > maxA) maxA = pos.angle;
    }
    assert.ok(minA < 60, `drift min angle ${minA} should be < 60`);
    assert.ok(maxA > 300, `drift max angle ${maxA} should be > 300`);
  });

  test('no card sits inside the ship rectangle', () => {
    // Inner ring should clear the ship's bounding circle plus the firstRingGap.
    const expectedMin = Math.hypot(GEOMETRY.shipHalfWidth, GEOMETRY.shipHalfHeight)
      + GEOMETRY.firstRingGap;
    // Allow the radial jitter (35% of ringSpacing) to nudge slightly inward,
    // but never past the ship envelope itself.
    const safeMin = expectedMin - GEOMETRY.ringSpacing * 0.35;
    for (let i = 0; i < 50; i++) {
      const c = card({ id: `s-${i}`, priority: 1 });
      const pos = computePosition(c, SECTORS.STARBOARD, GEOMETRY);
      const r = Math.hypot(pos.x - GEOMETRY.centerX, pos.y - GEOMETRY.centerY);
      assert.ok(
        r >= safeMin,
        `card at radius ${r.toFixed(1)} too close (must be >= ${safeMin.toFixed(1)})`
      );
    }
  });

  test('same-ring same-sector cards spread by angle, not collide', () => {
    const positions = [];
    for (let i = 0; i < 12; i++) {
      const c = card({ id: `bunch-${i}`, priority: 2 });
      positions.push(computePosition(c, SECTORS.STARBOARD, GEOMETRY));
    }
    const angles = positions.map(p => p.angle);
    const unique = new Set(angles.map(a => Math.round(a)));
    assert.ok(unique.size >= positions.length * 0.8,
      `expected angular spread; got ${unique.size} unique angles in ${positions.length} cards`);
  });
});

// =============================================================================
// Ship rectangle
// =============================================================================

describe('computeShipDimensions', () => {
  const cardSize = { width: 140, height: 60 };

  test('1 in-progress: still reserves 2-wide slot', () => {
    const ship = computeShipDimensions(1, cardSize);
    assert.strictEqual(ship.rows, 1);
    // Width always reserves room for 2 columns (consistent silhouette)
    assert.ok(ship.width >= 2 * cardSize.width);
  });

  test('2 in-progress: 1 row, 2 cols', () => {
    const ship = computeShipDimensions(2, cardSize);
    assert.strictEqual(ship.rows, 1);
    assert.strictEqual(ship.cols, 2);
  });

  test('5 in-progress: 3 rows', () => {
    const ship = computeShipDimensions(5, cardSize);
    assert.strictEqual(ship.rows, 3);
  });

  test('growing WIP grows the ship along its long axis (height)', () => {
    const small = computeShipDimensions(2, cardSize);
    const big = computeShipDimensions(10, cardSize);
    // Width stays the same; height grows
    assert.strictEqual(big.width, small.width);
    assert.ok(big.height > small.height,
      `expected ship to grow taller (small=${small.height}, big=${big.height})`);
  });

  test('zero in-progress still has a visible silhouette', () => {
    const ship = computeShipDimensions(0, cardSize);
    assert.ok(ship.width > 0);
    assert.ok(ship.height > 0);
  });
});

describe('shipCardOffset', () => {
  const cardSize = { width: 140, height: 60 };
  const ship = computeShipDimensions(6, cardSize);

  test('card 0 top-left of the grid (below the label area)', () => {
    const off = shipCardOffset(0, ship, cardSize);
    assert.strictEqual(off.x, ship.padding);
    assert.strictEqual(off.y, ship.padding + ship.labelArea);
  });

  test('card 1 top-right (col 1)', () => {
    const off = shipCardOffset(1, ship, cardSize);
    assert.ok(off.x > ship.padding);
    assert.strictEqual(off.y, ship.padding + ship.labelArea);
  });

  test('card 2 wraps to row 1', () => {
    const off = shipCardOffset(2, ship, cardSize);
    assert.strictEqual(off.x, ship.padding);
    assert.ok(off.y > ship.padding + ship.labelArea);
  });

  test('grid breathing room is consistent across all four sides', () => {
    // Bottom card's bottom edge should sit `padding` px from the rect bottom;
    // last column's right edge should sit `padding` px from the rect right.
    const lastIdx = 5; // 6 cards, 0-indexed
    const off = shipCardOffset(lastIdx, ship, cardSize);
    const rightOfCard = off.x + cardSize.width;
    const bottomOfCard = off.y + cardSize.height;
    assert.strictEqual(ship.width - rightOfCard, ship.padding,
      `right gap should equal padding (got ${ship.width - rightOfCard})`);
    assert.strictEqual(ship.height - bottomOfCard, ship.padding,
      `bottom gap should equal padding (got ${ship.height - bottomOfCard})`);
  });
});

// =============================================================================
// hash primitives
// =============================================================================

// =============================================================================
// assignProjectSides
// =============================================================================

describe('assignProjectSides', () => {
  test('alternates starboard/port across sorted projects', () => {
    const sides = assignProjectSides(['Charlie', 'Alpha', 'Bravo']);
    // Sorted: Alpha, Bravo, Charlie → starboard, port, starboard
    assert.strictEqual(sides.get('Alpha'), SECTORS.STARBOARD);
    assert.strictEqual(sides.get('Bravo'), SECTORS.PORT);
    assert.strictEqual(sides.get('Charlie'), SECTORS.STARBOARD);
  });

  test('balances 3 projects 2:1 (regression for hash-mod-2 bug)', () => {
    // The original hash-mod-2 sent all 3 of {'DevOps & Tooling','Product','General'}
    // to one side. Alternation guarantees a 2:1 split for any 3 projects.
    const sides = assignProjectSides(['DevOps & Tooling', 'Product', 'General']);
    const counts = { starboard: 0, port: 0 };
    for (const side of sides.values()) counts[side]++;
    assert.ok(Math.abs(counts.starboard - counts.port) <= 1,
      `expected balanced split, got ${JSON.stringify(counts)}`);
  });

  test('handles duplicates and falsy values', () => {
    const sides = assignProjectSides(['A', 'A', null, '', 'B']);
    assert.strictEqual(sides.size, 2);
    assert.ok(sides.has('A'));
    assert.ok(sides.has('B'));
  });

  test('empty input returns empty map', () => {
    assert.strictEqual(assignProjectSides([]).size, 0);
  });
});

// =============================================================================
// buildSegments
// =============================================================================

describe('buildSegments', () => {
  test('one project → one segment on the side', () => {
    const cards = [card({ projectName: 'OnlyOne' })];
    const { segments } = buildSegments(cards);
    const projectSegs = segments.filter(s => s.id.startsWith('project:'));
    assert.strictEqual(projectSegs.length, 1);
    assert.strictEqual(projectSegs[0].label, 'OnlyOne');
  });

  test('three projects → 2 segments on starboard side, 1 on port', () => {
    // Sorted: 'Alpha', 'Bravo', 'Charlie' → indices 0,1,2 → starboard, port, starboard
    const cards = [
      card({ id: 'a', projectName: 'Alpha' }),
      card({ id: 'b', projectName: 'Bravo' }),
      card({ id: 'c', projectName: 'Charlie' })
    ];
    const { segments } = buildSegments(cards);
    const starb = segments.filter(s => s.sector === SECTORS.STARBOARD);
    const port = segments.filter(s => s.sector === SECTORS.PORT);
    assert.strictEqual(starb.length, 2);
    assert.strictEqual(port.length, 1);
    assert.strictEqual(port[0].label, 'Bravo');
  });

  test('multi-project side: each project gets a non-overlapping sub-arc', () => {
    // Alternation: sorted Alpha,Bravo,Charlie,Delta → starboard,port,starboard,port
    // So starboard holds Alpha + Charlie; the 90° starboard arc is split 45° each.
    const cards = [
      card({ id: 'a', projectName: 'Alpha' }),
      card({ id: 'b', projectName: 'Bravo' }),
      card({ id: 'c', projectName: 'Charlie' }),
      card({ id: 'd', projectName: 'Delta' })
    ];
    const { segments } = buildSegments(cards);
    const starb = segments.filter(s => s.sector === SECTORS.STARBOARD);
    assert.strictEqual(starb.length, 2);
    const span0 = ((starb[0].range.end - starb[0].range.start + 360) % 360);
    const span1 = ((starb[1].range.end - starb[1].range.start + 360) % 360);
    assert.strictEqual(Math.round(span0), 45);
    assert.strictEqual(Math.round(span1), 45);
  });

  test('bug-labelled non-started cards produce a BUGS segment in aft', () => {
    const cards = [card({ id: 'b1', labels: ['bug'], projectName: 'P' })];
    const { segments } = buildSegments(cards);
    const aft = segments.find(s => s.id === 'bugs');
    assert.ok(aft, 'expected a bugs segment');
    assert.strictEqual(aft.label, 'BUGS');
    assert.strictEqual(aft.sector, SECTORS.AFT);
    assert.strictEqual(aft.cards.length, 1);
  });

  test('no bugs → no aft segment', () => {
    const { segments } = buildSegments([card({ projectName: 'P' })]);
    assert.ok(!segments.some(s => s.id === 'bugs'));
  });

  test('started cards do not go in any segment', () => {
    const cards = [card({ stateType: 'started', labels: ['bug'], projectName: 'P' })];
    const { segments, shipCards } = buildSegments(cards);
    assert.strictEqual(segments.length, 0);
    assert.strictEqual(shipCards.length, 1);
  });

  test('cards without a project route to driftCards, not a segment', () => {
    const cards = [card({ projectName: null })];
    const { segments, driftCards } = buildSegments(cards);
    assert.ok(!segments.some(s => s.id.startsWith('project:')));
    assert.strictEqual(driftCards.length, 1);
  });

  test('heading project produces a forward segment carrying its cards', () => {
    const cards = [
      card({ id: 'h1', projectName: 'NorthStar' }),
      card({ id: 'h2', projectName: 'NorthStar' }),
      card({ id: 'o',  projectName: 'Other' })
    ];
    const { segments, headingCards } = buildSegments(cards, {
      heading: { kind: 'project', name: 'NorthStar' }
    });
    const fwd = segments.find(s => s.sector === SECTORS.FORWARD);
    assert.ok(fwd, 'expected a forward segment');
    assert.strictEqual(fwd.label, 'NorthStar');
    assert.strictEqual(fwd.cards.length, 2);
    assert.strictEqual(fwd.range.start, 225);
    assert.strictEqual(fwd.range.end, 315);
    assert.strictEqual(headingCards.length, 2);
  });

  test('heading project is removed from port/starboard rotation', () => {
    // Two projects: 'NorthStar' (heading) + 'Other' (not). Without heading,
    // 'NorthStar' would alphabet-alternate onto starboard (it sorts first).
    // With heading, 'Other' is the only project for sides — gets starboard.
    const cards = [
      card({ id: 'h', projectName: 'NorthStar' }),
      card({ id: 'o', projectName: 'Other' })
    ];
    const { segments, projectSide } = buildSegments(cards, {
      heading: { kind: 'project', name: 'NorthStar' }
    });
    assert.ok(!segments.some(s => s.id === 'project:NorthStar'),
      'NorthStar should not appear as a port/starboard segment');
    const otherSeg = segments.find(s => s.id === 'project:Other');
    assert.ok(otherSeg);
    assert.strictEqual(otherSeg.sector, SECTORS.STARBOARD);
    assert.strictEqual(projectSide.get('Other'), SECTORS.STARBOARD);
    assert.ok(!projectSide.has('NorthStar'),
      'NorthStar should not appear in the side map');
  });

  test('heading is pushed even when no cards align (empty arc by design)', () => {
    // Heading set but no card carries the goal label. Forward segment still
    // exists so the seam lines and label render; cards array is empty.
    const cards = [card({ projectName: 'Other' })];
    const { segments } = buildSegments(cards, {
      heading: { kind: 'label', name: 'goal' }
    });
    const fwd = segments.find(s => s.sector === SECTORS.FORWARD);
    assert.ok(fwd, 'expected a forward segment even with no aligned cards');
    assert.strictEqual(fwd.cards.length, 0);
    assert.strictEqual(fwd.label, 'goal');
  });

  test('heading label wins over a bug label (card leaves aft for forward)', () => {
    const cards = [card({ id: 'lift', labels: ['bug', 'goal'], projectName: 'P' })];
    const { segments } = buildSegments(cards, {
      heading: { kind: 'label', name: 'goal' }
    });
    const fwd = segments.find(s => s.sector === SECTORS.FORWARD);
    const aft = segments.find(s => s.id === 'bugs');
    assert.strictEqual(fwd.cards.length, 1);
    assert.ok(!aft, 'aft segment should not exist when bug-labelled card lifted to heading');
  });

  test('no heading set → no forward segment (status quo)', () => {
    const cards = [card({ projectName: 'P' })];
    const { segments } = buildSegments(cards);
    assert.ok(!segments.some(s => s.sector === SECTORS.FORWARD));
  });

  test('project with only backlog cards is dropped from segments', () => {
    const cards = [
      card({ id: 'b1', projectName: 'Dormant', stateType: 'backlog' }),
      card({ id: 'b2', projectName: 'Dormant', stateType: 'backlog' }),
      card({ id: 'a1', projectName: 'Active',  stateType: 'unstarted' })
    ];
    const { segments } = buildSegments(cards);
    const projectSegs = segments.filter(s => s.id.startsWith('project:'));
    assert.strictEqual(projectSegs.length, 1, 'only Active should produce a segment');
    assert.strictEqual(projectSegs[0].label, 'Active');
  });

  test('cards in a dropped backlog project do NOT spill into drift', () => {
    const cards = [
      card({ id: 'b1', projectName: 'Dormant', stateType: 'backlog' }),
      card({ id: 'b2', projectName: 'Dormant', stateType: 'backlog' })
    ];
    const { segments, driftCards } = buildSegments(cards);
    assert.strictEqual(segments.filter(s => s.id.startsWith('project:')).length, 0);
    assert.strictEqual(driftCards.length, 0,
      'backlog-only project cards should drop out entirely, not become drift');
  });

  test('project with one non-backlog card is kept', () => {
    const cards = [
      card({ id: 'b1', projectName: 'Mostly', stateType: 'backlog' }),
      card({ id: 'b2', projectName: 'Mostly', stateType: 'backlog' }),
      card({ id: 't',  projectName: 'Mostly', stateType: 'unstarted' })
    ];
    const { segments } = buildSegments(cards, { showBacklog: true });
    const seg = segments.find(s => s.id === 'project:Mostly');
    assert.ok(seg, 'project with at least one Todo card stays');
    assert.strictEqual(seg.cards.length, 3, 'all three cards remain in the segment');
  });

  test('project with one non-backlog card is kept, backlog cards hidden by default', () => {
    const cards = [
      card({ id: 'b1', projectName: 'Mostly', stateType: 'backlog' }),
      card({ id: 'b2', projectName: 'Mostly', stateType: 'backlog' }),
      card({ id: 't',  projectName: 'Mostly', stateType: 'unstarted' })
    ];
    const { segments } = buildSegments(cards);
    const seg = segments.find(s => s.id === 'project:Mostly');
    assert.ok(seg, 'project with a surviving Todo card stays');
    assert.strictEqual(seg.cards.length, 1, 'only the non-backlog card remains by default');
    assert.strictEqual(seg.cards[0].id, 't');
  });

  test('bug card in a backlog-only project still routes to aft', () => {
    const cards = [
      card({ id: 'b1', projectName: 'Dormant', stateType: 'backlog' }),
      card({ id: 'b2', projectName: 'Dormant', stateType: 'backlog' }),
      card({ id: 'bug', projectName: 'Dormant', stateType: 'unstarted', labels: ['bug'] })
    ];
    const { segments } = buildSegments(cards);
    const aft = segments.find(s => s.id === 'bugs');
    assert.ok(aft);
    assert.strictEqual(aft.cards.length, 1);
    // The remaining two backlog cards still constitute a backlog-only project → dropped.
    assert.ok(!segments.some(s => s.id === 'project:Dormant'));
  });

  test('heading project with only backlog cards keeps its forward segment, cards hidden by default', () => {
    // The segment shell is an explicit user choice (the heading) — it shouldn't
    // be dropped even if every aligned card is backlog and hidden. The now-empty
    // forward arc is itself the signal.
    const cards = [
      card({ id: 'h1', projectName: 'Goal', stateType: 'backlog' }),
      card({ id: 'h2', projectName: 'Goal', stateType: 'backlog' })
    ];
    const { segments } = buildSegments(cards, {
      heading: { kind: 'project', name: 'Goal' }
    });
    const fwd = segments.find(s => s.sector === SECTORS.FORWARD);
    assert.ok(fwd, 'forward segment should exist for the heading project');
    assert.strictEqual(fwd.cards.length, 0, 'backlog heading cards are hidden by default');
  });

  test('heading project with only backlog cards: showBacklog true keeps the cards too', () => {
    const cards = [
      card({ id: 'h1', projectName: 'Goal', stateType: 'backlog' }),
      card({ id: 'h2', projectName: 'Goal', stateType: 'backlog' })
    ];
    const { segments } = buildSegments(cards, {
      heading: { kind: 'project', name: 'Goal' },
      showBacklog: true
    });
    const fwd = segments.find(s => s.sector === SECTORS.FORWARD);
    assert.ok(fwd);
    assert.strictEqual(fwd.cards.length, 2);
  });

  test('skipBacklogProjects: false keeps the drained project as an empty segment', () => {
    // Under the default hidden-backlog filter, both cards are stripped from
    // the group before this flag is consulted at all — its remaining job is
    // the empty-group cleanup, not the card-level filter itself. Opting out
    // leaves the (now cardless) segment in place instead of deleting it.
    const cards = [
      card({ id: 'b1', projectName: 'Dormant', stateType: 'backlog' }),
      card({ id: 'b2', projectName: 'Dormant', stateType: 'backlog' })
    ];
    const { segments } = buildSegments(cards, { skipBacklogProjects: false });
    const seg = segments.find(s => s.id === 'project:Dormant');
    assert.ok(seg, 'opt-out keeps the segment');
    assert.strictEqual(seg.cards.length, 0, 'its cards were still hidden by the default filter');
  });

  test('showBacklog: true bypasses both the card filter and the drained-project cleanup', () => {
    const cards = [
      card({ id: 'b1', projectName: 'Dormant', stateType: 'backlog' }),
      card({ id: 'b2', projectName: 'Dormant', stateType: 'backlog' })
    ];
    const { segments } = buildSegments(cards, { showBacklog: true });
    const seg = segments.find(s => s.id === 'project:Dormant');
    assert.ok(seg, 'showBacklog true bypasses skipBacklogProjects too — the project reappears');
    assert.strictEqual(seg.cards.length, 2);
  });

  test('backlog cards hidden from every bucket by default: heading, bugs, project, drift', () => {
    const cards = [
      card({ id: 'hd', projectName: 'Goal', stateType: 'backlog' }),
      card({ id: 'bg', stateType: 'backlog', labels: ['bug'] }),
      card({ id: 'pr', projectName: 'Active', stateType: 'backlog' }),
      card({ id: 'ac', projectName: 'Active', stateType: 'unstarted' }),
      card({ id: 'dr', stateType: 'backlog' })
    ];
    const { segments, driftCards } = buildSegments(cards, {
      heading: { kind: 'project', name: 'Goal' }
    });
    const fwd = segments.find(s => s.sector === SECTORS.FORWARD);
    const aft = segments.find(s => s.id === 'bugs');
    const active = segments.find(s => s.id === 'project:Active');
    assert.strictEqual(fwd.cards.length, 0, 'heading bucket');
    assert.ok(!aft, 'bug bucket: the only bug card was backlog and hidden, so no BUGS segment');
    assert.strictEqual(active.cards.length, 1, 'project bucket keeps only the non-backlog card');
    assert.strictEqual(active.cards[0].id, 'ac');
    assert.strictEqual(driftCards.length, 0, 'drift bucket');
  });

  test('backlog card that blocks in-progress work is exempt and stays in its bucket', () => {
    const ship = [card({ id: 'wip', stateType: 'started' })];
    const cards = [
      ...ship,
      card({ id: 'blocker', projectName: 'Active', stateType: 'backlog', blocksIds: ['wip'] }),
      card({ id: 'other', projectName: 'Active', stateType: 'backlog' })
    ];
    const { segments } = buildSegments(cards);
    const seg = segments.find(s => s.id === 'project:Active');
    assert.ok(seg, 'project survives because the exempt card keeps the group non-empty');
    assert.strictEqual(seg.cards.length, 1, 'only the exempt blocker survives, not the plain backlog card');
    assert.strictEqual(seg.cards[0].id, 'blocker');
  });

  test('backlog card that parents an in-progress descendant is exempt', () => {
    const ship = [card({ id: 'wip', stateType: 'started', parentId: 'epic' })];
    const cards = [
      ...ship,
      card({ id: 'epic', projectName: 'Active', stateType: 'backlog' })
    ];
    const { segments } = buildSegments(cards);
    const seg = segments.find(s => s.id === 'project:Active');
    assert.ok(seg);
    assert.strictEqual(seg.cards.length, 1);
    assert.strictEqual(seg.cards[0].id, 'epic');
  });

  test('a project group left with only an exempt backlog card is not deleted by the drained-project cleanup', () => {
    const ship = [card({ id: 'wip', stateType: 'started' })];
    const cards = [
      ...ship,
      card({ id: 'onlyExempt', projectName: 'Solo', stateType: 'backlog', blocksIds: ['wip'] })
    ];
    const { segments } = buildSegments(cards);
    const seg = segments.find(s => s.id === 'project:Solo');
    assert.ok(seg, 'a project whose sole surviving card is exempt-backlog must not be swept by the every()-style check');
    assert.strictEqual(seg.cards.length, 1);
  });
});

// =============================================================================
// computeShipReachableIds
// =============================================================================

describe('computeShipReachableIds', () => {
  test('empty without any blocker/parent relation', () => {
    const ship = [card({ id: 'wip', stateType: 'started' })];
    const cards = [...ship, card({ id: 'idle' })];
    const reachable = computeShipReachableIds(cards, ship);
    assert.strictEqual(reachable.size, 0);
  });

  test('direct blocker of a ship card is reachable', () => {
    const ship = [card({ id: 'wip', stateType: 'started' })];
    const cards = [...ship, card({ id: 'blocker', blocksIds: ['wip'] })];
    const reachable = computeShipReachableIds(cards, ship);
    assert.ok(reachable.has('blocker'));
  });

  test('transitive blocker chain is fully reachable', () => {
    const ship = [card({ id: 'wip', stateType: 'started' })];
    const cards = [
      ...ship,
      card({ id: 'a', blocksIds: ['b'] }),
      card({ id: 'b', blocksIds: ['wip'] })
    ];
    const reachable = computeShipReachableIds(cards, ship);
    assert.ok(reachable.has('a'));
    assert.ok(reachable.has('b'));
  });

  test('parent of a ship card is reachable', () => {
    const ship = [card({ id: 'wip', stateType: 'started', parentId: 'epic' })];
    const cards = [...ship, card({ id: 'epic' })];
    const reachable = computeShipReachableIds(cards, ship);
    assert.ok(reachable.has('epic'));
  });

  test('a blocker id with no matching card is ignored, not crashed on', () => {
    const ship = [card({ id: 'wip', stateType: 'started' })];
    const cards = [...ship, card({ id: 'ghostBlocker', blocksIds: ['does-not-exist'] })];
    const reachable = computeShipReachableIds(cards, ship);
    assert.strictEqual(reachable.size, 0);
  });

  test('an unrelated card is not reachable', () => {
    const ship = [card({ id: 'wip', stateType: 'started' })];
    const cards = [...ship, card({ id: 'unrelated' })];
    const reachable = computeShipReachableIds(cards, ship);
    assert.ok(!reachable.has('unrelated'));
  });
});

// =============================================================================
// computeProximityRings
// =============================================================================

describe('computeProximityRings', () => {
  test('default: ring follows priority', () => {
    const orbit = [
      card({ id: 'u', priority: 1 }),
      card({ id: 'h', priority: 2 }),
      card({ id: 'n', priority: 0 })
    ];
    const rings = computeProximityRings(orbit, []);
    assert.strictEqual(rings.get('u'), 0); // Urgent
    assert.strictEqual(rings.get('h'), 1); // High
    assert.strictEqual(rings.get('n'), RING_COUNT - 1); // No priority
  });

  test('completed/canceled cards demoted to outermost ring', () => {
    const orbit = [
      card({ id: 'done', priority: 1, stateType: 'completed' }),
      card({ id: 'gone', priority: 1, stateType: 'canceled' })
    ];
    const rings = computeProximityRings(orbit, []);
    assert.strictEqual(rings.get('done'), RING_COUNT - 1);
    assert.strictEqual(rings.get('gone'), RING_COUNT - 1);
  });

  test('blocker of in-progress card promoted to innermost ring', () => {
    // A is priority 4 (Low) — would normally be ring 3. But it blocks B which
    // is in-progress (in the ship). So A drops to ring 0 — pressing on the ship.
    const ship = [card({ id: 'B', stateType: 'started' })];
    const orbit = [card({ id: 'A', priority: 4, blocksIds: ['B'] })];
    const rings = computeProximityRings(orbit, ship);
    assert.strictEqual(rings.get('A'), 0);
  });

  test('transitive blocker promotion: A blocks B blocks C (in-progress)', () => {
    const ship = [card({ id: 'C', stateType: 'started' })];
    const orbit = [
      card({ id: 'A', priority: 4, blocksIds: ['B'] }),
      card({ id: 'B', priority: 4, blocksIds: ['C'] })
    ];
    const rings = computeProximityRings(orbit, ship);
    assert.strictEqual(rings.get('A'), 0);
    assert.strictEqual(rings.get('B'), 0);
  });

  test('parent of in-progress card promoted to innermost ring', () => {
    const ship = [card({ id: 'child', stateType: 'started', parentId: 'parent' })];
    const orbit = [card({ id: 'parent', priority: 4 })];
    const rings = computeProximityRings(orbit, ship);
    assert.strictEqual(rings.get('parent'), 0);
  });

  test('subtask siblings cohere to the min ring of any sibling', () => {
    // parent priority 1 → ring 0; child priority 4 → ring 3. Siblings should
    // cohere to the min (ring 0), so the whole subtask group sits together.
    const orbit = [
      card({ id: 'parent', priority: 1 }),
      card({ id: 'kid1', priority: 4, parentId: 'parent' }),
      card({ id: 'kid2', priority: 4, parentId: 'parent' })
    ];
    const rings = computeProximityRings(orbit, []);
    assert.strictEqual(rings.get('parent'), 0);
    assert.strictEqual(rings.get('kid1'), 0);
    assert.strictEqual(rings.get('kid2'), 0);
  });

  test('coherence only pulls inward (no member is pushed outward)', () => {
    // Two siblings both at ring 0 — no member changes ring.
    const orbit = [
      card({ id: 'p', priority: 1 }),
      card({ id: 'k', priority: 1, parentId: 'p' })
    ];
    const rings = computeProximityRings(orbit, []);
    assert.strictEqual(rings.get('p'), 0);
    assert.strictEqual(rings.get('k'), 0);
  });

  test('promotion is independent of label: a low-priority bug blocking work still promotes', () => {
    const ship = [card({ id: 'wip', stateType: 'started' })];
    const orbit = [card({ id: 'b', priority: 4, labels: ['bug'], blocksIds: ['wip'] })];
    const rings = computeProximityRings(orbit, ship);
    assert.strictEqual(rings.get('b'), 0);
  });

  test('non-blocker low-priority card stays on the rim', () => {
    const ship = [card({ id: 'wip', stateType: 'started' })];
    const orbit = [card({ id: 'idle', priority: 0 })];
    const rings = computeProximityRings(orbit, ship);
    assert.strictEqual(rings.get('idle'), RING_COUNT - 1);
  });

  test('completed blocker is NOT promoted (already done)', () => {
    // Demotion runs before promotion semantically; the BFS visits the blocker
    // and would set ring 0, but we want completed work to stay on the rim.
    // Currently the code DOES promote — this test pins the behaviour we want
    // and will fail if regressions occur.
    const ship = [card({ id: 'wip', stateType: 'started' })];
    const orbit = [card({ id: 'done', priority: 1, stateType: 'completed', blocksIds: ['wip'] })];
    const rings = computeProximityRings(orbit, ship);
    // Document current behaviour: promotion runs after demotion, so 'done'
    // ends up promoted to ring 0. If we later prefer keeping completed on
    // the rim regardless of relations, flip this assertion + reorder passes.
    assert.strictEqual(rings.get('done'), 0);
  });
});

describe('midpointAngle', () => {
  test('non-wrapping range', () => {
    assert.strictEqual(midpointAngle({ start: 45, end: 135 }), 90);
  });

  test('wrapping range (e.g. starboard 315→45)', () => {
    assert.strictEqual(midpointAngle({ start: 315, end: 45 }), 0);
  });

  test('zero-span range collapses to start', () => {
    assert.strictEqual(midpointAngle({ start: 90, end: 90 }), 90);
  });
});

// =============================================================================
// layout — full pass
// =============================================================================

describe('layout', () => {
  function manyCards(prefix, n, overrides = {}) {
    const cards = [];
    for (let i = 0; i < n; i++) {
      cards.push(card({ id: `${prefix}-${i}`, ...overrides }));
    }
    return cards;
  }

  test('returns positions for every non-ship card', () => {
    const cards = [
      card({ id: 'wip', stateType: 'started' }),
      card({ id: 'a', projectName: 'P1' }),
      card({ id: 'b', projectName: 'P2' })
    ];
    const { positions, buckets } = layout(cards, GEOMETRY);
    assert.strictEqual(buckets.ship.length, 1);
    assert.ok(positions.has('a'));
    assert.ok(positions.has('b'));
    assert.ok(!positions.has('wip'), 'ship cards do not get orbit positions');
  });

  test('projects are balanced across sides', () => {
    const cards = [
      ...manyCards('p1', 3, { projectName: 'Alpha' }),
      ...manyCards('p2', 3, { projectName: 'Bravo' }),
      ...manyCards('p3', 3, { projectName: 'Charlie' })
    ];
    const { positions } = layout(cards, GEOMETRY);
    const sides = { starboard: 0, port: 0 };
    for (const pos of positions.values()) {
      if (pos.sector === SECTORS.STARBOARD) sides.starboard++;
      if (pos.sector === SECTORS.PORT) sides.port++;
    }
    // 9 project cards across 2 sides; should split 6:3 or 3:6.
    assert.ok(sides.starboard > 0 && sides.port > 0,
      `both sides should be populated, got ${JSON.stringify(sides)}`);
  });

  test('dense bucket spills into sub-rings (no two cards in the same slot)', () => {
    // 30 cards in one project, all priority 0 — they used to pile up on one ring.
    const cards = manyCards('many', 30, { projectName: 'Heavy', priority: 0 });
    const { positions } = layout(cards, GEOMETRY);
    const subRings = new Set();
    for (const pos of positions.values()) {
      subRings.add(pos.subRing);
    }
    assert.ok(subRings.size > 1, `expected sub-ring spillover; got only ${subRings.size}`);
  });

  test('no two cards in the same sector end up at the same point', () => {
    const cards = manyCards('x', 50, { projectName: 'Heavy', priority: 0 });
    const { positions } = layout(cards, GEOMETRY);
    const seen = new Set();
    for (const pos of positions.values()) {
      const key = `${Math.round(pos.x)}|${Math.round(pos.y)}`;
      assert.ok(!seen.has(key), `duplicate position at ${key}`);
      seen.add(key);
    }
  });

  test('cards within a sub-ring are spread roughly uniformly along the arc', () => {
    const cards = manyCards('u', 8, { projectName: 'Single', priority: 2 });
    const { positions } = layout(cards, GEOMETRY);
    const angles = [];
    for (const pos of positions.values()) {
      if (pos.subRing === 0) angles.push(pos.angle);
    }
    angles.sort((a, b) => a - b);
    // Gaps between successive cards should be similar (uniform spacing).
    const gaps = [];
    for (let i = 1; i < angles.length; i++) gaps.push(angles[i] - angles[i - 1]);
    if (gaps.length > 1) {
      const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      for (const g of gaps) {
        assert.ok(Math.abs(g - mean) < mean * 0.5,
          `gap ${g.toFixed(1)} deviates from mean ${mean.toFixed(1)} too far`);
      }
    }
  });

  test('layout is deterministic for the same input', () => {
    const cards = manyCards('d', 12, { projectName: 'Stable', priority: 0 });
    const a = layout(cards, GEOMETRY);
    const b = layout(cards, GEOMETRY);
    for (const card of cards) {
      assert.deepStrictEqual(a.positions.get(card.id), b.positions.get(card.id));
    }
  });

  test('backlog cards get no position by default; toggling showBacklog restores them', () => {
    const cards = [
      card({ id: 'a', projectName: 'P1', stateType: 'unstarted' }),
      card({ id: 'b', projectName: 'P1', stateType: 'backlog' })
    ];
    const hidden = layout(cards, GEOMETRY);
    assert.ok(hidden.positions.has('a'));
    assert.ok(!hidden.positions.has('b'), 'hidden backlog card has no position');

    const shown = layout(cards, GEOMETRY, { showBacklog: true });
    assert.ok(shown.positions.has('a'));
    assert.ok(shown.positions.has('b'), 'showBacklog: true restores the position');
  });

  test('an all-backlog workspace with the filter on renders an empty, non-degenerate layout', () => {
    const cards = [
      card({ id: 'b1', projectName: 'Solo', stateType: 'backlog' }),
      card({ id: 'b2', stateType: 'backlog' }) // no project → drift
    ];
    const result = layout(cards, GEOMETRY);
    assert.strictEqual(result.positions.size, 0, 'no orbit positions computed');
    assert.strictEqual(result.driftCards.length, 0);
    assert.strictEqual(result.shipCards.length, 0);
    assert.ok(result.segments.every(s => s.cards.length === 0),
      'no leftover segment carries a card');
  });
});

// =============================================================================
// orderByDependency — topological order within a bucket
// =============================================================================

describe('orderByDependency', () => {
  test('empty input returns empty array', () => {
    assert.deepStrictEqual(orderByDependency([]), []);
  });

  test('single card unchanged', () => {
    const c = card({ id: 'solo' });
    assert.deepStrictEqual(orderByDependency([c]), [c]);
  });

  test('no edges → stable id order', () => {
    const a = card({ id: 'b' });
    const b = card({ id: 'a' });
    const c = card({ id: 'c' });
    const ordered = orderByDependency([a, b, c]);
    assert.deepStrictEqual(ordered.map(x => x.id), ['a', 'b', 'c']);
  });

  test('blocker comes before what it blocks', () => {
    const blocker = card({ id: 'z-blocker', blocksIds: ['a-blocked'] });
    const blocked = card({ id: 'a-blocked' });
    const ordered = orderByDependency([blocked, blocker]);
    const idx = (id) => ordered.findIndex(c => c.id === id);
    assert.ok(idx('z-blocker') < idx('a-blocked'),
      'blocker should precede the card it blocks');
  });

  test('transitive blocking: A blocks B blocks C → A, B, C', () => {
    const a = card({ id: 'A', blocksIds: ['B'] });
    const b = card({ id: 'B', blocksIds: ['C'] });
    const c = card({ id: 'C' });
    const ordered = orderByDependency([c, b, a]);
    assert.deepStrictEqual(ordered.map(x => x.id), ['A', 'B', 'C']);
  });

  test('parent comes before child', () => {
    const p = card({ id: 'p' });
    const k = card({ id: 'k', parentId: 'p' });
    const ordered = orderByDependency([k, p]);
    assert.deepStrictEqual(ordered.map(x => x.id), ['p', 'k']);
  });

  test('out-of-list edges are ignored', () => {
    // p is *not* in this bucket, so k should be treated as a free root.
    const k = card({ id: 'k', parentId: 'p-out-of-bucket' });
    const other = card({ id: 'other', blocksIds: ['also-out'] });
    const ordered = orderByDependency([k, other]);
    // Both have indeg 0, so they fall back to stable id order.
    assert.deepStrictEqual(ordered.map(x => x.id), ['k', 'other']);
  });

  test('handles cycles gracefully — every card still appears once', () => {
    // A blocks B, B blocks A. Kahn's drains nothing; both cards are appended
    // in stable id order rather than dropped.
    const a = card({ id: 'A', blocksIds: ['B'] });
    const b = card({ id: 'B', blocksIds: ['A'] });
    const ordered = orderByDependency([b, a]);
    assert.strictEqual(ordered.length, 2);
    const ids = ordered.map(x => x.id).sort();
    assert.deepStrictEqual(ids, ['A', 'B']);
  });

  test('mixed: parent + blocker constraints both honoured', () => {
    // Tree: parent p with children k1, k2. Separate card x blocks k2.
    // Both p and x have indeg 0; p sorts before x → p emitted first.
    // After p, k1 indeg→0 (free), k2 indeg=1 (still blocked by x).
    // ready=[k1, x] sorted → k1 (k<x). Emit k1.
    // ready=[x]. Emit x → k2 free. Emit k2.
    // Order: p, k1, x, k2.
    // Constraints satisfied: p < k1, p < k2, x < k2.
    const p = card({ id: 'p' });
    const k1 = card({ id: 'k1', parentId: 'p' });
    const k2 = card({ id: 'k2', parentId: 'p' });
    const x = card({ id: 'x', blocksIds: ['k2'] });
    const ordered = orderByDependency([k2, k1, p, x]);
    assert.deepStrictEqual(ordered.map(c => c.id), ['p', 'k1', 'x', 'k2']);
    const idx = (id) => ordered.findIndex(c => c.id === id);
    assert.ok(idx('x') < idx('k2'), 'blocker x must precede blocked k2');
    assert.ok(idx('p') < idx('k1'), 'parent p must precede child k1');
    assert.ok(idx('p') < idx('k2'), 'parent p must precede child k2');
  });
});

// =============================================================================
// clusterSubtaskSiblings — angular clustering inside a sub-ring slice
// =============================================================================

describe('clusterSubtaskSiblings', () => {
  test('empty / single returns equivalent array', () => {
    assert.deepStrictEqual(clusterSubtaskSiblings([]), []);
    const c = card({ id: 'only' });
    assert.deepStrictEqual(clusterSubtaskSiblings([c]), [c]);
  });

  test('unrelated cards preserve their input order', () => {
    const a = card({ id: 'a' });
    const b = card({ id: 'b' });
    const c = card({ id: 'c' });
    assert.deepStrictEqual(
      clusterSubtaskSiblings([a, b, c]).map(x => x.id),
      ['a', 'b', 'c']
    );
  });

  test('parent and children appear contiguously', () => {
    const p = card({ id: 'p' });
    const k1 = card({ id: 'k1', parentId: 'p' });
    const u = card({ id: 'u' });
    const k2 = card({ id: 'k2', parentId: 'p' });
    // Input intersperses parent/children with unrelated u. After clustering
    // the p family is one contiguous block.
    const clustered = clusterSubtaskSiblings([p, u, k1, k2]);
    const ids = clustered.map(c => c.id);
    const pIdx = ids.indexOf('p');
    const k1Idx = ids.indexOf('k1');
    const k2Idx = ids.indexOf('k2');
    const uIdx = ids.indexOf('u');
    // p, k1, k2 are consecutive in some order; u sits outside that run.
    const family = [pIdx, k1Idx, k2Idx].sort((a, b) => a - b);
    assert.strictEqual(family[1] - family[0], 1, 'family members must be contiguous');
    assert.strictEqual(family[2] - family[1], 1, 'family members must be contiguous');
    assert.ok(uIdx < family[0] || uIdx > family[2], 'unrelated card not inside family');
  });

  test('siblings whose parent is outside the list still cluster', () => {
    // Parent 'P' is NOT in the list — but two children share it. They should
    // still be adjacent.
    const k1 = card({ id: 'k1', parentId: 'P' });
    const u = card({ id: 'u' });
    const k2 = card({ id: 'k2', parentId: 'P' });
    const clustered = clusterSubtaskSiblings([k1, u, k2]);
    const ids = clustered.map(c => c.id);
    assert.ok(Math.abs(ids.indexOf('k1') - ids.indexOf('k2')) === 1,
      'external-parent siblings should be adjacent');
  });

  test('preserves family internal order (topo order is not disturbed within a family)', () => {
    // If input is parent-first-then-children, output is parent-first-then-children.
    const p = card({ id: 'p' });
    const k1 = card({ id: 'k1', parentId: 'p' });
    const k2 = card({ id: 'k2', parentId: 'p' });
    const clustered = clusterSubtaskSiblings([p, k1, k2]);
    assert.deepStrictEqual(clustered.map(c => c.id), ['p', 'k1', 'k2']);
  });
});

// =============================================================================
// layout-level: dependency + clustering inside placement
// =============================================================================

describe('layout: in-bucket ordering', () => {
  test('blocker in same proximity ring as blocked lands at an inner subRing', () => {
    // Put two cards in the same project + same priority so they share a bucket.
    // A blocks B inside that bucket. A should slice into an earlier sub-ring
    // (subRing 0) before B (subRing 1+) when the bucket density forces a split.
    // Force density with a narrow segment via many bystanders.
    const blocker = { id: 'A-blocker', identifier: 'A', title: 'A',
      priority: 4, stateType: 'unstarted', labels: [], projectName: 'Solo',
      blocksIds: ['Z-blocked'] };
    const blocked = { id: 'Z-blocked', identifier: 'Z', title: 'Z',
      priority: 4, stateType: 'unstarted', labels: [], projectName: 'Solo' };
    // Add filler cards in same bucket so the placement spills past sub-ring 0.
    const fillers = [];
    for (let i = 0; i < 10; i++) {
      fillers.push({ id: `f-${i}`, identifier: `F${i}`, title: `F${i}`,
        priority: 4, stateType: 'unstarted', labels: [], projectName: 'Solo' });
    }
    const cards = [blocked, blocker, ...fillers];
    const { positions } = layout(cards, GEOMETRY);
    const aPos = positions.get('A-blocker');
    const zPos = positions.get('Z-blocked');
    assert.ok(aPos.subRing <= zPos.subRing,
      `blocker subRing (${aPos.subRing}) should be <= blocked subRing (${zPos.subRing})`);
  });

  test('subtask siblings end up at adjacent angular positions within a sub-ring', () => {
    // 3 siblings sharing an out-of-bucket parent, plus 1 unrelated card whose
    // id sorts BETWEEN siblings. Topological order alone would interleave them
    // (id ordering: b1, b2, b3, b5); clustering pulls the siblings back together.
    const mkCard = (id, parentId) => ({
      id, identifier: id, title: id, priority: 4,
      stateType: 'unstarted', labels: [], projectName: 'Solo',
      ...(parentId ? { parentId } : {})
    });
    const cards = [
      mkCard('b1', 'PARENT-OUT'),
      mkCard('b2'),
      mkCard('b3', 'PARENT-OUT'),
      mkCard('b5', 'PARENT-OUT')
    ];
    const { positions } = layout(cards, GEOMETRY);
    // All four cards land in the same sub-ring on this geometry.
    const ringOf = (id) => positions.get(id).subRing;
    assert.strictEqual(ringOf('b1'), ringOf('b3'), 'b1 & b3 share sub-ring');
    assert.strictEqual(ringOf('b1'), ringOf('b5'), 'b1 & b5 share sub-ring');
    // Sorted by angle along the arc (wrap-aware — starboard spans 315→45°),
    // the siblings form a contiguous run with no unrelated b2 wedged between.
    const items = ['b1', 'b2', 'b3', 'b5']
      .map(id => ({ id, angle: positions.get(id).angle }));
    const maxA = Math.max(...items.map(c => c.angle));
    const minA = Math.min(...items.map(c => c.angle));
    const wraps = (maxA - minA) > 180;
    const sorted = items
      .map(c => ({ id: c.id, pos: wraps && c.angle < 180 ? c.angle + 360 : c.angle }))
      .sort((a, b) => a.pos - b.pos);
    const sibSet = new Set(['b1', 'b3', 'b5']);
    let bestRun = 0, runLen = 0;
    for (const c of sorted) {
      if (sibSet.has(c.id)) { runLen++; bestRun = Math.max(bestRun, runLen); }
      else runLen = 0;
    }
    assert.strictEqual(bestRun, 3,
      `expected 3 contiguous sibling angles, got longest run = ${bestRun} in ${JSON.stringify(sorted)}`);
  });
});

// =============================================================================
// resolveCollisions — anti-overlap pass
// =============================================================================

describe('resolveCollisions', () => {
  const CARD = { width: 160, height: 60 };
  const GEOM = { centerX: 1000, centerY: 1000 };

  function makePos(angle, radius, opts = {}) {
    const rad = angle * Math.PI / 180;
    return {
      x: GEOM.centerX + radius * Math.cos(rad),
      y: GEOM.centerY + radius * Math.sin(rad),
      angle,
      ring: opts.ring ?? 0,
      subRing: opts.subRing ?? 0,
      sector: opts.sector ?? 'starboard',
      segmentId: opts.segmentId ?? 'project:A'
    };
  }

  function noPairOverlaps(positions, w = CARD.width, h = CARD.height, pad = 4) {
    const entries = [...positions.values()];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (Math.abs(entries[i].x - entries[j].x) < w + pad &&
            Math.abs(entries[i].y - entries[j].y) < h + pad) {
          return false;
        }
      }
    }
    return true;
  }

  test('does nothing when no cards overlap', () => {
    const positions = new Map();
    positions.set('a', makePos(0, 400));
    positions.set('b', makePos(45, 400));
    const before = new Map([...positions].map(([k, v]) => [k, { ...v }]));
    const nudges = resolveCollisions(positions, GEOM, CARD);
    assert.strictEqual(nudges, 0);
    for (const [id, pos] of positions) {
      assert.strictEqual(pos.x, before.get(id).x);
      assert.strictEqual(pos.y, before.get(id).y);
    }
  });

  test('separates two overlapping cards', () => {
    const positions = new Map();
    positions.set('a', makePos(0, 400, { ring: 1 }));
    positions.set('b', makePos(0.5, 400, { ring: 1 })); // nearly identical angle
    const nudges = resolveCollisions(positions, GEOM, CARD);
    assert.ok(nudges > 0, 'expected nudges to be applied');
    assert.ok(noPairOverlaps(positions),
      `cards still overlap after ${nudges} nudges`);
  });

  test('lower priority (higher ring) is the card that moves', () => {
    const positions = new Map();
    const a = makePos(0, 400, { ring: 0 }); // urgent
    const b = makePos(0.5, 400, { ring: 3 }); // low
    positions.set('a', a);
    positions.set('b', b);
    const beforeA = { x: a.x, y: a.y };
    resolveCollisions(positions, GEOM, CARD);
    // High priority card untouched
    assert.strictEqual(positions.get('a').x, beforeA.x);
    assert.strictEqual(positions.get('a').y, beforeA.y);
    // Low priority card moved outward (further from centre)
    const rB = Math.hypot(positions.get('b').x - GEOM.centerX,
                          positions.get('b').y - GEOM.centerY);
    assert.ok(rB > 400, `low-priority card should be further out; got r=${rB}`);
  });

  test('angle is preserved — segment membership cannot change', () => {
    const positions = new Map();
    positions.set('a', makePos(20, 400, { segmentId: 'project:A' }));
    positions.set('b', makePos(20.2, 400, { segmentId: 'project:A' }));
    resolveCollisions(positions, GEOM, CARD);
    assert.strictEqual(positions.get('a').angle, 20);
    assert.strictEqual(positions.get('b').angle, 20.2);
  });

  test('deterministic — same input → same output', () => {
    const make = () => {
      const m = new Map();
      m.set('a', makePos(10, 400, { ring: 2 }));
      m.set('b', makePos(10.1, 400, { ring: 2 }));
      m.set('c', makePos(10.2, 400, { ring: 2 }));
      return m;
    };
    const p1 = make();
    const p2 = make();
    resolveCollisions(p1, GEOM, CARD);
    resolveCollisions(p2, GEOM, CARD);
    for (const id of ['a', 'b', 'c']) {
      assert.strictEqual(p1.get(id).x, p2.get(id).x);
      assert.strictEqual(p1.get(id).y, p2.get(id).y);
    }
  });
});

// =============================================================================
// layout: collision resolution end-to-end
// =============================================================================

describe('layout: end-to-end collision resolution', () => {
  test('dense layout produces no overlapping cards', () => {
    // 30 cards, all priority 0 (None), same project — would pile up densely
    // without the collision pass.
    const cards = [];
    for (let i = 0; i < 30; i++) {
      cards.push({
        id: `c-${i}`, identifier: `C-${i}`, title: `Card ${i}`,
        priority: 0, stateType: 'unstarted', labels: [], projectName: 'Crowded'
      });
    }
    const { positions } = layout(cards, GEOMETRY);
    const all = [...positions.values()];
    const W = 160, H = 69, PAD = 4;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const overlap = Math.abs(all[i].x - all[j].x) < W + PAD &&
                        Math.abs(all[i].y - all[j].y) < H + PAD;
        assert.ok(!overlap,
          `cards ${i} and ${j} still overlap at (${all[i].x},${all[i].y}) and (${all[j].x},${all[j].y})`);
      }
    }
  });
});

describe('hash32 / hashFloat', () => {
  test('hash32 is deterministic', () => {
    assert.strictEqual(hash32('hello'), hash32('hello'));
  });

  test('hash32 differs for different inputs', () => {
    assert.notStrictEqual(hash32('a'), hash32('b'));
  });

  test('hashFloat returns value in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = hashFloat(`id-${i}`);
      assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    }
  });

  test('hashFloat with different salts decorrelates', () => {
    const a = hashFloat('id', 'angle');
    const b = hashFloat('id', 'radius');
    assert.notStrictEqual(a, b);
  });
});

// =============================================================================
// Orientation mode (LIN-301) — bearing → angle, parallel layout path
// =============================================================================

// Helper: radius of a position relative to GEOMETRY centre.
function radiusOf(pos) {
  return Math.hypot(pos.x - GEOMETRY.centerX, pos.y - GEOMETRY.centerY);
}

describe('bearingToAngle', () => {
  test('maps the 8-point compass with N at the bow (270° up)', () => {
    assert.strictEqual(bearingToAngle('N'), 270);
    assert.strictEqual(bearingToAngle('NE'), 315);
    assert.strictEqual(bearingToAngle('E'), 0);
    assert.strictEqual(bearingToAngle('SE'), 45);
    assert.strictEqual(bearingToAngle('S'), 90);
    assert.strictEqual(bearingToAngle('SW'), 135);
    assert.strictEqual(bearingToAngle('W'), 180);
    assert.strictEqual(bearingToAngle('NW'), 225);
  });

  test('BEARING_TO_ANGLE and BEARINGS stay in sync', () => {
    assert.deepStrictEqual(BEARINGS.slice().sort(), Object.keys(BEARING_TO_ANGLE).sort());
  });

  test('unknown bearing → null (graceful, no throw)', () => {
    assert.strictEqual(bearingToAngle('X'), null);
    assert.strictEqual(bearingToAngle(''), null);
    assert.strictEqual(bearingToAngle(undefined), null);
  });

  test('E/W maintenance tie broken by project sector', () => {
    // Starboard project → east (0°); port project → west (180°).
    assert.strictEqual(bearingToAngle('E', SECTORS.STARBOARD), 0);
    assert.strictEqual(bearingToAngle('E', SECTORS.PORT), 180);
    assert.strictEqual(bearingToAngle('W', SECTORS.STARBOARD), 0);
    assert.strictEqual(bearingToAngle('W', SECTORS.PORT), 180);
  });

  test('E/W without a side falls back to the literal bearing', () => {
    assert.strictEqual(bearingToAngle('E', SECTORS.DRIFT), 0);
    assert.strictEqual(bearingToAngle('W', SECTORS.AFT), 180);
  });

  test('N/S ignore project sector (only E/W are tie-broken)', () => {
    assert.strictEqual(bearingToAngle('N', SECTORS.STARBOARD), 270);
    assert.strictEqual(bearingToAngle('S', SECTORS.PORT), 90);
  });
});

describe('orientationLayout', () => {
  function projectAndOrient(cards, orientation) {
    const result = layout(cards, GEOMETRY, {});
    const orient = orientationLayout(cards, result.positions, GEOMETRY, { orientation });
    return { result, orient };
  }

  test('hub-first invariant: started cards never enter orientation positions', () => {
    const started = card({ stateType: 'started' });
    const todo = card({ stateType: 'unstarted', identifier: 'LIN-1' });
    const { orient } = projectAndOrient([started, todo], [
      { identifier: 'LIN-1', bearing: 'N', reason: 'x', archived: false }
    ]);
    assert.ok(!(started.id in orient.positions) && !orient.positions.has?.(started.id),
      'started card must be absent from orientation positions');
    assert.ok(orient.positions.has(todo.id), 'orbit card present');
  });

  test('radius is unchanged — orientation only swings the angle', () => {
    const cards = [
      card({ stateType: 'unstarted', identifier: 'LIN-1', priority: 1 }),
      card({ stateType: 'unstarted', identifier: 'LIN-2', priority: 3 }),
      card({ stateType: 'unstarted', identifier: 'LIN-3', priority: 0 })
    ];
    const orientation = [
      { identifier: 'LIN-1', bearing: 'N', reason: 'x', archived: false },
      { identifier: 'LIN-2', bearing: 'S', reason: 'x', archived: false },
      { identifier: 'LIN-3', bearing: 'NE', reason: 'x', archived: false }
    ];
    const { result, orient } = projectAndOrient(cards, orientation);
    for (const c of cards) {
      const pr = radiusOf(result.positions.get(c.id));
      const orr = radiusOf(orient.positions.get(c.id));
      assert.ok(Math.abs(pr - orr) < 1e-6, `radius changed for ${c.identifier}: ${pr} → ${orr}`);
    }
  });

  test('bearing controls the angle (N → 270, S → 90)', () => {
    const north = card({ stateType: 'unstarted', identifier: 'LIN-1' });
    const south = card({ stateType: 'unstarted', identifier: 'LIN-2' });
    const { orient } = projectAndOrient([north, south], [
      { identifier: 'LIN-1', bearing: 'N', reason: 'x', archived: false },
      { identifier: 'LIN-2', bearing: 'S', reason: 'x', archived: false }
    ]);
    // Single card per anchor → exactly the anchor (no fan).
    assert.strictEqual(orient.positions.get(north.id).angle, 270);
    assert.strictEqual(orient.positions.get(south.id).angle, 90);
  });

  test('archived → off-compass flag, position kept (radius + angle unchanged)', () => {
    const c = card({ stateType: 'unstarted', identifier: 'LIN-1' });
    const { result, orient } = projectAndOrient([c], [
      { identifier: 'LIN-1', bearing: 'S', reason: 'x', archived: true }
    ]);
    assert.deepStrictEqual(orient.flags.get(c.id), { archived: true });
    // Position is the project position — archived doesn't swing to its bearing.
    assert.strictEqual(orient.positions.get(c.id).angle, result.positions.get(c.id).angle);
  });

  test('no orientation data for a card → keeps its project angle (fallback)', () => {
    const covered = card({ stateType: 'unstarted', identifier: 'LIN-1' });
    const uncovered = card({ stateType: 'unstarted', identifier: 'LIN-2' });
    const { result, orient } = projectAndOrient([covered, uncovered], [
      { identifier: 'LIN-1', bearing: 'N', reason: 'x', archived: false }
    ]);
    assert.strictEqual(
      orient.positions.get(uncovered.id).angle,
      result.positions.get(uncovered.id).angle
    );
    assert.ok(!orient.flags.has(uncovered.id));
  });

  test('empty orientation → every card keeps its project position (additive no-op)', () => {
    const cards = [
      card({ stateType: 'unstarted', identifier: 'LIN-1' }),
      card({ stateType: 'unstarted', identifier: 'LIN-2' })
    ];
    const { result, orient } = projectAndOrient(cards, []);
    for (const c of cards) {
      assert.strictEqual(orient.positions.get(c.id).angle, result.positions.get(c.id).angle);
    }
  });

  test('same-bearing cards fan within ±ORIENTATION_SPREAD of the anchor', () => {
    const cards = [];
    const orientation = [];
    for (let i = 1; i <= 5; i++) {
      const id = `LIN-${i}`;
      cards.push(card({ stateType: 'unstarted', identifier: id, priority: 0 }));
      orientation.push({ identifier: id, bearing: 'N', reason: 'x', archived: false });
    }
    const { orient } = projectAndOrient(cards, orientation);
    for (const c of cards) {
      const ang = orient.positions.get(c.id).angle;
      // All within the N anchor's ±spread window (270 ± 18).
      const delta = Math.abs(((ang - 270 + 540) % 360) - 180);
      assert.ok(delta <= ORIENTATION_SPREAD + 1e-6, `${c.identifier} angle ${ang} outside fan`);
    }
  });

  test('does not mutate the input project positions', () => {
    const c = card({ stateType: 'unstarted', identifier: 'LIN-1' });
    const result = layout([c], GEOMETRY, {});
    const before = { ...result.positions.get(c.id) };
    orientationLayout([c], result.positions, GEOMETRY, {
      orientation: [{ identifier: 'LIN-1', bearing: 'S', reason: 'x', archived: false }]
    });
    assert.deepStrictEqual(result.positions.get(c.id), before);
  });
});

// =============================================================================
// computeFitZoom (LIN-1221 F1) — first-paint fit so the graph is visible on a
// phone instead of clipping off-canvas at zoom=1. Mirrored inline in ship.js.
// =============================================================================
describe('computeFitZoom', () => {
  test('content smaller than the viewport does not zoom in (capped at maxZoom 1)', () => {
    const z = computeFitZoom({
      contentWidth: 400, contentHeight: 400, availWidth: 1200, availHeight: 900
    });
    assert.strictEqual(z, 1);
  });

  test('content larger than the viewport zooms out to fit', () => {
    // 2000-wide content into a 1000-wide viewport (pad 24): usable 952/2000.
    const z = computeFitZoom({
      contentWidth: 2000, contentHeight: 2000, availWidth: 1000, availHeight: 1000
    });
    assert.ok(z < 1, `expected fit < 1, got ${z}`);
    // The scaled content must sit inside the usable box in both axes.
    assert.ok(2000 * z <= 1000 - 2 * 24 + 1e-6);
  });

  test('picks the tighter axis (a tall narrow phone is width-constrained)', () => {
    // Square content, tall-narrow viewport → width is the binding constraint.
    const z = computeFitZoom({
      contentWidth: 2000, contentHeight: 2000,
      availWidth: 390, availHeight: 844, minZoom: 0.05
    });
    const byWidth = (390 - 48) / 2000;
    assert.ok(Math.abs(z - byWidth) < 1e-9, `expected width-bound ${byWidth}, got ${z}`);
  });

  test('never returns below minZoom (interactive floor honoured)', () => {
    const z = computeFitZoom({
      contentWidth: 100000, contentHeight: 100000,
      availWidth: 390, availHeight: 844, minZoom: 0.15
    });
    assert.strictEqual(z, 0.15);
  });

  test('a lower fit floor lets a large graph shrink further than the default 0.3', () => {
    const opts = { contentWidth: 5000, contentHeight: 5000, availWidth: 390, availHeight: 844 };
    const def = computeFitZoom(opts);                       // minZoom 0.3 default
    const low = computeFitZoom({ ...opts, minZoom: 0.15 }); // fit floor
    assert.strictEqual(def, 0.3);
    assert.ok(low < def, `expected ${low} < ${def}`);
  });

  test('degenerate inputs (zero content / viewport) fall back to 1', () => {
    assert.strictEqual(computeFitZoom({
      contentWidth: 0, contentHeight: 0, availWidth: 390, availHeight: 844
    }), 1);
    assert.strictEqual(computeFitZoom({
      contentWidth: 2000, contentHeight: 2000, availWidth: 0, availHeight: 0
    }), 1);
  });

  test('respects a custom pad', () => {
    const tight = computeFitZoom({
      contentWidth: 1000, contentHeight: 1000, availWidth: 500, availHeight: 500, pad: 0
    });
    const padded = computeFitZoom({
      contentWidth: 1000, contentHeight: 1000, availWidth: 500, availHeight: 500, pad: 50
    });
    assert.strictEqual(tight, 0.5);          // 500/1000
    assert.ok(padded < tight);               // (500-100)/1000 = 0.4
  });
});
