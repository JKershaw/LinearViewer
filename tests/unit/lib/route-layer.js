/**
 * One route-layer finder for tests that pull a handler out of a router (LIN-3861).
 *
 * Structure only. It descends nested routers (`layer.handle.stack`), so a test does
 * not care whether `createWorkspaceApiRoutes` registers a route directly or through
 * a router it mounts (the LIN-2246 moves mount route groups one router deeper),
 * returns the single matching route layer, and fails on zero or more than one match.
 * It loosens no guard: every assertion made on the layer or its handler is unchanged.
 *
 * Same semantics as the finder in dashboard-routes.test.js (LIN-3840), which keeps
 * its own copy. A plain (non-`.test.js`) module on purpose.
 */
import assert from 'node:assert/strict';

/**
 * @param {{ stack: object[] }} router an express Router (or anything with a `stack`)
 * @param {string} method lower-case HTTP method, e.g. 'get'
 * @param {string} path the route path exactly as registered
 * @returns {object} the one matching route layer
 */
export function findRouteLayer(router, method, path) {
  const matches = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        if (layer.route.path === path && layer.route.methods[method]) matches.push(layer);
      } else if (Array.isArray(layer.handle?.stack)) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(router.stack);
  assert.ok(matches.length > 0, `${method.toUpperCase()} ${path} route is registered`);
  assert.equal(matches.length, 1, `${method.toUpperCase()} ${path} is registered ${matches.length} times, expected exactly once`);
  return matches[0];
}
