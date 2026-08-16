/**
 * Unit tests for lib/prompts/flight-companion-kickoff.js (LIN-922).
 *
 * These pin the load-bearing research findings into the prompt so they can't
 * silently drift: the colleague persona, the proxy setup + token framing, the
 * orient/monitor/act tool catalog, the dispatch-feedback-stream monitor (and the
 * explicit avoidance of the browser-only observation endpoints), and the
 * user-approval-before-dispatch gate.
 *
 * Run with: node --test tests/unit/flight-companion-kickoff.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildFlightCompanionKickoff } from '../../lib/prompts/flight-companion-kickoff.js';

const BASE_URL = 'https://example.com';
const PROXY = `${BASE_URL}/api/proxy`;

describe('buildFlightCompanionKickoff', () => {
  test('opens with the flight companion persona (a friendly, up-to-speed colleague)', () => {
    const text = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    assert.ok(text.startsWith("# You're the Flight Companion"));
    assert.ok(/friendly, up-to-speed colleague/i.test(text));
  });

  test('is a re-personed sibling of autopilot — it watches, it does not drive', () => {
    const text = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    assert.ok(/not\b[\s\S]*driving\s+the work/i.test(text));
  });

  test('embeds the proxy base, the readWrite token framing, and the instructions pointer', () => {
    const text = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes(PROXY));
    assert.ok(text.includes('Authorization: Bearer'));
    assert.ok(/readWrite/.test(text));
    assert.ok(text.includes(`${PROXY}/instructions`));
  });

  test('carries the orient tool catalog', () => {
    const text = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes(`${PROXY}/stack?view=digest`));
    assert.ok(text.includes(`${PROXY}/brief/{id}`));
    assert.ok(text.includes(`${PROXY}/recap/{id}`));
    assert.ok(text.includes(`${PROXY}/issues/{id}`));
    assert.ok(text.includes(`${PROXY}/search`));
  });

  test('monitors via the dispatch feedback stream, NOT the observation endpoints', () => {
    const text = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    // The proxy-native monitor substrate (Constraint A).
    assert.ok(text.includes(`${PROXY}/dispatch?status=taken`));
    // LIN-2079 (PR #1146 review ledger A7): since `blocked` became a derived
    // wire status, `?status=taken` no longer returns runs parked on a human —
    // so the companion needs a SECOND labelled call or it goes blind to them.
    // This is the one doc surface of the six that already had a prompt-contract
    // guard; it simply was not extended when the sibling call landed. Without
    // this line a future prompt edit can drop the instruction with no test
    // failing, which is exactly what the `?status=taken` assertion above exists
    // to prevent for its own half.
    assert.ok(text.includes(`${PROXY}/dispatch?status=blocked`));
    assert.ok(text.includes(`${PROXY}/dispatch/{id}`));
    assert.ok(text.includes('feedback[]'));
    assert.ok(text.includes('[working]'));
    assert.ok(text.includes('[evidence]'));
    // Must explicitly steer AWAY from the browser-cookie observation routes.
    assert.ok(/cannot\b.*reach them|will 401/i.test(text));
    assert.ok(/\/api\/dashboard/.test(text));
    // And must NOT tell the session to hit an observation endpoint as a tool.
    assert.ok(!/GET\s+\S*\/api\/dashboard\/sessions/.test(text));
  });

  test('carries the act (user-gated) tool catalog including follow-ups', () => {
    const text = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes(`${PROXY}/recommend-and-dispatch`));
    assert.ok(text.includes(`${PROXY}/dispatch`));
    assert.ok(text.includes('followUpTo'));
  });

  test('has a friendly boot sequence: hello → orient → invite input → keep monitoring', () => {
    const text = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    assert.ok(/Say hello/i.test(text));
    assert.ok(/Orient/i.test(text));
    assert.ok(/Invite them in|welcome/i.test(text));
    assert.ok(/Keep monitoring/i.test(text));
    assert.ok(/think(ing)? out loud/i.test(text));
  });

  test('preserves the user-approval-before-dispatch gate as a prompt-only convention', () => {
    const text = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    assert.ok(/propose it.*wait for the human|wait for the go/i.test(text));
    assert.ok(/prompt-only/i.test(text));
    // Reads (GETs) explicitly need no approval; state changes (POSTs) do.
    assert.ok(/no\b.*approval/i.test(text));
    assert.ok(/explicit\b.*yes|say go/i.test(text));
  });

  test('ends with a trailing newline', () => {
    const text = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    assert.ok(text.endsWith('\n'));
  });
});
