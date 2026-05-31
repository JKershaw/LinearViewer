/**
 * Tests for the five-layer roadmap narrative pipeline prompts.
 *
 * Each layer is independently exercised. The design contract is:
 *   layer 1 (technical)   — exists in roadmap-narrative-template.js
 *   layer 2 (product)     — synthesizes themes; chains from layer 1
 *   layer 3a (trajectory) — extrapolates forward; chains from layer 2
 *   layer 3b (north star) — normative judgment; reads source + north star
 *   layer 4 (gap)         — tensions between 3a and 3b
 *
 * See docs/roadmap-narrative-pipeline.md for the design.
 *
 * Run with: node --test tests/unit/roadmap-pipeline-prompts.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  buildRoadmapProductMessages,
  buildRoadmapProductPrompt
} from '../../lib/prompts/roadmap-product-template.js';
import {
  buildRoadmapTrajectoryMessages,
  buildRoadmapTrajectoryPrompt,
  summarizeTrajectoryPace
} from '../../lib/prompts/roadmap-trajectory-template.js';
import {
  buildRoadmapNorthStarMessages,
  buildRoadmapNorthStarPrompt
} from '../../lib/prompts/roadmap-north-star-template.js';
import {
  buildRoadmapGapMessages,
  buildRoadmapGapPrompt
} from '../../lib/prompts/roadmap-gap-template.js';

// =============================================================================
// Shared fixtures
// =============================================================================

const SAMPLE_MODEL = {
  velocity: { tasksPerWeek: 4 },
  milestones: [{
    name: 'Harbour OS',
    progressPercent: 40,
    totalTasks: 10,
    remainingTasks: 6,
    recentlyCompleted: [
      { title: 'Add user onboarding flow', completedAt: '2026-05-10T00:00:00Z' }
    ]
  }]
};

const SAMPLE_TECH = `Recently shipped: user onboarding flow [done] (2026-05-10).
Currently in progress on Harbour OS: 6 tasks remaining.`;

const SAMPLE_PRODUCT = `Harbour OS continues to mature its onboarding surface.
Recent work consolidates the new-user pathway.`;

const SAMPLE_NORTH_STAR = `Become the simplest way for non-technical founders to ship a product.
Optimize for time-to-first-value over feature breadth.`;

const SAMPLE_TRAJECTORY = `At this pace, Harbour OS appears to be heading toward a more polished onboarding experience.
The work suggests a direction toward smoother user entry.`;

const SAMPLE_NS_READING = `Harbour OS: aligned — onboarding work directly serves "time-to-first-value".
Overall: largely aligned to the simplicity goal.`;

// Richer model exercising the deterministic temporal signals (velocity trend,
// recent-vs-prior shift, cycle time) that the trajectory layer now receives.
const PACE_MODEL = {
  velocity: {
    tasksPerWeek: 4,
    trend: 'increasing',
    weeklyData: [
      { week: '2026-W14', tasks: 2, points: 0 },
      { week: '2026-W15', tasks: 3, points: 0 },
      { week: '2026-W16', tasks: 5, points: 0 },
      { week: '2026-W17', tasks: 6, points: 0 }
    ]
  },
  milestones: [{
    name: 'Harbour OS',
    progressPercent: 40,
    totalTasks: 10,
    remainingTasks: 6,
    tasksInQueue: [],
    recentlyCompleted: [
      { title: 'Add user onboarding flow', createdAt: '2026-05-01T00:00:00Z', completedAt: '2026-05-10T00:00:00Z', estimate: 2 },
      { title: 'Wire up auth', createdAt: '2026-05-02T00:00:00Z', completedAt: '2026-05-06T00:00:00Z', estimate: 1 }
    ]
  }],
  criticalPaths: {}
};

// =============================================================================
// Cross-cutting rules — apply to every layer
// =============================================================================

function assertCrossCuttingRules(systemContent, layerLabel) {
  assert.ok(
    /plain text/i.test(systemContent),
    `${layerLabel}: system should require plain text`
  );
  assert.ok(
    /no markdown|don'?t use markdown|do not use markdown/i.test(systemContent),
    `${layerLabel}: system should prohibit markdown`
  );
  assert.ok(
    /original|don'?t rename|do not rename/i.test(systemContent),
    `${layerLabel}: system should require original task/project names`
  );
  assert.ok(
    /cite|specific/i.test(systemContent),
    `${layerLabel}: system should require citing specific items`
  );
  assert.ok(
    /first mention|short-form|short reference/i.test(systemContent),
    `${layerLabel}: system should permit a short-form reference after first mention`
  );
}

// =============================================================================
// Layer 2 — Product perspective
// =============================================================================

describe('buildRoadmapProductMessages (layer 2 — product)', () => {
  test('returns [system, user] messages array', () => {
    const messages = buildRoadmapProductMessages(SAMPLE_MODEL, SAMPLE_TECH);
    assert.ok(Array.isArray(messages));
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[1].role, 'user');
  });

  test('system prompt uses product manager persona', () => {
    const messages = buildRoadmapProductMessages(SAMPLE_MODEL, SAMPLE_TECH);
    const system = messages[0].content;
    assert.ok(/product manager|product perspective/i.test(system),
      'should reference product manager persona');
  });

  test('system prompt requires synthesis of themes, not re-narration', () => {
    const messages = buildRoadmapProductMessages(SAMPLE_MODEL, SAMPLE_TECH);
    const system = messages[0].content;
    assert.ok(/synthes|theme/i.test(system),
      'should require thematic synthesis');
  });

  test('system prompt forbids projections', () => {
    const messages = buildRoadmapProductMessages(SAMPLE_MODEL, SAMPLE_TECH);
    const system = messages[0].content;
    assert.ok(/no projection|do not project|forecast/i.test(system),
      'should forbid projections/forecasts');
  });

  test('system prompt forbids inventing user impact', () => {
    const messages = buildRoadmapProductMessages(SAMPLE_MODEL, SAMPLE_TECH);
    const system = messages[0].content;
    assert.ok(/invent|not supported|cite specific/i.test(system),
      'should warn against inventing impact');
  });

  test('user message embeds technical narrative verbatim', () => {
    const messages = buildRoadmapProductMessages(SAMPLE_MODEL, SAMPLE_TECH);
    const user = messages[1].content;
    assert.ok(user.includes(SAMPLE_TECH),
      'tech narrative must be embedded so layer 2 can synthesize from it');
  });

  test('user message contains summarized roadmap data', () => {
    const messages = buildRoadmapProductMessages(SAMPLE_MODEL, SAMPLE_TECH);
    const user = messages[1].content;
    assert.ok(user.includes('Harbour OS'),
      'should include project names from the data summary');
  });

  test('honors cross-cutting rules', () => {
    const messages = buildRoadmapProductMessages(SAMPLE_MODEL, SAMPLE_TECH);
    assertCrossCuttingRules(messages[0].content, 'layer 2');
  });

  test('backward-compatible buildRoadmapProductPrompt returns a string', () => {
    const prompt = buildRoadmapProductPrompt(SAMPLE_MODEL, SAMPLE_TECH);
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 100);
  });
});

// =============================================================================
// Layer 3a — Trajectory / aspirational
// =============================================================================

describe('buildRoadmapTrajectoryMessages (layer 3a — trajectory)', () => {
  test('returns [system, user] messages array', () => {
    const messages = buildRoadmapTrajectoryMessages(SAMPLE_MODEL, SAMPLE_TECH, SAMPLE_PRODUCT);
    assert.ok(Array.isArray(messages));
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[1].role, 'user');
  });

  test('system prompt uses strategist / forward-looking persona', () => {
    const messages = buildRoadmapTrajectoryMessages(SAMPLE_MODEL, SAMPLE_TECH, SAMPLE_PRODUCT);
    const system = messages[0].content;
    assert.ok(/strategist|direction of travel|forward|extrapolat/i.test(system),
      'should reference strategist / extrapolative persona');
  });

  test('system prompt requires hedging language', () => {
    const messages = buildRoadmapTrajectoryMessages(SAMPLE_MODEL, SAMPLE_TECH, SAMPLE_PRODUCT);
    const system = messages[0].content;
    assert.ok(system.includes('at this pace') || system.includes('if this continues') || system.includes('suggests a direction'),
      'should require hedging phrases like "at this pace", "if this continues", or "suggests a direction"');
  });

  test('system prompt distinguishes implicit vs recommended direction', () => {
    const messages = buildRoadmapTrajectoryMessages(SAMPLE_MODEL, SAMPLE_TECH, SAMPLE_PRODUCT);
    const system = messages[0].content;
    assert.ok(/not what should happen|implicit|extended/i.test(system),
      'should clarify that this describes current vector, not recommendation');
  });

  test('system prompt allows the model to say data is mixed/incoherent', () => {
    const messages = buildRoadmapTrajectoryMessages(SAMPLE_MODEL, SAMPLE_TECH, SAMPLE_PRODUCT);
    const system = messages[0].content;
    assert.ok(/mixed|scattered|incoherent|unclear|say so/i.test(system),
      'should allow the model to flag mixed data');
  });

  test('user message embeds both tech and product narratives', () => {
    const messages = buildRoadmapTrajectoryMessages(SAMPLE_MODEL, SAMPLE_TECH, SAMPLE_PRODUCT);
    const user = messages[1].content;
    assert.ok(user.includes(SAMPLE_TECH), 'must embed tech narrative');
    assert.ok(user.includes(SAMPLE_PRODUCT), 'must embed product narrative');
  });

  test('user message contains summarized roadmap data', () => {
    const messages = buildRoadmapTrajectoryMessages(SAMPLE_MODEL, SAMPLE_TECH, SAMPLE_PRODUCT);
    const user = messages[1].content;
    assert.ok(user.includes('Harbour OS'),
      'should include project names from the data summary');
  });

  test('honors cross-cutting rules', () => {
    const messages = buildRoadmapTrajectoryMessages(SAMPLE_MODEL, SAMPLE_TECH, SAMPLE_PRODUCT);
    assertCrossCuttingRules(messages[0].content, 'layer 3a');
  });

  test('backward-compatible buildRoadmapTrajectoryPrompt returns a string', () => {
    const prompt = buildRoadmapTrajectoryPrompt(SAMPLE_MODEL, SAMPLE_TECH, SAMPLE_PRODUCT);
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 100);
  });

  test('system prompt instructs grounding hedged direction in observed pace', () => {
    const messages = buildRoadmapTrajectoryMessages(PACE_MODEL, SAMPLE_TECH, SAMPLE_PRODUCT);
    const system = messages[0].content;
    assert.ok(/DELIVERY PACE/.test(system),
      'should reference the DELIVERY PACE block');
    assert.ok(/observed|measurement of the past|not a forecast/i.test(system),
      'should frame pace as observed measurement, not a forecast');
  });

  test('user message embeds the observed delivery pace block', () => {
    const messages = buildRoadmapTrajectoryMessages(PACE_MODEL, SAMPLE_TECH, SAMPLE_PRODUCT);
    const user = messages[1].content;
    assert.ok(/DELIVERY PACE/.test(user), 'pace block must reach the model');
    assert.ok(/Velocity trend: increasing/.test(user), 'should surface velocity trend');
    assert.ok(/Recent shift/.test(user), 'should surface recent velocity shift');
    assert.ok(/cycle time/i.test(user), 'should surface cycle time');
  });
});

// =============================================================================
// Trajectory delivery-pace summary (Win #2 — temporal signals)
// =============================================================================

describe('summarizeTrajectoryPace', () => {
  test('surfaces tasks/week, trend, recent shift, and cycle time when present', () => {
    const pace = summarizeTrajectoryPace(PACE_MODEL);
    assert.ok(/DELIVERY PACE/.test(pace));
    assert.ok(/Tasks shipped per week \(90-day avg\): 4/.test(pace));
    assert.ok(/Velocity trend: increasing/.test(pace));
    // last 2 weeks (5,6 -> 5.5) vs prior 2 (2,3 -> 2.5) = up 120%
    assert.ok(/Recent shift: last 2 weeks 5.5\/wk vs prior 2 weeks 2.5\/wk \(up 120%\)/.test(pace),
      `recent shift line missing/wrong:\n${pace}`);
    // cycle times 9d and 4d -> median 9, avg 6.5
    assert.ok(/Typical cycle time: 9d median \(avg 6.5d, sample 2 tasks\)/.test(pace),
      `cycle time line missing/wrong:\n${pace}`);
  });

  test('degrades to just the average when temporal signals are sparse', () => {
    const pace = summarizeTrajectoryPace(SAMPLE_MODEL);
    assert.ok(/DELIVERY PACE/.test(pace));
    assert.ok(/Tasks shipped per week \(90-day avg\): 4/.test(pace));
    // No trend, weeklyData, or createdAt timestamps -> no shift/cycle-time lines
    assert.ok(!/Recent shift/.test(pace), 'should omit shift when no weekly data');
    assert.ok(!/cycle time/i.test(pace), 'should omit cycle time when no created timestamps');
  });

  test('does not throw on an empty model', () => {
    assert.doesNotThrow(() => summarizeTrajectoryPace({}));
  });
});

// =============================================================================
// Layer 3b — North star reading
// =============================================================================

describe('buildRoadmapNorthStarMessages (layer 3b — north star reading)', () => {
  test('returns [system, user] messages array', () => {
    const messages = buildRoadmapNorthStarMessages(SAMPLE_MODEL, SAMPLE_NORTH_STAR);
    assert.ok(Array.isArray(messages));
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[1].role, 'user');
  });

  test('system prompt uses critical evaluator persona', () => {
    const messages = buildRoadmapNorthStarMessages(SAMPLE_MODEL, SAMPLE_NORTH_STAR);
    const system = messages[0].content;
    assert.ok(/evaluator|critical|rubric|not a cheerleader/i.test(system),
      'should reference critical evaluator / not-a-cheerleader persona');
  });

  test('system prompt fixes the north star (forbids reinterpreting it)', () => {
    const messages = buildRoadmapNorthStarMessages(SAMPLE_MODEL, SAMPLE_NORTH_STAR);
    const system = messages[0].content;
    assert.ok(/north star is fixed|never how the north star/i.test(system),
      'should instruct that north star is fixed, not revised to match work');
  });

  test('system prompt allows flagging vague north star parts', () => {
    const messages = buildRoadmapNorthStarMessages(SAMPLE_MODEL, SAMPLE_NORTH_STAR);
    const system = messages[0].content;
    assert.ok(/too vague|vague to score|cannot score|cannot judge/i.test(system),
      'should allow the model to flag vague north star parts');
  });

  test('system prompt requires per-project alignment classification', () => {
    const messages = buildRoadmapNorthStarMessages(SAMPLE_MODEL, SAMPLE_NORTH_STAR);
    const system = messages[0].content;
    assert.ok(/aligned/i.test(system) && /drift/i.test(system),
      'should require per-project classification including aligned/drift labels');
    assert.ok(/maintenance|archive/i.test(system),
      'should include maintenance and/or archive classifications');
  });

  test('user message contains north star verbatim', () => {
    const messages = buildRoadmapNorthStarMessages(SAMPLE_MODEL, SAMPLE_NORTH_STAR);
    const user = messages[1].content;
    assert.ok(user.includes(SAMPLE_NORTH_STAR),
      'north star must be embedded verbatim so the model judges against it');
  });

  test('user message contains summarized roadmap data', () => {
    const messages = buildRoadmapNorthStarMessages(SAMPLE_MODEL, SAMPLE_NORTH_STAR);
    const user = messages[1].content;
    assert.ok(user.includes('Harbour OS'),
      'should include project names from the data summary');
  });

  test('honors cross-cutting rules', () => {
    const messages = buildRoadmapNorthStarMessages(SAMPLE_MODEL, SAMPLE_NORTH_STAR);
    assertCrossCuttingRules(messages[0].content, 'layer 3b');
  });

  test('backward-compatible buildRoadmapNorthStarPrompt returns a string', () => {
    const prompt = buildRoadmapNorthStarPrompt(SAMPLE_MODEL, SAMPLE_NORTH_STAR);
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 100);
  });
});

// =============================================================================
// Layer 4 — Gap analysis
// =============================================================================

describe('buildRoadmapGapMessages (layer 4 — gap)', () => {
  test('returns [system, user] messages array', () => {
    const messages = buildRoadmapGapMessages(SAMPLE_NORTH_STAR, SAMPLE_TRAJECTORY, SAMPLE_NS_READING);
    assert.ok(Array.isArray(messages));
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[1].role, 'user');
  });

  test('system prompt uses advisor persona (presents findings, does not resolve)', () => {
    const messages = buildRoadmapGapMessages(SAMPLE_NORTH_STAR, SAMPLE_TRAJECTORY, SAMPLE_NS_READING);
    const system = messages[0].content;
    assert.ok(/advisor|flagging|present/i.test(system),
      'should reference advisor / flagging-not-resolving persona');
  });

  test('system prompt forbids resolving tensions in either direction', () => {
    const messages = buildRoadmapGapMessages(SAMPLE_NORTH_STAR, SAMPLE_TRAJECTORY, SAMPLE_NS_READING);
    const system = messages[0].content;
    assert.ok(/tensions for a human|do not propose|surface tensions|never resolve/i.test(system),
      'should explicitly forbid resolving — must flag tensions for human adjudication');
  });

  test('system prompt requires agree / diverge / questions structure', () => {
    const messages = buildRoadmapGapMessages(SAMPLE_NORTH_STAR, SAMPLE_TRAJECTORY, SAMPLE_NS_READING);
    const system = messages[0].content;
    assert.ok(/agree/i.test(system) && /diverge/i.test(system) && /question/i.test(system),
      'should require agree / diverge / questions structure');
  });

  test('system prompt warns against false alignment and false divergence', () => {
    const messages = buildRoadmapGapMessages(SAMPLE_NORTH_STAR, SAMPLE_TRAJECTORY, SAMPLE_NS_READING);
    const system = messages[0].content;
    assert.ok(/false align|largely agree|say so plainly/i.test(system),
      'should warn against manufacturing conflict (false alignment guard)');
    assert.ok(/false diverg|specific phrase|specific work|no vague/i.test(system),
      'should warn against vague divergence claims');
  });

  test('system prompt caps output length', () => {
    const messages = buildRoadmapGapMessages(SAMPLE_NORTH_STAR, SAMPLE_TRAJECTORY, SAMPLE_NS_READING);
    const system = messages[0].content;
    assert.ok(/200|300|short|concise|word/i.test(system),
      'should cap output around 200-300 words per design doc');
  });

  test('user message embeds north star, trajectory, and north star reading', () => {
    const messages = buildRoadmapGapMessages(SAMPLE_NORTH_STAR, SAMPLE_TRAJECTORY, SAMPLE_NS_READING);
    const user = messages[1].content;
    assert.ok(user.includes(SAMPLE_NORTH_STAR), 'must embed north star');
    assert.ok(user.includes(SAMPLE_TRAJECTORY), 'must embed trajectory reading');
    assert.ok(user.includes(SAMPLE_NS_READING), 'must embed north star reading');
  });

  test('honors cross-cutting rules', () => {
    const messages = buildRoadmapGapMessages(SAMPLE_NORTH_STAR, SAMPLE_TRAJECTORY, SAMPLE_NS_READING);
    assertCrossCuttingRules(messages[0].content, 'layer 4');
  });

  test('backward-compatible buildRoadmapGapPrompt returns a string', () => {
    const prompt = buildRoadmapGapPrompt(SAMPLE_NORTH_STAR, SAMPLE_TRAJECTORY, SAMPLE_NS_READING);
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 100);
  });
});
