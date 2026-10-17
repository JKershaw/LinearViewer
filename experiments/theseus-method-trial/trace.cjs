// Preload for the read trace (inherited by every node child through NODE_OPTIONS).
// 1. Logs every test-side TEXT read (readFileSync / readFile / promises.readFile / createReadStream)
//    of a root-level .js file in the export, with the test file that ran it. Paths are normalised
//    with path.resolve, so './x', 'a//x.js' and absolute spellings all count (the essay's doubled
//    slash miss). require() itself does not go through these APIs, so imports are not logged.
// 2. Guards the network: any socket connect to a non-loopback host, and any DNS lookup of a
//    non-localhost name, is refused and logged as an escape.
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const dns = require('dns');
const ROOT = process.env.TRACE_ROOT;
const LOG = process.env.TRACE_LOG;
const append = fs.appendFileSync.bind(fs);
const who = path.relative(ROOT, process.argv[1] || '?');
function log(rec) { try { append(LOG, JSON.stringify({ pid: process.pid, who, ...rec }) + '\n'); } catch { /* never break a test */ } }
function check(p, api) {
  try {
    if (typeof p === 'number' || p == null) return;
    const s = p instanceof URL ? p.pathname : Buffer.isBuffer(p) ? p.toString() : String(p);
    const abs = path.resolve(s);
    const rel = path.relative(ROOT, abs);
    if (!rel.startsWith('..') && !rel.includes(path.sep) && rel.endsWith('.js')) {
      // CommonJS's loader reads modules through the PUBLIC fs.readFileSync: drop those (an import is
      // not a text read). Keep the first frame inside the export's test/ tree as the reader site.
      // Node 22's CJS loader calls fs.readFileSync from defaultLoadImpl/loadSource; a test that
      // mocks readFileSync passes those through its own frame, so look a few frames deep.
      const stack = new Error().stack.split('\n').slice(2);
      if (stack.slice(0, 5).some(l => /(defaultLoadImpl|loadSource) \(node:internal\/modules\//.test(l))) return;
      const site = (stack.find(l => l.includes(ROOT + path.sep)) || '').trim().replace(ROOT + path.sep, '');
      log({ kind: 'read', file: rel, api, site, raw: s === abs ? undefined : s });
    }
  } catch { /* ignore */ }
}
// Probe mode: PROBE_DIR holds text variants; a test-side (non-loader) readFileSync of a root .js
// with a variant gets the variant, so text readers see the moved/reworded code while require()
// still loads the real file.
const PROBE_DIR = process.env.PROBE_DIR;
function variantFor(p) {
  if (!PROBE_DIR || typeof p !== 'string') return null;
  const abs = path.resolve(p); const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..') || rel.includes(path.sep) || !rel.endsWith('.js')) return null;
  const stack = new Error().stack.split('\n').slice(3);
  if (stack.slice(0, 5).some(l => /(defaultLoadImpl|loadSource) \(node:internal\/modules\//.test(l))) return null;
  const v = path.join(PROBE_DIR, rel);
  return fs.existsSync(v) ? v : null;
}
for (const api of ['readFileSync', 'readFile', 'createReadStream']) {
  const orig = fs[api];
  fs[api] = function (p, ...rest) { check(p, api); const v = api === 'readFileSync' ? variantFor(p) : null; return orig.call(this, v || p, ...rest); };
}
const origP = fs.promises.readFile;
fs.promises.readFile = function (p, ...rest) { check(p, 'promises.readFile'); return origP.call(this, p, ...rest); };

const LOOP = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::', undefined, null, '']);
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  let host;
  if (o && typeof o === 'object') { if (o.path) return origConnect.apply(this, args); host = o.host; }
  else if (typeof o === 'string' && isNaN(Number(o))) return origConnect.apply(this, args); // unix socket path
  else host = args[1];
  if (!LOOP.has(host) && !/^127\./.test(String(host))) {
    log({ kind: 'escape', host: String(host), port: o && o.port });
    const err = new Error(`trace guard: refused non-loopback connect to ${host}`); err.code = 'ECONNREFUSED';
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return origConnect.apply(this, args);
};
const origLookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  if (hostname && !LOOP.has(hostname) && !/^127\./.test(hostname)) {
    log({ kind: 'escape-dns', host: hostname });
    const cb = rest[rest.length - 1]; const err = new Error(`trace guard: refused lookup ${hostname}`); err.code = 'ENOTFOUND';
    if (typeof cb === 'function') return process.nextTick(() => cb(err));
  }
  return origLookup.call(this, hostname, ...rest);
};
