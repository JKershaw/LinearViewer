// Recorded inputs for the judge: a seeded generator (one scenario per index,
// reproducible at any --n) plus hand-written edge cases, one per branch of the
// cost code. A scenario is pure JSON — the "world" both sides are fed:
//   { id, seed, now (UTC ISO instant), env, models, promptSizes, usages,
//     rows (dispatch rows, either load shape), calls (call-log docs),
//     tickets, features }
// Generation runs ONCE in the parent; both sides read the same file, so
// nothing about the inputs can differ between the old and new side.
import { Rng } from '../../replay-kit/lib/gen-kit.mjs';

const DAY = 86400000;
const TICKETS = ['LIN-101', 'LIN-102', 'LIN-103'];
const FEATURES = ['scan', 'dispatch-plan', 'effort'];
const MODELS = [
  'anthropic/claude-sonnet-4.6', 'anthropic/claude-opus-4.8', 'anthropic/claude-opus-5',
  'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-5-5-20251001',
  'openai/gpt-5.5', 'openai/gpt-5.5-pro', 'anthropic/claude-haiku-5.5',
  'vendor/unknown-9', '<synthetic>', 'opus',
];
const NOW_POOL = [
  '2026-10-01T12:00:00.000Z', '2026-10-14T03:30:00.000Z', '2026-10-22T06:00:00.000Z',
  '2026-10-25T23:59:59.000Z', '2026-10-27T05:59:59.999Z', '2026-10-28T06:00:00.000Z',
];
const PROMPT_SIZES = [0, 1000, 272000, 272001, 500000];

const iso = ms => new Date(ms).toISOString();

function usagePayload(r, { model, harness }) {
  const p = { model };
  if (harness !== undefined) p.harness = harness;
  if (r.chance(0.5)) p.inputTokens = r.int(0, 180000);
  if (r.chance(0.8)) p.outputTokens = r.int(0, 60000);
  if (r.chance(0.6)) p.cacheReadInputTokens = r.int(0, 200000);
  if (r.chance(0.6)) p.cacheCreationInputTokens = r.int(0, 40000);
  if (r.chance(0.3)) p.cacheCreation1hInputTokens = r.int(0, 30000);
  if (r.chance(0.25)) p.costUsd = r.weighted([[0, 1], [r.int(0, 9) + r.next(), 1], [r.int(10, 40), 1]]);
  if (r.chance(0.2)) p.effort = r.pick(['low', 'medium', 'high', 'max']);
  if (r.chance(0.15)) p.lane = r.pick(['api', 'openrouter', 'subscription', 'bogus', null]);
  if (r.chance(0.02)) p.inputTokens = -5;
  return p;
}

function usageEntry(r, tsMs, rootItemId, harness) {
  const model = r.pick(MODELS);
  const payload = usagePayload(r, { model, harness });
  const message = r.chance(0.03) ? '[usage] {not json' : `[usage] ${JSON.stringify(payload)}`;
  const e = { kind: 'usage', timestamp: iso(tsMs), message };
  if (rootItemId) e.rootItemId = rootItemId;
  return e;
}

function generate(r, now) {
  const rows = [];
  const lineages = r.int(1, 6);
  for (let k = 0; k < lineages; k++) {
    const anchor = `a${k}`;
    const harness = r.pick(['claude-code', 'opencode', null]);
    const issueIdentifier = r.chance(0.9) ? r.pick(TICKETS) : null;
    const base = now - r.int(0, 40) * DAY - r.int(0, 86400) * 1000;
    const n = r.int(1, 3);
    for (let j = 0; j < n; j++) {
      const followUp = j > 0;
      const dispatchedAt = iso(base + j * 3600000);
      const row = {
        _id: followUp ? `${anchor}-${j}` : anchor,
        status: r.weighted([['taken', 85], ['queued', 5], ['failed', 5], ['skipped', 5]]),
        kind: r.pick(['implementation', 'review', 'close-out', 'wake', 'autopilot', 'periodical']),
        dispatchedAt,
        issueIdentifier: r.chance(0.9) ? issueIdentifier : null,
        harness: r.chance(0.9) ? harness : null,
        feedback: [],
      };
      if (followUp) {
        // The anchor is carried either on the row or only on its feedback (the
        // feedback-fallback shape the lineage anchor precedence must honour).
        if (r.chance(0.7)) row.rootItemId = anchor;
        else row.feedback.push({ kind: 'note', timestamp: dispatchedAt, rootItemId: anchor, message: 'follow-up' });
      }
      const usages = r.int(0, 3);
      for (let u = 0; u < usages; u++) {
        row.feedback.push(usageEntry(r, base + j * 3600000 + (u + 1) * 60000, followUp && r.chance(0.5) ? anchor : null, row.harness));
      }
      if (r.chance(0.2)) row.feedback.push({ kind: 'evidence', timestamp: dispatchedAt, message: '[evidence] artifact' });
      if (r.chance(0.5)) {
        const marker = r.pick(['[done]', '[done]', '[failed]', '[skipped]', '[aborted]', '[complete]', '[blocked] wait']);
        row.feedback.push({ kind: 'message', timestamp: iso(base + j * 3600000 + 3600000 * 2), message: `${marker} finished` });
      }
      rows.push(row);
    }
    if (r.chance(0.06)) {
      rows.push({ _id: `ab${k}`, abort: true, abortTo: anchor, status: 'taken', kind: 'autopilot', dispatchedAt: iso(base), feedback: [{ kind: 'message', timestamp: iso(base), message: '[aborted] cancelled' }] });
    }
  }
  const calls = [];
  const nCalls = r.int(0, 18);
  for (let c = 0; c < nCalls; c++) {
    calls.push({
      _id: `c${c}`,
      feature: r.pick(FEATURES),
      model: r.pick(MODELS),
      issueIdentifier: r.chance(0.8) ? r.pick(TICKETS) : null,
      cost: r.weighted([[null, 2], [0, 1], [r.int(1, 9) / 100, 6]]),
      timestamp: iso(now - r.int(0, 40) * DAY - r.int(0, 86400) * 1000),
      totalTokens: r.int(0, 90000),
      durationMs: r.chance(0.8) ? r.int(1, 90000) : null,
    });
  }
  const env = {};
  if (r.chance(0.4)) env.WEEKLY_BUDGET_USD_PER_POINT = r.pick(['15.5', 'abc', '-1', '0']);
  if (r.chance(0.3)) {
    env.WEEKLY_BUDGET_CHECKPOINT_PERCENT = r.pick(['40', '0', '-3', 'x']);
    env.WEEKLY_BUDGET_CHECKPOINT_AT = r.chance(0.8) ? iso(now - r.int(0, 6) * DAY) : 'not-a-date';
  }
  return { env, rows, calls };
}

/** Deterministic scenario list: `n` seeded worlds, then every edge case. */
export function buildScenarios({ seed, n }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = new Rng(seed, 'gen', i);
    const now = Date.parse(r.pick(NOW_POOL));
    const { env, rows, calls } = generate(r, now);
    out.push({
      id: `gen:${seed}:${i}`, seed: seed * 100000 + i, now: iso(now), env,
      models: MODELS, promptSizes: PROMPT_SIZES,
      usages: Array.from({ length: r.int(1, 4) }, () => usagePayload(r, { model: r.pick(MODELS), harness: r.pick(['claude-code', 'opencode', undefined]) })),
      rows, calls, tickets: TICKETS, features: FEATURES,
    });
  }
  return out;
}

export { TICKETS, FEATURES, MODELS, iso, DAY };
