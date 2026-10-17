// Fixture inputs: captured unit-test calls, the repo's own sample data
// (content/landing.md through the landing pipeline, lib/sample-data
// testMockData through the dashboard pipeline), and hand-written edges that hit
// specific boundaries on purpose.
import v8 from 'node:v8';
import { DAY, HOUR, ESC, clean } from './gen-common.mjs';
import { worldTrees } from './gen-world.mjs';

export function capturedInputs(capture) {
  const out = [];
  const perSite = new Map();
  for (const f of capture.files) {
    for (const r of f.records) {
      const k = `${r.mod}.${r.name}@${r.site}`;
      const n = (perSite.get(k) || 0) + 1;
      perSite.set(k, n);
      const id = `test:${r.mod}.${r.name}@${r.site}#${n}`;
      if (!r.payload) { out.push({ id, tier: 'test', module: r.mod, export: r.name, error: r.error }); continue; }
      out.push({ id, tier: 'test', module: r.mod, export: r.name, payload: r.payload, testFile: f.file });
    }
  }
  return out;
}

export function sampleInputs(deps) {
  const out = [];
  const { landing, testMockData, testMockTeams } = deps;
  // Landing trees exactly as server.js builds them (isHiddenState filtered).
  const landingIssues = landing.issues.filter(i => !deps.isHiddenState(i));
  const lf = deps.tree.buildForest(landingIssues);
  const landingTrees = landing.projects.slice().sort((a, b) => a.sortOrder - b.sortOrder).map(project => {
    const { roots } = lf.get(project.id) || { roots: [] };
    const { incomplete, completed, completedCount } = deps.tree.partitionCompleted(roots);
    return { project, incomplete, completed, completedCount };
  });
  const deploy = { version: 'v42', commit: 'abc1234def5678', createdAt: '2026-10-01T00:00:00Z' };
  for (const [name, opts] of [['landing', { isLanding: true, deployInfo: {} }], ['landing+deploy', { isLanding: true, deployInfo: deploy }], ['landing-hero', { isLanding: true, heroHtml: '<section class="landing-hero">hero</section>' }]]) {
    out.push({ id: `sample:renderPage:${name}`, tier: 'sample', module: 'render', export: 'renderPage', args: [landingTrees, [], [], landing.organizationName, opts] });
  }
  for (const [name, opts] of [['landing', { isLanding: true, deployInfo: {} }], ['landing+initial', { isLanding: true, deployInfo: deploy, initialIdentifier: landing.issues[0]?.identifier || null }]]) {
    out.push({ id: `sample:renderSwipePage:${name}`, tier: 'sample', module: 'swipe', export: 'renderSwipePage', args: [{ projectTrees: landingTrees, inProgressTrees: [], recentActivityTrees: [] }, opts] });
  }
  for (const issue of landing.issues.slice(0, 40)) {
    out.push({ id: `sample:renderDetailsContent:landing:${issue.id}`, tier: 'sample', module: 'render', export: 'renderDetailsContent', args: [issue, { isLanding: true }] });
  }
  // testMockData through the dashboard pipeline.
  const w = worldTrees(testMockData.issues, testMockData.projects, deps, { periodicals: false });
  const wp = worldTrees(testMockData.issues, testMockData.projects, deps, { periodicals: true });
  const ws = [{ id: 'w1', urlKey: 'test-workspace', name: 'Test Workspace', accessToken: 't' }];
  const flagsAll = Object.fromEntries(deps.FEATURE_KEYS.map(k => [k, true]));
  const variants = [
    ['default', w, { urlKey: 'test-workspace', workspaces: ws, featureFlags: deps.FEATURE_DEFAULTS, teams: testMockTeams }],
    ['all-flags', w, { urlKey: 'test-workspace', workspaces: ws, featureFlags: flagsAll, openRouterSource: 'oauth', showSource: true, teams: testMockTeams, selectedTeamId: testMockTeams[0].id }],
    ['periodicals', wp, { urlKey: 'test-workspace', workspaces: ws, featureFlags: { proxy: true }, isLocalhost: true }],
    ['periodicals-noproxy', wp, { urlKey: 'test-workspace', workspaces: ws, featureFlags: {} }],
    ['periodicals-landing', wp, { isLanding: true }],
    ['top-task', w, { urlKey: 'test-workspace', workspaces: ws, topTaskId: w.issues[0] && deps.tree.nodeKey(w.issues[0]), topTaskWhy: ['bug'], topTaskOnboarding: true }]
  ];
  for (const [name, world, opts] of variants) {
    out.push({ id: `sample:renderPage:mock:${name}`, tier: 'sample', module: 'render', export: 'renderPage', args: [world.trees, world.inProgressTrees, world.recentActivityTrees, testMockData.organizationName, opts] });
    out.push({ id: `sample:renderSwipePage:mock:${name}`, tier: 'sample', module: 'swipe', export: 'renderSwipePage', args: [{ projectTrees: world.trees, inProgressTrees: world.inProgressTrees, recentActivityTrees: world.recentActivityTrees }, opts] });
    out.push({ id: `sample:orderIssuesForSwipe:mock:${name}`, tier: 'sample', module: 'swipe', export: 'orderIssuesForSwipe', args: [{ projectTrees: world.trees, inProgressTrees: world.inProgressTrees, recentActivityTrees: world.recentActivityTrees, urlKey: opts.urlKey }] });
  }
  for (const issue of testMockData.issues) {
    for (const provider of [null, { __provider: 'linear' }, { __provider: 'local' }, { __provider: 'github' }]) {
      out.push({ id: `sample:renderDetailsContent:mock:${issue.id}:${provider?.__provider || 'none'}`, tier: 'sample', module: 'render', export: 'renderDetailsContent', args: [issue, { urlKey: 'test-workspace', featureFlags: flagsAll, provider, section: 'in-progress', openRouterSource: 'oauth' }] });
    }
  }
  return out;
}

