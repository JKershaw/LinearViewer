# Area read: LLM & prompts @ e8e92d50a (baseline, LIN-4464 piece 0)

The baseline read of the work area for LIN-4448, made with the frozen kit ([area-read.md](../area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and the frozen reader prompt ([area-read-reader-prompt.md](../area-read-reader-prompt.md), blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`). The adoption differences are in [area-read-adoption-e8e92d50a.md](../area-read-adoption-e8e92d50a.md); this report cites them and does not repeat them. The control read at the same base is [front-end-pages-e8e92d50a.md](front-end-pages-e8e92d50a.md).

## Recorded fields

| Field | Value |
| --- | --- |
| Area | LLM & prompts (`llm-and-prompts`) |
| Base commit | `e8e92d50a` (`origin/main`; nothing after it on main when checked) |
| Date | 2026-11-13 |
| `docs/areas/areas.json` blob | `1dc2ba7014ef021c785c06dc3eda7d5694a0facd` |
| Kit blob | `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` (`docs/plans/survey/area-read.md`) |
| Reader prompt blob | `ef1c2ca9173831f53ca32b60da1d805d27bf2159` (`docs/plans/survey/area-read-reader-prompt.md`) |
| Note | `docs/areas/llm-and-prompts.md`, blob `b6b4c726de22bccea153d1d3314ac11c5e8c2cca`, 14,838 B: Lessons 3,960 B, 25 Waiting entries (guard's count) |
| Universe | 91 files in the area, by first match, code scope |
| N | 14 (frozen) |
| Sample | 14 files, 380,459 B (see below) |
| Sampling rule | the kit's snippet, run at `e8e92d50a` with slug `llm-and-prompts` and N = 14 |

### Adoption fields

- **Target:** LIN-4448 (LLM & prompts, left simpler). This report is the baseline; it carries no Δ.
- **Verdict mapping (for the after-read):** `D = Δ(llm-and-prompts) − Δ(front-end-pages)`, with the kit's thresholds (D ≥ +0.5, D ≤ −0.5, otherwise no detectable difference) and the noise guard on code means.
- **Limits that apply here** (adoption addendum, section 2):
  - **Concentration.** `lib/openrouter.js` (103,188 B) and `lib/prompt-template-defs.js` (120,531 B) are 223,719 B, **59%** of the sample. Most of the code score rests on those two files.
  - **Byte imbalance.** This sample is 1.84× the control sample (206,545 B). N is frozen, so the imbalance is recorded here and not corrected. Scores are not balanced by byte.
  - **Planned files are sampled.** All three planned files are in the sample: `lib/openrouter.js` (rank 1), `lib/prompt-template-defs.js` (rank 5), `lib/recommendation-live-wait.js` (rank 8). A read that moves can move because these files moved, so the after-read must check which files changed.
  - **Frozen K2 examples are about Runs.** The reader prompt's K2 examples (close-out, PRs per task, dispatch model) are frozen and are about Runs & dispatch. Absolute scores are not compared across areas.
- **Pieces 1–6:** nothing has landed (`git log e8e92d50a..origin/main` is empty when checked).

## Sample

Sorted by the kit's key (rank order). Bytes from `git ls-tree -l` at `e8e92d50a`.

| Rank | Bytes | Path | Blob |
| --: | --: | -- | -- |
| 1 | 103,188 | `lib/openrouter.js` | `e99616a70` |
| 2 | 5,144 | `lib/prompts/runner-kickoff.js` | `b1b4c2e88` |
| 3 | 14,352 | `lib/context-graph.js` | `f30a79304` |
| 4 | 526 | `lib/prompts/area-registry-path.js` | `64fe1c3a4` |
| 5 | 120,531 | `lib/prompt-template-defs.js` | `bc8c4f049` |
| 6 | 2,216 | `lib/recommendation-input.js` | `553387c60` |
| 7 | 10,530 | `lib/prompts/flight-companion-kickoff.js` | `e82fca5b3` |
| 8 | 4,579 | `lib/recommendation-live-wait.js` | `dc9eae323` |
| 9 | 59,307 | `lib/prompts/autopilot-kickoff.js` | `9297f16b6` |
| 10 | 4,999 | `lib/custom-prompts-store.js` | `b1ebb527f` |
| 11 | 32,576 | `lib/prompts/collective-participant.js` | `a6be9fc96` |
| 12 | 4,894 | `lib/prompts/autopilot-manual.js` | `a0ff3a4bf` |
| 13 | 11,894 | `lib/prompts/roadmap-orientation-template.js` | `55d4a986a` |
| 14 | 5,723 | `lib/prompts/roadmap-gap-template.js` | `28951cfd5` |

**Sample total: 14 files, 380,459 bytes.** Reader bundle (note plus sample) 395,903 bytes, built from the git object store at `e8e92d50a`.

## Passes

Two passes, each a fresh general-purpose agent with the default toolset, launched in one batch. Each pass's output is verbatim.

### Pass A

```
Code
- K1: 4. File names map to behaviour (`lib/openrouter.js` for the model client, `lib/prompt-template-defs.js` for stage prompts, `lib/recommendation-live-wait.js` for the live-stage wait), so the right file is usually clear from the name. Cite lib/openrouter.js, lib/prompt-template-defs.js.
- K2: 2. The note itself records the same rules restated across files, and the code repeats the same model ids in `SUGGESTED_MODEL_IDS` and `FREE_TIER_MODEL_IDS` and the Linear workflow lines and pause-for-John text by hand, so deciding a rule means comparing several places. Cite lib/openrouter.js, lib/prompt-template-defs.js.
- K3: 4. Most functions read from their JSDoc and local code, for example `streamChat` and `codeRouteOf`, though `blindReadPrompt` and the template builders depend on leaf constants and helpers defined elsewhere. Cite lib/openrouter.js, lib/prompt-template-defs.js.
- K4: 3. Names are mostly precise (`requestChatOnce`, `TruncatedOutputError`, `codeRouteOf`), but one concept has several spellings (blind read, `blind-read`, `BLIND_READ_KIND`; `look-into` and `look-first`; Survey and `survey-task`), and many comments explain changes by ticket history rather than present behaviour. Cite lib/prompt-template-defs.js, lib/openrouter.js.
- Code mean: 3.3

Note
- M1: 3. Most lessons name an action and its reason (the frozen prompt-size budget, keeping the Survey renders byte-identical), but many depend on ticket numbers and unexplained labels such as "arm 3", "arm 4" and "the 13 Periodical prompt hashes", so a reader has to chase them.
- M2: 3. Each waiting entry names its file and what is waiting, and several give the cost or ruling that holds them back, but many (the `call-budget.js` split, the live-wait compare-and-set) say nothing about why they are not scheduled.
- Note mean: 3.0

Where I could not tell: The note and code cite files I was not given: `lib/call-budget.js`, `lib/prompt-formatters.js`, `lib/stage-router.js`, `lib/periodicals.js`, `lib/prompts/leftover-words.js`, `docs/areas/README.md`, and the tests and review documents named in the Waiting list. So I could not check whether the cited rules, tests or review findings still hold, or how the free-tier clamp and `{HEAD}`/`{BASE}` substitution behave outside these files.
```

Pass A: code mean 3.25 raw, reported 3.3. Note mean 3.0.

### Pass B

```
Code
- K1: 4. File names mostly say what each holds (`lib/call-budget.js`, `lib/prompts/stage-intent.js`, `lib/recommendation-live-wait.js`), and the note points to the right file for most rules, though `lib/openrouter.js` mixes routing, streaming, budgets and catalog reads.
- K2: 2. The same rules are restated across files, such as the inside/outside scope and verdict wording in `lib/prompt-template-defs.js` and the model-id lists in `lib/openrouter.js`, so finding where a rule is decided means reading several places.
- K3: 4. Most functions in `lib/openrouter.js` read correctly from the file itself, with JSDoc stating inputs, outputs and the whole-or-loud retry contract, though `blindReadPrompt` in `lib/prompt-template-defs.js` depends on imported leaf constants.
- K4: 3. Names are mostly precise (`streamChat`, `allowPartial`, `TruncatedOutputError`), but one concept goes by several names (routing reply, stage selector, recommendation, router, next-stage choice), and comments lean on ticket numbers more than stated reasons.
- Code mean: 3.3

Note
- M1: 4. Most lessons say what to do and why (keep scoping and the Survey renders byte-identical because replays compare them; give no Periodical its own merge rule because notes are prompt input), though a few are phrased as a state with the action only implied.
- M2: 3. Most Waiting entries name the file and a blocker (a John ruling, a replay, a size of move), but several give only a source such as a review or ticket, not why they are unscheduled, for example the stage-kind tables entry and the claim compare-and-set entry in `lib/recommendation-live-wait.js`.
- Note mean: 3.5

Where I could not tell: The tests, ceilings and docs the note cites (`docs/areas/README.md`, `tests/unit/prompt-size-budget.test.js`, `scripts/prompt-template-change-log.md`) were not in the bundle, so I could not check whether the rules are enforced or the ceilings hold. Several referenced modules were also absent (`lib/stage-router.js`, `lib/recommendation-blind-read.js`, `lib/recommendation-look-first.js`, `lib/prompt-formatters.js`, `lib/size-of-move.js`, `lib/prompts/leftover-words.js`, `lib/call-budget.js`). I could not confirm whether the Waiting items are still open.
```

Pass B: code mean 3.25 raw, reported 3.3. Note mean 3.5.

## Area summary

| | Code | Note |
| --- | --: | --: |
| Pass A | 3.3 (raw 3.25) | 3.0 |
| Pass B | 3.3 (raw 3.25) | 3.5 |
| **Area** | **3.3** | **3.25** |

- **Noise guard:** the passes' code means differ by 0.0 (under 1.0), so the read is decided. The note means differ by 0.5; the guard does not apply to the note, and the gap is reported only.
- Area code is the mean of the two passes' reported code means, and area note the mean of their reported note means (the kit's combined-score convention, method-as-run addendum section 7).

## Control and contamination

- **Control moved.** The control (`front-end-pages`) is read at the same base, and its sample changed since `4b5001ddf`: `lib/render-proxy.js` (#2424, LIN-4457), and `lib/render-swipe.js` and `lib/render-task-page.js` (#2423, LIN-4446). The control note moved from blob `971d4bf6c` to `ae9c007e1`, and its Waiting entries fell from 14 to 12. That is recorded in the control's own report and in the adoption addendum (section 2, item 6). It does not affect this area's numbers.
- **Open PRs.** Fourteen were open. None touches a sampled file. #2427 (LIN-4455) touches the LLM note `docs/areas/llm-and-prompts.md` (+5 lines). The baseline note is blob `b6b4c726d`, without #2427's lines. The other thirteen touch neither note. The check reads each PR's file list from `gh pr view`; it does not inspect diffs.
  - **At merge (2026-11-13).** #2427 has merged (`192e1f81f`), so the LLM note on main is now blob `eb976276d` (+5 lines, 172 to 177) while this baseline stays at `b6b4c726d`; the after-read reports that difference as note movement, not code change. #2428 (LIN-4456, `0092d8d9e`) touched neither note nor any sampled file. No sampled file changed between `e8e92d50a` and `0092d8d9e`. Open PRs now: #2432 (LIN-4459, opened after the baseline check) is open and touches the sampled file `lib/openrouter.js` and the LLM note `docs/areas/llm-and-prompts.md`; it has not merged, so the baseline still holds, but if it merges before the after-read, that sampled file's blob and the note move and the after-read must account for both. #2431 (LIN-4471, also new) touches no sampled file and neither note. #2429 (LIN-4451) touches no sampled file and adds 6 lines to the control note `docs/areas/front-end-pages.md` (not this area's note). The "thirteen touch neither note" count above is as checked at the baseline.
- **Contamination check.** Each counted reader's transcript was parsed for every tool call and checked against its own inputs file.

  | Pass | Tool calls | Tools used | Paths touched | Inside own inputs? |
  | --- | --: | --- | --- | --- |
  | A | 12 | Read only | the LLM `inputs.md`, 12 reads | yes |
  | B | 13 | Read only | the LLM `inputs.md`, 13 reads | yes |

  - Both passes' first user message is the reader prompt with the inputs line. It names no ticket identifier. It names the scratchpad path of the inputs file, which the method requires; it names no other repository path.
  - Neither pass used Grep, Glob, Bash, WebFetch or any other tool. Both are clean.
- **Limit on the check.** The check sees tool calls. It cannot see what the harness loaded into a reader's context before the first call, such as the repository's `CLAUDE.md`. The adoption addendum records this.

## Where the readers could not tell

Both passes report the same gap: the bundle holds only the note and the 14 sampled files, so the referenced tests, ceilings, docs and modules outside the sample could not be checked. Pass A and B each name the unscheduled-Waiting entries as hard to judge from the note alone. Neither pass could confirm that Waiting items are still open.
