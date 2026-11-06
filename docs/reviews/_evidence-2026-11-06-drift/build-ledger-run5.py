# Build the run-5 trend ledger (LIN-4324): the 135 rows of run 4's ledger, each with a run-5 delta, plus rows 136-140.
# Input: ledger-run4.tsv (run 4's rows 1-135, from the run-4 evidence folder) and ledger-touch-map-run5.txt (name match).
# Default for a row with no touched cited file: "unchanged (no cited file touched in af55cb73..5c63aa26)". Overrides below
# are the rows whose cited files the window touched, each checked against the hunks or the cited lines at 5c63aa26.
# Usage (repo root): python3 -I build-ledger-run5.py <ledger-run4.tsv> <out.tsv>
import csv, sys
rows = list(csv.reader(open(sys.argv[1]), delimiter='\t'))[1:]
NOTOUCH = 'unchanged (no cited file touched in af55cb73..5c63aa26)'
OV = {
 '1': 'unchanged (re-measured at 5c63aa26: 2 SCCs, same members, 0 upward; +1 static edge lib/render.js -> lib/periodicals.js; no cycle)',
 '8': 'unchanged (touched: public/common.js, the LIN-4292/4304 guard spelling only; the cited decision is outside the hunks)',
 '18': 'unchanged (touched: public/common.js, guard spelling only; the cited sites are outside the hunks)',
 '20': 'unchanged (touched: public/question-cards.js, a comment (LIN-4309) and one guard-spelling line; the focus helper is not in a hunk)',
 '23': 'unchanged (touched: lib/render.js +3/-2, the import and the two periodicalPromptName() calls; the cited decision is outside the hunks)',
 '24': 'unchanged (touched: public/prompt-section.js, guard spelling only; the payload sites are unmoved)',
 '25': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '27': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '38': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '40': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '55': 'unchanged (touched: public/prompt-section.js guard spelling only; the derivation split is not in a hunk)',
 '58': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '66': 'unchanged (touched: public/common.js guard spelling only; the cited decision is outside the hunks)',
 '71': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '72': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '74': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '87': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '91': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '99': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '102': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '106': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '108': 'unchanged (touched: lib/render.js and public/common.js; the window hunks are the periodical name calls and guard spelling; the cited decision is outside them)',
 '109': 'unchanged (touched: public/prompt-section.js and public/task-page.js, guard spelling only; READY_TASK_STATE still lib/render-task-page.js:108)',
 '113': 'unchanged (touched: lib/render.js import and periodicalPromptName() calls only; the cited decision is outside the hunks)',
 '120': NOTOUCH,
 '121': 'touched: +1 allowlist-shaped test (tests/unit/public-element-method-guards.test.js, LIN-4304: an acorn AST scan with a keyed allowlist and a stale-entry check, the shape of no-page-wide-label-listener.test.js). Files importing acorn in tests: 5 -> 6. Count +1, existing shape; still not ruled',
 '122': 'unchanged (touched: lib/proxy-instructions.js +27/-2, the PM catalog entry and the Grants line; docs/proxy-integration.md +60/-3, the LIN-4313 mint route; the usage-prose sites are not in a hunk). Run 4\'s improvement holds',
 '126': 'unchanged (touched: public/question-cards.js, a comment and one guard-spelling line; RULING_SETTLED_CODE now at :250, value unchanged)',
 '128': 'unchanged (cited production files 0-line diff; the one touched citation, tests/unit/dashboard-routes.test.js, is a LIN-4308 suite move and not the decision)',
 '130': 'unchanged (touched: public/question-cards.js, a comment and one guard-spelling line; the effect default is not in a hunk)',
 '131': 'unchanged in code: lib/proxy-instructions.js VERB OVERRIDE sentence not edited (it moved 860 -> 884); the window touched only the PM catalog entry and the Grants line. LIN-4302 Backlog, 0 comments. Not a new prose copy',
 '133': 'improved (guarded half, at 5c63aa26): vm-over-public suites not on loadWorld 64 -> 49 (46 at 90542b2c after LIN-4311); HAND_WRITTEN_FAKE_DOM_FILES 25 -> 10 (stops 9 -> 6); own-stub suites unchanged at 39',
 '134': 'unchanged: stageWrites( call sites in lib and routes 5 -> 5; the PM lane goes through enqueueRow and adds no threading site; the silent default is unchanged. The window touched tests/unit/lin-3134-declared-mint-census.test.js (+14/-12, the mint census), not the decision',
 '135': 'unchanged: the client liveNow still reads data.status === \'waiting\' (public/prompt-section.js:726, moved from run 4\'s :2300, not removed); lib/task-state.js:65 live: !!held unchanged; LIN-4256 Backlog',
 '104': 'unchanged (no Drift-family ticket moved; all 24 carried tickets unmoved; LIN-3449 Todo; this run mints no child)',
 '79': 'unchanged (cited files 0-line diff; the sub-item comment at lib/lineage-membership.js:14-15 is unchanged)',
}
NEW = [
 ('136', 'stage-kind-roster-tables', 'low', 'new (received from Seams run 8 §3, which rates it low-medium)',
  'Per-kind tables in 9 files (13 `survey-place` occurrences) joined by string keys; 7 of 8 tables are guarded by a kind loop. Unchanged: 13 occurrences at both ends. The unguarded table is row 131. Home: Drift (this ledger); no ticket names it.'),
 ('137', 'enqueue-route-list-restated', 'low', 'new (window-introduced; top of the window findings)',
  'The enqueue-route set is restated in 9 prose places. The window updated 5 and left 4 saying "three": CLAUDE.md:107 (LIN-4320), lib/proxy-scopes.js:23-25, lib/proxy-instructions.js:1171 (the agent-served 403 table), docs/proxy-integration.md:102. None of the prose is checked against the mounts. Home: widen LIN-4320.'),
 ('138', 'element-method-guard-idiom-beyond-scan', 'low', 'new (pre-existing sites, made visible by the one-spelling claim)',
  '8 presence guards on focus / setSelectionRange / dispatchEvent sit outside the scan\'s six methods: prompt-section.js:1053,1055,1219,1223,1856; question-cards.js:241-242; common.js:2301. Home: LIN-4303 (re-scope; its named list is done by LIN-4304).'),
 ('139', 'client-dual-export-split', 'low (borderline)', 'new (window-introduced, LIN-4310)',
  'public/live-console.js publishes two disjoint surfaces: module.exports (6 functions) and window.LiveConsoleLane (1 function, read only by tests). The canonical dual export is one api object published both ways (question-cards.js:547-549, cost-format.js, home-placement.js). Report-only; a convention outlier, not a rule by assumption.'),
 ('140', 'working-beat-grammar-cross-repo', 'low-medium', 'new (received from Comprehension-Debt run 5, R6, which rates it medium)',
  'Harbour reads the [working] beat and SD writes it, with neither end naming the other. state:\'running\' is unreachable from SD\'s real beats (CD run 5 spike). Unchanged by construction (SD 0 commits; the window touched no heartbeat reader). Home: LIN-3828 (Backlog, 1 comment).'),
]
out = []
for r in rows:
    row, finding, sev, delta = r[0], r[1], r[2], r[3]
    if row in OV:
        d = OV[row]
    elif delta.startswith('resolved'):
        d = 'resolved (held)'
    elif delta.startswith('unchanged (cited files 0-line diff)') or delta.startswith('unchanged'):
        d = NOTOUCH if row not in OV else OV[row]
    else:
        d = delta
    out.append((row, finding, sev, d))
for n, f, s, d, *_ in NEW:
    out.append((n, f, s, d))
with open(sys.argv[2], 'w') as fh:
    fh.write('row\tfinding\tseverity (run 4)\trun-5 delta vs run 4 and evidence\n')
    for row in out: fh.write('\t'.join(row) + '\n')
print('rows', len(out), 'new', len(NEW))
