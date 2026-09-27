# LIN-3101 — measurements summary (beat 3)

Evidence directory: `docs/reviews/_evidence-2026-09-26/` (376 captures: PNG + matching JSON each, plus `capture/manifest.json` and `capture/analysis.json`). Tooling in `capture/` (`capture.mjs`, `analyze.mjs`, `validate-metrics.mjs`). All render measurements below are from fresh `NODE_ENV=test` renders on a keyless server (`LINEAR_ACCESS_TOKEN=` empty), cookie dark via the real `theme` cookie, archive dark via `prefers-color-scheme` media emulation (labelled `darkMode:'media'`).

---

## 1 · Capture matrix

| Group | Surfaces | Captures | Result |
|---|---|---|---|
| Cold (landing, public swipe/swim/ship, privacy, terms, styleguide, templates, kpis) | 9 | 52 | 52 ok |
| Archive 1–7 (media-dark, 4 viewports each) | 7 | 56 | 56 ok |
| Authenticated workspace (Linear seed, all flags) | 26 | 108 | 108 ok |
| Provider seeds (local / github / github-projects / jira) | 6 | 24 | 24 ok |
| Error/consent family (intercept-rendered) + raw-route failures | 22 | 136 | 136 ok |
| **Total** | **70 surfaces** | **376** | **376 ok, 0 failed** |

Every capture is in `capture/manifest.json` (keyed `surface--theme--viewport`). Viewports: 1400 + 390 everywhere; 360/320 added for the uncertain set (landing + public swipe/swim/ship, all archives, `/ship`, all error/consent pages, raw failures). Fresh browser context per surface; auth surfaces seed via `/test/set-{session,local-session,github-session,github-projects-session,jira-session}`.

## 2 · Re-measure verdicts (the named targets)

| Target | Verdict | Evidence |
|---|---|---|
| **LIN-2400** merge-consent differentiation + sizing | **HOLDS** — confirm is filled teal `rgb(13,148,136)`/white, decline is chromeless outline (`background: transparent`, `border 1px solid rgb(221,221,221)`, ink `rgb(26,26,26)`); both 16px Inter, `cursor:pointer`, **46px tall** (≥44px touch target). Was: pixel-identical → now differentiated and sized. | `err-merge-confirm-*.json`, `analysis.json` `mergeButtons` |
| **LIN-2401** error-page subject as real heading | **HOLDS** — every error/consent subject is `<h2 class="error-title">`; a11y-tree heading role ≡ DOM (2 roles: "Harbour" + subject) on merge-confirm, generic, upstream auth/5xx, workspace-not-found, jira-nows, openrouter-nocode, jira-site; 4 on the GitHub repo picker (adds 2 `<h3>` group headings). | `err-*.json` (`headings.a11y`), `analysis.json` `errHeadings` |
| **LIN-2402** archive `.chip` nowrap overflow | **HOLDS / no longer reproduces** — zero document overflow at 320/360/390 on all 7 archives (`scrollWidth == clientWidth`, empty offender list). Prior runs measured 531/390 (archive 1,2) and 425/390 (archive 4). Regression guard **LIN-2491** is still Backlog → cite, do not re-mint. | `archive-{1..7}-light-{320,360,390}px.json` `overflow` |
| **D5** upstream error copy contradicts diagnostic on 5xx/429 | **STILL REPRODUCES** — 5xx and 429 both show "the connection closed before it responded" while the diagnostic under them says "Linear returned a 503 server error." / "Linear rate-limited the request…". | `err-upstream-{5xx,429}-*.json`, `analysis.json` `upstreamCopy` |
| **D6** `<title>` convention drift | **STILL REPRODUCES, and widened** — see §3 census. "- Projects" (pre-rename brand) is now the **most common** convention (22 surfaces), "- Experimental" still leaks into 8 tabs, 7 bare titles. | `analysis.json` `titleCensus` / `conventionCounts` |
| **D7** archive colophon | **REFINED (beat 5) — partially holds.** Holds: archives **4, 5, 6** don't wrap their provenance block in a `<footer>` landmark (`<footer>` count 0). **Overturned:** they do NOT lack a colophon — every archive 1–7 ends with a provenance sign-off; 4 ends *"THE HARBOUR ARCHIVE · THE AUGUST WING · compiled by the flight companion for John Kershaw · sources: … · harbour.cat"*, 5/6 end *"Harbour Archive · document N · filed … · served verbatim…"*. The earlier "archive 7's footer has no colophon text" was a too-narrow regex (its `<footer>` carries "About this document / Version / Filed…"). See `research-notes.md` §8. | `archive-{1..7}-light-390px.pe.png`/`.json`, `capture/manifest.json` |
| **D8** `/ship` zero headings | **STILL REPRODUCES** — both the cold `/ship` preview and `/workspace/:urlKey/ship` render **0 headings** (`h1–h6` all 0, a11y roleHeading 0). LIN-2401's renderer fix does not reach the Ship renderer. | `ship-public-*.json`, `ship-*.json` |
| **§3** archive links back into the product | **REFINED (beat 5) — holds for the app.** Fixed metric counts same-origin + canonical origin (`capture/links-reconciliation.json`): **0** `appHome` and **0** app-nav/workspace links on all 7 archives — no route into the *app* (the first-experience finding is unchanged). But archives 5/7 **interlink** to sibling installments (`/archive/4`, `/archive/2`, `/archive/5`, and `https://harbour.cat/archive/5`), and 1/2/4 mention `harbour.cat` as plain text only. See `research-notes.md` §8. | `capture/links-reconciliation.json`, `archive-{5,7}-*.json` |
| **§6** hardcoded "Linear" in rendered copy | **STILL REPRODUCES (error renderer); source-only elsewhere** — `renderUpstreamAwareErrorPage` renders "Trouble Reaching **Linear**" / "We couldn't reach **Linear's** API…" / "**Linear** rejected your session…" on all five branches, with no provider parameter in the call path, so it is produced for **any** backend. The `render-{roadmap,swim,ship,swipe}.js` fallbacks did **not** reproduce under any seed (every provider resolves a display name → titles use the workspace name, e.g. "Local Workspace - Projects"), so those remain source-only. | `err-upstream-*.json`, `analysis.json` `upstreamCopy` + `providerTrees` |

