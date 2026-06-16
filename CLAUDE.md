# Linear Projects Viewer

A minimal, CLI-aesthetic web app that displays Linear projects and issues as a collapsible tree.

## Commands

- `npm run env:check` - Verify environment is ready (runs automatically via Claude Code hook)
- `npm install` - Install dependencies
- `npx playwright install` - Install Playwright browsers (first-time setup)
- `npm start` - Start the server (runs on PORT from .env, default 3000)
- `npm test` - Run all tests (unit via `node --test tests/unit/*.test.js`, then Playwright E2E)
- `npm run test:unit` - Run unit tests only (`node --test tests/unit/*.test.js`)
- `npm run test:ui` - Run Playwright tests with the Playwright UI

## Architecture

Map of the source tree. Per-page assets and feature modules are grouped by the
surface they serve; a handful of small helpers may not be listed individually.

```
server.js              Express server, main entry point, dashboard routes
routes/
  auth.js              Linear OAuth routes
  openrouter-auth.js   OpenRouter OAuth PKCE routes
  workspace.js         Workspace management routes
  dispatch.js          Dispatch queue API (user + consumer endpoints)
  proxy.js             Linear API proxy (token auth, read/write endpoints, cycles, labels, foreman)
  pipeline.js          Pipeline page and JSON polling routes
  collective.js        Collective experiment (experimental): page, multi-workspace dispatch fan-out, Yap state/say proxy (LIN-450)
  dashboard.js         Autopilot dashboard (experimental): page, merged cross-workspace Loop feed, on-demand run-summary, lazy Linear hydration (LIN-509)
  workspace-api.js     Workspace API routes (prompts, recommendations, audit, comments, images)
  test.js              Test-only routes for E2E tests (mock sessions, fixtures)
  legacy-redirects.js  Backward-compatible redirects for old URLs
lib/
  linear.js            GraphQL client for Linear API
  linear-cli.js        CLI tool for AI agents to query/modify Linear
  bash-tool.js         Safe bash executor with data/code separation (stdin + argv modes)
  tree.js              Transforms flat issues → nested tree structure (frontier ranking in selectFocusSubtask)
  graph-features.js    Network-free blocking-graph / critical-path primitives (shared by swipe + frontier ranking)
  openrouter.js        OpenRouter API client for AI recommendations
  providers/           Provider abstraction (decouples views from Linear specifics)
    interface.js       Provider interface contract
    registry.js        Provider registry
    models.js          Canonical state model
    state-map.js       Maps provider states → canonical model
    linear/index.js    Linear provider adapter
    local/index.js     Local provider adapter (writable, Mongo/Mango-backed; LIN-356)
  render.js            Dashboard page renderer (tree view, sections)
  render-pages.js      Standalone page renderers (login, error, workspace-not-found)
  render-audit.js      Operator dashboard page renderer
  render-settings.js   Settings page renderer
  render-prompts.js    Prompts catalog page renderer
  render-custom-prompts.js  Custom prompts page (/prompts/custom) renderer
  render-dispatch.js   Dispatch page renderer (prompt, queue, tokens, history)
  render-pipeline.js   Pipeline page renderer (floor view shell)
  render-collective.js Collective page renderer (experimental discussion shell)
  render-dashboard.js  Autopilot dashboard page renderer (experimental; mobile-first feed shell, Foreman/Swipe-modeled)
  render-foreman.js    Foreman page renderer (live observation view)
  render-roadmap.js    Roadmap page renderer (delivery-focused)
  render-ship.js       Ship page renderer (radial view shell)
  render-swim.js       Swim lanes page renderer
  render-swipe.js      Swipe page renderer (mobile-first task swipe)
  render-proxy.js      Proxy token management UI
  render-legal.js      Privacy Policy / Terms of Service renderers
  render-kpis.js       Public /kpis instance stats page renderer
  kpi-stats.js         Instance KPI aggregation (privacy boundary for public /kpis)
  pipeline-state.js    Pipeline state builder (snapshot assembly)
  pipeline-loops.js    Pipeline loop reconstruction library
  sessions-view.js     Adapts pipeline Loop records into the sessions view
  roadmap.js           Roadmap deterministic layer (velocity, execution order, milestones)
  ship-layout.js       Ship view layout primitives (pure)
  swim-lanes.js        Swim lane assignment algorithm
  swim-graph.js        Swim dependency-graph model (flow / side-rail view)
  prompt-templates.js  Prompt template query functions and main entry point
  prompt-formatters.js Shared formatting helpers for prompt templates
  prompt-template-defs.js  Prompt template definitions (15 templates)
  completion-signals.js  Completion signals for prompt assessment
  custom-prompts-store.js  Custom prompt template storage (per workspace)
  prompts/
    meta-prompt-template.js  Meta-prompt for AI recommendation generation
    autopilot-kickoff.js     Autopilot kickoff briefing template
    autopilot-manual.js      Autopilot operating manual ("handbook")
    foreman-playbook.js      Foreman playbook template
    collective-participant.js  Collective discussion participant prompt (experimental, LIN-450)
    roadmap-*.js             Roadmap narrative-pipeline templates (orientation,
                             trajectory, north-star, product, gap, narrative, digest, chat)
  recap.js             Task recap prompt + response handling
  recap-cache.js       Hash-based cache for AI recaps
  run-summary.js       On-demand short summary of a single autopilot run (Loop); mirrors recap.js (LIN-509)
  run-summary-cache.js Cache for AI run summaries, keyed ${workspaceId}:${loopId}, 30-day TTL (LIN-509)
  dispatch-terminal.js Terminal-marker detection for dispatch runs ([done]/[failed]/… feedback → terminal status); shared by proxy watch endpoints + dashboard Loop feed (LIN-400/LIN-509)
  brief.js             Current-state task brief prompt + handling
  brief-cache.js       Hash-based cache for AI briefs
  recommend-recurse.js Server-side recommendation recursion (defer routing)
  recommendation-facts.js  Deterministic, network-free per-node fact assembly (assembleNodeFacts) — single fact seam for both prompt paths
  session-store.js     MongoDB/MangoDB session store
  user-preferences.js  Cross-device preference storage (MongoDB)
  workspace-preferences.js  Workspace-level preference storage
  workspace.js         Multi-workspace session management helpers
  local-store.js       Local provider's issue/project store (scope-partitioned collection)
  dispatch-store.js    Dispatch queue storage
  dispatch-tokens.js   Consumer API token management
  foreman-store.js     Foreman status append-only log storage
  report-history-store.js  Durable per-workspace roadmap report runs
  llm-call-log.js      Append-only per-LLM-call metadata log (model, provider, tokens, cost, time; LIN-418)
  free-tier-store.js   Free tier usage tracking and rate limiting
  proxy-tokens.js      Proxy token hashing and validation
  proxy-events.js      Proxy event audit logging
  proxy-fetch.js       Proxy-aware fetch for HTTP_PROXY environments
  periodicals.js       Periodicals registry (scheduled task generation)
  queue-config.js      Maps internal queue model → Linear states/labels
  workflow-config.js   Centralized workflow label configuration
  harbour-spawn.js     Spawns Claude Code sessions in Harbour OS (OSC escapes)
  harbour-feedback-tokens.js  Short-lived single-use feedback tokens for repo agents
  yap-client.js        Thin server-side HTTP client for the Yap chat server (Collective; channel/nick helpers)
  audit.js             Workspace audit module (computes audit report from Linear)
  feature-defaults.js  Feature toggle keys, defaults, and helpers
  token-refresh.js     Linear OAuth token refresh
  http-keepalive.js    Defuses Heroku H12 30s router timeout on long handlers
  errors.js            Error response helpers
  parse-landing.js     Parses markdown content for landing page
  utils/html.js        HTML utility functions
  components/
    navbar.js          Nav bar with workspace/team selectors, queue badge
    footer.js          Footer with deploy info, AI status
content/
  landing.md           Static projects preview for unauthenticated users
public/
  style.css            Light theme, mobile-responsive
  app.js               Client-side collapse/expand, localStorage persistence
  common.js            Shared client utilities
  common-actions.css   Shared action/button styles
  llms.txt             AI agent guidance (DOM selectors, navigation patterns)
  marked.min.js        Vendored Markdown renderer
  purify.min.js        Vendored DOMPurify (HTML sanitizer)
  chart.umd.min.js     Vendored Chart.js (used by /kpis)
  audit.css / audit.js          Operator dashboard
  kpis.css / kpis.js            Public /kpis instance stats page
  settings.css                  Settings page
  prompts.css                   Prompts catalog page
  custom-prompts.css / .js      Custom prompts page
  dispatch.css / dispatch.js    Dispatch page (prompt, queue, tokens, history)
  pipeline.css / pipeline.js    Pipeline floor view (polling, diffing, overlays)
  collective.css / collective.js  Collective page (setup, transcript poll, say box)
  dashboard.css / dashboard.js  Autopilot dashboard (merged-loops poll, status banner, autopilot-scope + workspace filters, runs grouped into expandable task sessions, run-summary at top of each session)
  foreman.css / foreman.js      Foreman observation page
  roadmap.css / roadmap.js      Roadmap page
  ship.css / ship.js            Ship radial view
  swim.css / swim.js            Swim lanes view
  swipe.css / swipe.js          Swipe (mobile) view
  proxy.css / proxy.js          Proxy token management page
  prompt-section.js, brief.js, recap.js, sessions.js  Shared client section renderers
tests/
  unit/                Node test runner unit tests (lib modules, renderers, stores)
  e2e/                 Playwright E2E specs (landing, dashboard, auth, dispatch, proxy, …)
  fixtures/            Shared mock data and test helpers
  screenshots/         Reference images for visual specs
  visual/              Playwright visual-regression specs
docs/
  dispatch-integration.md      Dispatch consumer integration guide
  proxy-integration.md         Linear API proxy consumer integration guide
  prompt-change-validation.md  Prompt-behavior change validation process
playwright.config.js   Playwright test configuration
playwright.visual.config.js  Playwright config for visual-regression specs
```

