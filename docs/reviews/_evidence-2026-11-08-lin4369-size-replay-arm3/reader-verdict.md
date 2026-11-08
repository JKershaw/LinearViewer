# Reader verdict: arm 3 replay

Judged from the files in `judge-arm3/` only. A "record" is a run's `description.md`. Criterion 2 is judged in code and is skipped here.

## Criterion 1: The control stays small (LIN-1512: b01, b02, b06)

Test: every LIN-1512 record chooses "just the task", and none names an extra piece of work.

| Run | Size | Extra named? | Words relied on | Verdict |
|---|---|---|---|---|
| b06 | just the task | No | "**Size:** just the task" / "no survey finding is needed for that move to work or to fix what was reported." / "**Cuts:** none" | Pass |
| b02 | just the task | No | "**Size:** just the task" / "Moves the projects page's search control and its panel out of the shared navigation to sit directly under the page title, retiring the earlier rule that put search in the nav; no deeper finding binds on this." | Pass |
| b01 | just the task | No | "**Size:** just the task" / "which delivers the ask in full; no deeper finding binds, so nothing extra rides along." | Pass |

**Borderline note (b02).** "retiring the earlier rule that put search in the nav" could be read as a second piece of work. I ruled that it is not. The earlier rule is the placement the ask overturns: search sits in the nav and the ask says it should not. Retiring that rule is the move itself, not something added to it. The record also says "no deeper finding binds on this".

All three records also cover both the toggle and the panel, so none is smaller than the ask. The criterion does not require that, but it confirms the size is "just the task" and not less.

**Criterion 1: PASS** (3 of 3).

## Criterion 3: No record tells the builder how (LIN-4178, LIN-4252, LIN-4253; 9 records)

Test: no record contains a list of names to sweep, or wording a builder could copy into the code or turn into a comment.

How I drew the line: every record describes what the work delivers, and any such description could in principle be paraphrased into a comment. Read that loosely, every record would fail, so it cannot be what the criterion means. I counted a record as telling the builder how only if it does one of these:
- names code identifiers, files, lines or sites to go through;
- gives code-shaped or docstring-ready text, such as a field name or a rule stated as it would appear in code;
- prescribes an implementation step.

Plain-language statements of scope (what the result does, and which surfaces it covers) pass.

| Run | Ticket | Words relied on | Verdict |
|---|---|---|---|
| b10 | LIN-4178 | "The task, plus first its own piece: the one cost read takes usage and membership from the row shapes production serves (public KPI rows, run-page loops), proven on those shapes, since otherwise the moved figures all read unpriced." | Pass (borderline, see below) |
| b09 | LIN-4178 | "The task, after a first piece making the one cost read accept the row shapes the KPI pages and run page really pass, proven on those shapes; without it, both KPI pages price nothing and every run step reads not reported." | Pass |
| b12 | LIN-4178 | "Moves the KPI pages and run page onto the one cost read, after first making that read accept the row shapes production sends, which it now prices as nothing, proven on those shapes." | Pass |
| b08 | LIN-4252 | "One shared fake DOM both suites run on, modelling every way the page repaints, including whole-slot replacement and markup read back as text; the other copies and fake-only guards in the code don't bind." | Pass (borderline, see below) |
| b11 | LIN-4252 | "One shared fake page that repaints, compares and reads back markup the way the opened task's code really does, carrying both suites with names and counts unchanged; no finding needs its own piece done first." | Pass |
| b07 | LIN-4252 | "One shared fake page that repaints, keeps or replaces nodes, and reads markup back as written, used by both suites; every gap the Surveys found binds inside that fake, and nothing outside it is needed." | Pass |
| b04 | LIN-4253 | "Each stage declares on its template whether it is offered and whether it runs under the read-only dispatch mandate, every reader uses that, and nothing changes in prompts." | Pass (borderline, see below) |
| b05 | LIN-4253 | "Declares each stage's two traits, offered as a next step and read-only, once on its template with no change to what any stage is told" | Pass |
| b03 | LIN-4253 | "offered and read-only each declared once on the stage, all four readers following it, prompts unchanged; unifying the other meanings of read-only would change what stages are told, which is LIN-4251's work." | Pass |

