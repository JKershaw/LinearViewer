# Area read: comparison, `49776653d` against `e8e92d50a` (LIN-4470 piece 6, for LIN-4448)

**The result first: no detectable difference on code, and the area does not beat its control.** The kit's rules give D = −0.3 on the reported means (−0.25 on the raw means), inside the ±0.5 band, so they produce "no detectable difference at this threshold". The LLM & prompts code score fell from 3.3 to 3.0 in both passes, and the control's did not move. The note score rose from 3.25 to 4.0 in both passes. The kit reports note movement on its own, so it is not counted as code improvement. The done-when condition, "the area reads better in a blind read ... by more than an untouched area read at the same times", is not met on code. LIN-4448 says so.

This file sets the after-read beside the baseline, using the frozen kit ([area-read.md](../area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and its verdict criteria exactly as written. The method is [area-read-method-as-run.md](../area-read-method-as-run.md), section 8.

| | Before (`e8e92d50a`, LIN-4464) | After (`49776653d`, LIN-4470) |
| --- | --- | --- |
| LLM & prompts (work area) | [llm-and-prompts-e8e92d50a.md](llm-and-prompts-e8e92d50a.md) | [llm-and-prompts-49776653d.md](llm-and-prompts-49776653d.md) |
| Front end: server-rendered pages (control) | [front-end-pages-e8e92d50a.md](front-end-pages-e8e92d50a.md) | [front-end-pages-49776653d.md](front-end-pages-49776653d.md) |

## 1. Scores

Each cell is one pass's reported mean (one decimal). Raw means are in brackets where they differ.

| Area | Pass | Code | Note |
| --- | --- | --: | --: |
| LLM & prompts | Before A | 3.3 (raw 3.25) | 3.0 |
| LLM & prompts | Before B | 3.3 (raw 3.25) | 3.5 |
| LLM & prompts | After A | 3.0 | 4.0 |
| LLM & prompts | After B | 3.0 | 4.0 |
| Front end (control) | Before A | 3.3 (raw 3.25) | 3.5 |
| Front end (control) | Before B | 3.3 (raw 3.25) | 3.5 |
| Front end (control) | After A | 3.3 (raw 3.25) | 3.5 |
| Front end (control) | After B | 3.3 (raw 3.25) | 3.5 |

Area means (mean of the two passes' reported means, the kit's convention):

| Area | Before code | After code | Δ code | Before note | After note | Δ note |
| --- | --: | --: | --: | --: | --: | --: |
| LLM & prompts | 3.3 | 3.0 | −0.3 | 3.25 | 4.0 | +0.75 |
| Front end (control) | 3.3 | 3.3 | 0.0 | 3.5 | 3.5 | 0.0 |

On raw means the code Δ is −0.25 for LLM & prompts and 0.0 for the control.

## 2. Verdict (kit criteria, fixed before any reading)

1. **Noise guard.** At each area and time point the two passes' code means differ by 0.0 (under 1.0), so each read is decided. The note means differ by 0.5 in the LLM before-read and by 0.0 elsewhere; the guard applies to code only, and the gap is reported.
2. **Verdict.** D = Δ(LLM & prompts) − Δ(control) = −0.3 − 0.0 = **−0.3**. That is inside the band (−0.5 < D < +0.5), so the verdict is **no detectable difference at this threshold**. On raw means, D = −0.25, the same verdict.
3. **Note movement, reported on its own.** Δ of the note mean is +0.75 for LLM & prompts and 0.0 for the control. It is reported beside D and is not counted in D. It is note cleanup, not code improvement. The LLM note went from 25 Waiting entries to 12, and the readers' note marks rose: M2 from 3 to 4 in both passes, and M1 from 3 to 4 in pass A.
4. **Control moved.** Yes. Four of the control's 14 sampled files changed bytes (`lib/render-task-page.js`, `lib/render-session.js`, `lib/render-proxy.js`, `lib/render-swipe.js`), and the control note changed (12 → 14 Waiting entries). The control's Δ is 0.0 on code and 0.0 on note, so the flag does not change the verdict. It is stated here beside D, as the kit requires.

**Done-when, mapped to verdict 2.** The area read better than the control on code by more than the control's movement would require, so the condition is not met. The result is not "no change": the LLM & prompts code score fell by 0.3 on the reported means, which the kit does not count as a detectable difference. Within the code score, the readers' marks moved in both passes the same way: K1 and K3 fell from 4 to 3, K2 rose from 2 to 3, and K4 held at 3. Two passes is a small sample, and the dimensions moved in opposite directions, so the code total is not evidence of a change in readability.

## 3. Sample

| | Before (`e8e92d50a`) | After (`49776653d`) |
| --- | --- | --- |
| LLM & prompts sample | 14 files, 380,459 B | 14 files, 396,764 B; 13 of 14 paired |
| LLM & prompts universe | 91 files | 94 files |
| Front end sample | 14 files, 206,545 B | 14 files, 206,753 B; 14 of 14 paired |
| Front end universe | 92 files | 94 files |
| `docs/areas/areas.json` blob | `1dc2ba7014ef021c785c06dc3eda7d5694a0facd` | `a4f33893e57fd7e936b05879f515c1edd4115078` |

- **LLM & prompts, paired set (secondary figure).** `lib/recommendation-live-wait.js` left the area (LIN-4459) and `lib/prompts/stage-kinds.js` entered (LIN-4467). The other 13 are paired. Verdicts use the full sample.
- **Front end, control.** The same 14 paths. Four changed bytes since the baseline, as in section 2, item 4.
- **Tracked control files.** The kit lists four files the work imports. Blob SHAs at `e8e92d50a` and `49776653d`: `lib/render-task-timeline.js` `1f26d930` → `5de60ac8` (changed, not sampled); `lib/render-run-evidence.js` `29ea01bd` → `29ea01bd` (unchanged, not sampled); `lib/render-task-page.js` `06654bb1` → `9e47c179` (changed, sampled); `lib/render-session.js` `05fafa3d` → `6762087d` (changed, sampled). The kit's table records the blobs at `4b5001ddf`. They match `e8e92d50a` for three of the four files; `lib/render-task-page.js` changed between those bases (`e5e1626c` at `4b5001ddf`, `06654bb1` at `e8e92d50a`). A change to a tracked file flags the control, so the flag stands.
- **Byte imbalance.** The LLM sample is 1.92× the control sample at the after-base. N is frozen, so this is recorded and not corrected. The scores are not balanced by byte.

## 4. Open PRs

Twelve were open at the check. None touches a file in either sample or one of the tracked control files. The check read each PR's file list, not its diff.

## 5. Contamination

Each counted reader's transcript was parsed for its tool calls and checked against its own inputs file. The check is in each area's report. All four counted readers used Read only, and every read was inside their own inputs file. Four readers were launched and four counted; none was stopped, and none was relaunched.

## 6. Known limits, stated plainly

1. **The sample sees part of the work.** The LLM sample holds `lib/prompts/stage-kinds.js` (the new record) and `lib/recommendation-input.js` and `lib/prompts/area-registry-path.js` (both changed here), and `lib/openrouter.js` and `lib/prompt-template-defs.js`, which the earlier pieces changed. Most of the duplicate-rule removal happened in files outside the sample (`lib/recommendation-blind-read.js`, `lib/dispatch-entrance.js`, `routes/proxy-compute.js`, the proxy write guard in `lib/stage-write-gate.js`), so this read does not see most of the move. A code score that does not move is not evidence that the copies are still there, or that they are gone.
2. **The note is scored apart from the code.** The note's gain is real in the kit's terms and is reported as note cleanup. It does not count toward the verdict.
3. **Two passes is a small sample.** Reader variance can be large. The noise guard is what stops a difference inside the noise from being read as a verdict; here it passed, and D is inside the band.
4. **Method.** The bundle was delivered as in method-as-run section 1: the same added line, with each area's own inputs path. The reader tools were not restricted to read-only (the method's "possible improvement" is not yet applied, so the method stays as written).
5. **Counting.** The universe excludes JSON such as `lib/runner-kit/contract.json` and all test files, as the kit states.
6. **The readers saw only what the bundle held.** Both areas' passes name cited files they could not check. Their notes on the Waiting entries are judgements about the entries as written, not about the code those entries cite.
