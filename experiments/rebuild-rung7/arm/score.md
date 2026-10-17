# Rung 7 score: `routes/workspace-api.js` design-first rebuild (LIN-3596, PR #1908, merge 603853c5)

Old = `rung7/replay/pinned/origin-main/workspace-api.js` (16e7ae77, byte-identical to `git show`; the
file is unchanged up to the merge's parent 91fca7dd; `git log 16e7ae77..603853c5 -- routes/workspace-api.js`
shows only 603853c5). New = `git show 603853c5:routes/workspace-api.js` (`arm/new/`) + `lib/workspace-api-mocks.js`.
`--lib` for both sides = fresh snapshot `arm/snap-603853c5/` (new folder; lib/, routes/, tests/, docs/ incl.
the autopilot manual; the helper resolves from it on the new side). Repo untouched (git show/archive only).
No model, provider, harbour.cat or GitHub-write calls; PR read through the GitHub MCP tool.

## 1. Behaviour (replay seeds 1 and 7, 6,592 requests each; live tier once)
| seed | differing / requests | groups | gen / edge / test |
|---|---|---|---|
| 1 | 117 / 6,592 | 14 kinds = 3 logical groups | 26 / 70 / 21 |
| 7 | 121 / 6,592 | 14 kinds = 3 logical groups | 30 / 70 / 21 |

Exports identical (`exportsDiff: []`); no import side effects; 0 socket escapes.

