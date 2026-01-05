# Linear Roadmap Viewer

A minimal, CLI-aesthetic web app that displays Linear projects and issues as a collapsible tree.

## Commands

- `npm start` - Start the server (runs on PORT from .env, default 3000)
- `npm install` - Install dependencies

## Architecture

```
server.js              Express server, OAuth routes, main entry point
lib/
  linear.js            GraphQL client for Linear API
  tree.js              Transforms flat issues → nested tree structure
  render.js            Generates HTML with box-drawing characters
  session-store.js     MongoDB/MangoDB session store
  parse-landing.js     Parses markdown content for landing page
content/
  landing.md           Static roadmap preview for unauthenticated users
public/
  style.css            Light theme, mobile-responsive
  app.js               Client-side collapse/expand, localStorage persistence
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

- Unauthenticated users see landing page with static roadmap preview
- In Progress section shows all in-progress issues across projects
- Click issue line → toggle details (description, assignee, dates, labels)
- Click ▼ arrow → collapse/expand children
- Click project header → collapse entire project
- Click "reset" → restore default collapse state
- Collapse state persisted in localStorage
- 401 errors clear session and redirect to landing page
