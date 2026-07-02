/**
 * Unit tests for lib/prompts/autopilot-kickoff.js
 *
 * Run with: node --test tests/unit/autopilot-kickoff.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildAutopilotKickoff, AUTOPILOT_MODES, AUTOPILOT_MODE_DEFAULT, AUTOPILOT_VARIANTS, AUTOPILOT_VARIANT_DEFAULT } from '../../lib/prompts/autopilot-kickoff.js';

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

  test('closes a judged-terminal child autopilot on the existing abort wire (LIN-915)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    // The composed prompt inlines the manual, so both surfaces must carry the carve-out:
    // a judged-terminal *child autopilot* is closed after judge-and-advance on the existing
    // abort:true/abortTo wire — the one case close-on-completion is right — while workers and
    // maybe-interactive/human-continued sessions keep the leave-open default.
    assert.ok(text.includes('one class where you close on completion'),
      'manual should carve out the single close-on-completion class');
    assert.ok(text.includes('child autopilot'),
      'the carve-out must name the child autopilot as that class');
    assert.ok(text.includes('abortTo'),
      'the close must reuse the existing abort:true/abortTo wire, not a new path');
    // The kickoff complete-branch coherence line names the same close.
    assert.ok(text.includes('abortTo=<child session id>'),
      'the kickoff advance/complete step should name closing the spent child on the abort wire');
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

  test('stepper gates on a SINGLE task up front — a batch coordinates child autopilots, it does not step into the first (LIN-888)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'stepper' });
    // The up-front single-task gate: stepping is one task's arc; instructions that
    // name a batch of tasks in sequence must switch to coordinating one child
    // autopilot per task, not step into the first.
    assert.ok(text.includes('is this ONE task, or a batch'), 'stepper carries the up-front single-task gate');
    assert.ok(/single task/i.test(text));
    assert.ok(text.includes('child autopilot'));         // coordinate, don't step
    assert.ok(text.includes("variant: 'stepper'"));      // each child is itself stepped
    // References the manual's mechanism rather than re-describing child dispatch.
    assert.ok(text.includes('Dispatching a child autopilot'));
    // Batch handling stays serial — one child at a time.
    assert.ok(/serial/i.test(text));
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
