import { test, expect } from '../fixtures/test-base.js'

// Feedback widget client UX (LIN-635). Seeding rides the provider harness
// (`seedLocal`); navigation drives off the returned urlKey (parallel-aware
// caller discipline, LIN-625). The server submit→ticket→triage flow is covered
// by the unit route test (tests/unit/feedback-route.test.js) — the local
// provider has zero teams, so a full submit is out of scope here. This spec
// pins the client surface: footer toggle, hidden-by-default, popup open, and
// minimize-without-losing-input (localStorage draft survives reload).

test.describe('Feedback widget', () => {
  test('is hidden by default and toggles on from the footer', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await page.goto(`/workspace/${urlKey}/`)
    await page.waitForLoadState('networkidle')

    // Hidden by default — the floating button is not present until enabled.
    await expect(page.getByTestId('feedback-fab')).toHaveCount(0)

    const toggle = page.getByTestId('footer-feedback-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('data-enabled', 'false')

    // Toggling reloads the page; the FAB then appears.
    await toggle.click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByTestId('footer-feedback-toggle')).toHaveAttribute('data-enabled', 'true')
    await expect(page.getByTestId('feedback-fab')).toBeVisible()
  })

  test('opens a popup with message, priority, and screenshot fields', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('feedback-fab').click()
    await expect(page.getByTestId('feedback-popup')).toBeVisible()
    await expect(page.getByTestId('feedback-message')).toBeVisible()
    await expect(page.getByTestId('feedback-priority')).toBeVisible()
    await expect(page.getByTestId('feedback-file')).toBeVisible()
  })

  test('preserves draft input across minimize and reload', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('feedback-fab').click()
    await page.getByTestId('feedback-message').fill('Half-written feedback')
    await page.getByTestId('feedback-priority').selectOption('2')

    // Minimize — popup hides but nothing is lost.
    await page.getByTestId('feedback-minimize').click()
    await expect(page.getByTestId('feedback-popup')).toBeHidden()

    // Reopen — text is still there.
    await page.getByTestId('feedback-fab').click()
    await expect(page.getByTestId('feedback-message')).toHaveValue('Half-written feedback')

    // Survives a full reload (localStorage draft).
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.getByTestId('feedback-fab').click()
    await expect(page.getByTestId('feedback-message')).toHaveValue('Half-written feedback')
    await expect(page.getByTestId('feedback-priority')).toHaveValue('2')
  })
})

// Enable the flag via the footer toggle and land on a reloaded page with the
// widget mounted.
async function enableWidget(page, urlKey) {
  await page.goto(`/workspace/${urlKey}/`)
  await page.waitForLoadState('networkidle')
  await page.getByTestId('footer-feedback-toggle').click()
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('feedback-fab')).toBeVisible()
}
