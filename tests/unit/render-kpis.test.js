/**
 * Unit tests for lib/render-kpis.js
 *
 * Run with: node --test tests/unit/render-kpis.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderKpisPage } from '../../lib/render-kpis.js';

function buildStats(overrides = {}) {
  return {
    generatedAt: '2026-06-10T12:00:00.000Z',
    totals: {
      workspaces: 4,
      users: 12,
      activeSessions: 3,
      agentActions: 1234,
      dispatches: 56,
      autopilotRuns: 8,
      feedbackNotes: 7,
      aiSummaries: 89,
      roadmapReports: 10,
      customPrompts: 2,
      localIssues: 5,
      localProjects: 1,
      activeTokens: 6
    },
    proxyCategories: {
      days: ['2026-06-09', '2026-06-10'],
      orienting: [10, 20],
      deciding: [2, 3],
      acting: [1, 1],
      watching: [4, 5],
      reporting: [2, 2]
    },
    proxyCategoriesHourly: {
      hours: ['2026-06-10T11', '2026-06-10T12'],
      orienting: [3, 7],
      deciding: [1, 1],
      acting: [0, 1],
      watching: [2, 2],
      reporting: [1, 0]
    },
    dispatchByDay: {
      days: ['2026-06-09', '2026-06-10'],
      kinds: [
        { label: 'autopilot', counts: [1, 2] },
        { label: 'research', counts: [0, 1] }
      ]
    },
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
      weeklyResolved: [2, 0, 3, 8]
    },
    terminalMarkedTaskCost: {
      windowDays: 30,
      issueCount: 10,
      unpriced: 2,
      costUsd: 176.4,
      cashUsd: 100,
      unknownLaneUsd: 10,
      inFlightUsd: 42.5,
      overheadUsd: 12.3,
      closeOutLineageShare: 0.7,
      evidenceLinkedShare: 0.9,
      opencodeSummedShare: 0.4,
      unknownHarnessShare: 0.05,
      pricedLineageShare: 0.8,
      attributableLineageShare: 0.95,
      captureRateShare: 0.85
    },
    weeklyBudgetGauge: {
      resetAt: '2026-06-05T06:00:00.000Z',
      nextResetAt: '2026-06-12T06:00:00.000Z',
      hoursElapsed: 126,
      usdPerPoint: 39.65,
      percentConsumed: 56.3,
      percentSource: 'telemetry-estimate',
      burnRatePerHour: 1.5,
      projectedExhaustionAt: '2026-06-13T02:00:00.000Z',
      checkpoint: null,
      windowLineageCount: 40,
      windowPricedLineageShare: 0.9,
      dayBars: { days: ['2026-06-09', '2026-06-10'], costUsd: [45.2, 61.8] }
    },
    funnel: { dispatched: 20, taken: 15, reported: 12, completed: 9 },
    dispatchKinds: [{ label: 'autopilot', count: 4 }, { label: 'research', count: 3 }],
    stepOutcomes: { completed: 5, failed: 1, blocked: 0, other: 2 },
    proxyStatus: { ok: 30, clientError: 2, serverError: 1 },
    proxyStatusHourly: { ok: 5, clientError: 0, serverError: 1 },
    topEndpoints: [{ label: '/api/proxy/me', count: 9 }],
    topEndpointsHourly: [{ label: '/api/proxy/me', count: 2 }],
    hourOfDay: Array.from({ length: 24 }, (_, h) => h),
    freeTier: { days: ['2026-06-09', '2026-06-10'], counts: [4, 6] },
    vanity: {
      busiestDay: { day: '2026-06-10', count: 26 },
      readsPerWrite: 12.4,
      medianQueueToTakeMinutes: 11,
      dbBackend: 'mangodb'
    },
    ...overrides
  };
}

describe('renderKpisPage', () => {
  test('renders stat cards with formatted values', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(html.includes('instance kpis'));
    assert.ok(html.includes('1,234'), 'agent actions formatted with separator');
    assert.ok(html.includes('workspaces'));
    assert.ok(html.includes('autopilot runs · 30d'));
    assert.ok(html.includes('prompts dispatched · 30d'));
    assert.ok(html.includes('data-section="kpi-cards"'));
  });

  test('stat cards ride on the shared .card primitive alongside kpi-* hooks', () => {
    const html = renderKpisPage(buildStats());

    // Shared primitive class + KPI hook + value/label spans preserved.
    assert.ok(html.includes('class="card kpi-card"'), 'stat blocks use the .card primitive');
    assert.ok(html.includes('<span class="kpi-card-value">'), 'value span hook preserved');
    assert.ok(html.includes('<span class="kpi-card-label">'), 'label span hook preserved');
  });

  test('chart boxes ride on the shared boxed .section primitive alongside kpi-* hooks', () => {
    const html = renderKpisPage(buildStats());

    // Shared primitive classes + KPI hook + tree glyph + unclassed h3 preserved.
    assert.ok(
      html.includes('class="section section--boxed kpi-chart-box"'),
      'chart boxes use the boxed .section primitive'
    );
    assert.ok(
      html.includes('class="section section--boxed kpi-chart-box kpi-chart-wide"'),
      'the wide hero chart keeps its kpi-chart-wide hook alongside the primitive'
    );
    assert.ok(html.includes('<span class="kpi-tree-glyph">├─</span>'), 'tree glyph preserved');
    // titleClass:'' leaves the h3 unclassed so `.kpi-chart-box h3` still styles it.
    assert.ok(html.includes('<h3><span><span class="kpi-tree-glyph">'), 'chart h3 stays unclassed');
  });

  test('renders all chart canvases and loads Chart.js + page script', () => {
    const html = renderKpisPage(buildStats());

    for (const id of [
      'chart-proxy-phases', 'chart-weekly-budget', 'chart-outcome-trend', 'chart-dispatch-weekly',
      'chart-dispatch-kinds', 'chart-funnel', 'chart-step-outcomes',
      'chart-proxy-status', 'chart-top-endpoints', 'chart-hour-of-day',
      'chart-free-tier'
    ]) {
      assert.ok(html.includes(`id="${id}"`), `missing canvas ${id}`);
    }
    assert.ok(html.includes('src="/chart.umd.min.js"'));
    assert.ok(html.includes('src="/kpis.js"'));
    assert.ok(html.includes('href="/kpis.css"'));
  });

  test('renders a 30d/24h range toggle on the proxy-phases chart, defaulting to 30d', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(html.includes('class="kpi-range-toggle" data-chart="chart-proxy-phases"'));
    assert.ok(html.includes('class="kpi-range-btn is-active" data-range="30d"'));
    assert.ok(html.includes('class="kpi-range-btn" data-range="24h"'));
  });

  test('renders a 30d/24h range toggle on proxy responses and top proxy endpoints too (LIN-1846)', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(html.includes('class="kpi-range-toggle" data-chart="chart-proxy-status"'));
    assert.ok(html.includes('class="kpi-range-toggle" data-chart="chart-top-endpoints"'));
    // Hero chart + proxy responses + top endpoints: exactly these three, and
    // no other chart (the volume-led scope decision — LIN-1846).
    assert.strictEqual(html.match(/kpi-range-toggle/g).length, 3);
  });

  test('titles the newly-windowed charts honestly (LIN-1846)', () => {
    const html = renderKpisPage(buildStats());

    // The 35-day weekly span exceeded 30-day retention; it is now a genuine
    // 30-day daily-bucketed window, so the title drops "weekly".
    assert.ok(html.includes('dispatched work by kind · 30d'));
    assert.ok(!html.includes('dispatched work by kind · weekly'));
    // proxy responses previously carried no window label at all
    assert.ok(html.includes('proxy responses · 30d'));
  });

  test('renders the headline outcome number with its slices and coverage label', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(html.includes('class="card kpi-headline"'), 'headline rides the shared .card primitive');
    assert.ok(html.includes('>87%</a>'), '0.872 renders as a rounded percentage, not a raw ratio');
    assert.ok(html.includes('of dispatched work landed · 30d'));
    assert.ok(html.includes('done 41 · failed 4 · aborted 2'), 'the three slices stay legible');
    assert.ok(
      html.includes('47 of 63 dispatches resolved · 30d'),
      'the coverage sub-label is mandatory: the rate must not read as covering all dispatched work'
    );
  });

  test('the headline links to the chart box that substantiates it', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(html.includes('<a class="kpi-headline-value" href="#kpi-outcome-evidence">'), 'headline value is the link');
    // The anchor must sit on the SECTION WRAPPER: emptyUnless() replaces the
    // canvas with a note, which would destroy a canvas-borne id.
    assert.ok(
      html.includes('class="section section--boxed kpi-chart-box" id="kpi-outcome-evidence"'),
      'anchor id belongs on the chart box wrapper'
    );
    assert.ok(
      !html.includes('<canvas id="kpi-outcome-evidence"'),
      'anchor id must NOT be on the canvas'
    );
    // Exactly one anchor target, and only the outcome box carries one.
    assert.strictEqual(html.match(/id="kpi-outcome-evidence"/g).length, 1);
  });

  test('renders an em dash with no anchor when the rate is unavailable', () => {
    const html = renderKpisPage(buildStats({
      dispatchOutcomes: {
        windowDays: 30, total: 4, resolved: 0, done: 0, failed: 0, aborted: 0,
        rate: null, weeks: ['2026-05-13', '2026-05-20', '2026-05-27', '2026-06-03'],
        weeklyRate: [null, null, null, null], weeklyResolved: [0, 0, 0, 0]
      }
    }));

    assert.ok(html.includes('<span class="kpi-headline-value">—</span>'), 'empty state renders a dash');
    // A link to an empty chart is a dead end.
    assert.ok(!html.includes('href="#kpi-outcome-evidence"'), 'no anchor when there is no rate');
    assert.ok(html.includes('of dispatched work landed · 30d'), 'the label stays intact');
    assert.ok(html.includes('0 of 4 dispatches resolved · 30d'), 'coverage still tells the truth');
  });

  test('the headline sits above the volume cards and is not one of them', () => {
    const html = renderKpisPage(buildStats());

    assert.ok(
      html.indexOf('kpi-headline') < html.indexOf('data-section="kpi-cards"'),
      'headline renders above the stat card grid'
    );
    // It is a ratio, not a count — it must not join the .kpi-cards grid (the
    // e2e count of 11 volume cards depends on this).
    const cardsBlock = html.slice(html.indexOf('data-section="kpi-cards"'));
    assert.ok(!cardsBlock.slice(0, cardsBlock.indexOf('</div>')).includes('kpi-headline'));
  });

  test('embeds the stats payload for the client script', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('window.__KPI_DATA__ = {'));
    assert.ok(html.includes('"agentActions":1234'));
  });

  test('escapes < in the embedded payload so it cannot close the script tag', () => {
    const stats = buildStats({
      dispatchKinds: [{ label: '</script><script>alert(1)', count: 1 }]
    });
    const html = renderKpisPage(stats);
    assert.ok(!html.includes('</script><script>alert(1)'));
    assert.ok(html.includes('\\u003c/script>'));
  });

  test('renders vanity strip and noindex meta', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('busiest day'));
    assert.ok(html.includes('reads per write: <strong>12.4:1</strong>'));
    assert.ok(html.includes('median queue→take latency: <strong>11m</strong>'));
    assert.ok(html.includes('mangodb'));
    assert.ok(html.includes('<meta name="robots" content="noindex">'));
  });

  test('formats long median queue→take latency in hours', () => {
    const html = renderKpisPage(buildStats({
      vanity: { busiestDay: null, readsPerWrite: null, medianQueueToTakeMinutes: 150, dbBackend: null }
    }));
    assert.ok(html.includes('median queue→take latency: <strong>2.5h</strong>'));
  });

  test('omits empty vanity stats when there is no activity', () => {
    const html = renderKpisPage(buildStats({
      vanity: { busiestDay: null, readsPerWrite: null, medianQueueToTakeMinutes: null, dbBackend: null }
    }));
    assert.ok(!html.includes('busiest day'));
    assert.ok(!html.includes('reads per write'));
    assert.ok(!html.includes('median queue→take latency'));
    assert.ok(html.includes('generated:'));
  });
});

describe('renderKpisPage: cost-per-terminal-marked-task card (LIN-1958)', () => {
  test('renders the pinned label exactly', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(
      html.includes('<span class="kpi-cost-label">cost per terminal-marked task</span>'),
      'label must be pinned verbatim, exact string'
    );
  });

  test('the per-task figure divides by the FULLY-PRICED denominator (issueCount - unpriced), not issueCount', () => {
    // costUsd 176.4 over 10 issues, 2 unpriced: the correct per-task figure
    // divides by the 8 fully-priced issues (176.4 / 8 = 22.05). Dividing by
    // issueCount instead (176.4 / 10 = 17.64) is the exact regression this
    // guards against — a "simplification" that drops `- unpriced` produces a
    // DIFFERENT number, so this test fails loudly if that happens.
    const html = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 10, unpriced: 2, costUsd: 176.4,
        cashUsd: 100, unknownLaneUsd: 10, inFlightUsd: 42.5, overheadUsd: 12.3,
        closeOutLineageShare: 0.7, evidenceLinkedShare: 0.9,
        opencodeSummedShare: 0.4, unknownHarnessShare: 0.05,
        pricedLineageShare: 0.8, attributableLineageShare: 0.95
      }
    }));
    assert.ok(html.includes('<span class="kpi-cost-value">$22.05</span>'), 'must divide by the fully-priced denominator');
    assert.ok(!html.includes('$17.64'), 'must NOT divide by the raw issueCount');
  });

  test('renders "—" when the fully-priced denominator is zero (all issues unpriced)', () => {
    const html = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 5, unpriced: 5, costUsd: null,
        cashUsd: null, unknownLaneUsd: null, inFlightUsd: null, overheadUsd: null,
        closeOutLineageShare: 0, evidenceLinkedShare: 0,
        opencodeSummedShare: 0, unknownHarnessShare: 0,
        pricedLineageShare: 0, attributableLineageShare: 0
      }
    }));
    assert.ok(html.includes('<span class="kpi-cost-value">—</span>'), 'zero fully-priced issues must render a dash, never $0/NaN');
  });

  test('renders "—" when costUsd is null even though issueCount - unpriced > 0', () => {
    const html = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 10, unpriced: 2, costUsd: null,
        cashUsd: null, unknownLaneUsd: null, inFlightUsd: null, overheadUsd: null,
        closeOutLineageShare: 0.7, evidenceLinkedShare: 0.9,
        opencodeSummedShare: 0.4, unknownHarnessShare: 0.05,
        pricedLineageShare: 0.8, attributableLineageShare: 0.95
      }
    }));
    assert.ok(html.includes('<span class="kpi-cost-value">—</span>'), 'a null costUsd must render a dash regardless of the denominator');
  });

  test('null renders "—" for all four shares plus both coverage ratios, distinct from a genuine 0 rendering "0%"', () => {
    const nullHtml = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 0, unpriced: 0, costUsd: null,
        cashUsd: null, unknownLaneUsd: null, inFlightUsd: null, overheadUsd: null,
        closeOutLineageShare: null, evidenceLinkedShare: null,
        opencodeSummedShare: null, unknownHarnessShare: null,
        pricedLineageShare: null, attributableLineageShare: null, captureRateShare: null
      }
    }));
    assert.ok(nullHtml.includes('close-out linked — · evidence linked — · opencode summed — · unknown harness —'), 'null shares render as dashes');
    assert.ok(nullHtml.includes('priced lineages — · capture rate — · attributable lineages —'), 'null coverage ratios render as dashes');

    const zeroHtml = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 4, unpriced: 0, costUsd: 40,
        cashUsd: 0, unknownLaneUsd: 0, inFlightUsd: null, overheadUsd: null,
        closeOutLineageShare: 0, evidenceLinkedShare: 0,
        opencodeSummedShare: 0, unknownHarnessShare: 0,
        pricedLineageShare: 0, attributableLineageShare: 0, captureRateShare: 0
      }
    }));
    assert.ok(zeroHtml.includes('close-out linked 0% · evidence linked 0% · opencode summed 0% · unknown harness 0%'), 'a genuine 0 must render as 0%, not be conflated with null');
    assert.ok(zeroHtml.includes('priced lineages 0% · capture rate 0% · attributable lineages 0%'), 'a genuine 0 coverage ratio must render as 0%');
  });

  test('inFlightUsd/overheadUsd null render "—", never $0', () => {
    const html = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 3, unpriced: 0, costUsd: 30,
        cashUsd: 30, unknownLaneUsd: 0, inFlightUsd: null, overheadUsd: null,
        closeOutLineageShare: 1, evidenceLinkedShare: 1,
        opencodeSummedShare: 0, unknownHarnessShare: 0,
        pricedLineageShare: 1, attributableLineageShare: 1
      }
    }));
    assert.ok(html.includes('unresolved — · resolved overhead —'), 'null USD lines render as dashes, never $0');
  });

  test('labels inFlightUsd "unresolved", never "in-flight" — it includes failed/aborted spend, not just running work', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('unresolved $42.50'), 'inFlightUsd must be labelled "unresolved"');
    assert.ok(!/in-flight/i.test(html), 'the rendered page must never say "in-flight"');
  });

  test('labels overheadUsd "resolved overhead", never a bare "overhead" (LIN-1958 review F2)', () => {
    // The LIN-1957 blocking handoff forbids deriving a rendered label from a
    // field name: overheadUsd is done AND issue-less spend ONLY (unresolved
    // issue-less spend routes to inFlightUsd/"unresolved" instead), so a
    // bare "overhead" would overstate it to a public reader as covering all
    // non-task spend. This test fails if the label regresses to the field
    // name, mirroring the existing "unresolved" regression test above.
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('resolved overhead $12.30'), 'overheadUsd must be labelled "resolved overhead"');
    // Scope the "no bare overhead" check to the rendered usd-lines span, not
    // the whole document — the embedded __KPI_DATA__ JSON payload legitimately
    // contains the raw "overheadUsd" field name (the ticket's own carve-out:
    // "the whole stats object is already embedded publicly ... anything
    // Session 1 emitted is already readable here"), which is not a rendered
    // label and must not fail this test.
    const usdLines = html.match(/<span class="kpi-cost-usd-lines">([^<]*)<\/span>/)[1];
    const withoutQualifiedLabel = usdLines.replace(/resolved overhead/g, '');
    assert.ok(!withoutQualifiedLabel.includes('overhead'), 'must never render a bare "overhead" once the qualified label text is stripped out');
  });

  test('plan-fee seam: unset renders "—" with the unset sub-label', () => {
    const html = renderKpisPage(buildStats(), { planFeeConfig: { monthlyUsd: null } });
    assert.ok(html.includes('cash: — · pending plan-fee configuration</span>'));
  });

  test('plan-fee seam: configured STILL renders "—", now with the amortisation-rule sub-label (no value invented)', () => {
    const html = renderKpisPage(buildStats(), { planFeeConfig: { monthlyUsd: 1500 } });
    assert.ok(
      html.includes('cash: — · plan fee configured · pending amortisation rule</span>'),
      'a configured plan fee must not invent a cash figure, but the blocker wording must change to name the missing amortisation rule'
    );
    assert.ok(!html.includes('pending plan-fee configuration</span>'), 'must not keep the unset-state wording once a value is configured');
  });

  test('plan-fee seam: an omitted planFeeConfig option degrades to the unset dash safely', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('cash: — · pending plan-fee configuration</span>'));
  });

  test('the card renders on the shared .card primitive, above and outside .kpi-cards (grid count unaffected)', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('class="card kpi-cost-card"'), 'rides the shared .card primitive');
    assert.ok(
      html.indexOf('kpi-cost-card') < html.indexOf('data-section="kpi-cards"'),
      'the cost card renders above the stat card grid'
    );
    const cardsBlock = html.slice(html.indexOf('data-section="kpi-cards"'));
    assert.ok(
      !cardsBlock.slice(0, cardsBlock.indexOf('</div>')).includes('kpi-cost-card'),
      'the cost card must not be one of the .kpi-cards grid cards (the e2e count of 11 depends on this)'
    );
    // 11 stat cards from buildStats().totals, unaffected by the new card.
    assert.strictEqual((html.match(/class="card kpi-card"/g) || []).length, 11);
  });

  test('never uses "verified" or a reserved-word synonym anywhere in the rendered page', () => {
    const html = renderKpisPage(buildStats(), { planFeeConfig: { monthlyUsd: 1500 } });
    assert.ok(!/verified/i.test(html), 'the metric is a strictly-weaker proxy and must never read as "verified"');
  });

  test('degrades safely when terminalMarkedTaskCost is entirely absent from stats', () => {
    const stats = buildStats();
    delete stats.terminalMarkedTaskCost;
    const html = renderKpisPage(stats);
    assert.ok(html.includes('<span class="kpi-cost-value">—</span>'));
    assert.ok(html.includes('close-out linked — · evidence linked — · opencode summed — · unknown harness —'));
    assert.ok(html.includes('unresolved — · resolved overhead —'));
  });

  test('publishes the figure\'s window as its own span, separate from the pinned label (LIN-1958 review F3)', () => {
    const html = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 10, unpriced: 2, costUsd: 176.4,
        cashUsd: 100, unknownLaneUsd: 10, inFlightUsd: 42.5, overheadUsd: 12.3,
        closeOutLineageShare: 0.7, evidenceLinkedShare: 0.9,
        opencodeSummedShare: 0.4, unknownHarnessShare: 0.05,
        pricedLineageShare: 0.8, attributableLineageShare: 0.95
      }
    }));
    assert.ok(html.includes('<span class="kpi-cost-window">30d window</span>'), 'the window must be disclosed');
    // The pinned label itself must stay byte-identical — the window is a
    // sibling span, never appended into the label text.
    assert.ok(html.includes('<span class="kpi-cost-label">cost per terminal-marked task</span>'));
  });

  test('publishes the sample size (issueCount) and exclusion count (unpriced) beside the shares (LIN-1958 review F4)', () => {
    const html = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 14, unpriced: 3, costUsd: 251.9384,
        cashUsd: 100, unknownLaneUsd: 10, inFlightUsd: 42.5, overheadUsd: 12.3,
        closeOutLineageShare: 0.7, evidenceLinkedShare: 0.9,
        opencodeSummedShare: 0.4, unknownHarnessShare: 1,
        pricedLineageShare: 0.8, attributableLineageShare: 0.95
      }
    }));
    // The handoff specifically nominated unpriced/issueCount as the coverage
    // story that DOES cover whole-lineage capture loss, unlike
    // pricedLineageShare — so a reader of "unknown harness 100%" can see the
    // N it is a share of, not just the bare ratio.
    assert.ok(html.includes('<span class="kpi-cost-sample">14 terminal-marked issues · 3 unpriced (excluded)</span>'));
  });

  test('captureRateShare (LIN-1959) renders beside pricedLineageShare and discloses the capture loss pricedLineageShare cannot see', () => {
    // The exact scenario the ticket names: priced lineages reads 100% (every
    // usage-bearing lineage priced) while the true capture rate is low (most
    // of what ran never posted usage at all) — pricedLineageShare alone would
    // read as full coverage next to it. Both must render, and pricedLineageShare
    // must NOT be replaced.
    const html = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 5, unpriced: 0, costUsd: 50,
        cashUsd: 50, unknownLaneUsd: 0, inFlightUsd: null, overheadUsd: null,
        closeOutLineageShare: 1, evidenceLinkedShare: 1,
        opencodeSummedShare: 0, unknownHarnessShare: 0,
        pricedLineageShare: 1, attributableLineageShare: 0.29, captureRateShare: 0.29
      }
    }));
    assert.ok(
      html.includes('priced lineages 100% · capture rate 29% · attributable lineages 29%'),
      'the true capture rate must sit directly beside priced lineages, and priced lineages must remain published unchanged'
    );
  });

  test('formatShare: a real non-zero share below the rounding threshold renders "<1%", never a false "0%" (LIN-1958 review F5)', () => {
    const html = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 250, unpriced: 0, costUsd: 100,
        cashUsd: 0, unknownLaneUsd: 0, inFlightUsd: null, overheadUsd: null,
        closeOutLineageShare: 0.004, evidenceLinkedShare: 1,
        opencodeSummedShare: 0, unknownHarnessShare: 0,
        pricedLineageShare: 1, attributableLineageShare: 1
      }
    }));
    // "<1%" is HTML-escaped by escapeHtml() like any other rendered text.
    assert.ok(html.includes('close-out linked &lt;1%'), 'a real non-zero share under the rounding threshold must not collapse to a false "0%"');
  });

  test('formatShare: a genuine zero still renders "0%", distinct from "<1%" and "—"', () => {
    const html = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 4, unpriced: 0, costUsd: 40,
        cashUsd: 0, unknownLaneUsd: 0, inFlightUsd: null, overheadUsd: null,
        closeOutLineageShare: 0, evidenceLinkedShare: 1,
        opencodeSummedShare: 0, unknownHarnessShare: 0,
        pricedLineageShare: 1, attributableLineageShare: 1
      }
    }));
    assert.ok(html.includes('close-out linked 0%'), 'an exact 0 must still render as 0%, not <1% or —');
  });

  test('formatShare: null still renders "—", distinct from "0%" and "<1%"', () => {
    const html = renderKpisPage(buildStats({
      terminalMarkedTaskCost: {
        windowDays: 30, issueCount: 0, unpriced: 0, costUsd: null,
        cashUsd: null, unknownLaneUsd: null, inFlightUsd: null, overheadUsd: null,
        closeOutLineageShare: null, evidenceLinkedShare: null,
        opencodeSummedShare: null, unknownHarnessShare: null,
        pricedLineageShare: null, attributableLineageShare: null
      }
    }));
    assert.ok(html.includes('close-out linked —'), 'null must still render as a dash, not 0% or <1%');
  });
});

describe('renderKpisPage: weekly-budget burn gauge card (LIN-2118)', () => {
  test('renders the estimate value, and labels it as an estimate never a direct meter read', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('<span class="kpi-budget-value">56.3%</span>'));
    assert.ok(html.includes('of weekly subscription window consumed (estimate)'));
    assert.ok(html.includes('never a direct meter read'));
  });

  test('sources the estimate from telemetry when no operator checkpoint exists this window', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('estimate from telemetry alone — no operator reading yet this window'));
  });

  test('sources the estimate from an operator reading, naming its timestamp, when a checkpoint exists', () => {
    const html = renderKpisPage(buildStats({
      weeklyBudgetGauge: {
        resetAt: '2026-06-05T06:00:00.000Z', nextResetAt: '2026-06-12T06:00:00.000Z',
        hoursElapsed: 10, usdPerPoint: 39.65, percentConsumed: 42, percentSource: 'operator-reading',
        burnRatePerHour: 1.2, projectedExhaustionAt: null,
        checkpoint: { percent: 40, at: '2026-06-05T16:00:00.000Z' },
        windowLineageCount: 5, windowPricedLineageShare: 1, dayBars: { days: [], costUsd: [] }
      }
    }));
    assert.ok(html.includes('estimate anchored to an operator reading at 2026-06-05 16:00 UTC'));
  });

  test('renders the burn rate and the projected clip time', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('burn rate 1.5 pts/hr (last 24h)'));
    assert.ok(html.includes('at this rate the window exhausts 2026-06-13 02:00 UTC'));
  });

  test('a null projection renders an honest "not projected", never a fabricated time', () => {
    const html = renderKpisPage(buildStats({
      weeklyBudgetGauge: {
        resetAt: '2026-06-05T06:00:00.000Z', nextResetAt: '2026-06-12T06:00:00.000Z',
        hoursElapsed: 1, usdPerPoint: 39.65, percentConsumed: null, percentSource: 'none',
        burnRatePerHour: null, projectedExhaustionAt: null, checkpoint: null,
        windowLineageCount: 0, windowPricedLineageShare: null, dayBars: { days: [], costUsd: [] }
      }
    }));
    assert.ok(html.includes('<span class="kpi-budget-value">—</span>'));
    assert.ok(html.includes('no data yet this window'));
    assert.ok(html.includes('not projected to exhaust at the current rate'));
  });

  test('publishes the window span and the priced-lineage provenance disclosure beside the number', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('window 2026-06-05 06:00 UTC → 2026-06-12 06:00 UTC'));
    assert.ok(html.includes('40 lineages this window · 90% priced'));
  });

  test('degrades safely when weeklyBudgetGauge is entirely absent from stats', () => {
    const stats = buildStats();
    delete stats.weeklyBudgetGauge;
    const html = renderKpisPage(stats);
    assert.ok(html.includes('<span class="kpi-budget-value">—</span>'));
    assert.ok(html.includes('no data yet this window'));
  });

  test('the card renders on the shared .card primitive, above and outside .kpi-cards (grid count unaffected)', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(html.includes('class="card kpi-budget-card"'));
    assert.ok(
      html.indexOf('kpi-budget-card') < html.indexOf('data-section="kpi-cards"'),
      'the budget card renders above the stat card grid'
    );
    assert.strictEqual((html.match(/class="card kpi-card"/g) || []).length, 11);
  });

  test('never uses "verified" or a reserved-word synonym anywhere in the rendered page', () => {
    const html = renderKpisPage(buildStats());
    assert.ok(!/verified/i.test(html));
  });
});
