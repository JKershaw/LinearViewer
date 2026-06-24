import { test, expect } from '../fixtures/test-base.js'
import { seedLocalWorkspace, LOCAL_WORKSPACE_URL_KEY } from '../fixtures/local-harness.js'
import { footer, settings } from '../helpers.js'

// Proof-of-pattern spec for LIN-215: brittle `:has-text()` / class / href
// selectors here are migrated to the stable `data-testid` selectors and page
// objects in `tests/helpers.js`. Seeding still rides the provider harness
// (`seedLocalWorkspace`); navigation drives off the urlKey it returns, not a
// hard-coded literal (parallel-aware caller discipline for LIN-625).
const TEST_WORKSPACE_URL_KEY = LOCAL_WORKSPACE_URL_KEY

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    const { urlKey } = await seedLocalWorkspace(page)
    await page.goto(`/workspace/${urlKey}/settings`)
    await page.waitForLoadState('networkidle')
  })

  test('renders settings page with title and sections', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Settings')
    await expect(settings(page).section('ai')).toContainText('AI')
  })

  test('has footer navigation links', async ({ page }) => {
    await expect(footer(page).getLink('swipe')).toBeVisible()
    await expect(footer(page).getLink('swim')).toBeVisible()
    await expect(footer(page).getLink('settings')).toBeVisible()
  })

  test('has Account section with logout', async ({ page }) => {
    await expect(settings(page).section('account')).toBeVisible()
    const logoutLink = settings(page).logout()
    await expect(logoutLink).toBeVisible()
    await expect(logoutLink).toContainText('logout')
  })

  test('shows workspace dropdown in nav', async ({ page }) => {
    const workspaceToggle = page.locator('#workspace-toggle')
    await expect(workspaceToggle).toBeVisible()
    await expect(workspaceToggle).toContainText('Local Workspace')
  })

  test('shows the AI usage KPI section (LIN-418)', async ({ page }) => {
    // No LLM calls in a fresh local workspace → empty state.
    await expect(settings(page).section('ai-usage')).toContainText('none recorded yet')
  })

  test('toggling a feature flips its state', async ({ page }) => {
    // dispatch is off by default. The ● / ○ glyphs make the assertion robust
    // against feature description text that merely contains "on"/"off".
    await expect(settings(page).toggle('dispatch')).toContainText('○ off')

    await settings(page).toggleFeature('dispatch')
    await page.waitForLoadState('networkidle')

    await expect(settings(page).toggle('dispatch')).toContainText('● on')
  })
})

