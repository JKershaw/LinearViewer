// Generators for lib/render.js exports.
import { Rng, DAY, HOUR, ESC, HAZARD, text, markdown, clean } from './gen-common.mjs';
import { makeWorld, makeIssue, makeFeatureFlags, makeWorkspaces, makeDeployInfo, makeTeams, makeCustomPrompts, URL_KEYS, timeNear } from './gen-world.mjs';

const PROVIDER_NAMES = ['linear', 'github', 'github-projects', 'jira', 'local'];

/** A provider argument for renderDetailsContent: registry instance, null, or a fake with arbitrary ui caps. */
export function makeProviderArg(rng) {
  return rng.weighted([
    [() => null, 2],
    [() => ({ __provider: rng.pick(PROVIDER_NAMES) }), 6],
    [() => clean({
      name: rng.pick(['fake', 'github', '', undefined, `p${ESC}`]),
      ui: rng.chance(0.9) ? clean({
        write: rng.chance(0.5), comments: rng.chance(0.6), estimates: rng.chance(0.6), subtasks: rng.chance(0.5),
        attachments: rng.chance(0.6), inlineEdit: rng.chance(0.4), inlineCreate: rng.chance(0.3),
        displayName: rng.pick(['Linear', 'GitHub', `Fake ${ESC}`, ''])
      }) : undefined,
      getCreateTaskUrl: { __fn: 'function getCreateTaskUrl(urlKey, projectId) { return "https://fake.example/new?ws=" + urlKey + "&p=" + projectId }', name: 'getCreateTaskUrl' }
    }), 2]
  ]);
}

export function renderPageCase(rng, nowMs, deps) {
  const urlKey = rng.weighted(URL_KEYS);
  const isLanding = rng.chance(0.1);
  const world = makeWorld(rng, nowMs, deps, { urlKey, periodicals: rng.chance(0.15), seedIssues: rng.chance(0.08) });
  const featureFlags = makeFeatureFlags(rng, deps);
  const nodeKeys = world.issues.map(deps.tree.nodeKey);
  const options = clean({
    isLanding: isLanding ? true : rng.maybe(0.2, false),
    teams: makeTeams(rng),
    selectedTeamId: rng.maybe(0.3, () => rng.pick(['t1', 't2', 'zz', null])),
    availableAssignees: rng.maybe(0.4, () => rng.subset(['Alice', 'Bob', `Eve ${ESC}`, 'Zoë'], 0.6)),
    selectedAssignee: rng.maybe(0.4, () => rng.pick(['all', 'me', 'Alice', `Eve ${ESC}`, null])),
    canFilterByMe: rng.maybe(0.4, () => rng.chance(0.5)),
    workspaces: makeWorkspaces(rng, urlKey),
    openRouterSource: rng.weighted([[null, 3], ['oauth', 2], ['env', 1], ['free', 1], [undefined, 1]]),
    urlKey: urlKey === null && rng.chance(0.5) ? undefined : urlKey,
    deployInfo: makeDeployInfo(rng),
    featureFlags,
    customPrompts: makeCustomPrompts(rng),
    setupNotice: rng.maybe(0.08, true),
    isLocalhost: rng.maybe(0.3, () => rng.chance(0.5)),
    showSource: rng.maybe(0.3, () => rng.chance(0.6)),
    heroHtml: rng.maybe(0.06, () => rng.pick(['<section class="hero">Hi</section>', `<div>${ESC}</div>`])),
    truncated: rng.maybe(0.1, true),
    topTaskId: rng.maybe(0.4, () => (nodeKeys.length && rng.chance(0.85) ? rng.pick(nodeKeys) : rng.pick(['linear:nope', null, '']))),
    topTaskWhy: rng.maybe(0.4, () => rng.pick([[], ['bug'], ['unblocks 3', 'critical path 2'], [ESC], null])),
    topTaskOnboarding: rng.maybe(0.1, true),
    proxyDefault: rng.maybe(0.4, () => rng.pick([true, false, null]))
  });
  const orgName = rng.weighted([[undefined, 1], ['Acme Corp', 4], [`Org ${ESC}`, 1], ['', 0.5]]);
  const argc = rng.weighted([[5, 8], [4, 1], [1, 0.5]]);
  const args = [world.trees, world.inProgressTrees, world.recentActivityTrees, orgName, options].slice(0, argc);
  if (rng.chance(0.05)) args[1] = undefined;
  if (rng.chance(0.03)) args[2] = null;
  return { module: 'render', export: 'renderPage', args };
}

