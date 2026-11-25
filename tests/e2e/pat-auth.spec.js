import { test, expect } from '../fixtures/test-base.js'
import { SELECTORS } from '../helpers.js'

test.describe('PAT Authentication Mode', () => {
  // Bound per-test from the per-worker key so session + nav stay partition-aligned.
  let WORKSPACE_URL
  let SETTINGS_URL

  test.beforeEach(async ({ page, workerUrlKey }) => {
    WORKSPACE_URL = `/workspace/${workerUrlKey}/`
    SETTINGS_URL = `/workspace/${workerUrlKey}/settings/account`
    await page.goto(`/test/set-session?patMode=true&urlKey=${workerUrlKey}`)
  })

  test('PAT workspace hides Linear +add but shows local-create in workspace dropdown', async ({ page }) => {
    await page.goto(WORKSPACE_URL)
    await page.waitForLoadState('networkidle')

    // Open workspace dropdown (LIN-4563: Home's is the rail's workspace menu)
    await page.locator(SELECTORS.nav.workspaceToggle).click()
    await expect(page.locator(SELECTORS.nav.workspaceMenu)).toBeVisible()

    // The Linear +add link should not be present (OAuth may not be configured).
    // Scoped to Linear's own testid: Jira's add row is not PAT-gated and still
    // renders here (the shared Playwright webServer configures Jira for the
    // whole run, LIN-2802), so a bare add-row count is not 0.
    await expect(page.locator('[data-testid="rail-workspace-add-linear"]')).toHaveCount(0)

    // But local-workspace onboarding is auth-independent (LIN-377): it stays
    // available even in PAT mode.
    await expect(page.locator('[data-testid="rail-workspace-add-local"]')).toContainText('+ Local workspace')
  })

  test('PAT workspace hides remove button in workspace dropdown', async ({ page }) => {
    await page.goto(WORKSPACE_URL)
    await page.waitForLoadState('networkidle')

    // Open workspace dropdown (LIN-4563: Home's is the rail's workspace menu, which never offers remove)
    await page.locator(SELECTORS.nav.workspaceToggle).click()
    await expect(page.locator(SELECTORS.nav.workspaceMenu)).toBeVisible()

    // The remove button should not be present
    await expect(page.locator('.nav-option-danger')).toHaveCount(0)
    await expect(page.locator(`${SELECTORS.nav.workspaceMenu} [action$="/remove"]`)).toHaveCount(0)
  })

  test('settings page shows "refresh session" instead of "logout"', async ({ page }) => {
    await page.goto(SETTINGS_URL)
    await page.waitForLoadState('networkidle')

    const sessionLink = page.locator('a[href="/logout"]')
    await expect(sessionLink).toBeVisible()
    await expect(sessionLink).toContainText('refresh session')
  })

  test('settings page shows PAT mode indicator', async ({ page }) => {
    await page.goto(SETTINGS_URL)
    await page.waitForLoadState('networkidle')

    await expect(page.locator('text=PAT mode')).toBeVisible()
  })

  test('dashboard renders normally in PAT mode', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}backlog`)
    await page.waitForLoadState('networkidle')

    // Should show projects from mock data
    await expect(page.locator('.project-header:has-text("Project Alpha")')).toBeVisible()
    await expect(page.locator('.project-header:has-text("Project Beta")')).toBeVisible()
  })
})
