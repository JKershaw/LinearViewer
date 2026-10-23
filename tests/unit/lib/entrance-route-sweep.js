/**
 * Shared helpers for the dispatch-entrance route sweeps (LIN-3601).
 *
 * LIN-3592 rebuilt routes/dispatch.js, routes/proxy-dispatch.js and
 * routes/proxy-kickoff.js ("E"). The source-text censuses pinned each guard by
 * the file and `router.<verb>(` registration it sat in, so the entrances could
 * not share one authority. The sweeps built on this module guard the same
 * properties by calling every route over HTTP instead.
 *
 * `enumerateRoutes` reads `router.stack` to LIST routes only (LIN-2505 moved
 * tests off `router.stack` introspection; the rule survives as "never pull a
 * handler from it"). It returns method + path and nothing callable. It
 * descends into nested routers and throws on any layer it cannot classify, so
 * a new kind of layer fails the sweep instead of going unseen.
 *
 * A plain (non-`.test.js`) module on purpose: importing a `.test.js` file would
 * register its tests a second time (see proxy-fake-deps.js).
 */
import { randomBytes } from 'node:crypto';
import express from 'express';
import { ProxyTokenStore } from '../../../lib/proxy-tokens.js';
import { createMockCollection } from '../../fixtures/mock-collection.js';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Every route registered on `router`, nested routers included.
 *
 * @param {import('express').Router} router
 * @param {{allowedLayers?: {mount: string, names: string[]}[]}} [options] the
 *   path-scoped middleware layers the caller has audited, by the source of the
 *   mount's path regexp and the layer's function names (none by default)
 * @returns {{method: string, path: string}[]} one entry per verb and path form
 * @throws {Error} on a layer that is neither a route, a nested router mounted
 *   at the root, nor an allowed middleware
 */
export function enumerateRoutes(router, { allowedLayers = [] } = {}) {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const method of Object.keys(layer.route.methods)) {
          for (const path of paths) {
            if (typeof path !== 'string') throw new Error(`unclassifiable route path ${String(path)}`);
            out.push({ method: method.toUpperCase(), path: prefix + path });
          }
        }
        continue;
      }
      if (layer.name === 'router' && Array.isArray(layer.handle?.stack)) {
        // `router.use(child)` with no path: Express marks the layer fast_slash.
        if (!layer.regexp?.fast_slash) throw new Error('unclassifiable layer: a nested router mounted at a path');
        walk(layer.handle.stack, prefix);
        continue;
      }
      if (allowedLayers.some(a => a.mount === layer.regexp?.source && a.names.includes(layer.name || '<anonymous>'))) continue;
      throw new Error(`unclassifiable layer: ${layer.name || '<anonymous>'} mounted at ${layer.regexp?.source}`);
    }
  };
  walk(router.stack, '');
  return out;
}

/** A concrete URL for a route path: every `:param` filled from `values` or a UUID. */
export const SAMPLE_UUID = '11111111-2222-4333-8444-555555555555';
export function sampleUrl(path, values = {}) {
  return path.replace(/:([A-Za-z]\w*)/g, (_m, name) => encodeURIComponent(values[name] ?? (name === 'urlKey' ? 'alpha' : SAMPLE_UUID)));
}

/**
 * A runtime-built bootstrap-token canary: `hbp_` plus 43 base64url characters (LIN-3795: the minted shape).
 * Never write a token-shaped literal in a test; the `harbour-bootstrap-token`
 * rule in lib/secret-scan.js is part of the `secret-scan` CI job.
 */
export function makeCanary() {
  const body = randomBytes(32).toString('base64url');
  const canary = `${'hb'}p_${body}`;
  if (canary.length !== 47 || !BASE64URL.test(canary)) throw new Error('canary shape');
  return canary;
}

/** A bound-to-127.0.0.1 server (LIN-2023) around `app`, closed by the returned `close`. */
export async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

/** One request against a fresh server. Resolves `{status, body, text}`. */
export async function request(app, method, url, { body, headers } = {}) {
  const server = await listen(app);
  try {
    const opts = { method, headers: { ...headers } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${server.base}${url}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, text };
  } finally {
    await server.close();
  }
}

/** An express app with JSON parsing around one router. */
export function appAround(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

/**
 * A call recorder: `spy.calls` is an ordered `[name, ...args]` list. `wrap(name,
 * fn)` returns a function that records and then delegates.
 */
export function makeSpy() {
  const calls = [];
  return {
    calls,
    wrap: (name, fn = async () => undefined) => async (...args) => {
      calls.push([name, ...args]);
      return fn(...args);
    },
    names: () => calls.map(c => c[0]),
    count: (name) => calls.filter(c => c[0] === name).length
  };
}

/**
 * The real ProxyTokenStore over a mock collection, with the two mint entry
 * points spied at the store boundary (`createToken`, `mintGrantBootstrap`) and
 * `validateToken` replaced so a test chooses who the caller is. Spying at the
 * store boundary sees the call shapes the routes really produce, and needs no
 * seam in the routes (LIN-3601: no production change).
 *
 * @param {ReturnType<typeof makeSpy>} spy
 * @param {{validateToken?: Function, ownerCheck?: Function}} [options]
 */
export function spiedProxyTokenStore(spy, { validateToken, ownerCheck } = {}) {
  const real = new ProxyTokenStore({ collection: createMockCollection() });
  real.setOwnerCheck(ownerCheck || (async () => ({ status: 'owner' })));
  const realGrant = real.mintGrantBootstrap.bind(real);
  const realCreate = real.createToken.bind(real);
  const store = Object.create(real);
  store.mintGrantBootstrap = spy.wrap('mintGrantBootstrap', realGrant);
  store.createToken = spy.wrap('createToken', realCreate);
  if (validateToken) store.validateToken = validateToken;
  return store;
}
