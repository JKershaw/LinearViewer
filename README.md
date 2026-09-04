# Harbour

A minimal, CLI-aesthetic web app that displays your projects and issues as a collapsible tree — backed by Linear, GitHub, GitHub Projects, Jira, or a local store — plus a growing set of focused views and an API surface for AI agents.

```
Platform Projects

▼ Backend Refactor
├─ ◐ Migrate to new database schema
│  ├─ ✓ Create migration scripts
│  └─ ○ Update ORM models
└─ ○ API versioning

▼ Mobile App
├─ ◐ Push notifications
└─ ○ Offline mode
```

## Features

### Views

- **Tree View** - Hierarchical display of projects and nested issues, with an In Progress section across all projects
- **Swipe** - Mobile-first triage, one issue at a time, with an integrated prompt
- **Swim** - Swim-lane / flow layout showing sequence, parallelism, and dependencies
- **Roadmap** - Narrative project summary with an at-a-glance digest, recap, and Brief; report history is browsable
- **Ship** - Radial view of work heading toward delivery
- **Observation** - Cross-workspace feed of agent sessions, drilling into per-task and per-run detail

### Interaction

- **Status Indicators** - ✓ done, ◐ in-progress, ○ todo
- **Collapsible** - Click to expand/collapse projects and sub-issues
- **Issue Details** - Click any issue to see description, assignee, dates, labels
- **Persistent State** - Collapse state saved in localStorage
- **Reset View** - One-click reset to default collapse state
- **Landing Preview** - Static projects preview for unauthenticated users
- **Mobile Friendly** - Responsive design for all screen sizes

### AI

- **AI Prompts** - Generate a focused prompt for any task from its title, description, parent, and siblings
- **AI Recommendations** - LLM-suggested next actions via OpenRouter (handwritten and AI-generated prompt paths)
- **Bring Your Own Key** - Connect your OpenRouter account via OAuth, or fall back to a server key
- **Free Tier** - Rate-limited free prompts when a server free-tier key is configured

### For AI Agents

- **Dispatch Queue** - Queue prompts for external consumers (AI agents, automation) with bearer-token auth
- **Workspace API Proxy** - Token-scoped REST-like access to your workspace (read / readWrite); the wire contract is source-neutral — one shape across providers, not a passthrough to any single backend — with audit logging and rate limiting
- **Task Automation** - Endpoints for agent-driven workflows (stack, prompt, recommend, recap, brief, status)

## Authentication

Several ways to sign in or connect a workspace source:

