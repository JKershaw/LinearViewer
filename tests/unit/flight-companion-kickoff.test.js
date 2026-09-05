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
import { readFileSync } from 'node:fs';
import { buildFlightCompanionKickoff } from '../../lib/prompts/flight-companion-kickoff.js';
import { buildCensusSeedText } from '../../routes/flight-companion.js';
import {
  buildFlightCompanionMessages, COMPANION_PERSONA, COMPANION_BRIEF_SECTIONS,
  COMPANION_FOSSIL_READOUT, COMPANION_READOUT_HEADINGS, formatCompanionClock, formatFossilThreshold,
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
    // LIN-2443 AC1: the status line carries a silent tick, never a bubble. That
    // concretisation is CHAT-ONLY — a pasted Claude Code session has no status
    // line, so asserting one to it would be a false fact about its own
    // environment offered as the reason to stay silent.
    assert.match(system.content, /status line already says/i);
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

describe('LIN-2618: the extraction must not cost the kickoff any instruction it had', () => {
  test('the gate is still concrete about which of THIS transport\'s calls it covers', () => {
    // The shared gate is transport-neutral ("anything that changes state"),
    // because the in-page chat has no verbs to name. The kickoff's old inline
    // gate DID name them, and a curl-driven session that has to infer which of
    // its own calls the rule covers is worse off than before the extraction.
    const text = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    assert.match(text, /every `GET`[\s\S]*reading/i);
    assert.match(text, /No approval needed/i);
    assert.match(text, /every `POST`[\s\S]*changes state/i);
    // The named POST routes specifically — the ones the catalog above offers.
    assert.ok(text.includes('/recommend-and-dispatch'));
    // ...and this concretisation belongs to THIS renderer, not the shared brief,
    // since the chat has no such verbs.
    assert.ok(!COMPANION_BRIEF_SECTIONS.join('\n').includes('`GET`'));
  });

  test('every substantive instruction the pre-extraction kickoff carried still has a home', () => {
    const text = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    // Spot-checked against the pre-LIN-2618 output: the persona's watch/narrate
    // framing, the boot sequence, the altitude rule, the propose-then-wait gate
    // and its prompt-only caveat, and the monitoring substrate.
    for (const claim of [
      /you \*\*watch\*\*/i,
      /narrate in plain\s+language/i,
      /read a colleague\s+would give over their shoulder/i,
      /propose it in plain language and wait/i,
      /prompt-only/i,
      /dispatch\?status=blocked/,
      /they will 401/i,
      /Say hello/i,
    ]) {
      assert.match(text, claim, `the kickoff lost: ${claim}`);
    }
  });
});

describe('LIN-2618: the shared/transport split is real, not just a word blacklist', () => {
  const kickoff = () => buildFlightCompanionKickoff({ baseUrl: BASE_URL });
  const chat = () => buildFlightCompanionMessages({
    history: [], message: 'hi', censusSeedText: 'CENSUS', turnKind: 'user-initiated',
  })[0].content;

  test('no shared section asserts a thing only ONE surface has', () => {
    // The earlier leak test blacklists six tokens, which cannot see semantic
    // transport-specificity. These are the three concrete facts that a pasted
    // Claude Code session cannot reach — it has no census (routes/proxy.js
    // serves none), no lanes, and no page — so a shared section stating any of
    // them as fact would be telling that session something false about its own
    // environment.
    const shared = [COMPANION_PERSONA, ...COMPANION_BRIEF_SECTIONS].join('\n');
    for (const [claim, why] of [
      [/status line/i, 'only the in-page chat has a status line'],
      [/\bcensus\b/i, 'only the in-page chat is handed a census'],
      [/census lanes|the lanes count/i, 'lanes are a census concept the kickoff never sees'],
      [/composer/i, 'the composer is a page element'],
      [/chat page/i, 'the kickoff is not a page'],
    ]) {
      assert.ok(!claim.test(shared), `shared brief must not assert: ${why}`);
    }
  });

  test('...and each surface still carries its own concretisation of those rules', () => {
    const c = chat();
    // The chat says the transport-specific parts the shared sections dropped.
    assert.match(c, /status line already says/i);
    assert.match(c, /\bcensus\b/i);
    assert.match(c, /composer below is the invitation/i);
    // The kickoff says its own, and NOT the chat's.
    const k = kickoff();
    assert.doesNotMatch(k, /status line/i);
    assert.doesNotMatch(k, /composer/i);
    assert.match(k, /every `GET`/i);
  });

  test('the fossil instruction is conditional, so a surface with no census does not go hunting', () => {
    // It must not order a session to obtain a count it cannot obtain — the
    // kickoff's own hard rule says the observation endpoints will 401, so a
    // session told to fetch one would either fabricate it or bounce off a 401.
    assert.match(COMPANION_FOSSIL_READOUT, /if — and only if — you are given/i);
    assert.match(COMPANION_FOSSIL_READOUT, /do not go looking for one and never estimate/i);
  });

  test('a waiting item is reported with what it is holding up (LIN-2027 fold-in)', () => {
    // Ticket item 6: waiting-on-a-human items carry critical-path context from
    // get_stack's blocking signals, so the human can order by consequence
    // rather than by age.
    for (const text of [kickoff(), chat()]) {
      assert.match(text, /Say what each one is holding up/i);
      assert.match(text, /blocking \/ critical-path signals/i);
      assert.match(text, /unblocks three others/i);
    }
  });
});

describe('LIN-2618: the "separate, older mechanism" claim is retired everywhere it was made', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

  test('no surviving source or doc still calls the kickoff a separate, older mechanism', () => {
    // Ticket item 7 / plan-review 2618-F3. The first pass fixed the two CLAUDE.md
    // entries and llms.txt's prose block and missed three more — including one
    // in the route file this change edits, ~100 lines above a new comment
    // asserting the opposite.
    for (const path of [
      '../../routes/flight-companion.js',
      '../../public/llms.txt',
      '../../CLAUDE.md',
      '../../lib/render-flight-companion.js',
    ]) {
      const src = read(path);
      assert.doesNotMatch(src, /SEPARATE, older/i, `${path} still calls the kickoff a separate, older mechanism`);
      assert.doesNotMatch(src, /separate, older kickoff/i, `${path} still calls the kickoff separate and older`);
    }
  });
});

