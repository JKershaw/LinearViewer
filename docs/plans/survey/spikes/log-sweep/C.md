# Log sweep C: log.md 1966–2741 (5–7 Nov)

Checked against the kept list. One caveat first: this slice's three papers (`task-size-and-cost.md`, `cleaner-than-it-started.md`, `the-place-became-somebodys-job.md`, which is essay v4 "Clearing up as it goes") and `tasks-are-tasks.md` are on `origin/main` but **not in this branch's `docs/papers/harbour/`**. I checked them at `origin/main`. Most of the round's evidence (tidy-first, after-step, census 56 → 6, pair baseline, the 50-comment cap, Hanoi, the two dials, network of tasks, photocopy, plain briefs, the clock drift) is captured there, so it isn't listed below. Several items are also in `notes-2026-11-05.md`, `place-ledger.md`, `prompt.md` or `discussion.md`. None of those is on the kept list, so they're flagged rather than counted as kept.

## Decisions

- **[decision]** John, 6 Nov: "let's not undersell that this actually works". Even if per ticket it is "simply not making things worse", "it still means the trend is towards a better, simpler, easier to maintain codebase". Also: the operator's mistakes "are what I'd expect to happen when you're holding the reins … that's why we're moving those points you hold into Harbour, so agents at this altitude don't need to provide judgement". Later: the paper "reads like not much improved". `log.md:2430`, `log.md:2551`. *Partly captured* in the essay on main (it cites log:2430) and in paper v2 Finding 9 (the structure thread). John's register preference for write-ups (state the direction as plainly as the limits; don't undersell) is in no kept file.
- **[decision]** John on integration: the human calls stay human, either "a human call (nice UI, etc)" or "like this session runs: a human instructs/gives authority to an agent". So granting authority is itself a human call. First explicit grant, 6 Nov 08:50: "I grant you authority" for LIN-4313, meaning an owner's proxy token may start an orchestrator through the Periodical mint with "+ Autopilot". `log.md:2393`, `log.md:2404`, `log.md:2413`. *Partly captured* in paper v2 Finding 9, as the operator's thread. `integration/design.md` says nothing about authority grants as a human call, or about this grant.
- **[decision]** John: essay v1 "doesn't express the spirit of his forcefield metaphor". Claude's reading was put to him for correction: shapes of different complexity, each held by something (pipeline → passage → John by hand), dissolving when the hand moves. So the question is "what holds the more complex shape, so the hand can move without it dissolving?", and the hand moves from holding to shaping. `log.md:2645`. *Missing*: essay v4 doesn't carry the holding → shaping framing, and no kept file records it. Unsure: no record that John confirmed it.

## Lessons

- **[lesson]** The scope-call rules learned 5–6 Nov:
  - a partial move leaves a ratchet, with no size exemption (`2030`, `2317`);
  - a proof-of-no-change rule invites copies, so pin wording, not wrapping, and keep the guarding test (`2044`, `2179`);
  - a rule about counts invites copies, so map names instead (`2344`);
  - ask whether a witness can fail at base, and mutation-check "the existing tests witness it" (`2180`, `2310`);
  - pieces sharing a hand-edited list run in sequence (`2194`);
  - a sweep starts by writing its check: its hit list is the work list, and a grep is not done (`2389`);
  - write the scope as instructions, not descriptions, because the scope becomes the builder's comments (`2302`, `2479`);
  - retire a claim a piece makes false, and cite by symbol (`2270`);
  - a piece narrowing a witness tests what it stops witnessing (`2164`);
  - check a blind read's claims before filing a tidy-after (`2115`);
  - a better-better tidy-after gets no tidy-after of its own (`2167`);
  - fix a gap in the fake, never bend production (`2529`);
  - one ticket per concern (`2239`).

  *Partly captured.* The full list is only in `notes-2026-11-05.md:134-148,235`, which is not kept. `journey.md:51` keeps only "finish the move", and the essay keeps the ratchet and "big moves early".
- **[lesson]** The instruments see different things. Blind reads judge copies inside one change. They can charge a change with debt it inherited: Drift found LIN-4247 added no copy, yet both blind reads scored it mixed. Seams sees couplings between areas and map gaps, such as `lib/stage-writes.js` growing the catch-all, which both blind passes missed. Drift checks against the base. Keep all of them. `log.md:2285`, `log.md:2303`, `log.md:2489`. *Partly captured* in paper v2 Finding 3 (the junk drawer). The inherited-debt overcharge isn't recorded.
- **[lesson]** A check should count behaviour, not spelling. A census of literals (F3) blocked a fold that would read better. Hand-kept counts in prose ("three/four/five enqueue routes", in 8–10 places, 4 stale) are the case for derived lists. `log.md:2476-2477`, `log.md:2546`. *Partly captured*: the essay's "lists the code works out for itself". The literal-counting trap is missing.
- **[lesson]** Writing the papers and essays:
  - The defensive register came from the house process: a per-claim accuracy reader, and "does not support" for every source. The cure was a hedge ledger, with the limits gathered in one section (`2638`, `2644`).
  - Write the whole brief before the writer starts. Mid-flight additions made v2 patchwork, and v3, written to a checklist, kept the seams (`2681`, `2708`). When John's points arrived after dispatch, the run was stopped and redispatched with one brief rather than a follow-up (`2725-2731`).
  - v4 worked: one writer on `opus` as a `custom` dispatch, not autopilot, from a plain brief of about 440 words parroted against John's words, with John reading before merge. A length rule was not needed (`2721-2740`).

  *Partly captured.* The essay's frontmatter shows opus/custom, and `proposals.md:697` has the plain-brief line. The defensiveness cause and the restart-rather-than-amend practice are missing.
