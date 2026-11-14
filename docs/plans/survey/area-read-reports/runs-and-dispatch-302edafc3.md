## Area read: Runs & dispatch @ 302edafc3

**Role:** Runs & dispatch, the area the work changes. This is the after-read for LIN-4462, the repeat of piece 0 after the last piece of LIN-4447. Both areas were read in one window, with the frozen kit, and the kit was not changed. The baseline is [runs-and-dispatch-4b5001ddf.md](runs-and-dispatch-4b5001ddf.md). The comparison is [comparison-302edafc3-vs-4b5001ddf.md](comparison-302edafc3-vs-4b5001ddf.md).

**Recorded fields**
- Base commit: `302edafc3a27a8d0d64a88435766625ab8d24cb5` (`origin/main`, short `302edafc3`, the last LinearViewer change of piece 8). Nothing had landed on main after it when the readers ran.
- `docs/areas/areas.json` blob: `a4f33893e57fd7e936b05879f515c1edd4115078` (at baseline `d13fca20e50c37e859e82fbc820177acefd4e48d`). It moved, but the sampled paths did not.
- Kit `docs/plans/survey/area-read.md` blob: `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`, checked with `git rev-parse 302edafc3:<path>` before any reader ran. It is the same blob as at baseline.
- Reader prompt `docs/plans/survey/area-read-reader-prompt.md` blob: `ef1c2ca9173831f53ca32b60da1d805d27bf2159`, checked the same way. It is the same blob as at baseline.
- Method: [area-read-method-as-run.md](../area-read-method-as-run.md) section 8, repeated: the same bundle shape and the one added inputs line.
- N = 14 per area, by the kit's stable SHA-256 path-hash rule. The kit's snippet, copied to a file and diffed against the kit (identical), reproduces this list at the base commit.
- Date: 2026-11-14
- Note: `docs/areas/runs-and-dispatch.md`, blob `46309d644b80d1508a85bd28fa301864d29d8239`, 18,045 bytes (11,540 at baseline). Lessons 6,019 bytes by the guard's `lessonsBytes` (4,268 at baseline, same method), of the 6,144 cap. 21 Waiting entries (20 at baseline).
- Universe: 121 files by first match, code scope (115 at baseline). Since baseline, 29 files changed in place and 6 are new: `lib/cost-read-calls.js`, `lib/dispatch-feedback-kinds.js`, `lib/item-stage-stamp.js`, `lib/run-live-wait.js`, `lib/run-trail.js` and `lib/usage-snapshot-intake.js`. None was removed.
- Reader bundle: the note plus the 14 sampled files, 214,884 bytes, built from the git object store at `302edafc3`. The builder reproduces the baseline bundle byte-for-byte at `4b5001ddf` (211,623 bytes).
- Readers: two fresh general-purpose agents, no model override. Every transcript records the model `claude-opus-5-5`. The baseline readers "inherited the operator's model", which was not recorded, so whether the two reads used the same model cannot be checked.

**Sample (exact file list, at the base commit)**

The same 14 paths as the baseline, so the paired set is the full sample (14 of 14). Three blobs changed.

| Bytes | Path | Blob | Since `4b5001ddf` |
| --: | -- | -- | -- |
| 21,859 | `lib/observation-sessions-materializer.js` | `c384ef8d9` | unchanged |
| 3,060 | `lib/consumer-heartbeat-store.js` | `37424df3e` | unchanged |
| 20,397 | `lib/observation-sessions-store.js` | `45c20089e` | unchanged |
| 1,681 | `routes/runner-kit.js` | `60e627b9d` | unchanged |
| 1,550 | `lib/request-usage-vocabulary.js` | `ab9e78771` | unchanged |
| 15,711 | `lib/transcript-spend.js` | `523c6417a` | unchanged |
| 7,990 | `lib/wake-shadow.js` | `08ab86b70` | unchanged |
| 10,879 | `lib/agent-status-store.js` | `b389c58bd` | unchanged |
| 30,540 | `lib/digest-feedback.js` | `92904e855` | changed (was `6706a4f65`) |
| 8,605 | `lib/session-summary.js` | `fa4d59276` | unchanged |
| 5,048 | `lib/queue-config.js` | `cdbfbbb67` | unchanged |
| 14,165 | `lib/request-usage-store.js` | `94143a01d` | unchanged |
| 42,921 | `lib/cost-read.js` | `169e2d85f` | changed (was `10f9482ad`) |
| 11,902 | `lib/wall-clock-summary.js` | `2523c187e` | changed (was `92352d0c8`) |

Sample total: 14 files, 196,308 bytes (199,552 at baseline).

