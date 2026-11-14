---
title: Nothing fights its shape
kind: essay
argument: Code, comment, doc, note, ticket and log name where something is written, not what it says; what is said comes in a few kinds, told apart by how each can be wrong and how each ends, and many of the tangles Harbour has measured are one kind kept in a place made for another, or carried forward by copying and retelling, so much of the simplification comes from letting each kind rest where something keeps it true and move on by changing form, not by being copied or retold; what resists is that one thing can be about a place, a job and a moment at once, and that some understanding fits on no page.
version: 1
date: 2026-11-14
authors: [Claude (LIN-4485; reasoned and designed by Fable 5.2, written by Opus 5.5), for John Kershaw]
model: "Reasoned and designed by claude-fable-5-2 (Fable 5.2), Claude Code CLI, dispatched by Harbour as a custom run on LIN-4485 (dispatch 7a2d17e7; effort high, as the dispatch row reports it): the argument, the structure, the two figures, and every source, each read at the place cited. Written from that design by a claude-opus-5-5 (Opus 5.5) subagent in the same session; its effort is not recorded. One fresh reader, a separate subagent given only this essay and told it was new to Harbour, reported where it got lost and where the argument claimed more than it showed; the designer decided the changes and the writer made them (the list is in the pull request). Not independently checked."
sources: ["docs/papers/harbour/steering-text.md@993f618bc", "docs/papers/harbour/beyond-the-code.md@993f618bc", "docs/papers/harbour/lanes-across-the-seam.md@993f618bc", "docs/papers/harbour/tasks-are-tasks.md@993f618bc:15,25", "docs/papers/harbour/the-place-became-somebodys-job.md@993f618bc:93", "docs/papers/harbour/starting-context.md@993f618bc:128", "docs/papers/harbour/wake-inventory.md@993f618bc:177", "docs/papers/harbour/ticket-record-and-quality.md@993f618bc:14-22", "lib/prompt-formatters.js@993f618bc:171", "lib/brief.js@993f618bc:1-29", "lib/as-asked.js@993f618bc:1-13", "docs/areas/README.md@993f618bc:103-104", "CLAUDE.md@993f618bc:108", "LIN-4485 (the As asked block, 14 November 2026)", "LIN-4401 (description, 10 November 2026)", "LIN-4021 (description, 29 October 2026)", "https://plato.stanford.edu/entries/speech-acts/", "https://doi.org/10.1056/NEJM196803142781105", "https://doi.org/10.1001/jamanetworkopen.2021.15334", "https://diataxis.fr/start-here/", "http://www.bkent.net/Doc/simple5.htm", "https://longnow.org/ideas/pace-layers/", "https://www.cidrdb.org/cidr2015/Papers/CIDR15_Paper16.pdf", "docs/papers/harbour/how-a-task-is-composed.md@993f618bc:110-118", "https://www.patternlanguage.com/archive/cityisnotatree.html", "https://wiki.c2.com/?ThreadMode", "docs/papers/harbour/the-second-copy.md@993f618bc:57", "https://doi.org/10.1016/0165-6074(85)90032-8", "docs/papers/harbour/how-process-changes-land.md@993f618bc:16-21"]
---

# Nothing fights its shape

Code, comment, doc, note, ticket and log are places to write, not kinds of information. That is this essay's answer to John Kershaw, who builds Harbour and asked how the kinds of information around a codebase "relate, move, and need to be held in a shape". It mostly agrees with his guess that "if everything is in its right place, no tangles" [10]. The kinds are few, each told apart by how it can be wrong and how it ends. Many of the tangles Harbour has measured come to one of two things: a kind kept in a place made for another, or a kind carried forward by copying and retelling when it should have changed form. When each rests where something keeps it true, and moves on by changing form (a job becomes a change, a lesson becomes a test), much of the writing turns out to be retelling, and unnecessary. Several things resist; the two largest are that one thing can be about several things at once, and that some understanding fits on no page.

Harbour is a tool that hands software work to AI agents. Each piece of work is a ticket; a fresh agent session reads it, does the job and leaves. Harbour is built this way too, so most examples here are from its own code. The title is John's phrase, from the same note: "Nothing fights its shape" [10]. This essay is a way of looking, not a scheme to adopt, and leans on three Harbour papers of 14 November, each of which found one corner of the same picture [1, 2, 3], and on ideas from other fields.

