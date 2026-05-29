/**
 * Sample dependency graph for the swim-flow prototype.
 *
 * A realistic Linear-style hierarchy: epic → sub-epic → story → task →
 * sub-task, with cross-cutting blocking relationships (chains, a fan-out,
 * and a fan-in bottleneck) plus a couple of independent components.
 *
 * Fields:
 *   id, title
 *   type   epic | story | task
 *   state  started | todo | backlog | done
 *   parent (optional) — hierarchy edge; renders as a nested "blue box"
 *   blocks (optional)  — array of ids this issue must finish before
 */
window.SAMPLE = [
  // ── HARBOUR epic tree ──────────────────────────────────────────────────────
  { id: 'HAR-100', title: 'Harbour 2.0 platform', type: 'epic', state: 'started' },

  { id: 'HAR-149', title: 'Runtime GA', type: 'epic', state: 'started', parent: 'HAR-100' },

  { id: 'HAR-497', title: 'JSX-app import pipeline', type: 'story', state: 'started', parent: 'HAR-149', blocks: ['HAR-501'] },
  { id: 'HAR-497a', title: 'Parser front-end', type: 'task', state: 'started', parent: 'HAR-497' },
  { id: 'HAR-497b', title: 'Render bridge', type: 'story', state: 'started', parent: 'HAR-497' },
  { id: 'HAR-497b1', title: 'Canvas paint path', type: 'task', state: 'started', parent: 'HAR-497b', blocks: ['HAR-497b2'] },
  { id: 'HAR-497b2', title: 'Virtualized scroll buffer', type: 'task', state: 'todo', parent: 'HAR-497b' },

  { id: 'HAR-501', title: 'Source map fixups', type: 'task', state: 'todo', parent: 'HAR-149', blocks: ['HAR-502'] },
  { id: 'HAR-502', title: 'Tree-shake dead imports', type: 'task', state: 'todo', parent: 'HAR-149', blocks: ['HAR-444'] },

  { id: 'HAR-517', title: 'Worker spawn supervisor', type: 'story', state: 'started', parent: 'HAR-100', blocks: ['HAR-519', 'HAR-444'] },

  { id: 'HAR-444', title: 'Phase-E migration runner', type: 'story', state: 'started', parent: 'HAR-100', blocks: ['HAR-498'] },
  { id: 'HAR-444a', title: 'Schema diff', type: 'task', state: 'started', parent: 'HAR-444', blocks: ['HAR-444b'] },
  { id: 'HAR-444b', title: 'Backfill job', type: 'task', state: 'todo', parent: 'HAR-444' },

  { id: 'HAR-498', title: 'Phase-E verification', type: 'task', state: 'started', parent: 'HAR-100', blocks: ['HAR-660'] },

  { id: 'HAR-519', title: 'Promote-on-ready gate', type: 'task', state: 'started', parent: 'HAR-100', blocks: ['HAR-522'] },
  { id: 'HAR-522', title: 'Rollback guard', type: 'task', state: 'started', parent: 'HAR-100', blocks: ['HAR-660'] },

  { id: 'HAR-660', title: 'GA cutover', type: 'task', state: 'todo', parent: 'HAR-100' },

  // ── Independent: docs 2-chain ────────────────────────────────────────────────
  { id: 'DOC-30', title: 'Rewrite proxy integration guide', type: 'story', state: 'todo', blocks: ['DOC-31'] },
  { id: 'DOC-31', title: 'Publish to docs site', type: 'task', state: 'backlog', parent: 'DOC-30' },

  // ── Independent: solo task ───────────────────────────────────────────────────
  { id: 'INF-7', title: 'Bump CI runner image', type: 'task', state: 'todo' }
];
