// Seeded issue "worlds": provider-shaped projects + issues (the canonical shape
// the Linear/GitHub/Jira/local providers emit), turned into projectTrees /
// inProgressTrees / recentActivityTrees by main's REAL tree pipeline exactly as
// server.js fetchAndPrepareProjects does (buildForest -> No Project ->
// Periodicals -> buildInProgressForest -> buildRecentActivityForest(…, 1) ->
// partitionCompleted + collapsed). Shared by the render.js and render-swipe.js
// generators.
import { Rng, DAY, HOUR, ESC, HAZARD, UNICODE, PEOPLE, TITLES, text, markdown, clean } from './gen-common.mjs';

export const STATES = [
  [{ name: 'In Progress', type: 'started' }, 6], [{ name: 'In Review', type: 'started' }, 2],
  [{ name: 'Todo', type: 'unstarted' }, 6], [{ name: 'Backlog', type: 'backlog' }, 4],
  [{ name: 'Triage', type: 'triage' }, 1], [{ name: 'Done', type: 'completed' }, 6],
  [{ name: `QA ${ESC}`, type: 'completed' }, 1], [{ name: 'Canceled', type: 'canceled' }, 2],
  [{ name: 'Duplicate', type: 'duplicate' }, 1], [undefined, 1], [{ name: 'Weird', type: 'mystery' }, 1], [{ name: 'NoType' }, 0.5]
];
export const SOURCES = [[undefined, 6], ['linear', 2], ['github', 2], ['jira', 1], ['local', 1], ['github-projects', 0.5]];

function isoAt(nowMs, deltaMs) { return new Date(nowMs + deltaMs).toISOString(); }
export function timeNear(rng, nowMs) {
  // spans formatRelativeTime's boundaries and the 1-day / 7-day activity windows
  return rng.weighted([
    [() => isoAt(nowMs, -rng.int(0, 59) * 1000), 1],
    [() => isoAt(nowMs, -rng.pick([60e3, 61e3, 59 * 60e3, 60 * 60e3, 23 * HOUR + 59 * 60e3, 24 * HOUR, 47 * HOUR, 48 * HOUR, 6 * DAY + 23 * HOUR, 7 * DAY, 7 * DAY + 1])), 2],
    [() => isoAt(nowMs, -rng.int(0, 3 * DAY)), 3],
    [() => isoAt(nowMs, -rng.int(3 * DAY, 400 * DAY)), 3],
    [() => isoAt(nowMs, rng.int(1, 30 * DAY)), 1],
    [() => rng.pick(['not-a-date', '2026-02-30', '', '2026-10-14']), 0.4]
  ]);
}

export function makeIssueId(rng, src) {
  return rng.weighted([
    [() => rng.uuid(), 6],
    [() => `${rng.pick(['acme/web', 'o/r', 'x-y/z.z'])}#${rng.int(1, 999)}`, src === 'github' ? 6 : 1],
    [() => `issue-${rng.int(1, 60)}`, 2],
    [() => rng.pick([`id"q${rng.int(1, 9)}`, `id<${rng.int(1, 9)}>`, `id&${rng.int(1, 9)}`, `ü-${rng.int(1, 9)}`]), 0.5]
  ]);
}

export function makeLabels(rng, promptLabels) {
  if (rng.chance(0.25)) return rng.chance(0.5) ? { nodes: [] } : undefined;
  const pool = ['bug', 'Bug', 'feature', 'preparing', `lbl ${ESC}`, 'ünï', ...promptLabels.slice(0, 8)];
  return { nodes: rng.subset(pool, 0.25).map(name => ({ name })) };
}

export function makeIssue(rng, nowMs, ctx, i) {
  const source = ctx.source !== undefined ? ctx.source : rng.weighted(SOURCES);
  const state = rng.weighted(STATES);
  const completed = state?.type === 'completed';
  const issue = clean({
    id: makeIssueId(rng, source),
    identifier: rng.weighted([[() => `${rng.pick(['LIN', 'HAR', 'ENG', 'GH'])}-${rng.int(1, 4000)}`, 8], [() => '', 1], [() => undefined, 1], [() => `X-${ESC}`, 0.3]]),
    title: rng.chance(0.7) ? rng.pick(TITLES) : text(rng),
    description: rng.weighted([[() => undefined, 2], [() => '', 1], [() => markdown(rng), 7]]),
    url: rng.weighted([[() => `https://linear.app/acme/issue/LIN-${rng.int(1, 999)}`, 5], [() => undefined, 2], [() => '/workspace/x/issue/1', 1], [() => `https://e.example/?a=1&b="2"`, 0.5]]),
    linkText: rng.maybe(0.1, () => rng.pick(['Open ↗', `View ${ESC}`])),
    sameTab: rng.maybe(0.1, true),
    state,
    priority: rng.weighted([[() => rng.int(0, 4), 9], [() => undefined, 1], [() => 7, 0.2]]),
    estimate: rng.weighted([[() => undefined, 4], [() => rng.pick([1, 2, 3, 5, 8]), 4], [() => 0, 1], [() => 0.5, 0.3]]),
    dueDate: rng.maybe(0.25, () => timeNear(rng, nowMs).slice(0, 10)),
    completedAt: completed ? (rng.chance(0.9) ? timeNear(rng, nowMs) : undefined) : rng.maybe(0.05, () => timeNear(rng, nowMs)),
    createdAt: rng.maybe(0.8, () => timeNear(rng, nowMs)),
    updatedAt: rng.maybe(0.8, () => timeNear(rng, nowMs)),
    assignee: rng.weighted([[() => undefined, 3], [() => ({ name: rng.pick(PEOPLE) }), 6], [() => ({}), 0.5], [() => null, 0.5]]),
    labels: makeLabels(rng, ctx.promptLabels),
    source,
    sortOrder: rng.chance(0.9) ? i : undefined,
    attachments: rng.maybe(0.12, () => {
      const list = rng.subset([
        { url: 'https://uploads.linear.app/a/1.png', title: 'shot' }, { url: 'https://cdn.example.com/x.jpg', title: '' },
        { url: 'https://linear.app/x.gif', title: ESC }, { url: 'not a url.png' }, { url: 'https://e.example/doc.pdf', title: 'doc' },
        { url: 'https://uploads.linear.app/b/2.webp', title: 'n' }], 0.5);
      return rng.chance(0.5) ? list : { nodes: list };
    }),
    comments: rng.maybe(0.08, () => ({ nodes: [{ body: '![c](https://uploads.linear.app/c.png)' }, { body: 'plain' }] }))
  });
  return issue;
}

