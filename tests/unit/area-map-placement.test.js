// LIN-3729: pin the code-shape area map for files that a name pattern in
// the area registry used to misfile. First matching area wins. The registry is docs/areas/areas.json
// since LIN-4371 (it was scripts/code-shape/areas.json).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { areaNameOf as areaOf } from './helpers/area-registry.js';

describe('code-shape area map placement (LIN-3729)', () => {
  // LIN-4201: the cost code gets a real area. The one read, the snapshot fold, the lineage membership and the request-record vocabulary
  // sit in Runs & dispatch beside the request-usage modules (the record fold and the loader); without their names they fell
  // through to the catch-all `^lib/` in "Other features". The workspace KPIs page cache sits with the page's read.
  test('the cost read and its folds land in Runs & dispatch, beside request-usage-*', () => {
    for (const path of ['lib/cost-read.js', 'lib/row-usage.js', 'lib/lineage-membership.js', 'lib/request-usage-vocabulary.js',
      'lib/request-usage-fold.js', 'lib/request-usage-loader.js']) {
      assert.strictEqual(areaOf(path), 'Runs & dispatch', path);
    }
    assert.strictEqual(areaOf('lib/workspace-kpis-cache.js'), 'Reports & operator tools');
    assert.strictEqual(areaOf('lib/workspace-kpi-stats.js'), 'Reports & operator tools');
  });

  test('the three relabelled files land in their owning areas', () => {
    assert.strictEqual(areaOf('lib/proxy-fetch.js'), 'Platform & plumbing');
    assert.strictEqual(areaOf('lib/openrouter-key-resolver.js'), 'Auth, accounts & workspaces');
    assert.strictEqual(areaOf('lib/guest-task-path.js'), 'Auth, accounts & workspaces');
    assert.strictEqual(areaOf('lib/vendor-assets.js'), 'Platform & plumbing'); // LIN-3787
  });

  test('sibling files the lookaheads must not steal stay where they were', () => {
    assert.strictEqual(areaOf('lib/proxy-wire.js'), 'Agent API (proxy)');
    assert.strictEqual(areaOf('lib/openrouter.js'), 'LLM & prompts');
    assert.strictEqual(areaOf('lib/pat-session.js'), 'Auth, accounts & workspaces');
  });

  // LIN-3554: task ordering is its own area; graph-features is relabelled into it
  // (first match wins, so Task model must sit ahead of LLM & prompts).
  test('task ordering and the blocking-graph primitives land in Task model', () => {
    assert.strictEqual(areaOf('lib/task-order.js'), 'Task model');
    assert.strictEqual(areaOf('lib/graph-features.js'), 'Task model');
    assert.strictEqual(areaOf('lib/tree.js'), 'Front end: server-rendered pages');
  });

  // LIN-3852: the LLM job registry is a leaf of the LLM area; without its pattern
  // it would fall through to the catch-all `^lib/` in "Other features".
  test('the LLM job registry lands in LLM & prompts', () => {
    assert.strictEqual(areaOf('lib/llm-jobs.js'), 'LLM & prompts');
    assert.strictEqual(areaOf('lib/llm-call-log.js'), 'LLM & prompts');
  });

  // LIN-3829: the retention checker is a new production file in the code-shape kit. Its pattern is
  // narrow: a directory-wide pattern would re-file the kit's existing files and change cochange pair counts.
  test('the retention checker lands in Reports & operator tools; its siblings stay unmapped', () => {
    assert.strictEqual(areaOf('scripts/code-shape/retention.mjs'), 'Reports & operator tools');
    assert.strictEqual(areaOf('scripts/code-shape/retention-core.mjs'), 'Reports & operator tools');
    assert.strictEqual(areaOf('scripts/code-shape/verbatim.mjs'), undefined);
    assert.strictEqual(areaOf('scripts/code-shape/code-shape-lib.mjs'), undefined);
  });

  // LIN-3754: the task board view model composes the ordering rules for the
  // three boards. It is filed with the pages because each board's composition is
  // a page choice; under Task model it would add a new "pages ⇄ Task model" pair.
  test('the task board view model lands in the server-rendered pages', () => {
    assert.strictEqual(areaOf('lib/task-board-view.js'), 'Front end: server-rendered pages');
  });

  // LIN-4371: the `## As asked` block's owner sits with the prompts that read it (the brief, the stage contract, stage
  // intent's CUT). It used to fall through to the catch-all `^lib/` in "Other features", which filed every area note about
  // the block's words under the catch-all. Its seal (as-asked-seal.js, the create lanes) is not moved with it.
  test('the As-asked block owner lands in LLM & prompts; its seal does not move', () => {
    assert.strictEqual(areaOf('lib/as-asked.js'), 'LLM & prompts');
    assert.strictEqual(areaOf('lib/as-asked-seal.js'), 'Other features');
  });

  // LIN-4369: the size record's owner supplies the scoping prompt's words (sizes, decided-by values, record parts)
  // and the selector's facts line, beside the As-asked owner. It fell through to the catch-all when LIN-4368 added it.
  test('the size record owner lands in LLM & prompts', () => {
    assert.strictEqual(areaOf('lib/size-of-move.js'), 'LLM & prompts');
  });
});
