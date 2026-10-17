TITLE: One authority for "which wake marker means waiting on a person": move WAITING_WAKE_MARKERS to dispatch-terminal.js and retire the copies

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Harbour decides in one place which wake marker means a run is paused waiting on a person. Every caller reaches that authority, and the copies that lose are deleted.

**Why.**

*Source.* This serves LIN-3339 ("One job, many paths: check the paper's candidates, then consolidate the ones that hold up"), candidate 2, "waiting for a person". The Drift & Coherence Review of 12 October (LIN-3516) re-checked that candidate and found it holds (`docs/reviews/drift-coherence-review-2026-10-12.md:140-155`, ledger row `human-wait-derivation-split` at `:517`). It also records that LIN-3339 was updated (`:155`, `:375`) and that LIN-3504 added a new inline copy in `lib/task-page-loader.js` (`:150`).

The review held the candidate back until the channel question is ruled (`:154-155`). This PR doesn't need that ruling: it changes where the marker set lives, not who counts as waiting. The channel question stays with LIN-3339. This PR does only the marker-set part of the candidate and does not close LIN-3339.

*Line numbers.* The review cites `task-page-loader.js:148` and `pipeline-loops.js:312`; the current lines are `:175` and `:150`. Trust this ticket's line numbers over the review's. They were checked at `d349e78c` and re-checked at `f885f44c` (LIN-3600 touched none of these files).

*The sites.*
* **Authority today:** `export const WAITING_WAKE_MARKERS = new Set(['blocked'])` at `lib/digest-feedback.js:56`, used at `:346`.
* **Two private copies, each with a parity comment:**
  * `lib/render-run-steps.js:159`, used at `:198` (comment `:155-158`);
  * `routes/dashboard.js:338`, used at `:362` (comment `:333-337`).
* **Seven inline checks of the same set:**
  * `lib/run-view.js:232` (`wake.marker !== 'blocked'`);
  * `lib/task-page-loader.js:175`;
  * `lib/dispatch-terminal.js:225`;
  * `lib/unanswered-decisions.js:71`;
  * `lib/observer-sweep.js:97`;
  * `lib/observer-efficacy-signal.js:110` (a private `/^\s*\[blocked\]/i`, used at `:295`);
  * `lib/dispatch-wake.js:343`.

  The last two are not in the review's list.
* **Nearby decisions that stay separate:**
  * `lib/recent-runs.js:39` reads the wire status that `dispatch-terminal.js:225` produces;
  * `lib/pipeline-loops.js:150` maps the agent-status word `blocked` to `agentState: 'waiting'`;
  * `lib/live-console.js:122` maps `blocked`, `pending` and `waiting` to the console kind `blocked`;
  * `lib/render-session.js:80` highlights `[blocked]` **and `[pending]`** transcript entries as "paused on human input" (`:76-79`).

Changing who counts as waiting today means editing 10 places across 3 areas.

