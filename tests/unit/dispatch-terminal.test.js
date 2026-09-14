/**
 * Unit tests for lib/dispatch-terminal.js (LIN-509 / LIN-400).
 *
 * Run with: node --test tests/unit/dispatch-terminal.test.js
 *
 * The terminal-marker seam shared by the proxy watch endpoints and the dashboard
 * Loop feed: a "[done]"/"[failed]"/"[aborted]" prefix on the LAST matching
 * feedback entry is the truthful completion signal while the queue status stays
 * 'taken'.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { findTerminalFeedback, deriveTerminalStatus, deriveLifecycleStatus, deriveCompletedAt, isWakeEvent, findWakeEvent, harvestAbortedTargets, feedbackWithHarvestedAbort, mergeLineageFeedback, isLaunchTimeFailure } from '../../lib/dispatch-terminal.js';

describe('deriveTerminalStatus', () => {
  test('null when feedback is missing or not an array', () => {
    assert.equal(deriveTerminalStatus(undefined), null);
    assert.equal(deriveTerminalStatus(null), null);
    assert.equal(deriveTerminalStatus('nope'), null);
    assert.equal(deriveTerminalStatus([]), null);
  });

  test('null when no entry carries a terminal marker', () => {
    assert.equal(deriveTerminalStatus([{ message: 'started work' }, { message: 'pushed a branch' }]), null);
  });

  test('maps [done]/[complete] → done, [failed]/[aborted] → failed/aborted', () => {
    assert.equal(deriveTerminalStatus([{ message: '[done] finished in 40s' }]), 'done');
    assert.equal(deriveTerminalStatus([{ message: '[complete] all green' }]), 'done');
    assert.equal(deriveTerminalStatus([{ message: '[failed] tests red' }]), 'failed');
    assert.equal(deriveTerminalStatus([{ message: '[aborted] gave up' }]), 'aborted');
  });

  test('case-insensitive and tolerant of leading whitespace', () => {
    assert.equal(deriveTerminalStatus([{ message: '  [DONE] ok' }]), 'done');
  });

  test('returns the LAST terminal marker when several exist', () => {
    const status = deriveTerminalStatus([
      { message: '[failed] first attempt' },
      { message: '[done] retry succeeded' }
    ]);
    assert.equal(status, 'done');
  });

  test('a non-prefix mention of [done] does not count', () => {
    assert.equal(deriveTerminalStatus([{ message: 'note: the marker is [done] when finished' }]), null);
  });
});

describe('deriveCompletedAt', () => {
  test('returns the timestamp of the terminal entry', () => {
    const ts = '2026-06-15T12:00:00.000Z';
    assert.equal(deriveCompletedAt([{ message: 'working' }, { message: '[done] ok', timestamp: ts }]), ts);
  });
  test('null when there is no terminal marker', () => {
    assert.equal(deriveCompletedAt([{ message: 'working' }]), null);
  });
});

describe('findTerminalFeedback', () => {
  test('returns the matching entry and its status', () => {
    const entry = { message: '[failed] boom', timestamp: 't' };
    const res = findTerminalFeedback([{ message: 'x' }, entry]);
    assert.deepEqual(res, { entry, status: 'failed' });
  });
});

/**
 * Shared abort terminal-attribution rule (LIN-1257 A2 / LIN-1261 F1/F2) — the
 * harvest half (`harvestAbortedTargets`) and the guarded-append half
 * (`feedbackWithHarvestedAbort`) both pipeline reconstruction and the proxy read
 * boundary consume, so the rule has ONE definition.
 */
