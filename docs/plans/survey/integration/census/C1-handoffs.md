# C1 Hand-offs: census

Route: hand-offs · commit 6f6c5d2 · 18 Nov · read by a census reader

Marks: [c] = [checked] (line read), [r] = [reported] (doc or comment, not verified). Paths are Harbour's unless under `/home/user/simple-dispatcher` (SD, local checkout at cf6369d).

## How the route works today

- No record store holds hand-offs. They travel in five carriers: Waiting bullets in `docs/areas/*.md` (git), ticket comments, the rulings stores (asks to John), the run-proposals store, and the up-chain wake. [c]
- **Waiting.** Prompt text tells four writers to add entries: the leftover step, close-out, Periodical Stage 2 and retrospective-audit. Each entry is one `- ` bullet under `## Waiting`. There are 118 entries in 12 notes at 6f6c5d2. Every stage prompt says to read them, as "context, not scope". Code only parses and counts them. An entry ends when a change deletes the bullet, and nothing records that end. [c]
- **Retires.** After a stage build's `[done]`, a hook resumes the builder as a `leftover` row and holds the parent's wake. The builder must settle one Waiting entry and name it on one `Retires:` line in a `### Leftovers` comment. The proxy checks only the line's shape (422). The review prompt checks that the diff removes the entry. No code links the line to an entry. [c]
- **Not run.** The review prompt puts checks it cannot run in the `### What CI Did Not Prove` ledger, "as not run, with why". `run-ledger.js` parses that ledger into items (scope, route, discharged). Close-out settles the items. The open counts are stored at merge. "Not run" has no state of its own: it is just item text. [c]
- **Review/blind read to close-out.** Review names outside finds "with its home" for close-out to write or file. The builder marks lines `for close-out`. The blind read sorts finds into three classes for someone else to act on. All of this is comment prose. Code parses only the ledger and the blind-read verdict. [c]
- **Asks to John.** A session's `DECISION:` block becomes a ruling, shown as "Waiting on you". It ends by answer, dismiss or withdraw. Prompts also send some finds to "the person" in a summary or closing comment, and those have no record. [c] (rulings traced to their entry points only)
- **Run proposals.** A run-scoped or propose-mode chat turn stores a follow-up prompt. The owner Applies it (it dispatches) or Declines it. It has no expiry. [c]
- **Wake.** A child's stopping point wakes its parent, up the chain only. Nothing passes sideways between lanes. [c]

## Sites

