/**
 * Census guard for CLAUDE.md's scheduler.js map entry (LIN-2572, P0.4 of the
 * LIN-2569 operating-model path).
 *
 * The entry ends with a hand-maintained roster sentence — "N jobs registered
 * today: `job` (interval/lease), ..." — and both halves of it drifted once
 * already: LIN-2384 added `pricing-conformance-sweep` to server.js and the
 * sentence still said "Three jobs" naming only three, exactly the class
 * LIN-2302 Instance 6 measured for the prompt-template count (14 -> 16 -> 17
 * inside one ticket's lifetime). This guard applies that block's remedy to
 * this claim: derive the truth from source, never pin a literal, so the NEXT
 * registration (LIN-2579's P2.2 invariant-measure job is planned to make it
 * five) fails here rather than shipping another drift instance.
 *
 * House patterns composed:
 *   - server.js is never imported by the unit suite (it boots a real app on
 *     import), so the roster is a source census — see
 *     tests/unit/observer-pass-server-wiring-census.test.js;
 *   - the doc side reads CLAUDE.md and derives, like the current-state-docs
 *     count guard in tests/unit/prompt-templates.test.js.
 *
 * Deliberate scope boundary: this guards the scheduler.js entry's roster
 * sentence ONLY. Dated point-in-time artifacts (docs/reviews/*) may carry
 * their own counts by design — freezing a historical report is not drift.
 *
 * Run with: node --test tests/unit/claude-md-scheduler-jobs-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const serverSrc = readFileSync(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');
const claudeSrc = readFileSync(fileURLToPath(new URL('../../CLAUDE.md', import.meta.url)), 'utf8');

// The registered-job roster, derived from the scheduler.register sites in
// server.js (every site is `scheduler.register({ name: '<job>', ... })`).
// Never edited by hand: adding a registration site changes this list here.
const registeredNames =
  [...serverSrc.matchAll(/scheduler\.register\(\{\s*name:\s*'([^']+)'/g)].map((m) => m[1]);

// The documented roster, parsed out of the scheduler.js map entry's sentence.
const entryLine = claudeSrc.match(/^ {2}scheduler\.js +.*$/m)?.[0] ?? '';
const rosterMatch = entryLine.match(/(\w+) jobs registered today: (.+)$/);
const documentedNames = rosterMatch ? [...rosterMatch[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [];

const WORD_TO_NUMBER = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

describe('CLAUDE.md scheduler entry matches the scheduler.register sites in server.js (LIN-2572)', () => {
  test('the census found the registration sites (guard against a parser-regex drift)', () => {
    assert.ok(registeredNames.length >= 4,
      `expected at least the four known sites in server.js, found: ${registeredNames.join(', ') || 'none'} — if this fails, server.js's registration shape changed; update the census regex, not the assertion`);
  });

  test('the scheduler.js map entry carries a "N jobs registered today" roster sentence', () => {
    assert.ok(rosterMatch,
      'CLAUDE.md\'s scheduler.js entry must still carry its "<N> jobs registered today: ..." roster sentence');
  });

  test('every job registered in server.js is named in the documented roster', () => {
    const missing = registeredNames.filter((name) => !documentedNames.includes(name));
    assert.deepEqual(missing, [],
      `CLAUDE.md's scheduler entry omits registered job(s): ${missing.join(', ')} — server.js registers ${registeredNames.length}: ${registeredNames.join(', ')}`);
  });

  test('the documented roster names no job that server.js does not register', () => {
    const ghosts = documentedNames.filter((name) => !registeredNames.includes(name));
    assert.deepEqual(ghosts, [],
      `CLAUDE.md's scheduler entry names unregistered job(s): ${ghosts.join(', ')} — server.js registers: ${registeredNames.join(', ')}`);
  });

  test('the count word matches the actual number of registered jobs', () => {
    const claimed = WORD_TO_NUMBER[rosterMatch?.[1]?.toLowerCase()];
    assert.ok(claimed !== undefined,
      `"${rosterMatch?.[1]}" is not a count word this guard parses (one..ten) — extend WORD_TO_NUMBER rather than rewording the sentence`);
    assert.strictEqual(claimed, registeredNames.length,
      `CLAUDE.md says ${rosterMatch[1]} jobs are registered; server.js registers ${registeredNames.length}: ${registeredNames.join(', ')}`);
  });
});
