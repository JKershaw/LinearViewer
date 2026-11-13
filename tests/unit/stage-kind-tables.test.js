/**
 * Every per-kind table that STAYS names every stage kind, or says why not (LIN-4437, the guard half of the Waiting
 * entry "a stage kind is a row in ~nine parallel tables"; docs/areas/llm-and-prompts.md).
 *
 * LIN-4467 made most of the per-kind tables views of one record per kind (lib/prompts/stage-kinds.js): a view
 * carries every kind by construction, and tests/unit/lin-4467-stage-kind-record.test.js checks the record's fields
 * and each view. What is left here is the tables that stay, each with its owner and reason:
 *   - STAGE_KINDS itself, the record every view reads (every kind is a key);
 *   - JOBS (lib/llm-jobs.js): pure data on purpose, so its census test is not vacuous (19 of its 39 rows are not
 *     template kinds);
 *   - the wall-clock bucket, the round-trip walk and the first-pass sets, which belong to Runs & dispatch (A13);
 *   - SPINE (lib/run-view.js): the fixed run-page spine;
 *   - the traits pin table (tests/unit/lin-4253-stage-traits.test.js PINNED): hand-typed on purpose, the one
 *     non-circular check of route and writes (read from the record it would check the record against itself);
 *   - the rendered byte ceilings (tests/unit/prompt-size-budget.test.js), which cover the registry.
 *
 * LIN-4466 adds a source scan below: outside lib/prompts/blind-read-words.js, the blind read's kind is a literal only
 * as a row key of a table listed in TABLES (or in the template registry), and its heading and verdict prose are never
 * typed. TABLES is that scan's table inventory, so a table is listed once.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { REPO, shippedSourceFiles } from './helpers/shipped-sources.js';
import { BLIND_READ_KIND, BLIND_READ_HEADING, BLIND_READ_VERDICT_PROSE, BLIND_READ_VERDICT_LIST } from '../../lib/prompts/blind-read-words.js';
import { PROMPT_TEMPLATES } from '../../lib/prompt-templates.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import { SPINE } from '../../lib/run-view.js';
import { BUCKET_OF_KIND } from '../../lib/wall-clock-summary.js';
import { JOBS } from '../../lib/llm-jobs.js';
import { FIRST_PASS_KINDS } from '../../lib/pipeline-churn.js';
import { OFF_SPINE_KINDS } from '../../lib/plan-review-round-trips.js';

const KINDS = Object.keys(PROMPT_TEMPLATES);
const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

/** The kinds a source block names as object keys (`kind:` or `'kind':`), between two markers. */
function keysInSource(path, from, to) {
  const text = read(path);
  const start = text.indexOf(from);
  assert.ok(start >= 0, `${path}: no "${from}"`);
  const end = text.indexOf(to, start + from.length);
  const block = text.slice(start, end === -1 ? undefined : end);
  return new Set([...block.matchAll(/^\s*'?([a-z][a-z-]*)'?\s*:/gm)].map(m => m[1]));
}

// The tables that stay: how to read the kinds each names, and the kinds it leaves out on purpose, with why.
const TABLES = {
  'STAGE_KINDS (lib/prompts/stage-kinds.js)': { has: (k) => Object.hasOwn(STAGE_KINDS, k) },
  'JOBS (lib/llm-jobs.js)': { has: (k) => JOBS.some(j => j.id === k) },
  'FIRST_PASS_KINDS (lib/pipeline-churn.js)': {
    has: (k) => FIRST_PASS_KINDS.has(k),
    out: {
      plan: 'its own branch: a second plan is plan-rejected',
      'plan-review': 'its own branch: a second is plan-rejected',
      implementation: 'its own branch: stage path, review changes or stall recovery',
      review: 'its own branch: stage path, then review changes',
      'close-out': 'its own branch: stage path, held or stall recovery',
      'retrospective-audit': 'its own branch: audit',
      'blind-read': 'its own branch: stage path, once per review (LIN-4437)',
      blocked: 'not a first pass: it runs whenever work stalls, a repeat is a repeat',
      breakdown: 'not a first pass: it follows a plan; a second is a repeat',
      retro: 'hand-triggered look-back, not a first pass'
    }
  },
  'the round-trip walk: OFF_SPINE_KINDS (lib/plan-review-round-trips.js)': {
    // A kind is accounted for when it is off the walk, or on it with a reason.
    has: (k) => OFF_SPINE_KINDS.has(k) || BUCKET_OF_KIND[k] === 'orchestration',
    out: {
      plan: 'on the walk: the plan-review gate\'s re-pass',
      'plan-review': 'on the walk: a gate',
      implementation: 'on the walk: the review gate\'s re-pass',
      review: 'on the walk: a gate',
      'close-out': 'on the walk: the row after an approving review',
      'retrospective-audit': 'on the walk since LIN-2592: after close-out, so it never sits between a gate and its re-pass',
      retro: 'on the walk: hand-triggered after the work, never between a gate and its re-pass',
      triage: 'on the walk: before the plan', research: 'on the walk: before the plan', scoping: 'on the walk: before the plan',
      design: 'on the walk: before the plan', spike: 'on the walk: before the plan', context: 'on the walk: before the plan',
      breakdown: 'on the walk: after the plan\'s approval', 'look-into': 'on the walk: before the plan',
      blocked: 'on the walk: a stall, read as a row like any other',
      'survey-task': 'on the walk: before work starts', 'survey-place': 'on the walk: before work starts'
    }
  },
  'BUCKET_OF_KIND (lib/wall-clock-summary.js)': { has: (k) => Object.hasOwn(BUCKET_OF_KIND, k) },
  'rendered byte ceilings (tests/unit/prompt-size-budget.test.js)': {
    has: (k) => keysInSource('tests/unit/prompt-size-budget.test.js', 'export const TEMPLATES_RENDERED_CEILINGS = {', '\n};').has(k)
  },
  'the stage-traits pin table (tests/unit/lin-4253-stage-traits.test.js)': {
    has: (k) => keysInSource('tests/unit/lin-4253-stage-traits.test.js', 'const PINNED = {', '\n};').has(k)
  },
  'SPINE (lib/run-view.js)': {
    has: (k) => SPINE.includes(k),
    out: Object.fromEntries(KINDS.filter(k => !['plan', 'implementation', 'review', 'blind-read', 'close-out'].includes(k))
      .map(k => [k, 'the fixed run-page spine is plan, build, review, blind read, close-out; other stages are rows, not progress']))
  }
};

