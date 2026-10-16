# Rung 5c score: dispatch entrance rebuild (LIN-3592, PR #1906, merged d2d7d818)

Scored 2026-10-17 by an independent replay (S/rung5c/replay). Old = pinned copies from `1f8010a0`
(byte-identical to `git show 1f8010a0:routes/…`; `git log 1f8010a0..d2d7d818` on the three files
shows only d2d7d818, and the PR's base `b3bdccaf` has the same three files). Both sides ran with
`--lib` = a temp worktree of d2d7d818 (rebuilt factory + `lib/dispatch-entrance.js`), so both use
the same rebuilt factory in private instances. New side = the three route files from d2d7d818.
No model calls, no real dispatch or mint. Worktree removed after.

## 1. Replay (all tiers: gen 6,000 + edge 3,158 + test 1,238 = 10,396 per seed)

| Run | Seed 1 | Seed 7 |
|---|---|---|
| old vs new | 543 differing, 2 groups | 539 differing, 2 groups |
| old + listed fix vs new | 349, 1 group (key order) | 340, 1 group (key order) |
| old + listed fix + key-order patch vs new | **0** | **0** |

Exports identical; 0 socket escapes. Coverage of new files (seed 1): dispatch.js 99.43% (1045/1051),
proxy-dispatch.js 99.65% (843/846), proxy-kickoff.js 100%; the uncovered lines are the same
HTTP-unreachable branches as the old files' (empty `Bearer `, unmintable broker resume,
`generatePrompt` null).

| # | Group (earliest id) | Count s1 / s7 | Before → after | Class | Reason |
|---|---|---|---|---|---|
| 1 | `POST /api/proxy/recommend-and-dispatch` `store:dispatchQueueStore` (gen:89) | 194 / 199 | override arm (`kind` set) `addItem` fields: `waitForFollowUps` `<absent>` → `false` (→ `true` when sent `true`) | **(a)** | The PR's one listed fix. The handler validates the field, its LIN-797 comment and `lib/proxy-instructions.js` say it is forwarded, and the LLM arm and `POST /dispatch` both stamp `waitForFollowUps === true`. New `tests/unit/dispatch-entrance-pins.test.js` fails 2/3 on the old file (checked), passes on d2d7d818. |
| 2 | `POST /api/proxy/dispatch` `header-derived:etag` (gen:77) | 349 / 340 | every non-cascade 201 receipt: same JSON value and length, different key order. Old `…promptName, kind, issueIdentifier, target, abort, abortTo, cascade, sessionId, maxTasks…`; new `…kind, promptName, issueIdentifier, target, sessionId, maxTasks, …, warning?, abort, abortTo, cascade` (from the shared `receiptFor(item, extra)`). ETag `W/"1bb-r//Y…"` → `W/"1bb-0QKe…"` | **(b), nominal** | The ticket never allows (c) for a 2xx body or a header, and says unsure means (b). In practice it is harmless: deep-equal JSON, no conditional request on a POST, no test or caller depends on key order (checked tests/public). Not listed in the PR. The PR's replay says it compared the bytes sent, but it missed this. |

(c) fuzz: none. (d): none. No other channel (status, refusals, `Retry-After`, `RateLimit-*`, store,
factory or closure calls, logEvent, audit, long-poll, keepalive, tokens, console, fs/tty) differed on
any request in either seed. The 2 patches: `fix-a.patch`, `fix-b-keyorder.patch`.

## 2. Shape (kit `shape.mjs`, vs S/rung5c/arm/old-shape.json)

| File | Code lines | Decision pts | Cyclomatic total | Worst unit | Functions | Units >10 | Max nesting | Longest fn (code) |
|---|---|---|---|---|---|---|---|---|
| dispatch.js | 1,150 → 1,051 | 348 → 331 | 395 → 409 | **122 → 63** (POST /dispatch, λ@483) | 46 → 77 | 8 → 6 | 5 → 4 | 1,079 → 889 |
| proxy-dispatch.js | 1,005 → 846 | 289 → 250 | 320 → 320 | **93 → 52** (recommend-and-dispatch, λ@766) | 30 → 69 | 7 → 7 | 5 → 5 | 923 → 722 |
| proxy-kickoff.js | 295 → 250 | 71 → 65 | 79 → 90 | **62 → 41** (POST kickoff, λ@206) | 7 → 24 | 1 → 1 | 4 → 4 | 279 → 233 |
| lib/dispatch-entrance.js (new) | 11 | 3 | 6 | 3 (`firstFailure`) | 2 | 0 | 2 | 7 |
| **Total** | **2,450 → 2,158 (−11.9%)** | **708 → 649 (−8.3%)** | 794 → 825 (+3.9%) | | 83 → 172 | 16 → 14 | | |

The checks are now one-line thunks in an ordered list, so the function count doubles and the
cyclomatic total rises a little while decision points fall. Worst units are about halved; the three
POST handlers are still the largest units, because the pins fix their enqueue blocks and catch chains.

## 3. Run facts

- **Files changed: 5.** The three routers, `lib/dispatch-entrance.js` (45 lines, pure:
  `firstFailure(checks)`, `opaqueFieldError(value, name, options)`, imported only by the three
  routers; it contains none of the forbidden names), and `tests/unit/dispatch-entrance-pins.test.js`
  (new, 106 lines, 3 tests). **No existing test edited.** server.js, proxy.js, areas.json and
  source-map.md are unchanged. The only new import is the helper.
