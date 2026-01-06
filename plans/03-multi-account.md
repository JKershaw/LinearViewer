# Plan: Multi-Account Support

## Overview

Allow users to log in with multiple Linear accounts simultaneously. This extends multi-workspace support to handle entirely separate Linear identities, useful for:

- Contractors working with multiple clients
- Users with personal and work accounts
- Agency employees managing multiple client organizations

## Current Behavior

- Single OAuth session per browser
- One identity at a time
- Switching accounts requires full logout/re-login

## Goal

- Store credentials for multiple Linear accounts
- Each account can have multiple workspaces (builds on 02-multi-workspace.md)
- Account switcher showing user identity + workspace
- "Add Account" triggers fresh OAuth flow
- Remove individual accounts without affecting others

---

## Relationship to Multi-Workspace

**Multi-workspace** (Plan 02): One user, multiple workspaces
```
John's Account
├── Workspace: Acme Corp
└── Workspace: Side Project
```

**Multi-account** (This plan): Multiple users, each with workspaces
```
Session
├── John's Account (john@work.com)
│   ├── Workspace: Acme Corp
│   └── Workspace: Side Project
└── Jane's Account (jane@client.com)
    └── Workspace: Client Co
```

### Implementation Strategy

**Option A: Extend Multi-Workspace Schema**

Add user identity fields to existing workspace entries. Simpler but denormalized.

**Option B: Nested Account → Workspace Structure**

Accounts contain workspaces. More complex but cleaner data model.

**Recommendation**: Option A (extend workspace schema) for simplicity. Each "workspace" entry includes its user identity. This means the same workspace accessed by different accounts appears as separate entries—which is actually correct behavior since they have different tokens/permissions.

---

## Data Model

### Extended Workspace Schema

```javascript
session = {
  workspaces: [
    {
      // Identity (NEW)
      id: 'unique-uuid',              // Internal unique ID

      // User info (NEW)
      userId: 'linear-user-uuid',     // viewer.id
      userName: 'John Doe',           // viewer.name
      userEmail: 'john@work.com',     // viewer.email
      userAvatarUrl: 'https://...',   // viewer.avatarUrl (optional)

      // Workspace info (from Plan 02)
      workspaceId: 'org-uuid',        // organization.id
      workspaceName: 'Acme Corp',     // organization.name
      workspaceUrlKey: 'acme-corp',   // organization.urlKey

      // Tokens (existing)
      accessToken: 'lin_oauth_...',
      refreshToken: 'lin_refresh_...',
      tokenExpiresAt: 1704567890000,

      // Metadata
      addedAt: 1704500000000
    },
    {
      id: 'unique-uuid-2',
      userId: 'linear-user-uuid',     // Same user
      userName: 'John Doe',
      userEmail: 'john@work.com',
      workspaceId: 'org-uuid-2',      // Different workspace
      workspaceName: 'Side Project',
      workspaceUrlKey: 'side-project',
      accessToken: '...',
      refreshToken: '...',
      tokenExpiresAt: ...,
      addedAt: ...
    },
    {
      id: 'unique-uuid-3',
      userId: 'different-user-uuid',  // Different user entirely
      userName: 'Jane Contractor',
      userEmail: 'jane@client.com',
      workspaceId: 'org-uuid-3',
      workspaceName: 'Client Co',
      workspaceUrlKey: 'client-co',
      accessToken: '...',
      refreshToken: '...',
      tokenExpiresAt: ...,
      addedAt: ...
    }
  ],
  activeWorkspaceId: 'unique-uuid'
}
```

### Unique Identifier Strategy

Use internal UUID (`id` field) rather than `userId + workspaceId` composite key because:
- Same user can re-auth to same workspace (should update, not duplicate)
- Different users in same workspace are distinct entries
- Simpler lookup logic

**Duplicate Detection**: Check `userId + workspaceId` combo when adding to detect re-auth.

---

## API Changes

### Extended Identity Query