### Prompt System (two independent paths)

Changes to prompt behavior (feature flags, workflow instructions, context formatting) must update BOTH:

- **Handwritten prompts**: `lib/prompt-templates.js` → `generatePrompt()` — deterministic, template-based
- **AI-generated prompts**: `lib/openrouter.js` → `lib/prompts/meta-prompt-template.js` — LLM generates via meta-prompt

**Deterministic grounding sections are a single shared post-pass (LIN-435), not duplicated prose.** Four rules — the staleness check, terminal-state note, all-subtasks-complete note, and bug-already-investigated note — are appended by `appendGroundingSections(prompt, issue, context)` (`lib/prompt-formatters.js`), which BOTH paths run as a post-pass over their rendered body: the handwritten path calls it in `generatePrompt()`; the AI meta-prompt path calls `applyGroundingToRecommendation(structured, issue, context, …)` (`lib/openrouter.js`) on the LLM's parsed `## Prompt` output at the three recommendation seams (`getRecommendation` return, the streaming branch, and — via the streamed prompt delta — the leaf view). The rule therefore executes ONCE for both paths (mirroring the capability-awareness post-pass below), so the meta-prompt no longer re-types these rules as prose and they cannot drift. Skipped for `defer` replies (`prompt === null`, the no-body cost contract); the pure parser `parseRecommendationResponse` stays free of `issue`/`context`. This is what fixed the meta path's broken staleness `--since` date (now injected deterministically from `issue.createdAt`, never a placeholder). Cross-path parity is pinned by the grounding-parity tests in `tests/unit/prompt-templates.test.js`.

