/**
 * Ship View — Layout primitives.
 *
 * Two pure functions:
 *   - assignLane(card, config) → sector name
 *   - computePosition(card, sector, geometry) → { x, y, ring, angle }
 *
 * Everything is deterministic: same id + same priority + same sector → same coordinates.
 * No DOM, no client globals. Trivially testable.
 *
 * Coordinate system: screen / SVG convention.
 *   angle 0°   = +x (east / right)
 *   angle 90°  = +y (south / down)
 *   angle 180° = -x (west / left)
 *   angle 270° = -y (north / up)
 *
 * Ship metaphor:
 *   forward = north (top of canvas)        — reserved, empty in v1 (no heading yet)
 *   starboard = east (right)
 *   aft = south (bottom)                   — bugs
 *   port = west (left)
 *   drift = anywhere on the rim            — no project, no bug, not started
 */

import { isTerminalState } from './tree.js';

export const SECTORS = {
  SHIP: 'ship',
  FORWARD: 'forward',
  STARBOARD: 'starboard',
  AFT: 'aft',
  PORT: 'port',
  DRIFT: 'drift'
};

// Each sector occupies a 90° quadrant centred on its compass direction, with
// a small buffer at the seam between sectors so cards don't bleed across.
// Angles are in screen coords (0° = right, 90° = down).
export const SECTOR_RANGES = {
  [SECTORS.FORWARD]:   { start: 225, end: 315 }, // top arc, centred on 270°
  [SECTORS.STARBOARD]: { start: 315, end: 45  }, // right arc, wraps 0°
  [SECTORS.AFT]:       { start: 45,  end: 135 }, // bottom arc, centred on 90°
  [SECTORS.PORT]:      { start: 135, end: 225 }  // left arc, centred on 180°
};

// Linear priority → ring index. Urgent items sit near the ship, no-priority on the rim.
// Linear's priority field: 0 = None, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low.
const PRIORITY_RING = {
  1: 0, // Urgent — innermost
  2: 1, // High
  3: 2, // Medium
  4: 3, // Low
  0: 4  // No priority — outermost
};

export const RING_COUNT = 5;

// Innermost (closest to ship) and outermost (rim) ring indices. Used by the
// promotion/demotion passes below.
const INNERMOST_RING = 0;
const OUTERMOST_RING = RING_COUNT - 1;

/**
 * Compute the radial ring for each orbit card, lifting swim-lanes.js' machinery.
 *
 * Pipeline (each step can only move a card inward — toward the ship — except
 * the explicit status demotion which moves completed/canceled cards outward):
 *
 *   1. Initial ring  = priority → ring  (Urgent → 0 … No priority → 4)
 *   2. Status demote: completed / canceled → outermost ring
 *   3. Blocker promote: any orbit card that blocks an in-progress card
 *      (directly or transitively, via blocksIds) → ring 0
 *   4. Parent promote: any orbit card that is an ancestor of an in-progress
 *      card → ring 0  (subtask trees rooted on an in-progress child)
 *   5. Subtask cohere: every member of a subtask tree adopts the min ring
 *      held by any member, so groups stay at one radius
 *
 * The mapping to swim:
 *   - "ring" here ≡ "segment" in swim-lanes.js
 *   - "INNERMOST_RING = 0" corresponds to swim's "segment 0 (started)"
 *   - In ship, the started items aren't in the orbit at all (they're inside
 *     the ship rect), so they're the BFS *seed*, not a destination.
 *
 * @param {Array} orbitCards   Non-started cards (everything to be placed in the orbit)
 * @param {Array} shipCards    Started cards (live inside the ship, drive promotion)
 * @returns {Map<string, number>}  cardId → ring index in [0, RING_COUNT)
 */
