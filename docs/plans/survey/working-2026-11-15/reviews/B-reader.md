# B: cold reader's review of "Harbour: the course, and what needs your ruling"

Read from the export at revision 39 (32,967 bytes, about 6,200 words by `wc` with table markup counted, 52 ruling dropdowns). Line numbers below refer to the decoded copy at
`/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/writeup/review/doc.md`.

Nothing was edited: not the document, not a repository, not a ticket. The dropdown options export as empty cells, so where I say a row "cannot be answered with one dropdown" I am judging from the row, not from the option list.

Section 1 was written before I opened any background file and has not been touched since. Sections 2 onward were written after reading the three background files.

## 1. First impressions (written before any background, left unedited)

**What I understood the plan to be.** Work goes in "rounds". Round 1 is a dress rehearsal: a brand-new account, with a repository Harbour has never seen, tries to get from sign-up to a proven merge, and whatever breaks on the way is the work. One rebuild ("one write path for issues") runs beside it, plus a notes experiment, a three-task comparison against a plain session, and some trimming of the loop. Round 2 is an outside team on Jira. After that, nothing is fixed. Before any of it, John marks five tables.

I could say that after reading, so the plan itself is clear. But I only got it at line 128 ("The order"), about 1,900 words in. The opening sentence says the same thing in four coined terms at once ("open for business", "round", "the real path", "larger rebuilds") and I half-followed it.

**Where I stumbled, in reading order.**

1. The opening says "The plan comes first, then five rulings". What comes first is a twelve-row history table. The plan is the sixth and seventh sections.
2. The history table is the hardest part of the document to read, and it is the first thing after the opening. Cells I could not parse cold: "We ask where a change binds, where before we asked what was messy"; "The goal becomes a balance per task"; "The claim narrows" (which claim?); "five measures in order" (never listed anywhere); "a first stretch"; "The pattern gets a name" (the name is not given); "text grows about six to one" (six of what to one of what?); "One picture and one number" (a fragment); "planned slices"; "Six tickets became about seventeen".
3. Two sets of week figures that do not agree and are not reconciled. "Where Harbour is" says 115 landings, 44 of them product or code. "What is scarce" says $2,800 bought about 88 landings, about 34 of them product. Then 44 product plus 69 loop is 113, not 115. And "about 41% of the budget reached task work" matches neither 44/115 nor 34/88. I assume different windows or different counting, but the document does not say, and John will check the sums.
4. The bold line "Ordinary work now makes less new work than it finishes" (line 52) is taken back a hundred lines later: new capability left 1.57 items per landing and defect fixes 1.60, "and those are the kinds of work the path will mostly ask for" (line 151). So what is "ordinary work" if it is not features and fixes? I came away not knowing whether 0.65 is good news or an artefact.
5. "Product landings should rise from about 34 a week to between 100 and 130" (line 90). That is three to four times, on one week's numbers, and $2,800 at $32 is 88 landings in total. The one hedge sentence does not carry that.
6. "Three conditions I'd hold to" (lines 92 to 96) read to me as three new rules, in a document that says the loop gains nothing.
7. "A correction on rulings" sits between "what is scarce" and "why larger steps look cheap" and is about neither. Its last line, "which should be choices and not clauses", I had to read three times. And the document that says the fix is "what reaches you" then hands him 52 dropdowns.
8. "Three fates: on the path, rebuilt by a planned move, or cut" is followed by three bullets that are a different set of three (on the path and busy, on the path and quiet, off the path), then a fourth outcome ("or they stay as they are"), and then a ruling table whose commonest suggestion is a fifth ("Leave as is"). I could not map the fates onto the table. "Fate" also sounds heavier than what is being asked.
9. "v1 puts it out" (used four times). I first read "puts out" as "publishes". It means "leaves out".
10. "Before round 1, on your time only: give the three items the Jira check needs" (line 141). The three items are not named until Ruling 5, and Ruling 5 says the Jira check blocks round 2, not round 1.
11. In the rulings, several rows cannot be answered with one dropdown: rows that point to another ruling ("See ruling 2"), rows whose suggestion is "Your call", a row that asks for a rewritten sentence (the purpose lines in Ruling 4), and rows that bundle several things with different suggestions (the "Parked work" row holds five items and three suggestions).
12. Ruling 5 has a row about four "small product calls that shipped without your say", identified only by ticket number, with "Nothing was lost beyond your say". I could not tell what he is being asked.
13. The same facts kept coming back: the dress rehearsal is described five times, "no usage data" four times, "nothing above 2,816 lines has been tried" four times, "chosen when we get there" three times in twelve lines.

