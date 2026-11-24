/**
 * LIN-4529: the retirement census for the rulings-as-records and ticket-section slice (LIN-4530 is its P1, the design and
 * the decision's own words; LIN-4543 is P9, which finalises the census). Each later piece of the slice adds the words it
 * retires to RETIRED, with a per-file reasoned allowance in ALLOW for any file that must keep one. This test then fails
 * on any retired word that comes back in the code, the live docs, the fixtures or the public pages.
 *
 * It is built on the LIN-4495 and LIN-4502 censuses: the same file scan (tests/unit/helpers/retirement-census.js, with
 * its roots and reasoned exclusions: dated papers, plans and designs of record, reviews, the walk-8 stores, the runner
 * kit), the same per-word, per-file allowance, and the same planted-mutation proof. It started with RETIRED empty (P1
 * retired nothing); LIN-4535 and LIN-4533 added the first words. A list is not a pass for free, so the proof below shows the scan sees a planted
 * word in a synthetic file and in a real file's text, and that an allowance hides only its word in only its file.
 *
 * Designs and plans of record (docs/plans/, including the integration design this slice revises) are excluded by the
 * shared list: they quote the retired words as the design they are, and rewriting them would falsify the record.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFiles, CENSUS_ROOTS, EXCLUDED_PREFIXES } from './helpers/retirement-census.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * This census's exclusions: the shared list, plus recorded history the standing answer keeps as it is (LIN-4529 plan
 * item 4). Local to this census: the shared helper and the LIN-4495/LIN-4502 censuses are left alone.
 */
export const EXCLUDED = Object.freeze({
  ...EXCLUDED_PREFIXES,
  'docs/archive/': 'archived docs: recorded history, kept as it is (standing answer)',
  'scripts/eval/fixtures/': 'recorded eval history, kept as it is (standing answer)',
});

