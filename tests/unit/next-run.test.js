/**
 * Unit tests for lib/next-run.js (LIN-603).
 *
 * Run with: node --test tests/unit/next-run.test.js
 *
 * Coverage:
 *   - formatNextRunContext renders velocity, in-progress work, and the queue
 *   - buildNextRunMessages shape (system + user)
 *   - normalizeSize coercion
 *   - parseGoalSuggestions: clean JSON, fenced, prose-wrapped, garbage, size
 *     coercion, empty-goal drop, cap
 *   - generateGoalSuggestions always appends the continue-until-stopped option
 */
import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  formatNextRunContext,
  buildNextRunMessages,
  buildNextRunSummary,
  parseGoalSuggestions,
  parseNextRunResponse,
  ensureSizeCoverage,
  normalizeSize,
  generateGoalSuggestions,
  resolveRoadmapNarrative,
  ROADMAP_REPORT_MAX_AGE_DAYS,
  CONTINUE_UNTIL_STOPPED_OPTION,
  REQUIRED_SIZES,
  TSHIRT_SIZES,
} from '../../lib/next-run.js';
import { buildRoadmapModel } from '../../lib/roadmap.js';

const MODEL = {
  velocity: { tasksPerWeek: 3.5, pointsPerWeek: 8, trend: 'increasing' },
  executionQueue: [
    { identifier: 'LIN-10', title: 'In-flight work', stateType: 'started', priority: 1, projectName: 'Core', labels: [] },
    { identifier: 'LIN-11', title: 'Next up', stateType: 'unstarted', priority: 2, projectName: 'Core', labels: ['bug'] },
  ],
  milestones: [{ projectName: 'Core', subtaskDone: 4, subtaskTotal: 10 }],
};

// A richer model exercising the enriched context sections (LIN-638): ids +
// blocking edges + parent, plus criticalPaths / risks / analysis as the real
// buildRoadmapModel emits them.
const RICH_MODEL = {
  velocity: { tasksPerWeek: 2, pointsPerWeek: 5, trend: 'decreasing' },
  executionQueue: [
    { id: 'a', identifier: 'LIN-1', title: 'Blocker', stateType: 'started', priority: 1, projectName: 'Core', labels: [], blocksIds: ['b'] },
    { id: 'b', identifier: 'LIN-2', title: 'Blocked work', stateType: 'unstarted', priority: 2, projectName: 'Core', labels: [], blocksIds: [], parentId: 'a' },
  ],
  criticalPaths: new Map([['Core', { path: ['a', 'b'], length: 2, blockers: ['a'] }]]),
  risks: [{ type: 'overdue', severity: 'high', description: 'Projected completion exceeds due date.', milestone: 'Core' }],
  analysis: {
    cycleTime: { medianDays: 3, avgDays: 4.2, sampleSize: 7 },
    velocityShift: { recentAvg: 1.5, priorAvg: 3, pctChange: -50 },
    staleTasks: [{ title: 'old one', ageDays: 30, milestone: 'Core' }],
  },
  milestones: [{ projectName: 'Core', subtaskDone: 1, subtaskTotal: 2 }],
};

