// Universal async error forwarding for Express 4 (LIN-609).
//
// Problem: Express 4 only routes errors to the 4-arg error middleware for
// SYNCHRONOUS throws. An `async (req, res) => { ... }` handler that rejects
// after an `await` returns a rejected promise that Express never inspects, so:
//   - no response is ever sent (the request hangs),
//   - the rejection surfaces only as a process-level `unhandledRejection`.
// The LIN-608 process handler keeps the dyno alive, but the hung request still
// times out at Heroku's H12 router limit (30s) and the user sees the "Application
// error" host page. In other words: the crash became a 30s hang, not a fix.
//
// This patches the Router Layer so a rejected promise from ANY route handler or
// middleware is forwarded to `next(err)` — landing it in the existing Express
// error middleware exactly like a synchronous throw. It is the in-repo, zero-
// dependency equivalent of `express-async-errors`, and it covers every current
// AND future async handler without wrapping each of the ~130 routes by hand.
// (Express 5 does this natively; this bridge can be removed on that upgrade.)
//
// `installAsyncErrorForwarding()` is idempotent and must run BEFORE any routes
// are registered (the Layer prototype is shared process-wide).
import Layer from 'express/lib/router/layer.js'

const PATCHED = Symbol.for('lin609.asyncErrorForwarding')

export function installAsyncErrorForwarding() {
  // Idempotent: never double-wrap if imported/called more than once.
  if (Layer.prototype[PATCHED]) return
  const originalHandleRequest = Layer.prototype.handle_request

  Layer.prototype.handle_request = function handleRequest(req, res, next) {
    const fn = this.handle
    // 4-arg functions are error handlers, not request handlers — Express skips
    // them here (handle_error invokes those). Preserve that exactly.
    if (typeof fn !== 'function' || fn.length > 3) {
      return originalHandleRequest.call(this, req, res, next)
    }
    try {
      const ret = fn.call(this, req, res, next)
      // Forward an async rejection to next(err) — the only behaviour change.
      // Sync handlers and non-promise returns are untouched.
      if (ret && typeof ret.then === 'function') {
        Promise.resolve(ret).then(undefined, next)
      }
    } catch (err) {
      next(err)
    }
  }

  Layer.prototype[PATCHED] = true
}
