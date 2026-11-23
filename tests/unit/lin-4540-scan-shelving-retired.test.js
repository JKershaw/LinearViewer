/**
 * LIN-4540 (LIN-4529 P7b-1): the comment scan and shelving are gone with their routes, jobs, page and tests, and no code
 * reads their collection. The shelved-rulings collection stays as history: it is still listed in the erasure inventory
 * (lib/account-erasure.js INVENTORY), the dry run's URLKEY_SOURCES and the urlkey-holders COLLECTION_CLASSES, each with
 * its reason, so an erasure still reaches a workspace's old shelves. Nothing else opens or names it.
 *
 * The scan had no collection of its own: it wrote task decisions (lib/task-decisions-store.js, still read by the ruling
 * predicate until LIN-4541 retires it) and read the Harbour-comments ledger, which stays for the comment ingest.
 *
 * The retired words themselves (module names, routes, jobs, page selectors) are pinned by the slice's census,
 * tests/unit/lin-4529-retirement-census.test.js. This file pins what a word list cannot: the collection is opened by
 * nothing, the modules are not on disk, and the jobs are not in the registry.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectionNames } from '../helpers/collection-names.js';
import { INVENTORY } from '../../lib/account-erasure.js';
import { URLKEY_SOURCES } from '../../scripts/dry-run-urlkey-duplicates.mjs';
import { JOB_IDS } from '../../lib/llm-jobs.js';
import { AI_OPERATION_KINDS } from '../../lib/model-routing.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The collection shelving kept, now history. */
const HISTORY_COLLECTION = 'shelved-rulings';

/** The files that may name it, each with its reason: the history tables an erasure and the dry run read. */
const NAMED_BY = Object.freeze({
  'lib/account-erasure.js': 'INVENTORY: a Full wipe still takes a workspace\'s old shelves',
  'scripts/dry-run-urlkey-duplicates.mjs': 'URLKEY_SOURCES: the no-holder count still reads the old rows\' urlKey',
});

/** The modules this piece deleted. */
const DELETED = Object.freeze(['lib/scan.js', 'lib/scan-fingerprint.js', 'routes/workspace-api-scan.js', 'public/scan.js', 'lib/shelved-rulings-store.js']);

/** Live code: what runs. Tests, docs and recorded fixtures are not code that reads a collection. */
const LIVE_ROOTS = ['lib', 'routes', 'public', 'scripts'];

function liveFiles() {
  const out = [join(ROOT, 'server.js')];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== 'node_modules' && name !== 'fixtures') walk(full); }
      else if (/\.(m?js|html)$/.test(name)) out.push(full);
    }
  };
  for (const root of LIVE_ROOTS) walk(join(ROOT, root));
  return out.map((full) => ({ file: relative(ROOT, full), text: readFileSync(full, 'utf8') }));
}

/** The files whose text names `collection` as a quoted string: `'name'`, `"name"` or `` `name` ``. Pure over the text. */
export function namersOf(files, collection) {
  const quoted = new RegExp(`['"\`]${collection.replace(/[-]/g, '\\-')}['"\`]`);
  return files.filter(({ text }) => quoted.test(text)).map(({ file }) => file).sort();
}

describe('LIN-4540: no code reads the shelved-rulings collection; it stays as history', () => {
  test('no module opens it: the collection universe derived from code does not hold it', () => {
    assert.equal(collectionNames().names.has(HISTORY_COLLECTION), false, 'a collection(\'shelved-rulings\') opening came back');
  });

  test('only the history tables name it, each with its reason', () => {
    assert.deepEqual(namersOf(liveFiles(), HISTORY_COLLECTION), Object.keys(NAMED_BY).sort());
  });

  test('it is still in INVENTORY with a reason, and in URLKEY_SOURCES, so an erasure still reaches it', () => {
    const row = INVENTORY.find((r) => r.collection === HISTORY_COLLECTION);
    assert.ok(row, 'INVENTORY lists it');
    assert.match(row.reason || '', /history/);
    assert.ok(URLKEY_SOURCES.some((s) => s.collection === HISTORY_COLLECTION), 'URLKEY_SOURCES lists it');
  });

  test('the matcher sees each quoting, and only the exact name', () => {
    const files = [
      { file: 'a.js', text: "db.collection('shelved-rulings')" },
      { file: 'b.js', text: 'const c = "shelved-rulings";' },
      { file: 'c.js', text: 'x(`shelved-rulings`)' },
      { file: 'd.js', text: '// the shelved-rulings collection is history' },
      { file: 'e.js', text: "'shelved-rulings-v2'" },
    ];
    assert.deepEqual(namersOf(files, HISTORY_COLLECTION), ['a.js', 'b.js', 'c.js']);
  });
});

describe('LIN-4540: the scan and shelving modules and jobs are gone', () => {
  test('the deleted modules are not on disk', () => {
    assert.deepEqual(DELETED.filter((f) => existsSync(join(ROOT, f))), []);
  });

  test('the scan jobs are not registered, and the scan is not an AI operation a person can route', () => {
    assert.deepEqual(JOB_IDS.filter((id) => id === 'scan' || id === 'scan-retire'), []);
    assert.equal(AI_OPERATION_KINDS.includes('scan'), false);
  });
});
