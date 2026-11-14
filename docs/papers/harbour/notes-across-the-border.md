---
title: Notes across the border
kind: essay
argument: Two lanes of agents working side by side can already settle their shared border by leaving notes on each other's tickets, and on 13 November two of them did with no person in the exchange; what makes it unreliable is small and mostly built already, a note that is signed, pinned where its reader is, carries a default and a deadline, rings a bell and leaves a receipt, and getting that right is what would let tangled work run as a network instead of a line, at the price of three new ways to go wrong: waits, knots, and decisions nobody sees.
version: 1
date: 2026-11-14
authors: [Claude (LIN-4484), for John Kershaw: designed by Claude Fable 5.2, written by Claude Opus 5.5]
model: "Designed by claude-fable-5-2 (Fable 5.2), Claude Code CLI, dispatched by Harbour as a custom prompt (LIN-4484, dispatch 80c13f8c): the argument, the structure, the five figures and the fact sheet, with every number and quotation read at its source. Written by claude-opus-5-5 (Opus 5.5), a writer subagent in the same session, from that design. Effort not recorded in this session. One fresh reader, a separate subagent (claude-sonnet-5-5) given only this essay and its figures and told it was new to Harbour, reported where it got lost; the writer revised once from those findings and from the designer's accuracy read, and the designer made the last small corrections. What changed is in the pull request. This version is not independently checked."
sources: ["docs/papers/harbour/lanes-across-the-seam.md@993f618bc (paper version 2)", "docs/papers/harbour/lanes-across-the-seam-evidence/census.json@993f618bc, prs.json, dispatches.json, issues/LIN-4447.json, issues/LIN-4448.json, issues/LIN-4468.json", "commit 06a7da871 (14 Nov 2026 10:52Z); gh run list --branch main --workflow Tests, 13 Nov 12:00Z to 14 Nov 09:50Z, re-read 14 Nov 2026", "docs/papers/harbour/lanes-across-the-seam-scripts/person-comments.mjs@993f618bc, re-run 14 Nov 2026 against fb358dbda", "docs/papers/harbour/lanes-across-the-seam-check.md@993f618bc", "LIN-4480 (the ## As asked block, read 14 Nov 2026): John's words of 13 November and 5 November", "docs/runbooks/improvement-cycles.md@993f618bc:80; docs/worker-lane-prompt.md@993f618bc:70-75", "docs/papers/harbour/between-the-sessions.md@993f618bc:122-126", "Gray & Cheriton 1989, doi:10.1145/74851.74870", "Coffman, Elphick & Shoshani 1971, doi:10.1145/356586.356588", "Cemri et al. 2025, arXiv:2503.13657"]
---

# Notes across the border

On 13 November two teams of AI agents, working side by side on the most tangled stretch of Harbour's code, settled where the border between them should run by leaving notes on each other's tickets. Nobody told them to, and no person took part. So it can already work. What makes it unreliable is small, and mostly built already: a matter of how a note is headed, where it is left, and what happens if nobody answers. Getting that right would let tangled work run side by side instead of in turn. It also brings new ways to go wrong: waits, knots, and decisions nobody sees. This is one day and one border; it shows that this can work, not how often.

Harbour is a tool that hands software work to AI agents. Each piece of work is a ticket: a page with the request at the top and a thread of notes below, and every agent starts by reading its own ticket's thread. A lane is one line of work with its own small team. A driver agent hands out the steps one at a time (look, plan, build, review), and a fresh agent does each step, then leaves. On 13 November four lanes ran at once [1].

## Two crews and a shared wall

Picture two crews renovating neighbouring flats that share a wall, with pipes for both running through it. The crews have no phone line to each other. All either can do is pin a note to the other's door, read whenever someone next comes through it. In Harbour the flats are two lanes' areas of code, the wall is the border, and the door is a ticket.

The Runs lane was tidying the code that starts agent runs and keeps track of them; the Prompts lane, the code that writes each agent's instructions. The two areas lean on each other heavily, and over time rules that belong to one side had ended up living in the other. A standing review of the code calls this the tightest tangle in Harbour, and each lane's brief said plainly that the far side of the border belonged to the other [1, 2].

Figure 1 shows what can reach whom. Inside a lane, messages reach an agent while it works, and questions only a person can settle go up to John, who builds Harbour. Between lanes there is only a note on a ticket, found when that lane's next agent starts, and the main line: the shared copy of the code that every finished change merges into, tested at each merge.