export function computeProximityRings(orbitCards, shipCards = []) {
  const orbitById = new Map(orbitCards.map(c => [c.id, c]));
  const ring = new Map();

  // 1. Initial ring from priority.
  for (const card of orbitCards) {
    ring.set(card.id, PRIORITY_RING[card.priority] ?? PRIORITY_RING[0]);
  }

  // 2. Demote terminal-state cards (completed/canceled/duplicate) to the rim.
  for (const card of orbitCards) {
    if (isTerminalState(card.stateType)) {
      ring.set(card.id, OUTERMOST_RING);
    }
  }

  // 3 + 4. Promotion BFS.
  //
  // Seed = in-progress (ship) cards. Walk backwards through both:
  //   - blocksIds : if X has blocksIds containing Y, then X *blocks* Y.
  //                  So to find X (a blocker of Y), reverse-index blocksIds.
  //   - parentId  : if X has parentId === Y, then Y is X's parent.
  //                  So ancestors of Y are walked by following parent pointers
  //                  *outward* from Y.
  //
  // Any orbit card reached this way drops to the innermost ring.
  const blockersOf = new Map();   // blockedId → [blockerCardIds]
  const childrenOf = new Map();   // parentId  → [childCardIds]
  const allCards = [...orbitCards, ...shipCards];
  const allById = new Map(allCards.map(c => [c.id, c]));

  for (const card of allCards) {
    for (const blockedId of card.blocksIds || []) {
      if (!blockersOf.has(blockedId)) blockersOf.set(blockedId, []);
      blockersOf.get(blockedId).push(card.id);
    }
    if (card.parentId) {
      if (!childrenOf.has(card.parentId)) childrenOf.set(card.parentId, []);
      childrenOf.get(card.parentId).push(card.id);
    }
  }

  const seeds = shipCards.map(c => c.id);
  const visited = new Set(seeds);
  const queue = [...seeds];

  while (queue.length > 0) {
    const id = queue.shift();

    // Blockers of this card (orbit only — ship cards are already "in")
    for (const blockerId of blockersOf.get(id) || []) {
      if (!visited.has(blockerId) && orbitById.has(blockerId)) {
        visited.add(blockerId);
        ring.set(blockerId, INNERMOST_RING);
        queue.push(blockerId);
      }
    }

    // Parent of this card (so an ancestor of any in-progress descendant gets pulled in)
    const card = allById.get(id);
    if (card?.parentId && !visited.has(card.parentId)) {
      visited.add(card.parentId);
      if (orbitById.has(card.parentId)) {
        ring.set(card.parentId, INNERMOST_RING);
      }
      queue.push(card.parentId);
    }
  }

  // 5. Subtask coherence — union-find across parent-child edges within the orbit.
  // Every member of a tree adopts the min ring held by any member.
  const parent = new Map(orbitCards.map(c => [c.id, c.id]));
  function find(x) {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const card of orbitCards) {
    if (card.parentId && orbitById.has(card.parentId)) {
      union(card.id, card.parentId);
    }
  }
  const groupMin = new Map();
  for (const card of orbitCards) {
    const root = find(card.id);
    const r = ring.get(card.id);
    const cur = groupMin.get(root);
    if (cur === undefined || r < cur) groupMin.set(root, r);
  }
  for (const card of orbitCards) {
    const target = groupMin.get(find(card.id));
    if (target !== undefined && target < ring.get(card.id)) {
      ring.set(card.id, target);
    }
  }

  return ring;
}

/**
 * Assign a sector to a card. First-matching-rule-wins.
 *
 * Heading routing (when config.heading is set) is checked *before* the bug and
 * project rules. Per design, a card carrying the heading label outranks both
 * its bug status (if any) and its project assignment — the label is more
 * specific than either. Project-heading is also explicit: cards in the heading
 * project go forward instead of into the alphabet-alternated port/starboard.
 *
 * @param {Object} card       Flat card-data object
 * @param {Object} [config]
 * @param {string[]} [config.bugLabels=['bug']]   Labels routing to aft
 * @param {Map<string,string>} [config.projectSide]  projectName → side sector
 * @param {Object} [config.heading]              { kind: 'project'|'label', name: string }
 * @returns {string}  One of SECTORS.*
 */
export function assignLane(card, config = {}) {
  const bugLabels = (config.bugLabels || ['bug']).map(s => s.toLowerCase());
  const heading = config.heading || null;

  if (card.stateType === 'started') return SECTORS.SHIP;

  if (heading && cardMatchesHeading(card, heading)) return SECTORS.FORWARD;

  const labelNames = (card.labels || []).map(l => String(l).toLowerCase());
  if (labelNames.some(name => bugLabels.includes(name))) return SECTORS.AFT;

  if (card.projectName) {
    if (config.projectSide && config.projectSide.has(card.projectName)) {
      return config.projectSide.get(card.projectName);
    }
    // Fallback for ad-hoc per-card calls (e.g. unit tests). Real layouts should
    // pass a balanced projectSide map built by assignProjectSides().
    return (hash32(String(card.projectName)) % 2 === 0) ? SECTORS.PORT : SECTORS.STARBOARD;
  }

  return SECTORS.DRIFT;
}

/**
 * Does this card match the chosen heading?
 *   - 'label' heading: the card carries that label (case-insensitive)
 *   - 'project' heading: the card belongs to that project (exact match)
 */
function cardMatchesHeading(card, heading) {
  if (!heading || !heading.kind || !heading.name) return false;
  if (heading.kind === 'label') {
    const wanted = String(heading.name).toLowerCase();
    return (card.labels || []).some(l => String(l).toLowerCase() === wanted);
  }
  if (heading.kind === 'project') {
    return card.projectName === heading.name;
  }
  return false;
}

/**
 * Distribute projects across port and starboard by alternating sorted order.
 *
 * The previous hash-mod-2 approach gave a coin-flip per project, which on small
 * workspaces (1–3 projects) can land everything on one side. Alternation is
 * deterministic *and* guaranteed-balanced for any project count.
 *
 * @param {string[]} projectNames  Unique project names; order doesn't matter
 * @returns {Map<string, string>}  projectName → 'starboard' | 'port'
 */
export function assignProjectSides(projectNames) {
  const sorted = Array.from(new Set(projectNames.filter(Boolean))).sort();
  const sides = new Map();
  for (let i = 0; i < sorted.length; i++) {
    sides.set(sorted[i], i % 2 === 0 ? SECTORS.STARBOARD : SECTORS.PORT);
  }
  return sides;
}

