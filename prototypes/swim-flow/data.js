/**
 * Sample dependency graph for the swim-flow prototype.
 *
 * A realistic Linear-style hierarchy: epic → sub-epic → story → task →
 * sub-task, with cross-cutting blocking relationships (chains, a fan-out,
 * and a fan-in bottleneck) plus a couple of independent components.
 *
 * Fields:
 *   id, title
 *   type    epic | story | task
 *   state   started | todo | backlog | done
 *   parent  (optional) — hierarchy edge; renders as a nested "blue box"
 *   blocks  (optional) — array of ids this issue must finish before
 *   a       assignee (initials/handle)
 *   p       priority: urgent | high | med | low
 *   labels  (optional) — array of label strings
 */
window.SAMPLE = [
  // ── HARBOUR epic tree ──────────────────────────────────────────────────────
  { id: 'HAR-100', title: 'Harbour 2.0 platform', type: 'epic', state: 'started', a: 'mira', p: 'high' },

  { id: 'HAR-149', title: 'Runtime GA', type: 'epic', state: 'started', parent: 'HAR-100', a: 'mira', p: 'high' },

  { id: 'HAR-497', title: 'JSX-app import pipeline', type: 'story', state: 'started', parent: 'HAR-149', blocks: ['HAR-501'], a: 'alex', p: 'high', labels: ['runtime'] },
  { id: 'HAR-497a', title: 'Parser front-end', type: 'task', state: 'started', parent: 'HAR-497', a: 'alex', p: 'med' },
  { id: 'HAR-497b', title: 'Render bridge', type: 'story', state: 'started', parent: 'HAR-497', a: 'sam', p: 'med' },
  { id: 'HAR-497b1', title: 'Canvas paint path', type: 'task', state: 'started', parent: 'HAR-497b', blocks: ['HAR-497b2'], a: 'sam', p: 'med', labels: ['perf'] },
  { id: 'HAR-497b2', title: 'Virtualized scroll buffer', type: 'task', state: 'todo', parent: 'HAR-497b', a: 'sam', p: 'low' },

  { id: 'HAR-501', title: 'Source map fixups', type: 'task', state: 'todo', parent: 'HAR-149', blocks: ['HAR-502'], a: 'jo', p: 'med' },
  { id: 'HAR-502', title: 'Tree-shake dead imports', type: 'task', state: 'todo', parent: 'HAR-149', blocks: ['HAR-444'], a: 'jo', p: 'low', labels: ['perf'] },

  { id: 'HAR-517', title: 'Worker spawn supervisor', type: 'story', state: 'started', parent: 'HAR-100', blocks: ['HAR-519', 'HAR-444'], a: 'alex', p: 'urgent', labels: ['infra'] },

  { id: 'HAR-444', title: 'Phase-E migration runner', type: 'story', state: 'started', parent: 'HAR-100', blocks: ['HAR-498'], a: 'mira', p: 'high', labels: ['migration'] },
  { id: 'HAR-444a', title: 'Schema diff', type: 'task', state: 'started', parent: 'HAR-444', blocks: ['HAR-444b'], a: 'mira', p: 'high' },
  { id: 'HAR-444b', title: 'Backfill job', type: 'task', state: 'todo', parent: 'HAR-444', a: 'jo', p: 'med' },

  { id: 'HAR-498', title: 'Phase-E verification', type: 'task', state: 'started', parent: 'HAR-100', blocks: ['HAR-660'], a: 'sam', p: 'high' },

  { id: 'HAR-519', title: 'Promote-on-ready gate', type: 'task', state: 'started', parent: 'HAR-100', blocks: ['HAR-522'], a: 'alex', p: 'high' },
  { id: 'HAR-522', title: 'Rollback guard', type: 'task', state: 'started', parent: 'HAR-100', blocks: ['HAR-660'], a: 'alex', p: 'urgent', labels: ['infra'] },

  { id: 'HAR-660', title: 'GA cutover', type: 'task', state: 'todo', parent: 'HAR-100', a: 'mira', p: 'urgent', labels: ['release'] },

  // ── Independent: docs 2-chain ────────────────────────────────────────────────
  { id: 'DOC-30', title: 'Rewrite proxy integration guide', type: 'story', state: 'todo', blocks: ['DOC-31'], a: 'jo', p: 'low', labels: ['docs'] },
  { id: 'DOC-31', title: 'Publish to docs site', type: 'task', state: 'backlog', parent: 'DOC-30', a: 'jo', p: 'low' },

  // ── Independent: solo task ───────────────────────────────────────────────────
  { id: 'INF-7', title: 'Bump CI runner image', type: 'task', state: 'todo', a: 'sam', p: 'low', labels: ['infra'] }
];
