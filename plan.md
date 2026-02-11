# Backend Provider Abstraction Plan

## Overview

Refactor the codebase to introduce a provider abstraction layer, making Linear one of several possible backends. Each provider implements a common interface, and projects/issues track their source. The system remains valuable even with minimal provider capabilities (e.g., GitHub Issues listing + prompt generation).

## Design Principles

1. **Canonical models** — All providers map to normalized Issue/Project/State shapes
2. **Capabilities, not assumptions** — Features like subtasks, comments, or write ops are declared capabilities, not assumed
3. **Source tracking** — Every project and issue knows which provider it came from
4. **Graceful degradation** — The UI adapts based on what the provider supports
5. **Linear stays first-class** — No regression for existing Linear users; Linear-specific features (MCP, relations) become provider-specific extensions

---

## Phase 1: Canonical Models & State Mapping

**Goal:** Introduce normalized data shapes that the rest of the app operates on, without changing any external behavior.

### 1a. Create `lib/providers/models.js` — Canonical data shapes

```js
// Canonical state types (the 5 states the app already uses, just named generically)
export const CanonicalState = {
  IN_PROGRESS: 'in_progress',
  TODO: 'todo',
  BACKLOG: 'backlog',
  DONE: 'done',
  CANCELLED: 'cancelled'
}

// Canonical Issue shape
// {
//   id, identifier, title, description,
//   state: { canonical, name, raw },
//   priority, estimate, sortOrder,
//   createdAt, dueDate, completedAt,
//   url, parentId, projectId,
//   assignee, labels: string[],
//   source: { provider, workspaceId }
// }

// Canonical Project shape
// {
//   id, name, description, url, sortOrder,
//   source: { provider, workspaceId }
// }
```

### 1b. Create `lib/providers/state-map.js` — State mapping utilities

```js
// Map canonical states to the display properties the app already uses
export function getStateDisplay(canonicalState) {
  // Returns { cssClass, char, label } — the same ✓/◐/○/◌ mapping
  // currently hardcoded in render.js
}

// Check helpers used by tree.js
export function isCompleted(state) { ... }
export function isInProgress(state) { ... }
export function isActionable(state) { ... }
```

### 1c. Refactor `lib/tree.js` to use canonical states

Replace all `issue.state?.type === 'started'` with `isInProgress(issue.state)` etc. The tree module should import from `state-map.js` instead of hardcoding Linear state strings.

**Files changed:** `lib/tree.js`, new `lib/providers/models.js`, new `lib/providers/state-map.js`

### 1d. Refactor `lib/render.js` to use canonical states

Replace the state switch in `renderNode()` with a call to `getStateDisplay(issue.state.canonical)`. Remove hardcoded `'started'`/`'completed'`/etc strings.

**Files changed:** `lib/render.js`

---

## Phase 2: Provider Interface & Linear Provider

**Goal:** Extract all Linear-specific logic behind a provider interface. Linear becomes the first (and initially only) provider.

### 2a. Create `lib/providers/interface.js` — Provider contract

```js
export class Provider {
  /** @returns {string} Provider key, e.g., 'linear' */
  get name() {}

  /** @returns {string} Display name, e.g., 'Linear' */
  get displayName() {}

  /**
   * Declared capabilities — UI adapts based on these
   * @returns {Object}
   */
  get capabilities() {
    return {
      subtasks: false,       // Parent-child issue hierarchy
      comments: false,       // Issue comments
      labels: false,         // Issue labels
      estimates: false,      // Point estimates
      priorities: false,     // Priority levels
      write: false,          // Create/update issues
      oauth: false,          // OAuth authentication flow
      teams: false,          // Team-based filtering
      projects: true,        // Project grouping (required)
    }
  }

  /** Map a provider-specific state to a canonical state */
  mapState(rawStateType, rawStateName) {
    // Returns { canonical, name, raw }
  }

  /** @returns {Router|null} Express router for auth routes */
  getAuthRouter() { return null }

  /** Fetch projects and issues */
  async fetchProjectsAndIssues(credentials, options) {
    // Returns { organizationName, projects: Project[], issues: Issue[] }
    // with canonical state shapes already applied
  }

  /** Fetch detailed context for a single issue (for prompts) */
  async fetchIssueContext(credentials, issueId) {
    // Returns { issue, parent?, siblings?, project?, children?, comments? }
  }

  /** Fetch comments for an issue (optional, requires comments capability) */
  async fetchComments(credentials, issueId) {
    // Returns Comment[]
  }

  /** Get the URL for creating a new task (optional) */
  getCreateTaskUrl(workspaceKey, projectId) {
    return null
  }

  /** Fetch teams for filtering (optional, requires teams capability) */
  async fetchTeams(credentials) {
    return []
  }
}
```

