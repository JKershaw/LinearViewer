# Harbour

A minimal, CLI-aesthetic web app — a provider-agnostic control plane for AI-augmented
software development. It started as a read-only Linear projects/issues tree viewer and grew
into a cockpit that reads any issue backend, generates grounded prompts, dispatches them to
AI agents, and verifies the work on real evidence.

> **Naming: Harbour vs Harbour OS.** **Harbour** is this product (the cockpit/control plane).
> **Harbour OS** is John's separate in-browser workstation that Harbour can *dispatch* agent
> sessions into (the `local` dispatch target; see `lib/harbour-spawn.js`). They are
> parent/child like Apple/macOS — always write the workstation as **Harbour OS** in full.
> The `local` target name and the `HAR-` eval fixtures (a separate Harbour OS Linear
> workspace used as test data) refer to the workstation, not the product brand — leave them
> as-is.

## Commands

- `npm run env:check` - Verify environment is ready (runs automatically via Claude Code hook)
- `npm install` - Install dependencies
- `npx playwright install` - Install Playwright browsers (first-time setup)
- `npm start` - Start the server (runs on PORT from .env, default 3000)
- `npm test` - Run all tests (unit via `node --test tests/unit/*.test.js`, then Playwright E2E)
- `npm run test:unit` - Run unit tests only (`node --test tests/unit/*.test.js`)
- `npm run test:ui` - Run Playwright tests with the Playwright UI

## Architecture

Map of the source tree. Per-page assets and feature modules are grouped by the
surface they serve; a handful of small helpers may not be listed individually.