describe('harvestAbortedTargets', () => {
  test('maps each abort row to its own [aborted] entry keyed by abortTo', () => {
    const abortEntry = { message: '[aborted] cancelled', timestamp: 't1' };
    const map = harvestAbortedTargets([
      { id: 'a1', abort: true, abortTo: 'tgt-1', feedback: [abortEntry] },
      { id: 'tgt-1', feedback: [{ message: '[working] running' }] }
    ]);
    assert.strictEqual(map.size, 1);
    assert.deepStrictEqual(map.get('tgt-1'), abortEntry);
  });

  test('ignores non-abort rows, abort rows without abortTo, and [skipped] refusals', () => {
    const map = harvestAbortedTargets([
      { id: 'a1', abort: false, abortTo: 'x', feedback: [{ message: '[aborted] x', timestamp: 't' }] },
      { id: 'a2', abort: true, feedback: [{ message: '[aborted] no target', timestamp: 't' }] },
      { id: 'a3', abort: true, abortTo: 'y', feedback: [{ message: '[skipped] human-continued session', timestamp: 't' }] }
    ]);
    assert.strictEqual(map.size, 0);
  });

  test('tolerates non-array input', () => {
    assert.strictEqual(harvestAbortedTargets(undefined).size, 0);
    assert.strictEqual(harvestAbortedTargets(null).size, 0);
  });
});

describe('feedbackWithHarvestedAbort (F1 guard)', () => {
  const abort = (ts) => ({ message: '[aborted] cancelled', timestamp: ts });

  test('no abort entry → returns the same array reference unchanged', () => {
    const fb = [{ message: '[working] running', timestamp: 't' }];
    assert.strictEqual(feedbackWithHarvestedAbort(fb, undefined), fb);
    assert.strictEqual(feedbackWithHarvestedAbort(fb, null), fb);
  });

  test('no pre-existing terminal → appends the abort (original A2 attribution)', () => {
    const fb = [{ message: '[working] running', timestamp: '2026-06-22T11:00:00.000Z' }];
    const out = feedbackWithHarvestedAbort(fb, abort('2026-06-22T11:30:00.000Z'));
    assert.strictEqual(deriveTerminalStatus(out), 'aborted');
    assert.strictEqual(deriveCompletedAt(out), '2026-06-22T11:30:00.000Z');
    assert.notStrictEqual(out, fb, 'a new array is returned (non-mutating append)');
    assert.strictEqual(fb.length, 1, 'the input array is not mutated');
  });

  test('EARLIER abort does NOT override a later [done] or rewind completedAt', () => {
    const fb = [{ message: '[done] finished', timestamp: '2026-06-22T12:00:00.000Z' }];
    const out = feedbackWithHarvestedAbort(fb, abort('2026-06-22T11:30:00.000Z'));
    assert.strictEqual(out, fb, 'the same array is returned (no append)');
    assert.strictEqual(deriveTerminalStatus(out), 'done');
    assert.strictEqual(deriveCompletedAt(out), '2026-06-22T12:00:00.000Z');
  });

  test('EQUAL-time abort does not override the existing terminal (strictly-later only)', () => {
    const ts = '2026-06-22T12:00:00.000Z';
    const fb = [{ message: '[done] finished', timestamp: ts }];
    assert.strictEqual(feedbackWithHarvestedAbort(fb, abort(ts)), fb);
  });

  test('STRICTLY-later abort wins (forward move, not a rewind)', () => {
    const fb = [{ message: '[done] finished', timestamp: '2026-06-22T12:00:00.000Z' }];
    const out = feedbackWithHarvestedAbort(fb, abort('2026-06-22T12:30:00.000Z'));
    assert.strictEqual(deriveTerminalStatus(out), 'aborted');
    assert.strictEqual(deriveCompletedAt(out), '2026-06-22T12:30:00.000Z');
  });

  test('unparseable timestamps on either side → keep the pre-existing terminal (never rewind on unknown order)', () => {
    const fb = [{ message: '[done] finished', timestamp: '2026-06-22T12:00:00.000Z' }];
    assert.strictEqual(feedbackWithHarvestedAbort(fb, abort(undefined)), fb);
    const fbNoTs = [{ message: '[done] finished' }];
    assert.strictEqual(feedbackWithHarvestedAbort(fbNoTs, abort('2026-06-22T12:30:00.000Z')), fbNoTs);
  });
});

/**
 * Wake-event predicate (LIN-826) — a deliberate SUPERSET of the terminal
 * markers that additionally counts [blocked], consumed only by the up-chain
 * wake auto-enqueue. Kept separate from the terminal regex so [blocked] never
 * leaks into completion/telemetry/KPI semantics.
 */