## The circles and what is inside them

John pictures a Venn diagram of tasks, comments and code, with "rich overlapping concepts" [10]. A ticket holds what someone asked for, a plan, decisions, findings, what is left, a status, and the talk that worked them out. A comment beside code holds a reason, a warning, a to-do, or a description of the line below. A note holds the same again. Harbour keeps area notes: one file per area of the code, kept with the code, holding lessons about changing that area and a list of work waiting there. A paper had two readers sort all 221 entries by what each said, and they agreed on 89% [2]. The entries were warnings about how a change goes wrong, pointers to the one place a rule lives, reasons and rulings, and waiting work [2].

So the same few things turn up in every circle, and each circle is named for where and how something is written. A comment is text beside something, a doc is text in a file, a note is short text, a ticket is text attached to a job, and a log is text in time order. The overlaps John expects are not at the edges. They are the contents. Even "comment" is two places, beside code and under a ticket: the word says where, not what.

![Left: three overlapping circles labelled ticket, comment and code, with the same items in their overlap: a reason, a rule, a to-do. Right: a grid with the kinds of thing said down the side and the places they are written across the top. Every kind but one has a mark in several places; a test, a commit and a log carry one or two kinds, while a thread, a note and a doc carry five or six.](figures/nothing-fights-its-shape/circles-and-kinds.svg)

*Figure 1. A drawing, not data: this essay's reading of where each kind is written today. The kinds are set out in the next section.*

An observation of this essay's own, not measured: the places that give least trouble are the ones named for what they hold. A test holds a rule. A commit holds one change and when it happened. A log holds what happened, in order. A ruling holds a decision. Harbour's "As asked" block, at the top of a ticket, holds the person's own words and nothing else [9]. Trouble gathers in the places named for how they are written (doc, note, comment, thread), and in the ticket, which is named for a job and has come to hold everything said about it.

Two other fields met this; their ideas are mechanisms to consider, never estimates for Harbour. In medicine, hospital records were filed by who wrote them: doctors' notes, nurses' notes, laboratory results. In 1968 Lawrence Weed proposed organising the record around a numbered list of the patient's problems [13]. Each note went under a problem, in fixed parts: what the patient reports, what was measured, what the clinician concludes, and the plan [13]. In documentation, the Diátaxis framework says "docs" is four different things: tutorials, how-to guides, reference and explanation [15]. They differ by what the reader is doing, and "crossing or blurring the boundaries" between them "is at the heart of a vast number of problems in documentation" [15].

It matters more now. Medicine also shows what cheap writing does. A study of 2.7 million outpatient notes at one American academic medical centre found the median note 60% longer in 2018 than in 2009, from 401 words to 642 [14]. In the median 2018 note, 58.8% of the text repeated the same patient's previous note. On average 29.4% of a note was typed directly; the rest was templated or copied [14]. Agents write for almost nothing, and each session starts remembering nothing. Harbour's steering text (the prompts, rules and notes agents are given to read) has taken in 6.3 bytes for every byte removed [1]. Two things used to keep the pile small: writing was costly, and people remembered. With agents neither holds. This essay's reading is that where a thing is kept must now do more of the work that thrift and memory did.

## Two lists

The philosopher Elizabeth Anscombe gives the picture this essay leans on most [12]. A man goes round a shop with a shopping list. A detective follows him, writing down everything he buys. At the checkout the two lists may carry the same words and still be different kinds of thing. If the shopper's list and the basket disagree, the mistake is in the basket, and he fixes it by changing what he bought. If the detective's list and the basket disagree, the mistake is in the list, and he fixes the list [12].

Every sentence written about the code is one list or the other (the code itself is the basket), and the page rarely says which. Harbour's guide to its area notes says the lessons section must stay within 6,144 bytes. That is a shopper's list: the notes must comply. The test that enforces it reads its own number and fails if the guide stops stating it, so the two cannot drift [9].