- **Fixes listed: 1.** The override arm's `waitForFollowUps` (replay group 1). The PR decides the
  ticket's four named edges as "keep" (history `NaN`, favourite DELETE checks, preset error status
  by message text, 200+`statusCode` after a keepalive flush). It lists 6 dead-looking behaviours,
  kept.
- **Pins: 17/17 named source-text tests pass at d2d7d818** (worktree, repo node_modules symlinked):
  lin-3384-redaction-census 11, lin-3383-runner-enqueue-census 27, lin-3134-declared-mint-census 39,
  lin-3130-…-proxy-token-store-pin 1, run-limit-gating 11, lin-3136-enqueue-census 5,
  lin-3136-dispatch-gate 30, proxy-tokens-private-mint-source-pin 7, proxy-credential-fingerprint-stamping 6,
  proxy-endpoint-inventory-witness 81, proxy-di-witness 16, passage-runner-contract-drift 11,
  lin-3134-default-path-characterization 50, lin-3137-dispatch-token-preservation 6,
  lin-3124-pr3-checkpoint-c2 9, proxy-scopes-source-pin 5, lin-2534-tokens-admin-extraction 10.
  The 6 whole-tree scans also pass (lin-2533 14, interactive-openrouter-chain 9, urlkey-holders 12,
  import-graph 24, lin-3382 12, task-page-links 6), and so does the new pins file (3). See `pins.log`.
- **Ticket refs (unique LIN refs in comments): all kept, 0 dropped.** dispatch 68 → 69,
  proxy-dispatch 79 → 80, kickoff 37 → 38 (each +LIN-3592); 131 → 132 across the files.
  Occurrences fell only in proxy-dispatch, where duplicated comments merged: LIN-2885 6→4, LIN-805 7→6,
  LIN-3134 7→6, LIN-1175 3→1, LIN-2934 2→1. This matches the PR's §6 exactly.
- **Identical-line share (rebuilt vs edited).** Lines trimmed, ignoring blanks, brace/punctuation-only
  lines and comments (acorn). **86.7% of the new non-trivial lines (1,577/1,819) occur verbatim in the
  old files** (multiset): dispatch 86.5%, proxy-dispatch 87.2%, kickoff 85.9%. In order (diff LCS)
  it is 81.0%. **Outside the pinned blocks** (the `createDispatchItem`/`provisionResumeCredential`/
  `createToken`/`attachProxyContext` calls, `formatDispatchWatch`, the list projection; 438 lines,
  436 identical) **the share is still 82.6% (1,141/1,381).** So this reads as a heavy edit of the old
  files, mostly folding validation runs into lists and arms into shared replies, not a rebuild from the
  design. The ticket said "Don't copy handlers or blocks". Many lines (messages, destructures, store
  calls) would be identical in any faithful rewrite, so the bar is unclear, but the share is high.
- **Time:** launched ~21:58Z, Done 23:42Z = **106 min**. One PR, merged, no PR comments or reviews
  on GitHub, and no DECISION recorded.

## 4. Prediction (wt-branch …/prediction-dispatch-entrance.md, 7c6b2793) line by line

| Prediction | Actual | Verdict |
|---|---|---|
| Baseline 1,150/348/122, 1,005/289/93, 295/71/62 | reproduced | ✓ |
| ~15 test files read these files as source text | the ticket names 17 + 6 whole-tree scans; the PR counted 24 census files | low (miss) |
| Not split ~60% | one PR | hit (likely side) |
| Merges ~60% | merged | hit (likely side) |
| Done without a ruling ~30% | no DECISION, no review thread | the less-likely side happened |
| 2–5 hours | 106 min (1.8 h) | miss (faster) |
| 1,950–2,300 code lines (6–20% cut) | 2,147 routes / 2,158 with helper (−12.4% / −11.9%) | hit |
| Worst function below 60 ~60% | 63 / 52 / 41; max 63 | miss (narrow) |
| Decision points down 10–25% | −8.8% routes / −8.3% with helper | miss (narrow) |
| Replay ≥99.5% coverage | old combined 99.63%; per file dispatch.js 99.48% (old) / 99.43% (new) | hit combined, just under per file |
| No agent-visible regression ~60% | none in substance; the one non-fix diff is JSON key order/ETag on proxy-dispatch 201s | hit (nominal (b) only) |
| If one ships: duplicate guard, refusal status/code, long-poll/keepalive | none there; the only diff is in the receipt's serialization | n/a |
| ≥1 pin satisfied awkwardly ~70% | `host` and `refuse` census rows were already names in the old file; nothing awkward added that I could see (the PR says `host` is kept partly *for* the census row) | weak hit at most |

## 5. For John

- **Behaviour:** 1 real fix (as the PR claimed) and 1 unlisted, harmless change: the
  `POST /api/proxy/dispatch` 201 receipt reorders its keys (ETag changes). It is (b) only by the
  ticket's strict rule. It is worth knowing that the PR's replay says it compared the bytes sent but
  did not flag this.
- **Shape:** worst units about halved (122→63, 93→52, 62→41). Code −12%, decision points −8%,
  function count ×2.
- **Rebuilt vs edited:** about 83% of the non-pinned code lines are verbatim old lines. For this rung,
  "design-first rebuild" behaved more like a careful refactor.

Reports in S/rung5c/arm/: report-seed{1,7}.json, report-fixa-seed{1,7}.json, report-fixab-seed{1,7}.json,
report-cov-seed1.json, replay-*.log, fix-a.patch, fix-b-keyorder.patch, shape/new-*.json,
shape/new-shape-summary.json, refs-identity.json, pins.log, lines/ (identity scripts and dumps).