/**
 * Build a world. opts: { urlKey, periodicals, seedIssues, nProjects, nIssues, singleSource }
 */
export function makeWorld(rng, nowMs, deps, opts = {}) {
  const { buildForest, buildInProgressForest, buildRecentActivityForest, partitionCompleted, NO_PROJECT_ID, PERIODICALS_PROJECT_ID } = deps.tree;
  const nProjects = opts.nProjects ?? rng.weighted([[0, 1], [1, 3], [2, 3], [3, 2], [5, 1]]);
  const projects = [];
  for (let p = 0; p < nProjects; p++) {
    projects.push(clean({
      id: rng.weighted([[() => rng.uuid(), 8], [() => `proj-${p}`, 2], [() => `p"${p}<`, 0.3], [() => '__synthetic', 0.2]]),
      name: rng.chance(0.8) ? rng.pick(['Project Alpha', 'Beta', 'Infra & Ops', `Proj ${ESC}`, 'Données — été', '中文项目', '', 'Unassigned', 'x', '"Quoted"']) : text(rng),
      content: rng.weighted([[() => undefined, 3], [() => null, 1], [() => '', 1], [() => 'Short description.', 2], [() => 'word '.repeat(rng.int(25, 40)).trim(), 2], [() => 'a'.repeat(rng.int(140, 160)), 1], [() => `${'x'.repeat(130)} ${'y'.repeat(25)}`, 1], [() => markdown(rng), 2], [() => `${ESC} `.repeat(30), 0.5]]),
      url: rng.weighted([[() => `https://linear.app/acme/project/p-${p}`, 5], [() => undefined, 2], [() => null, 1]]),
      linkText: rng.maybe(0.1, 'Open project ↗'),
      sameTab: rng.maybe(0.1, true),
      sortOrder: rng.chance(0.9) ? rng.int(0, 10) : p
    }));
  }
  const ctx = { promptLabels: deps.promptLabels, source: opts.singleSource };
  const nIssues = opts.nIssues ?? rng.weighted([[0, 1], [() => rng.int(1, 6), 4], [() => rng.int(7, 18), 4], [() => rng.int(19, 40), 1]]);
  const issues = [];
  const usedIds = new Set(['missing-parent', 'dangling']);
  for (let i = 0; i < nIssues; i++) {
    const issue = makeIssue(rng, nowMs, ctx, i);
    // globally unique ids: a provider never returns two issues with one id, and a
    // duplicate id under the default source could close a parent cycle, which
    // hangs lib/tree.js (not a renderer input main can produce)
    for (let tries = 0; usedIds.has(issue.id); tries++) issue.id = tries < 5 ? makeIssueId(rng, issue.source) : `${issue.id}-${i}`;
    usedIds.add(issue.id);
    if (projects.length && rng.chance(0.8)) { const pr = rng.pick(projects); issue.project = { id: pr.id, name: pr.name }; }
    if (issues.length && rng.chance(0.35)) {
      const parent = rng.pick(issues);
      issue.parent = { id: parent.id };
      if (rng.chance(0.85)) issue.source = parent.source; else delete issue.source;
      if (rng.chance(0.5) && parent.project) issue.project = { ...parent.project };
    }
    if (rng.chance(0.03)) issue.parent = { id: 'missing-parent' };
    issues.push(issue);
  }
  // blocking relations (in-set, some cycles, some dangling)
  for (const issue of issues) {
    if (!issues.length || !rng.chance(0.25)) continue;
    issue.relations = { nodes: rng.subset(issues, 0.15).filter(x => x !== issue).slice(0, 3).map(x => ({ type: rng.pick(['blocks', 'blocks', 'related', 'duplicate']), relatedIssue: { id: x.id } })) };
    if (rng.chance(0.1)) issue.relations.nodes.push({ type: 'blocks', relatedIssue: { id: 'dangling' } });
    if (rng.chance(0.05)) issue.relations.nodes.push({ type: 'blocks' });
  }
  // dedupe ids within a source (providers never return duplicates)
  const seen = new Set();
  const uniq = [];
  for (const iss of issues) { const k = `${iss.source || ''}:${iss.id}`; if (!seen.has(k)) { seen.add(k); uniq.push(iss); } }
  if (opts.seedIssues && opts.urlKey) {
    const seed = deps.starterSeed(opts.urlKey);
    const proj = seed.projects[0];
    if (!projects.some(p => p.id === proj.id)) projects.push({ ...proj });
    for (const s of seed.issues) uniq.push(clean({ id: s.id, identifier: s.identifier, title: s.title, description: s.description, url: s.url, state: { ...s.state }, sortOrder: s.sortOrder, project: { id: s.projectId, name: proj.name }, parent: s.parentId ? { id: s.parentId } : undefined, source: rng.chance(0.5) ? 'local' : undefined }));
  }
  return worldTrees(uniq, projects, deps, { periodicals: !!opts.periodicals });
}

