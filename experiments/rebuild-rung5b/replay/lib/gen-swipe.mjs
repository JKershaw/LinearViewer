// Generators for lib/render-swipe.js exports (the deck page + its pure ordering
// pipeline, which lib/roadmap.js and lib/task-stack.js also call).
import { ESC, text, clean } from './gen-common.mjs';
import { makeWorld, makeFeatureFlags, makeWorkspaces, makeDeployInfo, makeTeams, makeCustomPrompts, URL_KEYS } from './gen-world.mjs';

export function renderSwipeCase(rng, nowMs, deps) {
  const urlKey = rng.weighted(URL_KEYS);
  const isLanding = rng.chance(0.12);
  const world = makeWorld(rng, nowMs, deps, { urlKey, seedIssues: rng.chance(0.15), periodicals: rng.chance(0.05) });
  const idents = world.issues.map(i => i.identifier).filter(Boolean);
  const data = clean({ projectTrees: rng.chance(0.97) ? world.trees : undefined, inProgressTrees: rng.chance(0.97) ? world.inProgressTrees : undefined, recentActivityTrees: rng.chance(0.97) ? world.recentActivityTrees : undefined, organizationName: 'Acme' });
  const options = clean({
    deployInfo: makeDeployInfo(rng),
    urlKey: urlKey === null && rng.chance(0.5) ? undefined : urlKey,
    openRouterSource: rng.weighted([[null, 3], ['oauth', 2], ['env', 1], ['free', 1], [undefined, 1]]),
    workspaces: makeWorkspaces(rng, urlKey),
    featureFlags: makeFeatureFlags(rng, deps),
    customPrompts: makeCustomPrompts(rng),
    initialIdentifier: rng.maybe(0.2, () => (idents.length ? rng.pick(idents) : rng.pick(['LIN-1', ESC]))),
    isLanding: isLanding ? true : rng.maybe(0.2, false),
    isLocalhost: rng.maybe(0.3, () => rng.chance(0.5)),
    sessionCounts: rng.maybe(0.4, () => Object.fromEntries(rng.subset(idents, 0.4).map(id => [id, rng.int(0, 5)]))),
    teams: makeTeams(rng),
    selectedTeamId: rng.maybe(0.3, () => rng.pick(['t1', 't2', null])),
    proxyDefault: rng.maybe(0.4, () => rng.pick([true, false, null]))
  });
  const args = rng.chance(0.05) ? [data] : [data, options];
  return { module: 'swipe', export: 'renderSwipePage', args };
}

/** Flat card set straight from the real flattenTrees, optionally perturbed. */
export function cardsFrom(rng, world, deps, flatten) {
  let cards = [...flatten(world.inProgressTrees, 'in-progress'), ...flatten(world.trees, 'project'), ...flatten(world.recentActivityTrees, 'recent-activity')];
  const seen = new Set();
  cards = cards.filter(c => { const k = `${c.source}:${c.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  for (const c of cards) {
    if (rng.chance(0.3)) c.downstreamUnblocks = rng.int(0, 6);
    if (rng.chance(0.3)) c.criticalPathLen = rng.int(0, 5);
    if (rng.chance(0.1)) c.key = `${c.source}:${c.id}`;
    if (rng.chance(0.05) && cards.length) c.parentKey = `${c.source}:${rng.pick(cards).id}`;
    if (rng.chance(0.05) && cards.length) c.parentId = rng.pick(cards).id; // may form a parent cycle
    if (rng.chance(0.05)) c.blocksIds = [...(c.blocksIds || []), rng.pick(cards).id];
    if (rng.chance(0.03)) c.labels = undefined;
  }
  return rng.chance(0.3) ? rng.shuffle(cards) : cards;
}

export function swipePureCase(rng, nowMs, deps) {
  const urlKey = rng.weighted(URL_KEYS);
  const world = makeWorld(rng, nowMs, deps, { urlKey, seedIssues: rng.chance(0.1), nIssues: rng.chance(0.5) ? rng.int(2, 25) : undefined });
  const which = rng.weighted([['flattenTrees', 2], ['isBoostableBug', 1], ['sortIssuesForSwipe', 2], ['computeOffPageBlockers', 1.5], ['buildWhy', 1], ['applyBlockingOrder', 2], ['clusterByParent', 2], ['buildFilterGroups', 1.5], ['orderIssuesForSwipe', 3], ['computeGraphFeatures', 1.5]]);
  const flatten = deps.flattenTreesRef;
  if (which === 'flattenTrees') {
    const type = rng.pick(['project', 'in-progress', 'recent-activity', 'other']);
    const trees = type === 'project' ? world.trees : type === 'in-progress' ? world.inProgressTrees : type === 'recent-activity' ? world.recentActivityTrees : world.trees;
    return { module: 'swipe', export: which, args: [trees, type] };
  }
  const cards = cardsFrom(rng, world, deps, flatten);
  if (which === 'isBoostableBug') {
    const c = cards.length ? rng.pick(cards) : {};
    if (rng.chance(0.5)) c.labels = rng.pick([['bug'], ['BUG', 'x'], [], ['feature']]);
    if (rng.chance(0.5)) c.priority = rng.int(0, 5);
    if (rng.chance(0.3)) c.stateType = rng.pick(['backlog', 'started', 'unstarted', 'completed']);
    return { module: 'swipe', export: which, args: [c] };
  }
  if (which === 'computeOffPageBlockers') {
    if (rng.chance(0.6)) deps.computeGraphFeaturesRef(cards);
    return { module: 'swipe', export: which, args: [cards, rng.int(0, Math.max(1, cards.length + 1))] };
  }
  if (which === 'buildWhy') {
    const c = cards.length ? rng.pick(cards) : { labels: ['bug'], priority: 2, stateType: 'started', downstreamUnblocks: 3, criticalPathLen: 2 };
    const held = rng.pick([undefined, [], ['LIN-1'], ['LIN-1', 'LIN-2', ESC]]);
    return { module: 'swipe', export: which, args: held === undefined ? [c] : [c, held] };
  }
  if (which === 'buildFilterGroups') {
    if (rng.chance(0.2)) for (const c of cards) c.labels = rng.subset(['bug', 'b', 'a', 'Bug', '', 'a'], 0.4);
    return { module: 'swipe', export: which, args: [cards] };
  }
  if (which === 'orderIssuesForSwipe') {
    const data = clean({ projectTrees: rng.maybe(0.95, world.trees), inProgressTrees: rng.maybe(0.95, world.inProgressTrees), recentActivityTrees: rng.maybe(0.95, world.recentActivityTrees), urlKey: rng.maybe(0.8, urlKey) });
    return { module: 'swipe', export: which, args: rng.chance(0.03) ? [] : [data] };
  }
  if (which === 'sortIssuesForSwipe' || which === 'applyBlockingOrder' || which === 'clusterByParent') {
    if (rng.chance(0.5)) deps.computeGraphFeaturesRef(cards);
  }
  return { module: 'swipe', export: which, args: [cards] };
}
