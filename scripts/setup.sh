#!/bin/bash

# Auto-setup script for LinearViewer
# Installs missing dependencies and Playwright browsers, then runs env check

set -e

# Check and install node_modules
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
  echo ""
fi

# Check and install Playwright browsers
playwright_ok=0
if [ -d "node_modules/playwright-core/.local-browsers" ]; then
  playwright_ok=1
elif [ -d "$HOME/.cache/ms-playwright" ]; then
  playwright_ok=1
elif [ -d "/ms-playwright" ]; then
  playwright_ok=1
fi

if [ "$playwright_ok" -eq 0 ]; then
  echo "Installing Playwright browsers..."
  npx playwright install chromium --with-deps
  echo ""
fi

# Run the environment check to show status
npm run env:check
