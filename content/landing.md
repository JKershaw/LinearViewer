---
title: Linear Projects Viewer
---

# Login
> A distraction-free view of what matters in Linear

- ◐ Connect with Linear
  OAuth with read-only scope
  @identifier: LV-1
  @priority: 1
  @url: /auth/linear
  @linkText: Login with Linear →
  @sameTab: true

# Views
> Three ways to explore your Linear issues

- ◐ Projects tree
  Collapsible hierarchy of all your projects and issues. You're looking at it now.
  @identifier: LV-20
  @priority: 2
- ○ Swipe
  Review issues one at a time. Focus on a single task without distraction.
  @identifier: LV-21
  @priority: 2
- ○ Swim lanes
  Visualize work as parallel tracks. See dependencies and sequence at a glance.
  @identifier: LV-22
  @priority: 2

# What This Is
> Linear is powerful but busy. This gives you just the tree.

- ○ You're looking at it
  This landing page uses the same tree UI
  @identifier: LV-2
  @priority: 3
  @blocks: project-0-issue-0
- ✓ Collapsible tree view
  Expand issues to see descriptions, assignees, and dates
  @identifier: LV-3
  @priority: 2
  @completedAt: 2025-12-01T10:00:00.000Z
- ✓ Always fresh
  Fetched live from Linear—nothing stored on our servers
  @identifier: LV-4
  @priority: 2
  @completedAt: 2025-12-05T14:30:00.000Z
- ✓ Auto-logout after 24h
  Peace of mind for shared devices
  @identifier: LV-5
  @priority: 3
  @completedAt: 2025-12-10T09:00:00.000Z
- ✓ Works everywhere
  Clean interface on desktop, tablet, or phone
  @identifier: LV-6
  @priority: 2
  @completedAt: 2025-12-15T16:00:00.000Z

# AI Integration
> Get smart recommendations for your tasks

- ○ Task-specific prompts
  Click any task to see AI-generated prompts tailored to your workflow
  @identifier: LV-7
  @priority: 2
  @blocks: project-2-issue-2
- ○ Connect OpenRouter
  Link your OpenRouter account for personalized AI suggestions
  @identifier: LV-8
  @priority: 1
  @blocks: project-2-issue-0
  @url: https://openrouter.ai
  @linkText: Get an OpenRouter account →
- ○ How it works
  The AI analyzes your task context—parent issues, siblings, project goals—and recommends the best next action
  @identifier: LV-9
  @priority: 3

# Self-Host
> Full privacy in under 5 minutes
@collapsed: true

- ○ Run it yourself
  Node.js + a Linear OAuth app, that's it
  @identifier: LV-10
  @priority: 2
  @blocks: project-3-issue-1
- ○ AI-assisted setup
  Copy this prompt into your preferred AI assistant:
  ---
  I want to self-host Linear Projects Viewer. Repo: https://github.com/JKershaw/LinearViewer — Help me: 1) Clone and install dependencies, 2) Create a Linear OAuth app at linear.app/settings/api/applications with callback http://localhost:3000/auth/callback, 3) Create .env with the required variables, 4) Run it. Walk me through each step.
  ---
  @identifier: LV-11
  @priority: 2
  - ○ Customize it
    Ask your AI to modify the code—add features or change styling
    @identifier: LV-12
    @priority: 4

# Use Cases
> When a focused view helps
@collapsed: true

- ○ Daily standups
  Quick scan of in-progress work across projects
  @identifier: LV-13
  @priority: 3
- ○ Project reviews
  Collapse completed work, focus on what's left
  @identifier: LV-14
  @priority: 3
- ○ Status overviews
  Share a clean read-only view with stakeholders
  @identifier: LV-15
  @priority: 3

# Source
@collapsed: true

- ○ What is Linear?
  A modern project management tool for software teams
  @identifier: LV-16
  @priority: 4
  @url: https://linear.app
  @linkText: linear.app
- ○ View on GitHub
  @identifier: LV-17
  @priority: 4
  @url: https://github.com/JKershaw/LinearViewer
  @linkText: github.com/JKershaw/LinearViewer
- ○ Bugs & feature requests
  @identifier: LV-18
  @priority: 4
  @url: https://github.com/JKershaw/LinearViewer/issues
  @linkText: Submit on GitHub
- ○ Built by John Kershaw
  @identifier: LV-19
  @priority: 4
  @url: https://jkershaw.com
  @linkText: jkershaw.com
