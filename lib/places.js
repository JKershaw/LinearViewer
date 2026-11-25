/**
 * lib/places.js — the one list of places a signed-in person can reach (LIN-4342, piece 1: LIN-4562).
 *
 * The side rail (lib/components/frame.js), a page's tab title, the lit rail item and the "← <parent>" way back all read
 * this list, so a place is named, grouped, ordered and gated once. It replaces the flat link list in
 * `getViewNavLinks` (lib/components/view-nav.js), which the old bar keeps reading until piece 7 deletes it.
 *
 * A place has a key, a label, a group, a path under `/workspace/:urlKey` and `who`, a predicate over the page's
 * feature flags (`requestFeatureFlags`, lib/run-controls.js). URLs do not change: only labels do. A drilled-in page
 * (a task, a run, Escalation …) is not a place: it names its `parent` place, which the rail lights and the frame links
 * back to.
 *
 * Every page the app renders is registered here now, including the ones later pieces move onto the frame, so the
 * places census (tests/unit/places-census.test.js) and the reach test (tests/unit/places-reach.test.js) cover the
 * whole app from the first piece. `aliases` are the `currentPage` keys the old bar's pages still pass, or passed before
 * their page moved (LIN-4564 dropped Runs' and Live's, `observation` and `live-console`, once no page passed them).
 *
 * Decisions held by the parent plan (plan-46603cd7, "Decisions the builder does not re-open"):
 *  - Desk (Home, Backlog) and Settings: always.
 *  - Watch: Live when `liveConsole` is on; Runs needs `runControls` (the owner with a way to run).
 *  - Views: Swipe and Swim always, then Roadmap and each EXPERIMENTAL_VIEWS entry whose flag is on, in list order, so
 *    a flag adds a place in its own slot and never moves the others.
 *  - Tools (Dispatch, Connect an agent, KPIs, Prompts): all need `runControls`.
 *  - An empty group is not drawn.
 * Consequence, stated in the PR: a member who is not the owner, and an owner whose runner has lapsed, see no Runs,
 * KPIs, Prompts or Connect an agent in the rail. Their pages and URLs still work, and Settings › Agent access and
 * Settings › Running still lead to Connect an agent and the runner set-up.
 */
import { EXPERIMENTAL_VIEWS } from './feature-defaults.js';

/** The rail's groups, top to bottom. `settings` is the foot: it has no title. */
export const PLACE_GROUPS = Object.freeze([
  { key: 'desk', label: 'Your desk' },
  { key: 'watch', label: 'Watch' },
  { key: 'views', label: 'Views' },
  { key: 'tools', label: 'Tools' },
  { key: 'settings', label: null },
]);

const always = () => true;
const runControls = (flags) => flags?.runControls === true;
const flagOn = (flag) => (flags) => flags?.[flag] === true;

/** The words each flagged view goes by in the rail (the route key is not a label). */
const VIEW_LABELS = Object.freeze({
  collective: 'Collective',
  'task-chat': 'Task chat',
  ship: 'Ship',
  'flight-companion': 'Flight Companion',
  'passage-planner': 'Passage planner',
  'ship-biscuit': "Ship's biscuit",
  'ship-journey': 'Ship journey',
});

/**
 * Every place, in rail order. `path` is relative to `/workspace/:urlKey`. `who(flags)` says whether the rail shows it.
 * `reachedFrom` is the always-shown place a person who cannot see a gated place reached its page from, by its URL or a
 * link: a new user meets Connect an agent from Settings › Agent access, so on that page Settings is lit and is the way
 * back. The rail never marks a place it does not show, and never marks nothing.
 * @type {ReadonlyArray<{key: string, label: string, group: string, path: string, who: function(Object): boolean, aliases: string[], reachedFrom?: string}>}
 */
export const PLACES = Object.freeze([
  { key: 'home', label: 'Home', group: 'desk', path: '/', who: always, aliases: ['projects'] },
  { key: 'backlog', label: 'Backlog', group: 'desk', path: '/backlog', who: always, aliases: [] },
  { key: 'live', label: 'Live', group: 'watch', path: '/live-console', who: flagOn('liveConsole'), aliases: [], reachedFrom: 'home' },
  { key: 'runs', label: 'Runs', group: 'watch', path: '/observation', who: runControls, aliases: [], reachedFrom: 'home' },
  { key: 'swipe', label: 'Swipe', group: 'views', path: '/swipe', who: always, aliases: [] },
  { key: 'swim', label: 'Swim', group: 'views', path: '/swim', who: always, aliases: [] },
  { key: 'roadmap', label: 'Roadmap', group: 'views', path: '/roadmap', who: flagOn('roadmap'), aliases: [], reachedFrom: 'settings' },
  ...EXPERIMENTAL_VIEWS.map(({ flag, path }) => ({
    key: path, label: VIEW_LABELS[path] || path, group: 'views', path: `/${path}`, who: flagOn(flag), aliases: [], reachedFrom: 'settings',
  })),
  { key: 'dispatch', label: 'Dispatch', group: 'tools', path: '/dispatch', who: runControls, aliases: [], reachedFrom: 'settings' },
  { key: 'connect', label: 'Connect an agent', group: 'tools', path: '/proxy', who: runControls, aliases: ['proxy'], reachedFrom: 'settings' },
  { key: 'kpis', label: 'KPIs', group: 'tools', path: '/kpis', who: runControls, aliases: [], reachedFrom: 'settings' },
  { key: 'prompts', label: 'Prompts', group: 'tools', path: '/prompts', who: runControls, aliases: [], reachedFrom: 'settings' },
  { key: 'settings', label: 'Settings', group: 'settings', path: '/settings', who: always, aliases: [] },
].map(Object.freeze));

