# Area read: the method as run (LIN-4453, piece 0 addendum)

This file records how the paired baseline was actually run at `4b5001ddf`. It is an addendum, not an edit. The kit ([area-read.md](area-read.md), blob `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`) and the reader prompt ([area-read-reader-prompt.md](area-read-reader-prompt.md), blob `ef1c2ca9173831f53ca32b60da1d805d27bf2159`) are unchanged. The after-read (LIN-4462) repeats everything below identically, so that the delivery departure from the prompt is written down in the repo rather than left implicit.

## 1. The one departure from the prompt text

The reader prompt, as committed, ends its inputs section with:

> **Inputs.** The inputs follow this line, in this order: first the note, then each source file headed by its path.

The bundle is about 210 KB per area, too large to paste into four agent messages. So the operator appended one line after that sentence, filled per area, with nothing else added:

> The inputs are in the file `<ABSOLUTE PATH TO inputs.md>`. Read that file, in full or in chunks, and nothing else.

The two paths used were:

- Runs & dispatch: `<scratchpad>/lin4453-beat2/runs-and-dispatch/inputs.md`
- Front end: server-rendered pages: `<scratchpad>/lin4453-beat2/front-end-pages/inputs.md`

`<scratchpad>` is the session scratchpad, outside the repository tree and outside its git worktree. The `{AREA}` line was filled with `Runs & dispatch` and `Front end: server-rendered pages`, as the kit's report headings name them. Nothing else in the prompt was changed.

## 2. How the inputs bundle was built

Built at `4b5001ddf` from the git object store (`git show 4b5001ddf:<path>`), not from the working tree. For each area:

1. Take the sampled paths from the kit's snippet, run at `4b5001ddf` with N = 14. These are repo-relative paths.
2. Write the area's note first, headed `=== <repo-relative note path> ===`, then its content verbatim.
3. Write each sampled file in path order, headed `=== <repo-relative path> ===`, then its content verbatim.
4. Join the blocks with a single newline and write the result as `inputs.md` in the area's isolated directory.

Resulting bundle sizes: Runs & dispatch, 211,623 bytes; Front end, 213,452 bytes. These are the note plus the 14 sampled files. The note paths are `docs/areas/runs-and-dispatch.md` and `docs/areas/front-end-pages.md`.

Each area's isolated directory held only its own `inputs.md`, and nothing else.

## 3. Reader agents

- Agent type: general-purpose, the default. No model override, so each reader inherited the operator's model.
- Tool access: the default general-purpose toolset, unrestricted. The harness did not restrict readers to read-only access on the inputs directory.
- Launch: the four counted readers were launched in one batch, each a fresh agent with no shared context, and no reader could see another's output.
- Independence: no `SendMessage` or resume was used for any counted reader.

## 4. The five-launched, four-counted episode

Five readers were launched in the batch, not four. Three were Runs & dispatch passes and two were front-end passes. The fifth, a third Runs pass (`a370083c9d6f5e499`), was an operator error. It was stopped before it finished, with `TaskStop`, and its output was not used. Nothing from it reached either report. The four counted passes were:

| Pass | Agent | Area |
|---|---|---|
| Runs A | `ab63d09601c3cc56f` | Runs & dispatch |
| Runs B | `a1ef9b9220c6c912b` | Runs & dispatch |
| Front-end A | `a581ef74887791352` | Front end: server-rendered pages |
| Front-end B | `a29ecc88e5768defa` | Front end: server-rendered pages |

The stray reader's transcript shows two tool calls: a Read of the Runs inputs file and a Bash `grep` of that same file for section headers. Both are inside its own inputs file. Its output is not in either report.

## 5. Contamination check (run after the baseline, before the PR)

Each counted reader's transcript was parsed for every tool call. Every call was checked against that reader's own inputs file.

| Pass | Tool calls | Tools used | Paths touched | Inside own inputs? |
|---|---|---|---|---|
| Runs A | 6 | Read only | the Runs `inputs.md`, 6 reads (one whole, five in ranges) | yes |
| Runs B | 1 | Read only | the Runs `inputs.md`, 1 read (whole) | yes |
| Front-end A | 4 | Read only | the front-end `inputs.md`, 4 reads (one whole, three in ranges) | yes |
| Front-end B | 11 | Read only | the front-end `inputs.md`, 11 reads (one whole, ten in ranges) | yes |

Checks made on every counted reader:

- The first user message is the reader prompt with the inputs line. It mentions no repository path and no ticket identifier.
- No reader used Grep, Glob, Bash, WebFetch or any other tool.
- No reader opened the repository, the other area's inputs, any ticket, comment, report, or another reader's output.

Verdict: **all four counted readers are clean.** Their outputs were not affected by any read outside the inputs.

## 6. Scores as reported (for reference)

Code means are the mean of K1 to K4. Note means are the mean of M1 and M2. Each area's combined value is the mean of its two passes.

| Area | Pass | Code | Note |
|---|---|---|---|
| Runs & dispatch | A | 3.3 | 3.5 |
| Runs & dispatch | B | 3.0 | 3.0 |
| Front end (control) | A | 3.3 | 3.0 |
| Front end (control) | B | 3.5 | 3.0 |

Combined: Runs code 3.15, note 3.25. Control code 3.40, note 3.00. Noise guard (passes differ by 1.0 or more): not fired in either area (gaps 0.3 and 0.2).

## 7. Measurement notes for the after-read

- **Lessons byte counts.** The kit's beat 1 figures, Runs 4,257 bytes and front end 1,012 bytes, came from a local script with a slightly different section boundary. The guard's own function, `lessonsBytes` in `tests/unit/area-notes.test.js`, gives **Runs 4,268 bytes** and **front end 1,023 bytes**, both under the 6,144-byte cap. The guard's figures are the authoritative ones. The kit is frozen, so this correction lives here.
- **Sample overlap.** The Runs sample holds 1 of the 13 planned files (`lib/cost-read.js`). The limit is stated in the kit (Known limits 1). The overlap was settled as an engineering call on LIN-4447 (comment `e6ca12b3-e640-4c51-934e-152b8cbdf047`).
- **Combined-score convention.** An area's combined score is the mean of the two readers' reported one-decimal means (Runs 3.3/3.0 → 3.15; control 3.3/3.5 → 3.40), not recomputed from the individual criteria K1–K4 (which would give 3.125 and 3.375). The after-read uses the same convention.
- **Base-commit file counts.** The code-scope counts are Runs 115 files and front end 92 files. The ticket's 116 counts `lib/runner-kit/contract.json`, which is JSON and outside the code scope.

## 8. Instructions for the after-read (LIN-4462)

The after-read must repeat this method identically:

1. The same kit and the same reader prompt, verified by blob SHA (`cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` and `ef1c2ca9173831f53ca32b60da1d805d27bf2159`) before any reading. If either SHA differs, stop and report.
2. The same delivery: the inputs bundle built as in section 2, one file per area, and the same single added line from section 1, with the inputs path changed to the after-read's own directory.
3. The same agent type, the same batch launch, and the same two passes per area, each a fresh agent.
4. Exactly four counted readers. Launch no extra readers. If a reader is stopped, record it as here, and do not use its output.
5. The same contamination check as section 5, for every counted reader, before the report is written.
6. The sample is re-derived with the kit's snippet at the after-commit, as the kit requires. Compare its paths with the baseline manifest and report the paired subset as a secondary figure.

**Possible improvement, not yet applied.** Restrict reader tools to read-only access on the inputs directory, if the harness allows it. If it is adopted, it must be applied to **both** areas, in the same batch, and recorded here as a change in method. Until then the method stays as written above.