describe('formatNextRunContext', () => {
  test('renders velocity, in-progress, queue, and milestones', () => {
    const out = formatNextRunContext(MODEL, 'Acme');
    assert.match(out, /Workspace: Acme/);
    assert.match(out, /3\.5 tasks\/week/);
    assert.match(out, /increasing/);
    assert.match(out, /In progress now/);
    assert.match(out, /LIN-10/);
    assert.match(out, /Top of the execution queue/);
    assert.match(out, /LIN-11/);
    assert.match(out, /Core — 4\/10 done/);
  });

  test('handles an empty queue without throwing', () => {
    const out = formatNextRunContext({ velocity: {}, executionQueue: [], milestones: [] });
    assert.match(out, /nothing is currently started/);
  });

  test('tolerates a null/garbage model', () => {
    assert.equal(typeof formatNextRunContext(null), 'string');
    assert.equal(typeof formatNextRunContext(undefined), 'string');
  });

  test('enriches with relationships, critical paths, risks, and health (LIN-638)', () => {
    const out = formatNextRunContext(RICH_MODEL, 'Acme');
    // Per-card relationship clauses resolved to identifiers.
    assert.match(out, /LIN-1 — Blocker.*blocks LIN-2/);
    assert.match(out, /LIN-2 — Blocked work.*blocked by LIN-1; subtask of LIN-1/);
    // Dependency chain section.
    assert.match(out, /Dependency chains/);
    assert.match(out, /Core: LIN-1 → LIN-2/);
    // Risks.
    assert.match(out, /Risks flagged \(1\)/);
    assert.match(out, /\[high\] Projected completion/);
    // Delivery health from the analysis.
    assert.match(out, /Median cycle time: 3 days/);
    assert.match(out, /Velocity shift: 1\.5\/wk recent vs 3\/wk prior \(-50%\)/);
    assert.match(out, /Stale in progress: 1 task/);
  });

  test('omits enrichment sections cleanly when the model lacks them', () => {
    // The simple MODEL has no criticalPaths/risks/analysis — no headers leak.
    const out = formatNextRunContext(MODEL, 'Acme');
    assert.doesNotMatch(out, /Dependency chains/);
    assert.doesNotMatch(out, /Risks flagged/);
    assert.doesNotMatch(out, /Delivery health/);
  });
});

describe('resolveRoadmapNarrative (LIN-742)', () => {
  const NOW = Date.UTC(2026, 5, 27); // fixed clock for deterministic ages
  const iso = daysAgo => new Date(NOW - daysAgo * 86400000).toISOString();
  const report = (overrides = {}) => ({
    generatedAt: iso(2),
    narrative: { digest: 'Digest synthesis.', trajectory: 'Trajectory reading.' },
    ...overrides,
  });

  test('returns the digest + age for a fresh report (digest preferred)', () => {
    const out = resolveRoadmapNarrative(report(), { now: NOW });
    assert.equal(out.text, 'Digest synthesis.');
    assert.equal(out.ageDays, 2);
  });

  test('falls back to trajectory when there is no digest', () => {
    const out = resolveRoadmapNarrative(report({ narrative: { trajectory: 'Only trajectory.' } }), { now: NOW });
    assert.equal(out.text, 'Only trajectory.');
  });

  test('omits (null) a report older than the freshness window', () => {
    const out = resolveRoadmapNarrative(report({ generatedAt: iso(ROADMAP_REPORT_MAX_AGE_DAYS + 1) }), { now: NOW });
    assert.equal(out, null);
  });

  test('keeps a report exactly at the window boundary', () => {
    const out = resolveRoadmapNarrative(report({ generatedAt: iso(ROADMAP_REPORT_MAX_AGE_DAYS) }), { now: NOW });
    assert.ok(out);
    assert.equal(out.ageDays, ROADMAP_REPORT_MAX_AGE_DAYS);
  });

  test('respects a custom maxAgeDays override', () => {
    assert.equal(resolveRoadmapNarrative(report({ generatedAt: iso(5) }), { now: NOW, maxAgeDays: 3 }), null);
    assert.ok(resolveRoadmapNarrative(report({ generatedAt: iso(5) }), { now: NOW, maxAgeDays: 7 }));
  });

  test('returns null for absent report, missing/invalid date, no prose, or future date', () => {
    assert.equal(resolveRoadmapNarrative(null, { now: NOW }), null);
    assert.equal(resolveRoadmapNarrative({}, { now: NOW }), null);
    assert.equal(resolveRoadmapNarrative(report({ generatedAt: 'not-a-date' }), { now: NOW }), null);
    assert.equal(resolveRoadmapNarrative(report({ narrative: {} }), { now: NOW }), null);
    assert.equal(resolveRoadmapNarrative(report({ narrative: { digest: '   ' } }), { now: NOW }), null);
    assert.equal(resolveRoadmapNarrative(report({ generatedAt: iso(-1) }), { now: NOW }), null);
  });

  test('truncates an oversized narrative to keep the prompt lean', () => {
    const out = resolveRoadmapNarrative(report({ narrative: { digest: 'x'.repeat(10000) } }), { now: NOW });
    assert.ok(out.text.length <= 4000);
  });
});

