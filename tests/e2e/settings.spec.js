import { test, expect } from '../fixtures/test-base.js'
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js'
import { SELECTORS, nav, settings, revokeKeyInPlace } from '../helpers.js'

// Proof-of-pattern spec for LIN-215: brittle `:has-text()` / class / href
// selectors here are migrated to the stable `data-testid` selectors and page
// objects in `tests/helpers.js`. Seeding still rides the provider harness
// (`seedLocal`); navigation drives off the urlKey it returns, not a
// hard-coded literal (parallel-aware caller discipline for LIN-625).

// LIN-3846: Settings is a page per area; each test opens the area it is about.
test.describe('Settings Page', () => {
  let urlKey
  test.beforeEach(async ({ seedLocal }) => {
    ({ urlKey } = await seedLocal())
  })
  const openArea = async (page, area) => {
    await settings(page).gotoArea(urlKey, area)
    await page.waitForLoadState('networkidle')
  }

  test('renders the list of areas with a state for each, in two groups (LIN-3846)', async ({ page }) => {
    await page.goto(`/workspace/${urlKey}/settings`)
    await expect(page.locator('h1').first()).toContainText('Settings')
    const nav = page.getByTestId('settings-nav')
    await expect(nav).toContainText('Workspace')
    await expect(nav).toContainText('You')
    for (const area of ['sources', 'models', 'running', 'agent-access', 'health', 'change-log', 'features', 'account']) {
      await expect(page.getByTestId(`settings-nav-${area}`)).toBeVisible()
      await expect(page.getByTestId(`settings-state-${area}`)).not.toBeEmpty()
    }
  })

  test('has header view-switcher links', async ({ page }) => {
    await openArea(page, 'account')
    // Cross-view links moved from the footer into the shared header switcher
    // (LIN-978); settings is the current page so it renders as the bold current.
    await expect(nav(page).getView('swipe')).toBeVisible()
    await expect(nav(page).getView('swim')).toBeVisible()
    await expect(nav(page).getView('settings')).toBeVisible()
  })

  test('has Account section with logout', async ({ page }) => {
    await openArea(page, 'account')
    await expect(settings(page).section('account')).toBeVisible()
    const logoutLink = settings(page).logout()
    await expect(logoutLink).toBeVisible()
    await expect(logoutLink).toContainText('logout')
  })

  test('offers the email add affordance in the Account section (LIN-1892 S3-3)', async ({ page }) => {
    // The Playwright server runs the capture transport, so email sign-in is
    // available and a local (email-less) account is offered the link-mode add.
    await openArea(page, 'account')
    const add = page.getByTestId('settings-account-add-email')
    await expect(add).toBeVisible()
    await expect(add).toContainText('Add email')
    await expect(add).toHaveAttribute('href', /\/auth\/email\/register\?next=/)
  })

  test('shows workspace dropdown in nav', async ({ page }) => {
    await openArea(page, 'account')
    const workspaceToggle = page.locator('#workspace-toggle')
    await expect(workspaceToggle).toBeVisible()
    await expect(workspaceToggle).toContainText('Local Workspace')
  })

  test('shows the AI usage KPI section (LIN-418)', async ({ page }) => {
    // No LLM calls in a fresh local workspace → empty state.
    await openArea(page, 'health')
    await expect(settings(page).section('ai-usage')).toContainText('none recorded yet')
  })

  test('toggling a feature flips its state', async ({ page }) => {
    // roadmap is off by default (LIN-3849: dispatch is no longer a switch). The
    // ● / ○ glyphs make the assertion robust against feature description text
    // that merely contains "on"/"off".
    await openArea(page, 'features')
    await expect(settings(page).toggle('roadmap')).toContainText('○ off')

    await settings(page).toggleFeature('roadmap')
    await page.waitForLoadState('networkidle')

    await expect(settings(page).toggle('roadmap')).toContainText('● on')
  })
})

