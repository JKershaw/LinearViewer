# What this stage really wrote

## Comment on LIN-4464 at 15:58:40 (posted after steps 2 and 3, which wrote on LIN-4448)

## Survey open-0: LIN-4464 @ 5dcf5bcda

Base: origin/main `5dcf5bcda` (the #2424 merge). The kit's snippet was run unchanged.

**Why this will be harder than "rerun #2422"**

1. **The kit can't be used fully unchanged.** `area-read.md` names Runs as the work area, posts to LIN-4447 with `@ 4b5001ddf` headings, and writes the verdict as D = Δ(Runs) − Δ(control). The salt and N=14 carry over. The area, base, target ticket and verdict wording still have to be set somewhere, and editing the kit breaks its blob pin for LIN-4462's after-read. Put them in an adoption block in each report's header and leave the kit's file alone.

2. **The pairing isn't balanced the way the kit claims.** The kit chose N=14 for a 3.4% byte gap between Runs and the control. Here the samples are **380,459 B** for llm-and-prompts (14 of 91 files) and **206,545 B** for the control (14 of 92), a gap of about 84%. `lib/prompt-template-defs.js` (120,531) and `lib/openrouter.js` (103,188) are 59% of the LLM sample, so K3/K4 will mostly score those two files. Each pass also takes about 395 KB inline (sample plus the 14,838 B note). The noise guard (≥1.0 apart) is more likely to trip. Record this as a known limit and keep N. The upside: all three planned files are in the sample (`openrouter`, `prompt-template-defs`, `recommendation-live-wait`), so unlike Runs, this read does see the work.

3. **There is more contamination of the control than the ticket says.** Three of the 14 control files changed between `4b5001ddf` and the base:
   - `render-proxy.js` (812d9adbb, #2424), as noted;
   - `render-swipe.js` and `render-task-page.js`, from **#2423 (LIN-4446)**, which the ticket doesn't mention. `render-task-page.js` is also one of LIN-4453's four tracked files.

   The control's **note** changed too: `front-end-pages.md` went from 6,404 B to 5,825 B (blob `ae9c007e1`), and its Waiting entries from 14 to 12. Both reads sit at `5dcf5bcda`, so the pair holds. Record all of it; this control read's M scores won't match LIN-4453's.

4. **Other numbers have moved.** `areas.json` is now `1dc2ba701`, with no change to either sample. The LLM note is blob `b6b4c726d` with **25** Waiting entries, not the parent's 26 (#2421 removed one).

5. **Open PRs.** #2427 and #2426 touch neither sample. I checked every open PR: none touches the 28 files. Write them as `#NNNN`, never as full URLs: the kit warns that `landingPrUrls` would pull a PR URL into the landing.

**Smaller traps**
- "Frozen prompt" in the acceptance means the reader prompt, not the parent's 378,915 B prompt budget.
- The reader prompt's K2 examples are about Runs. Δ is still sound, but don't compare absolute scores across areas.
- Commit the reports as `area-read-reports/{llm-and-prompts,front-end-pages}-5dcf5bcda.md`. If you also post them as comments, use the `## Area read:` heading, not `## Blind read` (422).

**What I'd do first:** fix the base at `5dcf5bcda` even if main moves, provided none of pieces 1–6 has landed. Then write the adoption block (area, base, target LIN-4448, verdict mapping, byte-imbalance limit, the full contamination list) before running any reader. Then do four fresh passes.
