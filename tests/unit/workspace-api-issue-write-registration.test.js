/**
 * LIN-3876: the issue-write routes moved to routes/workspace-api-issue-write.js and
 * register on the composer's OWN router, not a mounted sub-router. A mounted inner
 * router answers OPTIONS on /api/comments/:issueId itself (`Allow: POST`), and calling
 * the writes before the reads gives `POST,GET,HEAD`; both differ from `GET,HEAD,POST`,
 * so the verb set Express reports is the observable proof of direct registration. Behavioural only: no source reads.
 *
 * Run with: node --test tests/unit/workspace-api-issue-write-registration.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createWorkspaceApiRoutes, decisionStampDedupe } from '../../routes/workspace-api.js';
import { decisionStampDedupe as movedDedupe } from '../../routes/workspace-api-issue-write.js';

let server, base;

before(async () => {
  const app = express();
  const workspaceFromUrl = (req, res, next) => next();
  app.use(createWorkspaceApiRoutes({ workspaceFromUrl }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const allowFor = async (path) => (await fetch(`${base}${path}`, { method: 'OPTIONS' })).headers.get('allow');

test('OPTIONS /api/comments/:issueId reports the read and write verbs together', async () => {
  assert.equal(await allowFor('/workspace/w/api/comments/abc'), 'GET,HEAD,POST');
});

test('OPTIONS reports the create and patch verbs on the issue paths', async () => {
  assert.equal(await allowFor('/workspace/w/api/issues'), 'POST');
  assert.equal(await allowFor('/workspace/w/api/issues/abc'), 'PATCH');
});

test('the composer re-exports the one shared decisionStampDedupe instance', () => {
  assert.equal(decisionStampDedupe, movedDedupe);
});