describe('LIN-4437 — every per-kind table that stays names every PROMPT_TEMPLATES key, or says why not', () => {
  for (const [table, { has, out = {} }] of Object.entries(TABLES)) {
    test(`${table}: each kind is in the table or listed out with a reason`, () => {
      const missing = KINDS.filter(k => !has(k) && !Object.hasOwn(out, k));
      assert.deepEqual(missing, [], `${table} is missing ${missing.join(', ')}: add the row, or list the kind as out with its reason`);
    });

    test(`${table}: every kind listed out is really out, and has a reason`, () => {
      for (const [kind, reason] of Object.entries(out)) {
        assert.ok(KINDS.includes(kind), `${table}: "${kind}" is not a stage kind`);
        assert.ok(!has(kind), `${table}: "${kind}" is listed out but the table carries it`);
        assert.ok(typeof reason === 'string' && reason.length > 10, `${table}: "${kind}" needs its reason`);
      }
    });
  }

  test('blind-read sits in SPINE between review and close-out', () => {
    assert.equal(SPINE.indexOf('blind-read'), SPINE.indexOf('review') + 1);
    assert.equal(SPINE.indexOf('close-out'), SPINE.indexOf('blind-read') + 1);
  });

  test('blind-read buckets after the diff, and is off the round-trip walk', () => {
    assert.equal(BUCKET_OF_KIND['blind-read'], 'after');
    assert.ok(OFF_SPINE_KINDS.has('blind-read'));
  });
});

// ─── LIN-4466: the blind read's kind and heading have one home ─────────────────
// The leaf (lib/prompts/blind-read-words.js) owns the kind, the heading and the verdict words. Outside
// it, a source scan (AST, so comments never count) fails on:
//   - the kind as an exact string literal, except (a) a direct row key of a table in TABLES above: the
//     key's enclosing `const NAME = { ... }` must be a TABLES entry labelled `NAME (file)` in that same
//     file (a keyed object that is not a listed table fails, even in a table's file), and (b) the template
//     registry (lib/prompt-template-defs.js), which types the kind as a template key (under
//     GENERATE, keyed by kind) and may type it as a literal anywhere in that file;
//   - the heading as a substring of a string or template text, anywhere but the leaf;
//   - the verdict words' prose ("better, the same or worse", "better, same or worse") likewise.
// The scope is the code that ships (lib/, routes/, server.js) and the stability script that reads the
// ledger. Eval fixtures under scripts/eval name kinds as data and are out of scope.
const WORDS_LEAF = 'lib/prompts/blind-read-words.js';
const TEMPLATE_REGISTRY = 'lib/prompt-template-defs.js';
// The tables whose rows may be keyed by the kind: `NAME (file)` labels in TABLES, plus the registry's GENERATE map
// (one generate() per kind, beside the record it is keyed to). One inventory, not a second.
const KEYED_TABLES = new Set([
  ...Object.keys(TABLES).map(label => /^([A-Z][A-Z_]*) \((lib\/[^)]+)\)$/.exec(label)).filter(Boolean).map(m => `${m[2]}#${m[1]}`),
  `${TEMPLATE_REGISTRY}#GENERATE`
]);

