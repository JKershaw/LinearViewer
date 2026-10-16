// Generators for lib/render-settings.js (renderSettingsPage) — every option in
// its SettingsPageOptions plus env overlays for the email-availability branch.
import { DAY, ESC, HAZARD, text, clean } from './gen-common.mjs';
import { makeFeatureFlags, makeWorkspaces, makeDeployInfo, URL_KEYS } from './gen-world.mjs';

const HARNESSES = ['claude-code', 'opencode', '', 'legacy-custom', undefined];
const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
function model(rng, deps) {
  return rng.weighted([[() => undefined, 3], [() => '', 1], [() => rng.pick(CLAUDE_MODELS), 2], [() => rng.pick(deps.AVAILABLE_MODELS).id, 2], [() => 'openrouter/catalog-1', 1], [() => `custom/${ESC}`, 0.5], [() => 'default', 0.5]]);
}
function dispatchRow(rng, deps) {
  return clean({ model: model(rng, deps), harness: rng.pick(HARNESSES), effort: rng.maybe(0.3, () => rng.pick(['high', 'low', ESC, ''])) });
}
function byKind(rng, deps, kinds, p = 0.15) {
  if (rng.chance(0.4)) return rng.chance(0.5) ? undefined : {};
  const o = {};
  for (const k of kinds) if (rng.chance(p)) o[k] = dispatchRow(rng, deps);
  return o;
}

