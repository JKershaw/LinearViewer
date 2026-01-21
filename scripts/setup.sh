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

# Install Playwright browsers if needed
# Extract expected chromium path from dry-run and check if it exists
chromium_path=$(npx playwright install chromium --dry-run 2>&1 | grep -m1 "Install location:" | awk '{print $3}')
if [ -n "$chromium_path" ] && [ ! -d "$chromium_path" ]; then
  echo "Installing Playwright browsers..."
  npx playwright install chromium --with-deps
  echo ""
fi

# Run the environment check to show status
npm run env:check
