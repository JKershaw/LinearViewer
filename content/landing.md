---
title: Harbour
---

# What Harbour Is
> Mission control for AI-built software

- ○ The control plane for your coding agents
  AI made writing code cheap—it didn't make knowing what to build any faster. Harbour reads your backlog, turns the right next task into a grounded prompt, dispatches it to an AI agent, and verifies the work landed on real evidence: CI, merges, diffs—not the agent's say-so.
  @identifier: LV-2
  @priority: 1
- ✓ Any backend, one cockpit
  Linear, GitHub Issues, or a local store—behind a single provider abstraction. You're no longer tied to one tracker.
  @identifier: LV-3
  @priority: 2
  @completedAt: 2026-01-15T10:00:00.000Z
- ✓ Grounded prompts, two ways
  14 deterministic templates plus an LLM meta-prompt, both re-grounded against your current code before they run.
  @identifier: LV-4
  @priority: 2
  @completedAt: 2026-02-01T10:00:00.000Z

# Views
> Many lenses on the same work

- ○ Tree, swipe & swim lanes
  Explore the backlog as a collapsible tree, one task at a time, or as parallel tracks that show dependencies and sequence at a glance.
  @identifier: LV-5
  @priority: 2
- ○ Roadmap & ship
  See delivery trajectory and a radial map of what's blocking what.
  @identifier: LV-6
  @priority: 3
- ○ Observation
  Watch your agent runs live as they pick up work, run, and report back.
  @identifier: LV-7
  @priority: 2

# Orchestration
> One human steering a fleet of agents

- ○ Dispatch
  Queue grounded prompts for external AI agents to poll, claim, run, and report on.
  @identifier: LV-8
  @priority: 2
- ○ Autopilot
  A thin orchestrator that runs the loop continuously—read, pick, dispatch, watch evidence, repeat—so you stop being the thing present for every tick and become the navigator.
  @identifier: LV-9
  @priority: 2
- ○ Workspace API proxy
  A source-neutral REST API so your own tools can read and write the backlog through one contract.
  @identifier: LV-10
  @priority: 3

# Self-Host
> Full control in under 5 minutes
@collapsed: true

- ○ Run it yourself
  Node.js + an OAuth app for your backend, that's it
  @identifier: LV-11
  @priority: 2
- ○ AI-assisted setup
  Copy this prompt into your preferred AI assistant:
  ---
  I want to self-host Harbour. Repo: https://github.com/JKershaw/LinearViewer — Help me: 1) Clone and install dependencies, 2) Create a Linear OAuth app at linear.app/settings/api/applications with callback http://localhost:3000/auth/callback, 3) Create .env with the required variables, 4) Run it. Walk me through each step.
  ---
  @identifier: LV-12
  @priority: 2
  - ○ Customize it
    Ask your AI to modify the code—add features or change styling
    @identifier: LV-13
    @priority: 4

# Source
@collapsed: true

- ○ View on GitHub
  @identifier: LV-14
  @priority: 4
  @url: https://github.com/JKershaw/LinearViewer
  @linkText: github.com/JKershaw/LinearViewer
- ○ Bugs & feature requests
  @identifier: LV-15
  @priority: 4
  @url: https://github.com/JKershaw/LinearViewer/issues
  @linkText: Submit on GitHub
- ○ Built by John Kershaw
  @identifier: LV-16
  @priority: 4
  @url: https://jkershaw.com
  @linkText: jkershaw.com

# Harbour OS
> A separate in-browser workstation Harbour can dispatch into

- ○ Harbour OS
  Harbour's sibling product — an in-browser developer workstation you can dispatch agent sessions into. Parent/child like Apple and macOS; Harbour is the cockpit, Harbour OS is the workshop floor.
  @identifier: LV-17
  @priority: 4
  @url: https://os.harbour.cat
  @linkText: os.harbour.cat →
