# Linear Projects Viewer

A minimal, CLI-aesthetic web app that displays your Linear projects and issues as a collapsible tree.

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

- **OAuth Login** - Sign in with your Linear account, choose your workspace
- **Tree View** - Hierarchical display of projects and nested issues
- **In Progress Section** - Dedicated view of all in-progress issues across projects
- **Status Indicators** - ✓ done, ◐ in-progress, ○ todo
- **Collapsible** - Click to expand/collapse projects and sub-issues
- **Issue Details** - Click any issue to see description, assignee, dates, labels
- **Persistent State** - Collapse state saved in localStorage
- **Reset View** - One-click reset to default collapse state
- **Landing Preview** - Static projects preview for unauthenticated users
- **Mobile Friendly** - Responsive design for all screen sizes

## Setup

### 1. Create a Linear OAuth Application

1. Go to [Linear Settings](https://linear.app/settings) → **API** → **OAuth Applications**
2. Click **Create new OAuth Application**
3. Fill in:
   - **Name**: e.g., "Projects Viewer"
   - **Redirect URI**: `http://localhost:3000/auth/callback`
4. Save and copy your **Client ID** and **Client Secret**

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```
LINEAR_CLIENT_ID=your-client-id
LINEAR_CLIENT_SECRET=your-client-secret
LINEAR_REDIRECT_URI=http://localhost:3000/auth/callback
SESSION_SECRET=any-random-string-for-sessions
PORT=3000
MONGODB_URI=mongodb://localhost:27017  # Optional: uses file-based storage if not set
```

### 3. Install and Run

```bash
npm install
npm start
```

Visit `http://localhost:3000` and click **Login with Linear**.

## Usage

| Action | Effect |
|--------|--------|
| Click issue title | Toggle details (description, assignee, dates) |
| Click ▼ arrow | Collapse/expand child issues |
| Click project header | Collapse entire project |
| Click "In Progress" header | Collapse/expand in-progress section |
| Click "reset" link | Reset all collapse states to default |
| Visit `/logout` | Sign out |

Session lasts 24 hours, then you'll need to log in again.

## Deployment

For production, update your `.env`:

```
LINEAR_REDIRECT_URI=https://yourdomain.com/auth/callback
SESSION_SECRET=generate-a-secure-random-string
```

And add `https://yourdomain.com/auth/callback` to your Linear OAuth app's redirect URIs.

## Tech Stack

- **Server**: Express.js (Node.js)
- **API**: Linear GraphQL API via `graphql-request`
- **Auth**: OAuth 2.0 with Linear
- **Sessions**: MongoDB (production) or MangoDB file-based storage (development)
- **Frontend**: Vanilla JS, no build step
- **Styling**: Light theme, monospace font, CLI aesthetic

## License

MIT