describe('isWakeEvent', () => {
  test('[done]/[complete]/[failed]/[aborted]/[blocked]/[pending] are all wake events', () => {
    assert.equal(isWakeEvent('[done] finished in 40s'), true);
    assert.equal(isWakeEvent('[complete] all green'), true);
    assert.equal(isWakeEvent('[failed] tests red'), true);
    assert.equal(isWakeEvent('[aborted] gave up'), true);
    assert.equal(isWakeEvent('[blocked] waiting on a human'), true);
    assert.equal(isWakeEvent('[pending] beat 1 done, beats 2-4 remain'), true);
  });

  test('non-terminal markers and empty input are not wake events', () => {
    assert.equal(isWakeEvent('[working] still going'), false);
    assert.equal(isWakeEvent('[stalled?] no output for a while'), false);
    assert.equal(isWakeEvent(''), false);
    assert.equal(isWakeEvent(undefined), false);
    assert.equal(isWakeEvent(null), false);
  });

  test('case-insensitive and tolerant of leading whitespace', () => {
    assert.equal(isWakeEvent('  [BLOCKED] ok'), true);
  });

  test('a non-prefix mention does not count', () => {
    assert.equal(isWakeEvent('note: a worker reports [blocked] when stuck'), false);
  });

  // SPLIT-PROOF: [blocked] wakes a parent, but it is NOT terminal — the new
  // predicate must not leak into terminal/telemetry/KPI semantics.
  test('[blocked] is a wake event WHILE findTerminalFeedback stays blind to it', () => {
    const feedback = [{ message: '[blocked] cannot proceed without creds' }];
    assert.equal(isWakeEvent(feedback[0].message), true);
    assert.equal(findTerminalFeedback(feedback), null);
    assert.equal(deriveTerminalStatus(feedback), null);
  });

  // SPLIT-PROOF (LIN-843): [pending] is a PAUSE — it wakes a parent but must
  // never count as completion. The whole point of the split is that telemetry/
  // KPI/close-out never see a pause as a finish.
  test('[pending] is a wake event WHILE findTerminalFeedback / deriveCompletedAt stay blind to it', () => {
    const feedback = [{ message: '[pending] my part is done, the task is not', timestamp: 't' }];
    assert.equal(isWakeEvent(feedback[0].message), true);
    assert.equal(findTerminalFeedback(feedback), null);
    assert.equal(deriveTerminalStatus(feedback), null);
    assert.equal(deriveCompletedAt(feedback), null, 'a pause must not stamp a completion time');
  });
});

// LIN-2423: a lane-marker relay now posts `[ticket] LIN-#### <state>` lines as their own
// dispatch feedback entries — verified here (not just asserted in review prose) that the new
// producer traffic can never be misread as a dispatch-level terminal/wake signal. Both regexes
// anchor on `\[(done|complete|failed|...)\]`/`\[(done|complete|failed|...|blocked|pending)\]`
// immediately after optional whitespace, and `[ticket]` is neither alternative.
describe('LIN-2423: [ticket] marker lines never match the terminal/wake vocabulary', () => {
  test('[ticket] LIN-900 done matches neither TERMINAL_FEEDBACK_REGEX nor WAKE_FEEDBACK_REGEX', () => {
    const feedback = [{ message: '[ticket] LIN-900 done', timestamp: 't' }];
    assert.equal(deriveTerminalStatus(feedback), null, 'must not be read as the dispatch\'s own terminal status');
    assert.equal(findTerminalFeedback(feedback), null);
    assert.equal(isWakeEvent(feedback[0].message), false, 'must not wake a parent as if it were a dispatch-level event');
  });

  test('every documented marker state ([ticket] LIN-XXXX started/done/blocked/refused/dissolved/trimmed) is inert to both regexes', () => {
    for (const state of ['started', 'done', 'blocked', 'refused', 'dissolved', 'trimmed']) {
      const message = `[ticket] LIN-2423 ${state}`;
      assert.equal(deriveTerminalStatus([{ message }]), null, `"${message}" must not derive a terminal status`);
      assert.equal(isWakeEvent(message), false, `"${message}" must not be a wake event`);
    }
  });
});