| ID | Site | Role | What it does | Reached from |
|---|---|---|---|---|
| C1-01 | docs/areas/README.md:38-42 | carries | Waiting entry format: one bullet, cite the file first, name the source, no size cap [c] | read by agents via C1-07 |
| C1-02 | docs/areas/README.md:64-88 | carries | three ways an entry leaves; the leftover-step exception; who writes [c] | prose only |
| C1-03 | docs/areas/*.md `## Waiting` (e.g. runs-and-dispatch.md:75) | carries | 118 entries; runs-and-dispatch has 24 [c] | C1-04 |
| C1-04 | lib/prompts/area-note-format.js:13-55 | reads | `parseNote`, `countWaiting`, `isCitedPath` [c] | tests/unit/area-notes.test.js:20; scripts/stability-measures.mjs:33,47-52; lib/dispatch-leftover-answer.js:28 |
| C1-05 | tests/unit/area-notes.test.js:1-168 | guards | slug, paths exist, first path in own area, Lessons cap; prints Waiting counts (:97) [c] | CI |
| C1-06 | tests/unit/stability-measures.test.js:176-190; tests/unit/lin-4470-note-leaves.test.js | guards | one parser and one predicate, no copies [c] | CI |
| C1-07 | lib/prompt-formatters.js:606-620 | instructs | read notes; Waiting is "context, not scope"; name an entry you use; scoping variant [c] | `GROUNDING_BY_KIND` :661-683 |
| C1-08 | lib/prompts/leftover-words.js:41,58 | instructs | `LEFTOVER_RULE`, `CONSEQUENCE_TEST`: Waiting vs ticket vs "summary comment, addressed to the person" [c] | dispatch-leftover.js:144-146; prompt-template-defs.js:734,858,916,1057,1078 |
| C1-09 | lib/periodicals.js:124-132, 358-372 | instructs | Stage 2 writes Waiting entries in a docs-only PR for close-out; finds with no note go to the person [c] | periodical templates |
| C1-10 | lib/prompt-template-defs.js:916; lib/prompts/stage-kinds.js:485 | instructs | audit: gate tickets, the rest as Waiting entries in `NOTES_PR` [c] | retrospective-audit stage |
| C1-11 | lib/dispatch-store.js:3545-3546 | carries | a code comment names a Waiting entry by position ("Waiting 5") [c] | none |
| C1-12 | lib/dispatch-leftover.js:38-117 | writes | `decideLeftover`: queue / hold / not-eligible, asked once per ticket [c] | dispatch-leftover-hook.js:45 |
| C1-13 | lib/dispatch-leftover-hook.js:1-45, 83 | writes | `createLeftoverStep`: enqueues the leftover row, withholds the build's wake [c] | server.js:90,1135; routes/proxy-runner.js:218; routes/dispatch.js:1650 |
| C1-14 | lib/dispatch-store.js:1880-1896, 3386-3416 | carries | held wake keyed on `heldWakeFor`; release when the row never ran [c] | `addFeedback` |
| C1-15 | lib/dispatch-leftover.js:132-156 | instructs | `leftoverPrompt`: settle one entry, `### Leftovers` comment, `Retires:` line, `for close-out` lines; same text in the terminal message [c] | C1-13 |
| C1-16 | lib/prompts/leftover-words.js:35,73,80,88-91 | carries | the spellings `LEFTOVERS_HEADING`, `FOR_CLOSE_OUT`, `RETIRES_LABEL`, `RETIRES_NONE` [c] | dispatch-leftover.js:25; prompt-template-defs.js:42; dispatch-leftover-answer.js:27 |
| C1-17 | lib/dispatch-leftover-answer.js:57-148 | reads | `checkLeftoverAnswer`: shape only; "the store is not involved" (:22-25) [c] | routes/proxy-writes.js:68; lib/proxy-instructions.js:5 |
| C1-18 | routes/proxy-writes.js:422-426, 811, 864, 905 | guards | 422 on comment create, edit and attachment caption; proxy lane only [c] | agents via the proxy |
| C1-19 | lib/proxy-instructions.js:849 | instructs | agent API text: the forms and refusal codes [c] | proxy instructions |
| C1-20 | lib/prompt-template-defs.js:729-730 | instructs | review: the `Retires:` line names an entry this diff removes [c] | review stage |
| C1-21 | lib/prompt-template-defs.js:858 | instructs | close-out takes the `for close-out` lines through the gate; no code reads the mark [c] | close-out stage |
| C1-22 | tests/unit/dispatch-leftover-answer.test.js; lin-4414-leftover-answer-route.test.js; lin-4373-leftover-step.test.js; lin-4377-*; lin-4374-review-leftover-read.test.js (:83,126-136 no retyping); lin-4401-outside-find-home.test.js | guards | checker, route, held wake, spellings, gate rendered once [c] | CI |
| C1-23 | lib/prompt-template-defs.js:762 | instructs | "list it in the ledger as not run, with why" [c] | review stage |
| C1-24 | lib/prompt-template-defs.js:734, 764-781, 789-795 | instructs | the hand-off ledger "close-out consumes"; outside finds named with a home; Needs Discussion = one question for the human [c] | review stage |
| C1-25 | lib/prompt-template-defs.js:813-817, 833, 837-846 | instructs | close-out reads the ledger and blind read, writes review's note entries, settles items [c] | close-out stage |
| C1-26 | lib/run-ledger.js:31, 150-173, 320 | reads | `parseRunLedger`: items, scope, `discharged` by regex [c] | lib/run-trail.js:33,255,400 |
| C1-27 | lib/run-trail.js:254-255, 351-400 | reads | `readRunLedger`, `readTrail` [c] | close-out-readiness.js:87,134; recommendation-facts.js:458; recommendation-blind-read.js:57; run-evidence.js:165; prompts/revision-brief.js:13 |
| C1-28 | lib/recommendation-facts.js:460-465, 527-546 | reads | ledger counts go to the selector ("left for close-out to discharge") [c] | stage selector |
| C1-29 | lib/close-out-merges.js:24-33, 82 | ends | `countOpenLedgerItems` at merge [c] | server.js:138; routes/workspace-api-run-evidence.js:15 |
| C1-30 | lib/close-out-events-store.js:7-8, 34, 117 | carries | stores open counts, never content [c] | C1-29, C1-31 |
| C1-31 | routes/workspace-api-run-evidence.js:356-367 | writes | a close-out press records `openItems` as all zeros [c] | press route |
| C1-32 | lib/render-run-evidence.js:92-176; lib/render-task-page.js:546-548 | shows | ledger items; cleared/total [c] | session page, task page |
| C1-33 | lib/follow-on-ratio.js:163-172 | reads | is the ledger heading present? [c] | reports |
| C1-34 | lib/prompt-template-defs.js:1014, 1046-1108 | instructs | blind read sorts finds into three classes; "someone else acts on each class" [c] | blind-read stage |
| C1-35 | lib/run-ledger.js:392-469; lib/run-trail.js:280-302 | reads | blind-read shape and verdict; classes not parsed [c] | routes/proxy-writes.js:70,775,786; recommendation-blind-read.js |
| C1-36 | lib/run-trail.js:134-145; lib/prompt-template-defs.js:486 | reads / instructs | comment kinds incl. Survey and area-read; scoping reads both Survey comments [c] | recommendation-look-first.js:66,105,137 |
| C1-37 | lib/prompt-template-defs.js:335 | instructs | subtask: "change course and say so on the parent" (an ask as a parent comment) [c] | decomposition stage |
| C1-38 | lib/prompt-template-defs.js:736, 859-860 | instructs | no re-raise of a ruling; existing-ticket check before filing [c] | review, close-out |
| C1-39 | /home/user/simple-dispatcher/hook.js:491-499 | instructs | `DECISION:` block format; dedupe by `decision_id` [c] | SD sessions |
| C1-40 | lib/unanswered-decisions.js:568, 701; lib/task-decisions-store.js:1-31 | reads / carries | open-decision predicate; scan decisions, no TTL [c] | nav count, rulings view, scan routes |
| C1-41 | lib/waiting-section.js:2-49; lib/render-observation.js:223; lib/components/navbar.js:326 | shows | "Waiting on you" (rulings, not area Waiting) [c] | Home, observation, navbar |
| C1-42 | lib/run-proposals-store.js:1-30, 86-233 | carries | schema; CAS apply/decline/revert; no TTL [c] | server.js:106,704-706 |
| C1-43 | routes/task-chat.js:438-555, 647 | writes | one proposal per propose or run-scoped turn [c] | chat UI |
| C1-44 | routes/dashboard.js:413-417, 532-620 | reads / ends | list for the session page; Apply dispatches then records the item, reverting on failure; Decline [c] | public/session.js:315-336 |
| C1-45 | routes/task-page.js:107-114, 171, 299 | reads | the owner's pending (`proposed`) proposals [c] | public/task-page.js:604-716 |
| C1-46 | lib/render-session.js:156-236; lib/render-task-page.js:847-848 | shows | Apply / Decline buttons; staged proposals [c] | session page, task page |
| C1-47 | tests/unit/run-proposals-store.test.js; lin-3254-run-proposals-apply.test.js; lin-3254-run-scoped-chat.test.js; lin-3975-proposal-*.test.js | guards | store, routes, propose-only chat [c] | CI |
| C1-48 | lib/dispatch-wake.js:1-42, 170, 329-371 | carries | `buildWakeFollowUp`, up the chain only; held-wake and leftover-pending notes [c] | dispatch-store `addFeedback` |

## Corrections to the inventory

- E2 "no data store; Waiting in `docs/areas/*.md`": **held** (C1-03, C1-04).
- E2 "proxy refuses a leftover answer without a valid `Retires:` line": **held**. lib/dispatch-leftover-answer.js:8-9; the refusal is at routes/proxy-writes.js:422-426.
- E2 "classifier names survey comments, run-trail.js:134-145": **held**. The Survey rows are :138-139.
- E2 "nearest hand-off with an end is a run proposal": **corrected**. Review-ledger items also have an end that code reads: `discharged` (run-ledger.js:150-173), counted at merge (close-out-merges.js:27-33). Rulings end by answer or dismiss (C1-40). A proposal comes from a chat turn, not a stage (routes/task-chat.js:438-523). The no-TTL quote holds (run-proposals-store.js:5-8).
- E3 "'record it as not run' is prose (picture §2)": **corrected**. The words are in the review template (prompt-template-defs.js:762). They land as an item in the parsed ledger, with no not-run state (C1-26).
- E3 "close-out events store the open-ledger-item counts at merge": **held** (close-out-events-store.js:7-8). A press stores zeros, though (C1-31).
- E3 "Apply / Decline is the nearest to-do for a person": **corrected**. Rulings ("Waiting on you", C1-40, C1-41) are the person's to-do list with an end. Proposals are one kind.
- E5 dispatch-wake quote and "up the chain only": **held** (dispatch-wake.js:4-10). The leftover hook can hold or reword that wake (C1-13).
- E17 "nothing matches a new finding to an existing one": **corrected in part**. In prompts: the existing-ticket check and no-re-raise (C1-38). In code: rulings dedupe by `decision_id` (SD hook.js:498) and by content hash (task-decisions-store.js:26-31). Nothing dedupes Waiting entries.
- E17 "a `Retires:` line links one build to one entry": **held as text only**. Code checks shape, never the link (dispatch-leftover-answer.js:22-24).

## Loose ends

- One leftover answer, two copies. The proxy checks the comment; the parent reads the terminal message, which is unchecked (routes/proxy-writes.js:412-421 [c]; docs/architecture/dispatch-and-proxy.md:127 [r]).
- Same counts, two writers. The merge recorder counts open ledger items (close-out-merges.js:82). The press route writes zeros (workspace-api-run-evidence.js:366) [c].
- One rule, two spellings. A cited path in a note takes `NOTE_EXTENSIONS`; one on a `Retires:` line takes any extension (area-note-format.js:19-22) [c].
- Entries have no id. Code and comments cite them by position (dispatch-store.js:3546) or by opening words (Retires form) [c].
- Several hand-offs have no reader in code: the `for close-out` lines, the blind read's three classes, and the "to the person" finds in closing comments (C1-21, C1-35, C1-09) [c].
- "Waiting" names two things: area-note entries, and rulings in "Waiting on you" [c].
- SD: the drift review cites a retirement rule in SD's README :72-82 [r]. The local SD checkout (cf6369d) has no `Retires:` or `## Waiting` text (grep) [c]. Not traced on SD main.
- Not traced: how rulings are made from SD's `DECISION:` feedback inside dispatch-store (entry points only), and how `scripts/stability-measures.mjs` is invoked.
