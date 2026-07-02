# Comprehension-Debt Review — run of 2026-07-01

**Grounding:** reviewed at HEAD = `6e5d928` (LIN-891 agent-facing attachment upload merge, 2026-07-01). Periodical LIN-370, run task **LIN-895**. Prior runs: baseline **2026-06-12** (`docs/reviews/comprehension-debt-review-2026-06-12.md`, run LIN-439, HEAD `f746725`) and most recent **2026-06-25** (`docs/reviews/comprehension-debt-review-2026-06-25.md`, run LIN-674, HEAD `8de7da5`), read in full before this run. HEAD moved 122 commits / 79 `lib`+`routes` files / ~6.4k insertions past `8de7da5`.

**Altitude reminder (LIN-370):** this review asks whether a *cold reader* can reconstruct *why a module is shaped the way it is* from the code + nearby docs alone. It is distinct from the Documentation Review's per-comment hygiene — a single missing why-comment is that review's to own; here a *module whose load-bearing rationale is unrecoverable* is the finding. Rationale-inflation (manufactured explanation for self-evident code) is itself a finding, so a clean, legible module is recorded as a genuine pass, never padded.

---

## Headline

**The paraphrase-next-to-the-tag culture keeps holding, including on the highest-risk new surface of the cycle.** The GitHub App migration (LIN-703/707/708/709/711–714, ~1000 new lines across `lib/providers/github/app-auth.js`, `routes/github-projects-auth.js`, the new `lib/providers/github-projects/*` provider) is genuinely security-adjacent (JWT minting, installation-token exchange, OAuth state) and lands with unusually thorough in-code rationale — design constraints, credential lifetimes, and cross-surface sequencing are all stated at the point of use. The dispatch orchestration work this cycle (LIN-881 warm-drip WAKE default, `lib/dispatch-wake.js`) explains not just what it does but the specific incident it fixes (LIN-835/LIN-877 deadlocks) and why adjacent-looking guards were deliberately *not* added. The attachment-upload work (LIN-890/891) — flagged by the last report as the strongest candidate to reproduce F3's "capability gate ≠ execution path" trap — does **not** reproduce it: the gate (`denyIfUnsupported(provider, 'uploadFile', …)`) and the execution (`provider.uploadFile(...)` a few lines later) are the same call, in the same handler, and the JSDoc says so.

The one new finding this cycle is a **negative-space** one, not a rationale gap: the **Pipeline view removal (LIN-877)** was thorough for the deleted surface itself (routes/lib/tests/flags/docs all swept across three beats) but missed a handful of **dangling references to the deleted file/page in unrelated client-side JSDoc** — comments that describe *other* code by contrast with something that no longer exists. This is exactly the failure mode the task context flagged as worth spot-checking, and it is real but narrow (Low).