**Where I stopped following.** Twice. First in the history table (row 1 and the two 14 November rows). Second at the top of Ruling 3, where the row labels are all internal names ("Cut rule and the as-asked seal", "Look-first and the size record", "Leftover step, consequence test, Retires line") and I could only judge the rows by their numbers.

**What worked on first read.** "How a round of work runs" and "The order" are clear and short. "Where this plan goes beyond the record" is the most trustworthy passage and reads like someone reasoning. The Ruling 3 summary sentence ("one look, a build, one outside review that runs the result, a blind read that reports, and a close-out that merges and checks it live") is the single clearest sentence in the document. The "What the record says" column, where it sets two of John's own statements side by side, is fair and useful.

**Overall feeling.** A good two-page plan with a good ruling sheet, wrapped in a third document about how the author kept being wrong. Honest, but long, and it makes the reader wait for the plan.

---

## 2. Verdict against what John asked

His words were "putting this all together", "a more thought through narrative", and "how the ideas developed and came together into this clear, optimised, plan".

- **Clear?** The plan is clear once reached. It is reached late: about 2,260 words (by `wc`) sit in front of "How a round of work runs".
- **Optimised?** No, it is long. The rulings are half the document (about 3,100 words, 52 rows), and by my count about 30 of the rows are real questions. The prose before the plan repeats itself (list in change 10).
- **Narrative?** The dated table is a chronology, and its cells are the most compressed writing in the document. The five bullets under it ("Five ideas run all the way through") are the narrative he asked for, because each ends in "It is why..." and ties a thread to a feature of the plan.
- **Two sentences on what happens next?** He could say "round 1 is the dress rehearsal with one rebuild beside it, round 2 is the Jira team". He could not say when round 1 starts or which of the 52 marks it is waiting for. The document implies all of them ("Before round 1... Mark the ruling sheet below", and step 1: "The rulings it needs are already made"). That reading puts his marking in front of all work, which is the thing the document's own "correction on rulings" takes back.

## 3. The ten changes that would most improve it, ranked

### 1. Put the plan directly under the opening, and move the dated history to the end

**Where:** lines 5 to 31, and lines 116 to 144.

The opening says "The plan comes first". Make that true. Proposed order:

1. Opening (rewritten, see change 5).
2. "The order" table, then "How a round of work runs" (as they are).
3. "Five ideas run all the way through" (as it is; it now refers back to things the reader has just seen).
4. "Where this plan goes beyond the record" (as it is).
5. The rulings.
6. Background: "Where Harbour is", what is scarce, what the path trace found, the thirteen-area table.
7. The dated table "How the ideas came together", then Sources.

The dated table is worth keeping for the record, because he asked for the development to be shown. It should not be the first thing he reads.

### 2. Say which marks round 1 needs, say the rest can wait, and add the one ruling that is missing

**Where:** line 120, lines 138 to 142, and the top of the rulings.

The round method and the order of rounds 1 and 2 are the heart of the plan, and they have no row. The record (item P10 in the background sheet) lists the round method as "Accept / change" and unanswered. Meanwhile 52 other things do have rows.

Concrete rewrite for lines 138 to 142:

> **To start round 1 I need six marks from you. Everything else on the sheet can wait, and nothing idles while it waits.**
> 1. Run rounds 1 and 2 as in the table above? (new row)
> 2. Is this the rehearsal? (Ruling 1)
> 3. Which runner does the rehearsal use? (Ruling 2)
> 4. The first rebuild: one write path for issues. (Ruling 4)
> 5. Where the seven safety findings go. (Ruling 5)
> 6. The three-task comparison against a plain session. (Ruling 5)
>
> For round 2 I will also need the three Jira items listed under Ruling 5. If you can, talk to the outside team before then, or watch them try what exists today.

The author should check my choice of six; the point is that the list is short and stated. Then delete "The rulings it needs are already made" at line 120. As written it reads as a standing condition that work waits for his rulings, and it is the unanswered "rule in batches at the start of a phase" proposal (L3 in the background sheet) arriving as a step with no row of its own.

### 3. Cut the ruling sheet from 52 rows to about 30

A row earns its place if John has a real choice and one dropdown can record it. Rows that fail that test, by ruling:

**Ruling 1 (8 rows to 5).**
- Add: "Are these three the steps to open?" The three steps are labelled "proposed" at line 176 and have no row.
- Drop "Which trackers are in?" and "Which runner does a new person use?". Both say "see ruling 2", so they cannot be marked here.
- Merge "Does Harbour OS stay on the landing page?" with the Harbour OS row in Ruling 2. They are one decision with two suggestions ("take it off" here, "leave as is" there).
- Drop "First lines that still describe a tree viewer". It is a task, not a choice. One sentence under the table: "Once you have marked this page I will file one small task to make the README, `llms.txt` and the proxy guide match it."
- Fold line 114 (email sign-in), line 113 (the GitHub App), the runner and "eight steps or nine" into the row "What exactly is the rehearsal?". At present the rehearsal's definition is spread over lines 60, 113, 114, 121, 134, 178, 192 and 239, and three step counts appear (eight, nine, thirteen). Suggested cell: "A fresh account signs in by email, connects Linear and the GitHub App, takes one task in a repository Harbour has never seen, runs it with the Claude Code kit, and reaches a proven merge. A session does it first to find the breaks. You do it last."

**Ruling 2 (15 rows to 6 or 7).** Nine rows ask nothing: the suggestion is "Leave as is", "Part of the product" or "Follows Ship", and the evidence column agrees. Replace them with one sentence: "Nothing is asked about Task chat, Live Console, Jira, Ship, Ship Journey, Swim or Passage planner: they stay. The four unimported files (1,527 lines) will be deleted unless you say otherwise." Keep rows for Collective and Yap, Flight Companion, Ship's Biscuit, Roadmap, GitHub Projects, Harbour OS (merged) and the runner. Move the thirteen-area table out of the ruling section: its own heading says it needs no ruling, and its last column repeats Ruling 4.

**Ruling 3 (15 rows to 10).** Fold the two plain "Keep" rows (outside review, close-out) into the intro sentence. Drop the prompt-size row and the Periodicals row (see change 7: both are already answered). Take the "Leftover step, consequence test, Retires line and prose notes" row out: its suggestion ("Replace with one visible list") decides the notes spike before the spike has run.

**Ruling 4 (5 rows to 2 or 3).** Only the write path (round 1) and `server.js` (round 2) are inside the two planned rounds. The document says twice that everything after round 2 "is chosen when we get there", then asks for a purpose and a size for three later moves. List providers, browser code and the core in one line as "later, not asked now". Also say what the dropdown records, because the section asks for a rewritten sentence and a size, and a dropdown can hold neither: "Edit the purpose line in place. The dropdown is only for size and timing: as suggested, smaller, or not now."

**Ruling 5 (9 rows to 5).**
- Keep: the seven safety findings, LIN-4210 (reworded, see section 5), the plain-session baseline, the survey record.
- Split "Parked work". It holds five items and three suggestions, and LIN-4342 and LIN-4343 are given no description and no suggestion.
- Drop "The format of the area notes" (agreed already; see change 7).
- Drop "Small product calls that shipped without your say". He cannot rule on four ticket numbers, and the suggestion is to do nothing. One line under the table is enough, with a few words on what each call was.
- Move "The Jira live check" out of the table. It is a request, like the token. "Before round 2" is not a suggestion he can agree or disagree with.

Also: replace "Your call" in the Suggested column (four times: lines 194, 227, 231, 233) with either a suggestion or "No suggestion". Every row is his call.

### 4. Reconcile the week's numbers in one place

**Where:** lines 37 to 53, line 72, line 90, line 122.

A reader who checks sums will find:
- 115 landings, 44 of them product or code (line 39). But "$2,800 bought about 88 landings... about 34 of them were product work" (line 72).
- 44 plus 69 is 113, not 115 (lines 40 and 53).
- "About 41%" of budget reached task work (line 44), which is neither 44/115 (38%) nor 34/88 (39%).
- $2,800 is called this week's spend; the agreed limit is $3,500 a week, and 80% of that is $2,800 (line 122 hints at this).
- 32 tidying landings and 26 loop-step landings are given; the number of "ordinary work" landings behind the 0.65 is not.

From the earlier course file I think 88 is not a count at all: it is $2,800 divided by $32, and 34 is 88 times 44/115. If so, say it:

> Two different numbers are called "landings this week". 115 is what landed on main from 7 to 14 November. 88 is arithmetic: 80% of the $3,500 weekly limit is $2,800, and at $32 a landing all-in that buys 88, of which the product share (44 in 115) is about 34.

And add the missing two landings, or say "about 69".

### 5. Put the caveat on each headline claim where the claim is made

The "beyond the record" section is good, but four claims run unhedged a long way before it.

**Line 5 (opening).** "Harbour gets to open for business one round at a time" is a statement of fact about an outcome the caveats say is unproven. Rewrite:

> This is a proposal for getting Harbour to open for business, and nothing in it is decided until you mark it. In round 1 a fresh account, with a repository Harbour has never seen, tries to go from sign-up to a proven merge. Whatever breaks is the work, and one rebuild runs beside it while you are still the only user. Round 2 is the outside team on Jira. The plan is first, then where it runs ahead of the evidence, then the rulings. Six of them are needed to start.

**Line 52.** "Ordinary work now makes less new work than it finishes" is withdrawn at line 151. Rewrite:

> **On one count, this week's landings left less work than they finished.** Counting tickets and notes left behind, an ordinary landing left about 0.65 new items. That is one week, coded by me, with the Periodicals' finds left out. The two kinds of work round 1 will mostly be, new features and fixes, each left about 1.6. It also says nothing about whether the code reads better, which no outside reader has found for ordinary tasks.

**Line 90.** "Product landings should rise from about 34 a week to between 100 and 130." At $32 a landing the whole $2,800 buys 88. The earlier course file shows the hidden assumption: 85% of spend reaching the product and a landing falling to $21 to $24. The new document dropped the assumption and raised the top of the range from 115 to 130. Rewrite:

> **What it might buy.** If nearly all the spend reached the product at today's cost, that is about 75 product landings a week against 34. Getting past 100 also needs a landing to cost about a third less once loop steps go. Nobody has measured either, and round 1 will.

**Line 144.** "I estimated three to five rounds... I would not plan around it." If he should not plan around it, cut it. Keep the definition of open and end the paragraph there.

Two smaller ones of the same kind. Line 275 says of the 1,900-line write path "this size has been done before", while line 153 says one essay puts the largest rebuild at about 930 lines. Line 80 states "A failed large move costs one revert and roughly the price of a task" as a fact; if no large move has yet failed and been reverted, say "should cost".

### 6. Take out the things that read as new rules, gates or settings

He has said "We want all this looser, not tighter", and that the earlier answer proposed removing things "but then suggested rules". The document says the loop gains nothing, and mostly keeps to that. These are the exceptions:

| Where | Text | Why it reads as a new rule | Change |
| --- | --- | --- | --- |
| Lines 92 to 96 | "Three conditions I'd hold to" | Three standing conditions on every large move. They come from an answer he has not replied to. | Cut the list. The suggested sizes and timings in Ruling 4 already carry them (smallest first, `server.js` after the write path, the core not yet). One sentence in the Ruling 4 intro: "I have suggested the smallest first and one at a time; say if you want it otherwise." |
| Line 256 | "Drop; a person decides before a second round" | Adds a decision that reaches him, in a row about removing a loop. | "Drop." If something must happen after a failed first review, say what the lane does, not what a person does. |
| Line 264 | "Keep the test; the ceiling comes down as steps go" | A ratchet on prompt size. He has said "Prompt size isn't a huge issue... Worth knowing, but not hard and fast." | Drop the row. |
| Line 278 | "page by page, under a count that can only fall" | A ratchet on the browser move. | "Page by page." |
| Lines 123, 255 | "One set of Periodicals" per round | A schedule for Periodicals. He retired a scheduled Periodical floor and said to "let it run as normal". | "The Periodicals, as they run now, say what the round left behind." |
| Lines 135, 292 | "A cheaper judging model in one lane" | A different model in one lane needs a per-lane setting. He turned down a model layer ("Happy to just change the defaults") and said "We're cheap enough as is." | Drop, or: "Change the default judging model for a day and report." |
| Line 120 | "The rulings it needs are already made." | See change 2. | Cut. |
| Line 253 | "Keep, only when the change left copies" | A condition an agent must judge on every task. | Mild. Keep if this is already how tidy-after decides; otherwise say "Keep". |

"New work stops near there" (line 122) is existing practice by the record and matches his "do everything quick then hit the limit". It is fine.

A related point on price. He said "The pricing limit need not become a red herring." The section "What is scarce" opens on dollars, and five rows of Ruling 3 argue from dollars per task ($4.59, $79.51, $2.88, $1.02, $48 against $37). The stronger argument in the record is sessions and what each step caught. I would lead with those and keep one cost figure per row at most.

### 7. Fix the rows that leave out, or run against, what John has already said

"What the record says" is the column he will trust. In these places it omits his own words on the question, or the row re-asks something answered.

