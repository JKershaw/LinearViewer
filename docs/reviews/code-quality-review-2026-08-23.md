# Code Quality Review — 2026-08-23 (periodical run, LIN-354 family)

> **Provenance note (LIN-694).** This report was persisted retroactively on 2026-08-23. The
> review itself ran the same day, under session `voyage-advisory-reviews-2026-08-23`, but a
> conflicting operator instruction ("do NOT edit, create, or delete any file in either repo")
> prevented the file from being written at the time — the review instead posted its full
> report as a Linear comment on **LIN-1920**, exactly as its own text below anticipated
> ("A future lane can commit this comment verbatim"). This file is that verbatim commit.
> Nothing below has been re-derived, re-judged, or edited for content.

*Review-only: no code, config or secrets changed. Severity-ranked complexity / duplication / maintainability findings, weighted by risk × churn, grounded against source at HEAD.*

**Session** `voyage-advisory-reviews-2026-08-23`. **HEAD** `LinearViewer` @ `0e8a1461` (= `origin/main`, 2026-08-23 17:42 BST). HEAD moved during the run — sibling lanes landed `#1211`–`#1214`; all figures are at that SHA.

**Report artefact — the one thing this run did not do.** The series convention is `docs/reviews/code-quality-review-<date>.md`, landed via feature branch + PR with `ci-success` green. This session ran under a **hard no-file-write / no-PR constraint** (six sibling lanes through this repo today, two live in it now), so the report is **this comment, in full**. That is the same failure mode §1 of this ticket exists to stop — a review whose artefact never merges is invisible to the next run — so it is named explicitly rather than glossed: **unrun step = landing `docs/reviews/code-quality-review-2026-08-23.md`.** A future lane can commit this comment verbatim. Everything else in the ticket's definition of done is complete.

---

## 0. Prior runs — what happened to them

| run | report | status at HEAD |
|---|---|---|
| **2026-06-25** (LIN-667) | `docs/reviews/code-quality-review-2026-06-25.md` | committed, read in full (F1–F5, N1/N2) |
| **2026-07-11** (LIN-1232) | `docs/reviews/code-quality-review-2026-07-11.md` | **confirmed lost** |
| **2026-08-23** (this run) | — | comment-only, see above |

**LIN-1232's report is genuinely lost, and I checked origin before saying so.** `git log --all --diff-filter=A -- docs/reviews/code-quality-review-2026-07-11.md` is empty on every ref this clone holds, and a live `git ls-remote --heads origin` returns exactly two matching heads — `feat/lin-667-code-quality-review` and `feat/lin-567-design-quality-finding-classes`. **No branch, no PR, no ref carries it.** Its only surviving record is the LIN-1232 comment of 2026-07-11, which I read in full and build on below.

Two runs in a row have now failed to land an artefact, for two different reasons. That is a pattern rather than an accident, and it is the single highest-leverage thing a human could fix about this periodical.

---

## 1. Risk × churn at HEAD — re-measured, not trusted

`wc -l` + `git log --since=90.days --oneline -- <file>`. Ranked by lines × commits.

| file | lines | 90d commits | risk×churn |
|---|---|---|---|
| **routes/proxy.js** | **7,098** | 174 | **1,235** |
| **server.js** | **3,756** | 174 | **653** |
| **routes/workspace-api.js** | **4,388** | 96 | **421** |
| public/style.css | 4,340 | 68 | 295 |
| lib/dispatch-store.js | 2,082 | 56 | 116 |
| routes/dashboard.js | 2,042 | 49 | 100 |
| public/common.js | 2,114 | 45 | 95 |
| public/app.js | 2,271 | 36 | 81 |
| lib/providers/linear/index.js | 2,308 | 33 | 76 |
| routes/test.js | 1,380 | 53 | 73 |
| lib/render-settings.js | 1,232 | 52 | 64 |
| public/swim.js | 2,975 | 13 | 38 |

**The ticket's leads were low, and the trend is the finding.** Growth is not merely continuing — its *rate* is accelerating, and the last 15 days are the steepest interval ever measured on all three hotspots:

| file | 06-25 | 07-11 | 08-08 | **08-23** | lines/day 06→07 | 07→08 | **08-08→08-23** |
|---|---|---|---|---|---|---|---|
| `routes/proxy.js` | 4,496 | 5,265 | 6,227 | **7,098** | 48 | 34 | **58** |
| `server.js` | 2,088 | 2,542 | 3,087 | **3,756** | 28 | 19 | **45** |
| `routes/workspace-api.js` | 3,019 | 3,319 | 3,629 | **4,388** | 19 | 11 | **51** |

