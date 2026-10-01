---
title: Pre-registration for replay-small-work (LIN-3189)
kind: pre-registration
date: 2026-10-01
authors: [Claude (LIN-3189)]
grounded_at: 26014544 (LinearViewer, the scorecard's head); 33667480 (simple-dispatcher)
---

# Pre-registration: replaying small finished tickets with a lean pipeline

Committed on its own, before any replay runs. Nothing below is changed after the first replay
starts. Anything decided later is marked as a deviation in the paper (`replay-small-work.md`).

## Question

For small changes, how does a lean pipeline compare with what Harbour's full process actually
shipped, in correctness and in cost? The lean pipeline is one implementer, one review and one
close-out.

## Selection (`scripts/survey-replay-select.mjs`)

**Population.** These are the throughput scorecard's changes (`data/survey/scorecard.json`, cut
30 September, heads above), in both repos. A change is eligible when all of these hold:

- it reached Done;
- its last merge falls between 1 August and 24 September. The cheap-tier implementer step was
  on 25 September;
- it is light under rule M3 of `proportional-process-backtest.md`, as
  `scripts/survey-proportional-classifiers.mjs` computes it unchanged. That means at most 49
  production lines in at most 3 files, and no auth, data-store, prompt or CI path, no path a
  CLAUDE.md invariant names, and no process text;
- it has at least one production line;
- it has exactly one first-parent commit on main, credited the way `survey-effort-git.mjs`
  credits them, so there is one parent to replay from.

That gives 75 eligible changes, 74 of them replayable.

**Escape stratum.** This is every replayable change that the scorecard marks escaped or
named-fixed, less some it removes on reading:

- finder rows;
- named fixes that `proportional-process-backtest-codes.json` reads as a mention or unclear;
- three September positives that backtest never read, read here against its rubric before
  selection (`READINGS` in the script). LIN-2563 is dropped as a finder row.

| Ticket | Repo | Known fault | Fix (tests to run, where they exist) |
|---|---|---|---|
| LIN-2123 | Harbour | the fix was a production no-op (marker regex keyed on a marker production never reaches) | LIN-2268, 99c604b4 |
| LIN-2252 | Harbour | the padding fix was inert: the FAB overlap was unchanged | LIN-2272, 740bded7 |
| LIN-2355 | Harbour | it left the proxy preamble and kickoff pointing at reads that 422 on non-Linear workspaces | LIN-2804, f66c82ec |
| LIN-2414 | runner | its lapsed-BLOCKED-hold re-park dropped an undelivered follow-up | LIN-2468, 2ef854b |
| LIN-2980 | Harbour | it made an unguarded `data.phase` dereference stream-aborting (LIN-2983) | none; LIN-2983 is still in Backlog, so this one is judged by reading |

**Clean stratum.** These are the other replayable changes, restricted to those where every
session the runner launched for them left a local transcript, so that whole-life tokens exist.
They are sampled systematically in last-merge order within each repo. The quota is six from
Harbour (pool 11) and two from the runner (pool 2, all of it).

| Ticket | Repo | Merge | Parent replayed from | Production / test lines |
|---|---|---|---|---|
| LIN-2123 | Harbour | 93c0e311 | 2ab2df76 | 44 / 51 |
| LIN-2252 | Harbour | 3a964f91 | 7fc7728b | 5 / 0 |
| LIN-2355 | Harbour | 48f6a9be | 181c3a3b | 17 / 137 |
| LIN-2414 | runner | 0b0732f9 | e554a9d2 | 44 / 98 |
| LIN-2980 | Harbour | 7404c881 | 6c1f8e72 | 18 / 187 |
| LIN-2406 | Harbour | 7ddc140d | 833762b4 | 19 / 32 |
| LIN-2400 | Harbour | ccc3b2c5 | 97bac32d | 27 / 78 |
| LIN-2702 | Harbour | fd10e3d6 | 7465b4a6 | 48 / 224 |
| LIN-2715 | Harbour | cda38e28 | 5feeefd0 | 13 / 268 |
| LIN-2981 | Harbour | 33f2f7b8 | 447c6ba3 | 31 / 53 |
| LIN-3013 | Harbour | 63da5387 | 2b77b0bd | 2 / 206 |
| LIN-2559 | runner | 10c2d1db | 9ebf8fe6 | 21 / 85 |
| LIN-2738 | runner | 055bc0a1 | 047dfc5c | 31 / 154 |

That is 13 tickets: 10 from Harbour and 3 from the runner, 5 with a known fault and 8 clean.

