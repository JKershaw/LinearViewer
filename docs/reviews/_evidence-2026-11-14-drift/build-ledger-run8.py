# Run 8 (LIN-4481): carry run 7's 158-row ledger under its stable names and give each row a run-8 delta.
# Inputs: run 7's ledger-run7.tsv and this run's touch map (ledger-touch-map-run8-window.txt, from touch-map-run8.py over
# window-numstat-all-run8.tsv). Rows not in the touch map and not judged by hand get the mechanical "no cited file touched"
# delta; every touched row and every row 136-158 is judged by hand below, against `git diff -U0 e2d4659c4 fb358dbda`.
# New rows 159+ are this run's findings.
# Usage (repo root): python3 -I build-ledger-run8.py <ledger-run7.tsv> <touch-map.txt> <out.tsv>
import csv, sys, re
W = 'e2d4659c4..fb358dbda'
rows = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
touched = {}
for l in open(sys.argv[2]):
    m = re.match(r'(\d+) \| (.*)', l.strip())
    if m: touched[m.group(1)] = m.group(2)

SERVER = 'unchanged (touched: server.js; its hunks are isHermeticTestToken at three test-mode sites, the held-wake provisioner factory and the /lib/ serving comment; cited decision not in a hunk)'
DISPATCH = 'unchanged (touched: routes/dispatch.js; its hunks are the LIN-4468 mint stamp and NEVER_RAN; cited decision not in a hunk)'
COMMON = 'unchanged (touched: public/common.js, a comment naming the classic twin LIN-4471 will retire; cited decision not in a hunk)'
RENDER = 'unchanged (touched: lib/render.js, Home\'s script list now loads { module: /cost-format-global.js }; cited decision not in a hunk)'
SETTINGS = 'unchanged (touched: routes/settings.js, callsSurfaceOf now imported from lib/cost-read-calls.js; cited decision not in a hunk)'
STORE = 'unchanged (touched: lib/dispatch-store.js; its hunks move FEEDBACK_ENTRY_KINDS to lib/dispatch-feedback-kinds.js, use NEVER_RAN and bind the held-wake release wording late; cited decision not in a hunk)'
MULTI = 'unchanged (touched files: {}; no hunk reaches the cited decision)'
HAND = {
  '1': 'unchanged (SCCs 6 + 6 with the same members at fb358dbda; 533 nodes, 2249 static edges; the stage-writes.js hit is a basename match on old citation text)',
  '2': 'resolved (held; 0 upward lib->routes edges at fb358dbda)',
  '6': DISPATCH, '30': DISPATCH, '61': DISPATCH, '88': DISPATCH, '92': DISPATCH, '98': DISPATCH, '101': DISPATCH,
  '8': COMMON, '18': COMMON,
  '9': 'unchanged (false hit: server.js matched by basename only)',
  '12': MULTI.format('lib/dispatch-store.js, routes/dispatch.js, server.js'),
  '17': SERVER, '19': 'improved: the formatElapsed pair lost its public/task-page.js half (census G0264 gone; the task page imports fmtDuration from lib/time-words.js, LIN-4472); public/session.js keeps its copy, a front-end-browser Waiting entry',
  '21': SERVER, '23': MULTI.format('lib/render.js, server.js'), '59': SERVER, '65': SERVER, '69': MULTI.format('routes/dispatch.js, server.js'), '87': MULTI.format('lib/render.js, server.js'), '94': SERVER, '124': 'resolved (held; touched: server.js wiring only)', '140': 'unchanged: no [working] line in any window hunk in either repo; Harbour still parses the beat grammar itself (lib/session-telemetry.js HEARTBEAT_HINT) and the contract\'s heartbeat row covers the host heartbeat only; LIN-3828 Backlog',
  '24': MULTI.format('public/common.js, public/prompt-section.js (a comment naming window.CostFormat), routes/dispatch.js'),
  '25': RENDER, '72': RENDER, '74': RENDER, '91': RENDER, '113': MULTI.format('lib/render.js, lib/task-page-loader.js (relativeAgo moved out, NEVER_RAN, latestReviewComment from run-trail)'),
  '27': MULTI.format('lib/render-run-steps.js (fmtDuration moved to lib/time-words.js), lib/render.js'),
  '38': MULTI.format('lib/render-run-steps.js (fmtDuration moved to lib/time-words.js), lib/render.js'),
  '36': 'unchanged (touched: routes/proxy-compute.js, now promptContextOf (LIN-4470) and isHermeticTestToken; the entrance field re-projection is not in a hunk)',
  '37': 'unchanged (touched: lib/run-view.js, stamp kinds from lib/dispatch-feedback-kinds.js and BLIND_READ_KIND; the owner word is not in a hunk)',
  '40': 'improved: fmtDuration and relativeAgo have one leaf (lib/time-words.js, LIN-4472) and the public/task-page.js formatElapsed copy is gone; byte-identical formatDuration copies stay in lib/render-escalation-kpis.js and lib/render-effort-readout.js, and relative time is still worded four ways (row 160)',
  '44': SETTINGS, '105': SETTINGS,
  '47': 'improved (partly): the inline NODE_ENV-and-test-token test mode is now isHermeticTestToken (lib/should-mock-ai.js, 12 importers in lib/routes/server.js; census G0008 gone, G0002 43 -> 31 sites); the not-configured gates outside isAiUnavailable are not in a hunk',
  '55': MULTI.format('lib/digest-feedback.js (stamp kinds from the table), lib/render-run-steps.js, lib/render-session.js, lib/render.js, lib/run-view.js, lib/task-page-loader.js, routes/dispatch.js'),
  '56': 'improved: the decision-stamp set has one home (DECISION_LIFECYCLE_STAMP_KINDS, lib/dispatch-feedback-kinds.js, LIN-4455), read by digest-feedback, session-telemetry, run-view and wall-clock-summary; two predicates over it remain (_isStampEntry in lib/session-telemetry.js, isDecisionLifecycleStampEntry in lib/digest-feedback.js), and the classic public/dispatch.js and public/session.js restate the set under a drift test',
  '58': 'improved: one close-out decision (closeOutDecision, lib/run-closeout-state.js, LIN-4460) answers every surface; closeOutSetsDone, byPersonCheck, REFUSED_REASONS and readGateTrail are gone; the Done bound is still split with the check route (row 163)',
  '63': 'unchanged (touched: routes/proxy-compute.js; census G0121 still has the three mock child-shaping copies, workspace-api-mocks.js, proxy-compute.js, task-chat.js)',
  '64': STORE, '81': MULTI.format('lib/dispatch-store.js, lib/task-page-loader.js, routes/dispatch.js'), '111': STORE,
  '66': MULTI.format('public/common.js, server.js'), '71': MULTI.format('lib/render.js, routes/dispatch.js'),
  '79': 'unchanged (touched: lib/pipeline-churn.js, the blind-read literal now BLIND_READ_KIND; cited decision not in a hunk)',
  '99': 'unchanged: still one hand-written scripts list per renderer; Home, Swipe and the task page each repeat { module: /cost-format-global.js }, /prompt-section.js (census G0233 left by a re-key, not a fold)',
  '102': 'unchanged: the mode-to-word maps stay (HALT_BANNER_WORD lib/render.js, HALT_MODE_LABELS public/dispatch.js); census G0049 re-keyed as G0076 when lib/dispatch-leftover.js took HALT_MODES (row 142)',
  '106': MULTI.format('lib/render.js, routes/dispatch.js, routes/settings.js'), '108': MULTI.format('lib/render.js, public/common.js'),
  '109': 'unchanged: READY_TASK_STATE still lib/render-task-page.js:116; public/task-page.js became a module (LIN-4472) and its status reads moved with it',
  '110': 'unchanged (touched: routes/proxy-rulings.js, the write gate per op; the inline live-anchor copy is not in a hunk)',
  '117': 'resolved (held; touched: lib/dispatch-store.js, not the identity read)',
  '119': 'resolved (held: lib/cost-read.js lost readCalls/callsSurfaceOf to lib/cost-read-calls.js, LIN-4457; the partition read is unmoved)',
  '121': 'unchanged (touched: tests/unit/fake-dom-census.test.js, one line)',
  '122': 'unchanged: the snapshot wording count in the cited files is 24 at both ends; lib/model-routing-spend.js changed only its import path',
  '123': 'unchanged (lib/cost-read.js -97 lines are the calls move; the precedence ladder stays in lib/row-usage.js)',
  '125': 'unchanged (touched: lib/session-telemetry.js, PARKED_WAIT_SKIPPED_KINDS now from the kinds table; PARKED_WAIT_HINT still reads one of SD\'s four wait kinds)',
  '127': 'unchanged: answered-or-dismissed is still inline at routes/dashboard-rulings.js:327, routes/workspace-api-issue-write.js:165,171,636 and routes/workspace-api-scan.js:389',
  '129': 'unchanged: the three inline loader-shape checks remain (lib/cost-read.js:157, lib/run-view.js:374, lib/kpi-stats.js:1067)',
  '131': 'resolved in code: the VERB OVERRIDE list is OVERRIDE_KINDS = Object.keys(STAGE_KINDS) (lib/proxy-instructions.js:15, LIN-4467), so it names every template key; LIN-4302 is still Backlog',
  '133': 'unchanged in rule: a module loader (tests/unit/helpers/import-world.js, importWorld) joined loadWorld, recorded in docs/areas/front-end-browser.md but not in CLAUDE.md, which names only loadWorld',
  '134': 'unchanged in shape, stakes raised: writes is still threaded by hand at the four entrance sites (lib/dispatch-entrance.js x2, routes/workspace-api-feedback.js x2); refire and wake mints now share lib/item-stage-stamp.js; since LIN-4468 the value gates proxy writes and an unstamped token is unrestricted, so a missed thread fails open (row 162)',
  '135': MULTI.format('lib/task-state.js (an import path), public/prompt-section.js (a comment)'),
  '136': 'improved: one record per stage kind (lib/prompts/stage-kinds.js, LIN-4467); STAGE_LEADS, PROMPT_TEMPLATES, COMPLETION_SIGNALS, STAGE_INTENT, STAGE_LABELS and the VERB OVERRIDE list are views; census G0100 gone; about eight kind-keyed tables remain (GENERATE, BUCKET_OF_KIND, FIRST_PASS_KINDS/OFF_SPINE_KINDS, JOBS, SPINE/STEP_KIND_WORDS, SURVEY_HEADINGS, TEMPLATES_RENDERED_CEILINGS), each listed by tests/unit/stage-kind-tables.test.js; the Waiting entry left (settled by LIN-4467/4470); the claim that every table is a view is row 161',
  '137': 'unchanged: CLAUDE.md:107 and lib/proxy-scopes.js:24-26 still list three enqueue routes; LIN-4320 Backlog',
  '138': 'unchanged (no cited file touched in ' + W + ')',
  '139': 'unchanged: public/live-console.js keeps its dual export; the three converted pages kept none',
  '141': 'unchanged: lib/dispatch-entrance.js:1230 still passes isAutopilotVariant(prompt) to declaresPeriodicalGrant; LIN-4318 Backlog',
  '142': 'resolved: lib/dispatch-leftover.js imports NEVER_RAN (lib/dispatch-terminal.js), HALT_MODES (lib/workspace-halt.js) and followUpTarget (lib/dispatch-targets.js) and keeps none of its own (LIN-4455 beat 3); census G0022, G0049 and G0234 left; the Waiting entry left with it',
  '143': 'improved: the four "search the repo for a committed tool" spellings are one helper, committedSearch (lib/periodicals.js, LIN-4469), and the notes-PR rule reads NOTES_PR from the leaf; the hand-off rule is still spelled in three bullets, pinned by tests/unit/lin-4390-periodical-hand-off.test.js',
  '144': 'unchanged: "Waiting entries are context, not scope" in lib/prompt-formatters.js:614 and both READMEs',
  '145': 'improved (one constant pair), count up by comments: REGISTRY_PATH now derives from NOTES_DIR and REGISTRY_FILE (lib/prompts/area-registry-path.js, LIN-4470); docs/areas spelled in 28 lines / 14 files at fb358dbda (26 / 11 at e2d4659c4; JavaScript only 18 / 9 -> 19 / 12), the added lines comments citing note files; the kept entry cites lib/periodicals.js, which spells it 0 times, and gives the JS-only count beside the all-files command (recounted in this PR)',
  '146': 'unchanged: the guards stay copied by design; Harbour\'s reads isCitedPath, SD\'s keeps its own spelling, which agrees (same path span, same extensions)',
  '147': 'unchanged: "no step may change them" in AS_ASKED_LEAD (routes/proxy-writes.js:80) and BRIEF_HINT (lib/as-asked.js:298)',
  '148': 'improved (partly): DECIDED_BY is read from lib/size-of-move.js by the stage records; "a day" (lib/proxy-instructions.js:501) and "four lines" (routes/proxy-writes.js:405) remain',
  '149': 'improved: nine report rows in the contract now pin the session-PR pick on both sides (LIN-4475/4476) and the Waiting entry left; still unpinned: a message with no DONE: line, where Harbour takes the first PR and SD its tracked ranking; one report row pins a disagreement (an http DONE: URL: SD canonical https, Harbour none, PR_URL_RE in lib/run-ledger.js), held by a runs-and-dispatch entry (second read)',
  '150': 'resolved: dispatchModelOf is gone; dispatchesOf carries fold.last.model from foldRequestUsage (lib/cost-read.js) and the timeline reads dispatch.model (LIN-4454); the Waiting entry and Lesson\'s cause left',
  '151': 'resolved (code): the kind and heading come from lib/prompts/blind-read-words.js in every runtime reader, VIRTUAL_PROMPTS is gone and an AST scan enforces it (LIN-4466); the template registry is exempt (goal(\'blind-read\')) and lib/render-run-evidence.js:87 hand-types the label \'Blind read\'',
  '152': 'improved: Harbour\'s README now points at the leaf for the forms; docs/proxy-integration.md still lists the refusal kinds by hand; SD\'s README keeps "a follow-up is filed for it", held as SD\'s own in the llm-and-prompts entry',
  '153': 'resolved: one comment classifier, COMMENT_KINDS (lib/run-trail.js, LIN-4458); landingPrUrls is a view of it and isLandingEvidence/isSurveyReport are deleted; the landing readers agree on agent notes (Seams run 12 section 3.0a answered); the selector\'s own PR list is row 159',
  '154': 'resolved: CODE_ROUTES (lib/code-routes.js, LIN-4465) is the one list, codeRouteOf iterates it, and every prose copy points at it; public/llms.txt\'s catalogue is generated (scripts/gen-llms-catalogue.mjs) and pinned byte for byte; the order line in docs/architecture/prompt-system.md is pinned',
  '155': 'resolved: one predicate, isCitedPath (lib/prompts/area-note-format.js, LIN-4470), read by the guard and lib/dispatch-leftover-answer.js; SD\'s guard is a third spelling that agrees, kept as SD\'s own',
  '156': 'unchanged (no cited file touched; the reports-and-operator-tools entry stands)',
  '157': 'unchanged: lib/render-task-timeline.js still restates the tick rule (its one window hunk is an import path); the front-end-pages entry stands',
  '158': 'resolved: closeOutSetsDone is gone; one decision, closeOutDecision (lib/run-closeout-state.js, LIN-4460), answers the box, the guard, the check route and blindReadStep; a merged landing is followed (John\'s R1 ruling, 13 Nov); the stop-at bound is still applied in the route (row 163)',
}
NEW = [
  ('159', 'trail-pr-list-beside-landing', 'LOW–MEDIUM', 'new (window claim, LIN-4458; the reader predates it): assembleTrailFacts builds prUrls from every comment with no kind filter (lib/recommendation-facts.js:466-471), feeding the selector line "PRs linked on the trail" (:554) and the look-first gate (lib/recommendation-look-first.js:152), while lib/run-trail.js:15-17 says the prompt is a view of the one trail pass and cannot disagree; reproduced: a survey-task report citing a PR turns look-first off ("has a PR"), skipping survey-place and scoping, with an empty landing (evidence look-first-survey-pr-repro.txt)', 'llm-and-prompts'),
  ('160', 'relative-time-four-formatters-one-home-claim', 'LOW–MEDIUM', 'new (window claim, LIN-4472; the copies predate it): lib/time-words.js says it is the one home for relative-time words on the server and the task page, as do tests/unit/lin-4472-time-words.test.js, docs/architecture/source-map.md and lib/components/time.js; but formatRelativeTime (lib/render.js, Settings/Home/KPIs, "25m ago"), window.relativeTime (public/common.js, read by the Observation module), formatGeneratedAge (public/prompt-section.js, rounds) word the same moment; byte-identical formatDuration in lib/render-escalation-kpis.js and lib/render-effort-readout.js; the guard keys on two names', 'front-end-pages'),
  ('161', 'stage-record-claims-and-catalogue-group', 'LOW', 'new (window, LIN-4467): the record\'s catalogue.group (lib/prompts/stage-kinds.js) drives the generated Default/More split in public/llms.txt, while the UI split is DEFAULT_PROMPT_KEYS (lib/render-prompt-opts.js); they agree today and no test links them; docs/architecture/source-map.md says every per-kind table is a view of the record, while about eight kind-keyed tables remain (row 136); catalogue lines retype the display name', 'llm-and-prompts'),
  ('162', 'stage-write-default-and-allowance-unguarded', 'LOW', 'new (window, LIN-4468): "no stamp means work" is restated in lib/item-stage-stamp.js (x2), lib/proxy-preamble.js resolveWrites and lib/stage-writes.js (isRestrictedStamp, stageWriteAllows); an unknown value throws in the preamble and reads none in normalizeWritesStamp; ALLOWED_OPS has no completeness test against WRITES_VALUES (a new value 500s, not 403s); the mandates say "one comment", the gate allows the createComment op any number of times', 'other-features'),
  ('163', 'closeout-done-bound-split', 'LOW', 'new (window, LIN-4460): lib/run-closeout-state.js says the Done rule is bounded there in one place, but setDone has no stop-at term and the stop-at-PR bound is applied in routes/workspace-api-run-evidence.js; inside closeOutDecision the person-acted rule is spelled twice (doneWithoutHarbour, and routesRead\'s inline variant), and followsPerson/waitsOn have no production reader', 'runs-and-dispatch'),
  ('164', 'fold-empty-corner-leftover-unhomed', 'LOW', 'new (window, cross-repo, LIN-4475/4476): the contract\'s fold corner rows name SD\'s raw "" model and "" timestamp as a leftover for SD (lib/runner-kit/contract.json); Harbour\'s intake rejects at "" (lib/request-usage-intake.js), so such a request record is lost; neither repo\'s notes held it', 'SD stop-hook-and-relay'),
  ('165', 'feedback-kinds-header-stale', 'LOW', 'new (window, LIN-4455/4459): lib/dispatch-feedback-kinds.js says the runner prompt renders the kinds through the store\'s re-export and that the store imports it; the store does neither (its comment says so) and lib/prompts/runner-kickoff.js imports the leaf', 'runs-and-dispatch'),
  ('167', 'prompt-context-header-overclaims', 'LOW', 'new (window, LIN-4470; found by the second read): lib/prompts/prompt-context.js says every prompt surface that renders a stage from a fetched context hands generatePrompt its one projection, but the routed and code-routed recommendation (composeRoutedRecommendation, lib/openrouter.js) passes prepareRecommendationInput\'s hand-built superset (lib/recommendation-input.js, adding focusedChild, runs, allRuns); a test pins that every projected field reaches it, so a miss fails CI rather than drifting', 'llm-and-prompts'),
  ('166', 'jira-as-asked-end-line-looser', 'LOW', 'new (window, LIN-4450): the Jira region reader accepts an end line whatever its marks and, for a block edited in Jira, takes the first end paragraph (lib/providers/jira/as-asked-region.js), looser than splitAsAsked; the providers Lesson calls it safe because filing refuses such a block, which does not cover an edit made in Jira later', 'providers'),
]
out = open(sys.argv[3], 'w')
out.write('row\tfinding\tseverity\trun8_delta\tnoted_in\n')
counts = {}
for r in rows:
    n = r['row']
    if n in HAND: d = HAND[n]
    elif n in touched: raise SystemExit(f'touched row {n} has no hand judgement')
    elif r['severity'].strip().lower() == 'resolved': d = 'resolved (held; no cited file touched in the window)'
    else: d = f'unchanged (no cited file touched in {W})'
    k = d.split(' ')[0].split(':')[0]
    counts[k] = counts.get(k, 0) + 1
    sev = r['severity']
    if n in ('142', '150', '151', '153', '154', '155', '158'): sev = 'resolved'
    out.write('\t'.join([n, r['finding'], sev, d, r['noted_in']]) + '\n')
for row in NEW:
    counts['new'] = counts.get('new', 0) + 1
    out.write('\t'.join(row) + '\n')
print('rows', len(rows) + len(NEW), counts, 'touched rows judged', len(touched))
