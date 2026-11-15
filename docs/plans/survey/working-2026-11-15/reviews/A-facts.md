# A. Fact check of "Harbour: the course, and what needs your ruling"

Checked: the Claude Docs export of file `57aa9ca6-1821` (rev 39, 32,967 bytes; decoded copy at `S/writeup/review/doc.md`, byte count matches the export). `doc:N` is a line in that copy.

Short names: `S` = `/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad`; `log`, `disc`, `gate14`, `course` = `log.md`, `discussion.md`, `gate-2026-11-14.md`, `course-2026-11-14.md` in `/home/user/LinearViewer/docs/plans/survey/`; `M/` = `S/wt-main/docs/`; `R1`, `R2`, `R3` = `S/writeup/1-how-ideas-developed.md`, `2-areas-and-path.md`, `3-definition-and-rulings.md`; `B`, `D`, `E`, `A` = the files in `S/course/`.

Not opened: `C-distance.md`, any `.jsonl`, any transcript, the tickets themselves (no web API). So anything the document takes from a ticket's own text is marked unverifiable, not wrong.

Every quotation in the document was string-matched against its source. All match. One (M15) matches only the first version of its paper, and three are attributed more firmly than the source allows (S10, S11, S14).

---

## 1. Wrong (must fix)

**W1. The plain-session baseline was not agreed by John.**
- Document (doc:159): "The same reader found two things we had agreed that my answers skipped: the notes spike as the next round, and a plain-session baseline before any larger rebuild. Both are now in the order above."
- Source: the notes spike was agreed (`log:3973`, `log:3977`). The baseline was the session's own proposal; John's reply went to tidying, not to it (`log:4078`). `R3:124` (P7) lists it as an open question; `A:71` says "no ruling found"; `R1:212` says "The operator said a bare-session baseline should run first".
- Second problem in the same sentence: the order does not do what it says. The spike was agreed as "the notes spike first" (`log:3977`, `gate14:74`); the order runs it alongside round 1 (doc:134). The baseline is described as "before any larger rebuild" but runs in the same round as the first large move (doc:134).
- Fix: "The same reader found one thing we had agreed that my answers skipped, the notes spike as the next round, and one thing I had proposed and then dropped, a plain-session baseline before any larger rebuild. Both are in round 1; the baseline runs beside the first large move, not before it." Or move the write-path move to after the baseline.

**W2. A rehearsal has been run. What has not been run is a fresh-account one.**
- Document (doc:60): "That rehearsal has been the bar since 19 September and has never been run". Again at doc:178: "v1 has asked for this since 19 September and it has never been run."
- Source: `M/v1.md:132`: "the 10 October rehearsal (LIN-2953) used a new workspace on the operator's existing account, so its log-in step was not a first sign-in, and no fresh-account run has happened yet". Also `M/v1.md:99` and `:111` (it ran on the runner kit from a Claude Code cloud session).
- Why it matters: Ruling 1 asks John to choose between "a fresh account or a fresh workspace" (doc:192). If he picks "fresh workspace", the 10 October run may already count. The document hides the fact his choice turns on.
- Fix: "A rehearsal ran on 10 October (LIN-2953) on a new workspace under your existing account. A fresh-account rehearsal has never been run."

**W3. "Three experimental views also hook into path code" is not what the trace found.**
- Document (doc:108): "Three experimental views also hook into path code: Task chat in the task page, Flight Companion in the shared turn core, and Live Console's helpers in the task-page loader."
- Source: Live Console is not experimental. `R2:94` has it as "promoted; flag is an opt-out", and the document's own Ruling 2 row says "Promoted out of experimental" (doc:234). Flight Companion is imported by `lib/agent-turn.js:47-48`, "the turn core that Task chat also drives" (`R2:88`); `agent-turn.js` appears in none of the 13 path steps (`R2:18-30`). Only Task chat is an experimental view imported by path code (`lib/render-task-page.js:72`, `R2:87`).
- Fix: "One experimental view, Task chat, is loaded by the task page. Flight Companion is wired into the chat turn core that Task chat uses. Live Console, already promoted, lends helpers to the task-page loader."

