# Code Quality Review — 2026-08-29 (periodical run, LIN-2378)

*Review-only: no code, config or secrets changed — the only file this run writes is this report. Severity-ranked complexity / duplication / maintainability findings, weighted by risk × churn, grounded against source at HEAD.*

**HEAD** `LinearViewer` @ **`b78c4499`** (2026-08-30 07:07:23 +0100, = `origin/main`). Every figure below was re-measured at that SHA with `wc -l` and `git log --since=90.days -- <file>`. **Nothing is inherited** from the ticket's mint-time leads (`8c9c3b08`), the research pass (`8c9c3b08`), or the execution plan (`292ac962`) — where a re-measurement contradicts one of those, the contradiction is stated rather than quietly corrected.

**Process note.** This edition ran research → plan → plan-review → revision → plan-review → escalation → operator ruling → execution. The second plan-review returned `Request Changes` on two ownership questions no agent could settle from inside the run; operator ruling `1bccd148` (Flight Companion, 2026-08-30 07:08 BST) authorised **Option B** — apply the two findings as written plus the two rulings in one amended plan pass, then execute without a third plan-review. Both rulings are honoured below and marked where they bind.

---

## 0. Prior runs — what happened to them

| run | report | status |
|---|---|---|
| **2026-06-25** (LIN-667) | `docs/reviews/code-quality-review-2026-06-25.md` | committed; baseline edition |
| **2026-07-11** (LIN-1232) | — | **confirmed lost** — no branch, no ref carries it; only the LIN-1232 comment survives |
| **2026-08-23** (LIN-1920) | `docs/reviews/code-quality-review-2026-08-23.md` | landed **retroactively, six days late**, after a conflicting "touch no files" instruction blocked it at the time |
| **2026-08-29** (this run) | `docs/reviews/code-quality-review-2026-08-29.md` | **this file**, landed on the day, via feature-branch PR |

Two consecutive editions failed to land an artifact on time. That is the single highest-leverage failure mode of this periodical, and it is why `lib/periodical-report-gate.js` (LIN-694) now refuses a Done transition until a comment on the task cites a real GitHub URL. This run satisfies that gate with a merged PR rather than a promise.

---

## 1. Risk × churn at HEAD — re-measured, not trusted

`wc -l` × `git log --since=90.days --oneline -- <file>`, over **every tracked `.js`/`.css` in the repo, tests included**.

> **This table was rebuilt after the adversarial second-read.** As first published it covered *"all tracked non-test `.js`/`.css`"* — which silently made "in scope" and "on the board" two different things, because §3a rules test-file *maintainability* **in scope**. The Tier-1 reader caught it (see the final section of this report), and the consequences were real: two in-remit files ranking above three graded surfaces carried no verdict at all, and §3a's stated deferral reason was false on this very metric. The board below is the corrected instrument; the findings and deferral reasons downstream were re-derived from it.

| # | file | lines | 90d commits | risk×churn | structural owner |
|---|---|---|---|---|---|
| 1 | **`routes/proxy.js`** | **7,356** | **178** | **1,309,368** | **LIN-2360** (In Progress, stages held) |
| 2 | **`server.js`** | 3,788 | 170 | 643,960 | LIN-1249 (Backlog) |
| 3 | **`routes/workspace-api.js`** | 3,498 | 91 | 318,318 | LIN-2246 (In Progress, partial) |
| 4 | `public/style.css` | 4,343 | 68 | 295,324 | — (08-23: no dead CSS; clean) |
| **5** | **`tests/unit/prompt-templates.test.js`** | **4,063** | **61** | **247,843** | **none — §3a, deferred** |
| **6** | **`tests/e2e/proxy.spec.js`** | **3,012** | **52** | **156,624** | **none — F10, added post-review** |
| **7** | **`tests/unit/dashboard-routes.test.js`** | **3,415** | **42** | **143,430** | — (**clean result**, see F10) |
| 8 | **`lib/dispatch-store.js`** | 2,178 | 58 | 126,324 | **none — F2 mints one** |
| 9 | **`routes/dashboard.js`** | 2,070 | 53 | 109,710 | **none — F6, deferred, see §3** |
| 10 | `public/common.js` | 2,114 | 45 | 95,130 | LIN-2071 (mirror class) |
| 11 | `tests/unit/openrouter.test.js` | 2,431 | 39 | 94,809 | — (clean result, see F10) |
| 12 | `lib/providers/linear/index.js` | 2,326 | 36 | 83,736 | LIN-1251 (Backlog) |
| 13 | `routes/test.js` | 1,463 | 53 | 77,539 | — (test-only, not production surface) |
| 14 | `public/app.js` | 2,271 | 34 | 77,214 | — (graded non-finding) |
| 15 | `lib/render-settings.js` | 1,289 | 52 | 67,028 | — (baseline, below the line) |
| 16 | `lib/openrouter.js` | 1,875 | 35 | 65,625 | LIN-1250 (Backlog) |
| 17 | **`routes/dispatch.js`** | 1,524 | 41 | 62,484 | **none — F7, deferred, see §3** |
| 18 | `lib/prompt-template-defs.js` | 1,303 | 47 | 61,241 | — (baseline) |
| 19 | `public/observation.js` | 2,101 | 28 | 58,828 | — (clean result) |
| 20 | **`lib/render.js`** | 1,147 | 45 | 51,615 | **none — F11, graded below** |
| 21 | **`lib/pipeline-loops.js`** | 1,572 | 27 | 42,444 | **none — F8, deferred, see §3** |
| 22 | **`lib/providers/jira/index.js`** | 2,244 | 14 | 31,416 | **none — F3 mints one** |

**Net growth over the window tells the same story the ranking does.** By lines added minus deleted in 90 days: `routes/proxy.js` **+4,569**, then `tests/unit/dashboard-routes.test.js` **+3,415**, `tests/unit/jira-provider.test.js` **+3,200**, `tests/unit/prompt-templates.test.js` **+3,119**, `tests/e2e/proxy.spec.js` **+2,483**, `server.js` **+2,327**. **Four of the six fastest-growing files in the repo are test files** — precisely the mass the original board excluded.

**The dominant complexity shape in this repo is the route-factory closure, and it recurs five times.** The largest genuine units in the tree are not handlers or algorithms — they are the closures that hold them:

| unit | lines | share of its file |
|---|---|---|
| `createProxyRoutes` (`routes/proxy.js:681`) | **6,676** | 91% |
| `createWorkspaceApiRoutes` (`routes/workspace-api.js:286`) | 3,213 | 92% |
| `createDashboardRoutes` (`routes/dashboard.js:455`) | 1,588 | 77% |
| `createTestRoutes` (`routes/test.js:49`) | 1,415 | 97% |
| `createDispatchRoutes` (`routes/dispatch.js:133`) | 1,392 | 91% |

Three of these five already have a decomposition ticket (LIN-2360, LIN-2246, LIN-679). **None of the three has been actioned to completion.** That fact, not the count of un-ticketed instances, is the finding — see §3's deferral rationale for why this run mints no fourth instance of the same class.

---

## 2. The question this edition was best placed to answer

> *Did the `routes/workspace-api.js` decomposition actually reduce complexity, or did it relocate it?*

**Verdict: a genuine reduction, and — the new evidence this run adds — it has now HELD for seven days.** The 08-23 run measured three mega-modules growing at an accelerating rate. One reversed. The question was whether the reversal was real or an artifact of the split commit.

| SHA | date | `workspace-api.js` | `-roadmap.js` | `-prompts.js` | `proxy.js` | `server.js` |
|---|---|---|---|---|---|---|
| `0e8a1461` | 08-23 (pre-split) | **4,388** | — | — | 7,098 | 3,756 |
| `80bd043d` | 08-23 (split) | **3,492** | 866 | 124 | 7,228 | 3,756 |
| `8c9c3b08` | 08-29 | 3,492 | 866 | 131 | 7,229 | 3,788 |
| `292ac962` | 08-29 | 3,498 | 866 | 131 | 7,315 | 3,788 |
| **`b78c4499`** | **08-30 (HEAD)** | **3,498** | **866** | **131** | **7,356** | **3,788** |

**Why this is a real reduction and not a relocation:**

- **Growth is arrested, not deferred.** `workspace-api.js` moved **+6 lines in seven days** across the only two commits that touched it (`03ebfff2` LIN-2353, `292ac962` LIN-2354) — against **+51 lines/day** in the 15 days before the split. No other mega-module has ever reversed in this series.
- **No new mega-surface formed.** The two extracted modules are **866 and 131 lines** and have not grown since creation (`-prompts.js` +7 at the split, then flat). Both mount as ordinary sub-routers (`routes/workspace-api.js:294`, `:3495`).
- **Closure pressure genuinely fell.** 36 endpoints / 24 in-closure helpers became 24 / 18 in the parent, plus two small children. The parent's closure is still 3,213 lines — real, but no longer the fastest-growing thing in the repo.
- **The contrast is the proof.** Over the identical seven-day window, the *un-decomposed* #1 surface `routes/proxy.js` went **7,098 → 7,356 (+258, ~37 lines/day)**. Same repo, same period, same pressure: the file that was split stopped growing, the file that wasn't did not.

**Two costs the split incurred, both still live at HEAD** — recorded so the answer is not overstated:

