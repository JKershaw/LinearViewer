# LIN-482 — UI Simplification Options (research / decision)

Status: research/decision pass (no build work). Follow-up to the **LIN-368**
epic; this is the deferred **Phase C decision point** named in
[`docs/ui-improvement-strategy.md`](./ui-improvement-strategy.md). Concrete UI
changes are out of scope and become separate tickets.

> **Outcome (decided with owner, 2026-06-15).** Direction agreed; see
> [Decision & follow-up](#decision--follow-up-decided-2026-06-15) at the end.
> Step 1 (comprehensive tidy-up to one source of truth) is ticketed under
> **LIN-491**; a tool/framework (htmx) is **deferred to Step 2**. Note the
> [correction](#decision--follow-up-decided-2026-06-15) on deliberate
> divergence — some flagged "duplication" is load-bearing and must be kept.

## Recommendation (TL;DR)

**Continue incrementally — finish adopting the layer we just built. Do not start
a full redesign yet, and do not add a framework.**

The order of leverage, by evidence:

1. **No framework.** It contradicts a core, restated design principle ("no
   frameworks, no build step") *and* would orphan the hand-rolled component
   layer that LIN-368 just finished building. Strong no.
2. **Not a full redesign yet.** The strategy doc's promise was that a redesign
   collapses to "restyle ~8 components" *once adoption is finished*. Adoption is
   **not** finished (numbers below), so a redesign today would have to restyle
   both the canonical components *and* the surviving bespoke variants — i.e. the
   cost has not actually collapsed yet. Finishing adoption is the prerequisite
   that makes the redesign decision cheap and real.
3. **Incremental polish is the supported direction** and it is almost entirely
   *adoption* work against seams that already exist — low-risk, E2E-guarded,
   no new architecture required.

The two **product-level** calls that this pass surfaces (and that a planner can
act on): **retire or fold `/ship`** (it is orphaned — no inbound link anywhere),
and **confirm the first-class view set** (dashboard, swipe, swim, settings).

## How this was measured (HEAD = `5d00b49`)

- `wc -l` over `lib/render*.js`, `public/*.css`, `public/*.js`.
- `grep -rL renderPage lib/render*.js` (shell adoption).
- Component usage: `grep -rl renderSection|renderCard|…`.
- Token adoption: `grep -roh 'var(--space|--radius|--shadow|--z-|--font-size'`.
- Residual hardcoded hex: `grep -rohE '#[0-9a-fA-F]{3,6}'` over `public/*.css`.
- Client primitive adoption: `grep -rc 'fetch('` / `api(` / `modal` / `toast`.
- View discoverability: `grep` for inbound links to each route across
  `lib/components/footer.js`, `lib/render*.js`, `public/*.js`,
  `lib/render-settings.js`.
- Staleness: `git log --since=2026-06-14T13:39 -- <component paths>` → empty
  (ticket premise is current; the layer at HEAD is exactly as the ticket
  describes).

## What the epic actually delivered (status at HEAD)

The LIN-368 plan ran **Phase 0 → A → B**. The *foundation* is complete; the
*adoption/convergence* is partial. This gap is the central finding.

| Layer | Plan | State at HEAD | Verdict |
|---|---|---|---|
| Shared page shell `renderPage()` | Phase 0A | **All** `render*.js` use it; `errors.js` too (LIN-481) | ✅ complete |
| Design tokens (`:root`) | Phase 0B | Full set **defined** (space/radius/shadow/z/font-size) | ✅ defined… |
| Token *wiring* | Phase 0B | …but largely **unwired** — see below | ⚠️ partial |
| `/styleguide` + visual baselines | Phase 0C/0D | `/styleguide` live; baselines for pages/ship/swim | ✅ present |
| Server components (6) | Phase A | `section`/`pageHeader` ×14, `emptyState` ×8, `field` ×7, `card` ×6, `statusPill` ×3 | ✅ exist, adopted in simpler surfaces |
| Client primitives (`api`/`toast`/`modal`) | Phase B | Defined in `common.js`; "wave-1" adoption only | ⚠️ partial |
| IA / layout / first-class views | Phase C | **deferred — this ticket** | ⬜ decision pending |

### Adoption residuals (the real remaining work — all incremental)

- **Tokens defined ≠ used.** `public/style.css:` carries the full scale, but the
  source comment says outright: *"definitions only — not yet wired to sites."*
  Measured wiring: `var(--space*)` 44 uses, `--radius` 11, `--shadow` **1**,
  `--z-*` **0**, `--font-size*` 18 — across ~10k lines of CSS. Hardcoded hex
  dropped from the doc's 317 → **149** (still `#e0e0e0` ×17, `#ddd` ×11, etc.
  bypassing `--border`). Color tokenization is roughly half done; spacing/
  elevation/z-index are essentially un-adopted.
- **`api()` is wave-1 only.** `window.api` exists in `common.js` but only
  `dispatch.js` calls it; **~66 raw `fetch()` calls remain** (app.js 13,
  foreman 8, roadmap 7, dispatch 7, proxy 6, prompt-section 6, pipeline 5, …).
- **`modal()`/`toast()` converged on 2 of ~5 sites** (dispatch, proxy). The
  app/pipeline/ship modal copies the doc flagged are not yet retired.
- **Per-page component variants survive in the heavy views.** The canonical
  classes exist (`.section`, `.section--boxed`, `.card`, `.card-accent--*`,
  `.status-pill--*`, `.badge`) **and coexist with** bespoke variants that were
  kept as deliberate divergences during A/B: `.foreman-section`,
  `.roadmap-section`, `.dispatch-section`, `.proxy-section`, `.settings-section`;
  `.foreman-now-card`, `.foreman-stack-card`, `.swim-fcard`, `.swipe-card*`,
  `.ship-rect-cards`, `.roadmap-milestone-card`, `.prompt-card`; pills/chips
  `.cell-stage-badge`, `.foreman-filter-chip`, `.foreman-session-chip`,
  `.ship-heading-chip`. The migration adopted the canonical vocabulary in the
  *simpler/newer* surfaces; the **high-complexity interactive views
  (foreman, swim, swipe, ship, roadmap, pipeline) still carry their own.**

## View inventory: first-class vs. secondary vs. retire

Navigation is almost entirely via the **footer** (the de-facto view switcher);
the top nav bar only carries workspace/team selectors, projects, search, and the
queue badge. Mapping every page route to its inbound links:

| View | Route | Surfaced via | Class |
|---|---|---|---|
| Dashboard (projects) | `/` , `/workspace/:k/` | nav + footer | **First-class** |
| Swipe | `…/swipe` | footer (always) | **First-class** |
| Swim | `…/swim` | footer (always) | **First-class** |
| Settings | `…/settings` | footer (always) | **First-class** |
| Roadmap | `…/roadmap` | footer **iff** `roadmap` flag | Flagged / power-user |
| Dispatch | `…/dispatch` | footer **iff** `dispatch` flag | Flagged / power-user |
| Proxy | `…/proxy` | footer **iff** `proxy` flag | Flagged / power-user |
| Foreman | `…/foreman` | footer **iff** `proxy` flag | Flagged / power-user |
| Pipeline | `…/pipeline` | footer **iff** `pipeline` flag | Flagged / power-user |
| Collective | `…/collective` | settings link, `collective` flag off | **Experimental (V1)** |
| **Ship** | `…/ship` | **no inbound link anywhere** | **Orphaned** |
| Styleguide | `/styleguide` | dev reference, unlinked | Utility |
| KPIs | `/kpis` | intentionally public+unlinked | Utility |
| Audit | `…/audit` | operator, unlinked | Utility |
| Prompts / custom-prompts | `…/prompts[/custom]` | settings/prompt flows | Supporting |
| Legal | `/privacy`,`/terms` | footer legal | Supporting |

Findings:

- **`/ship` is orphaned.** The route exists (`server.js:701`, `:1119`) and it has
  visual baselines, but **nothing links to it** — not the footer
  (`getFooterLinks` never lists it), not the nav, not settings, not the
  dashboard. It is reachable only by typing the URL. It is a radial *variant of
  the same dependency-graph data swim already renders* and even shares
  `swim.css`. **Decision needed:** retire it, or fold its radial mode into swim
  as a layout toggle. Evidence favours retire/fold over promoting a second
  unlinked graph view.
- **First-class set is already implicit and coherent:** dashboard + swipe + swim
  + settings (the always-on footer links). Recommend ratifying exactly this set
  as first-class and giving *only these* the shared-layout/IA treatment.
- **Collective is correctly quarantined** (flag-off, settings-only, documented
  V1 gaps). No action — leave experimental.
- **The flagged power-user views are fine flagged** (roadmap/dispatch/proxy/
  foreman/pipeline). They are the heaviest, most-divergent surfaces and are the
  main home of the residual duplication above — they are where convergence work
  pays back most, but they need no IA promotion.

## Shared layout / IA opportunity

Every page now shares the *document* shell (`renderPage`) and a `pageHeader`,
but there is **no shared content-frame/layout** and **no canonical view
switcher** — navigation is an ad-hoc footer list with one orphaned view. This is
the one genuine *structural* gap the foundation did not close. It is an
**improvement, not a requirement** for incremental work (see Surface Assessment),
and it is small in scope when taken on: a `renderLayout`/view-switcher seam plus
ratifying the first-class set. It should be its own ticket, sequenced *after* the
adoption residuals, not blended into them.

## The three named options, assessed

**Incremental polish — RECOMMENDED.** Almost all remaining value is *adoption of
existing seams*: wire tokens, retire raw `fetch()` for `api()`, converge the
remaining modal/toast copies, migrate the heavy views' bespoke section/card/pill
variants onto the canonical components. Each is mechanical, independently
shippable, and guarded by the existing 39 E2E specs + the Phase 0D visual
baselines. Drift no longer re-accumulates because there is now one source of
truth per concept. This is the direction the evidence supports.

**Full redesign — premature.** The redesign's cost only collapses to "restyle
the ~8 shared components" *after* the surfaces actually consume those components.
Today the heavy views still carry bespoke CSS and ~66 ad-hoc fetches, so a
redesign would fight two systems at once. Revisit redesign-vs-incremental as a
real decision point *after* the adoption waves land — by then the baselines turn
it into a reviewable diff rather than a leap.

**Framework (ejs / htmx / React / …) — no.** Two independent reasons:
(1) it contradicts the core principle stated in `CLAUDE.md` ("Keep it minimal —
no frameworks, no build step") and restated as a non-negotiable in the strategy
doc; (2) it would discard the component layer LIN-368 just built — the
template-literal components *are* the deliberate, build-step-free answer to "are
we inventing our own framework?" The honest reframing of the framework question
is "should we keep investing in the homegrown layer?" — and the answer is yes,
because the layer is built and works; the gap is adoption, which a framework
would not shortcut (it would *re-do* it). If a single ergonomic pain point ever
justifies one dependency, the precedent is the vendored-single-file approach
already used (`marked.min.js`, `purify.min.js`, `chart.umd.min.js`) — a
build-step-free vendored helper, not a framework. Not warranted now.

## Surface Assessment (necessity-gated)

**The current shape lands cleanly for the recommended next steps — a refactor is
NOT required to make simplification viable.** The seams the remaining work
consumes already exist and are the exact consumers:

- finishing token wiring consumes `:root` (defined) — CSS-only edits;
- `api()` adoption consumes `window.api` in `common.js` (already the seam,
  already consumed by `dispatch.js`);
- `modal()`/`toast()` adoption consumes the `common.js` helpers (already
  consumed by `dispatch.js`/`proxy.js`);
- heavy-view convergence consumes `renderSection`/`renderCard`/`renderStatusPill`
  /`renderField`/`renderEmptyState` (already consumed by 6–14 call-sites each).

So the remaining incremental work is *calling existing components from the
un-migrated sites* — no new seam, no structural change.

**One improvement (explicitly not required):** there is no shared
content-frame/layout component or canonical view-switcher (the deferred Phase C
layout item). This is a real but optional structural addition. Per the necessity
gate it is **not** a blocking prerequisite for the adoption work, so it is kept
scoped to its own follow-up (the IA/layout ticket) rather than pulled forward —
no consumer in the adoption work calls such a seam, which by the consumer test
means introducing it now would be speculation.

## Recommended sequencing (each → its own follow-up ticket)

1. **Finish token wiring** — map the remaining 149 hex onto `--border`/grays;
   wire spacing/elevation/z-index. Guard with the Phase 0D visual baselines.
2. **Finish `api()` adoption** — retire the ~66 raw `fetch()` calls wave by wave.
3. **Finish `modal()`/`toast()` convergence** — retire the app/pipeline/ship
   copies.
4. **Converge the heavy views** — migrate `foreman`/`swim`/`swipe`/`roadmap`/
   `pipeline` bespoke section/card/pill variants onto the canonical components;
   delete the dead per-page CSS.
5. **View decision (product)** — retire or fold `/ship`; ratify first-class set
   (dashboard/swipe/swim/settings); leave collective experimental.
6. **IA/layout pass** — shared content-frame + canonical view-switcher for the
   first-class set (the optional structural item above).
7. **Re-evaluate redesign vs. incremental** at a genuine decision point, once
   1–4 have landed and the cost has actually collapsed.

Steps 1–4 are pure incremental adoption (low risk). Step 5 is the product call
this research surfaces. Steps 6–7 are the deferred, optional Phase-C structure
and the eventual redesign gate.

## Decision & follow-up (decided 2026-06-15)

After the research above, the direction was decided with the owner.

**On the "no frameworks" rule.** It was reaffirmed *for now*, with a refinement:
the half worth keeping is *"no SPA / no build step"* (cheap to hold); the half
with rising cost is *"no helpers at all"* — already quietly relaxed via the
vendored single-file helpers (`marked`/`purify`/`chart`). Split by axis:

- **Styling / token complexity → no tool fixes it.** Every option (Tailwind,
  Open Props, classless CSS) is built on tokens; the pain is the *half-wired*
  state, not the concept. Finishing the wiring is the simplifier; a CSS
  framework would also fight the CLI aesthetic and the bespoke visualizations.
- **Interactivity / data axis → one tool has real merit: htmx** (vendored,
  no build step, fits the server-rendered model; would retire the per-page
  `fetch()`+DOM-patch JS for the CRUD-ish surfaces — not the visualizations).
  **Deferred to Step 2.**
- **React/Vue/Svelte → no** (rewrite + build step + orphans the current layer).

**Agreed two-step plan.**

1. **Step 1 — comprehensive tidy-up to one source of truth (decided, ticketed).**
   Bring the LIN-368 layer to 100% adoption with **no dangling pieces**, *before*
   evaluating any tool. Owner's principle: finish the alignment even where Step 2
   might rework part of it — solid ground with nothing dangling is the best base
   to choose from (so the Step-1 client-primitive convergence is completed *now*,
   intentionally, even though an htmx spike may later absorb it).
2. **Step 2 — evaluate a nicer setup on the clean base (deferred, not ticketed).**
   Spike htmx + a clean data API on one converged page, judge from real code,
   then decide rollout.

**Why the migration had stalled (investigated, not assumed).** Not abandoned:
LIN-368 deliberately closed at the *capability + proof-of-adoption* milestone —
Phase A (LIN-460) migrated only pages with a *true server-side seam* and
documented the rest; Phase B (LIN-475) shipped `api()` as **wave-1**; token
wiring was a conscious "definitions only" choice (LIN-456). The remaining waves
were simply never re-ticketed. LIN-491 now gives them a home.

**Correction to the residual estimate above.** Much of the "residual
duplication" tabulated earlier is **deliberate, load-bearing divergence**, not
unfinished work, and must be preserved: swipe gesture affordances
(12px radius/shadow/accent), `.swim-box`/ship graph primitives, foreman's
documented delta, and hook classes that client JS + E2E selectors depend on
("remove duplicate *styling*, never the names"). The genuinely-unfinished part is
narrower: token wiring, `api()` waves 2+, and 2–3 leftover modal/toast copies.

**Step 1 tickets (under umbrella LIN-491):**

| Ticket | Work |
|---|---|
| LIN-492 | Expand visual baselines to convergence surfaces (safety net — first) |
| LIN-493 | Finish token wiring — one source of truth in `:root` |
| LIN-494 | Converge genuinely-duplicated server components (preserve divergences) |
| LIN-495 | Finish client-primitive adoption — `api()` waves + modal/toast |
| LIN-496 | Retire-or-fold orphaned `/ship`; ratify first-class view set |
