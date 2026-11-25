/**
 * LIN-4561 (LIN-4508 piece F): the runner kit posts its subagent's words while it works.
 *
 * A runner-kit run is a Claude Code subagent; its words are the assistant `text` blocks of its own
 * transcript (`agent-<id>.jsonl`). Before LIN-4561 the kit posted none of them: Harbour saw a kit run
 * only through its status markers and recap. Now `runner wait` (the background long-poll, every poll)
 * sends each new complete text block as `assistant-text` feedback on the row, keyed from its position in
 * the transcript, and `runner usage` / `runner feedback` flush what is left before the run's recap and
 * marker. One sender at a time (a lock file with a lease), a saved queue resent until Harbour
 * acknowledges it, and Harbour's keyed append (LIN-4556) storing a key once.
 *
 * What this file proves, against a fake Harbour whose feedback route is the real validator and the real
 * `addFeedback` over MangoDB (so "stored once" is the store's answer, not a fake's):
 *  - the transcript grows during `wait` polls and then `usage`: each block is posted once, in order,
 *    keyed, before the `[done]` marker; a half-written last line is held back until it is complete;
 *    thinking and tool_use content are never posted (text only);
 *  - a post answered 503 is resent with the same key on the next poll and stored once, and a post
 *    stored whose reply was lost is resent with the same key and still stored once;
 *  - a `wait` and a `usage` running at once send each block once (on the wire, not only in the store);
 *  - `usage` with the lock held elsewhere waits a bounded time, leaves the words queued, and the next
 *    `wait` sends them;
 *  - `runner feedback <id> assistant-text …` is refused: the kit's sender is the one way the kind is posted.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4561-runner-kit-words.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';

import { runCommand, tokenFingerprint } from '../../lib/runner-kit/runner.mjs';
import { credentialStore } from '../../lib/runner-kit/broker.mjs';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { validateFeedbackBody } from '../../lib/dispatch-feedback-validation.js';

const TIMEOUT = { timeout: 30_000 };
const URL_KEY = 'acme';
const LABEL = 'runner-label';
const AGENT = 'a1b2c3d4e5';
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

const token = () => randomBytes(24).toString('base64url');

// ─── Transcript lines, as Claude Code writes a subagent's (every line a sidechain) ───────────────

const userLine = (text) => JSON.stringify({ type: 'user', isSidechain: true, uuid: randomUUID(), message: { role: 'user', content: text } });
const textLine = (text, extra = {}) => JSON.stringify({
  type: 'assistant', isSidechain: true, uuid: randomUUID(),
  message: { id: `msg_${randomUUID().slice(0, 8)}`, model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'text', text }] },
  ...extra
});
const thinkingLine = (thinking) => JSON.stringify({
  type: 'assistant', isSidechain: true, uuid: randomUUID(),
  message: { id: 'msg_think', model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'thinking', thinking }] }
});
const toolLine = (command) => JSON.stringify({
  type: 'assistant', isSidechain: true, uuid: randomUUID(),
  message: { id: 'msg_tool', model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command } }] }
});
const syntheticLine = (text) => JSON.stringify({
  type: 'assistant', isSidechain: true, uuid: randomUUID(),
  message: { id: 'msg_syn', model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] }
});

// ─── A fake Harbour whose feedback route is the real validator and the real keyed append ─────────

async function harbourOver(client) {
  const db = client.db(`lin4561_${randomUUID().replace(/-/g, '')}`);
  const history = db.collection('dispatch-history');
  const store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
  const state = {
    runnerToken: token(),
    posts: [], // every feedback POST on the wire: { itemId, body, status }
    faults: [], // per-post fault, consumed in order: 'refuse-503' (not stored) | 'lose-reply' (stored, then 503)
    delayMs: 0
  };
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (req.headers.authorization !== `Bearer ${state.runnerToken}`) return json(res, 401, { error: 'unauthorized' });
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/api/proxy/runner/poll') return json(res, 200, { items: [] });
    let m;
    if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/proxy\/dispatch\/([^/]+)$/))) return json(res, 200, { id: m[1], status: 'taken' });
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/proxy\/runner\/feedback\/(.+)$/))) {
      const body = JSON.parse(raw);
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      const fault = state.faults.shift();
      const record = (status) => { state.posts.push({ itemId: m[1], body, status }); };
      if (fault === 'refuse-503') { record(503); return json(res, 503, { error: 'store unavailable' }); }
      const checked = validateFeedbackBody(body);
      if (checked.error) { record(checked.status ?? 400); return json(res, checked.status ?? 400, { error: checked.error }); }
      const result = await store.addFeedback(m[1], URL_KEY, checked.value, LABEL, null, { takenByTokenId: 'tok-runner' });
      if (!result) { record(404); return json(res, 404, { error: 'not taken' }); }
      if (fault === 'lose-reply') { record(503); return json(res, 503, { error: 'reply lost' }); }
      record(200);
      return json(res, 200, result);
    }
    return json(res, 404, { error: `no route ${req.method} ${url.pathname}` });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    base: `http://127.0.0.1:${server.address().port}`,
    async seedTaken(itemId) {
      await history.insertOne({ _id: itemId, urlKey: URL_KEY, status: 'taken', takenByTokenLabel: LABEL, takenByTokenId: 'tok-runner', feedback: [] });
    },
    async stored(itemId) { return (await history.findOne({ _id: itemId }))?.feedback ?? []; },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); })
  };
}

// ─── The runner's home, set up as `login` + `take` + `handoff` leave it ──────────────────────────

function seedHome(home, harbour, itemId, agentId = AGENT) {
  const dir = join(home, URL_KEY);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  credentialStore({ file: join(dir, 'runner.token') }).set(harbour.state.runnerToken);
  const tokenId = tokenFingerprint(harbour.state.runnerToken);
  writeFileSync(join(dir, 'runner.json'), JSON.stringify({
    baseUrl: harbour.base, urlKey: URL_KEY, ownerAccountId: 'acct-owner', tokenId, grants: ['take', 'dispatch'],
    expiresAt: new Date(Date.now() + 20 * 3600_000).toISOString()
  }), { mode: 0o600 });
  writeFileSync(join(dir, 'ledger.json'), JSON.stringify({
    items: { [itemId]: { itemId, agentId, rootItemId: itemId, continuedFrom: null, state: 'running', tokenId, takenAt: new Date().toISOString() } }
  }), { mode: 0o600 });
  const tdir = join(home, 'transcripts', 'proj', 'sess', 'subagents');
  mkdirSync(tdir, { recursive: true });
  return join(tdir, `agent-${agentId}.jsonl`);
}

const assistantTexts = (entries) => entries.filter((e) => e.kind === 'assistant-text').map((e) => e.message);

describe('LIN-4561: the runner kit posts its subagent\'s words mid-turn, keyed and in order', () => {
  let dbDir, client, harbour, home, itemId, transcript;
  const run = (argv, extra = {}) => runCommand([...argv, '--url-key', URL_KEY], {
    home, now: () => Date.now(), transcriptRoot: join(home, 'transcripts'), waitPollMs: 10, waitHeartbeatMs: 10, waitCapMs: 150, ...extra
  });

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin4561-db-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    if (harbour) await harbour.close();
    if (home) rmSync(home, { recursive: true, force: true });
    harbour = await harbourOver(client);
    home = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'rk4561-'));
    itemId = randomUUID();
    await harbour.seedTaken(itemId);
    transcript = seedHome(home, harbour, itemId);
  });
  after(async () => {
    if (harbour) await harbour.close();
    if (home) rmSync(home, { recursive: true, force: true });
  });

  test('the transcript grows during wait polls and then usage: each block once, in order, keyed, before [done]; a half line is held back', TIMEOUT, async () => {
    // Poll 1 sees one finished block, a thinking line, a tool call, and a text line still being written.
    const half = textLine('second block, now complete');
    writeFileSync(transcript, [userLine('do the step'), textLine('first block'), thinkingLine('private reasoning'), toolLine('echo SECRET-TOOL-INPUT')].join('\n') + '\n' + half.slice(0, 40));
    await run(['wait']);
    assert.deepEqual(assistantTexts(await harbour.stored(itemId)), ['first block'], 'mid-turn: the finished block is stored; the half-written line is held back');

    // The line completes, and the run writes more, between polls.
    appendFileSync(transcript, half.slice(40) + '\n' + syntheticLine('No response requested.') + '\n' + textLine('third block') + '\n');
    await run(['wait']);
    assert.deepEqual(assistantTexts(await harbour.stored(itemId)), ['first block', 'second block, now complete', 'third block']);

    // The run ends: its last words, then the session's usage, recap and marker (docs/runner-prompt.md §4).
    appendFileSync(transcript, textLine('final words\nDONE: did the step') + '\n');
    await run(['usage', AGENT]);
    await run(['feedback', itemId, 'recap', 'It did the step.']);
    await run(['feedback', itemId, 'status', '[done] did the step']);

    const stored = await harbour.stored(itemId);
    assert.deepEqual(assistantTexts(stored), ['first block', 'second block, now complete', 'third block', 'final words\nDONE: did the step']);
    const doneAt = stored.findIndex((e) => e.message === '[done] did the step');
    assert.ok(doneAt > -1);
    assert.ok(stored.every((e, i) => e.kind !== 'assistant-text' || i < doneAt), 'every word is stored before the [done] marker');
    const words = stored.filter((e) => e.kind === 'assistant-text');
    for (const e of words) {
      assert.match(e.key || '', KEY_RE, 'each word carries a key Harbour accepts');
      assert.equal(e.rootItemId, itemId, 'each word carries the lineage\'s rootItemId');
    }
    assert.equal(new Set(words.map((e) => e.key)).size, words.length, 'one key per block');
    // Text only: no thinking, no tool call input, no synthetic filler.
    const all = stored.map((e) => e.message).join('\n');
    assert.ok(!all.includes('private reasoning'));
    assert.ok(!all.includes('SECRET-TOOL-INPUT'));
    assert.ok(!all.includes('No response requested.'));
    // Once each on the wire too: nothing was resent after it was acknowledged.
    const sentKeys = harbour.state.posts.filter((p) => p.body.kind === 'assistant-text').map((p) => p.body.key);
    assert.equal(sentKeys.length, new Set(sentKeys).size);
  });

  test('a post answered 503 is resent with the same key on the next poll, and stored once', TIMEOUT, async () => {
    writeFileSync(transcript, [userLine('go'), textLine('alpha'), textLine('beta')].join('\n') + '\n');
    harbour.state.faults.push('refuse-503');
    await run(['wait']);
    const words = harbour.state.posts.filter((p) => p.body.kind === 'assistant-text');
    assert.equal(words[0].status, 503);
    assert.equal(words[1].body.message, 'alpha', 'the failed post is the next one sent: order holds');
    assert.equal(words[1].body.key, words[0].body.key, 'the retry carries the same key');
    assert.deepEqual(assistantTexts(await harbour.stored(itemId)), ['alpha', 'beta']);
  });

  test('a post stored whose reply was lost is resent with the same key, and Harbour stores it once', TIMEOUT, async () => {
    writeFileSync(transcript, [userLine('go'), textLine('alpha'), textLine('beta')].join('\n') + '\n');
    harbour.state.faults.push('lose-reply');
    await run(['wait']);
    const alpha = harbour.state.posts.filter((p) => p.body.message === 'alpha');
    assert.ok(alpha.length >= 2, 'the unacknowledged post was resent');
    assert.equal(new Set(alpha.map((p) => p.body.key)).size, 1, 'with the same key');
    assert.deepEqual(assistantTexts(await harbour.stored(itemId)), ['alpha', 'beta'], 'stored once, in order');
  });

  test('a lost queue file replays the transcript with the same keys, and Harbour stores each block once', TIMEOUT, async () => {
    writeFileSync(transcript, [userLine('go'), textLine('alpha'), textLine('beta')].join('\n') + '\n');
    await run(['wait']);
    rmSync(join(home, URL_KEY, 'words', `${AGENT}.json`)); // the runner's home lost its words state
    await run(['wait']);
    const alpha = harbour.state.posts.filter((p) => p.body.message === 'alpha');
    assert.equal(alpha.length, 2, 'the replay resent the block');
    assert.equal(alpha[1].body.key, alpha[0].body.key, 'with the key its transcript position gives it');
    assert.deepEqual(assistantTexts(await harbour.stored(itemId)), ['alpha', 'beta'], 'stored once each');
  });

  test('a wait and a usage running at once send each block once, in order', TIMEOUT, async () => {
    const blocks = ['one', 'two', 'three', 'four', 'five', 'six'];
    writeFileSync(transcript, [userLine('go'), ...blocks.map((b) => textLine(b))].join('\n') + '\n');
    harbour.state.delayMs = 15;
    await Promise.all([run(['wait'], { waitCapMs: 400, waitPollMs: 5 }), run(['usage', AGENT]), run(['usage', AGENT])]);
    const sent = harbour.state.posts.filter((p) => p.body.kind === 'assistant-text').map((p) => p.body.message);
    assert.deepEqual(sent, blocks, 'on the wire: each block once, in transcript order');
    assert.deepEqual(assistantTexts(await harbour.stored(itemId)), blocks);
  });

  test('usage with the lock held elsewhere waits a bounded time, leaves the words queued, and the next wait sends them', TIMEOUT, async () => {
    writeFileSync(transcript, [userLine('go'), textLine('held words')].join('\n') + '\n');
    const lockDir = join(home, URL_KEY, 'words');
    mkdirSync(lockDir, { recursive: true });
    const lock = join(lockDir, `${AGENT}.lock`);
    writeFileSync(lock, JSON.stringify({ by: 'another-sender', until: Date.now() + 60_000 }));
    const t0 = Date.now();
    const r = await run(['usage', AGENT], { wordsLockWaitMs: 100 });
    assert.ok(Date.now() - t0 < 5_000, 'usage did not wait out the other sender\'s lease');
    assert.equal(r.words.outcome, 'busy');
    assert.deepEqual(assistantTexts(await harbour.stored(itemId)), [], 'nothing sent while another sender holds the lock');
    rmSync(lock); // the other sender finishes
    await run(['wait']);
    assert.deepEqual(assistantTexts(await harbour.stored(itemId)), ['held words'], 'the queued words are sent by the next wait');
  });

  test('a long block is sent as (assistant-text i/n) chunks, each keyed, in order', TIMEOUT, async () => {
    const long = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
    writeFileSync(transcript, [userLine('go'), textLine(long)].join('\n') + '\n');
    await run(['wait']);
    const words = (await harbour.stored(itemId)).filter((e) => e.kind === 'assistant-text');
    assert.ok(words.length >= 2);
    words.forEach((e, i) => assert.ok(e.message.startsWith(`(assistant-text ${i + 1}/${words.length})\n`), e.message.slice(0, 40)));
    assert.equal(new Set(words.map((e) => e.key)).size, words.length);
    assert.equal(words.map((e) => e.message.replace(/^\(assistant-text \d+\/\d+\)\n/, '')).join(''), long, 'the chunks put back together are the block, whole');
  });

  test('runner feedback <id> assistant-text … is refused: the kit\'s sender is the one way the kind is posted', TIMEOUT, async () => {
    await assert.rejects(run(['feedback', itemId, 'assistant-text', 'my own words']), /assistant-text/);
    assert.deepEqual(harbour.state.posts.filter((p) => p.body.kind === 'assistant-text'), []);
  });
});
