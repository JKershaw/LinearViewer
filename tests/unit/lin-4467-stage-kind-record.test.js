/**
 * LIN-4467 (piece 3 of LIN-4448): one record per stage kind, and every table that used to carry a row per kind is a
 * view of it.
 *
 * The render witness (lin-4467-stage-kind-witness.test.js) pins what each kind renders. This file pins the record
 * itself: every kind gives every field, the record imports leaves only, each view reads the record, the catalogue in
 * public/llms.txt is generated from it, and the verb-override list names every kind.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import { WRITES_VALUES } from '../../lib/stage-writes.js';
import { PROMPT_TEMPLATES } from '../../lib/prompt-templates.js';
import { STAGE_LEADS } from '../../lib/prompt-template-defs.js';
import { COMPLETION_SIGNALS } from '../../lib/completion-signals.js';
import { STAGE_INTENT } from '../../lib/prompts/stage-intent.js';
import { GROUNDING_BY_KIND, GROUNDING_LISTS } from '../../lib/prompt-formatters.js';
import { STAGE_LABELS, STEP_KIND_WORDS, stepKindWord } from '../../lib/run-view.js';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { buildInstructions } from '../../lib/proxy-instructions.js';
import { renderPromptCatalogue, CATALOGUE_HEADING, CATALOGUE_NEXT_HEADING } from '../../lib/prompts/stage-catalogue.js';
import { withCatalogue } from '../../scripts/gen-llms-catalogue.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const REQUIRED = ['name', 'category', 'description', 'route', 'writes', 'lead', 'label', 'grounding', 'signals', 'intent', 'contract', 'catalogue'];
const CATEGORIES = ['pre-work', 'work-issue', 'ready', 'universal'];
const GROUPS = ['default', 'more'];

/** The problems in one record, as strings. [] when it is complete and well-typed. */
function recordProblems(kind, record) {
  const problems = [];
  for (const field of REQUIRED) if (!Object.hasOwn(record, field)) problems.push(`${kind}: no ${field}`);
  if (typeof record.name !== 'string') problems.push(`${kind}: name is not a string`);
  if (!CATEGORIES.includes(record.category)) problems.push(`${kind}: category "${record.category}" is not a known category`);
  if (typeof record.description !== 'string' || record.description.length < 20) problems.push(`${kind}: description`);
  if (record.route !== null && (typeof record.route?.when !== 'string' || typeof record.route?.whenNot !== 'string')) problems.push(`${kind}: route is neither null nor {when, whenNot}`);
  if (!WRITES_VALUES.includes(record.writes)) problems.push(`${kind}: writes "${record.writes}" is not a known value`);
  if (typeof record.lead !== 'string' || record.lead.length < 20) problems.push(`${kind}: lead`);
  if (typeof record.label !== 'string' || record.label.length === 0) problems.push(`${kind}: label`);
  if (!Object.hasOwn(GROUNDING_LISTS, record.grounding)) problems.push(`${kind}: grounding "${record.grounding}" names no list`);
  const s = record.signals;
  if (!s || typeof s.coreOutcome !== 'string' || !Array.isArray(s.signals) || typeof s.readinessCheck !== 'string') problems.push(`${kind}: signals`);
  if (record.intent !== null && !Array.isArray(record.intent)) problems.push(`${kind}: intent is neither null nor a list`);
  if (record.contract !== null && typeof record.contract !== 'function') problems.push(`${kind}: contract is neither null nor a function`);
  if (!GROUPS.includes(record.catalogue?.group) || typeof record.catalogue?.line !== 'string') problems.push(`${kind}: catalogue`);
  return problems;
}

describe('LIN-4467 — every stage kind gives every field, well-typed', () => {
  test('the record holds the twenty template kinds, in the registry order the views keep', () => {
    assert.deepEqual(Object.keys(STAGE_KINDS), Object.keys(PROMPT_TEMPLATES));
    assert.equal(Object.keys(STAGE_KINDS).length, 20);
  });

  test('each record is complete and well-typed', () => {
    const problems = Object.entries(STAGE_KINDS).flatMap(([kind, record]) => recordProblems(kind, record));
    assert.deepEqual(problems, []);
  });

  test('a kind added without a field fails the same check (the guard bites)', () => {
    const { lead, ...withoutLead } = STAGE_KINDS.plan;
    assert.ok(recordProblems('plan', withoutLead).includes('plan: no lead'));
    assert.deepEqual(recordProblems('plan', { ...STAGE_KINDS.plan, writes: 'everything' }), ['plan: writes "everything" is not a known value']);
  });

  test('the six kinds with no template keep their run-page label in run-view, not in the record', () => {
    for (const kind of ['leftover', 'autopilot', 'wake', 'periodical', 'custom', 'defer']) {
      assert.ok(!Object.hasOwn(STAGE_KINDS, kind), kind);
      assert.equal(typeof STAGE_LABELS[kind], 'string', kind);
    }
  });
});

