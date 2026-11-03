/**
 * lib/key-state-holders.js — the registrations behind the one per-key reset (LIN-4168).
 *
 * `registerKeyStateHolders(keyState, instances)` is the only place that says which in-memory holders are kept per
 * workspace key and which caches are global. server.js builds the real instances and calls it once; the round-trip test
 * calls it with fresh instances from the same factories. Nothing else registers a holder.
 *
 * A holder added later and not registered here is caught by tests/unit/key-state-census.test.js, which scans for
 * in-memory containers and fails on any that is neither registered nor written down as a global-only exception or
 * another disposition.
 */

/** The harness marks a mock workspace with this token; the provider never sees it, so there is nothing to fetch. */
const MOCK_ACCESS_TOKEN = 'test-token';

/**
 * @typedef {Object} KeyStateInstances
 * @property {{holder: Object, refresh: Function}} taskFacts - createTaskFactsHolder's holder and createTaskFactsRefresh's refresh
 * @property {Object} workspaceIssuesMemo - createWorkspaceIssuesMemo
 * @property {Object} sessionsFeedCache - createSessionsFeedCache (the server's singleton)
 * @property {{dashboard: Object, dispatchGuard: Object}} taskDoneCaches - createTaskDoneCache instances, one per owner
 * @property {Object} workspaceTokenCache - createWorkspaceTokenCache
 * @property {Object} rejectedCredentialRegistry - createRejectedCredentialRegistry
 * @property {Object} refreshOnResolveGate - createRefreshOnResolveGate
 */

/**
 * Register every in-memory per-key holder and every global-only exception on `keyState`.
 * @param {ReturnType<import('./key-state.js').createKeyState>} keyState
 * @param {KeyStateInstances} instances
 */