The ticket staleness check (re-ground against current code: list referenced files/symbols, `git log --since=<createdAt>`, re-read source at HEAD before trusting the ticket) is `formatStalenessCheck()`, appended via the shared post-pass above.

The terminal-state *body note* (LIN-353 — a Done/Canceled/Duplicate task with no open children is steered to review/close, never a no-op `look-into`) is `formatTerminalStateNote()`, also via the shared post-pass. Its *recommender routing* counterpart — the meta-prompt's "Step 0" decision branch that selects the `review` action — remains in the meta-prompt, because action selection is a meta-path-only concern the handwritten path has no equivalent of. (The deterministic descent guard that refuses defers into terminal nodes is separate, in `lib/recommend-recurse.js`.)

The bug-already-investigated *body note* (LIN-366 — a `bug`-labelled task with prior investigation in its comments advances to the fix instead of re-recommending investigation, because the `bug` label alone is not a reason to re-investigate) is `formatBugInvestigatedNote()`, via the shared post-pass; its *routing* counterpart — the "First check whether the bug has already been investigated" escape hatch in the meta-prompt's Step 2 — remains in the meta-prompt for action selection. It is a soft signal (no deterministic "investigated" marker exists; findings live in free-form comments), gated on `bug` label + ≥1 comment.

The class check (LIN-313 — "widen the model, don't patch the witness": once a bug's root cause is in hand, or before a review approves the close, ask whether the work is an isolated instance or one of a class with unhandled siblings) lives in BOTH paths — woven into the bug template's investigation steps and the review template's "Isolated, or One of a Class?" section in `lib/prompt-template-defs.js`, and the Bug-prompts rule + Review-prompts rule (5) in the meta-prompt's quality rules. The directive never expands scope: a found class is named and its instances recorded (comment / review finding) while the fix stays minimal, and a genuinely isolated result is explicitly valid. It is the execution-altitude sibling of the plan template's Completeness check (LIN-295).

The Surface Assessment necessity gate (LIN-192 origin, LIN-397 gate — research ends with an explicit verdict on whether the feature's shape *demands* a structural change, and plan turns only a *necessary* prerequisite refactor into a separate blocking subtask) lives in BOTH paths — the research template's Surface Assessment block + the plan template's conditional ratchet in `lib/prompt-template-defs.js`, and the Research-prompts + Plan-prompts quality rules in the meta-prompt. A `refactor required` verdict must pass two citation tests: the consumer test (cite the line in THIS task that calls the new seam — no citation means speculation) and the who-pays test (every touched consumer is a beneficiary or a named-tax bystander — unjustified bystander tax means scope it down). A third verdict (`improvement noticed, not required`) gives noticed-but-not-demanded improvements a non-blocking home. Size is never a rejection criterion: a demanded refactor that doesn't fit the session is sequenced via the blocking subtask, not shrunk — effort is cheap for agents; speculation and bystander tax are not.

Provider capability-awareness (LIN-177 S4/S5) also spans BOTH paths via a single shared surface: `resolvePromptUi()` + `applyPromptCapabilities()` in `lib/prompt-formatters.js`. Call sites thread the active provider's `provider.ui` (`{write, comments, estimates, subtasks, displayName}`, from `getProviderForWorkspace(workspace)`) into `generatePrompt()`/`generateCustomPrompt()` (handwritten) and `buildMetaPrompt()`→`buildMetaPromptTemplate()` (meta). Provider capability is the hard floor; the `linearMcp` user flag is a soft preference within a writable provider. For Linear (every flag on, `displayName: 'Linear'`) every transform is a no-op, so Linear output is **byte-identical** — pinned by the parity test in `tests/unit/prompt-templates.test.js`. (`issue.source.provider` is not populated on canonical issues, so provider identity must come from the workspace, not the issue object. The token-auth proxy paths in `routes/proxy.js` stay on the Linear default until the proxy data-fetch is re-pointed under LIN-306.)

When changing prompt behavior, see **[docs/prompt-change-validation.md](docs/prompt-change-validation.md)** for the repeatable process (both-paths rule, overfitting guards, structural tests, and the offline A/B eval harness `scripts/eval-completeness-check.mjs`).

### View Tiers

Views are surfaced in one of three deliberate tiers (LIN-496). **First-class** (dashboard / swipe / swim / settings) — always-on footer links, no flag. **Experimental** (collective / taskChat / ship / dashboard) — per-user flag (default off) in `lib/feature-defaults.js`, listed in `EXPERIMENTAL_FEATURES` in `lib/render-settings.js`, surfaced **only** via a Settings link when on, and route-gated to redirect to `/settings` when off. (Naming note: the **first-class** "dashboard" is the unprefixed project tree view at `/workspace/:urlKey/`; the **experimental** `dashboard` flag/view is the separate realtime, cross-workspace *autopilot* dashboard at `/workspace/:urlKey/dashboard` — LIN-509. Same word, two surfaces.) **Flagged power-user** (roadmap / dispatch / proxy / foreman / pipeline) — per-user flag plus a conditional footer link in `lib/components/footer.js`. `/ship` is a key in-development experiment (radial dependency layout), not a retirement candidate; its radial layout is the protected experiment and its token wiring is LIN-500. Full model + the Step-2 "new canvas/radial concept doesn't fit the section/card/token model" friction note: **[docs/view-tiers.md](docs/view-tiers.md)**.

## Code Style

- ES modules (`import`/`export`)
- 2-space indentation
- Single quotes for strings
- Semicolons

## Design Principles

- CLI/terminal aesthetic: monospace font, box-drawing characters (├─ └─ │)
- Light theme with clean colors
- State indicators: ✓ (done/green), ◐ (in-progress/yellow), ○ (todo/dim)
- Mobile-responsive layout
- Keep it minimal - no frameworks, no build step

## Authentication

### Linear OAuth 2.0

```
GET /auth/linear     → Redirect to Linear OAuth (with state parameter)
GET /auth/callback   → Exchange code for access token, store in session
GET /logout          → Destroy session, redirect to login
```

- Sessions stored in MongoDB (production) or MangoDB file-based storage (development)
- Tokens expire after 24 hours (with automatic refresh)
- State parameter validated to prevent CSRF

### Personal Access Token (PAT) Mode

For local development without OAuth configuration:

1. Get a personal API key from: https://linear.app/settings/api
2. Set `LINEAR_ACCESS_TOKEN=lin_api_xxxxx` in your `.env` file
3. Start the server — you'll be logged in automatically

PAT mode:
- Auto-creates a session on first visit (no OAuth redirect)
- Single workspace only (tied to the token's organization)
- Token never expires (no refresh needed)
- OAuth still works alongside PAT if OAuth vars are configured
- Logout destroys session, but next visit re-creates it automatically

### OpenRouter OAuth (PKCE)

Users can connect their OpenRouter account for AI recommendations:

```
GET /auth/openrouter           → Redirect to OpenRouter OAuth (with PKCE)
GET /auth/openrouter/callback  → Exchange code for API key, store in session
POST /auth/openrouter/disconnect → Remove stored API key
```

- Uses PKCE flow with S256 code challenge method
- Returns a permanent API key (no expiry, no refresh needed)
- API key stored in session alongside Linear workspace tokens
- Falls back to `OPENROUTER_API_KEY` env var if no OAuth connection

### Free Tier (Rate-Limited)

When `OPENROUTER_FREE_TIER_KEY` is set, users without an OpenRouter connection get limited free prompts:

- API key source priority: user OAuth > env key > free tier key > none
- Per-workspace daily limit: 20 prompts (resets at midnight UTC)
- Global hourly limit: 50 prompts across all workspaces
- Uses atomic check-and-increment (`tryUse()`) to prevent race conditions
- Footer shows `ai: ● free (N/20)` status; settings page shows usage info
- Returns 429 with usage metadata when limits exceeded

## Environment Variables

```
LINEAR_CLIENT_ID        OAuth client ID from Linear
LINEAR_CLIENT_SECRET    OAuth client secret from Linear
LINEAR_REDIRECT_URI     Callback URL (must match Linear OAuth app config)
LINEAR_ACCESS_TOKEN     Personal API key for auto-authentication (optional, bypasses OAuth)
SESSION_SECRET          Secret for signing session cookies
PORT                    Server port (default: 3000)
MONGODB_URI             MongoDB connection string (optional, uses file storage if not set)
OPENROUTER_API_KEY      Server-side OpenRouter API key (optional, users can connect via OAuth)
OPENROUTER_REDIRECT_URI Callback URL for OpenRouter OAuth (optional, defaults to /auth/openrouter/callback)
OPENROUTER_FREE_TIER_KEY Server-side API key for free tier users (optional, enables rate-limited free prompts)
YAP_BASE_URL            Yap chat server base URL for the experimental Collective live view (optional, defaults to https://yap.jkershaw.com)
YAP_PASSWORD            Yap server password (optional, sent as Bearer auth on Yap calls)
```

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

## Dispatch API

The Dispatch feature allows users to queue prompts for external consumers (AI agents, automation tools).

**User-facing endpoints** (session auth, workspace-prefixed):
- `POST /workspace/:urlKey/api/dispatch` - Queue a prompt
- `GET /workspace/:urlKey/api/dispatch` - List queued items
- `DELETE /workspace/:urlKey/api/dispatch/:itemId` - Remove item
- Token management at `/workspace/:urlKey/api/dispatch/tokens`

**Consumer endpoints** (Bearer token auth):
- `GET /api/dispatch/poll` - Poll for available items
- `POST /api/dispatch/take/:itemId` - Atomically claim an item
- `POST /api/dispatch/feedback/:itemId` - Post feedback on a taken item

Items expire after 24 hours. Tokens are workspace-scoped and never expire (but can be revoked).
Feedback is append-only, inherits 30-day history TTL, and requires strict token ownership.

**See [docs/dispatch-integration.md](docs/dispatch-integration.md)** for the full consumer integration guide.

## Linear API Proxy

The proxy allows authenticated users to generate secure tokens for external AI agents and automation tools to interact with their Linear workspace via a REST-like API.

**Key features:**
- Token-based authentication (Bearer tokens with SHA-256 hashing)
- Read/write scope separation (`read` for queries, `readWrite` for mutations)
- Single-use token support (consumed after first request)
- Event audit logging (30-day TTL)
- Rate limiting (60 requests/minute per IP)
- Workspace isolation (tokens are scoped to a single workspace)

**User-facing endpoints** (session auth, workspace-prefixed):
- `POST /workspace/:urlKey/api/proxy/tokens` - Create a proxy token
- `GET /workspace/:urlKey/api/proxy/tokens` - List tokens
- `DELETE /workspace/:urlKey/api/proxy/tokens/:tokenId` - Revoke token
- `GET /workspace/:urlKey/api/proxy/events` - View audit log

Consumer endpoints are Bearer-token authenticated and fall into three groups: **read** (issues, teams, projects, cycles, labels, search, relations), **write** (`readWrite` scope — create/update issues, comments, relations, labels), and **foreman** task automation (stack, prompt, recommend, recap, brief, status, sessions, tasks, playbook). The full endpoint catalog, request/response shapes, and scope rules are the consumer contract and live in the integration guide — that's the source of truth, not this file. (Issue IDs accept both UUIDs and identifiers like `LIN-123`.)

**See [docs/proxy-integration.md](docs/proxy-integration.md)** for the full consumer integration guide.

## Collective (experimental, LIN-450)

A rough-draft experiment, **gated behind a per-user `collective` feature flag and surfaced only via a link in Settings**. It automates the manual cross-project discussion written up in `docs/collective-session-2026-06-12.md`: pick a subset of your connected workspaces, name a [Yap](https://github.com/jkershaw/yap) channel, and start — the page fans `buildCollectiveParticipantPrompt(...)` out to each selected workspace's **unchanged** dispatch route (`dispatchQueueStore.addItem`), then renders the live channel and lets you inject input via a thin server-side Yap proxy.

- **Substrate:** dispatch `target` is `cli`/`web` only (full Claude Code sessions); `dash`/`local` are rejected. Each selected workspace must have a live consumer draining its queue.
- **Channel name** is the single shared contract across the participant prompt, the fan-out, and the `state`/`say` endpoints — normalized once via `normalizeYapChannel`. The page seeds a fresh friendly default per load via `randomChannelName()` (`#word-word-YYYY-MM-DD`).
- **Side-effect policy is prompt-only:** participants may carry a `readWrite` proxy token (best-effort minted per fan-out), but the participant prompt requires asking John in-channel before any Linear write / ticket / mutation. There is no deterministic write-lock — a named, accepted V1 gap.
- **Yap** is ephemeral (200-msg ring buffer, unauthenticated nicks); poll/history return the body in a `text` field, normalized by the `state` endpoint. `YAP_BASE_URL` defaults to `https://yap.jkershaw.com` (override per env; optional `YAP_PASSWORD`), so the live view works out of the box. `lib/yap-client.js` uses the proxy-aware fetch (`createProxyFetch`), so Yap calls route through the same egress proxy as Linear calls when one is configured.
- **Prompt preview:** `POST .../collective/preview` builds the participant prompt for the chosen channel/topic (sample nick + placeholder token) so the page can show & copy exactly what each participant receives.
- **Deferred past V1:** chat/per-agent recaps, a durable transcript store, auto-cadence, and the within-a-project variant.

Endpoints (session auth, workspace-anchored but operating over `session.workspaces`):
- `GET  /workspace/:urlKey/collective` — page (redirects to settings when the flag is off)
- `POST /workspace/:urlKey/collective/start` — multi-workspace dispatch fan-out
- `POST /workspace/:urlKey/collective/preview` — build the participant prompt (view & copy, no dispatch)
- `GET  /workspace/:urlKey/api/collective/state` — JSON poll fronting `yap.poll`
- `POST /workspace/:urlKey/api/collective/say` — inject human input via `yap.say`

## Linear CLI (for AI Agents)

When `LINEAR_API_KEY` environment variable is set, AI agents can query Linear directly:

```bash
node lib/linear-cli.js <command> [args]
```

### Commands

| Command | Description |
|---------|-------------|
| `viewer` / `me` | Get current user info |
| `org` | Get organization info |
| `teams` | List all teams |
| `projects` | List active projects |
| `issues [teamId]` | List all issues (optionally filter by team) |
| `issue <id>` | Get issue details with full context (use `--with-images` for base64) |
| `search "query"` | Search issues |
| `states <teamId>` | List workflow states for a team |
| `relations <issueId>` | Get issue relations (blocks, blocked-by, etc.) |
| `labels [teamId]` | List all labels (optionally filter by team) |
| `fetch-image <url>` | Fetch image with auth (`--base64` or `--file <path>`) |
| `create-issue <teamId> <title> [json]` | Create a new issue |
| `update-issue <issueId> <json>` | Update an existing issue |
| `comment <issueId> "body"` | Add a comment to an issue |
| `relation <issueId> <type> <relatedId>` | Create a relation between issues |
| `add-label <issueId> <label>` | Add a label to an issue (by name or ID) |
| `remove-label <issueId> <label>` | Remove a label from an issue (by name or ID) |

### Setup

1. Get your API key from: https://linear.app/settings/api
2. Set the environment variable: `export LINEAR_API_KEY="lin_api_..."`

### Examples

```bash
# Check authentication
node lib/linear-cli.js viewer

# List all active projects
node lib/linear-cli.js projects

# Get full context for an issue
node lib/linear-cli.js issue abc123def

# Search for issues
node lib/linear-cli.js search "authentication bug"

# Create a new issue
node lib/linear-cli.js create-issue team_id "Fix login bug"
node lib/linear-cli.js create-issue team_id "Add feature" '{"description":"Details","projectId":"proj_123"}'

# Update an issue (change status, assignee, etc.)
node lib/linear-cli.js update-issue issue_id '{"stateId":"state_done"}'

# Add a comment
node lib/linear-cli.js comment issue_id "Fixed in PR #42"

# Query issue relations
node lib/linear-cli.js relations LIN-37

# Create relations between issues
node lib/linear-cli.js relation LIN-40 blocked-by LIN-39
node lib/linear-cli.js relation LIN-31 blocks LIN-32
node lib/linear-cli.js relation LIN-31 duplicate LIN-28
node lib/linear-cli.js relation LIN-31 related LIN-29

# List and manage labels
node lib/linear-cli.js labels
node lib/linear-cli.js labels team_id
node lib/linear-cli.js add-label LIN-99 "bug"
node lib/linear-cli.js add-label LIN-99 label_uuid_here
node lib/linear-cli.js remove-label LIN-99 "bug"
```

### Relation Types

| Type | Description |
|------|-------------|
| `blocks` | This issue blocks another issue |
| `blocked-by` | This issue is blocked by another issue |
| `duplicate` | This issue is a duplicate of another |
| `related` | General relation between issues |

**Note**: `blocked-by` is a convenience type - internally it creates a `blocks` relation with swapped issue IDs.

### Stdin Support

For complex content with special characters (newlines, quotes, backticks), use `--stdin` to avoid shell escaping issues:

```bash
# Using pipe
echo '{"description":"Text with \"quotes\" and\nnewlines"}' | node lib/linear-cli.js create-issue team_id "Title" --stdin

# Using heredoc (recommended for complex content)
node lib/linear-cli.js update-issue issue_id --stdin << 'EOF'
{
  "description": "Complex content with `backticks` and special chars",
  "stateId": "state_123"
}
EOF

# From file
cat payload.json | node lib/linear-cli.js create-issue team_id "Title" --stdin

# Comments with special characters
node lib/linear-cli.js comment issue_id --stdin << 'EOF'
Analysis complete:
- Found 3 issues with `authentication` module
- Fixed in commit abc123
EOF
```

**Note**: The CLI outputs JSON for easy parsing by AI agents.

### Image Support

The CLI can fetch images from Linear issues for AI agent visual analysis.

**Issue images are automatically included:**
```bash
# Get issue with image URLs extracted from description, comments, and attachments
node lib/linear-cli.js issue LIN-99

# Output includes:
# {
#   "images": {
#     "fromDescription": [{"alt": "screenshot", "url": "..."}],
#     "fromComments": [{"alt": "", "url": "...", "commentId": "..."}],
#     "fromAttachments": [{"id": "...", "url": "...", "title": "..."}]
#   }
# }
```

**Embed images as base64 for multimodal AI:**
```bash
node lib/linear-cli.js issue LIN-99 --with-images
# Adds "embeddedImages" array with base64 data URIs
```

**Fetch individual images:**
```bash
# Get image metadata only
node lib/linear-cli.js fetch-image "https://linear.app/uploads/..."

# Get as base64 data URI (for AI vision models)
node lib/linear-cli.js fetch-image "https://linear.app/uploads/..." --base64

# Save to file
node lib/linear-cli.js fetch-image "https://linear.app/uploads/..." --file ./image.png
```

**Note**: Linear-hosted images require authentication. The CLI uses your `LINEAR_API_KEY` automatically.

## GitHub Actions CI (for AI Agents)

This is a public repository, so GitHub Actions status can be checked without authentication using curl.

### Check Recent Runs

```bash
# List recent workflow runs
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs?per_page=5" | \
  jq '.workflow_runs[] | {id, status, conclusion, head_branch, display_title}'

# Quick status of latest run
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs?per_page=1" | \
  jq '.workflow_runs[0] | {status, conclusion, html_url}'
```

### Check Specific Run

```bash
# Get run status by ID
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs/RUN_ID" | \
  jq '{status, conclusion, html_url}'

# Get job details for a run
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs/RUN_ID/jobs" | \
  jq '.jobs[] | {name, status, conclusion}'
```

### Poll for Completion

```bash
# Wait and check (useful after pushing changes)
sleep 30 && curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs?per_page=1" | \
  jq '.workflow_runs[0] | {status, conclusion}'
```

### Status Values

| Field | Values |
|-------|--------|
| `status` | `queued`, `in_progress`, `completed` |
| `conclusion` | `success`, `failure`, `cancelled`, `skipped` (only when completed) |

**Note**: CI runs on pull requests targeting `main` and on pushes to `main` (i.e. after a PR merges). The `ci-success` job aggregates the unit and e2e jobs into a single stable check — require it as a branch-protection status check so automated agents can confirm CI is green before merging.