- **Linear OAuth 2.0** - Sign in with your Linear account, choose your workspace. Sessions last 24 hours with automatic refresh.
- **Personal Access Token (PAT)** - Set `LINEAR_ACCESS_TOKEN` for zero-config local development; you're logged in automatically.
- **GitHub App** - Sign in with GitHub, or add a GitHub repository (Issues or Projects v2) as a workspace source. Optional — disabled until configured. See [GitHub App (optional)](#github-app-optional) below.
- **Jira Cloud** - Sign in with Jira via OAuth 2.0, or link a Jira site as a workspace source via an API token or OAuth 2.0. Reads, plus writes (title/description/status edits, comments, labels) — creating new issues isn't supported yet. See [Jira Cloud (optional)](#jira-cloud-optional) below.
- **OpenRouter OAuth (PKCE)** - Optionally connect an OpenRouter account for AI features; returns a permanent API key stored alongside your session.

### GitHub App (optional)

GitHub login ("Continue with GitHub") and adding a GitHub repository (Issues or Projects v2) as a workspace source run through a **GitHub App installation**, not a plain OAuth App. They stay **disabled until the GitHub environment variables are set** — the settings page shows GitHub as unavailable, and `/auth/github` returns a clear "not available" message.

To enable them:

1. Create a GitHub App at [github.com/settings/apps](https://github.com/settings/apps/new) (not an OAuth App). Requesting repo/issues read permissions is enough for this integration.
2. From the app's settings page, note its **App ID**, generate and download a **private key** (PEM), and note the app's **slug** (from its settings URL).
3. Under the app's "Identifying and authorizing users" section, generate a **Client ID** and **Client secret**.
4. Add to your production `.env`:

```
GITHUB_CLIENT_ID=your-github-app-client-id
GITHUB_CLIENT_SECRET=your-github-app-client-secret
GITHUB_APP_ID=your-github-app-id
GITHUB_APP_PRIVATE_KEY=your-github-app-private-key-pem
GITHUB_APP_SLUG=your-github-app-slug
```

`GITHUB_REDIRECT_URI` is optional — GitHub falls back to the App's own configured callback URL when unset; set it only if you need a different one (see `.env.example`). After setting the variables and restarting, do a one-time manual smoke test of the GitHub login + "Add a source" flow, since CI exercises only mocked OAuth.

### Jira Cloud (optional)

Jira has two independent link paths, side by side:

- **API token** - No server config needed. Visit `/auth/jira?workspace=<urlKey>` and provide your Atlassian email, an [API token](https://id.atlassian.com/manage-profile/security/api-tokens), and your site (e.g. `your-team.atlassian.net`). Supports reads and writes (editing an existing issue's title/description/status and comments/labels); creating new issues isn't supported yet.
- **OAuth 2.0 (3LO)** - Sign in with Jira or add a Jira site the same way as GitHub. Disabled until the Jira OAuth environment variables are set:

```
JIRA_CLIENT_ID=your-jira-client-id
JIRA_CLIENT_SECRET=your-jira-client-secret
JIRA_REDIRECT_URI=https://yourdomain.com/auth/jira/oauth/callback
```

## Setup

### 1. Create a Linear OAuth Application

1. Go to [Linear Settings](https://linear.app/settings) → **API** → **OAuth Applications**
2. Click **Create new OAuth Application**
3. Fill in:
   - **Name**: e.g., "Projects Viewer"
   - **Redirect URI**: `http://localhost:3000/auth/callback`
4. Save and copy your **Client ID** and **Client Secret**

> Prefer no OAuth setup for local dev? Skip straight to a [Personal Access Token](#authentication) — set `LINEAR_ACCESS_TOKEN` in `.env` and you're done.

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```
# Linear OAuth
LINEAR_CLIENT_ID=your-client-id
LINEAR_CLIENT_SECRET=your-client-secret
LINEAR_REDIRECT_URI=http://localhost:3000/auth/callback

# Or, for local dev without OAuth: a personal API key from linear.app/settings/api
LINEAR_ACCESS_TOKEN=lin_api_xxxxx

# Sessions
SESSION_SECRET=any-random-string-for-sessions
PORT=3000
MONGODB_URI=mongodb://localhost:27017  # Optional: uses file-based storage if not set

# OpenRouter (optional, enables AI features)
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_REDIRECT_URI=http://localhost:3000/auth/openrouter/callback
OPENROUTER_FREE_TIER_KEY=server-key-for-free-tier  # Optional: enables rate-limited free prompts
```

### 3. Install and Run

```bash
npm install
npx playwright install   # first-time setup, for E2E tests
npm start
```

Visit `http://localhost:3000` and click **Login with Linear** (or, in PAT mode, you'll be logged in automatically).

## Usage

| Action | Effect |
|--------|--------|
| Click issue title | Toggle details (description, assignee, dates) |
| Click ▼ arrow | Collapse/expand child issues |
| Click project header | Collapse entire project |
| Click "In Progress" header | Collapse/expand in-progress section |
| Click "reset" link | Reset all collapse states to default |
| Visit `/logout` | Sign out |

OAuth sessions last 24 hours (with automatic refresh); PAT sessions re-create automatically on the next visit.

## Testing

```bash
npm test        # Run unit tests + Playwright E2E tests
npm run test:unit # Run unit tests only
npm run test:hermetic # Same unit suite + fails if any test opens a non-loopback socket (what CI runs)
npm run test:hermetic:proxy # Same, with proxy env set — native fetch ignores it, so both arms are checked
npm run test:ui   # Run E2E tests with the Playwright UI
```

## Deployment

For production, update your `.env`:

```
LINEAR_REDIRECT_URI=https://yourdomain.com/auth/callback
SESSION_SECRET=generate-a-secure-random-string
```

And add `https://yourdomain.com/auth/callback` to your Linear OAuth app's redirect URIs. HTTPS and secure cookies are enforced in production. See [GitHub App (optional)](#github-app-optional) and [Jira Cloud (optional)](#jira-cloud-optional) above for those providers' production setup.

## Tech Stack

- **Server**: Express.js (Node.js, ES modules)
- **API**: Provider-backed (`lib/providers/`) — Linear GraphQL, GitHub/GitHub Projects GraphQL, Jira REST v3, or a local store
- **Auth**: Linear OAuth 2.0 + PAT, GitHub App, Jira (API token or OAuth 2.0), and OpenRouter OAuth (PKCE)
- **AI**: OpenRouter API client for recommendations and prompt generation
- **Sessions**: MongoDB (production) or MangoDB file-based storage (development)
- **Frontend**: Vanilla JS, no build step
- **Styling**: Light theme, monospace font, CLI aesthetic
- **Testing**: Playwright E2E with GitHub Actions CI

## Documentation

- [`CLAUDE.md`](CLAUDE.md) - Architecture and full project reference
- [`docs/dispatch-integration.md`](docs/dispatch-integration.md) - Dispatch queue consumer guide
- [`docs/proxy-integration.md`](docs/proxy-integration.md) - Workspace API Proxy consumer guide (source-neutral)

## License

All rights reserved.
