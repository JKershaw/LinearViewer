// Seeded input generators.
//
//   Tier A ("gen-a"): provider-shaped `projects` + `issues` (the canonical issue
//     shape the Linear/local providers emit: state{name,type}, project{id,name},
//     parent{id}, assignee{name}, labels{nodes}, relations{nodes:[{type,
//     relatedIssue{id}}]}, completedAt, estimate, priority, sortOrder ...) run
//     through main's real buildRoadmapModel under the frozen clock.
//   Tier B ("gen-b"): a roadmapModel built directly, starting from a Tier A
//     model and then mutated into shapes buildRoadmapModel cannot produce.
//   Targeted ("target"): named deterministic cases that reach specific
//     boundaries on purpose (bucket overflow, exact 7/14/90-day ages ±1 ms, ...).
//
// Every case gets its own PRNG seeded from (seed, index), so `gen-a:1234` is
// reproducible regardless of --n.

import { mulberry32 } from './hermetic.mjs';

const DAY = 86400000;

export class Rng {
  constructor(seed) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  int(a, b) { return a + Math.floor(this.r() * (b - a + 1)); }
  chance(p) { return this.r() < p; }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  weighted(pairs) { // [[value, weight], ...]
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let x = this.r() * total;
    for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
    return pairs[pairs.length - 1][0];
  }
  subset(arr, p) { return arr.filter(() => this.r() < p); }
}

export function caseSeed(seed, tier, i) {
  let h = 2166136261 ^ seed;
  for (const ch of `${tier}:${i}`) { h = Math.imul(h ^ ch.charCodeAt(0), 16777619); }
  return h >>> 0;
}

// The full HTML escape set, in every string family.
export const ESC = `<b>&"x'</b>`;
const TITLES = [
  'Add pagination to user list', 'Fix flaky login test', 'Refactor auth module',
  'Ünïcødé — 日本語のタイトル ✓ 🚀', `Escape ${ESC} title`, '<script>alert("x")</script>',
  'Tom & Jerry\'s "quoted" <tag>', 'a'.repeat(300), '', '   ', 'Line one\nline two',
  'RTL ‮evil‬ mark', 'Zero​width', 'emoji 👩‍💻 cluster', 'tab\there', '&amp; already escaped'
];
const PROJECT_NAMES = [
  'Project Alpha', 'Beta', 'Infra & Ops', `Proj ${ESC}`, 'Données — été', '中文项目', '',
  'Unassigned', 'x', 'Very long project name '.repeat(6).trim(), '"Quoted"', "O'Brien's"
];
const PEOPLE = ['Alice', 'Bob', 'Zoë', `Eve ${ESC}`, '李雷', ''];
const LABELS = ['bug', 'feature', 'preparing', `lbl ${ESC}`, 'ünï'];
const STATES = [
  [{ name: 'In Progress', type: 'started' }, 6],
  [{ name: 'In Review', type: 'started' }, 2],
  [{ name: 'Todo', type: 'unstarted' }, 6],
  [{ name: 'Backlog', type: 'backlog' }, 4],
  [{ name: 'Triage', type: 'triage' }, 1],
  [{ name: 'Done', type: 'completed' }, 8],
  [{ name: 'Shipped', type: 'completed' }, 2],
  [{ name: `QA ${ESC}`, type: 'completed' }, 1],
  [{ name: '', type: 'completed' }, 1],
  [{ name: 'Canceled', type: 'canceled' }, 2],
  [{ name: 'Cancelled', type: 'cancelled' }, 1],
  [{ name: 'Duplicate', type: 'duplicate' }, 1],
  [undefined, 1],
  [{ name: 'Weird', type: 'mystery' }, 1]
];
const DESCRIPTIONS = [undefined, null, '', 'One line.', 'First para.\n\nSecond para.', `Desc ${ESC}`, 'w '.repeat(200), '\n\n\nleading blank paras'];

function isoAgo(nowMs, ms) { return new Date(nowMs - ms).toISOString(); }