**Flags recorded before any reader ran** (LIN-4462 comment `7305f073`)
1. **Thin coverage.** 3 of the 14 sampled files changed: `lib/cost-read.js`, `lib/digest-feedback.js` and `lib/wall-clock-summary.js`. 35 of the area's 121 files differ from baseline (29 changed, 6 new). The survey on LIN-4462 counted 34; this report's count is by blob. None of the six new files ranks in the first 14, so the read sees none of the new homes. 1 of the 13 planned Runs files is sampled (`lib/cost-read.js`), as the kit's Known limits 1 says.
2. **K2 leans on the work.** K2's frozen examples ("when a task may close out, which pull requests belong to a task, or which model a dispatch used") are the rules LIN-4460, LIN-4458 and LIN-4454 consolidated. A K2 rise is partly the rubric asking about the fixed rules. The rubric is not edited.
3. **The note grew.** 11,540 → 18,045 bytes, Lessons 4,268 → 6,019 bytes, Waiting 20 → 21. The kit's Known limits 3 expected the note to shrink. It grew. The note is scored apart from the code (verdict 3).
4. **Reader conditions.** Both readers used Bash on their own inputs file (`wc -l`, `grep` and `sed -n`, nothing else), where the baseline readers used Read only. Tools were unrestricted at both reads, and method section 8 does not restrict them. The readers ran from a working directory outside the repository, so no repository `CLAUDE.md` reached them.

**Reader passes** (two independent fresh agents, launched in one batch with the two control passes. Each output below is verbatim.)

Pass A (agent `a015db5849fdd0a6b`):

```
Code
- K1: 4. Most file names and opening comments say what each file owns, such as the one cost read, the read-model store, the wake shadow and the request-usage collection, but `queue-config`, `session-summary`, `transcript-spend` and `digest-feedback` are hard to place under "runs & dispatch" from their names alone. Cites `lib/cost-read.js`, `lib/digest-feedback.js`.
- K2: 3. `cost-read.js` names the one place each decision lives (`lineageUsageOf`, `postingKeysOf`, the model "carried, not derived"), yet the figure rule is computed again in `summarizeReadCost`, `lineageFigure` and `lineageFigureOf`. Also, the CI regex is declared twice: `VERIFY_BASH` claims to be "kept in lockstep" with `CI_TEST_SIGNATURE`, but the two patterns on the page are different. Cites `lib/cost-read.js`, `lib/transcript-spend.js`.
- K3: 3. Most functions carry long, careful comments, but understanding them means decoding plan and ticket labels ("narrow rule N1", "plan decision (ii)", "replay S10", "W1", "C3", "R4"). The doc comment for `_findDecisionWithdrawal` also sits above `_findReversedDecisionIds`, so that pair misleads on a local read. Cites `lib/cost-read.js`, `lib/digest-feedback.js`.
- K4: 3. Function names describe what the functions do, but one unit of work goes by many names across files: step, loop, lineage, session, run, dispatch, and `workerSessions` rows that are really lineages. `anchor`/`rootItemId` are used interchangeably, and comments lean on ticket IDs more than on stated reasons. Cites `lib/wall-clock-summary.js`, `lib/cost-read.js`.
- Code mean: 3.3

Note
- M1: 3. Most lessons name a function and file and give an instruction with a ticket. Several are compressed past easy action: "Six fields were once dropped on one hop of four", "the walks go up, a parked stage's ending is below it", "stands the gate aside", and "Price a pulled extra like any piece", which gives a precedent but no reason.
- M2: 4. Nearly every entry names its file, describes the gap and says why it waits ("larger than a fix", "a product call", John's 13 Nov ruling). The exceptions: the `lib/wake-shadow.js` entry states neither the gap nor why it waits, the first `lib/run-live-wait.js` entry gives no reason it waits, and the `lib/run-paragraph-hook.js` entry reads as already "answered in LIN-4475".
- Note mean: 3.5

Where I could not tell:
- Whether the note's lessons are accurate. Most of them refer to files that were not provided: `lib/dispatch-store.js`, `lib/run-trail.js`, `lib/run-closeout-state.js`, `lib/dispatch-fields.js`, `lib/dispatch-wake.js`, `lib/recent-runs.js`, `lib/cost-read-calls.js`, `lib/dispatch-terminal.js`, `lib/dispatch-feedback-kinds.js`.
- Whether the test said to assert `VERIFY_BASH` equal to wall-clock's pattern really does so, given the two regexes differ on the page.
- Whether `BUCKET_OF_KIND` really covers every `DISPATCH_KINDS`/`ROW_ONLY_KINDS` member (those lists were not provided).
- What the line reference `lib/digest-feedback.js:290-294` in `lib/observation-sessions-store.js` points to, since it does not match this file's layout.
```

Pass B (agent `aa55222ef8743b28a`):

