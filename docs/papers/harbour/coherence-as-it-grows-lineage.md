# Lineage of four decisions — Harbour (`/home/user/LinearViewer`), ground `d61903f3` (2026-10-08)

Read-only reconstruction from the first-parent history of `main`, the Drift & Coherence review editions under
`docs/reviews/`, and the tracker caches (defect rows A, send-backs C, tracker-merged). Counts are month-end snapshots;
"Oct" is the ground commit. Patterns and method are at the end; events with sha/ticket/file are in `lineage.json`.

## 1. Tolerant timestamp parse — `function toMillis|toMs|_epoch(`

- **2026-05-29** — born in `lib/report-history-store.js` (`d433a2ba`, PR #291, branch `claude/amazing-meitner`; inner commits cite LIN-299): a private `toMillis(date)` that returns `NaN` for unparseable input instead of throwing. One site.
- **2026-06-24** — LIN-598 (task snapshot archives) copies it into `lib/task-snapshot-store.js`. Two sites; the shape is now a store-module convention.
- **July** — six more copies in five PRs: saved-chat-store (LIN-1008, 07-04), collective-characters-store (LIN-1048, 07-05), ship-biscuit + ship-biscuit-history (LIN-818, 07-09, two in one PR, respelled `toMs`), live-console `_epoch` (#958 / LIN-1436, 07-19), proxy-events (LIN-1586, 07-26). Eight at July-end, three spellings.
- **August** — periodical-runs `_epoch` (LIN-1827, 08-03), task-decisions-store (LIN-2197, 08-22), then three on one day, 08-23: observer-efficacy-signal (LIN-2133), escalation-kpis (LIN-1736), shelved-rulings-store (LIN-1727). Thirteen.
- **2026-08-28** — the tolerance becomes a defect: Bug LIN-2358 (`computePlanReviewRoundTrips`) finds `options.rulerChangeAt` passed straight to `toMs`; `NaN` is not `null`, so the contamination branch runs and always reports `0`. Closed 09-05 by validating the one caller — the parse itself unchanged.
- **September** — flat at 13; no review edition tracks this decision (zero mentions in `docs/reviews/`).
- **2026-10-01 → 10-05** — seven new copies in five days: file-pointer (LIN-3200), task-mode-store (LIN-2942), run-view (LIN-3250), run-proposals-store (LIN-3254), milestone-funnel (LIN-2952), guest-run (LIN-3312), share-run-reader (LIN-3313). **2026-10-06** LIN-3325 deletes the last two with their modules. Eighteen at ground: `toMillis` ×10, `toMs` ×6, `_epoch` ×2, eighteen files, none exported.
- **Touches** — nine PRs since June edited within ±15 lines of an existing copy, never more than two at once; the copies drift independently (two take a `date` parameter, sixteen a `value`).
- **Consolidation** — none proposed. The only other mention is a code-review send-back on LIN-1684 (08-01) that cites `toMillis` as a sort key — incidental.

## 2. Page-shell option bag — `deployInfo: getDeployInfo()` in a route

- **2026-01-18** — `getDeployInfo()` is born in `server.js` (PR #65, footer requirements); **2026-02-08** `server.js` first passes `deployInfo: getDeployInfo()` into a page renderer (`c946d9cf`, #145). By May-end `server.js` has five such lines; **no route file has one** (the brief's "one in May" does not reproduce under a routes-only scope — the May site is in `server.js`, which is reported separately).
- **2026-06-13** — birth in a route: LIN-450 (Collective yap experiment) copies the `server.js` bag into `routes/collective.js`; LIN-450's follow-up PR #456 touches it the same day (the one "touched all sites" PR, trivially, at one site).
- **2026-06-15** — task-chat (#471) and dashboard (LIN-509) copy it; **06-24** next-run (LIN-603). Four at June-end: every new experimental page starts from a copied render call.
- **July** — flight-companion (LIN-922, 07-03), a second dashboard site (LIN-1003, 07-04), ship-biscuit (LIN-818, 07-09), live-console (#958, 07-19), task-edit (LIN-1565, 07-25). Nine.
- **2026-07-17** — the copied value breaks: LIN-1385 "footer deploy info is blank in production — reads Heroku-only env vars after the Railway migration" extracts `getDeployInfo()` to `lib/deploy-info.js` (`a7faf17a`, #940) without touching any caller. The same day LIN-1388 is filed: "5 `deployInfo` JSDoc sites still document the source as Heroku" — the copies carried stale documentation with them. Its plan review (08-01) sends it back for missing `dyno` siblings; fix `636148ef` (08-01) rewrites 7 files.
- **August** — passage-planner (LIN-1849, 08-03), ship-journey (LIN-1685, 08-09), task-create (LIN-1973, 08-09). Twelve. **September** — flat.
- **October** — runner-setup (LIN-3098, 10-01), task-page (LIN-3329, 10-06). Fourteen in routes, eight in `server.js`.
- **Touches** — 28 PRs since June edited near a site; the three `task-*` routes move together (LIN-3240 touched 3 of 13 on 10-02, LIN-3335 4 of 14 on 10-07), confirming they are one copied block maintained by hand.
- **Consolidation** — the helper exists and is the thing being copied; nothing builds the option bag itself, and no review edition tracks it. Two direct tickets (LIN-1385, LIN-1388), one incidental mention (LIN-1503 code review lists `getDeployInfo()` as a moved line).

## 3. Hand-rolled workspace lookup — `urlKey === urlKey`

- **2026-01-20** — PR #100 (LIN-100, `000531a5`) adds the canonical `getWorkspaceByUrlKey(session, urlKey)` to `lib/workspace.js`. **The very next first-parent commit the same day**, a direct push `71395df9` ("Fix multi-tab workspace support by using URL-based workspace selection", no PR), writes `workspaces?.find(w => w.urlKey === urlKey)` three times in `lib/render.js`. The renderer holds a bare array, the helper wants a session: the decision is born hours after its canon, around the canon's signature.
- **2026-01-29** — navbar extraction moves two of the three (`06cb822b`). **03-06** LIN-193 (#166) adds one in `server.js`; **03-27** #216 another; **05-24** render-roadmap (#274). Six at May-end.
- **2026-06-09/10** — LIN-335 (+3: render-foreman, render-swipe, render.js) and LIN-356 (+2: render-ship, render-swim) copy the full `getProviderForWorkspace(workspaces?.find(...))?.ui?.displayName || 'Linear'` incantation. **06-10** the first Drift & Coherence edition names it `provider-resolution-incantation` (Low, "8× across 6 files"); 06-11 re-grounds to 5; 06-25 to 4 after LIN-498 (06-15) drops the `server.js` site and LIN-451 (06-16) retires foreman. Nine by the review-command pattern at June-end.
- **July** — it escapes the renderers into the credential layer: workspace-title-resolver (LIN-962, 07-04), then `lib/workspace-token-resolver.js` on 07-16 (LIN-1366, +2, "resolve the token owner-blind — fail closed"), 07-19 (LIN-1373), 07-20 (LIN-1413), 07-23 (LIN-1524 and #990). Fifteen.
- **August** — LIN-1986 (08-14) folds the title resolver into the token resolver (a move); LIN-2235 (08-23) adds the eighth token-resolver site. **08-29** review: "worsened sharply, 4 → 16"; it mints **LIN-2389** — change the helper to accept a workspaces array, "the fix is the helper's shape, not 16 call-site edits". LIN-2389 is absent from the tracker cache and no commit cites it: it never landed.
- **2026-08-30** — LIN-2412 adds `located.urlKey === urlKey` in `lib/openrouter-key-resolver.js`. Seventeen; the **09-26** review confirms 17 and names LIN-2389 "the standing fix".
- **2026-09-29** — LIN-3124 PR1 (`b45a390e`) lands a count pin, `tests/unit/lin-3124-pr1-count-pins.test.js`: `w?.urlKey === urlKey` expected **16**.
- **2026-10-01** — LIN-3186 adds a site in `lib/superseded-selection.js` with the variable named `candidate` and a comment: "Named `entry`, not a `w`-suffixed identifier: the `urlkey-lookups` count pin … counts `/w\??\.urlKey === urlKey/`, and this module must not move that baseline." **10-03** LIN-3282 adds `r.urlKey === urlKey` in `lib/connection-credential.js`. Nineteen at ground; the pin still reads 16.
- **Touches** — 42 PRs since June edited near a site, never more than 3 of 18–19; the eight token-resolver copies were each touched separately.
- **Consolidation** — canon before birth (never fitted the call sites), a review ticket never worked, and a pin that froze the spelling rather than the decision.

## 4. Inline error envelope — `res.status(4xx|5xx).json(`

- **2026-01-11** — born in `server.js` (`4d9150d6`, #10, three sites); 20 by 01-16. **01-18** `lib/errors.js` becomes canon (LIN-36, #55) with 20 inline sites already behind it.
- **2026-01-20** — LIN-66 (#104) creates `routes/dispatch.js` with 30 inline envelopes, two days after the canon, importing nothing from it. **02-08** #143 moves `server.js` handlers into `routes/` (71). **03-06** LIN-193 creates `routes/proxy.js` with 77. Spring growth is in the big three — 306 at May-end, 10 of the last 11 May PRs adding to workspace-api or proxy.
- **2026-06-10/11** — the first review names `routes-error-envelope-fragmentation` (Medium): 239 inline, one importer; 06-11: 246, and LIN-417 (`dbdfc33c`) puts the structured `{error, code, retryable}` envelope into canon and wires proxy to it (−26). It mints **LIN-420**.
- **2026-06-13 → 06-24** — while LIN-420 is open, four new routes copy the inline idiom: collective (LIN-450, +15), task-chat (#471, +10), dashboard (LIN-509, +13), next-run (LIN-603, +5).
- **2026-06-18** — LIN-420 (`8fadcb9b`, #505) sweeps proxy, workspace-api and dispatch: **357 → 53**, touching 304 of 357 sites — the only sweep in the history. 61 at June-end; the 06-25 review calls the residue "a new, smaller frontier" of the four newer routes.
- **July** — task-chat +9 (LIN-1008), ship-biscuit +5 (LIN-818), live-console +2 (#958). 74. Bug LIN-1158 (07-09): malformed JSON body returns an unhandled 500 — fixed inside `lib/errors.js`, so only the canonical path got it.
- **August** — 76 at the 08-29 review's `292ac962`; the review flags `dashboard.js` as a half-adopter (imports `jsonError`, converted 0 of 17). Bug LIN-2363 (08-29): `autopilot/kickoff` "builds its 401/503 error envelope inline rather than via `graphqlErrorDetail`" and leaks Linear-named detail to non-Linear providers — the decision named as the cause.
- **08-30 → 09-11** — openrouter-auth +2 (LIN-2412), flight-companion +8 across LIN-2432/2622/2623, written from scratch beside its own `import { jsonError … }`. 87 at the 09-26 review ("+11, all in code written this window"; importer count 14 → 26 dismissed as a file-split artifact of LIN-679).
- **09-29 / 10-02** — runner-kit +2 (LIN-3098), task-chat +4 (LIN-3254, whose code review praised envelopes that "match the old `jsonError` output byte for byte"). 93 at ground: task-chat 24, dashboard 17, collective 15, flight-companion 8, server.js 8.
- **Touches** — 118 PRs since June edited near a site; none touched all, and only LIN-420 touched more than 25.
- **Fixes and complaints** — five review editions, LIN-417, LIN-420, LIN-1158, LIN-2363 direct; send-backs on LIN-1886, LIN-2025, LIN-3254 argue envelope shape; eight further defect rows cite `lib/errors.js` only as a file reference (incidental).


## Summary table

| decision | birth | sites May/Jun/Jul/Aug/Sep/Oct (month-end; Oct = ground) | PRs that touched a site (since June) | PRs that touched all sites (max touched/existing) | fixes/complaints naming it | helper added | sites deleted after |
|---|---|---|---|---|---|---|---|
| Tolerant timestamp parse | 2026-05-29 `d433a2ba` #291 (lib/report-history-store.js) | 1/2/8/13/13/18 | 9 | 0 (max 2/20) | 1 direct (LIN-2358) + 1 incidental | none | n/a — no helper. 2 sites deleted 2026-10-06 (LIN-3325 removed guest-run/share-run-reader), not a consolidation |
| Page-shell option bag (deployInfo: getDeployInfo()) | 2026-06-13 `2b7ad939` LIN-450 (routes/collective.js) | 0/4/9/12/12/14 (server.js: 5/7/7/8/8/8) | 28 | 1 (max 4/14) | 1 direct (LIN-1388) + 1 incidental | 2026-01-18 #65 server.js; 2026-07-17 LIN-1385 lib/deploy-info.js | 0 — LIN-1385 moved getDeployInfo() to lib/deploy-info.js; all 9 then-existing route sites kept the literal `deployInfo: getDeployInfo()` |
| Hand-rolled workspace lookup (urlKey === urlKey) | 2026-01-20 `71395df9` no PR (lib/render.js) | 6/9/15/17/17/19 | 42 | 0 (max 3/10) | 4 direct (LIN-2389, review 2026-06-10, review 2026-06-11, review 2026-06-25) + 1 incidental | 2026-01-20 LIN-100 lib/workspace.js; 2026-09-29 LIN-3124 tests/unit/lin-3124-pr1-count-pins.test.js | 0 — LIN-2389 never landed; the LIN-3124 pin (expected 16) froze the `w`-form only and was dodged twice by renaming the variable (19 at ground) |
| Inline error envelope (res.status(4xx|5xx).json) | 2026-01-11 `4d9150d6` #10 (server.js) | 306/61/74/82/89/93 | 118 | 0 (max 304/357) | 11 direct (LIN-1158, LIN-1886, LIN-2025, LIN-2363, LIN-3254, LIN-417, LIN-420, review 2026-06-10, review 2026-06-25, review 2026-08-29, review 2026-09-26) + 16 incidental | 2026-01-18 LIN-36 lib/errors.js; 2026-06-18 LIN-420 routes/proxy.js, routes/workspace-api.js, routes/dispatch.js | 304 deleted by LIN-420 (357 → 53 on 2026-06-18); +40 new inline sites written since, in files that mostly import lib/errors.js (dashboard, flight-companion, task-chat) |


## Patterns and method

Patterns (all run as `git grep -nE <re> <sha> -- server.js lib routes public`, classified in `classify()`):

- D1 Tolerant timestamp parse: `^\s*function (toMillis|toMs|_epoch)\(` in server.js, lib/, routes/, public/ (public/*.min.js excluded as vendored). Given by the brief.
- D2 Page-shell option bag: `deployInfo: getDeployInfo\(\)` in routes/ only (14 at ground). server.js carries the same literal (8 at ground, first 2026-02-08) and is reported separately, not counted. Given by the brief.
- D3 Hand-rolled workspace lookup — derived from the review's own command `grep -rn "urlKey === urlKey" lib/ routes/ server.js`: `urlKey === urlKey` in lib/, routes/, server.js, minus comment lines and minus the canonical helper body (`session.workspaces.find` in lib/workspace.js). Reproduces the review's 16 at 292ac962 and 17 at b5c528c4 exactly. The 06-25 edition's "4" counted only the renderer `getProviderForWorkspace(workspaces?.find(w => w.urlKey === urlKey))` incantation; this pattern gives 9 at d9c51da (navbar 2, render.js 2, render-roadmap 1, server.js 1 extra).
- D4 Inline error envelope — the review's stated command `grep -rnE "res\.status\(4[0-9][0-9]\)|res\.status\(5[0-9][0-9]\)" routes/*.js server.js | grep "\.json(" | grep -v routes/test.js`: `res\.status\([45][0-9][0-9]\)` and `.json(` on the same line, in routes/*.js (no subdirectories) + server.js, routes/test.js excluded. Reproduces the review's 76 at 292ac962 and 87 at b5c528c4 exactly.

Method: first-parent walk of d61903f3 (1,824 commits, 2026-01-04 → 2026-10-08), one `git grep` per commit; a "site" event is a per-file count increase between consecutive first-parent snapshots (a per-snapshot diff, equivalent to `git log --first-parent -S` but file-attributed); a "touch" is a first-parent commit since 2026-06-01 whose `git diff -U0 parent..commit` hunks overlap ±15 lines of a site that existed in the parent. Tickets come from the merge subject (`LIN-\d+`); when the subject carries none, the inner commits of the merged branch were read by hand (D1 birth #291 → LIN-299; #958 → LIN-1436). Fixes/complaints: regex scan of results/A/input.json (title, description, reason, comments), results/C/input.json send-back bodies and data/tracker-merged.json (title, description); each match hand-classified direct/incidental from its context. Review-edition rows were read from docs/reviews/drift-coherence-review-*.md.

Reproduce: `python3 -I lineage.py --repo /home/user/LinearViewer --ground d61903f3 --out <this dir> --defects results/A/input.json --sendbacks results/C/input.json --tracker data/tracker-merged.json` (≈3 min; writes lineage.json, snapshots.json, lineage.md = narratives.md + this table).