describe('LIN-4467 — the record imports leaves only, so it cannot form a cycle with the views it feeds', () => {
  const LEAVES = new Set(['lib/stage-writes.js', 'lib/as-asked.js', 'lib/size-of-move.js', 'lib/description-edit.js', 'lib/prompts/blind-read-words.js']);
  /** The static import targets of a module, as repo paths. */
  const importsOf = (rel) => [...read(rel).matchAll(/^import[^;]*?from '([^']+)';/gm)]
    .map(m => resolve(dirname(resolve(ROOT, rel)), m[1]).slice(ROOT.length + 1));

  test('the record\'s imports, transitively, are all leaves on the list', () => {
    const seen = new Set();
    const queue = ['lib/prompts/stage-kinds.js'];
    while (queue.length) {
      const rel = queue.shift();
      if (seen.has(rel)) continue;
      seen.add(rel);
      for (const next of importsOf(rel)) queue.push(next);
    }
    const outside = [...seen].filter(f => f !== 'lib/prompts/stage-kinds.js' && !LEAVES.has(f));
    assert.deepEqual(outside, [], 'the record may import these leaves only');
  });
});

describe('LIN-4467 — each view reads the record', () => {
  test('PROMPT_TEMPLATES: name, category, description, route and writes are the record\'s; generate is a function', () => {
    for (const [kind, template] of Object.entries(PROMPT_TEMPLATES)) {
      const r = STAGE_KINDS[kind];
      assert.equal(template.name, r.name, kind);
      assert.equal(template.category, r.category, kind);
      assert.equal(template.description, r.description, kind);
      assert.deepEqual(template.route, r.route, kind);
      assert.equal(template.writes, r.writes, kind);
      assert.equal(typeof template.generate, 'function', kind);
    }
  });

  test('STAGE_LEADS is each record\'s lead', () => {
    assert.deepEqual(Object.keys(STAGE_LEADS), Object.keys(STAGE_KINDS));
    for (const kind of Object.keys(STAGE_KINDS)) assert.equal(STAGE_LEADS[kind], STAGE_KINDS[kind].lead, kind);
  });

  test('COMPLETION_SIGNALS is each record\'s signals', () => {
    for (const kind of Object.keys(STAGE_KINDS)) assert.equal(COMPLETION_SIGNALS[kind], STAGE_KINDS[kind].signals, kind);
  });

  test('STAGE_INTENT is each record\'s intent, for the kinds that have one, and no others', () => {
    const withIntent = Object.keys(STAGE_KINDS).filter(k => STAGE_KINDS[k].intent);
    assert.deepEqual(Object.keys(STAGE_INTENT).sort(), withIntent.sort());
    for (const kind of withIntent) assert.equal(STAGE_INTENT[kind], STAGE_KINDS[kind].intent, kind);
  });

  test('GROUNDING_BY_KIND is the named list each record points at', () => {
    for (const kind of Object.keys(STAGE_KINDS)) assert.equal(GROUNDING_BY_KIND[kind], GROUNDING_LISTS[STAGE_KINDS[kind].grounding], kind);
  });

  test('STAGE_LABELS carries each record\'s label, and STEP_KIND_WORDS the labels it repeats', () => {
    for (const kind of Object.keys(STAGE_KINDS)) assert.equal(STAGE_LABELS[kind], STAGE_KINDS[kind].label, kind);
    for (const kind of ['plan', 'implementation', 'review', 'close-out', 'research', 'bug']) assert.equal(STEP_KIND_WORDS[kind], STAGE_LABELS[kind], kind);
    assert.equal(stepKindWord('autopilot'), 'Kick-off');
    assert.equal(stepKindWord('look-into'), 'Look-into');
  });

  test('the stage contract is each record\'s contract: the five stages that have one, and no others', () => {
    for (const kind of Object.keys(STAGE_KINDS)) {
      const out = formatStageContract(kind, 'LIN-1', { write: true });
      if (STAGE_KINDS[kind].contract) assert.match(out, /## Formats Later Steps Read/, kind);
      else assert.equal(out, '', kind);
    }
  });

  test('the triage description names the fields triage writes, and no assignee (stage-writes.js leaves assignee out)', () => {
    assert.match(PROMPT_TEMPLATES.triage.description, /labels, priority, state, project/);
    assert.doesNotMatch(PROMPT_TEMPLATES.triage.description, /assignee/);
  });
});

describe('LIN-4467 — the verb-override list names every template key, from the records', () => {
  test('the catalog\'s VERB OVERRIDE line lists the record keys, in record order', () => {
    const text = buildInstructions({ baseUrl: 'https://h', scope: 'readWrite' });
    const m = /VERB OVERRIDE — pass "kind" \(a prompt template key: ([^)]*)\)/.exec(text);
    assert.ok(m, 'the override line is in the catalog');
    assert.equal(m[1], Object.keys(STAGE_KINDS).join(', '));
  });
});

describe('LIN-4467 — public/llms.txt carries the catalogue generated from the records', () => {
  test('the catalogue section is the rendered one, byte for byte (edit the record, then node scripts/gen-llms-catalogue.mjs)', () => {
    const text = read('public/llms.txt');
    assert.equal(withCatalogue(text), text, 'public/llms.txt differs from the stage-kind records');
  });

  test('the rendered section lists every kind once, in its group, with its catalogue wording', () => {
    const rendered = renderPromptCatalogue();
    assert.match(rendered, new RegExp(`^${CATALOGUE_HEADING} \\(20 total\\)`));
    for (const [kind, record] of Object.entries(STAGE_KINDS)) {
      const bullet = `- \`${kind}\` - ${record.catalogue.line}`;
      assert.equal(rendered.split('\n').filter(l => l === bullet).length, 1, `${kind} bullet`);
    }
    assert.ok(!rendered.includes(CATALOGUE_NEXT_HEADING));
  });
});
