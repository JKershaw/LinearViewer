# Run 7 (LIN-4443): carry run 6's 149-row ledger under its stable names and give each row a run-7 delta.
# Inputs: run 6's ledger-run6.tsv and this run's touch map (ledger-touch-map-run7-window.txt, from touch-map-run5.py run in
# place over window-numstat-all-run7.tsv). Rows not in the touch map and not judged by hand get the mechanical
# "no cited file touched" delta; every touched row and every row 136-149 is judged by hand below, against
# `git diff -U0 b315e0e8f e2d4659c4`. New rows 150+ are this run's findings.
# Usage (repo root): python3 -I build-ledger-run7.py <ledger-run6.tsv> <touch-map.txt> <out.tsv>
import csv, sys, re
W = 'b315e0e8f..e2d4659c4'
rows = list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
touched = {}
for l in open(sys.argv[2]):
    m = re.match(r'(\d+) \| (.*)', l.strip())
    if m: touched[m.group(1)] = m.group(2)
SERVER = 'unchanged (touched: server.js; its hunks are the task-timeline import and wiring only; cited decision not in a window hunk)'
STORE = 'unchanged (touched: lib/dispatch-store.js; its one hunk is a comment at the founder projection; cited decision not in a window hunk)'
HAND = {
  '2': 'resolved (held; touched: server.js wiring only; 0 upward lib->routes edges at e2d4659c4)',
  '9': 'unchanged (false hit: server.js matched by basename only)',
  '12': STORE.replace('touched: lib/dispatch-store.js', 'touched: lib/dispatch-store.js, server.js'),
  '17': SERVER, '19': SERVER, '21': SERVER, '23': SERVER, '47': SERVER, '59': SERVER, '65': SERVER, '66': SERVER,
  '69': SERVER, '87': SERVER, '94': SERVER,
  '124': 'resolved (held; touched: server.js wiring only)',
  '36': 'unchanged (touched: routes/proxy-compute.js, whose /cost read moved to readTaskCost, and server.js wiring; the field duplication is not in a hunk)',
  '37': 'unchanged (touched: lib/run-view.js SPINE, STAGE_LABELS and the next-step line for the blind read; the owner word is not in a hunk)',
  '40': 'unchanged (touched: lib/effort-readout.js, a comment and a pinned string naming planReviewDueOf; server.js wiring)',
  '71': 'unchanged (touched: lib/effort-readout.js, a comment and a pinned string only)',
  '55': 'unchanged (touched: lib/run-view.js SPINE/labels and lib/task-page-loader.js timeline threading; the derivation split is not in a hunk)',
  '63': 'unchanged (touched: routes/proxy-compute.js /cost now calls readTaskCost; the mock-AI builder is not in a hunk)',
  '64': STORE,
  '81': 'unchanged (touched: lib/dispatch-store.js comment, lib/task-page-loader.js timeline threading; no marker-keyed pending predicate added)',
  '109': 'unchanged (touched: public/task-page.js timeline poll and lib/render-task-page.js; the new status read at public/task-page.js:848 repeats the existing :64/:73 reads; cited decision not in a hunk)',
  '111': STORE, '117': 'resolved (held; touched: lib/dispatch-store.js comment only)',
  '113': 'unchanged (touched: lib/task-page-loader.js timeline threading; cited decision not in a hunk)',
  '119': 'resolved (held: lib/cost-read.js was refactored inside the one home, sessionOf/selectLineageRecords/requestSpanOf extracted; lib/task-cost-read.js only calls readCost; the per-dispatch model pick is a new, separate row, 150)',
  '122': 'unchanged (touched: docs/architecture/source-map.md, docs/proxy-integration.md, lib/effort-readout.js, lib/proxy-instructions.js; prose sites outside hunks)',
  '123': 'unchanged (lib/cost-read.js reads the fold\'s completeness at one more site, 4 -> 5 in that file; the precedence ladder stays in lib/row-usage.js, not in a hunk)',
  '129': 'unchanged (the three inline loader-shape checks remain: lib/cost-read.js:160, lib/run-view.js:399, lib/kpi-stats.js:1067; line drift only)',
  '131': 'unchanged in code: the VERB OVERRIDE sentence gained blind-read and names 16 of the 20 PROMPT_TEMPLATES keys (bug, plan-review, close-out, retrospective-audit still missing); LIN-4302 Backlog',
  '132': 'unchanged (touched: scripts/delivery-composition.mjs now imports ownTicket from scripts/stability-measures-core.mjs; the isTest/isDoc copies are unmoved)',
  '133': 'unchanged (touched: CLAUDE.md, CI job names and the invariant sentence; the world-helper rule is not in a hunk)',
  '134': 'unchanged (touched: lib/proxy-preamble.js adds WRITES.BLIND_COMMENT to the endpoint hint; the per-entrance threading of writes is unchanged)',
  '104': 'unchanged: process row; LIN-3449 still Todo (22 comments); this run mints no child',
  '114': 'unchanged: John\'s ruling, not chosen here',
  '136': 'improved (pinned): tests/unit/stage-kind-tables.test.js (new, LIN-4437) checks 17 kind-keyed tables against PROMPT_TEMPLATES both ways; the blind read still had to touch 13 tables in 11 files and the copy of its text (public/llms.txt) is unpinned (row 154); survey-place 21 lines in 10 files -> 22 in 12',
  '137': 'unchanged: lib/proxy-scopes.js:24-25, CLAUDE.md:107 and docs/proxy-integration.md:102 still list three enqueue routes (the window edited CLAUDE.md and the doc and left them); lib/proxy-scopes.js:8 says four; LIN-4320 Backlog',
  '138': 'unchanged (no cited file touched in ' + W + ')',
  '139': 'unchanged (no cited file touched in ' + W + ')',
  '140': 'unchanged: no [working] line in any window hunk under lib, routes, public or server.js, nor in SD\'s window; LIN-3828 Backlog',
  '141': 'unchanged in code: lib/dispatch-entrance.js:1226 still passes isAutopilotVariant(prompt) to declaresPeriodicalGrant; the window\'s ±22 in the file did not touch it; LIN-4318 Backlog',
  '142': 'unchanged in code: lib/dispatch-leftover.js:26, :29, :113 keep RESUMABLE_TARGETS, NEVER_RAN and the pause/stop test; the window\'s hunks there are the prompt (it now renders CONSEQUENCE_TEST and the retirement words from the leaf)',
  '143': 'improved: areaNotes (lib/periodicals.js:350) no longer restates the byte cap, the distil step, Waiting vs Lesson, the cite order or the merge authority; three short restatements remain (the prune sentence, the source format, "a ticketed finding stays in the report only"), each consistent with its home today',
  '144': 'unchanged: "Waiting entries are context, not scope" in lib/prompt-formatters.js:612 and both READMEs (Harbour :66, SD :70); lib/dispatch-leftover.js:124 now names it as the rule its retirement step is the exception to',
  '145': 'worsened: docs/areas spelled in 17 lines / 10 files (lib, routes, public, server.js, scripts) at b315e0e8f -> 26 lines / 11 files at e2d4659c4; a second directory constant, NOTES_DIR (lib/prompts/area-note-format.js:8), now sits beside REGISTRY_PATH and neither derives from the other',
  '146': 'improved: the guards converged (both list the same 12 extensions incl. sh, the same five checks, the Lessons-only cap; SD\'s README gained the Periodical-entry rule); still copied by design and held by comments only; SD\'s README words the third way out differently (row 152)',
  '147': 'unchanged: "no step may change them" in AS_ASKED_LEAD (routes/proxy-writes.js:78) and BRIEF_HINT (lib/as-asked.js:294)',
  '148': 'improved (partly): the hand-typed look-first sequence left lib/proxy-instructions.js (LIN-4407); "a day" (lib/proxy-instructions.js:485), "four lines" (routes/proxy-writes.js:362) and the DECIDED_BY values (lib/completion-signals.js:121) remain',
  '149': 'unchanged: lib/dispatch-wake.js and SD links.js / hook.js untouched in both windows; joined by the comment at lib/dispatch-wake.js:275 only',
}
NEW = [
  ('150', 'dispatch-model-pick-second-rule', 'LOW–MEDIUM', 'new (window, LIN-4404/4405): lib/task-timeline.js:53-58 dispatchModelOf re-ranks byModel by costUsd then requests; the home, lib/request-usage-fold.js:107-121, ranks by priced dollars then latest use; a lane can name two models', 'runs-and-dispatch'),
  ('151', 'blind-read-kind-and-heading-retyped', 'LOW–MEDIUM', 'new (window, LIN-4437/4438): BLIND_READ_KIND and BLIND_READ_HEADING (lib/prompts/blind-read-words.js) are retyped: the kind as bare literals in lib/recommendation-blind-read.js:47,65,75-76, lib/pipeline-churn.js:233, lib/run-view.js:472, lib/run-closeout-state.js:116,255 and a second constant VIRTUAL_PROMPTS.BLIND_READ (lib/workflow-config.js:40); the heading and verdict words typed in lib/completion-signals.js:254-262', 'llm-and-prompts'),
  ('152', 'retirement-rule-restated-per-reader', 'LOW', 'new (window, LIN-4414): the three-form words have one home and one checker, but the selection rule and the forms are restated by hand in docs/areas/README.md, SD\'s README, docs/proxy-integration.md (with the refusal kinds), docs/architecture/dispatch-and-proxy.md and the prompt; SD\'s README says an entry leaves when "a follow-up is filed", not when the consequence test sends it; no test reads the doc copies', 'llm-and-prompts'),
  ('153', 'landing-exclusions-two-lists', 'LOW', 'new (window, LIN-4437/4438): what is not landing work (blind reads, Survey reports) is listed in lib/run-ledger.js:567 landingPrUrls and again in lib/recommendation-facts.js:86 isLandingEvidence, joined by a comment; already covered by the existing lib/run-ledger.js Waiting entry (one comment classifier, one landing reader)', 'runs-and-dispatch (existing entry)'),
  ('156', 'ruling-outcome-buckets-claim-home', 'LOW', 'new (window, LIN-4424): scripts/stability-measures-seat.mjs says its buckets are "as lib/escalation-kpis.js", but counts withdrawn as neither and a null outcome as unreadable, where the home (lib/escalation-kpis.js:120-126) counts both as answered', 'reports-and-operator-tools'),
  ('157', 'timeline-renderer-rederives-tick-style', 'LOW', 'new (window, LIN-4405): lib/render-task-timeline.js:130 restates the model\'s tick rule (lib/task-timeline.js:340: wake, resumed or no records) to pick the bare style, and the legend (:205) restates it again; the renderer\'s header says it derives nothing', 'front-end-pages'),
  ('154', 'code-settled-routes-list-copies', 'LOW', 'new (window, LIN-4392/4437): the four code-settled routes are listed in about nine places; docs/architecture/prompt-system.md:7 says "four routes" and restates three (no blind read); public/llms.txt:271 says the blind read is "Sent by hand"', 'llm-and-prompts'),
  ('155', 'cited-path-rule-three-spellings', 'LOW (borderline)', 'new (window, LIN-4414): what a cited path is lives in the notes guard (tests/unit/area-notes.test.js), in lib/dispatch-leftover-answer.js:41-42 (any 1-6 character extension) and in SD\'s guard; lib/prompts/area-note-format.js, the new one reading of a Waiting entry, does not hold it', 'llm-and-prompts'),
]
out = open(sys.argv[3], 'w')
out.write('row\tfinding\tseverity\trun7_delta\tnoted_in\n')
counts = {}
for r in rows:
    n = r['row']
    if n in HAND: d = HAND[n]
    elif n in touched: raise SystemExit(f'touched row {n} has no hand judgement')
    elif r['severity'].strip().lower() == 'resolved': d = 'resolved (held; no cited file touched in the window)'
    else: d = f'unchanged (no cited file touched in {W})'
    k = d.split(' ')[0].split(':')[0]
    counts[k] = counts.get(k, 0) + 1
    out.write('\t'.join([n, r['finding'], r['severity'], d, r['noted_in']]) + '\n')
for row in sorted(NEW, key=lambda r: int(r[0])):
    counts['new'] = counts.get('new', 0) + 1
    out.write('\t'.join(row) + '\n')
print('rows', len(rows) + len(NEW), counts, 'touched rows judged', len(touched))