/** The words this slice retires, each with the spelling the census matches: each piece's own, and LIN-4543's final sweep. */
export const RETIRED = Object.freeze([
  // LIN-4535 (P5): the text authorship readers. A person's comment is its finding (lib/comment-ingest.js), never a comment's words.
  { word: 'isPersonComment', re: /\bisPersonComment\b/ },
  { word: 'isAgentActivity', re: /\bisAgentActivity\b/ },
  { word: 'reportsLandedWork', re: /\breportsLandedWork\b/ },
  { word: 'opensAsAgentNote', re: /\bopensAsAgentNote\b/ },
  { word: 'holdingComment', re: /\bholdingComment\b/ },
  // LIN-4533 (P3): the DECISION:/WITHDRAW: block taught to a stage or a person. The spellings a prompt, manual, doc or catalogue
  // teaches: the backticked name, a line that opens with the marker, or the marker written with its JSON. A question is asked with
  // a question record (lib/prompts/handoff-words.js), so no Harbour text teaches the block.
  { word: 'DECISION: block taught', re: /`DECISION:`|^DECISION:|DECISION: \{/m },
  { word: 'WITHDRAW: block taught', re: /`WITHDRAW:`|^WITHDRAW:|WITHDRAW: \{/m },
  // LIN-4536 (P6a): the quote of the person's words above the model-written brief, and the `?run=` door that put the
  // records parts above it. GET /api/proxy/brief is the records brief for the credential's own run; part 1 is the task as
  // filed under ASKED_HEADING (lib/records/words.js). (`splitQuote` is the LIN-4502 census's row; its last allowance went here.)
  { word: 'the brief quote module', re: /brief-quote\.js/ },
  { word: 'quoteAsked', re: /\bquoteAsked\b/ },
  { word: 'composeBrief', re: /\bcomposeBrief\b/ },
  { word: 'briefQuoteEnd', re: /\bbriefQuoteEnd\b/ },
  { word: 'attachAsked', re: /\battachAsked\b/ },
  { word: 'parentWordsOf', re: /\bparentWordsOf\b/ },
  { word: 'the quote end line constants', re: /\bASKED_(?:END|END_SHORT|PARENT_HEADING|PARENT_END)\b/ },
  { word: 'withRunRecords', re: /\bwithRunRecords\b/ },
  { word: 'the brief ?run= door', re: /brief\/[^\s`'"()]*\?run=/ },
  // LIN-4540 (P7b-1): the comment scan, with its routes, page section, Scan-due tab, jobs and fingerprint, and shelving, with
  // its store, route and page controls. A question is answered or dismissed; the Harbour-comments ledger stays for the
  // comment ingest (lib/harbour-comments-store.js keeps resolveCommentId). The shelved-rulings collection stays as history
  // in the erasure inventories (tests/unit/lin-4540-scan-shelving-retired.test.js).
  { word: 'the scan module', re: /\blib\/scan\.js\b|from ['"]\.\/scan\.js['"]/ },
  { word: 'the scan page script', re: /public\/scan\.js|['"]\/scan\.js['"]/ },
  { word: 'the scan fingerprint', re: /scan-fingerprint|\b(?:scanBasisFromContext|scanBasisHashFromContext|dueBasisFromContext|dueBasisHashFromContext)\b/ },
  { word: 'the scan routes', re: /workspace-api-scan|\bregisterScanRoutes\b|\/api\/scan\b/ },
  { word: 'the scan section', re: /\bScanSection\b|data-scan-placeholder|data-toggle="scan"/ },
  { word: 'the scan calls', re: /\b(?:generateScan|buildScanMessages|parseScanResponse|buildMockScanText)\b|['"]scan-retire['"]/ },
  { word: 'the Scan-due tab', re: /obs-tab-due|obs-due-|\bscanDue\b|\b(?:startBulkScan|stopBulkScan|startDueBulkScan)\b|BULK_SCAN_|\bscanEstimateOf\b|\bscanCostEstimate\b/ },
  { word: 'the shelving store', re: /shelved-rulings-store|\b[Ss]helvedRulingsStore\b/ },
  { word: 'shelving on a ruling', re: /\bshelvedLapseCount\b|\bshelvedTaskIdentifiers\b|rulings\/shelve\b|clear-shelved-rulings|obs-ruling-shelve|\b(?:shelveRulingRow|makeShelveButton|toggleShelvePanel)\b|\bSHELVE_DURATIONS\b/ },
  // LIN-4537 (P6b): the model-written brief and recap, their two caches, their routes (POST /api/proxy/brief, GET and
  // POST /api/proxy/recap, GET and POST /api/brief and /api/recap), the task-page, session, swipe and tree panels and their
  // widgets, the chat tools, the model operations, the replay script, and the stage prompts' "read the current description
  // and comment thread" line. An agent reads the records brief (lib/records/run-brief.js). The two cache collections stay
  // named only by the one-off drop module (lib/drop-brief-recap-caches.js) and the erasure inventories, until it has run.
  { word: 'the brief and recap modules', re: /\blib\/(?:brief|recap|brief-cache|recap-cache)\.js\b/ },
  { word: 'the brief and recap calls', re: /\b(?:generateBrief|generateRecap|buildBriefMessages|buildRecapMessages|cleanBriefResponse|parseRecapResponse|DEFAULT_BRIEF_MODEL|DEFAULT_RECAP_MODEL|buildMockBrief|buildMockRecap|buildMockRecapContext|buildMockRecapFromContext|buildMockRecapContextFromFixtures)\b/ },
  { word: 'the brief and recap caches', re: /\b(?:BriefCacheStore|RecapCacheStore|InMemoryBriefCacheStore|InMemoryRecapCacheStore|briefCacheStore|recapCacheStore|hashContext)\b|clear-(?:brief|recap)-cache/ },
  { word: 'the brief and recap routes', re: /\/api\/(?:brief|recap)\/|\/api\/proxy\/recap\b|\/api\/proxy\/issues\/[^\s`'"]*\/recap\b|\/recap\/(?:\{id\}|:id|\$\{)/ },
  { word: 'the brief and recap widgets', re: /\b(?:BriefSection|RecapSection)\b|public\/(?:brief|recap)\.js|['"]\/(?:brief|recap)\.js['"]|data-(?:brief|recap)-placeholder|data-toggle="(?:brief|recap)"/ },
  { word: 'the brief and recap panels', re: /\b(?:renderContextPanel|renderRecapBody|renderTaskContext|contextSignature|briefCurrentSection|briefWithoutCurrent|joinSessionIssueContext|readCachedContext|mountWidgets|enhanceContextMarkdown)\b|task-page-(?:summary|context|write-brief|write-recap)\b/ },
  { word: 'the brief and recap chat tools', re: /\bget_brief\b|\bget_recap\b/ },
  { word: 'formatDiscussionReference', re: /\bformatDiscussionReference\b/ },
  { word: 'the brief and recap replay script', re: /lin-263-spike4\.mjs/ },
  // LIN-4541 (P7b-2): the ruling predicate, the old ruling stores, the agents' rulings route and its suggestions, the page's
  // old ruling writes, the store's decision writers, answers as comments, and the test seams that served them. A question is
  // a question record and its answer a decision record (lib/question-answers.js). The old collections stay as history,
  // named only by the erasure inventories (tests/unit/lin-4541-ruling-stores-retired.test.js); the four decision feedback
  // kinds stay as read-only history rows (lib/dispatch-feedback-kinds.js), so old rows still display.
  { word: 'the ruling predicate module', re: /unanswered-decisions\.js/ },
  { word: 'the ruling predicate', re: /\b(?:collectUnansweredDecisions|openDecisionLoopIds|rulingStandingOf|buildRulingRef|answeredDecisionIdsByLineage|isDecisionAnsweredInLineage|isDecisionAnswered|isDecisionWithdrawn|parseStampLoopIds|STAMP_LOOP_IDS_MESSAGE|MAX_STAMP_LOOP_IDS)\b/ },
  { word: 'the old ruling stores', re: /task-decisions-store|dismissal-suggestions-store|\b(?:TaskDecisionsStore|DismissalSuggestionsStore|taskDecisionsStore|dismissalSuggestionsStore|attachStandingSuggestions)\b/ },
  { word: 'the agents\' rulings route', re: /proxy-rulings\.js|\bcreateRulingsRoutes\b|\/api\/proxy\/rulings\b|\bsuggest-(?:dismissal|answer)\b|\brulingSuggest(?:Dismissal|Answer)\b/ },
  { word: 'the page\'s old ruling writes', re: /rulings\/(?:dismiss|answer|keep|reverse-withdrawal)\b|\b(?:dismissRuling|deliverRulingStampOnly|agreeRulingRow|keepRulingRow|bulkAgreeSelected|renderRulingRow)\b|obs-ruling-(?:bulk|agree|keep|select-all)/ },
  { word: 'the decision writers', re: /\b(?:markDecisionAnswered|markDecisionWithdrawn|markDecisionWithdrawalReversed|isDecisionSettled|isDecisionSettledIn)\b/ },
  { word: 'answers as comments', re: /\b(?:RULING_MARK|stampDecisionAnswers|decisionStampDedupe|deliverRulingRecord|deliverRulingDispatch|deliverRulingAnswer|deliverRulingReply|composeDispatchPrompt|deliveredEffect)\b|Ruling recorded via Harbour/ },
  { word: 'the old ruling test seams', re: /clear-task-decisions|clear-dismissal-suggestions|\/test\/task-decisions\b/ },
  // LIN-4542 (P8): the formal size section. The size of the move is a standing decision by scoping on the task, read by
  // the selector and look-first from records (lib/recommendation-input.js sizeDecisionsOfTicket); a `## Size of the move`
  // section in a description is ordinary text. The module, its guard's four 422s and wording tables, its readers and the
  // record's fixed lines and decided-by values go; the standing policy's line moved, word for word, to
  // lib/prompt-template-defs.js (STANDING_SIZE_POLICY).
  { word: 'the size module', re: /size-of-move/ },
  { word: 'the size guard codes', re: /\bSIZE_RECORD_(?:HOW|POLICY_CUT|SHAPE|DROPPED|CODES)\b|\brefusedBySizeRecord\b|\bSIZE_(?:HOW|SHAPE)_WORDS\b/ },
  { word: 'the size readers', re: /\b(?:readSizeRecord|checkSizeRecord|sizeFact|recordShape|STANDING_POLICY_LINE|SIZE_OF_MOVE_HEADING|RECORD_LINES|RECORD_PARTS|DECIDED_BY_LABEL|DECIDED_BY_MAX_OTHER_WORDS|CUT_MAX_OTHER_WORDS|WHY_MAX_WORDS)\b/ },
  { word: 'the size record\'s decided-by line', re: /\*\*Decided by:\*\*|pending a ruling/ },
  // LIN-4543 (P9): the census made final. The plan §5 searches, re-run at the close, and every export the slice's pieces
  // deleted, checked against the rows above: these were gone from the tree but no row kept them gone. Each is a piece's
  // retirement, named here so it cannot come back.
  // Ask item 7, the text rules for who wrote a comment: LIN-4535 retired `isRuling` as an authorship test.
  { word: 'isRuling', re: /\bisRuling\b/ },
  // Ask item 7, the predicate that stitches the stores: its effect choice and the closer's reads (LIN-4538, LIN-4541).
  { word: 'the predicate\'s effect and closer reads', re: /\b(?:resolveEffect|isSettledForCloser|ticketClosedBasisHash|liveOnAnchor)\b|live-anchor\.js/ },
  // Ask item 7, answers as comments: the digest's answer-stamp readers (LIN-4541 close-out).
  { word: 'the answer-stamp digest reads', re: /\b(?:_findDecisionAnswer|resolvedDecisionEvents)\b/ },
  // Ask item 7, the scan: its model default, payload parser and decision checks (LIN-4540).
  { word: 'the scan\'s model and parsers', re: /\b(?:DEFAULT_SCAN_MODEL|extractScanPayload|isClaimedDecisionValid|isExplicitRetirementSignal)\b/ },
  // Ask item 7, the formal size section: its line labels (LIN-4542).
  { word: 'the size section\'s labels', re: /\b(?:CUTS_LABEL|SIZE_LABEL|WHY_LABEL|NO_CUTS|WRONG_WORK)\b/ },
  // Ask item 5, stage runs write no comments: the Periodical gate's comment-evidence checks (LIN-4533).
  { word: 'the comment-evidence checks', re: /\b(?:hasReportEvidenceComment|hasAdversarialReadEvidenceComment)\b/ },
  // Ask item 7, the model-written brief: the mock brief's fixture parent (LIN-4537).
  { word: 'the brief mock\'s fixture parent', re: /fixture-parent\.js|\bfixtureParent\b/ },
]);

/** Files that keep a retired word, each with the words it may keep and the reason. */
export const ALLOW = Object.freeze({
  // LIN-4533 (P3): the dated log of prompt-template changes. Its earlier entries name the block they changed; that is recorded history.
  // LIN-4536 (P6a): its LIN-4502 row names the brief quote module it changed; that is recorded history too.
  'scripts/prompt-template-change-log.md': { words: ['DECISION: block taught', 'the brief quote module', 'the brief and recap modules', 'the brief and recap chat tools', 'the brief and recap routes', 'formatDiscussionReference', 'the size module', 'the size guard codes', 'the size readers', 'the size record\'s decided-by line'], reason: 'the dated log of prompt-template changes: its earlier entries quote the DECISION: block and name the brief quote module, the brief module, its chat tool, the discussion-reference formatter and the size section\'s module, guard and lines they changed, which is recorded history (LIN-4533, LIN-4536, LIN-4537 and LIN-4542 add their own entries)' },
  // LIN-4533 (P3): a recorded liveness fixture of a past cycle (LIN-3238). Its messages are the transcript as it was, not taught text.
  'tests/fixtures/liveness/lin-3238-cycle.json': { words: ['DECISION: block taught'], reason: 'a recorded liveness fixture of the LIN-3238 cycle: its messages are the transcript as it was, kept as history' },
  // LIN-4537 (P6b): dated research and eval records that name the brief and recap as they were. Rewriting them would
  // falsify the record (standing answer: recorded history stays as it is).
  'docs/lin-260-prompt-scaling-research.md': { words: ['the brief and recap modules', 'the brief and recap calls'], reason: 'dated research (LIN-260) that measured the brief and recap as they were; recorded history, kept as it is' },
  'docs/lin-418-llm-tracking-research.md': { words: ['the brief and recap modules', 'the brief and recap calls'], reason: 'dated research (LIN-418) that traced the LLM calls of its day, the brief and recap among them; recorded history, kept as it is' },
  'scripts/eval/lin-263-spike4-results.md': { words: ['the brief and recap calls', 'the brief and recap replay script'], reason: 'the recorded results of the LIN-263 spike, which ran the brief and recap through the retired replay script; recorded history, kept as it is' },
  'docs/prompt-pipeline/stage-descriptions/breakdown-triage-blocked-context.md': { words: ['formatDiscussionReference'], reason: 'dated notes of 3 Oct 2026 (superseded in part, see that directory\'s README) describing the templates as they were; recorded history' },
  'docs/prompt-pipeline/stage-descriptions/implementation-bug-lookinto.md': { words: ['formatDiscussionReference'], reason: 'dated notes of 3 Oct 2026 (superseded in part, see that directory\'s README) describing the templates as they were; recorded history' },
  'docs/prompt-pipeline/stage-descriptions/research-scoping-spike.md': { words: ['formatDiscussionReference'], reason: 'dated notes of 3 Oct 2026 (superseded in part, see that directory\'s README) describing the templates as they were; recorded history' },
  // LIN-4541 (P7b-2): the same dated notes name the agents' rulings route and the old stores as the templates read them then.
  'docs/prompt-pipeline/stage-descriptions/retro-audit.md': { words: ['formatDiscussionReference', 'the agents\' rulings route'], reason: 'dated notes of 3 Oct 2026 (superseded in part, see that directory\'s README) describing the templates as they were; recorded history' },
  'docs/prompt-pipeline/stage-descriptions/review-closeout.md': { words: ['formatDiscussionReference', 'the old ruling stores', 'the agents\' rulings route'], reason: 'dated notes of 3 Oct 2026 (superseded in part, see that directory\'s README) describing the templates as they were; recorded history' },
  'docs/prompt-pipeline/stage-descriptions/plumbing.md': { words: ['the brief and recap calls'], reason: 'dated notes of 3 Oct 2026 (superseded in part): a proposed generateBrief writer, never built; recorded history' },
});

/**
 * Every retired word in the given files, outside the per-word allowance: `[{file, word, line}]`. Pure over the file text,
 * so the planted-mutation tests can run it over synthetic files. A file under an excluded prefix is skipped, as in the
 * census's file list.
 * @param {Record<string, string>} files - repo-relative path → text
 * @param {{retired?: readonly {word: string, re: RegExp}[], allow?: Record<string, {words: string[], reason: string}>}} [opts]
 */
export function findRetired(files, { retired = RETIRED, allow = ALLOW } = {}) {
  const hits = [];
  for (const [file, text] of Object.entries(files)) {
    if (Object.keys(EXCLUDED).some((p) => file.startsWith(p))) continue;
    for (const { word, re } of retired) {
      if (allow[file]?.words.includes(word)) continue;
      const m = re.exec(text);
      if (!m) continue;
      hits.push({ file, word, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return hits;
}

const censusFiles = () => scanFiles(ROOT, CENSUS_ROOTS, EXCLUDED);
const readAll = (files) => Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

describe('LIN-4529 retirement census: what the slice retires is gone from the tree', () => {
  test('no retired word outside the per-word allowance and the exclusions', () => {
    const hits = findRetired(readAll(censusFiles()));
    assert.deepStrictEqual(hits, [], `retired words still in the tree:\n${hits.map((h) => `  ${h.file}:${h.line} ${h.word}`).join('\n')}`);
  });

  test('the scan reads the code and the live docs, and not the designs and plans of record', () => {
    const files = censusFiles();
    assert.ok(files.includes('lib/records/check.js'), 'the records code is scanned');
    assert.ok(files.includes('routes/proxy-records.js'), 'the records routes are scanned');
    assert.ok(!files.some((f) => f.startsWith('docs/plans/')), 'designs and plans of record are excluded, with their reason');
    assert.ok(!files.some((f) => f.startsWith('docs/archive/')), 'archived docs are recorded history and are not scanned');
    assert.ok(!files.some((f) => f.startsWith('scripts/eval/fixtures/')), 'recorded eval fixtures are history and are not scanned');
  });

  test('every allowance is scanned, still holds each word it allows, and carries a reason (a stale allowance fails)', () => {
    const all = readAll(censusFiles());
    for (const [file, { words, reason }] of Object.entries(ALLOW)) {
      assert.ok(all[file] !== undefined, `${file} is allowed but not scanned`);
      for (const word of words) {
        const row = RETIRED.find((r) => r.word === word);
        assert.ok(row, `${file} allows "${word}", which is not a retired word`);
        assert.ok(row.re.test(all[file]), `${file} is allowed "${word}" but no longer holds it: drop it`);
      }
      assert.ok(reason.length > 20, `${file} needs a reason`);
    }
  });

  test('each retired word has one row, a name, and a pattern', () => {
    const words = RETIRED.map((r) => r.word);
    assert.equal(new Set(words).size, words.length, 'no word is listed twice');
    for (const row of RETIRED) {
      assert.ok(row.word.length > 0 && row.re instanceof RegExp, `${row.word} has a name and a pattern`);
    }
  });

  test('a planted retired word is seen in every kind of file, one row per word', () => {
    const planted = [
      { word: 'planted: a function', re: /\bplantedRetiredFunction\b/ },
      { word: 'planted: a constant', re: /\bPLANTED_RETIRED_CONSTANT\b/ },
      { word: 'planted: a docs phrase', re: /planted retired phrase/ },
    ];
    const files = {
      'lib/p1.js': 'export const x = plantedRetiredFunction(1);\n',
      'routes/p2.js': "const code = 'PLANTED_RETIRED_CONSTANT';\n",
      'docs/areas/p3.md': 'The planted retired phrase is here.\n',
      'public/p4.js': 'const note = "planted retired phrase";\n',
      'scripts/p5.mjs': 'plantedRetiredFunction();\n',
    };
    const hits = findRetired(files, { retired: planted });
    assert.deepStrictEqual(hits.map((h) => `${h.file} ${h.word}`).sort(), [
      'docs/areas/p3.md planted: a docs phrase',
      'lib/p1.js planted: a function',
      'public/p4.js planted: a docs phrase',
      'routes/p2.js planted: a constant',
      'scripts/p5.mjs planted: a function',
    ]);
  });

  test('a per-word allowance hides only its word in only its file', () => {
    const retired = [
      { word: 'word A', re: /\bwordA\b/ },
      { word: 'word B', re: /\bwordB\b/ },
    ];
    const allow = { 'lib/keeps.js': { words: ['word A'], reason: 'a test allowance that keeps word A in this one file' } };
    const files = {
      'lib/keeps.js': 'wordA(); wordB();\n',
      'lib/other.js': 'wordA();\n',
    };
    assert.deepStrictEqual(findRetired(files, { retired, allow }).map((h) => `${h.file} ${h.word}`).sort(), [
      'lib/keeps.js word B',
      'lib/other.js word A',
    ]);
  });

  test('an excluded prefix is skipped, as in the other censuses', () => {
    const excluded = ['docs', 'plans', 'x.md'].join('/');
    const retired = [{ word: 'word A', re: /wordA/ }];
    assert.deepStrictEqual(findRetired({ [excluded]: 'wordA\n' }, { retired }), []);
    for (const prefix of ['docs/archive/', 'scripts/eval/fixtures/']) {
      assert.deepStrictEqual(findRetired({ [`${prefix}x.json`]: 'wordA\n' }, { retired }), [], `${prefix} is skipped`);
    }
  });

  test('a planted word in a real file is seen: the scan of the records check module, with one line added, fails', () => {
    // A mutation of the real tree in memory: the module's own text, plus one planted line. Nothing is written to disk.
    const real = readFileSync(join(ROOT, 'lib/records/check.js'), 'utf8');
    const retired = [{ word: 'planted: records check', re: /\bPLANTED_RETIRED_IN_REAL_FILE\b/ }];
    assert.deepStrictEqual(findRetired({ 'lib/records/check.js': real }, { retired }), [], 'unmutated, the planted word is absent');
    const mutated = `${real}\n// PLANTED_RETIRED_IN_REAL_FILE\n`;
    const hits = findRetired({ 'lib/records/check.js': mutated }, { retired });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].file, 'lib/records/check.js');
    assert.equal(hits[0].line, real.split('\n').length + 1, 'the hit is on the line that was added');
  });
});
