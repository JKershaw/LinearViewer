/**
 * lib/sse.js — the one server-sent-events frame writer (LIN-2631 item 2).
 *
 * Three byte-identical copies of this four-line function existed
 * (`routes/flight-companion.js`, `routes/task-chat.js`,
 * `routes/workspace-api-roadmap.js`), and LIN-2620's proxy turn endpoint was
 * about to add a fourth. Four copies of a wire format is how one of them
 * quietly stops matching the others.
 *
 * The format is not arbitrary and is what the copies were at risk of drifting
 * on: `event: <type>` then `data: <json>` then a BLANK LINE. The blank line is
 * the frame terminator — without it the browser's EventSource buffers
 * indefinitely and the client sees nothing at all rather than an error.
 */

/**
 * Write one SSE frame.
 *
 * @param {import('express').Response} res - the streaming response
 * @param {string} type - the event name
 * @param {*} data - JSON-serialisable payload
 */
export function sendSSE(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