/**
 * Build a flat list of segments (labelled angular slices) from a set of cards.
 *
 * Each segment owns:
 *   - id          stable identifier ('bugs' | 'project:<name>')
 *   - label       what we render at the segment's midpoint
 *   - sector      one of SECTORS.* (anatomical position on the ship)
 *   - range       { start, end } in canvas degrees; may wrap around 0/360
 *   - cards       cards assigned to this segment
 *
 * Sides containing multiple projects get subdivided so each project owns a
 * named slice. Aft becomes "BUGS" if any bug-labelled non-started cards exist.
 * Forward is reserved for the heading (deferred), drift goes to the rim band.
 *
 * @returns {{ segments: Object[], shipCards: Object[], driftCards: Object[], projectSide: Map }}
 */
export function buildSegments(cards, config = {}) {
  const bugLabels = (config.bugLabels || ['bug']).map(s => s.toLowerCase());
  const heading = config.heading || null;

  const shipCards = [];
  const headingCards = [];
  const bugCards = [];
  const driftCards = [];
  const byProject = new Map();

  for (const card of cards) {
    if (card.stateType === 'started') { shipCards.push(card); continue; }

    // Heading routing first — label-heading wins over project segmentation
    // (a card with the heading label leaves its project segment one card lighter).
    if (heading && cardMatchesHeading(card, heading)) {
      headingCards.push(card);
      continue;
    }

    const labels = (card.labels || []).map(l => String(l).toLowerCase());
    if (labels.some(name => bugLabels.includes(name))) { bugCards.push(card); continue; }
    if (card.projectName) {
      if (!byProject.has(card.projectName)) byProject.set(card.projectName, []);
      byProject.get(card.projectName).push(card);
      continue;
    }
    driftCards.push(card);
  }

  // Skip project segments where every card is in backlog state — those are
  // functionally dormant (no Todo, no In Progress, no Done) and just take up
  // arc real estate on the chart. Cards in such projects drop out entirely;
  // the ship view is for pressing work, not the queued pile. Heading and BUGS
  // segments are handled upstream and unaffected.
  const skipBacklogProjects = config.skipBacklogProjects !== false;
  if (skipBacklogProjects) {
    for (const [name, group] of [...byProject]) {
      if (group.every(c => c.stateType === 'backlog')) {
        byProject.delete(name);
      }
    }
  }

  // Project-side alternation runs over the *remaining* projects only, so a
  // project-heading is naturally absent from the port/starboard rotation.
  const projectSide = assignProjectSides([...byProject.keys()]);

  const segments = [];

  // Forward: heading. Always pushed when a heading is set so the segment
  // label and seam lines render even if no cards align — the empty arc is
  // the signal that nothing is staged toward the goal.
  if (heading) {
    segments.push({
      id: 'heading:' + (heading.id || heading.name),
      label: heading.name,
      sector: SECTORS.FORWARD,
      range: { start: 225, end: 315 },
      cards: headingCards
    });
  }

  // Aft: bugs. Always centred on 90° / span 90° regardless of count — it's a single segment.
  if (bugCards.length > 0) {
    segments.push({
      id: 'bugs', label: 'BUGS', sector: SECTORS.AFT,
      range: { start: 45, end: 135 }, cards: bugCards
    });
  }

  // Subdivide each side's 90° arc among the projects assigned to that side.
  const starboardProjects = [];
  const portProjects = [];
  for (const [name, group] of byProject) {
    (projectSide.get(name) === SECTORS.PORT ? portProjects : starboardProjects).push({ name, group });
  }
  starboardProjects.sort((a, b) => a.name.localeCompare(b.name));
  portProjects.sort((a, b) => a.name.localeCompare(b.name));

  // Starboard: 315°→45° (wraps). Subdivide CW starting from 315°.
  pushProjectSegments(segments, starboardProjects, 315, 90, SECTORS.STARBOARD);
  // Port: 135°→225°. Subdivide CW starting from 135°.
  pushProjectSegments(segments, portProjects, 135, 90, SECTORS.PORT);

  return { segments, shipCards, driftCards, projectSide, headingCards };
}

function pushProjectSegments(segments, projects, startAngle, sideSpan, sector) {
  if (projects.length === 0) return;
  const step = sideSpan / projects.length;
  for (let i = 0; i < projects.length; i++) {
    const start = (startAngle + i * step) % 360;
    const end = (startAngle + (i + 1) * step) % 360;
    segments.push({
      id: 'project:' + projects[i].name,
      label: projects[i].name,
      sector,
      projectName: projects[i].name,
      range: { start, end },
      cards: projects[i].group
    });
  }
}

/**
 * Midpoint angle of a (possibly wrapping) range, in canvas degrees [0, 360).
 */
export function midpointAngle(range) {
  const span = sectorSpan(range);
  return ((range.start + span / 2) % 360 + 360) % 360;
}

/**
 * Lay out every orbit card in one pass.
 *
 * Builds segments, then for each one distributes its cards by priority ring
 * within the segment's angular arc, spilling into sub-rings if dense. Drift
 * items get the full 360° rim band.
 *
 * @returns {{positions: Map<string,Object>, segments: Object[], shipCards: Object[], driftCards: Object[], projectSide: Map}}
 */
