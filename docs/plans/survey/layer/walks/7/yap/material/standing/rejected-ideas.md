# Rejected and reframed ideas

A living log of feature requests that got proposed and didn't make it in — or got reframed into something smaller. This exists so the reasoning doesn't have to be re-derived every time a similar idea comes up.

The goal isn't to be defensive. Most of these are good ideas. They're just not yap ideas.

---

## Moderation system with admin users and roles

**Proposed:** Admin username and password via env var, admin tools to delete messages and block accounts, per-role permissions.

**Reframe:** The underlying concern — "what happens when someone posts something awful on the hosted instance?" — is real. The solution isn't a user/role system, because yap doesn't have users. It's a single admin token and one or two endpoints.

**What we'll do instead:** Optional `YAP_ADMIN_TOKEN` env var. Two endpoints: `POST /admin/purge` to drop messages from a buffer, `POST /admin/block` to prevent a nick from joining (ephemeral, lost on restart — consistent with everything else). No admin user concept, no login, no UI. Curl-only.

**Why this is enough:** Self-hosted instances don't need moderation. The hosted instance has `YAP_PASSWORD` as its primary gate. If yap gets abused at a level where a token and two endpoints aren't enough, the right move is taking the public URL down, not building a moderation product.

---

## Server settings page

**Proposed:** Web UI for toggling features on and off, adjusting rate limits, configuring formatting rules.

**Reframe:** Env vars already are the settings system. They're documented in the README, they're simple, and changing them requires a restart — which for an in-memory ring buffer loses nothing important.

**What we'll do instead:** Nothing. The README is the settings UI.

**Why:** A settings page implies the server has state worth persisting across restarts, which it doesn't. It also implies an admin concept that doesn't exist. Adding both to support a UI is backwards.

---

## Plugin system (fetch plugins from GitHub URLs on load)

**Proposed:** Admin can add plugin GitHub URLs, server fetches and loads them at boot, plugins can register tools and UI elements.

**Reframe:** The motivating question is "how do people extend yap?" The answer already exists: reactive agents. An agent is a nick that joins a channel and does something when tagged. That's the plugin system. It runs out-of-process, has no access to server internals, can't crash the server, and doesn't require yap to become a code loader.

**What we'll do instead:** Ship example reactive agents in the repo. Make it trivial to write new ones. Document the pattern.

**Why we won't build the plugin system:** "Fetch and execute code from a URL" is remote code execution. Every plugin system starts simple and becomes the majority of the project's complexity within a year. Most of what plugins would do is better done as agents. The ones that aren't — things that need access to server internals — are things we don't want third parties touching anyway.

---

## User settings (stored server-side)

**Proposed:** Per-user preferences for nick color, notification settings, default channel, etc.

**Reframe:** None of these need server state. Nick color is a rendering choice (client). Notifications are a client feature. Default channel is a cookie.

**What we'll do instead:** Client-side storage for anything user-specific. The web UI uses cookies or localStorage.

**Why:** yap has no user accounts, which means there's nowhere to attach server-side user state. Adding accounts to support settings is exactly the kind of cascade we avoid.

---

## Agent/MCP call indicator (icon next to agent messages)

**Proposed:** Visual indicator in the UI showing which messages come from agents vs humans.

**Reframe:** This is a pure rendering concern. The server already exposes everything the UI needs — nicks with profile descriptions are (typically) agents; nicks without are (typically) humans.

**What we'll do instead:** The web UI can show a small icon next to any nick that has a `whois` description. Zero server changes needed.

---

## Custom text formatting rules

**Proposed:** Server-side configuration for how text is rendered — markdown support, link detection, syntax highlighting, etc.

**Reframe:** The protocol is plain text. Rendering is a client concern. Different clients can render differently.

**What we'll do instead:** The reference web UI can render markdown and links if we want. Other clients decide for themselves.

---

## Template for future entries

When adding to this log, keep entries short. The pattern:

**Proposed:** What someone asked for, in one or two sentences.

**Reframe:** What underlying need is really being expressed, and which of the three categories (client concern, reactive agent, env var) it fits into.

**What we'll do instead:** The minimal thing that addresses the real need.

**Why:** One or two sentences on the principle being preserved.

If an entry resists this template — if the real need can't be reframed and the minimal response doesn't exist — that's a signal the request might actually belong in yap. Most don't.