- **[lesson]** After-questions sent into the builder's session after merge kept finding root causes in the operator's own scope: "pin wording, not wrapping"; two unpinned views; "the line should have been the behaviour in any spelling". q7 went to tidy-afters, q8 to a stopped step, and a narrower-scope q7 was added. `log.md:2153`, `log.md:2257`, `log.md:2381-2389`. *Partly captured*: the papers count after-answers, and the question texts are only in `prompt.md` (not kept). Unsure whether Harbour's later stages replaced this.

## Facts

- **[fact]** Research-branch handling. Never `git merge origin/main` into `claude/cool-rubin-6acj5j`, which carries unrelated unmerged code; it conflicted across many files. Bring main's notebook edits back with a path-limited `git checkout origin/main -- docs/plans/survey*`. `log.md:2429`, `log.md:2494`. *Missing*: `journey.md:108` and `integration/design.md:210` say the record lives on the branch, but not how to sync it safely.
- **[fact]** GitHub gotchas.
  - No `pull_request` CI run starts on a conflicted PR (`mergeable_state: dirty`), so an empty commit won't help. Merge main and re-run.
  - A push reported as rejected ("fatal error in commit_refs_rules", during GitHub 502s) may have landed. Check the PR head before retrying.

  `log.md:2193`, `log.md:2197`, `log.md:2201`. *Missing.*
- **[fact]** The docs anchor resolver now excludes the whole of `docs/plans/survey` as frozen history (LIN-4314), so citations in the notes and prompt docs there are unchecked. `log.md:2418`. *Missing.*

## Open

- **[open]** John's future experiment, a candidate paper. Run the same tasks on two copies of one codebase, one tidy and one with planted duplication, comparing cost, review rounds and escaped defects. Blank, greenfield and already-tidy repos serve as controls, and as a test of the prompts' generality. The hypothesis is that copies cost reliability more than money. `log.md:2127`. *Missing* from `proposals.md` and every kept file (one line in `notes-2026-11-05.md:186`).
- **[open]** Backlog tickets filed in this slice. No commit on main as of 25 Nov for LIN-4297, 4301, 4318 or 4320:
  - LIN-4297: `loadWorld` as the cheap path. It carries the residues.
  - LIN-4301: stale status claims.
  - LIN-4302.
  - LIN-4318: mint by id. Today the session lane decides the grant from browser-posted prompt text, which Drift run 5 called "the larger item by consequence" (`2543`).
  - LIN-4320: enqueue-route prose.
  - LIN-4326 and LIN-4327: paging.
  - LIN-4256: the in-progress rule split across the server/client seam.

  `log.md:2445`, `2462`, `2531`, `2546`. *Missing* from kept files. They're listed only in `discussion.md:470-471,802-807`.
- **[open]** Notebook residues, pulled but not filed, still true on `origin/main` (checked):
  - `lib/stage-writes.js` has no place in `docs/areas/areas.json`, which is Seams's "worse as a map".
  - `public/prompt-section.js` is 2,957 lines. Moving question-slot keeping and the Go/run lifecycle out of the closure is where LIN-4293's stopped step 7 belongs.
  - It has a possibly dead `__autopilot__` branch (5 refs).
  - `public/ship.js:1154` `sel.remove(1)` is an untracked fake-DOM stop.
  - `focusInCard` adds a cross-script `window.QuestionCards` read (the F6 knot).

  `log.md:2202`, `2219`, `2286`, `2311`, `2388`. *Missing* (partly in `notes-2026-11-05.md:212-218`).
- **[open]** Ticket-history and stale-status comments are a house habit: raised with John, not acted on.
  - Comprehension-Debt R1 found about one stale status claim a day, each lowering a reader's caution.
  - Allow-list reasons cite tickets and lines, and no guard catches a stale reason.

  `log.md:2238`, `log.md:2268`, `log.md:2364`. *Partly captured*: the rule is only in notes, and LIN-4301 is open. Unsure whether the 14 Nov notes work subsumes it.
- **[open]** The Models page counted an Opus after-answer as implementation spend, so our own follow-ups polluted a product readout. `log.md:2165`. *Missing*. Unsure whether it's since fixed (paper v2 split the legs, but the page wasn't checked).

Read lines 1966–2741 in full; 15 gaps.
