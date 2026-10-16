// Preloaded (NODE_OPTIONS=--import) into every test process mutate.mjs and
// the corpus recorder spawn. Refuses any outbound socket that is not loopback
// or a unix socket, and reports the attempt on stderr as `KIT-NETWORK host:port`
// so a run that tried to leave the machine is visible in the results. This is
// a guard for the experiment's "never call a real API" rule, not a test
// fixture: a refused connect surfaces to the code under test as a socket error.
import net from 'node:net'

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/i
const original = net.Socket.prototype.connect

// A configured outbound proxy usually listens on loopback; a connect to IT is
// an escape too (the same lesson as the repo's LIN-2992), so its port is refused.
const PROXY_PORTS = new Set()
for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
  try { if (process.env[key]) PROXY_PORTS.add(String(new URL(process.env[key]).port || (process.env[key].startsWith('https') ? 443 : 80))) } catch { /* unparsable proxy URL: ignore */ }
}

net.Socket.prototype.connect = function guardedConnect(...args) {
  let opts = args[0]
  if (Array.isArray(opts)) opts = opts[0]
  let host
  let port
  let path
  if (opts && typeof opts === 'object') { host = opts.host; port = opts.port; path = opts.path } else if (typeof opts === 'string' && Number.isNaN(Number(opts))) { path = opts } else { port = opts; host = typeof args[1] === 'string' ? args[1] : undefined }
  const loopback = host === undefined || LOOPBACK.test(String(host))
  if (path || (loopback && !PROXY_PORTS.has(String(port)))) return original.apply(this, args)
  process.stderr.write(`KIT-NETWORK ${host}:${port}\n`)
  process.nextTick(() => this.destroy(new Error(`adf-kit: outbound network blocked (${host}:${port})`)))
  return this
}