export function registerKeyStateHolders(keyState, instances) {
  const { taskFacts, workspaceIssuesMemo, sessionsFeedCache, taskDoneCaches, workspaceTokenCache, rejectedCredentialRegistry, refreshOnResolveGate } = instances;

  // Task facts: cleared, then refilled from the new seed (LIN-4110). The refill runs after every clear and after the seam
  // has finished seeding, so it reads the new seed and never the old one. A mock workspace is never refilled: its set is
  // refused by the write gate (`mock`), so the fetch would be wasted on every mock seam call (LIN-4168 D5).
  keyState.holder({
    name: 'task-facts',
    async clear({ urlKey }) {
      const pending = taskFacts.refresh.inFlightFor(urlKey);
      if (pending) await pending.catch(() => {});
      taskFacts.holder.invalidate(urlKey);
      taskFacts.refresh.forget(urlKey);
    },
    async refill({ urlKey, workspace, accountId = null }) {
      if (!workspace || workspace.accessToken === MOCK_ACCESS_TOKEN) return;
      const started = taskFacts.refresh({ urlKey, workspace, accountId, urgent: true });
      if (started.promise) await started.promise;
      taskFacts.refresh.forget(urlKey);
    },
    probe: ({ urlKey }) => (taskFacts.holder.ageOf(urlKey) === Infinity ? 0 : 1),
  });

  keyState.holder({
    name: 'workspace-issues-memo',
    clear: (ctx) => workspaceIssuesMemo.clear(ctx),
    probe: (ctx) => workspaceIssuesMemo.countFor(ctx),
  });

  keyState.holder({
    name: 'sessions-feed',
    clear: ({ urlKey }) => sessionsFeedCache.clear(urlKey),
    probe: ({ urlKey }) => sessionsFeedCache.countFor(urlKey),
  });

  // Two instances of the touched-task done cache. Both are keyed `${urlKey}::${identifier}`, so both are per key.
  keyState.holder({
    name: 'task-done:dashboard',
    clear: ({ urlKey }) => taskDoneCaches.dashboard.clear(urlKey),
    probe: ({ urlKey }) => taskDoneCaches.dashboard.countFor(urlKey),
  });
  keyState.holder({
    name: 'task-done:dispatch-guard',
    clear: ({ urlKey }) => taskDoneCaches.dispatchGuard.clear(urlKey),
    probe: ({ urlKey }) => taskDoneCaches.dispatchGuard.countFor(urlKey),
  });

  // Keyed `${urlKey}::${owner|*}`. A session can reach it under a key the same worker used for another provider a moment
  // earlier (resolveWorkspaceAccess serves a cached token for up to 30 s), so it is per-key state, not a credential exception.
  keyState.holder({
    name: 'workspace-token',
    clear: ({ urlKey }) => workspaceTokenCache.clearUrlKey(urlKey),
    probe: ({ urlKey }) => workspaceTokenCache.countFor(urlKey),
  });

  // Refresh cooldowns keyed by `${ownerAccountId}:${urlKey}` (LIN-1980, LIN-2097). Reachable from every seam that seeds an
  // expired or rejected credential on the key.
  keyState.holder({
    name: 'rejected-credentials:scope-attempts',
    clear: ({ urlKey }) => rejectedCredentialRegistry.forgetScopesFor(urlKey),
    probe: ({ urlKey }) => rejectedCredentialRegistry.scopeAttemptsFor(urlKey),
  });
  keyState.holder({
    name: 'refresh-on-resolve:cooldown',
    clear: ({ urlKey }) => refreshOnResolveGate.forgetUrlKey(urlKey),
    probe: ({ urlKey }) => refreshOnResolveGate.countFor(urlKey),
  });

  // Caches that can only be cleared globally. Each is keyed by something other than a workspace key, so a per-key reset
  // cannot reach it sensibly, and each says what clears it.
  const global = (name, why, clearedBy) => keyState.globalOnly({ name, why, clearedBy });
  // Known gap, carried from the plan: the seams do not reset the comment dedupe. Its generation tracker is per workspace key,
  // but the dedupe entries it tags are hashed, so the only clear is the global one below.
  global('comment-dedupe', 'Keyed by a hash of the comment body and the workspace generation tag. Entries are hashed, so they cannot be tied to one workspace (lib/proxy-dedupe.js, both the entries and the generation tracker).', '/test/clear-comment-dedupe');
  global('decision-stamp-dedupe', 'Keyed by a hash of the ruling, so an entry cannot be tied to one workspace (lib/proxy-dedupe.js).', '/test/clear-comment-dedupe');
  global('proxy-credential-trail', 'Feeds one diagnostic log line (`[credential-rejected]`) and changes no behaviour. Bounded by RESOLUTION_TRAIL_LIMIT (lib/proxy-credential-trail.js).', 'LRU bound');
  // Known gap: these are keyed by installation id, or by `${workspaceId}|${repo}`. The reset does not clear them, so a
  // connection-backed spec that changes installations within the lookup TTL can read the previous answer. Revisit with the
  // connection-backed seams (LIN-4168 report).
  global('connection-credential-caches', 'Installation token, lookup, mint-failure and single-flight caches keyed by installation id or `${workspaceId}|${repo}` (lib/connection-credential.js). Known gap: the reset does not clear them.', 'TTL');
  global('observation-materializer-inflight', 'Single-flight rebuild registry keyed per workspace. It is in-flight work, and clearing it would abandon a running rebuild (lib/observation-sessions-materializer.js).', 'settles on its own');
  global('pr-status-chat-cache', 'Keyed by (repo, number, sha), 60 s TTL. A chat tool catalog is built per call site and starts cold (lib/chat-tools.js).', '60 s TTL');
  global('ci-wake-sweep-backoff', 'Lineage-keyed back-off for a server sweep. The sweep is inert without a configured base URL, and no seam seeds a lineage (lib/ci-wake-sweep.js).', 'process restart');
  global('rate-limiters', 'express-rate-limit memory stores keyed by client IP, not workspace (routes/email-auth.js and the per-IP limiters). Process-lifetime; the test skip disables them.', 'window expiry; process restart');
  global('rejected-credentials:fingerprint-maps', 'Keyed by credential fingerprint, not workspace: entries, rejection counts, supersessions and witnesses (lib/rejected-credentials.js). Known gap: a fingerprint shared by two keys is shared state.', 'TTL; LRU limit');
  global('runner-kit-cache', 'Static runner-kit files read from disk, keyed by file name (routes/runner-kit.js).', 'process restart');
  global('pr-status-fail-open', 'Keyed by repo and PR number, not workspace (lib/github-pr-status.js).', '/test/clear-pr-status');
  global('pr-status-seeded', 'Keyed by repo and PR number, not workspace (lib/github-pr-status.js).', '/test/clear-pr-status');
  global('pr-state-shared', 'Keyed by repo and PR number, not workspace (lib/pr-state-store.js).', '/test/clear-pr-status');
  global('kpi-cache', 'Instance-wide aggregates over every workspace (lib/kpi-page.js).', 'resetKpiCache (routes/test.js, /test/clear-kpi-rollup)');
  global('yap-buffers', 'A fake chat server keyed by channel name, not workspace (routes/test.js).', '/test/yap/clear');
  global('library-cache', 'Static content read from disk, keyed by file, not workspace (lib/library.js).', 'process restart');
  global('github-pr-files-cache', 'Keyed by repo and PR number, not workspace (lib/github-pr-files.js).', 'TTL');
  global('provider-registry', 'Process configuration: the registered provider singletons (providers/registry.js).', 'process restart');
  global('workspace-token-refresh-inflight', 'In-flight refresh work keyed `owner::urlKey::provider`. It is not state, and clearing it would abandon a running refresh (lib/workspace-token-refresh.js).', 'settles on its own');
  global('connection-refresh-inflight', 'In-flight refresh keyed by connection id (lib/connection-credential.js). It is not state.', 'settles on its own');
  global('task-share-cache', 'Keyed by share token, 5 s TTL, one entry per public share page (routes/task-share.js). /test/clear-task-shares removes the links.', '5 s TTL; /test/clear-task-shares');
  global('process-lifetime-memos', 'Process-lifetime dedupe, timers and identity-keyed WeakMaps. None is keyed by workspace (unpriced-models, pipeline-loops, scheduler, connection-binding, run-controls).', 'process restart');
}