describe('formatNextRunContext roadmap section (LIN-742)', () => {
  test('appends a dated Roadmap analysis section when a narrative is supplied', () => {
    const out = formatNextRunContext(MODEL, 'Acme', { text: 'The north star is X.', ageDays: 3 });
    assert.match(out, /Roadmap analysis \(generated 3 days ago\):/);
    assert.match(out, /The north star is X\./);
  });

  test('says "today" at age 0 and singularises "1 day ago"', () => {
    assert.match(formatNextRunContext(MODEL, 'Acme', { text: 'n', ageDays: 0 }), /generated today/);
    assert.match(formatNextRunContext(MODEL, 'Acme', { text: 'n', ageDays: 1 }), /generated 1 day ago/);
  });

  test('omits the section entirely when no narrative is supplied', () => {
    assert.doesNotMatch(formatNextRunContext(MODEL, 'Acme'), /Roadmap analysis/);
    assert.doesNotMatch(formatNextRunContext(MODEL, 'Acme', null), /Roadmap analysis/);
  });
});

describe('NEXT_RUN_SYSTEM_PROMPT size guidance (LIN-742)', () => {
  test('reframes "large" to include bundling many small straightforward tasks', () => {
    const system = buildNextRunMessages(MODEL)[0].content;
    assert.match(system, /Breadth counts the same as depth/);
    assert.match(system, /many small, straightforward, independent tasks/);
    // XL stays reserved for the auto-added open-ended option.
    assert.match(system, /XL[^]*added automatically/);
  });
});

describe('buildNextRunSummary (LIN-638)', () => {
  test('summarises in-progress/queued counts, velocity, next item, and risks', () => {
    const out = buildNextRunSummary(RICH_MODEL, 'Acme');
    assert.match(out, /Acme has 1 task in progress and 1 queued\./);
    assert.match(out, /Recent velocity is 2 tasks\/week \(decreasing trend\)\./);
    assert.match(out, /Next up the queue: LIN-2 — Blocked work\./);
    assert.match(out, /1 risk flagged \(1 high\)\./);
  });

  test('falls back to a generic subject and tolerates a garbage model', () => {
    assert.match(buildNextRunSummary(MODEL), /^This workspace has/);
    assert.equal(buildNextRunSummary(null), '');
    assert.equal(buildNextRunSummary(undefined), '');
  });
});

describe('buildNextRunMessages', () => {
  test('returns a system + user pair grounded in the model', () => {
    const msgs = buildNextRunMessages(MODEL, 'Acme');
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[1].role, 'user');
    assert.match(msgs[1].content, /LIN-10/);
  });
});

describe('TSHIRT_SIZES (LIN-633)', () => {
  test('is the S/M/L/XL scale — XS dropped, XL reserved for the open-ended option', () => {
    assert.deepEqual(TSHIRT_SIZES, ['S', 'M', 'L', 'XL']);
    assert.ok(!TSHIRT_SIZES.includes('XS'));
  });
});

describe('normalizeSize', () => {
  test('passes valid sizes through (case-insensitive)', () => {
    for (const s of TSHIRT_SIZES) assert.equal(normalizeSize(s.toLowerCase()), s);
  });
  test('defaults invalid/missing to M', () => {
    assert.equal(normalizeSize('huge'), 'M');
    assert.equal(normalizeSize(null), 'M');
    assert.equal(normalizeSize(undefined), 'M');
  });
  test('the now-dropped XS coerces to the M default', () => {
    assert.equal(normalizeSize('XS'), 'M');
  });
});

