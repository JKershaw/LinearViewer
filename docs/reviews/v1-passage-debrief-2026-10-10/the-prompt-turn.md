# C: The prompt turn (git, `origin/main` @ `ce3c4ee8`, 10 Oct)

Bytes: `git cat-file -s`, or the ceilings in `tests/unit/prompt-size-budget.test.js` (set to actual size by LIN-3300). Tickets read with the FC GET helper. UK dates.

## 1. Before, the turn, after

**Before (as of 2 Oct): two paths.**
- **Recommend:** a routed recommendation (Recommend, `recommend-and-dispatch`, autopilot, lanes) sent one model the meta-prompt (`lib/prompts/meta-prompt-template.js`: 106,905 bytes of source, 104,526 rendered). That model walked a Step 0–4 decision tree and **wrote the agent's whole prompt**.
- **Stage buttons:** these used the 17 hand-written templates (`generatePrompt()`).
- **The rule:** CLAUDE.md said changes "must update BOTH paths".
- **The cost:** 53 of the 63 PRs from June to 7 Oct that touched the stage definitions also had to touch the meta-prompt (`docs/papers/harbour/coherence-as-it-grows.md`). LIN-3300's research found "Stage knowledge sits in 19 mirrors."

**The turn.** It started from the essay `docs/papers/harbour/like-a-skilled-developer.md` (3 Oct).

| Date | PR | Ticket | Change |
|---|---|---|---|
| 2 Oct | #1708 | LIN-3203 | Prompt sizes frozen at a total of 568,534 bytes |
| 3 Oct | #1742–#1744 | LIN-3291/3292/3293/3294/3296 | The cause counts as part of the work; machine-read formats move into code; an experimental brief writer (a third layer, off by default) |
| 4 Oct | #1745 | LIN-3299 | One Goal lead per stage (`STAGE_LEADS`) |
| 4 Oct | #1747, #1748 | LIN-3304, LIN-3309 | Routing gets its own module; plan-review facts come from code |
| 5 Oct | #1751 | LIN-3300 | Meta-prompt and brief writer deleted |
| 5 Oct | #1752 | LIN-3300 | An 8 KB selector replaces the 44,667-byte decision tree and reads recent runs |
| 6 Oct | #1760 | LIN-3326 | Close-out finishes the work |
| 9 Oct | #1799 | LIN-3378 | Four selector misroutes fixed |

The brief writer was on main for about 31 hours.

**After: one path.** One routing call picks the stage and gives a one-line "why now". Code builds that stage's prompt, identical to what the stage button gives. Code settles one route itself, the review loop bound. There are 17 templates before and after.

| | Freeze, 2 Oct | Now |
|---|---|---|
| Prompt paths | 2 (3 for 3–5 Oct) | 1 |
| Prompt a routed call sends (eval leaf) | 104,526 | 9,545 |
| 17 templates, rendered | 114,936 | 105,214 |
| Close-out / review, rendered | 19,935 / 19,890 | 10,859 / 15,598 |
| Frozen prompt total | 568,534 | 342,601 (−40%) |

- **Lines:** #1751 and #1752 together added 3,827 lines and removed 11,422 (all files).
- **Where the rules went (inference):** checks the prompts used to spell out moved into code. `recommendation-facts.js` grew from 4,787 to 23,429 bytes, and `recent-runs.js` and `prompt-contract.js` are new.

## 2. Principles, verbatim

- "no model writes a prompt, and code settles only the review loop bound." (`CLAUDE.md`. The first clause arrived with #1751 and the second with #1752, both 5 Oct.)
- "a new lesson lands as code or a test first, and prompt text (templates, meta-prompt, runner prompt) grows only by removing at least as many bytes elsewhere in the same change." (`CLAUDE.md`, 2 Oct, #1708. It still names the deleted meta-prompt.)
- "Additions to the process have outnumbered removals about six to one … the ratchet is what makes the rules expensive." (`tests/unit/prompt-size-budget.test.js`, 2 Oct, #1708)
- "The model picks the stage and says why in one line; it writes no prompt." (`docs/architecture/prompt-system.md`, 5 Oct, #1752)
- "a rule is added only with its reason, and a rule in code only where it is structural" (same file, #1752)
- "both were deleted, not switched off." (same file, #1751)
- "A change to a machine-read format is a contract change … not prose." (same file, 3 Oct, #1742)

## 3. Did it run smoother after?

| `git log origin/main` | 26 Sep–2 Oct (7 d) | 3–5 Oct turn (3 d) | 6–10 Oct (5 d, last day partial) |
|---|---|---|---|
| PRs merged per day | 21.0 | 8.0 | 12.2 |
| … touching lib/routes/public, per day | 9.3 | 7.7 | 11.0 |
| Commits naming a re-review or review round | 7 | 4 | 0 |
| PRs fixing, retiring or reverting a PR merged ≤24 h earlier | 2 | 2 | 5 |

Caveats:
- The before window includes 68 docs-only PRs; the after window has 3.
- 22 of the 61 after-window PRs are squash merges, which hide their commits' subjects. Their message bodies mention no re-review.
- I classified the reversal row by hand, so treat it as a minimum: #1659, #1719 | #1741, #1744 | #1775, #1801, #1805, #1812, #1816.
- The only git revert (#1816) followed a ruling that cancelled the feature (LIN-3438).

**For:**
- LIN-3326 says close-out's deadlock "sat under LIN-2948, LIN-3313, LIN-3126 and LIN-3315 … hidden, because the Flight Companion merged past it".
- After #1760, a single close-out run finished LIN-3325 from start to finish (LIN-3326's close-out comment).
- Since then the prompt files have changed only through #1799 (+20/−13 lines) and two small edits.

**Against:**
- LIN-3372: "the selector wavered or misrouted at least eight times on 8 Oct. Each time the FC caught it by re-asking or by pinning the kind".
- When it shipped, the selector routed 13 of 92 eval cases wrong, against 11 for the old main. This was accepted (LIN-3300, 5 Oct).
- LIN-3378 shipped four fixes the next morning. On the 15 misroute points they scored 82/90, against 39/90 before. On the standard gate they scored 241/276, against 240/276 (`what-the-selector-needs.md`).

**Reading (inference):** smoother where the turn aimed. The commits show no re-review rounds after it, and close-out now finishes tasks. It was not friction-free: the selector needed one measured fix, and quick corrections of just-merged code did not fall (5 in 5 days, against 2 in 7).

## 4. Harbour in its own words

- "When this task fixes something, its cause is part of the work, wherever it lives." (`lib/prompts/stage-intent.js`)
- "Only a change the team would need to hear about before it happens goes to the human, as one clear question with your recommendation." (same file)
- "Build it, prove it works, and open a PR that review can approve: the problem solved, not steps ticked off." (`lib/prompt-template-defs.js`, `STAGE_LEADS`)
- "Finish it the way a skilled developer finishes their own … A merge is hard to undo, so settled must mean settled." (same, close-out)
- "You do not do the work or write its prompt: code assembles the chosen stage's prompt." (`lib/stage-router.js`)