```javascript
// lib/linear.js
const IDENTITY_QUERY = gql`
  query {
    viewer {
      id
      name
      email
      avatarUrl
    }
    organization {
      id
      name
      urlKey
    }
  }
`

export async function fetchIdentity(apiKey) {
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: { Authorization: apiKey }
  })
  const data = await client.request(IDENTITY_QUERY)
  return {
    user: data.viewer,
    organization: data.organization
  }
}
```

---

## Server Changes

### Helper Functions

```javascript
import crypto from 'crypto'

// Generate unique ID for workspace entry
function generateWorkspaceEntryId() {
  return crypto.randomUUID()
}

// Find existing entry for same user + workspace combo
function findExistingEntry(session, userId, workspaceId) {
  return session.workspaces?.find(
    w => w.userId === userId && w.workspaceId === workspaceId
  )
}

// Add or update workspace entry
function upsertWorkspaceEntry(session, entry) {
  session.workspaces = session.workspaces || []

  const existing = findExistingEntry(session, entry.userId, entry.workspaceId)

  if (existing) {
    // Update existing entry (re-auth)
    Object.assign(existing, entry, { id: existing.id })
    return existing.id
  } else {
    // Add new entry
    const id = generateWorkspaceEntryId()
    session.workspaces.push({ ...entry, id })
    return id
  }
}

// Get active workspace entry
function getActiveEntry(session) {
  if (!session.workspaces?.length) return null
  return session.workspaces.find(w => w.id === session.activeWorkspaceId)
    || session.workspaces[0]
}

// Group workspaces by user for UI
function groupByUser(workspaces) {
  const groups = {}
  for (const ws of workspaces) {
    const key = ws.userId
    if (!groups[key]) {
      groups[key] = {
        userId: ws.userId,
        userName: ws.userName,
        userEmail: ws.userEmail,
        userAvatarUrl: ws.userAvatarUrl,
        workspaces: []
      }
    }
    groups[key].workspaces.push(ws)
  }
  return Object.values(groups)
}
```

### Modified OAuth Callback

```javascript
app.get('/auth/callback', async (req, res) => {
  // ... existing validation and token exchange ...

  const tokens = await tokenResponse.json()

  // Fetch full identity (user + organization)
  const identity = await fetchIdentity(`Bearer ${tokens.access_token}`)

  // Build workspace entry
  const entry = {
    userId: identity.user.id,
    userName: identity.user.name,
    userEmail: identity.user.email,
    userAvatarUrl: identity.user.avatarUrl,
    workspaceId: identity.organization.id,
    workspaceName: identity.organization.name,
    workspaceUrlKey: identity.organization.urlKey,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiresAt: calculateExpiresAt(tokens.expires_in),
    addedAt: Date.now()
  }

  // Add/update entry
  const entryId = upsertWorkspaceEntry(req.session, entry)
  req.session.activeWorkspaceId = entryId

  req.session.save(() => res.redirect('/'))
})
```

### Routes

