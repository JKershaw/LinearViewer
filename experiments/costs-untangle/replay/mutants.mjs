// Planted faults: one per inventoried site (per decision/site pair, see
// ../decisions.md §2). Each mutant is one exact text replacement in the NEW
// side's tree copy (old must occur exactly once in the file). `expect` is the
// set of surfaces the static call graph says read that site, written BEFORE
// any run; the self-check reports any mismatch rather than tuning it away.
//
// `reach: 'v1'` — the site is on a surface this judge can call (surfaces.mjs).
// `reach: 'not-run'` — no adapter yet, or the site is browser / rendered-only;
// it is listed as a blind spot in README.md, never counted as caught.

export const MUTANTS = [
  // ── D1 Rates ─────────────────────────────────────────────────────────────
  { id: 'D1-model-pricing-row', decision: 'D1', site: 'lib/model-pricing.js MODEL_PRICING (sonnet-4.6 row)', file: 'lib/model-pricing.js',
    old: "'anthropic/claude-sonnet-4.6': { prompt: 3.00,", new: "'anthropic/claude-sonnet-4.6': { prompt: 30.00,",
    expect: ['rate', 'usage', 'taskCost', 'termMarked', 'gauge', 'cost'], reach: 'v1' },
  { id: 'D1-getModelRate', decision: 'D1', site: 'lib/model-pricing.js getModelRate', file: 'lib/model-pricing.js',
    old: '    ? MODEL_PRICING[modelId]\n    : null;', new: '    ? null\n    : null;',
    expect: ['rate', 'usage', 'taskCost', 'termMarked', 'gauge', 'cost'], reach: 'v1' },
  { id: 'D1-resolveWorkerModelId', decision: 'D1', site: 'lib/model-pricing.js resolveWorkerModelId', file: 'lib/model-pricing.js',
    old: "  const undated = id.replace(/-\\d{8}$/, '');", new: '  const undated = id;',
    expect: ['rate', 'usage', 'taskCost', 'termMarked', 'gauge', 'cost'], reach: 'v1' },
  { id: 'D1-selectRateForPrompt', decision: 'D1', site: 'lib/model-pricing.js selectRateForPrompt', file: 'lib/model-pricing.js',
    old: '    if (!(promptTokens > entry.minPromptTokens)) continue;', new: '    if (!(promptTokens >= entry.minPromptTokens)) continue;',
    expect: ['rate', 'usage', 'taskCost', 'termMarked', 'gauge', 'cost'], reach: 'v1' },
  { id: 'D1-getModelPricingHint', decision: 'D1', site: 'lib/openrouter.js getModelPricingHint', file: 'lib/openrouter.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'display hint for the model picker (S5); no judge adapter' },
  { id: 'D1-pricing-conformance', decision: 'D1', site: 'lib/pricing-conformance-sweep.js tier vocabulary', file: 'lib/pricing-conformance-sweep.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'scheduler sweep logs unpriced ids; reads no cost figure; no adapter' },

  // ── D2 Pricing one usage report ─────────────────────────────────────────
  { id: 'D2-computeUsageCostUsd', decision: 'D2', site: 'lib/model-pricing.js computeUsageCostUsd', file: 'lib/model-pricing.js',
    old: '  return perMillion / 1e6;', new: '  return perMillion / 1e5;',
    expect: ['usage', 'taskCost', 'termMarked', 'gauge', 'cost'], reach: 'v1' },
  { id: 'D2-native-wins', decision: 'D2', site: 'lib/session-telemetry.js native-wins precedence', file: 'lib/session-telemetry.js',
    old: "  usage.costUsd = typeof payload.costUsd === 'number'\n    ? payload.costUsd\n    : computeUsageCostUsd(usage);",
    new: "  usage.costUsd = computeUsageCostUsd(usage) ?? payload.costUsd ?? null;",
    expect: ['usage', 'taskCost', 'termMarked', 'gauge', 'cost'], reach: 'v1' },
  { id: 'D2-run-view-priced', decision: 'D2', site: 'lib/run-view.js "priced means > 0"', file: 'lib/run-view.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'run page (S9); buildRunView needs a session fixture (phase 2)' },
  { id: 'D2-observation-builder-version', decision: 'D2', site: 'lib/observation-sessions-store.js BUILDER_VERSION', file: 'lib/observation-sessions-store.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'stored derived cost in the observation store (S4); needs the store with a db' },

  // ── D3a Lineage identity ────────────────────────────────────────────────
  { id: 'D3a-task-cost-anchorFor', decision: 'D3a', site: 'lib/task-cost.js anchorFor', file: 'lib/task-cost.js',
    old: '  return item.rootItemId ?? item.feedback?.find(f => f.rootItemId)?.rootItemId ?? item.id;', new: '  return item.rootItemId ?? item.id;',
    expect: ['taskCost', 'cost'], reach: 'v1' },
  { id: 'D3a-dispatch-lineage-status-anchorFor', decision: 'D3a', site: 'lib/dispatch-lineage-status.js anchorFor', file: 'lib/dispatch-lineage-status.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'drives persisted lineage status, not a cost figure; needs the status store (phase 2)' },
  { id: 'D3a-dispatch-lineage-key', decision: 'D3a', site: 'lib/dispatch-lineage.js groupDispatchLineages key', file: 'lib/dispatch-lineage.js',
    old: '    const key = String(row.rootItemId || row._id);', new: "    const key = String(row.rootItemId || row.feedback?.find(f => f.rootItemId)?.rootItemId || row._id);",
    expect: ['lineage', 'termMarked', 'gauge'], reach: 'v1' },

  // ── D3b Combining a session's reports ───────────────────────────────────
  { id: 'D3b-task-cost-parseUsage-merged', decision: 'D3b', site: 'lib/task-cost.js parseUsage(merged)', file: 'lib/task-cost.js',
    old: '    const usage = parseUsage(merged);', new: '    const usage = parseUsage(base.feedback);',
    expect: ['taskCost', 'cost'], reach: 'v1' },
  { id: 'D3b-usageOf-last', decision: 'D3b', site: 'lib/dispatch-lineage.js usageOf last report per row', file: 'lib/dispatch-lineage.js',
    old: "    for (const entry of doc.feedback) {\n      if (entry?.kind === 'usage') last = entry;\n    }",
    new: "    for (const entry of doc.feedback) {\n      if (entry?.kind === 'usage' && !last) last = entry;\n    }",
    expect: ['lineage', 'termMarked', 'gauge'], reach: 'v1' },
  { id: 'D3b-reduceLineageCost-opencode-sum', decision: 'D3b', site: 'lib/terminal-marked-task-cost.js reduceLineageCost (opencode sum)', file: 'lib/terminal-marked-task-cost.js',
    old: '    const costUsd = priced.reduce((sum, u) => sum + u.costUsd, 0);', new: '    const costUsd = priced[priced.length - 1].costUsd;',
    expect: ['termMarked', 'gauge'], reach: 'v1' },
  { id: 'D3b-run-view-lineageCost', decision: 'D3b', site: 'lib/run-view.js lineageCost (cumulative iff claude-code)', file: 'lib/run-view.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'run page (S9); phase 2' },
  { id: 'D3b-model-pricing-override-harness', decision: 'D3b', site: 'lib/model-pricing.js override gate (harness !== opencode)', file: 'lib/model-pricing.js',
    old: "    if (crossesThreshold && usage.harness !== 'opencode') return null;", new: '    if (crossesThreshold) return null;',
    expect: ['usage', 'taskCost', 'termMarked', 'gauge', 'cost'], reach: 'v1' },

  // ── D4 A call's cost ────────────────────────────────────────────────────
  { id: 'D4-openrouter-extractUsage', decision: 'D4', site: 'lib/openrouter.js extractUsage', file: 'lib/openrouter.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'billed cost is read from the OpenRouter response; needs a fake fetch on streamChat (phase 2)' },
  { id: 'D4-llm-call-log-record', decision: 'D4', site: 'lib/llm-call-log.js record() cost', file: 'lib/llm-call-log.js',
    old: '      cost: num(call.cost),', new: '      cost: num(call.cost) ?? 0,',
    expect: ['callLog', 'taskCost'], reach: 'not-run', why: 'record() needs an insertOne-capable collection; memCollection is read-only (phase 2)' },
  { id: 'D4-summarize-missing-zero', decision: 'D4', site: 'lib/llm-call-log.js summarize (missing → $0)', file: 'lib/llm-call-log.js',
    old: '        const cost = typeof doc.cost === \'number\' && Number.isFinite(doc.cost) ? doc.cost : 0;',
    new: '        const cost = typeof doc.cost === \'number\' && Number.isFinite(doc.cost) ? doc.cost : 1;',
    expect: ['callLog'], reach: 'v1' },
  { id: 'D4-summarizeByIssue-unpriced', decision: 'D4', site: 'lib/llm-call-log.js summarizeByIssue (missing → unpriced)', file: 'lib/llm-call-log.js',
    old: '        else unpricedCalls += 1;', new: '        else unpricedCalls += 0;',
    expect: ['taskCost', 'callLog', 'cost'], reach: 'v1' },
  { id: 'D4-summarizeByFeature-mean', decision: 'D4', site: 'lib/llm-call-log.js summarizeByFeature (missing → out of mean)', file: 'lib/llm-call-log.js',
    old: '      return { calls: docs.length, pricedCalls, meanUsd: pricedSum / pricedCalls, unknown: false };',
    new: '      return { calls: docs.length, pricedCalls, meanUsd: pricedSum / docs.length, unknown: false };',
    expect: ['callLog'], reach: 'v1' },
  { id: 'D4-flight-companion-cost', decision: 'D4', site: 'public/flight-companion.js formatCost + tab total', file: 'public/flight-companion.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'browser code (S11); reachable only by e2e or the visual judge' },

  // ── D5 By ticket ────────────────────────────────────────────────────────
  { id: 'D5-proxy-compute-siblings', decision: 'D5', site: 'routes/proxy-compute.js lineage sibling batch (unscoped by ticket)', file: 'routes/proxy-compute.js',
    old: '          rootItemId: { $in: anchors },\n          limit: LINEAGE_QUERY_LIMIT,', new: '          rootItemId: { $in: anchors },\n          issueIdentifier: identifier,\n          limit: LINEAGE_QUERY_LIMIT,',
    expect: ['cost'], reach: 'v1' },
  { id: 'D5-task-cost-fullyPriced', decision: 'D5', site: 'lib/task-cost.js fullyPriced gate', file: 'lib/task-cost.js',
    old: '  const fullyPriced = !noLineage && unpriced.length === 0 && noTelemetryCount === 0 && (appCalls.unpricedCalls || 0) === 0;',
    new: '  const fullyPriced = !noLineage && unpriced.length === 0 && noTelemetryCount === 0;',
    expect: ['taskCost', 'cost'], reach: 'v1' },
  { id: 'D5-terminal-marked-issue-sum', decision: 'D5', site: 'lib/terminal-marked-task-cost.js issue sum', file: 'lib/terminal-marked-task-cost.js',
    old: '      issue.costUsd += reduced.costUsd;', new: '      issue.costUsd = reduced.costUsd;',
    expect: ['termMarked'], reach: 'v1' },

  // ── D6 By day and by period ─────────────────────────────────────────────
  { id: 'D6-windowedSpend-skipped', decision: 'D6', site: 'lib/weekly-budget.js windowedSpend (skipped excluded)', file: 'lib/weekly-budget.js',
    old: "    if (lineage.status === 'skipped') continue; // benign: nothing ended (same exclusion as kpi-stats.js)", new: '',
    expect: ['gauge'], reach: 'v1' },
  { id: 'D6-gauge-checkpoint', decision: 'D6', site: 'lib/weekly-budget.js computeWeeklyBudgetGauge checkpoint basis', file: 'lib/weekly-budget.js',
    old: '  if (checkpoint) {', new: '  if (false) {',
    expect: ['gauge'], reach: 'v1' },
  { id: 'D6-effort-readout-priced-filter-a', decision: 'D6', site: 'lib/effort-readout.js:331 group sum', file: 'lib/effort-readout.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'effort read-out (S8); phase 2' },
  { id: 'D6-effort-readout-priced-filter-b', decision: 'D6', site: 'lib/effort-readout.js:464 total sum', file: 'lib/effort-readout.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'effort read-out (S8); phase 2' },
  { id: 'D6-summarize-30-day-window', decision: 'D6', site: 'lib/llm-call-log.js summarize 30-day total', file: 'lib/llm-call-log.js',
    old: '      const docs = await this.collection.find({ urlKey, timestamp: { $gte: readHorizonStart() } }).toArray();',
    new: '      const docs = await this.collection.find({ urlKey }).toArray();',
    expect: ['callLog'], reach: 'v1' },
  { id: 'D6-run-view-header-total', decision: 'D6', site: 'lib/run-view.js header total (all cumulative)', file: 'lib/run-view.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'run page (S9); phase 2' },

  // ── D7 Per finished task ────────────────────────────────────────────────
  { id: 'D7-terminal-marked-done-gate', decision: 'D7', site: 'lib/terminal-marked-task-cost.js computeTerminalMarkedTaskCost done gate', file: 'lib/terminal-marked-task-cost.js',
    old: "    if (lineage.status !== 'done') {", new: "    if (lineage.status !== 'done' && lineage.status !== 'failed') {",
    expect: ['termMarked'], reach: 'v1' },
  { id: 'D7-publicCost', decision: 'D7', site: 'lib/kpi-stats.js publicCost', file: 'lib/kpi-stats.js',
    old: '', new: '', expect: [], reach: 'not-run', why: '/kpis public page (S3); needs collectKpiStats collections (phase 2)' },

  // ── D8 Read window ──────────────────────────────────────────────────────
  { id: 'D8-read-horizon', decision: 'D8', site: 'lib/read-horizon.js READ_HORIZON_DAYS', file: 'lib/read-horizon.js',
    old: 'export const READ_HORIZON_DAYS = 30;', new: 'export const READ_HORIZON_DAYS = 31;',
    expect: ['taskCost', 'callLog', 'cost'], reach: 'v1' },
  { id: 'D8-outcome-window', decision: 'D8', site: 'lib/dispatch-lineage.js OUTCOME_WINDOW_DAYS', file: 'lib/dispatch-lineage.js',
    old: 'export const OUTCOME_WINDOW_DAYS = 30;', new: 'export const OUTCOME_WINDOW_DAYS = 31;',
    expect: ['termMarked'], reach: 'v1' },
  { id: 'D8-workspace-kpi-long-window', decision: 'D8', site: 'lib/workspace-kpi-stats.js LONG_WINDOW_DAYS', file: 'lib/workspace-kpi-stats.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'workspace KPIs (S7); phase 2' },
  { id: 'D8-observation-copy', decision: 'D8', site: 'lib/render-observation.js "30-day" copy', file: 'lib/render-observation.js',
    old: '', new: '', expect: [], reach: 'not-run', why: 'rendered copy; needs the observation renderer (phase 2)' },
];
