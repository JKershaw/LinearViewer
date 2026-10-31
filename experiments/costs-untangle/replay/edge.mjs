// Hand-written edge cases: one world per branch the seeded generator does not
// reliably reach (the coverage floor and the mutants both need them). Same
// shape as gen.mjs scenarios; the timestamps are relative to NOW so the read
// window and the 06:00Z weekly anchor are exercised on purpose.
import { TICKETS, FEATURES, MODELS, iso, DAY } from './gen.mjs';

const NOW = Date.parse('2026-10-25T12:00:00.000Z');
const PROMPT_SIZES = [0, 1000, 272000, 272001, 500000];

const usage = (o) => ({ message: `[usage] ${JSON.stringify(o.payload)}`, kind: 'usage', timestamp: iso(o.at ?? NOW - 2 * DAY), ...(o.rootItemId ? { rootItemId: o.rootItemId } : {}) });
const done = (at = NOW - 2 * DAY, text = '[done] ok') => ({ kind: 'message', timestamp: iso(at), message: text });
const row = (o) => ({ status: 'taken', kind: 'implementation', dispatchedAt: iso(o.at ?? NOW - 2 * DAY), issueIdentifier: TICKETS[0], harness: 'claude-code', target: 'cli', feedback: [], ...o });
const call = (o) => ({ feature: 'scan', model: 'anthropic/claude-haiku-5.5', issueIdentifier: TICKETS[0], cost: 0.05, timestamp: iso(NOW - DAY), totalTokens: 1000, durationMs: 500, ...o });

const world = (o) => ({
  id: `edge:${o.name}`, seed: 0, now: iso(o.now ?? NOW), env: o.env ?? {},
  models: o.models ?? MODELS, promptSizes: PROMPT_SIZES, usages: o.usages ?? [],
  rows: o.rows ?? [], calls: o.calls ?? [], tickets: o.tickets ?? TICKETS, features: FEATURES,
  ...(o.callLogFail ? { callLogFail: o.callLogFail } : {}),
  catalog: o.catalog ?? [], stored: o.stored ?? [], orUsages: o.orUsages ?? [],
});

const priced = (id, prompt, completion) => ({ id, name: id, pricing: { prompt, completion }, supported_parameters: null, reasoning: null });
const stored = (sessionId, builderVersion, costUsd, extra = {}) => ({ _id: `wk:${sessionId}`, urlKey: 'wk', type: 'session', sessionId, builderVersion, session: { sessionId, telemetry: { usage: { costUsd } } }, ...extra });