```
server.js              Express server, main entry point, dashboard routes
routes/
  auth.js              Linear OAuth routes
  github-auth.js       GitHub App login/binding routes (GET /auth/github, GET /auth/github/callback, POST /auth/github/link; landing + settings add-source entry points share the routes via session `mode`; LIN-541/703)
  openrouter-auth.js   OpenRouter OAuth PKCE routes
  workspace.js         Workspace management routes
  dispatch.js          Dispatch queue API (user + consumer endpoints)
  proxy.js             Linear API proxy (token auth, read/write endpoints, cycles, labels, task automation)
  collective.js        Collective experiment (experimental): page, multi-workspace dispatch fan-out, Yap state/say proxy (LIN-450)
  dashboard.js         Autopilot Observation page (first-class, LIN-595): /observation page + sessionId-grouped sessions feed + merged cross-workspace Loop feed, on-demand run-/session-summary, session-context, lazy Linear hydration (LIN-509). /dashboard 302s to /observation; data endpoints keep their /api/dashboard/* paths. Also the dedicated per-session page GET /observation/session/:sessionId (LIN-1003): server-rendered snapshot via the NON-lean getSessionsForWorkspace read (the lean point-read drops feedback[]) + a cache-only brief/recap join over distinct loop.issueId UUIDs, rendered by lib/render-session.js; 404s an unknown/cross-workspace sessionId
  workspace-api.js     Workspace API routes (prompts, recommendations, audit, comments, images)
  task-chat.js         Task-chat view (experimental, taskChat flag): per-task conversational page + durable saved-chat CRUD under /api/task-chat/saved (LIN-1008): save/list/get/delete gated on the taskChat flag AND req.session.accountId (absent → 401, no fabricated id); the literal /saved routes are registered BEFORE /:issueId so Express doesn't misroute `saved` as an issue id; session-auth only
  task-edit.js         Dedicated task-edit page (LIN-1565): GET /workspace/:urlKey/task/:issueId/edit, the drill-down that replaced the inline edit form formerly hidden inside a tree row's collapsed Details panel. NOT a view-tier member — no feature flag, no EXPERIMENTAL_VIEWS entry, no nav/footer link; gated only on the provider's ui.inlineEdit (read off ui.*, never supports()), which redirects to the dashboard (not Settings) when false. :issueId takes a UUID or an identifier with no resolver hop. Read + render only: it owns no write path, submitting instead to the unchanged PATCH /workspace/:urlKey/api/issues/:issueId. The state <select> is sourced from provider.states(), capability-gated AND try/caught to [] so the page degrades to a text input rather than 500ing
  next-run.js          Suggested-next-run view (experimental, nextRun flag): page + suggest endpoint that generates grounded goal options for the next autopilot run; accept hands the chosen goal to the dispatch launch path (LIN-603)
  live-console.js      Live Console view (experimental, liveConsole flag): ambient "watch the swarm" page + generation-free events endpoint (GET /api/live-console/events) merging TWO cross-workspace sources — the agent-status feed (stream) and lean dispatch loops (working lanes w/ latest heartbeat + [evidence] events + tempo) — shaped via lib/live-console.js; `?before=<ts>&limit=` returns an older status history page (view-more); poll spends no LLM call (LIN-1436)
  test.js              Test-only routes for E2E tests (mock sessions, fixtures)
  legacy-redirects.js  Backward-compatible redirects for old URLs
lib/
  linear.js            GraphQL client for Linear API
  linear-fetch.js      Resilient fetch for the Linear GraphQL boundary (retry/timeout)
  bash-tool.js         Safe bash executor with data/code separation (stdin + argv modes)
  tree.js              Transforms flat issues → nested tree structure (frontier ranking in selectFocusSubtask)
  graph-features.js    Network-free blocking-graph / critical-path primitives (shared by swipe + frontier ranking)
  context-graph.js     Network-free relationship-neighborhood builder for the Context section (blockers/blocked/parent/children/related; LIN-572)
  openrouter.js        OpenRouter API client for AI recommendations
  openrouter-catalog.js  Live OpenRouter model catalog (LIN-1111): in-process TTL-cached wrapper over GET /api/v1/models, mocked in tests via the same `shouldMockAi` predicate that gates the AI recommendation mock; supplements (never replaces) the static DISPATCH_MODEL_SUGGESTIONS datalists in public/common.js + lib/render-settings.js, consumed server-side by Settings and client-side via GET /workspace/:urlKey/api/openrouter/models (routes/workspace-api.js) — one shared source of truth for both surfaces
  providers/           Provider abstraction (decouples views from Linear specifics)
    interface.js       Provider interface contract
    registry.js        Provider registry
    models.js          Canonical state model
    state-map.js       Maps provider states → canonical model
    linear/index.js    Linear provider adapter
    local/index.js     Local provider adapter (writable, Mongo/Mango-backed; LIN-356)
    github/index.js    GitHub provider adapter — the abstraction's first foreign backend (+ client.js, fake-client.js; LIN-178)
    github-projects/index.js  GitHub Projects v2 provider — additive sibling to GitHub Issues (own GraphQL client.js + fake-client.js; read-only V1; board Status→canonical heuristic; LIN-560)
  render.js            Dashboard page renderer (tree view, sections)
  render-pages.js      Standalone page renderers (login, error, workspace-not-found)
  render-landing.js    Bespoke unauthenticated home showcase (LIN-980): Harbour top area (hero + loop) + fake-data glimpses of real surfaces (observation feed, swim board, grounded prompt) + providers strip + distinct Harbour OS section; composes D's shared nav (renderNavBar isLanding); NOT the project-tree renderer. Styles in public/landing.css
  render-audit.js      Operator dashboard page renderer
  render-settings.js   Settings page renderer
  render-prompts.js    Prompts catalog page renderer
  render-custom-prompts.js  Custom prompts page (/prompts/custom) renderer
  render-dispatch.js   Dispatch page renderer (prompt, queue, tokens, history)
  render-collective.js Collective page renderer (experimental discussion shell)
  render-observation.js Autopilot Observation page renderer (first-class; mobile-first feed shell + collapsible completed archive, Swipe-modeled; LIN-595)
  render-session.js    Dedicated per-session page renderer (LIN-1003, Phase 1 of LIN-950): server-rendered snapshot on the shared shell — overview, per-run telemetry/timings, raw link-rich transcript (loop.feedback[]), and cache-joined brief/recap panels (present body OR explicit generate affordance on a miss; never auto-spends an LLM call); telemetry.model rendered only when present. Phase 2 (LIN-1004): renders the human follow-up reply box (renderReplyBox) at the bottom for cli/web sessions, threading data-session-terminal so the scoped session.js sends force only for finalized sessions. LIN-1298: the reply box + per-run inline replies now compose the shared chat.css conversational UI (composer + client-filled "you" echo thread) — restyle only, wire/force behaviour unchanged
  render-roadmap.js    Roadmap page renderer (delivery-focused)
  render-ship.js       Ship page renderer (radial view shell)
  render-swim.js       Swim lanes page renderer
  render-swipe.js      Swipe page renderer (mobile-first task swipe)
  render-task-chat.js  Task-chat page renderer (experimental; per-task conversational shell)
  render-task-edit.js  Dedicated task-edit page renderer (LIN-1565): the four v1 fields (title/description/state/priority) on the shared shell, plus the not-found body for an unknown/cross-workspace id. The state control has two branches — a real <select> when the route supplied states, the pre-existing free-text input when it did not — carrying the same name and data-testid either way. Option `value` is the state id when it is a UUID (Linear, which short-circuits resolveIssueStateRef's symbolic path and its ambiguous-name 422) and the state NAME otherwise (Local/GitHub, byte-identical to what the old inline form sent). renderPage's `title` and renderPageHeader's `titleHtml` are raw by contract, so the user-controlled issue title escapes at the call site (the 8aa32eaf sink). Description carries a Write/Preview toggle (LIN-1575): the textarea remains the sole edited/submitted value (stored format stays provider Markdown, never HTML) — Preview just renders it read-only via the already-vendored marked + DOMPurify pair (public/common.js's `window.renderMarkdown`, loaded here same as render.js/render-session.js/render-swipe.js), so the feature adds no new dependency and no new failure mode (a failed script load only flattens Preview to escaped text, per renderMarkdown's own fallback). The toggle is a REAL ARIA tablist — `role="tablist"` on the container, `role="tab"` + `aria-controls` on each button — the same pairing render-observation.js uses for the app's only other tab pair. `aria-selected` alone on a bare `<button>` is dropped by the UA, so the active tab was never announced; do not re-simplify it back to that
  render-next-run.js   Suggested-next-run page renderer (experimental; goal-option cards shell + the empty direction-chooser mount point above them, LIN-603/LIN-1566, plus the empty `#next-run-degraded` notice mount above both — reusing `.next-run-warning`, filled from the response's `degraded` flag, LIN-1665)
  render-live-console.js  Live Console page renderer (experimental; ambient shell — status banner + tempo sparkline, swimlane timeline mount points (last-24h bars viewport, zoomable/pannable; LIN-1742 Phase 1 + LIN-1743 Phase 2 of LIN-1720), pulse-lane rail, activity stream mount points; all motion/data/gestures in public/live-console.*; LIN-1436)
  next-run.js          Suggested-next-run goal-option generator (experimental): deterministic roadmap-model grounding → LLM → goal paragraphs with reasoning + t-shirt size, always plus a continue-until-stopped option (empty goal); NOT a recommendation seam, so exempt from the both-paths parity rule (LIN-603). Options are additionally grouped under named **directions** (LIN-1566) — a per-option `direction` tag plus a derived `directions: [{name, summary, optionIndexes}]`, resolved by the exported pure `resolveDirections` which routes/next-run.js's mock calls too (shape parity is load-bearing: the mock is the only response e2e sees). The flat `options` array stays authoritative, so `ensureSizeCoverage` / the id-grounding filter / `attachReferencedTaskTitles` are untouched — the tag rides their spreads, so do NOT "tidy" any of them into explicit field lists. Resolve LAST, after size coverage (fills carry no direction and only exist then); `directions: []` = no usable grouping → the flat list. Three things collapse to that empty result, all deliberately: nothing declared, nothing matching a declared name, and a grouping that survives as fewer than TWO directions — a lone chip filters nothing, so a chooser is only rendered when there is something to choose between (one declared name + a populated catch-all IS a real choice and is kept). S/M/L coverage stays GLOBAL, never per-direction, and continue-until-stopped is in no direction. "Direction", never "theme" — that word is taken by page theming and the roadmap narrative layer. The model call uses a bare `max_tokens` cap of 4000 — no `reasoning` field is sent (live evidence on gpt-5.4-mini showed sending it switches reasoning ON in a model that otherwise spends zero, and OpenRouter does NOT honour the field as a cap; raising the bare cap fixes the failing model while no-opping the default path). Zero PARSED options (assessed before the fills, by the exported pure `assessNextRunOutcome`, mirroring ship-biscuit's `assessEditorOutcome`) now sets a `degraded: {reason, truncated, finishReason}` on the response — `null` when healthy — because the fallback is otherwise indistinguishable from a successful ungrouped generation: same 200, same four cards, same "generated with <model>" caption. Degrading is still the behaviour — it never throws, and the fills + continue-until-stopped are preserved — it is just no longer silent
  live-console.js      Live Console data layer (experimental): pure, generation-free transform from { statusItems (agent-status), loops (lean dispatch loops) } → { events (status steps + [evidence] artifacts, newest-first, paginated via a before-cursor), lanes (running loops w/ latest heartbeat; status-working fallback; lanes idle beyond `laneStaleMs`, default 1h, are dropped so sessions stuck 'running' fall off the feed), tempo (event + heartbeat-rate buckets), pulse (heartbeat-only fine-grained density + serverNow anchor, for the flowing strip), timeline (LIN-1742, Phase 1 of LIN-1720: `buildTimeline` derives the last-24h flat run list — window-overlap filtered on the run's own activity not just `dispatchedAt`, left-edge-clipped never dropped, capped at 500 w/ truncation disclosure, sharing the SAME `laneStaleMs` knob as lane-dropping — then `packTimelineRows` packs it into non-overlapping display rows grouped by session lineage, with `followUpTo` connector edges), summary (fleet totals), hasMore/oldestTs }; tolerant/deterministic (`now` injected), accepts a bare status array for back-compat, same discipline as session-telemetry.js (LIN-1436)
  timeline-zoom.js     Live Console timeline zoom/pan primitives (pure; LIN-1743, Phase 2 of LIN-1720): `computeTimelineZoom`/`computeTimelinePan` share `computeFitZoom`'s pure-function shape (`ship-layout.js:847`) and Ship's focal-point contract (`public/ship.js`'s `setZoom`) — the window is `{startMs, endMs}` (re-layout via a time-scale, never CSS `transform: scale()`), clamped to the fixed `[nowMs - maxSpanMs, nowMs]` axis both functions and the 1h/24h presets share. Mirrored on `window` in `public/common.js`, same pattern as `computeFitZoom`. Kept generic on purpose so LIN-1505 can adopt this contract rather than fork it. Also exports `timelineRunOverlapsWindow(run, windowStart, windowEnd, nowMs)` (LIN-1743 review F1): the shared "does this run belong on screen at the current zoom" test — public/live-console.js's `updateTimelineBarNode` uses it to CULL a run lying entirely outside the current view window (never just clamp it to an edge sliver), and its own empty-state check uses the SAME test so the two questions can't disagree.
  credential-state.js  Per-session credential DISPLAY state (LIN-1588, Beat 2 of LIN-1577). NOT the credential rule — that is Beat 1's `credentialVerdict`/`listCredentialHealth` in lib/proxy-events.js, reused by CALLING it, never forked or extracted. This is the step downstream: `resolveCredentialState(agentTokenId, index)` → `dead|ok|unknown`, plus `foldCredentialIndex` (Beat 1's token rows → a `tokenId → verdict` index; `credential_dead` wins a collision) and `collectAgentTokenIds` (the empty-set short-circuit both routes use to SKIP the read entirely — the ~99.86% path per LIN-1585, which is why the Live Console poll's cost contract is unchanged). Shared by the Live Console lane (lib/live-console.js) and the session page (lib/render-session.js) so "what does a missing token mean" cannot diverge between the two surfaces. Pure and store-free by design: the ROUTES do the async read and inject the index, keeping lib/live-console.js pure/network-free/`now`-injected. Two `unknown` branches are load-bearing and must not be relaxed — a null `agentTokenId` is the ORDINARY case, and a token with no recent events resolves to `unknown`, NEVER a false `ok` (`ok` itself is weak: "no death evidence in 15 min", not "verified healthy"). `agentTokenLabel` is display-only — shared across concurrent sessions and mixed with historical `'exchanged'` rows — so it never keys, groups, or joins anything
  render-styleguide.js Styleguide page renderer (component/style reference; LIN-457)
  render-proxy.js      Proxy token management UI
  render-legal.js      Privacy Policy / Terms of Service renderers
  render-kpis.js       Public /kpis instance stats page renderer
  kpi-stats.js         Instance KPI aggregation (privacy boundary for public /kpis)
  pipeline-loops.js    Pipeline loop reconstruction library
  sessions-view.js     Adapts pipeline Loop records into the sessions view
  observation-sessions-store.js     Durable store for materialized Observation session groups
  observation-sessions-materializer.js  Materializes sessionId-grouped Observation sessions from Loop records
  sessions-feed-cache.js  Cache for the merged cross-workspace Observation sessions feed
  roadmap.js           Roadmap deterministic layer (velocity, execution order, milestones)
  ship-layout.js       Ship view layout primitives (pure)
  swim-lanes.js        Swim lane assignment algorithm
  swim-graph.js        Swim dependency-graph model (flow / side-rail view)
  prompt-templates.js  Prompt template query functions and main entry point
  prompt-formatters.js Shared formatting helpers for prompt templates
  prompt-template-defs.js  Prompt template definitions (14 templates)
  completion-signals.js  Completion signals for prompt assessment
  custom-prompts-store.js  Custom prompt template storage (per workspace)
  collective-characters-store.js  Collective character (persona) storage (LIN-1048): mirrors custom-prompts-store (Mongo/Mango, UUID, per-anchor-urlKey partition); each record carries its own repo binding (workspaceUrlKey, re-validated at dispatch, NO stored proxy token) + the five persona fields; two kinds — `custom` (capped 20, throw on overflow) and `recent` (auto-recorded per /start dispatch, rolling 10, evict-oldest, never throw); identity = binding+persona, so saving a recent promotes it to custom in place and a dispatched saved character is not double-listed
  prompts/
    meta-prompt-template.js  Meta-prompt for AI recommendation generation
    autopilot-kickoff.js     Autopilot kickoff briefing template
    autopilot-manual.js      Autopilot operating manual ("handbook")
    collective-participant.js  Collective discussion participant prompt (experimental, LIN-450)
    task-chat-template.js    Task-chat conversational prompt (experimental, taskChat)
    roadmap-*.js             Roadmap narrative-pipeline templates (orientation,
                             trajectory, north-star, product, gap, narrative, digest, chat)
  recap.js             Task recap prompt + response handling
  recap-cache.js       Hash-based cache for AI recaps
  run-summary.js       On-demand short summary of a single autopilot run (Loop); mirrors recap.js (LIN-509)
  run-summary-cache.js Cache for AI run summaries, keyed ${workspaceId}:${loopId}, 30-day TTL (LIN-509)
  session-summary.js   On-demand summary of a whole autopilot session (sessionId group) prompt + handling (LIN-592)
  session-summary-cache.js  Cache for AI session summaries (LIN-592)
  dispatch-terminal.js Terminal-marker detection for dispatch runs ([done]/[failed]/… feedback → terminal status); shared by proxy watch endpoints + dashboard Loop feed (LIN-400/LIN-509)
  session-telemetry.js Pure read-only telemetry parser over loop feedback[] → { runtime, metrics[], producedArtifacts[], model? }; runtime from dispatchedAt→completedAt (terminal duration cross-check only), heartbeat + [evidence] parsing, model omitted until runner emits it; attached per-run/per-session in pipeline-loops (LIN-594)
  brief.js             Current-state task brief prompt + handling
  brief-cache.js       Hash-based cache for AI briefs
  description-edit.js  Pure splice helpers for partial issue-description edits
  trashed-signal.js    Trashed-issue (soft-delete) signal detection (LIN-401)
  recommend-recurse.js Server-side recommendation recursion (defer routing)
  recommendation-facts.js  Deterministic, network-free per-node fact assembly (assembleNodeFacts) — single fact seam for both prompt paths
  session-store.js     MongoDB/MangoDB session store
  user-preferences.js  Cross-device preference storage (MongoDB)
  workspace-preferences.js  Workspace-level preference storage
  workspace.js         Multi-workspace session management helpers
  local-store.js       Local provider's issue/project store (scope-partitioned collection)
  dispatch-store.js    Dispatch queue storage
  dispatch-tokens.js   Consumer API token management
  agent-status-store.js  Agent status append-only log storage (Tier C substrate; loop reconstruction; canonical proxy path /agent/status, /foreman/status deprecated alias)
  report-history-store.js  Durable per-workspace roadmap report runs
  task-snapshot-store.js   Append-only task-history archive: full issue-slice snapshots captured (hash-gated) at the proxy recap/brief read seams; durable, per-task count-capped, read-time diffs (LIN-598)
  saved-chat-store.js  Durable saved task-chat transcripts (LIN-1008): private per {urlKey, accountId}, `{role,content}` transcript + auto-derived title, durable/count-capped (no TTL), hard-delete. Composes custom-prompts CRUD + task-snapshot durability + prompt-trace's session-auth-only privacy posture (content-bearing → deliberately NOT wired into proxy/workspace-api/kpis)
  llm-call-log.js      Append-only per-LLM-call metadata log (model, provider, tokens, cost, time; LIN-418)
  prompt-trace-store.js  Prompt trace storage (LIN-578)
  free-tier-store.js   Free tier usage tracking and rate limiting
  proxy-tokens.js      Proxy token hashing and validation
  proxy-events.js      Proxy event audit logging
  proxy-fetch.js       Proxy-aware fetch for HTTP_PROXY environments
  proxy-wire.js        Wire-contract neutralization for the consumer proxy (source-neutral shapes; LIN-310)
  proxy-dedupe.js      Short-window dedupe for non-idempotent proxy creates (LIN-399)
  periodicals.js       Periodicals registry (scheduled task generation)
  queue-config.js      Maps internal queue model → Linear states/labels
  workflow-config.js   Centralized workflow label configuration
  harbour-spawn.js     Spawns Claude Code sessions in Harbour OS (OSC escapes)
  harbour-feedback-tokens.js  Short-lived single-use feedback tokens for repo agents
  ownerless-token-policy.js  The one switch governing whether ownerless (`createdBy: null`) tokens are still tolerated (LIN-1447/1448): read by BOTH the broker-token mint (routes/dispatch.js) and bootstrap provisioning (lib/proxy-preamble.js) so the two seams cannot drift, and so neither route has to import the other. Ownerlessness is inherited (the exchange copies it; a worker holding an ownerless token mints its children ownerless too), which is why the policy is one value and not a per-site judgement. Fails safe: only an explicit off-value turns strictness on, because the host runner still authenticates with an ownerless pre-LIN-1397 token and must be re-issued first
  yap-client.js        Thin server-side HTTP client for the Yap chat server (Collective; channel/nick helpers)
  audit.js             Workspace audit module (computes audit report from Linear)
  feature-defaults.js  Feature toggle keys, defaults, and helpers
  token-refresh.js     Linear OAuth token refresh
  http-keepalive.js    Defuses Heroku H12 30s router timeout on long handlers
  errors.js            Error response helpers
  parse-landing.js     Parses markdown content for landing page
  deploy-info.js       Footer deploy info (LIN-1385): neutral DEPLOY_* env vars first, RAILWAY_GIT_COMMIT_SHA fallback for commit; version/createdAt have no Railway analog and stay null unless DEPLOY_VERSION/DEPLOY_CREATED_AT are set
  utils/html.js        HTML utility functions
  components/
    navbar.js          Nav bar with workspace/team selectors, queue badge
    footer.js          Footer with deploy info, AI status
    landing-hero.js    Landing brand hero (anchor mark + wordmark + Linear/GitHub CTAs; GitHub gated on GITHUB_CLIENT_ID; LIN-726)
content/
  landing.md           Static projects preview for unauthenticated users
public/
  style.css            Light theme, mobile-responsive
  landing.css          Bespoke landing showcase styles (LIN-980); semantic-token-only so it is dark-safe under both .theme-dark and the landing's prefers-color-scheme remap
  app.js               Client-side collapse/expand, localStorage persistence
  common.js            Shared client utilities
  common-actions.css   Shared action/button styles
  feedback-widget.js / feedback-widget.css  Floating feedback widget (save/triage/autopilot actions; wired via render-settings.js + footer.js; LIN-635/704/918)
  llms.txt             AI agent guidance (DOM selectors, navigation patterns)
  marked.min.js        Vendored Markdown renderer
  purify.min.js        Vendored DOMPurify (HTML sanitizer)
  chart.umd.min.js     Vendored Chart.js (used by /kpis)
  audit.css / audit.js          Operator dashboard
  kpis.css / kpis.js            Public /kpis instance stats page
  settings.css                  Settings page
  prompts.css                   Prompts catalog page
  custom-prompts.css / .js      Custom prompts page
  dispatch.css / dispatch.js    Dispatch page (prompt, queue, tokens, history)
  collective.css / collective.js  Collective page (character picker, transcript poll, say box). The setup step is a character picker (LIN-1048): select saved custom + recent characters, or define a new one (pick a connected repo + fill the five persona fields + name, optionally save); /start posts `characters` (not `workspaceUrlKeys`) and view-prompt threads the selected character so preview matches dispatch
  observation.css / observation.js  Autopilot Observation page (sessionId-grouped sessions poll, status banner, workspace filters, Level-1 active feed + collapsible completed archive, Level-2 session cards with status pill / one-sentence summary / runtime+model / per-worker-run progress bar, Level-3 drill-down: tasks-touched + relationships (session-context) with lazy Linear hydration, per-task worker-session tree with phase/recap/metric-chips, per-node activity log + produced-artifact links + on-demand run-summary next steps; LIN-595). Every session card header carries a persistent `open ↗` link to the dedicated per-session page (LIN-1019), and a waiting-on-user card additionally carries a `reply →` CTA — both to `/workspace/:urlKey/observation/session/:sessionId` for the session's OWN workspace key (the feed is cross-workspace merged), giving the LIN-1004 reply box a click-path out of the feed's in-place expansion
  chat.css                      Shared conversational chat UI (LIN-1298): provider-neutral `.chat-*` primitives (thread + speaker-pill/surface message bubble + composer) extracted from the Task Chat idiom so it can be REUSED beyond the experimental Task Chat view. Semantic-token-only (dark-safe); composes the shared .status-pill/.surface chrome. First consumer: the session reply surface
  session.css / session.js      Dedicated per-session page (LIN-1003): server-rendered snapshot styling (overview / runs / transcript / brief-recap panels). session.js is the page's ONE scoped client script (LIN-1004): the human follow-up reply box — a self-contained textarea→POST to /api/dispatch with followUpTo=sessionId, target cli/web, and conditional force (terminal session → force:true, waiting/warm → omit); additive to the agent-to-agent wake path. The reply surface reuses the shared chat.css UI (LIN-1298): a chat composer whose sent reply is echoed as a conversational "you" bubble (renderStatusPill + renderSurface), so replying reads like a chat turn — UI-only, the real agent continuation still arrives on reload
  roadmap.css / roadmap.js      Roadmap page
  ship.css / ship.js            Ship radial view
  swim.css / swim.js            Swim lanes view
  swipe.css / swipe.js          Swipe (mobile) view
  task-edit.css / task-edit.js  Dedicated task-edit page (LIN-1565). The CSS is the FIRST styling in-app task editing has ever had — the inline form it replaces had zero rules anywhere in public/ and rendered as raw browser defaults; semantic-token-only so it is dark-safe, mobile-first, with a roomy description textarea. task-edit.js is the page's ONE scoped script: the form[data-inline-edit] submit branch lifted out of app.js's document-wide delegation (the page has a single form present at load, so no delegation is needed) and re-pointed to redirect back to the dashboard on success instead of reloading in place. LIN-1575 added the description Write/Preview tabs: `showPreview`/`showWrite` toggle `hidden` on the textarea vs. the `.task-edit-preview` div, rendering via `window.renderMarkdown` (common.js) — the textarea is never written to by the toggle, so submit always reads the raw Markdown the user typed regardless of which tab is showing (including a save made while Preview is the showing tab: a hidden control is still submitted). The preview's Markdown typography lives on `.task-edit-preview` itself and mirrors the dashboard's `.issue-description .desc-full-content` (lists/pre/blockquote/code/img). It first borrowed `.comment-body`, which styles p/code/a ONLY — do not point it back there: that made the pane render a description *less* faithfully than the surface it was previewing for, which is the LIN-1575 review's blocking finding. The local copy is deliberate — `.comment-body` has other consumers (app.js's comment list), so widening it would change them to fix this one pane; the real fix is a shared `.markdown-body` layer (`.desc-full-content` / `.swipe-accordion-body` / `.comment-body` each hand-roll a different subset today, and LIN-1032 is about to add a fourth), which is its own task. `table` is deliberately unstyled here, matching the dashboard — styling it would make the preview diverge from what it previews
  task-chat.css / task-chat.js  Task-chat view (experimental, taskChat flag); includes the saved-chats UI (LIN-1008): save button + Saved chats list with open(resume)/delete, re-hydrating a stored transcript into chatHistory and continuing via the unchanged replay-each-turn send() path
  next-run.css / next-run.js    Suggested-next-run view (experimental, nextRun flag): generate button + goal-option cards, above them a direction chooser (LIN-1566) — a wrapping single-select chip row (aria-pressed, click not hover; this file still has zero @media rules) that filters which goals are shown. Purely a display filter: card markup, the dispatched goal, and the dispatch path are identical to the ungrouped page, and continue-until-stopped is appended under every direction. Painting the chooser is split in two and the split is load-bearing for keyboard access: `renderDirections()` builds the chip row only when the direction SET changes, `syncDirectionSelection()` mutates aria-pressed + the summary in place on every selection. Never repaint the row on selection — a `<button>` fires click on Enter/Space, so an innerHTML rebuild destroys the focused chip and drops focus to `<body>` (the LIN-1566 review's blocking finding). Same house pattern as public/live-console.js:147 and public/ship.js:1197-1202; the persistent summary node is `aria-live="polite"`, which only announces BECAUSE it survives the swap. `renderDegraded()` paints the `degraded` flag into `#next-run-degraded` before the cards (LIN-1665) and clears it on every generation, so a later healthy run drops a stale warning
  live-console.css / live-console.js  Live Console view (experimental, liveConsole flag): polls the events endpoint (chained setTimeout, in-flight-guarded, exponential backoff, pauses on tab-hidden) and paints the ambient surfaces via a KEYED reconcile (nodes updated in place, not innerHTML-replaced, so lane pulses breathe continuously, heartbeat ticks update live, and selections survive) — status banner (aria-live; disconnected/reconnecting state) + a full-width rAF-animated flowing activity strip (scrolls right→left in real time — heartbeat "hum" area under colour-coded event blips that drift left and fade; DPR-aware, reduced-motion falls back to a static snapshot), a swimlane TIMELINE of the last 24h (LIN-1742 Phase 1 of LIN-1720: server-packed rows painted as absolutely-positioned bars, keyed reconcile by run id, coloured by `outcomeKind` via bar-scoped `[data-kind]` CSS rules distinct from the stream's `.lc-event[data-kind]` ones, a dashed left edge on a `clippedStart` run, a VISIBLE `.lc-timeline-bar-label` child (ticket identifier + prompt type, not just title/aria-label — dark-on-amber text override for the one bright fill) that clips/ellipses on narrow or zoomed-out bars, and a run-to-run CONNECTOR overlay (`paintTimelineConnectors`, an `.lc-timeline-connectors` `<svg>` sized to the bars viewport with `viewBox="0 0 100 <rowsHeightPx>"` — x in percent-of-width, y in real px, both read straight off each endpoint bar's own rendered `left`/`width`/`top` rather than re-derived — one curved path per server-packed `timeline.connectors` `{fromId,toId}` edge, skipped when either endpoint bar is hidden, rebuilt wholesale — not keyed — on every poll and every gesture repaint since it holds no focus/gesture state); no full-bleed breakout — axis + bars lay out in the page's normal centered column, same as the label/preset-buttons row and every other section, after three review cycles each found a distinct viewport-conditional clipping bug in a full-bleed `.lc-timeline-breakout` attempt — see the CSS comment on `.lc-timeline-section` in public/live-console.css. LIN-1743 Phase 2 of LIN-1720 made it zoomable/pannable: bars re-layout against a `{start, end}` view window — `currentTimelineWindow()` — computed via lib/timeline-zoom.js's `computeTimelineZoom`/`computeTimelinePan` (mirrored on `window` in common.js), never a CSS `transform: scale()` (would blur labels). Desktop: ctrl/meta+wheel zoom, gated like public/ship.js's wheel handler so a plain wheel keeps native page scroll. Mobile: two-finger pinch zooms (focal = pinch midpoint) and one-finger drag pans, axis-LOCKED at the first move past a small jitter threshold (LIN-1743 review F3) — `touch-action: none` is decided by the browser once at touch-start for the whole gesture, so a later per-move `preventDefault()` choice cannot hand a vertical swipe back to native scrolling; a horizontal-dominant lock pans the time window, a vertical-dominant lock hand-rolls the scroll instead, preferring the viewport's own internal `scrollTop` (Q4, many stacked session rows) and falling the UNABSORBED remainder through to `window.scrollBy` so a swipe over a viewport with little/no internal overflow (the common under-~15-row case) still scrolls the page rather than hitting a dead zone. Desktop ALSO drag-pans via plain mouse (LIN-1743 review F2): `mousedown` on the viewport, `mousemove`/`mouseup` on `window` (mirrors public/ship.js's `wirePan`) so the drag survives the pointer leaving the element; `.lc-timeline-viewport--panning` (live-console.css) holds a grabbing cursor + suppresses text selection for the duration, same pattern as `.ship-panning`. `.lc-timeline-viewport` sets `touch-action: none` (deliberately not swipe.css's `pan-y` — a two-finger gesture can start vertical-dominant, which `pan-y` would hand to the browser mid-pinch). `timelineView`/`timelineGesture` are module-scope and untouched by the poll-driven `paintTimeline`, so a poll tick mid-gesture never resets the viewport; the view re-pins to "live" (tracks `lastServerNow`) once panned/zoomed back to the current right edge, matching the always-live 1h/24h presets. A run lying entirely outside the current view window is CULLED, not clamped to an edge sliver (LIN-1743 review F1) — `updateTimelineBarNode` hides it via the shared `lib/timeline-zoom.js` `timelineRunOverlapsWindow` predicate (mirrored on `window` in common.js), and the empty-state check (`updateTimelineEmptyState`, re-run on every viewport-only repaint too, not just a poll's `paintTimeline`) uses the SAME predicate so "is this bar visible" and "is there anything in the window" cannot disagree), breathing pulse-lanes each showing their latest heartbeat (tools/elapsed/breakdown), a newest-first activity stream of status steps + linked [evidence] events where genuinely-new ones animate in, a "view earlier activity" pager that loads older events into an append-only history region below, cross-workspace filter chips (client-side, no refetch), click-through to /observation, and a first-paint skeleton; semantic-token-only (dark-safe), reduced-motion aware; LIN-1436
  styleguide.css                Styleguide reference page (LIN-457)
  proxy.css / proxy.js          Proxy token management page
  prompt-section.js, brief.js, recap.js, context.js, sessions.js  Shared client section renderers (context.js = Context relationship diagram, LIN-572)
tests/
  unit/                Node test runner unit tests (lib modules, renderers, stores)
  e2e/                 Playwright E2E specs (landing, dashboard, auth, dispatch, proxy, …)
  fixtures/            Shared mock data and test helpers
  screenshots/         Reference images for visual specs
  visual/              Playwright visual-regression specs
docs/
  archive/                     Numbered standalone HTML documents served verbatim at /archive/:n, public; the landing page links the latest (archives #1–#2 = first and second editions of "The Harbour Archive" museum page, Jan–Jul 2026)
  dispatch-integration.md      Dispatch consumer integration guide
  proxy-integration.md         Linear API proxy consumer integration guide
  prompt-change-validation.md  Prompt-behavior change validation process
playwright.config.js   Playwright test configuration
playwright.visual.config.js  Playwright config for visual-regression specs
```

### Prompt System (two independent paths)

Changes to prompt behavior (feature flags, workflow instructions, context formatting) must update BOTH:

- **Handwritten prompts**: `lib/prompt-templates.js` → `generatePrompt()` — deterministic, template-based
- **AI-generated prompts**: `lib/openrouter.js` → `lib/prompts/meta-prompt-template.js` — LLM generates via meta-prompt

**Deterministic grounding sections are a single shared post-pass (LIN-435), not duplicated prose.** Four rules — the staleness check, terminal-state note, all-subtasks-complete note, and bug-already-investigated note — are appended by `appendGroundingSections(prompt, issue, context)` (`lib/prompt-formatters.js`), which BOTH paths run as a post-pass over their rendered body: the handwritten path calls it in `generatePrompt()`; the AI meta-prompt path calls `applyGroundingToRecommendation(structured, issue, context, …)` (`lib/openrouter.js`) on the LLM's parsed `## Prompt` output at the three recommendation seams (`getRecommendation` return, the streaming branch, and — via the streamed prompt delta — the leaf view). The rule therefore executes ONCE for both paths (mirroring the capability-awareness post-pass below), so the meta-prompt no longer re-types these rules as prose and they cannot drift. Skipped for `defer` replies (`prompt === null`, the no-body cost contract); the pure parser `parseRecommendationResponse` stays free of `issue`/`context`. This is what fixed the meta path's broken staleness `--since` date (now injected deterministically from `issue.createdAt`, never a placeholder). Cross-path parity is pinned by the grounding-parity tests in `tests/unit/prompt-templates.test.js`.

The ticket staleness check (re-ground against current code: list referenced files/symbols, `git log --since=<createdAt>`, re-read source at HEAD before trusting the ticket) is `formatStalenessCheck()`, appended via the shared post-pass above.

The plan-fidelity check (LIN-698 — the *symmetric* counterpart of the staleness check, one stage earlier in the pipeline: the staleness check distrusts the ticket's claims about the **code** and re-grounds them against HEAD; this distrusts the plan's claims about the **research** and re-grounds them against the research/exploration notes + comment thread the plan was distilled from — surface, don't silently absorb, anything the plan dropped or contradicted, and on conflict the research's reasoning wins) is `formatPlanFidelityCheck()` in `lib/prompt-formatters.js`. It is **implementation-specific**, so unlike the four universal grounding rules it is **NOT** routed through `appendGroundingSections()` (that seam is byte-identical-pinned across all templates; plan-fidelity would leak everywhere and break the grounding-parity test) — instead the handwritten implementation template calls it inline, and the same directive (plus the adjacent refactor/behavior-preservation equivalence check: don't trust a "refactor"/"behavior-preserving" label, enumerate and verify the old behaviors, ideally via a characterization test) is mirrored in the meta-prompt's "Implementation prompts" rule. Both paths are pinned by the LIN-698 tests in `tests/unit/prompt-templates.test.js`.

The terminal-state *body note* (LIN-353 — a Done/Canceled/Duplicate task with no open children is steered to review/close, never a no-op `look-into`) is `formatTerminalStateNote()`, also via the shared post-pass. Its *recommender routing* counterpart — the meta-prompt's "Step 0" decision branch that selects the `review` action — remains in the meta-prompt, because action selection is a meta-path-only concern the handwritten path has no equivalent of. (The deterministic descent guard that refuses defers into terminal nodes is separate, in `lib/recommend-recurse.js`.)

The bug-already-investigated *body note* (LIN-366 — a `bug`-labelled task with prior investigation in its comments advances to the fix instead of re-recommending investigation, because the `bug` label alone is not a reason to re-investigate) is `formatBugInvestigatedNote()`, via the shared post-pass; its *routing* counterpart — the "First check whether the bug has already been investigated" escape hatch in the meta-prompt's Step 2 — remains in the meta-prompt for action selection. It is a soft signal (no deterministic "investigated" marker exists; findings live in free-form comments), gated on `bug` label + ≥1 comment.

The class check (LIN-313 — "widen the model, don't patch the witness": once a bug's root cause is in hand, or before a review approves the close, ask whether the work is an isolated instance or one of a class with unhandled siblings) lives in BOTH paths — woven into the bug template's investigation steps and the review template's "Isolated, or One of a Class?" section in `lib/prompt-template-defs.js`, and the Bug-prompts rule + Review-prompts rule (5) in the meta-prompt's quality rules. The directive never expands scope: a found class is named and its instances recorded (comment / review finding) while the fix stays minimal, and a genuinely isolated result is explicitly valid. It is the execution-altitude sibling of the plan template's Completeness check (LIN-295).

The review→close-out split (LIN-550) makes close-out a first-class step distinct from `review`, so the irreversible finish has an owner and a gate. `review` is now **write-only**: it appends a `### What CI Did Not Prove` ledger (the "Not-Proven-by-CI" handoff — every claim the deliverable depends on that green CI does not exercise) to its summary comment and issues a verdict that is **conditional** when the ledger is non-empty (`Approve — conditional on close-out discharging the ledger`, never a bare Approve); it does NOT merge, set Done, or file close-out follow-ups. The new `close-out` template (`category: UNIVERSAL`, key `close-out`) **consumes** that ledger and owns the irreversible set: it BLOCKS merge/Done until every ledger item is discharged with cited evidence or explicitly accepted by a human naming the exact precondition exercised, then merges, sets Done, posts the summary, and files follow-ups. Three invariants are load-bearing: a missing/unparseable ledger BLOCKS (it is never read as "empty" — the original LIN-735 collapse); green CI alone never discharges a ledger item (the item exists because CI cannot reach it); an empty ledger makes close-out a cheap no-op pass-through. Both paths move together — review/close-out templates in `lib/prompt-template-defs.js`, the trimmed Review rule (6→7) + new Close-out rule + Step-0/Step-3 routing in the meta-prompt — and the ledger stays INLINE per-template (NOT in the byte-identical `appendGroundingSections` post-pass, which would leak it into every template). The close-out body emits no literal "Linear" (it enters the LIN-177 byte-parity loop). Ledger items are **proportional to risk class** (LIN-898): an inherently-unprovable-before-merge claim (model/behavioural compliance, real-world recurrence) is a *hard gate item* only when the change touches runtime logic, a data path, security, or an external contract; for a low-risk, reversible change (prompt-text/docs/comment-only, no such surface) review records it as a *post-merge observation* that discharges via normal post-merge observation, and close-out cites that routing instead of demanding a pre-merge human sign-off. The fix is at review-*authoring* time (such a claim should never have been a hard gate item), NOT at discharge time — close-out still never accepts the reviewer's own "no action needed" self-assessment as a human sign-off, so the three floors above are untouched (missing ledger blocks, green CI never discharges, risky claims still need cited evidence or a named human precondition). The lane is keyed on the *risk surface*, never on LOC/t-shirt size/file type. **LIN-1579 widens that lane and adds a fourth load-bearing invariant — naming is its price.** Two named routes take a claim out of the hard-gate class: a claim unprovable *in principle* before merge discharges to a named **monitor** (a log/oplog entry, a metric, a loudly-failing path, or a routed follow-up that owns the watch) *regardless of risk surface* — with the misfire guard that a claim a test could have proven is an untested claim, not an unprovable one; and the low-risk lane now also covers a **runtime-logic** change that is genuinely reversible, meaning the reviewer names the rollback (the single commit to revert, or the exact env var/flag and its safe value), the rollback is complete (no migration, no data persisted in the new shape, no third party already consuming it), and it needs no coordinated release. Data-path, security, and external-contract surfaces are **not** widened into the rollback lane; an **unnamed** monitor or rollback does not get the lane; and the naming happens at review-*authoring* time, so close-out only ever cites a name someone else wrote — the change relaxes *how* an item discharges, never *who* authorizes the close (the LIN-550 → LIN-810 → LIN-811 → LIN-823 → LIN-1365 lineage against self-certification). LIN-1579 also closes bookkeeping on merge: verification possible on the landed commit is the merging session's last step rather than a separate pass, bounded by claims needing real-world *elapsed* time, which route to the named monitor instead of holding the task open. The posture is unconditional prose, not a flag — pre-launch, one workspace, `git revert` is the rollback; **LIN-282** ("move feature flags from user to workspace, apply to all prompt generation") is the tracked gap that would make it per-workspace, and the orchestrator briefing in `lib/prompts/autopilot-kickoff.js` restates the rule independently, so it moves with the templates. Class-check and ledger stay distinct: class = breadth (siblings → follow-ups), ledger = verification depth (what the deliverable rests on that CI can't prove → close-out gate items). `close-out` registers like any kind — `PROMPT_TEMPLATES` entry (with `aiHint`, so it is AI-recommendable), `COMPLETION_SIGNALS['close-out']`, and `VIRTUAL_PROMPTS.CLOSE_OUT`; all the derived surfaces (`getPromptLabels`, `DISPATCH_KINDS`, `deriveDispatchKind`, the meta-prompt action vocabulary) update automatically.

The Surface Assessment necessity gate (LIN-192 origin, LIN-397 gate — research ends with an explicit verdict on whether the feature's shape *demands* a structural change, and plan turns only a *necessary* prerequisite refactor into a separate blocking subtask) lives in BOTH paths — the research template's Surface Assessment block + the plan template's conditional ratchet in `lib/prompt-template-defs.js`, and the Research-prompts + Plan-prompts quality rules in the meta-prompt. A `refactor required` verdict must pass two citation tests: the consumer test (cite the line in THIS task that calls the new seam — no citation means speculation) and the who-pays test (every touched consumer is a beneficiary or a named-tax bystander — unjustified bystander tax means scope it down). A third verdict (`improvement noticed, not required`) gives noticed-but-not-demanded improvements a non-blocking home. Size is never a rejection criterion: a demanded refactor that doesn't fit the session is sequenced via the blocking subtask, not shrunk — effort is cheap for agents; speculation and bystander tax are not.

Provider capability-awareness (LIN-177 S4/S5) also spans BOTH paths via a single shared surface: `resolvePromptUi()` + `applyPromptCapabilities()` in `lib/prompt-formatters.js`. Call sites thread the active provider's `provider.ui` (`{write, comments, estimates, subtasks, displayName}`, from `getProviderForWorkspace(workspace)`) into `generatePrompt()`/`generateCustomPrompt()` (handwritten) and `buildMetaPrompt()`→`buildMetaPromptTemplate()` (meta). Provider capability is the hard floor; the `linearMcp` user flag is a soft preference within a writable provider. For Linear (every flag on, `displayName: 'Linear'`) every transform is a no-op, so Linear output is **byte-identical** — pinned by the parity test in `tests/unit/prompt-templates.test.js`. (`issue.source.provider` is not populated on canonical issues, so provider identity must come from the workspace, not the issue object. The proxy data-fetch in `routes/proxy.js` has been re-pointed onto the provider layer (LIN-308/309) and provider *selection* is now per-workspace via `getProviderForWorkspace` (LIN-581), the same resolution the render surfaces use.)

When changing prompt behavior, see **[docs/prompt-change-validation.md](docs/prompt-change-validation.md)** for the repeatable process (both-paths rule, overfitting guards, structural tests, and the offline A/B eval harness `scripts/eval-completeness-check.mjs`).

### View Tiers

Views are surfaced in one of three deliberate tiers (LIN-496). **First-class** (dashboard / observation / swipe / swim / settings) — always-on footer links, no flag. **Experimental** (collective / taskChat / ship / nextRun / flightCompanion / shipBiscuit / liveConsole) — per-user flag (default off) in `lib/feature-defaults.js`, membership + flag→route owned by the shared ordered `EXPERIMENTAL_VIEWS` list in `lib/feature-defaults.js`; when on, surfaced in **two** places from that one source — a Settings discovery link (`EXPERIMENTAL_FEATURES` in `lib/render-settings.js`) **and** a gated entry in the nav's `⋯ more` overflow (`getViewNavLinks` in `lib/components/view-nav.js`, strict `flag === true`, emitting the kebab route as the active-match key) — reversing the earlier Settings-only policy (LIN-1247); route-gated to redirect to `/settings` when off. (Naming note: the **first-class** "dashboard" is the unprefixed project tree view at `/workspace/:urlKey/`; the separate realtime, cross-workspace *autopilot* dashboard — formerly the experimental `dashboard` flag/view at `/workspace/:urlKey/dashboard`, LIN-509 — was promoted to the first-class **Observation** page at `/workspace/:urlKey/observation` and its flag retired (LIN-595); `/dashboard` now 302s to `/observation`.) **Flagged power-user** (roadmap / dispatch / proxy) — per-user flag plus a conditional footer link in `lib/components/footer.js`. `/ship` is a key in-development experiment (radial dependency layout), not a retirement candidate; its radial layout is the protected experiment and its token wiring is LIN-500. Full model + the Step-2 "new canvas/radial concept doesn't fit the section/card/token model" friction note: **[docs/view-tiers.md](docs/view-tiers.md)**.

## Code Style

- ES modules (`import`/`export`)
- 2-space indentation
- Single quotes for strings
- Semicolons

## Design Principles

- CLI/terminal *character*, not pure monospace (LIN-785 / LIN-782): a typographic split — **mono (JetBrains Mono) for machine facts** (IDs, counts, paths, tree scaffolding), **sans (Inter) for human structure/labels** (headings, prose, controls). Box-drawing (├─ └─ │) stays as subtle structural character. Both faces are self-hosted woff2 under `public/fonts/` (no build step) and head the `--font-structural` / `--font-content` stacks with robust system fallbacks.
- Light is the default theme; **dark is an opt-in `.theme-dark` hook** applied to `<html>` pre-paint by the shared shell (`lib/components/page.js`) from a persisted preference, with a global toggle in the footer. Themes are pure overrides of the color tokens; the semantic token layer (`--text/--muted/--card/--line/--brand/--amber/--slate` …) and structural tokens stay shared. Default (no class) output is unchanged.
- State indicators: ✓ (done/green), ◐ (in-progress/yellow), ○ (todo/dim)
- Mobile-responsive layout
- Keep it minimal - no frameworks, no build step

## E2E Testing Pattern (LIN-215)

E2E specs live in `tests/e2e/` (Playwright) with unit tests in `tests/unit/` (`node --test`). Two test-side seams keep specs maintainable — keep them **separate**:

- **`tests/fixtures/local-harness.js` — the provider SEEDING seam.** `seedLocalWorkspace(page, seed?, options?)` POSTs to `/test/set-local-session`, seeds the real LocalStore, and establishes a `provider: 'local'` session. It returns `{ urlKey, dashboard }`. Use it whenever a spec needs backing data. Do **not** add selector/session helpers here.
- **`tests/helpers.js` — the SESSION + SELECTOR seam.** Shared `TEST_WORKSPACE_URL_KEY` + `featuresParam()`, `createSession(page, overrides)` (wraps the Linear test-token `/test/set-session` path), the `SELECTORS` stable-selector factory, and thin page objects (`footer`, `settings`, `dashboard`). Do **not** put provider seeding here.

**Prefer `data-testid` over brittle selectors.** Render files emit `data-testid="<surface>-<element>"` (footer links/ai-status, settings sections/toggles/logout, `render.js` project + issue rows, swipe, swim). In specs, select through `SELECTORS`/page objects (`settings(page).section('account')`, `footer(page).getLink('swipe')`) instead of `:has-text()`, CSS classes, or exact `href` values. `tests/e2e/settings.spec.js` is the proof-of-pattern refactor.

**Parallel-aware caller discipline.** A spec's workspace `urlKey` is one value with three consumers — the session endpoint, the `/workspace/${urlKey}/…` navigation URLs, and the teardown/seed query params — so always drive navigation off the `urlKey` a session helper returns, never a hard-coded literal. `createSession`/`seedLocalWorkspace` return the key for this reason. Parallel execution itself (`workers > 1`) is **not** enabled yet: it needs per-worker `urlKey` isolation threaded server-side and is owned by **LIN-625**. Do not raise `workers` in `playwright.config.js` without that isolation — the historical flakiness came from shared server-side store partition keys, not Playwright context sharing.

## Authentication

### Linear OAuth 2.0

```
GET /auth/linear     → Redirect to Linear OAuth (with state parameter)
GET /auth/callback   → Exchange code for access token, store in session
GET /logout          → Destroy session, redirect to login
```

- Sessions stored in MongoDB (production) or MangoDB file-based storage (development)
- Tokens expire after 24 hours (with automatic refresh)
- State parameter validated to prevent CSRF

### Personal Access Token (PAT) Mode

For local development without OAuth configuration:

1. Get a personal API key from: https://linear.app/settings/api
2. Set `LINEAR_ACCESS_TOKEN=lin_api_xxxxx` in your `.env` file
3. Start the server — you'll be logged in automatically

PAT mode:
- Auto-creates a session on first visit (no OAuth redirect)
- Single workspace only (tied to the token's organization)
- Token never expires (no refresh needed)
- OAuth still works alongside PAT if OAuth vars are configured
- Logout destroys session, but next visit re-creates it automatically

### OpenRouter OAuth (PKCE)

Users can connect their OpenRouter account for AI recommendations:

```
GET /auth/openrouter           → Redirect to OpenRouter OAuth (with PKCE)
GET /auth/openrouter/callback  → Exchange code for API key, store in session
POST /auth/openrouter/disconnect → Remove stored API key
```

- Uses PKCE flow with S256 code challenge method
- Returns a permanent API key (no expiry, no refresh needed)
- API key stored in session alongside Linear workspace tokens
- Falls back to `OPENROUTER_API_KEY` env var if no OAuth connection

### GitHub App (Installation)

Users can log in with — or add — a GitHub source via a **GitHub App installation** flow
(migrated from a plain OAuth App; LIN-541/703/761). `routes/github-auth.js` is its own
multi-step router:

```
GET  /auth/github           → Redirect to the GitHub App install page (repo picker)
GET  /auth/github/callback  → Mint an installation token from installation_id, show repo-select page
POST /auth/github/link      → Write the binding: linkProvider(workspace, 'github', repo, creds)
```

- **Three-step flow**: install (repo picker) → callback mints an installation token → link writes the provider binding.
- **Two entry points share the routes**: the landing "Continue with GitHub" (`mode: 'new'`) and the
  settings "Add a source" (`mode: 'add-source'`). Intent is carried in the **session `mode`**, not the
  OAuth `state` — both drive the same three routes.
- App-JWT internals (installation-token mint, user-to-server OAuth exchange) live in
  `lib/providers/github/app-auth.js`. `getMissingGitHubConfig()` there is the **single config
  predicate** — an empty result means the flow can be started and completed — and is the shared guard
  for both the `/auth/github` route and the settings add-source affordance.
- **Not env vars**: `GITHUB_API_BASE`, `GITHUB_OAUTH_AUTHORIZE_URL`, and `GITHUB_OAUTH_TOKEN_URL` are
  **hardcoded consts** in `app-auth.js` (the App migration centralized them as literals), not
  `process.env` reads — do not document them as environment variables.

### Free Tier (Rate-Limited)

When `OPENROUTER_FREE_TIER_KEY` is set, users without an OpenRouter connection get limited free prompts:

- API key source priority: user OAuth > env key > free tier key > none
- Per-workspace daily limit: 20 prompts (resets at midnight UTC)
- Global hourly limit: 50 prompts across all workspaces
- Uses atomic check-and-increment (`tryUse()`) to prevent race conditions
- Footer shows `ai: ● free (N/20)` status; settings page shows usage info
- Returns 429 with usage metadata when limits exceeded
- Free-tier calls are **clamped to one model**, ignoring the workspace preference and any
  per-request override, so a free user can never bill an arbitrary/expensive model against
  the operator's shared key (LIN-513). The clamp lives in the `forceDefault` branches of
  `resolveWorkspaceModel`/`resolveAiOperationModel` (`lib/workspace-preferences.js`) and
  returns **before** the prefs lookup, so it fails closed. `resolveRoadmapModelOverride`
  (`routes/workspace-api.js`) is the same gate on the LIN-819 per-request override path.
- The **value** it clamps to is `resolveFreeTierModel()` (`lib/openrouter.js`, LIN-1333):
  `OPENROUTER_FREE_TIER_MODEL` when set to a curated `AVAILABLE_MODELS` id, else
  `DEFAULT_MODEL`. Only that value is configurable — the precedence above is unchanged.
  It **fails closed**: an uncurated value is ignored (never passed unchecked to
  OpenRouter) and warned about once at startup via `getFreeTierModelConfigWarning()`,
  since a silent downgrade would otherwise hide the operator's typo. The var is scoped to
  the free tier: workspaces with no stored preference keep getting `DEFAULT_MODEL`, so the
  two can diverge (e.g. a cheaper free tier than the paid default).

## Environment Variables

```
LINEAR_CLIENT_ID        OAuth client ID from Linear
LINEAR_CLIENT_SECRET    OAuth client secret from Linear
LINEAR_REDIRECT_URI     Callback URL (must match Linear OAuth app config)
LINEAR_ACCESS_TOKEN     Personal API key for auto-authentication (optional, bypasses OAuth)
SESSION_SECRET          Secret for signing session cookies
PORT                    Server port (default: 3000)
MONGODB_URI             MongoDB connection string (optional, uses file storage if not set)
MONGODB_TEST_URI        Test-only: real MongoDB for tests/unit/mongo-smoke.test.js (LIN-1337). NOT a runtime var. Deliberately separate from MONGODB_URI so a developer's production URI can't be hit by the suite's concurrency probes. Unset locally skips the suite explicitly; CI sets it via a mongo:8.0 service container and hard-fails if missing
OPENROUTER_API_KEY      Server-side OpenRouter API key (optional, users can connect via OAuth)
OPENROUTER_REDIRECT_URI Callback URL for OpenRouter OAuth (optional, defaults to /auth/openrouter/callback)
OPENROUTER_FREE_TIER_KEY Server-side API key for free tier users (optional, enables rate-limited free prompts)
OPENROUTER_FREE_TIER_MODEL  Model free-tier requests are clamped to (optional, default openai/gpt-5.4-mini). Must be a curated AVAILABLE_MODELS id; anything else is ignored (warned at startup) and the free tier stays on the default. Free-tier only — does not move the default for workspaces with no stored model preference
FREE_TIER_DAILY_LIMIT   Per-workspace daily free-prompt limit (optional, default 20)
FREE_TIER_HOURLY_LIMIT  Global hourly free-prompt limit across all workspaces (optional, default 50)
GITHUB_CLIENT_ID        GitHub App user-to-server OAuth client ID (required for GitHub login/binding)
GITHUB_CLIENT_SECRET    GitHub App user-to-server OAuth client secret (required for GitHub login/binding)
GITHUB_APP_ID           GitHub App ID, used to sign the App JWT (required for GitHub login/binding)
GITHUB_APP_PRIVATE_KEY  GitHub App private key (PEM), used to sign the App JWT (required for GitHub login/binding)
GITHUB_APP_SLUG         GitHub App slug, used to build the install URL (required for GitHub login/binding)
GITHUB_REDIRECT_URI     Callback URL for GitHub user-to-server OAuth (optional; falls back to the App's default callback when unset)
GITHUB_PROJECTS_REDIRECT_URI  Callback URL for the github-projects provider (optional; falls back to GITHUB_REDIRECT_URI)
DISPATCH_OWNERLESS_BROKER_COMPAT  Whether ownerless (createdBy:null) tokens are still tolerated (optional, default ON). Set to off/false/0/no to restore strict owner-required minting. Its reach is EVERY bootstrap mint, structurally (LIN-1582): `ProxyTokenStore.createToken` itself throws on a `kind: 'bootstrap'` mint with no `createdBy`, so no call path — present or future, including the test-only `/test/create-proxy-token` — can mint one, and ownerless inheritance is impossible rather than merely unused. The three production sites additionally refuse ahead of the store so the policy surfaces in each one's own idiom rather than as a raw throw: `POST /api/dispatch/broker-token` 503s an ownerless caller, `provisionBootstrapToken` refuses (fail-closed for a claude-code dispatch, a dropped best-effort block for a prose harness — Collective's prose branch routes through it), and `POST /workspace/:urlKey/api/proxy/tokens` 503s a `bootstrap: true` request from a session with no accountId (its non-bootstrap path is untouched). `exchangeBootstrapToken` is deliberately NOT gated — it mints `kind: 'standard'`, so an already-issued ownerless bootstrap stays exchangeable and the compat population is never stranded mid-flight. Fails SAFE — only an explicit off-value switches strictness on, so an unset var or a typo leaves the compat lane running. ORDERING: the host runner authenticates with an ownerless pre-LIN-1397 dispatch token, so re-issue that token as OWNED (create one while signed in; `GET .../api/dispatch/tokens` reports `hasOwner`) BEFORE switching this off, or the runner's own mints start 503ing. See lib/ownerless-token-policy.js (LIN-1447/LIN-1448/LIN-1582)
YAP_BASE_URL            Yap chat server base URL for the experimental Collective live view (optional, defaults to https://yap.jkershaw.com)
YAP_PASSWORD            Yap server password (optional, sent as Bearer auth on Yap calls)
```

The five `GITHUB_*` required vars are the exact set in `GITHUB_REQUIRED_ENV` (`lib/providers/github/app-auth.js`); `getMissingGitHubConfig()` reports which are unset. `GITHUB_API_BASE`, `GITHUB_OAUTH_AUTHORIZE_URL`, and `GITHUB_OAUTH_TOKEN_URL` are **hardcoded consts**, not environment variables — do not add them here.

## Linear API

- Uses `graphql-request` to query Linear's GraphQL API
- OAuth tokens passed via `Authorization: Bearer {token}` header
- Fetches projects with state "started" and all issues
- Single query fetches both projects and issues

## Key Behaviors

- Unauthenticated users see landing page with static projects preview
- In Progress section shows all in-progress issues across projects
- Click issue line → toggle details (description, assignee, dates, labels)
- Click ▼ arrow → collapse/expand children
- Click project header → collapse entire project
- Click "reset" → restore default collapse state
- Collapse state persisted in localStorage
- 401 errors clear session and redirect to landing page
- Free tier users see daily prompt quota in footer and settings; 429 on limit exceeded
- `/kpis` is a public, intentionally unlinked page of instance-wide aggregate stats (Chart.js charts, 60s server cache). `lib/kpi-stats.js` is the privacy boundary: only counts and app-defined labels, never workspace keys or content

## AI Agent Support

The `/llms.txt` file provides guidance for AI agents navigating the site, including:
- DOM selectors (`data-id`, `data-status`, `data-section`, `data-parent`)
- Navigation patterns and interactive elements
- Status indicators and their meanings

**Keep llms.txt updated** when modifying DOM structure or data attributes in `render.js`.

## Dispatch API

The Dispatch feature allows users to queue prompts for external consumers (AI agents, automation tools).

**User-facing endpoints** (session auth, workspace-prefixed):
- `POST /workspace/:urlKey/api/dispatch` - Queue a prompt
- `GET /workspace/:urlKey/api/dispatch` - List queued items
- `DELETE /workspace/:urlKey/api/dispatch/:itemId` - Remove item
- Token management at `/workspace/:urlKey/api/dispatch/tokens`

**Consumer endpoints** (Bearer token auth):
- `GET /api/dispatch/poll` - Poll for available items
- `POST /api/dispatch/take/:itemId` - Atomically claim an item
- `POST /api/dispatch/feedback/:itemId` - Post feedback on a taken item

Items expire after 24 hours. Tokens are workspace-scoped and never expire (but can be revoked).
Feedback is append-only, inherits 30-day history TTL, and requires strict token ownership.

A dispatch item may carry an optional `followUpTo` field (the `id` of an earlier dispatch) to resume that
session as a follow-up instead of starting fresh (cli/web only, same workspace; LIN-415). Harbour
stores and forwards the id blindly — the consumer owns session identity and liveness, and reports
`[failed] no live session to resume` when the target session is gone. See the Follow-ups section of the
integration guide; the autopilot's conservative "fresh by default, follow up only after a flawless,
self-suggesting session" disposition lives in `docs/autopilot-operating-manual.md`.

**See [docs/dispatch-integration.md](docs/dispatch-integration.md)** for the full consumer integration guide.

## Workspace API Proxy (provider-backed)

The proxy allows authenticated users to generate secure tokens for external AI agents and automation tools to interact with their workspace's issues and projects via a REST-like API. The wire contract is **source-neutral** (flat shapes, no provider-specific URLs) and the data path runs through the provider layer (LIN-306/308/309/310): reads source through `lib/providers/linear/index.js`, writes go through an injected `provider.*` that is capability-gated (`provider.supports()` → clean 422 `CAPABILITY_NOT_SUPPORTED` for unsupported ops). The route owns no inline Linear GraphQL — only residual `graphqlErrorStatus()`/`graphqlErrorDetail()` error-shape parsers remain on the error path. Provider **selection** is now per-workspace (LIN-581): `resolveWorkspaceAccess` surfaces the workspace's own `provider` name and `resolveProviderAccess` resolves it via `getProviderForWorkspace` (registry; Linear is the legacy default for workspaces with no explicit provider, so the historical path is byte-identical), which makes the capability gate (`provider.supports()` → 422) a real runtime path rather than only a test-injected one. (Input `<source>:` namespace acceptance in `lib/proxy-ref-resolver.js` is still Linear-only — that relaxation is sequenced separately as LIN-544.)

**Key features:**
- Token-based authentication (Bearer tokens with SHA-256 hashing)
- Read/write scope separation (`read` for queries, `readWrite` for mutations)
- Single-use token support (consumed after first request)
- Single-use **bootstrap** tokens for handoffs (LIN-376): every token embedded in a dispatched prompt, page copy, +proxy block, or Collective message is a single-use, exchange-only bootstrap (`kind: 'bootstrap'` in `lib/proxy-tokens.js`). It authenticates ONLY `POST /api/proxy/token`, which atomically consumes it and returns a multi-use working token; `validateToken` rejects a bootstrap on every data endpoint. The durable prompt (queue/history/log/clipboard, readable via `GET /api/proxy/dispatch/:id/prompt`) therefore carries a credential that is inert the instant the agent exchanges it, and the dispatch endpoints no longer replay the caller's own standing token. The one seam is the exchange endpoint; every handoff generator (`buildProxyContextPreamble`, `buildLinearAccessBlock`, `buildAgentPrompt`, `buildBlock`, `/instructions`) leads with the exchange step.
- Event audit logging (30-day TTL)
- Rate limiting (60 requests/minute per IP)
- Workspace isolation (tokens are scoped to a single workspace)

**User-facing endpoints** (session auth, workspace-prefixed):
- `POST /workspace/:urlKey/api/proxy/tokens` - Create a proxy token
- `GET /workspace/:urlKey/api/proxy/tokens` - List tokens
- `DELETE /workspace/:urlKey/api/proxy/tokens/:tokenId` - Revoke token
- `GET /workspace/:urlKey/api/proxy/events` - View audit log

Consumer endpoints are Bearer-token authenticated and fall into three groups: **read** (issues, teams, projects, cycles, labels, search, relations), **write** (`readWrite` scope — create/update issues, comments, relations, labels), and **task automation** (stack, prompt, recommend, recap, brief, status). The full endpoint catalog, request/response shapes, and scope rules are the consumer contract and live in the integration guide — that's the source of truth, not this file. (Issue IDs accept both UUIDs and identifiers like `LIN-123`.) `GET /api/proxy/issues` is cursor-paged (LIN-1511): it accepts an opaque `after` request cursor (alias `cursor`) passed verbatim through the existing `provider.issues({ first, after })` seam, and returns `pageInfo.{hasNextPage,endCursor}` — loop `endCursor` back as `after` until `hasNextPage` is false to enumerate a workspace past the 250-per-page cap. `/api/proxy/search` is deliberately **not** paged (relevance-capped; tracked separately). A cursor the provider rejects is a **400**, not a 500: Linear signals a caller error *inside an HTTP 200 GraphQL envelope* (`extensions.userError: true`, no `statusCode`), which the four status branches of `graphqlErrorStatus()` cannot see, so before LIN-1511's follow-up every one fell through to 500. The `userError → 400` branch is evaluated **last**, after those branches, so it can only refine a would-be 500 — it applies to every proxy route, not just `/issues` (a caller error is a caller error wherever it lands), and `graphqlErrorDetail()` prefers Linear's `extensions.userPresentableMessage` over the generic top-level `message` so the caller is told *which* input was wrong.

**See [docs/proxy-integration.md](docs/proxy-integration.md)** for the full consumer integration guide.

## Collective (experimental, LIN-450)

A rough-draft experiment, **gated behind a per-user `collective` feature flag and surfaced only via a link in Settings**. It automates the manual cross-project discussion written up in `docs/collective-session-2026-06-12.md`: choose a roster of characters (personas, each bound to a connected repo), name a [Yap](https://github.com/jkershaw/yap) channel, and start — the page fans `buildCollectiveParticipantPrompt(...)` out to each character's bound workspace's **unchanged** dispatch route (`dispatchQueueStore.addItem`), then renders the live channel and lets you inject input via a thin server-side Yap proxy.

- **Character selection (LIN-1048):** the picker lists saved `custom` + auto-recorded `recent` characters and offers a define-new affordance (pick a connected repo + fill the five persona fields `role/lens/objective/value/disposition` + name, optionally save). `POST /start` accepts a `characters` list (superseding `workspaceUrlKeys`); each character's `workspaceUrlKey` repo binding is re-validated against `session.workspaces` (stale bindings dropped, empty-set → 400) and every dispatched character is recorded as `recent`. Persistence is `lib/collective-characters-store.js`; a character with no persona fields collapses to the byte-identical default Implementer. `POST /preview` threads the selected `character` so preview matches dispatch.
- **Substrate:** dispatch `target` is `cli`/`web` only (full Claude Code sessions); `dash`/`local` are rejected. Each character's bound workspace must have a live consumer draining its queue.
- **Channel name** is the single shared contract across the participant prompt, the fan-out, and the `state`/`say` endpoints — normalized once via `normalizeYapChannel`. The page seeds a fresh friendly default per load via `randomChannelName()` (`#word-word-YYYY-MM-DD`).
- **Side-effect policy is prompt-only:** participants may carry a `readWrite` proxy token (best-effort minted per fan-out), but the participant prompt requires asking John in-channel before any Linear write / ticket / mutation. There is no deterministic write-lock — a named, accepted V1 gap.
- **Yap** is ephemeral (200-msg ring buffer, unauthenticated nicks); poll/history return the body in a `text` field, normalized by the `state` endpoint. `YAP_BASE_URL` defaults to `https://yap.jkershaw.com` (override per env; optional `YAP_PASSWORD`), so the live view works out of the box. `lib/yap-client.js` uses the proxy-aware fetch (`createProxyFetch`), so Yap calls route through the same egress proxy as Linear calls when one is configured.
- **Prompt preview:** `POST .../collective/preview` builds the participant prompt for the chosen channel/topic (sample nick + placeholder token) so the page can show & copy exactly what each participant receives.
- **Deferred past V1:** chat/per-agent recaps, a durable transcript store, auto-cadence, and the within-a-project variant.

Endpoints (session auth, workspace-anchored but operating over `session.workspaces`):
- `GET  /workspace/:urlKey/collective` — page (redirects to settings when the flag is off)
- `POST /workspace/:urlKey/collective/start` — character-roster dispatch fan-out (`characters` list; records recents)
- `POST /workspace/:urlKey/collective/preview` — build the participant prompt for the selected `character` (view & copy, no dispatch)
- `GET  /workspace/:urlKey/api/collective/state` — JSON poll fronting `yap.poll`
- `POST /workspace/:urlKey/api/collective/say` — inject human input via `yap.say`

## GitHub Actions CI (for AI Agents)

This is a public repository, so GitHub Actions status can be checked without authentication using curl.

### Check Recent Runs

```bash
# List recent workflow runs
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs?per_page=5" | \
  jq '.workflow_runs[] | {id, status, conclusion, head_branch, display_title}'

# Quick status of latest run
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs?per_page=1" | \
  jq '.workflow_runs[0] | {status, conclusion, html_url}'
```

### Check Specific Run

```bash
# Get run status by ID
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs/RUN_ID" | \
  jq '{status, conclusion, html_url}'

# Get job details for a run
curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs/RUN_ID/jobs" | \
  jq '.jobs[] | {name, status, conclusion}'
```

### Poll for Completion

```bash
# Wait and check (useful after pushing changes)
sleep 30 && curl -s "https://api.github.com/repos/JKershaw/LinearViewer/actions/runs?per_page=1" | \
  jq '.workflow_runs[0] | {status, conclusion}'
```

### Status Values

| Field | Values |
|-------|--------|
| `status` | `queued`, `in_progress`, `completed` |
| `conclusion` | `success`, `failure`, `cancelled`, `skipped` (only when completed) |

**Note**: CI runs on pull requests targeting `main` and on pushes to `main` (i.e. after a PR merges). The `ci-success` job aggregates the unit and e2e jobs into a single stable check — require it as a branch-protection status check so automated agents can confirm CI is green before merging.
