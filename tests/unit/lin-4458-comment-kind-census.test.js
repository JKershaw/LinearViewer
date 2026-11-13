/**
 * LIN-4458 (piece 2 of LIN-4447): one comment classifier, `COMMENT_KINDS` in lib/run-trail.js.
 *
 *   - THE TABLE: every row declares its kind, its opening and each reading, from a closed set of
 *     values; the table and its rows are frozen; the last row matches everything.
 *   - THE OLD CHECKS, ONE BY ONE: each check the retired classifiers made (lib/run-ledger.js and
 *     lib/recommendation-facts.js at 0092d8d9e) written as a case, so a change to an opening, its
 *     case-folding, the order of overlapping kinds, or the person/agent/ruling split shows here.
 *   - THE CENSUS (boundary agreed with LIN-4448, comment 1a2e7cba): outside lib/run-trail.js, in
 *     lib/, routes/, server.js and scripts/stability-measures-blind.mjs,
 *       1. no declaration of a retired kind predicate or opening helper (the list below);
 *       2. no regular expression that spells a comment kind's opening (close-out, audit, plan-review
 *          verdict, area read, blind read, Survey, an agent's note opening, a plan comment's opening
 *          and its `Implementation Plan` heading, the ruling mark), but for the named description
 *          readers in DESCRIPTION_READERS, each with its reason;
 *       3. no string literal of the ruling mark (the in-app route writes `RULING_MARK`).
 *     Verdict-VALUE parsers are outside it: `extractVerdict` (lib/plan-review-round-trips.js) and the
 *     verdict word `planReviewVerdictOf` reads stay where they are; only "is this a plan-review
 *     verdict" moved into the table.
 *   - A PLAN COMMENT (`isPlanComment`) lives beside the table but is not a kind: it overlaps agent
 *     notes and plan reviews on purpose; the overlaps are pinned below.
 *   - THE READING CHANGES one kind per comment made, each pinned by name, with what the code before
 *     it (f9a8cbcd1) answered.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { shippedSourceFiles } from './helpers/shipped-sources.js';

import {
  COMMENT_KINDS, COMMENT_KIND_READINGS, SURVEY_KINDS, RULING_MARK,
  commentKindOf, isRuling, isPersonComment, reportsLandedWork, opensWithCloseOutTitle, isPlanComment, readTrail
} from '../../lib/run-trail.js';
import { assembleTrailFacts, assemblePlanReviewFacts } from '../../lib/recommendation-facts.js';
import { BLIND_READ_HEADING } from '../../lib/prompts/blind-read-words.js';
import { SURVEY_HEADINGS } from '../../lib/prompts/survey-words.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const HOME = 'lib/run-trail.js';
const PR = 'https://github.com/acme/widget/pull/41';

const VALUES = { landing: ['all', 'none', 'first-cited'], landed: ['always', 'cites-pr', 'never'], work: ['cites-pr', 'cites-new-pr', 'never'] };

describe('the table: every row declares every reading', () => {
  test('the readings are landing, landed and work', () => {
    assert.deepEqual([...COMMENT_KIND_READINGS], ['landing', 'landed', 'work']);
  });

  for (const row of COMMENT_KINDS) {
    test(`${row.kind}: exactly kind, opens and each reading, each from its closed set`, () => {
      assert.deepEqual(Object.keys(row).sort(), ['kind', 'opens', ...COMMENT_KIND_READINGS].sort());
      assert.equal(typeof row.opens, 'function');
      for (const reading of COMMENT_KIND_READINGS) assert.ok(VALUES[reading].includes(row[reading]), `${row.kind}.${reading} = ${row[reading]}`);
    });
  }

  test('kinds are distinct; the table and its rows are frozen; the last row is plain and matches anything', () => {
    const kinds = COMMENT_KINDS.map(r => r.kind);
    assert.equal(new Set(kinds).size, kinds.length);
    assert.ok(Object.isFrozen(COMMENT_KINDS));
    for (const row of COMMENT_KINDS) assert.ok(Object.isFrozen(row), row.kind);
    assert.equal(kinds.at(-1), 'plain');
    assert.equal(commentKindOf(''), 'plain');
    assert.equal(commentKindOf(null), 'plain');
  });

  test('the Survey kinds are the Survey headings\' keys, each a row', () => {
    assert.deepEqual([...SURVEY_KINDS], Object.keys(SURVEY_HEADINGS));
    for (const k of SURVEY_KINDS) assert.ok(COMMENT_KINDS.some(r => r.kind === k), k);
  });

  test('the readings that changed on purpose (LIN-4458): an audit carries its first citations, an area read none, an agent note counts a new PR', () => {
    const of = (kind) => COMMENT_KINDS.find(r => r.kind === kind);
    assert.equal(of('audit').landing, 'first-cited');
    assert.deepEqual([of('area-read').landing, of('area-read').landed, of('area-read').work], ['none', 'never', 'never']);
    assert.equal(of('agent-note').work, 'cites-new-pr');
  });
});

describe('the old checks, one by one (lib/run-ledger.js and lib/recommendation-facts.js at 0092d8d9e)', () => {
  const review = `## Code Review\n\nReviewed ${PR}.\n\n**Verdict: Approve**`;
  const cases = [
    // isReviewSummary: the title (first heading) names a review, not a plan review, not opening close-out/autopilot; a verdict word or the ledger heading.
    ['review', review],
    ['review', `## Re-review round 2\n\n### What CI Did Not Prove\nNone.`, 'the ledger heading stands in for a verdict word'],
    ['review', `## Review — conditional on close-out\n\n**Verdict:** Approve`, 'a review whose title mentions a close-out is a review (LIN-2944)'],
    ['plain', `## Code Review notes\n\nStill reading.`, 'a review title with no verdict and no ledger is not a review'],
    ['close-out', `## Close-out review\n\nApprove.`, 'a title opening close-out is never a review'],
    ['agent-note', `## Autopilot review pass\n\nApproved.`, 'a title opening autopilot is never a review'],
    ['plan-review', `### Plan Review Verdict\n\n**Verdict:** Approve`, 'a plan review is not the run review'],
    // isCloseOut: a close-out heading (first heading, anywhere in it), or a first line opening "Close-out"; case-blind; "closeout".
    ['close-out', `## Close-out\n\nMerged ${PR}.`],
    ['close-out', `**Close-out actions completed.**`, 'a first line opening close-out, markdown stripped'],
    ['close-out', `CLOSEOUT: merged.`, 'case-blind, with or without the hyphen'],
    ['close-out', `Merged.\n\n## LIN-1 close-out`, 'the first heading anywhere names a close-out'],
    ['plain', `We should close-out next.`, 'a mention that does not open the first line'],
    // isBlindRead / isSurveyReport: open with the heading exactly; a Survey takes ':' or a space after it.
    ['blind-read', `${BLIND_READ_HEADING}\nVerdict: same. a b c ${PR}`],
    ['blind-read', `\n\n${BLIND_READ_HEADING}: LIN-1`, 'after blank lines, with a : tail'],
    ['plain', `${BLIND_READ_HEADING} pilot`, 'a longer heading is another heading'],
    ['survey-task', `${SURVEY_HEADINGS['survey-task']}: LIN-1 @ abc`],
    ['survey-place', `${SURVEY_HEADINGS['survey-place']} @ abc`, 'a space tail'],
    ['plain', `${SURVEY_HEADINGS['survey-task']}x: LIN-1`],
    ['area-read', `## Area read: Runs & dispatch @ 4b5001ddf`, 'new in LIN-4458'],
    // AGENT_NOTE_RE on the first line, leading markdown stripped, case-blind.
    ['agent-note', `**Autopilot step record — LIN-1.**`],
    ['agent-note', `Plan posted in the description.`],
    ['agent-note', `plan revised: tightened step 2`],
    ['agent-note', `Plan revision 1 written`],
    ['agent-note', `Revision 2 — addresses plan-review`],
    ['plain', `Revision 2 is up`, 'a bare revision line without the plan-review clause is not a note'],
    ['agent-note', `Plan revised.\n\n## Plan review response\n\nNo verdict here.`, 'a planner\'s note quoting a plan-review heading stays the note'],
    // planReviewVerdictOf's heading test: the contract heading or the legacy one, from the first heading.
    ['plan-review', `## Plan-review (round 2) — Request Changes`],
    // isAuditReport: the first line opens "Retrospective audit", markdown stripped, case-blind.
    ['audit', `## Retrospective audit — LIN-1\n\nNotes PR: ${PR}.`],
    ['audit', `retrospective audit: nothing found`],
    // everything else
    ['plain', `Implementation done: ${PR}, CI green.`],
    ['plain', `Please keep the old flag.`],
  ];
  for (const [kind, body, why] of cases) {
    test(`${kind}: ${why || JSON.stringify(body.slice(0, 50))}`, () => assert.equal(commentKindOf(body), kind));
  }

  test('the share page\'s close-out title stays stricter than the close-out kind (lib/run-evidence.js closeOutSummaryFor)', () => {
    assert.equal(commentKindOf('## Autopilot close-out\n\nnot it'), 'close-out', 'on the trail it is a close-out');
    assert.equal(opensWithCloseOutTitle('## Autopilot close-out\n\nnot it'), false, 'but not a title the page quotes under');
    assert.equal(opensWithCloseOutTitle('## Close-out — LIN-1\n\nMerged.'), true);
    assert.equal(opensWithCloseOutTitle('\n## Close-out'), false, 'the very first line, as before');
  });

  test('commentKindOf takes a comment or its body', () => {
    assert.equal(commentKindOf({ body: review }), 'review');
    assert.equal(commentKindOf({}), 'plain');
  });

  test('isRuling: ends with the mark (trailing whitespace allowed); a quoted mark or an agent\'s note is not one', () => {
    assert.equal(isRuling(`Go.\n\n${RULING_MARK}`), true);
    assert.equal(isRuling(`Go.\n\n${RULING_MARK}\n  `), true);
    assert.equal(isRuling(`The suffix "${RULING_MARK}" is quoted.`), false);
    assert.equal(isRuling(`**Autopilot step record.**\n\n${RULING_MARK}`), false);
    assert.equal(isRuling(`## Close-out\n\nHold.\n\n${RULING_MARK}`), true, 'the mark says who wrote it, whatever the comment is');
  });

  test('isPersonComment: a ruling, or an unheaded comment that is no agent note, landed work, plan-review verdict or close-out', () => {
    assert.equal(isPersonComment(`## Close-out\n\nHold.\n\n${RULING_MARK}`), true, 'a ruling always is, heading or not');
    assert.equal(isPersonComment('Please keep the old flag.'), true);
    assert.equal(isPersonComment('## Research notes\n\nA plan.'), false, 'a heading first line is a stage\'s report');
    assert.equal(isPersonComment(`PR to merge: ${PR}`), false, 'a link is landed work');
    assert.equal(isPersonComment('Autopilot: parked.'), false);
    assert.equal(isPersonComment('Close-out: not ready.'), false);
    assert.equal(isPersonComment(`Retrospective audit: no notes PR.`), true, 'an unheaded audit with no PR reads as a person, as before');
  });

  test('reportsLandedWork (was isLandingEvidence): a review always; a PR URL on a close-out, plan review, audit or plain comment; never an agent note, blind read, Survey or area read', () => {
    assert.equal(reportsLandedWork(review.replace(PR, 'the change')), true);
    for (const body of [`## Close-out\n\n${PR}`, `### Plan Review Verdict\n\n${PR} Approve`, `Retrospective audit: ${PR}`, `PR: ${PR}`]) assert.equal(reportsLandedWork(body), true, body);
    for (const body of ['## Close-out\n\nno PR', 'plain words']) assert.equal(reportsLandedWork(body), false, body);
    for (const body of [`Autopilot: ${PR}`, `${BLIND_READ_HEADING}\n${PR}`, `${SURVEY_HEADINGS['survey-task']}: ${PR}`, `## Area read: x @ y ${PR}`]) assert.equal(reportsLandedWork(body), false, body);
  });
});

describe('a plan comment: beside the table, not a kind, overlapping on purpose (lib/run-trail.js isPlanComment)', () => {
  test('an Implementation Plan heading anywhere, or a first line opening "Plan"', () => {
    assert.equal(isPlanComment('Here it is.\n\n## Implementation Plan\n\n1. step'), true);
    assert.equal(isPlanComment('**Plan** — three steps'), true, 'leading markdown stripped');
    assert.equal(isPlanComment('Planning to start tomorrow'), false, 'a word that only begins with "plan"');
    assert.equal(isPlanComment('The plan is fine.'), false);
  });

  test('overlap 1: a planner\'s "Plan posted" note is a plan comment AND stays an agent-note comment', () => {
    const body = 'Plan posted in the description.\n\n## Implementation Plan\n\n1. step';
    assert.equal(isPlanComment(body), true);
    assert.equal(commentKindOf(body), 'agent-note', 'the agent-note readings still apply to it');
  });

  test('overlap 2: a plan-review verdict opens "Plan" and is a plan comment by opening; the selector skips it by its verdict word', () => {
    const verdict = '### Plan Review Verdict\n\n**Verdict:** Approve';
    assert.equal(isPlanComment(verdict), true);
    assert.equal(commentKindOf(verdict), 'plan-review');
    const plan = { createdAt: '2026-11-12T01:00:00.000Z', body: 'Plan posted.\n\nfits one session' };
    const facts = assembleTrailFacts([plan, { createdAt: '2026-11-12T02:00:00.000Z', body: verdict }], '');
    assert.equal(facts.plan.where, 'comment');
    assert.equal(facts.plan.at, plan.createdAt, 'the latest plan comment that is not a verdict is the plan');
  });

  test('a plan-review heading with no verdict word stays a plan comment for the selector, as before', () => {
    const noVerdict = { createdAt: '2026-11-12T03:00:00.000Z', body: '## Plan review notes\n\nfits one session' };
    assert.equal(assembleTrailFacts([noVerdict], '').plan.at, noVerdict.createdAt);
  });
});

describe('the reading changes one kind per comment made (LIN-4458), each pinned by name', () => {
  const PR1 = 'https://github.com/acme/widget/pull/41';
  const PR2 = 'https://github.com/acme/widget/pull/42';
  const c = (n, body) => ({ id: `c${n}`, body, createdAt: `2026-11-12T0${n}:00:00.000Z` });

  // Before (f9a8cbcd1): true. The heading made it no plan-review VERDICT (no verdict word), so nothing
  // excluded it. Now the comment is of kind plan-review, which is never a person's comment.
  test('change 1: a plain-first-line comment with a plan-review heading lower down, no verdict word and no PR, is no longer a person\'s comment', () => {
    const body = 'Thanks, see below.\n\n## Plan review notes\n\nStill reading.';
    assert.equal(commentKindOf(body), 'plan-review');
    assert.equal(isPersonComment(body), false);
  });

  // Before (f9a8cbcd1): 1 verdict. The heading test ignored the agent-note opening. Now the agent-note
  // row is matched first, so the note is the planner's, and its quoted verdict is not counted.
  test('change 2: an agent\'s note that carries a plan-review heading with a verdict is no longer counted as a plan-review verdict', () => {
    const note = c(1, 'Plan revised to address the review.\n\n### Plan Review Verdict\n\n**Verdict:** Approve');
    assert.equal(commentKindOf(note), 'agent-note');
    const f = assemblePlanReviewFacts([note]);
    assert.equal(f.verdicts, 0);
    assert.equal(f.latestVerdict, null);
  });

  // Before (f9a8cbcd1): true. The audit check's own close-out test counted a review whose title mentions
  // a close-out as the landing's close-out. Now that review is a review (as the landing and the
  // after-review readings already read it), so no close-out is on the trail and no audit "already ran".
  test('change 3: the audit-already-ran check no longer takes a review titled with "close-out" as the landing\'s close-out', () => {
    const trail = [
      c(1, `Implementation done: ${PR1}, CI green.`),
      c(2, `## Review — conditional on close-out\n\nReviewed ${PR1}.\n\n**Verdict: Approve**`),
      c(3, `## Retrospective audit — LIN-1\n\nNotes PR: ${PR2}.`),
    ];
    assert.equal(commentKindOf(trail[1]), 'review');
    assert.equal(readTrail(trail).auditAfterCloseOut, false);
    assert.equal(assembleTrailFacts(trail, '', { leaf: false }).auditAfterCloseOut, false);
  });
});

// ─── The census ────────────────────────────────────────────────────────────────

const RETIRED = [
  'isReviewSummary', 'isCloseOut', 'isBlindRead', 'isSurveyReport', 'isSurveyComment', 'isAnySurveyComment',
  'isAgentNote', 'isRuling', 'isPersonComment', 'isLandingEvidence', 'isAuditReport', 'isAreaRead',
  'auditAfterLandingCloseOut', 'opensWithHeading', 'firstHeading', 'firstLineOf', 'titleOf',
  'AGENT_NOTE_RE', 'RULING_MARK', 'CLOSE_OUT_TITLE_RE', 'PLAN_REVIEW_VERDICT_HEADING', 'PLAN_REVIEW_LEGACY_HEADING',
  'isPlanComment', 'PLAN_HEADING_ANY',
];
const OPENING = /close-\??out|retrospective audit|plan review verdict|plan\[-\\s\]\+review|area read|blind read|survey (?:open|global)|autopilot\\b|plan\\s\+\(\?:posted|ruling recorded|\^plan\\b|implementation plan/i;

/**
 * Regexes that spell an opening but read a DESCRIPTION, never a comment, so they are not comment
 * kinds. Each is named with its file and why; an exception that no longer matches its file fails.
 */
