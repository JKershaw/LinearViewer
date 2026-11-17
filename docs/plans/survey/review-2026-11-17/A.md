# Part A: log.md lines 1–1885 (2–5 Nov)

Short forms: `log` = `docs/plans/survey/log.md`; `plan` = `docs/plans/survey.md`; `ledger` = `place-ledger.md`; `r2`/`r3` = the round-2 and round-3 `forecasts.md`. **[checked]** means I checked it against a file or commit. **[reading]** means it is my interpretation.

On the source: log lines 1–1885 match the 5 Nov 09:02 version (`29f14bf6e`) **[checked]**; this shallow clone holds nothing older. `round1-results.md` covers 7–8 Nov (its line 3), outside this stretch. Round 2's open-0 answers sat only in the scratchpad (log:464), so they can't be checked.

## 1. John's aims

- **The starting frame.** The plan was co-written by John and Claude (plan:3). It aims "toward settled" (plan:11). The Survey "advises; it doesn't gate" and works by pull (plan:105-106). Its rules: "File tickets only when John asks"; "Judge by looking; don't build rating schemes" (plan:177-178).
- **3 Nov:**
  - LIN-4110 as a test was his idea (log:289). So was filing the follow-ups and acting on their Surveys, with no control (log:369-371).
  - He refused a CI deploy token as "grit in the gears" that "warrants human attention" (log:418).
  - "perhaps our prompt is too guiding?"; "a pretty free form answer", not one specialised for Harbour (log:452, 458).
  - He set Costs as round 3's goal (log:502) and allowed small quality-of-life tickets (log:597).
- **4 Nov, the change of direction:**
  - Is the Survey "the drill by other means"? Measure cleaning, not landing. He let the Periodicals file follow-ups (log:863), though the plan had said they would stop (plan:108).
  - "What would it take… for tasks to finish with a cleaner codebase" (log:981); "try-anything-and-see" (log:1037); the tipping point (log:1213).
  - "It's *my* call… show the process works" (log:1234). Then he handed the call to Claude: "play the role of the human" and choose large (log:1249).
  - Prompts should stay general, not become Harbour-shaped lists (log:1411).
  - Overnight: no routing of Periodicals findings, a code-only global voice, err larger (log:1516-1522).
- **Ruled against:** merging LIN-4196 with a waiver (he chose hold, log:857), and calling Railway access a fault (log:1369).

## 2. What was done

1. **Spike 0:** a session is resumable only within about 6 hours (log:48-53). 1a: five builders answered (log:79-98).
2. **v0** backtest and spike 1c (log:110-147). **v1**, then forecasts for S4 and S5 before the work (log:149-193). Overnight stall (log:197).
3. **S4** (log:218-276), **v2** (log:282), **LIN-4110** (log:287-339) and **S5** (log:341-364) compared against their forecasts.
4. **Round 2:** five plumbing tickets, surveyed with v2 and acted on, plus the open-0 side arm (log:367-482).
5. **Round 3:** Costs and the quality-of-life tickets, surveyed with open-0; each "do first" was written onto its ticket (log:500-764).
6. **4 Nov:** the Periodicals, a scripted before/after and 13 step-backs (log:861-977); global-voice backtests (log:999-1033, 1186-1209); two forward trials (log:1035-1108, 1282-1328); the ledger, pricing and Claude's scope calls (log:1215-1261); merges and a summary (log:1344-1497).
7. **Overnight:** LIN-4234 and LIN-4233, four ordinary tickets, and a q6 calibration (log:1531-1884).

## 3. What was learned

