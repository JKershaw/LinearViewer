import { test, expect } from '../fixtures/test-base.js'
import { sweepFixedOverlaps, describeHits } from '../fixed-overlay-sweep.js'

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
    await expect(page.getByTestId('nav-feedback-trigger')).toHaveCount(0)

    const toggle = page.getByTestId('footer-feedback-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('data-enabled', 'false')

    // Toggling reloads the page; the FAB then appears.
    await toggle.click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByTestId('footer-feedback-toggle')).toHaveAttribute('data-enabled', 'true')
    await expect(page.getByTestId('nav-feedback-trigger')).toBeVisible()
  })

  test('opens a popup with message, priority, and screenshot fields', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('nav-feedback-trigger').click()
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

    await page.getByTestId('nav-feedback-trigger').click()
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

    await page.getByTestId('nav-feedback-trigger').click()
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

    await page.getByTestId('nav-feedback-trigger').click()
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

    await page.getByTestId('nav-feedback-trigger').click()
    await page.getByTestId('feedback-message').fill('Half-written feedback')
    await page.getByTestId('feedback-priority').selectOption('2')

    // Minimize — popup hides but nothing is lost.
    await page.getByTestId('feedback-minimize').click()
    await expect(page.getByTestId('feedback-popup')).toBeHidden()

    // Reopen — text is still there.
    await page.getByTestId('nav-feedback-trigger').click()
    await expect(page.getByTestId('feedback-message')).toHaveValue('Half-written feedback')

    // Survives a full reload (localStorage draft).
    await page.reload()
    await page.waitForLoadState('networkidle')
    await page.getByTestId('nav-feedback-trigger').click()
    await expect(page.getByTestId('feedback-message')).toHaveValue('Half-written feedback')
    await expect(page.getByTestId('feedback-priority')).toHaveValue('2')
  })

  // LIN-704: a selected screenshot must be removable (a native file input
  // cannot be cleared by the user), and a failed client-side read must not
  // dead-end the user on the same unreadable file.
  test('shows a remove control once a screenshot is selected and clears it', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await enableWidget(page, urlKey)

    await page.getByTestId('nav-feedback-trigger').click()
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

    await page.getByTestId('nav-feedback-trigger').click()

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

    await page.getByTestId('nav-feedback-trigger').click()
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

    await page.getByTestId('nav-feedback-trigger').click()

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

    await page.getByTestId('nav-feedback-trigger').click()
    await expect(page.getByTestId('feedback-file-chip')).toBeHidden()

    await page.getByTestId('feedback-popup').evaluate((popup) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([1, 2, 3])], 'pasted.png', { type: 'image/png' }))
      popup.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }))
    })

    await expect(page.getByTestId('feedback-file-chip')).toBeVisible()
    await expect(page.getByTestId('feedback-file-name')).toHaveText('pasted.png')
  })

  // LIN-2298 — the class witness, inherited from LIN-2299/2296 and re-aimed.
  //
  // These sweeps were written for a defect that no longer exists: a fixed
  // `.feedback-fab` floating over the footer's own `feedback` toggle — the very
  // control that dismisses it — at the one scroll position a user is most
  // likely to be at. LIN-2299 fixed that with a horizontal reserve and pinned it
  // here; LIN-2298 then deleted the FAB outright on John's ruling, and with it
  // the reserve.
  //
  // The ruling was explicit that these tests SURVIVE the deletion: "keep their
  // rect-sweep tests as the class witness (they must still report zero overlaps
  // with the FAB gone)". So they are kept and pointed at the CLASS rather than
  // at one element: not "never intersects `.feedback-fab`" (which would now pass
  // vacuously — you cannot intersect an element that is not rendered) but
  // "never intersects ANY visible fixed overlay, at any 2px scroll offset".
  //
  // That is strictly stronger than what they asserted before, and it is the
  // version that earns its keep going forward: it goes red if ANYONE
  // reintroduces a floating element over this content, which is the actual
  // LIN-2272 class, rather than only if a specific deleted rule regresses.
  //
  // Still a REAL RECT SWEEP, never a computed-style assertion — a style-value
  // assertion is precisely what let LIN-2252's no-op pass CI green. Measured
  // before LIN-2299 at main 54116d21: 19 overlapping offsets at 320px, 18 at
  // 360, 18 at 390, 22 at 430; at 360 the toggle's right edge was 344.1 against
  // the FAB's 344.0.
  //
  // Because both the toggle and the widget mount are rendered from
  // lib/components/footer.js, ONE sweep here covers the whole ~30-page
  // footer-bearing surface — which is what closed the remainder of the LIN-2272
  // review's instance 3 ("no page other than live-console has any geometry-sweep
  // coverage for the FAB").
  test.describe('LIN-2298: no fixed overlay covers the footer controls, at any scroll offset', () => {
    for (const width of [320, 360, 390, 430]) {
      test(`the footer feedback toggle is clear of every fixed overlay (${width}px)`, async ({ page, seedLocal }) => {
        const { urlKey } = await seedLocal()
        await page.setViewportSize({ width, height: 844 })
        await enableWidget(page, urlKey)

        const hits = await sweepFixedOverlaps(page, '[data-testid="footer-feedback-toggle"]')
        expect(hits, describeHits(hits)).toEqual([])
      })
    }

    // `.footer-actions` holds the `reset` link — an interactive control, so an
    // overlay covering it is the same defect as the covered toggle, not a
    // cosmetic one. It reached the FAB's band at 23 offsets at 430px before
    // LIN-2299's reserve.
    test('the reset-link row is clear of every fixed overlay too', async ({ page, seedLocal }) => {
      const { urlKey } = await seedLocal()
      await page.setViewportSize({ width: 430, height: 844 })
      await enableWidget(page, urlKey)
      // Only the main dashboard renders `reset`; assert its presence rather
      // than sweeping vacuously against a control that is not there.
      await expect(page.locator('.footer-action.reset-view')).toHaveCount(1)

      // The LINK, not the row. `.footer-actions` is a block: its rect spans the
      // full column and INCLUDES its padding, so it would report the same result
      // with or without a reserve and prove nothing — the trap that made an
      // earlier version of the `.footer-deploy` assertion vacuous.
      const hits = await sweepFixedOverlaps(page, '.footer-action.reset-view')
      expect(hits, describeHits(hits)).toEqual([])
    })

    // What this adds over the sweeps: they iterate every offset INCLUDING max
    // scroll, so a non-overlap assertion here would be a strict subset of them.
    // The part that is NOT redundant is the PRECONDITION — that the footer is
    // actually on screen at max scroll, so the sweeps cannot have been passing
    // vacuously against a footer that never entered the viewport at all.
    test('the footer is genuinely on screen at max scroll, so the sweeps are not vacuous', async ({ page, seedLocal }) => {
      const { urlKey } = await seedLocal()
      await page.setViewportSize({ width: 360, height: 844 })
      await enableWidget(page, urlKey)

      const m = await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight)
        const toggle = document.querySelector('[data-testid="footer-feedback-toggle"]').getBoundingClientRect()
        return { top: toggle.top, bottom: toggle.bottom, viewportH: window.innerHeight }
      })

      expect(m.top).toBeLessThan(m.viewportH)
      expect(m.bottom).toBeGreaterThan(0)
    })

    // The reserve LIN-2299 landed is GONE, and its absence is asserted rather
    // than assumed. A gated rule left behind after its gate can never match is
    // dead CSS that still reads as a live constraint; worse, an UNGATED version
    // of this same rule shipped twice and was measurably wrong both times (it
    // shoved the centred footer 56px off-centre on landing pages, and took
    // `.footer-deploy` from 2 lines to 4 on ~30 pages with the flag off). This
    // is the witness that the reserve is not merely inactive but absent.
    test('reserves NOTHING now the FAB is gone — with the widget ON', async ({ page, seedLocal }) => {
      const { urlKey } = await seedLocal()
      await page.setViewportSize({ width: 360, height: 844 })
      await enableWidget(page, urlKey)

      // Precondition: the widget really is on, so this is not vacuous.
      await expect(page.getByTestId('footer-feedback-toggle')).toHaveAttribute('data-enabled', 'true')

      const pads = await page.evaluate(() => ({
        deploy: getComputedStyle(document.querySelector('.footer-deploy')).paddingRight,
        actions: document.querySelector('.footer-actions')
          ? getComputedStyle(document.querySelector('.footer-actions')).paddingRight
          : '0px'
      }))
      expect(pads.deploy).toBe('0px')
      expect(pads.actions).toBe('0px')
    })

    test('reserves NOTHING on a page that cannot show the widget at all (landing, legal)', async ({ page }) => {
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
          if (pad !== null) expect(pad, `${path} @${width}px`).toBe('0px')
        }
      }
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
  await expect(page.getByTestId('nav-feedback-trigger')).toBeVisible()
}
