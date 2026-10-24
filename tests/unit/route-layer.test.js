/**
 * LIN-3861: the shared route-layer finder (tests/unit/lib/route-layer.js) on
 * synthetic routers: it finds a top-level route, descends nested routers, and fails
 * on zero or more than one match.
 *
 * Run: node --test tests/unit/route-layer.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';
import { findRouteLayer } from './lib/route-layer.js';

const noop = (req, res) => res.end();

test('finds the single top-level route layer', () => {
  const router = Router();
  router.get('/a', noop);
  router.post('/a', noop);
  const layer = findRouteLayer(router, 'post', '/a');
  assert.equal(layer.route.path, '/a');
  assert.ok(layer.route.methods.post);
  assert.equal(layer, router.stack.find(l => l.route?.path === '/a' && l.route.methods.post));
});

test('descends nested routers, at any depth', () => {
  const inner = Router();
  inner.get('/deep', noop);
  const middle = Router();
  middle.use(inner);
  const outer = Router();
  outer.use(middle);
  const layer = findRouteLayer(outer, 'get', '/deep');
  assert.equal(layer.route.stack[layer.route.stack.length - 1].handle, noop);
});

test('fails on zero matches (wrong path, wrong method)', () => {
  const router = Router();
  router.get('/a', noop);
  assert.throws(() => findRouteLayer(router, 'get', '/b'), /GET \/b route is registered/);
  assert.throws(() => findRouteLayer(router, 'post', '/a'), /POST \/a route is registered/);
});

test('fails on more than one match, across top level and nested routers', () => {
  const twice = Router();
  twice.get('/a', noop);
  twice.get('/a', noop);
  assert.throws(() => findRouteLayer(twice, 'get', '/a'), /registered 2 times/);

  const inner = Router();
  inner.get('/a', noop);
  const split = Router();
  split.get('/a', noop);
  split.use(inner);
  assert.throws(() => findRouteLayer(split, 'get', '/a'), /registered 2 times/);
});
