# Stability measures: what Harbour's Stability Review opens with

This is LinearViewer's declaration of its Stability Review measures (LIN-4399; written by LIN-4423). A Stability
Review of this repository opens its report with the five measures below, in this order, each per landing or per
finished task, read with the committed tool and set beside the 8 November reference reading. The trajectory
assessment follows, unchanged.

The definitions live in the code, not here. Each row names the module that defines it; when this page and the code
disagree, the code is right and this page is out of date. `tests/unit/stability-measures.test.js` fails if a measure
or a row the tool emits is missing from this page, or if a module it cites is gone.

## The five measures, in order

When two measures pull different ways, the lower number wins. The unit of work is a **landing** (a first-parent
commit on LinearViewer `main` inside the window) or a **finished task** (a ticket whose own landing is in the window
or the lookback, and whose issue was marked Done inside the window). A ticket landed in pieces counts once, in the
window where it finished.

### 1. No new mess

Ordinary tickets read neutral or better in a blind read.

- `sample`: the landings to read. An *ordinary* landing names its own ticket and touches a path outside `docs/`.
  Each ticket keeps one landing, its first ordinary one in the window, and up to 8 of those are taken evenly spaced
  in landing order, so a re-run picks the same commits. Unit: tickets landed in the window. Source: git.
  Defined in `scripts/stability-measures-blind.mjs`.
