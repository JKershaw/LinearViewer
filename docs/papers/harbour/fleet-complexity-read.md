> Commissioned by John mid-passage (V1 passage, LIN-3099), 29 Sep 2026, after asking whether a "task" legitimately takes 2–4 PRs and 20–40 dispatches. Written by an independent read-only auditor session. Model names are given as tiers (frontier / mid / cheap) rather than product identifiers.

# Is the fleet overcomplicated? A read of three landed tickets

Auditor read, 2026-09-29. This is read-only: nothing in the repo, tracker or queue was changed.

**Sources**
- `git diff <merge>^1 <merge>` for #1607, #1612 and #1618.
- `issues/`, `dispatch?issueIdentifier=` and `dispatch/<root>` feedback (the `[usage]` lines) for LIN-3133, LIN-3131 and LIN-3124.

**Caveats**
- **Token maths.**
  - Claude `[usage]` lines are cumulative per session and often duplicated. I took the last line of each session, or last minus first where the session started before the window.
  - OpenRouter (cheap-tier) lines are per beat, so I summed them.
- **Relative cost.** "Cost units" weight tokens at list-price *ratios*:
  - Frontier tier: input 1, output 5, cache read 0.1, 1h cache write 2.
  - Mid tier: 0.6 × the frontier tier.
  - Cheap tier: its reported spend on the same scale.

  Claude beats run on the subscription lane, so a share here means a share of quota, not cash. Only percentages are reported.
- **Missing LIN-3124 data.** The dispatch list is capped at the newest 100 of 222, and the comments at the newest 50. So LIN-3124's plan passes 1–3 and revisions 1–2 have no token data. Passes 4–7 are readable in the comments.

---

## TL;DR verdict: **mixed, leaning overcomplicated**

- **Small and mid-size work: overcomplicated, heavily.**
  - The process is sized for a credential migration and is applied to an 8-line inert DI change.
  - On both small tickets, implementation is **under 1% of the weighted tokens** and about **13–14% of output tokens**.
  - The review rounds after the first changed **no production code**.
- **The large ticket (LIN-3124 PR3): the rigour paid for itself.** Review found about 7 real credential bugs that CI missed (details in §2). Much of the *size* of that work came from choices the process never re-questioned:
  - legacy byte-identity;
  - a dual read path;
  - a flag plus a rollback script;
  - five or more plan-review passes on a legacy-Jira edge case.

  John then closed that edge case in one line: *"He is the only Jira user and can reconnect if a token is lost: no legacy support and no cross-session checks."*
- **The biggest single cost is the orchestrator, not the implementer.** The frontier-tier, high-effort autopilot session, whose context keeps growing, is **36–59% of every ticket's weighted tokens**. That is more than all implementation combined.

---

## 1. Code: what each PR contains

| PR | Total + lines | Production | Tests | Docs | Test : prod | Comment share of added prod lines |
|---|---|---|---|---|---|---|
| #1607 LIN-3133 (T1) | 117 | 6 (5%) | 111 (95%) | 0 | 18.5 : 1 | 2 of 6 lines |
| #1612 LIN-3131 (S2b) | 2,057 | 550 (27%) | 1,429 (69%) | 78 (4%) | 2.6 : 1 | 31% |
| #1618 LIN-3124 PR3 | 6,587 | 1,998 (30%) | 4,588 (70%) | 1 | 2.3 : 1 | 36% |

Across the three samples, about **70% of added lines are tests** and about **30% are production**. If the fleet-wide 38.7k follows this pattern, about 11–12k lines were production in 24h. That is still a lot, but it is a third of the headline figure.

### #1607, LIN-3133: "thread `requireGrant` into two factories, unused"

**What the diff contains**
- **Production (8 lines).** The same identifier is added in two destructures and two mount literals, plus two JSDoc lines. Nothing calls it.
- **A census test update.** `proxy-di-witness.test.js` pins **the total count of declared DI params across 12 router files** (145 → 147). The ticket exists largely *because* of this pin. The plan's own rationale: "T3 would carry the DI change, the census bump and the gate in one PR … so a hot census literal (137 to 145 already this week) would sit in a stalled PR."
- **A new 105-line test** that a `read` token still gets a 403 on three enqueue routes. This is useful, but it covers pre-existing behaviour and is unrelated to the change.

