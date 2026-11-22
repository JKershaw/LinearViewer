/**
 * LIN-4492 (plan decision 1): a dispatch row's id is allocated before its prompt is finalized, so the prompt
 * can name it and every credential minted for it can carry it. These tests drive the real factory and the
 * real queue store on mock collections.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { startsRun, runRecordIdFor, withAutopilotSessionHeading } from '../../lib/run-identity.js';
import { buildProxyContextPreamble, attachProxyContext } from '../../lib/proxy-preamble.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';

function makeStore() {
  return new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
}

/** Dispatch through the real factory, recording the id and run the factory hands the finalizer. */
async function dispatch(store, { kind, prompt = 'BODY', fields = {}, followUpTo = undefined, personOriginated = false } = {}) {
  const seen = { ids: null, harness: undefined };
  const item = await createDispatchItem({
    store,
    urlKey: URL_KEY,
    kind,
    prompt,
    applyDefaultHarness: false,
    personOriginated,
    fields: { promptName: kind || 'custom', ...(followUpTo ? { followUpTo } : {}), ...fields },
    finalizePrompt: async (harness, resolvedKind, ids) => {
      seen.ids = ids;
      return { prompt: `${prompt}\nyour id: ${ids.id}` };
    }
  });
  return { item, ids: seen.ids };
}

describe('LIN-4492: which rows start a run', () => {
  test('every stage kind, the leftover and the periodical row start one', () => {
    for (const kind of ['implementation', 'plan', 'review', 'close-out', 'blind-read', 'triage', 'retro', 'leftover', 'periodical']) {
      assert.equal(startsRun(kind), true, kind);
    }
  });

  test('kind-less custom and work rows, collective, chat and wake start none', () => {
    for (const kind of ['custom', 'work', 'wake', 'collective', 'chat', '', null, undefined]) {
      assert.equal(startsRun(kind), false, String(kind));
    }
  });

  test('a run is the row\'s own id when it starts one; a custom resume carries the run it resumes', () => {
    assert.equal(runRecordIdFor({ kind: 'implementation', id: 'row-1', resumedRunRecordId: 'old' }), 'row-1');
    assert.equal(runRecordIdFor({ kind: 'custom', id: 'row-2', resumedRunRecordId: 'build-1' }), 'build-1');
    assert.equal(runRecordIdFor({ kind: 'custom', id: 'row-3', resumedRunRecordId: null }), null);
    // LIN-4531: a fresh autopilot kickoff starts its own run; its follow-up belongs to the run it resumes.
    assert.equal(runRecordIdFor({ kind: 'autopilot', id: 'row-4', resumedRunRecordId: null }), 'row-4');
    assert.equal(runRecordIdFor({ kind: 'autopilot', id: 'row-5', resumedRunRecordId: 'row-4', followUpTo: 'row-4' }), 'row-4');
  });
});

describe('LIN-4492: the id comes before the prompt, and the run is the row', () => {
  test('a stage row takes the id the finalizer was handed, and that id is its run', async () => {
    const store = makeStore();
    const { item, ids } = await dispatch(store, { kind: 'implementation', fields: { issueIdentifier: 'LIN-1' } });

    assert.ok(ids && typeof ids.id === 'string', 'the finalizer is handed the id');
    assert.equal(item._id, ids.id, 'the row takes that id');
    assert.equal(ids.runRecordId, ids.id, 'and that id is its run');
    assert.equal(item.runRecordId, ids.id);
  });

  test('the prompt names the id before the row exists, and the stored prompt carries the same id', async () => {
    const store = makeStore();
    const { item, ids } = await dispatch(store, { kind: 'implementation' });

    assert.ok(item.prompt.includes(`your id: ${ids.id}`), 'the finalized prompt named the id');
    assert.equal(item._id, ids.id);
  });

  test('an autopilot kickoff starts its run (LIN-4531): its run is its own id, and that id comes first', async () => {
    const store = makeStore();
    const { item, ids } = await dispatch(store, { kind: 'autopilot', prompt: 'You are Autopilot.' });

    assert.equal(ids.runRecordId, ids.id, 'the kickoff is its own run, so it can file a question');
    assert.equal(item._id, ids.id);
    assert.equal(item.runRecordId, ids.id);
  });

  test('the kickoff\'s session-id block is the same bytes as before, and names the row id', async () => {
    const store = makeStore();
    const { item, ids } = await dispatch(store, { kind: 'autopilot', prompt: 'BODY' });

    const expected = [
      'BODY',
      '',
      '---',
      '',
      '## Your autopilot session id',
      '',
      `This run's own dispatch id — your **session id** — is \`${ids.id}\`. This is the`,
      'id to use: it **overrides any other session id mentioned earlier in this prompt**',
      "(e.g. a standalone kickoff's placeholder, minted before this dispatch existed). Pass",
      `\`${ids.id}\` as \`sessionId\` on **every** worker dispatch you issue this run: every`,
      '`POST /recommend-and-dispatch`, every plain `POST /dispatch`, and any `followUpTo`',
      'liveness nudge. That explicit link is what groups all the work you spawn into this',
      'one autopilot session.'
    ].join('\n');
    // The finalized prompt (naming the id) followed by the block the factory appends after the pilot.
    assert.equal(item.prompt, withAutopilotSessionHeading(`BODY\nyour id: ${ids.id}`, ids.id));
    assert.equal(withAutopilotSessionHeading('BODY', ids.id), expected);
  });

  test('a follow-up of an autopilot run is not a run root: no heading, and it belongs to the kickoff\'s run', async () => {
    const store = makeStore();
    const kickoff = (await dispatch(store, { kind: 'autopilot', prompt: 'kickoff' })).item;
    await store.takeItem(kickoff._id, URL_KEY, 'token-a');
    const note = await createDispatchItem({
      store,
      urlKey: URL_KEY,
      kind: 'autopilot',
      prompt: 'a note',
      applyDefaultHarness: false,
      fields: { promptName: 'autopilot', followUpTo: kickoff._id, queueIfBusy: true },
      finalizePrompt: async (h, k, ids) => ({ prompt: 'a note' })
    });
    assert.equal(note.prompt, 'a note');
    assert.equal(note.runRecordId, kickoff.runRecordId, 'the note is a message into the run it resumes');
    assert.notEqual(note.runRecordId, note._id, 'and it starts no run of its own');
  });
});