1. **It institutionalised helper duplication.** `routes/workspace-api-roadmap.js:34` re-declares `shouldMockAi` locally with a comment asserting *"this codebase's established convention is to duplicate this 3-line predicate per route module rather than share it via import"* — while `routes/workspace-api.js:95` **exports** it and `server.js:94` **already imports it**. An import path existed and was declined. See F4.
2. **Stage 3 never landed.** The recap/brief/recommend group (7 endpoints — also LIN-680's home) was scoped into LIN-2246 and not delivered. LIN-2246 remains **In Progress with no active lane** (its own run summary: *"genuinely partial. Leaving In Progress, not Done"*; the holding lane ended 2026-08-23 20:04 BST). Cross-linked, not re-ticketed.

**What this tells the next run:** decomposition works here, and the evidence is now a measured seven-day hold rather than a single commit. That is the strongest available argument for actioning LIN-2360 and LIN-1249 rather than re-reporting them a fifth time.

---

# Findings, severity-ranked

**The `F<n>` labels are stable identifiers, not ranks** — they are cited by the minted tickets and by the LIN-2071 comment, so they are not renumbered. Document order below follows the identifiers; **severity order is this table**, and it is the one that decided the mint set.

| rank | finding | severity | surface | disposition |
|---|---|---|---|---|
| 1 | **F1** | HIGH | `routes/proxy.js` (1,309,368) | cross-link **LIN-2360** — owner is live, stages held |
| 2 | **F2** | HIGH | `lib/dispatch-store.js` (126,324) | **minted LIN-2398** |
| 3 | **F9** | MED-HIGH | `github-auth` ↔ `github-projects-auth` (79% verbatim) | **minted LIN-2397** |
| 4 | **F5** | MED-HIGH | `ship-layout` mirror, 2 confirmed divergences | evidence to **LIN-2071** — owner of the class |
| 5 | **F3** | MED-HIGH | `lib/providers/jira/index.js` ADF codec (801 lines) | **minted LIN-2399** |
| 6 | **F6** | MED | `routes/dashboard.js` (109,710) | recorded, deferred — see §3 |
| 7 | **F4** | MED | 30-site `isTestMode` repetition | recorded, deferred |
| 8 | **F7** | MED | `routes/dispatch.js` (62,484) | recorded, deferred — see §3 |
| 9 | **F8** | MED-LOW | `lib/pipeline-loops.js` (42,444) | recorded, deferred |
| — | **F10** | MED-HIGH | `tests/e2e/proxy.spec.js` (156,624) — **ranks 3rd** | **recorded — top unpromoted candidate** |
| — | **F11** | LOW | `lib/render.js` (51,615) | recorded, below the line |

**Why the mint set is F2, F9, F3.** F1 and F5 rank 1st and 4th but are **unmintable by construction** — each already has a live owner (LIN-2360, LIN-2071), and minting against either would be the duplicate-ticket failure this review's §7 contract exists to prevent.

**F10 is the honest exception, and it is a process failure rather than a judgment call.** It ranks **3rd overall**, is unowned, and would have displaced F3 — but it was found by the **Tier-1 adversarial reader after the three tickets were already minted**, because §1's board excluded test files while §3a declared them in scope. The cap is 3 and the three that exist are sound, so F10 is recorded rather than minted, and named here and in §7 as the top candidate for the next run.


## F1 · **HIGH** — the `routes/proxy.js` decomposition is being outrun by the file's own growth while its stages are held

**What.** `routes/proxy.js` is **7,356 lines / 178 commits = 1,309,368** — the #1 risk×churn surface by **2.0×** over #2, and the widest margin any edition of this series has measured. It holds **55 endpoint registrations** inside one 6,676-line `createProxyRoutes` closure (`:681`), which is **91% of the file**.

**The live owner is LIN-2360, and this report cross-links it rather than rivalling it** *(operator ruling 1, binding)*. LIN-2360 — *"Split routes/proxy.js (7,245 lines, 55 endpoints) into behaviour-preserving sub-modules"*, **In Progress** — is the live successor of the two dormant Backlog tickets prior runs cited (`related` to both **LIN-679** and **LIN-2245**). **LIN-2245 is recorded here as folded into LIN-2360's staging**, not as an independent live split; whether it is formally cancelled is normal-operations bookkeeping, not this report's call. **No `routes/proxy.js` decomposition is re-minted by this run.**

**Its Stage 1 landed, and this report credits it correctly.** `769948c5` (*"LIN-2360 Stage 1: extract credential-resolution trail"*, #1277) created **`lib/proxy-credential-trail.js` (106 lines)** and cut `routes/proxy.js` from **7,269 → 7,180** (`5 94` in `--numstat`). *Correction to the research pass:* its §5.4 graded that file as one of the "modules added since 08-23 are healthy — clean result", i.e. as an unrelated new module. **It is not — it is LIN-2360 Stage 1's own deliverable**, and filing it as an unowned healthy module credits the decomposition's output to nobody. That framing is not inherited here.

**The new, actionable measurement.** Stage 1 cut 89 lines on 2026-08-29. In the six commits since, `routes/proxy.js` has grown **7,180 → 7,356 (+176)**. **The decomposition's first stage was erased roughly twice over within a day.**

**Why it is not moving.** LIN-2360's **Stages 2–6 are deliberately held pending an explicit human go** (operator ruling `e3c0dda9` on that ticket). *This is a hold, not abandonment* — the file is **not** ownerless, and nothing here should be read as licence to file a rival decomposition.

**Concrete maintainability cost.** The single largest member of the file is still not a handler: `GET /api/proxy/instructions` spans **`:1778–:2491`, 714 lines** — a mostly-static documentation catalog inside the repo's highest-churn route file, so every edit to it re-touches that file's history. *Correction to the 08-23 run and the research pass, which both stated the catalog is "larger than the next two handlers combined":* **that is no longer true at HEAD, though only just.** The next two are `POST /api/proxy/recommend-and-dispatch` (480) and `POST /api/proxy/dispatch` (312) — **792 combined, against the catalog's 714.** The catalog remains the file's largest single member by a wide margin (480 is the runner-up), but it is no longer larger than its next two neighbours put together, and the claim as previously worded has expired.

*Measurement note, because it changed the answer:* the 55 registrations include **10 that register an array of two alias paths** (e.g. `router.get(['/api/proxy/issues/:identifier/recap', '/api/proxy/recap/:identifier'], …)`), so the file exposes **65 routable paths across 55 registrations**. A first pass here used a regex that only matched same-line single-path registrations, found 45, and consequently mis-sized every handler adjacent to an array-form one — it reported a non-existent 524-line `GET /api/proxy/stack` as the runner-up. The figures above use the complete 55-boundary set; the catalog's own span is brace-matched (`:1778–:2491`) and independent of it.

**Cost.** 178 commits in 90 days land in one 6,676-line closure with no module boundary to localise a mistake. At the current rate the file adds a Stage-1-sized extraction every ~4 days.

**Confidence: verified at HEAD.** *Cross-links LIN-2360 (owner), LIN-679 and LIN-2245 (both folded in). Not minted.*

---

## F2 · **HIGH** — `lib/dispatch-store.js` is the highest-ranked surface in the repo with no owner at all, and it grew again

**What.** **2,178 lines / 58 commits = 126,324**, #5 on the board and **the highest-ranked file that no ticket owns structurally**. It is one class with **31 methods**, three of them very large:

| method | line | size | 08-23 | delta |
|---|---|---|---|---|
| `addFeedback` | `:1748` | **288 lines** | 243 | **+18.5%** |
| `addItem` | `:254` | **182 lines** | 157 | +15.9% |
| `_archiveItem` | `:808` | 139 lines | — | — |

**Second site / delta.** The rest of the `lib/*store*.js` family is an order of magnitude smaller — the next-largest is `lib/owner-credential-store.js` at **498 lines total**, i.e. smaller than `dispatch-store.js`'s three biggest methods combined. This is not a family convention; it is one outlier.

**This is the third consecutive run to measure it worsening.** LIN-1232 (07-11) recorded `addFeedback` 157 / `addItem` 131. The 08-23 run recorded 243 / 157 and wrote: *"if a fourth ticket were minted, this is the one"* — then hit its cap of 3. It has grown again since. **This run has cap room and mints it.**

**Concrete maintainability cost.** `addFeedback` is on the dispatch hot path — every runner feedback POST enters it. LIN-1343 already fixed a check-then-write stale-snapshot race **inside this method** when it was 157 lines; it is now 288. The next concurrency defect in it will be harder to see and harder to test, and the method has no seam at which to add one.

**Negative search (why this is not a duplicate).** `LIN-2330` covers three *stale inline comments* in this file; `LIN-1356` corrects a stale citation elsewhere; `LIN-186`/`LIN-1343` are **Done** and behavioural. **No ticket owns this file's structure.**

**Confidence: verified at HEAD.** → **minted, see §7.**

---

## F3 · **MED-HIGH** — `lib/providers/jira/index.js` carries a complete second concern: an 801-line ADF↔Markdown codec with no consumer outside its own file

**What.** Lines **`:220–:1020`** of `lib/providers/jira/index.js` — **801 of 2,244 lines, 36% of the file** — are a self-contained bidirectional Atlassian-Document-Format ↔ Markdown converter: `adfToMarkdown` (`:342`), `markdownToAdf` (`:565`), `adfHasUnrenderableContent` (`:982`), plus ~20 escaper / parser / renderer internals and three escape-pattern constants (`:220`–`:227`).

**Second site.** `grep` over the whole tree returns **no consumer of those three exports in `routes/`, `lib/` or `public/`** — the codec has no production caller at all; it is reached only through the provider methods that wrap it. *(Correction, from the Tier-1 read: this report first wrote "zero consumers outside this file and `tests/unit/jira-provider.test.js`". That understated the test surface — the exports are also referenced by `tests/unit/proxy-jira-write-routes.test.js`, `tests/fixtures/jira-harness.js` and `tests/e2e/jira-provider.spec.js`. All four are tests, so the substantive claim — no production consumer, extraction is mechanical — stands; the count did not.)*

**Why the extraction is mechanical and low-risk.** `lib/providers/jira/` **already demonstrates the convention**: it is a four-file directory (`index.js`, `client.js`, `fake-client.js`, `oauth.js`). Adding `adf.js` follows a split the directory has already made, not a new pattern. The region has a clean top and bottom boundary — the next symbol after it, `issuetypeIsEpic` (`:1021`), is unrelated provider logic.

**Concrete maintainability cost.** A Markdown-escaping or ADF-node bug (the class of `LIN-1939`, still Backlog: *"empty unmarked text run between marked runs"*) is currently debugged and fixed inside a 2,244-line provider module whose other 1,443 lines are HTTP, auth, JQL and epic-hierarchy code. It also pins the 3,200-line `tests/unit/jira-provider.test.js` as one file, since codec tests and provider tests share a module.

**One failure path any extraction must preserve:** `JiraInProgressCapExceededError` (`:1125`) sits on the fail-whole path and must keep propagating unchanged.

**Churn is low and the report says so plainly.** 14 commits/90d — the *lowest* change pressure of anything promoted here. It is minted on cheapness and confidence, not urgency: zero external consumers and an in-directory precedent make it the highest-certainty structural win available at this cap.

**Confidence: verified at HEAD.** → **minted, see §7.**

---

## F4 · **MED** — the mock-mode decision is written out 30 times, and the "semantic divergence" reported upstream does not survive re-measurement

**What.** Two predicates answer "should this request be mocked?":

- **The named one.** `shouldMockAi(workspace)` — `NODE_ENV==='test' && (accessToken==='test-token' || provider==='local')`. It exists in **5 copies**: `routes/workspace-api.js:95` (exported), `routes/workspace-api-roadmap.js:34`, `routes/next-run.js:37`, `routes/task-chat.js:55`, `routes/ship-biscuit.js:54`.
- **The inline one.** `process.env.NODE_ENV === 'test' && …accessToken === 'test-token'` — written out **30 times across 6 files**: `routes/workspace-api.js` ×15, `routes/proxy.js` ×9, `server.js` ×3, `routes/next-run.js` ×1, `routes/task-chat.js` ×1, `routes/workspace-api-roadmap.js` ×1. Almost all bind it to a local named `isTestMode`.

**Correction to the research pass, which this run owes the record.** The research pass reported *"43 sites across 9 files"* and framed the gap as a **semantic divergence** — "two semantics for 'are we mocking?' … exactly the class where a fix lands on one and not the other". **Re-measured at HEAD, that framing does not hold:**

- The count is **30 inline sites across 6 files**, not 43 across 9 (the earlier figure counted the five named function bodies as inline sites and used a looser pattern).
- **All five named copies are byte-identical.** There is no drift *within* the named family.
- **All 30 inline sites are identical in shape.** There is no drift *within* the inline family either.
- The difference between the two families is **deliberate and documented**, at length, at the export site (`routes/workspace-api.js:80-93`): the migration split a gate that had conflated the **data** mock from the **AI** mock. Data stays on the narrow `test-token` check; the AI mock is a deliberate **superset** that also fires for local-provider sessions. The comment explicitly records why it does *not* widen further: *"the 503 'AI not configured' tests run on `test-token` with the AI mock active; an unconfigured non-local session must still 503."*

**So what is left, honestly.** Not a divergence — a **repetition**. One 5-copy named helper that an available `import` would collapse (proved available: `server.js:94` already does `import { …, shouldMockAi } from './routes/workspace-api.js'`), and one 30-site inline predicate with **no named helper at all**, while its AI sibling got one.

**Concrete maintainability cost, stated at its true size.** Changing what "test mode" means — adding a third provider, changing the token sentinel — is a 35-site edit across 7 files with no single definition to change, and the two families would have to be kept correctly *different* while being edited together. That is a real cost. It is **not** a latent bug: no site is currently wrong, and the report does not claim one is.

**Why it is recorded and not minted.** The duplication is documented as intentional per-module independence, no divergence exists to point at, and three higher-severity unowned surfaces already fill the cap. Promoting a MED repetition over F1–F3 would be padding.

**Confidence: verified at HEAD; upstream framing corrected.**

---

## F5 · **MED-HIGH** — LIN-1208 did not close its own class: 11 of 14 mirrored `ship-layout` functions are unguarded and **two have already diverged**

**What.** `lib/ship-layout.js` and `public/ship.js` hand-maintain **14 same-named functions**. `tests/unit/ship-layout-parity.test.js` — the battery LIN-1208 added specifically to bind them — covers **3**: `buildSegments`, `computeProximityRings`, `computeShipReachableIds`. The other **11 are unguarded**, and after normalising away ES5/ES6 style (`var`/`const`, default params, comments) **11 of 14 still differ**.

**Two of those differences are real contract divergences, verified by reading both bodies** — not the naive line-diff artifact the research pass correctly warned about:

| function | `lib/ship-layout.js` | `public/ship.js` | divergence |
|---|---|---|---|
| `resolveCollisions` | `:708` — `(positions, geometry, cardSize, padding)`, iterates a **`Map`**, **returns `nudges`** | `:472` — `(positions, geom, cardSize)`, iterates a **plain object**, **returns `undefined`** | different arity, different input type, different return contract |
| `computeShipDimensions` | `:854` — returns `{width, height, **cols**, rows, padding, labelArea, gap}` | `:720` — returns `{width, height, rows, padding, labelArea, gap}` | the client **omits `cols`** entirely |

The lib copy of `resolveCollisions` takes a `padding` argument its own caller passes (`lib/ship-layout.js:475` → `config.collisionPad`); the client hard-codes `PAD = 4`. A non-default `collisionPad` therefore produces a layout the client cannot reproduce.

**The severity-shaping fact, and the reason this is graded MED-HIGH rather than HIGH.** `lib/ship-layout.js`'s **layout functions are imported by tests only** — `tests/unit/ship-layout-parity.test.js` and `tests/unit/ship-layout.test.js`. The one production importer, `lib/ship-journey.js:13`, takes only the two constants `BEARING_TO_ANGLE` / `BEARINGS`. **The live render path is `public/ship.js` alone.** So these divergences are **not user-visible bugs today** — and that is precisely the problem: the repo carries ~819 lines of layout code nothing in production runs, plus a unit-test file asserting behaviour **no user can reach**, while the code that actually renders the view is the untested copy.

**That is, verbatim, the shape LIN-1208 was created to eliminate — and the shape LIN-2071 records it as having eliminated.**

**The seam is the limiting factor, and that makes the fix cheap.** `public/ship.js:1855` already carries the `module.exports` test seam LIN-1208 added — but it exports **exactly the three parity-tested names** and nothing else. Extending the battery from 3 to 14 is therefore a matter of widening that export list and adding cases, with no new seam work. By cost-to-close this is plausibly the cheapest item in LIN-2071's list; `public/swim.js`, its item (1), has no seam at all yet.

**Cross-link, not a rival — and a correction to the owner's premise.** **LIN-2071** (*"Close the live/mirror divergence class: public/swim.js ↔ lib/swim-lanes.js and siblings"*, Backlog) **owns this class** and lists its siblings worst-first, with `public/swim.js` ↔ `lib/swim-lanes.js` as item (1). Its framing is that LIN-1208 *closed* the ship pair. **This run's measurement says it did not:** the parity battery bound 3 of 14 names, and the unbound remainder has since drifted in at least two contract-level ways. The ship pair belongs **back in LIN-2071's list**, and it arrives with something item (1) does not yet have — **measured, not assumed, drift**.

**No ticket is minted for this.** LIN-2071 is the owner; the evidence is posted there instead (see §7), which is what "add evidence to the existing ticket, do not compete with it" means in practice.

**Confidence: verified at HEAD by reading both implementations.**

---

## F6 · **MED** — `routes/dashboard.js`: 2,070 lines, never weighed by any run, and 553 lines of preamble before its first route

*Graded here because ticket §3 and plan-review finding F1 require a recorded verdict at execution HEAD, clean or not. It is not clean.*

**What.** **2,070 lines / 53 commits = 109,710**, #6 on the board. `createDashboardRoutes` (`:455`) is a **1,588-line closure, 77% of the file**, and its **first `router.<verb>` registration is at `:1008`** — **553 lines of in-closure preamble** (helpers, resolvers, formatters) run before a single route is declared. Only 16 endpoints sit in the remaining 1,062 lines.

**Second site / delta.** This is the same defect class as F1's `createProxyRoutes` (6,676) and `createWorkspaceApiRoutes` (3,213) — but with a distinguishing feature neither has: in those two, closure bulk *is* endpoints; here more than a third of the closure executes before routing starts, so the module's cost is paid on every read regardless of which endpoint you came for.

**Concrete maintainability cost.** 53 commits in 90 days land in a closure where the helper a change touches may be 500 lines above the route that uses it, with no module boundary between them. Four open tickets already point into this file for behavioural reasons (`LIN-1989` owner-blind token lanes at `:829`/`:1688`, `LIN-2192`, `LIN-1919`, `LIN-1912`) — each of them a change that has to be made inside that closure.

**Structurally unowned** — all four tickets above are behavioural or security, none owns the file's shape.

**Deferred, not minted — with the reason stated rather than implied.** See §3.

**Confidence: verified at HEAD.**

---

## F7 · **MED** — `routes/dispatch.js`: 22 endpoints in one closure, no structural owner

*In scope by operator ruling 2, which folded it into the graded pool.*

**What.** **1,524 lines / 41 commits = 62,484**, #13 on the board — above `lib/pipeline-loops.js` (42,444) and above `lib/providers/jira/index.js` (31,416), both of which this report also grades. `createDispatchRoutes` (`:133`) is a **1,392-line closure, 91% of the file**, holding **22 endpoint registrations** (`:225`–`:1361`) and only **5 in-closure helpers**. The file has exactly **two** top-level functions.

**Second site.** Structurally identical to the class already ticketed three times: LIN-679 (*"4497-line closure"*), LIN-2246 (*"36 endpoints, 24 in-closure helpers"*), LIN-2360 (*"55 endpoints"*). It is the fifth route-factory closure in §1's table.

**Negative search — this branch of the finding is discharged, not left open.** The only live tickets naming this file are **LIN-2160** (Backlog — extend the dispatch-contract drift monitor to it) and **LIN-1598** (Backlog — ownerless dispatch-token mint at `:856`). Both are **behavioural**. **No ticket owns its structure.**

**Concrete maintainability cost.** 41 commits/90d into one closure with almost no internal decomposition (5 helpers for 22 endpoints) — the dispatch queue's whole HTTP surface shares one lexical scope, so any shared mutable binding is reachable from all 22 handlers.

**Deferred, not minted.** See §3 — and note explicitly, per the ruling that admitted it: **it displaced nothing.** It out-ranks `pipeline-loops.js` and `jira/index.js` on risk×churn, but F3 (jira) is minted over it on *class*, not rank — F3 is a distinct defect (a second concern embedded in a module, mechanically extractable, zero external consumers), whereas F7 is a fourth instance of a class with three unactioned tickets already open.

**Confidence: verified at HEAD.**

---

## F8 · **MED-LOW** — `lib/pipeline-loops.js`: two functions hold 45% of the file

*Graded here because ticket §3 and plan-review finding F1 require a recorded verdict at execution HEAD.*

**What.** **1,572 lines / 27 commits = 42,444**. 23 top-level functions, of which two are outliers: **`_buildLoops` (`:434`, 384 lines)** and **`_buildSessions` (`:972`, 325 lines)** — **709 lines, 45% of the module, in two units**. The other 21 functions average ~35 lines, which is squarely the house style.

**Concrete maintainability cost.** These two are the loop- and session-reconstruction cores; three open tickets already ask for changes inside them (`LIN-2148` malformed-history skip counting, `LIN-2099` owner threading for loops with no `dispatchedBy`, `LIN-1734` root-cause correlation). Each lands in a 300–400-line function with no seam.

**Why MED-LOW.** Churn is 27/90d — the second-lowest of anything graded — and the module is otherwise well-factored, with 21 small pure functions and injected `now`. The two large functions are cohesive rather than tangled: they build one structure each. This is a lead that has not yet become a cost.

**Deferred, not minted.** See §3.

**Confidence: verified at HEAD.**

---

## F9 · **MED-HIGH** — `routes/github-auth.js` ↔ `routes/github-projects-auth.js`: 79% of one file appears verbatim in the other, in two security-adjacent OAuth flows

**What.** **577 and 526 lines; 17 and 13 commits/90d.** Of `github-auth.js`'s **302 significant lines (comments and blanks excluded), 241 — 79% — appear verbatim in the sibling**, including **11 contiguous runs of ≥6 lines, 86 lines in total**:

| `github-auth.js` | lines | opening line |
|---|---|---|
| `:25–37` | 13 | `import { githubErrorDiagnostic } from '../lib/errors.js'` |
| `:57–63` | 7 | `function installationExpiryMs(expiresAt) {` |
| `:89–95` | 7 | `function notConfigured(res) {` |
| `:195–200` | 6 | `if (!installationId && code) {` |
| `:410–417` | 8 | `const workspace =` |
| `:423–429` | 7 | `const established = await establishAccount(req.session, accountStore, …` |
| `:442–451` | 10 | ``const workspaceId = `github:${creds.userId}` `` |
| `:460–465` | 6 | `const urlKey = validateWorkspaceUrlKey(creds.login) ? …` |
| `:514–521` | 8 | `const workspacesBeforeLogin = req.session.workspaces ? […]` |
| `:381–386`, `:561–568` | 14 | handler tails |

**This is acknowledged duplication, not coincidental similarity.** The sibling's own header (`routes/github-projects-auth.js:1-5`) states: *"Sibling to routes/github-auth.js: same two-step shape, but the picker chooses a Projects v2 BOARD (`org/projectNumber`) rather than an `owner/name` repo."* The genuine difference is the picker; the OAuth handshake, installation-token minting, expiry maths, error diagnostics, account establishment, workspace-id construction and session-merge logic are duplicated around it.

**Concrete maintainability cost, and why it is the sharpest one in this report.** These are **authentication flows**. A fix to CSRF/state handling, to `installationExpiryMs`, to `establishAccount`, or to the pre-login workspace-merge must be made **twice, in two files, correctly** — and the duplicated `establishAccount` and `workspaceId` blocks are exactly the account-identity code that `LIN-2103` (Backlog, GitHub App private-key validation) and `LIN-1991` (Backlog, forced-refresh recovery has no reachable arm for `github`/`github-projects`) already point at. A single-file fix to either would silently leave one of the two login paths unpatched.

**Never flagged by any prior edition** — four runs of size-ranking missed it, because neither file is large. Cross-file duplicate-block detection found it; file size never would have.

**Negative search.** `LIN-2030` (e2e stub seam for the callback), `LIN-2103`, `LIN-1991`, `LIN-2002` all touch these files behaviourally. **None owns the duplication.**

**Confidence: verified at HEAD.** → **minted, see §7.**

---

## F10 · **MED-HIGH** — `tests/e2e/proxy.spec.js`: the #6 surface in the repo, 53 repeated blocks, and 3 helpers in 3,012 lines

*Added after the Tier-1 adversarial second-read, which named it as the largest thing this report had missed. Every figure below was independently re-measured before it was written in.*

**What.** **3,012 lines / 52 commits = 156,624 — #6 on the corrected board**, above the minted F2 (126,324), F3 (31,416) and F9 (16,647). It holds **145 tests, 19 `describe`s, 13 `beforeEach`s — and exactly 3 helper functions**, all three declared late and nested in one block: `:2487 expiresAtFor`, `:2541 seedEvent`, `:2550 seedDeadCredential`. **Lines 1–2,486 — roughly 130 tests — contain no extracted helper at all.**

**Second site, measured with this review's own highest-yield instrument.** Running the same duplicate-block detection that produced F9, pointed *within* this one file: **53 distinct repeated ≥6-line verbatim blocks, covering 374 of its 2,218 significant lines (16%)**. For scale, **F9 — which this review minted — is 11 runs and 86 lines.** This single file carries **4.8× F9's run count and 4.3× its duplicated-line volume.**

The dominant repeated block is a protocol contract written out by hand a dozen times (`:1880, :1901, :1930, :1960, :1985, :2007, :2029, :2213, :2279, :2382, :2430, …`):

```js
const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
const { token: dispatchToken } = await tokenResponse.json();
const pollResp = await request.get('/api/dispatch/poll', {
  headers: { Authorization: `Bearer ${dispatchToken}` }
});
const { items } = await pollResp.json();
```

Alongside it: **215 hand-written `Bearer ${…}` authorization header lines** and **52 `/test/*` seam calls** in one file.

**Why it is a cost and not merely a large number — the coupling measurement.** **45 of its 52 commits in the window (86%) also touched `routes/proxy.js` or `routes/dispatch.js` in the same commit.** This is the test surface that every change to the repo's #1 churn file drags along with it. Changing the dispatch-poll contract — the exact class **LIN-2160** exists to monitor on `routes/dispatch.js` — is a twelve-site hand-edit here, with no seam to change instead.

**The in-repo counter-example that settles it.** This is **not** "e2e tests are just repetitive." `tests/unit/dashboard-routes.test.js` is **larger** (3,415 lines, 42 commits, #7 on the board) and carries **21 named factory helpers** — `getHandler:71`, `makeReqRes:77`, `makeRouter:93`, `activeItem:51`, `historyItem:54`, `decisionItem:240`, `scopedStore:2890`, … A 3,000-line test file in this repo has a demonstrated house structure, and `dashboard-routes.test.js` follows it. **`proxy.spec.js` is the outlier against its own repo's convention** — while importing only 2 of the 15 `tests/fixtures/` modules that **137 other test files** use.

**Growth.** **+2,483 lines net in 90 days**, more than the minted F2's `lib/dispatch-store.js` (+1,686).

**Not minted, and the reason is a process failure this report owns.** The ≤3 cap was spent on F2, F9 and F3 before the corrected board existed — had F10 been on the board at ranking time it would have displaced F3. Un-minting sound tickets to re-order them would churn the queue without changing what gets fixed, so **F10 and `tests/unit/prompt-templates.test.js` are recorded as the two top unpromoted candidates for the next run.**

**Clean results found alongside it, so the verdict on test files is not one-sided:** `tests/unit/dashboard-routes.test.js` (143,430, #7) and `tests/unit/openrouter.test.js` (94,809, #11) are both **graded clean** — large and high-churn, but factored to the house convention.

**Confidence: verified at HEAD, independently of the reader's measurements.**

---

## F11 · **LOW** — `lib/render.js` sits above a graded finding on the board and had never been weighed

**What.** **1,147 lines / 45 commits = 51,615** — above **F8**'s `lib/pipeline-loops.js` (42,444), which this report does grade. It appeared in the original document only as a mirror *target* ("`lib/render.js` ×10" in §3c), never as a surface in its own right. Its largest unit is `renderDetailsContent` at **317 lines (`:804`)** — the same shape as F8's `_buildLoops` (384).

**Verdict: below the promotion line, but recorded rather than omitted.** One large function in an otherwise well-factored render module, with churn below the top of the board. Raised because the Tier-1 reader used it to show the pool boundary was leaking in more than one direction — which it was.

**Confidence: verified at HEAD.**

---

## 3. Scope decisions — every widening candidate, decided and justified

Ticket §1 asked for three widening calls and required the report to say which way each went and why. Operator ruling 2 added a fourth surface, and plan-review F1 added two more. All six are decided here.

### a. Test-file *maintainability* → **IN SCOPE, and it yields exactly one bounded finding**

The premise needed correcting before it could be acted on. Re-measured at HEAD, the suite's size distribution is **healthier than `lib/`'s**:

| corpus | n | median | p90 | outliers |
|---|---|---|---|---|
| `tests/unit/*.js` | 390 | **213** | 772 | 9 over 1,500 |
| `tests/e2e/*.js` | 73 | 226 | 873 | — |
| `lib/**/*.js` | 228 | 204 | 711 | **17 over 800** |

**166,516 test lines against 123,403 non-test source lines** is a ratio, not a defect — and `lib/` has nearly twice as many outliers as `tests/unit/` despite being the smaller corpus. **File length is not the predictive signal here.**

The predictive signal is **fixture duplication**, and it is measurable in the top outlier. `tests/unit/prompt-templates.test.js` — **4,063 lines, 61 commits/90d, the repo's highest-churn test file** — contains **29 inline `const issue = {` literals** and **3 helper functions in 4,063 lines**. Meanwhile `tests/fixtures/` is an established convention with **137 importing test files** and 14 modules, and offers **no issue/context factory**.

**Concrete cost:** adding a field to the recommendation-context contract means hand-editing ~29 fixtures in one file.

**Recorded as a finding, not promoted — and the reason first given for that was wrong.** This report originally deferred it on the ground that *"it does not out-rank F1–F3, F9."* **On this review's own metric that is false**, and the Tier-1 reader was right to call it: `tests/unit/prompt-templates.test.js` is **247,843**, out-ranking the minted **F2** (126,324) by 2.0×, **F3** (31,416) by 7.9× and **F9** (16,647 combined) by 14.9×. The claim could not have been checked when it was made, because §1's board excluded the very file being ranked.

**The honest reason it stays unpromoted** is not rank: the ≤3 cap was already spent on F2, F9 and F3 by the time the corrected board existed, and un-minting three sound tickets to re-order them would churn the queue for no gain in what actually gets fixed. Ticket §6c's *"a real finding that waits one cycle"* is the intended outcome for exactly this case. **It is recorded as a top unpromoted candidate for the next run**, jointly with F10.

**This remains deliberately not a licence to open a test-hygiene front**, and test *adequacy* remains Test Coverage Gap's.

### b. The co-located `simple-dispatcher` repo → **IN SCOPE as a bounded first pass; recommend it gets its own lane**

**Two corrections to the ticket's framing, both source-backed.** The ticket's "its files dwarf this repo's" figures are **bytes, not lines**. Measured at `simple-dispatcher` HEAD `0568197` (2026-08-29 22:42 BST): **16,733 non-test JS lines against LinearViewer's ~121,432 — roughly one seventh.** Top risk×churn is `reapers.js` **2,461 × 69 = 169,809**, against `routes/proxy.js`'s **1,309,368** — **7.7× smaller**. It does not dwarf this repo.

**First-pass read (recorded, not ticketed).** Its complexity has the **opposite shape** to LinearViewer's: concentrated in single mega-functions inside modest files, rather than in mega-closures inside mega-files.

| unit | lines |
|---|---|
| `dispatcher.js:394 processPolledItem` | **745** |
| `hook.js:1156 main()` | 491 |
| `reapers.js:1173 runStallFailsafe` | 454 |
| `opencode-runner.js:667 runOpenCode` | 420 |
| `hook.js:772 decideHookActionInner` | 372 |

`processPolledItem` at 745 lines is larger than any single **non-closure** unit anywhere in LinearViewer. *(Measurement hygiene: a naive scan also reported `terminal-driver.js:352 appendLaunchMetric` at 445 lines — a regex artifact; read at source it ends at `:359`, 8 lines. Consistent with the research pass's warning that regex-derived function sizes must be eyeballed, this report checked every size it prints.)*

**Decision: report the first pass, mint nothing against it.** `grep -c simple-dispatcher docs/reviews/code-quality-review-*.md` → 0, 0 — this lane has never covered it — but **eight other review series already cite it**, so it is unowned *by this lane*, not unowned generally. Periodical lanes have been per-repo since LIN-1932 and this dispatch ran the default `repo: null` lane. **Recommendation: a `simple-dispatcher` code-quality lane of its own**, rather than having it ride a LinearViewer run where its findings cannot be ticketed without polluting this lane's queue.

### c. Client-side `public/*.js` structure → **IN SCOPE, reframed, and it produced F5**

- **`public/observation.js` is a clean result.** 2,101 lines / 28 commits looked like a lead; at source it is **76 functions, largest 183 lines**. Size without structural cost. **Reported as a non-finding** — and it sets the calibration bar used elsewhere in this report.
- **`public/ship.js` was the doorway to the real surface: the no-build-step client↔server mirror family.** **24 `public/*.js` files** carry mirror/keep-in-sync language, naming **15+ distinct `lib/` modules** they hand-mirror (`lib/ship-layout.js` ×12, `lib/render.js` ×10, `lib/timeline-zoom.js` ×8, …). Repo-wide there are **exactly 2 parity tests** (`ship-layout-parity`, `ship-biscuit-parity`). That became **F5** — and, critically, **the class already has an owner in LIN-2071**, so the finding is delivered as evidence on that ticket rather than as a rival.
- **The research pass's honest caveat was right to demand a semantic diff, and this run ran one.** A naive line diff reports "DIFFERS" for 11 of 14 pairs; after normalising ES5/ES6 style the count is **still 11**, and reading the bodies confirms **at least two are genuine contract divergences** (F5). The caveat's own spot-checks (`hashFloat`, `hash32`, `midpointAngle`) landed on the trivial pairs and found only style — a sampling artifact, now corrected.
- **`public/app.js` is a graded non-finding.** 2,271 / 34 = 77,214 is on the board, but it is 56 flat small functions with **zero** mirror markers, and its three large `init*` functions *shrank* since 08-23. Size alone is a lead, not a finding.

### d. `routes/dispatch.js` → **IN SCOPE and graded (F7)** *(operator ruling 2)*

Folded into the graded pool and given a recorded verdict at execution HEAD. It displaced nothing from the mint set; the rationale is in F7 and in the deferral note below.

### e. `routes/dashboard.js` and `lib/pipeline-loops.js` → **IN SCOPE and graded (F6, F8)** *(plan-review finding F1)*

Both carry recorded verdicts at execution HEAD. Neither turned out clean; both are deferred rather than minted.

### Why F6, F7 and F8 are deferred rather than minted — the reason, not just the fact

Ticket §6c requires that a deferred surface either name the sibling ticket that owns it or explain itself. **None of these three has an owning ticket**, so this is the explanation.

F6, F7 and F8 are, between them, a **fourth, fifth and sixth instance of one defect class**: too much code in one unit inside a route/loop module. **Three tickets for that exact class are already open and none has been actioned to completion** — LIN-679 (Backlog since June), LIN-2246 (In Progress, partial, no active lane since 2026-08-23), LIN-2360 (In Progress, Stages 2–6 held pending an explicit human go). The constraint on this class is **execution capacity, not ticket coverage.** Minting a fourth, fifth and sixth ticket for it would add queue noise while changing nothing about the bottleneck, and ticket §6c is explicit: *"Err toward under-creating: a queue swamped with low-value tasks is worse than a real finding that waits one cycle."*

Each is therefore **fully recorded above with file:line evidence at HEAD**, so the next run can promote whichever still matters — which is exactly what §6c asks the report to preserve.

---

## 4. Prior follow-ups — re-verified live at execution time, not trusted from any table

Every ticket below was re-`GET`-ed from the workspace API during this session.

| ticket | state (live) | verdict at HEAD `b78c4499` |
|---|---|---|
| **LIN-679** | Backlog | **Still real; superseded in practice.** `routes/proxy.js` 7,098 → **7,356**; 55 endpoints in one 6,676-line closure. **LIN-2360 is the live owner of this work** — see F1. Kept as the original record, not re-minted. |
| **LIN-680** | Backlog | **Still real.** No `cacheBackedGenerate` helper exists anywhere in the tree. Its home is LIN-2246's undelivered stage 3 (recap/brief/recommend). Kept. |
| **LIN-681** | Backlog | **RESOLVED — both halves, independently re-verified. → recommend CLOSE. See §6.** |
| **LIN-1249** | Backlog | **Still real, worsened.** `server.js` 2,088 → 2,542 → 3,087 → 3,756 → **3,788**; 170 commits/90d; #2 risk×churn. Kept. |
| **LIN-1250** | Backlog | **Still real.** `lib/openrouter.js` 1,875 / 35. Unchanged since the 08-23 re-weighting. Kept. |
| **LIN-1251** | Backlog | **Still real.** `lib/providers/linear/index.js` 2,326 / 36. Note the 08-23 calibration holds: much of the bulk is GraphQL template literals, so size overstates it. Kept, unchanged. |
| **LIN-1622** | Backlog | **Still real.** `CLAUDE.md:212` still carries the verbatim admission that a shared `.markdown-body` layer *"is its own task"*. Carries the 08-23 drift table. **Not rivalled.** |
| **LIN-2245** | Backlog | **Folded into LIN-2360's staging** *(operator ruling 1, binding)*. The `/api/proxy/instructions` catalog is now **714 lines at `:1778–:2491`** (686 at research, 697 at plan HEAD — still growing). Recorded as a cross-link note; **no re-verdict, no re-mint**, and its formal disposition is normal-operations bookkeeping. |
| **LIN-2246** | In Progress | **Partial by its own admission, and stalled.** Stages 1–2 delivered a genuine, held reduction (§2); stage 3 never landed and no lane is on it. Cross-linked. |
| **LIN-2247** | Done | Confirmed complete. |
| **LIN-2360** | **In Progress** | **The live owner of `routes/proxy.js`.** Stage 1 merged (`769948c5`, #1277): `lib/proxy-credential-trail.js` (106 lines), `routes/proxy.js` 7,269 → 7,180. **Stages 2–6 held pending explicit human go** (ruling `e3c0dda9`) — a hold, not abandonment. The file has grown +176 since Stage 1. See F1. |
| **LIN-2071** | Backlog | **Owner of the client↔server mirror-divergence class.** Its premise that LIN-1208 closed the ship pair is **contradicted at HEAD** — see F5. Evidence posted to it; **not rivalled**. |

---

## 5. Recorded but not promoted — every finding this run made and did not ticket

Per ticket §6c, nothing found is lost, so the next run can promote what still matters.

- **F4 — the 30-site inline `isTestMode` predicate + 5-copy `shouldMockAi`.** MED. Recorded above with the upstream "semantic divergence" framing corrected. The `import` path is proven available (`server.js:94`).
- **F6 — `routes/dashboard.js`** (2,070/53; 1,588-line closure; 553-line preamble). MED, unowned, deferred with reason.
- **F7 — `routes/dispatch.js`** (1,524/41; 22 endpoints in one closure at `:133`; 5 helpers). MED, structurally unowned, deferred with reason.
- **F8 — `lib/pipeline-loops.js`** (`_buildLoops` 384 @ `:434`, `_buildSessions` 325 @ `:972`; 45% of the module in 2 units). MED-LOW, deferred.
- **`tests/unit/prompt-templates.test.js` fixture duplication** — 4,063 lines, 61 commits/90d, **29 inline `const issue = {` literals**, 3 helpers; `tests/fixtures/` has 137 importers and no issue factory. §3a's single bounded test-maintainability finding.
- **`public/swim.js` connector duplication — re-verified unchanged, and the churn argument has now decided it.** `drawBlockingConnectors` (`:1659`) and `drawBlockingConnectorsVertical` (`:2045`), **375 lines each**, ~223 of A's lines verbatim in B, `grep -rn drawBlockingConnectors tests/` → **0**. Churn is **4 commits/90d** — the lowest of anything in this report. Real duplication under near-zero change pressure: the 08-23 run recorded it, this run re-verified it, and on the evidence it should stay unpromoted until its churn rises. *(Note: `public/swim.js` ↔ `lib/swim-lanes.js` is LIN-2071 item 1 — a different, larger finding on the same file.)*
- **Three genuinely dead exports** — re-verified: each has **exactly one reference tree-wide, its own definition**. `lib/harbour-spawn.js:42 isHarbourAvailable`, `lib/prompt-templates.js:328 getPromptCategory`, `lib/prompt-templates.js:393 getAllPromptsByCategory`. **Calibration:** the 08-23 run found 2 dead CSS classes in 4,340 lines and correctly called it a non-finding; **3 dead exports in 121,432 lines grades the same way.** Recorded, not promoted.
- **`lib/periodical-report-gate.js`'s adversarial predicate is satisfied by a comment that merely *quotes* it — found empirically during this run.** `hasAdversarialReadEvidenceComment` requires all three regexes in one body: `/Adversarial second-read verdict:\s*(AGREE|DISAGREE)\b/i` and siblings (`:116-:118`). **The Step 1 research comment on LIN-2378 satisfies all three** — not by containing a verdict, but by quoting the three patterns verbatim while *describing* the gate. `(AGREE|DISAGREE)` matches the literal text `AGREE|DISAGREE`, because `\b` holds between `E` and `|`. This run discovered it by arming a watcher on the same predicates and getting an immediate false positive on a comment written eight hours before any second-read existed, then **confirmed it against the exported function itself** — `hasAdversarialReadEvidenceComment([{body: <text that only quotes the three patterns>}])` returns **`true`**. The proposed `(?!\s*\|)` guard was checked the same way: it rejects the quotation and still accepts a real verdict.

  **Why it matters:** any periodical whose research or planning pass quotes its own Done-gate — a natural thing to do, and the 2026-08-29 run did it unprompted — pre-satisfies that gate before the work it guards has happened. The module's header already concedes it *"is not full verification"* and cannot tell a rubber stamp from a real second opinion; this is a step further, and one it does not claim: the gate can pass with **no second opinion at all**. A `(?!\s*\|)` guard on each alternation, or requiring the match outside a code span, would close it.

  **Not minted, and not because it is small.** The cap is 3 and this run's three slots went to higher-severity product findings; more importantly the module is owned by **LIN-694** and **LIN-2323** (both Done), so the correct next step is a bug against that owner rather than a rival ticket minted from a review of a different repo surface. It is arguably a *correctness* finding rather than a maintainability one and therefore slightly off this review's altitude — **recorded here in full rather than dropped, because discovering it and losing it would be the worse error.** Flagged to the operator in this run's summary comment.

- **F10 — `tests/e2e/proxy.spec.js`** (156,624; 53 repeated ≥6-line blocks over 16% of its significant lines; 3 helpers in 3,012 lines; 86% commit-coupled to `routes/proxy.js`/`routes/dispatch.js`). **The top unpromoted candidate for the next run**, jointly with the `prompt-templates.test.js` fixture finding above.
- **F11 — `lib/render.js`** (51,615; `renderDetailsContent` 317 lines at `:804`) — above F8 on the board, below the promotion line on structure.
- **`lib/render-settings.js`** (1,289/52; `renderSettingsPage` 311 lines at `:979`) and **`lib/prompt-template-defs.js`** (1,303/47) — high churn, flat template/data structure, no nesting, no duplication found. Baselines hold; still below the line.
- **`simple-dispatcher` first pass** — §3b. Recorded with a recommendation for its own lane; deliberately no LinearViewer-lane tickets.

---

## 6. Clean results and dispositions — reported as outcomes, not omitted

- **`public/observation.js` is fine.** 2,101 lines, 76 functions, largest 183. Size without structural cost.
- **`public/app.js` is fine.** 56 flat small functions, no mirror markers, its large `init*` functions shrank since 08-23.
- **The four modules added since 08-23 are healthy** — `lib/periodical-report-gate.js` 197, `routes/account-merge.js` 169, `lib/proxy-credential-trail.js` 106, `lib/account-conflict.js` 92. The house style held. **One attribution correction:** `lib/proxy-credential-trail.js` is **LIN-2360 Stage 1's deliverable** (`769948c5`), *not* an unrelated healthy new module — it is healthy, and it has an owner. *(Operator ruling 1; the research pass's §5.4 framing is not inherited.)*
- **`routes/test.js` is correctly gated.** 1,463/53 = 77,539 looks alarming on the board; it is mounted only inside `if (process.env.NODE_ENV === 'test')` at `server.js:729`. Not production surface, not a finding.
- **`public/style.css`** — the 08-23 run's verdict (essentially no dead CSS; 40 banner-delimited sections; 108 design tokens) stands; nothing in this window changed it.
- **No inline debt markers exist.** `grep -rE 'TODO|FIXME|HACK|XXX'` over `lib/ routes/ public/ server.js` returns **zero**. Debt in this repo is recorded in prose and tickets, or not at all — which is why `CLAUDE.md`'s prose admissions (e.g. `:212`) were mined directly.

### LIN-681 — independently re-verified as **resolved**; this report recommends closure

Two prior runs judged LIN-681 already resolved and recommended closing it; it is still Backlog. Ticket §2 asked this run to reach its own verdict and act, not recommend a third time. **Both halves re-verified at HEAD `b78c4499`, from source, not from the prior verdicts:**

1. **The mock arm is live.** `routes/workspace-api-roadmap.js:379 isRoadmapTestMode`, consumed at `:598`; and the inline arm at `server.js:2697`, whose own comment records the exact root cause the ticket names — *"without it this route auth-errors and the roadmap baseline silently captured the landing page."*
2. **The baselines were regenerated** — the half no prior run cited. Commit **`1d393ad6`** (*"LIN-1033: fix landing-dark + roadmap visual baselines"*) exists on `main`. Verified by file size: `tests/screenshots/pages/roadmap-desktop.png` is **86,630 B** against `landing-desktop.png`'s **443,500 B**. The roadmap baseline is no longer a copy of the landing page.

**Disposition: LIN-681 is resolved at HEAD and should be closed, citing `1d393ad6`.** It is not re-recommended, and no follow-up is minted for it.

---

## 7. Follow-ups minted — 3, at the cap, highest severity only

| ticket | finding | why this one, over the alternatives |
|---|---|---|
| **LIN-2397** | **F9** — factor the shared GitHub App OAuth/installation flow out of `routes/github-auth.js` ↔ `routes/github-projects-auth.js` | 79% verbatim duplication in **two authentication flows**; a CSRF/expiry/account-establishment fix must currently land twice. Unowned, and invisible to four prior runs of size-ranking. |
| **LIN-2398** | **F2** — decompose `lib/dispatch-store.js` (`addFeedback` 288 lines) | The **highest-ranked surface in the repo with no structural owner** (126,324, #5). Third consecutive run measuring it worsen; the 08-23 run explicitly named it as the next mint and ran out of cap. |
| **LIN-2399** | **F3** — extract the 801-line ADF↔Markdown codec from `lib/providers/jira/index.js` | 36% of a provider module is a second concern with **no production consumer at all** (its only referencers are four test files); `lib/providers/jira/` already demonstrates the split convention. The cheapest, highest-confidence structural win available. |

**Deliberately not minted, each with its reason on the record:**

- **F1 (`routes/proxy.js`)** — **LIN-2360 owns it and is In Progress.** Cross-linked, never rivalled; no `routes/proxy.js` split is re-minted *(operator ruling 1)*.
- **F5 (mirror divergence)** — **LIN-2071 owns the class.** The evidence, including the correction to its premise that LIN-1208 closed the ship pair, is posted to that ticket instead of a rival (comment `a54a9dbf`, 2026-08-30).
- **F4, F6, F7, F8** — recorded in full; F6/F7/F8's deferral reason is in §3 (three tickets for the identical class are already open and unactioned; the bottleneck is capacity, not coverage).
- **F10 (`tests/e2e/proxy.spec.js`) and the `prompt-templates.test.js` fixture finding** — **both out-rank minted findings on the corrected board** (156,624 and 247,843 against F3's 31,416 and F9's 16,647). Neither is minted because the cap was already spent when the Tier-1 adversarial read exposed the board error that hid them. **These two are the top unpromoted candidates for the next run** — see `## Adversarial Second-Read` for the full account of how this happened.
- **F11 (`lib/render.js`), `swim.js` connectors, 3 dead exports, `render-settings.js`, `simple-dispatcher`, and the `periodical-report-gate` predicate defect** — all below the promotion line or outside this review's mint channel, all recorded in §5.
- **LIN-681** — closed, not re-ticketed.

All three were created in the **Backlog** (default) state so normal operations pick them up, and each carries its own negative search showing it duplicates no existing ticket.

---

## 8. Deliberately not re-flagged — owned by a sibling review

- **Doc / contract accuracy** → **Documentation Review** (ran this window, `docs/reviews/documentation-review-2026-08-29.md`). Includes `/api/proxy/instructions` as a *documentation* surface; F1 treats it purely as 714 lines of code-file bulk.
- **Dependency direction, cross-cutting duplication, canonical-convention fragmentation** → **Drift & Coherence** (ran this window, `drift-coherence-review-2026-08-29.md`). Includes the **build-step question** — whether `public/` should import `lib/` rather than hand-mirror it. F5 reports the per-module cost only, never the architectural remedy.
- **Interface / contract shape** (55 proxy endpoints, 24 workspace-api, 22 dispatch as an *API surface*) → **API Quality**.
- **The rendered product** → **Design & Interface**. Stylesheet *structure* stays here by standing arrangement; the visible result is theirs.
- **Test adequacy / coverage** → **Test Coverage Gap**. The "2 parity tests for 15+ mirrored modules" figure is cited in F5 **only** as evidence that the duplication is unguarded — never as a coverage finding. Test-file *maintainability* is in scope here and produced §3a.
- **Rate-of-change convergence** → **Stability Review**. §1 and §2's growth figures are maintainability trend, never a convergence verdict.
- **Reader comprehension / missing rationale** → **Comprehension-Debt**. Noted in passing: rationale density is again high, and several leads resolved to non-findings *because* of load-bearing "why" comments — F4 is the clearest case.
- **Delivery drag** → **Recent Headwinds** (ran this window, `recent-headwinds-review-2026-08-29.md`).

---

## 9. Method notes — which signals earned their place

**Predictive** (a structural cost was confirmed behind the number):

- **Cross-file duplicate-block detection.** The highest-yield signal in this run and the one no prior edition ran: it produced **F9**, which four runs of size-ranking could not see because neither file is large.
- **Semantic (normalised) diffing of mirrored pairs.** Produced **F5**'s two confirmed divergences. A naive line diff would have reported the same 11 pairs and been dismissed as ES5/ES6 noise — as the research pass's own spot-check nearly did.
- **lines × 90-day churn, *paired with a unit count*.** `routes/proxy.js` 7,356/178 is real **because** 55 endpoints share one 6,676-line closure. The pairing is what makes it evidence.
- **Growth deltas on a *named unit*.** `addFeedback` 157 → 243 → 288 across three runs is a direction, which a size alone is not.

**Lead only** (produces a large number without a cost):

- **File size alone.** `public/observation.js` (2,101 lines, largest function 183) and `public/app.js` are the calibration cases.
- **Regex-derived function and handler sizes.** This run caught **three** artifacts before they reached a conclusion: `simple-dispatcher/terminal-driver.js:352 appendLaunchMetric` (scan: 445 lines; actual: **8**); `lib/dispatch-store.js:116` (scan: 2,063 lines; actually a class body); and — the one that briefly changed an answer — a `router.<verb>('…')` pattern that matched only same-line single-path registrations, finding **45** of `routes/proxy.js`'s **55** and mis-sizing every handler adjacent to one of the **10 array-form alias registrations**. **Every size figure in this report was re-derived from a complete boundary set and eyeballed at source; the one figure that a boundary error could still reach — the catalog's own span — is brace-matched instead.**
- **Naive line-diff of mirrors.** Reports "DIFFERS" for pure style; must be normalised then read.
- **Raw duplicate-line counts without a semantic read.** F4 is the cautionary case: a 30–43 site count looked like divergence and, read at source, was documented deliberate design.

**The bar this run applied.** A finding names (i) a specific `file:line` at HEAD, (ii) a *second* site or a measured delta, and (iii) a change that would be risky or a bug likely. Rejected by construction: renames, reformatting, "this file is big", ES5-vs-ES6 style, and any metric that moves without removing a decision point.

---

## Adversarial Second-Read

**Tier used: Tier 1** — a wholly separate dispatched session (dispatch `598278fe-6f6b-4765-91fe-3bd999d04ea0`) with no memory of this run: it did not see the research pass, the plan, either plan-review, the escalation or the operator ruling. It was given only the report and the repo, and re-measured the repo itself at HEAD `b78c4499`. Its answer is on LIN-2378 as comment `88e860d5` and is reproduced **in full and unedited** below. *(Tier 3 — this session re-reading its own report — was not used and is not accepted.)*

**The exact question put to it, cold:**

> **What is the largest item in this window that this report missed or misfiled?**

### The reader's full answer, verbatim


I am a **separate session with no memory of the run that wrote this report**. I did not see its research, plan, plan-reviews or operator rulings. I read `docs/reviews/code-quality-review-2026-08-29.md` on `feat/lin-2378-code-quality-review-2026-08-29` (PR #1297) and re-measured the repo myself at HEAD `b78c4499`.

**First, the calibration:** every non-test figure I independently re-measured matched exactly. The whole §1 risk×churn table reproduces to the digit. F2's method spans are right (`addFeedback` `lib/dispatch-store.js:1748`→`:2035` = **288**; `addItem` `:254`→`:435` = **182**; `_archiveItem` `:808`→`:946` = **139** — my first naive brace-counter said 260/157/70 and *it* was wrong, the report was right). F9 reproduces exactly: `routes/github-auth.js` has **302** significant lines, **241 (79.8%)** appear verbatim in `routes/github-projects-auth.js`, in **11 contiguous runs ≥6 lines totalling 86 lines**. This is a careful report. What follows is not a quibble about its arithmetic.

---

### The answer: the report's ranking instrument excludes half of its own declared remit, and the largest thing that fell through is `tests/e2e/proxy.spec.js` — never named once.

**The misfiling is structural.** §1 builds the board — the instrument every promotion, deferral and "does not out-rank" call in this report is decided against — from *"all tracked non-test `.js`/`.css`"*. §3a then rules **test-file maintainability IN SCOPE**. So the report graded a scope it had excluded from its own ranking, and substituted an unranked size-distribution argument for it (*"file length is not the predictive signal here"*). That argument was run over `tests/unit/` only. **`tests/e2e/` — 73 files, 27,873 lines — was never examined at all** (`grep -c e2e` over the report → 1 hit, and it is a passing mention of LIN-2030).

**Same metric, same command, same SHA, test files included:**

| rank | file | lines | 90d | risk×churn | in report? |
|---|---|---|---|---|---|
| 1 | `routes/proxy.js` | 7,356 | 178 | 1,309,368 | F1 |
| 2 | `server.js` | 3,788 | 170 | 643,960 | §4 |
| 3 | `routes/workspace-api.js` | 3,498 | 91 | 318,318 | §2 |
| 4 | `public/style.css` | 4,343 | 68 | 295,324 | §6 |
| **5** | **`tests/unit/prompt-templates.test.js`** | **4,063** | **61** | **247,843** | §3a/§5, **unranked** |
| **6** | **`tests/e2e/proxy.spec.js`** | **3,012** | **52** | **156,624** | **absent — 0 mentions** |
| **7** | **`tests/unit/dashboard-routes.test.js`** | **3,415** | **42** | **143,430** | **absent — 0 mentions** |
| 8 | `lib/dispatch-store.js` | 2,178 | 58 | 126,324 | **F2 — minted (LIN-2398)** |
| 9 | `routes/dashboard.js` | 2,070 | 53 | 109,710 | F6 — deferred |
| 13 | `routes/dispatch.js` | 1,524 | 41 | 62,484 | F7 — deferred |
| 16 | `lib/pipeline-loops.js` | 1,572 | 27 | 42,444 | F8 — deferred |
| 17 | `lib/providers/jira/index.js` | 2,244 | 14 | 31,416 | **F3 — minted (LIN-2399)** |
| — | `routes/github-auth.js` + sibling | 577+526 | 17+13 | **16,647** | **F9 — minted (LIN-2397)** |

**Three in-remit files out-rank the report's own #2 and #3 mints. Two of them are not named anywhere in the document.**

#### 1. The deferral whose stated reason does not hold

§3a promotes nothing from tests and states the reason: *"it does not out-rank F1–F3, F9."* On the report's own metric, of `tests/unit/prompt-templates.test.js`, **that is false** — 247,843 out-ranks F2 (126,324) by 2.0×, F3 (31,416) by 7.9×, and F9 (16,647 combined) by 14.9×. The finding may still deserve deferral, but not for the reason given, and the report could not have known because it never computed the number.

#### 2. The miss: `tests/e2e/proxy.spec.js`, 3,012 lines / 52 commits / 156,624

This clears the report's own three-part bar — `file:line` at HEAD, a second site or measured delta, and a change that would be risky.

- **145 tests, 19 `describe`s, 14 `beforeEach`s — and exactly 3 helper functions**, all three nested inside one late block: `:2487 expiresAtFor`, `:2541 seedEvent`, `:2550 seedDeadCredential`. Lines 1–2,486 (≈130 tests) have **zero** extracted helpers.
- **Ran the report's own highest-yield signal on it** — the cross-file duplicate-block detector that produced F9, pointed within one file: **53 distinct ≥6-line verbatim repeated blocks, covering 389 of 2,218 significant lines (18%)**. For scale, F9 — minted — is **11 runs / 86 lines**. This is **4.8× F9's run count and 4.5× its duplicated-line volume, inside a single file.**
- **The dominant block is a protocol contract written out 12 times**, at `:1880, :1901, :1930, :1960, :1985, :2007, :2029, :2213, :2279, :2382, :2430, …`:
  ```
  const tokenResponse = await request.get(`/test/create-dispatch-token?urlKey=${URL_KEY}`);
  const { token: dispatchToken } = await tokenResponse.json();
  const pollResp = await request.get('/api/dispatch/poll', {
    headers: { Authorization: `Bearer ${dispatchToken}` }
  });
  const { items } = await pollResp.json();
  ```
  Plus **215 hand-written `Authorization: \`Bearer ${…}\`** header lines and **37** `/test/*-proxy-token` seam calls in one file.
- **The measured coupling, which is what makes it a cost rather than a lead: 45 of its 52 commits in the window (87%) also touched `routes/proxy.js` or `routes/dispatch.js` in the same commit.** This is the test surface that every change to the repo's #1 churn file drags along. Changing the dispatch-poll contract — the exact class LIN-2160 exists to monitor on `routes/dispatch.js` — is a 12-site hand-edit here with no seam.
- **Second site, in-repo, and it is the one that settles it:** `tests/unit/dashboard-routes.test.js` is **larger** (3,415 lines, 42 commits) and has **21 named factory helpers** — `getHandler:71`, `makeReqRes:77`, `makeRouter:93`, `activeItem:51`, `historyItem:54`, `decisionItem:240`, `scopedStore:2890` … So this is **not** "tests are just repetitive." A 3,000-line test file in this repo has a demonstrated house structure; `proxy.spec.js` is the outlier against it, while importing only 2 of the 15 `tests/fixtures/` modules that **138** other test files use.
- **The growth delta.** Net **+2,483 lines in 90 days** — more than the minted F2's `lib/dispatch-store.js` (+1,686) and more than `server.js` (+2,327). Ranked by net growth in this window, **4 of the repo's top 5 files are test files** — and the instrument excluded all four.

#### 3. A smaller supporting instance of the same blind spot

`lib/render.js` — **1,147 × 45 = 51,615**, above F8 (42,444) which *was* graded — is mentioned once, only as a mirror target ("`lib/render.js` ×10"), never weighed. `renderDetailsContent` is **317 lines at `:804`**, the same shape as F8's `_buildLoops` (384). Not the headline; it just shows the pool boundary is leaking in more than one direction.

---

### What I am *not* claiming

F1 is correctly handled — it is 8.4× my item on risk×churn, but it is neither missed nor misfiled: LIN-2360 owns it, the Stage 1 attribution correction for `lib/proxy-credential-trail.js` is right, and the erasure measurement (7,180 → 7,356, +176 since Stage 1) reproduces. F9's severity argument survives scrutiny. F5's `resolveCollisions` / `computeShipDimensions` divergences are real. F3's "zero consumers" is very slightly overstated — the exports are also referenced by `tests/e2e/jira-provider.spec.js`, `tests/fixtures/jira-harness.js` and `tests/unit/proxy-jira-write-routes.test.js`, not just `tests/unit/jira-provider.test.js` — but all are tests, so the substantive claim (no consumer in `routes/`, `lib/`, `public/`) holds and the finding stands.

### Why this is DISAGREE and not a note

Two things have to change for the report to be sound as it stands: §3a's stated deferral reason is factually false on the report's own metric, and the #6 surface in the repo by that metric — inside the declared remit, tightly coupled to the #1 surface — carries no verdict at all. §3 required a recorded verdict for every in-scope surface; `tests/e2e/` never got one because §1's pool boundary silently made "in scope" and "on the board" two different things. The fix is small and mechanical: build §1's table over the whole tracked tree, then defer explicitly with reasons that hold.

I did not modify any file, open any PR, or change any ticket state.

### What this report did in response

The reader's central claim was **verified independently before any of it was written in**: the full-tree board reproduces exactly, `tests/e2e/proxy.spec.js` is 3,012 × 52 = 156,624, its 53 repeated ≥6-line blocks cover 374 of 2,218 significant lines, its three helpers are all at `:2487`/`:2541`/`:2550`, and **45 of its 52 commits (86%) also touch `routes/proxy.js` or `routes/dispatch.js`**. The criticism was correct, and is now fixed in the artifact:

1. **§1's board was rebuilt over the whole tracked tree, tests included.** The original *"all tracked non-test `.js`/`.css`"* pool silently made "in scope" and "on the board" two different things while §3a declared test-file maintainability in scope. That was the root cause of everything else the reader found.
2. **§3a's deferral reason was withdrawn as false.** *"It does not out-rank F1–F3, F9"* is wrong on this review's own metric — `tests/unit/prompt-templates.test.js` at 247,843 out-ranks F2 by 2.0×, F3 by 7.9× and F9 by 14.9×. The honest reason (the cap was spent before the corrected board existed) replaces it.
3. **`tests/e2e/proxy.spec.js` was graded as F10**, with `tests/unit/dashboard-routes.test.js` (21 named helpers) recorded as the in-repo counter-example that makes it a genuine outlier rather than "tests are repetitive", and `tests/unit/openrouter.test.js` graded clean alongside it.
4. **`lib/render.js` was graded as F11**, the reader's supporting instance of the same leaking pool boundary.
5. **F3's "zero consumers" was corrected.** The ADF exports are referenced by four test files, not one. The substantive claim — no production consumer — stands; the count did not.

**What did not change.** The reader explicitly did not dispute F1's handling, F9's severity argument, or F5's two confirmed divergences, and independently confirmed F2's method spans and F9's duplication figures. Those findings stand as written.

**The cost this leaves on the record.** F10 ranks 3rd and would have displaced F3 in the mint set had the board been correct at ranking time. The ≤3 cap was already spent, and un-minting three sound tickets to re-order them would churn the queue without changing what gets fixed — so F10 and the `prompt-templates.test.js` fixture finding are carried as the two top unpromoted candidates for the next run. **This is a real cost of the instrument error, recorded rather than smoothed over.**

### The three required fields, as the reader recorded them

The reader's own values, reproduced unaltered — this report does not get to soften its own second-read:

```
Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: escalated
```

**A DISAGREE concludes this task normally.** Per ticket §6d the disagreement *is* the escalation — visible here and in comment `88e860d5` — and is not a reason to leave LIN-2378 open pending a human. The reader recorded `Disposition: escalated` from its own vantage, before this report acted; the five amendments above are what that escalation produced.
