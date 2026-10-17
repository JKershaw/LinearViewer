# Score: experiment #2 (LIN-3602, PR #1911, "one authority for the waiting wake marker")

- **Merge:** `ee9fcba9` on origin/main (squash, merged 08:56:25Z). Its **first (and only) parent is `f885f44c`** (LIN-3600). Old = `f885f44c`, new = `ee9fcba9`.
- **PR head:** `77ecfb88` (refs/pull/1911/head). Its tree is identical to the merge. It has 2 commits: `a00764af` (08:32:58Z, the main change) and `77ecfb88` (08:50:48Z, the close-out case-fold guard).
- **Timeline:** kickoff 08:21Z → first commit +12 min → PR opened 08:34:04Z → close-out commit 08:50:48Z → merged 08:56:25Z. That is about 35 min from kickoff to merge.
- **Artefacts (this folder):**
  - seams: `seams-<sha>.json`
  - census: `census-<sha>.json` and `.log` (also run at d349e78c for the group id)
  - replay: `replay-s1.json`, `replay-s2.json`, `selfcheck/`, `selfcheck.log`
  - case-fold mutant: `replay-mut-casefold.json`
  - divergence probe: `probe-old.txt`, `probe-new.txt`
  - pinned sides: `sides/`

## 1. Sites (the ticket's git grep, lib routes server.js public)

| | hits |
|---|---|
| old `f885f44c` | 23 (same list as the ticket) |
| new `ee9fcba9` | **14** |

The 14 hits at new:
- The authority, `lib/dispatch-terminal.js:83`.
- All 10 expected sites:
  - recent-runs:39
  - efficacy:332 (deriveLifecycleStatus)
  - pipeline-loops:150
  - live-console:122 and :884
  - render-session:80
  - observer-sweep:147 (lifecycle) and :326 (lane)
  - observer-shadow-log:83
  - ticket-close-closer:88
- 3 comment-only lines in `lib/observer-sweep.js` (:62, :106, :124).

**No leftover copy:**
- The only `WAITING_WAKE_MARKERS = new Set` is in dispatch-terminal.js. Both private copies and the digest-feedback.js export are deleted.
- No production importer of the old digest-feedback export remains. The only importers of the set are the LIN-3258 pin and the new test, and both import from dispatch-terminal.js.
- All 7 inline checks now call `isWaitingWakeMarker`:
  - run-view:232
  - task-page-loader:175
  - dispatch-terminal:258
  - unanswered-decisions:71
  - observer-sweep:98
  - efficacy:290
  - dispatch-wake:343
- `BLOCKED_MARKER_RE` is gone.

**Wider sweep** (`case 'blocked'`, `"blocked"`, `.includes('blocked')`, `[blocked`): no other wake-marker decider. `chat-tools.js:1165` `.includes('blocked')` reads lane values, so it is not a copy.

## 2. Seams (`seams.mjs`, working-tree script = d349e78c; scripts/code-shape identical d349e78c..ee9fcba9)

- **Knots:** 18 pairs and 1 group of 9 → **18 pairs and 1 group of 9**.
  - The `knots` object is byte-identical, and so is the 62-row `links` table.
  - No pair changed and there is no new knot.
- **Only delta:** Runs & dispatch `internalImports` 125 → 126. That is the new same-area import observer-sweep → dispatch-terminal. entryFiles are unchanged.
- **areas.json:** unchanged.

## 3. Census (`dl1/census.mjs`)

| commit | groups | sites | crossAreaGroups |
|---|---|---|---|
| d349e78c | 310 | 1026 | 202 |
| f885f44c | 310 | 1026 | 202 |
| ee9fcba9 | **309** | **1022** | 201 |

- **`WAITING_WAKE_MARKERS` group:** G0040 at d349e78c and at f885f44c, 3 sites (digest-feedback:56, render-run-steps:159, dashboard:338). At new it **dissolves**. Only one definition is left, so there is no group; it did not shrink to a one-file group.
- **`[blocked]` text-contract group (G0010):** 15 → 14 sites. The site that went is efficacy:110 `BLOCKED_MARKER_RE`. The rest are emitters and docs.
- **by detector:** const 37/91 → 36/88, contract 25/135 → 25/134.

## 4. Replay (`dl2/replay`, old = f885f44c vs new = ee9fcba9, n=3000 + captured)

| run | inputs | diffs | missing | network | time |
|---|---|---|---|---|---|
| seed 1 | 51,046 | **0** | 0 | 0 | 7.1 s |
| seed 2 | 51,046 | **0** | 0 | 0 | 6.9 s |

