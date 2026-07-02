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

  // The E2E server runs with NO GitHub env configured, so the add affordance is
  // honestly disabled — not a live button that would 503/hang on click. This is the
  // end-to-end proof of LIN-761 root cause C (the settings promise must match what
  // /auth/github can deliver). The live-when-configured path is covered by the
  // render-settings unit tests (githubEnabled: true).
  test('disables the GitHub add source with an honest reason when GitHub is unconfigured (LIN-761)', async ({ page }) => {
    const githubAdd = page.locator('[data-testid="settings-provider-add-github"]')
    await expect(githubAdd).toBeVisible()
    await expect(githubAdd).toHaveClass(/provider-add-blocked/)
    await expect(githubAdd).toContainText('not configured on this server')
    // No live add button — a blocked row carries no form/button.
    await expect(githubAdd.locator('button')).toHaveCount(0)
  })

  test('disables the GitHub Projects add source with an honest reason when GitHub is unconfigured (LIN-761)', async ({ page }) => {
    const projectsAdd = page.locator('[data-testid="settings-provider-add-github-projects"]')
    await expect(projectsAdd).toBeVisible()
    await expect(projectsAdd).toContainText('GitHub Projects')
    await expect(projectsAdd).toHaveClass(/provider-add-blocked/)
    await expect(projectsAdd).toContainText('not configured on this server')
    await expect(projectsAdd.locator('button')).toHaveCount(0)
  })

  test('disables the Linear add source as a stopgap (blocked on LIN-544, LIN-735)', async ({ page }) => {
    const linearAdd = page.locator('[data-testid="settings-provider-add-linear"]')
    await expect(linearAdd).toBeVisible()
    // Blocked, not a live add button — it used to silently create/switch to a
    // separate workspace, which is the LIN-735 Symptom 1 bug.
    await expect(linearAdd).toContainText('blocked on LIN-544')
    await expect(linearAdd.locator('button')).toHaveCount(0)
  })

  test('refresh / test validates the binding and reports success', async ({ page }) => {
    await page.locator('[data-testid="settings-provider-binding"][data-provider="local"] [data-testid="settings-provider-refresh"]').click()
    await page.waitForLoadState('networkidle')
    const notice = page.locator('[data-testid="settings-provider-notice"]')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('local credentials are valid')
  })

  test('switch re-points the active provider and persists across reload (LIN-717)', async ({ page, seedLocal }) => {
    // Seed a coexisting second binding (GitHub) alongside the active local one.
    ({ urlKey } = await seedLocal(null, {
      extraBindings: [
        { provider: 'github', scope: 'octo/repo', credentials: { token: 'gh-install-tok', installationId: '99', tokenExpiresAt: Number.MAX_SAFE_INTEGER } },
      ],
    }))
    await page.goto(`/workspace/${urlKey}/settings`)
    await page.waitForLoadState('networkidle')

    const localBinding = page.locator('[data-testid="settings-provider-binding"][data-provider="local"]')
    const githubBinding = page.locator('[data-testid="settings-provider-binding"][data-provider="github"]')

    // Both bindings coexist; local is active (●), GitHub offers "make active".
    await expect(localBinding.locator('.provider-active')).toBeVisible()
    await expect(githubBinding.locator('.provider-active')).toHaveCount(0)
    await expect(githubBinding.locator('[data-testid="settings-provider-activate"]')).toBeVisible()

    // Switch the active provider to GitHub.
    await githubBinding.locator('[data-testid="settings-provider-activate"]').click()
    await page.waitForLoadState('networkidle')

    await expect(page.locator('[data-testid="settings-provider-notice"]')).toContainText('Switched active provider to github')
    // Active marker now tracks GitHub; local exposes the switch instead.
    await expect(githubBinding.locator('.provider-active')).toBeVisible()
    await expect(localBinding.locator('.provider-active')).toHaveCount(0)
    await expect(localBinding.locator('[data-testid="settings-provider-activate"]')).toBeVisible()

    // Persisted: a fresh load keeps GitHub active.
    await page.goto(`/workspace/${urlKey}/settings`)
    await page.waitForLoadState('networkidle')
    await expect(githubBinding.locator('.provider-active')).toBeVisible()
    await expect(localBinding.locator('.provider-active')).toHaveCount(0)
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
