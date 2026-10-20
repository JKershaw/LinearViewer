/**
 * A hand-built `collectKpiStats` output for the public /kpis tests (LIN-3703).
 * Only the keys `toPublicKpis` reads are meaningful; the rest are the raw
 * fields it must NOT pass on, kept here so a leak shows up as a failing test.
 */
import { PROXY_PHASES } from '../../lib/kpi-stats.js';

export const STEP_KEYS = ['login', 'connected', 'firstGo', 'prOpened', 'mergeClicked'];

const COVERAGE = 'app-defined coverage label';

/** A milestone funnel: `counts` per step (null = no-signal), `mode` as given. */
export function buildFunnel(counts = {}, mode = null) {
  const steps = {};
  for (const key of STEP_KEYS) {
    const count = counts[key] === undefined ? 0 : counts[key];
    steps[key] = count === null
      ? { state: 'no-signal', count: null, coverage: `${key}: ${COVERAGE}` }
      : { state: 'reached', count, coverage: `${key}: ${COVERAGE}` };
  }
  return { steps, mode };
}

/** A mode block: `total` and one `[entries, notReady]` pair per rung. */
export function buildMode(total, rungs) {
  const names = ['copy', 'run-step', 'run-task'];
  return {
    total,
    byRung: rungs.map(([entries, notReady], i) => ({ rung: names[i], entries, notReady })),
    coverage: { surfaces: ['swipe'] }
  };
}

export function buildStats({ fullSeries = false, workspaces = 40, funnel = buildFunnel({ login: 30, connected: 20, firstGo: 12, prOpened: 8, mergeClicked: null }, buildMode(36, [[20, 6], [10, 0], [6, 0]])), ...overrides } = {}) {
  const phase = values => [...values];
  // `fullSeries` swaps the two-day axis for 30 days ending 2026-06-10, with a
  // gap-free but varied count per day, so charts have something to draw.
  const days = fullSeries
    ? Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 5, 10) - (29 - i) * 86400000).toISOString().slice(0, 10))
    : ['2026-06-09', '2026-06-10'];
  const series = (base, step = 1) => days.map((_, i) => base + ((i * step) % 7));
  return {
    generatedAt: '2026-06-10T12:00:00.000Z',
    totals: {
      workspaces,
      workspacesBasis: 'workspaces with activity in the 30-day read window or stored preferences',
      users: 12,
      activeSessions: 3,
      agentActions: 1234,
      dispatches: 56,
      autopilotRuns: 8,
      feedbackNotes: 7,
      aiSummaries: 89,
      roadmapReports: 10,
      roadmapReportsBasis: 'newest 20 reports per workspace',
      customPrompts: 2,
      localIssues: 5,
      localProjects: 1,
      activeTokens: 6
    },
    proxyCategories: {
      days,
      ...Object.fromEntries(PROXY_PHASES.map((p, i) => [p, fullSeries ? phase(series(10 + i, i + 1)) : phase([10 + i, 20 + i])]))
    },
    daily: {
      dispatches: fullSeries ? series(1) : [1, 2],
      autopilotRuns: fullSeries ? series(0, 2) : [0, 1],
      done: fullSeries ? series(0, 3) : [1, 0]
    },
    proxyCategoriesHourly: { hours: ['2026-06-10T11'], orienting: [3], deciding: [1], acting: [0], watching: [2], reporting: [1] },
    dispatchByDay: { days: ['2026-06-09'], kinds: [{ label: 'autopilot', counts: [1] }] },
    dispatchOutcomes: {
      windowDays: 30,
      total: 63,
      resolved: 47,
      done: 41,
      failed: 4,
      aborted: 2,
      rate: 0.872,
      weeks: ['2026-05-13', '2026-05-20', '2026-05-27', '2026-06-03'],
      weeklyRate: [0.5, null, 1, 0.875],
      weeklyResolved: [2, 0, 3, 8],
      weeklyFailed: [1, 0, 0, 1],
      weeklyAborted: [0, 0, 0, 1]
    },
    terminalMarkedTaskCost: { windowDays: 30, issueCount: 10, costUsd: 176.4 },
    weeklyBudgetGauge: { percentConsumed: 56.3, dayBars: { days: ['2026-06-10'], costUsd: [61.8] } },
    funnel: { dispatched: 20, taken: 15, reported: 12, completed: 9 },
    milestoneFunnel: funnel,
    dispatchKinds: [{ label: 'autopilot', count: 4 }, { label: 'research', count: 3 }],
    dispatchKindsOtherCount: 2,
    stepOutcomes: { completed: 5, failed: 1, blocked: 0, other: 2 },
    proxyStatus: { ok: 30, clientError: 2, serverError: 1 },
    topEndpoints: [{ label: '/api/proxy/me', count: 9 }],
    hourOfDay: Array.from({ length: 24 }, (_, h) => h),
    freeTier: { days: ['2026-06-09'], counts: [4] },
    vanity: { busiestDay: { day: '2026-06-10', count: 26 }, readsPerWrite: 12.4, medianQueueToTakeMinutes: 11, dbBackend: 'mangodb' },
    ...overrides
  };
}