describe('findWakeEvent', () => {
  test('null when feedback is missing or not an array', () => {
    assert.equal(findWakeEvent(undefined), null);
    assert.equal(findWakeEvent(null), null);
    assert.equal(findWakeEvent('nope'), null);
    assert.equal(findWakeEvent([]), null);
  });

  test('null when no entry carries a wake marker', () => {
    assert.equal(findWakeEvent([{ message: 'started work' }, { message: '[working] still going' }]), null);
  });

  test('returns the matching entry and its lowercased marker', () => {
    const entry = { message: '[BLOCKED] stuck', timestamp: 't' };
    assert.deepEqual(findWakeEvent([{ message: 'x' }, entry]), { entry, marker: 'blocked' });
  });

  test('returns the LAST wake marker when several exist', () => {
    const last = { message: '[done] retry succeeded' };
    assert.deepEqual(
      findWakeEvent([{ message: '[failed] first attempt' }, last]),
      { entry: last, marker: 'done' }
    );
  });
});

/**
 * LIN-2079 S1 — `blocked` as a first-class READ-TIME lifecycle status.
 *
 * A row whose runner posted `[blocked]` (alive, parked on a human) has no
 * terminal marker, so it fell back to stored `taken` — indistinguishable on the
 * wire from a live run and from a hard-stop tombstone. This derives it instead.
 * Terminal-first is the load-bearing ordering: it is what stops an earlier
 * `[blocked]` from overriding a later genuine terminal (and, at the call sites,
 * from rewinding `completedAt`). `[pending]` is deliberately NOT mapped — it is
 * a pause with its own AWAITING_EXTERNAL → FAILED failsafe on the consumer.
 */
