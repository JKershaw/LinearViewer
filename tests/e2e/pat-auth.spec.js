import { test, expect } from '../fixtures/test-base.js'

const TEST_WORKSPACE_URL_KEY = 'test-workspace'
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`
const SETTINGS_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/settings`

test.describe('PAT Authentication Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session?patMode=true')
  })

  test('PAT workspace hides Linear +add but shows local-create in workspace dropdown', async ({ page }) => {
    await page.goto(WORKSPACE_URL)
    await page.waitForLoadState('networkidle')

    // Open workspace dropdown
    const workspaceToggle = page.locator('#workspace-toggle')
    await workspaceToggle.click()

    // The Linear +add link should not be present (OAuth may not be configured)
    await expect(page.locator('.nav-option-add')).toHaveCount(0)

    // But local-workspace onboarding is auth-independent (LIN-377): it stays
    // available even in PAT mode.
    await expect(page.locator('.nav-option-add-local')).toContainText('+local workspace')
  })

  test('PAT workspace hides remove button in workspace dropdown', async ({ page }) => {
    await page.goto(WORKSPACE_URL)
    await page.waitForLoadState('networkidle')

    // Open workspace dropdown
    const workspaceToggle = page.locator('#workspace-toggle')
    await workspaceToggle.click()

    // The remove button should not be present
    await expect(page.locator('.nav-option-danger')).toHaveCount(0)
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
    await page.goto(WORKSPACE_URL)
    await page.waitForLoadState('networkidle')

    // Should show projects from mock data
    await expect(page.locator('.project-header:has-text("Project Alpha")')).toBeVisible()
    await expect(page.locator('.project-header:has-text("Project Beta")')).toBeVisible()
  })
})