- **Forecasts named specific things in advance.** S4's two pill tables that disagree were still there at merge (`300c811f`, `render-task-page.js:111,124`) **[checked]**. LIN-4166's forecast warned against extending `subscription` (r2:100), and the builder extended it anyway (`7797c306`) **[checked]**. The misses were things learned by drawing or running the code (log:276, 364).
- **v0** recommended "just drill" on 4 of 5 prize tickets, past copies it had itself found (log:124).
- **open-0 beating v2 "on three"** (log:474) rests on one rater and texts that weren't kept **[reading]**.
- **open-0's "do first" was always a preparation, never a tidy** (log:476). John's question exposed the gap:
  - The consolidations added code: LIN-4177/78/79 +1,023/−646 lines, LIN-4168 +520/−48 **[checked]**.
  - They also made a hub with no home: the catch-all went from 12 to 17 files and cross-area imports from 1227 to 1262 (main, `seams-tangles-review-2026-11-04.md:7,40`) **[checked]**.
  - Claude's "about flat" prediction was wrong (log:908).
- **Pull against push.** Three routed findings were resolved and one improved; 17 pushed follow-ups didn't move (main, `drift-coherence-review-2026-11-04-run2.md:49,135-137`) **[checked]**. The routed ones sat in ground already being rewired, so this isn't like for like **[reading]**.
- **The Surveys caught stale tickets** (LIN-4048, log:1741; LIN-4143, log:1791). `liveGuard` has 0 occurrences at LIN-4143's merge `2eb73ae07`, and LIN-4242 left `setInterval` in `public/` at 10 **[checked]**.
- **Failures:**
  - LIN-4201's "free" extra had to be split off (log:1421).
  - Claude overrode open-0's "keep this separate", which cost (log:1649).
  - LIN-4218 landed as one PR, not the pieces asked for (log:1440).
  - Two rows left files with no map home (log:1679).
  - The global v2 backtest missed its main criterion (log:1534).
- **The ledger was Claude's own scoring.** Blind scorers just after this stretch rated forward rows +0.37 against a baseline of +0.38 and +0.50: "mostly my scoring" (ledger:102-106, 120-124) **[checked]**.

## 4. How the thread left this stretch

- **Carried forward:** the loop (two voices, Claude's scope call, an at-merge list, a ledger row). Next steps: a "table of cases" question, shared test fakes, a blind scorer ("the single biggest gap"), and map homes (log:1866-1870). John then moved the prompts into Harbour (log:1888).
- **Was it John's question?** Yes: can tasks finish cleaner, and can the process be shown to work (log:981, 1234). But "don't build rating schemes" (plan:178) had become scored criteria, tallies and a balance ledger. The ledger was Claude's design (log:1215), not John's **[reading]**.

## 5. Where the driving session's reports outran the evidence

1. **"10 better, 0 worse"** against a baseline of 1 better and 4 worse (log:1466-1469, 1823-1827).
   - LIN-4219's parent row is counted "+" on top of its five pieces (ledger:41) **[checked]**.
   - "Better every time" on ordinary work (log:1830): the blind reads rated LIN-4241 worse and LIN-4048 neutral (ledger:125), and Drift confirmed LIN-4241's check went from 2 copies to 5 (ledger:140).
   - The session caveated (log:1490) and later retracted (`notes-2026-11-05.md:5`).
2. **"14 of 14"** one-owner answers (log:811, 841) and "ten of ten" (log:707).
   - By my count, the question was answered 8 times by 01:30 (log:588, 643, 675, 699-703) and 11 times by 06:00 (log:799, 802, 808).
   - LIN-4199's quoted answer came from the tidy question (log:803-804).
   - "A one-word default change" (log:588) is not a one-owner answer **[reading]**.
3. **"Follows the Survey's order exactly"** (log:840). The entry it summarises says "with two refinements" (log:762) **[checked]**.
4. **"4 of 4 routed were resolved"** (log:1482). It was three resolved and one improved (ledger:56) **[checked]**.
5. **"Builders didn't know a tool"** was logged as a lesson (log:414, 1356). John said it is just the current setup (log:1369).
6. **John's calls taken:** open-0 said to ask John about the `/kpis` label at the start (r3:28), and Claude settled it itself (log:556). The step-back scopes went onto tickets as decisions, which Claude later corrected (log:1241).