const DESCRIPTION_READERS = [
  { file: 'lib/file-pointer.js', pattern: '^##[ \\t]+Implementation Plan\\b[^\\n]*$', why: 'extractPlanSection cuts the plan section out of a description' },
  { file: 'lib/recommendation-facts.js', pattern: '^##[ \\t]+Implementation Plan\\b[^\\n]*$', why: 'condensePlan condenses the plan section of a description for routing' },
  { file: 'lib/follow-on-ratio.js', pattern: '#{1,4}\\s*implementation plan\\b|\\bfits one session\\b|\\bneeds multiple sessions\\b', why: 'PLAN_MARKER, the follow-on ratio\'s did-plan-run marker, is matched against the description only (its limit 7)' },
];
const excepted = (file, pattern) => DESCRIPTION_READERS.some(e => e.file === file && e.pattern === pattern);

// The scope is shared with LIN-4466's blind-read words scan (tests/unit/helpers/shipped-sources.js).
const scannedFiles = () => shippedSourceFiles().filter(f => f !== HOME);

// A kind check written as a string method, not a regex: `x.startsWith('## Blind read')`,
// `x.includes(BLIND_READ_HEADING)`, `x.startsWith(SURVEY_HEADINGS[k])` (LIN-4458 review, ledger 2).
const STRING_METHODS = ['startsWith', 'includes', 'indexOf', 'match', 'test', 'endsWith'];
const HEADING_LITERAL = /^#{1,6}\s/;

