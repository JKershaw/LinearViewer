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

  // LIN-704: a selected screenshot must be removable (a native file input
  // cannot be cleared by the user), and a failed client-side read must not
  // dead-end the user on the same unreadable file.
  test('shows a remove control once a screenshot is selected and clears it', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('feedback-fab').click()
    const remove = page.getByTestId('feedback-file-remove')
    await expect(remove).toBeHidden()

    await page.getByTestId('feedback-file').setInputFiles({
      name: 'shot.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgo=', 'base64')
    })
    await expect(remove).toBeVisible()

    await remove.click()
    await expect(remove).toBeHidden()
    await expect(page.getByTestId('feedback-file')).toHaveValue('')
    await expect(page.getByTestId('feedback-status')).toHaveText('Screenshot removed.')
  })

  test('recovers from an unreadable screenshot: clears it and offers a retry path', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('feedback-fab').click()

    // Force the client-side FileReader read to fail, mimicking the device-side
    // NotReadableError an Android-Chrome content-provider read can throw — the
    // exact failure this ticket reproduces.
    await page.evaluate(() => {
      window.FileReader.prototype.readAsDataURL = function () {
        setTimeout(() => { if (this.onerror) this.onerror(new Event('error')) }, 0)
      }
    })

    await page.getByTestId('feedback-message').fill('Feedback with a bad screenshot')
    await page.getByTestId('feedback-file').setInputFiles({
      name: 'bad.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('not-a-real-image')
    })
    await expect(page.getByTestId('feedback-file-remove')).toBeVisible()

    await page.getByTestId('feedback-submit').click()

    // The error explains the problem and the recovery path; the unreadable file
    // is dropped (remove control hidden, input cleared) and Send is re-enabled
    // so the user is no longer stuck.
    await expect(page.getByTestId('feedback-status')).toContainText("Couldn't read that image")
    await expect(page.getByTestId('feedback-file-remove')).toBeHidden()
    await expect(page.getByTestId('feedback-file')).toHaveValue('')
    await expect(page.getByTestId('feedback-submit')).toBeEnabled()
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