**W4. "139 commits in two weeks" comes from a column the later reading found wrong.**
- Document (doc:279): "Read as not ready, with 139 commits in two weeks."
- Source: 139 = 72 + 67 from `D:11-12` ("Commits 14d"). `R2:10` marks that column "Wrong": the checkout is shallow, the window is 3 to 14 Nov (11 days), and each area carries a phantom commit. Full-history counts for 31 Oct to 14 Nov are runs 92 and LLM 72. Adding two areas also counts a commit that touches both twice.
- Fix: "with 92 and 72 commits in the two areas over the two weeks to 14 November (49 and 56 since 7 November)", citing `R2:10`, `R2:49`, `R2:51`.

**W5. Only one of the two idle lanes was held by the finish condition.**
- Document (doc:20): "A measure I wrote as a finish condition stalls two lanes overnight." And doc:75: "The two lanes that idled overnight on 14 November were held by a finish condition I wrote, which only you could release."
- Source: `log:3843-3844`: LIN-4447 waited on `lin4447-area-read-inconclusive` (the area-read gate, `log:3851`). LIN-4470 waited on a different ruling, `lin4470-five-files-lesson`, and "parked rather than building the uncontested part". The essay agrees: "One question came from a measurement written into a ticket's Done-when" (`M/papers/harbour/every-choice-was-right-at-the-time.md:38`).
- Fix: "Two lanes idled overnight on rulings. One was held by a finish condition I wrote; the other parked on a clause the cut rule sent to you."

**W6. This week's tidying has been read from outside, three ways, and the document leaves out the results.**
- Document (doc:88): "**This week's tidying has not been read from outside yet.** The newest Stability Review calls what follows the tidy wave "unobserved"."
- Source: three paired blind area reads of the tidy lanes all came back "no detectable difference": front end +0.25 (`log:3776-3779`), Runs +0.25 (`log:3834`), LLM −0.3 (`log:3997`). Drift and Seams read the same window as better (`gate14:29`; `D:32`). The Stability Review says of the area reads "none witnesses convergence on code" (`M/reviews/stability-review-2026-11-14.md:134`). The "unobserved" quote is accurate (`:113-114`) but refers to what comes after the wave.
- Fix: "Outside readings of this week's tidying disagree. Drift and Seams read the window as better. Three paired area reads found no detectable difference. The Stability Review says none witnesses convergence on code, and calls what follows the wave 'unobserved'."

**W7. "Eight places" misreports the reader's count.**
- Document (doc:148): "An independent reader checked my last four answers ... and found that they claim more than the record shows in eight places."
- Source: `R1:178-245` lists thirteen points, a to m. The eight bullets below (doc:150-157) cover a, b, c, d, e, k, l and one that is not a lettered point (usage data, from `course:11`). Points f, g, h, i, j are handled elsewhere in the document; m is not mentioned.
- Fix: "found thirteen places. Five are corrected in the plan above (v1's definition, cuts, the budget week, your attention, the skipped spike). The eight below still stand."

---

## 2. Unsupported or overstated (should fix)

**S1. "$2,800 bought about 88 landings" did not happen; it is an extrapolation.**
- Document (doc:72): "This week $2,800 bought about 88 landings at $32 each, and about 34 of them were product work."
- Source: at about midday 14 Nov the gauge read 51% (`log:4043`), taken as $1,785, for 56 landings since the 12 Nov reset: $32 each. $2,800 ÷ $32 = 88 is `[D]` (`B:20`, `B:52`). I recounted 56 first-parent landings in `S/wt-main` for that window. It also assumes 100% of the gauge is $3,500 (`B:63`, a listed gap). "34" applies the 7 to 14 Nov mix (44 of 115) to a different window and is marked `[A: mix holds]` (`B:52`).
- Fix: "By midday on 14 November about $1,785 had bought 56 landings, $32 each. At that rate $2,800 buys about 88, of which about 34 would be product or code work."

**S2. "About 41%" is derived, from a different window than the table's heading.**
- Document (doc:37, doc:44): table headed "What was measured, 7–14 November"; row "Share of the budget that reached task work | about 41%".
- Source: `B:23`: "about 41% of the burn is tracked task sessions [D, windows differ]". It is $13 tracked cost per landing (12 to 14 Nov, 25 tasks over 33 landings) against $32 all-in. The rest "is not split in the record".
- Fix: move it out of the "measured" table or label it "about 41% (derived, 12–14 Nov; the rest is not split in the record)".

