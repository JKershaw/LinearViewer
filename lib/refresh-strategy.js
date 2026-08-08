/**
 * The provider-declared credential-refresh strategy (LIN-1887, Step 1).
 *
 * ## Why this exists
 *
 * Before this module, server.js asked "how do I refresh this workspace?" in TWO
 * places with two different answers:
 *
 *   - `ensureValidToken` (proactive, 5-minute buffer): github-family → re-mint;
 *     **everything else** → Linear's refresh_token exchange.
 *   - `handleUnauthorizedError` (reactive, on a 401): its own ladder, whose
 *     fallthrough is `handleWorkspaceRemoval`.
 *
 * "Everything else → Linear" is the defect class: a provider that is neither
 * github-family nor Linear is routed into Linear's exchange, fails, and is
 * *deleted*. LIN-1499 fixed it once for github-projects by adding a name to the
 * proactive guard; LIN-1885 fixed it once for Jira by adding a branch to the
 * reactive one. Both were the same bug, and neither made the next one
 * impossible. One declaration read by both dispatches does.
 *
 * ## The declaration
 *
 * - `remint` — the credential is MINTED from durable app-level config
 *   (github-family: App JWT + `installationId`). Idempotent, no spent-token
 *   hazard.
 * - `oauth-refresh` — the credential is EXCHANGED for a new one using a rotating
 *   refresh token held in the durable owner-credential store.
 * - `none` — nothing to refresh. **The fail-safe default**: do not refresh, do
 *   not remove the workspace, do not touch the session; render an actionable
 *   re-link page instead. A provider that is added to the tree without being
 *   declared here gets this, so the "silently routed into Linear's exchange and
 *   deleted" failure mode is now structurally unreachable rather than merely
 *   tested-for.
 *
 * ## `destructiveOnFailure` — the second axis, and why it is not folded in
 *
 * `strategy` answers *how* to refresh. `destructiveOnFailure` answers what a
 * FAILED refresh means, and the two genuinely differ: Linear and Jira are both
 * `oauth-refresh`, but a Linear workspace with no refreshable credential IS a
 * disconnected workspace (Linear is the workspace's reason to exist, and its
 * removal-on-failure behaviour is load-bearing and stays byte-for-byte), whereas
 * a Jira binding is ONE binding on an otherwise multi-provider workspace.
 * Removing the workspace because Jira's token could not be refreshed deletes the
 * co-resident Linear binding with it — the same user-visible outcome LIN-1887's
 * F1/G1 exist to prevent, reached by a different route. `handleUnauthorizedError`
 * already states this rationale for the reactive path (LIN-1885, `server.js`);
 * the rationale is independent of *which* dispatch asks, so it is declared once
 * here and honoured by both.
 *
 * ## Normalisation
 *
 * The lookup normalises `(workspace?.provider || 'linear')` BEFORE the table
 * read, via `normalizeProvider`. A table keyed on the raw `workspace.provider`
 * with an undeclared-default would route every LEGACY providerless workspace to
 * `none` — a silent, total breakage of the oldest population in the tree, and a
 * one-character-looking choice.
 */
import { normalizeProvider, getWorkspaceCallScope } from './workspace.js';

/** The three strategies, as values rather than bare string literals at call sites. */
export const REFRESH_STRATEGY = Object.freeze({
  REMINT: 'remint',
  OAUTH_REFRESH: 'oauth-refresh',
  NONE: 'none',
});

/**
 * The single provider → refresh declaration table. Keyed on NORMALIZED provider
 * names (so a legacy providerless workspace reads the `linear` row).
 */
