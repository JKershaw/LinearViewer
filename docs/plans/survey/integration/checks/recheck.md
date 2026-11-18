# Recheck: integration design draft 2

*18 Nov. A fresh reader of draft 2 against the three checks and `layer/design.md`. Code: Harbour main `6f6c5d2`, simple-dispatcher `cf6369d` (`sd:`). [checked] = I read the line. [my reading] = inference. A = answered, P = partly, N = not.*

**Tally: 43 answered, 13 partly, 1 not** (Q3-Q10 count as eight).

## Verdicts

| Find | V | Note |
|---|---|---|
| BR1 comments drop from brief | A | §3 keeps the ticket section and thread line to slice 4. But see new break 5. |
| BR2 `by` on held sessions, copy tokens | P | Factory follow-ups work (see B2). Wake rows name no run (new break 4). A dispatch-token write with no `run` has no rule (new break 1). |
| BR3 actors; `john` | A | 20 kinds [checked: `lib/prompts/stage-kinds.js:39-570`] + autopilot, harbour, persons. Drops `leftover` (layer change). |
| BR4 areas in slice 5 | A | Imported at slice 1; part 5 fallback flagged. |
| BR5 blind-read isolation | P | No brief, kept [checked `lib/proxy-preamble.js:270-276`]. Reads stay open: `show --task` gives asked, plan, findings. The blind flag hides only verdicts and accounts. §2 gives reads no `run`, so how a query knows it is the blind actor is unsaid (the token's `blind-comment` stamp could). |
| BR6 chat reads brief cache | A | Cache kept to slice 4. |
| BR7 two-repo protocol | A | SD and runner kit unchanged; scripts in slice 4. |
| BR8 nothing resumes | A | Browser resume kept. |
| BR9 per repo vs workspace | P | Left open in answers.md; design.md is silent. |
| BR10 PR-set rule | A | Stays in the route [checked `routes/proxy-writes.js:773-787`]. |
| BR11 run join, markers | A | `runRecordId`; marker as reason; `[skipped]` ends nothing. |
| BR12 summaries read back | P | Code readers skip the mark. Agents are still told to read the thread, so they read the summaries (new break 5). |
| BR13 double wake | A | §6 skips own children. |
| BR14 callers of retired modules | A | Placement C3-41, slice 2 row, slice 4 row. |
| BR15 knots understated | A | Four edges at slice 1. |
| BR16 contradictions | A | Recap in slice 4; pin changes in 1 and 5. |
| BR17 uncached model call | A | Cache kept. |
| B1 wake/custom rows' stage | P | `stampForWakeParent` walks to the parent but returns a write class, not a stage [checked `lib/item-stage-stamp.js:20-23, 51-55`]. `stampForFollowUp` uses the follow-up's *own* kind, not the parent's [checked :66-71]. A new helper returning `row.kind` is needed. Small. |
| B2 held session's first token | A | Holds [checked]: signal stores `{prompt, itemId}` (`sd:dispatcher.js:371`); a broker-armed hold injects a nudge naming the new item, and the session fetches that item's stored prompt (`sd:hook.js:874, 1199, 1212-1215`). Leftover goes through the factory (`lib/dispatch-factory.js:1366-1368, 1400`). Ids: today `_id` is made inside `addItem` (`lib/dispatch-store.js:755`), after `finalizePrompt` (`dispatch-factory.js:14-20`); passing a pre-made UUID is a small change. |
| B3 areas needed slice 1 | A | §9. |
| B4 regex vs prefix | A | Hand conversion, test. |
| B5 sibling has no task | A | Find-or-make by tracker id. New risks: new break 7. |
| B6 head lags verdict | P | The read exists: `readPrStatuses` [checked `lib/close-out-readiness.js:30-45`]. It fails open (`:43-44`) and uses a shared 60 s cache (`:77`). Worse, it pins the verdict to the head at write time, not the head judged (new break 3). |
| B7 blind read | P | PR-set rule kept; change id given. Isolation as BR5. |
| B8 plan-review needs plan | A | Plan slice 2, verdicts slice 3. |
| B9 amendments drop | A | Ticket section kept. |
| B10 John's door | A | Task page writes `by` the person. |
| B11 records with no reader | P | Parentless ended tasks reach the rulings page (slice 4), Home covers persons from slice 1. `to: harbour` still has no reader. |
| B12 own run | A | Preamble names it. The brief header can't (new break 6). |
| Q1 kinds per slice | P | The answer (surveys keep a one-line comment until slice 3) is in answers.md, not design.md. |
| Q2 wake stage, answer-wake | P | As B1. |
| Q3-Q10 | A | §6 "held waiting"; `via` import/scan; §2 find-or-make; moot; 20 kinds; run names itself; routes open; Harbour on merge. |
| D1 write gate | A | None on records. |
| D2 one resume rule | A | `on-answer`, flagged. |
| D3 PR set | A | §4. |
| D4 version check | A | Route rule. |
| D5 `john` | A | `person:<accountId>`. |
| D6 kinds as data | P | `kinds.json` is data. Actors come from `PROMPT_TEMPLATES`, a JS module, and no `actors.json`. Where `blind` is marked is unsaid. |
| D7 port the model | A | Written fresh. |
| D8 `scope` clash | A | `workspace`. |
| D9 tracker backup/sync | P | Run-end line covers what is open. Inward comments can't be told from agents' (new break 2). |
| D10 `via` autopilot | A | Writes as itself. |
| D11 length | A | 17.3 KB. |
| D-missing: real work | A | §11.1, never gating. |
| D-missing: half-switched build | P | §10 says each slice leaves Harbour whole. Not how a slice-building task runs when the code changes under it mid-task. |
| D-missing: safety as tasks | A | §9. |
| D-missing: Yap | A | §1. |
| D-questions dropped | A | 11.1-11.3 gone or decided. |
| D-question: write gate? | A | Moot. |
| D-question: knot cost line | N | §11.6 still says "accept them all" with no line on what each costs. |

## New breaks (ranked)

1. **A run id is checked only for liveness and workspace.** §2: "Harbour checks that row is live and in the token's workspace." A token holds no item id [checked `lib/proxy-tokens.js:11-20`]. Brief part 6 hands every stage the ids of other open runs, and `find` lists runs. So a stage that copies a wrong id writes `by` another stage, unseen. Also: a dispatch-token write that omits `run` has no rule. If it falls to "the token's account", an agent writes as the person. Fix [my reading]: tie the run to the token's lineage, and refuse a dispatch token with no `run`.
2. **Inward comments become person findings, but agents post as the person.** Linear auth asks no app actor [checked `lib/providers/linear/index.js:2367-2373`]. Harbour's own note: "Agents post under a person's account, so the author cannot decide it" (`lib/run-trail.js:216-220`) [checked]. Until slices 2-4, agents still post plan comments, verdicts, answers and survey lines. Only Harbour's summaries carry the mark (§7). So each agent comment becomes a `finding by person:<owner>` to the task: a flood, and a misattribution. The guess Harbour uses today (`isPersonComment`, C3-03) retires in slice 3. §7 names no rule.
3. **Refreshing the head at the verdict write blesses a push the judge never saw.** §4 revises `head` "before any verdict is written", then puts the verdict `on` it. A push between the reviewer's read and its write is pinned as judged, and no stale flag ever shows. Slice 3 retires `findSha`, which compared the sha the reviewer named. Unreadable PRs fail open (`close-out-readiness.js:43-44`) [checked], so B6 also stays for them. Fix [my reading]: the judge names the head it read, and Harbour refreshes the change *after* the verdict, so stale shows.
4. **Wake rows name no run.** Wake prompts are built in the store, outside the factory (`lib/wake-credential.js:4-6`; `lib/dispatch-wake.js:85-102`; `addItem` at `dispatch-store.js:3317, 4011`) [checked]. "Allocated before the prompt" covers only the factory. A woken session knows only its first run id, so its writes either land on that run or are refused. Either way the wake's own run record (§4) stays empty.
5. **Things arrive twice until slice 4.** The prompt keeps "read the description and comment thread", so agents read Harbour's marked summaries beside the same verdicts, decisions and plans as records [my reading]. After slice 2, the kept section still folds old plan text and plan comments. It can show a superseded plan beside the plan record. `asked` shows in part 1 and again in the section. Also, "same model, cache and code" (§3) conflicts with that section skipping Harbour's mark (§7): `lib/brief.js` must change.
6. **The brief can't know its caller.** The door is `GET …/brief/<ticket>` [checked `proxy-preamble.js:278-280`], and §2 sends `run` on writes only. Part 3 ("addressed to it") and the header naming "the caller's own run" need the run. Fix: add `?run=` to the door.
7. **Find-or-make by tracker id.** [my reading] A ticket already closed gets an open task, and its close event has passed, so nothing ends it. Making a task also makes its parent's, and so up the tree. Every made task gets `asked`, children too: a layer change (below).
8. **"Live" is undefined.** Harbour's own "live" leaves out wake, leftover and custom rows (`lib/run-live-wait.js:15-18`) [checked]. SD leaves the original item `taken` forever after a follow-up (`sd:dispatcher.js:359-361`) [checked], so by row status a build's run stays "live" after its leftover takes over.
9. **Run-record flood.** Each wake row gets a run (§4). An autopilot woken many times leaves many short `autopilot` runs, and parts 6 and 8 fill with them [my reading].

## Unflagged changes to the layer

- **The actor list.** Layer §3.2 names `leftover` and `John` and reads from `actors.json`. Draft 2 drops `leftover` (it writes as its parent's stage). That makes `to: leftover` (walk 7, check-159) refusable, and part 3's "left behind" loses it. It adds 9 stage kinds and every member as `person:<id>`, and sources actors from code. Only part 5 and `on-answer` are flagged in §11.3.
- **Child tasks get `asked`.** Layer §3.2: "a child task has none". §2 and §7 set `asked` from the tracker on every made task, children included.
- **The query log goes unmentioned.** Layer §3.5: "Queries are logged with who asked". Draft 2's store has no log, and reads carry no `run`, so it can't say who asked [my reading].
- **A model-built section joins the brief.** The layer's brief is eight deterministic parts. Draft 2 appends a model-built ticket section until slice 4. The layer allows smoothing, but this is a ninth part, not a smoothing. It is named as kept, not as a layer change.
- **A verdict's `on` is set by Harbour, not the judge** (new break 3). This bends the layer's "the exact versions it rests on".
