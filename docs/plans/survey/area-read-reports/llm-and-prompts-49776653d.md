# Area read: LLM & prompts @ 49776653d (after, LIN-4470 piece 6)

The after-read of the work area for LIN-4448, made with the frozen kit ([area-read.md](../area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and the frozen reader prompt ([area-read-reader-prompt.md](../area-read-reader-prompt.md), blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`). The method is [area-read-method-as-run.md](../area-read-method-as-run.md), section 8, unchanged. Its baseline is [llm-and-prompts-e8e92d50a.md](llm-and-prompts-e8e92d50a.md) at the same kit. The control read at the same base is [front-end-pages-49776653d.md](front-end-pages-49776653d.md), and the comparison is [comparison-49776653d-vs-e8e92d50a.md](comparison-49776653d-vs-e8e92d50a.md).

## Recorded fields

| Field | Value |
| --- | --- |
| Area | LLM & prompts (`llm-and-prompts`) |
| Base commit | `49776653d` (LIN-4470 piece 6 commit on `feat/lin-4470-waiting-settle-and-reads`, the PR's head; read from git objects, not the working tree) |
| Date | 2026-11-14 |
| `docs/areas/areas.json` blob | `a4f33893e57fd7e936b05879f515c1edd4115078` (baseline `1dc2ba7014ef021c785c06dc3eda7d5694a0facd`) |
| Kit blob | `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` (`docs/plans/survey/area-read.md`), unchanged |
| Reader prompt blob | `ef1c2ca9173831f53ca32b60da1d805d27bf2159` (`docs/plans/survey/area-read-reader-prompt.md`), unchanged |
| Note | `docs/areas/llm-and-prompts.md`, blob `1168b94bc3a9b50bedb64032d12322c75151f132`, 12,006 B: 12 Waiting entries (baseline blob `b6b4c726de22bccea153d1d3314ac11c5e8c2cca`, 14,838 B, 25 entries) |
| Universe | 94 files in the area by first match, code scope (baseline 91) |
| N | 14 (frozen) |
| Sample | 14 files, 396,764 B (baseline 380,459 B) |
| Sampling rule | the kit's snippet, run at `49776653d` with slug `llm-and-prompts` and N = 14 |
| Inputs | one bundle built as in method-as-run section 2: the note, then the 14 sampled files in path order, from `git show 49776653d:<path>`; 409,371 B. Each pass reads that file, and nothing else |

## Sample

| Bytes | Path |
| --: | -- |
| 14,352 | `lib/context-graph.js` |
| 4,999 | `lib/custom-prompts-store.js` |
| 101,637 | `lib/openrouter.js` |
| 98,917 | `lib/prompt-template-defs.js` |
| 906 | `lib/prompts/area-registry-path.js` |
| 59,307 | `lib/prompts/autopilot-kickoff.js` |
| 4,894 | `lib/prompts/autopilot-manual.js` |
| 32,576 | `lib/prompts/collective-participant.js` |
| 10,530 | `lib/prompts/flight-companion-kickoff.js` |
| 5,723 | `lib/prompts/roadmap-gap-template.js` |
| 11,894 | `lib/prompts/roadmap-orientation-template.js` |
| 5,162 | `lib/prompts/runner-kickoff.js` |
| 43,330 | `lib/prompts/stage-kinds.js` |
| 2,537 | `lib/recommendation-input.js` |

Sample total: 14 files, 396,764 bytes.

**Paired set.** Against the baseline sample (`e8e92d50a`, the same rule), 13 of 14 files are paired. `lib/recommendation-live-wait.js` left the area (LIN-4459, merged into Runs & dispatch) and `lib/prompts/stage-kinds.js` entered (LIN-4467, a new record). The paired set is reported as a secondary figure; verdicts use the full sample.

**Planned-change overlap.** This read's files include `lib/openrouter.js`, `lib/prompt-template-defs.js`, `lib/recommendation-input.js` and `lib/prompts/area-registry-path.js`, which LIN-4470 touched, and `lib/prompts/stage-kinds.js`, which LIN-4467 made a record. The change was on the sample's own files, so this read can move because of them. That is a limit of the read, not a finding about the code.

## Passes

Two passes, each a fresh general-purpose agent with the default toolset, launched in one batch with no shared context. Each pass's output is verbatim.

### Pass A

```
Code
- K1: 3. Most file names say their subject (`lib/prompts/runner-kickoff.js`, `lib/prompts/stage-kinds.js`), but `lib/openrouter.js` is headed as the recommendation client while it also holds streaming, the tool loop, model lists and pricing, and `lib/prompt-template-defs.js` is headed as a label-to-generator map though it now mostly holds prompt bodies. Cite: lib/openrouter.js, lib/prompt-template-defs.js.
- K2: 3. The model lists, the reasoning-budget split, the stage record and the code-route order each name one home, but the same rules are restated in prose, such as the stepper's wedged-session and blocked exemption repeated across its beats, and close-out and review rules appear both in template bodies and in the `STAGE_KINDS` record. Cite: lib/prompts/autopilot-kickoff.js, lib/prompts/stage-kinds.js.
- K3: 3. Small functions such as `parseOrientationLines` and `buildRosterBlock` read whole from the file, but `buildAutopilotKickoff` interleaves five flag branches inside long template literals, and `streamChat` depends on `planCallBudget` and `planRetryBudget` from another module. Cite: lib/prompts/autopilot-kickoff.js, lib/openrouter.js.
- K4: 3. Names such as `resolveReasoningBudget`, `TruncatedOutputError` and `CODE_ROUTES` say what they do, but one concept is called "routing call", "stage selector", "next-stage choice" and "recommendation" within the same file, and many comments cite ticket numbers as history rather than stating the reason. Cite: lib/openrouter.js, lib/prompt-template-defs.js.
- Code mean: 3.0

Note
- M1: 4. Most lessons name the action and the reason, such as keeping the Survey renders byte-identical unless a ticket is about them because replays compare them, but a few depend on labels the note never defines, such as "arm 3", "arm 4" and "piece 5's re-pin".
- M2: 4. All twelve entries name their file, why they are unscheduled and an owner or blocker, though "Kept as an observation ... no fix is scheduled" gives little reason beyond the observation itself.
- Note mean: 4.0

Where I could not tell: the files the note cites but that were not supplied (lib/prompt-formatters.js, lib/call-budget.js, lib/stage-router.js, lib/code-routes.js, lib/prompts/leftover-words.js, lib/size-of-move.js, lib/periodicals.js, lib/prompts/blind-read-words.js, lib/prompts/autopilot-precedence.js, docs/autopilot-operating-manual.md); whether the tests the note names enforce its one-home rules; whether the stepper variant is in live use; and whether the restated copies in the other repository match this one.
```

Pass A: code mean 3.0 (raw 3.0), note mean 4.0.

### Pass B

```
Code
- K1: 3. File names mostly name their subject, but `lib/openrouter.js` mixes transport, budget, routing, parsing and the tool loop, and the close-out and review rules sit in `GENERATE` in `lib/prompt-template-defs.js` while their stage records live elsewhere. Cite: lib/openrouter.js, lib/prompt-template-defs.js.
- K2: 3. The stage record in `lib/prompts/stage-kinds.js` is a clear single home for stage facts and its leaves are imported, but the close-out finish-line rule is restated in `lib/prompts/autopilot-kickoff.js` and the review and close-out templates each carry their own re-raise and ledger rules. Cite: lib/prompts/stage-kinds.js, lib/prompts/autopilot-kickoff.js.
- K3: 3. Most functions read clearly in place with inline rationale, but the key decisions in `streamChat`, `getRecommendationStream` and the templates depend on `routeStage`, `planCallBudget`, `planRetryBudget` and `CODE_ROUTES`, none of which is in these files. Cite: lib/openrouter.js.
- K4: 3. Names such as `requestChatOnce`, `codeRouteOf` and `isCompleteFinish` say what they do, but one concept goes by "stage selector", "router", "routing call", "recommendation" and "step", and many comments give the why only as ticket numbers. Cite: lib/openrouter.js, lib/prompts/autopilot-kickoff.js.
- Code mean: 3.0

Note
- M1: 4. Most lessons give the action and its reason, such as keeping the prompt size frozen or regenerating the witness fixture, but several rely on unexplained labels ("arm 3", "piece 5", "John's ruling") and a few state a rule without its consequence.
- M2: 4. Each of the twelve Waiting entries names its file, its owner or blocker, and why it is unscheduled, but "Kept" and "moved" are status terms defined only in `docs/areas/README.md`, which was not given.
- Note mean: 4.0

Where I could not tell: the note-format rules in `docs/areas/README.md`, including what "settled", "moved" and "kept" mean; the wording of `routeStage`, `buildRouterPrompt`, `planCallBudget`, `planRetryBudget`, `CODE_ROUTES`, `CONSEQUENCE_TEST` and `DECIDED_BY`, whose files are not in the inputs; the budget test, the witness fixture and the other tests the note cites, so its claims about them are unverified; and the LIN-nnnn tickets, which I could not open, so I read them as labels rather than history.
```

Pass B: code mean 3.0 (raw 3.0), note mean 4.0.

## Area summary

| | Code | Note |
| --- | --: | --: |
| Pass A | 3.0 | 4.0 |
| Pass B | 3.0 | 4.0 |
| **Area** | **3.0** | **4.0** |

- **Noise guard:** the passes' code means differ by 0.0, under 1.0, so the read is decided. The note means differ by 0.0.
- Area code is the mean of the two passes' reported code means, and area note the mean of their reported note means (the kit's combined-score convention, method-as-run addendum section 7).

## Control and contamination

- **Control.** The control (`front-end-pages`) is read at the same base, `49776653d`. Its verdict-4 flag is stated beside the verdict in the comparison file.
- **Open PRs.** Twelve were open at the check. None touches a file in this sample, and none touches the four tracked control files. The check read each PR's file list from `gh pr list`; it did not inspect diffs.
- **Contamination check.** Each counted reader's transcript was parsed for every tool call and checked against its own inputs file, by reading the transcript's structured tool-use records.

  | Pass | Tool calls | Tools used | Paths touched | Inside own inputs? |
  | --- | --: | --- | --- | --- |
  | A | 13 | Read only | the LLM `inputs.md`, 13 reads | yes |
  | B | 12 | Read only | the LLM `inputs.md`, 12 reads | yes |

  - Both passes' first user message is the reader prompt with the inputs line. It names no ticket identifier and no repository path other than the scratchpad path of the inputs file, which the method requires.
  - Neither pass used Grep, Glob, Bash, WebFetch or any other tool. Both are clean.
- **Limit on the check.** The check sees tool calls. It cannot see what the harness loaded into a reader's context before the first call, such as the repository's `CLAUDE.md`. The adoption addendum records this.

## Where the readers could not tell

Both passes name the cited files that the bundle does not hold, so the cited rules, tests and review findings could not be checked. Both also say the note's status words ("settled", "moved", "kept") are defined outside the bundle.
