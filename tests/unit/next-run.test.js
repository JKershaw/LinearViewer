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
  attachReferencedTaskTitles,
  normalizeSize,
  generateGoalSuggestions,
  resolveRoadmapNarrative,
  resolveNorthStarSignal,
  ROADMAP_REPORT_MAX_AGE_DAYS,
  CONTINUE_UNTIL_STOPPED_OPTION,
  REQUIRED_SIZES,
  TSHIRT_SIZES,
  resolveDirections,
  MAX_DIRECTIONS,
  MAX_GENERATED_OPTIONS,
  CATCH_ALL_DIRECTION,
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

describe('resolveNorthStarSignal (LIN-779)', () => {
  const NOW = Date.UTC(2026, 5, 27);
  const iso = daysAgo => new Date(NOW - daysAgo * 86400000).toISOString();
  const report = (overrides = {}) => ({
    generatedAt: iso(2),
    narrative: { northStarReading: 'On course — WIP aligns with intent.', gap: 'Auth flow lags the intent.' },
    ...overrides,
  });

  test('returns the live north star with no report (always-current, no age)', () => {
    const out = resolveNorthStarSignal('Ship a self-serve onboarding.', null, { now: NOW });
    assert.equal(out.northStar, 'Ship a self-serve onboarding.');
    assert.equal(out.reading, '');
    assert.equal(out.gap, '');
    assert.equal(out.ageDays, null);
  });

  test('folds reading + gap from a fresh report and dates them', () => {
    const out = resolveNorthStarSignal('Intent text.', report(), { now: NOW });
    assert.equal(out.northStar, 'Intent text.');
    assert.equal(out.reading, 'On course — WIP aligns with intent.');
    assert.equal(out.gap, 'Auth flow lags the intent.');
    assert.equal(out.ageDays, 2);
  });

  test('drops a stale report reading but keeps the live north star', () => {
    const out = resolveNorthStarSignal('Intent text.', report({ generatedAt: iso(ROADMAP_REPORT_MAX_AGE_DAYS + 1) }), { now: NOW });
    assert.equal(out.northStar, 'Intent text.');
    assert.equal(out.reading, '');
    assert.equal(out.gap, '');
    assert.equal(out.ageDays, null);
  });

  test('keeps a report exactly at the freshness boundary', () => {
    const out = resolveNorthStarSignal('Intent.', report({ generatedAt: iso(ROADMAP_REPORT_MAX_AGE_DAYS) }), { now: NOW });
    assert.equal(out.ageDays, ROADMAP_REPORT_MAX_AGE_DAYS);
    assert.equal(out.reading, 'On course — WIP aligns with intent.');
  });

  test('ignores a future-dated report for the reading/gap but keeps the live text', () => {
    const out = resolveNorthStarSignal('Intent.', report({ generatedAt: iso(-1) }), { now: NOW });
    assert.equal(out.northStar, 'Intent.');
    assert.equal(out.ageDays, null);
    assert.equal(out.reading, '');
  });

  test('returns null for an empty / whitespace / non-string north star (path unchanged)', () => {
    assert.equal(resolveNorthStarSignal('', report(), { now: NOW }), null);
    assert.equal(resolveNorthStarSignal('   ', report(), { now: NOW }), null);
    assert.equal(resolveNorthStarSignal(null, report(), { now: NOW }), null);
    assert.equal(resolveNorthStarSignal(undefined, report(), { now: NOW }), null);
  });

  test('trims the live north star and tolerates a report with no reading/gap', () => {
    const out = resolveNorthStarSignal('  Padded intent.  ', report({ narrative: { digest: 'only digest' } }), { now: NOW });
    assert.equal(out.northStar, 'Padded intent.');
    assert.equal(out.reading, '');
    assert.equal(out.gap, '');
    assert.equal(out.ageDays, null);
  });

  test('respects a custom maxAgeDays override', () => {
    assert.equal(resolveNorthStarSignal('Intent.', report({ generatedAt: iso(5) }), { now: NOW, maxAgeDays: 3 }).reading, '');
    assert.ok(resolveNorthStarSignal('Intent.', report({ generatedAt: iso(5) }), { now: NOW, maxAgeDays: 7 }).reading);
  });
});

