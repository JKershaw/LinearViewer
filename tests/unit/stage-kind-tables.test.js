/**
 * Every per-kind table names every stage kind (LIN-4437, the guard half of the Waiting entry "a stage
 * kind is a row in ~nine parallel tables", docs/areas/llm-and-prompts.md).
 *
 * A stage kind is a PROMPT_TEMPLATES key. Each table below is keyed (or listed) by kind. The test
 * fails when any key is missing from any table. A table that leaves a kind out on purpose lists that
 * kind here, with the reason; a listed kind that the table does carry fails too, so the list cannot
 * go stale. Deleting `blind-read` from any table turns this file red.
 *
 * Partial checks that existed before it, and how this file accounts for them:
 *   - tests/unit/lin-4253-stage-traits.test.js pins each kind's `route` and `writes` with reasons;
 *     its PINNED table is read here as one more table.
 *   - tests/unit/prompt-templates.test.js's grounding matrix (EXPECTED) pins which notes each kind
 *     renders; GROUNDING_BY_KIND is read here directly (a kind missing from it silently gets the
 *     fallback list, lesson LIN-4371), and the matrix keeps the rendering half.
 *   - tests/unit/completion-signals.test.js pins the signal list by hand; COMPLETION_SIGNALS is read
 *     here directly.
 *   - tests/unit/prompt-size-budget.test.js asserts its rendered ceilings cover the registry; its
 *     ceiling table is also read here, from source, so this file is the one completeness guard.
 *   - the template count in docs/architecture/source-map.md and public/llms.txt's catalog keep their
 *     own tests in prompt-templates.test.js (a count and a bullet per kind); llms.txt is read here too.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROMPT_TEMPLATES, STAGE_LEADS } from '../../lib/prompt-templates.js';
import { COMPLETION_SIGNALS } from '../../lib/completion-signals.js';
import { STAGE_INTENT } from '../../lib/prompts/stage-intent.js';
import { GROUNDING_BY_KIND } from '../../lib/prompt-formatters.js';
import { STAGE_LABELS, SPINE } from '../../lib/run-view.js';
import { BUCKET_OF_KIND } from '../../lib/wall-clock-summary.js';
import { JOBS } from '../../lib/llm-jobs.js';
import { VIRTUAL_PROMPTS } from '../../lib/workflow-config.js';
import { FIRST_PASS_KINDS } from '../../lib/pipeline-churn.js';
import { OFF_SPINE_KINDS } from '../../lib/plan-review-round-trips.js';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { buildInstructions } from '../../lib/proxy-instructions.js';

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

/** The kinds the catalog's verb-override line lists. */
function overrideKinds() {
  const text = buildInstructions({ baseUrl: 'https://h', scope: 'readWrite' });
  const m = /VERB OVERRIDE — pass "kind" \(a prompt template key: ([^)]*)\)/.exec(text);
  assert.ok(m, 'the catalog carries the verb-override kind list');
  return new Set(m[1].split(',').map(s => s.trim()));
}

// Each table: how to read the kinds it names, and the kinds it leaves out on purpose, with why.
const TABLES = {
  'COMPLETION_SIGNALS (lib/completion-signals.js)': { has: (k) => Object.hasOwn(COMPLETION_SIGNALS, k) },
  'STAGE_LEADS (lib/prompt-template-defs.js)': { has: (k) => Object.hasOwn(STAGE_LEADS, k) },
  'STAGE_INTENT (lib/prompts/stage-intent.js)': { has: (k) => Object.hasOwn(STAGE_INTENT, k) },
  'GROUNDING_BY_KIND (lib/prompt-formatters.js)': { has: (k) => Object.hasOwn(GROUNDING_BY_KIND, k) },
  'STAGE_LABELS (lib/run-view.js)': { has: (k) => Object.hasOwn(STAGE_LABELS, k) },
  'BUCKET_OF_KIND (lib/wall-clock-summary.js)': { has: (k) => Object.hasOwn(BUCKET_OF_KIND, k) },
  'JOBS (lib/llm-jobs.js)': { has: (k) => JOBS.some(j => j.id === k) },
  'VIRTUAL_PROMPTS (lib/workflow-config.js)': {
    has: (k) => Object.values(VIRTUAL_PROMPTS).includes(k),
    out: {
      bug: 'label-based: WORK_ISSUE_LABELS.BUG, not a state-based prompt',
      blocked: 'label-named workflow (lib/prompt-templates.js header), not a state-based prompt',
      'survey-task': 'sent by the look-first route or by hand; nothing reads it as a state-based prompt (only LOOK_INTO is read)',
      'survey-place': 'as survey-task'
    }
  },
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
  'the stage contract (lib/prompt-contract.js)': {
    has: (k) => formatStageContract(k, 'X-1') !== '',
    out: Object.fromEntries(KINDS.filter(k => !['plan', 'plan-review', 'implementation', 'review', 'close-out'].includes(k))
      .map(k => [k, k === 'blind-read'
        ? 'its comment shape is in its own text and held by the proxy (lib/run-ledger.js checkBlindRead), not a contract line'
        : 'writes no format a later step parses through the contract'])),
  },
  'the catalog\'s verb-override list (lib/proxy-instructions.js)': {
    has: (k) => overrideKinds().has(k),
    out: {
      'plan-review': 'missing from the example list before LIN-4437; the override takes any template key (docs/areas/agent-api.md Waiting: the catalog\'s kind contract)',
      'close-out': 'as plan-review',
      'retrospective-audit': 'as plan-review',
      bug: 'as plan-review'
    }
  },
  'rendered byte ceilings (tests/unit/prompt-size-budget.test.js)': {
    has: (k) => keysInSource('tests/unit/prompt-size-budget.test.js', 'export const TEMPLATES_RENDERED_CEILINGS = {', '\n};').has(k)
  },
  'the stage-traits pin table (tests/unit/lin-4253-stage-traits.test.js)': {
    has: (k) => keysInSource('tests/unit/lin-4253-stage-traits.test.js', 'const PINNED = {', '\n};').has(k)
  },
  'the llms.txt prompt catalog (public/llms.txt)': { has: (k) => read('public/llms.txt').includes(`- \`${k}\` -`) },
  'SPINE (lib/run-view.js)': {
    has: (k) => SPINE.includes(k),
    out: Object.fromEntries(KINDS.filter(k => !['plan', 'implementation', 'review', 'blind-read', 'close-out'].includes(k))
      .map(k => [k, 'the fixed run-page spine is plan, build, review, blind read, close-out; other stages are rows, not progress']))
  }
};

describe('LIN-4437 — every per-kind table names every PROMPT_TEMPLATES key, or says why not', () => {
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