describe('deriveLifecycleStatus (LIN-2079)', () => {
  test('null when feedback is missing, not an array, or carries no marker', () => {
    assert.equal(deriveLifecycleStatus(undefined), null);
    assert.equal(deriveLifecycleStatus(null), null);
    assert.equal(deriveLifecycleStatus('nope'), null);
    assert.equal(deriveLifecycleStatus([]), null);
    assert.equal(deriveLifecycleStatus([{ message: '[working] still going' }]), null);
  });

  test('a [blocked]-only lineage derives "blocked"', () => {
    assert.equal(deriveLifecycleStatus([{ message: '[blocked] needs a human decision' }]), 'blocked');
  });

  test('case-insensitive and whitespace-tolerant, same as the terminal scan', () => {
    assert.equal(deriveLifecycleStatus([{ message: '  [BLOCKED] waiting on John' }]), 'blocked');
  });

  test('still returns the terminal status when one exists', () => {
    assert.equal(deriveLifecycleStatus([{ message: '[done] finished' }]), 'done');
    assert.equal(deriveLifecycleStatus([{ message: '[failed] tests red' }]), 'failed');
    assert.equal(deriveLifecycleStatus([{ message: '[aborted] cancelled' }]), 'aborted');
    assert.equal(deriveLifecycleStatus([{ message: '[skipped] human-continued session' }]), 'skipped');
  });

  // ORDERING, both directions. The second case is the one that breaks the
  // moment anyone refactors this to check wake events before terminals.
  test('terminal wins over blocked in BOTH orderings', () => {
    assert.equal(deriveLifecycleStatus([
      { message: '[blocked] waiting on creds', timestamp: '2026-08-15T10:00:00.000Z' },
      { message: '[done] unblocked and finished', timestamp: '2026-08-15T11:00:00.000Z' }
    ]), 'done', 'a later terminal must win');
    assert.equal(deriveLifecycleStatus([
      { message: '[done] finished', timestamp: '2026-08-15T10:00:00.000Z' },
      { message: '[blocked] re-blocked afterwards', timestamp: '2026-08-15T11:00:00.000Z' }
    ]), 'done', 'terminal-first: a LATER [blocked] does not un-finish a done run');
  });

  test('[pending] is deliberately NOT mapped — it stays null, exactly as today', () => {
    assert.equal(deriveLifecycleStatus([{ message: '[pending] my part is done, the task is not' }]), null);
  });

  test('the LAST wake event decides: an earlier [blocked] followed by [pending] is not blocked', () => {
    assert.equal(deriveLifecycleStatus([
      { message: '[blocked] stuck' },
      { message: '[pending] resumed and paused at a boundary' }
    ]), null);
  });

  test('never stamps a completion time — deriveCompletedAt stays blind to [blocked]', () => {
    const feedback = [{ message: '[blocked] parked', timestamp: '2026-08-15T10:00:00.000Z' }];
    assert.equal(deriveLifecycleStatus(feedback), 'blocked');
    assert.equal(deriveCompletedAt(feedback), null, 'a parked run has not completed');
  });

  // LIN-2123 / LIN-2268: a session unblocked and resumed posts Simple
  // Dispatcher's own one-time "[working] Session resumed. ..." marker
  // (hook.js, NOT dispatcher.js's own router-level "[working] Resumed
  // session ..." post — see RESUME_MARKER_REGEX's docstring in
  // lib/dispatch-terminal.js for why that distinction is load-bearing) —
  // recognized here, in addition to the wake-event scan, so the derivation
  // stops being permanently sticky on [blocked] once that specific marker
  // appears later in the array.
  describe('resume after [blocked] (LIN-2123 / LIN-2268)', () => {
    test('a resume marker after [blocked] clears the derived status to null', () => {
      assert.equal(deriveLifecycleStatus([
        { message: '[blocked] needs a human decision' },
        { message: '[working] Session resumed. Executing follow-up...' },
      ]), null);
    });

    test('the stall-failsafe refire wording also clears — harmless, since that path never reaches a [blocked] session', () => {
      assert.equal(deriveLifecycleStatus([
        { message: '[blocked] needs a human decision' },
        { message: '[working] Session resumed. Re-confirming completion state...' },
      ]), null);
    });

    test('the pinned regression case still holds: plain [working] heartbeats (no resume text) do NOT clear [blocked]', () => {
      assert.equal(deriveLifecycleStatus([
        { message: '[blocked] needs a human decision' },
        { message: '[working] 2 tools/5s · alive' },
        { message: '[working] 3 tools/8s · alive' },
      ]), 'blocked');
    });

    test('a LATER [blocked] after a resume marker wins — re-blocked stays blocked', () => {
      assert.equal(deriveLifecycleStatus([
        { message: '[blocked] first block' },
        { message: '[working] Session resumed. Executing follow-up...' },
        { message: '[blocked] blocked again' },
      ]), 'blocked');
    });

    test('a resume marker with no prior [blocked] at all changes nothing — still null', () => {
      assert.equal(deriveLifecycleStatus([
        { message: '[working] Session resumed. Executing follow-up...' },
      ]), null);
    });

    test('case-insensitive and whitespace-tolerant, same discipline as the terminal/wake scans', () => {
      assert.equal(deriveLifecycleStatus([
        { message: '[blocked] needs a human decision' },
        { message: '  [WORKING] session resumed. Executing follow-up...' },
      ]), null);
    });

    test('terminal still wins over everything, including a resume marker', () => {
      assert.equal(deriveLifecycleStatus([
        { message: '[blocked] needs a human decision' },
        { message: '[working] Session resumed. Executing follow-up...' },
        { message: '[done] finished' },
      ]), 'done');
    });
  });

  // LIN-2268: the marker-shape-only tests above are exactly what LIN-2123's
  // PR #1199 already had — and its regex still passed every one of them
  // while being a production no-op, because none of them exercised the
  // REAL production composition: the ORIGINAL (non-followUpTo) dispatch's
  // own feedback merged, via mergeLineageFeedback + rootItemId, with the
  // follow-up dispatch row that actually carries the resume. This block
  // drives deriveLifecycleStatus from THAT composition — routes/proxy.js's
  // own read path — so a marker that looks right in isolation but never
  // reaches the anchor row (LIN-2123's original defect) fails here even
  // though it would have passed every test above.
  describe('resume after [blocked], driven from a real (non-followUpTo) dispatch composition (LIN-2268)', () => {
    const SINCE = '2026-08-20T00:00:00.000Z';
    const ANCHOR = 'root-1';

    test('hook.js\'s resume marker, posted with rootItemId threaded (its real production shape), clears [blocked] on the anchor row', () => {
      // The ORIGINAL item — dispatched without followUpTo — parked [blocked].
      const anchorOwnFeedback = [
        { message: '[blocked] needs a human decision', timestamp: '2026-08-20T01:00:00.000Z', rootItemId: ANCHOR }
      ];
      // A follow-up dispatch (item.followUpTo = ANCHOR) resumed the session.
      // hook.js's Stop-hook choke point threads rootItemId = session.rootItemId
      // unconditionally (see RESUME_MARKER_REGEX's docstring) — this is that
      // real shape, not a hand-picked convenience.
      const followUpRow = {
        feedback: [
          { message: '[working] Session resumed. Executing follow-up...', timestamp: '2026-08-20T02:00:00.000Z', rootItemId: ANCHOR }
        ]
      };
      const merged = mergeLineageFeedback(anchorOwnFeedback, [followUpRow], ANCHOR, SINCE);
      assert.equal(deriveLifecycleStatus(merged), null, 'the anchor row must stop reporting blocked once the resume merges in');
    });

    test('regression pin: dispatcher.js\'s own router-level resume post — real production shape, rootItemId omitted — never reaches the anchor row and leaves it stuck [blocked]', () => {
      // This is dispatcher.js's ACTUAL post at its follow-up-resume site
      // (`feedback(item.id, config.token, { message: ... })`, no rootItemId) —
      // the exact defect LIN-2268 found. It is filtered out by
      // mergeLineageFeedback's `entry.rootItemId === anchor` guard, same as
      // in real production, so the anchor row stays stuck on [blocked].
      const anchorOwnFeedback = [
        { message: '[blocked] needs a human decision', timestamp: '2026-08-20T01:00:00.000Z', rootItemId: ANCHOR }
      ];
      const followUpRow = {
        feedback: [
          { message: '[working] Resumed session abc12345 (window: w1)', timestamp: '2026-08-20T02:00:00.000Z' /* no rootItemId — the bug */ }
        ]
      };
      const merged = mergeLineageFeedback(anchorOwnFeedback, [followUpRow], ANCHOR, SINCE);
      assert.equal(deriveLifecycleStatus(merged), 'blocked', 'a rootItemId-less post never joins the anchor lineage, so the row is stuck exactly as LIN-2268 found');
    });
  });

  // LIN-2333: dispatcher.js's three resume-FAILURE markers (no-transcript, unmappable-model,
  // resume-launch-failed) omitted rootItemId identically to LIN-2268's [working] resume post —
  // same defect class, on the failure paths instead of the success path. The fix threads
  // rootItemId when the target's pre-attempt phase was parked (BLOCKED/AWAITING_EXTERNAL). This
  // is the mandatory consumer pin (plan-review F1): it drives deriveLifecycleStatus from the REAL
  // mergeLineageFeedback/deriveLifecycleStatus exports over the real production message shapes,
  // not the SD-side mirror, so a drift in this file's regex/derivation/merge logic fails here
  // independently of the SD-side tests.
  describe('resume-failure markers threaded with rootItemId on a parked anchor (LIN-2333)', () => {
    const SINCE = '2026-08-20T00:00:00.000Z';
    const ANCHOR = 'root-1';

    function anchorParkedFeedback() {
      return [
        { message: '[blocked] needs a human decision', timestamp: '2026-08-20T01:00:00.000Z', rootItemId: ANCHOR }
      ];
    }

    test('no-transcript [failed] (dispatcher.js:667), rootItemId threaded on a parked target, derives failed on the anchor', () => {
      const followUpRow = {
        feedback: [
          {
            message: '[failed] Cannot resume session sess1234: its transcript was never flushed to disk, so there is no conversation to resume.',
            timestamp: '2026-08-20T02:00:00.000Z',
            kind: 'status',
            rootItemId: ANCHOR
          }
        ]
      };
      const merged = mergeLineageFeedback(anchorParkedFeedback(), [followUpRow], ANCHOR, SINCE);
      assert.equal(deriveLifecycleStatus(merged), 'failed');
    });

    test('unmappable-model [failed] (dispatcher.js:687), rootItemId threaded on a parked target, derives failed on the anchor', () => {
      const followUpRow = {
        feedback: [
          {
            message: '[failed] Cannot resume session sess1234: opencode cannot run claude-3-x. Fix the workspace/dispatch routing so the model matches the harness — SD will not silently substitute one.',
            timestamp: '2026-08-20T02:00:00.000Z',
            kind: 'status',
            rootItemId: ANCHOR
          }
        ]
      };
      const merged = mergeLineageFeedback(anchorParkedFeedback(), [followUpRow], ANCHOR, SINCE);
      assert.equal(deriveLifecycleStatus(merged), 'failed');
    });

    test('resume-launch-failed [failed] (dispatcher.js:855), rootItemId threaded on a parked target, derives failed on the anchor', () => {
      const followUpRow = {
        feedback: [
          {
            message: '[failed] Failed to resume iTerm session: boom',
            timestamp: '2026-08-20T02:00:00.000Z',
            kind: 'status',
            rootItemId: ANCHOR
          }
        ]
      };
      const merged = mergeLineageFeedback(anchorParkedFeedback(), [followUpRow], ANCHOR, SINCE);
      assert.equal(deriveLifecycleStatus(merged), 'failed');
    });

    test('negative control: the SAME resume-launch-failed marker, unanchored (as dispatcher.js posts when the target was already terminal — non-parked, non-forced; an unconditional post here would falsely flip an honest terminal, LIN-2366), never joins the anchor lineage', () => {
      const followUpRow = {
        feedback: [
          { message: '[failed] Failed to resume iTerm session: boom', timestamp: '2026-08-20T02:00:00.000Z', kind: 'status' /* no rootItemId — already-terminal target. LIN-2366: a FORCED (active) target now threads rootItemId too, since the kill-first has already killed its reporter — this negative control now covers only the terminal population. */ }
        ]
      };
      const merged = mergeLineageFeedback(anchorParkedFeedback(), [followUpRow], ANCHOR, SINCE);
      assert.equal(deriveLifecycleStatus(merged), 'blocked', 'unanchored feedback is filtered out by mergeLineageFeedback, so the anchor stays on its own last marker');
    });
  });
});

