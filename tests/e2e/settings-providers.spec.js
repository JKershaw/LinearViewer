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

  test('offers a LIVE Linear add-source affordance with honest copy (LIN-1351)', async ({ page }) => {
    const linearAdd = page.locator('[data-testid="settings-provider-add-linear"]')
    await expect(linearAdd).toBeVisible()
    // Live add-source (not the old LIN-544 stopgap): a real add button that begins
    // mode:'add-source', plus honest copy that a 2nd Linear org is its own workspace.
    await expect(linearAdd).not.toHaveClass(/provider-add-blocked/)
    await expect(linearAdd).not.toContainText('blocked on LIN-544')
    await expect(linearAdd).toContainText('connects another Linear organization')
    await expect(linearAdd.locator('button')).toHaveCount(1)
  })

  // LIN-1885 Phase 1: Jira's add flow needs no GITHUB_* config (it is its own
  // API-token Basic-auth flow, unrelated to the GitHub App), so it is live
  // regardless of the GitHub-unconfigured environment this suite runs under —
  // unlike the two GitHub rows above.
  test('offers a LIVE Jira add-source affordance (LIN-1885)', async ({ page }) => {
    const jiraAdd = page.locator('[data-testid="settings-provider-add-jira"]')
    await expect(jiraAdd).toBeVisible()
    await expect(jiraAdd).toContainText('Jira')
    await expect(jiraAdd).not.toHaveClass(/provider-add-blocked/)
    await expect(jiraAdd.locator('button')).toHaveCount(1)
  })

  test('the Jira add form posts to the providers/add route, which redirects to the GET link form (LIN-1885)', async ({ page }) => {
    // The add button POSTs .../settings/providers/add with provider=jira;
    // server.js redirects that to GET /auth/jira?workspace=<urlKey> (the
    // API-token link form), never an OAuth ?mode=add-source URL — Jira has no
    // redirect round-trip to carry session `mode` intent across.
    await page.locator('[data-testid="settings-provider-add-jira"] button').click()
    await page.waitForLoadState('networkidle')
    const url = new URL(page.url())
    expect(url.pathname).toBe('/auth/jira')
    expect(url.searchParams.get('workspace')).toBe(urlKey)
    await expect(page.locator('[data-testid="jira-link-form"]')).toBeVisible()
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
