# Fresh reader verdict: arm 4 replay (criteria 1, 3, 4, and the check 5 report)

I read only the files in `judge-arm4/`: `criteria.md`, `run-map.tsv`, `tickets/` (all five) and `runs/d01`–`d12`. A "record" is the run's `description.md`. I did not judge criterion 2 or check 5, which are scored by code. No run folder has a `comment.md` (`ls runs/*/comment.md` finds nothing). No `final.md` has a `DECISION:` line (`grep -rn DECISION runs/` finds nothing).

Run map: LIN-1512 = d11, d05, d12. LIN-4178 = d07, d09, d01. LIN-4252 = d02, d10, d03. LIN-4253 = d06, d04, d08.

---

## Criterion 1: the control stays small

> All 3 LIN-1512 records choose "just the task", with no extra piece of work named. 3 of 3.

| Run | Verdict | Words relied on |
|---|---|---|
| d05 | Pass | "**Size:** just the task" / "delivering the ask in full; no Survey finding binds on this, so the standing policy adds nothing." / "**Cuts:** none" |
| d11 | Pass (borderline, see below) | "**Size:** just the task" / "no survey finding binds, as the move works without a shared page-controls slot or moving the team filter." / "**Cuts:** none" |
| d12 | Pass | "**Size:** just the task" / "no survey finding binds a larger move, so the standing policy has nothing to weigh." / "**Cuts:** none" |

**Borderline (d11):** d11's record mentions two nearby pieces, "a shared page-controls slot" and "moving the team filter". It mentions them only to say the move does not need them ("the move works without ..."). I read "with no extra piece of work named" as meaning that the chosen size names no extra piece to be done alongside the task. d11 names these pieces as excluded, not as part of the move, so it still picks the task alone. I ruled it a pass. A stricter reading, where any mention of another piece counts, would fail d11 and so fail the criterion.

**Criterion 1 overall: PASS** (3 of 3 choose "just the task", and none adds an extra piece to the move).

---

## Criterion 3: no record tells the builder how

> The fresh reader finds, in no record, a list of names to sweep, or wording a builder could copy into the code or turn into a comment. One such record fails the criterion.

**How I applied the test.** Read literally, almost any sentence could be "turned into a comment", and then no record could ever pass. So I looked for two things:
- a list of identifiers, files, call sites or stage names for the builder to go through;
- wording specific to the implementation that a builder would copy as it stands: code-shaped text, a test rule in quotes, a docstring sentence, or a mechanism the ask does not already state.

A plain restatement of what the ask delivers, in the ask's own terms, does not fail the test.

| Run | Ticket | Verdict | Words relied on |
|---|---|---|---|
| d01 | 4178 | Pass | "The task plus a first tidy in which the one read accepts the row shape the KPI pages actually load and its replay runs on production-shaped rows and loops; otherwise the moved figures price nothing live while tests pass." It has no identifiers, files or functions. It says what the extra piece makes true, not how to code it. |
| d07 | 4178 | Pass (borderline) | "The task, after the cost read and its replay accept the row shapes production feeds them (public projection, run-page loops); wired as-is, live public and workspace costs price nothing and every run figure withholds, unseen by tests." |
| d09 | 4178 | Pass | "First, the one cost read and its replay accept the row shapes the KPI pages and run page actually pass, which the read misses today; then the task, else live figures read unpriced while tests pass." "KPI pages and run page" are the surfaces the ask already names. |
| d02 | 4252 | Pass (borderline) | "One shared fake page that parses, serializes and repaints, carrying both suites with the second fake gone; the Surveys' gaps fall inside what a repaint needs, and nothing nearby binds on this task." |
| d10 | 4252 | Pass (borderline) | "One shared fake DOM, round-tripping markup and repainting, carries both suites so a unit test can witness what a repaint keeps; no Survey finding binds beyond that, so the other copies and fake-shaped production guards wait." |
| d03 | 4252 | Pass (borderline) | "One shared fake DOM that parses, serializes and repaints the way the opened task's code really does, carrying both suites with the second fake gone; no Survey finding binds beyond that, so the wider consolidation stays out." |
| d06 | 4253 | Pass | "Declares each stage's offered and read-only traits once on its template, with every current reader using that declaration and prompts unchanged". This restates the ask's Goal and "This step". |
| d04 | 4253 | Pass | "Each stage's offered and read-only traits are declared once on its template, and every reader and test reads them with no prompt changing". This restates the ask. |
| d08 | 4253 | Pass | "Moves the offered and read-only traits onto each template and deletes both name lists, byte-identical; no Survey finding binds, since the other read-only meanings and per-kind tables are nearby". "Both name lists" refers to the lists without naming them (no `EXCLUDED_FROM_AI_RECOMMENDATION` / `SURVEY_KINDS`), and the ask itself says the lists are "derived from them or deleted". |

**Borderline calls, and why I ruled them passes:**

- **d07, "(public projection, run-page loops)".** This is the closest any record comes to a list for the builder to sweep. It names two sources of row shapes. I ruled it a pass because they are plain-English descriptions of the two kinds of input the piece must handle, not identifiers, files or call sites. They set the scope of the extra piece, which the record must name, rather than showing how to build it. d01 and d09 say the same thing ("KPI pages", "run page") without the parenthesis.
- **d02 / d03, "parses, serializes and repaints"; d10, "round-tripping markup and repainting".** These go a little beyond the ask's own list ("node identity, `replaceWith` and `innerHTML`, an input's value, focus and `document.activeElement`"). They encode a Survey finding: the fake's `innerHTML` must give real markup back. A builder could put "a shared fake DOM that parses, serializes and repaints" at the top of the helper file as a header comment. I ruled them passes because they state what the fake must be able to do, at the level of the ask's own Goal ("good enough to repaint a page"). They name no identifier, file, selector form or line, and none of the code-level detail the finals carry (`outerHTML` sites, `:scope >` selectors, `tests/helpers/fake-dom.js`). If "could be turned into a comment" is meant to cover any one-line summary of a capability, these three records fail, and the criterion fails with them.

