/**
 * Unit tests for lib/prompts/autopilot-kickoff.js
 *
 * Run with: node --test tests/unit/autopilot-kickoff.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT, AUTOPILOT_VARIANTS, AUTOPILOT_VARIANT_DEFAULT } from '../../lib/prompts/autopilot-kickoff.js';
import { buildAutopilotManual } from '../../lib/prompts/autopilot-manual.js';

const BASE_URL = 'https://example.com';

describe('buildAutopilotKickoff (shared guide)', () => {
  test('starts with the Autopilot persona header', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.startsWith("# You're Autopilot"));
  });

  test('embeds the proxy base URL and instructions pointer', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes(`${BASE_URL}/api/proxy`));
    assert.ok(text.includes(`${BASE_URL}/api/proxy/instructions`));
  });

  test('carries the four invariants and the halt rule', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('Evidence beats self-report'));
    assert.ok(text.includes('Stay light'));
    // The halt rule now lives in the consolidated instruments block
    // ("## Your instruments — and when to halt").
    assert.ok(text.includes('and when to halt'));
  });

  test('warns that a terminal done is a session boundary, not proof of success', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('the session ended'));
    assert.ok(text.includes('[stalled?]'));
  });

  test('separates the reversible-work mandate from the separately-gated irreversible finish (LIN-1365)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    // The dispatch is a mandate for reversible work — keep the anti-stall intent.
    assert.ok(text.includes('mandate for the reversible work'));
    assert.ok(/don't hold your first\s+call, or any call, waiting for a live reply/.test(text),
      'preserves the anti-stall "don\'t hold your first call" instruction');
    // It no longer over-asserts the token IS the human's authorization to act.
    assert.ok(!/\*\*is\*\* the human's authorization to act/.test(text),
      'drops the token-is-authorization conflation');
    // Merge/Done are gated separately on a recorded review Approve + discharged ledger.
    assert.ok(/not\*\* authorization for the irreversible finish/.test(text));
    assert.ok(text.includes('The token authenticates the channel; it is not permission to merge.'));
  });

  test('restates the named-discharge lanes, not an unqualified human sign-off (LIN-1579)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    // The old blanket clause contradicted every other surface once the lane widened.
    assert.ok(!/a human sign-off for\s+risky merges/.test(text),
      'drops the unqualified "human sign-off for risky merges" clause');
    // An unprovable item discharges through the monitor review named — no box to tick.
    assert.ok(/discharges through the \*\*named\*\* monitor review wrote for it/.test(text),
      'a ledger item unprovable before merge discharges via its named monitor');
    assert.ok(/reversible runtime-logic change through the \*\*named\*\* rollback/.test(text),
      'a reversible runtime-logic change discharges via its named rollback');
    assert.ok(/no human has to tick a box for\s+either/.test(text),
      'neither named lane requires a fresh human sign-off');
    // The floor the widening does NOT touch.
    assert.ok(/a human naming the exact precondition is still required for an item review left\s+undischarged on a security, data-path, or external-contract surface/.test(text),
      'undischarged items on risky surfaces still need a human naming the precondition');
    // Naming is review's job — the orchestrator cites, it never supplies.
    assert.ok(/you cite a name, you never supply one/.test(text),
      'the orchestrator cites review\'s name rather than authoring its own');
  });

  test('defaults to write/merge-gated mode', () => {
    assert.strictEqual(AUTOPILOT_MODE_DEFAULT, 'write');
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('WRITE, merge-gated'));
  });

  test('the finish is a dispatched close-out step, not an inline merge (LIN-804)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    // After an Approve, the orchestrator dispatches close-out and verifies it —
    // it does not merge/close inline (reconciled with LIN-550's dispatched step).
    assert.ok(text.includes('close-out'));
    assert.ok(text.includes('dispatch the close'));
    assert.ok(text.includes('not** to merge yourself'));
  });

  test('frames the finish as having natural give — an extra pass is normal, not a stall', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('natural give'));
    assert.ok(text.includes('not churn or a stall'));
  });

  test('the watch step is a stand-by-for-push contract, not a poll loop (LIN-826)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    // Phase 2 swaps the up-chain poll for the push contract: after dispatching a
    // step the orchestrator stands by and is woken automatically with the outcome.
    assert.ok(text.includes('Stand by for the wake'));
    assert.ok(text.includes('subscribed'));
    assert.ok(text.includes('woken automatically'));
    assert.ok(text.includes('do not poll'));
    // The deleted long-poll loop must be gone — no residual watch-loop machinery.
    assert.ok(!text.includes('do { r = GET .../dispatch/{id}?wait=50 }'));
    assert.ok(!text.includes('Quiet has a ceiling'));
  });

  test('keeps the ~30-min wedged-session liveness nudge (the push can\'t see silence) (LIN-826)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    // The runtime wakes on a terminal *outcome*; a worker that goes silent without
    // terminating still needs the agent's nudge — this judgment must survive the swap.
    assert.ok(text.includes('wedged session'));
    assert.ok(text.includes('silent without ever terminating'));
    assert.ok(text.includes('30 min'));
    assert.ok(text.includes('followUpTo'));
    assert.ok(text.includes('no live session to resume'));
  });

  test('keeps the step-4 "done means go look" cross-check after the swap (LIN-826)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    // The cross-check that earns its keep — fetch [evidence], confirm the deliverable
    // exists, treat done-while-waiting as not-yet — is untouched by the step-3 swap.
    assert.ok(text.includes('the step that earns its keep'));
    assert.ok(text.includes('[evidence]'));
    assert.ok(text.includes('claimed, not verified'));
  });

  test('reads a done-while-waiting (e2e/CI/deploy in flight) as a not-yet, not a finish', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('not-yet'));
    // The blessed confirmatory follow-up is the resolution for a done posted mid-flight.
    assert.ok(text.includes('confirm CI went green and report the run URL'));
  });

  test('the autopilot issues NO end-of-run close --cascade — the completion axis is the runner\'s (LIN-1206)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    const flat = text.replace(/\s+/g, ' ');
    // LIN-1100 step 2 / Strategy B: the autopilot closes NOTHING on the completion axis.
    // The end-of-run `close --cascade` is retired now that SD's `closeOnDone` auto-closes
    // DONE windows (LIN-1100 step 1, made reliable by LIN-1219).
    assert.ok(!text.includes('cascade: true'), 'the concrete end-of-run cascade wire flag must be gone');
    assert.ok(!/abortTo: <your own\s+session id>/.test(text),
      'the autopilot no longer roots a cascade on its own session id');
    assert.ok(flat.includes('you close nothing'),
      'the run-end prose states the autopilot closes nothing on completion');
    assert.ok(flat.includes('no end-of-run cascade to issue'),
      'the end-of-run cascade is explicitly retired');
    assert.ok(text.includes('closeOnDone'), 'names the runner-owned DONE auto-close that replaces it');
  });

  test('the autopilot never closes a DONE window itself — the runner does (closeOnDone); non-DONE stays open (LIN-1206)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    const flat = text.replace(/\s+/g, ' ');
    // The composed prompt inlines the manual, so both surfaces carry the inversion:
    // the runner closes a session on its DONE sentinel; the autopilot judges + advances
    // but closes no DONE window itself. (Reverses LIN-1071.)
    assert.ok(text.includes('closeOnDone'), 'names the runner-owned DONE auto-close');
    assert.ok(flat.includes("the runner's job now, not yours"),
      'the manual section is titled for the runner owning the close');
    assert.ok(flat.includes('never close a DONE window yourself'),
      'the autopilot is told it never closes a DONE window itself');
    // The child autopilot is no longer closed by the autopilot either — same inversion.
    assert.ok(text.includes('child autopilot'),
      'the child autopilot case is still named');
    assert.ok(flat.includes('do not issue an `abort`/`abortTo` to reap it'),
      'the autopilot no longer aborts/abortTo-reaps a done child');
    // Invariants preserved: no timer/guess close; resume-via-`--resume` (LIN-486) reversibility.
    assert.ok(flat.includes('event-driven off the DONE sentinel'),
      'closing stays event-driven, never timer/guess-based');
    assert.ok(text.includes('LIN-486'),
      'the --resume/LIN-486 reversibility premise is kept');
    // Non-DONE terminal windows stay open deliberately (a feature, not a leak).
    assert.ok(flat.includes('Non-DONE terminal windows are deliberately left open'),
      'non-DONE windows stay open as investigation affordances');
  });

  test('coordinates a child set as PARALLEL fan-out / fan-in with per-child liveness (LIN-874)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    // The inlined manual now describes parallel fan-out, not serial dispatch:
    // independent children go out up front and fan in as each terminal wake arrives.
    assert.ok(/fan the independent children out concurrently/i.test(text),
      'the manual dispatches independent children concurrently, not one after the last');
    assert.ok(text.includes('up front'), 'independent children are dispatched up front');
    // The waits-on join: a dependent child is held until its blocker is judged clean.
    assert.ok(/waits-on/i.test(text), 'a waits-on child is gated on its blocker');
    assert.ok(/judged clean/i.test(text), 'the blocker must be judged clean before the dependent dispatches');
    // Child-set liveness: each outstanding child carries its OWN ~30-min clock so a
    // wedged one is nudged/failed without freezing the siblings or the batch.
    assert.ok(/own ~30-minute liveness clock/i.test(text),
      'each outstanding child carries its own liveness clock at child-set level');
    assert.ok(/never freezes the siblings/i.test(text),
      'a wedged child must not freeze the siblings or the batch');
    // The serial batch language, and LIN-874 as a deferred item, are both gone.
    assert.ok(!/both are \*\*serial\*\* for now/i.test(text), 'the serial coordinator gate is removed');
    assert.ok(!text.includes('LIN-874'), 'LIN-874 is no longer listed as an unbuilt/deferred item');
  });
});

describe('buildAutopilotKickoff (inline handbook / disposition layer)', () => {
  // Anchor on structural facts (the handbook H1, the kickoff-owned lens transition,
  // ordering, the endpoint pointer) — never on handbook prose, which stays freely
  // editable in docs/autopilot-operating-manual.md.
  test('composes the handbook inline', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('# The Autopilot Handbook'));
  });

  test('the handbook is the lens — it precedes the mechanism (the four lines)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    const handbookAt = text.indexOf('# The Autopilot Handbook');
    const fourLinesAt = text.indexOf('The four lines that are the human');
    assert.ok(handbookAt > -1 && fourLinesAt > -1);
    assert.ok(handbookAt < fourLinesAt, 'handbook should come before the four lines');
  });

  test('points at the manual endpoint for mid-run re-reference', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes(`${BASE_URL}/api/proxy/autopilot/manual`));
  });

  test('the inlined handbook retires the end-of-run cascade — the runner owns DONE closing (LIN-1206)', () => {
    // The manual (composed inline into every run) no longer carries an end-of-run
    // close --cascade disposition. On the completion axis the autopilot closes nothing:
    // SD's closeOnDone reaps DONE windows and non-DONE windows are left open.
    const manual = buildAutopilotManual();
    const flat = manual.replace(/\s+/g, ' ');
    assert.ok(!manual.includes('cascade: true'), 'the manual no longer gives the cascade wire flag');
    assert.ok(manual.includes('closeOnDone'), 'the manual names the runner-owned DONE auto-close');
    assert.ok(flat.includes('you close nothing'),
      'the manual states the autopilot closes nothing on completion');
    assert.ok(flat.includes('Non-DONE terminal windows are deliberately left open'),
      'the manual keeps non-DONE windows open deliberately');
  });
});

describe('buildAutopilotKickoff (general / stack-walk)', () => {
  test('no goal → walks the stack under the precedence policy', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('none this run — walk the stack'));
  });

  test('first act fetches the stack digest (light orientation, not full bodies)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes(`${BASE_URL}/api/proxy/stack?limit=5&view=digest`));
  });

  test('a free-text goal is surfaced in the snapshot', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, goal: 'finish the Ship view' });
    assert.ok(text.includes('finish the Ship view'));
  });

  test('orient verb list points at the digest view', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('GET /stack?view=digest'));
  });

  test('deliverable cross-check is kept general (not a fixed code-only checklist)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('deliverable this task was meant to produce'));
    assert.ok(text.includes('not a fixed checklist'));
  });
});

describe('buildAutopilotKickoff (scoped to an issue)', () => {
  const issue = { identifier: 'LIN-42', title: 'Fix login bug' };

  test('goal is pinned to the task and the precedence policy is moot', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('run on autopilot until **LIN-42** (Fix login bug)'));
    assert.ok(text.includes('precedence policy is moot'));
  });

  test('first act reads the issue and triggers recommend-and-dispatch for it', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, issue });
    // Lead with the distilled brief as starting context (LIN-260); the raw /issues
    // read stays available for full detail the brief doesn't carry.
    assert.ok(text.includes('GET /brief/LIN-42'), 'scoped first act should start from the distilled brief');
    assert.ok(text.includes('GET /issues/LIN-42'), 'raw issue detail stays available');
    // The fused verb (LIN-321) replaces the two-step GET /recommend -> POST /dispatch:
    // the scoped first act triggers recommend-and-dispatch with the issue identifier.
    assert.ok(text.includes('POST /recommend-and-dispatch'));
    assert.ok(text.includes('issueIdentifier: "LIN-42"'));
  });

  test('does not pull other tasks off the stack', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, issue });
    assert.ok(text.includes('Do not pull other tasks off the stack'));
  });
});

describe('buildAutopilotKickoff (originNote seam, LIN-918)', () => {
  const issue = { identifier: 'LIN-918', title: 'Feedback widget actions' };
  const NOTE = '**Origin — raw feedback:** filed directly from the in-app feedback widget.';

  test('omitting originNote is byte-identical to the default (no drift)', () => {
    assert.strictEqual(
      buildAutopilotKickoff({ baseUrl: BASE_URL, issue, originNote: '' }),
      buildAutopilotKickoff({ baseUrl: BASE_URL, issue })
    );
    // Also byte-identical for a general (unscoped) run.
    assert.strictEqual(
      buildAutopilotKickoff({ baseUrl: BASE_URL, originNote: '   ' }),
      buildAutopilotKickoff({ baseUrl: BASE_URL })
    );
  });

  test('appends the note to a scoped run without disturbing the pinned goal', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, issue, originNote: NOTE });
    assert.ok(text.includes('run on autopilot until **LIN-918**'));
    assert.ok(text.includes(NOTE));
    // The note sits inside the goal block, before the snapshot's proxy line.
    assert.ok(text.indexOf(NOTE) < text.indexOf('**Proxy:** base'));
  });

  test('appends the note to a general run too', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, goal: 'ship it', originNote: NOTE });
    assert.ok(text.includes('**Goal from the human:** ship it'));
    assert.ok(text.includes(NOTE));
  });
});

describe('buildAutopilotKickoff (maxTasks budget, LIN-1751)', () => {
  const issue = { identifier: 'LIN-1751', title: 'Bounded autonomous runs' };

  test('omitting maxTasks is byte-identical to the default (no drift)', () => {
    assert.strictEqual(
      buildAutopilotKickoff({ baseUrl: BASE_URL }),
      buildAutopilotKickoff({ baseUrl: BASE_URL, maxTasks: null })
    );
    assert.strictEqual(
      buildAutopilotKickoff({ baseUrl: BASE_URL, issue }),
      buildAutopilotKickoff({ baseUrl: BASE_URL, issue, maxTasks: undefined })
    );
    assert.strictEqual(
      buildAutopilotKickoff({ baseUrl: BASE_URL, goal: 'ship it', variant: 'stepper' }),
      buildAutopilotKickoff({ baseUrl: BASE_URL, goal: 'ship it', variant: 'stepper', maxTasks: null })
    );
  });

  test('an invalid maxTasks (0, negative, non-integer) is treated the same as absent — byte-identical', () => {
    const base = buildAutopilotKickoff({ baseUrl: BASE_URL });
    for (const bad of [0, -1, 1.5, NaN]) {
      assert.strictEqual(buildAutopilotKickoff({ baseUrl: BASE_URL, maxTasks: bad }), base,
        `maxTasks: ${bad} must not be treated as a declared budget`);
    }
  });

  test('a declared budget states the scope bound up front, beside mode', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, maxTasks: 50 });
    assert.ok(text.includes('Task budget: up to 50 distinct tasks this run'));
    // Stated near the mode block, before the goal block.
    assert.ok(text.indexOf('Task budget') < text.indexOf('**Goal from the human:**'));
  });

  test('a budget of exactly 1 uses the singular "task"', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, maxTasks: 1 });
    assert.ok(text.includes('Task budget: up to 1 distinct task this run.'));
    assert.ok(!text.includes('1 distinct tasks'));
  });

  test('the finish-line sentence becomes budget-aware when maxTasks is set', () => {
    const unbudgeted = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(unbudgeted.includes('has no finish line — it runs until it needs you.'));

    const budgeted = buildAutopilotKickoff({ baseUrl: BASE_URL, maxTasks: 50 });
    assert.ok(!budgeted.includes('has no finish line — it runs until it needs you.'));
    assert.ok(budgeted.includes('This run covers **up to 50 distinct tasks**'));
    assert.ok(budgeted.includes('BUDGET_EXHAUSTED'));
  });

  test('the BUDGET_EXHAUSTED quirk-list bullet appears only when a budget is declared', () => {
    // The inlined manual (docs/autopilot-operating-manual.md) mentions
    // BUDGET_EXHAUSTED generically regardless of whether THIS run is budgeted
    // (it has no per-run templating), so assert on the kickoff's own quirk
    // bullet text specifically, not the bare code string.
    const QUIRK_BULLET = 'means this run reached its task budget';
    const unbudgeted = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(!unbudgeted.includes(QUIRK_BULLET));

    const budgeted = buildAutopilotKickoff({ baseUrl: BASE_URL, maxTasks: 50 });
    assert.ok(budgeted.includes('A `409 BUDGET_EXHAUSTED` means this run reached its task budget'));
    assert.ok(budgeted.includes('it is not a failure and not a\n  broken instrument'),
      'must be framed as an orderly finish, matching the DUPLICATE_DISPATCH quirk\'s framing');
    // Sits in the same quirks list as the existing DUPLICATE_DISPATCH entry.
    assert.ok(budgeted.indexOf('DUPLICATE_DISPATCH') < budgeted.indexOf(QUIRK_BULLET));
  });

  test('a budgeted scoped run still pins the goal and names the task, unaffected by the budget block', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, issue, maxTasks: 10 });
    assert.ok(text.includes('run on autopilot until **LIN-1751**'));
    assert.ok(text.includes('Task budget: up to 10 distinct tasks this run.'));
  });
});

describe('buildAutopilotKickoff (read-only mode)', () => {
  test('restricts the worker to findings-only and names the boundary', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, mode: 'readonly' });
    assert.ok(text.includes('READ-ONLY'));
    assert.ok(text.includes('no code changes, no PRs, no Linear state changes'));
    assert.ok(!text.includes('WRITE, merge-gated'));
  });

  test('is honest that read-only is a convention enforced via plain dispatch, not the fused verb', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, mode: 'readonly' });
    // read-only must not lean on recommend-and-dispatch (which generates write-shaped prompts)
    assert.ok(text.includes('plain `POST /dispatch`'));
    assert.ok(text.includes('not a sandbox the platform enforces'));
  });

  test('AUTOPILOT_MODES enumerates the supported modes', () => {
    assert.deepStrictEqual(AUTOPILOT_MODES, ['write', 'readonly']);
  });
});

describe('buildAutopilotKickoff (variant axis, LIN-791)', () => {
  // The kickoff body is composed as sections joined by this exact separator;
  // the stepper variant inserts ONE extra section, so splitting on it lets us
  // prove the insertion is purely additive (the standard sections are untouched).
  const SEP = '\n\n---\n\n';
  const STEPPER_MARKER = "You're running as the STEPPER";

  test('AUTOPILOT_VARIANTS enumerates the variants; default is standard', () => {
    assert.deepStrictEqual(AUTOPILOT_VARIANTS, ['standard', 'stepper']);
    assert.strictEqual(AUTOPILOT_VARIANT_DEFAULT, 'standard');
  });

  test("omitting variant === variant:'standard' (byte-identical default path)", () => {
    // Pin the default so the standard path can never silently drift onto the
    // stepper branch. Covers the general, scoped, and readonly permutations.
    const cases = [
      { baseUrl: BASE_URL },
      { baseUrl: BASE_URL, goal: 'ship the thing' },
      { baseUrl: BASE_URL, mode: 'readonly' },
      { baseUrl: BASE_URL, issue: { identifier: 'LIN-42', title: 'Do work' } },
    ];
    for (const c of cases) {
      assert.strictEqual(
        buildAutopilotKickoff(c),
        buildAutopilotKickoff({ ...c, variant: 'standard' }),
        `default must equal explicit standard for ${JSON.stringify(c)}`
      );
    }
  });

  test('standard output carries NO stepper disposition markers', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'standard' });
    assert.ok(!text.includes(STEPPER_MARKER));
    assert.ok(!text.includes('beat N/M'));
    assert.ok(!text.includes('followUpTo: ROOT'));
  });

  test('stepper inserts exactly one additive section — the standard sections stay byte-identical', () => {
    const standard = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'standard' });
    const stepper = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'stepper' });

    const stdSections = standard.split(SEP);
    const stepSections = stepper.split(SEP);
    // stepper adds exactly one section.
    assert.strictEqual(stepSections.length, stdSections.length + 1);
    // and the added one is the stepper disposition.
    const added = stepSections.filter(s => s.includes(STEPPER_MARKER));
    assert.strictEqual(added.length, 1);
    // Removing the stepper section reconstitutes the standard kickoff EXACTLY —
    // proves the intro/manual/guide/snapshot are untouched by the variant.
    const withoutStepper = stepSections.filter(s => !s.includes(STEPPER_MARKER)).join(SEP);
    assert.strictEqual(withoutStepper, standard);
  });

  test('stepper output carries the full disposition (warm beats, ROOT, force, subscription, push rails, labels, challenge, wrap-up)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'stepper' });
    assert.ok(text.includes(STEPPER_MARKER));
    assert.ok(text.includes('3–6'));                 // decompose into 3–6 beats
    assert.ok(text.includes('ROOT'));                // beat 1 fresh, captured as ROOT
    assert.ok(text.includes('followUpTo: ROOT'));    // later beats anchor on ROOT
    assert.ok(text.includes('force: true'));         // force on every resume
    assert.ok(text.includes("subscription: 'everything'")); // LIN-901: every beat declares the everything edge (push rails, §6)
    assert.ok(text.includes('waitForFollowUps: true')); // LIN-845: every beat asks for the worker-side hold
    assert.ok(text.includes('beat N/M'));            // label every send
    assert.ok(text.includes('PENDING'));             // PENDING wake = clean advance, the push signal
    assert.ok(text.toLowerCase().includes('challenge'));
    assert.ok(text.toLowerCase().includes('wrap-up'));
    assert.ok(/warm/i.test(text));                   // warm single-session default
  });

  test('the stepper is on PUSH RAILS — it stands by, no hand-rolled long-poll keep-alive (LIN-843)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'stepper' });
    // The orchestrator stands by for the up-chain wake instead of long-polling.
    assert.ok(/stand by/i.test(text), 'stepper instructs the orchestrator to stand by');
    assert.ok(/push rails/i.test(text), 'names the push-rails contract');
    // The old long-poll keep-alive loop must be gone as the delivery mechanism —
    // run_in_background may still appear, but only as something to NOT do.
    assert.ok(!/long-poll background wait IS your/i.test(text), 'the old keep-warm-via-long-poll claim is gone');
    assert.ok(/do not run a `run_in_background` long-poll/i.test(text) || /do not .*long-poll/i.test(text),
      'long-poll is now prohibited, not the mechanism');
  });

  test('beats carry BOTH halves of the warm drip — subscription:everything (wake) AND waitForFollowUps (hold) (LIN-845)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'stepper' });
    // subscription:'everything' alone wires only the up-chain wake; without
    // waitForFollowUps the worker finalizes after beat 1 and beat 2 falls back to a
    // cold `claude --resume`.
    assert.ok(text.includes("subscription: 'everything'"));
    assert.ok(text.includes('waitForFollowUps: true'));
    // The hold parks the worker at AWAITING_FOLLOWUP so the next beat lands in-session.
    assert.ok(text.includes('AWAITING_FOLLOWUP'));
    // Standard runs must never carry the stepper-only hold instruction.
    const standard = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'standard' });
    assert.ok(!standard.includes('waitForFollowUps: true'));
  });

  test('stepper gates on a SINGLE task up front — a batch coordinates child autopilots in PARALLEL, it does not step into the first (LIN-888 / LIN-874)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'stepper' });
    // The up-front single-task gate: stepping is one task's arc; instructions that
    // name a batch of tasks must switch to coordinating one child autopilot per task,
    // not step into the first.
    assert.ok(text.includes('is this ONE task, or a batch'), 'stepper carries the up-front single-task gate');
    assert.ok(/single task/i.test(text));
    assert.ok(text.includes('child autopilot'));         // coordinate, don't step
    assert.ok(text.includes("variant: 'stepper'"));      // each child is itself stepped
    // References the manual's mechanism rather than re-describing child dispatch.
    assert.ok(text.includes('Dispatching a child autopilot'));
    // LIN-874: batch handling is parallel fan-out / fan-in, not serial. Independent
    // children dispatch concurrently, a waits-on child is gated on its blocker's
    // terminal wake, and one stalled child never blocks its siblings or the batch.
    assert.ok(/concurrent/i.test(text), 'independent children fan out concurrently, not serially');
    assert.ok(/waits-on/i.test(text), 'a waits-on child is held back until its blocker is judged clean');
    assert.ok(/never blocks its siblings or the batch/i.test(text), 'one stalled child does not block its siblings or the batch');
    // The old serial batch-gate language is replaced, not layered on top of.
    assert.ok(!/serial/i.test(text), 'the serial batch-gate wording is removed, not retained');
    assert.ok(!/one at a time/i.test(text), 'the "one child at a time" wording is removed');
    // The gate is scoped to the stepper section: a standard kickoff never carries it.
    // (The byte-identical-standard test above is the structural guard; this pins the
    // gate's distinctive lead specifically to the stepper branch.)
    const standard = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'standard' });
    assert.ok(!standard.includes('is this ONE task, or a batch'), 'the batch gate must not leak into the standard kickoff');
  });

  test('variant is orthogonal to mode — stepper composes with readonly', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, mode: 'readonly', variant: 'stepper' });
    assert.ok(text.includes('READ-ONLY'));
    assert.ok(text.includes(STEPPER_MARKER));
  });
});

describe('buildAutopilotKickoff (standalone mode, LIN-1117)', () => {
  const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

  test('standalone: true inlines a UUID session id in the Setup bullet', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, standalone: true });
    assert.ok(text.includes('Your session id is `'));
    assert.ok(UUID_PATTERN.test(text), 'must contain a valid UUID');
    // The override clause bridges the standalone-copy path to the dispatch path.
    assert.ok(text.includes('overrides this value with the true dispatch id'));
  });

  test('standalone: true generates a fresh UUID on each call', () => {
    const t1 = buildAutopilotKickoff({ baseUrl: BASE_URL, standalone: true });
    const t2 = buildAutopilotKickoff({ baseUrl: BASE_URL, standalone: true });
    assert.notStrictEqual(t1, t2);
  });

  test('standalone: false (default) keeps the byte-identical dispatched contract', () => {
    const defaultText = buildAutopilotKickoff({ baseUrl: BASE_URL });
    const explicitText = buildAutopilotKickoff({ baseUrl: BASE_URL, standalone: false });
    assert.strictEqual(explicitText, defaultText);
  });

  test('standalone step 3 leads with stand-by as the default, keyed off the Setup session-id check (LIN-1324)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, standalone: true });
    // Stand-by is no longer only the push-rails wording — the standalone branch
    // must offer it too, gated on whether Setup found a real dispatch id.
    assert.ok(text.includes('Your autopilot session id'), 'step 3 references the Setup session-id block');
    assert.ok(/stand by/i.test(text), 'standalone still offers the stand-by discipline');
    assert.ok(text.includes('woken automatically'));
    // The bounded, one-off probe survives for the no-substrate case.
    assert.ok(text.includes('?wait=50'));
    assert.ok(/one-off|single.*call/i.test(text));
    // No standing loop anywhere in the standalone output.
    assert.ok(!text.includes('background loop'), 'the standing background poll loop is gone');
    assert.ok(!text.includes('not one call per turn'), 'the old standing-loop framing is gone');
  });

  test('standalone step 3: real dispatch id -> stand by; minted UUID only -> bounded one-off liveness probe, never a standing loop (LIN-1324)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, standalone: true });
    const step3 = text.split(/^3\. \*\*Wait per Setup's session-id check/m)[1].split(/^4\. \*\*Cross-check/m)[0];
    // Stand-by half: woken automatically on a terminal outcome, no polling.
    assert.ok(/stand by/i.test(step3));
    assert.ok(step3.includes('woken automatically'));
    assert.ok(/do not poll|don'?t poll/i.test(step3));
    // Bounded-probe half: a single, explicit, one-off call — never a standing loop.
    assert.ok(step3.includes('?wait=50'));
    assert.ok(/one-off|single/i.test(step3));
    assert.ok(!step3.includes('background loop'));
    // Both halves keep the ~30-min wedged-session judgment and the rate limit.
    assert.ok(step3.includes('30 min') || step3.includes('30-min'));
    assert.ok(step3.includes('60 req/min') || step3.includes('60 requests'));
  });

  test('standalone keeps waitForFollowUps and wedged-session ceiling', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, standalone: true });
    assert.ok(text.includes('followUpTo'));
    assert.ok(text.includes('30 min'));
    assert.ok(text.includes('liveness'));
  });

  test('standalone now DOES tell the agent to check for the "Your autopilot session id" block (LIN-1324)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, standalone: true });
    // Reversed from the pre-fix contract: standalone can no longer assume it has no
    // wake substrate — it must check at runtime whether the queue stamped a real,
    // resumable session id block onto this prompt, and that check is what decides
    // stand-by vs. the bounded probe.
    assert.ok(text.includes('Your autopilot session id'));
    assert.ok(/block/i.test(text) && /very end/i.test(text));
    assert.ok(!text.includes('### Your autopilot session id'), 'the block itself is only appended at dispatch time, not inlined here');
  });

  test('standalone mode is orthogonal to variant — stepper composes with standalone (LIN-1324)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'stepper', standalone: true });
    // The stepper marker is present.
    assert.ok(text.includes("You're running as the STEPPER"));
    // The standalone Setup inline UUID is present.
    assert.ok(text.includes('Your session id is `'));
    assert.ok(UUID_PATTERN.test(text));
    const afterStepper = text.split("You're running as the STEPPER")[1];
    const stepperSection = afterStepper.split('**Hard rules')[0];
    // Beat 3 now ALWAYS carries subscription: 'everything', standalone or not (LIN-1324) —
    // a real dispatch id, if one turns out to exist, needs the up-chain edge declared to wake.
    assert.ok(stepperSection.includes("subscription: 'everything'"),
      'beat 3 must carry subscription: everything even in the standalone build, so a real wake can land');
    // waitForFollowUps is kept.
    assert.ok(text.includes('waitForFollowUps: true'));
    // Beat 4 offers both the stand-by half and the bounded-probe half, and never a
    // standing background loop.
    const beat4Section = stepperSection.split(/^4\. \*\*Wait per Setup's session-id check/m)[1];
    assert.ok(beat4Section, 'beat 4 heading uses the new session-id-check wording');
    assert.ok(/stand by/i.test(beat4Section));
    assert.ok(beat4Section.includes('?wait=50'));
    assert.ok(!beat4Section.includes('background loop'));
    // Hard rules converge on the same check, also without a standing loop.
    const hardRulesSection = afterStepper.split('**Hard rules')[1];
    assert.ok(hardRulesSection.includes("subscription: 'everything'"));
    assert.ok(/stand by/i.test(hardRulesSection));
    assert.ok(hardRulesSection.includes('one-off'));
    assert.ok(!hardRulesSection.includes('background loop'));
    // Beat 5's corrective followUpTo must carry the same subscription: 'everything'
    // wake edge as beat 3 (LIN-1324 review finding) — otherwise a corrective re-judge
    // on a real-id run gets no [pending] wake and stalls to the wedged ceiling, the
    // exact failure mode this ticket exists to fix, reintroduced on the corrective path.
    const beat5Section = stepperSection.split(/^5\. \*\*Judge AND challenge/m)[1];
    assert.ok(beat5Section, 'beat 5 heading is present');
    assert.ok(beat5Section.includes("subscription: 'everything'"),
      "beat 5's corrective followUpTo must carry subscription: 'everything' even in the standalone build");
  });

  test('standalone mode is orthogonal to mode — readonly composes with standalone', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, mode: 'readonly', standalone: true });
    assert.ok(text.includes('READ-ONLY'));
    assert.ok(text.includes('Your session id is `'));
    assert.ok(UUID_PATTERN.test(text));
    assert.ok(/stand by/i.test(text));
    assert.ok(text.includes('?wait=50'));
  });
});