export function layout(cards, geometry, config = {}) {
  const cardPitch = config.cardPitch || 180;
  const cardSize = config.cardSize || { width: 160, height: 69 };
  const { segments, shipCards, driftCards, projectSide } = buildSegments(cards, config);

  // Compute proximity ring per orbit card (priority + promotion + coherence).
  // Used by placeSegmentBucket and placeDriftBucket as the radial bucket index
  // instead of raw priority.
  const orbitCards = [...driftCards, ...segments.flatMap(s => s.cards)];
  const proximityRings = computeProximityRings(orbitCards, shipCards);

  const positions = new Map();
  for (const segment of segments) {
    placeSegmentBucket(segment, geometry, cardPitch, positions, proximityRings);
  }
  placeDriftBucket(driftCards, geometry, cardPitch, positions);

  // Anti-collision pass: nudge overlapping cards radially outward. Invariants:
  //   - Angle is preserved per card, so segment membership cannot change.
  //   - The lower-priority / further-out card of each colliding pair is the one
  //     nudged, so ring ordering is preserved best-effort.
  resolveCollisions(positions, geometry, cardSize, config.collisionPad);

  // Keep the old buckets shape around for callers that still expect it
  // (E2E tests assert sector via the data-sector attribute).
  const buckets = {
    ship: shipCards,
    drift: driftCards,
    forward: [], starboard: [], aft: [], port: []
  };
  for (const seg of segments) {
    buckets[seg.sector] = buckets[seg.sector].concat(seg.cards);
  }

  return { positions, segments, shipCards, driftCards, buckets, projectSide };
}

function placeSegmentBucket(segment, geometry, cardPitch, positions, proximityRings = null) {
  if (!segment.cards || segment.cards.length === 0) return;

  // Group by proximity ring (priority + blocker/parent/subtask promotion).
  // Falls back to plain priority ring when no proximity map is provided so
  // computePosition's unit tests still exercise the basic mapping.
  const ringFor = (card) =>
    proximityRings && proximityRings.has(card.id)
      ? proximityRings.get(card.id)
      : priorityToRing(card.priority);

  const byPriority = new Map();
  for (const card of segment.cards) {
    const baseRing = ringFor(card);
    if (!byPriority.has(baseRing)) byPriority.set(baseRing, []);
    byPriority.get(baseRing).push(card);
  }

  const range = segment.range;
  const span = sectorSpan(range);
  // Sub-rings must clear card height (~60px) plus a small visible gap so cards
  // in adjacent radial layers don't overlap. Was 0.4 — overlapped vertically.
  const subRingStep = Math.max(geometry.ringSpacing * 0.55, 75);

  // Half a card plus a small buffer — used to keep card edges off the seam line.
  const SEAM_CLEAR_PX = (cardPitch / 2) + 6;

  for (const baseRing of [...byPriority.keys()].sort((a, b) => a - b)) {
    // Topologically order the bucket so blockers and parents are slotted into
    // *inner* sub-rings (they get sliced into the first batch). orderByDependency
    // does a stable-id tiebreak internally, so we don't need a separate sort.
    const group = orderByDependency(byPriority.get(baseRing));

    const baseR = ringRadius(baseRing, geometry);
    let subRing = 0;
    let cursor = 0;

    while (cursor < group.length) {
      const r = baseR + subRing * subRingStep;

      // Angular buffer at this radius: convert SEAM_CLEAR_PX into degrees so
      // half-card width clears the segment edge regardless of how deep the
      // ring is. Outer rings get a small angular buffer; inner rings a big one.
      const angBufDeg = (SEAM_CLEAR_PX / r) * (180 / Math.PI);
      const usable = Math.max(0, span - 2 * angBufDeg);

      const arc = (usable * Math.PI / 180) * r;
      const capacity = Math.max(1, Math.floor(arc / cardPitch) + 1);
      const remaining = group.length - cursor;
      const here = Math.min(capacity, remaining);

      // Within the sub-ring slice, cluster subtask siblings (and parent+kids)
      // so angular neighbours form coherent families. This reorders only inside
      // a single sub-ring, so it can't move a blocker outward across sub-rings.
      const slice = clusterSubtaskSiblings(group.slice(cursor, cursor + here));

      // Angular layout: cards within a sub-ring get equal spacing across the
      // usable arc. Adjacent sub-rings (in the same priority band) are
      // offset by half a step so cards in different sub-rings interleave
      // rather than stacking along the same radius — otherwise two cards
      // straight out along the same angle overlap because they're rectangles.
      const step = here > 1 ? usable / here : 0;
      let staggerOffset;
      if (here === 1) {
        // Single card: alternate near-start / near-end across sub-rings
        staggerOffset = subRing % 2 === 0 ? usable / 3 : (2 * usable) / 3;
      } else {
        staggerOffset = subRing % 2 === 0 ? step / 2 : step;
      }

      for (let i = 0; i < here; i++) {
        const card = slice[i];
        const angle = ((range.start + angBufDeg + staggerOffset + i * step) % 360 + 360) % 360;
        const jitter = (hashFloat(card.id, 'r') - 0.5) * subRingStep * 0.2;
        positions.set(card.id, makePoint(geometry, angle, r + jitter, baseRing, subRing, segment.sector, segment.id));
      }

      cursor += here;
      subRing++;
    }
  }
}