function stringMethodFinding(node) {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression' || node.callee.computed) return null;
  if (!STRING_METHODS.includes(node.callee.property.name)) return null;
  for (const arg of node.arguments) {
    if (arg.type === 'Identifier' && arg.name === 'BLIND_READ_HEADING') return `${node.callee.property.name}(BLIND_READ_HEADING)`;
    if (arg.type === 'MemberExpression' && arg.object.type === 'Identifier' && arg.object.name === 'SURVEY_HEADINGS') return `${node.callee.property.name}(SURVEY_HEADINGS…)`;
    if (arg.type === 'Literal' && typeof arg.value === 'string' && HEADING_LITERAL.test(arg.value) && OPENING.test(arg.value)) return `${node.callee.property.name}(${JSON.stringify(arg.value)})`;
  }
  return null;
}

function findings(file) {
  const ast = acorn.parse(readFileSync(join(REPO, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const out = [];
  walk.full(ast, (node) => {
    const viaMethod = stringMethodFinding(node);
    if (viaMethod) out.push(`string method ${viaMethod}`);
    const declared = node.type === 'FunctionDeclaration' ? node.id?.name
      : node.type === 'VariableDeclarator' && node.id.type === 'Identifier' ? node.id.name : null;
    if (declared && RETIRED.includes(declared)) out.push(`declares ${declared}`);
    if (node.type === 'Literal' && node.regex && OPENING.test(node.regex.pattern) && !excepted(file, node.regex.pattern)) out.push(`regex /${node.regex.pattern}/`);
    if (node.type === 'Literal' && typeof node.value === 'string' && node.value.includes('Ruling recorded via Harbour')) out.push('the ruling mark as a string');
  });
  return out;
}

describe('the census: no comment-kind test outside lib/run-trail.js', () => {
  test('the scan reaches the files that held the old classifiers', () => {
    const files = scannedFiles();
    for (const f of ['lib/run-ledger.js', 'lib/recommendation-facts.js', 'lib/recommendation-look-first.js', 'routes/proxy-writes.js', 'lib/run-evidence.js']) assert.ok(files.includes(f), f);
    assert.ok(!files.includes(HOME));
  });

  test('the census would catch the old copies: each retired shape is a finding', () => {
    const scan = (src) => { const out = []; walk.full(acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' }), (n) => { if (n.type === 'Literal' && n.regex && OPENING.test(n.regex.pattern)) out.push(n.regex.pattern); }); return out; };
    assert.equal(scan('const a = /^retrospective audit\\b/i;').length, 1);
    assert.equal(scan('const a = /^(?:autopilot\\b|plan\\s+(?:posted|revis\\w*)\\b)/i;').length, 1);
    assert.equal(scan('const a = /^#{1,4}[ \\t]*close-?out\\b/i;').length, 1);
    assert.equal(scan('const a = /^Plan Review Verdict\\b/i;').length, 1);
  });

  // The string-method shapes (LIN-4458 review, ledger 2): each passed the census before it read them.
  test('the census would catch a kind check written with a string method: literal, identifier and member-expression forms', () => {
    const scan = (src) => { const out = []; walk.full(acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' }), (n) => { const f = stringMethodFinding(n); if (f) out.push(f); }); return out; };
    assert.equal(scan('const a = String(b).startsWith("## Blind read");').length, 1, 'a heading literal');
    assert.equal(scan('const a = b.includes(BLIND_READ_HEADING);').length, 1, 'the heading identifier');
    assert.equal(scan('const a = b.startsWith(SURVEY_HEADINGS[k]);').length, 1, 'a member of SURVEY_HEADINGS');
    assert.equal(scan('const a = b.indexOf(SURVEY_HEADINGS["survey-task"]) === 0;').length, 1, 'indexOf, string key');
    for (const m of ['match', 'test', 'endsWith']) assert.equal(scan(`const a = b.${m}(BLIND_READ_HEADING);`).length, 1, m);
    assert.equal(scan('const a = b.startsWith("## Close-out");').length, 1, 'any heading literal spelling an opening');
    assert.equal(scan('const a = b.startsWith("## Notes");').length, 0, 'a heading that is no comment kind');
    assert.equal(scan('const a = b.startsWith("close-out");').length, 0, 'not a heading literal');
    assert.equal(scan('const a = b.replace(BLIND_READ_HEADING, "");').length, 0, 'a method outside the list');
  });

  test('outside lib/run-trail.js: no retired predicate, no opening regex, no ruling-mark string, no string-method kind check', () => {
    const hits = scannedFiles().flatMap(f => findings(f).map(x => `${f}: ${x}`));
    assert.deepEqual(hits, []);
  });

  test('each description-reader exception still names a regex in its file (no stale exception)', () => {
    for (const e of DESCRIPTION_READERS) {
      const patterns = [];
      walk.full(acorn.parse(readFileSync(join(REPO, e.file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }), (n) => { if (n.type === 'Literal' && n.regex) patterns.push(n.regex.pattern); });
      assert.ok(patterns.includes(e.pattern), `${e.file}: ${e.why}`);
    }
  });

  test('the plan-comment opening, written outside the home, is a finding', () => {
    const scan = (src) => { const out = []; walk.full(acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' }), (n) => { if (n.type === 'Literal' && n.regex && OPENING.test(n.regex.pattern)) out.push(n.regex.pattern); }); return out; };
    assert.equal(scan('const a = /^plan\\b/i;').length, 1);
    assert.equal(scan('const a = /^#{1,3}[ \\t]+Implementation Plan\\b/im;').length, 1);
  });

  test('lib/run-trail.js holds the openings the census forbids elsewhere', () => {
    const home = findings(HOME);
    assert.ok(home.some(x => x.startsWith('regex')), 'the openings are regexes in the home');
    assert.ok(home.includes('the ruling mark as a string'));
  });
});
