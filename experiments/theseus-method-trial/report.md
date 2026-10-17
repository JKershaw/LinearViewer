# Theseus method trial: simple-dispatcher, one loop up to the ticket (read-only)

- **Operator:** Claude, an in-session subagent with no prior exposure to the method, working from the essay alone. 2026-10-17. Saved to this file by the main session, because the harness refused report files from the subagent. The text is the subagent's, except that three mentions of simple-dispatcher's CLAUDE.md now say "SD's contributor notes", so this repository's citation checker does not read them as claims about LinearViewer's CLAUDE.md, and the scratchpad paths are now relative.
- **Essay:** `docs/papers/harbour/theseus-method.md`, version 1 draft (branch commit `13a98ba4`), before the fresh reader's corrections.
- **Codebase:** `JKershaw/simple-dispatcher` at `0d54b97` (main, committed 2026-10-12), with a clean working tree.

**What I read.**
- The essay, and two of its figures (the replay; when copies disagree).
- simple-dispatcher's CLAUDE.md and five docs: module-map, substrate, session-lifecycle, testing-and-ci and deployment.
- The source and tests that the measurements pointed me to.
- In LinearViewer I opened exactly one file: the named example instrument `experiments/rebuild-exp1/kit/shape.mjs@509ed3fc` (see B7). I read nothing else from LinearViewer or the operator's scratchpad.

**What I ran.**
- The instruments below, all of which read committed git objects.
- simple-dispatcher's unit suite, three times, on a `git archive` export. A preload traced file reads and refused any non-loopback socket or DNS lookup; it recorded 0 escapes.
- Nothing touched the network. I made no paid calls, changed neither repository and filed nothing.

**Abbreviations.** SD is simple-dispatcher. DP is decision points: the essay's count of `if`, loop, `&&`, `case` and so on, meaning cyclomatic complexity less one. The scripts named here are in this folder; the suite logs, the export and the probe texts were not committed (they are copies of SD or multi-megabyte logs).

---

## Part A: the work

### A1. The instruments: what I built and how I approximated

| Instrument | Script | How it was built; approximations | Runtime |
| --- | --- | --- | --- |
| Area map | `areas.json` | 18 areas: 14 for production code, plus e2e, test, experiments and ops. SD has no directories: all 38 production `.js` files sit at the root, so the map is one hand-made row per file. I wrote it from `docs/module-map.md` and each file's header comment *before* running the import map, then froze it. The catch-all `other` holds `format.js` and `net-util.js`. | n/a |
| Import map and knots | `imports.mjs` | acorn parses `git show <commit>:<path>`. An edge is one `require('./x')` or import call site, at top level or lazy inside a function. Output: an area matrix, knots (area pairs with imports both ways), tangled groups (strongly connected components of the area graph) and file-level cycles. | 1.9 s |
| Shape | `shape.mjs` | Definitions are in the script header. DP counts `if`, `?:`, the five loop forms, non-default `case`, `catch`, `&&`/`\|\|`/`??` and `&&=`/`\|\|=`/`??=`. It does not count `?.` or default parameters. Each decision belongs to its innermost function, and top-level code counts as a pseudo-function. A code line is any line holding a token. | 0.4 s |
| Census of copies | `census.mjs` | Six parser-based detectors: `cmp` (one subject compared with a string literal, including `case`); `set` (a set of two or more string literals, as an array, a `Set`, or an `\|\|` chain on one subject); `const` (numbers of 1000 or more, after folding literal arithmetic, that are bound to a name; plus regex literals); `record` (object literals with four or more keys and the same key set); `clone` (type-2 clones of functions of 40+ AST nodes and `if` statements of 30+ nodes); and `marker` (bracket heads and sentinel words in strings, templates and regexes). Groups are ranked by places × change. | 0.6 s |
| Targeted count for the chosen decision | `heads.mjs` | Applies the ticket's counting rule with the parser. A `git grep` gives the same answer (43 lines holding 44 sites). | 0.5 s |
| *Extra:* session-field census | `fields.mjs` | A rough count of `sessions.json` fields per area, matched through identifiers named `session`, `s` and similar. | 0.5 s |
| *Extra:* read trace, move probe, perturbation probe | `trace.cjs`, `probe-texts.mjs`, `guard-replica.cjs` | A preload that logs fs text reads. Reads made by the module loader are filtered out by stack (see B8). Probe variants are served only to tests that read source as text; `require()` still loads the real code. | 28 s per suite run |
| *Extra:* mutation-anchor map | `anchors.cjs` | Finds where each of the 52 exact-substring anchors in `test/system/mutation/run-mutations.js` lands. | <1 s |

Not built: the verbatim share (there is no rebuild in this loop) and the replay kit (designed in A8, as the brief asked).

**Approximations to keep in mind.**
- **"Change"** counts non-merge commits that touched a file in the 90 days ending at the measured commit's own date (2026-07-14 to 2026-10-12). A decision's change is the **sum** over its files. I also computed the union of distinct commits; it doesn't change the order at the top.
- **The undici dependency** isn't installed, and I didn't fetch it. I stubbed it for the suite runs. 15 tests fail identically in every run: the opencode subprocess tests (because of the stub) and the git-probe subprocess tests (because of the environment). None of them touches the target.

### A2. Measurements at `0d54b97`

**Import map.**
- 246 JS files and 668 local import sites, of which 200 are lazy (almost all in tests).
- Production code has 52 area pairs with edges and 96 import sites.
- **Knots: 0. Tangled groups: none. File-level cycles: none.** Under this map the production import graph is a DAG, and the code works to keep it one: `harnesses.js` documents how it avoids a require cycle with `executors.js`.
- The import map is blind to SD's main coupling channel. The dispatcher loop and the Stop hook are separate OS processes. They share `state/sessions.json`, several sentinel files, and an HTTP text protocol with Harbour.
- The rough field census shows 11 session fields touched in three or more areas. `phase` appears in 11 files across 8 areas and is written in 3. `itemMetadata` appears in 10 files across 7 areas, and `transcriptPath` in 4 files across 4 areas, written in both `hook.js` and `reapers.js`. A knot count cannot see any of this.

**Shape.**
- 38 production files, 9,789 code lines (comments make up about half of the 21.7k physical lines), 793 functions and 3,112 DP.
- 69 functions have more than 10 DP; 6 have 50 or more.
- The worst functions: `runOpenCode` (opencode-runner.js:1076) 101, hook `main` (hook.js:1572) 89, `processPolledItem` (dispatcher.js:676) 84, `runStallFailsafe` (reapers.js:1680) 82, `resolveAsyncWait` (heartbeat.js:196) 53, `runOnce` (dispatcher.js:1580) 51.
- Full tables: `shape.HEAD.txt`.

