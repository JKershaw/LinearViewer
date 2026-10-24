/**
 * Byte budget guard for the prompt surfaces (LIN-3203).
 *
 * Prompt text is carried context: every session that reads a template, the
 * routing prompt or the served runner prompt pays for it in full, across the whole
 * leg. Additions to the process have outnumbered removals about six to one, and
 * rule text is a small slice of the cost — the ratchet is what makes the rules
 * expensive. This guard freezes each prompt surface at the byte size it had when
 * the freeze landed (menu M25, `docs/steady-base.md`).
 *
 * The unit is UTF-8 bytes (`Buffer.byteLength`), not `.length` — an em dash is
 * three bytes. Prompt text still lands as code or a test first where it can, and a
 * shrink needs no edit. A surface grows only with its reason recorded beside the
 * ceiling it raises: the ticket, the bytes, and why the lesson cannot be code or a
 * test (LIN-3633; it replaced the earlier rule that a ceiling could rise only by
 * removing as many bytes from another surface in the same change). No other approval
 * is needed; review reads the comment. `FROZEN_TOTAL_BYTES` sums every ceiling below:
 * raising one ceiling without raising that constant pushes the sum over it and fails,
 * so a raise is a visible edit of a second, clearly labelled constant. The reason is
 * held by `ceilingLinesWithoutTicket` below: every ceiling's line must carry a ticket
 * reference in its comment. That check proves a reference is present, not that a raise
 * changed it; review reads the comment, and `scripts/steady-base-growth.mjs` keeps
 * reporting growth so a trend stays visible.
 *
 * Surfaces and the files that compose them mirror the `GROUPS` table in
 * `scripts/steady-base-growth.mjs` (the four-week growth read), so a drift in
 * one instrument is visible in the other:
 *   - Templates source  : lib/prompt-template-defs.js, lib/prompt-templates.js,
 *                         lib/prompt-formatters.js, lib/prompt-contract.js
 *   - Templates rendered: generatePrompt() for each PROMPT_TEMPLATES key under one
 *                         fixed fixture (composed output, catches leaks through a
 *                         source the frozen file does not itself contain)
 *   - Stage router      : lib/stage-router.js, source (LIN-3304) + the routing prompt
 *                         rendered with the leaf fixture the eval baseline uses — the
 *                         one prompt a recommendation call sends (LIN-3300)
 *   - Stage intent      : lib/prompts/stage-intent.js, source — every stage's Scope
 *                         and Authority lines (was lib/prompts/brief-writer.js)
 *   - Served runner     : docs/runner-prompt.md, source + buildRunnerKickoff() rendered
 *
 * LIN-3300 deleted the meta-prompt template (its source and rendered ceilings went
 * with it) and the brief writer's prompt; the writer's ceiling moved with the scope
 * lines it kept to lib/prompts/stage-intent.js. Every ceiling was then lowered to its
 * actual size and the total to their sum. The router's byte snapshots
 * (stage-router-prompt-snapshots.test.js) and the `meta-prompt.baseline.txt` guard in
 * rulings-resolution-contract-drift.test.js pin the rendered routing text; this pins
 * its size.
 *
 * Run with: node --test tests/unit/prompt-size-budget.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PROMPT_TEMPLATES, generatePrompt } from '../../lib/prompt-templates.js';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';
import { buildRunnerKickoff } from '../../lib/prompts/runner-kickoff.js';

// ─── Ceilings, measured at the freeze (LIN-3203) ─────────────────────────────
// Each is the surface's UTF-8 byte count on the freeze branch. A ceiling is a
// cap, not an identity pin: shrinking a surface needs no edit here. Growing one
// needs its reason recorded in the comment beside the ceiling it raises; see
// OVER_CEILING_FIX, used by each assert.

/** Templates, source bytes. Same files `steady-base-growth.mjs` GROUPS as
 * "worker templates". LIN-3292: the stage contract joins them, its 3481 bytes paid by
 * lowering the other three to their size after its format asks left the templates. */
