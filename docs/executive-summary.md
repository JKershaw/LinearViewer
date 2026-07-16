# Harbour — Executive Summary & Technical Analysis

## What It Is

Harbour is a server-rendered web application that presents Linear project management data as a collapsible, CLI-aesthetic tree. It serves two audiences:

1. **Human users** — browse projects and issues in a terminal-styled UI, generate context-rich prompts for AI coding agents, and dispatch those prompts to a queue.
2. **AI agents** — consume dispatched prompts via a polling API, provide feedback, and query Linear through the token-scoped workspace API proxy.

The app runs on Express with no frontend framework or build step. All HTML is generated server-side; the client handles only collapse/expand state (persisted in localStorage) and async actions like prompt fetching and dispatch.

---

## Core Capabilities

### 1. Issue Tree View

Linear projects and issues are fetched via GraphQL and rendered as a nested tree with box-drawing characters. Three sections partition the view:

| Section | Content |
|---------|---------|
| **In Progress** | All in-progress issues across projects, with ancestor context |
| **Recent Activity** | Completed in the last 7 days |
| **Projects** | Full project trees with incomplete/completed partitioning |

Each issue node is expandable: clicking reveals description, metadata (assignee, estimate, due date, labels), and — critically — **prompt action buttons**.

### 2. AI Prompt System (Two Independent Paths)

This is the system most relevant to the planned follow-on prompts feature.

#### Path A: Handwritten Templates

14 deterministic templates defined in `lib/prompt-template-defs.js`, invoked via `lib/prompt-templates.js`:

| Category | Templates | Trigger |
|----------|-----------|---------|
| Pre-work | (label-gated) | Issue has specific label |
| Work-Issue | `blocked`, `bug` | Issue has `blocked`/`bug` label |
| Ready | `plan`, `code-review` | Issue in backlog/unstarted/started state |
| Universal | `look-into`, `triage`, `breakdown`, `research`, `scoping`, `design`, `spike`, `context`, `implementation`, `review` | Always available |

Each template receives rich context from Linear (parent task, siblings, children with status, project info including repo URL, comments) and respects feature flags (`linearMcp`, `featureBranches`, `codeReview` sub-toggles). Output is a structured prompt with header, context sections, workflow steps, and completion signals.

Formatting helpers in `lib/prompt-formatters.js` produce consistent sections across templates: git workflow instructions, self-review checklists, CI/CD checks, subtask summaries.

#### Path B: AI-Generated Recommendations

An LLM (via OpenRouter) receives a **meta-prompt** (`lib/prompts/meta-prompt-template.js`) that encodes a decision tree:

1. Does the task need preparation/research?
2. Are there blockers or bugs?
3. Is planning needed, or is it ready for implementation?

The meta-prompt includes all 14 template definitions (with `aiHint` metadata: situation, goal, workflow) so the LLM can select the most appropriate one and generate a tailored prompt.

**Two-tier context mode** (for parent tasks with subtasks): the meta-prompt receives both a parent overview (all subtasks at a glance) and focused context for the recommended next subtask.

**Delivery**: Non-streaming (`/api/recommend/:issueId`) or SSE streaming (`/api/recommend/:issueId/stream`) with a `StreamingSectionParser` that handles `## Reasoning` / `## Prompt` section boundaries across chunk splits.

#### How Both Paths Surface in the UI

When a user expands an issue, `renderDetails()` in `lib/render.js` produces:

- **Prompt buttons row**: AI suggest + default prompts + custom prompts + "more" overflow
- **Prompt container**: displays the generated prompt with copy, dispatch (cli/web/dash), and proxy toggle actions
- **Recommendation container**: streams AI reasoning + prompt in real-time

### 3. Dispatch System (Queue + Consumer Pattern)

Prompts become actionable via a dispatch queue:

```
User generates prompt → Dispatches to queue → Consumer polls → Claims atomically → Processes → Posts feedback
```

**User-facing API** (session auth, workspace-scoped):
- Queue/list/remove items, view history, manage tokens

**Consumer API** (Bearer token auth):
- `GET /api/dispatch/poll` — non-destructive list of available items
- `POST /api/dispatch/take/:itemId` — atomic claim (find-and-delete + archive)
- `POST /api/dispatch/feedback/:itemId` — append-only feedback (ownership-enforced)

Each dispatched item carries: prompt text, prompt name, issue metadata (id, identifier, title, URL), target (cli/web/dash), and optional repo. Items expire after 24 hours; history retained 30 days.

**Token security**: consumer tokens are 32-byte random values; only SHA-256 hashes are stored. Plain text shown once at creation.

### 4. Feature Toggle System

10 toggles stored account-owned (keyed by accountId in `lib/user-preferences.js`), mirrored
into session per-request and synced to MongoDB for cross-device persistence (LIN-1331):

| Toggle | Default | Effect |
|--------|---------|--------|
| `aiRecommendations` | on | AI suggest button + recommendation streaming |
| `promptButtons` | on | Prompt buttons row visibility |
| `dispatch` | **off** | Dispatch queue UI + API |
| `proxy` | **off** | Proxy token toggle + API |
| `linearMcp` | on | "in Linear" hints in prompts |
| `featureBranches` | off | Git branch-per-task workflow in prompts |
| `codeReview` | off | Nested sub-toggles: self, CI/CD, PR |

---

