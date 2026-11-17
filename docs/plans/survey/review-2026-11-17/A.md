# Part A: log.md lines 1–1885 (2–5 Nov)

Short forms: `log` = `docs/plans/survey/log.md`; `plan` = `docs/plans/survey.md`; `ledger` = `place-ledger.md`; `r2`/`r3` = `round-2/forecasts.md`, `round-3/forecasts.md`. **[checked]** means I checked it against a file or commit. **[reading]** means it is my interpretation.

On the source: log lines 1–1885 are the same, word for word, as the 5 Nov 09:02 version (commit `29f14bf6e`) **[checked]**. Older history isn't in this shallow clone. `round1-results.md` covers 7–8 Nov (`round1-results.md:3`), so it falls outside this stretch. Round 2's open-0 answers were "kept in the scratchpad" (log:464), not in the repo, so nobody can now check the open-0 against v2 comparison.

## 1. John's aims

- **The starting frame.** The plan was co-written by John and Claude (plan:3). Its aim is codebases "toward settled" (plan:11). The Survey asks "why is this difficult?" (plan:82). It "advises; it doesn't gate", and it works by pull, not push (plan:105-106). Two of its rules: "File tickets only when John asks" and "Judge by looking; don't build rating schemes" (plan:177-178).
- **3 Nov.**
  - LIN-4110 as a test was John's idea (log:289).
  - So was filing the follow-ups, surveying them and acting on the Surveys. He accepted that there would be no control (log:369-371).
  - He refused a CI deploy token: "a sign of grit in the gears, so warrants human attention" (log:418).
  - "perhaps our prompt is too guiding?" (log:452). "We want a pretty free form answer… the temptation will be to specialise for Harbour" (log:458).
  - Round 3's goal: "closing the loop on tracking costs and tokens" (log:502). He allowed small quality-of-life tickets (log:597).
- **4 Nov: the change of direction.**
  - John asked whether the Survey is "the drill by other means". He wanted to measure cleaning, not landing, and he allowed the Periodicals to file follow-ups (log:863). The plan had said they would stop minting tickets (plan:108).
  - He asked "what would it take… for tasks to finish with a cleaner codebase" (log:981), and said "try-anything-and-see-if-it-works" (log:1037).
  - He set the tipping point (log:1213), and said "More work for the task, less work in future" (log:1219).
  - "It's *my* call… If we can show the process works, everything else is pretty straightforward" (log:1234). Then he handed that call to Claude: "play the role of the human… choose a large enough option" (log:1249).
  - His guard on the prompts: don't let them become lists of rules shaped like Harbour (log:1409-1411).
  - His overnight steer: don't route Periodicals findings into tickets, run the global voice on the code alone, and err larger (log:1516-1522).
- **What he ruled against:**
  - the merge-with-waiver Claude recommended for LIN-4196; he said hold (log:833, 857);
  - treating Railway access as a fault: "not a fault, and not a design either" (log:1369).

## 2. What was done

1. **Spike 0:** a finished session can be resumed if it ended within about 6 hours. Answers have to go to a ticket comment, and every question woke the ticket's autopilot (log:48-53).
2. **1a:** five builders answered the questions (log:79-98).
3. **v0:** a five-ticket backtest plus four controls, and spike 1c on S3 (log:110-147).
4. **v1, then forecasts for S4 and S5 before any work** (log:149-193). Nothing ran overnight because a permission prompt waited on John (log:197).
5. **Results:** S4 compared (log:218-276), v2 written (log:282), LIN-4110 compared (log:287-339), S5 compared (log:341-364).
6. **Round 2:** five plumbing tickets, surveyed with v2 and acted on (log:367-400). The open-0 side arm ran beside it (log:450-482).
7. **Round 3:** the Costs work (LIN-4176, then rebuild 2, LIN-4195) and the quality-of-life tickets, all surveyed with open-0. Each Survey's "do first" was written onto its ticket (log:500-764).
8. **4 Nov:**
   - the Periodicals were re-run, a scripted before/after was made, and 13 step-backs were asked (log:861-977);
   - the global voice was backtested (log:999-1033, 1186-1209);
   - two forward trials (log:1035-1108, 1282-1328);
   - the ledger was started (log:1215), plus pricing (log:1217-1265) and Claude's scope calls (log:1258-1261);
   - merges and two summaries for John (log:1344-1497).
9. **Overnight 4–5 Nov:** LIN-4234 and LIN-4233, then four ordinary tickets (LIN-4144, 4151, 4048, 4143), and a calibration of the builders' q6 answers (log:1531-1884).

## 3. What was learned

- **Forecasts named specific things before the work.**
  - S4's two pill tables that disagree were still on the branch at merge (`300c811f`, `render-task-page.js:111,124`) **[checked]**.
  - LIN-4166's forecast warned against extending `subscription` (r2:100). The builder extended it anyway (commit `7797c306`) **[checked]**.
  - The misses were things learned only by drawing or running the code (log:276, 364).