/**
 * Topologically order cards within a single (segment, ring) bucket.
 *
 * Edges considered (only when *both* endpoints are inside `cards`):
 *   - blocker → blocked  (from card.blocksIds)
 *   - parent  → child    (from card.parentId)
 *
 * Out-of-bucket relationships are ignored — those were already accounted for
 * by computeProximityRings, which is what landed the card in this bucket.
 *
 * Stable on ties: when two cards are both ready, the lower id is emitted first
 * so the layout is deterministic. Cycles are tolerated — any cards that can't
 * be drained by Kahn's are appended in stable id order so no card is lost.
 *
 * @param {Array} cards  Cards in a single bucket.
 * @returns {Array}      Same cards, topologically ordered.
 */
export function orderByDependency(cards) {
  if (cards.length <= 1) return cards.slice();
  const idSet = new Set(cards.map(c => c.id));
  const byId = new Map(cards.map(c => [c.id, c]));
  const out = new Map();
  const indeg = new Map(cards.map(c => [c.id, 0]));

  for (const card of cards) {
    for (const blockedId of card.blocksIds || []) {
      if (idSet.has(blockedId)) {
        if (!out.has(card.id)) out.set(card.id, []);
        out.get(card.id).push(blockedId);
        indeg.set(blockedId, indeg.get(blockedId) + 1);
      }
    }
    if (card.parentId && idSet.has(card.parentId)) {
      if (!out.has(card.parentId)) out.set(card.parentId, []);
      out.get(card.parentId).push(card.id);
      indeg.set(card.id, indeg.get(card.id) + 1);
    }
  }

  const ready = cards.filter(c => indeg.get(c.id) === 0).slice().sort(stableById);
  const result = [];
  while (ready.length > 0) {
    const card = ready.shift();
    result.push(card);
    for (const childId of out.get(card.id) || []) {
      const d = indeg.get(childId) - 1;
      indeg.set(childId, d);
      if (d === 0) {
        const c = byId.get(childId);
        let i = 0;
        while (i < ready.length && stableById(ready[i], c) < 0) i++;
        ready.splice(i, 0, c);
      }
    }
  }

  if (result.length < cards.length) {
    const seen = new Set(result.map(c => c.id));
    const leftover = cards.filter(c => !seen.has(c.id)).sort(stableById);
    for (const c of leftover) result.push(c);
  }
  return result;
}

/**
 * Cluster subtask siblings inside a list so families appear contiguously.
 *
 * A "family" is the set of cards that share the same topmost in-list ancestor
 * (walked via parentId). Siblings whose parent is outside the list cluster by
 * that external parentId so they still group together visually.
 *
 * Preserves each family's internal order. Families appear in the order their
 * first member appeared in the input — so a topologically-ordered input keeps
 * blockers in earlier positions than what they block, modulo family bunching.
 *
 * @param {Array} orderedCards  Pre-ordered cards (typically from orderByDependency).
 * @returns {Array}             Same cards, with families contiguous.
 */
export function clusterSubtaskSiblings(orderedCards) {
  if (orderedCards.length <= 1) return orderedCards.slice();
  const idSet = new Set(orderedCards.map(c => c.id));
  const byId = new Map(orderedCards.map(c => [c.id, c]));

  function familyKey(card) {
    let cur = card;
    while (cur.parentId) {
      if (idSet.has(cur.parentId)) {
        cur = byId.get(cur.parentId);
      } else {
        return 'external:' + cur.parentId;
      }
    }
    return 'root:' + cur.id;
  }

  const families = new Map();
  const familyOrder = [];
  for (const card of orderedCards) {
    const key = familyKey(card);
    if (!families.has(key)) {
      families.set(key, []);
      familyOrder.push(key);
    }
    families.get(key).push(card);
  }
  const result = [];
  for (const key of familyOrder) {
    for (const c of families.get(key)) result.push(c);
  }
  return result;
}

/**
 * Iterative anti-collision pass. After deterministic placement leaves some
 * cards overlapping (common at realistic density), we nudge the "loser" of
 * each colliding pair radially outward until no pair overlaps.
 *
 * Picking the loser:
 *   1. Higher proximity ring (= lower priority) is the loser.
 *   2. Tie: higher subRing.
 *   3. Tie: card currently further from centre.
 *   4. Tie: lexicographic id (stable, deterministic).
 *
 * Invariants:
 *   - Angle is preserved, so a card cannot cross a segment boundary.
 *   - Ring ordering is preserved best-effort — only the *lower-priority* card
 *     of a colliding pair moves outward. A high-priority card in the same
 *     segment will never end up further from centre than a low-priority one
 *     unless they started in the wrong order (which placeSegmentBucket
 *     prevents).
 *
 * Returns the number of nudges applied — exposed so callers / tests can
 * detect when collisions can't be resolved within the iteration budget.
 */
export function resolveCollisions(positions, geometry, cardSize, padding) {
  const W = cardSize.width;
  const H = cardSize.height;
  const PAD = padding !== undefined ? padding : 4;
  const STEP = 8;
  const MAX_ITER = 80;

  const cx = geometry.centerX;
  const cy = geometry.centerY;

  const entries = [];
  for (const [id, pos] of positions) entries.push({ id, pos });

  let nudges = 0;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let moved = false;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const ea = entries[i], eb = entries[j];
        if (!cardsOverlap(ea.pos, eb.pos, W, H, PAD)) continue;
        const loser = pickCollisionLoser(ea, eb, cx, cy);
        nudgeRadiallyOutward(loser.pos, cx, cy, STEP);
        nudges++;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return nudges;
}