```
Code
- K1: 4. Most file names and opening comments say what each file owns (`cost-read.js` says "the one cost read", `wake-shadow.js` says it holds only the shadow's storage), but some behaviour sits where the name doesn't lead you: `digest-feedback.js` holds the decision answer, withdrawal and settled checks, and `queue-config.js`, `transcript-spend.js` and `session-summary.js` don't read as runs-and-dispatch files. Cites: lib/digest-feedback.js, lib/cost-read.js.
- K2: 3. `cost-read.js` names its single owners (`lineageUsageOf`, `postingKeysOf`) and says which decisions belong to other files, but some rules are still written out more than once: the figure rule appears in `lineageFigure`, `lineageFigureOf` and `summarizeReadCost`, the `requestRows` refusal appears twice, and `transcript-spend.js` redeclares `VERIFY_BASH` "in lockstep" with `wall-clock-summary.js`'s `CI_TEST_SIGNATURE`, though the two patterns visibly differ. Cites: lib/cost-read.js, lib/transcript-spend.js.
- K3: 3. The functions have heavy comments, but a typical `cost-read.js` function rests on helpers from other files (`countedRowsOf`, `foldRequestUsage`, `byDispatchOrder`) and on labels these files never explain (plan N1, replay S10, review note 9, D6/D7), so you have to read slowly and still take some of it on trust. Cites: lib/cost-read.js, lib/observation-sessions-materializer.js.
- K4: 3. Names are mostly descriptive, but some words carry more than one meaning. "records" means request records in `readCostOverRecords` and lineage records in `summarizeReadCost`. "session" means an autopilot session, a cost lineage (`workerSessions`) and a Claude Code transcript in different files. `_findReversedDecisionIds` carries the doc comment written for `_findDecisionWithdrawal`. Some comments are out of date: `wall-clock-summary.js` says worker token/cost "is emitted nowhere today". Cites: lib/cost-read.js, lib/digest-feedback.js.
- Code mean: 3.3

Note
- M1: 3. Most lessons name a file, a function and what goes wrong, so they can be acted on, but they are packed with ticket numbers and shorthand, and a few are too short to act on without background ("Price a pulled extra like any piece", "When a person acts, Harbour follows").
- M2: 4. Nearly every entry names its file, what is waiting and why it isn't scheduled (larger than a fix, a product call, or a ruling from John), but some entries run long and are hard to follow, the `wake-shadow.js` entry gives no reason beyond "Survey tally", and the `run-paragraph-hook.js` entry reads as already answered rather than waiting.
- Note mean: 3.5

Where I could not tell:
- Most of the files the note's lessons point to were not provided (`dispatch-store.js`, `run-trail.js`, `run-closeout-state.js`, `dispatch-wake.js`, `cost-read-calls.js`, `dispatch-feedback-kinds.js`, `pipeline-loops.js`), so I could not check whether those lessons match the code.
- Whether a test really pins `VERIFY_BASH` and `CI_TEST_SIGNATURE` equal, given that they differ on the page.
- Whether `cost-read-calls.js` restates the figure rule, as the note says.
```

**Scores, recomputed from the criteria**

| Pass | K1 | K2 | K3 | K4 | Code mean (raw) | Code (reported) | M1 | M2 | Note mean |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| A | 4 | 3 | 3 | 3 | 3.25 | 3.3 | 3 | 4 | 3.5 |
| B | 4 | 3 | 3 | 3 | 3.25 | 3.3 | 3 | 4 | 3.5 |

Each reader's reported one-decimal means match its own criteria: 3.25 rounds to 3.3, and (3 + 4) ÷ 2 = 3.5.

**Combined after-read** (the method addendum's convention: the mean of the two passes' one-decimal means)
- Code means: pass A 3.3, pass B 3.3. Combined **3.30** (from the raw criteria, 3.25).
- Note means: pass A 3.5, pass B 3.5. Combined **3.50**.
- Noise guard (code means differ by 1.0 or more): |A − B| = 0.0, so the guard did not fire and the read is decided.
- Code movement and note movement against the baseline are reported separately, in the comparison.

**Contamination check** (method section 5, run before scoring)

| Pass | Tool calls | Tools used | Paths touched | Inside own inputs? |
| --- | --: | --- | --- | --- |
| A | 12 | Read 9, Bash 3 | the Runs `inputs.md` only (Bash: `wc -l`, `grep -n '^#'`, then `sed -n 1,140p` with a header `grep`, issued twice) | yes |
| B | 12 | Read 10, Bash 2 | the Runs `inputs.md` only (Bash: `wc -l` with `grep -n '^#'`, then `grep -n '^=== '`) | yes |

- Each reader's first user message is the reader prompt with the one inputs line. It names no repository path and no ticket identifier.
- No reader used Grep, Glob, git, a web tool, or any file but its own inputs. The one ticket identifier in an output (LIN-4475, pass A) is in the bundle, in the note. No output mentions a baseline, a commit, the other area or the work.
- The Bash calls are a deviation from the baseline's Read-only use. They are the same kind LIN-4463's after-read recorded and counted. Both passes are counted.

**Limits carried from the kit:** the sample holds 1 of the 13 planned Runs files (`lib/cost-read.js`), so the read measures the area at large. Most of LIN-4447's move lies outside Runs (Known limits 2), and this report does not claim that duplicate rules outside Runs are gone. Readers had the note and the 14 files only, supplied as one bundle file with the note first and each file headed by its path.