`routes/workspace-api.js` grew **4.6× faster** in the last 15 days than in the preceding four weeks. Every prior run has reported these files getting bigger; none has reported them getting bigger *faster*. Three runs of "still real, worsened" have produced no decomposition, and the debt is now compounding.

---

# Findings, severity-ranked

## F1 · **HIGH** — `routes/proxy.js` is 7,098 lines, and 678 of them are a documentation blob one `sed` could move

**What.** `routes/proxy.js` is the repo's #1 risk×churn surface by nearly 2× (1,235 vs 653). It holds **55 endpoint registrations** in a single `createProxyRoutes` closure. LIN-679 ("split by endpoint group") has tracked this since June across three runs and remains **Backlog, not actioned**. Re-verified: still real, still worsened, **not duplicated**.

**The new part, and the reason this is actionable rather than another "still real" line.** The single largest handler in the file is not a handler at all:

```
routes/proxy.js:1690   router.get('/api/proxy/instructions', …)   678 lines
```

It is the API catalog — pure documentation prose in template literals, a pure function of `baseUrl` and `req.proxyTokenScope`. It has grown **404 → 463 → 560 → 678 lines** across the exact review intervals of this series (2026-06-26 / 07-11 / 08-08 / HEAD), **+68% overall and +118 lines in the last 15 days alone**. It is now **9.5% of the file** and, by itself, roughly one seventh of the file's growth since June. The next four handlers combined (454 + 307 + 299 + 271) are smaller than it.

**Why it matters.** Every one of the 174 commits that touched this file in 90 days paid the cost of loading a 7,098-line module whose largest single member is prose. It makes the file's real complexity unreadable — a reviewer scanning for the dispatch logic scrolls past 678 lines of Markdown — and it inflates the diff surface of the one file the whole agent fleet depends on. It is also the cheapest possible first slice of LIN-679: unlike an endpoint-group split, it moves **no logic and changes no route behaviour**, so it carries none of the risk that has kept LIN-679 parked for three runs.

**What I would do.** Move the catalog to `lib/proxy-instructions.js` exporting `buildInstructions({ baseUrl, scope })`; the handler becomes ~6 lines. `routes/proxy.js` drops to ~6,420 with zero behavioural change and one snapshot test on the returned string. **Minted: see §5.**

**Confidence: verified at HEAD.** `routes/proxy.js:1690`; growth measured with `git show <rev>:routes/proxy.js`.

---

## F2 · **HIGH** — `routes/workspace-api.js` is the fastest-growing mega-module in the repo and **nothing tracks it**

**What.** 4,388 lines, 96 commits/90d, risk×churn #3. **36 endpoints across 14 URL groups plus 24 helper functions**, all inside one `createWorkspaceApiRoutes` closure. The roadmap group alone is 7 endpoints.

**Why it matters — and why this is the finding rather than "another big file".** There is a follow-up ticket for `routes/proxy.js` (LIN-679) and one for `server.js` (LIN-1249). **There is none for `routes/workspace-api.js`.** I searched the board specifically for one before writing this. It is the only member of the top-three risk×churn set that is completely untracked, and it is now the fastest-growing file in the repo (+51 lines/day over the last 15 days, against 11/day for the preceding four weeks). Every prior run recorded it in a table and moved on; three runs later it has gained 1,369 lines and still has no owner. Untracked debt on a top-three churn surface is how `routes/proxy.js` reached 7,098.

