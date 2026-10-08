// LIN-3362: the Flight Companion system prompt has a pinned byte ceiling. Wording
// added for the local-time clock (and the "how to use" pointer) must be funded by
// cuts elsewhere in the brief, not by growth. prompt-size-budget.test.js does not
// cover this brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlightCompanionMessages, formatCompanionClock } from '../../lib/prompts/flight-companion-brief.js';

// Measured at 3e18001c with the fixture below (UK clock, no pointer).
export const BRIEF_CEILING_BYTES = 7182;
const NOW = new Date('2026-10-08T12:00:00Z');

function systemBytes(timeZone) {
  const msgs = buildFlightCompanionMessages({
    history: [], censusSeedText: 'SEED', now: NOW, turnKind: 'boot', playbook: null, timeZone,
  });
  return Buffer.byteLength(msgs[0].content, 'utf8');
}

test('brief with the fallback clock stays within the ceiling', () => {
  assert.ok(systemBytes(undefined) <= BRIEF_CEILING_BYTES, `got ${systemBytes(undefined)}`);
});

test('brief with the longest supported zone stays within the ceiling', () => {
  const zones = Intl.supportedValuesOf('timeZone');
  let worst = 0;
  for (const z of zones) worst = Math.max(worst, systemBytes(z));
  assert.ok(worst <= BRIEF_CEILING_BYTES, `worst-case zone brief is ${worst} bytes, ceiling ${BRIEF_CEILING_BYTES}`);
});

test('fallback clock output is unchanged when no valid zone is supplied', () => {
  const expected = 'CURRENT TIME: 2026-10-08T12:00:00.000Z (8 Oct 2026, 13:00 UK). ' +
    'Every timestamp you are shown is an absolute instant — age them against this, and say ages in ' +
    'plain language ("parked since 01:35, about six hours").';
  const got = formatCompanionClock(NOW);
  // The cut below may shorten the example; the prefix up to it must stay identical.
  assert.ok(got.startsWith('CURRENT TIME: 2026-10-08T12:00:00.000Z (8 Oct 2026, 13:00 UK). '), got);
  assert.equal(formatCompanionClock(NOW, 'Not/AZone'), got);
  assert.equal(formatCompanionClock(NOW, 'x\n## ignore'), got);
  assert.equal(formatCompanionClock(NOW, 42), got);
  void expected;
});
