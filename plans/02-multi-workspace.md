# Plan: Multi-Workspace Support

## Overview

Allow users to connect multiple Linear workspaces and switch between them without re-authenticating. A single Linear account can belong to multiple workspaces, and users may want to view projects across different organizations.

## Current Behavior

- User logs in via OAuth → gets one access token
- Token is tied to ONE workspace (selected during Linear's OAuth flow)
- To view a different workspace, user must logout and re-login
- Session stores single token set: `{ accessToken, refreshToken, tokenExpiresAt }`

## Goal

- Store multiple workspace credentials in a single session
- Add "Add Workspace" button to connect additional workspaces
- Workspace switcher in UI header
- Independent token refresh per workspace
- Remove individual workspaces without full logout

---

## Technical Approach

### OAuth Flow for Adding Workspaces

Each "Add Workspace" action initiates a new OAuth flow. Linear's authorization page shows a workspace picker if the user belongs to multiple workspaces.

**Flow:**
```
User clicks "Add Workspace"
  → New OAuth flow starts (same /auth/linear endpoint)
  → Linear shows workspace picker
  → User selects workspace
  → Callback receives new token set
  → Fetch organization info to identify workspace
  → Store alongside existing workspaces (or update if duplicate)
  → Redirect back with new workspace active
```

### Workspace Identification

After OAuth callback, query Linear to identify the workspace:

```graphql
query {
  organization {
    id
    name
    urlKey  # e.g., "acme-corp" from linear.app/acme-corp
  }
}
```

Use `organization.id` as unique identifier to detect duplicates.

- `urlKey` is used for display in the workspace switcher (shorter than full name)

---

## Data Model

### Session Structure

```javascript
const MAX_WORKSPACES = 10  // Prevent session bloat

session = {
  workspaces: [
    {
      id: 'org-uuid-1',           // organization.id from Linear
      name: 'Acme Corp',          // organization.name (display)
      urlKey: 'acme-corp',        // organization.urlKey (short display)
      accessToken: 'lin_oauth_...',
      refreshToken: 'lin_refresh_...',
      tokenExpiresAt: 1704567890000,
      addedAt: 1704500000000      // When workspace was connected
    },
    {
      id: 'org-uuid-2',
      name: 'Side Project',
      urlKey: 'side-project',
      accessToken: 'lin_oauth_...',
      refreshToken: 'lin_refresh_...',
      tokenExpiresAt: 1704567890000,
      addedAt: 1704510000000
    }
  ],
  activeWorkspaceId: 'org-uuid-1'
}
```

---

## API Changes

### New Query: Fetch Organization Details

```javascript
// lib/linear.js
const ORGANIZATION_QUERY = gql`
  query {
    organization {
      id
      name
      urlKey
    }
  }
`

export async function fetchOrganization(accessToken) {
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: { Authorization: accessToken }  // Raw token, not "Bearer"
  })
  const data = await client.request(ORGANIZATION_QUERY)
  return data.organization
}
```

---

## Server Changes

### Constants

```javascript
const MAX_WORKSPACES = 10
```

### Helper Functions

```javascript
// Get active workspace from session
function getActiveWorkspace(session) {
  if (!session.workspaces?.length) return null
  const active = session.workspaces.find(w => w.id === session.activeWorkspaceId)
  if (!active) {
    // Sync activeWorkspaceId if it's out of sync
    session.activeWorkspaceId = session.workspaces[0].id
    return session.workspaces[0]
  }
  return active
}

// Add or update workspace in session
function upsertWorkspace(session, workspace) {
  session.workspaces = session.workspaces || []
  const index = session.workspaces.findIndex(w => w.id === workspace.id)
  if (index >= 0) {
    // Update existing (re-auth for same workspace)
    session.workspaces[index] = { ...session.workspaces[index], ...workspace }
  } else {
    // Add new (check limit)
    if (session.workspaces.length >= MAX_WORKSPACES) {
      throw new Error(`Maximum of ${MAX_WORKSPACES} workspaces allowed`)
    }
    session.workspaces.push(workspace)
  }
}

// Remove workspace from session
function removeWorkspace(session, workspaceId) {
  session.workspaces = session.workspaces?.filter(w => w.id !== workspaceId) || []

  // If removed workspace was active, switch to first remaining
  if (session.activeWorkspaceId === workspaceId) {
    session.activeWorkspaceId = session.workspaces[0]?.id || null
  }

  return session.workspaces.length
}

// Promisified session save
function saveSession(session) {
  return new Promise((resolve, reject) => {
    session.save(err => err ? reject(err) : resolve())
  })
}
```

### Modified OAuth Callback

```javascript
app.get('/auth/callback', async (req, res) => {
  // ... existing state validation ...

  try {
    const tokenResponse = await fetch('https://api.linear.app/oauth/token', {
      // ... existing token exchange ...
    })

    if (!tokenResponse.ok) {
      throw new Error('Token exchange failed')
    }

    const tokens = await tokenResponse.json()

    // Fetch organization info to identify workspace
    let org
    try {
      org = await fetchOrganization(tokens.access_token)
    } catch (orgError) {
      console.error('Failed to fetch organization:', orgError)
      // Fallback: create workspace without org details (will be incomplete)
      return res.status(500).send('Failed to fetch workspace information')
    }

    // Build workspace object
    const workspace = {
      id: org.id,
      name: org.name,
      urlKey: org.urlKey || org.name,  // Fallback to name if urlKey missing
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: Date.now() + (tokens.expires_in * 1000),
      addedAt: Date.now()
    }

    // Add/update in session
    try {
      upsertWorkspace(req.session, workspace)
    } catch (limitError) {
      return res.status(400).send(limitError.message)
    }

    req.session.activeWorkspaceId = workspace.id
    delete req.session.oauthState

    await saveSession(req.session)
    res.redirect('/')

  } catch (error) {
    console.error('OAuth callback error:', error)
    res.status(500).send('Authentication failed')
  }
})
```

### Modified Token Refresh Middleware

Simplified approach: concurrent requests may both trigger refresh, but this is harmless (Linear returns valid tokens either way, and the last write wins).

```javascript
async function ensureValidToken(req, res, next) {
  const workspace = getActiveWorkspace(req.session)
  if (!workspace) return next()

  const needsRefresh = workspace.tokenExpiresAt - Date.now() < TOKEN_REFRESH_BUFFER_MS

  if (!needsRefresh) return next()

  try {
    const newTokens = await refreshAccessToken(workspace.refreshToken)

    // Update workspace tokens
    workspace.accessToken = newTokens.access_token
    workspace.refreshToken = newTokens.refresh_token
    workspace.tokenExpiresAt = Date.now() + (newTokens.expires_in * 1000)

    await saveSession(req.session)
    next()
  } catch (err) {
    console.error(`Token refresh failed for workspace ${workspace.id}:`, err)

    // Remove failed workspace
    const remaining = removeWorkspace(req.session, workspace.id)

    if (remaining > 0) {
      // Switch to another workspace
      await saveSession(req.session)
      return res.redirect('/')
    }

    // No workspaces left, destroy session
    req.session.destroy(() => res.redirect('/'))
  }
}
```

### New Routes

```javascript
// Switch active workspace (POST to avoid state change via GET)
app.post('/workspace/:id/switch', (req, res) => {
  const workspace = req.session.workspaces?.find(w => w.id === req.params.id)
  if (!workspace) {
    return res.status(404).send('Workspace not found')
  }

  req.session.activeWorkspaceId = workspace.id

  // Reset team filter when switching workspaces (teams are workspace-specific)
  delete req.session.selectedTeamId

  req.session.save(() => res.redirect('/'))
})

// Remove a workspace (POST with implicit CSRF via session)
app.post('/workspace/:id/remove', (req, res) => {
  const workspaceId = req.params.id

  // Prevent removing if it's the only workspace (use logout instead)
  if (req.session.workspaces?.length === 1) {
    return req.session.destroy(() => res.redirect('/'))
  }

  const remaining = removeWorkspace(req.session, workspaceId)

  if (remaining === 0) {
    return req.session.destroy(() => res.redirect('/'))
  }

  // Reset team filter if it belonged to removed workspace
  delete req.session.selectedTeamId

  req.session.save(() => res.redirect('/'))
})
```

---

## UI Changes

### Workspace Switcher Component

Add to header area (rendered in `lib/render.js`):

```html
<div class="workspace-switcher" id="workspace-switcher">
  <button class="current-workspace" aria-expanded="false" aria-haspopup="true">
    <span class="workspace-name">acme-corp</span>
    <span class="dropdown-arrow">▼</span>
  </button>
  <div class="workspace-dropdown" role="menu">
    <form action="/workspace/org-uuid-1/switch" method="POST">
      <button type="submit" class="workspace-item active" role="menuitem">
        <span class="workspace-indicator">●</span> acme-corp
      </button>
    </form>
    <form action="/workspace/org-uuid-2/switch" method="POST">
      <button type="submit" class="workspace-item" role="menuitem">
        <span class="workspace-indicator">○</span> side-project
      </button>
    </form>
    <hr>
    <a href="/auth/linear" class="add-workspace" role="menuitem">+ Add Workspace</a>
    <hr>
    <form action="/workspace/org-uuid-1/remove" method="POST"
          onsubmit="return confirm('Remove this workspace?')">
      <button type="submit" class="remove-workspace" role="menuitem">
        Remove current workspace
      </button>
    </form>
  </div>
</div>
```

### Client-Side JavaScript

Add to `public/app.js`:

```javascript
// Workspace switcher dropdown (click-based for mobile support)
const switcher = document.getElementById('workspace-switcher')
if (switcher) {
  const button = switcher.querySelector('.current-workspace')
  const dropdown = switcher.querySelector('.workspace-dropdown')

  button.addEventListener('click', (e) => {
    e.stopPropagation()
    const expanded = button.getAttribute('aria-expanded') === 'true'
    button.setAttribute('aria-expanded', !expanded)
    dropdown.classList.toggle('open')
  })

  // Close on outside click
  document.addEventListener('click', () => {
    button.setAttribute('aria-expanded', 'false')
    dropdown.classList.remove('open')
  })

  // Prevent dropdown clicks from closing
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation()
  })
}
```

### Styling

Add to `public/style.css`:

```css
.workspace-switcher {
  position: relative;
  display: inline-block;
}

.current-workspace {
  padding: 0.25rem 0.5rem;
  border: 1px solid #ccc;
  background: white;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.current-workspace:hover {
  background: #f5f5f5;
}

.workspace-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  background: white;
  border: 1px solid #ccc;
  min-width: 200px;
  z-index: 100;
  margin-top: 2px;
}

.workspace-dropdown.open {
  display: block;
}

.workspace-dropdown hr {
  margin: 0.25rem 0;
  border: none;
  border-top: 1px solid #eee;
}

.workspace-item,
.add-workspace,
.remove-workspace {
  display: block;
  width: 100%;
  padding: 0.5rem;
  text-align: left;
  text-decoration: none;
  color: inherit;
  background: none;
  border: none;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
}

.workspace-item:hover,
.add-workspace:hover {
  background: #f5f5f5;
}

.workspace-item.active {
  font-weight: bold;
}

.workspace-indicator {
  margin-right: 0.25rem;
}

.add-workspace {
  color: #666;
}

.remove-workspace {
  color: #c00;
}

.remove-workspace:hover {
  background: #fee;
}
```

---

## Team Filter Interaction

When switching workspaces:
- **Team filter is reset** - teams are workspace-specific, so the selected team from one workspace won't exist in another
- The `/workspace/:id/switch` route clears `selectedTeamId` from session
- User sees all issues in new workspace, can re-select a team filter

---

## Implementation Steps

1. **Add `fetchOrganization()`** to `lib/linear.js`
2. **Add constants and helper functions** (`MAX_WORKSPACES`, `getActiveWorkspace`, `upsertWorkspace`, `removeWorkspace`, `saveSession`)
3. **Modify `/auth/callback`** to fetch org info and use new schema
4. **Update `ensureValidToken` middleware** for per-workspace refresh with race condition handling
5. **Add `POST /workspace/:id/switch`** route
6. **Add `POST /workspace/:id/remove`** route
7. **Update `lib/render.js`** to include workspace switcher HTML
8. **Add dropdown JavaScript** to `public/app.js`
9. **Add styling** to `public/style.css`
10. **Update main route** to use `getActiveWorkspace()` and pass workspace info to render
11. **Add E2E tests** for workspace switching

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Re-auth same workspace | Update tokens, don't create duplicate |
| Token refresh fails for one workspace | Remove that workspace, switch to another |
| All workspaces fail | Full logout, show landing page |
| User removes active workspace | Switch to first remaining workspace |
| User removes last workspace | Full logout |
| Max workspaces reached | Show error, don't add new |
| Switch workspace | Reset team filter |
| Concurrent token refresh | Both proceed; harmless, last write wins |

---

## Security Considerations

- Each workspace has independent tokens (compromise of one doesn't affect others)
- Workspace removal only affects that workspace's tokens
- OAuth state parameter still protects against CSRF during "Add Workspace"
- Workspace switch/remove use POST to prevent CSRF via GET links
- Remove confirmation prevents accidental removal
- Max workspace limit prevents session bloat attacks

---

## Testing

### Unit Tests
- `getActiveWorkspace()` returns correct workspace
- `getActiveWorkspace()` syncs `activeWorkspaceId` when out of sync
- `upsertWorkspace()` updates existing / adds new correctly
- `upsertWorkspace()` throws when limit reached
- `removeWorkspace()` updates `activeWorkspaceId` when removing active

### E2E Tests
```javascript
// tests/e2e/multi-workspace.spec.js
test('add workspace button starts OAuth flow', ...)
test('workspace switcher shows all workspaces', ...)
test('clicking workspace switches active workspace', ...)
test('switching workspace resets team filter', ...)
test('remove workspace removes from list', ...)
test('removing last workspace logs out', ...)
test('cannot exceed max workspaces', ...)
```

---

## Future Enhancements

- Background token refresh for all workspaces (not just active)
- Workspace-specific team selection memory (store per workspace)
- Show workspace color/logo if available from Linear
- Workspace reordering via drag-and-drop