- **v0's weakness:** it recommended "just drill" on 4 of 5 prize tickets, passing copies it had itself found (log:124).
- **open-0 against v2.** "At least as well… on three it did better" (log:474) was judged by one rater, and the open-0 texts can't be checked **[reading]**.
- **The open-0 Surveys' "do first" was always a preparation for the task, never a tidy** (log:476). John's 4 Nov question exposed what that meant:
  - Our consolidations added production code: LIN-4177/78/79 added 1,023 lines and removed 646; LIN-4168 added 520 and removed 48 **[checked, git shortstat]**.
  - They also made a hub with no home on the map. The Seams 11-04 report confirms the catch-all went from 12 to 17 files, cross-area imports from 1227 to 1262, and names `cost-read.js` as the hub (origin/main `seams-tangles-review-2026-11-04.md:7,19,40`) **[checked]**.
  - Claude's prediction of "about flat" was wrong (log:908).
- **Push against pull.** Drift run 2 found three routed findings resolved and one improved, while all 17 pushed follow-ups sat unmoved (`drift-coherence-review-2026-11-04-run2.md:49,135-137` on main) **[checked]**. But the routed findings were chosen because they sat in ground already being rewired, so this is not a like-for-like comparison **[reading]**.
- **The Surveys caught stale tickets.** LIN-4048 had already been fixed (log:1741-1744). LIN-4143's card was already guarded (log:1787-1791), and `liveGuard` has 0 occurrences at its merge `2eb73ae07` **[checked]**. LIN-4242 added no second poll: `setInterval` stays at 10 in `public/` **[checked]**.
- **What failed:**
  - LIN-4201's "loading part of the read" was priced as free and had to be split off (log:1421).
  - Claude overrode open-0's "keep this separate" on LIN-4234, and that override was the cost (log:1649).
  - LIN-4218 landed as one PR, not the pieces asked for (log:1440).
  - Two code-only rows left new files with no map home (log:1679).
  - The global v2 backtest missed its main criterion (log:1534).
- **The ledger was Claude's own scoring.** Blind scorers on 5 Nov, just after this stretch, rated the forward rows +0.37 and the baseline +0.38 and +0.50. Their verdict: "the ledger's gap… is mostly my scoring" (ledger:102-106, 120-124) **[checked]**.

## 4. How the thread left this stretch

- **What was carried forward:** the loop (two Survey voices, Claude's scope call, an at-merge list, a ledger row), plus four next steps: the "table of cases" question, pulling "shared test fakes", a blind second scorer (which Claude itself called "the single biggest gap"), and whether map homes belong in the Survey (log:1866-1870).
- **What happened next:** John's 08:00 steer moved the prompts into Harbour (log:1888).
- **Was it the question John set?** The main question was John's: can tasks finish cleaner, and can we show the process works (log:981, 1234). But the plan's "Judge by looking; don't build rating schemes" (plan:178) had turned into scored hit criteria, tallies and a balance ledger. John's tipping point invites a measure, but the scheme was Claude's design (log:1215) **[reading]**.

## 5. Where the driving session's reports outran the evidence

1. **The ledger contrast** given to John: "10 better, 0 worse" against a baseline of 1 better and 4 worse (log:1466-1469, 1823-1827).
   - It counts LIN-4219's parent row as "+ (its five pieces above)", on top of those five pieces (ledger:41) **[checked]**.
   - "On ordinary work… the place came out better every time" (log:1830). The blind reads rated LIN-4241 worse in both passes and LIN-4048 neutral (ledger:125). Drift run 3 confirmed LIN-4241's settled check went from 2 sites to 5 (ledger:140).
   - The session did add the caveat "I scored the rows" (log:1490), and it retracted the claim later (`notes-2026-11-05.md:5`).
2. **"14 of 14" builders named one owner or one seam** (log:811, 841), and "ten of ten" (log:707).
   - The question was first asked in round 3 (log:515). By my count, 8 builders had answered it by 01:30 (log:588, 643, 675, 699-703) and 11 by 06:00 (log:799, 802, 808).
   - LIN-4199's quoted answer was to the tidy question, not this one (log:803-804).
   - Some of the answers counted aren't one-owner answers: "a one-word default change" (log:588), "a two-way spec" (log:700) **[reading]**.
3. **"Rebuild 2's plan follows the Survey's order exactly"** (log:840). The entry it summarises says "with two refinements" (log:762) **[checked]**.
4. **"4 of 4 routed were resolved"** (log:1482). The evidence is three resolved and one improved (ledger:56) **[checked]**.
5. **"Builders didn't know a tool"** was logged as a recurring lesson (log:414, 858, 1356). John corrected it: it describes the current setup, and it isn't a lesson to act on (log:1369).
6. **Decisions that were John's:**
   - On LIN-4176, open-0 said to ask John about the `/kpis` label "at the start" (r3:28). Claude settled it itself (log:556).
   - On LIN-4201 and LIN-4203, the step-back's scope was written onto the tickets before John had said the call was his. Claude recorded that as a correction (log:1241).
