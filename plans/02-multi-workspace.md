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
  → Store alongside existing workspaces
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

---

## Data Model Changes

### Current Session Structure

```javascript
session = {
  accessToken: 'lin_oauth_...',
  refreshToken: 'lin_refresh_...',
  tokenExpiresAt: 1704567890000
}
```

### New Session Structure

```javascript
session = {
  workspaces: [
    {
      id: 'org-uuid-1',           // organization.id from Linear
      name: 'Acme Corp',          // organization.name
      urlKey: 'acme-corp',        // organization.urlKey
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

export async function fetchOrganization(apiKey) {
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: { Authorization: apiKey }
  })
  const data = await client.request(ORGANIZATION_QUERY)
  return data.organization
}
```

---

## Server Changes

### Helper Functions

```javascript
// Get active workspace from session
function getActiveWorkspace(session) {
  if (!session.workspaces?.length) return null
  return session.workspaces.find(w => w.id === session.activeWorkspaceId)
    || session.workspaces[0]
}

// Add or update workspace in session
function upsertWorkspace(session, workspace) {
  session.workspaces = session.workspaces || []
  const index = session.workspaces.findIndex(w => w.id === workspace.id)
  if (index >= 0) {
    // Update existing (re-auth for same workspace)
    session.workspaces[index] = { ...session.workspaces[index], ...workspace }
  } else {
    // Add new
    session.workspaces.push(workspace)
  }
}
```

### Modified OAuth Callback

```javascript
app.get('/auth/callback', async (req, res) => {
  // ... existing validation ...

  const tokenResponse = await fetch('https://api.linear.app/oauth/token', {
    // ... existing token exchange ...
  })
  const tokens = await tokenResponse.json()

  // NEW: Fetch organization info to identify workspace
  const org = await fetchOrganization(`Bearer ${tokens.access_token}`)

  // Build workspace object
  const workspace = {
    id: org.id,
    name: org.name,
    urlKey: org.urlKey,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiresAt: calculateExpiresAt(tokens.expires_in),
    addedAt: Date.now()
  }

  // Add/update in session
  upsertWorkspace(req.session, workspace)
  req.session.activeWorkspaceId = workspace.id

  req.session.save(() => res.redirect('/'))
})
```

### Modified Token Refresh Middleware

```javascript
async function ensureValidToken(req, res, next) {
  const workspace = getActiveWorkspace(req.session)
  if (!workspace) return next()

  if (needsRefresh(workspace.tokenExpiresAt)) {
    try {
      const newTokens = await refreshAccessToken(workspace.refreshToken)

      // Update workspace in place
      workspace.accessToken = newTokens.access_token
      workspace.refreshToken = newTokens.refresh_token
      workspace.tokenExpiresAt = calculateExpiresAt(newTokens.expires_in)

      await saveSession(req.session)
    } catch (err) {
      // Remove failed workspace, switch to another if available
      req.session.workspaces = req.session.workspaces
        .filter(w => w.id !== workspace.id)

      if (req.session.workspaces.length > 0) {
        req.session.activeWorkspaceId = req.session.workspaces[0].id
        return res.redirect('/')
      }
      // No workspaces left, clear session
      return req.session.destroy(() => res.redirect('/'))
    }
  }
  next()
}
```

### New Routes

```javascript
// Switch active workspace
app.get('/workspace/:id', (req, res) => {
  const workspace = req.session.workspaces?.find(w => w.id === req.params.id)
  if (workspace) {
    req.session.activeWorkspaceId = workspace.id
    req.session.save(() => res.redirect('/'))
  } else {
    res.status(404).send('Workspace not found')
  }
})

// Remove a workspace (without full logout)
app.post('/workspace/:id/remove', (req, res) => {
  req.session.workspaces = req.session.workspaces
    ?.filter(w => w.id !== req.params.id) || []

  if (req.session.activeWorkspaceId === req.params.id) {
    req.session.activeWorkspaceId = req.session.workspaces[0]?.id || null
  }

  if (req.session.workspaces.length === 0) {
    return req.session.destroy(() => res.redirect('/'))
  }

  req.session.save(() => res.redirect('/'))
})
```

---

## UI Changes

### Workspace Switcher Component

Add to header area:

```html
<div class="workspace-switcher">
  <div class="current-workspace">
    <span class="workspace-name">Acme Corp</span>
    <span class="dropdown-arrow">▼</span>
  </div>
  <div class="workspace-dropdown">
    <a href="/workspace/org-uuid-1" class="workspace-item active">
      <span class="workspace-indicator">●</span> Acme Corp
    </a>
    <a href="/workspace/org-uuid-2" class="workspace-item">
      <span class="workspace-indicator">○</span> Side Project
    </a>
    <hr>
    <a href="/auth/linear" class="add-workspace">+ Add Workspace</a>
  </div>
</div>
```

### Styling

```css
.workspace-switcher {
  position: relative;
  cursor: pointer;
}

.current-workspace {
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.workspace-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  background: white;
  border: 1px solid #ddd;
  min-width: 200px;
  z-index: 100;
}

.workspace-switcher:hover .workspace-dropdown,
.workspace-switcher:focus-within .workspace-dropdown {
  display: block;
}

.workspace-item {
  display: block;
  padding: 0.5rem 1rem;
  text-decoration: none;
  color: inherit;
}

.workspace-item:hover {
  background: #f5f5f5;
}

.workspace-item.active {
  font-weight: bold;
}

.add-workspace {
  display: block;
  padding: 0.5rem 1rem;
  color: #666;
}
```

---

## Migration Strategy

### Existing Sessions

Handle sessions with old schema gracefully:

```javascript
function migrateSession(session) {
  // Old schema: single token
  if (session.accessToken && !session.workspaces) {
    session.workspaces = [{
      id: 'legacy-' + Date.now(), // Temporary ID until we fetch org
      name: 'Workspace',          // Will be updated on next request
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      tokenExpiresAt: session.tokenExpiresAt,
      addedAt: Date.now()
    }]
    session.activeWorkspaceId = session.workspaces[0].id

    // Clean up old fields
    delete session.accessToken
    delete session.refreshToken
    delete session.tokenExpiresAt
  }
  return session
}
```

### Backfill Organization Info

For migrated sessions, fetch org info on first request:

```javascript
app.use(async (req, res, next) => {
  migrateSession(req.session)

  const workspace = getActiveWorkspace(req.session)
  if (workspace?.id.startsWith('legacy-')) {
    // Backfill organization info
    const org = await fetchOrganization(`Bearer ${workspace.accessToken}`)
    workspace.id = org.id
    workspace.name = org.name
    workspace.urlKey = org.urlKey
    req.session.activeWorkspaceId = org.id
    await saveSession(req.session)
  }
  next()
})
```

---

## Implementation Steps

1. **Add `fetchOrganization()`** to `lib/linear.js`
2. **Create helper functions** for workspace management
3. **Update session schema** with migration support
4. **Modify `/auth/callback`** to fetch org info and use new schema
5. **Update `ensureValidToken` middleware** for multi-workspace
6. **Add `/workspace/:id`** route for switching
7. **Add `/workspace/:id/remove`** route
8. **Update `lib/render.js`** to include workspace switcher
9. **Add styling** for workspace switcher
10. **Update main route** to use `getActiveWorkspace()`
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
| Session migration | Transparent upgrade, backfill org info |

---

## Security Considerations

- Each workspace has independent tokens (compromise of one doesn't affect others)
- Workspace removal only affects that workspace's tokens
- OAuth state parameter still protects against CSRF during "Add Workspace"

---

## Testing

### Unit Tests
- `getActiveWorkspace()` returns correct workspace
- `upsertWorkspace()` updates existing / adds new correctly
- Session migration preserves tokens

### E2E Tests
```javascript
// tests/e2e/multi-workspace.spec.js
test('add workspace button starts OAuth flow', ...)
test('workspace switcher shows all workspaces', ...)
test('clicking workspace switches active workspace', ...)
test('remove workspace removes from list', ...)
test('removing last workspace logs out', ...)
```

---

## Future Enhancements

- Background token refresh for all workspaces (not just active)
- Workspace-specific team selection (see 01-team-filter.md)
- Keyboard shortcut for workspace switching (e.g., `Cmd+1`, `Cmd+2`)
- Show workspace color/logo if available from Linear
- Combine with multi-account for full flexibility (see 03-multi-account.md)
