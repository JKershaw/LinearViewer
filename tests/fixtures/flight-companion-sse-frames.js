/**
 * tests/fixtures/flight-companion-sse-frames.js — LIN-2620 / LIN-2453.
 *
 * A single frame-rendering helper shared by the unit suite (which asserts it
 * byte-for-byte against lib/sse.js's real `sendSSE`) and the e2e suite's
 * `mockTurn` (tests/e2e/flight-companion.spec.js), so the browser's mocked
 * SSE body can never drift from the wire format the real proxy/session route
 * actually emits. Before this fixture, `mockTurn` hand-authored its frame
 * string independently of `sendSSE` — nothing checked the two matched
 * (LIN-2453's named gap). Now both render through the SAME function.
 *
 * The format itself is `sendSSE`'s (lib/sse.js): `event: <type>\ndata:
 * <json>\n\n` per frame, concatenated with no separator (the trailing blank
 * line of one frame IS the leading edge of the next).
 */

/**
 * Render one SSE frame in the exact shape `sendSSE(res, type, data)` writes.
 * @param {string} type
 * @param {*} data
 * @returns {string}
 */
export function renderSSEFrame(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Render a sequence of `[type, data]` pairs into one SSE response body.
 * @param {Array<[string, *]>} frames
 * @returns {string}
 */
export function renderSSEFrames(frames) {
  return frames.map(([type, data]) => renderSSEFrame(type, data)).join('');
}
