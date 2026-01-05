---
title: Linear Roadmap Viewer
---

# Login
> Read-only viewer for your Linear roadmap

- ◐ Connect with Linear
  OAuth with read-only scope
  @url: /auth/linear
  @linkText: Login with Linear →
  @sameTab: true

# What This Is
> A minimal, CLI-aesthetic view of your Linear projects

- ✓ Collapsible tree view
  Click to expand issues and see details
- ✓ No data stored
  Fetched fresh on each visit, nothing saved server-side
- ✓ 24h sessions
  Auto-logout keeps your account secure
- ✓ Mobile friendly
  Same clean interface on any device

# Self-Host
> Run your own instance for full privacy

- ○ Clone and run locally
  Node.js + a Linear OAuth app + ~5 minutes
- ○ Setup with Claude
  Copy this prompt into Claude Code or claude.ai:
  ---
  I want to self-host Linear Roadmap Viewer. Repo: https://github.com/JKershaw/LinearViewer — Help me: 1) Clone and install dependencies, 2) Create a Linear OAuth app at linear.app/settings/api/applications with callback http://localhost:3000/auth/callback, 3) Create .env with the required variables, 4) Run it. Walk me through each step.
  ---

# Source

- ○ View on GitHub
  @url: https://github.com/JKershaw/LinearViewer
  @linkText: github.com/JKershaw/LinearViewer
- ○ Built by John Kershaw
  @url: https://jkershaw.com
  @linkText: jkershaw.com