- `blind`: the share of sampled tickets read neutral or better (better, neutral or mixed), the number read worse, and
  the mean sign (better +1, neutral or mixed 0, worse −1). A sampled commit with no readable sign is counted as
  unreadable, never as neutral. Without `--blind` the row reads `pending blind reads`. Unit: sampled ticket. Source:
  the blind reads below. Defined in `scripts/stability-measures-blind.mjs` (`codeBalance` is the one
  Balance-to-sign rule; the paper's coder imports it).

### 2. The curve

Net production lines lead, with code and comments counted apart.

- `lines`: net production lines per landing, code, comment-only and blank apart, and the comment-only share at base
  and head. The share falling is the signal this measure watches. Production lines are the code-shape kit's
  counter (`measureShape` in `scripts/code-shape/shape-report.mjs`, the registry's Acorn counter; a line with code
  and a trailing comment is code) on the scope `^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)` with the kit's
  default excludes. Unit: landing. Source: git objects. Defined in `scripts/stability-measures-core.mjs`
  (`linesRow`, `SCOPE_INCLUDE`).
- `churn`: lines added and deleted per landing and deleted per added, from first-parent `--numstat --no-renames`
  with merge landings diffed against their first parent, on the same scope. Net churn equals the `lines` net.
  Unit: landing. Source: git. Defined in `scripts/stability-measures-core.mjs` (`churnRow`).
- `ci`: the median minutes (`updatedAt − startedAt`) of successful `test.yml` runs on `main` whose head sha is a
  window landing. Unit: one run per landing. Source: `gh`. Defined in `scripts/stability-measures-core.mjs`
  (`ciRow`) and `scripts/stability-measures.mjs` (the listing).
- `waiting.harbour`, `waiting.runner`, `waiting.total`: Waiting entries in the area notes at base and head and the
  change per landing, for this repository, the runner (simple-dispatcher) and both. An entry is a bullet under
  `## Waiting` in `docs/areas/*.md`, read from git objects; a commit with no notes directory has 0. The runner's
  endpoints are the last first-parent commits on its checked-out branch at or before base's and head's commit
  times. Unit: landing (the change); the totals are counts. Source: git, both repositories. Defined in
  `lib/prompts/area-note-format.js` (`countWaiting`, shared with the area-notes guard) and
  `scripts/stability-measures.mjs` (`readRunner`).
- `minted`: tickets minted per landing, an **ID-span estimate**: the highest issue number created at or before
  head's commit time, minus the same at base, over the window's landings. The span counts trashed and missing
  numbers. Unit: landing. Source: the tracker. Defined in `scripts/stability-measures-core.mjs` (`idSpanSearch`,
  `mintedRow`).

### 3. Speed

- `tasks`: the finished-task set the per-task measures read, with what was left out: tickets landed here but not
  done, done outside the window, and landings that own no ticket. A landing owns only its own ticket: the first id
  in a squash subject, else the merge's branch name, else its PR title. Finished tasks are read from the window's
  landings plus the 3 days before base (`--lookback-days`), because close-out marks a ticket Done after its merge;
  a task whose only landings are older than the lookback and that finished in the window is missed. Unit: finished
  task. Source: git and the tracker. Defined in `scripts/stability-measures-core.mjs` (`ownTicket`,
  `selectFinished`, `tasksRow`).
- `speed`: per finished task, the median and mean minutes from its **first dispatch to its last landing**, and the
  median and mean sessions. A session is a dispatch lineage as `/cost` counts it (`workerSessions`), not a
  dispatch row: LIN-4393 has 14 rows, 5 of them wakes, and 8 sessions. Unit: finished task. Source: the tracker
  (`GET /issues/{id}/cost`). Defined in `scripts/stability-measures-core.mjs` (`sessionsOf`, `firstDispatchOf`,
  `speedRow`).

### 4. The person's seat

- `rulings`: questions that were really the person's. **Loop rulings only**: rulings raised per finished task
  (distinct decisions) and the answered share, answered ÷ (answered + dismissed). A dismissed ruling was by
  definition not theirs. Unit: finished task. Source: the tracker (`GET /rulings`). Defined in
  `scripts/stability-measures-seat.mjs` (`rulingsRow`).
- `origin`: whether a person started a dispatch. Always `not measured` (see the limits below). Defined in
  `scripts/stability-measures-seat.mjs` (`originRow`).
- `operator-free`: runs that needed no operator, an **upper bound**: the share of finished tasks with no loop
  ruling, no `[blocked]` feedback entry on any lineage member, and no dispatch closed with `closedReason:
  'operator'`. Unit: finished task. Source: the tracker (`/cost` lineages, `GET /dispatch/{id}` for every member).
  Defined in `scripts/stability-measures-seat.mjs` (`operatorFreeRow`).

#### Limits of measure 4

- **Loop rulings only.** `GET /rulings` does not return an answered task-bound ruling, and no other read does, so
  those are not counted. Rulings anchored on a finished task's parent are reported beside the row, not counted
  against the pieces.
- **Person-origin is not readable.** `dispatchedBy` is the workspace account for autopilot and person alike, so
  "no dispatch started by a person" cannot be read, and `origin` prints why.
- **The operator-free share is an upper bound**, because that condition is missing. `closedReason: 'operator'` is a
  catch-all, which may push the share down.
- **Follow-up, not built here:** a person-origin field on the dispatch read, and a read of resolved task-bound
  rulings. Both are Waiting entries in `docs/areas/reports-and-operator-tools.md`.

### 5. Cost per finished task

- `cost`: the median and mean `totalUsd` per finished task, with the `unpriced`, `noTelemetryCount`,
  `unreadableCount` and `noLineage` counts beside it; a null total is unreadable, never $0. Measured, not optimised
  for now. Unit: finished task. Source: the tracker (`GET /issues/{id}/cost`). Defined in
  `scripts/stability-measures-core.mjs` (`costRow`).

A row whose source is missing or unreadable prints `not measured: <reason>`, and a partial read prints its
unreadable count. Nothing is estimated and nothing is zero-filled.

## Running it

From the LinearViewer checkout's root, with the simple-dispatcher checkout beside it:

```
node scripts/stability-measures.mjs . <base> HEAD --runner ../simple-dispatcher \
  --reference docs/reviews/stability-measures/reference-2026-11-08.json [--blind signs.json] \
  > reading.json 2> table.txt
```

`table.txt` is the opening table: one line per row, the five measures in order, and under each row its 8 Nov
reference, summarised by the same rule. `reading.json` is the full reading. The review saves both in its evidence
folder and runs the committed script; it does not copy or write measuring scripts of its own.

### The window

- **Base** is the previous Stability report's head pin. For the first reading after this declaration, it is
  `9574d537`, run 5's pin (`docs/reviews/stability-review-2026-11-08.md`, "LV `9574d537`").
- **Head** is HEAD at run time.
- Every report states its head pin the same way ("LV `<sha>`" in its Examined line), and the saved `reading.json`
  carries it as `window.head`, so the next review can find it without guessing. Consecutive windows then neither
  overlap nor leave a gap.

### What it reads outside this repository

- **The tracker**, through the workspace API proxy (`--api`, default `$HARBOUR_LOCAL_BASE/api/proxy`), for
  `minted`, `tasks`, `speed`, `cost`, `rulings` and `operator-free`. Reads are paced at 50 a minute and honour
  429 `Retry-After` (`createProxyClient` in `scripts/stability-measures-tracker.mjs`). On the 8 Nov window the
  tracker rows took about 280 calls and the seat about 1,700 more (one detail read per lineage member), roughly
  40 minutes in all.
- **`gh`**, for `ci`. It runs from the repository, so its GitHub remote decides which repository's runs are read.
- **The runner checkout** (`--runner`), for `waiting.runner`. A checkout older than head, whose origin has moved on,
  reads `not measured`.

A source that is absent prints its rows as `not measured` with the reason.

### The blind read

1. Run the tool without `--blind`. The `sample` row lists the sampled commits.
2. For each sampled commit, start a fresh reader: a new session or subagent that has read nothing else in this
   review. Give it only that commit's diff and the frozen prompt,
   `docs/papers/harbour/cleaner-than-it-started-evidence/2026-11-06/prompts/blind-read-prompt.md`, unchanged.
3. Save each reader's Balance cell verbatim in `signs.json`: one object keyed by the full commit sha.
4. Re-run with `--blind signs.json`, and save `signs.json` in the evidence folder beside the reading.

When LIN-4396 (a blind read before merge) lands, its recorded reads may replace this sample; this page will say so
then.

## The 8 November starting point

As the ask gives it (LIN-4399), unchanged:

> * net source growth +1.56k lines a day (about 2,390 added, 830 deleted);
> * 0.35 lines deleted per line added;
> * production JavaScript 206,782 lines; by the area registry's count (207,338 lines), 82,154 are comment-only;
> * CI median 8.55 minutes;
> * 66 Waiting entries (56 Harbour, 10 runner);
> * 1.43 tickets minted per landing;
> * round 1 cost about $24 a ticket;
> * one task (LIN-4393): 8 sessions, $14.94, 54 minutes from first Survey to merge.

Each figure has its own definition, and most are not the tool's. The table gives each one's definition, the tool's
figure on the same window (`5334c81a..9574d537`, 114 landings, 4 Nov 05:24Z to 8 Nov 17:10Z) and why they differ.
The supplied figures stay as they are; the tool's figures are the reference a reading is compared with, because only
they share its definitions.

| Supplied figure | Its definition | The tool on the reference window | Why they differ |
|---|---|---|---|
| +1.56k lines a day (2,390 added, 830 deleted) | Run 5's `src` bucket: every path outside its excluded, tests, scripts, docs, CI-config and research buckets (`docs/reviews/_evidence-2026-11-08-stability/measure_lv.py`), per day over ≈4.45 days: 10,635 added, 3,697 deleted | `lines` +57.5 net per landing (+6,558 over 114); `churn` 89.8 added, 32.3 deleted per landing (10,235 / 3,677) | Per day against per landing, and a wider scope. The `src` bucket is the tool's scope plus 400 added and 20 deleted lines of non-JavaScript files (373 added in JSON under `lib/`, the rest CSS, text, `CLAUDE.md` and `content/`), which reconciles both exactly. On the `src` bucket, per landing is +61 net and 93 added; that earlier figure came from this different scope, not from the tool |
| 0.35 deleted per added | Run 5's `src` bucket: 3,697 / 10,635 | `churn` 0.36 (3,677 / 10,235) | The scope above: the non-JavaScript lines were mostly added |
| 206,782 production JavaScript lines | The regex line counter in `scripts/steady-base-code.mjs` | `lines` 206,784 at `9574d537` | Another counter; 2 lines apart |
| 82,154 comment-only of 207,338 (the area registry's count) | The registry's Acorn counter (`scripts/code-shape/shape.mjs`) on the registry's coverage; the commit and exact scope of that count are not recorded | `lines` 82,161 comment-only of 206,784 at `9574d537` (code 110,011, blank 14,612); share 39.73% | The same counter on the kit's Harbour scope at run 5's pin. The comment-only count is 7 lines apart and the total 554 apart; the residual is not explained, and is left visible here rather than hidden |
| CI median 8.55 minutes | Run 5 (`docs/reviews/_evidence-2026-11-08-stability/measure_ci.py`): every successful `test.yml` run on `main` started 5 to 8 Nov by its start date (n = 101), `updatedAt − startedAt` | `ci` 8.59 min over 114 runs | Runs matched to the window's 114 landings rather than to calendar days: the window starts 4 Nov 05:24Z, and run 5 put 4 Nov's runs in its 2 to 4 Nov bucket |
| 66 Waiting entries (56 Harbour, 10 runner) | Bullets under `## Waiting` at `9574d537` and runner `5d8489e` | `waiting.harbour` 0 → 56; `waiting.runner` 0 → 10 (`9478e1c`..`5d8489e`); `waiting.total` 0 → 66 | Same definition; the supplied figure is the head total, the tool also reads base and the change per landing |
| 1.43 tickets minted per landing | Run 5: LIN-4206 → LIN-4394 (188 ids over 4.36 days, 43.1 a day) against LinearViewer and simple-dispatcher landings (114 + 20 over 4.45 days, 30.1 a day), a ratio of daily rates | `minted` 1.67 per landing: LIN-4204 → LIN-4394, 190 ids over 114 landings | One repository's landings, both ends by head's and base's commit times, a count over landings rather than a ratio of rates |
| About $24 a ticket (round 1) | "Round 1" of an earlier cost reading; its rule and window are not recorded in this repository | `cost` median $9.53 (mean $14.29) over 106 finished tasks, all priced | A median per finished task in this window, read from `/cost`, against an unrecorded per-ticket figure from another window |
| LIN-4393: 8 sessions, $14.94, 54 minutes from first Survey to merge | One task | LIN-4393 inside `speed` and `cost`: 8 sessions, $14.94, 53.9 minutes | Speed is first dispatch to last landing; `tests/unit/stability-measures.test.js` pins the 8 sessions and $14.94 from its recorded `/cost` fixture |

## The reference reading: `reference-2026-11-08.json`

The tool's reading of `5334c81a..9574d537` (run 4's pin to run 5's), written by the committed script with
`--as-reference '8 Nov'`:

```
node scripts/stability-measures.mjs . 5334c81a 9574d537 --runner ../simple-dispatcher --as-reference '8 Nov' \
  > docs/reviews/stability-measures/reference-2026-11-08.json
```

Its opening table (the tool's stderr):

```
stability measures 5334c81a7..9574d5371 (2026-11-04T05:23:59Z → 2026-11-08T17:10:36Z), 114 landings
1. No new mess
   sample           not measured: no 8 Nov reading; the first reading sets it
   blind            not measured: no 8 Nov reading; the first reading sets it
2. The curve
   lines            net +6,558 (code +3,034, comment-only +3,185, blank +339); +57.5 per landing; totals 200,226 → 206,784; comment-only share 39.44% → 39.73%
   churn            10,235 added, 3,677 deleted over 114 landings; 89.8 added and 32.3 deleted per landing; 0.36 deleted per added
   ci               median 8.59 min over 114 runs (114 of 114 landings)
   waiting.harbour  0 → 56 (+56, +0.49 per landing)
   waiting.runner   0 → 10 (+10, +0.09 per landing); main 9478e1c53..5d8489e7f
   waiting.total    0 → 66 (+66, +0.58 per landing)
   minted           190 over LIN-4204 → LIN-4394, 1.67 per landing (ID-span estimate; 22 probes)
3. Speed
   tasks            106 finished (1 landed before base); of 106 tickets landed here, 0 not done and 1 done outside the window; 0 landing(s) own no ticket; lookback 3 days
   speed            median 56.3 min (mean 124.6) first dispatch → last landing; median 5 sessions (mean 5.61); 106 of 106 tasks
4. The person's seat
   rulings          not measured: no 8 Nov reading; the first reading sets it
   origin           not measured: no 8 Nov reading; the first reading sets it
   operator-free    not measured: no 8 Nov reading; the first reading sets it
5. Cost per finished task
   cost             median $9.53 (mean $14.29) over 106 of 106 tasks; unpriced 0, noTelemetryCount 0, unreadableCount 0, noLineage 0
```

How to read it:

- **No blind read and no seat reading.** The 8 Nov starting point had neither, so `sample`, `blind`, `rulings`,
  `origin` and `operator-free` read `not measured: no 8 Nov reading; the first reading sets it`. The tool writes
  them that way (`--as-reference`), rather than reading the seat today and passing it off as 8 November's. The
  blind-read paper's baseline (`docs/papers/harbour/cleaner-than-it-started.md`, Finding 1: +0.38 and +0.50 over
  eight changes in `015aa4c6..5334c81a`) is a different method, with batches of commits and two passes, not this
  sample. It is cited here as context, not as a comparison.
- **Waiting 0 → 56 is not a rate.** Harbour's `docs/areas/` was created inside this window (base has no notes
  directory), so +0.49 per landing mostly records the notes being started, not entries accumulating at a normal
  pace. The runner's 0 → 10 is the same. The next reading's change per landing should not be judged against it as if
  it were a rate; its base and head totals are the comparison.
- **The tracker rows are the tracker as read on 12 November 2026**, not observations from 8 November: a later wake can
  add cost to a finished task, and `completedAt` can move. `sources.tracker.readOn` records the day.

### Re-running it

Run the command above again, from the same relative paths. The output is byte-identical apart from these, which read
live state:

- the tracker rows, `minted`, `tasks`, `speed` and `cost`, and `sources.tracker.readOn`: today's tracker (`minted`'s
  probe list also moves with the newest issue number, though its span does not);
- the `ci` row: live `gh` state, which changes only if a run is re-run or deleted;
- `repo`, `inputs.runner` and `sources.runner.dir`, if the command is given other paths than these.

A reference reading leaves out what a live reading keeps for diagnosis and would change on every run: the runner
checkout's tip, its date and the freshness check's upstream sha, and the proxy's call counts and waits. The proxy
is recorded as the variable it came from, `$HARBOUR_LOCAL_BASE/api/proxy`, not the session's local URL.

Checked when it was written (LIN-4423, 12 November 2026): two runs of the command, at 17:57Z and 18:03Z, each
about 5.7 minutes, gave byte-identical JSON and identical tables, with every tracker row measured and nothing
unreadable. Both runs were on one day, so they cannot show tracker drift across days, and both were in one
environment.

## What this retires

- **Copying or writing measuring scripts into each run's evidence folder.** The review runs the committed script and
  saves its output. Frozen evidence folders and published reports stay as they are, because reports cite them.
- **The per-day rows of `project-velocity-trajectory`** (LV and SD). The next report closes both ledger rows as
  superseded by the opening measures, rather than recomputing them per day.
