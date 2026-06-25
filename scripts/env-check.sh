#!/bin/bash

# Environment check script for LinearViewer
# Verifies all dependencies, environment variables, and tools are properly configured
# Output is structured for AI agents: blocking issues first, then passing checks

# Colors and symbols
check="✓"
warn="⚠️"

# Arrays to collect results
blockers=()
blocker_commands=()
optional=()
optional_commands=()
ready=()

# --- Collect check results ---

# Check Node.js
if command -v node &> /dev/null; then
  node_version=$(node --version | sed 's/v//')
  node_major=$(echo "$node_version" | cut -d. -f1)
  if [ "$node_major" -ge 20 ]; then
    ready+=("Node.js $node_version (≥20 required)")
  else
    blockers+=("Upgrade Node.js (current: $node_version, need ≥20)")
    blocker_commands+=("Install Node.js 20+ from https://nodejs.org")
  fi
else
  blockers+=("Install Node.js")
  blocker_commands+=("Install Node.js 20+ from https://nodejs.org")
fi

# Check npm
if command -v npm &> /dev/null; then
  npm_version=$(npm --version)
  ready+=("npm $npm_version")
else
  blockers+=("Install npm")
  blocker_commands+=("Comes with Node.js installation")
fi

# Check node_modules
deps_installed=0
if [ -d "node_modules" ]; then
  ready+=("Dependencies installed")
  deps_installed=1
else
  blockers+=("Install dependencies (required for Linear CLI and web app)")
  blocker_commands+=("npm install")
fi

# Check .env file (optional - only needed for web app OAuth)
env_exists=0
if [ -f ".env" ]; then
  ready+=(".env file exists")
  env_exists=1
else
  if [ -f ".env.example" ]; then
    optional+=("Create .env file")
    optional_commands+=("cp .env.example .env")
  fi
fi

# Check environment variables for OAuth (optional - only needed for web app)
if [ -n "$SESSION_SECRET" ]; then
  ready+=("SESSION_SECRET")
else
  optional+=("Set SESSION_SECRET")
  optional_commands+=("Add to .env: SESSION_SECRET=\"your-secret-here\"")
fi

if [ -n "$LINEAR_CLIENT_ID" ]; then
  ready+=("LINEAR_CLIENT_ID")
else
  optional+=("Set LINEAR_CLIENT_ID")
  optional_commands+=("Get from https://linear.app/settings/api/applications")
fi

if [ -n "$LINEAR_CLIENT_SECRET" ]; then
  ready+=("LINEAR_CLIENT_SECRET")
else
  optional+=("Set LINEAR_CLIENT_SECRET")
  optional_commands+=("Get from https://linear.app/settings/api/applications")
fi

# Check optional environment variables
if [ -n "$LINEAR_API_KEY" ]; then
  ready+=("LINEAR_API_KEY")
fi

# Check Playwright browsers
playwright_ok=0
if [ -d "node_modules/playwright-core/.local-browsers" ]; then
  playwright_ok=1
elif [ -d "$HOME/.cache/ms-playwright" ]; then
  playwright_ok=1
elif [ -d "/ms-playwright" ]; then
  playwright_ok=1
elif [ -n "$PLAYWRIGHT_BROWSERS_PATH" ] && compgen -G "$PLAYWRIGHT_BROWSERS_PATH/chromium*" > /dev/null; then
  playwright_ok=1
fi

if [ "$playwright_ok" -eq 1 ]; then
  ready+=("Playwright browsers installed")
else
  blockers+=("Install Playwright browsers")
  blocker_commands+=("npx playwright install chromium --with-deps")
fi

# --- Output results ---

echo "Environment Check"
echo "─────────────────"

# Print blockers first (if any)
if [ ${#blockers[@]} -gt 0 ]; then
  echo ""
  echo "$warn ACTION REQUIRED (complete these first):"
  echo ""
  for i in "${!blockers[@]}"; do
    num=$((i + 1))
    echo "$num. ${blockers[$i]}"
    echo "   → ${blocker_commands[$i]}"
  done
fi

# Print optional items (for web app only)
if [ ${#optional[@]} -gt 0 ]; then
  echo ""
  echo "Optional (only needed for web app OAuth):"
  for i in "${!optional[@]}"; do
    echo "- ${optional[$i]}"
    echo "  → ${optional_commands[$i]}"
  done
fi

# Print ready items
if [ ${#ready[@]} -gt 0 ]; then
  echo ""
  echo "Ready:"
  for item in "${ready[@]}"; do
    echo "$check $item"
  done
fi

# Final summary for AI agents
echo ""
if [ ${#blockers[@]} -gt 0 ]; then
  echo "Status: ${#blockers[@]} issue(s) to fix before proceeding"
else
  echo "Status: All checks passed"
fi