**Borderline calls**

- **b10, "(public KPI rows, run-page loops)".** This is a two-item list in parentheses, so I checked it against "a list of names to sweep". I ruled that it is not one. It names, in plain words, the two kinds of input the extra piece must accept. That is the boundary of the piece. It gives no identifiers (`usageEntry`, `_loopRecord`, `cost-read.js:66`), files or call sites to go through. Those appear only in b10's `comment.md`.
- **b08, "including whole-slot replacement and markup read back as text".** These are the two capabilities the comment spells out as an `outerHTML` setter and an `innerHTML` getter. The record keeps them as plain descriptions of behaviour the fake must support, which is scope ("what a repaint needs", in the ask's words). It does not name the API members or say how to build them. A builder would still have to work out what to write. Pass.
- **b04, "whether it runs under the read-only dispatch mandate".** This is the closest call. It narrows the ask's "whether it is read-only" to one specific meaning, and its comment says the trait's docstring should state that meaning. So the phrase could plausibly be reworded into a docstring. I ruled pass because the phrase defines which trait is being declared, a scope decision that keeps "just the task" honest given the Surveys' finding of four meanings. It gives no identifier, field name or docstring text, and no step. If a stricter reader holds that any definitional phrase a builder could put in a docstring counts, b04 is the one record that would flip, and with it the criterion.

No record contains file paths, identifiers, line numbers, code-formatted text or an enumerated sweep.

**Criterion 3: PASS** (0 of 9 records tell the builder how, with b04 the closest call).

## Criterion 4: Every size that cuts the ask raises a `DECISION:` (all 12 records)

Test: a record triggers if its size is smaller than the ask, or is "wrong work", or it names a cut to `## As asked`. Each such record's `final.md` must carry a `DECISION:` line.

| Run | Ticket | Size | Cuts field | Triggers? | Verdict |
|---|---|---|---|---|---|
| b01 | LIN-1512 | just the task | "**Cuts:** none" | No | Pass (not applicable) |
| b02 | LIN-1512 | just the task | "**Cuts:** none" | No | Pass (not applicable) |
| b06 | LIN-1512 | just the task | "**Cuts:** none" | No | Pass (not applicable) |
| b09 | LIN-4178 | consolidate the decision this task touches | "**Cuts:** none" | No (larger than the ask) | Pass (not applicable) |
| b10 | LIN-4178 | consolidate the decision this task touches | "**Cuts:** none" | No (larger than the ask) | Pass (not applicable) |
| b12 | LIN-4178 | a small tidy | "**Cuts:** none" | No (larger than the ask) | Pass (not applicable) |
| b07 | LIN-4252 | just the task | "**Cuts:** none" | No | Pass (not applicable) |
| b08 | LIN-4252 | just the task | "**Cuts:** none" | No | Pass (not applicable) |
| b11 | LIN-4252 | just the task | "**Cuts:** none" | No | Pass (not applicable) |
| b03 | LIN-4253 | just the task | "**Cuts:** none" | No | Pass (not applicable) |
| b04 | LIN-4253 | just the task | "**Cuts:** none" | No | Pass (not applicable) |
| b05 | LIN-4253 | just the task | "**Cuts:** none" | No | Pass (not applicable) |

No `final.md` contains a `DECISION:` line, and none needed one. None of the records triggers the criterion.

**Checks behind "no trigger"**
- **"A small tidy" is larger than "just the task".** b12 says so itself in its comment: "The policy tips the size from 'just the task' to a tidy named as its own piece." Its Why also adds a first piece on top of the move.
- **LIN-1512.** Triage recommended moving only the panel. All three runs rejected that because it would cut the ask (b01: "That would leave 'search' above the nav, so it would be a cut, and this size does not take it."). Their records deliver both the toggle and the panel.
- **LIN-4253, things left out.** b03's Why leaves out "unifying the other meanings of read-only". b04 and b05 leave the follow-up and feedback entry paths as they are. Neither is a cut. The ask itself rules out "changing what any stage is told" and requires prompts to be "byte-identical on every entry path", so leaving these alone is what delivers the ask.
- **LIN-4252.** b08's "the other copies and fake-only guards in the code don't bind" refers to the other `makeContainer` suites. The ask names those as "Not this ticket: ... moving other client tests onto it". The "second copy gone" item in Done when is kept by all three records ("both suites run on", "used by both suites").
- **LIN-4178.** The open note-1 decision is not a cut: the ask assigns it to the builder ("decide whether it applies and name the choice either way").

**Criterion 4: PASS** (no record triggers it, so none lacks a `DECISION:`).

## Recorded, not scored: do `comment.md` or `final.md` tell the builder how?

Yes. Almost every run's `comment.md` does, and several `final.md` files do as well, in exactly the sense criterion 3 uses. The how-to sits in the comments, not in the records. It does not change any verdict above.

**LIN-1512 (control, for reference)**
- b01 `comment.md`: "Gate the moved markup on `!isLanding`." / "Repin the LIN-1149 tests to the new rule, 'search is never in `.nav-actions`, and appears only on projects'. Those tests are in `header-nav.spec.js` ~L229-264 and `search.spec.js` L183."
- b02 `comment.md`: "`llms.txt` lines 99-100 and 393, the `.search-panel` CSS comment, and the navbar LIN-1149 comment and JSDoc" / "Don't delete these tests; repin them."
- b06 `comment.md`: "rewriting the LIN-1149 placement tests to the new rule ('search is never in `.nav-actions`')"
- b01, b02 and b06 `final.md`: each gives a shorter sweep list, e.g. b06: "update `llms.txt`, the CSS comment and the navbar comments."

**LIN-4178**
- b10 `comment.md`: "the replay feeds S11/S12 through an `aggregate`-backed fake that runs the real projection and feeds S13 from loops built by `pipeline-loops`" / "The zero comes from `|| 0` at `workspace-kpi-stats.js:98`" / "Keep today's rule, and add a corpus case so W9 would catch a drift." `final.md`: "`lib/cost-read.js:66,138` reads usage from `member.feedback` only."
- b09 `comment.md`: "`missingCanChangeFigure` (`:71`) and the duration merge (`:193`) also read `feedback`" / "the component union, T, the anchored identifiers and the per-ticket flags. Name those movements under (b)". `final.md`: "S12's all-unpriced day reads `$0.00` because the data writes 0 (`lib/workspace-kpi-stats.js:98`)".
- b12 `comment.md`: "The fix belongs in the read, not in a KPI adapter that fakes `feedback`" / "S11's ticket set T, the component union, `anchoredIdentifiers`, the attributable share and the per-issue harness and evidence flags" / "Add a corpus case for a lineage with members on both sides of `activityStart`." `final.md`: "Keep the join of outcome facts in one place once the old join function is deleted."

**LIN-4252**
- b08 `comment.md`: "`slot.outerHTML =` repaints at lines 1095, 1120, 1149, 1997 and 2009." / "The test must sit flat in `tests/unit/`, or the runner's glob skips it."
- b11 `comment.md`: "**An `outerHTML` setter.**" / "**`parentElement`, `.type`, and `setSelectionRange` on inputs.**" / "The new fake's header should say it's the one to use for new client tests". `final.md`: "The new fake's header should say it's the one to use for new client tests."
- b07 `comment.md`: "the fake needs ordered text nodes: lin-4242's single `_text` per node can't be serialized faithfully" / "the new file's header should say it is the fake to use for repaint claims and should name that shim". `final.md`: "The new file's header should name it".

**LIN-4253**
- b03 `comment.md`: "'Offered' is a deletion, not a new field: derive it from the template's `route`." / "So the caller has to resolve the trait."
- b04 `comment.md`: "The docstring should say how it differs from the prompt-body helpers." / "Either the caller resolves the trait or a small traits lookup sits between them." `final.md`: "name and document the trait for what it actually controls: the wording the dispatch preamble gives the stage."
- b05 `final.md` (no comment file): "`lib/proxy-instructions.js:849` names the two Surveys as 'never recommended'... replacing it can't change the instruction bytes" / "Tests: they need one pinned expected list".

Final messages that mostly stay at size level: b03 and b08 `final.md` carry little or no how-to.

## Verdicts

Criterion 1: PASS
Criterion 3: PASS
Criterion 4: PASS
