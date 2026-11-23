/**
 * LIN-4538 (LIN-4529 P7a): after this piece, nothing outside the ruling machinery and the old answer path imports the old
 * ruling modules. The witness the plan names: a search for imports of lib/unanswered-decisions.js and the three ruling stores
 * (lib/task-decisions-store.js, lib/shelved-rulings-store.js, lib/dismissal-suggestions-store.js) finds only the machinery
 * itself and the old answer path.
 *
 * The allowance is the list below, each with its reason. P7b (after the cutover gate) deletes these modules and their
 * importers together, so an entry is removed with the file it names. A new importer fails this test until it is either a
 * reader moved onto question and decision records (lib/records/question-facts.js, lib/open-questions.js) or named here with
 * a reason.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The old ruling modules. `unanswered-decisions` is the predicate; the other three are the stores it stitches together. */
const OLD_MODULES = Object.freeze([
  'unanswered-decisions',
  'task-decisions-store',
  'shelved-rulings-store',
  'dismissal-suggestions-store',
]);

/** Live code the witness searches. Experiments, docs and recorded fixtures are history, not code that runs. */
const SEARCHED = ['lib', 'routes', 'scripts', 'public'];

/** Importers that stay until P7b, each with the reason it stays. */
export const ALLOWED_IMPORTERS = Object.freeze({
  'lib/dismissal-suggestions-store.js': 'machinery: the suggestion store reads the predicate; retired with the ruling stores in P7b',
  'routes/proxy-rulings.js': 'machinery: the agents\' rulings route and its suggest routes; retired in P7b (LIN-4541)',
  'routes/dashboard-rulings.js': 'old answer path: the Rulings page feed and its answer, dismiss and keep routes; retired with the page in P7b (shelve went in LIN-4540)',
  'routes/workspace-api-issue-write.js': 'old answer path: answers posted as comments and the task-decision outcome; retired in P7b',
  'server.js': 'wiring: constructs the ruling stores for the routes above; the constructors go with them in P7b',
});

/** Every .js and .mjs file under the searched roots, plus server.js. */
function liveFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(name)) out.push(full);
    }
  };
  for (const root of SEARCHED) walk(join(ROOT, root));
  out.push(join(ROOT, 'server.js'));
  return out;
}

/** The old module a specifier names, or null: `./x.js`, `../lib/x.js` or `/lib/x.js` where x is one of OLD_MODULES. */
export function oldModuleOf(specifier) {
  const m = /(?:^|\/)([a-z-]+)\.js$/.exec(specifier);
  return m && OLD_MODULES.includes(m[1]) ? m[1] : null;
}

/** The importers in the given sources: `[{file, module}]`, one row per import of an old module. Pure over the text. */
export function oldImportersIn(files) {
  const rows = [];
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  for (const { file, text } of files) {
    for (const match of text.matchAll(pattern)) {
      const module = oldModuleOf(match[1]);
      if (module) rows.push({ file, module });
    }
  }
  return rows;
}

describe('LIN-4538: the old ruling modules are imported only by the machinery and the old answer path', () => {
  test('no live importer outside the allowance', () => {
    const files = liveFiles().map((full) => ({ file: relative(ROOT, full), text: readFileSync(full, 'utf8') }));
    const importers = [...new Set(oldImportersIn(files).map((r) => r.file))].sort();
    const unexpected = importers.filter((f) => !Object.hasOwn(ALLOWED_IMPORTERS, f));
    assert.deepEqual(unexpected, [], `a reader still imports an old ruling module; move it to question records or name it in ALLOWED_IMPORTERS: ${unexpected.join(', ')}`);
  });

  test('the allowance is exact: every named importer still imports an old module, so a removed import shrinks the list', () => {
    const files = liveFiles().map((full) => ({ file: relative(ROOT, full), text: readFileSync(full, 'utf8') }));
    const importers = new Set(oldImportersIn(files).map((r) => r.file));
    const stale = Object.keys(ALLOWED_IMPORTERS).filter((f) => !importers.has(f));
    assert.deepEqual(stale, [], `these allowed importers no longer import an old module; remove them from ALLOWED_IMPORTERS: ${stale.join(', ')}`);
  });

  test('the matcher sees each import form, and only the four old modules', () => {
    assert.equal(oldModuleOf('../lib/unanswered-decisions.js'), 'unanswered-decisions');
    assert.equal(oldModuleOf('./task-decisions-store.js'), 'task-decisions-store');
    assert.equal(oldModuleOf('./records/question-facts.js'), null);
    assert.equal(oldModuleOf('./open-questions.js'), null);
    const rows = oldImportersIn([{ file: 'x.js', text: "const m = await import('./shelved-rulings-store.js');\nimport { a } from '../lib/dismissal-suggestions-store.js';" }]);
    assert.deepEqual(rows.map((r) => r.module).sort(), ['dismissal-suggestions-store', 'shelved-rulings-store']);
  });
});