export const TEMPLATES_SOURCE_CEILINGS = {
  'lib/prompt-template-defs.js': 110586, // LIN-3279: +655 (109931), FOLLOW_UP_SHAPE once plus research/design whenNot wording; why the text cannot be code or a test: the shape of a filed ticket and the skip-guard wording are judgment the agent reads, and no schema can validate them. Earlier: // LIN-3615: -11 (109942), Check 5's pin-conversion rule and review's move-witness bullet paid by four unpinned cuts. Earlier: // LIN-3614: -1 (109943), the three close-out/review rules paid by cuts; net of the three touched ceilings is -2. Earlier: // LIN-3378: +16 net, retrospective-audit's whenNot names merged-and-approved but not Done (+72), paid by blocked's, context's and recap's route text (-56)
  'lib/prompt-templates.js': 19970, // LIN-3612: +15, the isTerminalState import path now names providers/state-map.js (code, not prompt text; no template byte added). Earlier: // LIN-3378: +20, defer's whenNot names plan-review (+36), its requires tightened (-16)
  'lib/prompt-formatters.js': 50224, // LIN-3299: +34, the hypothesis sentence covers a proposed solution or limit
  'lib/prompt-contract.js': 3656, // LIN-3651: +232 (3424), the `Blocking findings: <n>` contract line and its reader row; it cannot be code, the count is the reviewer's judgement of its own findings and five trails show no common label to parse. Earlier: // LIN-3300: at 3424 since the one-path recommendation change
};

/** Templates, rendered bytes for each PROMPT_TEMPLATES key under FIXTURE_ISSUE +
 * FIXTURE_CONTEXT below. The key set is asserted to match the live registry.
 * LIN-3299: every stage gains a `## Process` heading and the reworded hypothesis sentence,
 * and its role line became its lead; the rises (+468 over twelve stages) are paid by the
 * writer's ideals and unwritten stages' scope lines leaving lib/prompts/brief-writer.js.
 * Then every stage gains its Scope and Authority on every path (+4606 over seventeen
 * stages, net of leads that no longer repeat it), paid from the 4813 bytes left
 * unallocated under FROZEN_TOTAL_BYTES, 4485 of them freed by LIN-3299 itself.
 * LIN-3300: implementation, plan, review, scoping and context each gained a rule that
 * existed only in the deleted meta-prompt (+359 rendered), paid from its ceilings;
 * close-out's bug-label line renders only for a bug-labelled task, so not here. */