/**
 * Pages reached from a place, never listed in the rail. Each lights its `parent` and links back to it. `label` is the
 * page's default name; a task or run page passes its own title instead. A task page's parent is Home or Backlog by
 * where the person came from (`parentFor`). `path` is the route, for the census; `:x` marks a parameter.
 */
export const DRILLED = Object.freeze([
  { key: 'task', label: 'Task', parent: 'home', parents: ['home', 'backlog'], path: '/task/:identifier', aliases: [] },
  { key: 'task-edit', label: 'Edit task', parent: 'home', parents: ['home', 'backlog'], path: '/task/:issueId/edit', aliases: [] },
  { key: 'task-new', label: 'New task', parent: 'home', parents: ['home', 'backlog'], path: '/task/new', aliases: [] },
  { key: 'run', label: 'Run', parent: 'runs', path: '/observation/session/:sessionId', aliases: [] },
  { key: 'custom-prompts', label: 'Custom prompts', parent: 'prompts', path: '/prompts/custom', aliases: [] },
  { key: 'escalation', label: 'Escalation', parent: 'kpis', path: '/escalation-kpis', aliases: ['escalation-kpis'] },
  { key: 'effort', label: 'Effort', parent: 'kpis', path: '/effort-readout', aliases: ['effort-readout'] },
  { key: 'runner', label: 'Run on my machine', parent: 'settings', path: '/runner', aliases: [] },
  { key: 'audit', label: 'Operator audit', parent: 'settings', path: '/audit', aliases: [] },
  // The project's records, ordered by the person (routes/project-page.js): reached from Backlog.
  { key: 'project', label: 'Project backlog', parent: 'backlog', path: '/project', aliases: [] },
  // Search is reached from the rail's search field on every page. It lights Home, the desk it searches.
  { key: 'search', label: 'Search', parent: 'home', path: '/search', aliases: [] },
].map(Object.freeze));

const byKey = new Map();
for (const entry of [...PLACES, ...DRILLED]) {
  for (const name of [entry.key, ...entry.aliases]) {
    if (byKey.has(name)) throw new Error(`lib/places.js: the key ${JSON.stringify(name)} is registered twice`);
    byKey.set(name, entry);
  }
}

/** A place or drilled-in page by its key or one of its aliases, or null. */
export function placeFor(key) {
  return byKey.get(key) || null;
}

/** True when `key` names a drilled-in page rather than a place. */
export function isDrilled(key) {
  const entry = placeFor(key);
  return !!entry && 'parent' in entry;
}

/**
 * The place a page lights in the rail: the page itself, else its parent. `from` picks a task page's parent among the
 * ones it allows (Home or Backlog); anything else falls back to the default. Given the person's `flags`, a lit place
 * their rail does not show gives way to its `reachedFrom` (always shown), so exactly one shown item is lit.
 * @param {string} key
 * @param {{from?: string, flags?: Object}} [opts]
 * @returns {Object|null} the place entry
 */
export function litPlaceFor(key, { from, flags = null } = {}) {
  const entry = placeFor(key);
  if (!entry) return null;
  let lit = entry;
  if ('parent' in entry) lit = placeFor(entry.parents?.includes(from) ? from : entry.parent);
  // With the person's flags: a place their rail does not show gives way to the one they reached it from.
  if (flags && !lit.who(flags)) lit = placeFor(lit.reachedFrom || 'home');
  return lit;
}

/** A place's href in a workspace. */
export function placeHref(place, urlKey) {
  return `/workspace/${encodeURIComponent(urlKey)}${place.path}`;
}

/**
 * The rail for one person: the groups in order, each with the places its `who` admits, empty groups dropped.
 * @param {Object} flags - the page's feature flags (requestFeatureFlags)
 * @returns {Array<{key: string, label: string|null, places: Array<Object>}>}
 */
export function railFor(flags = {}) {
  return PLACE_GROUPS
    .map(group => ({ ...group, places: PLACES.filter(place => place.group === group.key && place.who(flags)) }))
    .filter(group => group.places.length > 0);
}

/**
 * Where a person came from to a task page, read off the request's Referer (LIN-4563): 'backlog' from the Backlog page or
 * a project's backlog, 'home' from Home, else undefined (the task family's default parent, Home). Only the path counts,
 * and only within this workspace. Every link on Backlog leads here, fetched rows included, so no link carries a marker.
 * @param {string|undefined} referer - req.get('referer')
 * @param {string} urlKey - the workspace
 * @returns {'home'|'backlog'|undefined}
 */
export function taskFromReferer(referer, urlKey) {
  if (!referer || !urlKey) return undefined;
  let path;
  try {
    path = new URL(referer, 'http://referer.invalid').pathname;
  } catch {
    return undefined;
  }
  const base = `/workspace/${encodeURIComponent(urlKey)}`;
  if (path === `${base}/backlog` || path === `${base}/project` || path.startsWith(`${base}/project/`)) return 'backlog';
  if (path === `${base}/` || path === base) return 'home';
  return undefined;
}
