import { test, expect } from '../fixtures/test-base.js'

// Provider-management section on the settings page (LIN-634). Rides the local
// provider harness (`seedLocal`) so the workspace has a REAL `local` binding to
// inspect/remove/refresh — navigation drives off the urlKey seedLocal returns
// (parallel-aware caller discipline, LIN-625).

test.describe('Settings — Providers section (LIN-634)', () => {
  let urlKey

  test.beforeEach(async ({ page, seedLocal }) => {
    ({ urlKey } = await seedLocal())
    await page.goto(`/workspace/${urlKey}/settings`)
    await page.waitForLoadState('networkidle')
  })

  test('renders the Providers section with the workspace binding', async ({ page }) => {
    await expect(page.locator('[data-testid="settings-section-providers"]')).toBeVisible()
    const binding = page.locator('[data-testid="settings-provider-binding"][data-provider="local"]')
    await expect(binding).toBeVisible()
    // Local token is the partition key, not a masked secret.
    await expect(binding).toContainText('(partition key)')
    // Active marker present for the sole binding.
    await expect(binding.locator('.provider-active')).toBeVisible()
  })

  test('offers GitHub as a live add source (unblocked, LIN-541)', async ({ page }) => {
    const githubAdd = page.locator('[data-testid="settings-provider-add-github"]')
    await expect(githubAdd).toBeVisible()
    // No longer blocked — a real add button is rendered that POSTs to the add flow.
    await expect(githubAdd).not.toContainText('blocked')
    await expect(githubAdd.locator('button')).toHaveCount(1)
  })

  test('refresh / test validates the binding and reports success', async ({ page }) => {
    await page.locator('[data-testid="settings-provider-binding"][data-provider="local"] [data-testid="settings-provider-refresh"]').click()
    await page.waitForLoadState('networkidle')
    const notice = page.locator('[data-testid="settings-provider-notice"]')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('local credentials are valid')
  })

  test('remove unlinks the binding and persists across reload', async ({ page }) => {
    await page.locator('[data-testid="settings-provider-binding"][data-provider="local"] [data-testid="settings-provider-remove"]').click()
    await page.waitForLoadState('networkidle')

    // Notice confirms removal and the binding is gone.
    await expect(page.locator('[data-testid="settings-provider-notice"]')).toContainText('Removed local binding')
    await expect(page.locator('[data-testid="settings-provider-binding"][data-provider="local"]')).toHaveCount(0)

    // Persisted: a fresh load still shows no local binding.
    await page.goto(`/workspace/${urlKey}/settings`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-testid="settings-provider-binding"][data-provider="local"]')).toHaveCount(0)
  })
})