describe('parseGoalSuggestions', () => {
  test('parses clean JSON and coerces size', () => {
    const raw = JSON.stringify({ options: [{ goal: 'Do the thing.', reasoning: 'Because.', size: 'l' }] });
    const out = parseGoalSuggestions(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].goal, 'Do the thing.');
    assert.equal(out[0].reasoning, 'Because.');
    assert.equal(out[0].size, 'L');
  });

  test('tolerates code fences and prose around the JSON', () => {
    const raw = 'Here you go:\n```json\n{"options":[{"goal":"G","reasoning":"R","size":"S"}]}\n```\nthanks';
    const out = parseGoalSuggestions(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].size, 'S');
  });

  test('drops options with an empty goal', () => {
    const raw = JSON.stringify({ options: [{ goal: '', reasoning: 'x', size: 'M' }, { goal: 'real', size: 'M' }] });
    const out = parseGoalSuggestions(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].goal, 'real');
  });

  test('caps at the generated maximum', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ goal: `g${i}`, size: 'M' }));
    const out = parseGoalSuggestions(JSON.stringify({ options: many }));
    assert.ok(out.length <= 6);
  });

  test('returns [] for garbage', () => {
    assert.deepEqual(parseGoalSuggestions('not json at all'), []);
    assert.deepEqual(parseGoalSuggestions(''), []);
    assert.deepEqual(parseGoalSuggestions(null), []);
  });

  test('parses a headline title and falls back to the goal first line (LIN-642)', () => {
    const raw = JSON.stringify({ options: [
      { goal: 'Line one.\nLine two.', reasoning: 'r', size: 'M', title: 'Ship the proxy migration' },
      { goal: 'Untitled first line.\nmore', reasoning: 'r', size: 'S' },
    ] });
    const out = parseGoalSuggestions(raw);
    assert.equal(out[0].title, 'Ship the proxy migration');
    assert.equal(out[1].title, 'Untitled first line.');
  });

  test('normalizes machine-readable referencedTaskIds (LIN-642)', () => {
    const raw = JSON.stringify({ options: [
      { goal: 'g', size: 'M', referencedTaskIds: ['LIN-10', 'LIN-10', ' LIN-11 ', 42, ''] },
      { goal: 'g2', size: 'S', referencedTaskIds: 'LIN-12' },
      { goal: 'g3', size: 'L' },
    ] });
    const out = parseGoalSuggestions(raw);
    // Deduped, trimmed, non-strings dropped.
    assert.deepEqual(out[0].referencedTaskIds, ['LIN-10', 'LIN-11']);
    // A bare string is tolerated as a single-id list.
    assert.deepEqual(out[1].referencedTaskIds, ['LIN-12']);
    // Absent → [].
    assert.deepEqual(out[2].referencedTaskIds, []);
  });
});

describe('parseNextRunResponse (LIN-642)', () => {
  test('extracts the global analysis preamble alongside the options', () => {
    const raw = JSON.stringify({
      analysis: 'The project has stalled WIP; clearing it is the priority.',
      options: [{ goal: 'g', reasoning: 'r', size: 'M', title: 'T' }],
    });
    const { analysis, options } = parseNextRunResponse(raw);
    assert.match(analysis, /stalled WIP/);
    assert.equal(options.length, 1);
    assert.equal(options[0].title, 'T');
  });

  test('analysis defaults to empty string when absent or on garbage', () => {
    assert.equal(parseNextRunResponse(JSON.stringify({ options: [] })).analysis, '');
    assert.deepEqual(parseNextRunResponse('garbage'), { analysis: '', options: [] });
  });
});