function completedAtFor(rng, nowMs) {
  return rng.weighted([
    [() => isoAgo(nowMs, rng.int(0, 6 * DAY)), 5],                  // this week
    [() => isoAgo(nowMs, 7 * DAY + rng.int(0, 7 * DAY - 1)), 4],    // last week
    [() => isoAgo(nowMs, 14 * DAY + rng.int(0, 76 * DAY)), 4],      // earlier, in window
    [() => isoAgo(nowMs, 90 * DAY + rng.int(1, 200 * DAY)), 3],     // outside window
    [() => isoAgo(nowMs, rng.pick([7, 14, 90]) * DAY + rng.pick([-1, 0, 1])), 2], // exact boundaries ±1 ms
    [() => isoAgo(nowMs, -rng.int(1, 3 * DAY)), 1],                 // future
    [() => null, 1],
    [() => undefined, 1],
    [() => 'not a date', 0.3],
    [() => new Date(nowMs - rng.int(0, 30) * DAY).toISOString().slice(0, 10), 0.5] // date-only
  ])();
}

/** Tier A: provider-shaped projects + issues. */
export function genProvider(rng, nowMs, { burst = rng.chance(0.15) } = {}) {
  const nProjects = rng.weighted([[0, 1], [1, 3], [2, 4], [3, 4], [5, 2], [8, 1]]);
  const projects = [];
  for (let i = 0; i < nProjects; i++) {
    const p = { id: `proj-${i}`, name: rng.chance(0.8) ? `${rng.pick(PROJECT_NAMES)}${rng.chance(0.5) ? ' ' + i : ''}` : rng.pick(PROJECT_NAMES) };
    if (rng.chance(0.8)) p.content = rng.pick(DESCRIPTIONS);
    if (rng.chance(0.5)) p.url = `https://linear.app/x/project/proj-${i}`;
    if (rng.chance(0.5)) p.sortOrder = rng.int(0, 10);
    if (rng.chance(0.2)) p.state = rng.pick(['started', 'planned']);
    projects.push(p);
  }
  const nIssues = rng.weighted([[0, 1], [rng.int(1, 5), 4], [rng.int(6, 40), 6], [rng.int(41, 150), 2], [rng.int(200, 320), 0.5]]);
  const issues = [];
  const projRef = () => {
    if (projects.length && rng.chance(0.85)) { const p = rng.pick(projects); return { id: p.id, name: p.name }; }
    return rng.weighted([[null, 3], [undefined, 1], [{ id: 'proj-ghost', name: `Ghost ${rng.int(0, 2)}` }, 1], [{ name: 'Name only' }, 0.5]]);
  };
  for (let k = 0; k < nIssues; k++) {
    const state = rng.weighted(STATES);
    const iss = {
      id: rng.chance(0.9) ? `iss-${k}` : `${k.toString(16).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`,
      identifier: rng.weighted([[`ENG-${k + 1}`, 8], ['', 1], [undefined, 1], [`X${ESC}-${k}`, 0.5]]),
      title: rng.pick(TITLES) + (rng.chance(0.6) ? ` #${k}` : ''),
      description: rng.pick(DESCRIPTIONS),
      estimate: rng.pick([null, undefined, 0, 1, 2, 3, 5, 8, 0.5]),
      priority: rng.pick([0, 1, 2, 3, 4, undefined]),
      sortOrder: rng.chance(0.9) ? rng.int(-100, 1000) : undefined,
      createdAt: rng.chance(0.9) ? isoAgo(nowMs, rng.int(0, 400) * DAY + rng.int(0, DAY)) : undefined,
      dueDate: rng.chance(0.2) ? new Date(nowMs + rng.int(-30, 60) * DAY).toISOString().slice(0, 10) : null,
      completedAt: null,
      url: `https://linear.app/x/issue/ENG-${k + 1}`,
      parent: null,
      project: projRef(),
      state,
      assignee: rng.weighted([[null, 3], [undefined, 1], [{ name: rng.pick(PEOPLE) }, 4]]),
      labels: rng.chance(0.85) ? { nodes: rng.subset(LABELS, 0.25).map(name => ({ name })) } : undefined,
      relations: { nodes: [] }
    };
    if (state?.type === 'completed') iss.completedAt = completedAtFor(rng, nowMs);
    else if (rng.chance(0.03)) iss.completedAt = completedAtFor(rng, nowMs);
    if (rng.chance(0.1)) delete iss.relations;
    issues.push(iss);
  }
  // Parent/child links (same project mostly; sometimes cross-project or dangling).
  for (const iss of issues) {
    if (!rng.chance(0.25) || issues.length < 2) continue;
    const r = rng.next();
    if (r < 0.08) { iss.parent = { id: 'missing-parent' }; continue; }
    const candidates = issues.filter(o => o !== iss && (r < 0.8 ? o.project?.name === iss.project?.name : true));
    if (candidates.length) iss.parent = { id: rng.pick(candidates).id };
  }
  // Blocking relations: random edges, plus deliberate chains and cycles.
  const addBlock = (a, b) => { (a.relations ||= { nodes: [] }).nodes.push({ type: 'blocks', relatedIssue: { id: b.id } }); };
  for (const iss of issues) {
    if (!rng.chance(0.12)) continue;
    const kind = rng.next();
    if (kind < 0.1) (iss.relations ||= { nodes: [] }).nodes.push({ type: 'blocks', relatedIssue: null });
    else if (kind < 0.18) (iss.relations ||= { nodes: [] }).nodes.push({ type: 'related', relatedIssue: { id: rng.pick(issues).id } });
    else if (kind < 0.25) (iss.relations ||= { nodes: [] }).nodes.push({ type: 'blocks', relatedIssue: { id: 'nonexistent' } });
    else addBlock(iss, rng.pick(issues));
  }
  if (issues.length >= 3 && rng.chance(0.35)) {
    const len = rng.int(2, Math.min(6, issues.length));
    const chain = rng.subset(issues, 0.5).slice(0, len);
    for (let i = 0; i + 1 < chain.length; i++) addBlock(chain[i], chain[i + 1]);
    if (chain.length >= 2 && rng.chance(0.3)) addBlock(chain[chain.length - 1], chain[0]); // cycle
  }
  // Burst: 13-25 completions in one recency bucket ("Show N more" overflow).
  if (burst) {
    const n = rng.int(13, 25);
    const band = rng.pick([[0, 7], [7, 14], [14, 90]]);
    const proj = projects.length ? rng.pick(projects) : null;
    for (let j = 0; j < n; j++) {
      issues.push({
        id: `burst-${j}`, identifier: `BST-${j}`, title: `${rng.pick(TITLES)} burst ${j}`,
        estimate: rng.pick([null, 1, 2]), priority: rng.int(0, 4), sortOrder: j,
        createdAt: isoAgo(nowMs, 120 * DAY), completedAt: isoAgo(nowMs, band[0] * DAY + rng.int(0, (band[1] - band[0]) * DAY - 1)),
        parent: null, project: rng.chance(0.7) && proj ? { id: proj.id, name: proj.name } : projRef(),
        state: rng.pick([{ name: 'Done', type: 'completed' }, { name: 'Shipped', type: 'completed' }]),
        assignee: null, labels: { nodes: [] }, relations: { nodes: [] }
      });
    }
  }
  return { projects, issues };
}