One note entry said that about 16 places in the code compared a credential in a way that should go through a helper, seven of them in one file, and that only two modules used the helper [2]. That is a detective's list, written once. The code moved on: when the paper checked, all seven in that file called the helper and eleven modules used it [2]. The code was fine; the list was wrong, and nothing made it fail.

A plan is a shopper's list before the work, and afterwards a detective's list that nobody corrects. A to-do is a shopper's list too, though it is often written as if it described the code. Sorting sentences by which list they are, and by time, gives a handful of kinds, set out below.

| | Kind | For example | It goes wrong when | What can keep it true | How it ends |
|---|---|---|---|---|---|
| What was | What happened | a commit, a log, a session's transcript, what was said in a thread | it cannot go stale, because it is dated; its trouble is that it is long and seldom read | being dated and never edited | it does not end; it gets older |
| | Why | a reason, a ruling: what was decided, by whom, and when | it is edited instead of replaced, or cannot be found from the thing it explains | the same, and a pointer from what it explains | replaced by a later decision, never erased |
| | What was found | a measurement, a review, a paper | it is read as true now when it was true then | saying what it was read from, and when | replaced by a newer reading |
| What is | What is so | the code, its settings, and anything worked out from them when asked: a count, a list, a status | by itself it cannot; only copies of it can | it runs, or it is computed | it is changed, and the change leaves a record |
| What is to be | What is wanted | the ask, the purpose, "done when" | it is retold, or changed by someone other than the person | being kept in the person's own words | the person says it is met, or changes their mind |
| | What must hold | a rule, a limit, a lesson, the standing text agents are given | nothing checks it, or its reason has gone and it stays | a check that fails | its reason ends, if anything says when |
| | What remains to do | a task, a to-do, a waiting entry, a plan | the work is done or dropped and the entry stays, or it sits in two lists | a status and an owner | done, dropped, or handed on |

The count is not the point: the notes paper found four kinds in notes alone, and its two readers used nine labels [2]. The columns are the point: how a thing goes wrong, what keeps it true, how it ends. They also part things that arrive together. A ruling is the record that something was decided, by whom and when; the rule it made is what must hold. One event gives two kinds, kept in two ways.

The three groups are the two lists again. What was is a detective's list with a date on it, so it never becomes false; it can only be misread as current. What is to be is a shopper's list, which is why each item needs an owner and an end. What is so is the basket.

One familiar thing is missing from the table: the description. A document saying what the code does, a count kept by hand and a status report are each a detective's list about the present with no date. It is the one thing here that any change to the code can make false without anyone touching it. The notes paper found exactly this. Every one of the 253 code names cited in the notes of Harbour's main repository still existed. Yet 8 of the 44 entries that made a checkable claim about the code carried a false one, and seven of those eight were a count [2]. Harbour uses both ways out. Date it, and it becomes a finding: every paper in Harbour's archive says which commit it was read at, so a paper grows old but does not become false. Or compute it, and it becomes part of what is so. The project's own rules say that a list and a count kept by hand in its documentation are "checked against source at test time, never trusted as written" [9].

## Kept with what it is about

A thing's shape, in this essay, is its answers to four questions: what keeps it true, how it ends, what it is about, and who needs it and when. A place fits a thing when its answers are the same. The table gave the first two; this section takes the others.

Database designers settled what a fact is about long ago. William Kent's 1983 guide to their rules uses a stock list on which every row for a part also carries the address of the warehouse it is stored in [16]. The address is a fact about the warehouse, kept with facts about parts. Kent lists what follows: it is repeated on every row; when it changes, every row must change; rows can come to disagree; and a warehouse with no parts has nowhere to keep its address [16]. The rules, he writes, "are designed to prevent update anomalies and data inconsistencies" [16].

Harbour has met these. Nowhere to write it: an earlier essay in this archive found that what an agent learned about a corner of the code "was filed under the job, not the place". In its words: "When the job closes, so does the memory" [4]. It records the one decision John would be willing to reopen, the ticket as the source of truth, which that essay says "conflates three things: the record of the job, the plans, and the place's memory" [4]. The same fact written twice: a third of the lessons in the area notes (31 of 91) restate a rule that a test already enforces [2].

