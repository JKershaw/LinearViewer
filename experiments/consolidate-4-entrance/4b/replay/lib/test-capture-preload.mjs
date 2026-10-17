// --import preload for one unit-test process: records every HTTP request any
// in-process http.Server receives on one of the three routers' URL forms
// (method, URL, auth/host shape, the JSON body express parsed, status), and
// blocks non-loopback sockets. Written to $REPLAY_CAPTURE_OUT at exit.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { routeKeyFor } from './edge.mjs';

const file = process.env.REPLAY_CAPTURE_FILE;
const calls = [];
const escapes = [];
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) ? args[0] : Array.isArray(args[0]) ? args[0][0] : { port: args[0], host: args[1] };
  const host = o?.host ?? o?.hostname;
  if (!(typeof o?.path === 'string' || host === undefined || host === '127.0.0.1' || host === '::1' || host === 'localhost')) { escapes.push(String(host)); throw new Error('capture: blocked non-loopback connect'); }
  return origConnect.apply(this, args);
};
const origEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function (ev, req, res) {
  if (ev === 'request' && req && res) {
    res.once('finish', () => {
      try {
        const url = req.originalUrl || req.url;
        const pathname = new URL(url, 'http://x').pathname.replace(/^\/workspace\/[^/]+\//, '/workspace/acme/');
        if (!routeKeyFor(req.method, pathname)) return;
        let body;
        try { body = req.body === undefined ? undefined : JSON.parse(JSON.stringify(req.body)); } catch { body = undefined; }
        if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0 && !/^(POST|PATCH|DELETE)$/.test(req.method)) body = undefined;
        calls.push({ file, method: req.method, url, hasAuth: typeof req.headers.authorization === 'string', host: req.headers.host, body, status: res.statusCode });
      } catch { /* never disturb the test */ }
    });
  }
  return origEmit.apply(this, arguments);
};
process.on('exit', () => {
  try { fs.writeFileSync(process.env.REPLAY_CAPTURE_OUT, JSON.stringify({ file, calls, escapes })); } catch { /* ignore */ }
});