**Ledger carried forward:** F1 stays resolved. F2 survives a **third** cycle unpromoted (still genuinely layout-only, still hasn't leaked). F3's follow-up (**LIN-692**) is **still in Backlog, not landed** — the constraint-note has not yet been added at the three provider sites. F4/F5/F6 are unchanged and still self-mitigated (no new consumers). One new Low finding (F7) is recorded, not promoted.

**Zero follow-ups minted this cycle** — nothing clears the promotion bar (Medium+); LIN-692 already exists for F3 and needs no re-derivation, just a nudge (see below).

---

## Findings (severity-ranked)

### F7 — `pipeline-removal-orphaned-references` — **Low** — *new*

**Where** (all client-side JSDoc/prose, none of it executable logic):
- `public/common.js:181-182` — `relativeTime()` JSDoc: *"pipeline.js deliberately keeps its own 30-day-cap variant and is NOT a consumer of this helper."*
- `public/common.js:321-325` — `dispatchPrompt()` JSDoc: *"Every dispatch surface (dashboard tree, dispatch page, swipe/recap/brief, pipeline overlay) funnels through here…"*
- `public/common.js:650-652` — `showOverlay()` JSDoc: *"The pipeline overlay is intentionally NOT built on this helper — it is a persistent polling singleton, a different primitive."*
- `public/sessions.js:12-14` — file header: *"Visual language mirrors the pipeline overlay loop history (`public/pipeline.js renderLoopEntry`)."* — a direct pointer to a specific function in a deleted file.
- `public/recap.js:10-11` — *"Exposed as a global `RecapSection` since the swipe and pipeline pages are plain scripts…"*
- `lib/render-styleguide.js:396` — Styleguide page prose (**live-rendered**, not just a comment): *"The five per-page looks (custom-prompts, roadmap, foreman, swipe, pipeline) genuinely diverge…"* — only **three** `.emptyState` variant classes exist today (`custom-prompts-empty`, `roadmap-empty`, `swipe-card-empty`; confirmed via `grep` across `public/*.css`), so this is a stale, user-visible count, not just a dead internal comment. (`foreman` in the same sentence is older, pre-dates this cycle's diff, and is likely Documentation Review's to own rather than re-flagged here.)

**Non-obvious behavior + missing rationale.** `lib/harbour-feedback-tokens.js` — LIN-877's own beat-2 commit message asserts *"No live reference to the flag or the deleted view remains; surviving 'pipeline' hits are KEEP substrate… or CI/CD wording"* — but the six sites above are neither: they are genuine leftover references to the deleted `public/pipeline.js` / Pipeline page, missed by that beat's sweep (which correctly covered `lib/render-*.js`, `routes/`, feature flags, tests, and `docs/`/`llms.txt`, but not `public/*.js` JSDoc headers or the styleguide's descriptive prose). A cold reader following any of these comments to understand *why* the code is shaped this way (why does `relativeTime` have this specific exception; what does "mirrors the pipeline overlay" mean for `sessions.js`'s visual design) is sent to a file that no longer exists.

**Cold-hand-off test:** passes narrowly on risk, fails on accuracy. None of the six sites gate an invariant a newcomer could silently break — worst case is a few minutes spent searching for a deleted file, not a corrupted edit. That keeps this **Low**, not Medium (contrast with F3, where a plausible edit had a silent, consumer-facing failure mode). But it is a genuine, now-unrecoverable-without-git-archaeology reference, and the styleguide instance is user-visible prose, not an internal comment, so it is not purely cosmetic either.

**Minimal fix (constraint-note edit, not net-new prose):** delete or reword the pipeline mentions in the five JSDoc sites (they can simply drop the contrast clause — e.g. `dispatchPrompt`'s surface list becomes "dashboard tree, dispatch page, swipe/recap/brief"), and update the styleguide sentence to "three" (or fewer) per-page looks, dropping `pipeline` (and, optionally, the already-stale `foreman`, though that predates this cycle). No behavior change; this is comment/prose-only.

**Not promoted.** Six one-line edits with zero risk is exactly the kind of item the under-create discipline says can wait — it costs nothing to fix opportunistically (next Pipeline-adjacent touch, or the next Documentation Review pass, which is arguably the closer-fitting owner for the styleguide prose specifically) rather than spending one of the three follow-up slots on it. Recorded in full so it isn't lost.

---

## Ledger reconciliation (carried forward from 2026-06-25)

- **F1 `proxy-dedupe-key-nul-separator`** — still resolved (LIN-440). `lib/proxy-dedupe.js` untouched this cycle. No re-check needed.
- **F2 `composite-sort-key-magnitude-invariant`** — **still open, unchanged, third cycle.** `lib/swim-graph.js:113` (`* 100000`) and `lib/swim-lanes.js:279` (`* 1000000`) are byte-identical to the last two reviews; re-checked `lib/render-swipe.js`, `lib/roadmap.js`, `lib/ship-layout.js` for the `primary * BIG + secondary` idiom leaking into a non-layout path — no hits. Still genuinely layout-only, still **Low**, still not promoted. This is the third consecutive cycle it has waited; the under-create discipline explicitly allows this, but if it survives a fourth cycle unchanged it may be worth promoting purely on tenure (a cheap one-line comment fix that keeps getting deferred is itself a small drag) even without new evidence of leakage.
- **F3 `provider-label-capability-method-not-execution-path`** — mechanism unchanged (confirmed no touches to `lib/providers/interface.js`'s reflection-derivation logic or the three provider `addLabel`/`removeLabel` sites this cycle). Its follow-up, **LIN-692** ("Constraint-note: provider addLabel/removeLabel are capability-gate-only, not the proxy execution path"), is **still in Backlog** as of this run — not landed, so the constraint-note is not yet in place at the three provider sites. Noted rather than re-derived, per the task's instruction; this is now the second run in a row this sat un-actioned in the queue. Worth a nudge in the summary comment rather than a re-mint.
- **F4 `telemetry-heartbeat-state-vocabulary-unstated`** / **F5 `telemetry-runtime-crosscheck-policy-unstated`** — `lib/session-telemetry.js` has had no commits since `8de7da5`, and its consumer set is unchanged (`lib/pipeline-loops.js`, `lib/dispatch-terminal.js` — same two as last cycle). No new consumer makes either unstated policy load-bearing. Both remain Low, self-mitigated, not promoted.
- **F6 `github-recommendation-context-opts-shape`** — `lib/providers/github/index.js` churned this cycle (LIN-771 attachment collector added ~80 lines above it), so the finding's site moved: `fetchRecommendationContext(scope, issueId, _opts = {})` is now at **`lib/providers/github/index.js:340`** (was `:260`), otherwise byte-identical — still ignores `_opts`, still documents why. Still Low, not promoted; ledger site reference updated.

---

## New territory walked this cycle

Walked at module/system altitude, prioritized by risk (critical-path / auth / orchestration over mechanical churn):

- **`lib/harbour-feedback-tokens.js`** (new, LIN-... single-use dispatch-feedback token store) — **clean.** Full JSDoc on the schema, the single-use/hash/no-distinguishable-failure-mode security rationale ("Callers should treat null as 401 Unauthorized — no caller-facing distinction between failure modes to avoid leaking which property failed"), and the used-tokens-kept-as-audit-trail retention choice are all stated at the point of use.
- **`POST /api/proxy/issues/:issueId/attachments`** (LIN-891, `routes/proxy.js:2366-2480`) — **clean; resolves the prior report's named watch item.** The prior review's "notes for next run" flagged `uploadFile` by name as the next likely site for F3's gate-method-≠-execution-method trap. It doesn't reproduce: `denyIfUnsupported(provider, 'uploadFile', …)` gates and `provider.uploadFile(...)` executes in the same handler, a few lines apart, and the doc comment states the deliberate difference from the human feedback widget's `/api/image` route. The LIN-891 follow-up commit (`90da18b`) that pre-validates comment/description length before the upload runs is itself well-commented (explains the orphaned-asset failure mode it closes).
- **`att:` attachment resolution + `ssrfGuardUrl()`** (LIN-890, `routes/proxy.js:1755-1900+`) — **clean, exemplary.** The shared SSRF/allowlist guard extraction, the `md:` vs `att:` error-precedence divergence (deliberately preserved, with the reason stated inline), and the LIN-890 close-out fix for a real hang bug (missing `.catch` on an async Express 4 handler) are all self-explaining. `lib/providers/linear/index.js`'s `fetchAttachment`/`cycleDetail` null-normalization fix is documented at the site.
- **`lib/dispatch-wake.js` + the `subscribe` server-side default** (LIN-881, `routes/proxy.js` kickoff + dispatch handlers) — **clean.** The fix is framed around the specific incident it resolves (named casualties LIN-835/LIN-877, a real deadlock class), states why `recommend-and-dispatch`'s existing behavior is the template, and `buildWakeFollowUp`'s deliberately-absent guards (no `followUpTo` early-return, no `kind === 'autopilot'` early-return) are each backed by a `NOTE (LIN-###)` explaining why the obvious-looking guard would be wrong.
- **Child-dispatch variant policy + stepper→coordinator hand-off** (LIN-885) — **docs-only** (`docs/autopilot-operating-manual.md`); no code changed. The manual is itself the rationale surface, so this is definitionally self-documenting.
- **Pipeline view removal** (LIN-877, 3 beats) — **the deletion itself is clean** (routes/lib/tests/flags/docs swept correctly, `docs/pipeline-*.md` explicitly kept as history with a "superseded by Observation" note); see **F7** above for the dangling-reference gap the sweep missed.
- **Theme migration PRs** (LIN-855/856/857/859/860/861) — confirmed **mechanical**, not just assumed: sampled `LIN-860` (login CTA) and `LIN-861` (experimental views); both are CSS-token/markup-only with the token choice reasoned inline (e.g. `--brand`/`color-mix` mirroring `.btn--primary`, the GitHub-CTA differentiation rationale). No new debt.
- **GitHub App migration** (LIN-703/707/708/709/711–714 + the new `lib/providers/github-projects/*` provider) — **not on the task's pointer list, but the single largest and most security-adjacent new surface this cycle** (~1,000 new lines: JWT minting, installation-token exchange, a new read-only provider). Sampled `lib/providers/github/app-auth.js` (created 2026-06-26) and `routes/github-projects-auth.js` — both **clean, exemplary**: JWT lifetime/clock-drift constants justified, the "no jsonwebtoken dependency" design constraint stated, the shared-App-config single-seam rationale, and the Projects-vs-Issues install-flow parity ("V1 covers the INSTALL path, exactly as Issues shipped its picker… before the already-installed re-bind landed as a separate follow-up") all explicit. This was a sample of 2 of the ~8 surfaces the migration touches (per LIN-707's own "Surface 1 of 8" framing), not an exhaustive walk — flagged for a future cycle if the remaining surfaces (LIN-708/709/711-713) haven't been separately reviewed, since the sample is strong but not total coverage of a security-relevant migration.
- **`lib/proxy-preamble.js`** (extracted from `routes/proxy.js`, LIN-733) — **clean; explicit self-flagged debt, not a finding.** The module documents its own known tradeoff verbatim: *"SECURITY DEBT — revisit (do not ship to broad use as-is): this embeds the caller's STANDING readWrite proxy token in plaintext inside the queued prompt… Planned hardening: mint a per-dispatch, short-TTL token… For now (by explicit choice): standing readWrite."* This is the opposite of comprehension debt — the rationale, the risk, and the planned remediation are all recoverable from the code itself. Recorded as a pass per this review's own rule (a module that explains itself, including its own debt, is legible).

---

## Notes for the next run

- **F3/LIN-692** has now sat in Backlog through two full review cycles since being minted. If it lands before the next run, confirm the constraint-note at the three provider sites (`lib/providers/linear/index.js:1876-1877`, `lib/providers/local/index.js:578-585`, `lib/providers/github/index.js:472-479`) and close the loop; if not, it may be worth a direct nudge rather than a third silent carry-forward.
- **F2** has now waited three cycles. Re-assess promotion purely on tenure next time even absent new leakage evidence, or explicitly decide the wait is indefinite and say so.
- **F7** is cheap (six one-line edits, zero behavior risk) — worth sweeping up opportunistically; the styleguide count (`lib/render-styleguide.js:396`) is the one instance visible to end users, not just other developers, so it is the highest-value single line to fix if only one gets picked up.
- **GitHub App migration** — only 2 of ~8 planned surfaces (LIN-707, LIN-560-adjacent LIN-560Projects auth) were sampled this cycle despite being the largest new critical-path addition. Both were clean, but a future cycle should confirm the remaining surfaces (LIN-708 install-URL wiring, LIN-709 callback mint, LIN-711 binding expiry, LIN-712 refresh/re-mint, LIN-713 per-request client threading) hold the same standard, since a security-adjacent migration is exactly where a single under-documented surface would be highest-cost.
- The strongest signal this run is again a **negative** one: the highest-risk new code (GitHub App auth, dispatch-wake orchestration) continues to paraphrase its constraints in-code even under continued heavy churn (122 commits since last review). Reaffirm by spot-check next cycle rather than re-walking these in full.

---

## Modules reaffirmed clean by spot-check (not re-walked; unchanged or lightly touched since `8de7da5`)

Per the 2026-06-25 report's clean list, spot-checked for churn rather than re-derived: **Cluster A** (proxy critical-path seams — provider selection, capability gate, comment dedupe, `proxy-ref-resolver.js`, `proxy-wire.js`), **Cluster B** (provider layer apart from F3 — `interface.js`, `registry.js`, `models.js`/`state-map.js`, Linear/Local/GitHub-Issues provider adapters), **Cluster C** (telemetry/summary apart from F4/F5 — `dispatch-terminal.js`, `run-summary.js`/cache, `session-summary.js`/cache, `sessions-feed-cache.js`, `sessions-view.js`), **Cluster D** (stores/graph/goal-gen — `task-snapshot-store.js`, `context-graph.js`, `next-run.js`, `tree.js`, `workspace.js`), plus the 2026-06-12 baseline's own reaffirmed list (`recommend-recurse.js`, `recommendation-facts.js`, `graph-features.js`, `kpi-stats.js`, `ship-layout.js`, `pipeline-loops.js`, `periodicals.js`, `trashed-signal.js`, the proxy trash path). None of these show meaningful churn since `8de7da5` beyond what's covered in "New territory" above.

---

### Trend ledger

| Finding | Severity | Sites | Delta vs 2026-06-25 | Promoted? |
|---|---|---|---|---|
| `proxy-dedupe-key-nul-separator` (F1) | Low–Medium | `lib/proxy-dedupe.js:40` | resolved (unchanged) | closed (LIN-440) |
| `composite-sort-key-magnitude-invariant` (F2) | Low | `lib/swim-graph.js:113`, `lib/swim-lanes.js:279` | unchanged, 3rd cycle | no (3rd cycle) |
| `provider-label-capability-method-not-execution-path` (F3) | Medium | `linear/index.js:1876`, `local/index.js:578`, `github/index.js:472`, gate `routes/proxy.js:2323`/`2383` | unchanged; follow-up LIN-692 still in Backlog | already promoted (LIN-692, unlanded) |
| `telemetry-heartbeat-state-vocabulary-unstated` (F4) | Low | `lib/session-telemetry.js:145` | unchanged, no new consumer | no |
| `telemetry-runtime-crosscheck-policy-unstated` (F5) | Low | `lib/session-telemetry.js:84-103` | unchanged, no new consumer | no |
| `github-recommendation-context-opts-shape` (F6) | Low | `lib/providers/github/index.js:340` (was `:260`) | site moved, unchanged otherwise | no |
| `pipeline-removal-orphaned-references` (F7) | Low | `public/common.js:181,321-325,650-652`; `public/sessions.js:12-14`; `public/recap.js:10-11`; `lib/render-styleguide.js:396` | **new** | no |

*Run of 2026-07-01 for the Comprehension-Debt Review (LIN-370 / run LIN-895). Grounded against source at HEAD `6e5d928`, not prior prose. Prior: `comprehension-debt-review-2026-06-25.md` at `8de7da5`; baseline `comprehension-debt-review-2026-06-12.md` at `f746725`.*