The fix for having nowhere to write made a new problem. In November the area notes gave places a home, and work agents spotted outside their own job went there instead of into new tickets, partly because each finished change had been producing about 1.4 new tickets [11]. But waiting work is a thing to be done, and the tools that rank and sweep work read tickets. In six days the waiting lists grew from 30 entries to 118 [2]. Nine safety findings sat in notes, and Harbour's safety sweep, which is built from tickets, named none of them until two were moved across on 14 November [2]. The move answered what the work is about (a place) and broke who needs it (whoever ranks the work).

Lifetime clashes too. Stewart Brand describes systems as layers that change at different speeds: "Fast learns, slow remembers. Fast proposes, slow disposes" [17]. Each layer, he holds, has to respect the pace of the others [17]. A fast fact in a slow place goes stale there, like a count inside a lesson (the seven false counts above). So does a line in the code that keeps an old name "until" a named ticket retires it, still there after that ticket was marked done [1]. A slow thing in a fast place is lost, like a prompt's purpose said once in a thread. The paper on Harbour's steering text found that nearly all of its real shrinking came in two ways: the thing a passage described was deleted, or one author rewrote a whole prompt or guide from its purpose. Trimming single rules never moved the total by a kilobyte [1].

## How it moves

Each kind is on its way to becoming another. Something is said in talk. It settles as a want, a decision, a finding or a job. A job becomes a change. A change becomes new code and a record that it happened. Running the code makes more records. Someone reads them and finds something, which becomes a lesson or a new job.

![A flow. Talk settles into four things: what is wanted, a decision and why, a finding, and a job. The job becomes a change, and the change becomes what is so: the code. Under them all runs one long bar, the record of what happened, dated and never edited; dashed arrows show each form closing and joining the record. One arrow returns from the record to a finding: read later, the record gives a new finding.](figures/nothing-fights-its-shape/how-it-moves.svg)

*Figure 2. A drawing, not data: how one kind becomes another. A healthy move changes the form, closes the old one and leaves a pointer.*

The second picture comes from bookkeeping. Bookkeepers keep two things: a journal of dated entries that is only ever added to, and a balance worked out from it. Pat Helland, writing about databases, puts the rule this way: "Accountants don't use erasers or they go to jail", and corrections are made "only by making new entries" [18]. Of a database and its log he says, "The truth is the log. The database is a cache of a subset of the log" [18]. The code is held like this: version control keeps the journal, every change dated and signed, and the current files are the balance; nobody asks whether the two agree.

Almost everything else keeps the living thing and its history together. A ticket is a journal (its thread) with a balance kept by hand (its description and status). Harbour's prompts for each stage of work tell the agent to read the description and thread first, "since they are the source of truth" [9]. Across September's tickets with more than one session, 52% of what a session read (files, tickets and instructions) had already been read by an earlier session on the same ticket [6]. That fits a reading in which each session works the state out again, but it does not show the cause: a session that remembers nothing must read something.

The test that caps the size of Harbour's prompts records a reason beside every raise, so its history lives inside the living file. That record of reasons grew from under 12,000 bytes to over 30,000, while the text it caps fell by 30% [1]. An area note is a balance with no way to close an entry. When one busy note was tidied, some entries were settled and others only moved to another list. A comment on the ticket put it plainly: "A move is not an exit" [2].

Harbour already builds a balance for tickets, called the brief: "the smallest artifact that lets an agent start and finish a task correctly without reading the raw history" [9]. Its history shows two kinds needing two treatments. At first a model wrote all of it, including what the person had asked for. A paper that compared 60 briefs with their tickets judged 27 to have changed something that mattered, mostly by reopening what had been settled [19]. A second reader, on 15 of them, found fewer, so 27 is likely high [19]. Now the present state is still worked out by a model, while the person's words are carried across byte for byte, because they "never pass through the model" [9].

And the brief was added beside the thread, not in place of it: of 2,843 sessions, 59% read the brief and then the ticket, and 35% the ticket and then the brief [19]. Whether re-reading has fallen since has not been measured.

Harbour has measured four ways a move goes wrong.

**It arrives and never leaves.** The steering text has taken in 6.3 bytes for each byte out [1]. Of 57 commits whose titles say they cut, remove, simplify, fold or retire, 37 left the steering text larger, because a cut explains itself and restates the result [1].