function cardsOverlap(a, b, W, H, PAD) {
  return Math.abs(a.x - b.x) < W + PAD && Math.abs(a.y - b.y) < H + PAD;
}

function pickCollisionLoser(ea, eb, cx, cy) {
  const a = ea.pos, b = eb.pos;
  if (a.ring !== b.ring) return a.ring > b.ring ? ea : eb;
  if (a.subRing !== b.subRing) return a.subRing > b.subRing ? ea : eb;
  const rA = Math.hypot(a.x - cx, a.y - cy);
  const rB = Math.hypot(b.x - cx, b.y - cy);
  if (Math.abs(rA - rB) > 0.5) return rA > rB ? ea : eb;
  return ea.id < eb.id ? eb : ea; // higher id loses — deterministic
}

function nudgeRadiallyOutward(pos, cx, cy, step) {
  const r = Math.hypot(pos.x - cx, pos.y - cy) + step;
  const rad = pos.angle * Math.PI / 180;
  pos.x = cx + r * Math.cos(rad);
  pos.y = cy + r * Math.sin(rad);
}

function placeDriftBucket(cards, geometry, cardPitch, positions) {
  if (cards.length === 0) return;

  cards.sort(stableById);

  // Drift starts one band past the outermost priority ring.
  const baseR = ringRadius(RING_COUNT, geometry);
  const subRingStep = geometry.ringSpacing * 0.4;

  let subRing = 0;
  let cursor = 0;

  while (cursor < cards.length) {
    const r = baseR + subRing * subRingStep;
    const arc = 2 * Math.PI * r;
    const capacity = Math.max(4, Math.floor(arc / cardPitch));
    const remaining = cards.length - cursor;
    const here = Math.min(capacity, remaining);
    const step = 360 / here;

    for (let i = 0; i < here; i++) {
      const card = cards[cursor + i];
      const angle = (i * step) % 360;
      const jitter = (hashFloat(card.id, 'r') - 0.5) * subRingStep * 0.25;
      positions.set(card.id, makePoint(geometry, angle, r + jitter, RING_COUNT, subRing, SECTORS.DRIFT));
    }

    cursor += here;
    subRing++;
  }
}

function makePoint(geometry, angle, radius, ring, subRing, sector, segmentId) {
  const rad = angle * Math.PI / 180;
  return {
    x: geometry.centerX + radius * Math.cos(rad),
    y: geometry.centerY + radius * Math.sin(rad),
    ring, subRing, angle, sector,
    segmentId: segmentId || null
  };
}

function stableById(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Compute screen coordinates for a card outside the ship.
 *
 * For SHIP cards, this returns null — the renderer lays out the ship rectangle
 * separately (cards stack 2-wide inside it).
 *
 * @param {Object} card           Flat card-data object
 * @param {string} sector         From assignLane
 * @param {Object} geometry
 * @param {number} geometry.centerX        Canvas centre x
 * @param {number} geometry.centerY        Canvas centre y
 * @param {number} geometry.shipHalfWidth  Half the ship rect's width (px)
 * @param {number} geometry.shipHalfHeight Half the ship rect's height (px)
 * @param {number} geometry.ringSpacing    Distance between adjacent rings (px)
 * @param {number} [geometry.firstRingGap=40]  Gap between ship edge and ring 0 (px)
 * @returns {{x:number, y:number, ring:number, angle:number} | null}
 */
export function computePosition(card, sector, geometry) {
  if (sector === SECTORS.SHIP) return null;

  const ring = priorityToRing(card.priority);
  const baseRadius = ringRadius(ring, geometry);
  const angle = pickAngle(card, sector);

  // Small radial jitter so same-ring same-sector cards don't sit on identical arcs.
  // Use a different hash seed than pickAngle so angle and radius decorrelate.
  const radialJitter = (hashFloat(card.id, 'r') - 0.5) * (geometry.ringSpacing * 0.35);
  const radius = baseRadius + radialJitter;

  const rad = (angle * Math.PI) / 180;
  const x = geometry.centerX + radius * Math.cos(rad);
  const y = geometry.centerY + radius * Math.sin(rad);

  return { x, y, ring, angle };
}

/**
 * Ship rectangle dimensions for N in-progress items.
 *
 * Layout intent: the WIP grid sits inside the rect with *consistent breathing
 * room on all four sides* (`gridPad`). The IN PROGRESS label gets its own top
 * allowance (`labelArea`) above the grid so it doesn't crowd the cards. The
 * total top padding is `gridPad + labelArea`; the other three paddings are
 * just `gridPad`.
 *
 * Returned values are authoritative — the renderer applies them inline as
 * `padding` on the element so CSS can't drift from what we compute here.
 */
export function computeShipDimensions(inProgressCount, cardSize) {
  const cols = Math.min(2, Math.max(1, inProgressCount));
  const rows = Math.max(1, Math.ceil(inProgressCount / 2));
  const GRID_PAD = 16;
  const LABEL_AREA = 20;
  const GAP = 8;

  // Always reserve room for 2 columns so the silhouette is consistent even with 1 card.
  const width = 2 * cardSize.width + GAP + 2 * GRID_PAD;
  const height = rows * cardSize.height + (rows - 1) * GAP + LABEL_AREA + 2 * GRID_PAD;

  return {
    width, height, cols, rows,
    padding: GRID_PAD,
    labelArea: LABEL_AREA,
    gap: GAP
  };
}

/**
 * Place an in-ship card within the ship rectangle.
 * Cards fill row-by-row, left-then-right. Returns top-left of the card.
 */
export function shipCardOffset(index, ship, cardSize) {
  const col = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: ship.padding + col * (cardSize.width + ship.gap),
    y: ship.padding + (ship.labelArea || 0) + row * (cardSize.height + ship.gap)
  };
}

