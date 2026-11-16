# Plan: from the frame to a design

*Drafted 16 Nov. Not yet agreed. It plans the step between the frame (`shapes.md` §6) and any build. Marks are as on `situation.md`; lines with no mark are proposals. `words §n` is a section of `my-words.md`.*

## The step

- **John's outline:** "We find where then loop is leaking, understand deeply why, and what it needs, then build that specific solution in a simple form." (log:4151) [checked]. The finding and understanding produced `picture.md`. The build sitting chose a frame, "a data layer that carries the information" (words §9), sketched in `shapes.md` §6 [checked].
- **The frame is not yet the solution:** "The frame is a sketch, not a design … we do not have a specific solution yet." (words §10) [checked]. This step turns it into a design John has read and corrected. It is not a build plan.
- **What a design has to show** (the read-back John agreed, words §10) [checked]:
  1. Everything found is placed: as a shape, as something computed from shapes, or as outside the frame, with misfits listed.
  2. Each shape is stated so it can be checked: its fields, who writes it, who it is for, its end, and what code does at each change.
  3. Each direction of travel in picture §2 is a path through it, and each of the four causes in picture §6 is answered.
  4. What each reader is given: each stage, Harbour's code, John, the tracker.
  5. What it replaces, and what ends each new thing.
  6. That it holds when the traces and Lighthouse are replayed on it, under a reader trying to break it, and on a project that isn't Harbour.
- **His three things still hold** (words §10) [checked]: look before naming; understand before designing ("the frame is chosen, the design is not"); hold for any project. "Covering every aspect" means the mapping is complete, and he would "rather see where the avenues differ than have a recommendation too early".
- **Two cautions from the record:**
  - Every shape in shapes §4 (trace 6) leaves the near-deadlock unchanged, because two engine rules caused it, not information moving [checked]. The mapping lists such things instead of bending the frame to fit them.
  - "Trying to figure it all out in advance will be a fool's errand" (disc:484, on the backlog), and shape B's first risk, "a data shape designed ahead of the evidence" (shapes §3) [checked]. A complete design avoids both only if every placement comes from a traced piece, not an imagined case [my reading].

## How

### 1. Mapping

- **What is placed:**
  - the 179 numbered rows of the six traces' tables (16, 34, 37, 28, 30, 34) [checked, my count]
  - the picture's places (§1), directions (§2), who decides (§3), what is done by hand (§4), what a task carries (§5), causes (§6) and needs (§7)
  - Lighthouse's nine results (picture §9), and its reader's notes while they last: they sit in an earlier session's scratchpad (`lighthouse-trace.md`, 25.6 KB) [checked], which a cleanup can clear
  - every routing rule the picture cites, such as `LEFTOVER_RULE`, "to the person", "record it as not run", the prune and the blind read's exclusions. Each becomes code on the layer, stays as judgement in a prompt, or goes
  - every actor (each stage, the autopilot, close-out, Periodicals, the leftover run, John, the tracker), with the shapes it reads and writes
- **How:**
  1. Expectations first. Before placing anything, I write down which pieces I expect not to fit and where I expect shapes to strain, and commit that.
  2. Each piece is placed in the traces' own words: on a shape, computed from shapes, or outside the frame and why. For each one: who writes it, who it is for, its end, what code does with it, and whether it fits cleanly, fits by stretching a shape, or doesn't fit.
  3. Pieces that fit no shape wait. Only once everything is placed are they grouped, and only then may a shape be added, split or merged, with the rows that caused it.
  4. Each direction, cause, need and by-hand item gets a line: how the frame answers it, or that it doesn't.
  5. A script checks that every row and item appears exactly once.
  6. Misfits get their own section, each with its row and the reason.
  7. John reads and corrects the mapping before any avenue is chosen.
- **My view** [my reading]:
  - Completeness is cheap, because the traces already list the pieces.
  - The real risk is quiet stretching: a shape that fits everything because its fields are vague. So "fits by stretching" is its own mark, and a shape that takes many unlike pieces is examined for being two.
  - I do the placing myself, so the placements share one judgement.
  - The mapping stays at the level of shapes. Where anything is stored belongs to the avenues.

### 2. Avenues

- **My view:** choose them after the mapping, since which differences matter depends on what has to be carried. The frame is fixed, so every avenue is a data layer with declared shapes. They differ inside it.
- **Questions I can see now** [my reading]:
  - **Where it lives:** Harbour's store, the project's repository, or split. That settles how it meets a tracker, git, or a project with neither.
  - **How earlier values are kept:** versions on each record, or a log of changes from which the current state is computed.
  - **How an addressee is reached:** woken by code, finding what is addressed to it when it starts, or subscribing.
  - **How agents meet it:**
    - What they write: records through checked calls, or prose that a model inside Harbour turns into records.
    - What they read: a view computed for them, or queries of their own.
  - **How general:** one structure with shapes declared as data (the WordPress model), or a declared table per shape.
- **The avenues.** Two to four, each a coherent whole, differing on the questions the mapping shows matter.
  - Each is written to the six points above at the same depth, so they can be laid side by side.
  - Each says what it adds, what it replaces and what ends each new thing (words §9), and what it reuses of what Harbour already holds: the local store, rulings, snapshots (shapes §3 B) [checked].
  - Each is walked through traces 3 and 6 and Lighthouse at the moments shapes §4 used, with expectations committed first.
