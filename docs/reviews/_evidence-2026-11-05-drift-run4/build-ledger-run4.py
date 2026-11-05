# Build the run-4 trend ledger (LIN-4299): the 130 rows of the 11-05 ledger, each with a run-4 delta, plus new rows.
# Input: ledger-11-05.tsv (the 11-05 edition's rows), ledger-touch-map-run4.txt (name match), and the overrides below,
# each of which was checked against the code at af55cb73 (see the report's Method and evidence notes).
import csv
E = 'docs/reviews/_evidence-2026-11-05-drift-run4'
rows = list(csv.reader(open('docs/reviews/_evidence-2026-11-05-drift/ledger-11-05.tsv'), delimiter='\t'))[1:]
CROSS = {'6','9','10','11','15','33','42','61','76','92','93','97','101','102','114','118','125'}
RESOLVED_HELD = {'2','4','13','41','45','46','48','49','60','67','75','78','112','115','124'}
UNCH0 = 'unchanged (cited files 0-line diff)'
OV = {
 '1': 'unchanged (re-measured: 2 SCCs, same members, 0 upward; +2 edges, both into lib/stage-writes.js; no cycle)',
 '12': 'unchanged (touched: LINEAGE_IDENTITY_PROJECTION +followUpTo in lib/dispatch-store.js; cited decision unmoved)',
 '20': 'unchanged (touched: public/question-cards.js focus helpers; the fetch idiom is not in a hunk)',
 '24': 'unchanged (touched: three run-item literals in public/prompt-section.js became runItemOf(), LIN-4293; the cited payload sites are unmoved)',
 '36': 'unchanged at cited sites (routes/proxy-compute.js: the /cost perDispatch flag only). One entrance field added at four call sites (`writes`, see new-row note on the stage-writes threading); the call-site census (lin-3134-declared-mint-census) guards it',
 '37': 'unchanged (touched: lib/run-view.js STAGE_LABELS +2 Survey labels; the owner-word sites unmoved)',
 '55': 'unchanged (touched: lib/run-view.js STAGE_LABELS only; the derivation split is not in a hunk)',
 '63': 'unchanged (touched: routes/proxy-compute.js /cost perDispatch and docs only; the mock-AI builder is not in a hunk)',
 '64': 'unchanged (touched: lib/dispatch-store.js projection +followUpTo only)',
 '81': 'unchanged (touched: lib/dispatch-store.js projection only; the pause-marker predicate is not in a hunk)',
 '109': 'unchanged (touched: prompt-section.js line numbers shifted; READY_TASK_STATE still render-task-page.js:108; takesNoRun body unmoved, now :705). Pre-existing: the started/running Go-status literals at prompt-section.js:300 and :2407 (were :286 and :2326 at 2eb73ae0)',
 '111': 'unchanged (touched: lib/dispatch-store.js projection only; the 11-05 improvement holds)',
 '117': 'resolved (held): the founder lookup reads the same fields; the window adds followUpTo to its projection and nothing reads it there',
 '119': 'resolved (held): countedRowsOf is still the one partition of snapshot rows. New, single-owner: dispatchesOf (lib/cost-read.js, LIN-4263) partitions records among dispatches, a different partition; the cited restatements are not repeated',
 '121': 'touched by a new sibling census (LIN-4265, tests/unit/fake-dom-census.test.js): an exact sorted-list ratchet over an AST shape. Probably a fifth allowlist shape; the 11-04 text names four without listing them, so not ruled. Count +1',
 '122': 'improved (small): two cited sites rewritten by LIN-4263 (lib/proxy-instructions.js dispatches prose; docs/proxy-integration.md the cumulative-snapshot sentence, now the dispatch-split sentence). The 11-05 citations lib/effort-readout.js:599 and lib/model-routing-spend.js:6,58 do not contain the word at either end (they say "[usage] telemetry", byte-identical); citation corrected',
 '123': 'unchanged (cited cost-read.js line moved 199 -> 211 with the window insertions above it; the completeness ladder is lib/row-usage.js:116-118, not in the window)',
 '126': 'unchanged (touched: question-cards.js focus helpers above it; RULING_SETTLED_CODE = "ruling-settled" unmoved at :248)',
 '129': 'unchanged (touched: the inline loader check moved cost-read.js 147 -> 160, still inline; run-view.js:391 shifted; kpi-stats.js:1067 unmoved; no new inline copy)',
 '130': 'unchanged (touched: question-cards.js focus helpers only; the effect default at :82-89 is not in a hunk)',
 '79': 'unchanged copies; WORSENED by a contradicting comment: lib/lineage-membership.js:14-15 says readers "none re-writes" the dispatch order, but ci-wake-sweep.js:253, pipeline-loops.js:84 and pipeline-churn.js:196 keep their own sort rules (sub-item; not a new row)',
 '104': 'unchanged (no Drift-family ticket moved; 16 open as at 11-05; this run mints one new open child under LIN-3449)',
 '103': UNCH0 + ' (lib/home-view.js, lib/home-row-states.js, public/app.js untouched)',
 '128': UNCH0 + ' (lib/waiting-section.js, lib/home-row-states.js, public/app.js untouched)',
}
NEW = [
 ('131', 'override-kind-list-stale', 'low', 'new (minted)',
  'lib/proxy-instructions.js:860 VERB OVERRIDE lists 15 of the 19 template keys the route accepts (routes/proxy-compute.js:406, `hasPrompt`); missing bug, plan-review, close-out, retrospective-audit. LIN-4248 edited the sentence (+2) without deriving it. No ticket names it (Linear searches in the report). Minted under LIN-3449.'),
 ('132', 'path-class-predicate-copies', 'low', 'new (report-only)',
  'isTest / isDoc: one canonical home, scripts/delivery-paths.mjs (LIN-4257, extracted from delivery-composition.mjs), plus eight pre-window copies: six in scripts/survey-*.mjs (five with the same two regexes, one with an extended isDoc) and two in scripts/steady-base-*.mjs (differing isTest). The window did not touch the copies. Not minted: scripts/ tooling, no shipped behaviour, cap reached.'),
 ('133', 'world-helper-convention-half-guarded', 'low', 'new (report-only)',
  'CLAUDE.md requires vm-over-public suites to use fake-dom.js and client-world.js (loadWorld). The census guards only the fake-DOM half. Of 68 vm-over-public suites, 64 do not use loadWorld: 25 are the census list (hand-written fakes), 1 imports fake-dom.js directly, 38 build their own non-tree document stub that the census excludes by design. Per-suite quality is Code Quality\'s; coverage is Test Coverage\'s.'),
 ('134', 'stage-writes-threading-per-entrance', 'low', 'new (report-only; sub-item of 36 would also fit)',
  'The new `writes` value is resolved once (stageWrites) but threaded by hand at four entrance call sites (lib/dispatch-entrance.js x2, routes/workspace-api-feedback.js x2). The call-site census (tests/unit/lin-3134-declared-mint-census.test.js) guards the mint, not the field. The default is silent: an absent value is `work` (lib/proxy-preamble.js resolveWrites), so an entrance that drops the argument gets the PR-mandate block with no error; routes/collective.js:373 omits it (safe only because its kind is custom). Same shape as row 36; worsened by one field; report-only.'),
 ('135', 'in-progress-predicate-server-client-split', 'low', 'new (report-only; found by the second read)',
  'The "in progress" rule is composed across the server/client seam. The server\'s `live` (lib/task-state.js sessionFactsOf) is running or queued only, by design. The client liveNow (public/prompt-section.js:726) adds `status === \'waiting\'`; that literal predates the window (2eb73ae0 public/prompt-section.js:2300) and LIN-4293 moved it into InProgress.liveNow without removing it. The LIN-4293 comment "adds no rule of its own" overstates. No behaviour diverges today. Report-only: the fix is a design choice (one server flag, or one named client field).'),
]
out = []
for r in rows:
    k = r[0]
    if k in OV: d = OV[k]
    elif k in CROSS: d = 'unchanged by construction (SD 0 commits; runner kit and docs/runner-prompt.md 0-line diff)'
    elif k in RESOLVED_HELD: d = 'resolved (held)'
    elif k == '2': d = 'resolved (held)'
    else: d = UNCH0
    out.append([k, r[1].strip('`'), r[2], d])
for n in NEW: out.append([n[0], n[1], n[2], n[3] + ' | ' + n[4]])
with open(E + '/ledger-run4.tsv', 'w') as fh:
    fh.write('row\tfinding\tseverity (11-05)\trun-4 delta vs 11-05 and evidence\n')
    for o in out: fh.write('\t'.join(o) + '\n')
import collections
c = collections.Counter(o[3].split(' ')[0] for o in out)
print(len(out), 'rows'); print(c)