export function edgeScenarios() {
  return [
    world({ name: 'opencode-sums-per-turn', rows: [row({ _id: 'x1', harness: 'opencode', feedback: [usage({ payload: { harness: 'opencode', model: 'anthropic/claude-sonnet-4.6', costUsd: 1 } }), usage({ payload: { harness: 'opencode', model: 'anthropic/claude-sonnet-4.6', costUsd: 2 } })] }), row({ _id: 'x2', rootItemId: 'x1', harness: 'opencode', dispatchedAt: iso(NOW - DAY), feedback: [usage({ payload: { harness: 'opencode', model: 'anthropic/claude-sonnet-4.6', costUsd: 4 } }), done(NOW - DAY + 1000)] })] }),
    world({ name: 'claude-code-cumulative-last-wins', rows: [row({ _id: 'c1', feedback: [usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-opus-4.8', inputTokens: 1000, outputTokens: 500 } }), usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-opus-4.8', inputTokens: 5000, outputTokens: 900 } }), done()] })] }),
    world({ name: 'zero-dollar-report', rows: [row({ _id: 'z1', feedback: [usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 0 } }), done()] })] }),
    world({ name: 'one-hour-clamp', rows: [row({ _id: 'h1', feedback: [usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-opus-4.8', cacheCreationInputTokens: 100, cacheCreation1hInputTokens: 900 } }), done()] })] }),
    world({ name: 'one-hour-without-total', usages: [{ model: 'anthropic/claude-opus-4.8', harness: 'claude-code', cacheCreation1hInputTokens: 50 }] }),
    world({ name: 'negative-tokens', usages: [{ model: 'anthropic/claude-sonnet-4.6', inputTokens: -1, outputTokens: 10 }, { model: 'anthropic/claude-sonnet-4.6', outputTokens: 10, cacheCreation1hInputTokens: -2, cacheCreationInputTokens: 5 }] }),
    world({ name: 'override-cumulative-over-272k', usages: [{ model: 'openai/gpt-5.5', harness: 'claude-code', inputTokens: 200000, cacheReadInputTokens: 80000, outputTokens: 1000 }] }),
    world({ name: 'override-opencode-per-request', usages: [{ model: 'openai/gpt-5.5', harness: 'opencode', inputTokens: 300000, outputTokens: 1000 }] }),
    world({ name: 'override-boundary-exactly-272k', usages: [{ model: 'openai/gpt-5.5', harness: 'opencode', inputTokens: 272000, outputTokens: 1000 }, { model: 'openai/gpt-5.5', harness: 'opencode', inputTokens: 272001, outputTokens: 1000 }] }),
    world({ name: 'anchor-only-in-feedback', rows: [row({ _id: 'f1', feedback: [usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 3 } }), done()] }), row({ _id: 'f2', at: NOW - DAY, feedback: [{ kind: 'note', rootItemId: 'f1', timestamp: iso(NOW - DAY), message: 'follow-up' }, usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 7 } }), done(NOW - DAY + 5000)] })] }),
    world({ name: 'unpriced-call-gates-cost', rows: [row({ _id: 'u1', feedback: [usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 2 } }), done()] })], calls: [call({ cost: null }), call({ cost: 0.25 })] }),
    world({ name: 'unknown-model-unpriced', rows: [row({ _id: 'm1', feedback: [usage({ payload: { harness: 'claude-code', model: 'vendor/unknown-9', inputTokens: 1000 } }), done()] })] }),
    world({ name: 'no-telemetry-taken-row', rows: [row({ _id: 'n1', feedback: [done()] })] }),
    world({ name: 'no-taken-rows-noLineage', rows: [row({ _id: 'q1', status: 'queued', feedback: [] })] }),
    world({ name: 'skipped-and-window-edges', rows: [
      row({ _id: 'w1', at: NOW - 30 * DAY, feedback: [usage({ at: NOW - 30 * DAY, payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 1 } }), done(NOW - 30 * DAY)] }),
      row({ _id: 'w2', at: NOW - 31 * DAY, feedback: [usage({ at: NOW - 31 * DAY, payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 9 } }), done(NOW - 31 * DAY)] }),
      row({ _id: 'w3', status: 'skipped', feedback: [usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 5 } }), done()] }),
    ] }),
    world({ name: 'weekly-window-anchor-before-0600', now: Date.parse('2026-10-25T03:00:00.000Z'), rows: [row({ _id: 'b1', at: Date.parse('2026-10-23T08:00:00.000Z'), feedback: [usage({ at: Date.parse('2026-10-23T08:00:00.000Z'), payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 4 } }), done(Date.parse('2026-10-23T09:00:00.000Z'))] })] }),
    world({ name: 'checkpoint-inside-window', env: { WEEKLY_BUDGET_CHECKPOINT_PERCENT: '40', WEEKLY_BUDGET_CHECKPOINT_AT: iso(NOW - DAY), WEEKLY_BUDGET_USD_PER_POINT: '15.5' }, rows: [row({ _id: 'k1', at: NOW - 2 * DAY, feedback: [usage({ at: NOW - 2 * DAY, payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 30 } }), done(NOW - 2 * DAY)] }), row({ _id: 'k2', at: NOW - 6 * 3600000, feedback: [usage({ at: NOW - 6 * 3600000, payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 2 } }), done(NOW - 6 * 3600000)] })] }),
    world({ name: 'outside-outcome-window-done', rows: [row({ _id: 'd1', at: NOW - 45 * DAY, feedback: [usage({ at: NOW - 45 * DAY, payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 6 } }), done(NOW - 45 * DAY)] })] }),
    world({ name: 'wake-row-carries-identifier', rows: [row({ _id: 'wk0', kind: 'implementation', issueIdentifier: TICKETS[1], feedback: [usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 2 } }), done()] }), row({ _id: 'wk1', rootItemId: 'wk0', kind: 'wake', issueIdentifier: TICKETS[0], dispatchedAt: iso(NOW - DAY), feedback: [usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 3 } }), done(NOW - DAY + 2000)] })] }),
    world({ name: 'malformed-usage-message', rows: [row({ _id: 'bad1', feedback: [{ kind: 'usage', timestamp: iso(NOW - 2 * DAY), message: '[usage] {oops' }, usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 1.5 } }), done()] })] }),
    world({ name: 'call-log-features-and-zero', calls: [call({ feature: 'scan', cost: 0 }), call({ feature: 'scan', cost: 0.5 }), call({ feature: 'scan', cost: null }), call({ feature: 'effort', cost: null, issueIdentifier: null, durationMs: null }), call({ feature: 'dispatch-plan', cost: 1.25, timestamp: iso(NOW - 40 * DAY) })] }),
    world({ name: 'call-log-all-unpriced-feature', calls: [call({ feature: 'effort', cost: null }), call({ feature: 'effort', cost: null })] }),
    world({ name: 'bad-env-values', env: { WEEKLY_BUDGET_USD_PER_POINT: '-1', WEEKLY_BUDGET_CHECKPOINT_PERCENT: 'x', WEEKLY_BUDGET_CHECKPOINT_AT: 'nope' }, rows: [row({ _id: 'e1', feedback: [usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 2 } }), done()] })] }),
    world({ name: 'unknown-harness-last-wins', rows: [row({ _id: 'uh1', harness: null, feedback: [usage({ payload: { model: 'anthropic/claude-sonnet-4.6', costUsd: 2 } }), usage({ payload: { model: 'anthropic/claude-sonnet-4.6', costUsd: 6 } }), done()] })] }),
    world({ name: 'rows-listed-later-first', rows: [row({ _id: 'o2', rootItemId: 'o0', at: NOW - 2 * DAY, feedback: [usage({ at: NOW - 2 * DAY, rootItemId: 'o0', payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 3 } })] }), row({ _id: 'o0', at: NOW - 3 * DAY, feedback: [usage({ at: NOW - 3 * DAY, payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 1 } }), done(NOW - 3 * DAY + 1000)] })] }),
    world({ name: 'lane-landed-tickets', rows: [
      row({ _id: 'L1', issueIdentifier: TICKETS[0], feedback: [{ kind: 'message', timestamp: iso(NOW - 2 * DAY), message: '[ticket] LIN-301 done — shipped' }, { kind: 'message', timestamp: iso(NOW - 2 * DAY), message: '[ticket] LIN-302 started' }, usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 5 } }), done()] }),
      row({ _id: 'L2', issueIdentifier: 'LIN-301', at: NOW - 3 * DAY, feedback: [{ kind: 'message', timestamp: iso(NOW - 3 * DAY), message: '[ticket] LIN-302 done' }, usage({ at: NOW - 3 * DAY, payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 2 } }), done(NOW - 3 * DAY + 1000)] }),
      row({ _id: 'L3', issueIdentifier: 'LIN-303', at: NOW - 4 * DAY, feedback: [{ kind: 'message', timestamp: iso(NOW - 4 * DAY), message: '[ticket] LIN-302 done — again' }, usage({ at: NOW - 4 * DAY, payload: { harness: 'opencode', model: 'vendor/unknown-9', costUsd: 1 } }), done(NOW - 4 * DAY + 1000)] }),
    ], tickets: [TICKETS[0], 'LIN-301', 'LIN-302'] }),
    world({ name: 'call-log-store-throws', callLogFail: 'throw', calls: [call({ cost: 0.5 })] }),
    world({ name: 'call-log-store-rejects', callLogFail: 'reject', calls: [call({ cost: 0.5 })] }),
    world({ name: 'latency-ties-sort', calls: [call({ feature: 'scan', model: 'm-b', durationMs: 100 }), call({ feature: 'scan', model: 'm-a', durationMs: 100 }), call({ feature: 'dispatch-plan', model: 'm-a', durationMs: 100 }), call({ feature: 'effort', model: 'm-a', durationMs: 900 })] }),
    // The row is stamped opencode, as its usage says: the requested and realised harness agree, so the
    // boundary is priced by the rule under test rather than by the harness divergence (decisions.md §5.3).
    world({ name: 'row-usage-at-272k-boundary', rows: [row({ _id: 'bd1', harness: 'opencode', at: NOW - 2 * DAY, feedback: [usage({ payload: { harness: 'opencode', model: 'openai/gpt-5.5', inputTokens: 272000, outputTokens: 1000 } }), done()] })], calls: [call({ cost: 0.1 })] }),
    world({ name: 'raw-model-strings', models: ['claude-opus-4-8', 'claude-haiku-5-5-20251001', 'opus', '<synthetic>', '', 'claude-opus-5-20991231', 42] }),
    // Divergence 1 (decisions.md §5.1): one OpenCode session. Row 1 reports $1, $2, $4; its follow-up row reports $8, $16.
    // /cost reads the last report of the lineage ($16); the KPI readers read the last report per row, summed ($4 + $16 = $20);
    // the reports sum to $31. The judge reads these three figures from `cost`, `termMarked` and `taskCost`.
    world({ name: 'opencode-probe-1-2-4-8-16', rows: [
      row({ _id: 'op1', harness: 'opencode', at: NOW - 3 * DAY, feedback: [
        usage({ at: NOW - 3 * DAY, payload: { harness: 'opencode', model: 'anthropic/claude-sonnet-4.6', costUsd: 1 } }),
        usage({ at: NOW - 3 * DAY + 60000, payload: { harness: 'opencode', model: 'anthropic/claude-sonnet-4.6', costUsd: 2 } }),
        usage({ at: NOW - 3 * DAY + 120000, payload: { harness: 'opencode', model: 'anthropic/claude-sonnet-4.6', costUsd: 4 } }),
        done(NOW - 3 * DAY + 180000),
      ] }),
      // The follow-up's reports carry the lineage anchor: only a sibling report stamped with it joins the lineage (mergeLineageFeedback).
      row({ _id: 'op2', rootItemId: 'op1', harness: 'opencode', at: NOW - 2 * DAY, feedback: [
        usage({ at: NOW - 2 * DAY, rootItemId: 'op1', payload: { harness: 'opencode', model: 'anthropic/claude-sonnet-4.6', costUsd: 8 } }),
        usage({ at: NOW - 2 * DAY + 60000, rootItemId: 'op1', payload: { harness: 'opencode', model: 'anthropic/claude-sonnet-4.6', costUsd: 16 } }),
        done(NOW - 2 * DAY + 120000),
      ] }),
    ] }),
    // Pricing hint: the catalog fallback's branches (a router's -1, an empty field, a null, a usable row).
    world({ name: 'pricing-hint-catalog-branches', catalog: [
      priced('vendor/unknown-9', '-1', '0.00001'), priced('openai/gpt-5.5', '', '0'), priced('anthropic/claude-haiku-5.5', null, '1'),
      priced('claude-opus-4-8', '0.0000002', '0.000001'), priced('anthropic/claude-sonnet-4.6', 'x', '0.000001'),
    ] }),
    // Observation store: a stored doc is served only at the current builder version.
    world({ name: 'observation-stored-versions', stored: [stored('s19', 19, 999), stored('s20', 20, 1.5), stored('s21', 21, 0), { _id: 'wk:meta', urlKey: 'wk', type: 'meta', backfilledAt: new Date(0) }, { _id: 'wk:bare', urlKey: 'wk', type: 'session', builderVersion: 20 }] }),
    // OpenRouter streamed usage: the final chunk's cost, absent, zero, non-numeric, negative, and no usage at all.
    world({ name: 'openrouter-usage-branches', orUsages: [
      { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.25 }, { prompt_tokens: 10, cost: 'x' }, { completion_tokens: 4, cost: -1 },
      null, { cost: 0 }, { cost: null, completion_tokens_details: { reasoning_tokens: 7 } }, {},
    ] }),
    // Spend by job: a prefix-named kind and feature (`plan` vs `plan-review`, `scan` vs `scan-retire`), an unpriced run, a run with no usage.
    world({ name: 'spend-by-job-prefixes', rows: [
      row({ _id: 'sp1', kind: 'plan-review', feedback: [usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 2 } }), done()] }),
      row({ _id: 'sp2', kind: 'plan', feedback: [done()] }),
      row({ _id: 'sp3', kind: 'plan', feedback: [usage({ payload: { harness: 'claude-code', model: 'vendor/unknown-9', inputTokens: 1000 } }), done()] }),
      row({ _id: 'sp4', kind: 'custom', feedback: [usage({ payload: { harness: 'claude-code', model: 'anthropic/claude-sonnet-4.6', costUsd: 5 } }), done()] }),
    ], calls: [call({ feature: 'scan-retire', cost: null }), call({ feature: 'scan', cost: 0.5 }), call({ feature: 'recap', cost: 0 }), call({ feature: 'recap', cost: 0.25, timestamp: iso(Date.parse('2026-09-01T00:00:00.000Z')) })] }),
  ];
}
