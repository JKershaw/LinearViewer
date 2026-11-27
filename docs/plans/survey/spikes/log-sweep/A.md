# Log sweep, slice A: log.md lines 1–860 (2–4 Nov)

Checked against the kept files in the brief. These cover 2–4 Nov in two lines (journey.md:21), so nearly everything below is missing from them. Note: `review-notes.md` §6b–7c (lines 91–144, **not on the kept list**) summarises much of this slice, and `prompt.md` (not on the list) holds the Survey prompts and the round-3 after-questions. If either goes too, the items below that cite them become fully missing.

## Decisions
- **[decision]** LIN-4167, quoting John: "No: keep the manual redeploy after green re-runs": "it is a sign of grit in the gears, so warrants human attention." Context: Railway deploys only on a green CI run, a re-run of a failed job doesn't deploy, and the next green commit deploys everything. `log.md:418` (context 280). *Missing* (only in review-notes.md:120; notes-review.md:27 has the symptom, not the ruling).
- **[decision]** On the Survey prompt, quoting John: "perhaps our prompt is too guiding?" and "We want a pretty free form answer, and the temptation will be to specialise for Harbour as that's the shape of the code we're working with." `log.md:452, 458`. *Partly captured in journey.md:21* ("loosened to an open answer"). Missing: John's words, and the rule not to specialise the Survey for Harbour.
- **[decision]** John's after-questions: a builder's after-answer is "a second place to find a tidy" (tidy after as well as tidy first). He added "what would you tidy now?" and "if this area of code were how you'd want it, what would this ticket have been?" `log.md:387, 515–533`. *Missing* from the kept files (the template is in prompt.md:27–28).
- **[decision]** Rebuild 2's gate, quoting John: "Accept a shorter window size, and you can use the railway cli to access mongo." The builders didn't know the CLI reaches production, the same gap as LIN-4167's research (`log.md:414`). `log.md:858`. *Partly captured in journey.md:221* (`railway ssh`). Missing: builders have to be told the CLI exists, or they mark checks "NOT RUN: needs production access".
- **[decision]** Disk, quoting John: "disk space isn't a concern". Clones share unedited files, and most of the host's used space is personal data. Rulings: records are kept 7 days, and the clone and TMPDIR are pruned at 24 h. `log.md:205, 407, 418, 560`. *Partly captured in 2-cleanup.md:99* (the 7-day reaper only).
- **[decision]** Quoting John: "Happy for you to file and dispatch a few small tickets to address these quality of life issues as we go … we can continue to use the survey." This permission covered tickets made from builders' friction. `log.md:597`. *Missing*; possibly superseded by "show John every ticket" (journey.md:338). Unsure.

## Lessons
- **[lesson]** On unattended runs, book the next wake-up *before* any step that might block on a permission prompt. The 2–3 Nov overnight run stalled from 22:25 to morning for want of one. `log.md:197`. *Missing*.
- **[lesson]** Follow-up rule: ask only sessions whose ticket is Done and whose lineage autopilot has ended (one question reached a live build). The allowed exception: the lineage is blocked for days, the workers are finished, the question goes quiet, and nothing goes to the parked worker. `log.md:102, 680, 792`. *Missing*.
- **[lesson]** A read-only forecaster's misses fall in one class, things learned only by drawing or running: CSS draw order, pixel budgets, test seeding, the runtime cascade, and a macOS-only witness on Linux CI. Survey v2's "what couldn't you check, and how could the builder check it early" paid off on LIN-4110 and LIN-4164. `log.md:14, 276, 284, 564`. *Missing*.
- **[lesson]** Two instruments see different halves. The census catches decisions *spelled* the same; builders catch decisions *meant* the same but spelled differently (parent and children held in 3–5 structures, the ruling count in 4 places). `log.md:242`. *Missing*.
- **[lesson]** Asked openly, "do first" was always a *preparation*, never a tidy: measure, experiment, write the failing test, take an inventory, or ask John. Writing it onto the ticket changed what happened: LIN-4127's witness order avoided the trap, LIN-4196's baseline found the fake score, and rebuild 2's plan followed the Survey's order. `log.md:476, 840`. *Missing*.
- **[lesson]** The one-owner pattern held for 14 of 14 builders. Asked "if this area were how you'd want it", each named one owner, one seam or one interface (one predicate, one cache shape, one posting helper, one flag parser, a `main()` seam), and each sized its ticket at a fraction of what it became. No Survey version asked "which things here do the same job through different interfaces?". `log.md:496, 707, 811`. *Missing*.
- **[lesson]** The commonest quiet failure was a check that can't fail. There were five cases: an env pin in the shared test preload made the LIN-558 guard vacuous; a replay change list *allowed* differences but never *required* them, so a reverted fix passed; "it runs" was read as "it passes"; the mutation runner counted a killer that was red on unmutated code as a kill for every mutant (a fake score); and goldens covered cases production never posts. The question to ask: does the check you rely on actually fail when it should? `log.md:669, 700, 746, 772, 812, 843`. *Missing*.
- **[lesson]** Proving costs more than changing. The "before" must be a two-way spec with after-values, and the corpus must contain each case. Re-recording goldens at HEAD erases the change list. A replay under a rate limit and a frozen clock silently recorded 429s, so run it twice. `log.md:706, 796–797, 842`. *Missing*.
- **[lesson]** A baseline figure depends on where you run it. simple-dispatcher's main showed 1, 4 or 119 failures by location (workspace clone, `/tmp`, TMPDIR inside `state/`). The "46" copied from a Survey onto LIN-4181 was untraceable. Record the location with any baseline. `log.md:619, 663`. *Missing*.
- **[lesson]** A conflicting PR starts no CI run. Check `mergeable` before reading the silence as slow CI. `log.md:673`. *Missing*.
- **[lesson]** A "no" ruling leaves a ticket with no owner once its autopilot has ended: LIN-4167 sat In Progress. `log.md:498`. *Missing*.
- **[lesson]** Close-out files follow-ups even though the bar says "listed, not filed" (tidy 5, then LIN-4176 → LIN-4191–4194). It's product behaviour, not a brief problem. `log.md:695`. *Partly captured in journey.md:58* ("filing work as new tickets" hasn't worked). The close-out cause is missing.
- **[lesson]** A "Done when" that asks an implementation session for a post-merge live witness doesn't fit its remit. Make it its own step with a named owner. `log.md:589`. *Partly captured in 0-ledger.md* row 79 (the NOT RUN pile). The cause is missing.
- **[lesson]** A safety classifier stopped LIN-4165's close-out because it printed other tickets' oplog text. Read only counts and cursors there. `log.md:431`. *Missing*.