describe('LIN-4492: a follow-up belongs to the run it resumes, or to its own', () => {
  test('a custom resume carries the parent stage row\'s run', async () => {
    const store = makeStore();
    const parent = (await dispatch(store, { kind: 'implementation' })).item;
    const { item, ids } = await dispatch(store, { kind: 'custom', followUpTo: parent._id });

    assert.equal(ids.runRecordId, parent.runRecordId, 'the resumed run');
    assert.equal(item.runRecordId, parent.runRecordId);
  });

  test('a stage follow-up (a fresh leftover or review) starts its own run', async () => {
    const store = makeStore();
    const parent = (await dispatch(store, { kind: 'implementation' })).item;
    const { item, ids } = await dispatch(store, { kind: 'leftover', followUpTo: parent._id });

    assert.equal(ids.runRecordId, ids.id);
    assert.equal(item.runRecordId, item._id);
    assert.notEqual(item.runRecordId, parent.runRecordId);
  });
});

describe('LIN-4492: the run is never read from a body, and survives the queue', () => {
  test('a body-supplied runRecordId and _id are ignored', async () => {
    const store = makeStore();
    const { item, ids } = await dispatch(store, {
      kind: 'implementation',
      fields: { runRecordId: 'forged-run', _id: 'forged-id' }
    });

    assert.notEqual(item._id, 'forged-id');
    assert.equal(item._id, ids.id);
    assert.equal(item.runRecordId, ids.id, 'the run is the row itself, not the body\'s value');
  });

  test('a body-supplied run on a run-less row is dropped, not kept', async () => {
    const store = makeStore();
    const { item } = await dispatch(store, { kind: 'custom', fields: { runRecordId: 'forged-run' } });

    assert.equal('runRecordId' in item, false);
  });

  test('the run is readable from the status read, and is kept when the row is taken', async () => {
    const store = makeStore();
    const { item } = await dispatch(store, { kind: 'implementation', fields: { issueIdentifier: 'LIN-2' } });

    const queued = await store.getItemStatus(URL_KEY, item._id);
    assert.equal(queued.runRecordId, item._id, 'the queued read carries the run');

    await store.takeItem(item._id, URL_KEY, 'token-b');
    const archived = await store.getItemStatus(URL_KEY, item._id);
    assert.equal(archived.runRecordId, item._id, 'the history read carries the run');
  });
});

describe('LIN-4492: the preamble names the run', () => {
  test('a run-bearing block names it; a block with no run does not', () => {
    const withRun = buildProxyContextPreamble({ baseUrl: 'https://h.example', token: 't', runRecordId: 'run-9' });
    assert.ok(withRun.includes('Your run: run-9.\n'));

    const noRun = buildProxyContextPreamble({ baseUrl: 'https://h.example', token: 't' });
    assert.equal(noRun.includes('Your run:'), false);
  });
});

describe('LIN-4492: a credential minted through the factory carries its row\'s run (store boundary)', () => {
  test('a launch mints its token with origin dispatch and the row\'s own id as its run', async () => {
    const store = makeStore();
    const tokens = new ProxyTokenStore({ collection: createMockCollection() });
    const minted = [];
    const realCreate = tokens.createToken.bind(tokens);
    tokens.createToken = async (urlKey, options) => { minted.push(options); return realCreate(urlKey, options); };

    const item = await createDispatchItem({
      store,
      urlKey: URL_KEY,
      kind: 'implementation',
      prompt: 'BODY',
      applyDefaultHarness: false,
      proxyTokenStore: tokens,
      fields: { promptName: 'implementation', issueIdentifier: 'LIN-9' },
      finalizePrompt: (harness, kind, ids) => attachProxyContext({
        proxyTokenStore: tokens,
        urlKey: URL_KEY,
        baseUrl: 'https://h.example',
        issueIdentifier: 'LIN-9',
        prompt: 'BODY',
        harness,
        createdBy: 'acct-1',
        runRecordId: ids.runRecordId
      })
    });

    assert.equal(minted.length, 1, 'exactly one credential was minted for the launch');
    assert.equal(minted[0].origin, 'dispatch');
    assert.equal(minted[0].runRecordId, item._id, 'the token names the row, which is its run');
    assert.equal(minted[0].createdBy, 'acct-1');
  });
});