## Protocol (`scripts/survey-replay-prepare.mjs`)

- **Isolation.** Each ticket gets its own detached local worktree at the parent of its original
  commit, outside both repos. The worktrees are never pushed and are removed afterwards. Nothing
  leaves them except the paper's data. No PR, no comment on the source tickets, no dispatch
  through Harbour.
- **Roles.** All three are in-session subagents of this session, run at the mid tier. That is
  the tier the fleet used for implementation from 12 July to 24 September, the whole selection
  window. The original implementer's model is read from the transcripts where they exist, and
  any mismatch is reported. The fixed prompts are in the script.
  1. **Implementer.** It gets the ticket's title and description only, as the tracker holds
     them now. It implements the change, tests it and commits locally.
  2. **Reviewer.** It gets the ticket and the diff, may run unit tests, edits nothing, and ends
     with APPROVE or REQUEST CHANGES and its must-fix list.
  3. **Close-out.** It gets the ticket and the review, fixes any must-fix item, verifies, and
     ends with READY or NOT READY.
- **No other loop.** There is one review pass and no second round, whatever the verdicts.
- **Fences.** Every role is told not to:
  - look past HEAD in git;
  - read outside its worktree;
  - call any service;
  - run anything but unit tests by file;
  - spawn subagents.

  These are instructions, not enforcement. The objects for the future commits are in the
  shared object store.

## Comparison metrics (fixed now)

Per ticket, against what shipped:

1. **Same thing.** The author reads both diffs, knowing which is which, and codes the replay as
   *same*, *partial* or *different* behaviour.
2. **Shipped tests.** Check out the original change's test files, at the original commit, onto
   the final replay tree and run them by file (unit tests only). Record pass and fail per file.
   The same run on the original commit is the baseline. A failure is coded *interface* when the
   test calls a name or signature the replay did not create, and *behaviour* otherwise.
   Playwright and visual specs are not run.
3. **Known fault (escape stratum).**
   - Where the fix has unit tests, run the fix commit's test files on the final replay tree,
     with the same baseline on the original commit, which should fail them.
   - Code the replay as one of: *same fault*, *avoided* (never introduced), *caught by its
     review*, or *not applicable*.
   - LIN-2980's fault and the UI faults are coded by reading.
4. **Blind judgement.** A fresh subagent at the frontier tier, which plays no lean role, sees
   the ticket and two unlabelled diffs against the same parent: production and tests, no commit
   messages. The original is A when the ticket number is odd and B when it is even. It ends
   with A BETTER, EQUIVALENT or B BETTER, mapped to the replay being *better*, *equivalent* or
   *worse*.
5. **Correctness verdict, for the headline chart.** This is the blind judgement, overridden to
   *worse* when a shipped test fails on behaviour, or when the replay ships the known fault
   that its own review missed.
6. **Cost.**
   - **Lean cost.** Each role's tokens, turns and wall-clock come from its subagent transcript
     (`~/.claude/projects`), tagged `[replay LIN-n role]`. Tokens are weighted as
     `survey-costmix-tokens.mjs` weights them: frontier-input equivalents, with the mid tier at
     0.6. The blind reader is measurement and is not counted.
   - **Original whole-life cost.** This is the scorecard's measure:
     - dispatches and working hours, from `scorecard.json`;
     - weighted tokens, from `survey-costmix-tokens.mjs`, charged both ways: by the session
       entered, and by the child the log names.
   - **Ratios.** The headline ratio is lean ÷ original, in weighted tokens charged by session
     entered. The ratio under the child-named rule is also given. An hours ratio (replay
     wall-clock ÷ original working hours) is given for all 13 tickets. That covers the four
     escape tickets from August, which have no transcripts.

## Predictions, recorded before running

- The lean pipeline costs between a tenth and a half of the original in weighted tokens, at
  the median ticket. `cost-mix.md` puts about half of a small change's cost in fixed process.
- At least 9 of the 13 replays are equivalent or better.
- Of the four known faults that can be tested or read as code faults, the replay reproduces at
  most two. LIN-2252's is CSS, judged by reading.

## Biases declared in advance

- **Hindsight.** The replay reads the description as finally written. This favours the replay.
- **Not the fleet's harness.** In-session subagents do not run under the fleet's harness: no
  Stop hook, no worker prompt from the meta-prompt, and a different system prompt. The
  direction is unknown.
- **Small sample.** There are 13 tickets, and 5 with known faults. The intervals will be wide.
- **The clean stratum's selection.** Requiring transcripts pulls the clean stratum into
  September.
