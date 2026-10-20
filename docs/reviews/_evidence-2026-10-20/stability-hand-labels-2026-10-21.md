# Stability Review 2026-10-21: hand labels for `corrective-vs-additive-ratio`

Census (not a sample) of the 171 LV first-parent landings 2026-10-12..HEAD (`f25aa127`). Rule: **C** = the title states a
previously wrong behaviour being corrected (bug, contradiction, security gap, failing-open path, drift between runner kit and SD).
Features, rebuilds, moves/consolidations, reviews, papers and docs are **A**. The rule is liberal (it counts security gap-closes).
Labeller: the report-writing session; one pass, not independently double-labelled.

**Result: 52 C of 171 = 30.4%.** Broad title classifier on the same 171: 8 (4.7%).

Prior-window comparison was **not** labelled: 80% of prior-30 landings (312/391) carry a `Merge pull request ... branch-name` subject, which cannot be
labelled from the subject. See the report's `corrective-vs-additive-ratio` finding.

| label | landing |
|---|---|
| A | f25aa127 LIN-3740: Code quality review 2026-10-20 (docs-only) (#2026) |
| C | 9b2955cc LIN-3739: read the /kpis rate view off its own payload; pin the empty note from a seeded one (#2025) |
| A | 6be536c5 LIN-3735: Seams & Tangles review 2026-10-20 (first delta vs 2026-10-13) (#2024) |
| A | 9fe21b91 LIN-3715: replace documentElement.scrollWidth overflow checks with geometry assertions (#2023) |
| C | 61d7f345 LIN-3733: cap the KPI running total's through at the rollup marker (#2022) |
| A | 6d3b5cfd docs/incidents: MongoDB 8.0 kernel CI incident and Railway build pause (#2021) |
| A | b815a930 LIN-3732: KPI daily rollup, part B: running totals and a rate/total toggle on both KPI pages (#2020) |
| A | 1259e49c LIN-3727: focus-child picker moves from tree.js to recommendation-facts.js (#2019) |
| C | b074b849 LIN-3725: run page follows the sessionId hop for stopAt (#2018) |
| A | facd92f4 LIN-3730: area map: a "Reports & operator tools" area for Platform's observer files (#2017) |
| A | d2da45a3 LIN-3724: KPI daily rollup, part A: daily records, daily job, backfill script (#2013) |
| A | 88f2686e LIN-3728: follow-up targeting moves from chat-tools.js to follow-up-dispatch.js (#2016) |
| A | 272d1458 LIN-3729: area map: proxy-fetch to Platform, openrouter-key-resolver and guest-task-path to Auth (#2014) |
| A | a2fe3819 LIN-3726: move periodicals test fixture to tests/fixtures (#2015) |
| A | c5295b42 LIN-3713: record PR opened/merged times; workspace time-to-merge card (#2012) |
| C | e0c00e72 LIN-3723: fix stale comments/docs after the LIN-3717 move (#2011) |
| A | 0da144c8 LIN-3711: workspace KPI page trend charts (#2009) |
| A | 37be33d7 LIN-3720: area map: assign the 13 lib/ files left in "Other features" (#2010) |
| A | 8ddb0f3b LIN-3722: one stopAtFromRows rule shared by task-run-facts and the run page (#2008) |
| A | d10e7398 LIN-3717: loop-terminal checks to lib/run-loop-state.js, census seed to lib/flight-companion-census-seed.js (#2007) |
| A | 71a42131 LIN-3714: public /kpis cost per finished task, caveats in the fold (#2006) |
| A | 7ea6d82a LIN-3718: one Runs-owned dispatch-id pattern, three copies removed (#2005) |
| A | 67fd50ae LIN-3716: area map: close-out-readiness.js to Runs & dispatch, question-card.js to server-rendered pages (#2004) |
| A | 39cd7624 LIN-3712: KPI daily rollup design note (running totals, rate/total toggle) (#2002) |
| A | c1d5c700 LIN-3710: public /kpis trend charts and a shared chart helper (#2003) |
| A | 8f39afd8 LIN-3708: area map: account-erasure.js is an operator data tool (Platform & plumbing), not Auth (#2001) |
| A | a6e0ae11 LIN-3700: write each workspace's urlKey to the registry when it is created or bound (#2000) |
| A | 0eb4a2d1 LIN-3706: rebuild the free-tier plan and allowance as one seam (design-first) (#1999) |
| A | 331683f3 LIN-3692: send HSTS, default to no-store, build absolute URLs from one public origin (#1998) |
| A | b0bc3445 LIN-3688: pin fetchAndPrepareProjects passing the matched team id to fetchProjects (#1996) |
| C | 956f43c2 LIN-3685: waitLoop classifies a failed wake root read (credential/network) instead of escaping (#1997) |
| A | a9f81290 LIN-3703: rebuild the public /kpis page design-first, with a small-count floor (#1995) |
| A | 3dfffe63 LIN-3423: deletion by request, two levels: erasure tool, runbook, accurate privacy page (#1994) |
| A | 25ff6ce1 LIN-3687: backlog glyph ◌ in status-pill/audit maps; explicit halt labels (carries LIN-3684) (#1993) |
| A | dca50589 LIN-3632: drop the retired empty funnel-events collection, remove its stale references (#1989) |
| A | 95b8f2ec Docs: community answers, starting with MongoDB 8.0 on Linux kernel 6.19+ (#1991) |
| A | 272af5c9 LIN-3693: CI: pin mongo:8.0.32 with glibc.pthread.rseq=1 so the Unit tests service starts on kernel 6.19+ (#1990) |
| A | d8c14f6d LIN-3618: 90-day dispatch token lifetime, expire ownerless tokens (#1992) |
| A | 493c62bb LIN-3689: workspace KPIs page inside Harbour, next to Settings (#1988) |
| A | 0ff9c51a LIN-3683: roadmap filtered-load test uses a raw team id that differs from the matched id (#1987) |
| C | 9ee09ae9 LIN-3680 + LIN-3678: swim labels say Cancelled; roadmap glyph from getStateDisplay (#1985) |
| A | 71d226d3 LIN-3644: reword flight-companion brief ceiling header to the grows-only-with-reason rule (#1986) |
| C | bba51895 LIN-3622: runner poll and take serve only session targets (#1984) |
| A | c5b78074 LIN-3638: seams.mjs adopts the kit's tree reader (+ LIN-3639/3640/3641) (#1982) |
| C | ca5c902f LIN-3677: followUpTarget refuses unknown targets (#1983) |
| C | 3cb74ddc LIN-3665: Flight Companion proxy free-tier 429 carries the freeTier block (#1981) |
| C | 4a9b21b9 LIN-3675: runner kit recover and stop-halt consult Harbour's settlement before a terminal post (#1978) |
| A | 024fd026 LIN-3637: privacy page: consumer heartbeat disclosure (#1980) |
| C | 16934a05 LIN-3664: trim OPENROUTER_FREE_TIER_KEY (whitespace-only is not configured) (#1979) |
| C | 813d01b7 LIN-3620: KPI activeTokens skips expired dispatch tokens (#1977) |
| C | 5359866c LIN-3619: revoke tokens and /t/ links on involuntary removal and last-binding unlink (#1975) |
| C | 7ecea8b1 LIN-3667: wait loop returns reason=network for a poll that failed before any reply; credential stays the 401 (#1976) |
| A | 2a90f7b4 LIN-3650: a new HALT_MODES value fails CI until the kit and contract table handle it (#1974) |
| A | f930976b LIN-3682: roadmap route harness follows the data-mock predicate wherever it lives (tests only) (#1973) |
| A | bd61b85d LIN-3673: one total owner check; per-gate try wrappers deleted (#1972) |
| C | 8db6259f LIN-3674: a closed task draws the same everywhere (#1971) |
| A | 3a11a7a9 LIN-3672: one follow-up target rule shared by deriveFollowUpDispatch and the CI-wake sweep (#1970) |
| C | 1d4aec6a LIN-3670: runner kit fails a no-live-session follow-up under stop, as SD does (#1969) |
| A | 00831934 LIN-3668: Drift & Coherence review 2026-10-19 (trend vs 2026-10-18) (#1968) |
| C | fc908ff0 LIN-3669: runner watchdog must not post [failed] stalled for a finished run (#1967) |
| A | 77704276 LIN-3414: make the Terms and Privacy pages match the code (#1966) |
| A | 35031d6d LIN-3659: use isTerminalState for open-child checks in mock/e2e-fake paths (#1965) |
| C | c08f56a0 LIN-3499: the task page shows the answer box wherever it says it's waiting for an answer (#1964) |
| C | d134c0f5 LIN-3655: a throwing status getter on an owner answer fails closed at grant mint and the share page (#1963) |
| C | f521c534 fix(runner-setup): owner seam throwing null/undefined renders 'unavailable' instead of hanging (LIN-3654) (#1962) |
| C | 25a9607a LIN-3379: merged-but-not-Done task page no longer contradicts the close-out (#1960) |
| C | 9adc8e81 LIN-3496: the runner kit joins a credential block line that was broken in the middle (#1961) |
| A | f49a957c LIN-3285: Linear/Jira PR-state reads use the workspace owner's GitHub App installation (#1957) |
| C | f2fc235c LIN-3498: a stage's clock starts with its latest attempt (#1959) |
| C | 7c38ab2e LIN-3495: the runner kit names the cause when it can't reach Harbour (#1958) |
| C | 08bcfaab LIN-3494: Go shows the server's reason when a run can't start (#1956) |
| C | 0cdad293 LIN-3513: hide stale [pending] line on continued/ended sessions (#1955) |
| C | a48c3588 LIN-3497: a review is on record only when a review comment exists (#1954) |
| A | 9bc8d373 LIN-3662: operator runbook for improvement cycles (#1952) |
| A | b6beb380 LIN-3661: wake a worker parked PENDING-EXTERNAL on its PR's CI when the checks finish (#1953) |
| A | b4ca2a5a LIN-3658: one home for the free-tier rule and refusal block (lib/chat-request.js) (#1950) |
| C | 1ba54841 LIN-3657: refuse a head-moved close-out press like the dispatch lane (#1951) |
| A | 7a12c0fb LIN-3656: route the task page's finished set onto isTerminalState (#1949) |
| A | e204e258 LIN-3627: email-confirm pages send the shared APP_CSP; record img-src/form-action as decided (#1948) |
| A | 69991b3e LIN-3651: a converging plan gets another plan-review round, up to a ceiling of 5 (#1945) |
| C | a9186957 LIN-3647: heartbeat routes must not refresh the token's lastUsedAt (#1944) |
| A | ccdf7260 LIN-3626: paginate GitHub /user/installations (bounded walk, truncation carried) (#1947) |
| A | a975f117 LIN-3612: point remaining state-predicate imports at providers/state-map.js (#1946) |
| A | 9b3b6673 LIN-3648: every owner gate reads the owner answer through isOwnerAnswer()/readOwnerStatus() (#1943) |
| A | d947d2dc LIN-3630: contract table says SD reads an unknown halt mode as pause; name the abort difference (#1941) |
| C | b8334989 LIN-3631: a Rulings-tab poll no longer wipes what the operator is typing (#1942) |
| A | f62837a4 LIN-3646: Drift & Coherence Review 2026-10-18 (first census-driven edition) (#1940) |
| C | ff479045 LIN-3634: refuse a head-moved close-out on the session dispatch lane (#1939) |
| A | ea96357a LIN-3635: gate, limit and narrow the feedback intake route (#1938) |
| A | 207a880e LIN-3629: Drift & Coherence Review runs the census; cmp detector (#1936) |
| C | bc875ddc LIN-3642: require a present state on the Linear OAuth callback (#1937) |
| A | ec21bf9a LIN-3633: prompt-size freeze allows a justified raise, recorded beside the ceiling (#1935) |
| A | 1352fd89 LIN-3419: commit the 18 Oct v1-path security review report (#1934) |
| A | 1a4c9f1d LIN-3628: code-shape kit — census, shape, verbatim share, perturbation probe (#1933) |
| A | cb2de94a LIN-3615: accept a permitted pin conversion whose behaviour replacement lands first; behaviour witnesses a move (#1932) |
| A | e2cc2ef0 LIN-1952: consumer heartbeat receiver (Harbour PR 1 of 2) (#1930) |
| A | b45e9b57 LIN-3614: record an unasked live or post-deploy check as not run instead of holding the close (#1931) |
| C | cb470984 LIN-3500: the funnel reads the merge click from the close-out record (#1929) |
| A | 79c526a1 LIN-3420: hash-based CSP and frame-ancestors on app pages and /t/ (#1928) |
| C | 15c3b42c LIN-3404: fresh-install callback mints only for an installation the user can access (#1922) |
| C | 0441adfb LIN-3501: count the funnel by person; one reader for the route and /kpis (#1927) |
| C | acadeeab LIN-3418: moved PR head makes close-out not ready (head-moved) (#1926) |
| A | 4939292d LIN-3421: revoke removing account's tokens and /t/ links on workspace removal; optional dispatch-token expiry (#1925) |
| C | 6a7d9ad0 LIN-3506: filter expired session rows in the five direct sessions readers (#1924) |
| A | 251ef022 LIN-3451: runner kit matches Simple Dispatcher (halt / target / repo / cap) + contract table (#1923) |
| A | 3739a540 model-pricing: Fable 5.1, Opus 5.5, Sonnet 5.5 rows; sweep flags unpriced models (LIN-3094) (#1921) |
| A | 5ef27843 Papers: The Theseus Method, version 2 (links in the text, terms explained) (#1920) |
| A | 038526d8 Papers: The Theseus Method (essay) and its long version (#1919) |
| A | 509ed3fc Papers: consolidate, then rebuild (does consolidating scattered decisions before a rebuild improve a codebase, reliably and cheaply?), with the round's experiments record (#1918) |
| A | 2e8cba6e LIN-3611: rebuild the dispatch-entrance authority design-first (#1917) |
| A | ab85eb9e LIN-3610: move periodical gate marker format to lib/periodicals.js (#1916) |
| A | 6ae4c0e4 LIN-3606: move isBlocked to its owner (lib/providers/state-map.js) (#1915) |
| A | 675c0d33 LIN-3605: cap local unit-suite concurrency at half the CPUs (#1914) |
| A | 47d87055 LIN-3604: dispatch entrance — one authority per entrance decision in lib/dispatch-entrance.js (#1913) |
| A | 15191460 LIN-3601: dispatch entrance — source-text pins become behaviour tests (tests only) (#1912) |
| A | ee9fcba9 LIN-3602: one authority for the waiting wake marker (dispatch-terminal.js) (#1911) |
| A | f885f44c LIN-3600: move summarizeChecks to github-pr-status, prompt-opts to render-prompt-opts (#1910) |
| A | d349e78c Papers: the rebuild round (is a design-first rebuild a viable, cheap way to improve Harbour's code?), with the round's experiments record (#1909) |
| A | 603853c5 LIN-3596: rebuild the workspace API router design-first (#1908) |
| A | 91fca7dd LIN-3591: rebuild the KPI statistics collector design-first, fix the free-tier count leak (#1907) |
| A | d2d7d818 LIN-3592: rebuild the dispatch entrance design-first (#1906) |
| A | 16e7ae77 LIN-3590: rebuild the task page loader design-first (#1905) |
| A | b3bdccaf LIN-3580: rebuild the dispatch factory and validation design-first (#1904) |
| A | 1f8010a0 LIN-3579: rebuild the page renderer cluster design-first (render, render-session, render-swipe, render-settings) (#1903) |
| A | 44528462 LIN-3583: E2E: keep a developer's MONGODB_URI and ./data out of the Playwright servers (#1902) |
| A | 4ee0a2c7 LIN-3578: rebuild lib/pipeline-loops.js design-first (rung 5); lean abort now reaches a digest-less target (#1901) |
| A | f4749b91 Papers: the rebuild ladder (can chunks of Harbour be rebuilt from scratch safely?), with the experiments record (#1900) |
| A | 350242d5 LIN-3573: rebuild the Agent API write and rulings routes design-first (LIN-3575 + LIN-3576) (#1899) |
| C | e90b94c6 LIN-3570: Jira codec: nested lists and *single-asterisk* italics (#1898) |
| A | 06ec62b7 LIN-3569: rebuild the Agent API read routes design-first (#1897) |
| A | 65969467 LIN-3566: rebuild the roadmap page renderer design-first (#1896) |
| A | 74e5e2ca LIN-3565: clean-room rebuild of the Jira ADF codec, experiment 2b (#1895) |
| C | c2bc9a65 LIN-3564: Jira codec: inline code follows CommonMark (#1894) |
| C | bf6f7507 LIN-3561: fix Jira href brackets and pin the codec's user-visible outputs (#1893) |
| A | e7f7bd57 LIN-3557: clean-room rebuild of the Jira ADF↔Markdown codec (#1892) |
| A | 269a6189 LIN-3556: rebuild Jira ADF↔Markdown codec as a whole (same behaviour, cleaner code) (#1891) |
| A | 2a07f3ea Papers: Theseus (plank-by-plank rebuild), two essays, and PNG figures in the Library (#1890) |
| A | 38fc3b5c LIN-3551: paper — have Harbour's tests taken on a life of their own? (#1889) |
| A | e4dcbe1b LIN-3552: Seams & Tangles review 2026-10-13 (baseline) (#1888) |
| A | 6597d6e0 LIN-3550: Seams & Tangles periodical, with its measuring script and area guide (#1887) |
| A | ebf93bd9 LIN-3547: Stability Review 2026-10-12 (trend vs 2026-06-25) (#1886) |
| A | 6be148a8 LIN-3543: code quality review 2026-10-12 (production edition) (#1885) |
| A | 1ef562ce LIN-3523: delete the LIN-3449 swap-time residue from unit tests (#1882) |
| A | b23afeda LIN-3520: chat-tools tests import the real sessionIsTerminal (#1881) |
| A | 61824e63 LIN-3426: retire "merged by you" — a merged PR reads the same for every viewer (#1880) |
| A | fe54a0ad LIN-3517: Code Quality Review — test estate (trial for LIN-3449) (#1879) |
| A | ce5d4120 LIN-3516: Drift & Coherence Review — post-batch-3 gauge (trend vs 2026-10-11 post-batch) (#1878) |
| C | e24f8d12 LIN-3395: refuse a close-out press once a merged event exists (#1877) |
| C | 6575161b LIN-3448: task page paints the ready header when a session ends on a merge-ready PR (#1876) |
| A | 66014ac0 LIN-3269: remove dead FreeTierStore.canUse() (#1875) |
| A | 87b0d528 LIN-3447: one goneHandlerFor decides the guest-only 404 gate; test it through init() (#1874) |
| A | d85720c0 LIN-3505: runner-kit worker can raise a ruling (#1870) |
| A | 596ad272 Merge pull request #1872 from JKershaw/fix/lin-3424-hourly-session-sweep |
| C | 5cb05987 LIN-3504: answered/ended session stops showing its [blocked] question (#1868) |
| A | eab584fe LIN-2392: landing copy names all five backends and 17 templates (#1867) |
| C | 719043e5 LIN-3471: trailing semicolon on the validateRunField import in workspace-api (#1873) |
| C | 2ec145d1 LIN-3267: re-read the run quota after a ladder press (#1854) |
| A | a0d9c0de LIN-3503: one 20-minute NOBODY_LISTENING_MS limit for every no-listener warning (#1871) |
| C | 92eee6f2 LIN-3213: runner open end summary and wait debounce (#1869) |
| A | f33fdcb0 LIN-997: Roadmap pricing-hint test parity with Settings (#1866) |
| A | c3ac285d LIN-2698: pin scan-due ledger-present branch and pageCandidateCount (tests only) (#1864) |
| A | ca11d672 LIN-940: remove orphaned --motion-slow token (#1865) |
| A | 2e40f08f LIN-1550: remove dead updateWorkspaceTokens seam (#1861) |
| A | ddfe62f5 LIN-2856: pin decision/outcome ?? null coalesces in toRecord (#1863) |
| C | 069b6c16 LIN-1465: make mergeLineageFeedback tie order independent of sibling query order (#1860) |
| C | d45089aa LIN-1965: cannot-close re-close condition is capability-gated (#1862) |
| A | 23db4b97 LIN-3388: docs: Go has no cap, by design (#1858) |
| C | 3ee41011 LIN-2854: getRecommendationStream/getRecommendation fail fast on an already-aborted signal (#1859) |
| C | adf630cc LIN-3445: restore inert repo= decoys so the "no project derivation" tests are not vacuous (#1856) |
| C | 31208b6f LIN-3444: title lane projects the binding's owner/name scope, not the installation id (#1855) |
| C | 2469ac2b LIN-3446: Go never dispatches on a live task (#1853) |
