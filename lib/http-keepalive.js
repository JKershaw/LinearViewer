/**
 * Keep a slow response alive behind Heroku's router: 30s from when the ROUTER took
 * the request to the first response byte (H12), then a rolling 55s between bytes
 * (H15). One module, one cadence, two framings: JSON whitespace (armKeepalive) and
 * SSE comment lines (armSseKeepalive). clientGoneSignal turns a client hang-up into
 * an abort, so a dropped request stops paying for model calls.
 *
 * JSON usage:
 *   const keepalive = armKeepalive(res);
 *   try {
 *     keepalive.send(200, await slowWork());
 *   } catch (err) {
 *     keepalive.send(503, { error: 'AI unavailable' });
 *   }
 *
 * send() stops the keep-alive itself, and so does the response's `close`. Call
 * stop() only to reply on res directly instead.
 *
 * If the handler hasn't responded by the first-byte target, armKeepalive commits
 * HTTP 200 + JSON Content-Type with one space, then a space every intervalMs.
 * JSON.parse ignores the whitespace, so JSON clients stay compatible. Once
 * flushed, the HTTP status is committed: errors ride in the body with a logical
 * `statusCode` field (send() does this).
 */

/** The first byte goes out this long after the router received the request. */
export const FIRST_BYTE_TARGET_MS = 20_000;
/** Gap between keep-alive bytes, well inside the router's 55s window. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** Without a router stamp the first byte goes out this long after arming (the old rule). */
const FALLBACK_DELAY_MS = 25_000;
const STALE_STAMP_MS = 60_000;

/**
 * When the router received this request, from its X-Request-Start header (Heroku:
 * epoch milliseconds; nginx-style `t=<seconds>`; microseconds), or null when absent
 * or implausible (in the future, or older than a minute).
 * @param {{get: Function}|undefined} req
 * @param {number} [now]
 * @returns {number|null}
 */
export function requestArrivedAt(req, now = Date.now()) {
  const raw = typeof req?.get === 'function' ? req.get('x-request-start') : undefined;
  if (typeof raw !== 'string') return null;
  const value = Number(raw.trim().replace(/^t=/, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  const ms = value >= 1e15 ? value / 1000 : value >= 1e12 ? value : value * 1000;
  const elapsed = now - ms;
  if (elapsed < 0 || elapsed > STALE_STAMP_MS) return null;
  return Math.round(ms);
}

function writeQuietly(res, chunk) {
  if (res.writableEnded || res.destroyed) return;
  try { res.write(chunk); } catch { /* client disconnected */ }
}

/**
 * Arm the JSON keep-alive. The first byte is due FIRST_BYTE_TARGET_MS after the
 * request arrived (read through Express's res.req), never later than `delayMs`
 * after arming; with no router stamp it is `delayMs` after arming.
 * @param {import('express').Response} res
 * @param {{delayMs?: number, intervalMs?: number, firstByteMs?: number}} [options]
 */
export function armKeepalive(res, { delayMs = FALLBACK_DELAY_MS, intervalMs = HEARTBEAT_INTERVAL_MS, firstByteMs = FIRST_BYTE_TARGET_MS } = {}) {
  const state = { flushed: false, interval: null };
  const now = Date.now();
  const arrived = requestArrivedAt(res.req, now);
  const delay = arrived == null ? delayMs : Math.max(0, Math.min(delayMs, firstByteMs - (now - arrived)));

  const stop = () => {
    clearTimeout(kick);
    if (state.interval) clearInterval(state.interval);
  };
  const kick = setTimeout(() => {
    // A reply already made on res directly (an early return) keeps its own status.
    if (res.headersSent || res.writableEnded || res.destroyed) return;
    state.flushed = true;
    res.status(200);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.flushHeaders();
    writeQuietly(res, ' ');
    state.interval = setInterval(() => writeQuietly(res, ' '), intervalMs);
  }, delay);
  // Finished or abandoned, the response needs no more bytes.
  if (typeof res.once === 'function') res.once('close', stop);

  return {
    get flushed() { return state.flushed; },
    /** Commit to replying now, on res directly. send() does this itself. */
    stop,
    send(status, body) {
      stop();
      if (state.flushed) {
        const payload = status === 200 ? body : { ...body, statusCode: status };
        res.end(JSON.stringify(payload));
      } else {
        res.status(status).json(body);
      }
    }
  };
}

/**
 * Arm the SSE keep-alive on a stream whose headers are already flushed: an SSE
 * comment line every intervalMs. EventSource and window.readSSEStream skip
 * comment lines, so clients see nothing.
 * @param {import('express').Response} res
 * @param {{intervalMs?: number}} [options]
 */
export function armSseKeepalive(res, { intervalMs = HEARTBEAT_INTERVAL_MS } = {}) {
  const interval = setInterval(() => writeQuietly(res, ': keepalive\n\n'), intervalMs);
  return { stop() { clearInterval(interval); } };
}

/**
 * An AbortSignal that fires when the client goes away before the response has
 * finished (the connection's `close` with the response unfinished). Thread it into
 * model calls only: work that must not be left half-done (an enqueue) checks
 * `gone` before it starts and is never aborted once started. A client that left
 * before the signal was armed (during the handler's earlier awaits) is gone at once.
 * @param {import('express').Response} res
 * @returns {{signal: AbortSignal, readonly gone: boolean, release: Function}}
 */
export function clientGoneSignal(res) {
  const controller = new AbortController();
  const onClose = () => { if (!res.writableFinished) controller.abort(); };
  const listens = typeof res?.on === 'function';
  if (res?.destroyed && !res.writableFinished) controller.abort();
  else if (listens) res.on('close', onClose);
  return {
    signal: controller.signal,
    get gone() { return controller.signal.aborted; },
    release() { if (listens) res.off('close', onClose); }
  };
}
