/**
 * The hold-open read's wait loop, one copy (LIN-4560; the loop is LIN-392's, its change token LIN-3812's).
 *
 * `GET /api/proxy/dispatch/:id?wait=Ns` (routes/proxy-dispatch.js, a driving session's watch) and its signed-in twin
 * `GET /workspace/:urlKey/api/dispatch/transcripts?wait=Ns` (routes/dispatch.js, the run page's and Dispatch history's
 * live transcripts) both hold a request open until what they read changes. This is the loop they share; each route keeps
 * its own first read, its own short-circuits and its own response shape.
 *
 * The loop, as LIN-392 and LIN-3812 built it: sleep one tick; stop if the client went away; read the cheap change token
 * and go round again when it has not moved; when it moved, re-read the body (the body, not the token, decides "change");
 * a body that is gone mid-wait ends the hold with the last known snapshot. It returns at the first change or at the
 * deadline, saying which (`reason` 'change' | 'timeout') and how long it held (`waitedMs`).
 */

/** The longest hold a caller may ask for (below the ~60s that armKeepalive's 25s flush buys past Heroku's 30s H12). */
export const DISPATCH_WAIT_MAX_S = 50;
/** The re-check interval, which bounds the worst-case detection latency. */
export const DISPATCH_WAIT_POLL_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `?wait=` as seconds: garbage or non-positive is 0 (no hold), anything else is capped at `max`. */
export function clampWaitSeconds(raw, max = DISPATCH_WAIT_MAX_S) {
  return Math.min(Math.max(0, Math.floor(Number(raw)) || 0), max);
}

/**
 * Hold until the read changes or the window ends.
 *
 * @param {object} o
 * @param {*} o.initial - the snapshot the caller already read (returned unchanged on a timeout)
 * @param {*} o.token - the change token read BEFORE `initial` (so a change between the two reads is re-checked)
 * @param {number} o.waitSeconds - the window, already clamped
 * @param {() => Promise<*>} o.readToken - the cheap change token
 * @param {() => Promise<*>} o.readSnapshot - the body; null when it is gone
 * @param {(snapshot: *) => boolean} o.changed - true when this snapshot is a change the caller returns for
 * @param {() => boolean} [o.isGone] - true when the client has gone away
 * @param {number} [o.pollMs]
 * @returns {Promise<{aborted: true} | {current: *, reason: 'change'|'timeout', waitedMs: number}>}
 */
export async function holdForChange({ initial, token, waitSeconds, readToken, readSnapshot, changed, isGone = () => false, pollMs = DISPATCH_WAIT_POLL_MS }) {
  const waitStart = Date.now();
  const deadline = waitStart + waitSeconds * 1000;
  let current = initial;
  let watchToken = token;
  let reason = 'timeout'; // default: held the full window, nothing new
  while (Date.now() < deadline) {
    await sleep(pollMs);
    if (isGone()) return { aborted: true };
    // A fault here propagates to the caller (LIN-3805: never swallowed into "unchanged"). Scalars only per tick; the
    // body is re-read only when the token moved (LIN-3812).
    const nextToken = await readToken();
    if (nextToken === watchToken) continue;
    watchToken = nextToken;
    const next = await readSnapshot();
    if (!next) break; // gone mid-wait: return the last known snapshot
    current = next;
    if (changed(current)) { reason = 'change'; break; }
  }
  return { current, reason, waitedMs: Date.now() - waitStart };
}