export const TEMPLATES_RENDERED_CEILINGS = {
  blocked: 3244, // LIN-3299: at 3244 since Scope and Authority on every path
  bug: 4744, // LIN-3299: at 4744 since Scope and Authority on every path
  plan: 15793, // LIN-3300: the planner's revision line no longer asks for an exact form or names the loop bound
  'look-into': 1762, // LIN-3299: at 1762 since Scope and Authority on every path
  triage: 2429, // LIN-3299: at 2429 since Scope and Authority on every path
  breakdown: 5096, // LIN-3299: at 5096 since Scope and Authority on every path
  research: 11514, // LIN-3299: at 11514 since Scope and Authority on every path
  scoping: 2427, // LIN-3300: at 2427 since the stage rules only the meta-prompt carried moved into their templates
  design: 2562, // LIN-3299: at 2562 since Scope and Authority on every path
  spike: 2581, // LIN-3299: at 2581 since Scope and Authority on every path
  context: 2021, // LIN-3300: at 2021 since the stage rules only the meta-prompt carried moved into their templates
  'plan-review': 7989, // LIN-3651: +133 (7856), the `Blocking findings: <n>` line on Request Changes; not code, the count is the reviewer's own judgement and no label is common across the trails. Earlier: // LIN-3615: -99 (7955), the pin-conversion rule (+209) paid by cutting Verdict's restated opening, Completion's restated record line and the planner-owns-the-edit clause.
  implementation: 7937, // LIN-3300: at 7937 since the stage rules only the meta-prompt carried moved into their templates
  review: 15165, // LIN-3615: +88 (15077), the source-reading-test-is-no-witness bullet, paid by retiring the 'Code is ready for production' checklist item and by plan-review's cuts. Earlier: // LIN-3614: -521 (15598), unverifiable claims go in the ledger as not run; paid by cutting the repeated class-vs-ledger sentence, Completion's CI restatement and the Outside wording close-out restates. Earlier: // LIN-3326: -3297, the risk lanes and the authoring bound leave review
  'close-out': 11803, // LIN-3903: +232 (11571), John's 12 Oct standing ruling replaces the asked/unasked hold: a post-deploy check close-out cannot run never holds the close once the deploy has landed, the three holds are named, a product question still gets a ruling, and one ruling asks for every fact. Why the text cannot be code or a test: whether a step is a check and whether the deploy has landed are judgment the close-out worker reads from the ticket; no code path decides the hold. Guards kept verbatim (raise no ruling, no monitor settles it, never a reason to hold the merge), so no cut was taken. Review nets -12 and keeps its ceiling. Earlier: // LIN-3279: +192 (11379), FOLLOW_UP_SHAPE rendered. Earlier: // LIN-3614: +520 (10859), an unasked live or post-deploy check is recorded as not run and the close goes ahead; stale citations are fixes; Triage states the outsider standard. Earlier: // LIN-3326: -7893, close-out finishes the work: no authoring bound, no hard gate, one statement of each floor
  'retrospective-audit': 4619, // LIN-3279: +192 (4427), FOLLOW_UP_SHAPE rendered. Earlier: // LIN-3299: at 4427 since Scope and Authority on every path
  retro: 4265, // LIN-3299: at 4265 since Scope and Authority on every path
};

/**
 * The stage router's source bytes (lib/stage-router.js, LIN-3304): the stage selector's
 * rules, its prompt and the reply parse. LIN-3300 replaced the decision tree (44667) with
 * the selector; the stage options it lists are each stage's `route`, counted in the
 * template defs.
 */
export const STAGE_ROUTER_SOURCE_CEILING = 8069; // LIN-3378: -46, Why clauses of rules 1-3 tightened (rules 6 and 8 keep theirs: measured, HAR-697 and the parent-plan points)
/**
 * The routing prompt, rendered bytes for the eval baseline's leaf (a leaf with no
 * comments and no plan, its view a placeholder). LIN-3300: the meta-prompt's rendered
 * ceiling (103308) became the routing half's (40687) when the full path went; the stage
 * selector sends 9555. It also catches growth in the stage options and the facts code
 * renders (lib/recommendation-facts.js), which no source ceiling covers.
 */
export const ROUTER_PROMPT_RENDERED_CEILING = 9701; // LIN-3279: +156 (9545), research and design whenNot say a filer's own fix is not completed prep. Earlier: // LIN-3378: -10 net of b and g

/**
 * Every stage's Scope and Authority lines, source bytes (lib/prompts/stage-intent.js).
 * LIN-3300: the file was lib/prompts/brief-writer.js (ceiling 4779); the writer's prompt
 * left with the writer, and the ceiling moved with the lines that stayed.
 */
export const STAGE_INTENT_SOURCE_CEILING = 2912; // LIN-3326: +82, close-out's own line (engineering calls in finishing the work are its), paid from close-out's rendered ceiling

/** Served runner prompt, source bytes (docs/runner-prompt.md). */
export const RUNNER_PROMPT_SOURCE_CEILING = 17638; // LIN-3669: +164 (17474), §5 names the watchdog's three outcomes; the parent's response to a finished-but-unposted subagent is prose (the parent is a model), the rest of LIN-3669 is code and tests. Earlier: // LIN-3451: at 17474 since the runner kit matched Simple Dispatcher (halt / target / repo / cap)
/** Served runner prompt, rendered bytes (buildRunnerKickoff at BASE_URL). */
export const RUNNER_PROMPT_RENDERED_CEILING = 15953; // LIN-3669: +164 (15789), the same §5 lines rendered; the parent's response to a finished-but-unposted subagent is prose (the parent is a model), the rest of LIN-3669 is code and tests. Earlier: // LIN-3451: at 15789 since the runner kit matched Simple Dispatcher (halt / target / repo / cap)