- **Spikes.** These are throwaway: they live in a dated working folder, never under `lib/`, and are never wired to Harbour. Each has an expectation written first and a cap of a few hours.
  - **Replay.** One trace's pieces are loaded into each avenue's structure by a short script. The script is then asked what the trace's sessions had to rebuild by reading: what the current plan is, what is open and for whom, who decided what, and what the next stage needs. The answers are compared with what those sessions actually started with (picture §5). It teaches whether a structure answers the questions, and whether the reading shrinks.
  - **Agents writing shapes.** A model is given a real stage output from a trace, plus the declared fields, and writes records instead of prose. It teaches which fields a model fills well, which addressees and ends it picks, and what it can't place. This tests the frame's premise that LLMs work as components on the layer.
  - **Others** only where an avenue rests on something paper can't settle.
- **Side by side.** A table of where the avenues differ: by need, by direction, by misfit, and by kind of project (Harbour, Lighthouse, no git, no tracker). It holds no recommendation. John chooses, combines, or sends us back. If he wants my reading, it comes after he has read the table, marked as mine.

### 3. Verifying

- **My view** [my reading]:
  - Verifying runs at two levels. The avenues get a light walkthrough so they can be compared; the chosen design gets the full test.
  - The strongest test is the project that isn't Harbour, since all evidence so far is Harbour or its lineage (picture §9).
  - The weakest point is that every reader so far is the same model family (picture, "Limits") [checked].
- **Walkthrough.** Every row of all six traces, and every Lighthouse result, is replayed through the design: what is written, who is woken, what the next reader is given. Each is marked changed, unchanged or worse.
- **Expectations first.** Before each look (each walkthrough, each spike, the outside project), I write what the design predicts and what would count as it failing. That is committed before looking, as `lighthouse-expectations.md` was.
- **Readers trying to break it.** Two fresh readers who did not see the design being made. They are given the design, the picture and the traces, but not the mapping or the avenues.
  - One attacks from the evidence: a piece with no home, a record with no end, a pile or a load that still grows, two components that can disagree, anything worse than today. Each break comes with its trace row.
  - One attacks from generality: a solo project, a team, no git, no tracker, a different tracker.
  - Every break is answered in the design or listed as open.
- **A project that isn't Harbour.** John's side project, set up with Harbour (words §8):
  - One fresh small task runs through Harbour as it is today. It needs no design, so it can run early.
  - A reader who has seen neither the picture nor the design traces it the way the six were traced.
  - Once the design is drawn, I write its expectations and commit them, and only then open the trace. Its pieces are replayed and each expectation is marked held or not.
  - A paper walk adds a project with neither git nor a tracker.
- **Drift.** A fresh reader, given only `my-words.md`, checks the design.
- **John reads and corrects the design.**

## Where things live

- **Files in this folder:** `mapping.md`, `avenues.md`, `design.md`, and `design-expectations.md`. Each expectations section is committed before its look.
- **Spikes** go in one dated working folder. It is removed once the design is agreed; git keeps it.
- **The trace folder stays until the design is agreed,** since the mapping cites its rows. `plan.md` said it would go once the picture was agreed, and it is still on the branch [checked].
- **Lighthouse's and the side project's notes stay out of this repository,** as `plan.md` set for the pet project, unless John says otherwise.

## Pet projects

- **This step uses one:** the side project set up with Harbour, which John offered as a test case (words §8, §9) [checked].
- **His other placements stay open, and stay his** (situation §4).

## Cost

*Stated here and left out of the choosing (words §10). The avenues are compared without it.*

- **Money, all of it John's.**
  - About five readings by sub-agents: the drift check on this plan, two break readers, the outside trace, and the drift check on the design. The last step's readings used 236k to 307k tokens each (picture, end note) [checked]. `plan.md` put a reading at $3 to $10 [guess], so about $15 to $50 [guess].
  - The spikes' model calls run as sub-agents: a few dollars [guess].
  - One fresh Harbour task on the side project. The six traced tasks cost $9 to $21 each; LIN-4448's whole lane came to $142 (picture) [checked].
  - This session's own use, mostly the mapping and the avenues, which I do myself.
  - I report what each reading used.
- **John's time.**
  - Reading the mapping, the side-by-side table and the design: about half an hour each [guess].
  - Choosing among the avenues.
  - Arranging the side project's task.
  - Any stop-and-ask question along the way.
- **How long** [guess]: the mapping takes one sitting, the avenues and spikes one or two, and the design and its test one more. The pace is John's call.

## When it stops

- **The mapping stops** when every row and item is placed or listed as a misfit, and the script finds none missing. If the misfits include a large part of the leak itself, not just its edges, I stop and bring that to John before any avenue. The frame is his choice, and the mapping may question it.
- **The avenues stop at four at most.** An avenue stops once it is written to the six points and walked through traces 3 and 6 and Lighthouse. A spike stops at its cap and is thrown away.
- **If the break readers or the outside test show the design doesn't hold,** it goes back to the avenues once. If it still doesn't hold, I stop and ask.
- **The step ends** when John has read and corrected the design. It delivers a design, not a build plan.
- **I stop early and ask** if something alarming turns up (I read the code myself before relaying it), if access fails, or if spend runs past twice the estimate. That would mean the plan is wrong; it is not a budget line.

## Not in this plan

- Building anything into Harbour, filing tickets, or changing its prompts, notes or code. Spikes touch none of Harbour.
- A build plan or a first slice. They follow an agreed design.
- Choosing for John, or using cost as a reason to choose.
- The sync as a build ("Could all projects be 'local' projects", log:4141) [checked]. An avenue may treat the tracker as a view of the layer; whether to build that is John's later call.
- Fixing the misfits. The near-deadlock and anything like it are listed, not fixed.
- The notes spike, still held (`plan.md`). The mapping places the notes, so the design may absorb the spike; that is John's call.
- Rewriting the record (log:4227).