// =============================================================================
// Orientation mode (LIN-301) — parallel layout path, bearing → angle.
//
// A pure-read consumer of the per-task compass bearings saved by the roadmap
// orientation run (LIN-300) into the report-history store (LIN-299). NO LLM
// call happens here or on the ship side — see LIN-298. This is a SECOND layout
// path: it never touches buildSegments / assignLane / layout. It takes the
// project-mode positions those produce and overrides ONLY each card's angle,
// reusing the project radius verbatim. That makes two invariants structural
// rather than best-effort:
//   - Radius is unchanged (readiness/priority axis is preserved exactly).
//   - In-progress work stays at the hub: started cards return null from
//     computePosition and never enter the orbit `positions` map, so they are
//     simply absent here — the `stateType === 'started'` → SHIP check in
//     assignLane stays first and authoritative, and orientation never re-ranks
//     committed work.
// =============================================================================

/**
 * 8-point compass bearing → canvas angle (degrees, screen coords where
 * 0° = east/right, 90° = south/down, 270° = north/up).
 *
 *   canvasAngle = (compassDeg − 90 + 360) % 360, with compass N=0, E=90, S=180, W=270.
 *
 * So the bow (forward / toward the north star) is N → 270° (up); drift/drag is
 * S → 90° (aft); maintenance is E/W → starboard/port. Intermediate bearings sit
 * on the diagonals, giving the fuzzy alignment gradient.
 */
export const BEARING_TO_ANGLE = {
  N:  270,
  NE: 315,
  E:  0,
  SE: 45,
  S:  90,
  SW: 135,
  W:  180,
  NW: 225
};

/** The 8-point bearing vocabulary, in compass order from the bow. */
export const BEARINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Map a bearing to a canvas angle, breaking the cosmetic E-vs-W maintenance tie
 * with the card's existing project-side assignment so the chart stays balanced
 * (LIN-298: "E vs W for maintenance is cosmetic — break the tie with the
 * existing project-side assignment"). Pure; does not call the LLM; does not
 * mutate the card.
 *
 *   - N/S and the four diagonals map straight through BEARING_TO_ANGLE.
 *   - E or W (pure maintenance) defers to projectSector: a card whose project
 *     was alternated to STARBOARD points east (0°), PORT points west (180°).
 *     Without a side (aft/forward/drift) the literal bearing is honoured.
 *
 * @param {string} bearing        One of BEARINGS
 * @param {string} [projectSector] The card's project-mode sector (SECTORS.*)
 * @returns {number|null}         Canvas angle in [0, 360), or null if unknown bearing
 */
export function bearingToAngle(bearing, projectSector) {
  if (!Object.prototype.hasOwnProperty.call(BEARING_TO_ANGLE, bearing)) return null;
  if (bearing === 'E' || bearing === 'W') {
    if (projectSector === SECTORS.STARBOARD) return BEARING_TO_ANGLE.E;
    if (projectSector === SECTORS.PORT) return BEARING_TO_ANGLE.W;
  }
  return BEARING_TO_ANGLE[bearing];
}

/**
 * Build the orientation-mode positions from the project-mode positions.
 *
 * Contract:
 *   - TAKES the project-mode `positions` map (from layout()), the same card
 *     list, the geometry, and the saved orientation bearings.
 *   - RETURNS { positions, flags }: a new positions map (card id → point, same
 *     shape as layout()'s, with `angle` overridden and `radius` carried) plus a
 *     `flags` map (card id → { archived: true }) for off-compass cards.
 *   - DOES NOT call the LLM (pure read of saved results — see LIN-298).
 *   - DOES NOT modify the input positions, the cards, or any task state.
 *   - DOES NOT change any card's radius — every point reuses the radius of its
 *     project-mode position, so the toggle animates angle only.
 *   - DOES NOT place started/hub cards: they are absent from `positions` by
 *     construction and stay on the ship.
 *
 * Per-card rule:
 *   - archived bearing  → off-compass: keep the project angle + radius, flag it
 *     overboard (a visual flag, not a relocation — keeps the radius invariant
 *     and leaves the drift rim clear for the future LIN-291 overlay).
 *   - no bearing / unknown bearing for this card (the report may not cover every
 *     task) → graceful fallback: keep the project-mode angle. The card simply
 *     doesn't swing.
 *   - otherwise → swing to bearingToAngle(bearing, projectSector). Cards sharing
 *     an anchor are fanned deterministically across ±ORIENTATION_SPREAD so they
 *     don't stack, while radius stays put.
 *
 * @param {Array}  cards                 The same flat card list passed to layout()
 * @param {Map<string,Object>} positions Project-mode positions (layout().positions)
 * @param {Object} geometry              { centerX, centerY, ... } used by layout()
 * @param {Object} [config]
 * @param {OrientationBearing[]} [config.orientation=[]]  Saved per-task bearings
 * @returns {{ positions: Map<string,Object>, flags: Map<string,Object> }}
 */
export function orientationLayout(cards, positions, geometry, config = {}) {
  const orientation = Array.isArray(config.orientation) ? config.orientation : [];
  const byIdentifier = new Map();
  for (const o of orientation) {
    if (o && o.identifier) byIdentifier.set(o.identifier, o);
  }
  const cardById = new Map(cards.map(c => [c.id, c]));
  const cx = geometry.centerX;
  const cy = geometry.centerY;

  // Resolve each orbit card to a target angle, carrying its project radius.
  const resolved = [];
  for (const [id, pos] of positions) {
    const card = cardById.get(id);
    if (!card) continue; // stray position with no card — skip defensively
    const radius = Math.hypot(pos.x - cx, pos.y - cy);
    const rec = byIdentifier.get(card.identifier);

    if (rec && rec.archived) {
      resolved.push({ id, pos, radius, angle: pos.angle, archived: true, swung: false });
      continue;
    }
    const anchor = rec ? bearingToAngle(rec.bearing, pos.sector) : null;
    if (anchor === null) {
      // No (or unknown) bearing → keep project angle (graceful fallback).
      resolved.push({ id, pos, radius, angle: pos.angle, archived: false, swung: false });
      continue;
    }
    resolved.push({ id, pos, radius, anchor, archived: false, swung: true });
  }

  // Fan same-anchor cards across ±ORIENTATION_SPREAD (radius preserved) so a
  // popular bearing doesn't pile every card on one ray. Deterministic by id.
  const groups = new Map();
  for (const r of resolved) {
    if (!r.swung) continue;
    if (!groups.has(r.anchor)) groups.set(r.anchor, []);
    groups.get(r.anchor).push(r);
  }
  for (const group of groups.values()) {
    group.sort(stableById);
    const n = group.length;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const offset = (t - 0.5) * 2 * ORIENTATION_SPREAD; // [-spread, +spread]
      group[i].angle = ((group[i].anchor + offset) % 360 + 360) % 360;
    }
  }

  const outPositions = new Map();
  const flags = new Map();
  for (const r of resolved) {
    outPositions.set(r.id, makeOrientationPoint(geometry, r.angle, r.radius, r.pos));
    if (r.archived) flags.set(r.id, { archived: true });
  }
  return { positions: outPositions, flags };
}