## Architecture At a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│                        Express Server                           │
│                                                                 │
│  Routes:                                                        │
│    auth.js ─────── Linear OAuth 2.0                             │
│    openrouter-auth.js ── OpenRouter PKCE                        │
│    workspace.js ── Dashboard, settings, pages                   │
│    workspace-api.js ── Prompts, recommendations, comments       │
│    dispatch.js ──── Queue, tokens, consumer API                 │
│                                                                 │
│  Rendering (server-side HTML):                                  │
│    render.js ──────── Issue tree + prompt UI                    │
│    render-settings.js ── Feature toggles                        │
│    render-dispatch.js ── Queue management page                  │
│    render-prompts.js ─── Template catalog                       │
│                                                                 │
│  Core Libraries:                                                │
│    linear.js ─────── GraphQL client (issues, context)           │
│    openrouter.js ──── LLM client (streaming + non-streaming)    │
│    prompt-templates.js ── 14 handwritten templates              │
│    meta-prompt-template.js ── AI decision tree                  │
│    dispatch-store.js ── Queue + history (MongoDB/MangoDB)       │
│    dispatch-tokens.js ── Consumer token management              │
│    feature-defaults.js ── Toggle definitions + helpers          │
│                                                                 │
│  Client (vanilla JS, no framework):                             │
│    app.js ────── Collapse/expand, localStorage state            │
│    dispatch.js ── Prompt dispatch, queue polling, tokens        │
└─────────────────────────────────────────────────────────────────┘
```

**Storage**: MongoDB in production, MangoDB (file-based) in development. Six independent stores: sessions, user preferences, custom prompts, dispatch queue, proxy tokens, free tier usage.

**Authentication layers**:
- Session-based (Linear OAuth) for all user routes
- Bearer token for consumer dispatch API
- Bearer token for the workspace API proxy

---

## Integration Points Relevant to Follow-On Prompts

The planned feature — **follow-on prompts triggered by Claude Code** — would extend the existing prompt → dispatch → consumer → feedback loop. Here are the key integration surfaces:

### Where Prompts Are Generated

| Component | File | Role |
|-----------|------|------|
| Template definitions | `lib/prompt-template-defs.js` | 14 prompt templates with `aiHint` and `completionSignals` |
| Template engine | `lib/prompt-templates.js` | `generatePrompt()` entry point, availability rules |
| Formatting helpers | `lib/prompt-formatters.js` | Shared section formatters |
| Meta-prompt | `lib/prompts/meta-prompt-template.js` | AI decision tree for recommendation |
| OpenRouter client | `lib/openrouter.js` | LLM API calls (streaming + non-streaming) |

### Where Prompts Are Consumed

| Component | File | Role |
|-----------|------|------|
| Dispatch queue | `lib/dispatch-store.js` | FIFO queue with atomic take |
| Consumer API | `routes/dispatch.js` | Poll, take, feedback endpoints |
| Feedback model | `lib/dispatch-store.js` → `addFeedback()` | Append-only feedback on completed items |

### Where Context Is Fetched

| Function | File | Used By |
|----------|------|---------|
| `fetchIssueContext()` | `lib/linear.js` | Handwritten prompts |
| `fetchRecommendationContext()` | `lib/linear.js` | AI recommendations (two-tier parent/subtask) |
| `parseRepoFromDescription()` | `lib/linear.js` | Extracts repo URL from project descriptions |

### Completion Signals (Already Defined)

Each template in `prompt-template-defs.js` includes a `completionSignals` object describing how to verify work is done. This is a natural hook point — a follow-on prompt system could evaluate these signals to determine what comes next.

### Dispatch Item Metadata

Each queued item already carries:
- `issueId`, `issueIdentifier`, `issueTitle`, `issueUrl` — issue traceability
- `promptName` — which template was used
- `target` — intended consumer (cli/web/dash)
- `repo` — target repository
- `feedback` — array of consumer responses

This metadata could drive follow-on logic: "the `plan` prompt was completed → now dispatch `implementation`."

### Feature Flags

The toggle system (`lib/feature-defaults.js`) provides a clean mechanism to gate the follow-on feature behind a new flag, consistent with how `dispatch` and `aiRecommendations` are gated today.

---

## Design Constraints & Principles

Any addition should respect:

1. **No frameworks, no build step** — vanilla JS, ES modules, server-rendered HTML
2. **CLI aesthetic** — monospace font, box-drawing characters, minimal color palette
3. **Two prompt paths must stay in sync** — changes to prompt behavior must update both handwritten templates and the AI meta-prompt
4. **Workspace isolation** — all data is scoped by workspace URL key
5. **Security model** — session auth for users, bearer tokens for consumers, hashed storage for secrets
6. **Feature gating** — new capabilities behind toggles, off by default for disruptive features
7. **Rate limiting** — all public endpoints have per-IP throttling; free tier has usage caps

---

## Summary

Harbour transforms Linear project data into an opinionated, AI-agent-friendly workflow tool. Its prompt system (handwritten templates + AI recommendations) generates context-rich coding prompts. Its dispatch system queues those prompts for external consumers. Its feedback loop closes the circle.

The architecture is deliberately simple — server-rendered HTML, vanilla client JS, no build tooling — which makes it straightforward to extend. The existing `completionSignals`, dispatch metadata, and feedback model provide natural hooks for a follow-on prompt system that chains prompts based on completed work.
