#!/usr/bin/env python3
"""LIN-4250 (Drift & Coherence 2026-11-05): build the report's three long tables from the evidence files.

Run from the repo root:
  python3 docs/reviews/_evidence-2026-11-05-drift/build-report-tables.py

Reads  rulings-11-05.tsv, census-W-*.json, ledger-carry-11-04b.tsv and ledger-touch-map.txt (this folder).
Writes ledger-11-05.tsv (this folder) and replaces the {{RULINGS}}, {{TABLEGROUPS}} and {{LEDGER}} markers in
docs/reviews/drift-coherence-review-2026-11-05.md. Re-running on a filled report is a no-op (markers gone).
"""
import csv, json, os, re, sys

E = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.join(E, '..', 'drift-coherence-review-2026-11-05.md')


def cell(s):
    return str(s).replace('|', '\\|').replace('\n', ' ').strip()


# ---- 1. ruling table (105 mustRule groups) --------------------------------------------------------------
census = json.load(open(os.path.join(E, 'census-W-code-2eb73ae0-vs-d7ceb373-guide-2eb73ae0.json')))
by_id = {g['id']: g for g in census['groups']}
rows = list(csv.DictReader(open(os.path.join(E, 'rulings-11-05.tsv')), delimiter='\t'))
must = [r for r in rows if r['id_11-05'] != '(left)']
left = [r for r in rows if r['id_11-05'] == '(left)']
assert len(must) == 105, len(must)
for r in must:
    assert by_id[r['id_11-05']]['mustRule'], r['id_11-05']
counts = {}
for r in must:
    counts[r['ruling_11-05']] = counts.get(r['ruling_11-05'], 0) + 1
rl = ['| id (11-05) | 11-04b id | decision | a/f/s | ruling | one-line reason (home, when real) | basis |',
      '|---|---|---|---|---|---|---|']
for r in must:
    g = by_id[r['id_11-05']]
    basis = r['note_11-05'].replace('carried: ', 'carried; ')
    rl.append('| %s | %s | %s | %s | **%s** | %s | %s |' % (
        r['id_11-05'], r['id_11-04b'], cell(g['decision'][:110]), r['areas/files/sites'],
        r['ruling_11-05'], cell(r['reason_11-04b']), cell(basis)))
for r in left:
    rl.append('| (left) | %s | %s | %s | **real** (re-ruled) | %s | left `mustRule` by a re-key |' % (
        r['id_11-04b'], cell(r['decision']), cell(r['areas/files/sites']), cell(r['note_11-05'] or r['ruling_11-05'])))
rulings_md = '\n'.join(rl)
rulings_head = 'Counts: %d real, %d borderline, %d noise.' % (
    counts.get('real', 0), counts.get('borderline', 0), counts.get('noise', 0))

# ---- 2. table groups (309, no ruling) -------------------------------------------------------------------
tg = [g for g in census['groups'] if g['table'] and not g['mustRule']]
tl = ['| id | det | decision (truncated at 90) | a/f/s | status |', '|---|---|---|---|---|']
for g in tg:
    tl.append('| %s | %s | %s | %d/%d/%d | %s |' % (g['id'], g['detector'], cell(g['decision'][:90]),
                                                g['areaCount'], g['fileCount'], g['siteCount'], g['status']))
table_md = '\n'.join(tl)
table_n = len(tg)

# ---- 3. compact trend ledger ----------------------------------------------------------------------------
touched = {}
for line in open(os.path.join(E, 'ledger-touch-map.txt')):
    m = re.match(r'^(\S+) -> (.*)$', line.strip())
    if m:
        touched[m.group(1)] = m.group(2)

