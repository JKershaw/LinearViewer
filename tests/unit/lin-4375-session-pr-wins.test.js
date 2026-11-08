/**
 * LIN-4375 (blocking LIN-4347): the leftover step names the PR the build opened, and
 * queues once.
 *
 * 1. `prUrlOfFeedback` reads the session's own report first: a PR URL on its `DONE:`
 *    line (relayed assistant text) or in a `[done]` message wins over the `[done]`
 *    entry's `url`, which older runners filled with the PR mentioned most often. The
 *    witness is LIN-4374's build: it read #2357 26 times, opened #2359 and reported
 *    #2359 on its `DONE:` line, and its leftover prompt and parent wake named #2357.
 * 2. Two `[done]` posts on one build row at the same moment queue exactly one
 *    `leftover` row (`claimLeftoverFor`), and the build still wakes the parent once.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createLeftoverStep } from '../../lib/dispatch-leftover-hook.js';
import { lineagePrUrl, LEFTOVERS_HEADING } from '../../lib/dispatch-leftover.js';
import { prUrlOfFeedback } from '../../lib/dispatch-wake.js';

const READ_PR = 'https://github.com/JKershaw/LinearViewer/pull/2357';
const OWN_PR = 'https://github.com/JKershaw/LinearViewer/pull/2359';

/** The tail of LIN-4374's build feedback, in the order the runner posted it. */
function lin4374Tail({ doneUrl = READ_PR } = {}) {
  return [
    { kind: 'assistant-text', message: `Read the parent's comments on ${READ_PR}.`, url: null },
    { kind: 'assistant-text', message: `DONE: LIN-4374 leftovers are pushed to PR ${OWN_PR} at head e92c3a7f, with CI green.`, url: null },
    { kind: 'evidence', message: '[evidence] Pull request · 26 mentions', url: READ_PR },
    { kind: 'evidence', message: '[evidence] Pull request · 22 mentions (in recap)', url: OWN_PR },
    { kind: 'status', message: '[done] Task completed in 30m 2s', url: doneUrl }
  ];
}

describe('LIN-4375 — prUrlOfFeedback: the session-reported PR wins', () => {
  test("LIN-4374's shape: the DONE: line's #2359 wins over the [done] url #2357 (mentioned more often)", () => {
    assert.equal(prUrlOfFeedback(lin4374Tail()), OWN_PR);
  });

  test("a [done] message's own PR wins over that entry's disagreeing url", () => {
    assert.equal(prUrlOfFeedback([{ message: `[done] Built LIN-7. PR ${OWN_PR} is green.`, url: READ_PR }]), OWN_PR);
  });

  test('the newest DONE: line wins over an older one', () => {
    assert.equal(prUrlOfFeedback([
      { message: `DONE: opened ${READ_PR}` },
      { message: `DONE: superseded by ${OWN_PR}` }
    ]), OWN_PR);
  });

  test('a PR mentioned mid-line beside the word DONE is not a report; only a line that starts with it is', () => {
    assert.equal(prUrlOfFeedback([
      { message: `Not DONE: yet, see ${READ_PR}`, url: null },
      { message: '[done] Task completed', url: OWN_PR }
    ]), OWN_PR);
  });

  test('with no report line naming a PR it falls back as before: newest url, then message', () => {
    assert.equal(prUrlOfFeedback([{ message: 'DONE: built it' }, { message: '[done] Task completed', url: OWN_PR }]), OWN_PR);
    assert.equal(prUrlOfFeedback([{ message: `see ${READ_PR}` }, { message: '[done] Task completed' }]), READ_PR);
    assert.equal(prUrlOfFeedback([]), null);
    assert.equal(prUrlOfFeedback(undefined), null);
  });

  test('lineagePrUrl over the build row names the opened PR', () => {
    assert.equal(lineagePrUrl([{ feedback: lin4374Tail() }]), OWN_PR);
  });
});

// ─── Store-level ─────────────────────────────────────────────────────────────

const URL_KEY = 'acme';
const TOKEN = 'token-a';
const OWNER = 'account-owner';
const WORKSPACE = 'ws-1';

