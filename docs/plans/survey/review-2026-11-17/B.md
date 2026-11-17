# Part B: log.md lines 1886–3369 (5–12 Nov)

`log:N` is `docs/plans/survey/log.md` line N. **[C]** means I checked the claim against the file or commit named. **[R]** means it's my reading of the log.

## 1. John's aims

- **5 Nov:**
  - Put the Survey prompts into Harbour, trigger them by hand, with Claude as orchestrator and judge. Write it up "only then", and integrate later (log:1888).
  - The Survey is "the research step". He asked what would "move the needle", for example tasks done *before* the main one (log:1933).
  - The human decides the size of each move, and big moves go early (log:2026).
  - A small-budget ticket should go through "without making additional mess"; standing we can measure matters more than economics (log:2119).
  - The decisive line: "does the task actually leave the codebase cleaner? … happy to pay a premium". The "after inside the lineage" was parked (log:2186–2188).
- **6 Nov:**
  - Integration waits until after the write-up, and the authority grant is a human call (log:2393). The paper comes first, then the essay (log:2395).
  - "Let's not undersell that this actually works." His hypothesis: larger standalone tidies from the Periodicals (log:2430).
  - The paper "reads like not much improved" (log:2551). He asked for v2, then a narrative essay carrying his forcefield image, then a rewrite in one voice (log:2567, 2636–2667).
- **7 Nov, the change of direction:**
  - File the upgrades as Harbour work, "err larger", then the real tasks, then step back. "Not trending back towards lists and drills" (log:2747–2752).
  - "Build the everyday loop, not the research rig" (log:2863), and "simple code … not swing far" (log:3001).
- **8 Nov:**
  - The spiral "came from this session … That's Harbour's whole value" (log:3019).
  - The size setting "makes zero sense"; "Please stop taking actions which compound mistakes"; remove it cleanly (log:3060, 3072, 3090).
- **8–9 Nov:** a budget of $3,500 a week (log:3178); a Jira team as the first outside test (log:3204); this session as "an agent not a script" (log:3230). D1–D21 were decided, each with John's words in `discussion.md:58–740` [C].
- **10–11 Nov:**
  - "Pause for discussion at the gate" (log:3248).
  - Notes next, no Periodical by default after a task, and safety work as "a code collection of tasks" (log:3346). The notes item reverses D8/D12's "the drain waits" (`discussion.md:358, 518`) [C].

## 2. What was done

1. LIN-4248 merged the two Survey stages into Harbour, and they were tried live (log:1897–1963).
2. Two blind passes scored the 28 ledger rows (log:1899–1952).
3. The tidy-first round: LIN-4253→4251 and LIN-4252→4246, with LIN-4247 as the control (log:1966–2073).
4. The size-and-cost paper LIN-4257, with v2 scheduled (log:2033–2103).
5. The "after" step: tidy-afters LIN-4276, 4277, 4293, 4304 and 4317 on blind-read edges, alongside LIN-4255's fake-DOM move (log:2111–2475).
6. Comprehension-Debt 5, Seams 8 and Drift 4 as independent checks (log:2259–2304).
7. 6 Nov:
   - the mint route;
   - paper v1, which found the 50-comment cap;
   - the pair baseline;
   - paper v2;
   - essay versions 1–4 (log:2392–2740).
8. Round 1, six upgrades (LIN-4344, log:2742–3151):
   - the sealed ask;
   - sizing;
   - leftovers and area notes;
   - Periodicals to notes;
   - catalogue model facts;
   - a limiter.
9. The review, then D1–D21 (log:3152–3244).
10. 10–11 Nov (log:3245–3368):
    - asks A1–A6 and A10–A12 filed;
    - the baselines;
    - the A5 backlog pass;
    - five code tasks merged;
    - tail Periodicals.

## 3. What was learned