- **Cut rule and the as-asked seal (line 259).** Suggested: "Drop both". Not in the row: he declined a bypass ("we don't want to fight the system"), the record calls removal expensive, and the open question in the record was a fix (only narrowing his own words needs him), not removal. Add those, and offer the fix as the alternative.
- **Prompt size budget (line 264).** Omits his "not hard and fast". See change 6.
- **The format of the area notes (line 289).** The spike is agreed ("Let's start then asap"), so there is nothing to rule. The row gives the author's lean and leaves out John's own idea, "simply saving the notes as TS". The record also has the spike as *the* next round, first; the order table has it "alongside" round 1. Line 159 says both agreed items "are now in the order above" without saying one was moved down. Say so, or put it first.
- **Browser code (line 278).** He has answered this: pages become modules, "Happy for it to be whatever size is natural." The row asks him for a purpose and a size again.
- **Look-first (line 260).** The row is fair and quotes his 9 November call to keep both. The suggestion reverses that call. Say so in the Suggested cell: "One look for an ordinary task. This goes against your 9 November call; the case is the cost and the missing gain, and it is thin." The row label says "and the size record" but no suggestion is made about the size record. The record also has him calling a run that skipped the look "seems minor", which supports the suggestion and is not quoted.
- **"What the record says against" (lines 84 to 88).** Missing his own warning that agents are "very likely... trying really hard to do big things when we want small", and that "err larger" was once misread as more pieces. Missing also that the newest Stability Review offers "Let the wave finish and then pause it". These are the strongest items against bolder steps, and two of the three are his.
- **Team before or after (line 188).** Missing the quote that best supports the suggestion, from v1: "Once I've done a sort of dress rehearsal, then it can start to be shared around, with me inviting other specific people to test it out." The question also says "the clean-up" where the suggestion means "the rehearsal and the first rebuild".
- **Step 3, "Open for business" (line 180).** "This is the milestone you described on 14 November, after which Harbour mostly runs other projects." By the record, his 14 November words survive only as fragments ("A* quality, through and through"; V1 first, then other projects). "A stranger reaches the bar unaided" comes from v1's "next step's bar" and from the earlier course. Joining them and calling the result "the milestone you described" puts the definition in his mouth. Rewrite: "My wording, built from two things: v1's next bar (a stranger, unaided) and your 14 November phrase 'A* quality, through and through'."
- **v1 and V1.** The record notes that "V1" now means three things. The document uses "v1" for the 19 September page everywhere, then "V1" once at line 188 in his 14 November sense, and never says they differ. One sentence in Ruling 1: "v1 below always means the 19 September page, which is done at the dress rehearsal. What you called V1 on 14 November I am calling 'open for business'."
- **Line 247.** "stays, goes, or stays with a planned removal, in your words" reads as if the phrase is his. The record means the ruling is to be written down in his words.
- **Line 28.** "You said so on 4 November." He said "It's *my* call." "The person sets size and purpose, and agents recommend" is the session's generalisation.
- **Line 291.** "You said waiting for Thursday isn't a real constraint." Use his words: "I doubt the 'wait for Thursday' is true. It's just me keeping track of my budget."
- **Line 261.** "your first-ranked measure". By the record he accepted the ranking ("Agreed, perfect"); he did not write it. "The first of the five measures you agreed."

### 8. Replace the "three fates" frame with the question actually being asked

**Where:** lines 98 to 108 and line 197 to 199.

Problems, in order: the three fates (on the path, rebuilt, cut) are not the three bullets that follow (busy, quiet, off the path); a fourth outcome appears ("or they stay as they are"); the table's commonest suggestion is a fifth ("Leave as is"); "every part of the code needs" a fate is an up-front sort of the whole codebase, and he dropped an up-front sort and "a census to retire views" on 9 November; and "fate... or cut" in two headings makes the section sound like a cull when the suggestions cut three things out of fifteen.

The content underneath is good and protects the features he likes ("I would not ask which to kill", "Cuts are worth less than I told you"). Reframe it:

- Heading at line 98: "Where a new person's work goes, and where it does not".
- First sentence: "Tidying as work passes only cleans where work goes, so I traced where a new person's work would go."
- Heading at line 197: "Ruling 2: which features are part of Harbour when it opens".
- Above the table, define the answers once: "**Yes** means it is brought up to standard before Harbour opens. **Not yet** means it stays exactly as it is and nothing is spent on it. **Remove** means it is deleted, and git keeps it."
- Line 199: "The areas need no ruling, because twelve of thirteen are on the path" does not follow (half the code in those areas is off the path by the document's own table). Just: "Nothing is asked about the areas."
- Line 106: "which is seven moves at the largest size yet tried" prices keeping them all and reads as a nudge. It answers something he asked (the record has him open to cutting "if the cost to keep them is genuinely high enough"), so keep the cost, but say that is why it is there, and note that on the 930-line count it would be about twenty.
- Line 108: "Three experimental views also hook into path code" lists Live Console, which Ruling 2 says was promoted out of experimental.

### 9. One word per thing, and plain words in the history table

Words used in more than one sense:

| Word | Senses in the document |
| --- | --- |
| round | a round of work (line 116); a plan-review round (254, 256); a review round ("$4.59 a round", 251) |
| lane | a parallel worker (122); a runner option ("Two lanes", 239); "the feedback lane" (275) |
| path | the new person's path (throughout); "one write path for issues" (134, 275) |
| judge | "Each large move has its judge" (94); "a cheaper judging model" (135, 292) |
| door | "whichever door it came through", "both write doors" (275, 276); "advertises it with no door" (236) |
| cut | remove a feature; "the cut rule" (259); "The loop changes and cuts you rule" (134), which reads as "cuts-you-rule" |
| the bar | the rehearsal (60); the north star's stranger bar (171, 180) |
| v1 / V1 | see change 7 |

And six names for one thing: large move, broad move, planned move, rebuild, larger steps, bolder steps. Pick "rebuild" (his word is closer to "large simple improvements" or "Theseus'ing") and use it throughout.

"Puts out" (lines 182, 194, 238; three uses, not the four I counted on first read) should be "leaves out".

History table cells to rewrite in plain words if the table stays (I give my best guess at the meaning; where I could not guess I say so):

- Line 13: "We ask where a change binds, where before we asked what was messy." I could not work out "binds". Perhaps: "We stop asking what is messy and ask what gets in the way of this particular change."
- Line 14: "The goal becomes a balance per task" → "The goal becomes: each task leaves the code a little better than it found it."
- Line 16: "The claim narrows." → "The claim shrinks to: whole areas and finished moves read better; ordinary tasks do not."
- Line 17: say what the six tickets and the seventeen were.
- Line 18: "five measures in order and a first stretch" → name them or say "the five measures and the outside team as the first target".
- Line 21: "The pattern gets a name" but no name follows. "text grows about six to one": six of what to one of what?
- Line 22: "One picture and one number." is a fragment. "planned slices" is not explained.
- Line 23: fine.

### 10. Remove the repetition

| Said | Where | Keep |
| --- | --- | --- |
| The dress rehearsal described | 60, 121, 134, 178, 192 | 134 and the one row in Ruling 1 |
| The three steps to open | 62, 132 to 136, 176 to 180 | the order table and Ruling 1 |
| Purpose of Harbour | 58 (paraphrase), 167 (quote) | 167; cut the section "What Harbour is for" down to its caution paragraph and move that into "beyond the record" |
| No usage data / only you know | 54, 157, 199, 241 | 157 and 241 |
| Nothing above 2,816 lines tried | 81, 96, 153, 276 | 153 and 276 |
| Cost rises with size, slowly | 79, 152 | either |
| Ordinary tasks not shown to read better | 15, 16, 52, 64, 150, 189, 260 | 150, plus the clause in the rewritten 52 |
| Harbour has one user | 5, 35, 82, 188 | 5 and 82 |
| "Chosen when we get there" | 126, 130, 136 | 136 |
| Notes spike and baseline | 134, 159, 289, 293 | 134 and 293 |
| Jira three items | 141, 290 | one request line |
| "I told you X and was wrong" | 9, 15, 17, 20, 31, 68, 75, 108, 148 | see below |

On the last row: each correction is honest and some are needed (75 and 108 change what he should believe). Together, nine of them make the document read partly as a report on its author. Keep 75, 108 and the "beyond the record" section. Let the rest go quietly.

With changes 1, 3 and 10 the document should come to roughly 3,500 to 4,000 words.

## 4. Answers to the seven questions, briefly

1. **Does it do what he asked?** Partly. Everything is in one place and the plan is clear. It is not optimised, and the narrative is a table. See section 2.
2. **Structure and length.** Wrong order for someone who reads the top and then marks tables (change 1). Tables are the right form for rulings and for the week's figures; a table is the wrong form for the story of how ideas developed. The thirteen-area table is reference and belongs after the rulings. About a third of the length can go (changes 3 and 10). Rows that one dropdown cannot answer are listed in change 3.
3. **Plain language.** See section 6.
4. **Stated lines.** No stall alarm, no backlog sort, no budget pacing, no pushing him to cut what he likes, and the "attention" point is explicitly taken back. The crossings are: new rules and ratchets (change 6), an up-front sort of the code by "fate" (change 8), rulings in a batch before work starts (change 2), and a cheaper-model lane (change 6). On "rescue project": the document does not read as one, because the rebuilds run beside real work and the core is "not yet". But "Five rebuilds are on the table, in this order", covering about 130,000 lines, is the nearest it comes. Trimming Ruling 4 to the two rebuilds inside the planned rounds (change 3) removes that impression.
5. **Honesty and tone.** It reasons with him more than it defends itself, and it quotes him fairly with dates. "Where this plan goes beyond the record" is the right size (about 340 words) and in a place he will reach. Its weakness is distance from the claims it qualifies (change 5). The opening line promises more than the caveats allow (change 5).
6. **The rulings.** Change 3 for merges and drops; change 7 for loaded rows. What is asked is clear in Rulings 1, 3 and 5; unclear in Ruling 2 (what do the answers mean?) and Ruling 4 (what does the dropdown record?). Suggestions are clearly marked as suggestions throughout, by column header. Rows I would call loaded: cut rule and seal (by omission), prompt size (by omission), research session (the "$48 with it, $37 without" comparison invites a causal reading; harder tickets may be the ones that get research), line 106's "seven moves", and line 256's "never a new design".
7. **Privacy.** See section 5.

## 5. Privacy

No company is named and no private person other than John. No token, credential, session link or production configuration appears. Two things to look at:

- **Line 288, the LIN-4210 row.** This is the one place I would change. The record files LIN-4210 under safety findings, "counts and ticket ids only". The row says what the stop check does today, under which failure, and what the two options are. That is an open safety finding described in detail. Suggested row: "LIN-4210: a stop-handling choice | Two options are on the ticket. Waiting since 9 November. | The stricter option. I have read only the ticket's summary."
- **Line 308, the artifact link.** It is an artifact link, not a session link, so it passes the rule as written. The author should confirm the page behind it is as clean as this document, since its "course section predates this doc".

Minor: line 297 gives the exact expiry time of a token. Not a credential, but "tomorrow afternoon" would do. Lines 229 and 236 mention a public route and a landing-page claim; these are product facts, not configuration.

The seven safety findings (lines 263, 287) are given as a count and a source only, which is right. Line 307 correctly keeps the detailed file out of the repository.

## 6. Labels and jargon

"Explained" means the document says what the term means at or before first use. "John knows" is my judgement from the background files.

| Term | Explained in the document? | Can John be assumed to know it? |
| --- | --- | --- |
| round | Yes, but at line 116; used from line 5 | New in this document. Three senses (change 9) |
| the path, the real path, on the path, path work, path code | Indirectly at line 102 | Yes, since 14 November. About 35 uses; fine once defined early |
| the walk, walks, "when the walk trips" | No | Inferable |
| fate | Yes at line 100, but the definition does not match the table | New on 14 November. Replace (change 8) |
| large move, broad move, planned move, rebuild, larger steps, bolder steps | No | Yes, but six words for one thing |
| landing | No | Yes |
| lane | No | Yes. Three senses (change 9) |
| the loop, loop steps, the standing loop | No | Yes |
| look-first, "one look", "both looks" | No | Probably, though the record calls them the two Surveys, and his quoted "benefits from two" is about those. The rename may confuse him |
| the size record | No | Yes |
| blind read, blind passes, blind scorers | Self-explaining | Yes |
| Periodicals | By function at line 123 | Yes |
| tidy-after | No | Yes |
| cut rule | No | Yes. Collides with "cut" |
| as-asked seal | No | Yes |
| close-out | Half ("merges and checks it live") | Yes |
| class and requirements checks | No | Probably |
| Leftover step, consequence test, Retires line | No | Yes, but a row of four internal names |
| area notes, the notes, Lesson, Waiting, "items waiting" | No. "Waiting rose from 82 to 118" uses a section name as a noun | Yes |
| notes spike | No | Yes, agreed term |
| plain-session baseline | Only at line 293; used at 134 and 159 | His reply to it is not on record. Define at first use |
| dress rehearsal | Yes | His own word |
| proven merge, evidence-verified merge | Quoted | Yes |
| the bar | Yes at 171; used differently at 60 | Yes. Two senses |
| first stretch | No | Yes, agreed term |
| five measures in order; "no new mess" | Not listed | Yes |
| binds, "where a change binds", "where real work binds" | No | Unsure. Hardest term in the document |
| the shape, "where decisions live", "gathered into one owner" | No | Yes, from the papers |
| "free the seam", "replay independently", "Replays exist for both sides" | No | Probably, from the papers |
| design-first rebuild | No | Yes |
| "its judge", "tests at the edge" | No | Unsure |
| the gate pack, the 14 temporary structures | No | Yes |
| the distance | No | From the earlier course. Say "how far there is to go" |
| "the maths has changed", "bends the curve" | His phrases | Yes |
| planned slices | No | Unsure |
| "text grows about six to one" | No | Unsure |
| "one picture" | Only in Sources | Yes |
| north star v4, v1, V1 | By Sources; V1 not distinguished | Yes, but see change 7 |
| puts out | No | Misreads as "publishes" |
| "with no pass figure" (291) | No | Perhaps |
| "the feedback lane", "write doors" | No | Probably |
| the kit | Yes, in its row | Yes |
| flagged, experimental, first-class (views) | No | Yes |
| a second coder | No | Unsure who or what this is |
| fast burn, talk and test, A* quality, open for business | His phrases or plain | Yes |

Sentences that are hard to parse, vague or compressed, beyond those already quoted: line 29 ("A check holds and a sentence does not"); line 30 ("It is why a walked path pulls the work"); line 68 ("though less of this has been measured than I first said"); line 75 (last sentence); line 86 ("The shape changed only when a decision was first gathered into one owner"); line 100 ("Tidying as work passes only cleans where work goes"); line 112 ("joined by seeded data"); line 126 ("Nobody grooms a backlog under this"); line 138 ("on your time only", which can be read as "your time is the only constraint"); line 153 ("so even the ceiling is counted two ways"); line 216 ("One file needs a home, which is an owner's call"); line 254 ("ran a median 6 sessions against 11": which is which?); line 291 ("The duplicates close with their area's fate"); line 295 ("Nothing was lost beyond your say").

## 7. Smaller points

- Line 141 asks for the Jira items "before round 1"; line 283 says the Jira check blocks round 2.
- Line 283 says none of the nine blocks round 1, but two of them (notes spike, baseline) are scheduled inside round 1 and line 121 puts safety items first.
- Line 190: "Linear and Jira on the path" leaves GitHub off, while line 113 says proving a merge needs the GitHub App. "The others are in ruling 2", but Ruling 2 has no row for GitHub issues or the local store.
- Line 247: "most of the 14 temporary structures". Which ones are not covered?
- Line 258: if close-out stops filing follow-ups, where do its finds go? 12 of 54 did change production code. One clause would answer it.
- Line 233, Roadmap: the record shows him pasting the north star into the Roadmap box on 13 November, so there is some evidence he uses it. The row says only "Eight prompt templates".
- Line 227: "If it stays, it is the first to rebuild smaller" assumes it is too big. Say why (14,060 test lines for 5,853 of source) or leave it at "No suggestion".
- Line 236: "Cut, or take it off the landing page" is two suggestions.
- Round 2 does not mention the one thing the record says an outside company needs first: "What Harbour keeps about a company's code... A short check before they start."
- Line 30: "four times out of four" is four cases, and the record has him asking to run without that routing so the method does not depend on it.
- The heading at line 66 covers two topics. If the section stays, split it.
- Line 9: "most steps were a measurement or a remark of yours overturning what I believed" is a good sentence and true to the table. Keep it wherever the table goes.

## 8. What is good and should not be touched

- **"How a round of work runs"**, steps 2 to 5 and the closing paragraph. "Whatever breaks is the work." "It reports and gates nothing." "Nobody grooms a backlog under this, the loop gains no steps and no papers are written." This is the plan in his own register, and it is the opposite of the phase table it replaces.
- **"The order" table.** Four columns, one outcome per round, "How we will know" as a thing he does himself, and an honest third row.
- **"Where this plan goes beyond the record."** Content, length and tone. "I have kept the plan's shape and lowered its confidence" is exactly right.
- **"Five ideas run all the way through"**, with each bullet ending "It is why...". This is the narrative he asked for.
- **The "What the record says" column**, wherever it sets two of his dated statements side by side and lets him choose.
- **The Ruling 3 intro sentence** describing an ordinary task after the changes, and the evidence in each Ruling 3 row.
- **"So I would not ask which to kill"** and **"Cuts are worth less than I told you."** These keep faith with "I'd be sad to get rid, but happy to tidy."
- **The retraction at line 75** ("I told you your attention was the limit, and the record doesn't say that"). Keep the substance; reword the last sentence.
- **The stated limits:** "I have read only the ticket's summary"; "The live database would show it, and I have not read it"; "could be off by thousands of lines"; "the loop's verdict on itself".
- **The purpose-line drafts in Ruling 4.** They state outcomes, not methods, and are offered for him to rewrite.
- **Compared with the earlier course file:** the phases, gates, the "V1 exam", the January date, "cut before fixing" and "half the plan's speed comes from John ruling early" are all gone. That was the right direction. What remains of the conventional version is the five-rebuild sequence, the three conditions, the 100-to-130 figure and the three-to-five-round estimate, and changes 3, 5 and 6 deal with each.