export function settingsCase(rng, nowMs, deps) {
  const urlKey = rng.weighted(URL_KEYS);
  const kinds = deps.DISPATCH_DEFAULT_KINDS;
  const avail = rng.weighted([[() => deps.AVAILABLE_MODELS, 6], [() => [], 1], [() => rng.subset(deps.AVAILABLE_MODELS, 0.5), 2], [() => [...deps.AVAILABLE_MODELS.slice(0, 2), { id: `x/${ESC}`, name: ESC, pricing: { prompt: 0, completion: 0 } }, { id: 'y/no-price', name: 'NoPrice' }, { id: 'z/str-price', name: 'Str', pricing: { prompt: '1', completion: 2 } }], 1]]);
  const catalog = rng.weighted([[() => [], 4], [() => [{ id: 'openrouter/catalog-1', name: 'Catalog One', pricing: { prompt: '0', completion: '0' } }, { id: 'anthropic/claude-sonnet-4.6', name: 'Dup' }, { id: 'c/2', pricing: { prompt: '0.000001', completion: '0.000002' } }, { id: '', name: 'empty' }, { id: `c/${ESC}`, name: 42 }], 3], [() => Array.from({ length: rng.int(1, 6) }, (_, i) => ({ id: `cat/${i}`, name: rng.maybe(0.7, `Cat ${i}`), pricing: rng.maybe(0.6, () => ({ prompt: rng.pick([0, '0', 1e-6, '', null]), completion: rng.pick([0, '0', 2e-6, undefined]) })) })), 2]]);
  const options = clean({
    openRouterSource: rng.weighted([[null, 2], ['oauth', 3], ['env', 1], ['free', 1.5], [undefined, 1], ['weird', 0.2]]),
    openRouterConsentedAt: rng.maybe(0.5, () => rng.pick(['2026-10-01T00:00:00Z', null, ''])),
    deployInfo: makeDeployInfo(rng),
    currentModel: rng.weighted([[() => undefined, 1], [() => '', 1], [() => (avail.length ? rng.pick(avail).id : 'none'), 5], [() => 'custom/model-x', 1.5], [() => `x/${ESC}`, 0.5]]),
    availableModels: rng.maybe(0.9, avail),
    modelError: rng.maybe(0.15, () => rng.pick(['empty', 'too-long', 'invalid-format', 'unknown-code', ESC])),
    urlKey: urlKey === null && rng.chance(0.5) ? undefined : urlKey,
    workspaces: rng.maybe(0.9, () => makeWorkspaces(rng, urlKey)),
    featureFlags: rng.maybe(0.9, () => makeFeatureFlags(rng, deps)),
    workspaceFeatures: rng.maybe(0.8, () => Object.fromEntries(deps.WORKSPACE_FEATURE_KEYS.filter(() => rng.chance(0.8)).map(k => [k, rng.chance(0.5)]))),
    llmStats: rng.weighted([[() => undefined, 2], [() => null, 1], [() => ({}), 1], [() => ({ totalCalls: 0 }), 0.5], [() => clean({
      totalCalls: rng.int(1, 5000), totalTokens: rng.maybe(0.9, () => rng.int(0, 9e6)), totalCost: rng.pick([0, 0.0042, 1.5, 123.456, 'x', undefined]),
      byFeature: rng.maybe(0.9, () => Array.from({ length: rng.int(0, 4) }, (_, i) => ({ feature: rng.pick(['recommend', 'recap', ESC]), calls: rng.pick([1, 2, 30]), cost: rng.pick([0, 0.5, 3, null]) }))),
      lastCallAt: rng.maybe(0.6, () => new Date(nowMs - rng.int(0, DAY)).toISOString()),
      latencyByFeatureModel: rng.maybe(0.5, () => rng.pick([[], 'not-array', Array.from({ length: rng.int(1, 3) }, () => ({ feature: rng.pick(['recap', ESC]), model: rng.pick(['m1', ESC]), count: rng.pick([1, 4]), p50Ms: 120, p90Ms: 900, maxMs: 4000 }))]))
    }), 4]]),
    providerContextSummary: rng.weighted([[() => undefined, 2], [() => null, 0.5], [() => ({}), 1], [() => clean({ traces: rng.pick([0, 3, 40]), untracedContext: rng.maybe(0.7, () => rng.pick([0, 2, 5])), divergent: rng.maybe(0.6, 1), benign: rng.maybe(0.6, 1), newestUntracedContextAt: rng.maybe(0.5, '2026-10-13T00:00:00Z'), basis: rng.maybe(0.6, () => rng.pick(['last 30 days', ESC])) }), 3]]),
    providerBindings: rng.maybe(0.85, () => Array.from({ length: rng.int(0, 4) }, (_, i) => clean({ provider: rng.pick(['linear', 'github', 'local', 'jira', 'github-projects', ESC]), scope: rng.pick(['acme', `o/r${i}`, ESC, '']), displayName: rng.maybe(0.5, () => rng.pick(['Linear', ESC])), token: rng.maybe(0.7, () => rng.pick(['lin_api_abcdef1234', 'ab', ''])), active: rng.maybe(0.7, () => rng.chance(0.4)) }))),
    providerNotice: rng.maybe(0.25, () => clean({ type: rng.pick(['ok', 'fail', 'blocked', ESC]), text: text(rng), activate: rng.maybe(0.4, () => ({ provider: 'github', scope: `o/${ESC}` })) })),
    githubEnabled: rng.maybe(0.6, () => rng.chance(0.5)),
    jiraOAuthEnabled: rng.maybe(0.6, () => rng.chance(0.5)),
    dispatchDefaults: rng.maybe(0.8, () => clean({ ...dispatchRow(rng, deps), byKind: byKind(rng, deps, kinds) })),
    dispatchDefaultsError: rng.maybe(0.1, () => rng.pick(['invalid-field', 'other', ESC])),
    dispatchModelCatalog: rng.maybe(0.8, catalog),
    aiModelOverrides: rng.maybe(0.7, () => rng.pick([{}, { byKind: Object.fromEntries(deps.AI_OPERATION_KINDS.filter(() => rng.chance(0.25)).map(k => [k, clean({ model: rng.maybe(0.9, () => (avail.length && rng.chance(0.6) ? rng.pick(avail).id : `cust/${ESC}`)) })])) }])),
    aiOverridesError: rng.maybe(0.1, () => rng.pick(['invalid-format', 'too-long', 'x'])),
    dispatchPresets: rng.maybe(0.6, () => Array.from({ length: rng.int(0, 3) }, (_, i) => clean({ id: rng.pick([`p${i}`, `p"${i}<`, 'p-x']), name: rng.pick(['Fast', ESC, '']), config: rng.maybe(0.9, () => clean({ ...dispatchRow(rng, deps), byKind: byKind(rng, deps, kinds, 0.1) })) }))),
    accountEmails: rng.maybe(0.5, () => rng.pick([[], ['a@example.com'], ['a@example.com', `b+${ESC}@x.io`]]))
  });
  const env = rng.chance(0.2) ? rng.pick([{ EMAIL_TRANSPORT: 'capture', NODE_ENV: 'test' }, { EMAIL_TRANSPORT: 'console', NODE_ENV: 'development' }, { RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.c', EMAIL_LINK_ORIGIN: 'https://h.example' }, { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's', GITHUB_APP_SLUG: 'app' }]) : undefined;
  const wsName = rng.weighted([[undefined, 1], ['Acme', 4], [`WS ${ESC}`, 1], ['', 0.5]]);
  const argc = rng.weighted([[2, 9], [1, 0.5], [0, 0.2]]);
  return clean({ module: 'settings', export: 'renderSettingsPage', args: [wsName, options].slice(0, argc), env });
}
