# Break read: integration design

*18 Nov. Adversarial read of `integration/design.md` against the census (C1–C5), main at `6f6c5d2`, and simple-dispatcher at `cf6369d`. [checked] = I read the line. [my reading] = inference.*

## Breaks

**1. Slice 1 cuts the comment thread out of the brief while verdicts, plan comments and rulings still live there.** (cat 5, 6)
- Design §3 and slice 1: the brief comes from records, the plan part from "the description's plan section alone". The prompt line "read the current description and comment thread" becomes "the records are the source" (C4-31).
- Today the brief model folds every comment in: "comments, stage write-ups and subtask states are amendments … the most recent and specific signal wins" (`lib/brief.js:29-60`) [checked]. The pass-by-reference line is at `lib/prompt-formatters.js:168-172` [checked].
- Until slice 2, verdicts are still comments. Until slice 3, plan comments count as the plan (`run-trail.js:194-197`, C4 intro). Until slice 4, ruling answers are comments (C2-22, C2-23). After slice 1 none of these reach the brief, and the prompt no longer sends the agent to the thread.
- The same applies to every other workspace, whose tasks have no imported records at all [my reading].
- Why it matters: §10 says "After slice 1, verdicts are still read from comments … as today". Code reads them that way. The agents won't.

**2. `by` from the credential breaks on simple-dispatcher's held sessions and on tokens that have no dispatch.** (cat 3, 4, 6)
- §2 says the dispatch mint records the item id and stage, and that "this is the one change to the token model."
- The mint runs *before* the row exists: "the prompt finalized BEFORE the row is written" (`lib/dispatch-factory.js:14-20`; `proxy-preamble.js:534` "BEFORE addItem") [checked]. So the item id has to be written back after insert, or allocated early. The design doesn't say which.
- SD's SIGNAL path writes a follow-up into a live held session (`sd:dispatcher.js:893-905`) [checked]. The broker keeps its first working token for the whole process (`sd:harbour-token-mcp-server.js:124-140`) [checked].
- So the leftover step (a follow-up into the build's own session, `lib/dispatch-leftover.js:4-7` [checked]), ruling resumes and CI wakes all write as the *original* row: `by: implementation`, on the build's run. §4's "run record per taken row" then gives the leftover row a run that never receives a write.
- Some tokens have no item at all: the `+proxy` copy token (`prompt-proxy`, `routes/proxy-tokens-admin.js:24-44, 288-300`), and the runner and agent copy mints (`:176-203`) [checked]. Their writes would have no `by`, so the shape check refuses them, or they need a rule the design doesn't give.
- `via` = "the token label" carries nothing. Labels are per-site constants (`dispatch-bootstrap`, `wake-bootstrap`, `refire-broker`; C5-C07, `proxy-preamble.js:512`) [checked].

**3. The actor list doesn't cover the stages that will write.** (cat 4)
- §2: "A write's `by` is the stage's actor". The layer's actors (layer §3.2): design, plan-review, breakdown, survey-task, survey-place, scoping, implementation, leftover, review, blind-read, close-out, autopilot, John, Harbour.
- Code has 20 stage kinds: blocked, bug, **plan**, look-into, triage, breakdown, research, scoping, design, spike, context, plan-review, implementation, review, close-out, **retrospective-audit**, retro, survey-task, survey-place, blind-read (`lib/prompts/stage-kinds.js:39-570`; `PROMPT_TEMPLATES` keys) [checked]. Periodical, custom and wake rows also run (`lib/run-live-wait.js:15-17`) [checked].
- So the plan stage (which writes plan records in slice 3), the audit and Periodical Stage 2 (rewritten in slice 1 to write findings, Appendix C1 09/10), and bug, research and spike all get a 422.
- "A signed-in person writes as `john`" doesn't hold either. Harbour is multi-account: free-tier runs per account, and a workspace owner is a role edge (CLAUDE.md). The rulings page's `to: john` has no meaning for any other user. That needs an account-to-actor mapping, which the design doesn't name.

**4. Slice 1 needs area records, which arrive only in slice 5.** (cat 5)
- §9: slice 1 imports 118 Waiting entries as findings "`in` and `to` its area". Slice 1 also sends finds to areas, and brief part 5 lists the overlapping areas.
- The layer refuses an `in` or `to` that doesn't resolve (layer §3.3) [checked]. Area records are "written from `areas.json` at boot" only in slice 5 (§10 row 5) [checked].
- Task `paths` are "blank until a stage sets them" (§7) [checked], and no slice names the stage that sets them. Until one does, a finding addressed to an area reaches no brief. Today every stage reads Waiting in full (C1-07).

**5. The blind read loses its isolation.** (cat 4)
- Today the blind read gets no brief, by design: "No brief, issue-detail … each would point the reader at the ticket it must not read" (`lib/proxy-preamble.js:270-276`) [checked]. It must not read "any ticket, the area notes" (`lib/prompt-template-defs.js:1071-1076`) [checked].
- §3 builds a brief for every caller, `req.proxyStage` included, and §2 puts no limit on reads. The layer's `blind` flag strips only verdicts and the accounts of verdict-writing stages.
- So a blind read can see `asked`, the plan, review's findings (slice 1 makes them findings) and the imported Waiting findings.

**6. A caller not switched: Task Chat and Flight Companion read the brief cache directly.** (cat 2, 6)
- `get_brief` and `get_recap` are cache-only reads of `briefCacheStore` and `recapCacheStore` (`lib/chat-tools.js:290-297, 1563-1565`) [checked].
- Slice 1 retires the brief cache (C4-37). Appendix C4 keeps row 44 as "pointers to the same door". It is not a pointer to the door. After slice 1, `get_brief` returns `missing` for good, or fails if the store is removed from `server.js`.
- `GET /brief?noRefresh=1` (cache-only; `routes/proxy-compute.js:1385-1393` [checked]) is still in the close-out prune text until slice 3 (C4-04). With no cache it has no defined meaning.

**7. The question protocol spans two repositories, with no order and no compat window.** (cat 2, 5)
- Slice 4 retires the predicate and SD's `DECISION:`/`WITHDRAW:` "in the same slice".
- SD deploys on its own (`watch-restart.sh`, SD CLAUDE.md). Until it does, SD keeps posting `kind:'decision'` feedback (`sd:hook.js:784, 828`) [checked], and nothing in Harbour reads it. Questions vanish silently.
- These callers are not in Appendix A:
  - the runner kit's `decision` kind (`lib/runner-kit/runner.mjs:258-265`) [checked];
  - its parity contract (`lib/runner-kit/contract.json:316-325`) [checked];
  - `scripts/false-live-rows.js:39` and `scripts/ticket-closed-clear-lin3399.js`, which import `task-decisions-store` [checked].

**8. The ruling resume in slice 4 has nothing to run it.** (cat 5, 6)
- §5: "Harbour wakes the asking run if it is parked waiting (C3-51)". Slice 4 retires the browser resume (B10). Its witness says "answered and resumed".
- C3-51 can't tell that a run is parked: "A run waiting on a person, ended, closed or aborted is not live" (`lib/run-live-wait.js:17-18`) [checked].
- The design names the Records → Runs wake edge only for slice 6, which is optional (§10 knots). If slice 6 never lands, an answer resumes nothing [my reading].

**9. Areas and lessons move from per-repo files to a per-workspace store.** (cat 4, 6)
- The pointer "Names no repository (each keeps docs/areas/)" (`lib/prompt-formatters.js:611-614`) [checked]. Notes live in each checkout, and rows carry a `repo` (C3-44).
- Records are scoped by `urlKey` (§1). Slice 5 writes area records from Harbour's own `areas.json` at boot. Into which scope? A workspace with several repos, or a repo other than Harbour, gets Harbour's areas or none.

**10. The PR-set rule is workflow, not shape.** (cat 6)
- §4: "The shape check replaces the proxy's blind-read guard (C3-17)".
- The guard also refuses unless the read names exactly the landing PRs taken from the trail (`routes/proxy-writes.js:773-787`) [checked]. The store checks shape only, so this rule is lost unless Harbour keeps it in the route.

**11. The run record can't carry what §4 needs.** (cat 3, 6)
- The layer's `run` has only `stage`, `claims` and `account`, and refuses unknown fields (layer §3.2–3.3) [checked]. "Its run is the item id's run record" (§2) has no join key, since the record holds no item id.
- §4 ends every run `done` on a terminal marker. `[failed]`, `[aborted]` and `[skipped]` are terminal too (`lib/dispatch-terminal.js:37-38`) [checked], and `[skipped]` means a human is still in the session.
- A run record per taken row also covers wake, leftover and periodical rows, whose stages aren't actors (see break 3).

**12. "Nothing reads these back" is false.** (cat 6)
- §7 says nothing reads the summary comments Harbour posts. But the selector view reads the 3 newest comments (C4-21, kept in slice 3 "if routing still reads ticket text"). Scan and task chat read every comment (C4-47, kept).
- So after slice 2 a verdict reaches the selector twice, as facts from records and as a summary comment. And scan can raise questions from Harbour's own summaries [my reading].

**13. A route left running twice after slice 6.** (cat 1)
- Slice 1 turns an ask to the parent into a finding `to` the parent (C1-37). The up-chain wake is kept (C1-48). Slice 6 adds "wake a parked run on a record to its task".
- A child that writes the finding and then parks `[blocked]` wakes its parent twice. The two compare-and-swaps are unrelated (per item, `terminalWakeItems`, C5-B03; per run and record, §6) [my reading]. Not named as kept.

**14. More callers of retired modules not in Appendix A.** (cat 2)
- `prompts/blind-read-words.js` (C3-41, retired whole in slice 2) is imported by 15 files. `BLIND_READ_KIND` is the dispatch kind, used by `recent-runs.js`, `run-view.js`, `code-routes.js`, `llm-jobs.js:1,49` and `stage-kinds.js` [checked]. Only the words can go.
- Ship Biscuit reads task snapshots for "board Before→After" (`lib/ship-biscuit.js:28`; `server.js:3444`) [checked]. Slice 3 retires snapshots (C4-41, C4-42) and says nothing about this page.
- `scripts/replay-brief.mjs` and `scripts/eval/lin-263-spike4.mjs` import `lib/brief.js` and `lib/recap.js` [checked].

**15. The knots are understated.** (cat 6)
- Slice 1 changes `recommendation-facts.js` (C1-28) and the pages (C1-32, §8). By `areas.json` those are LLM & prompts and Front end, so slice 1 already adds LLM & prompts → Records and Pages → Records [checked: `docs/areas/areas.json`].
- The design lists LLM & prompts → Records only under slice 3, and Pages → Records under slice 2.

**16. The design contradicts itself.** (cat 6)
- The recap model is "kept for now … swapped in this slice" and is a "path kept on purpose (it goes in slice 1)" (§10). A path that goes in the slice that keeps it is not kept.
- C1-07 (retired in slice 1) and C5-A06 (slice 5) are the same lines, `prompt-formatters.js:606-620`. The 386-byte pin on them (C5-A17, placed in slice 5) has to change in slice 1 (`tests/unit/lin-4377-area-notes-pointer-bytes.test.js:17-24`) [checked].

**17. The kept plan part costs a model call on every brief read.** (cat 4)
- In slices 1–2 the plan part is "today's model distillation", and the brief cache is retired in slice 1. So every `GET /brief` makes an uncached LLM call that counts against the free tier. Today a fresh cache hit is free (`proxy-compute.js:1373-1395`) [checked].

## Simplifications

- **Quote the plan section verbatim** in slices 1–2. `extractPlanSection` exists (C4-06). That needs no model, no cache and no cost, and matches "no model smooths it" (§3). It also removes break 17.
- **Move area records into slice 1,** written from `areas.json`, and drop the boot sync from slice 5. That fixes break 4.
- **Drop `via`,** or take it from `parentTokenId`. Labels carry nothing.
- **Derive the stage from the row** with the existing `lib/item-stage-stamp.js` (`stampForItem`, `stampForWakeParent`) [checked]. Write run records only for stage rows, as `recent-runs.js` already filters. That avoids new actors for wake, leftover and periodical rows.
- **Keep the browser resume (B10)** for ruling answers instead of a new rule, and drop slice 6 until the need shows. §5 and §6 then share no half-built mechanism.

## Checked and held

- SD's broker forwards any `/api/proxy/*` path. A path allowlist was considered and rejected, so the new routes need no SD change. POST needs `X-Harbour-Intent: write` (`sd:harbour-token-mcp-server.js:160-173, 203-217`) [checked].
- `[pending]` and `[blocked]` are wake markers, not terminal ones, so a parked run's record stays open (`dispatch-terminal.js:37, 66`) [checked].
- The brief door exists as described (`proxy-preamble.js:278-280`) [checked].
- `recap-cache.js` stays (only the brief cache retires), so `hashContext` and `stableStringify` still serve scan, observer and chat [checked: importers].
- `area-note-format.js` has two importers, both listed (C1-04, C5-A21) [checked].
- All four `as-asked-seal.js` importers are listed in C4-17 [checked].
- A wake token takes its parent's stage today (`item-stage-stamp.js:51-55`) [checked], so the infrastructure for a per-follow-up stage exists. Break 2 is about SD's held-session token, not Harbour's mint.