**Essential to the stated outcome:** the 8 lines. The census bump is essential only because the census test exists.

**What John with one agent would plausibly ship:** folded into T3 as about 4 lines, or as a 10-minute standalone PR. He would skip the census and maybe the read-scope witness.

**Risk of skipping:** effectively none, since the change is inert by construction. The witness closes a real but small coverage gap, and it could be written as a 20-line test.

### #1612, LIN-3131: the owner-checked runner copy mint, the Settings UI, docs and e2e

**Production (~550 lines).** All of it is real feature work:
- owner seam (75);
- mint branch and refusal map (90);
- Settings UI across `public/proxy.js`, `common.js`, css and render (~240);
- instructions and docs (~150);
- test-route plumbing (73).

This is proportionate to the outcome.

**Tests (1,429 lines).**
- The unit tests are behavioural, not source pins:
  - `lin-3131-runner-copy-mint` 405;
  - `workspace-owner` 361;
  - Settings render 186;
  - client 132.
- The e2e spec is 275 lines.
- The only source pin is a 25-line allow-list update.

The suite is thorough but heavy. For example, 361 lines test a 75-line owner-check module (4.8 : 1).

**What John with one agent would ship:** the same ~500 production lines and perhaps 500–700 test lines, with one e2e happy path plus two refusal probes.

**What he'd skip:**
- About half the refusal-permutation tests.
- The L2/L3/L4 "surviving mutation" tests added in later rounds: body-supplied `ownerAccountId`/`workspaceId`/`urlKey` is ignored, and there is an `/instructions` runner-section e2e.

**Risk of skipping:** low. The production code was already correct, and those tests guard against a *future* regression.

### #1618, LIN-3124 PR3: the atomic connection-backed credential read cutover

**Production (~2,000 lines).** This is genuinely hard code:
- rotating refresh tokens;
- single-flight;
- revoke semantics across Linear, GitHub and Jira;
- session-row mirrors.

About 350 lines exist to keep the old model alive and reversible:
- the `CONNECTION_BACKED_WRITES` flag (D11) and a 189-line `scripts/revert-connection-backed.js`, plus a 155-line test;
- dual-path branches ("legacy byte-identical" appears as an explicit constraint);
- mixed-container handling.

**Tests (4,588 lines).** They are mostly behavioural, using real MangoDB stores and concurrency tests. The ceremony is organisational rather than in the assertions:
- Files are named for process steps, not behaviour: `checkpoint-b/c/c2/c3/d/e/e-jira`, `darkness`, `review-fixes`, `t17`, `t18-decoy`, `n1-d4`.
- A "D6 guard suite" pins import allow-lists.
- Count pins are carried from PR1 and PR2.

**Comments.**
- 36% of added production lines are comments.
- 128 added production lines cite plan labels (D7, D12, N1, F4 …).
- 102 cite ticket IDs.

The code cannot be read without the ticket, and the ticket's plan body was pruned to a snapshot archive (§5 was kept).

**What John with one agent would ship:** if he took his own "only Jira user, no legacy support" ruling as a design input from day one, plausibly **1,000–1,400 production lines and 1,500–2,500 test lines**. He would drop the rollback script and flag, most mixed legacy+connection branches, and the checkpoint-named test sprawl.

**Risk:** see §2. Several review blockers were real and would have shipped. Some would surface quickly (503s after token expiry). Some would fail silently (a legacy revoke deleting a healthy connection; a refresh token being spent through the legacy path).

---

## 2. Process: beats, rounds and what each round changed

### LIN-3133: 41 queue items for an 8-line change

**Sequence, 60 minutes wall-clock (23:56 → 00:56)**

| Phase | Beats | Duration |
|---|---|---|
| Research | 4 | 6m |
| Plan | 3 | 7m |
| Plan-review (Approve) | 1 | 4m |
| Implementation | 3 | 29m |
| Review (Approve, empty ledger) | 1 | 4m |
| Close-out | 1 | 6m |
| Autopilot | 1 root + 13 wakes | whole run |

**What the reviews changed:** plan-review, nothing; code review, nothing.

**Where the implementation time went.** Most of the 29 minutes was verification rather than writing:
- 12,429 unit tests, twice (hermetic plus proxy arm);
- the full Playwright suite;
- hand-run mutations;
- the CI wait.