**What I would do.** Same treatment as LIN-679, and the seams are already visible in the URL prefixes: split `roadmap` (7 endpoints, plus the orientation/`isRoadmapTestMode`/`emitMockLayer` SSE machinery — the largest and most self-contained group), then `prompts` + `prompt-traces` (5), then `recap`/`brief`/`recommend` (7, which is also where LIN-680's shared helper belongs). The 24 in-closure helpers are the real obstacle and should move with their groups. **Minted: see §5.**

**Confidence: verified at HEAD.**

---

## F3 · MED-HIGH — 175 byte-identical lines across two 375-line functions in `public/swim.js`, and the prior run's "healthy" calibration was measuring a different file

**What.** `public/swim.js` holds two functions of the same length and near-identical name:

```
public/swim.js:1659   drawBlockingConnectors           375 lines
public/swim.js:2045   drawBlockingConnectorsVertical   375 lines
```

Compared on significant lines (comments and blanks stripped): **71% similar over 298 lines each, with 175 lines byte-identical across 9 contiguous runs** — including a 76-line `blockedByMap.forEach` traversal (`:1681` == `:2067`) and a 20-line SVG-container setup block (`:1660` == `:2046`).

**Correcting the prior calibration, with evidence.** LIN-1232 recorded: *"calibration: `public/swim.js` healthy despite being the largest client file (low churn, pure logic **unit-tested**)."* The low-churn half holds (13 commits/90d). The unit-tested half does not, and the error is specific: the swim unit tests are `tests/unit/swim-graph.test.js` and `tests/unit/swim-lanes.test.js`, and both import from **`lib/swim-graph.js`** — the server-side model — not from `public/swim.js`. `grep -rn drawBlockingConnectors tests/` returns **nothing**. The 750 lines in question have no test reference anywhere in the tree.

**Why it matters.** 175 duplicated lines is where a fix lands in one orientation and not the other — the exact class of bug LIN-1226 already filed once against this view (a stale `calc()` chrome constant in the vertical container). Because nothing tests either function, that divergence is invisible until someone looks at the screen in the right orientation.

**What I would do.** Extract the shared half — container setup, the `blockedByMap` traversal, and the `<path>` construction — into one function taking an orientation-projection (`{ x1, y1, x2, y2 }` per edge). ~175 lines removed. **Not minted** — real but lower consequence than F1/F2, low churn, and the cap is 3. Recorded here with enough evidence to execute directly.

**Confidence: verified at HEAD.**

---

## F4 · MED-HIGH — four hand-rolled Markdown typography blocks, and the drift between them is measurable

**What.** CLAUDE.md's own prose admission (`CLAUDE.md:212`) names this and says *"the real fix is a shared `.markdown-body` layer … which is its own task."* Re-measured at HEAD, per element actually styled:

| element | `.desc-full-content`<br>`style.css:1497` | `.comment-body`<br>`style.css:1658` | `.swipe-accordion-body`<br>`swipe.css:421` | `.task-edit-preview`<br>`task-edit.css:191` |
|---|:--:|:--:|:--:|:--:|
| `p` | ✓ | ✓ | ✓ | ✓ |
| `ul` / `ol` | ✓ | — | ✓ | ✓ |
| `li` | ✓ | — | — | ✓ |
| `code` | ✓ | ✓ | ✓ | ✓ |
| `pre` / `pre code` | ✓ | — | ✓ | ✓ |
| `blockquote` | ✓ | — | — | ✓ |
| `a` | ✓ | ✓ | — | ✓ |
| `img` | *(via `.issue-description img`, `style.css:1553`)* | — | ✓ | ✓ |

**This is duplication with demonstrated drift, so it clears the "deliberate duplication is not a finding" bar this ticket sets.** The same Markdown renders through the same `window.renderMarkdown` (`public/common.js:399`) into four differently-styled containers. Concretely: a comment containing a bulleted list or a fenced code block renders at **raw browser defaults** — `.comment-body` styles `p`, `code` and `a` only. `.swipe-accordion-body` drops `blockquote`, `li` and `a`. The most complete block is `.task-edit-preview`, which is a **preview pane** — so the preview renders its input more faithfully than the surface it is previewing for. That inversion is not new: it is the LIN-1575 review's own blocking finding, still live at HEAD.

**What I would do.** Nothing new — **LIN-1622 already exists** ("Extract a shared `.markdown-body` typography layer for rendered Markdown surfaces", Backlog). **Not minted; the drift table above is posted to LIN-1622** so the ticket carries measured evidence rather than a description. Companion: LIN-1621 (image relay across Markdown paths).

**Confidence: verified at HEAD.**

---

## F5 · MED — the landing's dark palette claims to mirror `.theme-dark` and mirrors 39 of 42 tokens, with nothing asserting it

**What.** The app themes via a `.theme-dark` class hook (`public/style.css:217-271`, 42 tokens). The landing page instead re-declares the whole vocabulary under `@media (prefers-color-scheme: dark) body.is-landing` (`public/style.css:2136-2183`, 39 tokens). The comment above it (`:2125-2134`) states it *"Mirrors the **FULL** `.theme-dark` vocabulary — raw tokens, the LIN-785 semantic layer … and the status palette"* and warns that these aliases *"MUST be re-declared at this scope"* or they inherit their light computed value.

**The comment is already false.** Three tokens are in `.theme-dark` and absent from the landing block: **`--accent`, `--ok`, `--red-hover`**. Value drift: none — every one of the 39 shared tokens matches exactly.

**Why it matters, stated at its true grade.** **No visible defect today** — I checked: neither `public/landing.css` nor `lib/render-landing.js` uses any of the three (`grep -c` = 0 for each). This is a live trap, not a live bug: the moment a landing rule adopts `var(--accent)`, `var(--ok)` or `var(--red-hover)` it renders at its **light** value on a dark landing, and the file's own comment tells the next author the mirror is complete, so they will not check. Nothing guards it — `tests/unit/theme.test.js` already reads `public/style.css` and already has a `ruleBody(css, selector)` helper, and asserts the semantic/status layers exist in both themes, but never compares the two token *sets*.

**What I would do.** One assertion in the file that already has the machinery:

```js
assert.deepEqual(
  tokenNames(ruleBody(STYLE_CSS, '.theme-dark')).sort(),
  tokenNames(ruleBody(STYLE_CSS, 'body.is-landing')).sort()
);
```

It fails today, naming the three tokens, and converts a comment into an enforced invariant. **Minted: see §5.** *(Stylesheet structure is explicitly deferred to this review by Design & Interface; the rendered result is theirs and is not re-flagged here.)*

**Confidence: verified at HEAD.**

---

## 2. Prior follow-ups — status at HEAD. **No duplicates minted.**

| ticket | finding | state | verdict at HEAD |
|---|---|---|---|
| **LIN-679** | split `routes/proxy.js` | Backlog | **Still real, worsened.** 4,497 → 5,265 → 6,227 → **7,098**; 55 endpoints; #1 risk×churn. Kept. F1 minted as its cheapest first slice and cross-linked, *not* as a rival. |
| **LIN-680** | shared `cacheBackedGenerate` for recap/brief | Backlog | **Still real.** No such helper exists anywhere in the tree. The two GET handlers in `routes/proxy.js` (`:4888` recap, `:5179` brief) are **73% similar over 131 significant lines each**; `routes/workspace-api.js` carries 4 more orchestration sites. Kept. |
| **LIN-681** | roadmap test-mode mock arm + baselines | Backlog | **RESOLVED at HEAD — recommend closing, as LIN-1232 did.** The `test-token → testMockData` arm is present at **`server.js:2676`** (`const isTestMode = process.env.NODE_ENV === 'test' && workspace.accessToken === 'test-token'`), feeding both the projects fetch and the LIN-2025 team resolution, with a comment recording that LIN-409 removed it and it was restored *because* the roadmap baseline had silently captured the landing page. Two runs have now recommended closing it and it is still open. |
| **LIN-1249** | decompose `server.js` | Backlog | **Still real, worsened.** 2,088 → 2,542 → 3,087 → **3,756**; 174 commits/90d; risk×churn #2. Kept. |
| **LIN-1250** | shared OpenRouter request/finish helpers | Backlog | **Still real, and I measured it rather than repeating it.** `getRecommendationStream` (`lib/openrouter.js:947`, 216 lines) vs `streamChat` (`:1181`, 164 lines) are **48% similar**; `streamChat` vs `streamChatWithTools` (`:1506`) only **18%** — so the duplication is narrower than the original F2 prose implies, concentrated in the recommendation/chat pair rather than spread "3–5×". Kept, at a slightly lower weight than recorded. |
| **LIN-1251** | extract pure sub-steps from `lib/providers/linear/index.js` context-fetch | Backlog | **Still real.** File 2,308 lines, 33 commits/90d; `fetchIssueContext` still at `:821` on the universal data path. Kept, unchanged. |

---

## 3. Recorded but not promoted — re-weighed at HEAD, not re-derived

- **`lib/dispatch-store.js` outgrowing the `lib/*-store.js` family (N2) — worsened materially, still not promoted.** File 2,082 lines / 56 commits (risk×churn #5). LIN-1232 recorded `addFeedback` 157 / `addItem` 131. At HEAD: **`addFeedback` 243 lines (`:1669`, +55%)**, **`addItem` 157 (`:254`, +20%)**. The growth is real and the direction is wrong. Held back only because the cap is 3 and F1/F2 outrank it on churn; **if a fourth ticket were minted, this is the one.**
- **`public/app.js` monolithic `init*` functions (F4/N) — did not worsen; correctly stays unpromoted.** LIN-1232 recorded 360 / 298 / 259. At HEAD: `init` **344** (`:534`), `initPrompts` **287** (`:930`), `initRecommendations` **255** (`:1709`). All three *shrank* slightly while the file's other work continued. Reported as an improvement, not padded into a finding.
- **`public/swim.js` connector duplication** — see F3. Newly recorded; not promoted.
- **`lib/render-settings.js`** (1,232 lines / 52 commits, risk×churn #11; `renderSettingsPage` 310 lines at `:923`) and **`lib/prompt-template-defs.js`** (1,210 lines) — never weighed by any prior run. Both sit below the promotion line: high churn but flat data/JSX-ish structure, no nesting depth, no duplication found. Recorded so the next run has a baseline.

---

## 4. Clean results — reported as outcomes, not omitted

Four things this ticket specifically asked about turned out fine, and saying so is the point:

- **The ~40 new `lib/` modules are healthy factoring, not a mega-surface forming.** `lib/` now holds **168 modules**: median **220 lines**, mean 331, p90 758, and only **14 over 800**. The `account-*` / `workspace-token-*` / `*credential*` family is 18 modules / 4,445 lines with **no member over 582**. The `lib/render-*` family is 30 modules / 9,211 lines with one outlier (`render-settings.js`, above). `lib/components/` is a real 20-file primitive layer. Small, `now`-injected, single-purpose — the current house style held under 40 new modules and ~320 commits. *(Whether 15 modules for one credential concern is the right **number** is dependency-direction and canonical-convention — **deferred to Drift & Coherence**, not re-flagged here.)*
- **`public/style.css` has essentially no dead CSS — the first time any run has checked.** Of **380 classes** defined, 25 appear nowhere else in the tree; **23 of those 25 are dynamically composed** (`accent-bar--${state}`, `tag--${status}`, `status-pill--*`, `segment-bar__cell--*` — each resolved in `lib/components/*.js`). Genuinely unreferenced: **`.child-count` and `.recommend-actions`**. Two dead classes in 4,340 lines is not a finding. The file is also well-structured: 40 banner-delimited sections, 108 design tokens, a component layer at the tail, and its two nested `:root` blocks are deliberate media-query token bumps with rationale comments (`:1700`, `:2125`).
- **`routes/test.js` is correctly gated.** 1,380 lines / 53 commits looked alarming in the churn table; it is mounted only inside `if (process.env.NODE_ENV === 'test')` at **`server.js:729`**. No production exposure. Not a finding.
- **The `lib/recap.js` / `lib/brief.js` mirror is not drifting.** 131 and 123 lines, same three-function shape (`build*Messages` / `parse|clean*Response` / `generate*`). Deliberate duplication with no drift and no under-testing — **explicitly not flagged**, per this ticket's own exception.

---

## 5. Follow-ups minted — 3, at the cap, top severity only

| ticket | finding | why this one |
|---|---|---|
| **LIN-2245** | **F1** — extract the 678-line `/api/proxy/instructions` catalog out of `routes/proxy.js` | Cheapest 9.5% cut of the repo's #1 risk×churn file; moves no logic; unblocks LIN-679 rather than duplicating it |
| **LIN-2246** | **F2** — decompose `routes/workspace-api.js` by URL group | Only top-three churn surface with no ticket at all; fastest-growing file in the repo |
| **LIN-2247** | **F5** — assert `.theme-dark` / `body.is-landing` dark-token parity in `tests/unit/theme.test.js` | One assertion; converts a comment that is already false into an enforced invariant |

**Not minted, deliberately:** F3 (swim.js — recorded with full evidence, below the cap), F4 (**LIN-1622 already owns it**; drift table posted there instead of a rival ticket), `lib/dispatch-store.js` N2 (next in line), and all six prior follow-ups (re-verified, none duplicated).

---

## 6. Deliberately not re-flagged — owned by a sibling review

- **Doc / contract drift** → Documentation Review (LIN-1922, run next in this batch). Includes the fact that `/api/proxy/instructions` is a *documentation* surface living in a route file: F1 treats it purely as 678 lines of code-file bulk, never as doc accuracy.
- **Dependency direction, canonical-convention fragmentation** → Drift & Coherence. Includes whether 18 modules is the right shape for the credential concern.
- **Interface / contract shape** (55 proxy endpoints, 36 workspace-api endpoints as an *API surface*) → API Quality.
- **The rendered product** → Design & Interface (LIN-1924, run next). F4's and F5's *visible* consequences are theirs; the stylesheet *structure* is mine, per their standing deferral.
- **Test adequacy** → Test Coverage Gap. F3 cites the absence of a `public/swim.js` test only to establish that the duplication is unguarded — not as a coverage finding. Repo-wide: 371 unit tests, 72 e2e specs, 16 unit files exercising `public/`.
- **Rate-of-change convergence** → Stability Review. §1's acceleration figures are cited as maintainability trend, not as a convergence verdict.
- **Delivery drag** → Recent Headwinds (LIN-1918, this batch).
- **Reader comprehension / missing rationale** → Comprehension-Debt. Note in passing: rationale density in this repo is unusually high — most of what I read carried a load-bearing "why", which is why several leads resolved to non-findings above.
