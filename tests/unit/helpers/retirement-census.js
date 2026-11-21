/**
 * The retirement censuses' shared scan and table (LIN-4495, LIN-4502, LIN-4504; LIN-4524 piece A).
 *
 * Three censuses read this one module:
 *   - CENSUS_WORDS: each census's retired words (label → RegExp). A census checks its own words only, as before.
 *   - RETAINED: the one table of files that keep a retired word, each row a kind (temporary, live or record) with a
 *     reason. A census accepts a hit only when a row covers that file and word, or the file is in SELF.
 *   - WHOLE_ROOTS: the roots a census reads, now the whole tests root as well as the code, docs, fixtures and pages.
 *
 * A row's `words` are census labels, or one of two tokens that cover a whole set:
 *   - '*': every census word, for a dated record or a reasoned directory the census has always skipped;
 *   - 'ALL:<census>': every word of that census (e.g. 'ALL:LIN_4504' for the LIN-4504 eval folders, which only that
 *     census excluded).
 * Both tokens are valid on record rows only. tests/unit/retirement-census-table.test.js pins the schema and checks the
 * real table against the real tree.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/** The roots the census reads before LIN-4524: the code, the live docs, the fixtures and the public pages. */
export const CENSUS_ROOTS = Object.freeze(['lib', 'routes', 'server.js', 'scripts', 'docs', 'tests/fixtures', 'public']);

/** The roots the censuses read now: the census roots and the whole tests root (LIN-4524). */
export const WHOLE_ROOTS = Object.freeze([...CENSUS_ROOTS, 'tests']);

/** Text extensions a census reads; binary assets (fonts, images) are not text and are not scanned. */
export const TEXT_EXT = /\.(m?js|cjs|md|txt|json|html|css|ya?ml)$/;

function textFilesUnder(root, rel, out = []) {
  const full = join(root, rel);
  if (!existsSync(full)) return out;
  if (!statSync(full).isDirectory()) {
    if (TEXT_EXT.test(rel)) out.push(rel.split(sep).join('/'));
    return out;
  }
  for (const name of readdirSync(full)) textFilesUnder(root, join(rel, name), out);
  return out;
}

/**
 * The census's file list: the text under `roots` (repo-relative), minus any path starting with an excluded prefix.
 * @param {string} root - the repo root
 * @param {readonly string[]} roots
 * @param {Record<string, string>} [excludedPrefixes] - prefix → reason (the table replaces these; kept for the scan's own tests)
 * @returns {string[]} sorted repo-relative paths
 */
export function scanFiles(root, roots, excludedPrefixes = {}) {
  return roots.flatMap((r) => textFilesUnder(root, r))
    .filter((f) => !Object.keys(excludedPrefixes).some((p) => f.startsWith(p)))
    .sort();
}

/** The three kinds a row may have: the closed set. */
export const KINDS = Object.freeze(['temporary', 'live', 'record']);

const symbol = (name) => ({ word: name, re: new RegExp(`\\b${name}\\b`) });

/**
 * Each census's retired words, each with the spelling it matches. A label that two censuses share must match the same
 * text (checked below, when WORD_PATTERNS is built).
 */