| # | group (earliest id) | count s1 / s7 | before → after | class | reason |
|---|---|---|---|---|---|
| G1 | `POST /comments/:issueId`, connection-backed workspace, provider 401, `adoptConnectionCredential` throws (edge:1643) | 6 / 6 (body, console, final-handler error, content-length, etag) | `500 {"error":"Internal server error"}` + final handler `Error: connection store down` → `500 {"error":"Failed to create comment","code":"INTERNAL_ERROR","category":"internal","retryable":false,"detail":"An unexpected error occurred while preparing the page."}`; same calls, session unchanged and unsaved on both | (a) fix E2b, listed | old comment promises "exactly one exit from this catch block … the classified 500"; pinned by the new `workspace-api-pins` test |
| G2 | `GET /image?url=…&url=x` (edge:2473; s7 gen:285) | 5 / 6 (status, body, console, final-handler error, content-length, etag) | `500 Internal server error` (`imageUrl.startsWith is not a function`) → `400 {"error":"Invalid image URL format"}`; no fetch and no credential on either side | (a) fix E2d, listed | LIN-1158 (bad input is a 400, not a 500); ticket names this edge; pinned by the new test |
| G3 | `POST /scan/:id/dismiss`, `/unretire`, `/retire` 200s (gen:6, gen:9, gen:2123) | 106 / 109 (etag only) | `{…,"decision":null,"outcome":…,"outcomeBasisHash":…,"scannedAt":"…"}` → `{…,"decision":null,"scannedAt":"…","outcome":…}` | (b) harmless, key order only (scored like rung 5c's key-order row) | one shared `scanRow()` projection moved `scannedAt`; bodies deep-equal; only bytes/weak ETag of a POST change, which no browser or cache uses. Under the ticket's own comparison ("JSON deep, key order ignored") it is not a difference, which is why the worker's replay did not see it. Not unlisted behaviour; worth one line to John |

Security never-(c) areas (top severity by rule): G1 sits in "comment errors classified, never echoing the upstream
message" and G2 in "the image proxy's protections". Both differences tighten, not loosen: G1 now classifies
(body carries only the classifier's generic `detail`, not "connection store down"; log keeps
`credentialFingerprint` only, as before the throw text was logged by the final handler instead); G2 refuses before
any fetch, as the old 500 also did. No difference anywhere in: image hosts/https/`..`/redirect/raster/nosniff/
private cache/credential egress, audit 422, feedback owner gate and `dispatch` grant, session mutation, close-out
binding, free-tier clamp and 429, retire's own re-scan, store/provider/model calls, dedupe, keepalive/SSE/hang-up.

**Confirmation.** `arm/old-patched/` = old + the two listed fixes only (`arm/patch-old.cjs`, 9 lines): seeds 1/7 leave
only G3 (106 / 109). `arm/old-patched-ko/` = that + `scannedAt` moved in the three literals: **0 / 6,592 differing
on both seeds**. Nothing else remains.

**Live tier** (`arm/livetests-snap.mjs` = kit `livetests.mjs` with the snapshot as a parameter): 178 files,
5,403 tests per side; 1 file differs, `tests/unit/workspace-api-pins.test.js` (new in this PR): its 2 tests fail on
old, pass on new (the two fixes). The other 9 old failures are the known environment ones (`lin-688-undici…`,
`owner-backfill-script`), identical on both sides.

## 2. Shape (kit `shape.mjs`, acorn from `S/rebuild-exp1/kit/node_modules`; kit identical to the repo's)
| | old | new router | helper | new total | change |
|---|---|---|---|---|---|
| lines total | 4,673 | 3,764 | 316 | 4,080 | −12.7% |
| code lines | 2,816 | 1,997 | 226 | **2,223** | **−21.1%** (router alone −29.1%) |
| comment lines | 1,488 | 1,440 | 69 | 1,509 | +1.4% |
| functions | 113 | 153 | 36 | 189 | +67% |
| decision points | 769 | 538 | 51 | **589** | **−23.4%** (router alone −30.0%) |
| cyclomatic total | 883 | 692 | 88 | 780 | −11.7% |
| functions over 10 | 29 | 19 | 0 | **19** | −10 |
| worst function | 57 (feedback handler) | **31** (feedback handler, λ@3151) | 9 | 31 | −46% |
| max nesting | 6 | 4 | 1 | 4 | |
| longest function (code lines) | 2,650 (factory) | 1,541 (factory) | 31 | | |

## 3. Run facts
- Files changed: 3 (`routes/workspace-api.js` replaced; `lib/workspace-api-mocks.js` new, 316 lines, imports only
  `sample-data/mock-data.js`, `tree.js`, `workflow-config.js`, imported only by the router, no pinned names;
  `tests/unit/workspace-api-pins.test.js` new, 145 lines, 2 tests, binds 127.0.0.1). Existing tests edited: 0.
- Router imports: + the helper; − `task-decisions-store.js` (unused), − `tree.js`/`workflow-config.js` (moved to the helper).
- Fixes listed: 2 (E2b, E2d), both confirmed. Edges kept and listed as looking wrong: E1 (leaf stream no 180 s budget),
  E2a (`tryUse` throw), E2c (`/recommend/status` prefs), E3 (un-hydrated connection scope), 2 test-only escapes.
- 8 source-text pin tests (`free-tier-model-clamp-wiring`, `workspace-accesstoken-linear-egress-census`,
  `interactive-openrouter-chain-byte-identity`, `lin-3383-runner-enqueue-census`, `lin-3134-declared-mint-census`,
  `run-limit-gating`, `lin-3130-…-proxy-token-store-pin`, `lin-3124-pr3-checkpoint-c3`) run in the 603853c5
  snapshot: **103/103 pass** (`reports/pin8.log`); the wider censuses pass in the live tier.
- Ticket refs: old 106 distinct `LIN-` ids / 271 mentions; new (router + helper) 107 / 267. **Dropped: LIN-772/773**
  ("fetchRecommendationContext carries it (LIN-772/773)") although its code, the attachments forwarding now in
  `modelCallArgs`, remains; added LIN-1158, LIN-3596. 16 ids lost duplicate mentions (consolidation, e.g. LIN-1910
  8→2). The PR says "No ticket reference was dropped": one was.
- CI on head 9f5e5e0b green (CI success, Unit, E2E 1–4, secret scan; checked via MCP). 7 commits, 1 review redo.
- Timeline: launched 00:23Z; first commit 01:03Z; PR opened 01:35Z (head e22d1908); Request Changes; redo commits
  01:58–02:13Z; author reply 02:19Z; merged by John 02:27Z; Done ~02:30Z (~2h07m).

### Verbatim share (`arm/verbatim-r7.mjs`, `reports/verbatim.json`; new non-trivial lines found in old)
| definition | router + helper | router alone | longest run | lines in runs ≥10 |
|---|---|---|---|---|
| rung standard (S/verbatim: imports stripped, multiset) | **905/1,760 = 51.4%** | 52.9% | 31 | 281 |
| PR's (imports kept, membership) | 995/1,834 = **54.3%** (= PR exactly) | 55.7% (= PR) | 48 (import block) | 329 (= PR) |
| standard, trailing `;` ignored | 1,013/1,760 = 57.6% | 59.6% (membership 60.5%) | 35 | 413 |

The old file mixes styles (941 of 2,812 non-comment lines end in `;`); the new one uses semicolons throughout, so
~108 lines count as "new" only for a trailing `;` — about 6 points. Semicolon-blind, the router alone sits at the
ticket's ~60% line. Inside the 37–55% band by the PR's and the standard measure; between rung 5b (55.1%) and the
small design-first rungs (37–48%); far below rung 5c (86.1%).

### What the two reviews said and how it resolved
GitHub carries no formal review (`get_reviews` and review threads empty); both reviews are known only through the
PR body and the author's reply comment (they were posted off GitHub). **Review 1 (Request Changes, head e22d1908):**
judged it an edit: 79.3% verbatim by the reviewer's script (74.2% by the author's), 898 lines in copied runs ≥10;
asked to re-express the listed regions, name the pinned/only-way lines if still above ~60%, redo the design without
the base file open, keep the fixes, helper, test and replay, and re-run the replay. **Resolution:** the redo
(84e5be07…9f5e5e0b) re-expressed the regions; 54.3%, runs ≥10 902→329; the "design without the base file open"
condition was **not met** and the PR says so at the top. **Review 2:** re-measured independently at 54.3% router +
helper, 55.7% router alone, 291 lines in runs ≥10, and listed "What CI did not prove" (independent post-merge replay,
E1, the false `checkFreeTierGate` "never throws" docstring, the `auth.md:176` citation). The author left open
"whether ~54–60% is acceptable as a rebuild"; John merged 8 minutes later with no recorded ruling.