// LIN-1892 S3-3 / G3 (round-3): the Settings email surface is threaded from the
// REAL route (`server.js` `accountEmails`) to the rendered page — not passed in
// by hand at store+renderer level. The Playwright server runs the capture
// transport, so a real email sign-in gives the account an email identity; the
// /test local harness then attaches a workspace to that SAME live account
// (`establishAccount` links the local identity onto the existing accountId).
// This is the test the `accountEmails: []` mutant must fail.
test.describe('Settings account email threading (LIN-1892 S3-3, G3)', () => {
  test('an account holding an email shows it in Settings and offers no add link', async ({ page, request, seedLocal }) => {
    const email = `settings-g3-${Date.now()}@example.test`;

    // Sign in by email on the capture transport → an email-only account P.
    await page.goto('/auth/email');
    await page.getByTestId('email-signin-address').fill(email);
    await page.getByTestId('email-signin-submit').click();
    await expect(page.getByTestId('email-check-inbox')).toBeVisible();
    const outbox = await request.get(`/test/email-outbox?to=${encodeURIComponent(email)}`);
    expect(outbox.status()).toBe(200);
    const message = await outbox.json();
    const link = message.text.match(/https?:\/\/[^\s]+\/auth\/email\/confirm\?t=[A-Za-z0-9_-]+/)[0];
    await page.goto(link);
    await page.getByTestId('email-confirm-submit').click();
    await expect(page).toHaveURL(/\/account$/);

    // Give the SAME account a workspace: the local harness links its local
    // identity onto the live accountId rather than replacing the account.
    const { urlKey } = await seedLocal();

    await page.goto(`/workspace/${urlKey}/settings/account`);
    await expect(page.getByTestId('settings-account-emails')).toContainText(email);
    await expect(page.getByTestId('settings-account-add-email')).toHaveCount(0);
  });
})

