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
import {
  buildRoadmapDigestMessages,
  buildRoadmapDigestPrompt,
  summarizeRoadmapPosition
} from '../../lib/prompts/roadmap-digest-template.js';

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

  test('embeds prior readings as descriptive context when provided', () => {
    const messages = buildRoadmapNorthStarMessages(SAMPLE_MODEL, SAMPLE_NORTH_STAR, {
      tech: 'TECH-NARRATIVE-MARKER',
      product: 'PRODUCT-NARRATIVE-MARKER'
    });
    const user = messages[1].content;
    assert.ok(user.includes('TECH-NARRATIVE-MARKER'), 'should embed the technical narrative');
    assert.ok(user.includes('PRODUCT-NARRATIVE-MARKER'), 'should embed the product perspective');
    assert.ok(/descriptive context|do not (let|defer)|anchor/i.test(user),
      'should frame prior readings as non-authoritative context');
  });

  test('system prompt no longer forbids prior layers; warns against anchoring instead', () => {
    const system = buildRoadmapNorthStarMessages(SAMPLE_MODEL, SAMPLE_NORTH_STAR)[0].content;
    assert.ok(!/read fresh from the source data/i.test(system), 'should drop the read-fresh prohibition');
    assert.ok(/anchor|defer|descriptive context/i.test(system), 'should warn against anchoring on prior readings');
  });

  test('omits the prior-readings block when none are given', () => {
    const messages = buildRoadmapNorthStarMessages(SAMPLE_MODEL, SAMPLE_NORTH_STAR);
    assert.ok(!/PRODUCT PERSPECTIVE \(layer 2\)/.test(messages[1].content),
      'no prior-readings block without tech/product');
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

  test('embeds the underlying roadmap data for re-grounding when the model is provided', () => {
    const messages = buildRoadmapGapMessages(SAMPLE_NORTH_STAR, SAMPLE_TRAJECTORY, SAMPLE_NS_READING, SAMPLE_MODEL);
    const user = messages[1].content;
    assert.ok(/UNDERLYING ROADMAP DATA|re-ground/i.test(user), 'should label an underlying-data block');
    assert.ok(user.includes('Harbour OS'), 'should include project names from the data summary');
  });

  test('omits the data block when no model is provided (prose-only fallback)', () => {
    const messages = buildRoadmapGapMessages(SAMPLE_NORTH_STAR, SAMPLE_TRAJECTORY, SAMPLE_NS_READING);
    assert.ok(!/UNDERLYING ROADMAP DATA/.test(messages[1].content), 'no data block without a model');
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

// =============================================================================
// Digest — the at-a-glance synthesis layer (generates last, renders first)
// =============================================================================

describe('buildRoadmapDigestMessages (digest — synthesis layer)', () => {
  const FULL_INPUTS = {
    northStar: SAMPLE_NORTH_STAR,
    technical: SAMPLE_TECH,
    product: SAMPLE_PRODUCT,
    trajectory: SAMPLE_TRAJECTORY,
    nsReading: SAMPLE_NS_READING,
    gap: 'Where they agree: onboarding. Where they diverge: none material. Questions: should mini-foreman serve intent-legibility?'
  };

  // A model in the shape projectTimeline() actually produces (LIN-1110): every
  // milestone carries the five forecast fields house policy keeps out of this
  // layer. "Dormant Atlas" is listed FIRST and is the larger, further-along
  // project — but it has nothing in flight, so the activity ranking must put
  // "Harbour OS" ahead of it.
  const POSITION_MODEL = {
    velocity: { tasksPerWeek: 4, pointsPerWeek: 7 },
    milestones: [
      {
        name: 'Dormant Atlas',
        progressPercent: 90,
        totalTasks: 20,
        remainingTasks: 2,
        completedTasks: 18,
        tasksInQueue: [{ stateType: 'unstarted' }, { stateType: 'unstarted' }],
        projectedStart: '2026-07-27T00:00:00.000Z',
        projectedEnd: '2026-09-14T00:00:00.000Z',
        weeksRemaining: 7,
        confidenceLow: 4,
        confidenceHigh: 10
      },
      {
        name: 'Harbour OS',
        progressPercent: 40,
        totalTasks: 10,
        remainingTasks: 6,
        completedTasks: 4,
        tasksInQueue: [
          { stateType: 'started' },
          { stateType: 'unstarted', subtasks: [{ stateType: 'started' }] },
          { stateType: 'unstarted' }
        ],
        projectedStart: '2026-07-27T00:00:00.000Z',
        projectedEnd: '2026-11-02T00:00:00.000Z',
        weeksRemaining: 14,
        confidenceLow: 10,
        confidenceHigh: 18
      }
    ],
    criticalPaths: new Map([
      ['Harbour OS', { path: ['a', 'b', 'c'], length: 3, blockers: ['a'] }],
      ['Dormant Atlas', { path: [], length: 0, blockers: [] }]
    ])
  };

  // Prose inputs deliberately free of dates and week-words, so a leak assertion
  // over the whole message cannot false-fail on the layers being synthesised.
  const LEAK_SAFE_INPUTS = {
    technical: 'Shipped the onboarding flow. Two tasks are blocked on review.',
    product: 'Harbour OS consolidates the new-user pathway.'
  };

  test('returns [system, user] messages array', () => {
    const messages = buildRoadmapDigestMessages(FULL_INPUTS);
    assert.ok(Array.isArray(messages));
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[1].role, 'user');
  });

  test('asks for a connected narrative lede, not a labelled four-slot form (LIN-416)', () => {
    const system = buildRoadmapDigestMessages(FULL_INPUTS)[0].content;
    // The story is told as flowing prose — the digest must NOT re-impose the old
    // mandate to emit verbatim labelled slots. (The labels may still appear as
    // *forbidden* examples, so assert on the mandate phrasing, not the substring.)
    assert.ok(!/Emit EXACTLY the four labelled slots/i.test(system),
      'digest must not mandate verbatim labelled slots');
    assert.ok(/connected narrative|flowing prose|tell the story|throughline/i.test(system),
      'digest should ask for a connected narrative, not a form');
    assert.ok(/no field labels|not.*(a form|labelled)|no labelled slots/i.test(system),
      'digest should explicitly forbid field labels in the output');
  });

  test('covers the six story beats including position and the two split forces (LIN-1110)', () => {
    const system = buildRoadmapDigestMessages(FULL_INPUTS)[0].content;
    assert.ok(/what we shipped|shipped/i.test(system), 'should cover what shipped');
    assert.ok(/where we are along the roadmap|roadmap position/i.test(system),
      'should cover where we are along the roadmap (the new position beat)');
    assert.ok(/where this is heading|direction of travel|heading/i.test(system),
      'should cover where the work is heading');
    assert.ok(/pulling us sideways/i.test(system), 'should cover what is pulling us sideways');
    assert.ok(/slowing us down/i.test(system), 'should cover what is slowing us down');
    assert.ok(/the one decision|single open question/i.test(system), 'should cover the one decision');
  });

  test('reasons internally but does not print the reasoning (LIN-416)', () => {
    const system = buildRoadmapDigestMessages(FULL_INPUTS)[0].content;
    assert.ok(/think first|work through the layers|reason/i.test(system),
      'should instruct the model to reason over the layers before writing');
    assert.ok(/do not print|no reasoning section/i.test(system),
      'should keep that reasoning out of the visible output');
  });

  test('grants hedged optimism about the far outlook for the heading beat (LIN-416)', () => {
    const system = buildRoadmapDigestMessages(FULL_INPUTS)[0].content;
    assert.ok(/optimistic about the far outlook|permission to be optimistic/i.test(system),
      'heading beat should allow earned optimism about the far outlook');
    assert.ok(/hedged|at this pace|points toward/i.test(system),
      'heading must stay hedged — direction, not forecast');
  });

  test('system prompt forbids a reasoning section and preamble (lede only)', () => {
    const system = buildRoadmapDigestMessages(FULL_INPUTS)[0].content;
    assert.ok(/no reasoning section|no preamble/i.test(system),
      'digest must not emit a reasoning block — it is a clean lede');
  });

  test('splits the risk beat into sideways pull and delivery friction, each with its own sources (LIN-1110)', () => {
    const system = buildRoadmapDigestMessages(FULL_INPUTS)[0].content;

    // The two forces are separate beats now, not one unified risk sentence.
    assert.ok(!/unif/i.test(system), 'must not still instruct unifying the two risk kinds');

    const sideways = system.match(/- What's pulling us sideways:[^\n]*/)?.[0];
    const friction = system.match(/- What's slowing us down:[^\n]*/)?.[0];
    assert.ok(sideways, 'should carry a distinct pulling-us-sideways beat');
    assert.ok(friction, 'should carry a distinct slowing-us-down beat');

    // Each names its own sources: sideways ← north-star reading / gap analysis,
    // slowing-down ← the technical narrative.
    assert.ok(/north.star reading/i.test(sideways) && /gap analysis/i.test(sideways),
      'sideways beat should draw from the north-star reading and the gap analysis');
    assert.ok(/(alignment|drift)/i.test(sideways), 'sideways beat should be the alignment force');
    assert.ok(/technical narrative/i.test(friction),
      'slowing-down beat should draw from the technical narrative');
    assert.ok(/blocker|stale|bottleneck/i.test(friction),
      'slowing-down beat should be the delivery-friction force');

    // Two beats create two slots to fill — the anti-manufacture escape must be
    // present in EACH, or the split trades one vague risk for two invented ones.
    assert.ok(/do not manufacture one/i.test(sideways),
      'sideways beat must keep the do-not-manufacture escape');
    assert.ok(/do not manufacture one/i.test(friction),
      'slowing-down beat must keep the do-not-manufacture escape');
  });

  test('THE DECISION slot escalates the open question without answering it', () => {
    const system = buildRoadmapDigestMessages(FULL_INPUTS)[0].content;
    assert.ok(/decision/i.test(system) && /do not answer/i.test(system),
      'should ask for the open decision and forbid answering it');
  });

  test('states the same length budget in BOTH messages, and the old cap in neither (LIN-1110)', () => {
    // The budget lives twice — once in the system prompt, once in the user
    // message's closing line — in two different messages. A guard that reads
    // only messages[0] lets them drift, which is how the old ~150 could have
    // survived at the user end while the system prompt said 250.
    const [system, user] = buildRoadmapDigestMessages(FULL_INPUTS).map(m => m.content);

    assert.ok(/250/.test(system), 'system prompt should state the ~250-word target');
    assert.ok(/250/.test(user), 'user message should state the ~250-word target');
    assert.ok(/320/.test(system), 'system prompt should state the ~320-word ceiling');

    // Phrase-matched, not a bare /150/, so an unrelated future number cannot
    // false-fail this.
    assert.ok(!/~?\s*150\s*words/i.test(system) && !/~?\s*150\s*words/i.test(user),
      'the old ~150-word cap must be gone from both messages');

    // The number is derived from this intent sentence; they must stay together.
    assert.ok(/absorb in under a minute/i.test(system),
      'the governing "under a minute" intent must survive the re-derivation');
  });

  test('user message embeds the prior layers it synthesises', () => {
    const user = buildRoadmapDigestMessages(FULL_INPUTS)[1].content;
    assert.ok(user.includes(SAMPLE_TECH), 'must embed technical narrative');
    assert.ok(user.includes(SAMPLE_PRODUCT), 'must embed product perspective');
    assert.ok(user.includes(SAMPLE_TRAJECTORY), 'must embed trajectory');
    assert.ok(user.includes(SAMPLE_NS_READING), 'must embed north star reading');
    assert.ok(user.includes(SAMPLE_NORTH_STAR), 'must embed the north star itself');
  });

  test('honors cross-cutting rules', () => {
    assertCrossCuttingRules(buildRoadmapDigestMessages(FULL_INPUTS)[0].content, 'digest');
  });

  test('degrades cleanly with no north star (sideways beat suppressed, friction only) (LIN-1110)', () => {
    const messages = buildRoadmapDigestMessages({
      technical: SAMPLE_TECH,
      product: SAMPLE_PRODUCT,
      trajectory: SAMPLE_TRAJECTORY
      // no northStar / nsReading / gap
    });
    const system = messages[0].content;
    const user = messages[1].content;

    // The sideways beat draws EXCLUSIVELY from the north-star reading and the
    // gap analysis, neither of which exists here — so it is suppressed, not
    // redrawn from delivery signals. The beat bullet itself stays in THE STORY
    // TO TELL unconditionally by design, so /pulling us sideways/ alone proves
    // nothing: the discriminating assertion is the skip instruction inside the
    // no-north-star clause, matched as one clause rather than three loose ORs.
    const clause = system.match(/- No north star is set[^\n]*/)?.[0];
    assert.ok(clause, 'system should acknowledge the missing north star');
    assert.ok(/skip[^\n]*pulling us sideways|pulling us sideways[^\n]*(skip|omit)/i.test(clause),
      'the clause must tell the model to skip the pulling-us-sideways beat');
    assert.ok(/omit it rather than drawing it from delivery/i.test(clause),
      'suppression must be explicit about not substituting delivery signals');
    assert.ok(/no alignment decision is forced/i.test(clause),
      'the decision half of the clause must survive unchanged in substance');
    assert.ok(/slowing us down/i.test(clause),
      'the delivery-friction beat still applies and should be said so');

    // The abolished wording must not coexist with the new rule.
    assert.ok(!/delivery risk only/i.test(system),
      'the old unified "delivery risk only" instruction must be gone');

    // The user message must not fabricate empty NS sections.
    assert.ok(!/NORTH STAR READING/.test(user), 'should omit the ns-reading section when absent');
    assert.ok(!/GAP ANALYSIS/.test(user), 'should omit the gap section when absent');
  });

  // ---------------------------------------------------------------------------
  // The deterministic position input (LIN-1110)
  // ---------------------------------------------------------------------------

  test('embeds a deterministic position block when a roadmap model is supplied (LIN-1110)', () => {
    const [system, user] = buildRoadmapDigestMessages({ ...FULL_INPUTS, roadmapModel: POSITION_MODEL })
      .map(m => m.content);

    assert.ok(/ROADMAP POSITION \(deterministic/.test(user),
      'user message should carry a labelled deterministic position section');
    assert.ok(/Harbour OS: 40% complete \(4\/10 tasks done, 6 remaining, 2 in progress\)/.test(user),
      'position block should carry the whitelisted current-state counts');
    assert.ok(/Harbour OS: 3 tasks deep, 1 blockers/.test(user),
      'position block should carry critical-path depth from the Map');
    assert.ok(!/Dormant Atlas: 0 tasks deep/.test(user),
      'critical paths of length <= 1 are not meaningful and must be filtered out');

    // Deterministic ground truth precedes the prose interpreting it.
    assert.ok(user.indexOf('ROADMAP POSITION') < user.indexOf('TECHNICAL NARRATIVE'),
      'the position section must be ordered first');

    // The beat is told to use the figures, and told what it may never do with them.
    assert.ok(/citing at least one concrete number/i.test(system),
      'position beat should require a concrete figure when one is available');
    assert.ok(/NEVER turn these figures into a date, an ETA, a number of weeks remaining/i.test(system),
      'position beat must forbid converting the figures into a forecast');
  });

  test('ranks the position block by activity, not input order or size (LIN-1110)', () => {
    const block = summarizeRoadmapPosition(POSITION_MODEL);
    const names = block.split('\n')
      .map(l => l.match(/^ {2}(.+?):/)?.[1])
      .filter(n => n === 'Harbour OS' || n === 'Dormant Atlas');

    // "Dormant Atlas" is listed first in the model and is bigger and further
    // along; "Harbour OS" has work in flight, so it must lead.
    assert.strictEqual(names[0], 'Harbour OS', 'the most active project must be ranked first');
    assert.ok(names.includes('Dormant Atlas'), 'the other projects are still listed');

    // The prompt is what enforces brevity over the ranked list.
    const system = buildRoadmapDigestMessages({ ...FULL_INPUTS, roadmapModel: POSITION_MODEL })[0].content;
    assert.ok(/lead with the first project named there/i.test(system),
      'the prompt should tell the model to lead with the ranked-first project');
    assert.ok(/do not enumerate a percentage for every project/i.test(system),
      'the prompt should forbid listing every project');
  });

  test('the position whitelist leaks no forecast field (LIN-1110)', () => {
    const block = summarizeRoadmapPosition(POSITION_MODEL);
    const [system, user] = buildRoadmapDigestMessages({ ...LEAK_SAFE_INPUTS, roadmapModel: POSITION_MODEL })
      .map(m => m.content);
    const both = `${system}\n${user}`;

    // Field names and their values — neither may reach the prompt.
    for (const key of ['projectedStart', 'projectedEnd', 'weeksRemaining', 'confidenceLow', 'confidenceHigh']) {
      assert.ok(!both.includes(key), `forecast field name "${key}" must not reach the prompt`);
    }
    for (const value of ['2026-09-14', '2026-11-02', '2026-07-27']) {
      assert.ok(!both.includes(value), `projected date "${value}" must not reach the prompt`);
    }
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(both), 'no ISO-date-shaped string may reach the prompt');

    // "weeks" is asserted against the BLOCK, not the whole prompt: the system
    // prompt legitimately uses the word inside its own prohibition.
    assert.ok(!/week/i.test(block), 'the position block must carry no week counts');
    assert.ok(!/confidence/i.test(block), 'the position block must carry no confidence range');
    assert.ok(!/tasksPerWeek|pointsPerWeek/.test(both),
      'velocity is excluded — a rate invites forecasting by arithmetic');
  });

  test('softens the position beat and omits the section when there is no model (LIN-1110)', () => {
    const cases = [
      ['no roadmapModel', {}],
      ['empty milestones', { roadmapModel: { milestones: [] } }],
      ['empty model', { roadmapModel: {} }]
    ];

    for (const [label, extra] of cases) {
      const messages = buildRoadmapDigestMessages({ ...FULL_INPUTS, ...extra });
      assert.strictEqual(messages.length, 2, `${label}: still a valid two-message array`);
      const [system, user] = messages.map(m => m.content);

      assert.ok(!/ROADMAP POSITION/.test(user),
        `${label}: must never emit an empty labelled position section`);
      assert.ok(/where we are along the roadmap/i.test(system),
        `${label}: the position beat is softened, not dropped`);
      assert.ok(/describe it qualitatively/i.test(system),
        `${label}: the softened beat should read position from the prose`);
      assert.ok(/Do not state figures you were not given/i.test(system),
        `${label}: the softened beat must forbid inventing figures`);
    }
  });

  test('composes the two degradations independently — no north star AND no position (LIN-1110)', () => {
    const [system, user] = buildRoadmapDigestMessages({
      technical: SAMPLE_TECH,
      product: SAMPLE_PRODUCT,
      trajectory: SAMPLE_TRAJECTORY
      // no northStar / nsReading / gap, and no roadmapModel — the furthest
      // degradation: the fresh-workspace shape, a five-beat delivery-only digest
      // with a prose-sourced position beat.
    }).map(m => m.content);

    const clause = system.match(/- No north star is set[^\n]*/)?.[0];
    assert.ok(clause && /skip/i.test(clause), 'sideways beat suppressed');
    assert.ok(/describe it qualitatively/i.test(system), 'position beat softened');
    assert.ok(!/ROADMAP POSITION/.test(user), 'no position section');
    assert.ok(/slowing us down/i.test(system), 'the friction beat survives both degradations');
    assert.ok(/what we shipped/i.test(system) && /the one decision/i.test(system),
      'the remaining beats are unaffected');
  });

  test('caps the position block at five projects with a tail line (LIN-1110)', () => {
    const many = {
      milestones: Array.from({ length: 7 }, (_, i) => ({
        name: `Project ${i}`,
        progressPercent: i * 10,
        totalTasks: 10,
        remainingTasks: 10 - i,
        completedTasks: i
      }))
    };
    const block = summarizeRoadmapPosition(many);
    const projectLines = block.split('\n').filter(l => /^ {2}Project \d/.test(l));

    assert.strictEqual(projectLines.length, 5, 'at most five projects are listed');
    assert.ok(/\+2 more projects not listed/.test(block), 'the remainder collapses to a tail line');
  });

  test('summarizeRoadmapPosition is total — never throws, returns "" when empty (LIN-1110)', () => {
    assert.strictEqual(summarizeRoadmapPosition(undefined), '');
    assert.strictEqual(summarizeRoadmapPosition(null), '');
    assert.strictEqual(summarizeRoadmapPosition({}), '');
    assert.strictEqual(summarizeRoadmapPosition({ milestones: [] }), '');
    assert.strictEqual(summarizeRoadmapPosition({ milestones: null, criticalPaths: null }), '');

    // A milestone missing every field must still render rather than throw.
    const bare = summarizeRoadmapPosition({ milestones: [{}] });
    assert.ok(/Untitled: 0% complete \(0\/0 tasks done, 0 remaining, 0 in progress\)/.test(bare));

    // criticalPaths as a plain object is handled identically to a Map.
    const asObject = summarizeRoadmapPosition({
      criticalPaths: { 'Harbour OS': { length: 4 } }
    });
    assert.ok(/Harbour OS: 4 tasks deep, 0 blockers/.test(asObject),
      'plain-object criticalPaths and a missing blockers array both degrade');
  });

  test('backward-compatible buildRoadmapDigestPrompt returns a string', () => {
    const prompt = buildRoadmapDigestPrompt(FULL_INPUTS);
    assert.strictEqual(typeof prompt, 'string');
    assert.ok(prompt.length > 100);
  });
});