/** Options variations (shared by every tier). */
export function genOptions(rng, deps) {
  const urlKey = rng.weighted([['acme', 5], ['test-ws', 2], [null, 2], [undefined, 1], ['', 1], [`ws${ESC}`, 1.5], ['ünï code', 1]]);
  const opts = {};
  const set = (k, v) => { if (v !== undefined || rng.chance(0.5)) opts[k] = v; };
  set('urlKey', urlKey);
  set('openRouterSource', rng.weighted([[null, 4], [undefined, 2], ['oauth', 2], ['env', 1], ['free', 1], ['session', 1], ['', 0.5]]));
  set('workspaces', rng.weighted([
    [undefined, 2], [[], 2],
    [() => {
      const n = rng.int(1, 4);
      const ws = Array.from({ length: n }, (_, i) => ({ id: `w${i}`, urlKey: `ws-${i}`, name: rng.pick([`Workspace ${i}`, `WS ${ESC}`, 'Données', '']) }));
      if (rng.chance(0.6) && urlKey) ws[rng.int(0, n - 1)].urlKey = urlKey;
      if (rng.chance(0.2)) ws[0].isPAT = true;
      if (rng.chance(0.1)) delete ws[0].name;
      return ws;
    }, 6]
  ]));
  if (typeof opts.workspaces === 'function') opts.workspaces = opts.workspaces();
  const teams = rng.weighted([[undefined, 3], [[], 2], [null, 0.3], ['gen', 5]]);
  if (teams === 'gen') {
    opts.teams = Array.from({ length: rng.int(1, 4) }, (_, i) => ({ id: `team-${i}`, name: rng.pick(['Engineering', 'Design', `T ${ESC}`, 'Équipe', 'zeta']), key: `T${i}` }));
    opts.selectedTeamId = rng.weighted([[null, 2], [undefined, 1], [opts.teams[0].id, 3], ['no-such-team', 2]]);
  } else {
    set('teams', teams);
    if (rng.chance(0.3)) opts.selectedTeamId = rng.pick([null, 'team-0', 'no-such-team']);
  }
  const flagsKind = rng.weighted([['none', 2], ['empty', 2], ['defaults', 3], ['random', 5]]);
  if (flagsKind === 'empty') opts.featureFlags = {};
  else if (flagsKind === 'defaults') opts.featureFlags = { ...deps.FEATURE_DEFAULTS, ...(rng.chance(0.5) ? { roadmap: true } : {}) };
  else if (flagsKind === 'random') {
    opts.featureFlags = {};
    for (const k of [...deps.FEATURE_KEYS, 'notARealFlag']) {
      if (rng.chance(0.4)) opts.featureFlags[k] = rng.weighted([[true, 6], [false, 3], ['true', 0.5], [1, 0.5]]);
    }
  }
  const models = rng.weighted([['none', 3], ['empty', 2], ['real', 3], ['custom', 3]]);
  if (models === 'empty') opts.availableModels = [];
  else if (models === 'real') opts.availableModels = deps.AVAILABLE_MODELS;
  else if (models === 'custom') {
    opts.availableModels = Array.from({ length: rng.int(1, 5) }, (_, i) => {
      const m = { id: rng.pick([`vendor/model-${i}`, `v/${ESC}-${i}`, '']), name: rng.pick([`Model ${i}`, `M ${ESC}`, 'Modèle ✓', '']) };
      const pr = rng.weighted([['num', 4], ['none', 2], ['nonnum', 2], ['zero', 1], ['partial', 1], ['nan', 0.5]]);
      if (pr === 'num') m.pricing = { prompt: rng.pick([0.75, 3, 15, 0.125, 1.005]), completion: rng.pick([4.5, 15, 75, 0.4]) };
      else if (pr === 'nonnum') m.pricing = { prompt: '0.75', completion: rng.pick(['4.5', null, 4.5]) };
      else if (pr === 'zero') m.pricing = { prompt: 0, completion: 0 };
      else if (pr === 'partial') m.pricing = { prompt: 1 };
      else if (pr === 'nan') m.pricing = { prompt: NaN, completion: Infinity };
      if (rng.chance(0.1)) delete m.name;
      return m;
    });
  }
  const deploy = rng.weighted([['none', 2], ['empty', 2], ['version', 1], ['commit', 1], ['full', 2], ['badDate', 1], ['createdOnly', 0.5]]);
  if (deploy === 'empty') opts.deployInfo = {};
  else if (deploy === 'version') opts.deployInfo = { version: rng.pick(['v42', `v${ESC}`]) };
  else if (deploy === 'commit') opts.deployInfo = { commit: rng.pick(['abcdef1234567890', `c0ffee${ESC}`]) };
  else if (deploy === 'full') opts.deployInfo = { version: 'v7', commit: '0123456789abcdef', createdAt: rng.pick(['2026-10-01T23:30:00Z', '2026-01-01T00:00:00.000Z', '2025-12-31T23:59:59Z']) };
  else if (deploy === 'badDate') opts.deployInfo = { version: 'v8', createdAt: rng.pick(['yesterday', `x${ESC}`]) };
  else if (deploy === 'createdOnly') opts.deployInfo = { createdAt: '2026-10-01T00:00:00Z' };
  // Rare null-valued options (destructuring defaults do not apply to null).
  if (rng.chance(0.01)) opts[rng.pick(['availableModels', 'featureFlags', 'workspaces'])] = null;
  return opts;
}