```javascript
// Switch to specific workspace entry
app.get('/account/:id', (req, res) => {
  const entry = req.session.workspaces?.find(w => w.id === req.params.id)
  if (entry) {
    req.session.activeWorkspaceId = entry.id
    req.session.save(() => res.redirect('/'))
  } else {
    res.status(404).send('Account not found')
  }
})

// Remove specific workspace entry
app.post('/account/:id/remove', (req, res) => {
  const id = req.params.id
  req.session.workspaces = req.session.workspaces?.filter(w => w.id !== id) || []

  if (req.session.activeWorkspaceId === id) {
    req.session.activeWorkspaceId = req.session.workspaces[0]?.id || null
  }

  if (req.session.workspaces.length === 0) {
    return req.session.destroy(() => res.redirect('/'))
  }

  req.session.save(() => res.redirect('/'))
})

// Remove all workspaces for a user (logout one account entirely)
app.post('/account/user/:userId/remove', (req, res) => {
  const userId = req.params.userId
  req.session.workspaces = req.session.workspaces
    ?.filter(w => w.userId !== userId) || []

  // If active was removed, switch
  const active = req.session.workspaces
    .find(w => w.id === req.session.activeWorkspaceId)
  if (!active) {
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

### Account Switcher Component

Hierarchical display: Users → Workspaces

```html
<div class="account-switcher">
  <div class="current-account">
    <img src="avatar.jpg" class="avatar" alt="">
    <div class="account-info">
      <span class="user-name">John Doe</span>
      <span class="workspace-name">Acme Corp</span>
    </div>
    <span class="dropdown-arrow">▼</span>
  </div>

  <div class="account-dropdown">
    <!-- User 1 -->
    <div class="user-group">
      <div class="user-header">
        <img src="avatar1.jpg" class="avatar-small" alt="">
        <span>john@work.com</span>
      </div>
      <a href="/account/uuid-1" class="workspace-item active">
        ● Acme Corp
      </a>
      <a href="/account/uuid-2" class="workspace-item">
        ○ Side Project
      </a>
      <button class="remove-user" data-user-id="user-1">
        Remove account
      </button>
    </div>

    <hr>

    <!-- User 2 -->
    <div class="user-group">
      <div class="user-header">
        <img src="avatar2.jpg" class="avatar-small" alt="">
        <span>jane@client.com</span>
      </div>
      <a href="/account/uuid-3" class="workspace-item">
        ○ Client Co
      </a>
      <button class="remove-user" data-user-id="user-2">
        Remove account
      </button>
    </div>

    <hr>

    <a href="/auth/linear" class="add-account">
      + Add Account or Workspace
    </a>
  </div>
</div>
```

### Display Logic

```javascript
// Server-side: prepare data for rendering
function prepareAccountSwitcherData(session) {
  const groups = groupByUser(session.workspaces || [])
  const active = getActiveEntry(session)

  return {
    groups,
    activeId: active?.id,
    activeUser: active ? {
      name: active.userName,
      email: active.userEmail,
      avatar: active.userAvatarUrl
    } : null,
    activeWorkspace: active?.workspaceName
  }
}
```

### Styling

```css
.account-switcher {
  position: relative;
}

.current-account {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  cursor: pointer;
}

.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.avatar-small {
  width: 18px;
  height: 18px;
  border-radius: 50%;
}

.account-info {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.user-name {
  font-weight: bold;
  font-size: 0.9rem;
}

.workspace-name {
  font-size: 0.8rem;
  color: #666;
}

.account-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  right: 0;
  background: white;
  border: 1px solid #ddd;
  min-width: 250px;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.account-switcher:hover .account-dropdown {
  display: block;
}

.user-group {
  padding: 0.5rem 0;
}

.user-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  font-weight: bold;
  font-size: 0.85rem;
  color: #666;
}

.workspace-item {
  display: block;
  padding: 0.5rem 1rem 0.5rem 2.5rem;
  text-decoration: none;
  color: inherit;
}

.workspace-item:hover {
  background: #f5f5f5;
}

.workspace-item.active {
  font-weight: bold;
}

.remove-user {
  display: block;
  width: calc(100% - 2rem);
  margin: 0.5rem 1rem;
  padding: 0.25rem;
  background: none;
  border: 1px solid #ddd;
  cursor: pointer;
  font-size: 0.75rem;
  color: #999;
}

.remove-user:hover {
  border-color: #c00;
  color: #c00;
}

.add-account {
  display: block;
  padding: 0.75rem 1rem;
  text-decoration: none;
  color: #666;
  text-align: center;
}