**S3. "Between 100 and 130" product landings is higher than its sources, and contradicts Ruling 3.**
- Document (doc:90): "Product landings should rise from about 34 a week to between 100 and 130, if spending moves to the product and some loop steps go."
- Source: `B:54-55`: 117 and 133 are all landings, not product landings. 133 needs look-first and the blind read both dropped. Ruling 3 keeps one look and keeps the blind read (doc:260-261). `course:56` gives "about 100 to 115 product landings a week, if 85% of $2,800 reaches product work at $21 to $24". The document's own round also runs a large move and Periodicals alongside (doc:122-123). The 117 rests on "one 6-hour interval" (`B:54`).
- Also: "product" here is the 44 of 115, of which 32 were tidying old code, 7 new capability and 5 defect fixes (`log:4086`). The table calls the same group "product or code work" (doc:40).
- Fix: give the range the suggested loop supports (my arithmetic: 85% of $2,800 at $24 is about 100; the 70% share proposed at `log:4093` gives about 80), say it is derived, and use one label for the 44.

**S4. "Ordinary work now makes less new work than it finishes" is stronger than the count behind it.**
- Document (doc:52): "**Ordinary work now makes less new work than it finishes.** Under one new item per landing, the list shrinks."
- Source: `log:4086`. The 0.65 sets aside the 30 seed entries and the Periodicals' finds (net +58), and "the adjudicated coding is mine". The per-kind figures weight back to 0.65 over 91 landings only because 32 tidying landings sit at 0.09; the other 59 average about 0.95 (my arithmetic from the figures in `log:4086`). New capability is 1.57 and defect fixes 1.60. Over the same week the lists grew: Waiting 0 to 118 (`gate14:51`), tickets about 1,358 to 1,366 (`disc:485`, `log:3281`). The Stability Review: a flat count "can be settling and filing at the same rate", and "Neither row alone is an improvement" (`M/reviews/stability-review-2026-11-14.md:250-251`).
- The document does caveat this at doc:151. The bold claim at doc:52 does not carry the caveat.
- Fix: "Counted one way, work left about 0.65 new items per landing this week. The figure is under one mainly because of the tidying landings; the lists themselves grew."

**S5. "The record doesn't say that" is false; John did not say it, but the record does.**
- Document (doc:68, doc:75): "Two things are scarce here, and the workers' time is not one of them." "I told you your attention was the limit, and the record doesn't say that."
- Source: the accepted north star: "**Operator minutes and sessions are the scarce resources.**" (`M/north-star.md:17`). `log:3187`: "Money isn't the binding limit; things in flight and John's decisions are." `log:3844`: "both active lanes are idle on John's answers". `B:47` lists "John's rulings" as a limit seen. John's own words point the other way (`log:4027`; "if I do become a blocker we can look into it", `log:3609`).
- Fix: "I told you your attention was the limit. That is not how you put it, and the stall I pointed to came from a condition I wrote." Do not say the record is silent; say which scarce things this plan acts on.

**S6. "A failed large move costs one revert and roughly the price of a task" has no measurement.**
- Document (doc:80), listed under "Why larger steps look cheap ... on the numbers so far".
- Source: the sentence is the session's own answer at `log:4103`. No file I read measures a failed large move. Against it: rung 4 took 5 h 17 and was split in three (`D:54`); one missed fault cost $79.51 to repair (`M/papers/harbour/what-the-reviews-checked.md:65-66`); the essay says "Nothing shows the clearing is easy" (`every-choice-was-right-at-the-time.md:32`).
- Fix: mark it as an expectation, or drop it.

**S7. "+0.37 and the baseline +0.38" is the comparison the paper corrected.**
- Document (doc:15): "Blind readers scored the loop +0.37 and the baseline +0.38."
- Source: `log:1925` has those figures. The paper says they cross passes: "the same-pass pairs are +0.39 against +0.38 in pass 1 and +0.37 against +0.50 in pass 2" (`M/papers/harbour/cleaner-than-it-started.md:44`; noted at `log:2484` and `log:2489`).
- Fix: "Blind readers scored the loop +0.39 against a baseline of +0.38, then +0.37 against +0.50."

