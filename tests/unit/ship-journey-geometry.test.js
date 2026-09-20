/**
 * Ship Journey marker-geometry invariant (LIN-2089).
 *
 * The page's legibility failure was a pure ratio: `derivePositions` advances
 * exactly one unit per waypoint while the client drew each waypoint at r=3 —
 * a dot six steps wide, so 121 waypoints read as ~8 merged blobs at any zoom.
 * The ratio is scale-invariant (dot and step live in the same scaled group),
 * so it cannot be fixed by the fit and has to be pinned as arithmetic here.
 *
 * `public/ship-journey.js` is a browser IIFE with no build step, so — same
 * pattern as tests/unit/ship-layout-parity.test.js and
 * tests/unit/ship-biscuit-parity.test.js — evaluate its source in a vm
 * sandbox and read its test-only `module.exports`. The sandbox's
 * `getElementById` returns null, which is the file's own no-map early return;
 * the export seam deliberately sits above that return so this still works.
 *
 * Run with: node --test tests/unit/ship-journey-geometry.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(__dirname, '../../public/ship-journey.js');
const CSS_PATH = join(__dirname, '../../public/ship-journey.css');

const sandbox = {
  module: { exports: {} },
  window: {},
  document: { getElementById() { return null; } },
  console,
};
vm.runInNewContext(readFileSync(CLIENT_PATH, 'utf8'), sandbox, { filename: 'ship-journey.js' });

const { WAYPOINT_RADIUS, WAYPOINT_HALO, TRAIL_STROKE, DOT_REACH, boundingBox } = sandbox.module.exports;

// derivePositions advances exactly one unit per waypoint (lib/ship-journey.js).
// Every ratio below is stated against that step.
const STEP = 1;
const MAX_MARK_RATIO = 0.8;

describe('ship-journey client geometry constants', () => {
  test('exposes its geometry constants to this test', () => {
    for (const [name, value] of Object.entries({ WAYPOINT_RADIUS, WAYPOINT_HALO, TRAIL_STROKE, DOT_REACH })) {
      assert.strictEqual(typeof value, 'number', `${name} should be exported as a number`);
      assert.ok(value > 0, `${name} should be positive`);
    }
  });

  test('the PAINTED waypoint mark stays under 80% of one step', () => {
    // The rule is stated over 2r + halo, not 2r: the halo is a centred stroke
    // and paints outside the fill. Measuring the fill alone is what let the
    // original r=3 read as "6 units" when the mark was really 6.75 — and is
    // why shrinking r without accounting for the stroke inverts the bug.
    const paintedMark = 2 * WAYPOINT_RADIUS + WAYPOINT_HALO;
    assert.ok(
      paintedMark <= MAX_MARK_RATIO * STEP,
      `painted mark ${paintedMark} must be <= ${MAX_MARK_RATIO} of the ${STEP}-unit step`
    );
  });

  test('the trail stroke is thinner than the waypoint halo', () => {
    // The halo cuts the trail where it passes under a dot. If the trail is as
    // thick as the halo (or thicker) the cut disappears and the trail reads as
    // one continuous thread with no separable waypoints — the inverse of the
    // blob failure, not a fix for it.
    assert.ok(
      TRAIL_STROKE < WAYPOINT_HALO,
      `trail stroke ${TRAIL_STROKE} must be thinner than the waypoint halo ${WAYPOINT_HALO}`
    );
  });

  test('DOT_REACH is the dot\'s true painted reach past its own centre', () => {
    assert.strictEqual(DOT_REACH, WAYPOINT_RADIUS + WAYPOINT_HALO / 2);
    // Sanity: padding the content box by the reach is the same as padding it
    // by the painted mark, which is what the fit actually has to contain.
    assert.strictEqual(2 * DOT_REACH, 2 * WAYPOINT_RADIUS + WAYPOINT_HALO);
  });

  test('the stylesheet paints the stroke widths the constants declare', () => {
    // WAYPOINT_HALO/TRAIL_STROKE are declared in JS (so the invariant above
    // can be tested) but rendered from CSS. Nothing enforces that by
    // construction, so check the two files agree — a silent drift here would
    // pass every assertion above while rendering the old blobs.
    const css = readFileSync(CSS_PATH, 'utf8');
    const strokeWidthOf = (selector) => {
      const block = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
      assert.ok(block, `${selector} should exist in ship-journey.css`);
      const decl = /stroke-width:\s*([\d.]+)\s*;/.exec(block[1]);
      assert.ok(decl, `${selector} should declare a stroke-width`);
      return Number(decl[1]);
    };
    assert.strictEqual(strokeWidthOf('.sj-waypoint'), WAYPOINT_HALO);
    assert.strictEqual(strokeWidthOf('.sj-trail-segment'), TRAIL_STROKE);
  });
});

// boundingBox returns an object built inside the vm realm, so its prototype is
// not this realm's Object.prototype — deepStrictEqual would fail on identity
// alone. Compare the fields.
function assertBox(actual, expected) {
  for (const key of ['minX', 'maxX', 'minY', 'maxY']) {
    assert.strictEqual(actual[key], expected[key], `${key} mismatch`);
  }
}

describe('ship-journey boundingBox', () => {
  test('covers every point it is given', () => {
    const pts = [{ x: 0, y: 0 }, { x: 4, y: -2 }, { x: -1, y: 7 }];
    assertBox(boundingBox(pts), { minX: -1, maxX: 4, minY: -2, maxY: 7 });
  });

  test('returns a unit box for an empty trail rather than an infinite one', () => {
    assertBox(boundingBox([]), { minX: -1, maxX: 1, minY: -1, maxY: 1 });
  });

  test('a walk that never passes near the origin excludes it from its bounding box', () => {
    // Pure boundingBox() arithmetic: a point not in the input never appears
    // in the box unless explicitly included.
    const eastwardWalk = [{ x: 10, y: 0 }, { x: 11, y: 0 }, { x: 12, y: 0 }];
    const box = boundingBox(eastwardWalk);
    assert.ok(box.minX > 0, 'the origin is outside a walk that never returns to it');

    const withOrigin = boundingBox(eastwardWalk.concat([{ x: 0, y: 0 }]));
    assert.strictEqual(withOrigin.minX, 0);
    assert.strictEqual(withOrigin.maxX, 12);
  });
});