const PROVIDER_REFRESH_DECLARATIONS = Object.freeze({
  // Linear: the rotating refresh_token exchange, and the only provider whose
  // failed refresh legitimately tears the workspace down (LIN-1545's
  // definitive-revocation gate still narrows WHICH failures count).
  linear: { strategy: REFRESH_STRATEGY.OAUTH_REFRESH, destructiveOnFailure: true },
  // GitHub family: installation tokens carry no refresh_token — they are
  // re-minted from the App JWT + installationId (LIN-712/LIN-1499).
  github: { strategy: REFRESH_STRATEGY.REMINT, destructiveOnFailure: true },
  'github-projects': { strategy: REFRESH_STRATEGY.REMINT, destructiveOnFailure: true },
  // Jira: `oauth-refresh` from LIN-1887 Step 5 (before Step 5 there is no Jira
  // OAuth binding to refresh, and Phase 1's Basic credential carries a
  // MAX_SAFE_INTEGER expiry so it never reaches a refresh dispatch at all).
  // Non-destructive per the LIN-1885 rationale above.
  jira: { strategy: REFRESH_STRATEGY.OAUTH_REFRESH, destructiveOnFailure: false },
  // Local: Mango-backed, its "token" is the store partition key. Nothing to
  // refresh and nothing to revoke.
  local: { strategy: REFRESH_STRATEGY.NONE, destructiveOnFailure: false },
});

/** The fail-safe declaration for a provider that declares nothing. */
const UNDECLARED = Object.freeze({ strategy: REFRESH_STRATEGY.NONE, destructiveOnFailure: false });

/**
 * This workspace's refresh declaration.
 * @param {import('./workspace.js').Workspace} [workspace]
 * @returns {{strategy: string, destructiveOnFailure: boolean}}
 */
export function refreshDeclarationFor(workspace) {
  return PROVIDER_REFRESH_DECLARATIONS[normalizeProvider(workspace)] || UNDECLARED;
}

/**
 * This workspace's refresh strategy — `remint` | `oauth-refresh` | `none`.
 * @param {import('./workspace.js').Workspace} [workspace]
 * @returns {string}
 */
export function refreshStrategyFor(workspace) {
  return refreshDeclarationFor(workspace).strategy;
}

/**
 * The non-destructive "this credential is no longer usable, re-link it" notice —
 * the response BOTH dispatches render instead of removing a workspace they must
 * not remove (LIN-1887 G3).
 *
 * Provider-parameterised because the copy is not generic: the pre-LIN-1887
 * response was Jira's, hard-coded, and routing a `local` workspace to it would
 * tell the user to "Reconnect Jira" — a worse failure than the one it replaces.
 * Jira's Basic-auth copy is reproduced byte-for-byte because LIN-1885's own
 * behaviour tests assert on it and the Phase 1 Basic path is unchanged by this
 * ticket.
 *
 * @param {import('./workspace.js').Workspace} workspace
 * @returns {{title: string, message: string, action: string, actionUrl: string}}
 */
export function relinkNotice(workspace) {
  const urlKey = workspace?.urlKey;
  const settingsUrl = `/workspace/${encodeURIComponent(urlKey)}/settings`;

  if (normalizeProvider(workspace) === 'jira') {
    const scope = getWorkspaceCallScope(workspace);
    const jiraUrl = `/auth/jira?workspace=${encodeURIComponent(urlKey)}`;
    if (scope?.authType === 'oauth') {
      return {
        title: 'Access Token Invalid',
        message: 'Your Jira connection is no longer valid. Reconnect Jira to continue.',
        action: 'Reconnect Jira',
        actionUrl: `/auth/jira/oauth?mode=add-source&workspace=${encodeURIComponent(urlKey)}`,
      };
    }
    return {
      title: 'Access Token Invalid',
      message: 'Your Jira API token is no longer valid. Reconnect Jira with a fresh API token to continue.',
      action: 'Reconnect Jira',
      actionUrl: jiraUrl,
    };
  }

  return {
    title: 'Connection Invalid',
    message: 'This workspace\'s connection is no longer valid. Reconnect it from Settings to continue.',
    action: 'Go to settings',
    actionUrl: settingsUrl,
  };
}
