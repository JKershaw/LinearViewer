#!/bin/bash

# Auto-setup script for LinearViewer
# Installs missing dependencies and Playwright browsers, then runs env check

set -e
trap 'echo "Setup failed at line $LINENO. Run the failed command manually for details."' ERR

# Check and install node_modules
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
  echo ""
fi

# Install Playwright browsers (idempotent - skips if correct version installed)
npx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium

# Run the environment check to show status
npm run env:check
