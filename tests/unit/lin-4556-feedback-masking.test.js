/**
 * LIN-4556 (LIN-4508 piece A), beat 2: feedback is stored with secrets masked, through either
 * route, and read back masked by `GET /api/proxy/dispatch/:id`.
 *
 * Witnesses (each observed failing against the unmasked path before `addFeedback` called the
 * masker):
 *   - GitHub, Linear and Anthropic-shaped tokens posted through BOTH feedback routes are masked
 *     in the stored row and in the API read; url and urlLabel too;
 *   - a secret split across two `(assistant-text i/n)` chunks is masked in the second chunk:
 *     a long line hard-split mid-token, a PEM whose header ends chunk 1, and a PEM whose first
 *     body line chunk 1 already masked (with and without the runner's label line);
 *   - a body that is only a secret is stored as `[redacted]`, not refused;
 *   - a secret on a `[done]` line is masked and the line still ends the run.
 * Plus the accepted miss, pinned by name: a continuation chunk that arrives before its
 * predecessor is masked on its own only.
 *
 * Token-shaped values come from tests/fixtures/secret-scan-fixtures.js (assembled from parts,
 * on the scanner's fixture allowlist). No real credential appears anywhere.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { deriveTerminalStatus, isLineageClosingTerminal, findWakeEvent } from '../../lib/dispatch-terminal.js';
import { maskFeedbackFields, parseChunkHead, previousChunkBodyOf, isContinuationChunk, CONTINUATION_TAIL_CHARS } from '../../lib/dispatch-feedback-masking.js';
import { MASK } from '../../lib/mask-secrets.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { FIXTURE_SECRETS as F } from '../fixtures/secret-scan-fixtures.js';
import { ACME, buildApp, call } from './lib/proxy-fake-deps.js';

const URL_KEY = ACME;
const DISPATCH_LABEL = 'token-a';
const RUNNER_TOKEN_ID = 't1';
const SECRETS = { github: F.githubPat, linear: F.linearApiKey, anthropic: F.anthropicApiKey };

const makeStore = () => new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
const storedRow = (store, id) => store.historyCollection._docs.find((d) => d._id === id);

function assertNoSecret(value, where) {
  for (const [name, secret] of Object.entries(SECRETS)) {
    assert.ok(!String(value).includes(secret), `${where}: the ${name} token must not appear, got ${JSON.stringify(value)}`);
  }
}

async function takenByDispatchToken(store) {
  const item = await store.addItem(URL_KEY, { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-42' });
  await store.takeItem(item._id, URL_KEY, DISPATCH_LABEL);
  return item;
}

async function takenByRunner(store) {
  const item = await store.addItem(URL_KEY, { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-42' });
  await store.takeItem(item._id, URL_KEY, 'runner', RUNNER_TOKEN_ID);
  return item;
}

async function serve(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

// ── Both routes, stored row and API read ────────────────────────────────────

describe('LIN-4556: a token posted through either route is masked in the stored row and in GET /api/proxy/dispatch/:id', () => {
  const message = `[status] tried gh with ${SECRETS.github}, then Linear ${SECRETS.linear} and the model key ${SECRETS.anthropic}.`;
  const body = { message, url: `https://example.com/cb?token=${SECRETS.github}`, urlLabel: `key ${SECRETS.linear}` };
  const expectedMessage = `[status] tried gh with ${MASK}, then Linear ${MASK} and the model key ${MASK}.`;

  async function proxyApp(store) {
    return buildApp({
      dispatchQueueStore: store,
      proxyTokenStore: {
        validateToken: async () => ({ tokenId: RUNNER_TOKEN_ID, urlKey: URL_KEY, label: 'runner', scope: 'readWrite', createdBy: 'u1', grants: ['take', 'dispatch'] }),
        listTokens: async () => [],
        describeRejectionCause: async () => null
      }
    });
  }

  async function readBack(store, id) {
    const res = await call(await proxyApp(store), 'GET', `/api/proxy/dispatch/${id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.feedback;
  }

  function assertMaskedEntry(entry, where) {
    assertNoSecret(JSON.stringify(entry), where);
    assert.equal(entry.message, expectedMessage, `${where}: message`);
    assert.equal(entry.url, `https://example.com/cb?token=${MASK}`, `${where}: url`);
    assert.equal(entry.urlLabel, `key ${MASK}`, `${where}: urlLabel`);
  }

  test('runner route POST /api/proxy/runner/feedback/:id', async () => {
    const store = makeStore();
    const item = await takenByRunner(store);

    const res = await call(await proxyApp(store), 'POST', `/api/proxy/runner/feedback/${item._id}`, { body });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    assertMaskedEntry(storedRow(store, item._id).feedback[0], 'stored row');
    assertMaskedEntry((await readBack(store, item._id))[0], 'GET /api/proxy/dispatch/:id');
  });

  test('dispatch-token route POST /api/dispatch/feedback/:itemId', async () => {
    const store = makeStore();
    const tokens = new DispatchTokenStore({ collection: createMockCollection() });
    const { token } = await tokens.createToken(URL_KEY, DISPATCH_LABEL, 'acct-1');
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore: store,
      dispatchTokenStore: tokens,
      workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: URL_KEY }; next(); },
      userPreferencesStore: {},
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      proxyTokenStore: { createToken: async () => ({ token: 'tok' }) }
    }));
    const item = await takenByDispatchToken(store);

    await serve(app, async (base) => {
      const res = await fetch(`${base}/api/dispatch/feedback/${item._id}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      assert.equal(res.status, 200, await res.text());
    });

    assertMaskedEntry(storedRow(store, item._id).feedback[0], 'stored row');
    assertMaskedEntry((await readBack(store, item._id))[0], 'GET /api/proxy/dispatch/:id');
  });
});

// ── What masking must and must not touch ────────────────────────────────────

describe('LIN-4556: what masking touches', () => {
  test('a body that is only a secret is stored as [redacted], not refused or dropped', async () => {
    const store = makeStore();
    const item = await takenByDispatchToken(store);

    const res = await store.addFeedback(item._id, URL_KEY, { message: SECRETS.anthropic }, DISPATCH_LABEL);

    assert.deepEqual(res, { success: true, feedbackCount: 1 });
    assert.equal(storedRow(store, item._id).feedback[0].message, MASK);
  });

  test('a secret on a [done] line is masked and the line still ends the run', async () => {
    const store = makeStore();
    const item = await takenByDispatchToken(store);

    await store.addFeedback(item._id, URL_KEY, { message: `[done] PR opened; pushed with ${SECRETS.github}` }, DISPATCH_LABEL);

    const row = storedRow(store, item._id);
    assert.equal(row.feedback[0].message, `[done] PR opened; pushed with ${MASK}`);
    assert.equal(deriveTerminalStatus(row.feedback), 'done');
    assert.equal(isLineageClosingTerminal({ message: row.feedback[0].message }), true);
    assert.equal(findWakeEvent(row.feedback).marker, 'done');
  });

  test('a secret on a [blocked] line is masked and the line is still a blocked wake', async () => {
    const store = makeStore();
    const item = await takenByDispatchToken(store);

    await store.addFeedback(item._id, URL_KEY, { message: `[blocked] the key ${SECRETS.linear} was refused` }, DISPATCH_LABEL);

    const row = storedRow(store, item._id);
    assert.equal(row.feedback[0].message, `[blocked] the key ${MASK} was refused`);
    assert.equal(findWakeEvent(row.feedback).marker, 'blocked');
  });

  test('a secret-free post, code prose included, is stored as the same text', async () => {
    const store = makeStore();
    const item = await takenByDispatchToken(store);
    const prose = '(assistant-text 1/1)\nconst token = req.headers.authorization; // sk- prefix check in lib/secret-scan.js\n[done] is a marker';

    await store.addFeedback(item._id, URL_KEY, { message: prose, kind: 'assistant-text', url: 'https://github.com/o/r/pull/1', urlLabel: 'PR #1' }, DISPATCH_LABEL);

    const [entry] = storedRow(store, item._id).feedback;
    assert.equal(entry.message, prose);
    assert.equal(entry.url, 'https://github.com/o/r/pull/1');
    assert.equal(entry.urlLabel, 'PR #1');
  });
});

// ── The chunk boundary ──────────────────────────────────────────────────────

const chunk = (i, n, text, label = null) => `${label ? `${label}\n` : ''}(assistant-text ${i}/${n})\n${text}`;
const pemLines = F.privateKey.split('\n'); // [BEGIN, body1, body2, END]

async function postChunks(store, item, messages) {
  for (const message of messages) {
    const res = await store.addFeedback(item._id, URL_KEY, { message, kind: 'assistant-text' }, DISPATCH_LABEL);
    assert.ok(res?.success, `chunk post: ${message.slice(0, 40)}`);
  }
  return storedRow(store, item._id).feedback.map((f) => f.message);
}

describe('LIN-4556: a secret split across two assistant-text chunks is masked', () => {
  test('a long line hard-split mid-token: the remainder in chunk 2 is masked', async () => {
    const store = makeStore();
    const item = await takenByDispatchToken(store);
    // One line longer than the runner's chunk, cut at 1900 chars with the token across the cut.
    const cut = 1900;
    const lead = `${'w'.repeat(cut - 13)} `; // a space before the token, as in prose (the rule needs a word boundary)
    const line = `${lead}${SECRETS.github} then more words on the same line`;
    const [one, two] = [line.slice(0, cut), line.slice(cut)];
    assert.ok(!one.includes(SECRETS.github) && !two.includes(SECRETS.github), 'the token is split across the cut');

    const stored = await postChunks(store, item, [chunk(1, 2, one), chunk(2, 2, two)]);

    assert.equal(stored[1], chunk(2, 2, `${MASK} then more words on the same line`));
  });

  test('the rollback (recap i/n) format: a token split across two recap chunks is masked like the assistant-text pair', async () => {
    // simple-dispatcher hook.js postTurnText (SD_ASSISTANT_TEXT_RELAY=0) posts `[<label> ](recap i/n)\n<chunk>`,
    // the label on the SAME line, chunked by the same chunkLines.
    const token = SECRETS.github;
    const recap = (i, n, text, label = null) => `${label ? `${label} ` : ''}(recap ${i}/${n})\n${text}`;
    for (const label of [null, '[turn 3]']) {
      const store = makeStore();
      const item = await takenByDispatchToken(store);
      const stored = await postChunks(store, item, [
        recap(1, 2, `token is ${token.slice(0, 16)}`, label),
        recap(2, 2, `${token.slice(16)} tail`, label)
      ]);
      assert.equal(stored[1], recap(2, 2, `${MASK} tail`, label), `label ${label}`);
    }
  });

  test('a recap chunk is not continued by an assistant-text chunk (head families do not mix)', async () => {
    const store = makeStore();
    const item = await takenByDispatchToken(store);
    const token = SECRETS.github;
    const stored = await postChunks(store, item, [
      `(recap 1/2)\ntoken is ${token.slice(0, 16)}`,
      chunk(2, 2, `${token.slice(16)} tail`)
    ]);
    assert.ok(stored[1].includes(token.slice(16)), 'no cross-family join: masked on its own only');
  });

  test('a long line hard-split inside a long key chunk 1 already masked: the key\'s remainder in chunk 2 is masked', async () => {
    const store = makeStore();
    const item = await takenByDispatchToken(store);
    // The Anthropic rule has no upper length, so the first 40+ chars match alone in chunk 1 and
    // are masked there; the joined text then shows only `[redacted]` before the remainder.
    const cut = 1900;
    const keyHead = 46; // chars of the key left of the cut
    const line = `${'w'.repeat(cut - keyHead - 1)} ${SECRETS.anthropic} and on we go`;
    const [one, two] = [line.slice(0, cut), line.slice(cut)];
    assert.ok(two.startsWith(SECRETS.anthropic.slice(keyHead)), 'the key continues into chunk 2');

    const stored = await postChunks(store, item, [chunk(1, 2, one), chunk(2, 2, two)]);

    assert.ok(stored[0].endsWith(` ${MASK}`), 'chunk 1 masks the part it holds');
    assert.equal(stored[1], chunk(2, 2, `${MASK} and on we go`));
  });

  test('a PEM whose BEGIN line ends chunk 1: the body and END line in chunk 2 are masked', async () => {
    const store = makeStore();
    const item = await takenByDispatchToken(store);

    const stored = await postChunks(store, item, [
      chunk(1, 2, `Here is the key I found:\n${pemLines[0]}`),
      chunk(2, 2, `${pemLines.slice(1).join('\n')}\nand that was the end.`)
    ]);

    assert.equal(stored[1], chunk(2, 2, `${MASK}\nand that was the end.`));
  });

  test('a PEM whose first body line chunk 1 already masked: the rest of it in chunk 2 is masked (runner label line)', async () => {
    const store = makeStore();
    const item = await takenByDispatchToken(store);
    const label = '[turn 3]';

    const stored = await postChunks(store, item, [
      chunk(1, 2, `Key:\n${pemLines[0]}\n${pemLines[1]}`, label),
      chunk(2, 2, `${pemLines[2]}\n${pemLines[3]}\nDone reading.`, label)
    ]);

    assert.equal(stored[0], chunk(1, 2, `Key:\n${MASK}`, label), 'chunk 1 is masked on its own (truncated PEM rule)');
    assert.equal(stored[1], chunk(2, 2, `${MASK}\nDone reading.`, label));
  });

  test('accepted miss: a continuation chunk that arrives before its predecessor is masked on its own only', async () => {
    const store = makeStore();
    const item = await takenByDispatchToken(store);
    const rest = `${pemLines.slice(1).join('\n')}`;

    const stored = await postChunks(store, item, [
      chunk(2, 2, `${rest}\nand that was the end.`),
      chunk(1, 2, `Here is the key I found:\n${pemLines[0]}`)
    ]);

    // Without chunk 1 there is no header to join; the bare body lines match no rule.
    assert.equal(stored[0], chunk(2, 2, `${rest}\nand that was the end.`));
  });

  test('a chunk is joined only to chunk i-1 of the same text (same n, same label)', async () => {
    const store = makeStore();
    const item = await takenByDispatchToken(store);

    const stored = await postChunks(store, item, [
      chunk(1, 3, `Key:\n${pemLines[0]}`, '[turn 1]'),
      chunk(2, 2, `${pemLines.slice(1).join('\n')}`, '[turn 2]')
    ]);

    assert.equal(stored[1], chunk(2, 2, `${pemLines.slice(1).join('\n')}`, '[turn 2]'), 'a different text is never joined');
  });
});

// ── The pure helpers ────────────────────────────────────────────────────────

describe('LIN-4556: chunk-head helpers', () => {
  test('parseChunkHead reads the head with and without the label line', () => {
    assert.deepEqual(parseChunkHead('(assistant-text 2/5)\nbody'), { label: null, i: 2, n: 5, bodyStart: 21, family: 'assistant-text' });
    assert.deepEqual(parseChunkHead('[turn 3]\n(assistant-text 1/2)\nbody'), { label: '[turn 3]', i: 1, n: 2, bodyStart: 30, family: 'assistant-text' });
    assert.deepEqual(parseChunkHead('(recap 2/3)\nbody'), { label: null, i: 2, n: 3, bodyStart: 12, family: 'recap' });
    assert.deepEqual(parseChunkHead('[turn 3] (recap 1/2)\nbody'), { label: '[turn 3]', i: 1, n: 2, bodyStart: 21, family: 'recap' });
    assert.equal(parseChunkHead('plain words'), null);
    assert.equal(parseChunkHead('(assistant-text 3/2)\nbody'), null, 'i past n is not a chunk');
    assert.equal(parseChunkHead('(assistant-text 2/5) no newline'), null);
  });

  test('isContinuationChunk is true only for kind assistant-text with i > 1', () => {
    assert.equal(isContinuationChunk({ message: '(assistant-text 2/2)\nb', kind: 'assistant-text' }), true);
    assert.equal(isContinuationChunk({ message: '(assistant-text 1/2)\nb', kind: 'assistant-text' }), false);
    assert.equal(isContinuationChunk({ message: '(assistant-text 2/2)\nb', kind: 'status' }), false);
    assert.equal(isContinuationChunk({ message: '(assistant-text 2/2)\nb' }), false);
  });

  test('previousChunkBodyOf finds chunk i-1 newest first, or null', () => {
    const fb = [
      { kind: 'assistant-text', message: '(assistant-text 1/2)\nold' },
      { kind: 'status', message: '(assistant-text 1/2)\nnot text' },
      { kind: 'assistant-text', message: '(assistant-text 1/2)\nnew' }
    ];
    assert.equal(previousChunkBodyOf(fb, '(assistant-text 2/2)\nx'), 'new');
    assert.equal(previousChunkBodyOf(fb, '(assistant-text 2/3)\nx'), null);
    assert.equal(previousChunkBodyOf(undefined, '(assistant-text 2/2)\nx'), null);
  });

  test('the tail bound is the feedback message cap', () => {
    assert.equal(CONTINUATION_TAIL_CHARS, 2000);
  });

  test('maskFeedbackFields returns null/undefined url fields as given', () => {
    assert.deepEqual(maskFeedbackFields({ message: 'm', url: null, urlLabel: undefined }), { message: 'm', url: null, urlLabel: undefined });
  });
});