## 3 · Title census (light @1400, deduped across themes/viewports)

Convention counts (66 distinct `<title>` values grouped):

| Convention | Surfaces | Notes |
|---|---|---|
| `<X> - Projects` (pre-rename brand) | **22** | every `render-pages.js` error/consent surface + the tree/roadmap under **all five** providers |
| `<Workspace> - <Page>` | 10 | Settings, Prompts, Dispatch, Proxy, Custom Prompts, Escalation KPIs, Effort Self-Assessment, Operator Dashboard, Roadmap |
| `- Experimental` | 8 | all experimental views except Ship (leaks into 8 browser tabs) |
| `bare` (no suffix) | 7 | Ship, Observation, New task, Choose a Jira site, Connect Jira, dashboard alias, effort/collective-adjacent |
| `archive (document titles)` | 6 | "The Harbour Archive", "… · Harbour Archive #5/#6/#7", "Project Brief · 3 Aug" |
| `- Harbour` | 5 | privacy, terms, styleguide, templates, kpis |
| landing one-off | 2 | "Harbour — keep human intent…", one more |
| one-off `Swim - Lanes` / `Swipe <issue>` | 4 | Swipe uses the issue title ("Swipe - TEST-13 Login fails…") |

## 4 · Contrast highlights (light, 1400) — measured ratios vs effective background

| Element | Color / bg | Ratio | WCAG AA (4.5:1) |
|---|---|---|---|
| Body text | `rgb(26,26,26)` / white | **17.4** | pass |
| Muted paragraph (`p`) | `rgb(102,102,102)` / white | **5.74** | pass |
| Landing primary CTA "Log in with Linear" | `rgb(4,35,31)` / `rgb(13,148,136)` | **4.43** | **fail by 0.07** (LIN-739) |
| Merge-confirm primary button (white text) | `rgb(255,255,255)` / `rgb(13,148,136)` | **3.74** | **fail** |
| OpenRouter-consent primary button | white / `rgb(13,148,136)` | **3.74** | **fail** |

*Limitation:* the effective-background walk is a span-level heuristic; it mis-resolves one styleguide `.chip` (reported 1.21:1 against black) and should not be treated as a real finding. The four rows above are stable and were independently confirmed where relevant.

## 5 · Nav / footer census (auth surfaces, light @1400)

- Theme toggle: **present on every authenticated page** (`hasThemeToggle:true`; cookie dark verified). Footer shows "theme: light|dark".
- Team selector (LIN-2519, "widen to five pages"): present on **tree, roadmap, swim, swipe, ship** — exactly the five filterable pages. Absent elsewhere.
- Assignee selector (LIN-2527): present **only on the dashboard/tree**.
- Feedback trigger in nav (LIN-2298): **renders only when `featureFlags.feedbackWidget === true`** (`lib/components/navbar.js:150`); captured on the dashboard with the flag on (`hasNavFeedback:true`, plus a footer "feedback" link). With the flag off it is absent — a flag-gating nuance, not a defect.
- Experimental "⋯ more" overflow lists all nine experimental views in the nav; footer carries `reset · ai: ○ · github · privacy · terms · templates · theme · feedback`.

