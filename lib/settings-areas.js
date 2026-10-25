/**
 * Settings area census (LIN-3846).
 *
 * The one table that says where every setting lives. The sidebar, the area
 * pages, the landing helper `settingsAreaUrl` and the census test
 * (tests/unit/settings-areas-census.test.js) all read it, so a setting or a
 * settings route placed nowhere fails a test instead of going missing.
 *
 * `features` holds setting keys: every FEATURE_DEFAULTS and
 * WORKSPACE_FEATURE_KEYS key, plus the named entries `proxyDefault`, `theme`
 * and `consent`. `routes` holds `METHOD /path` (relative to
 * /workspace/:urlKey) for every settings route.
 *
 * `state(ctx)` is the sidebar's short state: `{ text, tone }`, text at most
 * STATE_MAX_LENGTH characters ("one word or a short state"), tone 'bad' paints
 * the red dot. It is pure: the route gathers `ctx`.
 */

import { EXPERIMENTAL_VIEWS } from './feature-defaults.js';

export const STATE_MAX_LENGTH = 16;

export const AREA_GROUPS = [
  { id: 'workspace', title: 'Workspace' },
  { id: 'you', title: 'You' }
];

/**
 * The sidebar's tones, exported once (LIN-3890). `warn` is amber: paused or
 * stopped, a deliberate owner action that is not a failure. `bad` is red and
 * means it needs you. The sidebar frame reads this list; it has no mapping of
 * its own.
 */
export const SIDEBAR_TONES = Object.freeze(['ok', 'warn', 'bad']);

const clip = (text) => (text.length > STATE_MAX_LENGTH ? `${text.slice(0, STATE_MAX_LENGTH - 1)}…` : text);
const ok = (text) => ({ text: clip(text), tone: 'ok' });
const warn = (text) => ({ text: clip(text), tone: 'warn' });
const bad = (text) => ({ text: clip(text), tone: 'bad' });

export const AREAS = [
  {
    id: 'sources', purpose: 'Where Harbour reads from. Each source is yours, not the workspace’s.', label: 'Sources', group: 'workspace',
    features: [],
    routes: [
      'POST /settings/providers/remove', 'POST /settings/providers/switch',
      'POST /settings/providers/refresh', 'POST /settings/providers/add'
    ],
    state: (ctx) => {
      const active = (ctx.providerBindings || []).find(b => b.active) || (ctx.providerBindings || [])[0];
      return active ? ok(active.displayName || active.provider) : bad('None');
    }
  },
  {
    id: 'models', purpose: 'Which model each job runs on, for everyone in this workspace.', label: 'Models', group: 'workspace', wide: true,
    features: [],
    routes: [
      'POST /settings/model', 'POST /settings/dispatch-defaults', 'POST /settings/ai-model-overrides'
    ],
    state: (ctx) => ok(ctx.defaultModelName || 'Default')
  },
  {
    id: 'running', purpose: 'Whether runs go ahead, the runner that takes them, and periodic reviews.', label: 'Running', group: 'workspace',
    features: ['periodicals'],
    routes: ['POST /settings/workspace-features', 'POST /settings/running/halt'],
    state: (ctx) => {
      if (ctx.haltMode === 'stop') return warn('Stopped');
      if (ctx.haltMode === 'pause') return warn('Paused');
      return ctx.hasRunner ? ok('Runner ready') : ok('No runner');
    }
  },
  {
    id: 'agent-access', purpose: 'The keys agents and runners use to reach this workspace.', label: 'Agent access', group: 'workspace',
    features: ['modelRoutingProxyWrites'],
    routes: [],
    state: (ctx) => ok(`${ctx.keyCount || 0} live ${ctx.keyCount === 1 ? 'key' : 'keys'}`)
  },
  {
    id: 'health', purpose: 'Credential problems, the runner’s last poll and Harbour’s AI calls.', label: 'Health', group: 'workspace',
    features: [],
    routes: [],
    state: (ctx) => (ctx.healthProblems > 0 ? bad(`${ctx.healthProblems} to fix`) : ok('All clear'))
  },
  {
    id: 'change-log', purpose: 'Every change that affects everyone here, newest first, and how to undo it.', label: 'Change log', group: 'workspace',
    features: [],
    routes: ['POST /settings/change-log/:source/:id/undo'],
    state: (ctx) => (ctx.changeLogCount > 0 ? ok(`${ctx.changeLogCount} recent`) : ok('Empty'))
  },
  {
    id: 'features', purpose: 'Which views and helpers are on for you.', label: 'Features', group: 'you',
    features: ['roadmap', 'feedbackWidget', 'proxyDefault', ...EXPERIMENTAL_VIEWS.map(v => v.flag)],
    routes: ['POST /settings/features', 'POST /settings/proxy-default'],
    state: (ctx) => ok(`${ctx.featuresOn || 0} on`)
  },
  {
    id: 'account', purpose: 'Your email, your AI key, your theme and your session.', label: 'Account', group: 'you',
    features: ['theme', 'consent'],
    routes: [
      'POST /settings/theme', 'GET /auth/openrouter', 'POST /auth/openrouter/begin',
      'GET /auth/openrouter/callback', 'POST /auth/openrouter/disconnect',
      'POST /auth/openrouter/consent', 'POST /auth/openrouter/consent/clear'
    ],
    state: (ctx) => {
      const byKey = { oauth: 'Own key', env: 'Server key', free: 'Free tier' };
      return ok(byKey[ctx.openRouterSource] || 'Not connected');
    }
  }
];

/** The index route and the legacy shims are listed here: they place no setting. */
export const INDEX_ROUTES = ['GET /settings'];

export const DEFAULT_AREA_ID = AREAS[0].id;

export function getArea(id) {
  return AREAS.find(a => a.id === id) || null;
}

/**
 * Where a redirect should land: the area's page, or the index when `id` is
 * omitted. `query` is an object of extra query params.
 */
export function settingsAreaUrl(urlKey, id, query = null) {
  const base = `/workspace/${encodeURIComponent(urlKey)}/settings${id ? `/${id}` : ''}`;
  if (!query) return base;
  const qs = new URLSearchParams(query).toString();
  return qs ? `${base}?${qs}` : base;
}

/** Areas that hold `key`, for the census test. */
export function areasHoldingSetting(key) {
  return AREAS.filter(a => a.features.includes(key)).map(a => a.id);
}
