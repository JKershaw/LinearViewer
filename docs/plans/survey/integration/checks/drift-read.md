# Drift read of `integration/design.md` (18 Nov draft)

*A fresh reader, 18 Nov. Read: `my-words.md`, log "17 Nov" and "18 Nov", `layer/design.md` (approved), `integration/plan.md`, then the draft. Census rows opened only where the draft leans on them (C2 "Resume", C3-17, C5-C06). `journey.md` "Since" read for the agreed order. Quotes are copied from those files.*

## Drift

1. **§2 "Write gate … Restricted stamps (blind read, one-comment) get only the record writes their stage needs."**
   Departs from the approved layer: "Any actor may write any kind and end any record; which ones it should is its prompt's business and Harbour's" (layer §3.2), and "Only shape" (§3.3). A per-stage allowance on record writes is a rule about who may write. That is the drift John caught in walk 3: "the data layer doesn't _act_ per say, agents act" (log "17 Nov"). It also carries over today's `STAGE_WRITE_OPS` machinery (C5-C06), which John warned about: "we'll inherit likely too much we don't want" (my-words §10).
   *Fix:* every token that may write may use the record routes. What a stage should write stays in its prompt. If a restriction is wanted, flag it to John as a change to the approved design.

2. **§5 "Today's three effects (resume, record, dispatch) become one rule: wake the asker if it is waiting." (also §11.1)**
   This changes Harbour's workflow. The layer says it is not "Harbour's workflow and engine rules" (§1). The census shows the effect is chosen per answer today (C2 "Resume": `resume`, `record`, `dispatch`). The draft removes that choice, though nothing in John's words asks for it. On a similar call in walk 3 John said: "All of this is already easily handled by Harbour?" and "This feels like a trivial issue dressed up in very elaborate clothing?" (log "17 Nov").
   *Fix:* keep the three effects as they are. Only the carrier changes, from a comment to a decision record. Drop §11.1.

3. **§4 "The shape check replaces the proxy's blind-read guard (C3-17)."**
   C3-17 checks shape and also "PR set = landing". The layer's shape check (§3.3) does not cover the second part. So either that part is dropped without saying so, or it has become a content rule inside the store.
   *Fix:* say which. If the PR check stays, it belongs in Harbour's route or the blind-read prompt, not in the store's check.

4. **§5 "'Answered elsewhere' is the store's version check, so the 409 shape (C2-13) can stay."**
   The approved store has no version check on writes. §3.3 lists shape checks only. The draft writes as if one existed.
   *Fix:* say it is a new check and where it lives (the answer route in Harbour, refusing to answer a question that has already ended), or drop the 409.

5. **§2 "In the UI, a signed-in person writes as `john`." §9 and the rulings page are also all "`to: john`".**
   John: "It has to hold for any project" and "We have to keep it universal" (my-words §8; log:4155). The layer says "Another project declares its own" actors (§3.2). Hard-coding `john` won't hold for Yap, for a stranger, or for the Jira team.
   *Fix:* the person actor is the signed-in account, declared per workspace. Keep `john` as Harbour's own case.

6. **§1 "`lib/records/kinds.js` holds the kinds, actors and outcome sets as data."**
   The layer says "Kinds are data: one generic record plus `kinds.json`", with actors declared in `actors.json`, per project (§3.2, §4). A JS module per Harbour fixes the declarations in code.
   *Fix:* keep the declarations as data that a workspace can supply. The JS module only loads them.

7. **§1 "They are ported from the walk 7 model (`layer.mjs`)."**
   The layer says the model "is thrown away after its round" (§4). The plan agreed only that "the model's checks [are] ported" as contract tests (plan "Not in this plan"). Porting the throwaway CLI code is a quiet change.
   *Fix:* build the modules from layer §3, with the model's 16 checks as the contract. Use the model as a reference, not as the source.

8. **§1 `scope` as the storage partition (the workspace `urlKey`).**
   This clashes with the decision kind's own `scope` field (layer §3.2). Two meanings for one name will confuse readers and queries.
   *Fix:* call the partition `workspace` or `urlKey`.