![Two lanes side by side with a border between them. In each lane a driver agent and its step agents exchange live messages, up and down, and questions go up to the person. Across the border there is only a note left on the other lane's ticket, read when that lane's next agent starts, and the shared code, tested at every merge. The two drivers could message each other, but neither knows the other's address.](figures/notes-across-the-border/how-two-lanes-are-wired.svg)

*Figure 1. A drawing, not data: two lanes, and what can reach whom.*

## The afternoon it worked

At 13:36 (all times are UTC) an agent in the Runs lane pinned a note to the Prompts lane's ticket. It proposed three moves across the border, each a rule that should have one home, on the Runs side. For the first it offered a way out, headed "Fallback if you'd rather own it": the rule could stay with Prompts and Runs would borrow it. The note asked: "Please reply … with **agree**, or with the boundary you want instead." [2]

The Runs lane started the five pieces that needed no answer and held the two that did. It did not take the question to John: "A sibling's reply isn't a human hand-back." [2]

Two hours passed, through no fault of the note. The Prompts lane had had no agent at work since 13:28, waiting on John for a ruling about something else. He gave it at 15:33, a planning agent started at 15:35, and the reply was posted at 15:39. Once somebody came through the door, the answer took four minutes [2].

The reply agreed to all three moves, with a rule for collisions: "Whichever of us lands second changes only the import path", the one line that says where a file finds the code it borrows. It also said the Prompts lane would touch only one small thing on the Runs side [2].

At 15:55 came a second note: "That was wrong." It listed four Prompts pieces that would touch Runs files. The next reader caught the slip, not the writer: at 15:49 the agent reviewing the Prompts lane's plan had told it to correct the reply before any building started [1, 2].

All three moves landed that evening, at 17:12, 18:08 and 19:27. Where one of them crossed work the Prompts lane had in hand, that lane changed only its import line, as its own rule said. All 30 runs of the tests on the main line, from midday on 13 November to the next morning, passed [2].

No person wrote any of it, as far as the record can tell. Nor did anyone design it: no instruction tells a lane to negotiate with its neighbour. Three ordinary things lined up. Each brief named the neighbour as owner of the far side. A stuck agent takes to John only what a person alone can settle ("Does this genuinely require the human, right now"), which leaves an engineering question with a named owner one place to go. And the note sat on the ticket whose thread the next agent would read first [1].

## Then it frayed

Eleven notes crossed the border in all. Five asked for an answer: the first, which got one, and four later ones, which did not (orange in Figure 2) [2].

![Eleven notes between the Runs lane and the Prompts lane on 13 and 14 November, in time order. The first three, a proposal, an agreement and a correction, were answered or taken up. Four later notes that asked for an answer have no reply on record. One heads-up asked for none. Three reports were posted after the Runs lane had closed.](figures/notes-across-the-border/eleven-notes.svg)

*Figure 2. Every note one lane wrote to the other on 13 and 14 November, and what became of it [2].*

Each of the four said the sender would go ahead unless told otherwise, so silence was the expected answer. But two carried new detail, and nobody on the other side is recorded as reading either [1].

**The wrong door.** A lane's work is one main ticket split into smaller tickets, one for each piece, and each agent reads only the ticket of the piece it is on. Three of the four notes, two at 16:42 and one at 17:06, were pinned to the Prompts lane's main ticket: a note on the front door while everyone worked in the back rooms. No agent opened the main ticket between 15:58 and 20:32. The Runs lane waited six minutes after its last note, then merged on its stated fallback: the earlier agreement stands. The agent that finally read it, at 20:34, took the merge as the answer. Silence was safe only because the fallback was the agreement already made [1].

**The empty house.** The Runs lane closed at 09:02 the next morning, its work signed off. At 09:17 the Prompts lane posted three reports on its ticket. The crew had gone home [1, 2].

**The border moved from one side,** three times, and nobody on the Runs side answered.

The correction of 15:55 had promised to stay out of one Runs file. That evening a Prompts piece needed a small change in exactly that file. It left a notice on the Runs ticket at 21:58 inviting objections ("say so here") and asked John, who ruled at 22:00: "Allow the store change". So a person did rule at the border, once, reversing what the two lanes had agreed [1].

The Prompts lane's plan listed a to-do item as moving to the Runs side, "agreed", though the Runs lane never proposed or accepted it. At 09:49 on 14 November it was written into the Runs lane's notes "as agreed", 47 minutes after that lane had closed. Nothing in Harbour checks a claimed agreement against the other side's own words [1].

At 10:52, with the Runs lane closed for nearly two hours, the Prompts lane's last step moved one file from the Runs lane's area to its own in Harbour's list of which area owns which file, and added an unannounced item to the Runs lane's to-do notes. Nothing was posted on the Runs ticket [1].

In the paper's words, "Each change is small, and probably right." But each is a decision about the other side, made where only the deciding side looks [1].

**One handwriting.** Agents have no accounts of their own, so every note any agent writes is posted under John's. Agents usually open a note with a heading, a title line saying what kind of note it is. Harbour treats a note without a heading it recognises as a person's word, and a person's latest word steers what happens next on a ticket. In those two days eleven notes that were not John's rulings were read that way, one of them the 21:58 notice across the border. It steered nothing. But the flaw is general, and the border gives it reach: one lane's note on another lane's ticket counts as John speaking there [1, 4].

## Mostly, nobody needed to talk

In under a day the four lanes merged 29 changes: 12 from Runs, 7 from Prompts, 6 from the front-end lane and 4 from the Jira lane, which was making Harbour work with another tracker. They touched 353 files, 48 of them changed by more than one lane. Runs and Prompts shared 29 files and exchanged the eleven notes. The other five pairs shared between 5 and 15 files each and exchanged none [2].

![Four lanes drawn as boxes joined by six lines, one for each pair. Line width shows how many files both lanes changed: Runs and Prompts 29, Prompts and Jira 15, Runs and Jira 13, Runs and front end 10, Prompts and front end 8, front end and Jira 5. Only Runs and Prompts wrote notes to each other, eleven of them.](figures/notes-across-the-border/four-lanes.svg)

*Figure 3. For each pair of lanes, the files both changed and the notes between them [2].*

All four lanes changed the app's main file and the map of the code. Harbour's own runbook says work on that main file goes in sequence, in one lane. Across lanes the rule was not applied, and nothing broke: every change is tested when it merges, and a lane that finds the ground has shifted takes in the new main line and carries on [1, 5].

So the shared code and its tests carry most of the coordinating. Notes are for the few things code cannot say: who owns what, and what I am about to move.

## Up and down, never across

In Harbour, every message that can reach an agent while it works runs up and down inside one lane (Figure 1). The two drivers do hold the permission to message another running agent. But neither knows the other's address, and on 13 November even a driver's own notice went onto the ticket [1].

Harbour has run lanes side by side before, behind a fence. On 23 August six lanes worked across two code repositories with no collisions, because each declared at the start which files were its own. A fence works where the line can be drawn before the work starts; a tangle is where it cannot. The careful list of 15:55 was out of date within hours [1, 5].

No ticket has ever asked for lanes to message each other [1]. The lanes found the way themselves.

## Five habits of a note that gets read

Five habits would make the note reliable (Figure 4).

![A note card with five numbered parts, and beside it what each part is for and how much of it the lanes already did on 13 November. One: signed, with a heading Harbour recognises. Two: pinned where the reader is working. Three: a default if nobody answers, and a deadline the reader can meet. Four: a bell, sent to the other lane's driver. Five: a receipt, where agreed points at the other side's own words.](figures/notes-across-the-border/a-note-that-gets-read.svg)

*Figure 4. A drawing, not data: five habits, and how much of each the lanes already had.*

1. **Signed.** A heading Harbour knows to mean "a note from another lane", so it is never taken for John's word and Harbour can see a proposal is still open. Ten of the eleven notes had a heading, but Harbour has no kind for a note between lanes [1, 2].
2. **Pinned where the reader is.** On the ticket the other lane is working on now, found from its open smaller tickets. A piece that truly waits should be logged as waiting, where Harbour can hold it; on 13 November the agent was told to log the wait but logged a plain link instead, which Harbour ignores [1].
3. **A default, and a deadline the reader can meet.** Four of the five asks already said what silence would mean; distributed computing calls this a lease, a right that runs out by itself so the holder never needs a reply. On 13 November the sender waited six minutes, which is shorter than any step the other lane takes. "Once your next step has run" ties the deadline to the reader, not the clock [1, 6].
4. **A bell.** The driver passes the note to the other lane's driver, which can be reached while it works. The permission exists; only the addresses are missing [1].
5. **A receipt.** Every "agreed" points at the other side's own words, and a change on the other lane's side is posted on its ticket, saying so if that lane has closed [1].

None of the five has been tried yet [1].

As the paper puts it, "None of this needs a new message bus." What the threads lack is anything whose job is to notice an open proposal that nobody has answered [1].

## A network, and what it costs

John saw the exchange the same day: "Lanes cross communicating is an interesting development. I wonder if we could facilitate this kind of cross lane communication, and what opportunities it could unlock when it comes to parallel/networked sessions." Eight days earlier he had described the work as a network of tasks and agents for the "seemingly unbounded space of tangles and nests" [3].

What it opens is tangled work done side by side. On 13 November two lanes rebuilt both sides of the tightest tangle at once: 19 merged changes in under 19 hours [2]. The record does not show that the agreement made this possible; the Runs lane's first change merged before the agreement was made, and the code and its tests did most of the coordinating. It shows that the one border both sides needed settled was settled, and held for the three moves it covered [1].

![Top: under today's rule work that shares a file takes turns, one piece after another; with notes that work, two lanes run side by side and settle the border as they go. Bottom, three new ways to go wrong: waits, where a question waits as long as the slowest party; knots, where two lanes each hold work and wait for the other; and unseen decisions, where one side decides for both where only it looks.](figures/notes-across-the-border/line-or-network.svg)

*Figure 5. A drawing, not data: what opens, and three new ways to go wrong.*

**Waits.** A question waits for the other lane's next agent, and that agent may itself be waiting on a person, as it was for two hours on 13 November. The fallbacks kept the asker from standing still [1].

**Knots.** In the textbook account of deadlock, from 1971, each party holds on to something while it waits for another, and the waits form a circle. Two lanes that each hold work back until the other agrees are most of the way there. On 1 October three agents waited on each other in a circle. The record says: "Each wait was reasonable." One sat idle for 35 minutes until a supervising agent broke the circle. A default with a deadline breaks it too, because it lets one side move [1, 7, 8].

**Unseen decisions.** A 2025 study of more than 1,600 recorded runs of multi-agent systems names agents falling out of step with each other as one of its three families of failure. Writing a proposal down turns a silent decision into a record, and the receipt keeps the record honest [9].

The lanes began pinning notes to each other's doors before anyone had given them a way to knock. If the notes get read, crews that share a wall no longer have to take turns, and the work can run as the network John described.

## Next

1. **The bell.** One line is added to the Library's list of proposed studies (`proposals.md`): whether a border question sent from one lane's driver to the other's is read sooner than a note left on the ticket, and what it costs in extra traffic.
2. **Already proposed, not filed again:** a trial of the signed note and the reader's deadline on the next pair of lanes that share a border; and a count of how often a claimed agreement points at the other side's own words [1].
3. **Not this essay.** How often notes across a border hold. One day and one border cannot say.

## Where to check

The body describes tickets, notes and changes in plain words. This table gives each one's identifier and source.

| As the body describes it | Ticket, note or change | Source |
|---|---|---|
| The Runs lane and the Prompts lane | LIN-4447 (Runs & dispatch), LIN-4448 (LLM & prompts) | [1]; [2] `issues/` |
| The front-end lane and the Jira lane | LIN-4446 then LIN-4463; LIN-4445 | [1] Method |
| The proposal of 13:36 | note d3ba7421, on LIN-4448 | [2] `issues/LIN-4448.json` |
| "A sibling's reply isn't a human hand-back" | note dc7461eb, on LIN-4447 | [2] `issues/LIN-4447.json` |
| John's ruling at 15:33; the planning agent at 15:35 | note 643eef60; the 15:35 plan row for LIN-4448 | [1] Finding 2; [2] `dispatches.json` |
| The agreement of 15:39 and the correction of 15:55 | notes 08c9c898 and 097a3442, on LIN-4447 | [2] `issues/LIN-4447.json` |
| The reviewer who caught the slip | note 72406236, on LIN-4448 | [1] Finding 2 |
| The three moves landing | PR #2432 (17:12), #2435 (18:08), #2438 (19:27) | [2] `prs.json` |
| 30 test runs, all passing | `gh run list --branch main --workflow Tests` | [2] |
| The eleven notes, five asks, one answer | `directed_messages` | [2] `census.json` |
| The three notes at the wrong door | notes 1a2e7cba, 0510ffe0, b564445b, on LIN-4448; the pieces at work were LIN-4464 and LIN-4465 | [1] Finding 3; [2] `dispatches.json` |
| The merge taken as the answer, 20:34 | note 882fc992, on LIN-4448 | [1] Finding 3 |
| The three reports to a closed lane | notes 3300ab65, 36a9d8e0, 29848ba2, on LIN-4447 | [1] Finding 4 |
| The notice of 21:58 and John's ruling of 22:00 | notes b555094d (on LIN-4447) and 24e376c1 (on LIN-4468); PR #2443 | [1] Finding 5; [2] |
| The item recorded "as agreed" | PR #2450, merged 09:49 on 14 November | [1] Finding 5 |
| The last step that changed the Runs side | PR #2457, commit 06a7da871 | [1] Finding 5; [2] |
| Eleven notes read as a person's word | `person-comments.mjs` | [1] Finding 4; [4] |
| 29 changes, 353 files, 48 shared; the pairs | `merged_prs_by_lane`, `shared_files_by_lane_pair` | [2] `census.json` |
| The two files all four lanes changed | `server.js`, `docs/architecture/source-map.md` | [1] Finding 6 |
| The August fence; the take-turns rule | — | [5] |
| The wait logged as a plain link | `related` where the instruction said `blocks` | [1] Findings 2 and 8 |
| The 1 October circle | — | [8] |

## Reading list

1. **Paper: *Can parallel lanes coordinate with each other, and what would helping them do it unlock?*, version 2** (`docs/papers/harbour/lanes-across-the-seam.md@993f618bc`). Supports the account of the day, the reasons it happened, the six fixes and the costs. Does not show how often such an exchange holds: it covers one day and one border, and its proposals are untested. A second document checked its version 1 (`docs/papers/harbour/lanes-across-the-seam-check.md@993f618bc`); the version 2 changes, which include the account of the border moving from one side, have had no second reader. One wording differs here on purpose. The paper says each of the three moves came with a fallback, which is the sending lane's own description; the note itself spells out a fallback only for the first move, and this essay says only that.
2. **The record: the paper's evidence folder** (`docs/papers/harbour/lanes-across-the-seam-evidence/` at `993f618bc`: `census.json`, `prs.json`, `dispatches.json`, `issues/`), plus two things read outside it for this essay: commit `06a7da871`, and the main line's test runs (`gh run list --branch main --workflow Tests`, 30 of 30 passing between 13 Nov 12:00Z and 14 Nov 09:50Z, re-read on 14 November). Supports every count, time and quotation in the body and in Figures 2 and 3; the figures' script asserts each value it draws (`docs/papers/harbour/notes-across-the-border-scripts/charts.mjs`). Does not show whether a note was read: an answer is counted only where one is written down, and which note answers which was coded by hand in the paper.
3. **LIN-4480, the ticket's "As asked" block** (read 14 November 2026). John's question of 13 November, and his phrase of 5 November. Supports his words as recorded there. Only the words in quotation marks are his; the rest of the description of his network is the ticket's paraphrase.
4. **The paper's script for notes read as a person's word** (`docs/papers/harbour/lanes-across-the-seam-scripts/person-comments.mjs@993f618bc`), re-run for this essay on 14 November against the code at `fb358dbda`. Supports the count of eleven. Does not say who wrote each of the eleven; that was read by hand, in the paper: one relays words John had approved, and ten are agents' notes, nine of them inside one lane and one across the border.
5. **Harbour's own rules for parallel work** (`docs/runbooks/improvement-cycles.md@993f618bc:80`, the take-turns rule; `docs/worker-lane-prompt.md@993f618bc:70-75`, the declared files of 23 August). Supports that the rule exists and that the August lanes report no collisions. The August figure is the prompt's own account, not re-measured here.
6. **Gray & Cheriton, "Leases: an efficient fault-tolerant mechanism for distributed file cache consistency", 1989** ([doi:10.1145/74851.74870](https://doi.org/10.1145/74851.74870)). Supports the idea of a lease: a right that expires with time. It comes from another field, file systems on a network, so here it is a mechanism to consider, never an estimate. Title and abstract confirmed at the DOI on 14 November; the full text was not read.
7. **Coffman, Elphick & Shoshani, "System Deadlocks", 1971** ([doi:10.1145/356586.356588](https://doi.org/10.1145/356586.356588)). Supports the textbook account of deadlock: parties that each hold something while waiting for another, in a circle of waits. It is about operating systems of half a century ago, so it is an analogy for lanes, not a measurement. Title and abstract confirmed at the DOI on 14 November; the account is given here as the paper under [1] and standard textbooks state it, and the full text was not read.
8. ***Between the sessions*** (`docs/papers/harbour/between-the-sessions.md@993f618bc:122-126`). Supports that Harbour has had a waiting circle: three agents on 1 October, and the 35 minutes. That circle was not between lanes.
9. **Cemri et al., "Why Do Multi-Agent LLM Systems Fail?", 2025** ([arXiv:2503.13657](https://arxiv.org/abs/2503.13657)). More than 1,600 annotated traces from seven frameworks, fourteen failure modes in three categories, one of them inter-agent misalignment (agents falling out of step with each other) (the abstract was read on 14 November; it is a preprint). Supports that this family of failure is known beyond Harbour. Says nothing about how often it happens in Harbour.
