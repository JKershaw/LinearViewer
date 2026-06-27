import { test, expect } from '../fixtures/test-base.js'

// Persisted global theme toggle (LIN-756). Verifies the full foundation loop:
// the Appearance control switches the live theme instantly, writes localStorage,
// persists durably (active marker survives a reload), and — the core "Done when" —
// the pre-paint bootstrap re-applies the theme on the NEXT page with no FOUC.

test.describe('Theme toggle (LIN-756)', () => {
  let urlKey

  test.beforeEach(async ({ page, seedLocal }) => {
    ({ urlKey } = await seedLocal())
    await page.goto(`/workspace/${urlKey}/settings`)
    await page.waitForLoadState('networkidle')
  })

  test('Appearance control renders all three theme options, light active by default', async ({ page }) => {
    await expect(page.locator('[data-testid="settings-theme-control"]')).toBeVisible()
    await expect(page.locator('[data-theme-option="light"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-theme-option="dark"]')).toBeVisible()
    await expect(page.locator('[data-theme-option="amber"]')).toBeVisible()
  })

  test('selecting dark applies the theme instantly and writes localStorage', async ({ page }) => {
    await page.locator('[data-theme-option="dark"]').click()

    // Applied to <html> immediately (no reload).
    await expect(page.locator('html')).toHaveClass('theme-dark')
    const stored = await page.evaluate(() => localStorage.getItem('theme'))
    expect(stored).toBe('dark')
  })

  test('the chosen theme persists across navigation with no FOUC', async ({ page }) => {
    await page.locator('[data-theme-option="amber"]').click()
    await expect(page.locator('html')).toHaveClass('theme-amber')

    // Navigate to a different page — the pre-paint bootstrap must re-apply it.
    await page.goto(`/workspace/${urlKey}/`)
    await expect(page.locator('html')).toHaveClass('theme-amber')
  })

  test('the active marker is restored on reload (synced to the effective theme)', async ({ page }) => {
    await page.locator('[data-theme-option="dark"]').click()
    await page.waitForLoadState('networkidle')

    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-theme-option="dark"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('switching back to light clears the theme class', async ({ page }) => {
    await page.locator('[data-theme-option="dark"]').click()
    await expect(page.locator('html')).toHaveClass('theme-dark')

    await page.locator('[data-theme-option="light"]').click()
    await expect(page.locator('html')).toHaveClass('')
    const stored = await page.evaluate(() => localStorage.getItem('theme'))
    expect(stored).toBe('light')
  })
})