- **Callers:** all 16 are the same on both seeds.
- **Coverage:** 100% for every touched function, including the new `isWaitingWakeMarker` (2/2) and `findFirstBlockedMarker` (6/6).

**Self-check** (`selfcheck/`, n=1000, old-a and old-b are two fresh pins of f885f44c), 43 s. **PASSED:**
- Identity on seeds 1 and 2: 0 diffs (19,046 inputs each).
- M1–M14: each caught on exactly the expected callers.
- M15 (new authority widened to `pending`): caught on 13 callers.
- E1 and E2 (equivalent mutants): 0 diffs.

**Extra mutant (mine):** new tree with `.toLowerCase()` removed from efficacy `findFirstBlockedMarker`. The replay shows 731 diffs, all on `computeIncumbentSignal`. So the generated inputs exercise the upper-case path.

**Divergence probe** (3,000 loops, seed 1): byte-identical old vs new, and identical to `divergence-probe-d349e78c.txt`. The consolidation fixed and added no composition divergence.

**Classification of differences:** there are none, so there is nothing to classify (no fix, no regression, no fuzz).

## 5. Diff

| scope | files | lines | of which code |
|---|---|---|---|
| production (lib, routes) | 12 | +73/−65 (net +8) | +24/−22 |
| tests | 4 | +73/−3 | |

- **Code vs comments:** the rest of the production lines are comments. The new authority docstring is the bulk of the growth.
- **Production files:** the 10 predicted files, plus `lib/render-session.js` and `lib/session-telemetry.js`. Those two are comment-only stale-text fixes ("blocked/pending" → `[blocked]`).
- **Function bodies:** nothing changed beyond routing to the predicate.
  - Every code delta is an import addition, a deletion of a set or regex, or `X === 'blocked'` / `SET.has(X)` becoming `isWaitingWakeMarker(X)`.
  - `findFirstBlockedMarker` swaps `/^\s*\[blocked\]/i.test` for `WAKE_FEEDBACK_REGEX.exec` plus `isWaitingWakeMarker(match[1].toLowerCase())`. That is what the ticket asked for, and it is equivalent: same leading-prefix contract, any case.
  - `deriveBlockedStatus` still returns the word `'blocked'`.
- **Ticket refs:** in lib/routes, LIN-1005 13→11, LIN-1025 4→3 and LIN-843 14→13.
  - The drop is only because duplicated parity blocks collapsed.
  - LIN-1005, LIN-1025, LIN-843, LIN-3008 and LIN-3258 all sit in the new docstring at `dispatch-terminal.js:65-83`. That docstring also adds LIN-3602 and a LIN-3339 pointer (the channel question is not decided here).
  - The efficacy reason "no exported first scan" moved into `findFirstBlockedMarker`'s docstring.
  - No reason was lost.
- **D9 stale pointers fixed:**
  - digest-feedback "Mirror any change" was deleted with the set.
  - render-run-steps "keep in parity" was deleted, and :187 now points at dispatch-terminal.
  - dashboard :333/:337 were deleted. The `[pending]`-counts claims at dashboard :301, :345, :368 and :820 were corrected; four places where the ticket named one.
  - observer-sweep :61-62 lost its `:273`/`:47` pointers and now names dispatch-terminal.js.
  - The observer-sweep allowlist comment now says "five → six" with its reason.
  - Remaining `[blocked]`/`[pending]` mentions are correct wake-vocabulary text.
- **Observer-sweep pinned import list** (`tests/unit/observer-sweep.test.js:1734`):
  - `./dispatch-terminal.js` was added, with the reason "pure (imports only ./utils/time.js)". Verified: dispatch-terminal.js imports only `./utils/time.js`.
  - The worker also corrected the stale unanswered-decisions reason in the same message. It now reads "imports ./loop-supersede.js and, since LIN-3364, ./dispatch-terminal.js".
- **LIN-3258 pin:** now imports from `../../lib/dispatch-terminal.js`.
- **New test** `tests/unit/waiting-wake-marker.test.js` (6 behaviour tests):
  - only `blocked` waits
  - every WAKE_FEEDBACK_REGEX marker is classified
  - null-safe
  - exact (no case-fold or trim)
  - the caller lower-cases a message capture
  - the set is the authority
