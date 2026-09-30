/**
 * scripts/lin3014/capture-kpis.mjs (LIN-3014)
 *
 * Records the app's REAL /kpis read shapes (via the real collectKpiStats,
 * against recording stubs — no DB, no network) so measure.template.js's
 * /kpis measurements can never drift from what the app actually reads.
 * Unlike the research-scratch version, this resolves lib/kpi-stats.js from
 * its own file location instead of a hard-coded absolute path.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { collectKpiStats } from '../../lib/kpi-stats.js';
import { captureKpiReads } from '../../scripts/lin3014/capture-kpis.mjs';

test('LIN-3014 captureKpiReads: captures the real dispatchHistory/proxyEvents/reportHistory read shapes', async () => {
  const captured = await captureKpiReads(collectKpiStats);
  assert.strictEqual(captured.dispatchHistory.op, 'aggregate');
  assert.ok(Array.isArray(captured.dispatchHistory.pipeline) && captured.dispatchHistory.pipeline.length >= 1);
  assert.ok(captured.dispatchHistory.pipeline.some(s => s.$project), 'the pipeline must carry the $project kpi-stats.js builds (FRESH_DIGEST cond lives inside it)');

  assert.strictEqual(captured.proxyEvents.op, 'aggregate');
  assert.ok(Array.isArray(captured.proxyEvents.pipeline));

  assert.strictEqual(captured.reportHistory.op, 'find');
  assert.deepStrictEqual(captured.reportHistory.filter, {});
});

test('LIN-3014 captureKpiReads: the captured dispatchHistory pipeline carries a FRESH_DIGEST $cond usable by measure.template.js', () => {
  return captureKpiReads(collectKpiStats).then((captured) => {
    const project = captured.dispatchHistory.pipeline.find(s => s.$project).$project;
    assert.ok(project.feedbackCount?.$cond, 'measure.template.js reads FRESH = the $project stage\'s feedbackCount.$cond[0]');
    assert.strictEqual(Array.isArray(project.feedbackCount.$cond), true);
  });
});
