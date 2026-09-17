# Harbour

A minimal, CLI-aesthetic web app — a provider-agnostic control plane for AI-augmented
software development. It started as a read-only Linear projects/issues tree viewer and grew
into a cockpit that reads any issue backend, generates grounded prompts, dispatches them to
AI agents, and verifies the work on real evidence.

> **Naming: Harbour vs Harbour OS.** **Harbour** is this product (the cockpit/control plane).
> **Harbour OS** is John's separate in-browser workstation that Harbour can *dispatch* agent
> sessions into (the `local` dispatch target; see `lib/harbour-spawn.js`). They are
> parent/child like Apple/macOS — always write the workstation as **Harbour OS** in full.
> The `local` target name and the `HAR-` eval fixtures (a separate Harbour OS Linear
> workspace used as test data) refer to the workstation, not the product brand — leave them
> as-is.

## Commands

- `npm run env:check` - Verify environment is ready (runs automatically via Claude Code hook)
- `npm install` - Install dependencies
- `npx playwright install` - Install Playwright browsers (first-time setup)
- `npm start` - Start the server (runs on PORT from .env, default 3000)
- `npm test` - Run all tests (unit via `node --test tests/unit/*.test.js`, then Playwright E2E)
- `npm run test:unit` - Run unit tests only (`node --test tests/unit/*.test.js`)
- `npm run test:hermetic` - Run the SAME unit suite under a socket-level watcher and additionally fail if any test opens a non-loopback socket (LIN-1880). This is what CI runs in place of `test:unit`, so it costs no extra time there. The unit suite reached `api.linear.app` on every run for months while two other instruments reported clean — see `tests/fixtures/network-guard.js`
- `npm run test:hermetic:proxy` - The same check with `HTTPS_PROXY`/`HTTP_PROXY` set. Native `fetch` ignores proxy env vars entirely, so a proxy-based counter cannot see this class; both arms are part of LIN-1880's acceptance
- `npm run test:ui` - Run Playwright tests with the Playwright UI
- `npm run secret-scan` - Run secret scan over repository source in CI (LIN-2573)
- `npm run scan:public-pages` - Run public pages secret scan on schedule (landing, /kpis, /archive/:n; LIN-2573)

## Code Style

- ES modules (`import`/`export`)
- 2-space indentation
- Single quotes for strings
- Semicolons

## Design Principles

- CLI/terminal *character*, not pure monospace (LIN-785 / LIN-782): a typographic split — **mono (JetBrains Mono) for machine facts** (IDs, counts, paths, tree scaffolding), **sans (Inter) for human structure/labels** (headings, prose, controls). Box-drawing (├─ └─ │) stays as subtle structural character. Both faces are self-hosted woff2 under `public/fonts/` (no build step) and head the `--font-structural` / `--font-content` stacks with robust system fallbacks.
- Light is the default theme; **dark is an opt-in `.theme-dark` hook** applied to `<html>` pre-paint by the shared shell (`lib/components/page.js`) from a persisted preference, with a global toggle in the footer. Themes are pure overrides of the color tokens; the semantic token layer (`--text/--muted/--card/--line/--brand/--amber/--slate` …) and structural tokens stay shared. Default (no class) output is unchanged.
- State indicators: ✓ (done/green), ◐ (in-progress/yellow), ○ (todo/dim)
- Mobile-responsive layout
- Keep it minimal - no frameworks, no build step

## E2E Testing Pattern (LIN-215)

E2E specs live in `tests/e2e/` (Playwright) with unit tests in `tests/unit/` (`node --test`). Two test-side seams keep specs maintainable — keep them **separate**:

- **`tests/fixtures/local-harness.js` — the provider SEEDING seam.** `seedLocalWorkspace(page, seed?, options?)` POSTs to `/test/set-local-session`, seeds the real LocalStore, and establishes a `provider: 'local'` session. It returns `{ urlKey, dashboard }`. Use it whenever a spec needs backing data. Do **not** add selector/session helpers here.
- **`tests/helpers.js` — the SESSION + SELECTOR seam.** Shared `TEST_WORKSPACE_URL_KEY` + `featuresParam()`, `createSession(page, overrides)` (wraps the Linear test-token `/test/set-session` path), the `SELECTORS` stable-selector factory, and thin page objects (`footer`, `settings`, `dashboard`). Do **not** put provider seeding here.