const iso = (ms) => new Date(ms).toISOString();

export function edgeInputs(nowMs, deps) {
  const E = [];
  const add = (id, module, exp, args, extra = {}) => E.push({ id: `edge:${id}`, tier: 'edge', module, export: exp, args, ...extra });
  // ---- render.js ----------------------------------------------------------
  add('renderPage:empty-1arg', 'render', 'renderPage', [[]]);
  add('renderPage:empty-all', 'render', 'renderPage', [[], [], [], 'Org', {}]);
  add('renderPage:landing-empty', 'render', 'renderPage', [[], [], [], undefined, { isLanding: true }]);
  for (const d of [-1, 0, 59e3, 60e3, 59 * 60e3 + 59e3, 60 * 60e3, 23 * HOUR, 24 * HOUR - 1, 24 * HOUR, 48 * HOUR - 1, 48 * HOUR, 7 * DAY - 1, 7 * DAY, 30 * DAY, -DAY]) {
    add(`formatRelativeTime:${d}`, 'render', 'formatRelativeTime', [iso(nowMs - d)]);
  }
  for (const v of [null, undefined, '', 'garbage', 0, nowMs]) add(`formatRelativeTime:${String(v)}`, 'render', 'formatRelativeTime', [v]);
  for (const v of [0, 1, 2, 3, 4, '3', null, undefined, 9, 'x']) add(`priorityOptionsHtml:${String(v)}`, 'render', 'priorityOptionsHtml', [v]);
  add('priorityOptionsHtml:noarg', 'render', 'priorityOptionsHtml', []);
  const base = { id: 'i-1', identifier: 'LIN-1', title: 'T', url: 'https://linear.app/x/issue/LIN-1' };
  const descs = {
    'exactly-3-lines': 'a\nb\nc', '4-lines': 'a\nb\nc\nd', 'len-300': 'x'.repeat(300), 'len-301': 'x'.repeat(301),
    'blank-lines': 'a\n\n\nb', 'prompt-block': 'Intro\n---\nDo the thing\n---\nAfter 1\nAfter 2\nAfter 3', 'prompt-block-no-tail': 'Intro\n---\nPrompt only\n---',
    'prompt-block-empty-intro': '---\nP\n---\nrest', 'prompt-block-empty-prompt': 'Intro\n---\n \n---', 'hr-not-block': 'a\n---\nb', 'escape': `${ESC}\n${ESC}`, 'crlf': 'a\r\nb\r\nc\r\nd', 'images': '![a](https://uploads.linear.app/1.png)\n![b](https://cdn.example.com/2.png "T")'
  };
  for (const [name, description] of Object.entries(descs)) {
    for (const [mode, opts] of [['landing', { isLanding: true }], ['auth', { urlKey: 'acme', provider: { __provider: 'linear' }, featureFlags: { dispatch: true, taskChat: true }, section: 'project' }], ['auth-noprovider', { urlKey: 'acme' }]]) {
      add(`renderDetailsContent:${name}:${mode}`, 'render', 'renderDetailsContent', [{ ...base, description }, opts]);
    }
  }
  add('renderDetailsContent:nothing', 'render', 'renderDetailsContent', [{ id: 'x' }, { isLanding: true }]);
  add('renderDetailsContent:nothing-auth', 'render', 'renderDetailsContent', [{ id: 'x' }, {}]);
  add('renderDetailsContent:noopts', 'render', 'renderDetailsContent', [{ ...base, description: 'd', assignee: { name: 'A' }, estimate: 3, dueDate: '2026-11-01', labels: { nodes: [{ name: 'bug' }, { name: 'plan' }] } }]);
  for (const p of ['linear', 'github', 'github-projects', 'jira', 'local']) {
    add(`renderDetailsContent:provider:${p}`, 'render', 'renderDetailsContent', [{ ...base, description: 'd\n![i](https://uploads.linear.app/i.png)', estimate: 2, completedAt: iso(nowMs - DAY), source: p, comments: { nodes: [{ body: '![c](https://linear.app/c.png)' }] } }, { urlKey: 'acme', provider: { __provider: p }, featureFlags: { dispatch: true, taskChat: true }, section: 'in-progress' }]);
  }
  // project description truncation boundaries + add-task link per provider
  const proj = (id, content, extra = {}) => ({ project: { id, name: `P ${id}`, content, url: 'https://linear.app/p', collapsed: false, ...extra }, incomplete: [], completed: [], completedCount: 0 });
  const contents = ['x'.repeat(150), 'x'.repeat(151), `${'a'.repeat(125)} ${'b'.repeat(40)}`, `${'a'.repeat(115)} ${'b'.repeat(40)}`, `${'w '.repeat(80)}`];
  for (const prov of [undefined, 'github', 'jira', 'local', 'github-projects']) {
    add(`renderPage:projects:${prov || 'legacy'}`, 'render', 'renderPage', [contents.map((c, i) => proj(`p${i}`, c, i === 0 ? { collapsed: true } : {})).concat([proj('__no_project__', null), proj('__periodicals__x', null)]), [], [], 'Org', { urlKey: 'acme', workspaces: [{ id: 'w', urlKey: 'acme', name: 'W', provider: prov }] }]);
  }
  add('renderPage:projects:no-urlkey', 'render', 'renderPage', [[proj('p1', 'c')], [], [], 'Org', { workspaces: [] }]);
  // topTask dedupe: same issue in In Progress + project tree
  {
    const issue = { id: 'dup-1', identifier: 'LIN-9', title: 'Dup', state: { name: 'In Progress', type: 'started' }, project: { id: 'pA' } };
    const w = worldTrees([issue, { id: 'c-1', identifier: 'LIN-10', title: 'Child', state: { name: 'Todo', type: 'unstarted' }, parent: { id: 'dup-1' }, project: { id: 'pB' } }], [{ id: 'pA', name: 'A', sortOrder: 1 }, { id: 'pB', name: 'B', sortOrder: 2 }], deps);
    add('renderPage:top-task-dedupe', 'render', 'renderPage', [w.trees, w.inProgressTrees, w.recentActivityTrees, 'Org', { urlKey: 'acme', topTaskId: deps.tree.nodeKey(issue), topTaskWhy: ['bug', ESC] }]);
    add('renderPage:top-task-empty-why', 'render', 'renderPage', [w.trees, w.inProgressTrees, w.recentActivityTrees, 'Org', { urlKey: 'acme', topTaskId: deps.tree.nodeKey(issue), topTaskWhy: [] }]);
  }
  // ---- render-swipe.js ----------------------------------------------------
  const card = (id, o = {}) => ({ id, identifier: `S-${id}`, title: id, stateType: 'unstarted', priority: 3, labels: [], source: 'linear', blocksIds: [], parentId: null, section: 'project', projectName: 'P', ...o });
  add('sort:promotion-threshold', 'swipe', 'sortIssuesForSwipe', [[card('a', { stateType: 'started' }), card('b', { downstreamUnblocks: 2 }), card('c', { downstreamUnblocks: 1 }), card('d', { stateType: 'backlog', downstreamUnblocks: 5 }), card('e', { labels: ['Bug'], priority: 1 }), card('f', { labels: ['bug'], priority: 4 }), card('g', { stateType: 'completed' }), card('h', { stateType: 'weird' })]]);
  add('applyBlockingOrder:cycle', 'swipe', 'applyBlockingOrder', [[card('a', { blocksIds: ['b'] }), card('b', { blocksIds: ['a'] }), card('c', { blocksIds: ['a'] })]]);
  add('applyBlockingOrder:keyed', 'swipe', 'applyBlockingOrder', [[card('a', { key: 'linear:a', blocksIds: ['b'] }), card('b', { key: 'linear:b' })]]);
  add('cluster:parent-cycle', 'swipe', 'clusterByParent', [[card('a', { parentId: 'b' }), card('b', { parentId: 'a' }), card('c'), card('d', { parentId: 'c' }), card('e', { parentId: 'zz' })]]);
  add('cluster:parentKey', 'swipe', 'clusterByParent', [[card('a', { key: 'k:a', parentId: 'b', parentKey: 'k:b' }), card('b', { key: 'k:b' })]]);
  add('cluster:none', 'swipe', 'clusterByParent', [[card('a'), card('b')]]);
  add('offpage:held', 'swipe', 'computeOffPageBlockers', [[card('x', { parentId: 'y' }), card('y'), card('z', { blocksIds: ['x'] })], 2]);
  add('why:held-many', 'swipe', 'buildWhy', [card('a', { labels: ['bug'], priority: 2, downstreamUnblocks: 6, criticalPathLen: 4 }), ['LIN-1', 'LIN-2', 'LIN-3']]);
  add('filters:labels-tie', 'swipe', 'buildFilterGroups', [[card('a', { labels: ['b', 'a', 'a'], stateType: 'started' }), card('b', { labels: ['a', 'b', ''], section: 'recent-activity', projectName: '' }), card('c', { labels: undefined, projectName: 'Q' })]]);
  add('flatten:unknown-type', 'swipe', 'flattenTrees', [[{ project: { name: 'P' }, incomplete: [] }], 'nope']);
  {
    const seedKey = 'seedws';
    const s = deps.starterSeed(seedKey);
    const seedIssues = s.issues.map(i => clean({ id: i.id, identifier: i.identifier, title: i.title, state: i.state, project: { id: i.projectId }, parent: i.parentId ? { id: i.parentId } : undefined }));
    const w = worldTrees(seedIssues, s.projects, deps);
    add('swipe:seed-only', 'swipe', 'renderSwipePage', [{ projectTrees: w.trees, inProgressTrees: w.inProgressTrees, recentActivityTrees: w.recentActivityTrees }, { urlKey: seedKey }]);
    add('order:seed-only', 'swipe', 'orderIssuesForSwipe', [{ projectTrees: w.trees, inProgressTrees: w.inProgressTrees, recentActivityTrees: w.recentActivityTrees, urlKey: seedKey }]);
    const w2 = worldTrees([...seedIssues, { id: 'real-1', identifier: 'R-1', title: 'Real', state: { name: 'Todo', type: 'unstarted' }, project: { id: s.projects[0].id } }], s.projects, deps);
    add('order:seed-demoted', 'swipe', 'orderIssuesForSwipe', [{ projectTrees: w2.trees, inProgressTrees: w2.inProgressTrees, recentActivityTrees: w2.recentActivityTrees, urlKey: seedKey }]);
  }
  add('swipe:empty', 'swipe', 'renderSwipePage', [{}]);
  add('order:noarg', 'swipe', 'orderIssuesForSwipe', []);
  // ---- render-session.js --------------------------------------------------
  add('session:not-found', 'session', 'renderSessionPage', [{ session: null, sessionId: `s${ESC}`, urlKey: 'acme' }, {}]);
  add('session:noargs', 'session', 'renderSessionPage', []);
  const L = (id, o = {}) => ({ loopId: id, kind: 'implementation', iteration: 1, issueIdentifier: 'LIN-1', target: 'cli', dispatchedAt: iso(nowMs - DAY), ...o });
  const sess = (loops, o = {}) => ({ sessionId: 'abcdef1234567890', seedIssue: 'LIN-1', tasksTouched: ['LIN-1'], loops, dispatchedAt: iso(nowMs - 2 * DAY), ...o });
  add('session:lineage-2-reply', 'session', 'renderSessionPage', [{ session: sess([L('l1', { lineageId: 'g', terminalStatus: 'done' }), L('l2', { lineageId: 'g', followUpTo: 'l1', feedback: [{ message: '[blocked] need', timestamp: iso(nowMs - HOUR) }] })]), canReply: true, waiting: true, urlKey: 'acme', proposals: [{ id: 'p1', stepLoopId: 'l2', prompt: 'x', status: 'proposed' }, { id: 'p2', stepLoopId: 'zz', prompt: 'y', status: 'applied' }] }, {}]);
  add('session:bare-blocked', 'session', 'renderSessionPage', [{ session: sess([L('l1', { feedback: [{ message: '[blocked] help', timestamp: iso(nowMs - HOUR) }] })]), waiting: true, waitingMessage: '[blocked] help', canReply: true, producer: { loopId: 'l1', target: 'web', issueSource: 'github', case: ['why 1', 'why 2'] }, urlKey: 'acme' }, {}]);
  add('session:decision-midturn', 'session', 'renderSessionPage', [{ session: sess([L('l1')]), decisions: [{ decision: { decision_id: 'd1', question: 'Q?', options: [{ id: 'a', label: 'A' }] }, anchor: { loopId: 'l1' }, disposition: 'mid-turn' }, { decision: { decision_id: 'd2', if_unanswered: { summary: 'S' } }, anchor: { loopId: 'l1', source: 'jira' }, disposition: 'resumable' }], canReply: true, sessionTerminal: true, urlKey: 'acme' }, {}]);
  add('session:priced-total', 'session', 'renderSessionPage', [{ session: sess([L('l1', { terminalStatus: 'done', kind: 'plan', telemetry: { model: 'claude-opus-4-8', usage: { costUsd: 1.25, harness: 'claude-code' }, runtime: { ms: 125000 } } }), L('l2', { kind: 'review', telemetry: { usage: { costUsd: 0.5, harness: 'claude-code' } } })], { completedAt: iso(nowMs) }), sessionTerminal: true, anchorIssueTitle: 'Anchor', credentialByToken: { t: 'credential_dead' }, prState: { state: 'open', number: 5, checks: 'passing' }, runParagraph: 'Para.' }, {}]);
  add('session:standalone', 'session', 'renderSessionPage', [{ session: { sessionId: 'x', loops: [L('l1', { issueIdentifier: undefined })] } }, {}]);
  add('session:goal-only', 'session', 'renderSessionPage', [{ session: { sessionId: 'x', loops: [L('l1', { sessionId: 'x' }), L('l2', { sessionId: 'x' })] } }, {}]);
  add('prline:default', 'session', 'renderPrLine', []);
  // ---- render-settings.js -------------------------------------------------
  add('settings:noargs', 'settings', 'renderSettingsPage', []);
  add('settings:name-only', 'settings', 'renderSettingsPage', ['WS']);
  for (const src of ['oauth', 'env', 'free', null, 'other']) {
    add(`settings:openrouter:${src}`, 'settings', 'renderSettingsPage', ['WS', { urlKey: 'acme', openRouterSource: src, openRouterConsentedAt: src === 'oauth' ? null : undefined, availableModels: deps.AVAILABLE_MODELS, currentModel: deps.AVAILABLE_MODELS[1].id }]);
  }
  add('settings:oauth-consented', 'settings', 'renderSettingsPage', ['WS', { urlKey: 'acme', openRouterSource: 'oauth', openRouterConsentedAt: '2026-10-01T00:00:00Z' }]);
  add('settings:all-flags', 'settings', 'renderSettingsPage', ['WS', { urlKey: 'acme', featureFlags: Object.fromEntries(deps.FEATURE_KEYS.map(k => [k, true])), workspaceFeatures: Object.fromEntries(deps.WORKSPACE_FEATURE_KEYS.map(k => [k, true])) }]);
  add('settings:no-flags', 'settings', 'renderSettingsPage', ['WS', { urlKey: 'acme', featureFlags: Object.fromEntries(deps.FEATURE_KEYS.map(k => [k, false])), workspaceFeatures: {} }]);
  for (const [n, env] of [['capture', { EMAIL_TRANSPORT: 'capture', NODE_ENV: 'test' }], ['console-prod', { EMAIL_TRANSPORT: 'console' }], ['resend', { RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.c', EMAIL_LINK_ORIGIN: 'https://h.example' }]]) {
    add(`settings:email:${n}`, 'settings', 'renderSettingsPage', ['WS', { urlKey: 'acme', accountEmails: [] }], { env });
    add(`settings:email:${n}:has-email`, 'settings', 'renderSettingsPage', ['WS', { urlKey: 'acme', accountEmails: ['a@x.io'] }], { env });
  }
  add('settings:providers-full', 'settings', 'renderSettingsPage', ['WS', { urlKey: 'acme', providerBindings: [{ provider: 'linear', scope: 'acme', token: 'lin_abcd', active: true }, { provider: 'local', scope: 'acme', active: false }, { provider: 'github', scope: 'o/r', displayName: 'GitHub', token: undefined }], providerNotice: { type: 'ok', text: 'Added', activate: { provider: 'github', scope: 'o/r' } }, githubEnabled: false, jiraOAuthEnabled: false }]);
  add('settings:providers-enabled', 'settings', 'renderSettingsPage', ['WS', { urlKey: 'acme', providerBindings: [], githubEnabled: true, jiraOAuthEnabled: true }]);
  add('settings:pat', 'settings', 'renderSettingsPage', ['WS', { urlKey: 'acme', workspaces: [{ id: 'w', urlKey: 'acme', name: 'W', isPAT: true }] }]);
  return E;
}
