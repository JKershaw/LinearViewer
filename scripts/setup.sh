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
# Try with system deps first; fall back to browser-only if that fails (e.g., no sudo)
if ! npx playwright install chromium --with-deps; then
  echo "Note: Could not install system dependencies, installing browser only..."
  npx playwright install chromium
fi

# Run the environment check to show status
npm run env:check