test.describe('Token Management', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${localWorkerUrlKey}`)
    await seedLocal(undefined, { runnerKey: true })
    // LIN-3137 J5: the mint is owner-only — seed the owner edge explicitly.
    await seedWorkspaceOwnership(page, localWorkerUrlKey)
    await page.goto(`/workspace/${localWorkerUrlKey}/dispatch`)
    await page.waitForLoadState('networkidle')
  })

  test('shows Tokens section on dispatch page', async ({ page }) => {
    await expect(page.locator(SELECTORS.dispatchSection('tokens')).locator('h2', { hasText: 'Tokens' })).toBeVisible()
  })

  test('shows token create form', async ({ page }) => {
    await expect(page.locator('#create-token-form')).toBeVisible()
    await expect(page.locator('.token-label-input')).toBeVisible()
    await expect(page.locator('#create-token-form button[type="submit"]')).toBeVisible()
  })

  // LIN-3846: the list of keys is Settings › Agent access; this page links to it.
  const keyRows = (page) => page.getByTestId('settings-key-dispatch')
  const openKeys = async (page, localWorkerUrlKey) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/agent-access`)
    await page.waitForLoadState('networkidle')
  }

  test('links to the key list instead of listing keys itself', async ({ page, localWorkerUrlKey }) => {
    await expect(page.getByTestId('dispatch-keys-link')).toBeVisible()
    await expect(page.locator(SELECTORS.settings.keyRows)).toHaveCount(0)
    await openKeys(page, localWorkerUrlKey)
    await expect(keyRows(page)).toHaveCount(0)
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

  test('created token appears in list', async ({ page, localWorkerUrlKey }) => {
    await page.fill('.token-label-input', 'listed-token')
    await page.click('#create-token-form button[type="submit"]')

    // LIN-3618: the mint modal shows the expiry from the 201 body
    // ('never expires' also contains 'expires', so pin the dated form)
    await expect(page.locator('.token-modal')).toContainText('This token expires')
    await expect(page.locator('.token-modal')).not.toContainText('never expires')

    // Close modal
    await page.click('.token-modal-close')

    // Token should be in the key list on Settings › Agent access
    await openKeys(page, localWorkerUrlKey)
    await expect(keyRows(page)).toHaveCount(1)
    await keyRows(page).locator(':scope > summary').click()
    await expect(keyRows(page)).toContainText('listed-token')
    // LIN-3618: a new token carries a 90-day expiry and the list shows it
    await expect(keyRows(page)).toContainText(/expires in \d+d/)
  })

  test('can revoke a token', async ({ page, localWorkerUrlKey }) => {
    // Create a token first
    await page.fill('.token-label-input', 'to-revoke')
    await page.click('#create-token-form button[type="submit"]')
    await page.click('.token-modal-close')

    // Verify token is in the list
    await openKeys(page, localWorkerUrlKey)
    await expect(keyRows(page)).toHaveCount(1)

    // Revoke it: the button lives inside the opened row (the in-place confirmation, no dialog)
    await keyRows(page).locator(':scope > summary').click()
    await revokeKeyInPlace(keyRows(page))

    // The list no longer has it
    await expect(keyRows(page)).toHaveCount(0)
  })

  test('shows multiple tokens in list', async ({ page, localWorkerUrlKey }) => {
    // Create first token
    await page.fill('.token-label-input', 'token-one')
    await page.click('#create-token-form button[type="submit"]')
    await page.click('.token-modal-close')

    // Create second token
    await page.fill('.token-label-input', 'token-two')
    await page.click('#create-token-form button[type="submit"]')
    await page.click('.token-modal-close')

    // Both should appear
    await openKeys(page, localWorkerUrlKey)
    await expect(keyRows(page)).toHaveCount(2)
  })

  test('token list shows "never used" for new tokens', async ({ page, localWorkerUrlKey }) => {
    await page.fill('.token-label-input', 'unused-token')
    await page.click('#create-token-form button[type="submit"]')
    await page.click('.token-modal-close')

    await openKeys(page, localWorkerUrlKey)
    await expect(keyRows(page)).toBeVisible()
    await expect(keyRows(page)).toContainText('never used')
  })
})

test.describe('Token API Integration', () => {
  test.beforeEach(async ({ page, seedLocal, localWorkerUrlKey }) => {
    await page.goto(`/test/clear-dispatch-tokens?urlKey=${localWorkerUrlKey}`)
    await seedLocal(undefined, { runnerKey: true })
  })

  test('created token works with consumer API', async ({ page, request, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/dispatch`)
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

  test('revoked token stops working', async ({ page, request, localWorkerUrlKey }) => {
    await page.goto(`/workspace/${localWorkerUrlKey}/dispatch`)
    await page.waitForLoadState('networkidle')

    // Create and capture token
    await page.click('#create-token-form button[type="submit"]')
    const tokenValue = await page.locator('.token-value').textContent()
    await page.click('.token-modal-close')

    // The token is in the key list on Settings › Agent access
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/agent-access`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('settings-key-dispatch')).toBeVisible()

    // Verify it works
    let response = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${tokenValue}` }
    })
    expect(response.status()).toBe(200)

    // Revoke via UI (the button is inside the opened row; the owner may revoke a queue token)
    await seedWorkspaceOwnership(page, localWorkerUrlKey)
    await page.goto(`/workspace/${localWorkerUrlKey}/settings/agent-access`)
    await page.getByTestId('settings-key-dispatch').locator(':scope > summary').click()
    await revokeKeyInPlace(page.getByTestId('settings-key-dispatch'))

    // Wait for revoke to complete
    await expect(page.getByTestId('settings-key-dispatch')).toHaveCount(0)

    // Verify it no longer works
    response = await request.get('/api/dispatch/poll', {
      headers: { 'Authorization': `Bearer ${tokenValue}` }
    })
    expect(response.status()).toBe(401)
  })
})
