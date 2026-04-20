/**
 * Defuse Heroku's 30s router timeout (H12) on long-running handlers.
 *
 * If the handler hasn't responded within `delayMs`, flush HTTP 200 + JSON
 * Content-Type and start a single-space heartbeat every `intervalMs`.
 * JSON.parse ignores interior whitespace, so existing JSON clients stay
 * compatible. Once flushed, HTTP status is committed; errors must ride in
 * the body with a logical `statusCode` field.
 *
 * Usage:
 *   const keepalive = armKeepalive(res);
 *   try {
 *     const result = await slowWork();
 *     keepalive.stop();
 *     keepalive.send(200, result);
 *   } catch (err) {
 *     keepalive.stop();
 *     keepalive.send(503, { error: 'AI unavailable' });
 *   }
 */
export function armKeepalive(res, { delayMs = 25_000, intervalMs = 15_000 } = {}) {
  const state = { flushed: false, interval: null };

  const kick = setTimeout(() => {
    state.flushed = true;
    res.status(200);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.flushHeaders();
    state.interval = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      try { res.write(' '); } catch { /* client disconnected */ }
    }, intervalMs);
  }, delayMs);

  return {
    get flushed() { return state.flushed; },
    stop() {
      clearTimeout(kick);
      if (state.interval) clearInterval(state.interval);
    },
    send(status, body) {
      if (state.flushed) {
        const payload = status === 200 ? body : { ...body, statusCode: status };
        res.end(JSON.stringify(payload));
      } else {
        res.status(status).json(body);
      }
    }
  };
}