## Facts
- **[fact]** Quiet follow-up (LIN-4166): `followUpTo` plus `subscription:'none'` wakes nothing on the lineage, and it's refused without `followUpTo`. Gotcha: a `'none'` follow-up to a worker its autopilot is parked on silences that worker's real terminal (documented, not guarded). The dispatch read view shows `subscription: null`. `log.md:422, 429, 435`. *Missing*: docs/proxy-integration.md:154 lists only `terminal-only` and `everything`.
- **[fact]** How resume works after LIN-4164: the reap drops the record (7 d) and the clone (24 h) separately. The transcript stays in `~/.claude/projects/`, and `claude --resume` works across a deleted and re-created cwd, so a resume re-clones at the same path (LIN-4171). `dispatchedPrompt` is cleared at clone reap (`sessions.json` had grown about 20×). Whether a failed launch shows as FAILED is decided by the terminal driver (LIN-4175). `log.md:201, 408–409, 560, 563`. *Missing*.
- **[fact]** Harbour feedback limits:
  - a 100/min per-IP rate limit, with non-terminal posts not retried, so a burst could starve `[done]`;
  - the channel has a 2,000-character cap, one try, and drops unknown kinds silently;
  - the feedback token is single-use, but batch tokens aren't.

  `log.md:469, 486, 721, 800`. *Missing*. Unsure whether still current.
- **[fact]** simple-dispatcher gotchas:
  - importing a helper from `config.js` makes a module start loading `.env`;
  - four `watch-restart` fixtures copy `instance-guard.js` alone, so a new require there breaks them;
  - terminal phases are written inline in about six places, although `phases.js` owns the phase rules. The builder's tidy: one `transitionToTerminal(sid, phase, reason)`.

  `log.md:624, 702, 803`. *Missing*. Unsure whether the phase tidy has since been done.
- **[fact]** Each follow-up's completion queues a wake that resumes the lineage's autopilot ("a child reached a terminal outcome"), unless it is sent quiet. `log.md:53`. *Missing* from the kept files.

## Open
- **[open]** "Should this session be running?" S3e's autopilot started 4.5 h before its prerequisite landed, then the stall failsafe killed it for waiting. It was never filed (the fourth follow-up of round 1). `log.md:103, 208–210`. *Missing*. Unsure whether it was addressed later.
- **[open]** Filed, status not checked:
  - LIN-4174: the reply box and chat-tools `send_follow_up` can't send a quiet follow-up;
  - LIN-4191: the run page windows cost differently;
  - LIN-4192 to LIN-4194: close-out's follow-ups.

  `log.md:423, 693`. *Missing*. Unsure.
- **[open]** Builder tidies never filed:
  - a route manifest (routes declare the credentials they accept, and each is registered once for every census to read);
  - scripting the A/B/C baseline;
  - giving the system suite its own ephemeral ports and child processes;
  - a harness-neutral usage-records module.

  `log.md:674, 801, 808`. *Missing*.
- **[open]** A read-only aggregate route (`GET /api/proxy/costs`, decision 10 in costs.md) would let the "NOT RUN: needs production access" checks run through the proxy without handing out database access. `log.md:813, 834`. *Partly captured in 0-ledger.md* rows 31 and 79 (the access sweep, the pile). This remedy is missing.

Read lines 1–860 in full; 29 gaps.