export function genOrgName(rng) {
  return rng.weighted([['Acme Inc', 4], ['', 2], [undefined, 2], [`Org ${ESC}`, 2], ['Société Générale — 東京', 1], [null, 0.5]]);
}

function dataFor(rng, roadmapModel, orgName) {
  const data = { roadmapModel };
  if (orgName !== undefined || rng.chance(0.5)) data.organizationName = orgName;
  return data;
}

export function makeGenA(rng, nowMs, deps) {
  const { projects, issues } = genProvider(rng, nowMs);
  const model = deps.buildRoadmapModel(projects, issues);
  return { data: dataFor(rng, model, genOrgName(rng)), options: genOptions(rng, deps), meta: { projects: projects.length, issues: issues.length } };
}

/** Tier B: direct roadmapModel with shapes buildRoadmapModel cannot produce. */
export function makeGenB(rng, nowMs, deps) {
  const { projects, issues } = genProvider(rng, nowMs, { burst: rng.chance(0.25) });
  const model = deps.buildRoadmapModel(projects, issues);
  const applied = [];
  const M = model.milestones;
  const mut = (name, p, fn) => { if (rng.chance(p)) { fn(); applied.push(name); } };

  mut('cp-plain-object', 0.4, () => { model.criticalPaths = Object.fromEntries(model.criticalPaths); });
  mut('cp-empty', 0.08, () => { model.criticalPaths = rng.pick([new Map(), {}]); });
  mut('cp-missing', 0.05, () => { delete model.criticalPaths; });
  for (const m of M) {
    mut('drop-progressPercent', 0.2, () => { delete m.progressPercent; });
    mut('drop-completedTasks', 0.15, () => { delete m.completedTasks; });
    mut('drop-totalTasks', 0.15, () => { delete m.totalTasks; });
    mut('drop-remainingTasks', 0.1, () => { delete m.remainingTasks; });
    mut('progress-100plus', 0.05, () => { m.progressPercent = rng.pick([100, 150, 99.6]); });
    mut('empty-name', 0.08, () => { m.name = rng.pick(['', undefined]); });
    mut('description-edge', 0.15, () => { m.description = rng.pick(['', `D ${ESC}`, null]); });
    mut('drop-tasksInQueue', 0.05, () => { delete m.tasksInQueue; });
    mut('drop-recentlyCompleted', 0.05, () => { delete m.recentlyCompleted; });
    if (m.tasksInQueue?.length) {
      mut('completed-in-queue', 0.2, () => { rng.pick(m.tasksInQueue).stateType = 'completed'; });
      mut('rollup-null-with-subtasks', 0.2, () => {
        const t = rng.pick(m.tasksInQueue);
        t.subtasks = [{ id: 'sx1', identifier: 'SX-1', title: `sub ${ESC}`, stateType: rng.pick(['started', 'unstarted', 'completed']) }, { id: 'sx2', title: '', stateType: undefined }];
        t.rollup = rng.pick([null, undefined, {}, { subtaskDone: 1 }]);
      });
      mut('subtasks-missing', 0.1, () => { delete rng.pick(m.tasksInQueue).subtasks; });
      mut('task-fields-missing', 0.1, () => { const t = rng.pick(m.tasksInQueue); delete t.title; delete t.identifier; });
    }
    m.recentlyCompleted ||= [];
    mut('rc-edge-dates', 0.3, () => {
      for (let j = 0; j < rng.int(1, 4); j++) {
        m.recentlyCompleted.push({
          id: `rc-${j}`, identifier: `RC-${j}`, title: rng.pick(TITLES),
          stateName: rng.pick(['Done', 'Shipped', '', undefined, `S ${ESC}`]),
          completedAt: rng.pick([undefined, null, '', 'Oct 3, 2026', 'garbage', new Date(nowMs + 3 * DAY).toISOString(),
            new Date(nowMs - 7 * DAY).toISOString(), new Date(nowMs - 90 * DAY - 1).toISOString(), '2026-10-10'])
        });
      }
    });
    mut('rc-numeric-completedAt', 0.005, () => { m.recentlyCompleted.push({ title: 'numeric', completedAt: nowMs - DAY }); });
  }
  mut('risks-edge', 0.5, () => {
    const names = M.map(m => m.name);
    for (let j = 0; j < rng.int(1, 5); j++) {
      const r = {
        type: rng.pick(['unassigned-critical', 'blocked', 'velocity-declining', 'overdue', 'unestimated-critical', 'mystery', undefined]),
        severity: rng.pick(['high', 'medium', 'low', 'critical', undefined, '', `sev${ESC}`]),
        description: rng.pick(['desc', `R ${ESC}`, undefined, '']),
        milestone: rng.weighted([[names.length ? rng.pick(names) : 'none', 4], ['No Such Project', 1], [null, 1], [undefined, 0.5]]),
        issues: []
      };
      if (rng.chance(0.1)) delete r.issues;
      (model.risks ||= []).push(r);
    }
  });
  mut('cp-unknown-ids', 0.3, () => {
    const name = M.length ? rng.pick(M).name : 'Unassigned';
    const q = model.executionQueue || [];
    const path = [q[0]?.id ?? 'ghost-a', 'ghost-not-in-queue', ...(rng.chance(0.5) ? [q[1]?.id ?? 'ghost-b'] : [])];
    const entry = { path, length: rng.pick([path.length, 99, undefined]), blockers: [path[0]] };
    if (model.criticalPaths instanceof Map) model.criticalPaths.set(name, entry);
    else (model.criticalPaths ||= {})[name] = entry;
  });
  mut('cp-completed-or-blank-node', 0.15, () => {
    // A path node whose queue entry is completed, and a blank id with no entry.
    const name = M.length ? rng.pick(M).name : 'Unassigned';
    const q = (model.executionQueue ||= []);
    q.push({ id: 'cp-done', identifier: rng.pick(['CP-DONE', '']), title: `done ${ESC}`, stateType: 'completed' });
    const entry = { path: ['cp-done', '', ...(q[0] ? [q[0].id] : [])], length: 3, blockers: [] };
    if (model.criticalPaths instanceof Map) model.criticalPaths.set(name, entry); else (model.criticalPaths ||= {})[name] = entry;
  });
  mut('cp-length-1', 0.1, () => {
    const name = M.length ? rng.pick(M).name : 'x';
    const entry = { path: ['only-one'], length: 1, blockers: [] };
    if (model.criticalPaths instanceof Map) model.criticalPaths.set(name, entry); else if (model.criticalPaths) model.criticalPaths[name] = entry;
  });
  mut('velocity-edge', 0.3, () => {
    model.velocity = rng.pick([{}, undefined, { tasksPerWeek: 2.5 }, { tasksPerWeek: -1 }, { tasksPerWeek: '3' }, { pointsPerWeek: 4, trend: 'increasing' }, { tasksPerWeek: 0.333333, weeklyData: null }]);
    if (model.velocity === undefined) delete model.velocity;
  });
  mut('drop-executionQueue', 0.1, () => { delete model.executionQueue; });
  mut('drop-milestones', 0.05, () => { delete model.milestones; });
  mut('drop-risks', 0.05, () => { delete model.risks; });
  return { data: dataFor(rng, model, genOrgName(rng)), options: genOptions(rng, deps), meta: { mutations: [...new Set(applied)] } };
}