9. **§7 The tracker: "Nothing reads these back." Inward, only `asked` at first dispatch and the close.**
   John: "Could all projects be 'local' projects, and the provider a sync, somewhat abstracted behind it?" (log:4141). The journey reports "tickets as a backup and trackers syncing" (journey, 15 Nov; reported, not his words). John also said "if I choose to do something, Harbour is a passenger" (log:3609). The draft sends out summaries of verdicts, decisions and plans only. Open findings, checks and questions never reach the tracker, so it is not a backup of what is open. A person's later ticket edits or comments have no way in.
   *Fix:* say what the tracker backs up, and where a person's edits or comments after first dispatch go. A person's tracker comment could become a record `by` that person.

10. **§2 "`via` is the token label for a relay, such as the autopilot writing for a child."**
    In walk 4, "the autopilot wrote as itself" (log "17 Nov"). The autopilot is a declared actor (layer §3.2). The example reads as if the autopilot writes under the child's name.
    *Fix:* the autopilot writes `by: autopilot`. Keep `via` for real relays, such as an import or a scan.

11. **Length and the appendix.** The journey asked for "a short integration design on paper" (journey, "Since"). At 20.5 KB the draft is longer than the approved layer page (18.7 KB). John: "it just needs to be correct for what Harbour needs" (log "17 Nov").
    *Fix:* move Appendix A into `checks/`, where the completeness script reads it. Cut §0 to two lines.

## Missing

- **Real work as the test.** John said real work comes once the parts hold: "then we can start thinking about like the running real work through it" (log "17 Nov"). The journey reports "The first work through the upgraded Harbour is the parked work (John, 18 Nov)", read against the 13–14 Nov baselines, "reported, never gating". The draft's witnesses are replays and contract tests. §9 mentions the parked work but doesn't say it is how the integration is judged.
  *Add one line:* after which slice the parked work runs, and that it is read against the baselines, reported, never gating. The "Before-read" column should also say "reported, never gating", as layer §2 does ("Measures report, never gate").
- **Built through Harbour's own loop.** The journey's step 2 builds each slice "through Harbour's own loop". §9 says "The fleet is paused, so no route runs old and new side by side for live work". But the tasks that build slices 2–6 are themselves live work, running on a Harbour that is half switched over. The draft doesn't say how those tasks run in the in-between states.
- **The safety findings as tasks.** John: "Agreed on the safety - a code collection of tasks to run through the improved loop" (asks.md:227, my-words §5). §9 imports them as findings `to: john` or to an area. His words make them work to run, not items on his list.
- **Yap and the pet projects after the parked work** are not mentioned. One line on what another project supplies (its actors, its tracker or none) would show the design doesn't foreclose them. See drifts 5 and 6.
- **The proxy** as the "sensible deterministic natural feeling system" (log "17 Nov") is used throughout. That holds.

## Holds

- Kinds, fields, states, views and the eight brief parts are as approved. The brief is deterministic, with no model smoothing at first, which matches "The ideal is it's fully deterministic" (log "17 Nov").
- Writes are checked for shape and refused with a reason (422). Close-out, the selector and the measures read records instead of parsing comments. None of this adds a new gate.
- `by` comes from the credential. That is bookkeeping done in code, as layer §1 says.
- The knots are listed per slice for John to call (tidy before, after, or accept), with no blanket tangle rule, as John corrected on 18 Nov. Retiring the old route is the default, and the kept paths are named with when they go.
- The draft is headed "for John to correct". I found no claim that John agreed to anything he hasn't.
- Moving rulings to slice 4, against the journey's order, is flagged to John (§11.5), not done silently.

## Questions that aren't John's, and missing ones

- **§11.1 (one resume rule):** not a question. It is a workflow change he didn't ask for. Drop it (drift 2).
- **§11.2 (`areas.json` as the source of area paths):** a technical choice. John: "Unless it's for a reason that actually needs me, I'm happy for you to handle it" (log:3773). Decide it and note it.
- **§11.3 (who the safety findings go to):** his words already answer it. They are tasks to run (asks.md:227).
- **§11.4 (slice 6), §11.5 (rulings as their own slice), §11.6 (knots):** these are rightly his. They are scope, order, and the knot call he asked for. For §11.6, each knot needs a plain line saying what it costs. "New edges, no new pair" isn't enough to call.
- **Missing, and his:**
  - Does the write gate (drift 1) stay? It changes the approved design.
  - When does the parked work start: after slice 1, or after all the slices? The pace is his call.
  - What should the tracker back up? Should a person's comments on it flow back in (drift 9)?