**S8. The cut-rule row leaves out what John has already said about it; "None of these has been ruled on" is too flat.**
- Document (doc:259): "Cut rule and the as-asked seal ... Drop both". Document (doc:247): "None of these has been ruled on."
- Source: John on bypassing cut rulings: "we don't want to fight the system." (`log:3799`). The fix the session then proposed was narrower: "only narrowing John's own words needs him" (`log:3799`). On false escalations: "also fine ... if I do become a blocker we can look into it." (`log:3609`). `R3:205` lists the bypass under "do not propose". The gate calls the seal's removal "expensive: every filed ticket carries the block" (`gate14:56`).
- Other rows also have standing words from John: both looks kept (`disc:314-321`; the document says so); measures "reported, never gating" (`log:3876`), which already covers removing the blind-read gate and Periodicals reporting only; prompt size "Worth knowing, but not hard and fast" (`log:3627`).
- Fix: add John's two remarks to the cut-rule row, and change doc:247 to "None of these suggestions has been ruled on. Where you have already said something about a step, the row says so."

**S9. Most of Ruling 3's evidence is from the September loop, and the table does not say so.**
- Document (doc:251-265), rows 1, 2, 6, 7, 8, 12, 15.
- Source: `E:3`: "Most gate-rule numbers are from the September loop". Tickets completed 11 to 29 September (`which-rules-pay.md:29`); "the thirty days to 12 September" (`review-loops.md:13`); `tasks-generate-tasks.md` dated 12 Sep; `what-supervisors-do.md` dated 30 Sep, over 254 supervisor sessions. The row "A supervising session (this one)" uses that September figure for other sessions.
- Fix: one line above the table: "Rows 1, 2, 6, 7, 8, 12 and 15 use September's measurements; look-first, blind read, notes and the seal are November's."

**S10. "As you first put it" firms up John's "potentially".**
- Document (doc:192): "A fresh account and a repository Harbour has not seen, as you first put it." Also doc:178.
- Source: John: "sign up a fresh account, go through all the steps and see a result, potentially with a repo that I've not used with Harbour before." (`M/v1.md:31`). The firm version is the document's own gloss ("on a repo it has never seen", same line) and its order step 6 (`M/v1.md:130`).
- Fix: "as v1 states it (you said 'potentially with a repo that I've not used')".

**S11. Step 3 attributes a composite to John.**
- Document (doc:180): "A stranger reaches the bar unaided, and the codebase is "A\* quality, through and through". This is the milestone you described on 14 November".
- Source: `log:4085` is the session's report of ideas John raised; "Only the quoted phrases are his" (`R3:47`). His idea was a V1 milestone with A* quality, after which Harbour mostly runs other projects. The stranger half comes from `M/v1.md:33` ("the next step's bar") and `course:18`.
- Fix: "The second half is the milestone you described on 14 November; the first half is v1's 'next step's bar'."

**S12. The beyond-the-record section drops four warnings from R1 section 5 that cut against the plan.**
- (d) The newest outside reading recommends the opposite of bolder: "Let the wave finish and then pause it." (`M/reviews/stability-review-2026-11-14.md:448`; `R1:201`). Not in the document.
- (d) "Err larger" was already misread once as more pieces (`log:3019`), and John warned agents are "very likely… trying really hard to do big things when we want small" (`disc:550`, `log:3241`; `R1:200`). Not in the document.
- (a) "no ordinary product task has gone through the finished loop yet" (`gate-2026-11-13.md:15`; `R1:182`), and the 20-of-22 reader was redesigned to have no "mixed" answer (`R1:183`). Not in the document.
- (b) The number fell from 1.67 to 1.12 partly because finds moved from tickets into notes (`R1:190`). Not in the document.
- Not overclaimed any longer: g (v1), h (cuts are John's call), i (rounds, not weeks), j (attention; but see S5), k (700 is soft), l (other people's code).

**S13. "Text grows about six to one" is not what was measured.**
- Document (doc:21). Source: "Process changes that add outnumber those that remove by about 6:1." (`log:3934`). It counts changes, not text.
- Fix: "process changes that add outnumber those that remove about six to one".

**S14. "You said so on 4 November" covers size, not purpose.**
- Document (doc:28): "**The person sets size and purpose, and agents recommend.** You said so on 4 November".
- Source: `log:1234`: "the user decides how much to tidy up. Agents can recommend". "John's seat is purpose" is session wording of 14 Nov (`log:4084`).
- Fix: "You said so about size on 4 November; purpose was added on 14 November, in my words."