test.describe('Token Management', () => {
  const DISPATCH_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/dispatch`

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${TEST_WORKSPACE_URL_KEY}`)
    await seedLocalWorkspace(page, undefined, { features: { dispatch: true } })
    await page.goto(DISPATCH_URL)
    await page.waitForLoadState('networkidle')
  })

  test('shows Tokens section on dispatch page', async ({ page }) => {
    await expect(page.locator('.dispatch-section-header:text-is("Tokens")')).toBeVisible()
  })

  test('shows token create form', async ({ page }) => {
    await expect(page.locator('#create-token-form')).toBeVisible()
    await expect(page.locator('.token-label-input')).toBeVisible()
    await expect(page.locator('#create-token-form button[type="submit"]')).toBeVisible()
  })

  test('shows empty state when no tokens', async ({ page }) => {
    await expect(page.locator('.token-list-empty')).toContainText('No tokens')
  })

  test('can create a token with label', async ({ page }) => {
    // Fill label and submit
    await page.fill('.token-label-input', 'my-test-token')
    await page.click('#create-token-form button[type="submit"]')

    // Modal should appear with token
    await expect(page.locator('.token-modal')).toBeVisible()
    await expect(page.locator('.token-value')).not.toBeEmpty()
  })

  test('can create a token without label', async ({ page }) => {
    // Submit without label (uses default)
    await page.click('#create-token-form button[type="submit"]')

    // Modal should appear
    await expect(page.locator('.token-modal')).toBeVisible()
  })

  test('token modal has copy button', async ({ page }) => {
    await page.click('#create-token-form button[type="submit"]')

    const copyBtn = page.locator('.token-copy-btn')
    await expect(copyBtn).toBeVisible()
    await expect(copyBtn).toHaveText('copy')
  })

  test('token modal shows usage hint', async ({ page }) => {
    await page.click('#create-token-form button[type="submit"]')

    await expect(page.locator('.token-usage-hint')).toContainText('Authorization')
    await expect(page.locator('.token-usage-hint code')).toContainText('Bearer')
  })

  test('can close token modal with X button', async ({ page }) => {
    await page.click('#create-token-form button[type="submit"]')
    await expect(page.locator('.token-modal')).toBeVisible()

    await page.click('.token-modal-close')
    await expect(page.locator('.token-modal')).not.toBeVisible()
  })

  test('can close token modal by clicking overlay', async ({ page }) => {
    await page.click('#create-token-form button[type="submit"]')
    await expect(page.locator('.token-modal')).toBeVisible()

    // Click on corner of overlay (not covered by centered modal)
    await page.locator('.token-modal-overlay').click({ position: { x: 10, y: 10 } })
    await expect(page.locator('.token-modal')).not.toBeVisible()
  })

  test('created token appears in list', async ({ page }) => {
    await page.fill('.token-label-input', 'listed-token')
    await page.click('#create-token-form button[type="submit"]')

    // Close modal
    await page.click('.token-modal-close')

    // Token should be in list
    await expect(page.locator('.token-item .token-label-text')).toContainText('listed-token')
    await expect(page.locator('.token-item .token-meta')).toContainText('created')
  })

  test('can revoke a token', async ({ page }) => {
    // Create a token first
    await page.fill('.token-label-input', 'to-revoke')
    await page.click('#create-token-form button[type="submit"]')
    await page.click('.token-modal-close')

    // Verify token is in list
    await expect(page.locator('.token-item')).toBeVisible()

    // Revoke it (accept confirmation dialog)
    page.on('dialog', dialog => dialog.accept())
    await page.click('.token-revoke')

    // Should show empty state again
    await expect(page.locator('.token-list-empty')).toContainText('No tokens')
  })

  test('shows multiple tokens in list', async ({ page }) => {
    // Create first token
    await page.fill('.token-label-input', 'token-one')
    await page.click('#create-token-form button[type="submit"]')
    await page.click('.token-modal-close')

    // Create second token
    await page.fill('.token-label-input', 'token-two')
    await page.click('#create-token-form button[type="submit"]')
    await page.click('.token-modal-close')

    // Both should appear
    const items = page.locator('.token-item')
    await expect(items).toHaveCount(2)
  })

  test('token list shows "never used" for new tokens', async ({ page }) => {
    await page.fill('.token-label-input', 'unused-token')
    await page.click('#create-token-form button[type="submit"]')
    await page.click('.token-modal-close')

    // Wait for token list to re-render after modal close
    await expect(page.locator('.token-item')).toBeVisible()
    await expect(page.locator('.token-meta')).toContainText('never used')
  })
})

test.describe('Token API Integration', () => {
  const DISPATCH_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/dispatch`

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${TEST_WORKSPACE_URL_KEY}`)
    await seedLocalWorkspace(page, undefined, { features: { dispatch: true } })
  })

  test('created token works with consumer API', async ({ page, request }) => {
    await page.goto(DISPATCH_URL)
    await page.waitForLoadState('networkidle')

    // Create token via UI
    await page.fill('.token-label-input', 'api-test')
    await page.click('#create-token-form button[type="submit"]')

    // Get token from modal
    const tokenValue = await page.locator('.token-value').textContent()
    await page.click('.token-modal-close')

    // Use token with consumer API
    const response = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${tokenValue}` }
    })
    expect(response.status()).toBe(200)
  })

  test('revoked token stops working', async ({ page, request }) => {
    await page.goto(DISPATCH_URL)
    await page.waitForLoadState('networkidle')

    // Create and capture token
    await page.click('#create-token-form button[type="submit"]')
    const tokenValue = await page.locator('.token-value').textContent()
    await page.click('.token-modal-close')

    // Wait for token list to re-render after modal close
    await expect(page.locator('.token-item')).toBeVisible()

    // Verify it works
    let response = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${tokenValue}` }
    })
    expect(response.status()).toBe(200)

    // Revoke via UI
    page.on('dialog', dialog => dialog.accept())
    await page.click('.token-revoke')

    // Wait for revoke to complete
    await expect(page.locator('.token-list-empty')).toBeVisible()

    // Verify it no longer works
    response = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${tokenValue}` }
    })
    expect(response.status()).toBe(401)
  })
})
