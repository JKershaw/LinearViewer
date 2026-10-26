/**
 * LIN-3952 item 6: the No job (Dispatch suggestion) section on the Dispatch page. It saves its model and effort with a
 * reason, through the same save Models uses, and reads them back on the page. A refusal comes back to Dispatch.
 *
 * Run with: npx playwright test tests/e2e/dispatch-no-job.spec.js
 */
import { test, expect } from '../fixtures/test-base.js'

test.describe('Dispatch: the No job suggestion (LIN-3952)', () => {
  let urlKey
  test.beforeEach(async ({ seedLocal }) => {
    ;({ urlKey } = await seedLocal())
  })

  test('the section saves its model and effort with a reason, and reads them back on Dispatch', async ({ page }) => {
    await page.goto(`/workspace/${urlKey}/dispatch`)
    const section = page.locator('[data-testid="dispatch-no-job"]')
    await expect(section).toBeVisible()
    await section.locator('input[data-decision-field="model"]').fill('sonnet')
    await section.locator('select[data-decision-field="harness"]').selectOption('claude-code')
    await section.locator('select[data-decision-field="effort"]').selectOption('high')
    await section.locator('input[name="reason"]').fill('suggest sonnet on Dispatch')
    await section.locator('[data-testid="dispatch-no-job-save"]').click()

    await expect(page.locator('[data-testid="dispatch-no-job-notice"]')).toContainText('Saved.')
    await expect(page.locator('[data-testid="dispatch-no-job"] select[data-decision-field="effort"]')).toHaveValue('high')
  })

  test('a save with no reason comes back to Dispatch, and says so there', async ({ page }) => {
    await page.goto(`/workspace/${urlKey}/dispatch`)
    const section = page.locator('[data-testid="dispatch-no-job"]')
    await section.locator('input[data-decision-field="model"]').fill('sonnet')
    // The reason is required in the browser; drop the attribute so the server's own refusal is what shows.
    await section.locator('input[name="reason"]').evaluate((el) => { el.removeAttribute('required') })
    await section.locator('[data-testid="dispatch-no-job-save"]').click()
    await expect(page.locator('[data-testid="dispatch-no-job-notice"]')).toContainText('Save needs a reason')
    await expect(page).toHaveURL(/\/dispatch\?no_job_error=REASON_REQUIRED$/)
  })
})
