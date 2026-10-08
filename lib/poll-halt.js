/**
 * Bounded workspace-halt read shared by the consumer poll routes (LIN-3024,
 * LIN-3130).
 *
 * Extracted verbatim from `routes/dispatch.js` as the S2a refactor-only
 * prerequisite so `GET /api/dispatch/poll` and the runner poll share one read
 * rather than forking it. No behaviour change: the bounds, the degrade-to-
 * last-known-cache rule and the projected `{ mode, setAt, setBy }` shape are
 * exactly what the dispatch poll already had.
 */

// LIN-3024 (LIN-2994 Surface 2): default bound for the poll handler's halt
// read, independent of `maxTimeMS` (nothing sets that yet, LIN-2997) and well
// below Simple Dispatcher's own 15s client timeout. Overridable per factory
// call (`haltReadTimeoutMs`) so tests can inject a short bound instead of
// waiting out the production value.
export const POLL_HALT_READ_TIMEOUT_MS = 1500;

// Bounds `promise` with a local timeout, in the same withTimeout idiom used
// elsewhere: reject on the timer, but always clear it so an
// already-won race doesn't keep the event loop (or a test process) alive.
// This does NOT cancel `promise` itself — the underlying store read keeps
// running to completion in the background (accepted residual, LIN-2997).
function raceWithLocalTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('workspace halt read timed out')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Projects a raw workspace-halt document (which carries a Mongo `_id`) to
// the poll response's contract shape. `doc` is `null` when unset. Exported
// because the session-authed halt read route reuses this one projection too.
export function projectHaltForPoll(doc) {
  if (!doc) return null;
  const { mode, setAt, setBy } = doc;
  return { mode, setAt, setBy };
}

// LIN-3024's bounded halt read for the poll handler. Never throws: a missing
// store, a timeout, or a store-read failure all degrade to the shared
// store's synchronous last-known cache (null on a cold cache), so a halt
// read can never turn the poll into a non-2xx response.
export async function readHaltForPoll(workspaceHaltStore, urlKey, timeoutMs) {
  if (!workspaceHaltStore) return null;
  try {
    const doc = await raceWithLocalTimeout(workspaceHaltStore.getWorkspaceHalt(urlKey), timeoutMs);
    return projectHaltForPoll(doc);
  } catch {
    return workspaceHaltStore.getLastKnownHalt(urlKey);
  }
}
