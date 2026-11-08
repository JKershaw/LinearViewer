/**
 * LIN-4381 (plan-review b79ff49e, B1): `issueIdentifier` survives the periodicals
 * route's real reads.
 *
 * The self-trigger exclusion ignores a landing whose issue a Periodical row
 * names. The route reads rows under PERIODICAL_PROJECTION (queue) and
 * PERIODICAL_HISTORY_PROJECTION (history), which are inclusion projections. A
 * field they don't grant arrives empty, so the exclusion would match nothing.
 * This runs on a real MangoDB engine, which honours inclusion projections (the
 * mock collection does not). The last case shows the vehicle can fail.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { PERIODICAL_PROJECTION, PERIODICAL_HISTORY_PROJECTION, DispatchQueueStore } from '../../lib/dispatch-store.js';

const URL_KEY = 'acme';

describe('LIN-4381: PERIODICAL_PROJECTION carries issueIdentifier', () => {
  let client;
  let dbDir;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin-4381-projection-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`lin_4381_${counter++}`);
    return new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history')
    });
  }

  // A Stage-2 row: it names the review issue and carries the periodicalId stamp.
  const stageTwo = {
    prompt: 'run the review',
    promptName: 'review',
    kind: 'review',
    periodicalId: 'documentation-review',
    issueIdentifier: 'LIN-900'
  };

  test('both projections grant it, the history one by inheritance', () => {
    assert.equal(PERIODICAL_PROJECTION.issueIdentifier, 1);
    assert.equal(PERIODICAL_HISTORY_PROJECTION.issueIdentifier, 1);
  });

  test('a queue row read under PERIODICAL_PROJECTION reads back its issueIdentifier', async () => {
    const store = freshStore();
    await store.addItem(URL_KEY, stageTwo);
    const [row] = await store.listItems(URL_KEY, { projection: PERIODICAL_PROJECTION });
    assert.equal(row.issueIdentifier, 'LIN-900');
    assert.equal(row.periodicalId, 'documentation-review');
  });

  test('a history row read the route\'s way (history projection + periodicalEvidenceRow) reads back its issueIdentifier', async () => {
    const store = freshStore();
    const created = await store.addItem(URL_KEY, stageTwo);
    await store.takeItem(created._id, URL_KEY, 'token-a');
    const { items } = await store.listHistory(URL_KEY, {
      since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      projection: PERIODICAL_HISTORY_PROJECTION,
      periodicalEvidenceRow: true
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].issueIdentifier, 'LIN-900');
  });

  test('the same history row under the projection without issueIdentifier loses it (the vehicle can fail)', async () => {
    const store = freshStore();
    const created = await store.addItem(URL_KEY, stageTwo);
    await store.takeItem(created._id, URL_KEY, 'token-a');
    const { issueIdentifier, ...withoutIt } = PERIODICAL_HISTORY_PROJECTION;
    assert.equal(issueIdentifier, 1);
    const { items } = await store.listHistory(URL_KEY, { limit: 100, projection: withoutIt });
    assert.equal(items.length, 1);
    assert.ok(items[0].issueIdentifier == null, `expected no issueIdentifier, got ${items[0].issueIdentifier}`);
    assert.equal(items[0].periodicalId, 'documentation-review');
  });
});
