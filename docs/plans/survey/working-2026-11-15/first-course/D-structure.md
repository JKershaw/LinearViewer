# D — Structure: areas, rebuild evidence, cut candidates

Measured at `origin/main` = `6f6c5d2e2` (wt-main HEAD, 14 Nov). Paths are under `wt-main/`. **S13** = `docs/reviews/seams-tangles-review-2026-11-14-run13.md`; **D8** = `docs/reviews/drift-coherence-review-2026-11-14.md` (both measured `fb358dbda`, S13:30); **P/** = `docs/papers/harbour/`. My scripts: `scratchpad/course/tmpD/{areas,features}.mjs`.

## 1. Area table

`docs/areas/areas.json` has **13** areas, not 12. It maps code only, not tests (`docs/areas/README.md:16`), so the test columns are my heuristic: a test file goes to the area it imports or names most. 231 of 1,446 test files (59,219 lines, mostly e2e) stay unattributed. Commits = first-parent changes since 31 Oct (202 in all). Waiting: "old" means the cited file existed at `e63c2f69d`, 7 Nov (`gen/waiting-age.mjs:3`).

| Area | Source files / JS lines | Unit tests files / lines | Commits 14d | Waiting all-old / old+new / first-new | Rebuild readiness (S13:347-361) |
|---|---|---|---|---|---|
| Runs & dispatch | 120 / 45,825 | 331 / 124,529 | 72 | 10 / 5 / 9 | Not ready: F1, F4 |
| LLM & prompts | 95 / 27,784 | 162 / 51,491 | 67 | 5 / 3 / 6 | Not ready: F1 |
| Front end: browser | 44 / 35,236 (+21,414 CSS) | 54 / 21,180 | 33 | 9 / 3 / 0 | Needs 67 global writes retired |
| Front end: pages | 94 / 21,912 | 134 / 25,348 | 26 | 13 / 0 / 2 | Ready within its area |
| Auth, accounts, workspaces | 64 / 19,081 | 154 / 51,946 | 7 | 4 / 0 / 0 | Ready as a seam |
| Web routes | 38 / 16,052 | 78 / 20,419 | 31 | 7 / 0 / 0 | Ready as a routing layer |
| Agent API | 33 / 14,334 | 144 / 38,260 | 54 | 7 / 5 / 0 | Ready once F4, LIN-4155, table home settle |
| Providers | 38 / 13,986 | 58 / 22,920 | 9 | 3 / 2 / 1 | Ready except F3 |
| Reports & operator tools | 15 / 5,433 | 16 / 5,329 | 13 | 2 / 0 / 7 | Ready; small |
| Wiring (`server.js`) | 1 / 4,771 | 9 / 967 | 17 | 1 / 1 / 0 | Only after LIN-1249 |
| Platform & plumbing | 25 / 4,725 | 34 / 7,182 | 13 | 7 / 0 / 0 | Ready as a leaf |
| Other features (catch-all) | 16 / 2,496 | 24 / 5,286 | 23 | 3 / 2 / 1 | Not a unit of rebuild |
| Task model | 2 / 591 | 2 / 930 | 1 | 0 / 0 / 0 | Ready; healthy leaf |

**What the reviews say.**
- **Runs ⇄ LLM (F1)** is the one High knot: 41/61 imports, worse in count, better in kind (S13:200-216). Agent API ⇄ Runs is the top co-change pair, 135 (S13:387).
- **Agent API ⇄ Web:** two HTTP lanes into one domain; every new door is wired twice; co-change 78 → 87 (S13:247-253). The create-field rule is split across them (D8:137).
- **Providers:** Jira imports the 1,428-line Periodical engine for one regex (S13:259).
- **Catch-all:** `lib/stage-writes.js` became a three-area table with no home (S13:231-245).
- **Hubs:** `server.js`, 205 outbound imports (S13:147); `lib/dispatch-store.js`, 4,571 lines (S13:143).
- **Duplicated rules:** 32 census groups ruled real (D8:68). The new rows share one shape: a new home claims every caller, and one caller keeps its own rule (D8:11, rows at D8:98-104).
- **D8 verdicts:** Runs, LLM, Agent API better; browser, pages, providers, web/wiring/platform neutral (D8:15-22).
- **A written purpose per area: not found.** Notes hold Lessons and Waiting only (`docs/areas/README.md:31-33`).

## 2. Candidate large moves, ranked

| # | Move | Size | Would remove | Readiness | Risk |
|---|---|---|---|---|---|
| 1 | **Cut experimental views** (§4) | 7 views ≈ 18,500 source lines (JS+CSS), ≈ 27,000 test lines; ≈ 8,900 / 10,200 without `/ship` and Flight Companion | 5 Waiting; browser lines ahead of move 5 | Deletion needs no replay. One list gates them (`lib/feature-defaults.js:132-139`) | `/ship` is "not a retirement candidate" (`docs/view-tiers.md:74`). No usage data |
| 2 | **Providers rebuild**, staged | 13,986 lines; pilot on GitHub Projects (P/theseus.md:48) | F3; the write-envelope helper; 6 Waiting | Clearest seam (P/theseus.md:29); quiet (9 commits). Prerequisites unmet at HEAD: `lib/providers/linear/` holds only `index.js` (no fake client); no conformance suite found in `tests/unit`; `normalizeWritePayload` still called (`routes/proxy-writes.js:339,517,616`) | Linear is the default and least ready (P/theseus.md:199); 62% of the block is reason-comments (P/theseus.md:229) |
| 3 | **One write pipeline for the two HTTP lanes** | `routes/proxy-writes.js` 1,036 + `routes/workspace-api-issue-write.js` 886 lines, plus the feedback lane | `seam:two-http-lanes`; the `docs/areas/web-routes.md:25-29` entry | Replays exist for both sides (`experiments/rebuild-rung4`, `rebuild-rung7`); size already tried | Security checks pinned by text tests (P/consolidate-then-rebuild.md:124) |
| 4 | **`server.js` decomposition** (LIN-1249, Backlog) | 4,771 lines | The 205-import hub; 2 Waiting | 967 test lines attributed; 1.7× the largest rebuild tried | Composition root; 17 commits in 14 days |
| 5 | **Browser code to modules** | 35,236 JS lines; 67 `window.X =` writes (S13:271) | F6; 12 Waiting (9 old) | Order is written (`docs/areas/front-end-browser.md:16,30`); 5 pages done (S13:273) | 11 co-change pairs with no import link (S13:391) |
| 6 | **Runs/LLM core** (F1, `dispatch-store.js`) | 45,825 + 27,784 lines | F1, F4; 38 Waiting | Not ready (S13:349-350); 72 and 67 commits; 15 Waiting cite files born since 7 Nov | Each new home adds edges to the knot (S13:244) |

Cheap placement moves, independent of the above: `should-mock-ai.js` to Platform removes 17 cross-area edges (S13:319); a home for `stage-writes.js` is an owner's decision (S13:244).

## 3. What the rebuild experiments showed

| Round (`experiments/`) | What | Code lines | Time | Passed? | Lost or changed |
|---|---|---|---|---|---|
| Informed rewrite (`rebuild-exp1`) | Jira codec | 322 → 302 | 37 min | 0 differences on 59,718 calls | Nothing; 82% verbatim, an edit (P/rebuild-round.md:87) |
| Clean rooms (`rebuild-exp1`, `-exp2`) | Same codec | ≈ 300 | not found | **Unreliable**: all passed tests; 1 of 4 changed 345 of 1,037 real texts (P/rebuild-ladder.md:50) | Display regressions |
| Design-first, `rebuild-rung2`–`4` | Roadmap page, proxy reads, proxy writes | 375, 448, 929 | 37–60 min; rung 4 took 5 h 17, split in three (P/rebuild-ladder.md:89-90) | No visible regression; 9 bugs found (P/rebuild-ladder.md:14-23) | — |
| Design-first, `rebuild-rung5a`–`7` | 7 chunks, up to `workspace-api.js` | 441 – 2,816 | 50 min – 2 h 33 | All merged; 12 bugs fixed (P/rebuild-round.md:14-17) | 2 JSON key-order changes (:63); 17 ticket refs dropped (:184); 3 of 7 drifted to editing (:22); knots 19 → 20, decisions did not move (:112-127) |
| Consolidate then rebuild (`consolidate-*`) | Dispatch entrance, 3 knots, 1 marker | 8 tickets | One day, two ruling presses (P/consolidate-then-rebuild.md:160-166) | 0 replay differences; knots 20 → 16; sites 95 → 26; worst function 63 → 29 → 13 (:50-55, :94) | Freeing the seam cost most: 2 h 34, 139 tests (:50) |
| `theseus-method-trial` | simple-dispatcher, up to the ticket | — | — | Nothing filed (P/theseus-method.md:185) | — |
| LIN-4447 / LIN-4448 (Nov) | Consolidating Runs; LLM | — | — | Blind area reads: "no detectable difference", twice (`docs/plans/survey/area-read-reports/comparison-*.md:3`); D8 reads both "better" (D8:33) | — |

**Preconditions of the method that worked:**
1. Gather the decision into one owner first; a rebuild alone does not move decisions (P/theseus-method.md:32; P/rebuild-round.md:127).
2. Free the seam: a behaviour test lands and is shown failing before each text pin loosens (P/theseus-method.md:106). Pins are "the main drag" (P/rebuild-ladder.md:84).
3. Design-first with the old code visible; never a clean room alone (P/rebuild-ladder.md:14-16).
4. An independent replay built before the work, self-checked, two seeds (P/theseus-method.md:138).
5. A verbatim-share Done-when line, about 60%, enforced by review (P/rebuild-round.md:97).
6. One PR, not split (P/rebuild-round.md:68-69); an area named for every new helper (:118).
7. End in deletion: all 5 knots that ever dissolved did so by removal (P/theseus.md:110); helpers half-finish, "deletion finishes" (P/coherence-as-it-grows.md:137-148).

## 4. Cut candidates

Tiers: `docs/architecture/views.md:5`. Sizes come from filename patterns; shared code is not counted. **No per-feature usage evidence was found** in the repo or papers. `never-worked-pile.md` and `capability-ledger.md` are about tickets and models, not features.

| Feature (tier) | Source lines | Test lines | Waiting | Commits 14d | Evidence |
|---|---|---|---|---|---|
| Flight Companion (experimental) | 5,853 | 14,060 | 1 | 10 | Actively changed; no usage data |
| Collective + Yap (experimental) | 3,450 | 3,389 | 1 | 1 | "Rough-draft experiment" (`docs/architecture/experiments.md:5`) |
| Ship, radial (experimental) | 3,785 | ≈ 2,700 | 2 | 1 | Protected (`docs/view-tiers.md:74`) |
| Ship's Biscuit (experimental) | 2,000 | 1,950 | 1 | 6 | None |
| Ship Journey (experimental) | 1,554 | 2,575 | 0 | 2 | None |
| Task chat (experimental) | 1,626 | 2,055 | 0 | 3 | None |
| Passage planner (experimental) | 279 | 201 | 0 | 1 | None |
| Roadmap (flagged) | 5,116 | 5,198 | 0 | 3 | None |
| Live Console (promoted, opt-out) | 4,298 | 5,990 | 1 | 2 | None |
| Jira provider | 5,149 | ≈ 11,300 | 7 | 5 | John "is the only Jira user" (P/fleet-complexity-read.md:37) |
| Scan / audit / library / custom prompts (untiered) | 2,444 / 1,596 / 1,486 / 696 | ≈ 5,700 / 1,350 / 920 / 509 | 2 / 0 / 2 / 0 | 2 / 2 / 2 / 1 | None |
| Swim (first-class) | 5,380 | 2,657 | 0 | 1 | None; quiet |

## 5. Order constraints

- **Cuts before the browser move (1 → 5):** the views own large `public/` files (`flight-companion.js` 2,204, `ship.js` 1,859 lines).
- **Consolidate and free the seam before any rebuild** (P/consolidate-then-rebuild.md:81; an inference from one case).
- **Providers:** schema → Linear fake → conformance suite → writes agree → pilot (P/theseus.md:42-48); settle which files belong in the block first (P/drawing-the-ship.md:228).
- **Move 3 before move 4:** `server.js` mounts both lanes.
- **Move 6 waits:** Agent API, Runs and LLM are where merges queue (S13:389).
- **Parallel, no shared files:** move 2 (`lib/providers/`), move 1 (view files plus `lib/feature-defaults.js`), and the map-only moves. Moves 3, 4 and 6 share `routes/proxy*.js` and `server.js`, so they run in sequence.

## 6. Unknowns

- Usage of any feature: not found.
- Whether a rebuild above 2,816 code lines works: the whole Agent API was proposed, not run (P/rebuild-ladder.md:154).
- Whether consolidation makes later changes land smaller: untested (P/consolidate-then-rebuild.md:203; P/theseus-method.md:181).
- Text pins per area at HEAD: not measured. A rough grep finds 187 `tests/unit` files reading production source.
- Providers prerequisites were checked by filename only.
- `P/prototype-concepts.md` and `P/one-feature-twice.md` hold no rebuild evidence.