### 2b. Create `lib/providers/linear/index.js` — Linear provider

Extract all Linear-specific logic from `lib/linear.js` into a provider implementation:

- Move GraphQL queries, client creation, fetch functions into the provider
- Implement `mapState()` to convert Linear's `started`/`unstarted`/`backlog`/`completed`/`canceled` to canonical states
- Implement `getCreateTaskUrl()` to return `https://linear.app/{urlKey}/new?project={id}`
- Keep `linear-cli.js` as a separate tool (it's for AI agents, not the web UI)

The existing `lib/linear.js` becomes a thin re-export or is replaced entirely.

**Files changed:** New `lib/providers/linear/index.js`, refactored `lib/linear.js`

### 2c. Create `lib/providers/registry.js` — Provider registry

```js
const providers = new Map()

export function registerProvider(provider) {
  providers.set(provider.name, provider)
}

export function getProvider(name) {
  return providers.get(name)
}

export function getAllProviders() {
  return [...providers.values()]
}
```

### 2d. Refactor `server.js` to use provider registry

Replace direct `fetchProjects()` / `fetchTeams()` calls with provider-based calls:

```js
const provider = getProvider(workspace.provider) // 'linear'
const { projects, issues } = await provider.fetchProjectsAndIssues(workspace.credentials, { teamId })
```

**Files changed:** `server.js`, new `lib/providers/registry.js`

---

## Phase 3: Source Tracking & Multi-Provider Rendering

**Goal:** Projects and issues carry source metadata. The UI adapts based on provider capabilities.

### 3a. Add source tracking to workspace model

Each workspace in the session already stores Linear-specific data. Generalize:

```js
// Before (implicit Linear)
{ id, urlKey, accessToken, refreshToken, tokenExpiresAt, name }

// After (provider-aware)
{ id, urlKey, provider: 'linear', credentials: { accessToken, refreshToken, tokenExpiresAt }, name }
```

**Files changed:** `lib/workspace.js`, `routes/auth.js`

### 3b. Capability-aware rendering

In `lib/render.js`:
- Only show "Add task" link if provider has `write` capability and `getCreateTaskUrl()` returns a URL
- Only show "View in Linear →" if there's a `url` on the issue; change text to "View in {providerDisplayName} →"
- Only show Comments toggle if provider has `comments` capability
- Only show estimates if provider has `estimates` capability

```js
// renderDetails() receives provider capabilities
const caps = getProvider(issue.source.provider).capabilities
if (caps.comments && !isLanding && urlKey) {
  // render comments toggle
}
```

### 3c. Capability-aware prompts

The prompt system should:
- Skip MCP/Linear references when the provider isn't Linear
- Skip subtask formatting when provider doesn't support subtasks
- Adjust workflow instructions based on capabilities (e.g., no "set status to In Progress" if provider doesn't support write)

**Files changed:** `lib/render.js`, `lib/prompt-formatters.js`, `lib/prompt-templates.js`

---

## Phase 4: Second Provider — GitHub Issues

**Goal:** Prove the abstraction by implementing a second provider. GitHub Issues is a good choice because it has very different capabilities from Linear.

### 4a. Create `lib/providers/github/index.js`

```js
class GitHubProvider extends Provider {
  get name() { return 'github' }
  get displayName() { return 'GitHub Issues' }
  get capabilities() {
    return {
      subtasks: false,        // GitHub has task lists but not real subtasks
      comments: true,         // GitHub issues have comments
      labels: true,           // GitHub has labels
      estimates: false,       // No native estimates
      priorities: false,      // No native priority field
      write: true,            // Can create/update via API
      oauth: true,            // GitHub OAuth
      teams: false,           // No team concept (repos instead)
      projects: true,         // GitHub Projects or repos as grouping
    }
  }

  mapState(rawState) {
    // GitHub: 'open' -> TODO, 'closed' -> DONE
    // GitHub Projects: 'Todo', 'In Progress', 'Done' columns
  }

  async fetchProjectsAndIssues(credentials, options) {
    // Use GitHub REST or GraphQL API
    // Map milestones or GitHub Projects to canonical Projects
    // Map issues to canonical Issues
  }
}
```

### 4b. Add GitHub OAuth route

Create `routes/github-auth.js` using GitHub's OAuth flow. Store GitHub token in workspace credentials.

### 4c. Provider selection UI

On the landing/login page, show provider options:
- "Connect with Linear" (existing)
- "Connect with GitHub" (new)

The workspace switcher should show which provider each workspace uses.

---

## Phase 5: Static/Local Providers

**Goal:** Support non-API backends like markdown files or manual lists.

### 5a. Create `lib/providers/markdown/index.js`

```js
class MarkdownProvider extends Provider {
  get name() { return 'markdown' }
  get displayName() { return 'Markdown Files' }
  get capabilities() {
    return {
      subtasks: true,          // Can nest via indentation
      comments: false,
      labels: true,            // Can use tags
      estimates: false,
      priorities: false,
      write: false,            // Read-only (user edits files)
      oauth: false,
      teams: false,
      projects: true,          // Each file = a project
    }
  }

  // Reads markdown files from a directory
  // Parses task lists (- [ ] / - [x]) into issues
  // Supports headings as project names
}
```

This is essentially a generalization of the existing `parse-landing.js` logic.

### 5b. Obsidian provider (extends markdown)

Could be a variant that reads from an Obsidian vault, using frontmatter for metadata and wiki-links for relationships.

---

## Migration Strategy

### Incremental, not big-bang

Each phase is independently shippable and testable:

1. **Phase 1** is pure refactoring — no behavior change, all existing tests should pass
2. **Phase 2** introduces the interface but only Linear implements it — still no behavior change
3. **Phase 3** adds source tracking and capability-aware rendering — existing Linear users see minor text changes ("View in Linear" becomes dynamic)
4. **Phase 4** adds a real second provider — proves the abstraction works
5. **Phase 5** is additive — static providers for non-API use cases

### What stays unchanged

- `public/app.js` — Client-side collapse/expand logic is already generic
- `lib/session-store.js` — Session management is already backend-agnostic
- `lib/dispatch-store.js` — Dispatch queue is generic
- `lib/openrouter.js` — AI recommendation engine is generic (receives context, not Linear objects)
- `public/style.css` — Styling is generic

### What changes per phase

| Phase | Files Changed | Files Created | Risk |
|-------|--------------|---------------|------|
| 1 | `tree.js`, `render.js` | `providers/models.js`, `providers/state-map.js` | Low — pure refactor |
| 2 | `server.js`, `linear.js` | `providers/interface.js`, `providers/linear/index.js`, `providers/registry.js` | Medium — restructure |
| 3 | `render.js`, `workspace.js`, `prompt-formatters.js`, `routes/auth.js` | — | Medium — rendering changes |
| 4 | — | `providers/github/index.js`, `routes/github-auth.js` | Low — additive |
| 5 | — | `providers/markdown/index.js` | Low — additive |

---

## Key Design Decisions

### Q: How do we handle the "Add task" link?
**A:** `provider.getCreateTaskUrl(workspaceKey, projectId)` returns a URL or null. Render.js only shows the link if non-null.

### Q: How do we handle the image proxy?
**A:** The image proxy route becomes provider-aware. Each provider declares allowed image hosts. The proxy validates against the active provider's allowlist.

### Q: How do we handle the CLI (`linear-cli.js`)?
**A:** Keep it as a Linear-specific tool. It's for AI agents with `LINEAR_API_KEY`, not the web UI. No need to abstract it. Future providers could have their own CLI tools.

### Q: How do we handle prompts for providers without MCP?
**A:** The `formatWorkflow()` function already has a `useMcp` flag. We extend this: providers declare whether they have MCP integration. The prompt templates check `provider.capabilities.mcp` and adjust workflow instructions accordingly.

### Q: What about the audit system?
**A:** `lib/audit.js` is deeply Linear-specific (queries workflow states, analyzes project health). For Phase 1-3, keep it Linear-only. Later, make it provider-specific: each provider can optionally implement an `audit()` method.

### Q: How do we handle authentication?
**A:** Each provider supplies its own auth router via `getAuthRouter()`. The main app mounts all provider auth routes. Session workspace objects store a `provider` field and generic `credentials` instead of Linear-specific token fields.

---

## Implementation starting point: Phase 1

Since Phase 1 is pure refactoring with no behavior change, it's the safest place to start. The steps:

1. Create `lib/providers/models.js` with canonical state constants
2. Create `lib/providers/state-map.js` with `getStateDisplay()`, `isCompleted()`, `isInProgress()` etc.
3. Refactor `lib/tree.js` — replace 15+ hardcoded state comparisons with helper calls
4. Refactor `lib/render.js` — replace state switch in `renderNode()` with `getStateDisplay()`
5. Refactor `lib/prompt-formatters.js` — replace `state?.type === 'completed'` etc.
6. Refactor `lib/linear.js` — have `fetchProjects()` normalize state into canonical shape before returning
7. Run full test suite to confirm no behavior change
