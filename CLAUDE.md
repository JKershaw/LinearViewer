# Linear Projects Viewer

A minimal, CLI-aesthetic web app that displays Linear projects and issues as a collapsible tree.

## Commands

- `npm install` - Install dependencies
- `npx playwright install` - Install Playwright browsers (first-time setup)
- `npm start` - Start the server (runs on PORT from .env, default 3000)
- `npm test` - Run Playwright E2E tests
- `npm test:ui` - Run tests with Playwright UI

## Architecture

```
server.js              Express server, OAuth routes, main entry point
lib/
  linear.js            GraphQL client for Linear API
  linear-cli.js        CLI tool for AI agents to query/modify Linear
  tree.js              Transforms flat issues → nested tree structure
  render.js            Generates HTML with box-drawing characters
  session-store.js     MongoDB/MangoDB session store
  parse-landing.js     Parses markdown content for landing page
content/
  landing.md           Static projects preview for unauthenticated users
public/
  style.css            Light theme, mobile-responsive
  app.js               Client-side collapse/expand, localStorage persistence
  llms.txt             AI agent guidance (DOM selectors, navigation patterns)
tests/e2e/
  landing.spec.js      Landing page tests
  dashboard.spec.js    Authenticated dashboard tests
  interactions.spec.js Collapse/expand interaction tests
playwright.config.js   Playwright test configuration
```

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

OAuth 2.0 flow with Linear:

```
GET /auth/linear     → Redirect to Linear OAuth (with state parameter)
GET /auth/callback   → Exchange code for access token, store in session
GET /logout          → Destroy session, redirect to login
```

- Sessions stored in MongoDB (production) or MangoDB file-based storage (development)
- Tokens expire after 24 hours (no refresh token handling)
- State parameter validated to prevent CSRF

## Environment Variables

```
LINEAR_CLIENT_ID      OAuth client ID from Linear
LINEAR_CLIENT_SECRET  OAuth client secret from Linear
LINEAR_REDIRECT_URI   Callback URL (must match Linear OAuth app config)
SESSION_SECRET        Secret for signing session cookies
PORT                  Server port (default: 3000)
MONGODB_URI           MongoDB connection string (optional, uses file storage if not set)
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

## AI Agent Support

The `/llms.txt` file provides guidance for AI agents navigating the site, including:
- DOM selectors (`data-id`, `data-status`, `data-section`, `data-parent`)
- Navigation patterns and interactive elements
- Status indicators and their meanings

**Keep llms.txt updated** when modifying DOM structure or data attributes in `render.js`.

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
| `issue <id>` | Get issue details with full context |
| `search "query"` | Search issues |
| `states <teamId>` | List workflow states for a team |
| `create-issue <teamId> <title> [json]` | Create a new issue |
| `update-issue <issueId> <json>` | Update an existing issue |
| `comment <issueId> "body"` | Add a comment to an issue |

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
```

**Note**: The CLI outputs JSON for easy parsing by AI agents.
