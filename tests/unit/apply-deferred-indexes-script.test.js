/**
 * Unit tests for scripts/apply-deferred-indexes.mjs (LIN-3811).
 * Run with: node --test tests/unit/apply-deferred-indexes-script.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { parseArgs, main, exitCodeOf, DeferredIndexError } from '../../scripts/apply-deferred-indexes.mjs';
import { INDEX_SPECS, tierOf, deferredIndexState } from '../../lib/db-indexes.js';

const DEFERRED = INDEX_SPECS.filter((s) => tierOf(s) === 'deferred');

describe('apply-deferred-indexes script', () => {
  let dir;
  let client;
  const logger = () => {
    const out = { log: [], error: [], warn: [] };
    return { out, log: (m) => out.log.push(m), error: (m) => out.error.push(m), warn: (m) => out.warn.push(m) };
  };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'deferred-script-'));
    client = new MangoClient(dir);
    await client.connect();
  });
  after(async () => {
    await client.close?.();
    rmSync(dir, { recursive: true, force: true });
  });
  const stateOf = () => deferredIndexState(client.db('linear-viewer'), { logger: logger() });
  // `main` closes the client it is given, so hand it a non-closing view of the shared one.
  const shared = () => ({ connect: async () => {}, db: (n) => client.db(n) });

  test('parseArgs: --plan is the default, --apply and --only parse, unknown args are refused', () => {
    assert.deepEqual(parseArgs([]), { apply: false, only: undefined });
    assert.deepEqual(parseArgs(['--apply', '--only', 'proxy-events:timestamp_1']), { apply: true, only: 'proxy-events:timestamp_1' });
    assert.throws(() => parseArgs(['--nope']), DeferredIndexError);
    assert.throws(() => parseArgs(['--only']), (e) => e.code === 4);
  });

  test('exit 2 when neither MONGODB_URI nor HARBOUR_DATA_DIR is set', async () => {
    const l = logger();
    assert.equal(await main([], {}, { logger: l }), 2);
  });

  test('--plan writes nothing', async () => {
    const l = logger();
    assert.equal(await main([], {}, { logger: l, client: shared() }), 0);
    assert.ok((await stateOf()).every((s) => s.built === false));
    assert.ok(l.out.log.some((m) => /plan only/.test(m)));
  });

  test('a bad --only exits 4 and builds nothing', async () => {
    const l = logger();
    assert.equal(await main(['--apply', '--only', 'nope:nope_1'], {}, { logger: l, client: shared() }), 4);
    assert.ok((await stateOf()).every((s) => s.built === false));
  });

  test('--apply --only builds one spec, then --apply builds the rest', async () => {
    assert.equal(await main(['--apply', '--only', 'proxy-events:timestamp_1'], {}, { logger: logger(), client: shared() }), 0);
    assert.equal((await stateOf()).filter((s) => s.built === true).length, 1);
    assert.equal(await main(['--apply'], {}, { logger: logger(), client: shared() }), 0);
    assert.ok((await stateOf()).every((s) => s.built === true));
    assert.equal((await stateOf()).length, DEFERRED.length);
  });

  test('exitCodeOf: only our own refusals carry a code', () => {
    assert.equal(exitCodeOf(new DeferredIndexError('x', 4)), 4);
    assert.equal(exitCodeOf(Object.assign(new Error('driver'), { code: 2 })), 1);
  });

  test('no auto-build env flag is read anywhere', () => {
    const src = readFileSync(new URL('../../scripts/apply-deferred-indexes.mjs', import.meta.url), 'utf8');
    assert.ok(!/HARBOUR_DEFERRED_INDEX_BUILD/.test(src));
  });
});

describe('server.js deferred-index wiring', () => {
  const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');

  test('the reporter is called inside app.listen, not awaited, and nothing builds deferred specs', () => {
    assert.ok(!/await\s+reportDeferredIndexes/.test(src));
    assert.ok(!/applyDeferredIndexes/.test(src));
    assert.ok(src.indexOf('reportDeferredIndexes(db)') > src.indexOf('app.listen(PORT'));
    assert.ok(!/HARBOUR_DEFERRED_INDEX_BUILD/.test(src));
  });
});