**Weighted token share**

| Component | Share |
|---|---|
| Autopilot (orchestrator) | **59%** |
| Plan-review | 15% |
| Plan | 11% |
| Review | 11% |
| Research | 3% |
| Implementation | **0.6%** |
| Close-out | 0.2% |

By output tokens, implementation is 13%.

**Text produced:** about 30k characters of comments plus a 15k-character description, for 8 lines of production code.

### LIN-3131: 38 queue items; the plan was upstream in LIN-3059 and is not counted

**Sequence, 130 minutes (07:28 → 09:38)**

| Phase | Time | Beats | Result |
|---|---|---|---|
| Implementation | 07:32–08:41, 69m | 5 | PR open, CI green |
| Review 1 (frontier-tier) | | | "Approve, conditional" with ledger L1–L3: two doc wordings and two regression tests. **No production change needed.** |
| Close-out 1 | | | **Held.** The rules bar close-out from making a wording fix unless review gave the exact text ("an illustrative 'e.g.' does not qualify"), and bar new tests in close-out. |
| Implementation | | 1 | L1–L3 added, about 80 lines of tests and docs |
| Review 2 | | | **Request Changes.** A sibling mutation survived: body `urlKey` authority is untested. The fix is "one changed unit test with no production code change". The rules forbid a conditional approve when a test is needed. |
| Implementation | | 1 | About 18 test lines |
| Review 3 | | | Approve |
| Close-out 2 | | | Merged |

**What the post-PR loop cost:**
- **56 minutes, 43% of wall-clock.**
- About 5.7 of 22.2 cost units, **~26% of tokens**.
- **Zero production changes.**

**Weighted token share**

| Component | Share |
|---|---|
| Autopilot | 49% |
| Reviews (three) | 50% |
| Implementation (all beats) | **0.9%** |

The implementation ran on the cheap tier. By output tokens it is 14%.

### LIN-3124 PR3: the large one

**Planning (shared by PR1–PR3)**
- **Seven plan-review passes.** Blockers went 11 → 4 → 1 → 1 → 1, then a text correction, then a confirmation.
- **What each late pass changed:**
  - **Pass 4:** a real design bug. A "skip finalize" rule left two live copies of a rotating Jira refresh token, so one site would stop refreshing.
  - **Pass 5:** the same seam across devices. This parked for John; the park and his reply took 03:34 → 06:13, overnight.
  - **John's ruling:** accept the residual. He is the only Jira user.
  - **Pass 6:** a one-clause *text* contradiction in test case T20(k). A liveCopies count stated as 1 should be 0.
  - **Pass 7:** confirmation.
- **Assessment.** Passes 1–4 bought real design corrections. Passes 5–7 cost about 5 hours of elapsed time (including the overnight park) and several frontier-tier sessions, on a scenario the owner dismissed in a sentence and on proofreading.

**Implementation.**
- The cheap tier ran 5 beats from 09:35 to 12:35:
  - re-ground and inventory;
  - checkpoints A–D;
  - the 5th beat failed.
- A fresh frontier-tier session then completed N1 and checkpoint E (the write flip), then F, and opened the PR at 13:26.
- Time to PR: about 3h50m.

**Reviews: 3 rounds, 13:27 → 14:29.**
- **Round 1: Request Changes with 7 blockers. Round 2 found blocker 8.** Mostly real bugs:

| Blocker | Kind | What was wrong |
|---|---|---|
| 1 | Bug | The mirror/expiry accessors return `undefined` for connection-backed workspaces. This was caused by an *orchestrator* fidelity deviation (F4) from the plan. |
| 2 | Bug | The post-401 retry renders with the stale token: a 503 after each expiry. |
| 3 | Bug | A legacy revoke deletes a healthy connection-backed sibling. |
| 4 | Bug | The D4 revocation can never fire; there is a double refresh gate. |
| 5 | Bug | A stale `activeBinding` marker survives. |
| 6 | Bug | Rollback leaves two live refresh-token copies. |
| 7 | Coverage gap | Untested seams. |
| 8 | Bug | The suspect lane spends the refresh token through the legacy path. |