## 6 · Candidate observations in the ~625-commit window (evidence file names only; ranking is the report stage's job)

1. **`/ship` (cold preview) and `/workspace/:urlKey/ship` render zero headings** — `ship-public-light-1400px.json` (totalDom 0, a11y roleHeading 0), `ship-light-1400px.json`.
2. **Upstream error copy contradicts its own diagnostic on 5xx/429** — `err-upstream-5xx-light-1400px.json`, `err-upstream-429-light-1400px.json`, `analysis.json` `upstreamCopy`.
3. **`<title>` brand drift; `- Projects` (pre-rename) is the dominant convention (22 surfaces), `- Experimental` leaks into 8 tabs, 7 bare titles** — `analysis.json` `conventionCounts`.
4. **Archives 4/5/6 don't wrap their provenance sign-off in a `<footer>`** (a landmark note, **not** missing content — every archive ends with a provenance line; see D7 in §2) — `archive-{4,5,6}-light-1400px.json` (`footerCount` 0), `archive-{1..7}-light-390px.pe.png`.
5. **No archive links into the app (home `/`, workspace, or nav) — but 5/7 interlink to sibling installments and 7 links to `https://harbour.cat/archive/5`** — `capture/links-reconciliation.json`.
6. **Upstream error renderer hardcodes "Linear" regardless of backend** — `err-upstream-{auth,5xx,429,net,internal}-*.json`; title "Trouble Reaching Linear".
7. **`.login-button` renders white-on-teal at 3.74:1 — one site-wide class, not two page findings.** `rgb(13,148,136)` is the shared `--brand`/`--teal` token (`public/style.css:39,119`), and `.login-button { background: var(--brand); color: var(--bg) }` (`public/style.css:2103`). So the merge-confirm + OpenRouter primary buttons (3.74:1) are two instances of the *same* `.login-button` white-on-teal class that also covers every error-page "Try again"/"Go to homepage" button, the GitHub/Jira picker submit buttons, and workspace-not-found. Cite **LIN-739** (landing CTA teal contrast — do-not-re-mint) + **LIN-849** (a11y cleanup); do not re-mint. — `err-merge-confirm-light-1400px.json` `contrast`, `analysis.json` `mergeButtons`.
8. **Effort-readout and escalation-kpis each render a single `<h1>` with no section headings** (sparse heading structure on the new operator surfaces) — `effort-readout-light-1400px.json`, `escalation-kpis-light-1400px.json` (totalDom 1).
9. ~~`/workspace/:urlKey/task/123/edit` returns 500~~ **WITHDRAWN (beat 4)** — the 500 is a test-seam artifact (the `test-token` seed fails a real Linear GraphQL call with 401 auth error → generic 500), not a product defect. With a real session a missing id takes the 400/404 paths (`routes/task-edit.js:93,146`). Sibling check: `observation/session/none` → clean 404 "Session not found"; swipe with a bad identifier → 200 empty "Swipe - Tasks".
10. **Nav feedback trigger only renders with `feedbackWidget` flag** (the relocated LIN-2298 trigger), confirmed present on the dashboard with the flag on — `tree-light-1400px.json` (`hasNavFeedback:true`).
11. **`/archive/:n` route 404 state** (newly discovered in beat 4): `/archive/999` renders a `renderErrorPage` "Not Found — There is no archive #999." (404, `- Projects` title). — `archive-404-light-1400px.json`.

## 7 · Coverage limits / unrenderable states

- **Non-Linear merge-consent screens** remain unrendered: `/test/set-merge-conflict-session` hardcodes `provider:'linear'`; no GitHub / GitHub Projects / Jira merge-confirm or reauth variant is producible. (Same limit as the 2026-08-29 run.)
- **View-renderer "Linear" fallbacks** (`render-{roadmap,swim,ship,swipe}.js`) are the *unresolved-provider* branch; every seed resolves a display name, so those fallbacks cannot be reproduced — they are source-only.
- **`/test/set-session` is the Linear-PAT-equivalent seam**; the upstream-error pages under a *live* non-Linear provider (a real GitHub/Jira outage) cannot be produced on a keyless server — they are rendered via the production renderer with synthetic errors, exactly as the prior run did.
- **Contrast** for text clipped without horizontal overflow is not captured (needs a color/position probe); noted, not papered over.