**It stops halfway.** A lesson stays a sentence when a test could hold it. A temporary structure has no end written in: a study of 27 changes to Harbour's process found none that came with a condition for retiring it [24].

**It travels by retelling.** A ticket becomes a brief, the brief a plan, and the plan code and comments, "like a photocopy of a photocopy" [5]. Harbour runs work in lanes, each a line of tickets worked by its own agents in parallel with others. One lane recorded a move as "as agreed" with its neighbour, when the neighbour had neither proposed nor accepted that item, and nothing checked the claim against the other thread [3].

**It is sent where nobody is reading.** A message is said to someone and needs a reader and a time; a ticket thread is a record. When two lanes used threads as a postbox, three requests went to a parent ticket while the other lane's agents were working on its child tickets [3]. Three reports were posted to a ticket that had closed fifteen minutes earlier [3]. That paper's summary: Harbour's channels carry messages up and down a line of work, not across it [3].

## What might not be needed

If this reading is right, much of the writing around a codebase is retelling, and John's guess, "Some may simply not be necessary" [10], has candidates. Each is a candidate, not a finding.

- Descriptions of what the code already says, and counts written by hand. Compute them or date them.
- The lesson that restates its test: a third of the lessons in Harbour's notes [2].
- The second backlog. Work waiting in notes and work waiting in tickets are the same kind in two places [2].
- Status sent as a message. In September, 35% of the wake-ups Harbour delivered to agents that supervise other agents were one supervisor passing its own decision to keep waiting up to its parent, and 97% of those changed nothing [7]. A status is what is so, and can be read where it lives.
- The plan left in the ticket after the code exists, and the pipeline's own comments about its steps. Over 184 finished tickets, the size of the record had no measurable relation to whether the work passed review; what reviewers used was the problem statement, the acceptance criteria and the files named [8].
- Campaigns to cut text. If a thing's end is written when it is made, nothing has to be hunted down later [1].
- Some of the asking. In about a day four lanes changed 48 of the same files, and only one pair of lanes exchanged messages about it. Version control and the tests settled the rest without a word [3].
- Perhaps the words "doc" and "note" themselves. If each kind had a home, the notes paper's own count of what would still need prose in a note is about one entry in ten: rulings, and warnings that no single place in the code owns [2].

What stays is what is wanted, why, the warnings with no single site, and the talk: the things only prose holds. It is a much smaller pile, and the hard one.

## What resists

Of the five limits below, the first and third are large and the others are smaller.

**The overlap is real.** Christopher Alexander's essay on city plans separates a tree, in which any two groups are either nested or wholly apart, from a structure in which groups overlap [20]. He warns that "the mind has an overwhelming predisposition to see trees wherever it looks" [20]. Read as one home for each thing, "everything is in its right place" is a tree. A defect left in the code is about a place, is a job, came from a reading on a certain day, and may bear on safety. Any single home hides it from someone, as the nine safety findings showed. The usual way out is one home and many views; Weed's problem list was that, one list that every note points to [13]. But a view needs structure, such as ids and fields, and structure has a cost: the notes took in the waiting work in the first place partly because tickets were costly. Where that trade should sit is open.

**The talk has to stay free.** Everything in the table starts as talk, and talk filed sentence by sentence stops being thinking. John, on rewriting Harbour's prompts: "asking them to follow precise steps undermines their ability to reason" [11]. Ward Cunningham's original wiki named two modes: a thread, where signed remarks follow each other, and a document, which makes one point [21]. The hope was that a thread "gradually, over time, becomes a DocumentMode page", and the same page has a name for when it does not: "ThreadMess" [21]. So the rule cannot be that every remark declares its kind, only that what must outlive the talk leaves it in its own form. That is a finishing step, and an essay in this archive on duplicated decisions found that in every migration pattern "the step that gets skipped is always the last one" [22]. Who does the leaving is open.

**Some of it fits on no page.** Peter Naur argued in 1985 that programming is building a theory of the problem in the programmers' heads, and that the program and its documents are secondary [23]. He held that "the death of a program happens when the programmer team possessing its theory is dissolved", and that rebuilding the theory "merely from the documentation, is strictly impossible" [23]. A fleet of agents dissolves its team at the end of every session. This essay concerns only the part that can be written down. How large the other part is for agents, and whether a well-kept record lets a fresh agent regrow it quickly enough, nobody has measured.