*The divergences.* Every copy agrees on the set (`{'blocked'}`). The copies differ in what surrounds the set. A starting list, to verify:
* D1. **Channel.** The banner (`routes/dashboard.js:356`) and the census lane (`lib/observer-sweep.js:97`) also count agent-status `blocked`. The run flag (`lib/render-run-steps.js:191-199`), the waiting clock (`lib/run-view.js:226-243`), the disposition and the wire read the marker only.
* D2. **What ends a wait.** History cancelled/expired becomes `agentState` complete/error at `lib/pipeline-loops.js:146-147`. The banner reads that, and treats agent-status completed/failed as ended too (`routes/dashboard.js:226,244`). The lane treats cancelled/expired as `resolved` (`lib/observer-sweep.js:106-108`). The flag, clock and wire read the feedback terminal markers and the closed-row stamp (`lib/render-run-steps.js:193`, `lib/run-view.js:229`, `lib/dispatch-terminal.js:256`). The flag and clock also skip superseded runs. `lib/observer-sweep.js:102-105` says such a row can still carry a stale `blocked`.
* D3. **Resume marker.** Only the wire clears `blocked` on `[working] Session resumed.` (`lib/dispatch-terminal.js:110,223`; LIN-2123/LIN-2268). Its comment says the marker is consumed only there (`:101-108`).
* D4. **Decision stamps.** The clock skips `decision-*` stamps (`lib/run-view.js:126-131,150`); `findWakeEvent` does not. Stamp messages are JSON (`lib/dispatch-store.js:2770-2772,2844-2846`), so this looks unreachable in production.
* D5. **`[pending]` in the transcript highlight** (`lib/render-session.js:80`). LIN-1025 excludes it everywhere else (`lib/render-run-steps.js:156-158`, `routes/dashboard.js:335-337`).
* D6. **Agent-status vocabulary.** `lib/pipeline-loops.js:150` matches `'blocked'` exactly. The console folds case and also counts `pending` and `waiting` (`lib/live-console.js:119-122`).
* D7. **Closed rows.** `resolveDisposition` checks `[blocked]` (`lib/unanswered-decisions.js:71`) before the closed-row check (`:74`). Every waiting reader excludes closed rows (`lib/render-run-steps.js:193`, `lib/run-view.js:229`, `routes/dashboard.js:244`, `lib/dispatch-terminal.js:256`).
* D8. **Answered out of band.** Only the lane clears `blocked` when the decision was answered out of band (comment `lib/observer-sweep.js:69-76`, code `:143-155`).
* D9. **Stale comments:**
  * `lib/digest-feedback.js:50-55` (the LIN-3008 history and "Mirror any change here in routes/dashboard.js"), which moves with the set;
  * `lib/render-run-steps.js:155-156,187`;
  * `routes/dashboard.js:333,337` and `:345` (says `[pending]` counts);
  * `lib/observer-sweep.js:60,62` (cites `routes/dashboard.js:273` and `lib/pipeline-loops.js:47`).

**Decision.**
* **Home and shape (direction; verify it).**
  * Put the set and a predicate in `lib/dispatch-terminal.js`: `export const WAITING_WAKE_MARKERS` and `export function isWaitingWakeMarker(marker)`. The predicate is an exact, null-safe `Set.has`; don't lower-case inside it.
  * That file owns the wake-marker vocabulary (`WAKE_FEEDBACK_REGEX` `:63`, `findWakeEvent` `:503`, `deriveBlockedStatus` `:219`). It imports only `./utils/time.js` (`:27`). Every caller module except `lib/observer-sweep.js` already imports it.
  * The area that would change if the rule changed is "Runs & dispatch" (`scripts/code-shape/areas.json`, as read by `scripts/code-shape/seams.mjs`). If you find a better home by that rule, say why in the PR.
* **Route every caller to it, and delete the losing copies.**
  * Delete the set in `lib/digest-feedback.js` (import from the new home instead) and both private copies.
  * Replace each inline check with the predicate. Where a site tests a message rather than a marker (`lib/observer-efficacy-signal.js:110,295`, and `lib/dispatch-terminal.js:225`), use `WAKE_FEEDBACK_REGEX.exec(message)` and then `isWaitingWakeMarker(match[1].toLowerCase())`.
  * The wire still returns the word `'blocked'`.
  * Treat the site list above as a starting point to verify, not to trust. Deleting the losing sites is part of done.
* **Check that the copies are gone.** Run:

  ```
  git grep -nE -e "WAITING_WAKE_MARKERS = new Set" -e "[=!]== ?'blocked'" -e '\\\[blocked\\\]' -e '\[\(blocked' -- lib routes server.js public
  ```

  It gives 23 hits at `f885f44c`. Afterwards the only set definition should be in `lib/dispatch-terminal.js`. These hits are expected to remain: each is a separately named decision, or reads a lane or wire value.

  | Site | Why it stays |
  |---|---|
  | `lib/recent-runs.js` (`status === 'blocked'`) | reads the wire status |
  | `lib/observer-efficacy-signal.js` (`deriveLifecycleStatus(feedback) !== 'blocked'`) | reads the wire status |
  | `lib/pipeline-loops.js:150` | agent-status mapping |
  | `lib/live-console.js:122` | console kind |
  | `lib/live-console.js:884` | console kind |
  | `lib/render-session.js:80` | pause highlight |
  | `lib/observer-sweep.js` (`lifecycle === 'blocked'`) | lane value |
  | `lib/observer-sweep.js` (`lane === 'blocked'`) | lane value |
  | `lib/observer-shadow-log.js:83` | lane value |
  | `lib/ticket-close-closer.js:88` | lane value |

  Comment-only lines in `lib/observer-sweep.js` may remain. Any other hit means a copy was missed. `scripts/` and the runner-kit emitters are out of scope.
