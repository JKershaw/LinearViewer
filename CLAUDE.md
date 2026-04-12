# Linear Projects Viewer

A minimal, CLI-aesthetic web app that displays Linear projects and issues as a collapsible tree.

## Commands

- `npm run env:check` - Verify environment is ready (runs automatically via Claude Code hook)
- `npm install` - Install dependencies
- `npx playwright install` - Install Playwright browsers (first-time setup)
- `npm start` - Start the server (runs on PORT from .env, default 3000)
- `npm test` - Run Playwright E2E tests
- `npm test:ui` - Run tests with Playwright UI

## Architecture

```
server.js              Express server, main entry point, dashboard routes
routes/
  auth.js              Linear OAuth routes
  openrouter-auth.js   OpenRouter OAuth PKCE routes
  workspace.js         Workspace management routes
  dispatch.js          Dispatch queue API (user + consumer endpoints)
  proxy.js             Linear API proxy (token auth, read/write endpoints, cycles, labels, foreman)
  pipeline.js          Pipeline page and JSON polling routes
  workspace-api.js     Workspace API routes (prompts, recommendations, audit, comments, images)
  test.js              Test-only routes for E2E tests (mock sessions, fixtures)
  legacy-redirects.js  Backward-compatible redirects for old URLs
lib/
  linear.js            GraphQL client for Linear API
  linear-cli.js        CLI tool for AI agents to query/modify Linear
  openrouter.js        OpenRouter API client for AI recommendations
  free-tier-store.js   Free tier usage tracking and rate limiting
  tree.js              Transforms flat issues → nested tree structure
  render.js            Dashboard page renderer (tree view, sections)
  render-pages.js      Standalone page renderers (login, error, workspace-not-found)
  render-audit.js      Operator dashboard page renderer
  render-settings.js   Settings page renderer
  render-prompts.js    Prompts catalog page renderer
  render-dispatch.js   Dispatch page renderer (prompt, queue, tokens, history)
  render-pipeline.js   Pipeline page renderer (floor view shell)
  pipeline-state.js    Pipeline state builder (snapshot assembly)
  pipeline-loops.js    Pipeline loop reconstruction library
  feature-defaults.js  Feature toggle keys, defaults, and helpers
  user-preferences.js  Cross-device preference storage (MongoDB)
  session-store.js     MongoDB/MangoDB session store
  parse-landing.js     Parses markdown content for landing page
  prompt-templates.js  Prompt template query functions and main entry point
  prompt-formatters.js Shared formatting helpers for prompt templates
  prompt-template-defs.js  Prompt template definitions (14 templates)
  prompts/
    meta-prompt-template.js  Meta-prompt for AI recommendation generation
  dispatch-store.js    Dispatch queue storage
  dispatch-tokens.js   Consumer API token management
  proxy-tokens.js      Proxy token hashing and validation
  proxy-events.js      Proxy event audit logging
  proxy-fetch.js       Proxy-aware fetch for HTTP_PROXY environments
  render-proxy.js      Proxy token management UI
  components/
    navbar.js          Nav bar with workspace/team selectors, queue badge
    footer.js          Footer with deploy info, AI status
content/
  landing.md           Static projects preview for unauthenticated users
public/
  style.css            Light theme, mobile-responsive
  audit.css            Operator dashboard styles
  settings.css         Settings page styles
  dispatch.css         Dispatch page styles
  pipeline.css         Pipeline page styles (floor view, cells, overlay)
  pipeline.js          Pipeline page client-side logic (polling, diffing, overlays)
  app.js               Client-side collapse/expand, localStorage persistence
  dispatch.js          Dispatch page client-side logic (prompt, queue, tokens, history)
  audit.js             Operator dashboard client-side logic
  llms.txt             AI agent guidance (DOM selectors, navigation patterns)
tests/e2e/
  landing.spec.js      Landing page tests
  dashboard.spec.js    Authenticated dashboard tests
  interactions.spec.js Collapse/expand interaction tests
  openrouter-auth.spec.js  OpenRouter OAuth tests
  dispatch.spec.js     Dispatch queue and consumer API tests
  dispatch-page.spec.js  Dispatch page UI tests
  free-tier.spec.js    Free tier rate limiting tests
  feature-toggles.spec.js  Feature toggle settings tests
  pat-auth.spec.js     PAT (personal access token) auth mode tests
  proxy.spec.js        Proxy API tests (tokens, cycles, labels, auth)
docs/
  dispatch-integration.md  Consumer integration guide
playwright.config.js   Playwright test configuration
```

### Prompt System (two independent paths)

Changes to prompt behavior (feature flags, workflow instructions, context formatting) must update BOTH:

- **Handwritten prompts**: `lib/prompt-templates.js` → `generatePrompt()` — deterministic, template-based
- **AI-generated prompts**: `lib/openrouter.js` → `lib/prompts/meta-prompt-template.js` — LLM generates via meta-prompt

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
- Per-workspace daily limit: 5 prompts (resets at midnight UTC)
- Global hourly limit: 50 prompts across all workspaces
- Uses atomic check-and-increment (`tryUse()`) to prevent race conditions
- Footer shows `ai: ● free (N/5)` status; settings page shows usage info
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

**Consumer read endpoints** (Bearer token auth):
- `GET /api/proxy/instructions` - Agent-readable API documentation
- `GET /api/proxy/me` - Current user info
- `GET /api/proxy/teams` - List teams
- `GET /api/proxy/projects` - List active projects
- `GET /api/proxy/issues?teamId={id}&limit={n}` - List issues (optional team filter, pagination)
- `GET /api/proxy/issue/:issueId` - Full issue detail (comments, children, relations, cycle)
- `GET /api/proxy/search?q={query}` - Search issues
- `GET /api/proxy/states/:teamId` - Workflow states for a team
- `GET /api/proxy/labels?teamId={id}` - Labels (id, name, color; optional team filter)
- `GET /api/proxy/cycles?teamId={id}` - Cycles (optional team filter)
- `GET /api/proxy/cycle/:cycleId` - Cycle detail with issues and progress
- `GET /api/proxy/relations/:issueId` - Issue relations (blocks, blocked-by, related, duplicate)

**Consumer write endpoints** (Bearer token auth, `readWrite` scope):
- `POST /api/proxy/issues` - Create issue (supports `cycleId` for cycle assignment)
- `PATCH /api/proxy/issue/:issueId` - Update issue (supports `cycleId`)
- `POST /api/proxy/issue/:issueId/comments` - Add comment
- `POST /api/proxy/issue/:issueId/relations` - Create relation
- `POST /api/proxy/issue/:issueId/labels` - Add label
- `DELETE /api/proxy/issue/:issueId/labels/:labelId` - Remove label

**Foreman endpoints** (Bearer token auth, task automation):
- `GET /api/proxy/stack?limit={n}` - Sorted task stack with available prompts
- `GET /api/proxy/prompt/:identifier/:templateKey` - Generate deterministic prompt
- `GET /api/proxy/recommend/:identifier` - AI-generated prompt recommendation
- `GET /api/proxy/foreman/status` - List/post foreman status entries
- `GET /api/proxy/foreman/playbook` - Foreman automation playbook

Issue IDs accept both UUIDs and identifiers (e.g., `LIN-123`). All issue responses include cycle and label details (id, name, color).

**See [docs/proxy-integration.md](docs/proxy-integration.md)** for the full consumer integration guide.

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

**Note**: CI runs on pushes to `main` and pull requests targeting `main`. Feature branch pushes don't trigger CI until a PR is created.
