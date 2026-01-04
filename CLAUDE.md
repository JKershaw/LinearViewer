# Linear Roadmap Viewer

A minimal, CLI-aesthetic web app that displays Linear projects and issues as a collapsible tree.

## Commands

- `npm start` - Start the server (runs on PORT from .env, default 3000)
- `npm install` - Install dependencies

## Architecture

```
server.js          Express server, OAuth routes, main entry point
lib/
  linear.js        GraphQL client for Linear API
  tree.js          Transforms flat issues → nested tree structure
  render.js        Generates HTML with box-drawing characters
public/
  style.css        Dark theme, mobile-responsive
  app.js           Client-side collapse/expand, localStorage persistence
```

## Code Style

- ES modules (`import`/`export`)
- 2-space indentation
- Single quotes for strings
- Semicolons

## Design Principles

- CLI/terminal aesthetic: monospace font, box-drawing characters (├─ └─ │)
- Dark theme with muted colors
- State indicators: ✓ (done/green), ◐ (in-progress/yellow), ○ (todo/dim)
- Mobile: hide box chars, use left-border + padding for depth indication
- Keep it minimal - no frameworks, no build step

## Authentication

OAuth 2.0 flow with Linear:

```
GET /auth/linear     → Redirect to Linear OAuth (with state parameter)
GET /auth/callback   → Exchange code for access token, store in session
GET /logout          → Destroy session, redirect to login
```

- Sessions stored in-memory via `express-session`
- Tokens expire after 24 hours (no refresh token handling)
- State parameter validated to prevent CSRF

## Environment Variables

```
LINEAR_CLIENT_ID      OAuth client ID from Linear
LINEAR_CLIENT_SECRET  OAuth client secret from Linear
LINEAR_REDIRECT_URI   Callback URL (must match Linear OAuth app config)
SESSION_SECRET        Secret for signing session cookies
PORT                  Server port (default: 3000)
```

## Linear API

- Uses `graphql-request` to query Linear's GraphQL API
- OAuth tokens passed via `Authorization: Bearer {token}` header
- Fetches projects with state "started" and all issues
- Single query fetches both projects and issues

## Key Behaviors

- Unauthenticated users see login page
- Click issue line → toggle details (description, assignee, dates, labels)
- Click ▼ arrow → collapse/expand children
- Click project header → collapse entire project
- Collapse state persisted in localStorage
- 401 errors clear session and redirect to login