* **Classify each divergence.** This covers D3–D5, D7–D9 and any others you find. Mark D1, D2 and D6 *out of scope, stays with LIN-3339*, and raise nothing for them. For the rest use one of:
  * (a) one copy is a bug: fix it here, with a test. Fix only a bug that involves no product choice; the stale comments in D9 are the expected case. If a fix would change who counts as waiting on any page or in any feed (for example D5 or D7), it is (d).
  * (b) deliberate local variation: keep it as a named parameter or a separately named decision, with its reason beside it.
  * (c) bounded fuzz: unreachable or harmless, so say why and leave it.
  * (d) unclear: keep today's behaviour. Write it up in the PR body under **Open questions**: the question, the options and your recommendation. Post the same text as one comment on LIN-3339. Don't end the run BLOCKED and don't emit a `DECISION:` line for a (d). None of them needs a ruling before merge.
* **Tests.**
  * Add a behaviour test for the predicate.
  * Keep the LIN-3258 pin (`tests/unit/liveness-contract-and-capability.test.js:21,47-50`), importing the set from its new home.
  * Add `./dispatch-terminal.js` to the pinned import list in `tests/unit/observer-sweep.test.js:1734`. In the assertion message (`:1735-1737`) give its reason: pure, imports only `./utils/time.js`. Also update the comment at `lib/observer-sweep.js:113-115`, which says the allowlist went from four to five; it goes to six. `tests/unit/observer-efficacy-signal.test.js:717` already allows `./dispatch-terminal.js`.
  * You may convert a source-text test that pins a site into a behaviour test. Show each converted test failing with its guard removed.
* **Comments.** Keep every ticket reference and reason comment beside the code it governs (LIN-1005, LIN-1025, LIN-843, LIN-3008, LIN-3258 move with the set). Correct the stale pointers in D9 rather than copying them.
* No edits to `scripts/code-shape/areas.json`.
* **Your own replay.** Replay each of these callers' exported output, old code against new: `deriveLoopFacingFacts`, `renderStepFace`, `deriveSessionWaiting`, `buildRunView`, `sessionMessage`, `deriveBlockedStatus`, `deriveLifecycleStatus`, `deriveWireStatus`, `resolveDisposition`, `classifyLoop`, `recentRuns`, `computeIncumbentSignal`, `classifyWake`.
  * Use about 1,000 seeded inputs and one seed, covering every marker value in the repo, case variants and unknown markers.
  * Freeze the clock and set TZ=UTC.
  * Report differences per caller. Expect none; explain any you see by its divergence class.
  * Keep the replay out of `tests/unit` and out of the PR, or put it under `experiments/` if you commit it. Paste its output in the PR.
* **Seams.** After committing, run `node scripts/code-shape/seams.mjs . origin/main` (the origin/main you branched from) and `node scripts/code-shape/seams.mjs . HEAD`, and paste the knot count for each.
  * At `f885f44c` there are 18 pairs and one group of 9. There were 20 at `d349e78c`; LIN-3600 removed two.
  * Compare HEAD against your base, not against a number in this ticket. A new pair, or a larger group, is not acceptable.
  * The *Providers ↔ Runs & dispatch* knot is gone, so add no import from a Providers-area file into a Runs & dispatch file.
* Report the sites before and after by hand, with the grep above. The reviewer re-runs the census after merge.
* No live checks; no paid model calls.
* Don't start parallel forks or background sub-agents; do the parts one at a time. While iterating, run the unit tests for the files you change; run the full unit suite once before opening the PR. Leave e2e to CI; run it locally only to reproduce a CI failure.

**This is one PR. Don't split it into child tickets.**

**Done when.** Merged with `ci-success` green. The PR shows:
* the sites before and after, with the grep output;
* each divergence with its class, and for each (d) the link to its LIN-3339 comment;
* the replay result per caller;
* seams before and after, with no new knot.

**Out of scope.**
* The channel question: whether agent-status or history status starts or ends a wait (D1, D2, D6). It stays with LIN-3339.
* Closing LIN-3339.
* The review's other decisions: the decision-stamp classifier copies and the provider write-field contract.