- **Round 3:** confirmation.
- **What the rigour bought:** these are real bugs that CI did not reach.
- **Where the bugs sat:**
  - Blockers 3, 5 and 6 (and the seams in 7) live in mixed-legacy or rollback code that exists only because of the dual-path and rollback design.
  - Blocker 1 was introduced by the process itself: the orchestrator's F4 instruction.

**Close-out.** Held for John on L2 from 14:34 to 15:45. Merged at 15:52; acceptance was closed at 17:48.

**Weighted tokens for PR3 (excluding planning)**

| Component | Share |
|---|---|
| Implementation (frontier-tier, incl. fixes) | **~48%** |
| Autopilot | ~36% |
| Review | ~11% |
| Close-outs | ~4% |
| Cheap-tier implementation beats | <0.1% |

This is the only ticket where writing code is the largest single cost, and the orchestrator is still over a third.

### The pattern across all three

- **The orchestrator dominates.** The autopilot is a frontier-tier, high-effort session that accumulates context (192M cumulative cache-read by the end of LIN-3124). Every wake re-reads that context.
- **Cheap implementers, expensive checkers.** Implementation is delegated to the cheapest model. That makes the "code" line tiny and the "checking" line large. On PR3 the cheap implementer failed and a frontier-tier session had to take over.
- **Beats are fragmented.** Research, plan and implementation are each split into 3–5 beats. Each beat restarts, re-grounds (SHA, staleness check) and posts a progress comment, and each costs a wake.

---

## 3. Ticket and plan shape

- **LIN-3133.**
  - A 15k-character description for an inert 8-line change. It has:
    - a strategy-framing section ("cost of doing / not doing");
    - a 12-row "bounded class" table;
    - a named "Decision (a)";
    - a JSDoc constraint to avoid tripping a source-scanning test.
  - The research, plan, plan-review and review comments add about 25k characters more.
  - **This is clearly over-specified.** The planning depth is that of a design review; the risk is zero.
- **LIN-3131.**
  - The description is lean, because it inherits LIN-3059's plan.
  - The *review* comments are 11–12k characters each, with:
    - mutation tables of 20+ rows;
    - a "What CI did not prove" ledger;
    - an L1–L4 ledger with inside/outside classification.
  - The review format is the over-specification here: long, formal and rule-bound. The rules turn test-only suggestions into full round trips.
- **LIN-3124.**
  - A 46k-character description, with decision records D1–D18 (plus D2a and the D14→D17 addendum) and residuals (a)–(c).
  - Planned "fidelity findings" F1–F7, a T1–T28 test catalogue, and N1–N9 / L1–L9 ledgers.
  - About 270k characters of comments.
  - The *design* work is mostly warranted: rotating refresh tokens with a spend-once invariant are a place where one-copy/zero-copy bugs silently lock users out.
  - **Two things are mis-fit:**
    1. The risk model assumes a multi-user legacy estate. The owner's own ruling says there is effectively one legacy user, yet "legacy byte-identical", a feature flag and a rollback script were kept as constraints. They drove extra code, extra review blockers and plan passes 3–5.
    2. Plan-review goes to proofreading level. A whole frontier-tier pass (pass 6) returned Request Changes for a count stated as 1 instead of 0 in the prose of one test case.
- **Loop bounds.** The "Con ruling" loop bounds did work: "any further blocker at this seam parks for John". But the bound arrived at pass 4. By then the plan had consumed about 5 revisions.

---

## 4. Comparison: John driving one agent

| Example | Fleet (wall-clock) | Fleet (queue items) | John + one agent (plausible) | What the fleet bought that John wouldn't get |
|---|---|---|---|---|
| LIN-3133 | 60 min, unattended | 41 | **10–20 min**, or folded into T3 at 0 extra | Nothing material. A read-scope 403 witness (nice to have). |
| LIN-3131 | 130 min, plus upstream plan | 38 | **1.5–3 h** attended | Several regression tests pinning session-derived authority. Doc wording caught before merge. No production bugs found. |
| LIN-3124 PR3 | ~6h active to merge-ready, plus ~5h of late plan passes, plus ~1h human wait; unattended | ~35 during PR3 alone | **1–2 days** attended. It would be smaller if he dropped legacy support up front | **Real value:** about 7 credential bugs caught pre-merge, including silent credential deletion and a refresh-token double spend. John would probably ship some of these and find them in production over days. |

