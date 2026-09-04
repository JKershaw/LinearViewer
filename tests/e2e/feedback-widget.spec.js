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

  // LIN-1132: the popup carries the shared model/harness exec-controls (the same
  // window.renderDispatchExecControls block the Dispatch page uses), and a
  // dispatching action forwards the entered override in its payload.
  test('forwards an entered model/harness override on a triage dispatch (LIN-1132)', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('feedback-fab').click()
    // The shared exec-controls render inside the popup.
    const exec = page.getByTestId('feedback-exec-controls')
    await expect(exec).toBeVisible()
    await expect(exec.locator('.dispatch-exec-model')).toBeVisible()
    await expect(exec.locator('.dispatch-exec-harness-select')).toBeVisible()

    let posted = null
    await page.route(`**/workspace/${urlKey}/api/feedback`, async (route) => {
      posted = JSON.parse(route.request().postData() || '{}')
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, issue: { identifier: 'LIN-778' } })
      })
    })

    await page.getByTestId('feedback-message').fill('use a specific model')
    await exec.locator('.dispatch-exec-model').fill('anthropic/claude-opus-4')
    await exec.locator('.dispatch-exec-harness-select').selectOption('opencode')
    await page.getByTestId('feedback-submit-triage').click()

    await expect(page.getByTestId('feedback-status')).toContainText('Filed LIN-778')
    expect(posted.action).toBe('triage')
    expect(posted.model).toBe('anthropic/claude-opus-4')
    expect(posted.harness).toBe('opencode')
  })

  // LIN-1132: Save files a ticket WITHOUT dispatching, so model/harness are
  // meaningless there — an entered override must not ride the Save payload.
  test('omits model/harness from a plain Save even when entered (LIN-1132)', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('feedback-fab').click()
    const exec = page.getByTestId('feedback-exec-controls')

    let posted = null
    await page.route(`**/workspace/${urlKey}/api/feedback`, async (route) => {
      posted = JSON.parse(route.request().postData() || '{}')
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, issue: { identifier: 'LIN-779' } })
      })
    })

    await page.getByTestId('feedback-message').fill('just save, no dispatch')
    await exec.locator('.dispatch-exec-model').fill('anthropic/claude-opus-4')
    await page.getByTestId('feedback-submit').click()

    await expect(page.getByTestId('feedback-status')).toContainText('Filed LIN-779')
    expect(posted.action).toBe('save')
    expect(posted.model).toBeUndefined()
    expect(posted.harness).toBeUndefined()
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

  // LIN-2299 — the shared footer's `feedback` toggle vs the fixed FAB.
  //
  // The irony this pins: the FAB covered the very control that dismisses it,
  // at the one scroll position a user is most likely to be at. Because both
  // are rendered from lib/components/footer.js, ONE sweep here covers the whole
  // ~30-page footer-bearing surface — which is what closes the remainder of the
  // LIN-2272 review's instance 3 ("no page other than live-console has any
  // geometry-sweep coverage for the FAB").
  //
  // A REAL RECT SWEEP at every scroll offset, never a computed-style assertion:
  // a style-value assertion is precisely what let LIN-2252's no-op pass CI
  // green, and the ticket calls that out by name. Measured before the fix at
  // main 54116d21: 19 overlapping offsets at 320px, 18 at 360, 18 at 390, 22 at
  // 430 — at 360 the toggle's right edge was 344.1 against the FAB's 344.0.
  test.describe('LIN-2299: the footer feedback toggle never sits under the FAB', () => {
    for (const width of [320, 360, 390, 430]) {
      test(`no overlap at any scroll offset (${width}px)`, async ({ page, seedLocal }) => {
        const { urlKey } = await seedLocal()
        await page.setViewportSize({ width, height: 844 })
        await enableWidget(page, urlKey)

        const offending = await page.evaluate(() => {
          const toggle = document.querySelector('[data-testid="footer-feedback-toggle"]')
          const fab = document.querySelector('[data-testid="feedback-fab"]')
          const maxScroll = document.documentElement.scrollHeight - window.innerHeight
          const hits = []
          for (let y = 0; y <= Math.max(maxScroll, 0); y += 2) {
            window.scrollTo(0, y)
            const a = toggle.getBoundingClientRect()
            const b = fab.getBoundingClientRect()
            if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) hits.push(y)
          }
          return hits
        })

        expect(offending, `overlapping at scrollY: ${offending.join(', ')}`).toEqual([])
      })
    }

    // What this adds over the sweeps: they iterate every offset INCLUDING
    // max scroll, so the non-overlap half here is a strict subset of them. The
    // part that is NOT redundant is the precondition — that the footer is
    // actually on screen at max scroll, so the sweeps cannot have been passing
    // vacuously against a footer that never entered the viewport at all.
    //
    // Measured on the TOGGLE, not on `.footer-deploy`. A block's
    // getBoundingClientRect() returns the BORDER box, which includes the
    // padding, so the row's right edge does not move when the reserve is
    // applied — asserting on it would pass either way and prove nothing.
    // The regressions a fresh-context review caught in the FIRST version of this
    // fix, which was ungated: it reserved 112px for a FAB that could not exist.
    // These are the witnesses that would have caught it.
    test('reserves NOTHING on a page that cannot show a FAB (landing, legal)', async ({ page }) => {
      await page.goto('/test/clear-session')
      for (const width of [320, 360]) {
        await page.setViewportSize({ width, height: 844 })
        for (const path of ['/', '/privacy']) {
          await page.goto(path)
          await page.waitForLoadState('networkidle')
          const pad = await page.evaluate(() => {
            const el = document.querySelector('.footer-deploy')
            return el ? getComputedStyle(el).paddingRight : null
          })
          // feedback-widget.css is not even loaded here (renderFeedbackMount is
          // gated on !isLanding && urlKey), so an ungated rule with a non-zero
          // var() FALLBACK would silently reserve — and did.
          if (pad !== null) expect(pad, `${path} @${width}px`).toBe('0px')
        }
      }
    })

    test('reserves NOTHING while the widget flag is off — the default', async ({ page, seedLocal }) => {
      const { urlKey } = await seedLocal()
      await page.setViewportSize({ width: 360, height: 844 })
      await page.goto(`/workspace/${urlKey}/`)
      await page.waitForLoadState('networkidle')

      // The flag is a durable per-user preference, so an earlier test in this
      // file may have left it ON for this worker. Force it off rather than
      // assume the default.
      if (await page.getByTestId('footer-feedback-toggle').getAttribute('data-enabled') === 'true') {
        await page.getByTestId('footer-feedback-toggle').click()
        await page.waitForLoadState('networkidle')
      }

      // Precondition: the flag really is off, so this is not vacuous.
      await expect(page.getByTestId('footer-feedback-toggle')).toHaveAttribute('data-enabled', 'false')
      await expect(page.getByTestId('feedback-fab')).toHaveCount(0)

      const pad = await page.evaluate(() => getComputedStyle(document.querySelector('.footer-deploy')).paddingRight)
      expect(pad).toBe('0px')
    })

    test('reserves ONLY once the widget is actually on', async ({ page, seedLocal }) => {
      const { urlKey } = await seedLocal()
      await page.setViewportSize({ width: 360, height: 844 })
      await enableWidget(page, urlKey)
      const pad = await page.evaluate(() => getComputedStyle(document.querySelector('.footer-deploy')).paddingRight)
      expect(pad).not.toBe('0px')
    })

    // `.footer-actions` holds the `reset` link — an interactive control, so the
    // FAB covering it is the same defect as the covered toggle, not a cosmetic
    // one. It reached the band at 23 offsets at 430px before this reserve.
    test('the reset-link row never sits under the FAB either', async ({ page, seedLocal }) => {
      const { urlKey } = await seedLocal()
      await page.setViewportSize({ width: 430, height: 844 })
      await enableWidget(page, urlKey)
      // Only the main dashboard renders `reset`; skip rather than assert
      // vacuously if this route has no such control.
      await expect(page.locator('.footer-action.reset-view')).toHaveCount(1)

      const offending = await page.evaluate(() => {
        // The LINK, not the row. `.footer-actions` is a block: its rect spans
        // the full column and INCLUDES the padding, so it would report an
        // overlap with or without the reserve and prove nothing — the same trap
        // that made an earlier version of the `.footer-deploy` assertion vacuous.
        const row = document.querySelector('.footer-action.reset-view')
        const fab = document.querySelector('[data-testid="feedback-fab"]')
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight
        const hits = []
        for (let y = 0; y <= Math.max(maxScroll, 0); y += 2) {
          window.scrollTo(0, y)
          const a = row.getBoundingClientRect()
          const b = fab.getBoundingClientRect()
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) hits.push(y)
        }
        return hits
      })
      expect(offending, `overlapping at scrollY: ${offending.join(', ')}`).toEqual([])
    })

    test('the footer is genuinely on screen at max scroll, so the sweeps are not vacuous', async ({ page, seedLocal }) => {
      const { urlKey } = await seedLocal()
      await page.setViewportSize({ width: 360, height: 844 })
      await enableWidget(page, urlKey)

      const m = await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight)
        const toggle = document.querySelector('[data-testid="footer-feedback-toggle"]').getBoundingClientRect()
        const fab = document.querySelector('[data-testid="feedback-fab"]').getBoundingClientRect()
        return { toggleRight: toggle.right, toggleTop: toggle.top, fabLeft: fab.left, viewportH: window.innerHeight }
      })

      // Guard the guard: if the footer were off screen the comparison below
      // would be vacuous.
      expect(m.toggleTop).toBeLessThan(m.viewportH)
      expect(m.toggleRight).toBeLessThanOrEqual(m.fabLeft)
    })
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