describe('ensureSizeCoverage (LIN-642)', () => {
  test('fills missing sizes from the execution queue and leaves present ones', () => {
    const opts = [{ title: 'a', goal: 'g', reasoning: 'r', size: 'M', referencedTaskIds: ['LIN-1'] }];
    const out = ensureSizeCoverage(opts, RICH_MODEL);
    const sizes = out.map(o => o.size);
    for (const s of REQUIRED_SIZES) assert.ok(sizes.includes(s), `missing ${s}`);
    // The original option is preserved as-is and leads.
    assert.equal(out[0].size, 'M');
    assert.equal(out[0].referencedTaskIds[0], 'LIN-1');
    // Fills are grounded in real queue identifiers and flagged synthesized.
    const fills = out.filter(o => o.synthesized);
    assert.equal(fills.length, 2); // S and L
    for (const f of fills) {
      assert.ok(REQUIRED_SIZES.includes(f.size));
      if (f.referencedTaskIds.length) {
        assert.ok(RICH_MODEL.executionQueue.some(c => c.identifier === f.referencedTaskIds[0]));
      }
    }
  });

  test('is a no-op when all three sizes are already present', () => {
    const opts = [
      { title: 's', goal: 'g', size: 'S', referencedTaskIds: [] },
      { title: 'm', goal: 'g', size: 'M', referencedTaskIds: [] },
      { title: 'l', goal: 'g', size: 'L', referencedTaskIds: [] },
    ];
    const out = ensureSizeCoverage(opts, RICH_MODEL);
    assert.equal(out.length, 3);
    assert.ok(!out.some(o => o.synthesized));
  });

  test('still guarantees coverage with an empty queue (generic fills)', () => {
    const out = ensureSizeCoverage([], { executionQueue: [] });
    const sizes = out.map(o => o.size);
    for (const s of REQUIRED_SIZES) assert.ok(sizes.includes(s));
    // No queue → generic fills with no referenced ids.
    assert.ok(out.every(o => o.referencedTaskIds.length === 0));
  });
});

describe('CONTINUE_UNTIL_STOPPED_OPTION', () => {
  test('is the deterministic empty-goal mapping the generator always appends', () => {
    // The generator appends a copy of this option as the guaranteed last entry, so
    // "continue until stopped" is always offered and reliably maps to an empty goal
    // (the open-ended stack walk) regardless of LLM output. Full append behaviour is
    // exercised end-to-end via the mocked suggest endpoint in the e2e spec.
    assert.equal(CONTINUE_UNTIL_STOPPED_OPTION.goal, '');
    assert.equal(CONTINUE_UNTIL_STOPPED_OPTION.continueUntilStopped, true);
    assert.equal(typeof generateGoalSuggestions, 'function');
  });

  test('owns the XL size — the open-ended option is the deterministic XL (LIN-633)', () => {
    // XL = "run the project with no specific guide", which IS this option. Concrete
    // LLM goals are constrained to S/M/L, so XL must live here and nowhere else.
    assert.equal(CONTINUE_UNTIL_STOPPED_OPTION.size, 'XL');
  });

  test('satisfies the new schema — has a headline title and empty referenced ids (LIN-642)', () => {
    // The frozen option must satisfy the same contract concrete options do, so the
    // page renders it without special-casing missing fields.
    assert.equal(typeof CONTINUE_UNTIL_STOPPED_OPTION.title, 'string');
    assert.ok(CONTINUE_UNTIL_STOPPED_OPTION.title.length > 0);
    assert.deepEqual([...CONTINUE_UNTIL_STOPPED_OPTION.referencedTaskIds], []);
  });
});