.add-account:hover {
  background: #f5f5f5;
}
```

---

## Migration Strategy

### From Single Token (Original)

```javascript
function migrateFromSingleToken(session) {
  if (session.accessToken && !session.workspaces) {
    session.workspaces = [{
      id: generateWorkspaceEntryId(),
      // User info will be backfilled
      userId: null,
      userName: 'Unknown User',
      userEmail: null,
      // Workspace info will be backfilled
      workspaceId: null,
      workspaceName: 'Workspace',
      workspaceUrlKey: null,
      // Tokens
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      tokenExpiresAt: session.tokenExpiresAt,
      addedAt: Date.now(),
      needsBackfill: true  // Flag for backfill
    }]
    session.activeWorkspaceId = session.workspaces[0].id

    delete session.accessToken
    delete session.refreshToken
    delete session.tokenExpiresAt
  }
}
```

### From Multi-Workspace (Plan 02)

```javascript
function migrateFromMultiWorkspace(session) {
  if (session.workspaces?.[0] && !session.workspaces[0].userId) {
    // Has workspace schema but missing user info
    for (const ws of session.workspaces) {
      ws.userId = null
      ws.userName = 'Unknown User'
      ws.userEmail = null
      ws.userAvatarUrl = null
      ws.needsBackfill = true
    }
  }
}
```

### Backfill Middleware

```javascript
app.use(async (req, res, next) => {
  migrateFromSingleToken(req.session)
  migrateFromMultiWorkspace(req.session)

  // Backfill identity for entries missing it
  for (const ws of req.session.workspaces || []) {
    if (ws.needsBackfill && ws.accessToken) {
      try {
        const identity = await fetchIdentity(`Bearer ${ws.accessToken}`)
        ws.userId = identity.user.id
        ws.userName = identity.user.name
        ws.userEmail = identity.user.email
        ws.userAvatarUrl = identity.user.avatarUrl
        ws.workspaceId = identity.organization.id
        ws.workspaceName = identity.organization.name
        ws.workspaceUrlKey = identity.organization.urlKey
        delete ws.needsBackfill
      } catch (err) {
        // Token may be invalid, will be handled by refresh middleware
      }
    }
  }

  if (req.session.workspaces?.some(w => !w.needsBackfill)) {
    await saveSession(req.session)
  }

  next()
})
```

---

## Implementation Steps

1. **Extend `fetchIdentity()`** to return both user and organization
2. **Add helper functions** for entry management and grouping
3. **Update migration functions** to handle new schema
4. **Modify `/auth/callback`** to store full identity
5. **Update token refresh middleware** for new schema
6. **Add routes** for account/workspace switching and removal
7. **Update `lib/render.js`** for account switcher UI
8. **Add styling** for hierarchical account display
9. **Add backfill middleware** for migrations
10. **Add E2E tests** for multi-account flows

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Same user, same workspace, re-auth | Update tokens on existing entry |
| Same user, different workspace | Add new entry (both visible) |
| Different user, same workspace | Add new entry (both visible, different tokens) |
| Token refresh fails | Remove that entry, switch to another |
| Remove user's only workspace | Same as removing user |
| Remove all entries | Full logout |
| Avatar URL missing | Show placeholder initial |
| Email not available | Show user name only |

---

## Security Considerations

- Each account has isolated tokens (no cross-contamination)
- Removing one account doesn't expose others
- Session cookie still protected by SESSION_SECRET
- No sensitive data in localStorage (only collapse state, team selection)

---

## Testing

### Unit Tests
- `findExistingEntry()` finds correct match
- `upsertWorkspaceEntry()` updates vs creates correctly
- `groupByUser()` groups correctly
- Migration functions handle all schema versions

### E2E Tests
```javascript
// tests/e2e/multi-account.spec.js
test('add account button starts OAuth flow', ...)
test('account switcher shows grouped accounts', ...)
test('clicking workspace switches to it', ...)
test('remove account removes all its workspaces', ...)
test('same user can have multiple workspaces', ...)
test('different users can access same workspace', ...)
```

---

## Future Enhancements

- Keyboard shortcuts for switching (Cmd+1, Cmd+2, etc.)
- Search/filter in account dropdown for many accounts
- Account nicknames/labels for disambiguation
- Workspace-specific settings (team filter, collapse state)
- "Switch to last used" shortcut
- Desktop notifications per account