/** The kind, heading and verdict-prose findings in one module's source. */
function blindReadFindings(file, source) {
  const parse = () => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const out = [];
  const text = (node) => (node.type === 'Literal' && typeof node.value === 'string') ? node.value
    : (node.type === 'TemplateElement' ? node.value.cooked : null);
  walk.fullAncestor(parse(), (node, _state, ancestors) => {
    // acorn-walk does not descend into a non-computed property key, so a key is checked here, where it is a row.
    if (node.type === 'Property' && !node.computed && node.key.type === 'Literal' && node.key.value === BLIND_READ_KIND) {
      // A row is a direct property of the object a listed table is declared as: `const NAME = { ... }`.
      const owner = ancestors[ancestors.length - 3];
      const isRow = owner?.type === 'VariableDeclarator' && owner.id.type === 'Identifier'
        && owner.init === ancestors[ancestors.length - 2] && KEYED_TABLES.has(`${file}#${owner.id.name}`);
      if (!isRow) out.push(`the kind '${BLIND_READ_KIND}' as a key outside a listed table`);
    }
    if (node.type === 'Literal' && node.value === BLIND_READ_KIND && file !== TEMPLATE_REGISTRY) out.push(`the kind '${BLIND_READ_KIND}' as a literal`);
    const s = text(node);
    if (s === null) return;
    if (s.includes(BLIND_READ_HEADING)) out.push(`the heading "${BLIND_READ_HEADING}" as text`);
    if (s.includes(BLIND_READ_VERDICT_PROSE) || s.includes(BLIND_READ_VERDICT_LIST)) out.push('the verdict words as prose');
  });
  return out;
}

// The scope is shared with LIN-4458's comment-kind census (tests/unit/helpers/shipped-sources.js).
const scannedFiles = () => shippedSourceFiles().filter(f => f !== WORDS_LEAF);

describe('LIN-4466 — the blind read\'s kind, heading and verdict words have one home', () => {
  test('the scan reaches the files that type them today', () => {
    const files = scannedFiles();
    for (const f of ['lib/run-view.js', 'lib/completion-signals.js', 'lib/code-routes.js', 'lib/llm-jobs.js', 'lib/workflow-config.js']) assert.ok(files.includes(f), f);
  });

  test('no module outside the leaf types the kind, its heading or its verdict words', () => {
    const hits = scannedFiles().flatMap(f => blindReadFindings(f, readFileSync(join(REPO, f), 'utf8')).map(x => `${f}: ${x}`));
    assert.deepEqual(hits, [], 'import BLIND_READ_KIND, BLIND_READ_HEADING or the verdict constants from lib/prompts/blind-read-words.js');
  });

  test('the scan would catch each shape the Waiting entry names: predicate, array member, call argument, returned value, heading, verdict prose', () => {
    const shapes = [
      `export const f = (r) => r.kind === '${BLIND_READ_KIND}';`,
      `export const SPINE = ['plan', '${BLIND_READ_KIND}'];`,
      `agent('${BLIND_READ_KIND}', 'judge');`,
      `export const g = () => ({ step: '${BLIND_READ_KIND}' });`,
      `export const h = 'posted as one ${BLIND_READ_HEADING} comment';`,
      `export const i = \`its first line exactly ${BLIND_READ_HEADING}\`;`,
      `export const j = 'whether the change left its area ${BLIND_READ_VERDICT_PROSE}';`,
    ];
    for (const src of shapes) assert.ok(blindReadFindings('lib/x.js', src).length > 0, src);
  });

  test('the scan allows what it should: a table row keyed by the kind, a comment, a longer status, the registry', () => {
    assert.deepEqual(blindReadFindings('lib/prompts/stage-kinds.js', `export const STAGE_KINDS = { '${BLIND_READ_KIND}': { label: 'Blind read' } };`), []);
    assert.deepEqual(blindReadFindings('lib/x.js', `// a ${BLIND_READ_KIND} note, and ${BLIND_READ_HEADING} in a comment\nexport const k = 'blind-read-missing';`), []);
    assert.deepEqual(blindReadFindings(TEMPLATE_REGISTRY, `export const GENERATE = { '${BLIND_READ_KIND}': () => 1 };`), []);
    assert.ok(blindReadFindings('lib/x.js', `export const T = { '${BLIND_READ_KIND}': 1 };`).length > 0, 'a keyed object outside a table file is not a row');
    // The key allowance is per table, not per file (LIN-4466 review): a non-table object in a table's file fails.
    assert.ok(blindReadFindings('lib/run-view.js', `export const ZZ = { '${BLIND_READ_KIND}': 1 };`).length > 0, 'a non-table object in a table file is not a row');
    assert.ok(blindReadFindings('lib/run-view.js', `export const STAGE_LABELS = { nested: { '${BLIND_READ_KIND}': 1 } };`).length > 0, 'a key nested below a table row is not a row');
    assert.ok(blindReadFindings('lib/run-view.js', `export const STAGE_LABELS = f({ '${BLIND_READ_KIND}': 1 });`).length > 0, 'a table must be declared as the object itself');
    assert.ok(blindReadFindings('lib/wall-clock-summary.js', `export const STAGE_LABELS = { '${BLIND_READ_KIND}': 1 };`).length > 0, 'a table name in another table\'s file is not a row');
    assert.deepEqual(blindReadFindings(TEMPLATE_REGISTRY, `export const GENERATE = { '${BLIND_READ_KIND}': 1 };`), []);
  });

  test('the verdict prose is the words in the order the prompts print them', () => {
    assert.equal(BLIND_READ_VERDICT_PROSE, 'better, the same or worse');
    assert.equal(BLIND_READ_VERDICT_LIST, 'better, same or worse');
  });
});