// Half-width of the angular fan applied to cards sharing a bearing anchor. The
// 8-point compass gives each bearing a 45° slice; ±18° keeps fanned cards
// inside their own slice so the bearing stays legible.
export const ORIENTATION_SPREAD = 18;

function makeOrientationPoint(geometry, angle, radius, basePos) {
  const rad = angle * Math.PI / 180;
  return {
    x: geometry.centerX + radius * Math.cos(rad),
    y: geometry.centerY + radius * Math.sin(rad),
    ring: basePos.ring,
    subRing: basePos.subRing,
    angle,
    radius,
    sector: basePos.sector,
    segmentId: basePos.segmentId || null
  };
}

// =============================================================================
// Internals
// =============================================================================

function priorityToRing(priority) {
  return PRIORITY_RING[priority] !== undefined ? PRIORITY_RING[priority] : PRIORITY_RING[0];
}

function ringRadius(ringIndex, geometry) {
  const shipBound = Math.sqrt(
    geometry.shipHalfWidth * geometry.shipHalfWidth +
    geometry.shipHalfHeight * geometry.shipHalfHeight
  );
  const firstGap = geometry.firstRingGap !== undefined ? geometry.firstRingGap : 40;
  return shipBound + firstGap + ringIndex * geometry.ringSpacing;
}

/**
 * Pick a deterministic angle inside a sector's arc, leaving a 10% buffer at
 * each edge so cards don't sit right on the seam between sectors.
 * Drift gets the full circle.
 */
function pickAngle(card, sector) {
  const h = hashFloat(card.id, 'a');

  if (sector === SECTORS.DRIFT) {
    return h * 360;
  }

  const range = SECTOR_RANGES[sector];
  if (!range) return h * 360;

  const span = sectorSpan(range);
  const usable = span * 0.8;
  const offset = span * 0.1;
  return ((range.start + offset + h * usable) % 360 + 360) % 360;
}

function sectorSpan(range) {
  if (range.start <= range.end) return range.end - range.start;
  return (360 - range.start) + range.end;
}

/**
 * 32-bit string hash. FNV-1a accumulation followed by a murmur3 finalizer so
 * single-character differences (e.g. `bunch-0` vs `bunch-1`) avalanche through
 * all output bits — without the finalizer the angles cluster on the seam.
 * Stable across runs and platforms.
 */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Hash → float in [0, 1). Salt lets us derive multiple uncorrelated values
 * from the same id (e.g. angle vs radial jitter).
 */
export function hashFloat(str, salt = '') {
  return hash32(salt + ':' + str) / 0x100000000;
}