describe('generateGoalSuggestions return shape (LIN-633)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function mockStreamResponse(text) {
    const enc = new TextEncoder();
    const blocks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 10 } })}\n\n`,
      'data: [DONE]\n\n',
    ];
    return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
  }

  test('returns the grounding context verbatim plus the XL open-ended option', async () => {
    const raw = JSON.stringify({ analysis: 'WIP first.', options: [{ goal: 'Finish the in-flight work.', reasoning: 'WIP first.', size: 'M', title: 'Finish the in-flight work' }] });
    global.fetch = mock.fn(async () => mockStreamResponse(raw));

    const result = await generateGoalSuggestions(
      { projects: [], issues: [], organizationName: 'Acme' },
      { apiKey: 'test-key' }
    );

    // context is returned and is the exact deterministic grounding blob (not discarded).
    assert.equal(typeof result.context, 'string');
    assert.ok(result.context.length > 0);
    assert.equal(result.context, formatNextRunContext(buildRoadmapModel([], []), 'Acme'));

    // summary is returned and is the deterministic intro paragraph (LIN-638).
    assert.equal(typeof result.summary, 'string');
    assert.equal(result.summary, buildNextRunSummary(buildRoadmapModel([], []), 'Acme'));

    // analysis (the global think-first preamble) is surfaced (LIN-642).
    assert.equal(result.analysis, 'WIP first.');

    // The concrete option survives; the guaranteed open-ended option is appended last as XL.
    const last = result.options[result.options.length - 1];
    assert.equal(last.continueUntilStopped, true);
    assert.equal(last.goal, '');
    assert.equal(last.size, 'XL');
    assert.ok(result.options.some(o => o.goal === 'Finish the in-flight work.' && o.size === 'M'));
  });

  test('guarantees ≥1 option per size S/M/L even when the LLM returns only one (LIN-642)', async () => {
    // The model returns a single M option; the deterministic backstop must fill S and L.
    const raw = JSON.stringify({ analysis: '', options: [{ goal: 'Just one direction.', reasoning: 'r', size: 'M', title: 'One' }] });
    global.fetch = mock.fn(async () => mockStreamResponse(raw));

    const result = await generateGoalSuggestions(
      { projects: [], issues: [], organizationName: 'Acme' },
      { apiKey: 'test-key' }
    );

    const concrete = result.options.filter(o => !o.continueUntilStopped);
    const sizes = new Set(concrete.map(o => o.size));
    for (const s of REQUIRED_SIZES) assert.ok(sizes.has(s), `missing size ${s}`);
  });

  test('drops referencedTaskIds the model hallucinated, keeps real ones (LIN-642)', async () => {
    const issues = [
      { id: 'i1', identifier: 'LIN-1', title: 'Real task', state: { type: 'started' }, estimate: 2 },
    ];
    const raw = JSON.stringify({ options: [
      { goal: 'Act on real + fake.', reasoning: 'r', size: 'M', title: 'T', referencedTaskIds: ['LIN-1', 'LIN-999'] },
    ] });
    global.fetch = mock.fn(async () => mockStreamResponse(raw));

    const result = await generateGoalSuggestions(
      { projects: [], issues, organizationName: 'Acme' },
      { apiKey: 'test-key' }
    );
    const opt = result.options.find(o => o.title === 'T');
    assert.deepEqual(opt.referencedTaskIds, ['LIN-1']);
  });

  test('folds a fresh roadmap report digest into the returned context (LIN-742)', async () => {
    const raw = JSON.stringify({ options: [{ goal: 'g', reasoning: 'r', size: 'M', title: 'T' }] });
    global.fetch = mock.fn(async () => mockStreamResponse(raw));

    const report = { generatedAt: new Date().toISOString(), narrative: { digest: 'The roadmap digest line.' } };
    const result = await generateGoalSuggestions(
      { projects: [], issues: [], organizationName: 'Acme', roadmapReport: report },
      { apiKey: 'test-key' }
    );
    assert.match(result.context, /Roadmap analysis \(generated today\):/);
    assert.match(result.context, /The roadmap digest line\./);
  });

  test('omits a stale roadmap report from the context (LIN-742)', async () => {
    const raw = JSON.stringify({ options: [{ goal: 'g', reasoning: 'r', size: 'M', title: 'T' }] });
    global.fetch = mock.fn(async () => mockStreamResponse(raw));

    const stale = new Date(Date.now() - 60 * 86400000).toISOString();
    const report = { generatedAt: stale, narrative: { digest: 'Stale digest line.' } };
    const result = await generateGoalSuggestions(
      { projects: [], issues: [], organizationName: 'Acme', roadmapReport: report },
      { apiKey: 'test-key' }
    );
    assert.doesNotMatch(result.context, /Roadmap analysis/);
  });

  test('omits silently when no roadmap report is provided (LIN-742)', async () => {
    const raw = JSON.stringify({ options: [{ goal: 'g', reasoning: 'r', size: 'M', title: 'T' }] });
    global.fetch = mock.fn(async () => mockStreamResponse(raw));

    const result = await generateGoalSuggestions(
      { projects: [], issues: [], organizationName: 'Acme' },
      { apiKey: 'test-key' }
    );
    assert.doesNotMatch(result.context, /Roadmap analysis/);
  });
});