**The honest framing**
- **Throughput versus attention.** Unattended, the fleet's wall-clock per ticket is not bad. John's "a task takes far less" is right for *his* time on small tickets, but the fleet uses almost none of his time.
- **The real waste** is tokens, and the elapsed latency of serial ceremony: 41 dispatches for 8 lines.
- **On the one high-risk ticket, the fleet's independent review is worth its cost.**

---

## 5. Verdict and simplifications, ranked by impact

**Verdict: mixed.** The fleet is legitimately careful where it matters (credential cutover). It is greatly simplifiable everywhere else. Its large-ticket *size* is inflated by design constraints nobody re-priced after the owner's rulings.

### 1. Scale the process to a risk tier, decided at triage

**The change.** Three lanes:
- **Tier 0: inert, mechanical or under ~50 lines.** One implementation beat covering plan, code, test, PR and CI. No research, plan-review or review. Auto-merge on `ci-success`.
- **Tier 1: normal feature work.** A plan inside the implementation session and one review. Conditional approve allowed.
- **Tier 2: credentials, auth, data migration.** Today's full process.

**Estimated saving**
- About **85–95% of tokens** and about **45 of 60 min** on LIN-3133-class tickets.
- About **40–50%** on LIN-3131-class tickets.

**What you'd lose.** An independent check on trivial changes. On LIN-3133 both checks found nothing.

### 2. Put the orchestrator on a diet

**The change.**
- The autopilot is 36–59% of every ticket's tokens.
- Collapse the 3–5-beat splits into 1–2 beats per phase, which means fewer wakes.
- Run routing and wake handling on a fresh-context session or a cheaper model, with state passed through the tracker rather than an ever-growing frontier-tier, high-effort context.

**Estimated saving.** About **25–40% of total tokens fleet-wide**, plus the per-beat re-grounding overhead: the SHA and staleness checks, and the progress comments.

**What you'd lose.** Fine-grained checkpoints and resumability mid-phase. PR3's failed the cheap tier beat is the case where a checkpoint helped.

### 3. Re-price design constraints against the real user base

**The change.**
- Make "who does this protect?" a required plan input.
- If the answer is John or a handful of users, drop legacy byte-identity, dual paths, flags and rollback scripts. Accept "reconnect" as the recovery.

**Estimated saving**
- About **30–40% of PR3's code and tests**. The rollback script and its test alone are 344 lines.
- Roughly half the review blockers (3, 5, 6 and 7 sit in mixed-legacy or rollback code).
- Plan passes 3–5.

**What you'd lose.** Safe rollback, and continuity for any real legacy users. That is real once there are external users, so revisit at launch.

### 4. Cap plan review at 2 rounds; text fixes need no re-review

**The change.**
- After pass 2, open design questions go straight to John as a ruling, and are not revised again.
- Text-only or wording corrections are applied by the planner and not re-reviewed.
- Reviewers flag prose inconsistencies as non-blocking.

**Estimated saving.** For LIN-3124: passes 3–7, about 5–8h of elapsed time and 4–5 frontier-tier review sessions.

**What you'd lose.** Pass 4's real double-copy bug would have had to be caught in code review or by a test instead. PR3's review demonstrably catches this class.

### 5. Loosen the review and close-out ledger rules, and drop census pins

**The change.**
- Allow close-out to apply wording fixes and add test-only ledger items without another review round.
- Let reviewers choose Approve-with-follow-ups for surviving mutations on already-correct code.
- Retire global count and census pins such as the DI-param total, count-pins and credential-census.
- Name tests by behaviour, not checkpoint.
- Keep plan-label jargon (D7/N1/F4) out of production comments.

**Estimated saving.**
- About **40% of LIN-3131's wall-clock and ~26% of its tokens.**
- Removes a whole class of "bump the literal" tickets like LIN-3133.

**What you'd lose.** Some regression tests arrive later, or never. Census pins do catch accidental DI or import drift, but an import-graph lint is cheaper.

### A secondary note on model routing

Having the cheapest tier implement the riskiest code, then paying for 3 rounds of frontier-tier review, is backwards for Tier 2. On PR3 the cheap-tier beats failed and a frontier-tier session took over anyway.

For Tier 2, have a strong model implement once and review once. For Tier 0 and 1, the cheap implementer is fine.