# Rows whose 11-05 reading is not the default. (state at 2eb73ae0 / 07c88f7, delta vs 11-04b, severity override)
O = {
 'lib-import-cycles': ('2 SCCs (6, 6), same members; 499 nodes / 2,051 static edges; no window edge closes a cycle (`import-graph-diff.txt`)', 'unchanged'),
 'provider-auth-router-upward-imports': ('0 static / 0 dynamic `lib/`→`routes/`/`server.js` edges at both SHAs', 'held'),
 'routes-error-envelope-fragmentation': ('`res.status(` 275 / 250 / 12 at both SHAs, identical per file; LIN-4241\'s 409 goes through `jsonError` (#F-c)', 'unchanged'),
 'cross-repo-sentinel-decision-marker-vocabulary': ('kit 0-line diff; SD hook status strings unchanged (comment-only diff). New SD system test binds Harbour\'s terminal and wake readers one way, outside SD CI (#3)', 'unchanged'),
 'cache-module-family': ('8 `lib/*-cache.js`; no cache added in the window (new files: `ruling-settled`, `waiting-section`, `home-placement`)', 'unchanged'),
 'runner-contract-semantics-cross-repo': ('38 vs 34 rows, both 0-line diff, 0 usage rows. LIN-4218 puts the usage flush first in SD\'s Stop order (the U slot, `hook.js:441-468`), still in neither table', 'unchanged'),
 'decision-dialect-split': ('SD decision relay: three call sites → one D slot `relayDecisionAndWithdrawals` (`hook.js:538`, LIN-4218); `scanDecisionBlock` body byte-identical (`:771`); kit DECISION prose 0-line diff', 'unchanged (SD relay consolidated internally)'),
 'decision-stamp-classifier-copies': ('touched without consolidation: LIN-4240\'s `_isNonStateEntry` (`session-telemetry.js:85-91`) calls the inline `_isStampEntry` (`:60-63`), not `digest-feedback.js:78`', 'unchanged (touched)'),
 'vendor-script-list-restated': ('27 `scripts: [` arrays, 7 purify render files at both SHAs; Home\'s list +`/home-placement.js` (`render.js:383`); census G0214→G0211 is the label (+8→+9)', 'unchanged'),
 'home-next-answer-split': ('LIN-4151: /backlog lead roots on Up next\'s ranking (`rankKeysOf`/`compareRank`, `home-view.js:422,432`), one split for page and fold (`home-rows.js:156-158`). Triage (`home-view.js:36`, `task-order.js:163`) and the deck top (`home-pipeline.js` 0-line diff) unchanged; `orderIssuesForSwipe` (`task-board-view.js:91`) still ranks apart', '**improved (partial)**'),
 'coherence-loop-stalled': ('LIN-4234 Done ~3h after mint; LIN-4151 Done. 16 open Drift follow-ups (was 18); the other 14 unmoved, 0 new comments', '**improved** (first movement)'),
 'task-page-state-outside-owner': ('`READY_TASK_STATE` still `render-task-page.js:108`; `public/task-page.js` 0-line diff. LIN-4048 kept the no-run rule in `runOfferOf` (`task-state.js:310`), read via `takesNoRun` (`prompt-section.js:691`)', 'unchanged'),
 'live-anchor-old-home-alive': ('`liveGuard` flag gone; `liveOnAnchor` unconditional (`unanswered-decisions.js:982`). One inline copy left, `routes/proxy-rulings.js:246-249` (0-line diff), named at `live-anchor.js:9`; LIN-3843 Backlog', '**improved**'),
 'halt-poll-cold-cache-fail-open': ('`poll-halt.js`, `workspace-halt.js`, kit and SD `dispatcher.js` 0-line diff; LIN-4210 Backlog, 0 comments. John\'s ruling; not chosen', 'unchanged'),
 'usage-relay-flag-partial': ('LIN-4218\'s U slot calls `flushRequestUsageSafely` → `request-usage-flush.js:114` (0-line diff). LIN-4214 Backlog, 0 new comments', 'held'),
 'usage-record-vocabulary-two-readers': ('`request-usage-vocabulary.js`, `request-usage-intake.js` 0-line diff', 'unchanged'),
 'lineage-identity-read-twins': ('`findLineageIdentity` `dispatch-store.js:320`; LIN-4241\'s dispatch-store hunks are the settled check and CAS only', 'held'),
 'cost-fold-partition-restated': ('`countedRowsOf` read at `cost-read.js:89,252,268`', 'held'),
 'usage-snapshot-prose-residue': ('8 of 9 files left. Fixed: `source-map.md:192` (LIN-4226). Left in files LIN-4226 edited: `effort-readout.js:599` (user-visible), `model-routing-spend.js:6,58`. Unchanged: `proxy-instructions.js:385-386`, `proxy-integration.md:1239`, `request-usage-vocabulary.js:4`, SD `request-usage-flush.js:3-8`, `request-usage.js:163-164`', '**improved** (1 of 9)'),
 'completeness-precedence-restated': ('`row-usage.js:116`, `cost-read.js:199`, `request-usage-fold.js:103`', 'unchanged'),
 'erasure-inventory-lockstep-gap': ('`usage-snapshot-intake` in `INVENTORY` (LIN-4234, `950113b1`); one name source `tests/helpers/collection-names.js` for both guards; `server.js` non-literal `collection()` census. Residual (noise): that census covers `server.js` only', '**resolved**', 'resolved'),
 'key-state-residue': ('held (informational)', 'held'),
}

