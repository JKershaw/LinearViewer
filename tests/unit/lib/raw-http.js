/**
 * A raw HTTP/1.0 request with no Host header, through a real Express app on a
 * loopback socket (LIN-3931). HTTP/1.1 requires Host, and Node answers a Host-less
 * 1.1 request with an empty 400 before Express runs, so HTTP/1.0 is the only wire
 * form that reaches a route without one. Same idea as the helper in
 * tests/unit/feedback-route.test.js, shared here so more than one file can use it.
 *
 * A plain (non-`.test.js`) module on purpose: importing a `.test.js` file from
 * another test re-registers its tests under Node's per-file runner.
 */
import { connect } from 'node:net';

/**
 * @param {import('express').Express} app
 * @param {string} method
 * @param {string} path
 * @param {{ body?: unknown, headers?: Record<string, string> }} [options]
 * @returns {Promise<{ status: number, contentType: string|null, body: unknown }>}
 */
export async function requestWithoutHost(app, method, path, { body, headers = {} } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const payload = body === undefined ? '' : JSON.stringify(body);
  const allHeaders = {
    Authorization: 'Bearer anything',
    ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) }),
    ...headers,
  };
  const head = [`${method.toUpperCase()} ${path} HTTP/1.0`, ...Object.entries(allHeaders).map(([k, v]) => `${k}: ${v}`)].join('\r\n');
  try {
    const raw = await new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => socket.write(`${head}\r\n\r\n${payload}`));
      let data = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => { data += chunk; });
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    const split = raw.indexOf('\r\n\r\n');
    const headText = raw.slice(0, split);
    const text = raw.slice(split + 4);
    const status = Number(headText.split(' ')[1]);
    const contentType = /^content-type:\s*(.*)$/mi.exec(headText)?.[1]?.trim() ?? null;
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status, contentType, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