**S15. LIN-4210 has waited longer than stated, and its two options are not in the record.**
- Document (doc:288): "The ticket gives two options ... It has waited since 9 November."
- Source: it was put to John on 4 Nov ("Open for you: ... LIN-4210 (the halt poll)", `log:1497`; minted `log:1152`; still open 5 Nov, `log:1864`). 9 Nov is when the discussion recorded "LIN-4210 waits for John's ruling" (`disc:481`). The two options appear in no file I was allowed to read; the document says it read the ticket's summary, which I could not check.
- Fix: "It has waited since 4 November."

**S16. "2.9 times a change under 50 lines" compares against 1 to 49 lines, not everything under 50.**
- Document (doc:79). Source: `B:15`, `B:34`: 300+ production lines $21.18 (n 19) against 1–49 lines $7.34 (n 15), marked `[D]`, "association only". I recomputed from `M/papers/harbour/task-size-and-cost-evidence/2026-11-12/analysis.json`: 2.88 against 1–49 lines; 3.48 against all 45 tickets under 50 lines (30 of them change no production line).
- Fix: "about 2.9 times a change of 1 to 49 production lines (medians)".

**S17. "Path work ... can clean as it goes" has evidence against it for two of the busy areas.**
- Document (doc:104) and the area table (doc:208). Source: browser, "9 of its 12 Waiting entries predate 7 Nov and 15 commits since have not cleared them"; pages, "13 of 15 Waiting entries are old, the largest old backlog of any area" (`R2:62-63`).
- Fix: say that passing work has not cleared the old items in Pages or Browser code so far.

**S18. The write-path move's readiness is stated without its conditions.**
- Document (doc:275): "Replays exist for both sides, and this size has been done before. | Whole, in one pull request, in round 1."
- Source: Agent API is "Ready once F4, LIN-4155, table home settle" (`D:17`); risk "Security checks pinned by text tests" (`D:41`).
- Fix: add both to "Size and state".

---

## 3. Minor

- **M1.** doc:9 "over twelve days": 2 to 14 November is thirteen days counted inclusively.
- **M2.** doc:39 "115" landings: `log:4086` says 115; `R2:42` and my recount at HEAD give 116 since 7 Nov 00:00 UTC. Also 44 + 69 = 113, not 115; the source leaves two unclassified (`log:4086`).
- **M3.** doc:13 "78,900 added lines": the plan says "+78,900 lines" (`/home/user/LinearViewer/docs/plans/survey.md:9`), which reads as net growth.
- **M4.** doc:45 "Open tickets 1,366": this is the backlog pass's inventory of about 10 Nov (`log:3281`), not a 14 Nov count.
- **M5.** doc:48 "Known defects and clean-ups ... 118": 118 Waiting entries, of which 40 are defects and 56 copies or clean-ups (`course:7`).
- **M6.** doc:81 "one to two and a half hours": "50 minutes to about 2.5 hours of run time"; two ran 3.3 and 4.6 hours of wall clock (`M/papers/harbour/rebuild-round.md:18-19`).
- **M7.** doc:276 "205 imports": 205 at the review's pin (`D:30`), 207 at HEAD (`R2:56`).
- **M8.** doc:122 "about 42 hours": derived from one evening's 1.9% an hour (`B:22`, `log:3801`).
- **M9.** doc:144 "three to five rounds": the source says "three to five budget weeks" for "V1" (`log:4103`). The document says a round is not a week (doc:118).
- **M10.** doc:141 lists the Jira items under "Before round 1"; doc:283 and doc:290 say "Before round 2".
- **M11.** doc:277 "Prerequisites now"; doc:135 puts the providers prerequisites in round 2.
- **M12.** doc:245 "keeping seven steps, shrinking three and dropping five": the table has 15 rows. It reconciles only if the blind read counts as kept and "Replace with one visible list" (doc:263) counts as shrinking. Drops are five (rows 6, 7, 8, 9, 12), two of them conditional or double.
- **M13.** doc:156 "never run on a codebase other than its own" against doc:64 "itself and its runner" (simple-dispatcher is a second repository, `cleaner-than-it-started.md:40`).
- **M14.** doc:305: *Cleaner than it started*, *Steering text* and *Beyond the code* are short names, not titles (the titles are questions). The cost paper quoted at doc:152 (`task-size-and-cost.md`) and the September papers behind Ruling 3 are not in the Sources list.
- **M15.** doc:16: the quotation is exact for the paper's first version (commit `5c63aa26`, 6 Nov, line 34). The paper on main is version 2 of the same day and no longer has that sentence; it says "tasks on average: not shown" (`:38`).
- **M16.** doc:105 "almost all their waiting items are old": 14 of 17 (providers 3 old, 2 mixed, 1 new; `R2:55`).
- **M17.** Ruling 2 "Last changed" dates cover each view's main files only (`R2:135`).
- **M18.** doc:247 "in your words": the log's phrase is "stays, goes, or stays with a planned removal, in John's words" (`log:3976`). It means each verdict is recorded in his words; placed here it reads as if the three-way phrase is his.
- **M19.** doc:254 "a median 6 sessions against 11": the middle of three size bands (5.5, 6, 9 against 9, 11, 23; `how-a-task-is-composed.md:87-89`).
- **M20.** doc:258 "12 of 54": follow-ups filed from review and close-out findings together (`which-rules-pay.md:145-146`); the 74% is the close-out row alone (`tasks-generate-tasks.md:34`).
- **M21.** doc:169 "(v1, 19 September)": the page was revised on 26 September (`M/v1.md:142-143`; `R3:24`).
- **M22.** doc:106 "seven moves at the largest size yet tried": 18,547 ÷ 2,816 = 6.6, and it compares JS plus CSS lines with code lines.