## 4. Prediction (`wt-branch/experiments/rebuild-rung7/prediction-workspace-api.md`) line by line
| prediction | actual | verdict |
|---|---|---|
| baseline 2,816 code / 113 fn / 769 dp / 29 over 10 / worst 57 | identical on re-run | correct |
| ~8 source-text tests | 8, all pass | hit |
| not split ~70% | one PR, 3 files | hit |
| merges ~65% | merged | hit |
| done without a ruling ~35% | no DECISION or ruling; one Request Changes redo loop; merged with the verbatim question open | hit (the likelier outcome happened against my 35%) |
| 2–4 hours | ~2h07m | hit (low end) |
| 2,300–2,650 code lines (−6 to −18%) | 2,223 combined (−21.1%), 1,997 router | miss (cut larger) |
| decision points −10 to −25% | −23.4% combined (−30.0% router) | hit (combined) |
| worst ≤35 ~60% | 31 | hit |
| verbatim 40–65% ~65%; >65% ~25% | 51.4% std / 54.3% PR at merge; first head 74–79% (an edit) caught by review | hit at merge; the >65% branch happened at the first head |
| no regression found ~60%; if one, in the escaping-500s or streaming timeouts | no behavioural regression; one harmless key-order (b); the only real changes are the two listed fixes, in exactly the escaping-500 area | hit |

## Notes for John
- Behaviour: clean. Two fixes, both in security-sensitive routes, both tighten; nothing else but a key-order change on
  three POST 200s.
- Verbatim is formatting-sensitive: adding semicolons alone removed ~6 points. Consider measuring with a trailing `;`
  stripped (or token-normalised) from the next ladder on.
- The PR's "no ticket reference dropped" claim is off by one (LIN-772/773), and the "requirements and design without
  the base file open" step was skipped twice; the review caught the first pass as an edit.
- Functions rose 113→189 while code fell 21%: small single-purpose steps, worst 57→31, 10 fewer functions over 10.
