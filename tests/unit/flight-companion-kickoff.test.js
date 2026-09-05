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
import { buildCensusSeedText } from '../../routes/flight-companion.js';
import {
  buildFlightCompanionMessages, COMPANION_PERSONA, COMPANION_BRIEF_SECTIONS,
  COMPANION_FOSSIL_READOUT, COMPANION_READOUT_HEADINGS,
} from '../../lib/prompts/flight-companion-brief.js';

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

// ─── LIN-2618: one brief, two renderings ─────────────────────────────────────

describe('LIN-2618: one shared brief, rendered into both surfaces', () => {
  const censusDoc = {
    rev: 2272, stateHash: 'h',
    state: {
      lanes: { working: 17, silent: 313, blocked: 52, terminal: 2197, queued: 0, resolved: 3, unknown: 0 },
      attention: [{ loopId: 'l1', issue: 'LIN-2515', lane: 'blocked', stage: 'close-out', since: '2026-09-05T01:35:00.000Z' }],
      truncated: false, staleAttentionCount: 313, staleAttentionThresholdMs: 7 * 24 * 60 * 60 * 1000,
    },
  };
  const kickoff = () => buildFlightCompanionKickoff({ baseUrl: BASE_URL });
  const chat = () => buildFlightCompanionMessages({
    history: [], message: 'where are we?', censusSeedText: buildCensusSeedText(censusDoc),
    now: Date.parse('2026-09-05T12:00:00.000Z'), turnKind: 'user-initiated',
  })[0].content;

  test('the persona is defined ONCE and appears verbatim in both renders', () => {
    // The acceptance criterion, and the reason this module exists: editing the
    // copy in one renderer cannot pass, because both assert against the SAME
    // exported constant rather than against their own literal.
    assert.ok(kickoff().includes(COMPANION_PERSONA), 'kickoff must carry the shared persona');
    assert.ok(chat().includes(COMPANION_PERSONA), 'chat must carry the shared persona');
    // And it is genuinely substantial text, not a token that would match by luck.
    assert.ok(COMPANION_PERSONA.length > 300);
  });

  test('every shared section appears byte-identically in both renders', () => {
    const k = kickoff();
    const c = chat();
    assert.ok(COMPANION_BRIEF_SECTIONS.length >= 6, 'the brief is more than a persona');
    for (const section of COMPANION_BRIEF_SECTIONS) {
      const label = section.split('\n')[0];
      assert.ok(k.includes(section), `kickoff is missing, or has diverged from, "${label}"`);
      assert.ok(c.includes(section), `chat is missing, or has diverged from, "${label}"`);
    }
  });

  test('the fossil-row instruction is one of those shared sections, byte-identical across both', () => {
    // LIN-2619 ledger item 5 asks for this in BOTH renders. The pasted kickoff
    // reaches this workspace only through /api/proxy, which serves no census, so
    // what is shared is the INSTRUCTION and its format; the chat additionally
    // interpolates the live number into its census seed.
    assert.ok(kickoff().includes(COMPANION_FOSSIL_READOUT));
    assert.ok(chat().includes(COMPANION_FOSSIL_READOUT));
    assert.match(COMPANION_FOSSIL_READOUT, /older than 7d, not listed/);
    // ...and the chat's rendered line follows that same shape, from the census.
    assert.ok(chat().includes('+313 silent / blocked rows older than 7d, not listed'));
  });

  test('the chat system turn carries the clock, the turn kind and the readout headings in order', () => {
    const c = chat();
    assert.match(c, /CURRENT TIME: 2026-09-05T12:00:00\.000Z/);
    assert.match(c, /the human just asked you something/i);
    assert.match(c, /mandatory headline block/i);

    let cursor = -1;
    for (const heading of COMPANION_READOUT_HEADINGS) {
      const at = c.indexOf(heading);
      assert.ok(at > -1, `readout heading missing: ${heading}`);
      assert.ok(at > cursor, `readout heading out of order: ${heading}`);
      cursor = at;
    }
  });

  test('an auto-wake turn is told it is one, and told to stay quiet', () => {
    const out = buildFlightCompanionMessages({
      history: [], message: null, censusSeedText: 'CENSUS', turnKind: 'auto-wake',
      now: Date.parse('2026-09-05T12:00:00.000Z'),
    });
    const system = out[0];
    const turn = out[out.length - 1];
    assert.match(system.content, /a check-in tick — nobody typed/i);
    assert.match(system.content, /say nothing at all/i);
    // LIN-2443 AC1: the status line carries a silent tick, never a bubble.
    assert.match(system.content, /status line already carries it/i);
    assert.match(turn.content, /No new message from the human this tick/);
  });

  test('the playbook slot is omitted when empty and rendered when filled (LIN-2625)', () => {
    const without = buildFlightCompanionMessages({ history: [], censusSeedText: 'CENSUS' })[0].content;
    assert.doesNotMatch(without, /## Playbook/);
    const with_ = buildFlightCompanionMessages({
      history: [], censusSeedText: 'CENSUS', playbook: 'Prefer the smallest reversible step.',
    })[0].content;
    assert.match(with_, /## Playbook/);
    assert.ok(with_.includes('Prefer the smallest reversible step.'));
    // Whitespace-only is not a playbook.
    assert.doesNotMatch(
      buildFlightCompanionMessages({ history: [], censusSeedText: 'C', playbook: '   ' })[0].content,
      /## Playbook/
    );
  });

  test('history and the new turn ride after the system message, unchanged', () => {
    const history = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
    const out = buildFlightCompanionMessages({ history, message: 'and now?', censusSeedText: 'CENSUS' });
    assert.strictEqual(out.length, 4);
    assert.strictEqual(out[0].role, 'system');
    assert.deepStrictEqual(out.slice(1, 3), history);
    assert.deepStrictEqual(out[3], { role: 'user', content: 'and now?' });
  });

  test('transport-specific instruction stays OUT of the shared sections', () => {
    // The kickoff's curl catalog and 401 warning are meaningless to a surface
    // with real tool-calling; the chat's tool names are meaningless to a pasted
    // session with none. Leaking either would make the byte-identity test above
    // a lie by construction.
    const shared = [COMPANION_PERSONA, ...COMPANION_BRIEF_SECTIONS].join('\n');
    for (const leak of ['/api/proxy', 'curl', '401', 'list_active_sessions', 'send_follow_up', 'Bearer']) {
      assert.ok(!shared.includes(leak), `shared brief must not mention "${leak}"`);
    }
    // ...and each renderer really does still carry its own.
    assert.ok(kickoff().includes('/api/proxy'));
    assert.ok(chat().includes('list_active_sessions'));
  });

  test('a clock that cannot be resolved degrades rather than rendering an Invalid Date', () => {
    const c = buildFlightCompanionMessages({ history: [], censusSeedText: 'CENSUS', now: NaN })[0].content;
    assert.match(c, /CURRENT TIME: unknown/);
    assert.doesNotMatch(c, /Invalid Date/);
  });
});
