# Plan: from the approved layer to an integration design

*Drafted 18 Nov for John to correct. Marks as on `situation.md`. Short names as in `layer/design.md`; `existing` is on `claude/peaceful-euler-thz7ct` at `fff543172`, taken at main `6f6c5d2`, which is still main's head [checked].*

## The step

Step 1 of three (journey, "Since"): an integration design on paper that says how the approved layer (`layer/design.md`) becomes part of Harbour, slice by slice, with each slice naming what it retires. It ends when John has read and corrected it. It delivers a design, not tickets or code.

## What the design must answer

1. **Where the store lives.** One collection keyed by kind, on the local store's pattern (`existing` §"The general structure"). It is an area of its own: prompts and runs read it, and it reads neither of them. The tightest knot is already between LLM & prompts and Runs & dispatch (gate 13 Nov, line 18) [checked].
2. **How agents reach it.** Proxy endpoints that mirror the model's commands, beside `proxy-reads`, `proxy-writes` and `proxy-rulings`. This includes who the writer is: the model takes `--by`, whereas a proxy token already knows its dispatch.
3. **How a stage gets its brief.** Built in code from records and fed to `generatePrompt`, within the "one path" invariant and the frozen prompt size. This covers what it replaces in `formatIssueContext` and `lib/brief.js`.
4. **Runs and verdicts.** How dispatch rows and run records relate, and what replaces each consumer of the comment classifier.
5. **Rulings.** Questions and decisions, with the rulings page as John's view, and answers as records instead of comments.
6. **Wakes.** "Open for a reader" is what causes a wake, through the one existing function (`addFeedback`, `wake-inventory.md`) or in its place.
7. **The tracker.** What it still shows, synced from the records, and in which direction.
8. **Pages for people.** Where each change shows up, so each slice finishes where the change binds.
9. **What is already in flight.** What happens to today's Waiting entries, notes, and the seven safety findings the parked work needs.
10. **The slices.** For each one:
    - the route it moves;
    - every site that carries that route today;
    - the one place it moves to;
    - the callers it switches;
    - what is deleted in the same PR;
    - the test or recorded run that proves it;
    - the reading taken before it lands;
    - its effect on tangles.

    Each slice must leave Harbour whole if the next one never lands. There are no switches and no second paths (`how-process-changes-land.md`: 21 switches and 19 old paths kept, 9 of 27 changes half-finished) [checked].

## How

The same discipline that produced the layer design: expectations first, fresh readers who cite, a page revised in place, readers who try to break it, and John last.

### 0. Expectations

Before any code is read, `integration/expect.md` predicts what the census will find for each route, and what would count as the design failing. It is committed first.

### 1. Census: where each route lives today

This is the first step of consolidate-then-rebuild. Fresh read-only readers each take one route at main `6f6c5d2` and list every site that writes it, carries it or reads it, plus the tests that guard it and the pages that show it, with `file:line`. Each starts from its rows in `existing` and goes down to every caller. The census also covers simple-dispatcher where wakes are delivered.

| Reader | Route | `existing` rows |
|---|---|---|
| C1 | Hand-offs: Waiting lists, the `Retires:` conveyor, "record it as not run", run proposals | E2, E3, E5 |
| C2 | Rulings and answers | E4 |
| C3 | Verdicts and runs: the classifier and its consumers, dispatch rows, the blind-read gate | E6, E8, E11 |
| C4 | The plan and the brief: description, prune, copy-down, snapshots, `brief.js`, `generatePrompt` | E1, E7, E15 |
| C5 | Lessons, areas, wakes and the proxy surface | E9, E13, E14 |

- I spot-check each reader's key claims against the code before using them.
- `scripts/code-shape/seams.mjs` takes the area-tangle baseline at the same commit.

### 2. Draft `integration/design.md`

The draft is short and revised in place, with the same marks. It answers the ten questions above, in that order, and ends with the slices table. Every census site is either retired by a slice or listed as kept, with the reason.

### 3. Verify on paper

- **Completeness.** A script checks every census row against the slices: each is retired, or kept with a reason.
- **Paper walk.** Walk 7's three tasks (LIN-4450, LIN-4446 and LIN-4469) are traced step by step through the integration. For each write: the endpoint and the module. For each brief: the code that builds it and its size against the budget. For each hand-off: what wakes. For each step: what page shows it.
  - One parked safety finding is traced from today's notes to a record and on to its reader.
  - Each step is marked changed, unchanged or worse.
- **Tangles.** The imports the design would add are drawn against the baseline. It must add no edge between LLM & prompts and Runs & dispatch.
- **A break reader.** This is a fresh reader given the layer design, the integration design and the census, but not my drafts or reasoning. It looks for:
  - a route left running twice;
  - a caller not switched;
  - a hidden switch;
  - something the fleet does today that would stop working;
  - a slice that leaves Harbour broken if the next one never lands.

  Every break is answered in the design or listed as open.
- **A drift reader.** Given only `my-words` and `layer/design.md`, it checks that the integration design still says what the approved design says. The parrot reads it too.

### 4. John reads and corrects it

## Where things live

- **This folder:** `plan.md`, `expect.md`, `census/C1–C5.md`, `design.md` and `checks/`.
- `existing` and `avenues` stay on peaceful-euler and are cited by commit.
- **Once John agrees the design:** the census and the checks stay until the slice that uses them has landed, since each slice cites its census rows.

## Cost

- **Money.** Seven readings by subagents: five census readers, the break reader and the drift reader. Earlier readings used 110k to 307k tokens each (`design-plan` §Cost) [checked]. That's roughly $25 to $70 in all [guess], plus this session's own use. I report what each reading used.
- **John's time.** Reading this plan, then the design, about half an hour each [guess].
- **How long** [guess]:
  - the expectations and the census take one sitting;
  - the draft and its checks take one more.
- **Proxy token.** None of this needs the harbour.cat token.

## When it stops

- **The census stops** when every row of E1–E15 that it covers has been followed to its callers.
- **I stop and bring it to John** if a route can't be retired in one slice, or if the census finds the layer would have to sit inside the knot.
- **If the paper walk shows a step that is worse, or the break reader finds a route left running twice,** the design is revised once. If it still doesn't hold, I stop and ask.
- **The step ends** when John has read and corrected the design.

## Not in this plan

- Tickets, code, prompt or note changes, or anything touching the running fleet.
- Changing the layer design. If integration shows a fault in it, I bring the fault to John rather than editing the approved page.
- A spike or a prototype endpoint. The real test is step 2's contract tests: the model's checks ported, and walk 7 replayed through the proxy.
- Jira, pet projects and the parked work itself.