**Prefer `data-testid` over brittle selectors.** Render files emit `data-testid="<surface>-<element>"` (footer links/ai-status, settings sections/toggles/logout, `render.js` project + issue rows, swipe, swim). In specs, select through `SELECTORS`/page objects (`settings(page).section('account')`, `footer(page).getLink('swipe')`) instead of `:has-text()`, CSS classes, or exact `href` values. `tests/e2e/settings.spec.js` is the proof-of-pattern refactor.

**Parallel-aware caller discipline.** A spec's workspace `urlKey` is one value with three consumers — the session endpoint, the `/workspace/${urlKey}/…` navigation URLs, and the teardown/seed query params — so always drive navigation off the `urlKey` a session helper returns, never a hard-coded literal. `createSession`/`seedLocalWorkspace` return the key for this reason. Parallel execution itself (`workers > 1`) is **not** enabled yet: it needs per-worker `urlKey` isolation threaded server-side and is owned by **LIN-625**. Do not raise `workers` in `playwright.config.js` without that isolation — the historical flakiness came from shared server-side store partition keys, not Playwright context sharing.

## Unit Testing Pattern (LIN-2023)

Test servers in `tests/unit` bind `127.0.0.1` explicitly (`app.listen(0, '127.0.0.1')`), never hostless — and are addressed the way they were bound (`http://127.0.0.1:${port}`, never `localhost`). A hostless `listen(0)` binds IPv6 dual-stack and can silently coexist with an unrelated IPv4-only process already holding that port number (LIN-2023) — see `tests/unit/test-server-listen-bind.test.js` for the enforcement.

## Linear API

- Uses `graphql-request` to query Linear's GraphQL API
- OAuth tokens passed via `Authorization: Bearer {token}` header
- Fetches projects with state "started" and all issues
- Single query fetches both projects and issues

## Key Behaviors

- Unauthenticated users see landing page with static projects preview
- In Progress section shows all in-progress issues across projects
- Click issue line → toggle details (description, assignee, dates, labels)
- Click ▼ arrow → collapse/expand children
- Click project header → collapse entire project
- Click "reset" → restore default collapse state
- Collapse state persisted in localStorage
- 401 errors clear session and redirect to landing page
- Free tier users see daily prompt quota in footer and settings; 429 on limit exceeded
- `/kpis` is a public, intentionally unlinked page of instance-wide aggregate stats (Chart.js charts, 60s server cache). `lib/kpi-stats.js` is the privacy boundary: only counts and app-defined labels, never workspace keys or content

## AI Agent Support

The `/llms.txt` file provides guidance for AI agents navigating the site, including:
- DOM selectors (`data-id`, `data-status`, `data-section`, `data-parent`)
- Navigation patterns and interactive elements
- Status indicators and their meanings

**Keep llms.txt updated** when modifying DOM structure or data attributes in `render.js`.

## Where the detail lives

- `docs/architecture/source-map.md` — map of the source tree: where each module, page asset, and feature lives, plus file-local invariants (scheduler job roster, prompt-template count, etc.)
- `docs/architecture/prompt-system.md` — the two-path prompt system and the both-paths update rule; see `docs/prompt-change-validation.md` for the repeatable validation process
- `docs/architecture/views.md` — the view tiers (first-class / experimental / flagged power-user) and how they're surfaced
- `docs/architecture/auth.md` — Linear OAuth 2.0 and the rest of authentication
- `docs/architecture/configuration.md` — environment variables
- `docs/architecture/dispatch-and-proxy.md` — the Dispatch API and the Workspace API Proxy
- `docs/architecture/experiments.md` — Collective (experimental, LIN-450)
- `docs/architecture/ci.md` — GitHub Actions CI, for AI agents checking status without authentication

## Invariants

- Prompt-behavior changes (feature flags, workflow instructions, context formatting) must update BOTH paths — handwritten (`lib/prompt-templates.js` → `generatePrompt()`) and AI-generated (`lib/openrouter.js` → `lib/prompts/meta-prompt-template.js`); full detail in `docs/architecture/prompt-system.md`.
- This file must stay ≤110 lines / ≤12,000 bytes (bytes binding); the `docs/architecture/` citations above must resolve to real content, not just to an existing file.
- `ci-success` must be green on a PR before merging (it aggregates the unit and e2e jobs).
- A PAT-mode session still supports OAuth if OAuth vars are configured; see `docs/architecture/auth.md`.
- The scheduler's registered-job roster and the prompt-template count are derived from source at test time, never hand-pinned; see `docs/architecture/source-map.md`.
