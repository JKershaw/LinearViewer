/**
 * lib/task-facts-holder.js — the server-side holder of each workspace's issue set (LIN-4068 D4).
 *
 * `/state` and the task page need a task's subtree and must never wait on a provider (LIN-3324: a poll makes no provider
 * call). So the set is held here, one entry per workspace (`urlKey`), separate from `_workspaceIssuesMemo`. The holder
 * only ever holds a COMPLETE set, so completeness is decided once, at the write, and a partial set is never served.
 *
 * Three parts, kept apart so that a reader cannot reach a fetch:
 *  - `createTaskFactsHolder` — the holder. `write` applies the gate; `read` is read-only and answers `incomplete` with a
 *    reason when the set is cold or does not hold the task. It starts nothing.
 *  - `createTaskFactsRefresh` — the refresh trigger. Single-flight per workspace, rate-limited, and the only thing here
 *    that calls a provider. Its caller is the only holder of the workspace object and `accountId` it needs.
 *  - The write gate (`gateRefusalOf`): a set is written only when every binding was read (`degradeSecondary: false`
 *    rethrows a failed one), none was truncated, none was degraded, no team was applied, and no mock set was used.
 */

import { buildSubtreeIndex } from './subtree-index.js';
import { withInverseRelations } from './graph-features.js';

/** A complete set older than this is cold: a read answers `incomplete` and says why. */
export const SERVE_MAX_AGE_MS = 5 * 60 * 1000;
/** A refresh starts only once the entry is older than this, whatever the reason it was asked for. */
export const REFRESH_AFTER_MS = 2 * 60 * 1000;
/** Refresh attempts, failed ones included, are at least this far apart per workspace. */
export const ATTEMPT_FLOOR_MS = 60 * 1000;

/**
 * The write gate. Returns the reason a fetch result may not be held, or null when it may.
 *
 * `fetchAndPrepareProjects` returns `stateIssues` and writes nothing; its callers pass the result here. `selectedTeamId`
 * is the team the fetch actually applied (`matchTeamId` can drop a requested team to unscoped), not the one requested.
 *
 * @param {Object|null|undefined} fetched - `fetchAndPrepareProjects`'s result
 * @returns {string|null} 'no-set' | 'mock' | 'truncated' | 'degraded' | 'team', or null
 */
export function gateRefusalOf(fetched) {
  if (!fetched || !Array.isArray(fetched.stateIssues)) return 'no-set';
  if (fetched.stateMock) return 'mock';
  if (fetched.truncated) return 'truncated';
  if (Array.isArray(fetched.degradedSources) && fetched.degradedSources.length > 0) return 'degraded';
  if (fetched.selectedTeamId) return 'team';
  return null;
}

/**
 * The holder.
 *
 * @param {Object} [deps]
 * @param {Function} [deps.now] - () → epoch ms
 * @returns {{write: Function, read: Function, ageOf: Function}}
 */
export function createTaskFactsHolder({ now = () => Date.now() } = {}) {
  /** @type {Map<string, {issues: Array, index: Array, identifiers: Set<string>, fetchedAt: number}>} */
  const entries = new Map();

  /**
   * Hold a fetch result if it passes the gate. Writes nothing otherwise: an older complete entry stays and ages cold.
   * @param {string} urlKey
   * @param {Object} fetched - `fetchAndPrepareProjects`'s result
   * @param {{index?: Array|null}} [opts] - `index`: the index already built over `fetched.stateIssues` (Home's gather
   *   returns it as `roots`), reused instead of built a second time on the request path; built here when absent
   * @returns {{written: boolean, refusal: string|null}}
   */
  function write(urlKey, fetched, { index: prebuilt = null } = {}) {
    const refusal = gateRefusalOf(fetched);
    if (refusal || !urlKey) return { written: false, refusal: refusal || 'no-urlkey' };
    const index = prebuilt || withInverseRelations([buildSubtreeIndex(fetched.stateIssues)])[0];
    const identifiers = new Set();
    const visit = (node) => {
      identifiers.add(node.issue.identifier);
      node.children.forEach(visit);
    };
    index.forEach(visit);
    entries.set(urlKey, { issues: fetched.stateIssues, index, identifiers, fetchedAt: now() });
    return { written: true, refusal: null };
  }

  /** Milliseconds since the entry was written, or Infinity when there is none. */
  function ageOf(urlKey) {
    const entry = entries.get(urlKey);
    return entry ? now() - entry.fetchedAt : Infinity;
  }

  /**
   * Read-only. A complete set under 5 minutes old is served; otherwise the answer is `incomplete` with its reason:
   * `cold` (no entry, or older than 5 minutes) or `task-missing` (complete, but without the task).
   *
   * @param {string} urlKey
   * @param {{identifier?: string|null}} [opts]
   * @returns {{complete: true, issues: Array, index: Array, fetchedAt: number, ageMs: number}|{complete: false, reason: string}}
   */
  function read(urlKey, { identifier = null } = {}) {
    const entry = entries.get(urlKey);
    const age = ageOf(urlKey);
    if (!entry || age >= SERVE_MAX_AGE_MS) return { complete: false, reason: 'cold' };
    if (identifier && !entry.identifiers.has(identifier)) return { complete: false, reason: 'task-missing' };
    return { complete: true, issues: entry.issues, index: entry.index, fetchedAt: entry.fetchedAt, ageMs: age };
  }

  return { write, read, ageOf };
}

/**
 * The refresh trigger. Only a private route's caller holds one; it is never handed to a loader or a router that serves
 * a public or shared page (LIN-4068 B2).
 *
 * Starts a fetch only when the entry is absent or older than 2 minutes (the same age rule for a task-missing read), no
 * fetch is already in flight for the workspace (single-flight), and the last attempt was at least 60 s ago. A failed
 * attempt counts as an attempt. A failure logs and writes nothing.
 *
 * @param {Object} deps
 * @param {{write: Function, ageOf: Function}} deps.holder - `createTaskFactsHolder`'s holder
 * @param {Function} deps.fetchAndPrepareProjects - the server's fetch; called with the arguments the plan fixes
 * @param {Function} [deps.now] - () → epoch ms
 * @param {Function} [deps.onError]
 * @returns {({urlKey: string, workspace: Object, accountId: string|null}) => {started: boolean, reason: string, promise?: Promise<Object>}}
 */
export function createTaskFactsRefresh({
  holder, fetchAndPrepareProjects, now = () => Date.now(),
  onError = (message, err) => console.error(message, err),
}) {
  const inFlight = new Map();
  const lastAttemptAt = new Map();

  return function refresh({ urlKey, workspace, accountId = null }) {
    if (inFlight.has(urlKey)) return { started: false, reason: 'in-flight', promise: inFlight.get(urlKey) };
    if (holder.ageOf(urlKey) < REFRESH_AFTER_MS) return { started: false, reason: 'fresh' };
    const t = now();
    const last = lastAttemptAt.get(urlKey);
    if (last !== undefined && t - last < ATTEMPT_FLOOR_MS) return { started: false, reason: 'attempt-floor' };
    lastAttemptAt.set(urlKey, t);

    const promise = Promise.resolve()
      .then(() => fetchAndPrepareProjects(workspace, null, null, urlKey, { slim: true, accountId, degradeSecondary: false }))
      .then(
        (fetched) => holder.write(urlKey, fetched),
        (err) => {
          onError(`Task facts refresh failed for ${urlKey}:`, err);
          return { written: false, refusal: 'failed' };
        },
      )
      .finally(() => inFlight.delete(urlKey));
    inFlight.set(urlKey, promise);
    return { started: true, reason: 'started', promise };
  };
}