**Someone has to say which kind a sentence is.** If the writer must declare it, every remark grows a label. If a program guesses, it guesses wrong in ways that matter: Harbour's own classifier treats any agent note without a recognised heading as a person's comment, because agents post under a person's account. So one lane's notice on another lane's ticket counted as John speaking [3]. Who is allowed to say a thing matters as much as what is said, and the page does not show it.

**The evidence is thin.** The three papers this essay leans on most were written on one day, about one codebase. Two have not yet been checked: in this archive a paper counts as checked when someone else has written a second document testing it. The area notes were six days old when they were studied. The kinds in the table are this essay's guess, and the first proposal below is a way to test it.

## Next

1. **How much of what a session is given to read is retelling?** One line is added to the Library's list of proposed studies (`proposals.md`): take the description, thread, area notes and standing prompt text given to the sessions on twenty recent finished tickets; have two readers sort each statement by kind, by whether this is its only home or a retelling of something held elsewhere, and by whether anything the session did used it; report the share of retelling by place and kind, and the statements neither reader could place.
2. **Has re-reading fallen since sessions began reading the brief first?** A second line: repeat the September count of repeated reads [6] on October's and November's sessions, when 97% read the brief first [19].
3. **Not this essay.** Building any of it. The three papers each carry their own proposals for a register of waiting work, for scaffolding that names its own end, and for messages between lanes [1, 2, 3]. This essay adds a way of seeing why they are one problem, and does not rank them.

## Where to check

The body describes things in plain words. This table gives each one's ticket or path and its source.

| As the body describes it | Id or path | Source |
|---|---|---|
| John's four remarks | LIN-4485, the "As asked" block | [10] |
| 221 note entries sorted by two readers, 89% agreement | — | [2], Finding 1 |
| The "As asked" block | `lib/as-asked.js` | [9] |
| The 6,144-byte limit the test and the guide both state | `docs/areas/README.md`, guard check 5; `tests/unit/area-notes.test.js` | [9] |
| The credential entry: 16 places, seven in one file, two modules; then all seven and eleven | `routes/proxy-compute.js` | [2], Finding 5 |
| 253 names still exist; 8 of 44 entries false, seven by a count | — | [2], Finding 5 |
| Lists "checked against source at test time, never trusted as written" | `CLAUDE.md`, Invariants | [9] |
| "Filed under the job, not the place"; the decision John would reopen | — | [4], opening and line 25 |
| 31 of 91 lessons restate a test | — | [2], Finding 4 |
| About 1.4 new tickets from each finished change | LIN-4401 | [11] |
| Waiting lists 30 to 118 in six days; nine safety findings in notes | LIN-4416 (the safety sweep) | [2], Findings 2 and 3 |
| The line kept "until" a ticket that is already done | LIN-4015; `public/style.css` | [1], Finding 6 |
| Shrinks came from deletion or a rewrite from purpose; single trims never moved a kilobyte | LIN-3300, LIN-4021, LIN-3326 | [1], Finding 3 |
| "Since they are the source of truth" | `lib/prompt-formatters.js:171` | [9] |
| 52% of reads repeat an earlier session's | — | [6], line 128 |
| The prompt-size test's reasons, 11,659 bytes to 30,076 while the capped text fell 30% | `tests/unit/prompt-size-budget.test.js` | [1], Finding 2 |
| "A move is not an exit" | LIN-4448, LIN-4470 | [2], Finding 2 |
| The brief; "never pass through the model" | `lib/brief.js`; LIN-4351 | [9] |
| 27 of 60 briefs changed something that mattered; 59% and 35% reading order; 97% brief first | — | [19], lines 110 to 118 |
| 6.3 bytes in per byte out; 37 of 57 cutting commits grew the text | — | [1], Findings 1 and 2 |
| None of 27 process changes came with a condition for retiring it | — | [24], lines 16 to 21 |
| "Like a photocopy of a photocopy" | LIN-4340 | [5] |
| "As agreed" without the other side | LIN-4448, LIN-4470, LIN-4447 | [3], Finding 5 |
| Three requests to a parent ticket; three reports to a ticket closed fifteen minutes before | LIN-4448, LIN-4447 | [3], Findings 3 and 4 |
| 35% of wake-ups were relays, 97% changed nothing | — | [7], line 177 |
| 184 finished tickets; what reviewers use | — | [8], opening |
| 48 files changed by more than one lane; one pair exchanged messages | — | [3], Finding 6 |
| About one note entry in ten needs prose | — | [2], Finding 1 |
| John on precise steps, 29 October | LIN-4021 | [11] |
| An unheaded agent note read as a person's comment | `lib/run-trail.js` | [3], Finding 4 |