- **Close-out `[BLOCKED]`/`[Blocked]` test** (`observer-efficacy-signal.test.js:193-219`, commit 77ecfb88):
  - It checks that `computeIncumbentSignal` measures an upper-case or mixed-case leading marker exactly like `[blocked]` (count 1, timeToRespondMs 150000, same row).
  - It is a **regression guard for the new call-site `.toLowerCase()`**. The old `/i` regex accepted any case, and the new exact predicate needs the caller to fold.
  - **It does not change behaviour.**
  - Witnessed: the test passes on old code (f885f44c with the new test file: 33/33). It passes on new (109/109 across 4 files). It goes red (2 failures) when `.toLowerCase()` is removed.
- **Replay:** not committed. There is no `experiments/` addition.

## 6. LIN-3339 comment (from commit messages)

Neither commit message, nor the squash body, mentions LIN-3339, "Open questions", D3/D5/D7, or a comment to post. The commit messages carry no LIN-3339 comment. The only LIN-3339 text in the change is the code docstring at `dispatch-terminal.js:79-81`. Whether the (d) write-ups and the LIN-3339 comment exist depends on the PR body, which is still to be read.

## 7. Prediction, line by line

| # | prediction | result |
|---|---|---|
| 1 | Home `lib/dispatch-terminal.js` | **hit** |
| 2 | Shape: exported set + `isWaitingWakeMarker`, exact `Set.has`, null-safe | **hit** |
| 3 | Callers use the predicate; wire still returns `'blocked'` | **hit** |
| 4 | LIN-3258 pin imports the set from the new home | **hit** |
| 5 | observer-sweep needs a same-area import + pinned-list update | **hit** |
| 6 | digest-feedback imports from dispatch-terminal (set moves down the graph) | **hit** |
| 7 | Knots 18 → 18, no new pair, group stays 9 | **hit** (knots and links byte-identical) |
| 8 | By hand: 10 deciders → 1; 2 set copies → 0; 7 inline → 0; all route to the authority | **hit** |
| 9 | R1, M1, M2, T1 stay as separate decisions | **hit** (code unchanged; T1 keeps `[pending]`) |
| 10 | Grep 23 → 14 = authority + 10 expected + 3 observer-sweep comment lines | **hit** (exact composition) |
| 11 | Census groups 310 → 309 | **hit** |
| 12 | Census sites 1026 → 1022 | **hit** |
| 13 | `WAITING_WAKE_MARKERS` constant group dissolves | **hit** |
| 14 | `[blocked]` contract group 15 → 14 (I6) | **hit** |
| 15 | Production net −10 to −25 lines | **miss**: +73/−65 = **+8** (code +24/−22; the comment docstring grew) |
| 16 | Tests +20 to +60 | **miss**: +73/−3 = **+70** (just over; the close-out guard added 28) |
| 17 | Deleted comment blocks keep reasons/tickets beside the authority | **hit** |
| 18 | Replay on the merge: 0 differences | **hit** (2 seeds × 51,046) |
| 19 | Self-check: identity 0, 14/14 mutants, M15 on 13 callers, 2/2 equivalent | **hit** (reproduced on f885f44c) |
| 20 | Coverage 100% of touched functions | **hit** |
| 21 | Consolidation neither fixes nor adds the probe divergences | **hit** (probe byte-identical) |
| 22 | Run times: replay ~7 s, self-check ~45 s, seams ~3 s | **hit** |
| 23 | D9-case: predicate stays exact (no lower-casing) | **hit** (and tested) |
| 24 | D3/D5/D7 keep today's behaviour | **hit** (replay 0) |
| 25 | D3/D5/D7 go to PR-body "Open questions" + one LIN-3339 comment; no DECISION/BLOCKED | **unverified here** (needs PR body; commit messages silent) |
| 26 | Drift row after: 1 authority, 0 set copies, 0 inline checks | **hit** (in code) |
| 27 | Seams stays 18 | **hit** |
| 28 | Worker effort ~1.5–3 h in one session | **miss**: ~35 min kickoff → merge (12 min to first commit) |

**Tally:** 24 hit, 3 miss (#15, #16, #28), 1 unverified (#25).

The preview fact "+30/−47 in 10 files" is not a PR prediction. The PR touched 12 production files; the 2 extras are comment-only.

## Surprises

- The worker fixed more stale `[pending]`-counts comments than the ticket listed: 6 extra lines in dashboard, render-session and session-telemetry. It also fixed a stale reason in the observer-sweep test assertion message, stale since LIN-3364.
- The close-out commit is a test-only guard for a case-fold the consolidation introduced at the efficacy call site. It is green on old, red on the mutant, and changes no behaviour.
- Production lines grew rather than shrank. The cause is the 18-line authority docstring that consolidates the reasons.
- Squash merge: the first parent is LIN-3600's `f885f44c`, as expected, and the tree equals the PR head.