export function worldTrees(issues, projects, deps, { periodicals = false } = {}) {
  const { buildForest, buildInProgressForest, buildRecentActivityForest, partitionCompleted, NO_PROJECT_ID, PERIODICALS_PROJECT_ID } = deps.tree;
  projects = projects.map(p => ({ ...p }));
  const forest = buildForest(issues);
  if (forest.has(NO_PROJECT_ID)) projects.push({ id: NO_PROJECT_ID, name: 'No Project', content: null, url: null, sortOrder: Number.MAX_SAFE_INTEGER });
  if (periodicals) {
    projects.push({ id: PERIODICALS_PROJECT_ID, name: 'Periodicals', content: null, url: null, sortOrder: Number.MAX_SAFE_INTEGER });
    forest.set(PERIODICALS_PROJECT_ID, { roots: structuredClone(deps.periodicalNodes) });
  }
  const inProgressTrees = buildInProgressForest(issues, projects);
  const recentActivityTrees = buildRecentActivityForest(issues, projects, 1);
  const trees = projects.sort((a, b) => a.sortOrder - b.sortOrder).map(project => {
    const { roots } = forest.get(project.id) || { roots: [] };
    const { incomplete, completed, completedCount } = partitionCompleted(roots);
    const collapsed = incomplete.length === 0 && completedCount === 0;
    return { project: { ...project, collapsed }, incomplete, completed, completedCount };
  });
  return { issues, projects, trees, inProgressTrees, recentActivityTrees };
}

export function makeFeatureFlags(rng, deps, p = 0.5) {
  if (rng.chance(0.08)) return {};
  const f = {};
  for (const k of deps.FEATURE_KEYS) if (rng.chance(0.85)) f[k] = rng.chance(p);
  if (rng.chance(0.05)) f.aiRecommendations = undefined;
  return f;
}

export function makeWorkspaces(rng, urlKey) {
  const n = rng.weighted([[0, 1], [1, 5], [2, 2], [3, 1]]);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(clean({
      id: `w${i}`,
      urlKey: i === 0 && urlKey && rng.chance(0.85) ? urlKey : rng.pick(['other', 'ws-2', `k${i}`]),
      name: rng.chance(0.85) ? rng.pick(['Acme', 'Test Workspace', `WS ${ESC}`, 'Ünï', '']) : text(rng),
      provider: rng.weighted([[undefined, 3], ['linear', 2], ['github', 2], ['github-projects', 1], ['jira', 1], ['local', 2], ['nope', 0.3]]),
      accessToken: 'tok',
      isPAT: rng.maybe(0.15, true)
    }));
  }
  return out;
}

export function makeDeployInfo(rng) {
  return rng.weighted([[() => ({}), 4], [() => ({ version: 'v42', commit: 'abc1234def5678', createdAt: '2026-10-01T00:00:00Z' }), 2], [() => ({ commit: 'deadbeef' }), 1], [() => ({ version: `v${ESC}`, createdAt: 'garbage' }), 0.5]]);
}

export function makeTeams(rng) {
  if (rng.chance(0.5)) return [];
  return [{ id: 't1', name: 'Eng', key: 'ENG' }, { id: 't2', name: `Ops ${ESC}`, key: 'OPS' }, { id: 't3', name: 'Ünï', key: 'U' }].slice(0, rng.int(1, 3));
}

export function makeCustomPrompts(rng) {
  if (rng.chance(0.6)) return [];
  return [{ id: 'cp1', name: 'My prompt', body: 'x' }, { id: `cp"2`, name: `Hazard ${ESC}`, body: 'y' }].slice(0, rng.int(1, 2));
}

export const URL_KEYS = [['acme', 6], ['test-workspace', 2], [null, 1], ['', 0.5], ['a b/c?d', 0.5], [`k${'"'}<`, 0.3]];