function makeWorld({ enqueue } = {}) {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  const world = { store, collection, historyCollection, logs: [] };
  const step = createLeftoverStep({
    dispatchStore: store,
    ownerCheck: async () => ({ status: 'owner' }),
    haltReader: async () => null,
    resolveWorkspaceId: async () => WORKSPACE,
    log: (line) => world.logs.push(line),
    ...(enqueue ? { enqueue } : {})
  });
  world.hook = step.forRequest({ baseUrl: 'https://harbour.test', workspaceId: WORKSPACE });
  return world;
}

async function runAndBuild(world) {
  const a = await world.store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-7', dispatchedBy: OWNER });
  await world.store.takeItem(a._id, URL_KEY, 'orchestrator');
  const b = await world.store.addItem(URL_KEY, {
    prompt: 'build it', kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
    target: 'cli', dispatchedBy: OWNER, subscription: 'terminal-only', sessionId: a._id
  });
  await world.store.takeItem(b._id, URL_KEY, TOKEN);
  return { a, b };
}

const post = (world, row, entry) =>
  world.store.addFeedback(row._id, URL_KEY, entry, TOKEN, undefined, { leftoverHook: world.hook });

const all = (world) => [...world.collection._docs, ...world.historyCollection._docs];
const wakesTo = (world, runId) => all(world).filter(d => d.kind === 'wake' && d.followUpTo === runId);
const leftovers = (world) => all(world).filter(d => d.kind === 'leftover');

describe('LIN-4375 — the leftover prompt and the held wake name the opened PR', () => {
  test("a build that read another PR more often: the leftover prompt names its own PR, and so does the released wake", async () => {
    const world = makeWorld();
    const { a, b } = await runAndBuild(world);
    for (const entry of lin4374Tail()) await post(world, b, entry);

    const [row] = leftovers(world);
    assert.ok(row, `a leftover row is queued; logs ${JSON.stringify(world.logs)}`);
    assert.ok(row.prompt.includes(OWN_PR), 'the leftover prompt names the PR the build opened');
    assert.ok(!row.prompt.includes(READ_PR), 'and not the PR it only read');

    // Cancel the leftover row: the release wakes the parent with the build's outcome and its PR.
    await world.store.removeItem(URL_KEY, row._id);
    const [wake] = wakesTo(world, a._id);
    assert.ok(wake, 'the release wakes the parent');
    assert.ok(wake.prompt.includes(OWN_PR), 'the held wake names the PR the build opened');
  });
});

describe('LIN-4375 — two concurrent [done] posts on one build queue one leftover', () => {
  const DONE = { message: `[done] Built LIN-7. PR ${OWN_PR} is green.` };

  test('exactly one leftover row, no parent wake yet; its [done] then wakes the parent once', async () => {
    const world = makeWorld();
    const { a, b } = await runAndBuild(world);
    await Promise.all([post(world, b, DONE), post(world, b, DONE)]);

    assert.equal(leftovers(world).length, 1, `exactly one leftover row; logs ${JSON.stringify(world.logs)}`);
    assert.equal(wakesTo(world, a._id).length, 0, 'the build wake is held by both posts');
    assert.ok(world.logs.some(l => l === `[leftover] hold item=${b._id} claim-lost`), JSON.stringify(world.logs));

    const row = world.collection._docs.find(d => d.kind === 'leftover');
    await world.store.takeItem(row._id, URL_KEY, TOKEN);
    await post(world, row, { message: `[done] ${LEFTOVERS_HEADING}: nothing` });
    assert.equal(wakesTo(world, a._id).length, 1, 'the leftover answer wakes the parent once');
  });

  test('the claim winner whose enqueue fails still wakes the parent, once; the loser holds', async () => {
    const world = makeWorld({ enqueue: async () => ({ status: 503, body: { code: 'OWNER_CHECK_UNAVAILABLE' } }) });
    const { a, b } = await runAndBuild(world);
    await Promise.all([post(world, b, DONE), post(world, b, DONE)]);

    assert.equal(leftovers(world).length, 0);
    assert.equal(wakesTo(world, a._id).length, 1, 'one wake: the winner skipped, the loser held');
  });

  test('claimLeftoverFor: the first claim wins, every later one loses', async () => {
    const world = makeWorld();
    const { b } = await runAndBuild(world);
    assert.equal(await world.store.claimLeftoverFor(URL_KEY, b._id), true);
    assert.equal(await world.store.claimLeftoverFor(URL_KEY, b._id), false);
    assert.equal(await world.store.claimLeftoverFor('other', b._id), false, 'scoped to the workspace');
  });
});