/**
 * The total: the sum of every ceiling above. A PR that raises a ceiling raises
 * THIS number with it, in the same change, and says why in the comment beside the
 * ceiling it raises; the raise is a visible edit, reviewed rather than assumed.
 *
 * LIN-3304 raised it by 6990 (568534 -> 575524) when lib/stage-router.js joined the
 * frozen surfaces. LIN-3300 lowered it to the sum of the ceilings above, each at its
 * actual size, once the meta-prompt template and the brief writer's prompt were deleted
 * (575524 before), so there is no slack. That includes +960 for the six stage rules
 * the meta-prompt alone carried, moved into their templates in the same change.
 *
 * LIN-3300's stage selector lowered it again (437765 -> 364994): the selector's rules,
 * stage options and facts replace the decision tree and the aiHints, and the planner no
 * longer carries the loop bound. Every ceiling sits at its surface's size.
 *
 * LIN-3326 lowered it again (364994 -> 342621): close-out and review shed the authoring
 * bound and the pre-merge risk gates (-22455), less close-out's Scope and Authority line (+82).
 */
export const FROZEN_TOTAL_BYTES = 344712; // LIN-3903: +232 (344480), close-out ceiling +232; review is -12 under its unchanged ceiling. Earlier: // LIN-3279: +1195 (343285), defs +655, close-out +192, retrospective-audit +192, router +156. Earlier: // LIN-3669: +328 (342957), runner prompt source +164 and rendered +164. Earlier: // LIN-3651: +365 (342592), contract source +232 and plan-review rendered +133. Earlier: // LIN-3612: +15 (342577), prompt-templates.js import path. Earlier: // LIN-3615: -22 (342599), net of plan-review -99, review +88, defs -11. Earlier: // LIN-3614: -2 (342601), net of review -521, close-out +520, defs -1. Earlier: // LIN-3378: -20 (342621)

const BASE_URL = 'https://harbour.example';

// ─── Fixtures (fixed, committed) ─────────────────────────────────────────────
// A representative non-terminal leaf: no parent/siblings/children/comments and
// default feature flags, so the grounding/attachments post-passes self-gate to
// nothing. The point is a stable, reproducible number, not a maximal one — the
// source ceilings catch every conditional branch; the rendered ceilings catch
// growth that leaks in through a composed source.
const FIXTURE_ISSUE = {
  id: 'LIN-0000',
  identifier: 'LIN-0000',
  title: 'Representative leaf task for the prompt byte-budget fixture',
  description: 'A short fixed description used only to freeze prompt byte budgets.',
  url: 'https://linear.app/example/issue/LIN-0000',
  state: { name: 'In Progress', type: 'started' },
  labels: ['plan'],
  assignee: { name: 'Fixture' },
  estimate: 3,
  createdAt: '2026-01-01T00:00:00.000Z'
};

const FIXTURE_CONTEXT = {
  parent: null,
  siblings: [],
  project: { name: 'Fixture Project', description: 'A fixed project used only for byte budgets.' },
  children: [],
  comments: []
};

// The leaf the baseline snapshot (scripts/eval/regen-baseline.mjs) uses: no comments,
// no plan, its view left as the {{ISSUE_CONTEXT}} placeholder. Rendered this is
// byte-identical to scripts/eval/meta-prompt.baseline.txt.
const ROUTER_PROMPT_ARGS = {
  ...buildSelectorArgs({ identifier: '{{IDENTIFIER}}', title: '', state: {}, labels: [] }, {}),
  view: '{{ISSUE_CONTEXT}}',
  featureFlags: {}
};

// What every over-ceiling failure tells the author to do (LIN-3633).
const OVER_CEILING_FIX =
  'Land the lesson as code or a test first. If the text must grow, raise the ceiling and FROZEN_TOTAL_BYTES ' +
  'with the reason in the comment beside the ceiling (the ticket, the bytes, why not code or a test).';

