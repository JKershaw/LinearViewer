/**
 * LIN-4414 (W4): the leftover answer guard on the proxy's comment writes (routes/proxy-writes.js
 * `refusedByLeftoverAnswer`).
 *
 * Drives the REAL proxy routes with an injected fake provider that counts its calls, so a refusal
 * is shown to reach no provider at all:
 *   - POST and PATCH of a comment that opens with the leftover heading and has no retirement line
 *     answer 422 LEFTOVER_RETIRES_MISSING; a malformed line answers 422 LEFTOVER_RETIRES_SHAPE;
 *     createComment / updateComment are never called;
 *   - a refused body cannot pass through the dedupe cache, even one cached before the guard
 *     existed (a body posted before deploy);
 *   - a valid answer, an ordinary comment and a review-shaped comment (opens `## Review — …` with
 *     the heading further down and no retirement line) are posted as before;
 *   - the comment-target attachment caption is checked too, before any upload.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes, commentDedupe, commentDedupeGenerations } from '../../routes/proxy.js';
import { dedupeKey } from '../../lib/proxy-dedupe.js';
import { ProviderInterface } from '../../lib/providers/interface.js';
import { LEFTOVERS_HEADING, RETIRES_LABEL, RETIRES_NONE } from '../../lib/prompts/leftover-words.js';
import { LEFTOVER_ANSWER_CODES } from '../../lib/dispatch-leftover-answer.js';

const URL_KEY = 'acme-4414';
const ISSUE_ID = '44144414-4414-4414-4414-441444144414';
const COMMENT_ID = '0c0c0c0c-0c0c-0c0c-0c0c-0c0c0c0c0c0c';
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]).toString('base64')}`;

class CountingProvider extends ProviderInterface {
  constructor() {
    super();
    this.name = 'fake';
    this.calls = { createComment: 0, updateComment: 0, uploadFile: 0, issueWriteGuard: 0 };
    this.createComment = async (token, issueId, body) => { this.calls.createComment++; return { id: `c-${this.calls.createComment}`, body, createdAt: '2026-11-12T00:00:00.000Z', user: { name: 'Agent' } }; };
    this.updateComment = async (token, commentId, body) => { this.calls.updateComment++; return { id: commentId, body }; };
    this.uploadFile = async () => { this.calls.uploadFile++; return 'https://uploads.example/asset.png'; };
    this.issueWriteGuard = async () => { this.calls.issueWriteGuard++; return { id: ISSUE_ID, team: { id: 'team-1' } }; };
  }
}

function buildApp(provider) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'ws-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return app;
}

async function call(provider, method, path, body) {
  const server = buildApp(provider).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/issues/${path}`, {
      method,
      headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// Unique per test, so the process-wide dedupe cache never links two tests.
let n = 0;
const pr = () => `PR: https://github.com/o/r/pull/${++n} · head \`abc${n}\``;
const noLine = () => [LEFTOVERS_HEADING, '', pr(), '', '- `lib/a.js`: a stale comment. **tidied**'].join('\n');
const withLine = (line) => `${noLine()}\n\n${line}`;
const reviewShaped = () => ['## Review — LIN-9001', '', pr(), '', '**Verdict:** Approve.', '', LEFTOVERS_HEADING, '', 'The builder\'s answer matches the diff.'].join('\n');

describe('POST comments: the leftover answer guard', () => {
  test('an answer with no retirement line is refused 422 MISSING, and the provider is never called', async () => {
    const provider = new CountingProvider();
    const res = await call(provider, 'POST', `${ISSUE_ID}/comments`, { body: noLine() });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, LEFTOVER_ANSWER_CODES.missing);
    assert.match(res.body.error, new RegExp(`opens with the line "${LEFTOVERS_HEADING}"`));
    assert.ok(res.body.error.includes(`${RETIRES_LABEL} ${RETIRES_NONE.noWaiting}`), 'the refusal gives a literal example');
    assert.deepEqual(provider.calls, { createComment: 0, updateComment: 0, uploadFile: 0, issueWriteGuard: 0 });
  });

  test('a malformed line is refused 422 SHAPE naming the line, and nothing is posted', async () => {
    const provider = new CountingProvider();
    const res = await call(provider, 'POST', `${ISSUE_ID}/comments`, { body: withLine(`${RETIRES_LABEL} none, not busy`) });
    assert.equal(res.status, 422);
    assert.equal(res.body.code, LEFTOVER_ANSWER_CODES.shape);
    assert.equal(res.body.kind, 'unknown-reason');
    assert.equal(res.body.line.number, 7);
    assert.equal(provider.calls.createComment, 0);
  });

  test('the flat alias route is guarded too', async () => {
    const provider = new CountingProvider();
    const server = buildApp(provider).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/comments/${ISSUE_ID}`, {
        method: 'POST', headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' }, body: JSON.stringify({ body: noLine() }),
      });
      assert.equal(res.status, 422);
      assert.equal(provider.calls.createComment, 0);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('a refused body cannot pass through the dedupe cache, even one cached before the guard existed', async () => {
    const provider = new CountingProvider();
    const body = noLine();
    const first = await call(provider, 'POST', `${ISSUE_ID}/comments`, { body });
    const retry = await call(provider, 'POST', `${ISSUE_ID}/comments`, { body });
    assert.equal(first.status, 422);
    assert.equal(retry.status, 422, 'a refusal is never cached as a success');
    // A body posted before deploy sits in the cache as a success; the guard runs before the lookup.
    commentDedupe.set(dedupeKey(URL_KEY, ISSUE_ID, body, commentDedupeGenerations.current(URL_KEY)), { success: true, comment: { id: 'old', body } });
    const cached = await call(provider, 'POST', `${ISSUE_ID}/comments`, { body });
    assert.equal(cached.status, 422, JSON.stringify(cached.body));
    assert.equal(cached.body.deduped, undefined);
    assert.equal(provider.calls.createComment, 0);
  });

  test('a valid answer is posted (201), in each form', async () => {
    for (const line of [
      `${RETIRES_LABEL} \`lib/dispatch-factory.js\`: tests the provider name beside the hermetic token check`,
      `${RETIRES_LABEL} ${RETIRES_NONE.noWaiting}`,
      `${RETIRES_LABEL} ${RETIRES_NONE.nothingFixSized}: the smallest is \`lib/cost-read.js\`, a store split larger than a fix`,
    ]) {
      const provider = new CountingProvider();
      const res = await call(provider, 'POST', `${ISSUE_ID}/comments`, { body: withLine(line) });
      assert.equal(res.status, 201, `${line}: ${JSON.stringify(res.body)}`);
      assert.equal(provider.calls.createComment, 1);
    }
  });

  test('an ordinary comment is posted (201)', async () => {
    const provider = new CountingProvider();
    const res = await call(provider, 'POST', `${ISSUE_ID}/comments`, { body: `## Implementation: PR open\n\n${pr()}` });
    assert.equal(res.status, 201);
    assert.equal(provider.calls.createComment, 1);
  });

  test('a review-shaped comment, with the heading further down and no retirement line, is posted (201)', async () => {
    const provider = new CountingProvider();
    const res = await call(provider, 'POST', `${ISSUE_ID}/comments`, { body: reviewShaped() });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(provider.calls.createComment, 1);
  });
});

describe('PATCH comments: the leftover answer guard', () => {
  test('an edit to an answer with no retirement line is refused 422, and updateComment is never called', async () => {
    const provider = new CountingProvider();
    const res = await call(provider, 'PATCH', `${ISSUE_ID}/comments/${COMMENT_ID}`, { body: noLine() });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, LEFTOVER_ANSWER_CODES.missing);
    assert.equal(provider.calls.updateComment, 0);
  });

  test('an edit that adds a valid line, and an ordinary or review-shaped edit, are applied (200)', async () => {
    for (const body of [withLine(`${RETIRES_LABEL} ${RETIRES_NONE.noWaiting}`), 'An ordinary edit.', reviewShaped()]) {
      const provider = new CountingProvider();
      const res = await call(provider, 'PATCH', `${ISSUE_ID}/comments/${COMMENT_ID}`, { body });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(provider.calls.updateComment, 1);
    }
  });
});

describe('the comment-target attachment caption: the leftover answer guard', () => {
  test('a caption that opens an answer with no retirement line is refused 422 before any upload', async () => {
    const provider = new CountingProvider();
    const res = await call(provider, 'POST', `${ISSUE_ID}/attachments`, { image: PNG_DATA_URL, body: noLine() });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, LEFTOVER_ANSWER_CODES.missing);
    assert.equal(provider.calls.uploadFile, 0);
    assert.equal(provider.calls.createComment, 0);
  });

  test('a valid caption, and an ordinary one, are posted (201)', async () => {
    for (const body of [withLine(`${RETIRES_LABEL} ${RETIRES_NONE.noWaiting}`), 'Before/after screenshot.']) {
      const provider = new CountingProvider();
      const res = await call(provider, 'POST', `${ISSUE_ID}/attachments`, { image: PNG_DATA_URL, body });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(provider.calls.createComment, 1);
    }
  });
});