carry = list(csv.reader(open(os.path.join(E, 'ledger-carry-11-04b.tsv')), delimiter='\t'))[1:]
assert len(carry) == 124, len(carry)
NEW = [
 ('`parked-wait-text-cross-repo`', 'low-medium', '—', 'SD writes one park status for 4 wait kinds (`hook.js:1520-1537`, `heartbeat.js:258-264`); Harbour reads 1 (`PARKED_WAIT_HINT`, `session-telemetry.js:325`). No contract row; the binding test is SD system-tier only, outside SD CI. Home: LIN-2258', '**new** (first ruled)'),
 ('`error-code-case-split`', 'low', '—', '`ruling-settled` is the one kebab-case HTTP error `code` (routes: 42 UPPER_SNAKE codes, lib: 18); scan retire keeps `ALREADY_TERMINAL` (`workspace-api-scan.js:75,508`); browser restates the code (`question-cards.js:248`)', '**new**'),
 ('`ruling-settled-row-predicate-inline`', 'low', '—', 'task-row "settled" = outcome ∈ {answered, dismissed} inline at 5 sites / 3 route files (`dashboard-rulings.js:327`, `workspace-api-issue-write.js:162,168,646`, `workspace-api-scan.js:389`); loop side has one owner (`isDecisionSettledIn`). Home: `lib/task-decisions-store.js`. Census G0217 re-ruled real', '**new**'),
 ('`waiting-standing-comment-residue`', 'low', '—', 'three window comments contradict the code: `home-row-states.js:121` ("the task page\'s read leaves it off", untrue since LIN-4143); `waiting-section.js:5` (names `readWaitingStanding`, which does not exist; Seams run 7 hand-off); `public/app.js:630-631` (badge and count line "differ by design", against `unanswered-decisions.js:963-964`, `home-row-states.js:120` and `dashboard-routes.test.js:6891-6893`; second-read). The real difference is freshness: the badge reads the 5s-cached feed, the count line the uncached `/api/home-waiting`, on one tick', '**new**'),
 ('`request-source-guard-copies`', 'low', '—', 'LIN-4226 added three inline partial checks of the loader shape (`cost-read.js:147` both methods, `kpi-stats.js:1067` `forRows` only, `run-view.js:388` `forAnchors` only) beside the owner `requireRequestUsageLoader` (`request-usage-loader.js:91-92`, called from 6 files at both SHAs; 0 inline copies at `d7ceb373`). Found by the second-read', '**new**'),
 ('`reply-effect-default-split`', 'borderline (not graded)', '—', '`question-cards.js` defaults an absent effect to `record` (LIN-4143, fail closed) while the shared reply helper keeps absent = `resume` (pinned by `reply-delivery-contract`); deliberate and documented', '**new** (borderline)'),
]

out = [['#', 'finding', 'severity (11-05)', 'delta vs 11-04 (11-04b)', '11-05 (this run, `2eb73ae0` / `07c88f7`)', 'delta vs 11-04b']]
stat = {}
for row in carry:
    n, name, sev, d04b = row[0], row[1], row[2], row[3]
    key = name.strip('`')
    d04b = re.sub(r'\s*\[row has an escaped pipe; parsed by hand\]', '', d04b)
    if key in O:
        o = O[key]
        text, delta = o[0], o[1]
        if len(o) > 2:
            sev = o[2]
    elif sev == 'resolved':
        text, delta = 'held resolved; ' + ('named files touched, hunks in the window clusters, decision unmoved' if key in touched else 'cited files 0-line diff'), 'held'
    elif key in touched:
        text, delta = 'named files touched (%s); hunks belong to the window clusters read in beat 2; cited decision unmoved' % touched[key], 'unchanged'
    else:
        text, delta = 'cited files 0-line diff in the window', 'unchanged'
    out.append([n, name, sev, d04b, text, delta])
    k = re.sub(r'\*|\s*\(.*', '', delta)
    stat[k] = stat.get(k, 0) + 1
for i, (name, sev, d04b, text, delta) in enumerate(NEW, start=125):
    out.append([str(i), name, sev, d04b, text, delta])
with open(os.path.join(E, 'ledger-11-05.tsv'), 'w', newline='') as f:
    csv.writer(f, delimiter='\t').writerows(out)
ll = ['| ' + ' | '.join(out[0]) + ' |', '|' + '---|' * len(out[0])]
for r in out[1:]:
    ll.append('| ' + ' | '.join([r[0], r[1]] + [cell(x) for x in r[2:]]) + ' |')
ledger_md = '\n'.join(ll)
ledger_head = 'Of the 124 carried rows: %s. New: %d. Total %d rows.' % (
    ', '.join('%d %s' % (v, k) for k, v in sorted(stat.items(), key=lambda kv: -kv[1])), len(NEW), len(out) - 1)

print(rulings_head, '| table groups', table_n, '|', ledger_head, file=sys.stderr)
rep = open(REPORT).read()
if '{{RULINGS}}' in rep:
    rep = (rep.replace('{{RULINGS_HEAD}}', rulings_head).replace('{{RULINGS}}', rulings_md)
              .replace('{{TABLEGROUPS_N}}', str(table_n)).replace('{{TABLEGROUPS}}', table_md)
              .replace('{{LEDGER_HEAD}}', ledger_head).replace('{{LEDGER}}', ledger_md))
    open(REPORT, 'w').write(rep)
else:
    i = rep.index('| # | finding | severity (11-05) |')
    rep = rep[:i] + ledger_md + '\n'
    rep = re.sub(r'Of the 124 carried rows: [^.]*\. New: \d+\. Total \d+ rows\.', ledger_head, rep)
    open(REPORT, 'w').write(rep)