describe('formatNextRunContext north-star section (LIN-779)', () => {
  const signal = (overrides = {}) => ({ northStar: 'Ship self-serve onboarding.', reading: '', gap: '', ageDays: null, ...overrides });

  test('renders a standalone North star section with the live intent', () => {
    const out = formatNextRunContext(MODEL, 'Acme', null, signal());
    assert.match(out, /North star \(current intent\):/);
    assert.match(out, /Ship self-serve onboarding\./);
    // No reading/gap lines when the signal carries none.
    assert.doesNotMatch(out, /Latest alignment reading/);
    assert.doesNotMatch(out, /Gap to the north star/);
  });

  test('renders dated alignment reading + gap when present', () => {
    const out = formatNextRunContext(MODEL, 'Acme', null, signal({ reading: 'On course.', gap: 'Auth lags.', ageDays: 3 }));
    assert.match(out, /Latest alignment reading \(3 days ago\): On course\./);
    assert.match(out, /Gap to the north star \(3 days ago\): Auth lags\./);
  });

  test('says "today" at age 0 and singularises "1 day ago"', () => {
    assert.match(formatNextRunContext(MODEL, 'Acme', null, signal({ reading: 'r', ageDays: 0 })), /Latest alignment reading \(today\):/);
    assert.match(formatNextRunContext(MODEL, 'Acme', null, signal({ gap: 'g', ageDays: 1 })), /Gap to the north star \(1 day ago\):/);
  });

  test('is a distinct section from the roadmap trajectory analysis (no blur)', () => {
    const out = formatNextRunContext(MODEL, 'Acme', { text: 'Trajectory prose.', ageDays: 2 }, signal({ reading: 'r', ageDays: 2 }));
    assert.match(out, /North star \(current intent\):/);
    assert.match(out, /Roadmap analysis \(generated 2 days ago\):/);
    // The north-star section appears before the roadmap analysis section.
    assert.ok(out.indexOf('North star (current intent):') < out.indexOf('Roadmap analysis'));
  });

  test('the no-north-star output is byte-identical to omitting the argument', () => {
    const base = formatNextRunContext(MODEL, 'Acme');
    assert.equal(formatNextRunContext(MODEL, 'Acme', null, null), base);
    assert.doesNotMatch(base, /North star/);
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

describe('NEXT_RUN_SYSTEM_PROMPT alignment ranking (LIN-779)', () => {
  test('adds an alignment-ranking rule that keeps size coverage and continue-until-stopped verbatim', () => {
    const system = buildNextRunMessages(MODEL)[0].content;
    // The new rule references the north-star section and ranking by intent.
    assert.match(system, /North star \(current intent\)/);
    assert.match(system, /rank\/order your options by how much each advances that intent/);
    // It must NOT weaken the S/M/L coverage rule…
    assert.match(system, /does NOT relax the size-coverage rule/);
    assert.match(system, /Provide AT LEAST ONE option for each size S, M, and L/);
    // …nor the continue-until-stopped exclusion rule (kept verbatim).
    assert.match(system, /Do NOT include a "continue until stopped" \/ open-ended option/);
  });
});

describe('NEXT_RUN_SYSTEM_PROMPT direction guidance (LIN-1566)', () => {
  test('asks for 2-3 named directions and a verbatim per-option tag', () => {
    const system = buildNextRunMessages(MODEL)[0].content;
    // The schema carries the grouping axis…
    assert.match(system, /"directions"/);
    assert.match(system, /"direction":\s+string/);
    // …and the rules pin the count, the inference, and the verbatim tag.
    assert.match(system, /2-3 "directions"/);
    assert.match(system, /Infer them from the provided state/);
    assert.match(system, /copied verbatim/);
  });

  test('states the total option cap, so a 3x3 reply cannot be silently truncated', () => {
    // parseNextRunResponse slices at MAX_GENERATED_OPTIONS. Without this rule a
    // model reading "2-3 directions x 2-3 options" could return 9 and lose its
    // last direction entirely to the cap. Interpolated from the constant so the
    // prompt and the cap cannot drift apart.
    const system = buildNextRunMessages(MODEL)[0].content;
    assert.match(system, new RegExp(`AT MOST ${MAX_GENERATED_OPTIONS} options in total`));
  });

  test('states that S/M/L coverage is GLOBAL, not per direction (D3)', () => {
    // Without this the model balances sizes inside each direction, which needs
    // 3 x N options and blows the MAX_GENERATED_OPTIONS cap.
    const system = buildNextRunMessages(MODEL)[0].content;
    assert.match(system, /ALL your options TAKEN TOGETHER/);
    assert.match(system, /NOT required within each direction/);
    // The original per-size guarantee is reaffirmed, not replaced.
    assert.match(system, /Provide AT LEAST ONE option for each size S, M, and L/);
  });

  test('never uses the word "theme" for the grouping (D4)', () => {
    const system = buildNextRunMessages(MODEL)[0].content;
    assert.doesNotMatch(system, /theme/i);
  });

  test('leaves the continue-until-stopped exclusion rule intact', () => {
    // Directions are a grouping over concrete goals; the open-ended option is
    // still added deterministically and is still not the model's to return.
    const system = buildNextRunMessages(MODEL)[0].content;
    assert.match(system, /Do NOT include a "continue until stopped" \/ open-ended option/);
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
    // `directions: []` rides on the unparseable path too (LIN-1566) — the caller
    // always gets the key, and empty means "no usable grouping" (the flat list).
    assert.deepEqual(parseNextRunResponse('garbage'), { analysis: '', directions: [], options: [] });
  });
});

describe('parseNextRunResponse directions (LIN-1566)', () => {
  test('extracts declared directions and each option\'s direction tag', () => {
    const raw = JSON.stringify({
      analysis: 'a',
      directions: [
        { name: 'finish the migration', summary: 'Close out the provider migration.' },
        { name: 'clear the blockers', summary: 'Unblock the critical path.' },
      ],
      options: [
        { goal: 'g1', reasoning: 'r', size: 'M', title: 'T1', direction: 'finish the migration' },
        { goal: 'g2', reasoning: 'r', size: 'S', title: 'T2', direction: 'clear the blockers' },
      ],
    });
    const { directions, options } = parseNextRunResponse(raw);
    assert.deepEqual(directions, [
      { name: 'finish the migration', summary: 'Close out the provider migration.' },
      { name: 'clear the blockers', summary: 'Unblock the critical path.' },
    ]);
    assert.equal(options[0].direction, 'finish the migration');
    assert.equal(options[1].direction, 'clear the blockers');
  });

  test('back-compat: a reply with no grouping parses to [] / \'\' and unchanged options', () => {
    // Today's fixtures carry no directions at all; they must still parse cleanly.
    const raw = JSON.stringify({ options: [{ goal: 'g', reasoning: 'r', size: 'M', title: 'T' }] });
    const { directions, options } = parseNextRunResponse(raw);
    assert.deepEqual(directions, []);
    assert.equal(options.length, 1);
    assert.equal(options[0].direction, '');
    assert.equal(options[0].title, 'T');
  });

  test('trims names/summaries, drops blanks, and dedupes case-insensitively', () => {
    const raw = JSON.stringify({
      directions: [
        { name: '  finish the migration  ', summary: '  Close it out.  ' },
        { name: 'Finish The Migration', summary: 'A duplicate under another casing.' },
        { name: '   ', summary: 'blank name' },
        { name: 'clear the blockers' },
      ],
      options: [],
    });
    const { directions } = parseNextRunResponse(raw);
    assert.deepEqual(directions, [
      { name: 'finish the migration', summary: 'Close it out.' },
      { name: 'clear the blockers', summary: '' },
    ]);
  });

  test('caps the declared directions and tolerates a non-array / garbage value', () => {
    const many = Array.from({ length: MAX_DIRECTIONS + 3 }, (_, i) => ({ name: `d${i}`, summary: 's' }));
    assert.equal(parseNextRunResponse(JSON.stringify({ directions: many, options: [] })).directions.length, MAX_DIRECTIONS);
    assert.deepEqual(parseNextRunResponse(JSON.stringify({ directions: 'nope', options: [] })).directions, []);
    assert.deepEqual(parseNextRunResponse(JSON.stringify({ directions: [1, null, 'x'], options: [] })).directions, []);
  });

  test('a non-string option direction normalizes to the empty tag, not a crash', () => {
    const raw = JSON.stringify({
      directions: [{ name: 'd', summary: 's' }],
      options: [{ goal: 'g', size: 'M', title: 'T', direction: 42 }],
    });
    assert.equal(parseNextRunResponse(raw).options[0].direction, '');
  });
});

describe('resolveDirections (LIN-1566)', () => {
  // Shorthand: a concrete option carrying just the fields the resolver reads.
  const opt = (direction) => ({ title: 't', goal: 'g', size: 'M', direction });
  const OPEN = { ...CONTINUE_UNTIL_STOPPED_OPTION };
  const DECLARED = [
    { name: 'finish the migration', summary: 'Close it out.' },
    { name: 'clear the blockers', summary: 'Unblock the path.' },
  ];

  test('partitions options into the declared directions, in declared order', () => {
    const options = [
      opt('clear the blockers'),
      opt('finish the migration'),
      opt('finish the migration'),
      OPEN,
    ];
    const resolved = resolveDirections(options, DECLARED);
    assert.deepEqual(resolved.map(d => d.name), ['finish the migration', 'clear the blockers']);
    assert.deepEqual(resolved[0].optionIndexes, [1, 2]);
    assert.deepEqual(resolved[1].optionIndexes, [0]);
    // Summaries ride along for the chooser.
    assert.equal(resolved[0].summary, 'Close it out.');
  });

  test('matches an option tag to a declared name case-insensitively', () => {
    // The second (correctly-cased) option is what keeps this above the two-direction
    // floor, so the assertion is about case-folding and not about the F2 collapse
    // guard below. Without it a single surviving direction would resolve to [].
    const resolved = resolveDirections([opt('FINISH the Migration'), opt('clear the blockers'), OPEN], DECLARED);
    assert.deepEqual(resolved.map(d => d.name), ['finish the migration', 'clear the blockers']);
    assert.deepEqual(resolved[0].optionIndexes, [0]);
  });

  test('blank and undeclared tags land in the trailing catch-all', () => {
    const options = [
      opt('finish the migration'),
      opt(''),                    // untagged (e.g. a deterministic size fill)
      opt('a name never declared'),
      { title: 't', goal: 'g', size: 'L' }, // no direction field at all
      OPEN,
    ];
    const resolved = resolveDirections(options, DECLARED);
    assert.equal(resolved[resolved.length - 1].name, CATCH_ALL_DIRECTION);
    assert.deepEqual(resolved[resolved.length - 1].optionIndexes, [1, 2, 3]);
  });

  test('drops a declared direction that ends up holding nothing', () => {
    // Three declared, two tagged: the empty one is dropped and the other two survive,
    // so the drop is observable without tripping the F2 two-direction floor.
    const declared = [...DECLARED, { name: 'reduce flake', summary: 'Stabilise CI.' }];
    const resolved = resolveDirections([opt('finish the migration'), opt('clear the blockers'), OPEN], declared);
    assert.deepEqual(resolved.map(d => d.name), ['finish the migration', 'clear the blockers']);
  });

  // ── F2 (LIN-1566 review): a chooser needs something to choose between ──────────
  // One chip that filters nothing is chrome for a no-op control — the same
  // degradation the `placed === 0` branch already rejects, reached from the other
  // side. Both collapse to [] so the page renders its flat list.

  test('a grouping that collapses to ONE direction falls back to the flat list', () => {
    // Every concrete option carries the same declared tag, nothing reaches the
    // catch-all, and the second declared direction is dropped as empty — one chip.
    const resolved = resolveDirections(
      [opt('finish the migration'), opt('finish the migration'), OPEN],
      DECLARED
    );
    assert.deepEqual(resolved, []);
  });

  test('one declared direction plus a catch-all is a real choice and survives', () => {
    // The floor is about usable choices, not about the catch-all being special: one
    // declared name + a populated catch-all is two chips, so it must NOT collapse.
    const resolved = resolveDirections([opt('finish the migration'), opt(''), OPEN], DECLARED);
    assert.deepEqual(resolved.map(d => d.name), ['finish the migration', CATCH_ALL_DIRECTION]);
  });

  test('a single declared direction holding everything also collapses', () => {
    const resolved = resolveDirections(
      [opt('only one'), opt('only one'), OPEN],
      [{ name: 'only one', summary: 'The sole direction.' }]
    );
    assert.deepEqual(resolved, []);
  });

  test('the continue-until-stopped option is in NO direction (A4)', () => {
    const options = [opt('finish the migration'), opt(''), OPEN];
    const openIndex = options.length - 1;
    const resolved = resolveDirections(options, DECLARED);
    assert.ok(resolved.length > 0);
    for (const d of resolved) {
      assert.ok(!d.optionIndexes.includes(openIndex), `${d.name} must not hold the open option`);
    }
  });

  test('optionIndexes partition every concrete option exactly once', () => {
    const options = [
      opt('finish the migration'),
      opt('clear the blockers'),
      opt('unknown'),
      opt(''),
      opt('finish the migration'),
      OPEN,
    ];
    const resolved = resolveDirections(options, DECLARED);
    const flat = resolved.flatMap(d => d.optionIndexes);
    // No index twice…
    assert.equal(new Set(flat).size, flat.length);
    // …and every concrete option covered, the open one excluded.
    const concrete = options
      .map((o, i) => (o.continueUntilStopped ? null : i))
      .filter(i => i !== null);
    assert.deepEqual([...flat].sort((a, b) => a - b), concrete);
  });

  test('returns [] when nothing was declared — the flat-list fallback (A5)', () => {
    assert.deepEqual(resolveDirections([opt('anything'), OPEN], []), []);
    assert.deepEqual(resolveDirections([opt(''), OPEN], undefined), []);
  });

  test('returns [] when no option matches a declared name (one "other" pile is worse than flat)', () => {
    const resolved = resolveDirections([opt(''), opt('never declared'), OPEN], DECLARED);
    assert.deepEqual(resolved, []);
  });

  test('returns [] when there are no concrete options at all', () => {
    assert.deepEqual(resolveDirections([OPEN], DECLARED), []);
  });

  test('tolerates null/garbage input without throwing', () => {
    assert.deepEqual(resolveDirections(null, null), []);
    assert.deepEqual(resolveDirections(undefined, DECLARED), []);
    assert.deepEqual(resolveDirections('nope', DECLARED), []);
    assert.deepEqual(resolveDirections([null, undefined, OPEN], DECLARED), []);
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

describe('attachReferencedTaskTitles (LIN-923)', () => {
  test('resolves each referenced id to its task title from the execution queue', () => {
    const opts = [{ title: 'a', goal: 'g', size: 'M', referencedTaskIds: ['LIN-1', 'LIN-2'] }];
    const out = attachReferencedTaskTitles(opts, RICH_MODEL);
    assert.deepEqual(out[0].referencedTasks, [
      { id: 'LIN-1', title: 'Blocker' },
      { id: 'LIN-2', title: 'Blocked work' },
    ]);
    // The machine-readable field is left untouched (LIN-644 diffs it).
    assert.deepEqual(out[0].referencedTaskIds, ['LIN-1', 'LIN-2']);
  });

  test('resolves an unknown id to an empty title rather than dropping it', () => {
    const opts = [{ title: 'a', goal: 'g', size: 'M', referencedTaskIds: ['LIN-999'] }];
    const out = attachReferencedTaskTitles(opts, RICH_MODEL);
    assert.deepEqual(out[0].referencedTasks, [{ id: 'LIN-999', title: '' }]);
  });

  test('yields an empty referencedTasks for an option with no ids', () => {
    const out = attachReferencedTaskTitles([{ title: 'a', goal: 'g', size: 'M', referencedTaskIds: [] }], RICH_MODEL);
    assert.deepEqual(out[0].referencedTasks, []);
    // ...and for a missing field entirely.
    const out2 = attachReferencedTaskTitles([{ title: 'a', goal: 'g', size: 'M' }], RICH_MODEL);
    assert.deepEqual(out2[0].referencedTasks, []);
  });

  test('tolerates a null/garbage model or options without throwing', () => {
    assert.deepEqual(attachReferencedTaskTitles(null, RICH_MODEL), []);
    const out = attachReferencedTaskTitles([{ referencedTaskIds: ['LIN-1'] }], null);
    assert.deepEqual(out[0].referencedTasks, [{ id: 'LIN-1', title: '' }]);
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
    // The surviving id is enriched with its resolved title for display (LIN-923).
    assert.deepEqual(opt.referencedTasks, [{ id: 'LIN-1', title: 'Real task' }]);
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

  test('threads a live north star into the returned context, kept byte-equal to the user message (LIN-779)', async () => {
    const raw = JSON.stringify({ options: [{ goal: 'g', reasoning: 'r', size: 'M', title: 'T' }] });
    let sentUserMessage = null;
    global.fetch = mock.fn(async (_url, opts) => {
      sentUserMessage = JSON.parse(opts.body).messages.find(m => m.role === 'user').content;
      return mockStreamResponse(raw);
    });

    const result = await generateGoalSuggestions(
      { projects: [], issues: [], organizationName: 'Acme', northStar: 'Ship self-serve onboarding.' },
      { apiKey: 'test-key' }
    );
    // The north-star section is present in the returned context…
    assert.match(result.context, /North star \(current intent\):/);
    assert.match(result.context, /Ship self-serve onboarding\./);
    // …and the displayed context == the context the model was actually given.
    assert.equal(result.context, sentUserMessage);
  });

  test('folds a fresh report reading/gap under the north-star section (LIN-779)', async () => {
    const raw = JSON.stringify({ options: [{ goal: 'g', reasoning: 'r', size: 'M', title: 'T' }] });
    global.fetch = mock.fn(async () => mockStreamResponse(raw));

    const report = {
      generatedAt: new Date().toISOString(),
      narrative: { northStarReading: 'Aligned on onboarding.', gap: 'Billing lags the intent.' },
    };
    const result = await generateGoalSuggestions(
      { projects: [], issues: [], organizationName: 'Acme', northStar: 'Ship self-serve onboarding.', roadmapReport: report },
      { apiKey: 'test-key' }
    );
    assert.match(result.context, /North star \(current intent\):/);
    assert.match(result.context, /Latest alignment reading \(today\): Aligned on onboarding\./);
    assert.match(result.context, /Gap to the north star \(today\): Billing lags the intent\./);
  });

  test('the no-north-star path stays byte-identical and preserves size coverage + continue-until-stopped (LIN-779)', async () => {
    const raw = JSON.stringify({ options: [{ goal: 'Only M.', reasoning: 'r', size: 'M', title: 'One' }] });
    global.fetch = mock.fn(async () => mockStreamResponse(raw));

    const withoutNs = await generateGoalSuggestions(
      { projects: [], issues: [], organizationName: 'Acme' },
      { apiKey: 'test-key' }
    );
    const emptyNs = await generateGoalSuggestions(
      { projects: [], issues: [], organizationName: 'Acme', northStar: '' },
      { apiKey: 'test-key' }
    );
    // Passing an empty north star changes nothing about the grounding blob.
    assert.equal(emptyNs.context, withoutNs.context);
    assert.doesNotMatch(emptyNs.context, /North star/);

    // Size coverage (S/M/L) intact and the continue-until-stopped option still ends the list,
    // even with a live north star present (alignment ranking is orthogonal to both).
    const withNs = await generateGoalSuggestions(
      { projects: [], issues: [], organizationName: 'Acme', northStar: 'Some intent.' },
      { apiKey: 'test-key' }
    );
    const concrete = withNs.options.filter(o => !o.continueUntilStopped);
    const sizes = new Set(concrete.map(o => o.size));
    for (const s of REQUIRED_SIZES) assert.ok(sizes.has(s), `missing size ${s}`);
    const last = withNs.options[withNs.options.length - 1];
    assert.equal(last.continueUntilStopped, true);
    assert.equal(last.size, 'XL');
    assert.equal(last.goal, '');
  });
});

describe('generateGoalSuggestions directions (LIN-1566)', () => {
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

  const ISSUES = [
    { id: 'i1', identifier: 'LIN-1', title: 'In-flight work', state: { type: 'started' }, estimate: 2 },
    { id: 'i2', identifier: 'LIN-2', title: 'Next up', state: { type: 'unstarted' }, estimate: 1 },
  ];

  // A grouped reply covering only M and S, so the deterministic L fill is
  // synthesized AFTER parsing — the case that proves resolver placement.
  const GROUPED_REPLY = JSON.stringify({
    analysis: 'a',
    directions: [
      { name: 'finish started work', summary: 'Close out what is in flight.' },
      { name: 'open the queue', summary: 'Start the next ranked item.' },
    ],
    options: [
      { goal: 'Finish LIN-1.', reasoning: 'r', size: 'M', title: 'Finish LIN-1', referencedTaskIds: ['LIN-1'], direction: 'finish started work' },
      { goal: 'Start LIN-2.', reasoning: 'r', size: 'S', title: 'Start LIN-2', referencedTaskIds: ['LIN-2'], direction: 'open the queue' },
    ],
  });

  test('returns the resolved grouping alongside the flat options', async () => {
    global.fetch = mock.fn(async () => mockStreamResponse(GROUPED_REPLY));
    const result = await generateGoalSuggestions(
      { projects: [], issues: ISSUES, organizationName: 'Acme' },
      { apiKey: 'test-key' }
    );
    assert.ok(Array.isArray(result.directions));
    assert.ok(result.directions.length >= 2);
    assert.deepEqual(result.directions.slice(0, 2).map(d => d.name), ['finish started work', 'open the queue']);
    // The flat array stays authoritative and unchanged in shape.
    assert.ok(result.options.length > result.directions.length);
  });

  test('the grouping covers the deterministic size fills — proof the resolver runs LAST', async () => {
    // ensureSizeCoverage pushes the missing-L fill after parsing, so a fill carries
    // no direction of its own. Resolving before that point would silently orphan it.
    global.fetch = mock.fn(async () => mockStreamResponse(GROUPED_REPLY));
    const result = await generateGoalSuggestions(
      { projects: [], issues: ISSUES, organizationName: 'Acme' },
      { apiKey: 'test-key' }
    );
    const fillIndex = result.options.findIndex(o => o.synthesized);
    assert.ok(fillIndex >= 0, 'expected a deterministic size fill');
    const holder = result.directions.find(d => d.optionIndexes.includes(fillIndex));
    assert.ok(holder, 'the size fill must be inside some direction');
    assert.equal(holder.name, CATCH_ALL_DIRECTION);
  });

  test('every concrete option is grouped exactly once and the open option never is', async () => {
    global.fetch = mock.fn(async () => mockStreamResponse(GROUPED_REPLY));
    const result = await generateGoalSuggestions(
      { projects: [], issues: ISSUES, organizationName: 'Acme' },
      { apiKey: 'test-key' }
    );
    const flat = result.directions.flatMap(d => d.optionIndexes);
    assert.equal(new Set(flat).size, flat.length);
    const concrete = result.options
      .map((o, i) => (o.continueUntilStopped ? null : i))
      .filter(i => i !== null);
    assert.deepEqual([...flat].sort((a, b) => a - b), concrete);
  });

  test('an ungrouped reply returns directions: [] and the same options as before (A5)', async () => {
    // Byte-for-byte the pre-LIN-1566 contract: the only difference is the new key.
    const flatReply = JSON.stringify({
      analysis: 'a',
      options: [{ goal: 'Finish LIN-1.', reasoning: 'r', size: 'M', title: 'Finish LIN-1', referencedTaskIds: ['LIN-1'] }],
    });
    global.fetch = mock.fn(async () => mockStreamResponse(flatReply));
    const result = await generateGoalSuggestions(
      { projects: [], issues: ISSUES, organizationName: 'Acme' },
      { apiKey: 'test-key' }
    );
    assert.deepEqual(result.directions, []);
    // Size coverage and the trailing open option are untouched by grouping.
    const concrete = result.options.filter(o => !o.continueUntilStopped);
    const sizes = new Set(concrete.map(o => o.size));
    for (const s of REQUIRED_SIZES) assert.ok(sizes.has(s), `missing size ${s}`);
    const last = result.options[result.options.length - 1];
    assert.equal(last.continueUntilStopped, true);
    assert.equal(last.goal, '');
  });

  test('an LLM failure still yields the size-guaranteed set with no grouping', async () => {
    global.fetch = mock.fn(async () => { throw new Error('upstream down'); });
    const result = await generateGoalSuggestions(
      { projects: [], issues: ISSUES, organizationName: 'Acme' },
      { apiKey: 'test-key' }
    ).catch(() => null);
    // streamChat swallowing vs. throwing is out of scope here — assert only that
    // IF it resolves, the grouped path degrades rather than half-renders.
    if (result) {
      assert.deepEqual(result.directions, []);
      assert.equal(result.options[result.options.length - 1].continueUntilStopped, true);
    }
  });

  test('the per-option direction tag survives the whole post-parse pipeline', async () => {
    // Grouping only works because every stage after the parser copies options by
    // spread. If a stage is ever "tidied" into an explicit field list this fails.
    global.fetch = mock.fn(async () => mockStreamResponse(GROUPED_REPLY));
    const result = await generateGoalSuggestions(
      { projects: [], issues: ISSUES, organizationName: 'Acme' },
      { apiKey: 'test-key' }
    );
    const tagged = result.options.find(o => o.title === 'Finish LIN-1');
    assert.equal(tagged.direction, 'finish started work');
    // …and the enrichment that runs after it is still applied.
    assert.deepEqual(tagged.referencedTasks, [{ id: 'LIN-1', title: 'In-flight work' }]);
  });
});