export const CENSUS_WORDS = Object.freeze({
  LIN_4495: Object.freeze([
    { word: 'Retires:', re: /Retires:/ },
    { word: 'RETIRES_*', re: /\bRETIRES_[A-Z]/ },
    { word: 'LEFTOVER_RETIRES_', re: /LEFTOVER_RETIRES_/ },
    { word: 'NOTES_PR', re: /\bNOTES_PR\b/ },
    { word: '## Waiting', re: /## Waiting\b/ },
    { word: 'countWaiting', re: /\bcountWaiting\b/ },
    { word: 'dispatch-leftover-answer', re: /dispatch-leftover-answer/ },
    { word: 'LEFTOVERS_HEADING', re: /\bLEFTOVERS_HEADING\b/ },
    { word: 'FOR_CLOSE_OUT', re: /\bFOR_CLOSE_OUT\b/ },
    { word: 'FOLLOW_UP_SHAPE', re: /\bFOLLOW_UP_SHAPE\b/ },
    { word: 'dischargedBy', re: /\bdischargedBy\b/ },
    { word: '.discharged', re: /\.discharged\b/ },
    { word: 'ledger.items', re: /\bledger\??\.items\b/ },
    { word: 'ledgerItems / ledgerOpen', re: /\bledger(?:Items|Open)\b/ },
    // LIN-4505: the one-off importer and its frozen Waiting reader are retired (the records they wrote stay, by id).
    { word: 'parseWaitingSection', re: /\bparseWaitingSection\b/ },
    { word: 'countFrozenWaiting', re: /\bcountFrozenWaiting\b/ },
    { word: 'waitingAt', re: /\bwaitingAt\b/ },
    { word: 'planImport', re: /\bplanImport\b/ },
    { word: 'applyManifest', re: /\bapplyManifest\b/ },
    { word: 'waiting-import', re: /\bwaiting-import\b/ },
    { word: 'import-apply', re: /\bimport-apply\b/ },
    { word: 'records-import', re: /\brecords-import\b/ },
    { word: 'parked-tickets', re: /\bparked-tickets\b/ },
  ]),
  LIN_4502: Object.freeze([
    // The seal's, the guard's and the Jira region's functions and classes. Case-sensitive, so the orphaned property's
    // name (`harbour.asAsked`) is not one.
    { word: '*AsAsked* symbols', re: /AsAsked/ },
    // `NO_AS_ASKED_BLOCK` has no word boundary before AS_; it has its own row below.
    { word: 'AS_ASKED_*', re: /\bAS_ASKED_[A-Z]/ },
    { word: 'sealForFiling', re: /\bsealForFiling\b/ },
    { word: 'sealOnFirstDispatch', re: /\bsealOnFirstDispatch\b/ },
    { word: 'hasDispatchForIssue', re: /\bhasDispatchForIssue\b/ },
    { word: 'carriesStageState', re: /\bcarriesStageState\b/ },
    { word: 'descriptionRoundTrip', re: /\bdescriptionRoundTrip\b/ },
    { word: 'hasMarkerLine', re: /\bhasMarkerLine\b/ },
    { word: 'the As-asked modules', re: /\bas-asked(?:-seal|-region)?\.js\b/ },
    { word: 'the [as-asked] log lines', re: /\[as-asked\]/ },
    { word: 'splitQuote', re: /\bsplitQuote\b/ },
    { word: 'belowDescription', re: /\bbelowDescription\b/ },
    { word: 'NO_AS_ASKED_BLOCK', re: /\bNO_AS_ASKED_BLOCK\b/ },
    { word: 'the write-below route', re: /description\/below/ },
    { word: 'keepBlockThen', re: /\bkeepBlockThen\b/ },
    { word: 'Archive & Prune', re: /Archive & Prune/ },
    { word: 'task-snapshot-store', re: /task-snapshot-store/ },
    { word: 'task snapshot symbols', re: /\b(?:TaskSnapshotStore|taskSnapshotStore|captureTaskSnapshot|snapshotFromContext|diffSnapshots)\b/ },
    { word: 'clear-task-snapshots', re: /clear-task-snapshots/ },
    { word: 'the /snapshots routes', re: /issues\/[^\s`'"()]*\/snapshots\b/ },
    // Not inside a longer hyphenated name (clear-task-snapshots has its own row).
    { word: 'the task-snapshots collection', re: /(?<![\w-])task-snapshots\b/ },
  ]),
  LIN_4504: Object.freeze([
    { word: 'the plan heading', re: /implementation plan/i },
    { word: 'fits one session', re: /\bfits one session\b/i },
    { word: 'needs multiple sessions', re: /\bneeds multiple sessions\b/i },
    { word: 'plan-review due', re: /plan-review due/i },
    ...['extractPlanSection', 'extractPlanPaths', 'PLAN_HEADING_ANY', 'isPlanComment', 'sessionFitOf', 'extractSessionFit',
      'planReviewDueOf', 'condensePlan', 'PLAN_MARKER', 'parentPlan', 'carriesStageState', 'readFact', 'countPilotEligible',
      'PLAN_READ_TIMEOUT_MS', 'gateFieldsAvailable'].map(symbol),
    { word: 'file-pointer', re: /file-pointer/i },
    { word: 'FILE_POINTER', re: /FILE_POINTER/ },
    { word: 'github-pr-files', re: /github-pr-files/ },
  ]),
});

/**
 * Every census label → its RegExp, merged across the three censuses. Throws if one label means two spellings, so a
 * shared word (`carriesStageState`) cannot quietly match differently in two censuses.
 */
export const WORD_PATTERNS = (() => {
  const map = new Map();
  for (const [census, words] of Object.entries(CENSUS_WORDS)) {
    for (const { word, re } of words) {
      const seen = map.get(word);
      if (seen && seen.source !== re.source) throw new Error(`${census}: "${word}" is spelled two ways`);
      map.set(word, re);
    }
  }
  return map;
})();

/**
 * The census files themselves, by path, each with its reason. They name the words as their own lists and planted
 * files, so the scan skips them. A SELF path may never also be a row.
 */
export const SELF = Object.freeze({
  'tests/unit/lin-4495-retirement-census.test.js': 'the LIN-4495 census: its RETIRED list and planted files name every word it reads',
  'tests/unit/lin-4502-retirement-census.test.js': 'the LIN-4502 census: its RETIRED list and planted files name every word it reads',
  'tests/unit/lin-4504-plan-text-census.test.js': 'the LIN-4504 census: its RETIRED list and planted files name every word it reads',
  'tests/unit/helpers/retirement-census.js': 'the census scan and this table: their word lists and comments name the words they describe',
  'tests/unit/retirement-census-table.test.js': 'the table\'s own tests: their planted bad rows name the words the table refuses',
});

/** The live rules a live row names (path and symbol); the table test checks each symbol still exists in its file. */
const RULE = Object.freeze({
  legacy: { path: 'lib/legacy-plan-text.js', symbol: 'LEGACY_PLAN_HEADING' },
  added: { path: 'lib/legacy-plan-text.js', symbol: 'addedPlanHeadings' },
  facts: { path: 'lib/records/plan-facts.js', symbol: 'planFactsOf' },
  roundTrips: { path: 'lib/plan-review-round-trips.js', symbol: 'computeIssueRoundTrips' },
  readout: { path: 'lib/effort-readout.js', symbol: 'computeEffortReadout' },
  follow: { path: 'lib/follow-on-ratio.js', symbol: 'plannedOf' },
  prompt: { path: 'lib/prompt-templates.js', symbol: 'generatePrompt' },
  brief: { path: 'lib/brief-quote.js', symbol: 'splitQuote' },
  note: { path: 'lib/prompts/area-note-format.js', symbol: 'parseNote' },
  runner: { path: 'lib/runner-kit/runner.mjs', symbol: 'openItems' },
});

const R_LEGACY = 'feeds old plan text and asserts it is left out, refused or kept apart; lib/legacy-plan-text.js is the one recognition rule';
const R_FACTS = 'feeds old session-fit or plan-review text and asserts the plan facts come from records, not the description';
const R_RUNNER = 'the runner\'s own local ledger (lib/runner-kit/runner.mjs), not the cutover\'s ledger';
const DROP_OWNER = 'operator run: scripts/drop-task-snapshots-collection.mjs';
const DROP_EXIT = 'the production drop has run; then the collection name goes from this file';

/**
 * The rows: every file a retired word still hits, sorted into one of the three kinds, or the reasoned directories and
 * records the censuses have always skipped. `file` is repo-relative, or a directory ending in `/`.
 *   - temporary: `owner` (a ticket or an operator run) and `exit` (what removes the hit);
 *   - live: `rule` (a path and symbol that must exist);
 *   - record: the reason says why the dated or recorded text stays.
 */
export const RETAINED = Object.freeze([
  // ── live: the word is the input of a live rule, or the test feeds the old shape and asserts it is ignored ──────────
  { kind: 'live', file: 'tests/e2e/runner-kit-loop.spec.js', words: ['ledger.items'], reason: R_RUNNER, rule: RULE.runner },
  { kind: 'live', file: 'tests/unit/runner-kit-helper.test.js', words: ['ledger.items'], reason: R_RUNNER, rule: RULE.runner },
  { kind: 'live', file: 'lib/runner-kit/runner.mjs', words: ['ledger.items'], reason: R_RUNNER, rule: RULE.runner },
  { kind: 'live', file: 'tests/unit/area-notes.test.js', words: ['## Waiting'], reason: 'the area-notes guard (check 3): a note holds Lessons only, and parseNote reads its sections', rule: RULE.note },
  { kind: 'live', file: 'lib/legacy-plan-text.js', words: ['the plan heading'], reason: 'the one recognition rule for old plan text: it recognises the heading so the selector view and new writes leave it out', rule: RULE.legacy },
  { kind: 'live', file: 'lib/brief-quote.js', words: ['splitQuote'], reason: 'the quote\'s home: splitQuote reads the brief\'s own quote (briefQuoteEnd), and the module defines it', rule: RULE.brief },
  { kind: 'live', file: 'tests/unit/as-asked-marker-census.test.js', words: ['splitQuote'], reason: 'tests the live quote reader splitQuote', rule: RULE.brief },
  { kind: 'live', file: 'tests/unit/as-asked-one-home.test.js', words: ['splitQuote'], reason: 'tests that the quote\'s rules live in one home, lib/brief-quote.js', rule: RULE.brief },
  { kind: 'live', file: 'tests/unit/as-asked-one-home.test.js', words: ['plan-review due'], reason: 'the round-trip gate and the selector read the plan-review gate from records, not the description', rule: RULE.roundTrips },
  { kind: 'live', file: 'tests/unit/brief-quote.test.js', words: ['splitQuote'], reason: 'tests the live quote reader splitQuote', rule: RULE.brief },
  { kind: 'live', file: 'tests/unit/effort-readout.test.js', words: ['plan-review due'], reason: 'the readout reads the plan-review gate from the facts it is given, not the description', rule: RULE.readout },
  { kind: 'live', file: 'tests/unit/effort-readout-route.test.js', words: ['plan-review due'], reason: 'the readout route reads the plan-review gate from records, not the description', rule: RULE.readout },
  { kind: 'live', file: 'tests/unit/follow-on-ratio.test.js', words: ['fits one session', 'needs multiple sessions'], reason: 'planned is read from records; a session-fit line in a description or a comment is not a plan', rule: RULE.follow },
  { kind: 'live', file: 'tests/unit/lin-4370-look-first-route.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/lin-4370-look-first-route.test.js', words: ['plan-review due'], reason: R_FACTS, rule: RULE.facts },
  { kind: 'live', file: 'tests/unit/lin-4392-live-stage-wait.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/lin-4458-comment-kind-census.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/lin-4469-prompt-folds.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/lin-4494-records-pages.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/lin-4499-kept-section-sealed-ask.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/lin-4501-task-at-dispatch.test.js', words: ['splitQuote'], reason: 'the task\'s asked is the quote (splitQuote), not the description around it', rule: RULE.brief },
  { kind: 'live', file: 'tests/unit/lin-4501-task-at-dispatch.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/lin-4502-witness.test.js', words: ['splitQuote'], reason: 'the brief quotes the task\'s words through splitQuote', rule: RULE.brief },
  { kind: 'live', file: 'tests/unit/lin-4502-witness.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/lin-4503-child-tickets.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/lin-4503-child-tickets.test.js', words: ['needs multiple sessions', 'plan-review due'], reason: R_FACTS, rule: RULE.facts },
  { kind: 'live', file: 'tests/unit/lin-4504-plan-facts.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/lin-4504-plan-facts.test.js', words: ['fits one session', 'needs multiple sessions', 'plan-review due'], reason: R_FACTS, rule: RULE.facts },
  { kind: 'live', file: 'tests/unit/lin-4504-plan-writes.test.js', words: ['the plan heading'], reason: 'a new description write that adds a plan heading is refused: addedPlanHeadings', rule: RULE.added },
  { kind: 'live', file: 'tests/unit/next-stage-choice.test.js', words: ['the plan heading'], reason: 'an agent note in the plan form is part of the trail, not a person\'s comment', rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/plan-review-round-trips.test.js', words: ['plan-review due', 'needs multiple sessions'], reason: 'the round trips read the plan from records; the description\'s plan-review line is ignored', rule: RULE.roundTrips },
  { kind: 'live', file: 'tests/unit/prompt-contract.test.js', words: ['the plan heading'], reason: 'no plan goes into a description: the contract is the refusal addedPlanHeadings enforces', rule: RULE.added },
  { kind: 'live', file: 'tests/unit/prompt-templates.test.js', words: ['plan-review due'], reason: 'the copy-down section of the assembled prompt carries no plan-review line', rule: RULE.prompt },
  { kind: 'live', file: 'tests/unit/recent-runs.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/recommendation-facts.test.js', words: ['fits one session', 'needs multiple sessions'], reason: R_FACTS, rule: RULE.facts },
  { kind: 'live', file: 'tests/unit/size-of-move.test.js', words: ['the plan heading'], reason: 'the size record ends at its record: plan text outside it is not part of the record', rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/size-of-move-guard.test.js', words: ['the plan heading'], reason: 'the size record ends at its record: plan text outside it is not part of the record', rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/stage-selector-input.test.js', words: ['the plan heading'], reason: R_LEGACY, rule: RULE.legacy },
  { kind: 'live', file: 'tests/unit/stage-selector-input.test.js', words: ['plan-review due'], reason: R_FACTS, rule: RULE.facts },

  // ── temporary: the owner removes the hit ────────────────────────────────────────────────────────────────────────────
  { kind: 'temporary', file: 'tests/unit/lin-4373-leftover-step.test.js', words: ['LEFTOVERS_HEADING'], reason: 'these hold tests run lib/dispatch-leftover.js\'s queue and hold, which piece C (LIN-4526) removes', owner: 'LIN-4526', exit: 'piece C removes the leftover hold; these tests and their heading go with it' },
  { kind: 'temporary', file: 'tests/unit/lin-4375-session-pr-wins.test.js', words: ['LEFTOVERS_HEADING'], reason: 'these tests run the leftover step\'s hold, which piece C (LIN-4526) removes', owner: 'LIN-4526', exit: 'piece C removes the leftover hold; these tests and their heading go with it' },
  { kind: 'temporary', file: 'lib/asked-of.js', words: ['splitQuote'], reason: 'the one legacy reader of the block that tickets filed before P2 still carry (legacyBlock)', owner: 'LIN-4525', exit: 'piece B removes legacyBlock and its splitQuote call; this row goes with it' },
  { kind: 'temporary', file: 'lib/account-erasure.js', words: ['the task-snapshots collection'], reason: 'a Full wipe keeps erasing the collection while its per-task history is still in production', owner: DROP_OWNER, exit: DROP_EXIT },
  { kind: 'temporary', file: 'lib/drop-task-snapshots-collection.js', words: ['the task-snapshots collection'], reason: 'the one-off drop of the collection; its exported name keeps the collection in the derived universe until it runs', owner: DROP_OWNER, exit: DROP_EXIT },
  { kind: 'temporary', file: 'scripts/drop-task-snapshots-collection.mjs', words: ['the task-snapshots collection'], reason: 'the operator script that runs the drop once after deploy; it names what it drops', owner: DROP_OWNER, exit: DROP_EXIT },
  { kind: 'temporary', file: 'scripts/dry-run-urlkey-duplicates.mjs', words: ['the task-snapshots collection'], reason: 'the operator\'s urlKey dry run reads every collection that still holds workspace data', owner: DROP_OWNER, exit: DROP_EXIT },
  { kind: 'temporary', file: 'tests/unit/urlkey-holders.test.js', words: ['the task-snapshots collection'], reason: 'the holder map names the collection until the drop has run', owner: DROP_OWNER, exit: DROP_EXIT },
  { kind: 'temporary', file: 'tests/unit/drop-task-snapshots-collection.test.js', words: ['the task-snapshots collection'], reason: 'the test of the one-off drop, which names the collection it drops', owner: DROP_OWNER, exit: DROP_EXIT },

  // ── record: dated or recorded text, kept as it was ──────────────────────────────────────────────────────────────────
  { kind: 'record', file: 'tests/judge/audit-report.fixture.json', words: ['the plan heading', 'fits one session', 'needs multiple sessions', 'plan-review due', 'Archive & Prune', 'the /snapshots routes'], reason: 'a recorded judge audit: the prompts and facts as the judge saw them when recorded; tests/judge/replay.spec.js reads it as data' },
  { kind: 'record', file: 'tests/unit/as-asked-lin4085-replay.test.js', words: ['the plan heading', 'plan-review due'], reason: 'the replay of LIN-4085 as filed and as worked: the plan written below the block is part of the recorded input' },
  { kind: 'record', file: 'lib/prompts/leftover-words.js', words: ['Retires:', 'dispatch-leftover-answer'], reason: 'the history header that says what the cutover retired' },
  { kind: 'record', file: 'scripts/prompt-template-change-log.md', words: ['Retires:', 'RETIRES_*', 'LEFTOVER_RETIRES_', 'NOTES_PR', '## Waiting', 'dispatch-leftover-answer', 'LEFTOVERS_HEADING', 'FOR_CLOSE_OUT', 'FOLLOW_UP_SHAPE', 'AS_ASKED_*', 'the As-asked modules', 'the write-below route', 'Archive & Prune', 'the plan heading', 'fits one session', 'plan-review due', 'condensePlan', 'PLAN_MARKER', 'file-pointer'], reason: 'the change log: each row names what it changed or retired, so the old names are the record itself' },
  { kind: 'record', file: 'scripts/survey-overlap-lib.mjs', words: ['the plan heading'], reason: 'the LIN-3179 research instrument: it sorts historical description text into steps by heading; it reads no plan fact and drives no route or metric' },
  { kind: 'record', file: 'tests/fixtures/cost-replay/goldens.json', words: ['plan-review due', 'planReviewDueOf'], reason: 'the frozen LIN-4177 baseline the change list is measured from; it is never re-recorded (agent-api Lesson, LIN-4404)' },
  { kind: 'record', file: 'tests/fixtures/run-ledger-trails.js', words: ['dischargedBy', 'fits one session'], reason: 'recorded trail comments, as written, that the run-ledger tests replay' },
  { kind: 'record', file: 'docs/prompt-system-audit.md', words: ['task-snapshot-store'], reason: 'a dated audit whose recommendations name the store as it stood; the store is retired, the audit is a record' },
  { kind: 'record', file: 'docs/prompt-system-audit.html', words: ['task-snapshot-store'], reason: 'the rendered copy of the dated audit above' },
  { kind: 'record', file: 'docs/prompt-pipeline/stage-descriptions/review-closeout.md', words: ['the write-below route', 'the /snapshots routes'], reason: 'a dated analysis whose banner says the archive, the snapshot check and the prune it describes are retired (LIN-4502)' },
  { kind: 'record', file: 'scripts/eval/fixtures/recommend/large-dense.json', words: ['task snapshot symbols', 'the /snapshots routes'], reason: 'recorded ticket text the recommend eval replays; the words are the tickets\' own, as written' },
  { kind: 'record', file: 'scripts/eval/fixtures/recommend/_source/large-dense.json', words: ['task snapshot symbols', 'the /snapshots routes'], reason: 'the source of the recorded eval fixture above: the tickets\' own words, as written' },

  // ── record: the reasoned directories and files the censuses have always skipped ─────────────────────────────────────
  // Shared by all three censuses (was EXCLUDED_PREFIXES): every census word is covered.
  { kind: 'record', file: 'docs/papers/', words: ['*'], reason: 'research papers: dated records of the method as it was, quoting the retired words as history' },
  { kind: 'record', file: 'docs/plans/', words: ['*'], reason: 'plans and designs of record: the LIN-4491 design quotes the retired words it retires' },
  { kind: 'record', file: 'docs/reviews/', words: ['*'], reason: 'dated review records, including the stability readings from before the cutover' },
  { kind: 'record', file: 'tests/fixtures/walk-8/', words: ['*'], reason: 'the walk-8 stores (LIN-4496), ported to today\'s kinds: the historical records the replay writes through the proxy, and their retired words are the walk\'s record, as the walk wrote them' },
  // LIN-4504 only (was SLICE2_EXCLUDED): the LIN-4502 and LIN-4495 words stay checked in these, as before.
  { kind: 'record', file: 'scripts/eval/recommend-baseline/', words: ['ALL:LIN_4504'], reason: 'a dated eval baseline: the recommend outputs as recorded' },
  { kind: 'record', file: 'scripts/eval/lin-3309-pass-bar/', words: ['ALL:LIN_4504'], reason: 'a dated eval record (LIN-3309): the pass bar as it was set' },
  { kind: 'record', file: 'scripts/eval/lin-263-spike2-out/', words: ['ALL:LIN_4504'], reason: 'a dated eval output folder: what the model wrote then' },
  { kind: 'record', file: 'scripts/eval/lin-263-spike3-out/', words: ['ALL:LIN_4504'], reason: 'a dated eval output folder: what the model wrote then' },
  { kind: 'record', file: 'scripts/eval/jev-routing-out/', words: ['ALL:LIN_4504'], reason: 'a dated eval output folder (LIN-3107)' },
  { kind: 'record', file: 'scripts/eval/assessment-scaffold-out/', words: ['ALL:LIN_4504'], reason: 'a dated eval output folder' },
  { kind: 'record', file: 'scripts/eval/lin-263-spike2-results.md', words: ['ALL:LIN_4504'], reason: 'a dated eval results write-up' },
  { kind: 'record', file: 'scripts/eval/fixtures/', words: ['ALL:LIN_4504'], reason: 'recorded ticket corpora: the tickets\' own words, as written (the invariance test covers what they feed)' },
  { kind: 'record', file: 'scripts/eval/fixtures-widened/', words: ['ALL:LIN_4504'], reason: 'recorded ticket corpora (LIN-3107 class D), as written' },
  { kind: 'record', file: 'scripts/eval/jev-routing-corpus.json', words: ['ALL:LIN_4504'], reason: 'the recorded verb-override corpus table (LIN-3107)' },
  { kind: 'record', file: 'scripts/eval/build-widened-routing-fixtures.mjs', words: ['ALL:LIN_4504'], reason: 'the builder of the recorded fixtures-widened corpus, whose quoted ticket text and two hand-built cases are written in that corpus\'s own era' },
  { kind: 'record', file: 'scripts/eval/jev-routing-eval.mjs', words: ['ALL:LIN_4504'], reason: 'the dated LIN-3107 eval harness; its gold-override reasons quote the recorded corpus' },
  { kind: 'record', file: 'scripts/eval/lin-3372-selector-context/', words: ['ALL:LIN_4504'], reason: 'a dated LIN-3372 experiment that replays recorded points through the selector as it was' },
  { kind: 'record', file: 'scripts/eval-plan-review-verdict.mjs', words: ['ALL:LIN_4504'], reason: 'a paid-model eval\'s seeded input, kept as it was set; paid-model evals were not re-run for LIN-4504' },
  { kind: 'record', file: 'docs/prompt-pipeline/stage-descriptions/', words: ['ALL:LIN_4504'], reason: 'dated analyses (3 Oct 2026), bannered as superseded, describing the prompts as they stood' },
  { kind: 'record', file: 'docs/autopilot-experiment.md', words: ['ALL:LIN_4504'], reason: 'a dated experiment record' },
  { kind: 'record', file: 'docs/lin-260-prompt-scaling-research.md', words: ['ALL:LIN_4504'], reason: 'dated research (LIN-260)' },
  { kind: 'record', file: 'docs/plan-LIN-180-dispatch-custom-prompt.md', words: ['ALL:LIN_4504'], reason: 'a dated plan of record (LIN-180)' },
  { kind: 'record', file: 'docs/recommendation-engine-redesign.md', words: ['ALL:LIN_4504'], reason: 'a dated design record' },
  { kind: 'record', file: 'docs/prompt-system-audit.md', words: ['ALL:LIN_4504'], reason: 'a dated audit whose recommendations name the code as it stood' },
  { kind: 'record', file: 'docs/prompt-system-audit.html', words: ['ALL:LIN_4504'], reason: 'the rendered copy of the dated audit above' },
]);

/** The token that covers a census's whole word set, or a single label, for a row. */
const coversWord = (row, census, word) => row.words.includes(word)
  || row.words.includes('*')
  || row.words.includes(`ALL:${census}`);

/** Whether a row covers a file (exactly, or by its directory prefix). */
const coversFile = (row, file) => row.file === file || (row.file.endsWith('/') && file.startsWith(row.file));

/**
 * Every retired word in the given files that no row covers, and that is not in SELF: `[{file, word, line}]`. Pure over the
 * file text, so the planted-mutation tests can run it over synthetic files.
 * @param {Record<string, string>} files - repo-relative path → text
 * @param {readonly {word: string, re: RegExp}[]} words - one census's retired words
 * @param {string} census - the census key (e.g. 'LIN_4502'), which an 'ALL:<census>' token names
 * @param {readonly object[]} [rows] - the table (default: RETAINED)
 * @param {Record<string, string>} [self] - SELF (default: SELF)
 */
export function censusHits(files, words, census, rows = RETAINED, self = SELF) {
  const hits = [];
  for (const [file, text] of Object.entries(files)) {
    if (Object.hasOwn(self, file)) continue;
    for (const { word, re } of words) {
      if (rows.some((row) => coversFile(row, file) && coversWord(row, census, word))) continue;
      const m = re.exec(text);
      if (!m) continue;
      hits.push({ file, word, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return hits;
}

/**
 * Every problem with the rows, as readable strings (`[]` when the table is valid). Pure over the environment: `env`
 * gives `exists(rel)`, `holds(rel, label)`, `ruleHas(path, symbol)`, `knownWord(label)` and `roots`.
 * @param {readonly object[]} rows
 * @param {Record<string, string>} self - SELF: path → reason
 * @param {object} env
 * @returns {string[]}
 */
export function retainedProblems(rows, self, env) {
  const problems = [];
  const blank = (v) => typeof v !== 'string' || v.trim() === '';
  const inScope = (rel) => env.roots.some((r) => rel === r || rel.startsWith(r.endsWith('/') ? r : `${r}/`));
  const selfPaths = new Set(Object.keys(self));
  const firstRowOf = new Map(); // `${file}|${word}` → index of the row that first holds it

  rows.forEach((row, i) => {
    const at = `row ${i} (${row?.file ?? 'no file'})`;
    if (!KINDS.includes(row.kind)) problems.push(`${at}: unknown kind "${row.kind}"; the kinds are ${KINDS.join(', ')}`);
    if (blank(row.reason)) problems.push(`${at}: no reason`);
    if (row.kind === 'temporary') {
      if (blank(row.owner)) problems.push(`${at}: temporary row has no owner`);
      if (blank(row.exit)) problems.push(`${at}: temporary row has no exit`);
    }
    if (row.kind === 'live') {
      if (!row.rule || blank(row.rule.path) || blank(row.rule.symbol)) {
        problems.push(`${at}: live row names no rule (a path and a symbol)`);
      } else if (!env.ruleHas(row.rule.path, row.rule.symbol)) {
        problems.push(`${at}: live rule ${row.rule.path} has no ${row.rule.symbol}`);
      }
    }
    if (blank(row.file)) {
      problems.push(`${at}: no file`);
      return;
    }
    if (selfPaths.has(row.file)) problems.push(`${at}: ${row.file} is in SELF and also a row`);
    if (!inScope(row.file)) problems.push(`${at}: ${row.file} is outside the scanned roots, so no census reads it`);
    const exists = env.exists(row.file);
    if (!exists) problems.push(`${at}: file ${row.file} does not exist`);
    if (!Array.isArray(row.words) || row.words.length === 0) {
      problems.push(`${at}: names no words`);
      return;
    }
    for (const word of row.words) {
      if (word === '*' || word.startsWith('ALL:')) {
        // A token that covers a whole set holds no single word to check; it is a record, and it stands alone.
        if (row.kind !== 'record' || row.words.length !== 1) {
          problems.push(`${at}: the word "${word}" covers a whole set, so it is allowed only as the sole word of a record row`);
        } else if (word.startsWith('ALL:') && !env.knownCensus(word.slice(4))) {
          problems.push(`${at}: "${word}" names no census`);
        }
        continue;
      }
      if (!env.knownWord(word)) {
        problems.push(`${at}: word "${word}" is not a census word`);
      } else if (exists && !env.holds(row.file, word)) {
        problems.push(`${at}: ${row.file} no longer holds "${word}" (a stale row)`);
      }
      const key = `${row.file}|${word}`;
      if (firstRowOf.has(key)) problems.push(`${at}: duplicate of row ${firstRowOf.get(key)} (${row.file}, "${word}")`);
      else firstRowOf.set(key, i);
    }
  });

  for (const [path, reason] of Object.entries(self)) {
    if (blank(reason)) problems.push(`SELF ${path}: no reason`);
    if (!env.exists(path)) problems.push(`SELF ${path}: file does not exist`);
  }
  return problems;
}

/**
 * The environment `retainedProblems` reads, over the real tree at `root`. `patterns` maps a word label to the RegExp that
 * matches it in a file's text (WORD_PATTERNS for the real table). `roots` is what a row may name.
 * @param {string} root
 * @param {Map<string, RegExp>} patterns
 * @param {readonly string[]} roots
 */
export function fsEnv(root, patterns, roots) {
  const under = (rel) => {
    const full = join(root, rel);
    if (!existsSync(full)) return [];
    return statSync(full).isDirectory() ? textFilesUnder(root, rel) : [rel];
  };
  return {
    roots,
    exists: (rel) => existsSync(join(root, rel)),
    holds: (rel, label) => {
      const pattern = patterns.get(label);
      return Boolean(pattern) && under(rel).some((f) => pattern.test(readFileSync(join(root, f), 'utf8')));
    },
    ruleHas: (path, symbol) => existsSync(join(root, path))
      && new RegExp(`\\b${symbol}\\b`).test(readFileSync(join(root, path), 'utf8')),
    knownWord: (label) => patterns.has(label),
    knownCensus: (name) => Object.hasOwn(CENSUS_WORDS, name),
  };
}
