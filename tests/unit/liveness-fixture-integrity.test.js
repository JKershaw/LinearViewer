/**
 * Fixture-integrity tripwires for tests/fixtures/liveness/lin-3238-cycle.json
 * (LIN-3258, RC2/RC4/RC5).
 *
 * These exist so nobody can "fix" the verbatim capture into one that passes
 * while production misses the cycle:
 *   - the close-out's `[pending]` texts must contain NO full UUID, and no
 *     8-hex token that resolves to a dispatch row (RC4's restated tripwire);
 *   - the close-out's `sessionId` must name the stepper (the parent edge);
 *   - the header must record the lineage-merged provenance of the capture.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractDispatchIds } from '../../lib/liveness-detectors.js';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/liveness/lin-3238-cycle.json', import.meta.url)), 'utf8'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOSE_OUT = '2550fd09-3567-4416-8eb5-b4d3750a285f';
const STEPPER = '8608873d-af0f-47fd-8dea-61c36f85d8e5';

describe('LIN-3238 fixture integrity (LIN-3258)', () => {
  const rowById = new Map(fixture.rows.map((r) => [r.id, r]));
  const knownIds = fixture.rows.map((r) => r.id);

  test('the fixture header records the merged-capture provenance', () => {
    assert.ok(fixture._header, 'a _header with capturedAt/source/provenance is required');
    assert.ok(fixture._header.capturedAt);
    assert.ok(fixture._header.source);
    assert.match(fixture._header.provenance, /lineage-merged/i, 'RC5: the provenance must state the view is lineage-merged');
  });

  test('the close-out [pending] texts carry no full UUID', () => {
    const closeOut = rowById.get(CLOSE_OUT);
    assert.ok(closeOut, 'the close-out row is present');
    for (const entry of closeOut.feedback) {
      if (!entry.message?.startsWith('[pending]')) continue;
      const uuids = extractDispatchIds(entry.message).filter((id) => UUID_RE.test(id));
      assert.deepEqual(uuids, [], `the close-out must NOT name a dispatch by full UUID (else the capture was "fixed"): ${entry.message.slice(0, 120)}`);
    }
  });

  test('no 8-hex token in the close-out [pending] texts resolves to a fixture dispatch row (RC4)', () => {
    const closeOut = rowById.get(CLOSE_OUT);
    const prefixes = new Set(knownIds.map((id) => id.slice(0, 8).toLowerCase()));
    for (const entry of closeOut.feedback) {
      if (!entry.message?.startsWith('[pending]')) continue;
      const hex8 = extractDispatchIds(entry.message).filter((id) => !UUID_RE.test(id));
      for (const token of hex8) {
        assert.ok(!prefixes.has(token), `8-hex ${token} resolves to a fixture row — the tripwire would be vacuous`);
      }
    }
  });

  test('the close-out sessionId names the stepper (the parent edge)', () => {
    assert.equal(rowById.get(CLOSE_OUT).sessionId, STEPPER);
  });

  test('the stepper wait names the close-out by full UUID (the text edge)', () => {
    const stepper = rowById.get(STEPPER);
    const pending = stepper.feedback.filter((e) => e.message?.startsWith('[pending]'));
    assert.ok(pending.some((e) => e.message.includes(CLOSE_OUT)), 'the stepper must name the close-out by full id');
  });
});