/** Targeted named cases (point-by-point coverage of the tricky boundaries). */
export function targetedCases(nowMs, deps) {
  const P = (id, name, extra = {}) => ({ id, name, content: `About ${name}`, ...extra });
  const I = (id, o = {}) => ({
    id, identifier: o.identifier ?? id.toUpperCase(), title: o.title ?? `Task ${id}`, description: '', estimate: o.estimate ?? null,
    priority: o.priority ?? 2, sortOrder: o.sortOrder ?? 0, createdAt: isoAgo(nowMs, 120 * DAY), dueDate: null,
    completedAt: o.completedAt ?? null, parent: o.parent ?? null, project: 'project' in o ? o.project : { id: 'p1', name: 'Alpha' },
    state: o.state ?? { name: 'Todo', type: 'unstarted' }, assignee: o.assignee ?? null,
    labels: { nodes: [] }, relations: { nodes: (o.blocks || []).map(b => ({ type: 'blocks', relatedIssue: { id: b } })) }
  });
  const done = (id, ageMs, o = {}) => I(id, { state: { name: o.stateName ?? 'Done', type: 'completed' }, completedAt: isoAgo(nowMs, ageMs), ...o });
  const baseOpts = { urlKey: 'acme', openRouterSource: null, workspaces: [{ id: 'w', urlKey: 'acme', name: 'Acme' }], featureFlags: { roadmap: true } };
  const aiOpts = { ...baseOpts, openRouterSource: 'oauth', availableModels: deps.AVAILABLE_MODELS };
  const model = (projects, issues) => deps.buildRoadmapModel(projects, issues);
  const cases = [];
  const add = (id, data, options) => cases.push({ id: `target:${id}`, data, options });

  for (const [label, band, n] of [['this-week', 0, 13], ['this-week', 0, 25], ['last-week', 7, 13], ['earlier', 14, 25], ['earlier', 14, 12]]) {
    const issues = Array.from({ length: n }, (_, j) => done(`b${j}`, band * DAY + 1000 + j * 3600000));
    add(`bucket-${label}-${n}`, { roadmapModel: model([P('p1', 'Alpha')], issues), organizationName: 'Acme' }, baseOpts);
  }
  // Overflow across projects (recentlyCompleted is capped at 25 per project; the bucket aggregates).
  add('bucket-cross-project-40', { roadmapModel: model([P('p1', 'Alpha'), P('p2', 'Beta')], [
    ...Array.from({ length: 20 }, (_, j) => done(`a${j}`, j * 3600000)),
    ...Array.from({ length: 20 }, (_, j) => done(`c${j}`, j * 3600000 + 1, { project: { id: 'p2', name: 'Beta' } }))
  ]), organizationName: 'Acme' }, aiOpts);
  const ages = [];
  for (const d of [7, 14, 90]) for (const e of [-1, 0, 1]) ages.push([`${d}d${e < 0 ? '-1ms' : e > 0 ? '+1ms' : ''}`, d * DAY + e]);
  add('age-boundaries', { roadmapModel: model([P('p1', 'Alpha')], ages.map(([l, ms], j) => done(`age-${l}`, ms, { title: `age ${l}`, sortOrder: j }))), organizationName: 'Acme' }, baseOpts);
  // Each boundary alone, so a bucket-placement change shows up as its own case.
  for (const [l, ms] of ages) add(`age-${l}`, { roadmapModel: model([P('p1', 'Alpha')], [done('x', ms, { title: `age ${l}` })]), organizationName: 'Acme' }, baseOpts);
  add('stateName-not-done', { roadmapModel: model([P('p1', 'Alpha')], [done('s1', DAY, { stateName: 'Shipped' }), done('s2', 2 * DAY, { stateName: `Merged ${ESC}` }), done('s3', 3 * DAY, { stateName: '' })]), organizationName: 'Acme' }, baseOpts);
  add('chain-2', { roadmapModel: model([P('p1', 'Alpha')], [I('c1', { blocks: ['c2'], assignee: { name: 'Al' } }), I('c2')]), organizationName: 'Acme' }, baseOpts);
  add('chain-4-mixed-states', { roadmapModel: model([P('p1', 'Alpha')], [
    I('d1', { blocks: ['d2'], state: { name: 'In Progress', type: 'started' } }), I('d2', { blocks: ['d3'], estimate: 3 }), I('d3', { blocks: ['d4'] }), I('d4', { assignee: { name: 'Bo' } })
  ]), organizationName: 'Acme' }, baseOpts);
  add('cycle', { roadmapModel: model([P('p1', 'Alpha')], [I('y1', { blocks: ['y2'] }), I('y2', { blocks: ['y3'] }), I('y3', { blocks: ['y1'] })]), organizationName: 'Acme' }, baseOpts);
  add('cross-project-block', { roadmapModel: model([P('p1', 'Alpha'), P('p2', 'Beta')], [I('z1', { blocks: ['z2'] }), I('z2', { project: { id: 'p2', name: 'Beta' } })]), organizationName: 'Acme' }, baseOpts);
  add('child-only-started', { roadmapModel: model([P('p1', 'Alpha')], [I('par'), I('kid', { parent: { id: 'par' }, state: { name: 'In Progress', type: 'started' } }), I('kid2', { parent: { id: 'par' } })]), organizationName: 'Acme' }, baseOpts);
  add('parent-all-children-done', { roadmapModel: model([P('p1', 'Alpha')], [I('par'), done('k1', DAY, { parent: { id: 'par' } }), done('k2', 2 * DAY, { parent: { id: 'par' } })]), organizationName: 'Acme' }, baseOpts);
  add('project-with-no-issues', { roadmapModel: model([P('p1', 'Alpha'), P('p2', 'Empty Project')], [I('e1')]), organizationName: 'Acme' }, baseOpts);
  add('unassigned-project', { roadmapModel: model([P('p1', 'Alpha')], [I('u1', { project: null }), I('u2', { project: undefined, state: { name: 'In Progress', type: 'started' } }), done('u3', DAY, { project: null })]), organizationName: 'Acme' }, baseOpts);
  add('fully-complete-project', { roadmapModel: model([P('p1', 'Alpha')], [done('f1', DAY), done('f2', 2 * DAY)]), organizationName: 'Acme' }, baseOpts);
  // The escape set in every string family at once.
  const escIssues = [
    I('h1', { title: `T1 ${ESC}`, identifier: `ID${ESC}`, project: { id: 'p1', name: `P ${ESC}` }, blocks: ['h2'], state: { name: `S ${ESC}`, type: 'started' } }),
    I('h2', { title: `T2 ${ESC}`, project: { id: 'p1', name: `P ${ESC}` }, assignee: { name: `A ${ESC}` } }),
    I('h3', { title: `T3 ${ESC}`, project: { id: 'p1', name: `P ${ESC}` }, parent: { id: 'h1' } }),
    done('h4', DAY, { title: `T4 ${ESC}`, stateName: `Shipped ${ESC}`, project: { id: 'p1', name: `P ${ESC}` } })
  ];
  const escOpts = {
    urlKey: `k${ESC}`, openRouterSource: 'oauth',
    workspaces: [{ id: 'w1', urlKey: `k${ESC}`, name: `W ${ESC}` }, { id: 'w2', urlKey: 'other', name: `W2 ${ESC}` }],
    teams: [{ id: `t${ESC}`, name: `Team ${ESC}`, key: 'T' }], selectedTeamId: `t${ESC}`,
    availableModels: [{ id: `m/${ESC}`, name: `Model ${ESC}`, pricing: { prompt: 1, completion: 2 } }],
    deployInfo: { version: `v${ESC}`, commit: `c${ESC}`, createdAt: '2026-10-01T10:00:00Z' },
    featureFlags: { roadmap: true, dispatch: true, feedbackWidget: true }
  };
  add('escape-everywhere', { roadmapModel: model([P('p1', `P ${ESC}`, { content: `C ${ESC}` })], escIssues), organizationName: `Org ${ESC}` }, escOpts);
  add('escape-everywhere-no-ai', { roadmapModel: model([P('p1', `P ${ESC}`, { content: `C ${ESC}` })], escIssues), organizationName: `Org ${ESC}` }, { ...escOpts, openRouterSource: null });
  const small = () => model([P('p1', 'Alpha')], [I('s1', { state: { name: 'In Progress', type: 'started' } }), done('s2', DAY)]);
  add('models-nonnumeric-pricing', { roadmapModel: small(), organizationName: 'Acme' }, { ...aiOpts, availableModels: [
    { id: 'a/one', name: 'One', pricing: { prompt: '0.75', completion: '4.5' } }, { id: 'a/two', name: 'Two', pricing: { prompt: 1, completion: null } },
    { id: 'a/three', name: 'Three' }, { id: 'a/four', name: 'Four', pricing: { prompt: 0, completion: 0 } }, { id: 'a/five', name: 'Five', pricing: { prompt: 0.005, completion: 1.995 } }
  ] });
  add('models-real-ai-free', { roadmapModel: small(), organizationName: 'Acme' }, { ...aiOpts, openRouterSource: 'free' });
  add('teams-mismatch', { roadmapModel: small(), organizationName: 'Acme' }, { ...baseOpts, teams: [{ id: 'eng', name: 'Engineering', key: 'ENG' }, { id: 'des', name: 'Design', key: 'DES' }], selectedTeamId: 'nope' });
  add('teams-match', { roadmapModel: small(), organizationName: 'Acme' }, { ...baseOpts, teams: [{ id: 'eng', name: 'Engineering', key: 'ENG' }, { id: 'des', name: 'Design', key: 'DES' }], selectedTeamId: 'des' });
  add('urlKey-null', { roadmapModel: small(), organizationName: 'Acme' }, { ...baseOpts, urlKey: null });
  add('urlKey-absent-all-defaults', { roadmapModel: small() }, {});
  add('workspace-no-match', { roadmapModel: small(), organizationName: 'Fallback Org' }, { ...baseOpts, workspaces: [{ id: 'w', urlKey: 'other', name: 'Other' }] });
  add('org-empty', { roadmapModel: small(), organizationName: '' }, { ...baseOpts, workspaces: [] });
  add('org-empty-no-workspace-name', { roadmapModel: small(), organizationName: '' }, { ...baseOpts, workspaces: [{ id: 'w', urlKey: 'acme', name: '' }] });
  add('deploy-with-createdAt', { roadmapModel: small(), organizationName: 'Acme' }, { ...baseOpts, deployInfo: { version: 'v42', commit: 'abcdef1234567', createdAt: '2026-10-01T23:30:00Z' } });
  add('deploy-without-createdAt', { roadmapModel: small(), organizationName: 'Acme' }, { ...baseOpts, deployInfo: { version: 'v42', commit: 'abcdef1234567' } });
  add('deploy-bad-createdAt', { roadmapModel: small(), organizationName: 'Acme' }, { ...baseOpts, deployInfo: { version: 'v42', createdAt: 'not-a-date' } });
  add('all-flags-on', { roadmapModel: small(), organizationName: 'Acme' }, { ...aiOpts, featureFlags: Object.fromEntries(deps.FEATURE_KEYS.map(k => [k, true])) });
  add('options-omitted', { roadmapModel: small(), organizationName: 'Acme' }, undefined);
  return cases;
}
