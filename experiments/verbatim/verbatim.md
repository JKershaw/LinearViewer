# Rebuilt vs edited: verbatim line carry-over

OLD = first parent of the squash-merge commit, NEW = the merge commit. Non-trivial = trimmed, non-blank, not only `{}[]();,`, not a comment (`//`, `*`, `/*`), not an import/export-from. Multiset match on identical trimmed strings across the whole file set.

| Ticket | Method | Merge (OLD→NEW) | NEW nt lines | OLD nt lines | Matched | New verbatim % | Old surviving % | Longest verbatim run | Run location |
|---|---|---|---|---|---|---|---|---|---|
| LIN-3556 | informed rewrite | 2a07f3ea→269a6189 | 246 | 259 | 202 | 82.1% | 78.0% | 121 | lib/providers/jira/adf.js (nt-line 5) |
| LIN-3557 | clean room | 269a6189→e7f7bd57 | 231 | 246 | 31 | 13.4% | 12.6% | 3 | lib/providers/jira/adf.js (nt-line 81) |
| LIN-3565 | clean room | c2bc9a65→74e5e2ca | 247 | 259 | 48 | 19.4% | 18.5% | 10 | lib/providers/jira/adf.js (nt-line 170) |
| LIN-3566 | design-first | 74e5e2ca→65969467 | 311 | 332 | 127 | 40.8% | 38.3% | 15 | lib/render-roadmap.js (nt-line 267) |
| LIN-3569 | design-first | 65969467→06ec62b7 | 281 | 350 | 104 | 37.0% | 29.7% | 12 | routes/proxy-reads.js (nt-line 162) |
| LIN-3573 | design-first | e90b94c6→350242d5 | 502 | 731 | 201 | 40.0% | 27.5% | 39 | routes/proxy-rulings.js (nt-line 35) |
| LIN-3578 | design-first | f4749b91→4ee0a2c7 | 518 | 657 | 248 | 47.9% | 37.7% | 24 | lib/pipeline-loops.js (nt-line 71) |
| LIN-3579 | design-first | 44528462→1f8010a0 | 1736 | 2020 | 956 | 55.1% | 47.3% | 72 | lib/render-session.js (nt-line 134) |
| LIN-3580 | design-first | 1f8010a0→b3bdccaf | 525 | 592 | 243 | 46.3% | 41.0% | 36 | lib/dispatch-factory.js (nt-line 286) |
| LIN-3590 | design-first | b3bdccaf→16e7ae77 | 401 | 368 | 211 | 52.6% | 57.3% | 16 | lib/task-page-loader.js (nt-line 290) |
| LIN-3592 | design-first | 16e7ae77→d2d7d818 | 1747 | 1957 | 1504 | 86.1% | 76.9% | 151 | routes/dispatch.js (nt-line 227) |
| LIN-3591 | design-first | — | — | — | — | skipped (not merged) | | | |

NEW-side files: LIN-3556: lib/providers/jira/adf.js; LIN-3557: lib/providers/jira/adf.js; LIN-3565: lib/providers/jira/adf.js; LIN-3566: lib/render-roadmap.js; LIN-3569: routes/proxy-reads.js; LIN-3573: routes/proxy-writes.js, routes/proxy-rulings.js; LIN-3578: lib/pipeline-loops.js; LIN-3579: lib/render.js, lib/render-session.js, lib/render-swipe.js, lib/render-settings.js, lib/home-swipe-prompt-opts.js; LIN-3580: lib/dispatch-factory.js, lib/dispatch-validation.js; LIN-3590: lib/task-page-loader.js; LIN-3592: routes/dispatch.js, routes/proxy-dispatch.js, routes/proxy-kickoff.js, lib/dispatch-entrance.js