const sourceBytes = (path) => Buffer.byteLength(readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url))));
const renderBytes = (key) => Buffer.byteLength(generatePrompt(key, FIXTURE_ISSUE, FIXTURE_CONTEXT).prompt);

describe('prompt surfaces stay within their frozen byte budgets (LIN-3203)', () => {
  test('templates source bytes', () => {
    const over = [];
    for (const [file, ceiling] of Object.entries(TEMPLATES_SOURCE_CEILINGS)) {
      const actual = sourceBytes(file);
      if (actual > ceiling) over.push(`${file} is ${actual} bytes, ${actual - ceiling} over its ${ceiling}-byte ceiling`);
    }
    assert.deepStrictEqual(over, [],
      `Prompt template source file(s) grew: ${over.join('; ')}. ${OVER_CEILING_FIX}`);
  });

  test('templates rendered bytes', () => {
    const over = [];
    for (const [key, ceiling] of Object.entries(TEMPLATES_RENDERED_CEILINGS)) {
      const actual = renderBytes(key);
      if (actual > ceiling) over.push(`"${key}" renders to ${actual} bytes, ${actual - ceiling} over its ${ceiling}-byte ceiling`);
    }
    assert.deepStrictEqual(over, [],
      `Template(s) grew: ${over.join('; ')}. ${OVER_CEILING_FIX}`);
  });


  test('stage router source bytes', () => {
    const actual = sourceBytes('lib/stage-router.js');
    assert.ok(actual <= STAGE_ROUTER_SOURCE_CEILING,
      `lib/stage-router.js is ${actual} bytes, ${actual - STAGE_ROUTER_SOURCE_CEILING} over its ` +
      `${STAGE_ROUTER_SOURCE_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('routing prompt rendered bytes', () => {
    const actual = Buffer.byteLength(buildRouterPrompt(ROUTER_PROMPT_ARGS));
    assert.ok(actual <= ROUTER_PROMPT_RENDERED_CEILING,
      `The routing prompt renders to ${actual} bytes, ${actual - ROUTER_PROMPT_RENDERED_CEILING} over its ` +
      `${ROUTER_PROMPT_RENDERED_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('stage intent source bytes', () => {
    const actual = sourceBytes('lib/prompts/stage-intent.js');
    assert.ok(actual <= STAGE_INTENT_SOURCE_CEILING,
      `lib/prompts/stage-intent.js is ${actual} bytes, ${actual - STAGE_INTENT_SOURCE_CEILING} over its ` +
      `${STAGE_INTENT_SOURCE_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('served runner prompt source bytes', () => {
    const actual = sourceBytes('docs/runner-prompt.md');
    assert.ok(actual <= RUNNER_PROMPT_SOURCE_CEILING,
      `docs/runner-prompt.md is ${actual} bytes, ${actual - RUNNER_PROMPT_SOURCE_CEILING} over its ` +
      `${RUNNER_PROMPT_SOURCE_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('served runner prompt rendered bytes', () => {
    const actual = Buffer.byteLength(buildRunnerKickoff({ baseUrl: BASE_URL }));
    assert.ok(actual <= RUNNER_PROMPT_RENDERED_CEILING,
      `The served runner prompt renders to ${actual} bytes, ${actual - RUNNER_PROMPT_RENDERED_CEILING} over its ` +
      `${RUNNER_PROMPT_RENDERED_CEILING}-byte ceiling. ${OVER_CEILING_FIX}`);
  });

  test('the rendered budget covers exactly the live PROMPT_TEMPLATES key set', () => {
    // A new template without a budget (or a stale budget for a removed one) is a
    // failure: adding a template means giving it a ceiling with its reason beside it.
    assert.deepStrictEqual(
      Object.keys(TEMPLATES_RENDERED_CEILINGS).sort(),
      Object.keys(PROMPT_TEMPLATES).sort(),
      'Every PROMPT_TEMPLATES key must carry a rendered ceiling and vice versa. A new template needs a ceiling ' +
      'with its reason recorded beside it, and FROZEN_TOTAL_BYTES raised to match. ' + OVER_CEILING_FIX
    );
  });

  test('the sum of every ceiling does not exceed FROZEN_TOTAL_BYTES', () => {
    const ceilingSum = [
      ...Object.values(TEMPLATES_SOURCE_CEILINGS),
      ...Object.values(TEMPLATES_RENDERED_CEILINGS),
      STAGE_ROUTER_SOURCE_CEILING,
      ROUTER_PROMPT_RENDERED_CEILING,
      STAGE_INTENT_SOURCE_CEILING,
      RUNNER_PROMPT_SOURCE_CEILING,
      RUNNER_PROMPT_RENDERED_CEILING,
    ].reduce((sum, n) => sum + n, 0);
    assert.ok(ceilingSum <= FROZEN_TOTAL_BYTES,
      `The ceilings sum to ${ceilingSum} bytes, ${ceilingSum - FROZEN_TOTAL_BYTES} over the frozen total ` +
      `${FROZEN_TOTAL_BYTES}. Raising FROZEN_TOTAL_BYTES by ${ceilingSum - FROZEN_TOTAL_BYTES} is a deliberate, ` +
      `reviewable edit, made together with the reason beside the ceiling that rose. ${OVER_CEILING_FIX}`);
  });
});

// ─── The reason beside every ceiling (LIN-3633) ──────────────────────────────

/**
 * The ceiling lines in the block between the "Ceilings, measured at the freeze" banner
 * and BASE_URL whose `//` comment carries no ticket reference. A ceiling line's code
 * part is `NAME = <digits>` or `key: <digits>`. Pure over a source string so the tests
 * below can run it on mutated copies of this file.
 */
const CEILING_LINE = /^\s*(?:export\s+const\s+\w+\s*=|['"]?[\w./-]+['"]?\s*:)\s*\d+/;
const ceilingLines = (source) =>
  source.slice(source.indexOf('Ceilings, measured at the freeze'), source.indexOf('const BASE_URL')).split('\n').filter(l => CEILING_LINE.test(l));

export function ceilingLinesWithoutTicket(source) {
  return ceilingLines(source).filter(l => !/\bLIN-\d+\b/.test(l.includes('//') ? l.slice(l.indexOf('//')) : ''));
}

describe('every ceiling carries its reason (LIN-3633)', () => {
  const real = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const strip = (line) => line.replace(/\bLIN-\d+\b/g, '');

  test('the matcher sees every ceiling, so a pass is not vacuous', () => {
    // Source and rendered keys, router source and rendered, intent, runner source and rendered, the total.
    const expected = Object.keys(TEMPLATES_SOURCE_CEILINGS).length + Object.keys(TEMPLATES_RENDERED_CEILINGS).length + 5 + 1;
    assert.equal(ceilingLines(real).length, expected,
      'A ceiling is in a shape the matcher misses (or the matcher over-matches). Keep ceilings as `NAME = <digits>` or `key: <digits>`.');
  });

  test('on the real file, every ceiling line names a ticket in its comment', () => {
    assert.deepStrictEqual(ceilingLinesWithoutTicket(real), [],
      'A ceiling line has no ticket reference in its comment. A raise says why beside the ceiling: ' + OVER_CEILING_FIX);
  });

  test('a ceiling whose comment lost its ticket reference is reported', () => {
    const line = real.split('\n').find(l => l.startsWith("  'plan-review':"));
    assert.ok(line, 'fixture line not found');
    assert.deepStrictEqual(ceilingLinesWithoutTicket(real.replace(line, strip(line))), [strip(line)]);
  });

  test('a ceiling raised with its comment deleted is reported', () => {
    const line = real.split('\n').find(l => l.startsWith('export const STAGE_INTENT_SOURCE_CEILING'));
    assert.ok(line, 'fixture line not found');
    const raised = line.replace(/= \d+;.*/, '= 99999;');
    assert.deepStrictEqual(ceilingLinesWithoutTicket(real.replace(line, raised)), [raised]);
  });
});
