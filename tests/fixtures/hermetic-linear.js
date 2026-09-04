/**
 * Hermetic Linear transport for the unit suite (LIN-1880).
 *
 * WHAT THIS EXISTS FOR. `npm run test:unit` opened live TLS connections to
 * `api.linear.app:443` on every run. Measured at `44ffe713` with a socket-level
 * watcher (`net.connect`/`tls.connect`): **8 connections**, from 8 distinct test
 * files. The ticket recorded 2 and predicted its own number was stale; it was.
 *
 * WHY NOTHING CAUGHT IT. Both instruments used on LIN-1848 are structurally
 * blind to this class:
 *   - `tests/fixtures/network-guard.js` patches the `http(s).request` MODULE
 *     EXPORTS. Native `fetch` goes through undici and never touches them.
 *   - An external counting proxy only sees clients that honour `HTTPS_PROXY`.
 *     Node's `fetch` ignores proxy env vars unless given a dispatcher.
 * The captured stacks are pure undici internals with no application frames, so
 * the leak is invisible from both ends — which is why identifying the call site
 * was part of the ticket rather than a given.
 *
 * THE CALL SITE. `lib/providers/linear/index.js` builds its transport once at
 * MODULE SCOPE (`const linearFetch = createLinearFetch()`), defaulting to
 * `globalThis.fetch`. Every leaking file transitively imports that provider
 * through a route module, spins a real server on 127.0.0.1, and drives it — and
 * some route path incidentally reaches a Linear read. None of these tests
 * ASSERT on Linear data; the call is incidental, which is why stubbing it
 * leaves every one of them green.
 *
 * WHY A HOOK AND NOT A `globalThis.fetch` MOCK, which the ticket names as the
 * approach to avoid: `createLinearFetch` captures its base fetch at
 * construction, and the provider constructs at module load. By the time a test
 * body runs, swapping the global is not observed. `setLinearFetchImpl`
 * (lib/linear-fetch.js) is resolved per attempt inside the retry loop instead.
 *
 * USAGE — call at module scope. Ordering against the route imports does not
 * matter (the hook is read per call, not per construction), but calling it at
 * the top keeps the intent visible:
 *
 *     import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
 *     installHermeticLinearTransport();
 */
import { setLinearFetchImpl } from '../../lib/linear-fetch.js';

/**
 * Install a transport that refuses to reach the network and says so.
 *
 * The default REFUSES rather than returning a plausible response, deliberately.
 * A canned success would silently satisfy a test that genuinely depends on
 * Linear data, converting a real dependency into an invisible one — the same
 * shape of quiet failure this ticket is about. A refusal makes such a test go
 * red and name itself.
 *
 * NOTE the envelope is HTTP 200 with a GraphQL `errors` array, which is what
 * every current consumer expects — they all go through graphql-request, which
 * throws `ClientError` on `errors` regardless of status. A future consumer that
 * called `createLinearFetch` directly and checked `res.ok` would read this as a
 * success carrying `data: null`. If one appears, give this a non-2xx status.
 *
 * It refuses by returning a GraphQL-shaped error envelope rather than throwing,
 * because that is what the provider's own error path is built to handle: a
 * throw is routed through `createLinearFetch`'s retry/diagnostics machinery,
 * which retries twice and emits terminal-drop diagnostics — noise that says
 * nothing about the test. The envelope reaches the caller in one attempt and is
 * handled by the same code that handles a real Linear error.
 *
 * @param {Object} [opts]
 * @param {Function} [opts.respond] - optional custom transport for a test that
 *   genuinely needs to exercise a Linear response shape. Receives (url, options).
 * @returns {{ calls: Array<{url: string}>, restore: () => void }} `calls`
 *   records every intercepted request so a test can assert the count — including
 *   asserting it is ZERO, which is the usual case.
 */
export function installHermeticLinearTransport({ respond } = {}) {
  const calls = [];

  setLinearFetchImpl(async (url, options) => {
    calls.push({ url: String(url) });
    if (typeof respond === 'function') return respond(url, options);
    return new Response(
      JSON.stringify({
        data: null,
        errors: [{
          message:
            'hermetic test transport: this unit test reached the Linear API. ' +
            'If the call is incidental, nothing to do — this envelope is the refusal. ' +
            'If your test genuinely needs Linear data, pass `respond` to ' +
            'installHermeticLinearTransport() rather than letting it hit the network.'
        }]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });

  return {
    calls,
    restore() { setLinearFetchImpl(null); }
  };
}