## Reading list

1. **Paper: *Why does the text that steers Harbour's agents keep growing, and what has ever made it shrink?*, version 1** (`docs/papers/harbour/steering-text.md@993f618bc`). Supports the growth figures, the two ways the text has shrunk, the ledger of reasons in the prompt-size test, and the line kept past its ticket. Not yet checked by a second document. It describes the growth; it does not show that the growth made the work worse.
2. **Paper: *What do agents need to know about a codebase beyond the code, and where should each kind of knowledge live?*, version 1** (`docs/papers/harbour/beyond-the-code.md@993f618bc`). Supports every figure about the area notes. Not yet checked by a second document. It studies six days of a new system, and its two readers and its author are the same model family. Its kinds are kinds of note entry, narrower than this essay's.
3. **Paper: *Can parallel lanes coordinate with each other, and what would helping them do it unlock?*, version 2** (`docs/papers/harbour/lanes-across-the-seam.md@993f618bc`). Supports the message cases, the shared files, the claimed agreement and the classifier. Checked at version 1. It covers one day and one seam between two lanes.
4. **Essay: *Tasks are tasks, and the codebase is a place*, version 5** (`docs/papers/harbour/tasks-are-tasks.md@993f618bc:15,25`). Supports the account of the place and the job, and John's remark on the ticket as source of truth, as that essay records it. An essay, not a measurement.
5. **Essay: *Clearing up as it goes*, version 4** (`docs/papers/harbour/the-place-became-somebodys-job.md@993f618bc:93`). Supports the photocopy observation, which that essay marks as an observation, not a result.
6. **Paper: *How much of a session goes on finding its starting context…*, version 2** (`docs/papers/harbour/starting-context.md@993f618bc:128`). Supports the 52% figure, over 277 tickets with two or more sessions begun after 1 September. It does not cover October or November.
7. **Paper: *What are all the paths that wake a Harbour supervisor…*, version 2** (`docs/papers/harbour/wake-inventory.md@993f618bc:177`). Supports the 35% and 97% figures, for September. It describes only; it tests no change.
8. **Paper: *Could the way tickets are written and updated be simplified without losing output quality?*, version 2** (`docs/papers/harbour/ticket-record-and-quality.md@993f618bc:14-22`). Supports the finding that the size of the record did not predict the review outcome over 184 tickets, and what reviewers used. It does not show that a slimmer ticket was ever tried.
9. **Harbour's code and guides at `993f618bc`**: `lib/prompt-formatters.js:171` (read the thread first, "since they are the source of truth"); `lib/brief.js:1-29` (the brief; "never pass through the model"); `lib/as-asked.js:1-13` (the person's words kept "byte for byte"); `docs/areas/README.md:103-104` (the guard and the guide cannot drift); `CLAUDE.md`, under Invariants ("checked against source at test time, never trusted as written"). Supports what the code says it does. It does not show how often each is followed.
10. **LIN-4485, the ticket's "As asked" block (John, 14 November 2026).** The four remarks quoted, and the question. Read through Harbour's workspace proxy on 14 November.
11. **LIN-4401 (description, 10 November 2026) and LIN-4021 (description, quoting John, 29 October 2026).** The first supports "about 1.4 tickets" per finished change, as the ticket states it; the figure was not re-derived here. The second supports John's words on precise steps. Both were read through the workspace proxy on 14 November.
12. **G. E. M. Anscombe, *Intention* (1957), section 32, as set out in Mitchell Green, "Speech Acts", *Stanford Encyclopedia of Philosophy*, section 3.1** (https://plato.stanford.edu/entries/speech-acts/). The shopper's list and the detective's list. Read in the encyclopedia's account, not in Anscombe's book. This is philosophy of language from 1957: a distinction to think with. The mapping onto a codebase's writing is this essay's own.
13. **Lawrence L. Weed, "Medical records that guide and teach", *New England Journal of Medicine* 278(11), 1968, pages 593 to 600** (https://doi.org/10.1056/NEJM196803142781105). The record organised by problem, with notes in fixed parts. Confirmed from the citation and from secondary accounts; the article itself was not read for this essay. Medicine, 1968: a mechanism, not an estimate.
14. **Adam Rule, Steven Bedrick, Michael F. Chiang and Michelle R. Hribar, "Length and Redundancy of Outpatient Progress Notes Across a Decade at an Academic Medical Center", *JAMA Network Open* 4(7), 2021, e2115334** (https://doi.org/10.1001/jamanetworkopen.2021.15334). The note figures, read from the abstract: 2,704,800 notes at Oregon Health & Science University, 2009 to 2018. Redundancy there means the share of a note's text identical to the same patient's last note. It is about clinicians, not agents. It shows what cheap copying did to one kind of record, and says nothing of code.
15. **Daniele Procida, *Diátaxis*** (https://diataxis.fr/start-here/). Four kinds of documentation, and the cost of blurring them. A practitioner's framework, argued from experience, not a study.
16. **William Kent, "A Simple Guide to Five Normal Forms in Relational Database Theory", *Communications of the ACM* 26(2), 1983, pages 120 to 125** (http://www.bkent.net/Doc/simple5.htm). The warehouse address, and what follows from keeping a fact with the wrong subject. This is database design: the rules are about tables of data, and applying them to prose is an analogy.
17. **Stewart Brand, "Pace Layering: How Complex Systems Learn and Keep Learning" (2018)** (https://longnow.org/ideas/pace-layers/). Layers that change at different speeds. Written about civilisations and buildings; an image of a mechanism, not evidence about software.
18. **Pat Helland, "Immutability Changes Everything", CIDR 2015** (https://www.cidrdb.org/cidr2015/Papers/CIDR15_Paper16.pdf), sections 2.1 and 2.2. The log and the cache; accountants and erasers. It is about databases and storage, and says nothing of tickets or notes.
19. **Paper: *How is a task composed, and does that shape the way it runs?*, version 2** (`docs/papers/harbour/how-a-task-is-composed.md@993f618bc:110-118`). Supports the brief figures: 27 of 60 by the first coder, with the second coder's lower reading; the reading order over 2,843 sessions; and 97% reading the brief first since the week of 5 October. The 60 pairs predate the "As asked" block.
20. **Christopher Alexander, "A City is Not a Tree", *Architectural Forum* 122(1) and 122(2), 1965** (https://www.patternlanguage.com/archive/cityisnotatree.html). Trees and overlapping structures. City planning, 1965: a way to see why one home per thing is too simple, and nothing more.
21. **"Thread Mode", Ward Cunningham's WikiWikiWeb** (https://wiki.c2.com/?ThreadMode). Thread and document modes, and "ThreadMess". A community's own description of its practice, undated. It gives no measure of how often a thread became a document.
22. **Essay: *The second copy*, version 1** (`docs/papers/harbour/the-second-copy.md@993f618bc:57`). "The step that gets skipped is always the last one", said there of code migrations. Applying it to talk is this essay's step.
23. **Peter Naur, "Programming as Theory Building", *Microprocessing and Microprogramming* 15(5), 1985, pages 253 to 261** (https://doi.org/10.1016/0165-6074(85)90032-8). The theory that lives in the team. An argument from 1985 about human programmers, with case reports and no measurements. Whether it holds for agents is the open question, not a result.
24. **Paper: *When Harbour's process has changed, how did each change land…*, version 2** (`docs/papers/harbour/how-process-changes-land.md@993f618bc:16-21`). Supports that none of the 27 process changes it studied came with a condition for retiring it. A second reader there found one retirement note the first did not count.
