/**
 * Sample dependency graph for the swim-flow prototype.
 *
 * Mirrors the complexity of the real mobile screenshot: chains, a fan-out
 * (one ticket gating several), a fan-in bottleneck, a nested subtask group,
 * plus a couple of independent components and solo tasks.
 *
 * Edge model (directed):
 *   blocks  — this issue must finish before the listed issues can proceed
 *   parent  — listed children belong to this issue (subtask group)
 *
 * state: started | todo | backlog | done
 */
window.SAMPLE = [
  // ── Component 1: HARBOUR runtime ───────────────────────────────────────────
  { id: 'HAR-149', title: 'Harbour runtime — GA epic', group: 'HARBOUR RUNTIME', state: 'started',
    blocks: ['HAR-497', 'HAR-517'] },

  // JSX-APP chain, with a nested subtask group under HAR-497
  { id: 'HAR-497', title: 'JSX-app import pipeline', group: 'HARBOUR: JSX-APP', state: 'started',
    blocks: ['HAR-501'], children: ['HAR-497a', 'HAR-497b'] },
  { id: 'HAR-497a', title: 'Parser front-end', group: 'HARBOUR: JSX-APP', state: 'started', parent: 'HAR-497' },
  { id: 'HAR-497b', title: 'Render bridge', group: 'HARBOUR: JSX-APP', state: 'started', parent: 'HAR-497',
    children: ['HAR-497b1', 'HAR-497b2'] },
  { id: 'HAR-497b1', title: 'Canvas paint path', group: 'HARBOUR: JSX-APP', state: 'started', parent: 'HAR-497b',
    blocks: ['HAR-497b2'] },
  { id: 'HAR-497b2', title: 'Virtualized scroll buffer', group: 'HARBOUR: JSX-APP', state: 'todo', parent: 'HAR-497b' },
  { id: 'HAR-501', title: 'Source map fixups', group: 'HARBOUR: JSX-APP', state: 'todo', blocks: ['HAR-502'] },
  { id: 'HAR-502', title: 'Tree-shake dead imports', group: 'HARBOUR: JSX-APP', state: 'todo', blocks: ['HAR-444'] },

  // Worker spawn — a fan-out point
  { id: 'HAR-517', title: 'Worker spawn supervisor', group: 'HARBOUR WORKER SPAWN', state: 'started',
    blocks: ['HAR-519', 'HAR-444'] },

  // Promote chain
  { id: 'HAR-519', title: 'Promote-on-ready gate', group: 'HARBOUR: PROMOTE', state: 'started', blocks: ['HAR-522'] },
  { id: 'HAR-522', title: 'Rollback guard', group: 'HARBOUR: PROMOTE', state: 'started', blocks: ['HAR-660'] },

  // Phase E
  { id: 'HAR-444', title: 'Phase-E migration runner', group: 'HAR-149-E: PHASE E', state: 'started', blocks: ['HAR-498'] },
  { id: 'HAR-498', title: 'Phase-E verification', group: 'HAR-149-E: PHASE E', state: 'started', blocks: ['HAR-660'] },

  // Fan-in bottleneck — three things converge here
  { id: 'HAR-660', title: 'GA cutover', group: 'HARBOUR RUNTIME', state: 'todo' },

  // ── Component 2: independent 2-chain ───────────────────────────────────────
  { id: 'DOC-30', title: 'Rewrite proxy integration guide', group: 'DOCS', state: 'todo', blocks: ['DOC-31'] },
  { id: 'DOC-31', title: 'Publish to docs site', group: 'DOCS', state: 'backlog' },

  // ── Component 3: solo task (no dependencies) ───────────────────────────────
  { id: 'INF-7', title: 'Bump CI runner image', group: 'INFRA', state: 'todo' }
];
