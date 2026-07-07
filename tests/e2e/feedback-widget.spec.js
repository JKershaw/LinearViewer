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

  // LIN-918 / LIN-1037: the foot offers three explicit actions (Save + triage was
  // restored in LIN-1037), and each posts its own `action` to the feedback route.
  // The local provider has no team (a real submit would 422), so we stub the route
  // to a 201 and assert the wiring — exactly which action the clicked button sends.
  test('offers save / triage / autopilot actions and posts the chosen action', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('feedback-fab').click()
    await expect(page.getByTestId('feedback-submit')).toBeVisible()
    await expect(page.getByTestId('feedback-submit-triage')).toBeVisible()
    await expect(page.getByTestId('feedback-submit-autopilot')).toBeVisible()

    // Capture the posted action and fulfil with a success the widget accepts.
    let postedAction = null
    await page.route(`**/workspace/${urlKey}/api/feedback`, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}')
      postedAction = body.action
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, issue: { identifier: 'LIN-777' } })
      })
    })

    // Save + triage posts action:'triage' (triage-and-park, not autopilot).
    await page.getByTestId('feedback-message').fill('please triage and park this')
    await page.getByTestId('feedback-submit-triage').click()

    await expect(page.getByTestId('feedback-status')).toContainText('Filed LIN-777')
    expect(postedAction).toBe('triage')
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

  // LIN-920: dropping a screenshot onto the drop zone must go through the same
  // intake path as the native picker — the selected-file chip appears with the
  // dropped filename and the remove control lights up.
  test('accepts a screenshot dropped onto the drop zone', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('feedback-fab').click()
    await expect(page.getByTestId('feedback-file-chip')).toBeHidden()

    await dropFileOnZone(page, { name: 'dropped.png', type: 'image/png', bytes: [1, 2, 3] })

    await expect(page.getByTestId('feedback-file-chip')).toBeVisible()
    await expect(page.getByTestId('feedback-file-name')).toHaveText('dropped.png')
    await expect(page.getByTestId('feedback-file-remove')).toBeVisible()
  })

  // LIN-920: a dropped file cannot bypass the picker's 7MB cap — the shared
  // intake path rejects it with the same error and selects nothing.
  test('rejects an oversized dropped image with the same cap as the picker', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('feedback-fab').click()

    // 7MB + 1 byte — one over MAX_IMAGE_BYTES.
    await dropFileOnZone(page, { name: 'huge.png', type: 'image/png', size: 7 * 1024 * 1024 + 1 })

    await expect(page.getByTestId('feedback-status')).toContainText('too large')
    await expect(page.getByTestId('feedback-file-chip')).toBeHidden()
    await expect(page.getByTestId('feedback-file-remove')).toBeHidden()
  })

  // LIN-920: pasting an image into the open popup routes through the same intake
  // path (e.g. right after a screenshot-to-clipboard capture).
  test('accepts a screenshot pasted into the popup', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('feedback-fab').click()
    await expect(page.getByTestId('feedback-file-chip')).toBeHidden()

    await page.getByTestId('feedback-popup').evaluate((popup) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([1, 2, 3])], 'pasted.png', { type: 'image/png' }))
      popup.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }))
    })

    await expect(page.getByTestId('feedback-file-chip')).toBeVisible()
    await expect(page.getByTestId('feedback-file-name')).toHaveText('pasted.png')
  })
})

// Synthesize a drag-and-drop of a single file onto the drop zone. Builds a real
// DataTransfer + File in the page so the widget's `dragCarriesFiles` / `drop`
// handlers see the same shape a browser would deliver. Pass `size` to fabricate
// an oversize file without allocating its bytes, or `bytes` for exact content.
async function dropFileOnZone(page, { name, type, bytes, size }) {
  await page.getByTestId('feedback-drop').evaluate((zone, spec) => {
    const content = spec.size != null
      ? new Uint8Array(spec.size)
      : new Uint8Array(spec.bytes || [])
    const file = new File([content], spec.name, { type: spec.type })
    const dt = new DataTransfer()
    dt.items.add(file)
    zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }))
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
  }, { name, type, bytes, size })
}

// Enable the flag via the footer toggle and land on a reloaded page with the
// widget mounted.
async function enableWidget(page, urlKey) {
  await page.goto(`/workspace/${urlKey}/`)
  await page.waitForLoadState('networkidle')
  await page.getByTestId('footer-feedback-toggle').click()
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('feedback-fab')).toBeVisible()
}