## 8 · Evidence-set size (curated, beat 4)

`docs/reviews/_evidence-2026-09-26/` = **9.5 MB total** — **114 PNGs** (86 `fullPage`, 16 `pageEnd` light, 12 `viewport`) + **502 JSONs** (2.0 MB) + tools/manifest (~0.2 MB). Capture mode is recorded per entry in `capture/manifest.json` (`viewport` | `fullPage` | `pageEnd`). All measurement JSONs are kept (they back every number, including the 360/320 sweeps); PNGs are pruned to verdict/observation surfaces + three lean family representatives (`landing`, `tree`, `local-tree`) + `fullPage` verdict captures + `pageEnd` archives (final-viewport capture of the page end incl. footer/colophon — but see the `pageEnd` dark variants dropped to meet the budget). Every pruned entry is marked `pruned — regenerable via capture/{capture,capture-full}.mjs <key>`. 2026-08-29 was 6.6 MB / 60 artifacts; this is 9.5 MB over a ~6.4× larger measured scope.

## 9 · Adversarial self-review (beat 4)

- **Missed siblings.** Searched beyond `app.get`/`router.get`: the only *new* rendered surface is the **`/archive/:n` 404 state** (`server.js:1873`), captured as `archive-404`. The global error middleware (`server.js:3897`) and the basePath-mounted GitHub/GitHub-Projects routers + POST-rendered account-merge/`github-install-flow`/`jira-auth` pages all render via `renderErrorPage`/`renderMergeConfirmPage`/`renderMergeReauthRequiredPage` — structurally the same family already captured, differing only in copy.
- **LIN-2402 "no longer reproduces" is NOT a false hold.** The long `.chip.ev` content that originally overflowed is still present (52/55/21 chips in archives 1/2/4, incl. the exact `/kpis · terminalMarkedTaskCost · weeklyBudgetGauge` string), and the fix `7704f3c2` changed the archive documents' *own* `.chip.ev` rule to `white-space: normal; overflow-wrap: anywhere; max-width:100%`. Verified wrapping is real.
- **D8 zero is real, not a semantic substitute.** Rendered `/workspace/:urlKey/ship` has `h1–h6 = 0`, `role="heading" = 0`, `aria-level = 0`, `svg <text> = 0`; the only "heading" in the renderer is the *orientation* control ("pick a heading"), not a heading element. Both DOM and a11y zero confirmed.
- **Contrast 3.74:1 is one class, not two.** `rgb(13,148,136)` = shared `--brand`/`--teal` token; `.login-button` uses white-on-teal across ~14 error/consent surfaces. Cited to LIN-739 / LIN-849 (do-not-re-mint).
- **task-edit 500 is a harness artifact — withdrawn** (see observation 9).

### Duplicate-ticket search (`GET /api/proxy/search`)

| Item | Existing ticket | Disposition |
|---|---|---|
| D5 upstream copy contradiction | none | new if promoted |
| D6 `<title>` conventions | LIN-975 (Done, in-page `<h1>`), LIN-13 (old) | none exact — report, don't re-mint those |
| D7 archive colophon | none (LIN-2789 adjacent, papers backlinks) | refined to a `<footer>`-landmark note (4/5/6) — unlikely to merit a task |
| D8 ship zero headings | LIN-266 (heading-tag/sector investigation) — related, not exact | report; check LIN-266 before minting |
| §3 archive no product links | LIN-2789 "Papers archive: web it together — backlinks" — adjacent | holds for the app; 5/7 interlink (report; check LIN-2789 before minting) |
| §6 hardcoded "Linear" | LIN-2351 / LIN-2354 / LIN-2370 / LIN-2371 / LIN-561 (source-neutral/provider attribution) — none reaches `renderUpstreamAwareErrorPage` | report; the renderer is uncovered |
| contrast 3.74 white-on-teal | LIN-739 (+LIN-849) — in do-not-re-mint list | cite, never re-mint |
| LIN-2402 chip wrap | LIN-2491 (regression guard, Backlog) — in do-not-re-mint list | cite, never re-mint |

None of D5/D6/D7/D8/§3/§6 collide with the do-not-re-mint list (LIN-739, LIN-2221, LIN-1018, LIN-1856, LIN-1979, LIN-2491, LIN-849, LIN-681, LIN-868, LIN-941, LIN-1688, LIN-1218, LIN-949).