describe('LIN-2618: the shared sections are shared by identity, not by resemblance', () => {
  test('neither renderer may extend the persona in place', () => {
    // `includes` alone would pass if one surface appended a sentence inside the
    // persona block, which is precisely the divergence this module exists to
    // prevent. Pin the block's boundaries: what follows the persona must be the
    // section delimiter, not more persona.
    const k = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    const c = buildFlightCompanionMessages({ history: [], censusSeedText: 'CENSUS' })[0].content;
    for (const [text, label] of [[k, 'kickoff'], [c, 'chat']]) {
      const at = text.indexOf(COMPANION_PERSONA);
      assert.ok(at > -1, `${label} must carry the persona`);
      const after = text.slice(at + COMPANION_PERSONA.length);
      assert.match(
        after.slice(0, 32), /^\n\n(---|Your job this session)/,
        `${label} appended to the persona instead of rendering it as-is`
      );
    }
  });

  test('every shared section is rendered whole, in both surfaces, in one piece', () => {
    const k = buildFlightCompanionKickoff({ baseUrl: BASE_URL });
    const c = buildFlightCompanionMessages({ history: [], censusSeedText: 'CENSUS' })[0].content;
    for (const section of COMPANION_BRIEF_SECTIONS) {
      for (const [text, label] of [[k, 'kickoff'], [c, 'chat']]) {
        // Exactly once — a section rendered twice is as wrong as one dropped.
        assert.strictEqual(
          text.split(section).length - 1, 1,
          `${label} must render "${section.split('\n')[0]}" exactly once`
        );
      }
    }
  });
});

describe('LIN-2618: the builder is defensive where a future caller will actually hit it', () => {
  test('a null clock reads as unknown, never as a confident 1970', () => {
    // `new Date(null)` is the EPOCH, not an Invalid Date, and the `= Date.now()`
    // default only covers `undefined`. LIN-2622's boot endpoint is the next
    // caller; a nullable clock there would have the model age every `since` it
    // is shown by ~56 years and report the whole fleet as fossilised.
    for (const bad of [null, undefined, NaN, 'nonsense', {}, [], true]) {
      const out = formatCompanionClock(bad);
      assert.doesNotMatch(out, /1970/, `a ${JSON.stringify(bad)} clock must not render 1970`);
      assert.doesNotMatch(out, /Invalid Date/);
    }
    assert.match(formatCompanionClock(null), /CURRENT TIME: unknown/);
    // A real clock still works, both shapes.
    const iso = '2026-09-05T12:00:00.000Z';
    assert.match(formatCompanionClock(Date.parse(iso)), /2026-09-05T12:00:00\.000Z/);
    assert.match(formatCompanionClock(new Date(iso)), /2026-09-05T12:00:00\.000Z/);
  });

  test('a sub-hour staleness threshold reads in minutes, never as "0h"', () => {
    // "rows older than 0h" is a vacuous claim inside a block the prompt calls
    // ground truth, and rounding 30m up to "1h" over-claims in the other
    // direction.
    assert.strictEqual(formatFossilThreshold(30 * 60000), '30m');
    assert.strictEqual(formatFossilThreshold(60000), '1m');
    assert.strictEqual(formatFossilThreshold(1), '1m');
    assert.strictEqual(formatFossilThreshold(90 * 60000), '2h');
    // The production value and the ordinary shapes are unchanged.
    assert.strictEqual(formatFossilThreshold(7 * 24 * 3600000), '7d');
    assert.strictEqual(formatFossilThreshold(6 * 3600000), '6h');
    assert.strictEqual(formatFossilThreshold(0), 'the staleness threshold');
  });

  test('an omitted history is an empty one, matching the signature\'s own promise', () => {
    // The `= {}` parameter default signals a tolerance the body did not have:
    // `buildFlightCompanionMessages()` threw on the history spread.
    assert.doesNotThrow(() => buildFlightCompanionMessages());
    const out = buildFlightCompanionMessages();
    assert.strictEqual(out.length, 2, 'system turn plus the stand-in user turn');
    assert.strictEqual(out[0].role, 'system');
    assert.strictEqual(out[1].role, 'user');
  });
});