**Criterion 3 overall: PASS** (0 of 9 records carry a list of names to sweep, or wording a builder could copy into the code or turn into a comment; d07, d02, d03 and d10 are borderline for the reasons above).

---

## Criterion 4: every size that cuts the ask raises a `DECISION:`

> For every record whose chosen size is smaller than the ask or "wrong work", or that names a cut to the `## As asked` block, the run's final message carries a `DECISION:` line. Any record without one fails the criterion.

To find where the criterion applies, I checked each record's size and cuts:

| Run | Size | Cuts | Smaller than the ask / wrong work / names a cut? | `DECISION:` needed? |
|---|---|---|---|---|
| d01 | "a small tidy" | "none" | No. The size is larger: "The task plus a first tidy". | No |
| d07 | "a small tidy" | "none" | No. The size is larger: "The task, after the cost read and its replay accept ..." | No |
| d09 | "a small tidy" | "none" | No. The size is larger: "First, ... ; then the task". | No |
| d02, d03, d10 | "just the task" | "none" | No | No |
| d04, d06, d08 | "just the task" | "none" | No | No |
| d05, d11, d12 | "just the task" | "none" | No | No |

No record picks a size smaller than the ask or "wrong work", and none names a cut to `## As asked`. Every record reads "**Cuts:** none". The criterion therefore applies to no run. No `final.md` has a `DECISION:` line, and none needs one.

One point I checked: d08 says "deletes both name lists", while the ask allows "derived from them or deleted". That picks one of the two options the ask offers, and it drops nothing the ask requires, so I did not count it as a cut. d11's final says "No cuts, with one condition". The condition is that the toggle, not just the panel, must move. That is a reason against cutting, and d11's record says "Cuts: none".

**Criterion 4 overall: PASS** (it applies to no record, so no record lacks a `DECISION:`).

---

## Check 5 report: criterion 3's test applied to final messages and comments (recorded, not scored)

**Comments.** No run wrote a `comment.md`, so no comment had the test applied. Several finals say so, for example d04: "There is no `comment.md`, because the prompt says to post no comment."

**Final messages.** All 12 `final.md` files fail criterion 3's test, usually many times over. Each has a section addressed to the builder ("Notes for implementation", "For the builder", "Engineering choices", "Risks for the build stage"). These sections carry lists of names to sweep and wording a builder could copy into code, tests or comments. Examples:

- **d05 (1512):** a list of names: "Keep `#search-input`, `#search-clear`, `#search-no-results` and `[data-search-text]` unchanged." A test rule ready to copy: "rewriting the LIN-1149 tests to the new rule, "search is never in `.nav-actions`"".
- **d11 (1512):** a test rule ready to copy: "to the new rule ("search is never in the nav actions, and only appears on projects")". A sweep list: "Update the stale text in llms.txt (lines 99–100 and 393) and the comments in style.css and navbar.js."
- **d12 (1512):** a sweep list: "`llms.txt` L99-100 and L393, the comment in `style.css` (~L951), and the navbar JSDoc". Code: "a `!isLanding` guard".
- **d01 (4178):** mechanism and lines: "`perDay` uses `|| 0` (lib/workspace-kpi-stats.js:98)", "`fmtUsd` returns null for any amount of zero or less (lib/render-run-steps.js:270)".
- **d07 (4178):** how to build it: "The raw-collection founder lookup should reuse the query in `lineageIdentityRows` (`dispatch-store.js:1935`)". A sweep list: "the public `/kpis` issue set, the component union, `anchoredIdentifiers` and the attributable share".
- **d09 (4178):** how to build it: "an `aggregate`-backed fake, and loops built by `pipeline-loops`". Builder notes cite `lib/workspace-kpi-stats.js:98`, `public/workspace-kpis.js:127-130`, `lib/render-run-steps.js:270` and `tests/unit/run-view.test.js:367`.
- **d02 (4252):** where to put things: "Following the precedent of `tests/helpers/css-rules.js` with `tests/unit/css-rules-helper.test.js`". It also names a regex: "a bare `data-question-slot>`".
- **d03 (4252):** paths ready to copy: "Put the fake at `tests/helpers/fake-dom.js` and its own tests at `tests/unit/fake-dom-helper.test.js`." It lists the `outerHTML` sites "(1095, 1120, 1149, 1997, 2009)".
- **d10 (4252):** "Engineering choice: `tests/helpers/fake-dom.js`, with its own test at `tests/unit/fake-dom-helper.test.js`." A sweep list: "`keepTypedQuestion`, `paintRun`'s outerHTML path, focus restore, `paintFoldCount`".
- **d04 (4253):** design ready to copy: "make `route` required, with null meaning hand-only, and add a test." A docstring topic: "Its docstring should say how it differs from the prompt-body workflow helpers."
- **d06 (4253):** a sweep: "Update the docstrings in `action-kind.js` and the template defs." Layering advice: "Either the caller resolves the trait or a small traits lookup sits between them."
- **d08 (4253):** comments to rewrite, named: "Update two stale comments: the header of `lib/action-kind.js` and the docstring in `lib/prompt-template-defs.js` that says "No route: never offered (retro)"". Design: "make `route` required, with null meaning hand-only".

In short, the records are clean, but the "how" each run worked out went into its final message instead. Final messages are not posted on the ticket, so this does not affect any score. It shows that the builder guidance was produced every time and was kept out of the record, not left out altogether.

---

Criterion 1: PASS
Criterion 3: PASS
Criterion 4: PASS