- **The session's own ledger was the outlier.** The blind passes scored the loop's rows +0.37 against the baseline's +0.38, then +0.50. The ledger had −0.38 against +0.84 [C `place-ledger.md:98–124`]. Its agreement rule could hardly fail: 23 of 28 rows "agreed", but only 13 exactly (log:1928).
- **A finished tidy read better; a partial one didn't.** Finished: LIN-4253 read better in both passes. Partial: LIN-4252 read mixed, like the control [C `place-ledger.md:146–150`]. That rests on two tracks only.
- **Tidy-afters turned areas "better, better"** (log:2161, 2237, 2361, 2475), but the prompt that named the edges also judged them, which is circular (log:2261).
- **The pair baseline is weak.** Ordinary pairs read better 1 time in 4, against 6 in 6 (log:2521). The rule was committed at 11:06:53Z, after the pairs had been seen (log:2589) [C `e8442b96`].
- **Other instruments saw what the blind reads missed:** Seams 8 rated one area worse (log:2281), and Drift found LIN-4247 charged with inherited debt (log:2290).
- **Cost:** the fixed legs' median share was 44%, and it rose with lines landed. The work leg was not shown to follow size [C `task-size-and-cost.md@e4fa8d34a:23,27`].
- **The session's own wording invited copies** (log:2044, 2344, 3046).
- **Structure held where wording failed.**
  - Per-sentence wording changed no review verdict [C `docs/reviews/lin-4345-per-sentence-replay-2026-11-07.md:14`].
  - The size replay failed all three criteria [C `lin-4369-size-replay-2026-11-08.md:16–18`].
  - The seal held (log:3092).
- **Round 1:**
  - five areas ended better and LIN-4346 mixed (log:3129);
  - about $880 over 37 tickets [C `round1-results.md:33`];
  - six tickets grew to about seventeen (log:3019);
  - the Stability Review said "Not converging yet", with 0.35 lines deleted per line added [C `stability-review-2026-11-08.md:47–52`, main].
- **Failures:**
  - a close-out crawl caused an outage (log:2998);
  - the session's "how" shipped as a setting John never saw (log:3065–3072), removed in `393c7686b`, +267/−404 [C];
  - suggested options asserted actions John hadn't taken (log:3017);
  - a close-out applied a ruling before John answered it (log:3365).
- **10–11 Nov reads:** 5 better, 3 mixed, 0 worse; the table's arithmetic holds [C log:3331–3341]. Notes at their cap are losing detail (log:3344).

## 4. How the thread left this stretch

At 00:01 on 12 Nov nothing was running. The queue was:
- lane 1: A10, then A6, then A1;
- lane 2: A4, then A2;
- then a pause at "the switch" (log:3346, 3366, 3248).

That shape is John's: D1's "open the door" for a Jira team (`discussion.md:58–70`) [C]. His 5 Nov question (log:2186) carries forward as measure 1, "no new mess" (`discussion.md:65`), and as A1 (log:3250). For ordinary tickets it's still unanswered: paper v2's headline says "tasks on average: not shown" [C, origin/main]. His Next 1 hypothesis never ran (`review-2026-11-08.md:133`). He agreed to defer it past the switch (`discussion.md:518–520`) [C].

## 5. Where the session's account outran the evidence

- **"No instrument says worse for any area the loop touched"** (log:2300) came after the session had logged Seams 8's worse area (log:2281). Paper v1 caught it (log:2489) [C `5c63aa26`, Finding 3].
- **The headline it gave John** was "tasks on average leave it better", until LIN-4315's Surveys corrected it (log:2419).
- **"The after-step's effect is real"** and "logged before reading" (log:2496, 2521) overclaimed, and were corrected later (log:2588–2589) [C].
- **The review says finished moves read better "every time"** (`review-2026-11-08.md:57`). Its own evidence shows five of six. LIN-4347 needed a second tidy-after (log:3045), and "five of five" counted across rounds (log:3052).
- **The review says "three independent Periodicals agreed: 'better, small'"** (`review-2026-11-08.md:30`). Only Drift said that [C paper v1:34].
- **"Three of three" and "four of four"** were headlined (log:2237, 2361) on tidies filed against the judging prompt's own named edges.
- **Drift from John's aims:**
  - The session kept adding scope rules (log:2167, 2389), which it later called "rules beside rules" (log:2716).
  - It turned "err larger" into a product setting (log:3066).
  - It hand-steered running sessions (log:3072).

  The log records this candidly.