export function detailsIssue(rng, nowMs, deps) {
  const issue = makeIssue(rng, nowMs, { promptLabels: deps.promptLabels }, rng.int(0, 50));
  if (rng.chance(0.4)) issue.description = markdown(rng);
  if (rng.chance(0.1)) issue.comments = rng.pick([[{ body: '![a](https://uploads.linear.app/z.png "T")' }], { nodes: [{ body: '![x](https://cdn.example.com/k.jpeg)' }] }, []]);
  if (rng.chance(0.15)) issue.attachments = { nodes: [{ url: 'https://uploads.linear.app/q.png', title: `t ${ESC}` }, { url: 'https://cdn.e.com/r.png' }] };
  if (rng.chance(0.05)) delete issue.title;
  return issue;
}

export function renderDetailsCase(rng, nowMs, deps) {
  const issue = detailsIssue(rng, nowMs, deps);
  const opts = rng.chance(0.05) ? undefined : clean({
    isLanding: rng.maybe(0.6, () => rng.chance(0.25)),
    openRouterSource: rng.maybe(0.5, () => rng.pick(['oauth', 'env', 'free', null])),
    urlKey: rng.maybe(0.85, () => rng.weighted(URL_KEYS)),
    featureFlags: rng.maybe(0.85, () => makeFeatureFlags(rng, deps)),
    customPrompts: rng.maybe(0.3, () => makeCustomPrompts(rng)),
    isLocalhost: rng.maybe(0.3, () => rng.chance(0.5)),
    provider: rng.maybe(0.85, () => makeProviderArg(rng)),
    section: rng.maybe(0.6, () => rng.pick(['in-progress', 'project', 'recent-activity', '', `s${ESC}`]))
  });
  return { module: 'render', export: 'renderDetailsContent', args: opts === undefined ? [issue] : [issue, opts] };
}

export function smallRenderCase(rng, nowMs, deps) {
  const which = rng.weighted([['formatRelativeTime', 4], ['renderDisplayLabels', 3], ['priorityOptionsHtml', 2], ['reexport', 1]]);
  if (which === 'formatRelativeTime') {
    const v = rng.weighted([[() => timeNear(rng, nowMs), 6], [() => null, 0.5], [() => undefined, 0.5], [() => '', 0.5], [() => nowMs - rng.int(0, 10 * DAY), 1], [() => new Date(nowMs - rng.int(0, 3 * DAY)).toISOString(), 1]]);
    return { module: 'render', export: 'formatRelativeTime', args: [v] };
  }
  if (which === 'renderDisplayLabels') {
    const labels = rng.weighted([[() => undefined, 1], [() => ({ nodes: [] }), 1], [() => ({ nodes: rng.subset(['bug', `x${ESC}`, 'ünï', ...deps.promptLabels], 0.3).map(name => ({ name })) }), 6]]);
    return { module: 'render', export: 'renderDisplayLabels', args: [clean({ id: 'i', labels })] };
  }
  if (which === 'priorityOptionsHtml') {
    return { module: 'render', export: 'priorityOptionsHtml', args: [rng.pick([0, 1, 2, 3, 4, '2', '0', null, undefined, 5, -1, 'x', 2.5, true])] };
  }
  const re = rng.pick(['renderLoginPage', 'renderErrorPage', 'renderUpstreamAwareErrorPage', 'renderWorkspaceNotFoundPage', 'renderOpenRouterConsentPage']);
  const args = {
    renderLoginPage: () => [rng.pick([{}, { githubEnabled: true }, { error: ESC }])],
    renderErrorPage: () => [text(rng), text(rng), rng.pick([{}, { urlKey: 'acme' }])],
    renderUpstreamAwareErrorPage: () => [rng.pick([new Error('boom'), { status: 503, message: ESC }, null]), {}],
    renderWorkspaceNotFoundPage: () => [rng.pick(['acme', ESC, '']), [{ urlKey: 'a', name: 'A' }]],
    renderOpenRouterConsentPage: () => [rng.pick([{}, { urlKey: 'acme' }, { urlKey: ESC }])]
  }[re]();
  return { module: 'render', export: re, args };
}