/**
 * LIN-2872 — the launch-time-failure predicate the duplicate-dispatch guard
 * uses to exempt a prior that died before any work started. The exemption must
 * be EXACT: a terminal `[failed]` with no REAL work-started marker is a
 * launch-time failure (not a duplicate risk); anything else keeps blocking.
 * The executor's `[working] Session launched …` beat is a launch ANNOUNCEMENT
 * (posted the instant the terminal window opens, before any tool runs) and does
 * NOT count as work (LIN-2872 review F1); every other `[working]`/`[working · cat]`
 * heartbeat does (review F2).
 */
describe('isLaunchTimeFailure (LIN-2872)', () => {
  test('true for the launch-failure shape: terminal [failed], no work-started marker anywhere', () => {
    assert.equal(isLaunchTimeFailure([
      { message: '[failed] opencode server never became ready within 20000ms' }
    ]), true);
    assert.equal(isLaunchTimeFailure([
      { message: '[failed] opencode HTTP 500 on the first message' }
    ]), true);
    // A runner detail line before the terminal marker does not count as work.
    assert.equal(isLaunchTimeFailure([
      { message: 'claiming item' },
      { message: '[failed] Failed to launch iTerm session: boom' }
    ]), true);
  });

  // LIN-2872 review F1: the executor posts `[working] Session launched ...` the
  // instant the terminal window opens (simple-dispatcher/executors.js:711) — BEFORE
  // the harness has run a single message. Every opencode launch-time failure carries
  // this beat, so "any [working] marker = work started" misses the ticket's own
  // motivating rows (a995b517, 2c174598, ce42c335). The launch announcement is NOT
  // evidence of work.
  test('true for the REAL launch-failure shape: only the [working] Session launched announcement precedes the [failed]', () => {
    assert.equal(isLaunchTimeFailure([
      { message: '[working] Session launched (session: 4cbf91c1, tty: unknown)' },
      { message: '[failed] opencode runner error: message request failed: HTTP 500 ' }
    ]), true);
    assert.equal(isLaunchTimeFailure([
      { message: '[working] Session launched (session: ce42c335, tty: unknown)' },
      { message: '[failed] opencode runner error: opencode serve never became ready within 20000ms' }
    ]), true);
    // A bare mention of the launch beat (no session/tty payload) is still the announcement.
    assert.equal(isLaunchTimeFailure([
      { message: '[working] Session launched' },
      { message: '[failed] boom' }
    ]), true);
  });

  test('false once a real during-work beat appeared — the dispatch actually ran before it failed', () => {
    assert.equal(isLaunchTimeFailure([
      { message: '[working] 4 tools/20s · alive' },
      { message: '[failed] tests red' }
    ]), false);
    // A non-launch liveness beat (the opencode reaper's during-run heartbeat) is
    // still evidence the process ran — conservative: ONLY the launch announcement
    // is ignored, never a post-launch heartbeat.
    assert.equal(isLaunchTimeFailure([
      { message: '[working] (opencode — 12s so far; next check in 30s)' },
      { message: '[failed] opencode exited with code 1' }
    ]), false);
    // The resume marker is a [working] marker too (LIN-2123's shared prefix).
    assert.equal(isLaunchTimeFailure([
      { message: '[working] Session resumed. Executing follow-up...' },
      { message: '[failed] boom' }
    ]), false);
  });

  // LIN-2872 review F2: heartbeat.js also emits the CATEGORIZED lead
  // `[working · <category>]` (e.g. `[working · editing] 4 tools/20s`). A regex keyed
  // on `[working]` alone would miss it and wrongly exempt a dispatch that genuinely
  // ran and failed after only categorized beats — the exact gap that goes live once
  // F1 stops counting the launch announcement.
  test('false once a CATEGORIZED heartbeat appeared — [working · <cat>] is real work, not a launch announcement', () => {
    assert.equal(isLaunchTimeFailure([
      { message: '[working · editing] 4 tools/20s: editing 3, search 1 · 4 total' },
      { message: '[failed] tests red' }
    ]), false);
    assert.equal(isLaunchTimeFailure([
      { message: '[working · verifying] verifying in background · idle 30s' },
      { message: '[failed] boom' }
    ]), false);
    assert.equal(isLaunchTimeFailure([
      { message: '[working · running] e2e running for 2m' },
      { message: '[failed] boom' }
    ]), false);
  });

  test('false for every non-failed terminal — done/aborted/skipped are not launch-time failures', () => {
    assert.equal(isLaunchTimeFailure([{ message: '[done] finished' }]), false);
    assert.equal(isLaunchTimeFailure([{ message: '[complete] all green' }]), false);
    assert.equal(isLaunchTimeFailure([{ message: '[aborted] cancelled' }]), false);
    assert.equal(isLaunchTimeFailure([{ message: '[skipped] human-continued session' }]), false);
  });

  test('false when there is no terminal marker at all — the prior is still taken/running', () => {
    assert.equal(isLaunchTimeFailure([]), false);
    assert.equal(isLaunchTimeFailure([{ message: '[working] still going' }]), false);
    assert.equal(isLaunchTimeFailure([{ message: 'started work' }]), false);
  });

  test('fails CLOSED on non-array / unreadable feedback', () => {
    assert.equal(isLaunchTimeFailure(undefined), false);
    assert.equal(isLaunchTimeFailure(null), false);
    assert.equal(isLaunchTimeFailure('nope'), false);
  });

  test('case-insensitive and tolerant of leading whitespace, matching the terminal regex', () => {
    assert.equal(isLaunchTimeFailure([{ message: '  [FAILED] boom' }]), true);
  });
});
