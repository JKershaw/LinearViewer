#!/bin/bash

# Environment check script for LinearViewer
# Verifies all dependencies, environment variables, and tools are properly configured

# Track if any required check fails
required_failed=0

# Colors and symbols
check="✓"
cross="✗"
skip="○"

echo "Environment Check"
echo "─────────────────"

# Check Node.js
if command -v node &> /dev/null; then
  node_version=$(node --version | sed 's/v//')
  node_major=$(echo "$node_version" | cut -d. -f1)
  if [ "$node_major" -ge 20 ]; then
    echo "$check Node.js $node_version (≥20 required)"
  else
    echo "$cross Node.js $node_version (≥20 required)"
    required_failed=1
  fi
else
  echo "$cross Node.js not installed"
  echo "  Run: Install Node.js 20+ from https://nodejs.org"
  required_failed=1
fi

# Check npm
if command -v npm &> /dev/null; then
  npm_version=$(npm --version)
  echo "$check npm $npm_version"
else
  echo "$cross npm not installed"
  required_failed=1
fi

# Check node_modules
if [ -d "node_modules" ]; then
  echo "$check Dependencies installed"
else
  echo "$cross Dependencies not installed"
  echo "  Run: npm install"
  required_failed=1
fi

# Check Playwright browsers
playwright_ok=0
if [ -d "node_modules/playwright-core/.local-browsers" ]; then
  playwright_ok=1
elif [ -d "$HOME/.cache/ms-playwright" ]; then
  playwright_ok=1
elif [ -d "/ms-playwright" ]; then
  playwright_ok=1
fi

if [ "$playwright_ok" -eq 1 ]; then
  echo "$check Playwright browsers installed"
else
  echo "$cross Playwright browsers not installed"
  echo "  Run: npx playwright install chromium --with-deps"
  required_failed=1
fi

echo ""
echo "Environment Variables:"

# Check for .env file and load it
if [ -f ".env" ]; then
  echo "$check .env file exists"
  # Load .env file safely (only KEY=VALUE lines, no command execution)
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$key" ]] && continue
    # Remove surrounding quotes from value
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    # Export if key is a valid variable name
    if [[ "$key" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
      export "$key=$value"
    fi
  done < .env
else
  echo "$cross .env file not found"
  if [ -f ".env.example" ]; then
    echo "  Run: cp .env.example .env"
  fi
fi

# Check required environment variables
if [ -n "$SESSION_SECRET" ]; then
  echo "$check SESSION_SECRET"
else
  echo "$cross SESSION_SECRET"
  echo "  Set in .env or export SESSION_SECRET=\"your-secret\""
  required_failed=1
fi

if [ -n "$LINEAR_CLIENT_ID" ]; then
  echo "$check LINEAR_CLIENT_ID"
else
  echo "$cross LINEAR_CLIENT_ID"
  echo "  Get from: https://linear.app/settings/account#api"
  required_failed=1
fi

if [ -n "$LINEAR_CLIENT_SECRET" ]; then
  echo "$check LINEAR_CLIENT_SECRET"
else
  echo "$cross LINEAR_CLIENT_SECRET"
  echo "  Get from: https://linear.app/settings/account#api"
  required_failed=1
fi

# Check optional environment variables
if [ -n "$LINEAR_API_KEY" ]; then
  echo "$check LINEAR_API_KEY"
else
  echo "$skip LINEAR_API_KEY (optional - for AI agents)"
fi

# Check Linear CLI (optional - only if LINEAR_API_KEY is set)
echo ""
echo "Linear CLI (optional):"
if [ -n "$LINEAR_API_KEY" ]; then
  if [ -f "lib/linear-cli.js" ]; then
    cli_output=$(node lib/linear-cli.js viewer 2>&1) || true
    if echo "$cli_output" | grep -q '"name"'; then
      user_name=$(echo "$cli_output" | grep -o '"name": *"[^"]*"' | head -1 | sed 's/"name": *"//' | sed 's/"$//')
      echo "$check Working - authenticated as $user_name"
    else
      echo "$cross Linear CLI failed"
      # Show first line of error for debugging
      error_line=$(echo "$cli_output" | head -1)
      if [ -n "$error_line" ]; then
        echo "  Error: $error_line"
      else
        echo "  Check your LINEAR_API_KEY is valid"
      fi
    fi
  else
    echo "$cross lib/linear-cli.js not found"
  fi
else
  echo "$skip Skipped (LINEAR_API_KEY not set)"
fi

exit $required_failed