**Census.**
- Groups spanning two or more files: cmp 24, set 3, const 12, record 4, clone 0, marker 9. Full output: `census.HEAD.txt` (the JSON form was not committed).
- Clone groups came back empty. No function or `if` statement is a type-2 clone of another across files. The copies that do exist are at statement level, and other detectors found them.
- My classification of the top 22 groups by score (the `lit` detector is left out because it duplicates `cmp`):

| # | Group | Score | Verdict |
| --- | --- | --- | --- |
| 1 | marker `[failed]` (8 files, 34 sites) | 1968 | **real**, T1 |
| 2 | marker `FAILED` (5 files) | 920 | noise: one word in prompts, logs and a phase name |
| 3 | record `{attempt, cause, error, item, status, url}` (4 files) | 844 | **real**, T2 |
| 4 | marker `BLOCKED` | 596 | noise (same reason as #2) |
| 5 | record `{backoffBaseMs, backoffCapMs, budget, maxAttempts, onAttemptFailed}` | 519 | **real**, T2 |
| 6 | const `2000` | 485 | noise (coincidental numbers) |
| 7 | marker `[done]` | 435 | **real**, T1 |
| 8 | set `{ignore, pipe}` | 392 | noise (stdio arrays), though two of its sites point at T5 |
| 9 | cmp `harness == 'opencode'` (13 sites) | 294 | **real**, T3 |
| 10 | cmp `livenessSignal == 'transcript-hook'` (7 sites) | 262 | **real**, T3 |
| 11 | record `{bootstrapToken, reservePort, sessionId, usesMcp}` | 262 | real, T6 |
| 12 | cmp `action == 'abort'` | 216 | noise (two different verdict objects) |
| 13 | marker `DONE` | 206 | noise (prompt prose) |
| 14 | const `3000` | 160 | mixed: one of its sites belongs to T5 |
| 15–20 | cmp `kind == 'blocked' / 'failed' / 'pending-external' / 'pending-internal'`; marker `[usage]` | 160 each | **real**, T4 |
| 19, 21 | marker `[blocked]`, `[pending]` | 160 each | **real**, T1 |
| 22 | const `/^\d+$/` | 160 | noise |

Noise: 7 of 22 (32%), close to the essay's "about one in four". The 15 real groups reduce to six decisions.

**Coherence-review stand-in.** SD has no ledger of scattered decisions. Instead I checked the docs' own "this lives in one place" claims against the code:

| Claim | Holds? |
| --- | --- |
| `phases.js` owns the phase vocabulary "instead of scattered string literals" | Yes: no phase literal is compared outside `phases.js`. (The doc's "7 phases" is stale: the code has 8, including `AWAITING_EXTERNAL`.) |
| `targets.js`: "Add a target here, not by editing if/else ladders" | Yes: no `target === 'cli'/'web'` comparisons remain. |
| `transcript.js` is "the one transcript reader" | Partly: `links.js`, `opencode-runner.js` and `reapers.js` compare transcript block types (`type === 'text'`, `'user'`) themselves. |
| The harness registry carries `livenessSignal` | Bypassed at 13 sites that compare the harness name directly (T3). |
| "Effective start" (`resumedAt \|\| createdAt`) | Two code sites, both in `reapers.js`; not scattered across files. |

**The ranking, by decision.** The essay ranks by places × change. I've added a column the essay doesn't ask for: churn on the decision's own lines, from `git log -G`, so the gap between the two is visible.

| # | Decision | Places (files) | Change Σ | **Places × change** | Decision-line churn (90 days) | Kind |
| --- | --- | --- | --- | --- | --- | --- |
| **T1** | **Terminal feedback-head vocabulary.** `[done] [failed] [aborted] [blocked] [pending]` are written at 44 sites, and `feedback.js` holds a reader regex that also accepts `[complete]`. | 9 | 251 | **2,259** | 31 | the same data in every copy |
| T2 | Terminal-post retry policy (LIN-3208). The retry options and the `feedback.terminal_attempt` oplog record are restated in each lane (dispatcher.js:659, hook.js:104/141, opencode-runner.js:518, reapers.js:91). The defaults (4 / 1000 / 8000) are restated in `config.js` and `feedback.js`. | 6 (the census saw 4) | 251 (211) | 1,506 (844) | 5 | the same data, plus a deliberate retry budget per lane |
| T3 | Which liveness protocol a session follows. `itemMetadata?.harness === 'opencode'` appears 13 times, and `harnessFor(… \|\| DEFAULT_HARNESS).livenessSignal === 'transcript-hook'` 7 times. | 4 | 164 | 656 | 8 | a rule, mixed: some sites really do mean opencode |
| T4 | How a sentinel verdict becomes an outcome in each harness lane (`hook.js` and `opencode-runner.js`). Their "pending" sets differ: the hook uses `{pending-external, pending}` and the runner `{pending-external, pending-internal}`. | 2–3 | 80–145 | 160–435 | 1 | a cluster of rules with deliberate variants |
| T5 | The evidence-link lookup `git remote get-url origin` with a 3000 ms timeout (hook.js:424, opencode-runner.js:367) | 2 | 80 | 160 | – | a copied procedure |
| T6 | The broker-arming call, built in two lanes (dispatcher.js:1016/1363, reapers.js:1914) | 2 | 131 | 262 | – | deliberate per lane |

### A3. Target and ownership call

**Target: T1, the terminal feedback-head vocabulary.**
- It ranks first by places × change.
- It is of the runbook's second preferred kind, "a decision whose copies hold the same data". Nothing of the first kind exists, because there are no knots.
- The 44 copies agree byte for byte on six tokens. It is the essay's `{'blocked'}` case.

**What the scattering costs.**
- Every new failure path restates the token. Head lines were touched in 31 commits in 90 days.
- A misspelt head silently stops counting as terminal. `isTerminalMessage` would no longer make it eligible for retry, and, by its own comment, Harbour would no longer wake on it.
- The only guard today checks file names, not heads (A4).

**Coupling to T2.** In SD, the reader `isTerminalMessage` has exactly one job: it gates retry in three lanes (dispatcher.js:656, hook.js:133 and reapers.js:90). The reader, the guard test and the producer table all arrived in one commit, `4a9c2aa` (LIN-3208). So T2 is the natural next target, gathered into the same authority.

**Ownership, by the rule.** "A decision belongs to the area that would have to change if its rule changed." If the head vocabulary changed, the reader in `feedback.js`, SD's port to Harbour, would have to change. The eight producer files would change only because each of them restates the tokens. **Owner: the feedback area (`feedback.js`).** I checked the call against every use:

| Use | Where | Does the call hold? |
| --- | --- | --- |
| Writers (44) | abort.js 2, admission.js 4, dispatcher.js 7, executors.js 1, followup.js 2, hook.js 6, opencode-runner.js 10, reapers.js 12 | Yes. They restate the tokens; they don't own them. |
| Reader | feedback.js:22 `TERMINAL_MESSAGE_REGEX`, through `isTerminalMessage`, called by dispatcher.js:656, hook.js:133 and reapers.js:90 | Yes. This is the authority's natural home. |
| A copy in tooling | e2e-smoke.js:599-602 maps outcome type to head | Non-production; out of scope; written up (d). |
| Tests | test/feedback.test.js:543-622 | Converted inside the ticket (A4). |
| **Another repository** | `feedback.js:19-21`: "The same terminal vocabulary as WAKE_FEEDBACK_REGEX (LinearViewer lib/dispatch-terminal.js:53)" | Harbour holds the rule that actually wakes parents. Inside SD the feedback area is the only claimant, so I treated Harbour's regex as an external mirror, not a second owner within this codebase, and wrote it up as an open question (d). **This is a judgement the essay doesn't cover** (B5). A person may rule otherwise, at leisure. Nothing here blocks, because the change keeps SD's behaviour byte-identical. |

**Checked against the corollaries.**
- No catch-all is involved, and no knot.
- The map is right for this target.
- The authority goes in `feedback.js`, an existing file. A new file would need a row in this per-file area map, and the round forbids map edits (B13).
- New import edges, predicted: intake → feedback gains 3 sites (abort.js, admission.js and followup.js), and launch → feedback gains a new pair (executors.js). Feedback imports only `chunk.js` and `http.js`, so no knot can form.
- An SD rule a fresh reader should confirm: abort.js, admission.js and followup.js are listed as pure modules (no fs, clock or network). They would import `feedback.js`. What they use from it is a pure table or builder, and `feedback.js` does no I/O at load (it reads `process.env` only).

### A4. What pins the target: the trace and both probes

- **Read trace** (the whole suite, filtered for loader reads). Four test sites read production source as text:
  - `test/feedback.test.js:616` reads 8 named producer files. This is the head-coverage guard.
  - `test/process-item.test.js:750` reads `dispatcher.js` to check that two names are absent.
  - `test/links.test.js:374` is a whole-tree absence scan for URL regexes.
  - `test/claude-md-anchor-resolver.test.js:95` is a whole-tree resolver for doc anchors.
  - My first search, a narrow grep, missed `feedback.test.js:616`.
- **Move probe.** I rewrote the 44 heads to `${TERMINAL_HEADS.x}`, added a table to `feedback.js`, and served those texts only to the tests that read source.
  - It produced **0 new failures**; the failing set was identical to baseline.
  - **But the guard at `feedback.test.js:604-622` goes vacuous.** Before the move it finds head literals in 8 of 8 producer files. After the move it finds them in 5 of 8, and every one of those matches is a comment line (`guard-replica.cjs`). It would stay green while guarding nothing.
- **Perturbation probe** (every comment blanked, in all 38 files). 0 failures, but **4 tests disappeared**, because the anchor resolver generates one test per comment that cites a doc. This doesn't affect the target, but see B9.
- **Mutation gate.** It is manual and not part of `npm test`. Its 52 exact-substring anchors are text pins on production source. One of them sits on a target site: `run-mutations.js:508` matches opencode-runner.js:1571 (the `[blocked]` post, which is excluded from retry by LIN-3208's rule R1). Rewording that line makes the mutant report ERRORED until it is re-anchored.
- **Stale entries.** The `PRODUCER_HEADS` labels in `feedback.test.js:543-567` carry old line numbers; for example, 'dispatcher.js:548' now sits at :605.

**Classing the pins.**
- `feedback.test.js:604-622`: **convert**. It goes vacuous after the move.
- `PRODUCER_HEADS`: **mixed**. Keep its `isTerminalMessage` checks exactly as they are; re-label only the stale labels.
- links.test.js:374, the anchor resolver and process-item.test.js:750: **keep**.
- The mutation anchor: **re-anchor in the same change.**

### A5. The move: consolidate

- **Not untie:** there is no knot.
- **Not free the seam:** its done-when, "the move probe fails no test", already holds. The one real pin goes vacuous rather than failing. The clause list lets its conversion ride inside the consolidation, in section 6's order (B11 covers the ambiguity).
- **Not rebuild:** the decision is scattered, so there is no single unit to rebuild yet.
- **Consolidate:** one authority in `feedback.js`: a frozen table of heads, a builder that writers call, and the reader built from the same table, or tested against it. The losing copies are deleted in the same change.
- The authority will be about ten lines, so no rebuild of it follows. The next move is T2, gathered into the same authority.

### A6. The ticket (draft; not filed)

> **Repository: JKershaw/simple-dispatcher.**
> Branch from a freshly fetched `main` and check the base before starting; this ticket was written at `0d54b97`. Compare every count against your base, not against the numbers below.
>
> **Title:** Give the terminal feedback heads one authority in `feedback.js` (44 writer sites outside it → 0)
>
> **Shape of the work.**
> - This is one PR. Don't split it into child tickets. Do one part at a time, with no parallel forks.
> - While iterating, run targeted tests: `test/feedback.test.js`, `test/admission.test.js`, `test/abort*.test.js`, `test/followup*.test.js`, `test/process-item.test.js`, `test/opencode-runner.test.js`, `test/opencode-retry-r1.test.js`, `test/fast-fail-watchdog.test.js`, and the reaper tests that assert `[failed]`/`[done]` messages.
> - Run the full `npm test` once, before opening the PR.
> - `npm run test:system` and `npm run test:mutation` need a Harbour checkout (see Tests).
> - No live calls to outside services and no paid model calls.
> - **Merging to `main` restarts the production dispatcher** (`watch-restart.sh` follows `main`). Nothing merges until the operator's replay has passed on the PR head.
>
> **What.**
> - **The decision:** how SD spells a terminal feedback head, the bracketed token at the start of a feedback message that marks it terminal. Writers emit `[done]`, `[failed]`, `[aborted]`, `[blocked]` and `[pending]`. The reader, `TERMINAL_MESSAGE_REGEX` in `feedback.js`, also accepts `[complete]`, case-insensitively and after leading whitespace.
> - **The owner is the feedback area (`feedback.js`).** If the vocabulary changed, `feedback.js`'s reader (the port to Harbour) is what would have to change. The writers change today only because each of them restates the tokens.
> - **The authority goes in `feedback.js`; do not create a new file.** It contains one frozen table of heads; a way for writers to take a head from the table; and the reader built from the same table, or tested to match it. `[complete]` stays as a named reader-only entry, with its reason beside it.
> - **Counting rule.** A *site* is a string literal, or the first part of a template literal, in production code (root-level `*.js`, excluding `e2e-*.js`) whose text begins with a head the reader accepts. A reference to the authority is not a site. Comments and log prose that merely mention a head are not sites.
> - **Tested grep for the sites** (`<base>` is your base commit):
>   ```
>   git grep -nE "['\`\"]\s*\[(done|complete|failed|aborted|blocked|pending)\]" <base> -- '*.js' ':!test/**' ':!e2e-*.js' ':!experiments/**' | sed 's/^<base>://' | grep -vE '^[^:]+:[0-9]+:\s*(//|\*)'
>   ```
>   It returns 43 lines (44 sites; hook.js:2051 holds two) at `0d54b97`. After this change it should return only the table's lines in `feedback.js`.
> - **Deleting the losing copies is part of done.** After this change, no writer spells a head itself.
> - **Starting list.** Verify it at your base; don't trust it. These are the sites at `0d54b97`:
>
> | File | Sites before | After |
> | --- | --- | --- |
> | abort.js | 2: 45, 86 | 0 |
> | admission.js | 4: 37, 49, 63, 76 | 0 |
> | dispatcher.js | 7: 605, 606 `[aborted]`; 911, 937, 1076, 1178, 1337 | 0 |
> | executors.js | 1: 730 | 0 |
> | followup.js | 2: 40, 66 | 0 |
> | hook.js | 6: 1395, 1435; 1456 `[blocked]`; 1498 `[pending]`; 2051 `[done]` ×2 | 0 |
> | opencode-runner.js | 10: 933, 968, 969, 1545; 1571 `[blocked]`; 1624 `[pending]`; 1638 `[done]`; 1694, 1695, 1801 | 0 |
> | reapers.js | 12: 482, 498, 518, 522, 523, 660, 2342; 2343 `[done]`; 2430; 3028 `[done]`; 3043 `[done]`; 3055 | 0 |
> | **Outside feedback.js** | **44** | **0** |
> | feedback.js | 1 reader | the table (5 writer heads and 1 reader-only head) plus the reader |
>
> Unmarked sites are `[failed]`.
>
> **Order of work.**
> 1. **Requirements.** For each of the 44 sites, record the exact message it produces, where that message goes (a feedback POST and through which lane, a verdict field, or an oplog line), and whether it is retry-eligible today.
> 2. **Design.** Decide where the table lives, how writers take a head, and how the reader relates to the table, with one line per function. Write the design before changing any production line.
> 3. **Conversions** (see Tests).
> 4. **Build.** Route all 44 writers through the authority without changing a single byte of any message. Don't copy functions or blocks.
> 5. **Replay** (your own, light) **and measures.**
>
> **Tests.**
> - **Pins that may be converted:**
>   - `test/feedback.test.js:604-622`, "the producer table covers every terminal head the repo emits". It reads 8 named producer files as text, so after this change it would pass while matching only comments. (A probe at `0d54b97` showed it then sees 5 of 8 files, all through comment lines.) Replace it with two checks:
>     - a whole-tree absence scan: no root-level production `*.js` other than `feedback.js` contains a string or template literal starting with a head. Parse the files; don't regex them, and exclude comments.
>     - a table-driven check that `isTerminalMessage` recognises every table entry.
>   - `test/feedback.test.js:543-567`, `PRODUCER_HEADS`. This is a **mixed pin.** Its `isTerminalMessage` checks stay exactly as they are; only its stale labels (for example, 'dispatcher.js:548' now refers to :605) may be re-labelled.
> - **The conversion rule.** A pin may go only after a behaviour check of the same property has landed and been shown to fail without its guard.
> - **The order:**
>   1. Land the replacements while the old guard stays unchanged and green.
>   2. In a scratch copy outside the repository, break the guard three ways: (a) misspell one head in the table; (b) add a raw `'[failed] x'` literal to `reapers.js`; (c) drop `complete` from the reader. Show the replacement fail each time, restore, show it pass, and record every run.
>   3. Only then, in a later commit, delete the old scan.
> - **Never weaken a guard.** These guards are listed by location and must not change:
>   - `feedback.test.js` "is case-insensitive and tolerates leading whitespace" and its `NON_TERMINAL` list;
>   - `test/opencode-retry-r1.test.js` (the opencode `[blocked]` post stays a single attempt);
>   - `test/links.test.js:363-381`.
> - No security pins are in scope. Build any secret-shaped test values at run time.
> - **Mutation gate.** `test/system/mutation/run-mutations.js:508` anchors on the exact text of opencode-runner.js:1571. Re-anchor it in this PR so that it matches exactly once, then run `npm run test:mutation` (it needs Harbour at `/home/user/LinearViewer`). If you cannot run it, record the waiver on this ticket, as SD's contributor notes require: what was not run, why, and the follow-up that will run it.
>
> **Differences between copies.** Sort each into one of four classes, in order. Inside a consolidation only comments are fixed; a wrong behaviour becomes class (d).
> - **(b) Deliberate, kept as a named entry:** the reader accepts `[complete]`, which no SD writer emits, because it mirrors Harbour's wake vocabulary. Keep it as a reader-only table entry, with that reason beside it.
> - **Reader leniency, not a difference between copies:** the reader is case-insensitive and accepts leading whitespace, while writers emit lowercase heads at position 0. Keep the reader's behaviour byte for byte.
> - **(d) Write up, never block** (each with options and a recommendation, on a standing ticket):
>   1. Harbour's `WAKE_FEEDBACK_REGEX` (LinearViewer `lib/dispatch-terminal.js:53`) holds the same vocabulary in another repository. Should SD's table be checked against it, for example in `test:system`, which boots the real Harbour?
>   2. `e2e-smoke.js:599-602` restates the mapping from outcome to head in manual tooling. Should it adopt the authority?
> - **Never fuzz:** any byte of a feedback message; any key or value of the feedback options, or their order; whether a post is retry-eligible; oplog lines; state writes; console output. Where unsure, it is not fuzz.
> - **Open questions carried forward:** none, since this is the first change of the round.
>
> **Behaviour to keep.**
> - Every message byte, including truncation at 2000 characters with `...` (the head survives it).
> - The retry-eligibility verdict for every message.
> - Post order within each lane, and the key order of the feedback options.
> - The verdict objects from `assess`, `resolveAbortTarget`, `resolveAbortForSession` and `resolveFollowUpTarget`, with their key order.
> - Oplog lines.
> - Console output. This includes the two `reapers.js` log lines that mention "a [failed] marker was posted" as prose; leave them as they are.
>
> **Measures.**
> - Commit before measuring.
> - Run the import map at base and at head, with the same attached area map. No new knot (there are 0 today). The only new production edges should be intake → feedback (+3 sites) and launch → feedback (+1 site, a new pair).
> - Do not edit the area map.
> - Report shape per touched file; DP should move by no more than ±2 per producer file.
> - Census: the `[done]`, `[blocked]` and `[pending]` groups should leave the list of groups spanning two or more files.
> - The verbatim share does not apply, because this is not a rebuild.
>
> **The worker's replay.**
> - The old side comes from an export of the base. Run about 1,000 seeded inputs across the eight writer files' entry points, under a frozen clock and `TZ=UTC`.
> - Compare these channels: feedback POST bodies and options (sent to a loopback fake), verdict objects, oplog lines and console output.
> - The expected result is zero differences. Explain any difference by its class. Keep the replay out of the unit tests.
>
> **The plan** must contain six things:
> 1. the requirements;
> 2. the design, one line per function, including where the table lives;
> 3. each conversion, with its replacement and the scratch mutation that shows it failing;
> 4. the commit order;
> 5. how behaviour will be shown unchanged;
> 6. what is out of scope.
>
> The plan reviewer approves a plan that covers all six and breaks no constraint in this ticket. Helper names, parameter shapes and line-level design are for code review.
>
> **Reasons.** Keep every ticket reference and reason comment beside the code it governs. Comments that mention `[done]`, `[failed]` and the other heads stay: they are prose, not sites. List anything you drop.
>
> **Out of scope.**
> - The retry policy (T2), the harness/liveness predicate (T3), and the sentinel-to-outcome mapping (T4).
> - Whole-message copies such as `'[done] Task completed (opencode).'` (opencode-runner.js:1638; reapers.js:3028 and 3043).
> - Non-terminal heads (`[working]`, `[started]`, `[usage]`, `[stall-failsafe]` and the rest).
> - `e2e-smoke.js`; Harbour's regex; and every comment mention of a head.
>
> **Words.** This ticket quotes no person. Its rules are its own.

### A7. The prediction (committed before filing; to be revised after a fresh reader)

| Item | Baseline | Prediction | P | Falsified by |
| --- | --- | --- | --- | --- |
| One PR, no child tickets | – | yes | 0.9 | child tickets or more than one PR |
| Merges | – | yes | 0.8 | abandoned or closed |
| Plan review reaches its bound and needs a ruling | – | no | 0.75 (a ruling: 0.25) | a ruling is requested; the most likely cause is a reviewer reading the guard conversion as a weakening |
| Code-review send-backs | – | 0 (0.5), 1 (0.35), 2 or more (0.15) | – | – |
| Wall clock to merge-ready | – | 1 to 3 h, median 1.5 h | 0.7 | outside the range. The essay says predictions miss most on effort. |
| Mutation anchor re-anchored in the PR | – | yes | 0.75 | anchor left stale |
| Mutation gate actually run (not waived) | – | yes | 0.5 | waiver recorded |
| Head sites outside `feedback.js` (counting rule / grep lines) | 44 / 43 | 0 / 0 | 0.85 (3 or fewer: 0.95) | any unlisted site left |
| Grep lines inside `feedback.js` | 0 | 5 to 7 | 0.7 | – |
| Knots; file cycles | 0; none | 0; none | 0.97; 0.95 | any new pair with imports both ways |
| Production area pairs; import sites | 52; 96 | 53; 100 ±1 | 0.75; 0.7 | another pair moves |
| Total DP | 3,112 | 3,112 to 3,116 | 0.85 | more than +5 |
| Worst function in each touched file | 101 / 89 / 84 / 82 / 26 (sendFeedback) | unchanged | 0.9 | any change |
| Code lines | – | producers ±3 each; `feedback.js` +4 to +15 | 0.8; 0.7 | – |
| Census marker groups spanning 2+ files | 9 | 5 to 6. `[done]`, `[blocked]` and `[pending]` leave; `[failed]` falls to 2 files and 3 sites (the table plus the reapers log prose). | 0.75 | `[done]` still spans 2+ files |
| Other census detectors | as A2 | unchanged | 0.85 | – |
| Guard at feedback.test.js:604-622 | a source scan over 8 named files | an absence scan plus a table check, each shown failing first | 0.8 | the old scan is deleted before a replacement has been shown failing |
| Unit suite | 3,254 pass (on the export) | +3 to +15 tests; 0 new failures | 0.9 | – |
| Ticket references dropped | – | 0 | 0.85 | – |
| Replay after merge, two seeds | – | 0 differences | 0.9 | any difference. If one appears, the likeliest cause is an escape change where a plain string became a template literal (P 0.05). |
| Fresh reader finds a must-fix in this ticket | – | yes | 0.5 | – |

### A8. Design for the replay that would judge it (not built)

**Who builds it, and when.** A separate agent builds it before the ticket is filed, and the worker never sees it. Because SD deploys when `main` moves, the full replay runs **on the PR head before merge**, and again after merge on the merge's parent against the merge.

**Two pinned copies.** Export the base and the change with `git archive`, each into its own directory with its own `node_modules`. undici is the only dependency that loads; it has to be vendored once, because the sandbox has no network.

**Isolation.**
- Each side runs in its own child process per batch.
- A fresh process per scenario for anything with module-level state: `hook.js`'s `HOOK_STARTED_AT`, the launch-breaker singleton, the auto-pause singleton in `halt.js`, and the dispatcher's `HALT_LOCAL_MALFORMED_LOGGED`.
- The pure tier clears `require.cache` between scenarios.

**One frozen world.**
- `Date.now` and `new Date` are frozen and advanced only by the scenario; `TZ=UTC`.
- The environment is scrubbed to a fixed set: `DISPATCH_API_URL` points at a loopback fake Harbour; the state directory, the oplog and the resource-metrics file live in a per-scenario temp directory; every `*_MS` setting stays at its default.
- `Math.random` and `crypto.randomUUID` are seeded.
- The network is blocked and every attempt counted, using the guard in `trace.cjs`.
- Terminal drivers, `spawn` and `exec` are replaced by recording fakes; `git remote get-url` returns fixed text.

**Entry points.** Each lane is one caller, so the replay runs per caller:
1. `feedback.isTerminalMessage`.
2. `admission.assess`, `abort.resolveAbortTarget` / `resolveAbortForSession`, and `followup.resolveFollowUpTarget`.
3. `dispatcher.processPolledItem`, with a fake `DispatchSource` and dependencies (the `makeDeps` pattern from `test/process-item.test.js`), and `runOnce`'s halt-stop sweep, which emits `[aborted]`.
4. The `executors.js` launch path, with a failing fake driver.
5. `hook.js` as a subprocess: a Stop payload on stdin, a temporary `sessions.json`, and a transcript fixture.
6. `reapers.js`: `runStallFailsafe`, `runFastFailWatchdog`, `runOpenCodeCompletionCheck`, and the message builders at :482–:660, all with injected state.
7. `opencode-runner.runOpenCode` with injected fs, spawn and fetch (backed by a fake opencode server), including the follow-up and hold paths (:933, :968–969, :1694–1695, :1801).

**Inputs, in four tiers.**
- **Captured:** every call the unit suite makes into entry points 1 to 7. A preload wraps those exports during one `npm test` run and serialises the arguments; dependencies that can't be serialised become recording fakes.
- **Generated:** at least 3,000 per seed, stratified so that each of the 44 sites is reached at least 30 times:
  - sessions across 8 phases × 2 harnesses × 2 targets × flags (`humanContinued`, `awaitingVerify`, `brokerArmed`, `force`);
  - dispatch items with `followUpTo`, `abortTo`, repo, harness and terminal variants;
  - turn texts carrying each sentinel;
  - message details containing `[`, `]`, backticks, `${`, backslashes, newlines, non-ASCII text, and more than 2,000 characters (to exercise truncation);
  - 15% malformed.
- **Targeted:**
  - one hand-written case per site (44 in all);
  - reader edge cases: `'  [DONE] x'`, `'\n\t[Failed] x'`, `'[complete] x'`, `'[completed] x'`, `'[done ] x'`, `'x [done]'`, `''`, `null`, `42` and `{}`;
  - every listed difference.
- **Real text:** none here, because no human-written text is rendered. Turn texts from `test/fixtures` are used, reported as counts only.

**Channels.** Every comparison is order-aware, and keys are never sorted.
- Feedback POSTs as received by the loopback fake: method, path, headers (with Authorization reduced to a hash), body bytes, and their order. Also the options handed to `sendFeedback` wherever they can be injected, including whether `retry` is present and its fields (functions are recorded by name).
- Verdict objects, as JSON with key order.
- The hook's stdout verdict and its exit code.
- The bytes of `sessions.json` after each scenario.
- Oplog and resource-metrics lines.
- Console output on stdout and stderr.
- Driver, signal, spawn and exec calls, with their arguments.
- Thrown errors.
- No normalisation is planned. Any normalisation added later is reported as a blind spot.

**Self-checks before it is trusted.**
- **Old against twin.** The old copy against an independently exported twin of the old copy gives 0 differences on two seeds.
- **Planted mutants.** Each is a single exact text change, and each must be caught at exactly the expected caller and nowhere else:

| Mutant | Change | Caught at |
| --- | --- | --- |
| M1 | admission.js:37: `[failed]` → `[faild]` | lane 2 |
| M2 | abort.js:86 | lane 2 |
| M3 | followup.js:66 | lane 2 |
| M4 | dispatcher.js:605: `[aborted]` → `[abort]` | lane 3, halt-stop sweep |
| M5 | executors.js:730 | lane 4 |
| M6 | hook.js:1498: `[pending]` → `[pendng]` | lane 5 |
| M7 | reapers.js:660 | lane 6 |
| M8 | opencode-runner.js:1571: `[blocked]` → `[block]` | lane 7 |
| M9 | the reader with `complete` dropped | lane 1 only |
| M10 | the reader's `/i` flag dropped | lane 1 only |
| M11 | a detail-text change at reapers.js:3055 | lane 6 (proves the replay sees bytes other than heads) |

- **Equivalent mutant, must stay silent:** reorder the alternatives in the reader regex.
- **Coverage.** 100% of the 43 head lines execute in the old copy, and line coverage of the functions that enclose them is at least 95% (measured with `NODE_V8_COVERAGE`). The essay asks for 95% of "the old code"; I've scoped that to the enclosing functions (see B14).

**After merge.** Run the merge's parent against the merge, on two seeds. Group and name each difference as a listed fix (none expected), listed fuzz (none allowed) or a regression.

**The worker's light replay.** Lanes 1, 2 and 6 (the pure functions and the message builders), plus lane 7's `postStatusFeedback`. About 1,000 inputs on one seed, with a guard that fails unless every lane ran at least one input.

### A9. The next targets the measures point to

- **T2: the retry policy, gathered into the same `feedback.js` authority.** The per-lane budget becomes a named parameter (`lane: 'hook' | 'opencode' | 'router' | 'reaper-pass'`). The restated defaults in `config.js` and `feedback.js` would be class (a) or (c), to be decided. This is data plus one deliberate variation.
- **T3: one `livenessSignalOf(session)` or `isProcessExitHarness(session)` in `harnesses.js`.** This is a rule, so it needs a decision site by site, because some sites really do mean "opencode".
- **T4: a cluster at a busy entrance.** The "pending" sets of the two lanes disagree. That disagreement is a (d) candidate, to be written up before anything is gathered.

---

## Part B: the essay as a manual

Each item gives the essay's words, what happened when I applied them, and what I needed. They are ordered by how much each one cost me or would cost a run.

**B1. The ranking: which "change" to count, and how to combine it with the preference order.**
- **The essay:** "Rank what they find by **places × change**: the number of files holding a decision times the number of commits that touched those files in the last ninety days." And: "Pick a target by places × churn. Prefer, in this order: a knot that hangs on one import; a decision whose copies hold the same data; a decision cluster at a busy entrance."
- **What was unclear:**
  - Whether to sum each file's commits or count distinct commits (I computed both).
  - Whether the window ends today or at the measured commit (I used the commit).
  - Whether merges count (I excluded them).
  - Whether the preference order ranks first and filters by kind second, or the reverse. Here both readings chose T1, but only by luck.
- **The deeper problem:** file churn credits a token with the churn of whatever files it happens to sit in. `[failed]` ranks first partly because it appears in all four of the hottest files (dispatcher, reapers, opencode-runner, hook), while the token itself has never changed. The essay also says "a scattered decision costs only when it changes." Decision-level churn (commits whose diffs touch the decision's lines) tells a different story: T1 31, T3 8, T2 5.
- **What I needed:** one explicit formula, plus a sentence on whether decision-line churn should break ties or override file churn.

**B2. Turning census groups into decisions, and what counts as a site.**
- **The essay** describes the census's detectors but not how their *groups* become *decisions*. I merged five marker groups and the reader regex into T1, and four `cmp` groups into T4. That was judgement every time.
- It also says to "Expect about one in four of its top groups to be noise" but not how to recognise noise. Here noise ran at 32%, mostly common words such as `FAILED`, coincidental constants and stdio arrays.
- A consumer comparing a value it was given (`verdict.action === 'reject'`) is a *use*, not a restatement. Only the ticket's counting rule ("a call to the shared authority is not a site") gets close to saying so. Applied by hand, that rule worked well (see "What worked well").
- **What I needed:** a short procedure. Merge groups whose sites share one reader or one writer; drop pure consumers; then count with the rule.

**B3. The area map on a flat, multi-process codebase, and zero knots.**
- **The essay:** "Someone writes down, once, which paths belong to which area (pages, routes, providers, a catch-all)", and in the runbook, "Write it by hand, once. Name every module; keep the catch-all small."
- **What happened:** SD has no directories, so every area boundary was my per-file judgement, and the knot count (0) is entirely a function of that grouping. The essay says nothing about how coarse areas should be, or how to check a map written by someone new to the codebase.
- **The bigger problem:** with no knots, the first rung of the runbook had nothing to work on. The essay does say the import map is "blind ... to calls over the network, to data shared through a database". In SD, that blind spot *is* the architecture: separate processes coupled through `sessions.json` fields, sentinel files and an HTTP text protocol. My rough field census showed `phase` in 11 files across 8 areas.
- **What I needed:**
  - a rule for the grain of areas;
  - a suggestion to have a fresh reader write a second, independent map and compare the knot counts;
  - an instruction to find the codebase's real coupling channel and measure that, whether imports, shared state or a wire protocol.

**B4. Bootstrapping "the coherence review" on a new codebase.**
- **The essay:** runbook step 1 says "Measure at the current main: knots, shape, census, the coherence review's list." Harbour's review is described as "a recurring review document with a short list of named decisions and a script that counts their files".
- **What happened:** SD has none, and the essay gives no recipe for seeding one. I used the docs' own "this lives in one place" claims instead; three held and two did not (A2).
- **What I needed:** a recipe for seeding the list on the first round, for example: harvest single-place claims from docs and comments, then verify them.

**B5. Decisions shared across repositories, and ownership.**
- **The essay:** "A decision belongs to the area that would have to change if its rule changed." And: "an ownership call when two areas both have a real claim" goes to a person.
- **What happened:** the target's rule really lives in another repository. `feedback.js` says it copies `WAKE_FEEDBACK_REGEX` from LinearViewer. Every instrument works on one repository, and the essay doesn't say whether a repository the work doesn't touch counts as "two real owners" (which would stop the move) or as an external contract (which goes on the standing ticket). I chose the second, but it was a guess.
- **What I needed:** a corollary for protocols, mirrors and contracts across repositories.

**B6. Pipeline, deployment and gating assumptions that didn't transfer.**
- **The essay:** "Each move runs as one ticket through the codebase's own pipeline: plan, plan review, build, code review, merge." "After merge. The replay runs on two seeds." "When a review loop in the pipeline reaches its bound (here, three send-backs)".
- **What I found in SD:**
  - **Merging is deploying.** `watch-restart.sh` restarts the production dispatcher when `main` moves. A replay that runs only after merge finds regressions that are already live, so I moved the full replay to the PR head as well.
  - **CI cannot block a merge.** SD's own contributor notes call CI "citeable, not enforceable": a red check does not stop a merge.
  - **The pipeline is SD itself.** SD is the dispatcher that runs Harbour's tickets, so changes to it go through itself. I could only work this out from SD's contributor notes.
  - **No standing ticket, review bound or ruling channel** was visible from the repository.
- **What I needed:** a short "find the pipeline" checklist. Where tickets go, the review bound, who rules, whether merge means deploy, and whether CI gates merges.

**B7. Instrument definitions are not in the essay, and the named example didn't supply them.**
- **The essay:** "count the decision points (each `if`, loop, `&&`, `case`)", "cyclomatic complexity less one", "Any complexity tool, with its definitions written down."
- **What was missing:** whether `?:`, `||`, `??`, `catch`, `?.` and default parameters count, and how nested functions are attributed. All of these shift Harbour's thresholds ("functions with fifty or more decision points ... from 21 to 9").
- **What happened when I looked:** I opened the one named instrument, `experiments/rebuild-exp1/kit/shape.mjs`. It is a 20-line wrapper whose definitions live in `lib/shape-core.mjs` and `kit/README.md`, neither of which the essay names. It didn't answer the question.
- The census is specified the same way: detector kinds are listed, but no thresholds (minimum clone size, which constants count, what counts as a "text format").
- **What I needed:** an eight-line definitions box for shape, and one line per census detector with its threshold.

**B8. The read trace in CommonJS.**
- **The essay:** "Run the whole suite with a hook in the test runtime that logs every test-side read of the target files."
- **What happened:**
  - In CommonJS, Node's module loader reads every module through the *public* `fs.readFileSync`. My first trace therefore reported 43 production files "read" by about 117 tests.
  - Tests that mock `readFileSync` relay the loader's reads through frames inside the test file.
  - I had to filter by stack (`defaultLoadImpl` / `loadSource`), after which there were 4 real reader sites. Harbour's code is ES modules, where this doesn't happen, so the essay never mentions it.
- **What I needed:** one sentence saying the loader's own reads must be excluded, and how to recognise them.

**B9. The probes count failures, so they cannot see vacuity.**
- **The essay:** on the move probe, "Every failure is a location pin, because behaviour did not change." On the perturbation probe, "Every failure pins how the code is written." And "Blanking every comment broke nothing, which meant no test kept the reason comments either."
- **What happened:**
  - The one source-reading guard on the target didn't fail under the move. It went **vacuous**: afterwards only comments satisfy it.
  - Blanking comments produced 0 failures, but **4 tests vanished**, because a data-driven resolver test generates one test per doc-citing comment. On SD the essay's inference would be wrong: a test does keep those reason comments honest. It shrinks instead of failing.
- The essay does say "Report *stale* or vacuous ones" and "Every sweep needs a positive control", but neither is part of the probe procedure.
- **What I needed:** probes that also compare test counts and names, and that report what each reader *observed* under the variant.

**B10. Mutation-gate anchors are text pins the essay's classes don't cover.**
- **The essay:** "*Convert* ... *Loosen* ... *Keep* ... Report *stale* or vacuous ones." And "Planted mutants are the method checking its own checker."
- **What I found:** SD already has a curated mutation gate. Its 52 exact-substring anchors on production source are text pins by the essay's own definition. A reword makes them ERRORED, and they had to be re-pointed in the very latest commit (LIN-3518). The gate isn't in the unit suite, so the read trace can't see it.
- **What I needed:** a fifth class ("re-anchor in the same change"), and an instruction to look for test harnesses outside the main suite.

**B11. Which move, when the probe is clean but a pin goes vacuous.**
- **The essay:** "If the target's tests pin it (run the trace and both probes), the next move is *free the seam*." Its done-when is "the move probe fails no test". And Figure 2 says "Free the seam changes tests only" and that "A move that would change a row it does not own is either the wrong move or two moves."
- **What was ambiguous:** the move probe failed nothing, so the seam was formally free, yet one test still had to be converted. The clause list allows conversions inside a ticket, but Figure 2 suggests a consolidation should not change tests. I put the conversion inside the consolidation, following section 6's order.
- **What I needed:** one sentence saying whether conversions are allowed inside a consolidation, and when a separate tests-only change is required.

**B12. The replay is specified for HTTP routes.**
- **The essay:** "Status; body, parsed and as bytes; headers; ... issued credentials; ... what the server does after a client hangs up".
- **What SD has instead:** a poll loop, a Stop hook run as a subprocess (stdin in, a stdout verdict out, no dependency injection in `main`), reapers that sweep a state file, and a runner that spawns servers. There are also module-level singletons and a clock read at load (`HOOK_STARTED_AT`), which force a process per scenario.
- I could derive SD's channels from the essay's principle ("every channel an outsider can see"), but the list itself didn't transfer.
- **Two small inconsistencies:** Figure 8 shows three input tiers where the text has four, and Figure 5's never-fuzz list leaves out "permission or middleware order".

**B13. The area-map rules contradict each other for new files.**
- **The essay:** "name any new file into an area pattern before it merges" in section 7. Against that: "Freeze it for the round" and the ticket clause "no edits to the area map".
- **What happened:** with a per-file map, any new file forces a map edit. I avoided the conflict by placing the authority in an existing file, which is a design decision forced by a measurement rule.
- **What I needed:** to be told that adding a pattern for a *new* file is allowed, said out loud, while relabelling an existing file is not.

**B14. Small guesses, listed for completeness.**
- Whether lazy (in-function) requires count as edges. I counted them.
- What "Model the change on an exported copy where you can" means when the change cannot run in isolation. I modelled it as text for the probes only.
- Whether the verbatim share belongs in a consolidation's measures, since it is in the general Measures clause. I said it does not apply.
- What "Line coverage of the old code at least 95%" covers. For 44 sites spread over files of up to 3,740 lines, whole-file coverage is out of reach, so I scoped it to the head lines and their enclosing functions.

**B15. Unchecked in a read-only trial.** The fresh reader, the scorer, the review-loop ruling and the after-merge re-measure were not exercised. The essay's claims about them are untested here.

### What worked well

- **The ownership sentence.** It decided the call in minutes. The instruction to check the call "against every place that uses, throws or catches the thing" gave me a concrete table to fill in, and that table is what surfaced the cross-repository mirror.
- **The census with places × change.** Under a second, and it found real scattered decisions that reading would not have. The four-lane retry block was written in four commits within 15 minutes and is visible only by opening four files. The single-comparison detector the essay's "Next" section asks for found T3 and T4.
- **The counting rule for sites,** "one place that writes the decision's rule itself". It separated the 44 real heads from log prose and comments that the census over-counted, and it matched a `git grep` exactly.
- **"Take every starting list as something to verify."** It caught stale test labels (`PRODUCER_HEADS` line numbers) and the census's prose false positives.
- **"Find the readers by tracing, not searching."** My first grep missed the only reader that mattered; the trace found it.
- **Transferred unchanged:** the four difference classes, the never-fuzz list, "where unsure, it is not fuzz", and "(d) never blocks the run".
- **The ticket clause list.** It worked as a checklist: every clause found something real in SD, including the mutation anchor, a mixed pin, a stale baseline and deploy-on-merge.
- **The replay's self-checks** (old against twin, mutants caught at exactly one caller, coverage). They carried over intact and gave the replay design its spine.

### What I would do differently

- **Two area maps.** Write the map from the docs, then have a fresh reader write a second blind map, and report the knot count under both before relying on it.
- **Both churn measures.** Report decision-line churn beside file churn in the ranking, from the start.
- **Model the move as text first.** It costs one suite run and found the vacuous guard. I'd do it before choosing the move, not after.
- **Better probes from the start.** Stack filtering, test-count comparison and "what did each reader observe".
- **Rank T1 and T2 together.** They form one cluster at SD's busiest port: the vocabulary's only reader exists to decide retry. I'd scope T1 knowing T2 comes next, and put the authority's table and the retry lane parameter in one design note so the second change doesn't reshape the first.

---

**Artefacts in this folder.**
- Scripts: `areas.json`, `lib.mjs`, `imports.mjs`, `shape.mjs`, `census.mjs`, `heads.mjs`, `fields.mjs`, `trace.cjs`, `probe-texts.mjs`, `guard-replica.cjs`, `anchors.cjs`.
- Outputs: `imports.HEAD.txt`, `shape.HEAD.txt`, `census.HEAD.txt`, `heads.HEAD.txt`, `fields.HEAD.txt`, `trace.HEAD.summary.txt`, `anchors.HEAD.txt`.
- Not committed: the census JSON, the multi-megabyte suite logs and traces, the `git archive` export of simple-dispatcher, and the probe texts (copies of its source).
