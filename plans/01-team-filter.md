# Plan: Team Filter

## Overview

Add the ability to filter the project/issue tree by Linear team. This allows users in large workspaces to focus on issues relevant to their team.

## Current Behavior

- App fetches ALL issues across ALL teams in the workspace
- No team information is queried or displayed
- Users see every issue regardless of team membership

## Goal

- Add a team selector dropdown in the UI
- Filter displayed issues by selected team
- Persist team selection across sessions
- Option to view "All Teams" (current behavior)

---

## Technical Approach

### Option A: Server-Side Filtering (Recommended)

Filter issues at the GraphQL query level for better performance.

**Pros:**
- Less data transferred over network
- Faster page loads for large workspaces
- Reduces Linear API pagination needs

**Cons:**
- Requires page reload or API call to switch teams
- Need to handle team parameter in routes

### Option B: Client-Side Filtering

Fetch all issues, filter in browser.

**Pros:**
- Instant team switching without reload
- Simpler server implementation

**Cons:**
- Still fetches all data even if user only needs one team
- Slower initial load
- Memory usage for large workspaces

### Recommendation

Start with **Option A** (server-side) with team in query string. Could add client-side caching later for instant switching.

---

## API Changes

### New GraphQL Query: Fetch Teams

```javascript
// lib/linear.js
const TEAMS_QUERY = gql`
  query {
    teams {
      nodes {
        id
        name
        key
        description
        color
      }
    }
  }
`

export async function fetchTeams(apiKey) {
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: { Authorization: apiKey }
  })
  const data = await client.request(TEAMS_QUERY)
  return data.teams.nodes
}
```

### Modified Issues Query: Filter by Team

```javascript
const ISSUES_QUERY = gql`
  query($first: Int!, $after: String, $teamId: ID) {
    issues(
      first: $first,
      after: $after,
      filter: { team: { id: { eq: $teamId } } }
    ) {
      nodes { ... }
      pageInfo { hasNextPage, endCursor }
    }
  }
`

// Make teamId optional - null means all teams
export async function fetchProjects(apiKey, teamId = null) {
  // ... existing code with optional filter
}
```

---

## Data Model Changes

### Session Storage

No changes required. Team selection stored client-side.

### LocalStorage

```javascript
// Existing: collapse state
localStorage.getItem('collapseState')

// New: selected team
localStorage.getItem('selectedTeamId')  // team UUID or 'all'
```

---

## Server Changes

### Route: GET /

```javascript
app.get('/', ensureValidToken, async (req, res) => {
  const teamId = req.query.team || null  // Optional team filter

  // Fetch teams for dropdown
  const teams = await fetchTeams(req.session.accessToken)

  // Fetch projects/issues (filtered if teamId provided)
  const { projects, issues } = await fetchProjects(
    req.session.accessToken,
    teamId
  )

  // Render with team selector data
  res.send(renderPage({
    teams,
    selectedTeamId: teamId,
    projects,
    issues
  }))
})
```

---

## UI Changes

### Team Selector Component

Add dropdown above the project tree:

```html
<div class="team-selector">
  <label for="team">Team:</label>
  <select id="team" onchange="switchTeam(this.value)">
    <option value="all">All Teams</option>
    <option value="uuid-1">Engineering</option>
    <option value="uuid-2">Design</option>
    <!-- ... -->
  </select>
</div>
```

### Client-Side JavaScript

```javascript
// public/app.js
function switchTeam(teamId) {
  localStorage.setItem('selectedTeamId', teamId)
  const url = teamId === 'all'
    ? '/'
    : `/?team=${teamId}`
  window.location.href = url
}

// On page load, restore selection
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('selectedTeamId')
  if (saved) {
    document.getElementById('team').value = saved
  }
})
```

### Styling

```css
/* public/style.css */
.team-selector {
  margin-bottom: 1rem;
  padding: 0.5rem;
  border-bottom: 1px solid #ddd;
}

.team-selector select {
  font-family: monospace;
  padding: 0.25rem 0.5rem;
}
```

---

## Implementation Steps

1. **Add `fetchTeams()` function** to `lib/linear.js`
2. **Modify `fetchProjects()`** to accept optional `teamId` filter
3. **Update route handler** in `server.js` to:
   - Parse `?team=` query parameter
   - Fetch teams list
   - Pass team filter to `fetchProjects()`
   - Include teams in render data
4. **Update `lib/render.js`** to include team selector HTML
5. **Add team switching logic** to `public/app.js`
6. **Add styles** for team selector
7. **Add E2E tests** for team filtering

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| User has no teams | Show "No teams available" message |
| Selected team deleted | Fall back to "All Teams", clear localStorage |
| Team has no issues | Show empty state "No issues in this team" |
| Issues without team | Only show in "All Teams" view |

---

## Testing

### Unit Tests
- `fetchTeams()` returns team list
- `fetchProjects()` filters correctly with teamId
- `fetchProjects()` returns all issues when teamId is null

### E2E Tests
```javascript
// tests/e2e/team-filter.spec.js
test('team selector appears for authenticated users', ...)
test('selecting team filters issues', ...)
test('team selection persists across page loads', ...)
test('"All Teams" shows all issues', ...)
```

---

## Future Enhancements

- Show team color/icon in selector
- Team keyboard shortcut (e.g., `Cmd+T` to open team picker)
- Remember team selection per workspace (for multi-workspace feature)
- Show team badge on issues when viewing "All Teams"