---

## 4. Checked and found correct

- **Quotations of John, all verbatim:** doc:14 (both), doc:17, doc:18, doc:20, doc:21, doc:22, doc:75, doc:106, doc:118, doc:124, doc:180 ("A* quality, through and through"), doc:260. Dates right: 4, 8, 9, 13 and 14 November.
- **North star and v1 quotations, all verbatim:** doc:167-173 against `M/north-star.md:5, 7, 11, 13, 25` and `M/v1.md:1, 37`. Accepted dates (13 Nov, 19 Sep) right.
- **Paper and review quotations:** "did not move where decisions live" (`rebuild-round.md:21`), "unobserved", "Ordinary tickets did not read better than the baseline.", "rises with size, but slowly", "about 930 lines over two files", the Stability Review headline and 28 of 35.
- **Area table (doc:205-217):** all thirteen source-line figures, all Waiting counts (sum 118), path shares, 221 importers, against `R2:44-58`. `server.js` 4,771 lines confirmed in the checkout.
- **Feature table (doc:225-239):** all fourteen source and test line pairs, the 1,527 unused lines (816 + 141 + 163 + 407, confirmed by `wc`), import facts, 7 commits for Flight Companion, against `R2:86-102`. Seven experimental views sum to 18,547.
- **Ruling 3 figures:** 44 in 18 of 100; 12 and 7; $4.59; 11 of 44; $79.51; 47–85%; 11 of 94; 107 and 97; 74%; 12 of 54; 15 and about 10; $2.88; 20 of 22; 15 of 16; $1.02; 1 of 44; $48 and $37; 82 to 118; 13 of 110; 22%; 77% and 31%. Each traced to its paper, the gate pack or the Stability Review.
- **Ruling 4:** 1,036 + 886 = 1,922 lines; 4,771 ÷ 2,816 = 1.7; 13,986; 35,236 and 67 globals; 45,825 + 27,784 = 73,609.
- **Other numbers:** 965 and about 100; six tickets to about seventeen; 10.6 KB to 88.8 KB; 1.12 then 0.65; 0.09 over 32 landings and about 1 over 26; 134; 9,725; 2,816; four of four and seventeen; 1.57 and 1.60.
- **Counts in sentences that match their tables:** five rulings, five ideas, eight choices, fifteen features, thirteen areas, 13 path steps, five rebuilds, nine questions, three Jira items, 14 gate structures.
- **Decisions:** 8 Nov "Agreed, perfect" (goal, measures, first stretch); 9 Nov no phase table, no big sort, both looks kept, no surface retired by default, "chosen when we get there"; 13 Nov north star applied; 14 Nov measures report and never gate, notes spike agreed, one-structure-at-a-time agreed.
- **Ids, dates, names:** LIN-614, 4416, 4445, 4449, 4463, 4342, 4343, 3703, 3952, 4113, 3983; Security Review 10 Nov; token expiry 15 Nov 15:48 UTC; the three 14 Nov review files exist; the artifact link matches `log:4087`.
