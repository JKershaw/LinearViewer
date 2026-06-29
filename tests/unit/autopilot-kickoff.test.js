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
    assert.ok(text.includes('Merge on green'));
  });

  test('frames the finish as having natural give — an extra pass is normal, not a stall', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('natural give'));
    assert.ok(text.includes('not churn or a stall'));
  });

  test('caps the watch on silence — a ~30-min zero-activity ceiling, then a liveness follow-up', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    // The watch loop must have a terminal escape: silence is not trusted forever.
    assert.ok(text.includes('Quiet has a ceiling'));
    assert.ok(text.includes('30 min'));
    assert.ok(text.includes('followUpTo'));
  });

  test('reads a done-while-waiting (e2e/CI/deploy in flight) as a not-yet, not a finish', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL });
    assert.ok(text.includes('not-yet'));
    // The blessed confirmatory follow-up is the resolution for a done posted mid-flight.
    assert.ok(text.includes('confirm CI went green and report the run URL'));
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

  test('stepper output carries the full disposition (warm beats, ROOT, force, labels, keep-alive, challenge, wrap-up)', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, variant: 'stepper' });
    assert.ok(text.includes(STEPPER_MARKER));
    assert.ok(text.includes('3–6'));                 // decompose into 3–6 beats
    assert.ok(text.includes('ROOT'));                // beat 1 fresh, captured as ROOT
    assert.ok(text.includes('followUpTo: ROOT'));    // later beats anchor on ROOT
    assert.ok(text.includes('force: true'));         // force on every resume
    assert.ok(text.includes('beat N/M'));            // label every send
    assert.ok(text.includes('run_in_background'));   // long-poll keep-alive
    assert.ok(text.includes('PENDING'));             // mid-chain PENDING = clean advance
    assert.ok(text.toLowerCase().includes('challenge'));
    assert.ok(text.toLowerCase().includes('wrap-up'));
    assert.ok(/warm/i.test(text));                   // warm single-session default
  });

  test('variant is orthogonal to mode — stepper composes with readonly', () => {
    const text = buildAutopilotKickoff({ baseUrl: BASE_URL, mode: 'readonly', variant: 'stepper' });
    assert.ok(text.includes('READ-ONLY'));
    assert.ok(text.includes(STEPPER_MARKER));
  });
});
