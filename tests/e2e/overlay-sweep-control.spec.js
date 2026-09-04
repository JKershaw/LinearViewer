import { test, expect } from '../fixtures/test-base.js'
import { sweepFixedOverlaps, describeHits, expectSweepNotVacuous } from '../fixed-overlay-sweep.js'

// LIN-2298 — the POSITIVE CONTROL for tests/fixed-overlay-sweep.js.
//
// Every other consumer of that helper asserts a NEGATIVE: "this content is
// covered by nothing". A negative assertion is only worth the machinery behind
// it, and this ticket family exists because of a guard that asserted the right
// thing and proved nothing (LIN-2252's `padding-bottom` no-op passed CI green).
//
// The LIN-2298 review found that exact shape reproduced inside the new guard:
// with the FAB deleted there is no visible fixed element left on the swept
// pages, so the candidate set was empty and every sweep would have passed
// identically had the helper's body been `return []`. Mutation-checking the
// helper by hand (restoring the deleted FAB — 118 offsets, scrollY 590–824)
// showed the machinery worked THAT DAY, but nothing in the suite kept it
// working. This spec is that missing evidence, run on every CI pass.
//
// It deliberately does NOT test the product. It injects overlays into a real
// page and asserts the sweep reports them, so the negative assertions
// elsewhere mean something. If this file goes red, every other sweep result in
// the suite is suspect regardless of what it says.
test.describe('LIN-2298: the overlay sweep can actually detect an overlay', () => {
  // Inject a fixed overlay sitting exactly over the footer toggle's band, in
  // the shape of the FAB this ticket deleted (83x32 at a 16px bottom-right
  // inset — the geometry measured at main 54116d21).
  async function injectFab(page) {
    await page.evaluate(() => {
      const el = document.createElement('div')
      el.setAttribute('data-testid', 'sweep-control-overlay')
      el.style.cssText = 'position:fixed;right:16px;bottom:16px;width:83px;height:32px;background:#2563eb;z-index:1000'
      document.body.appendChild(el)
    })
  }

  // Run at every width the real sweeps use. Detection capability is not
  // width-independent — the target's own geometry moves — so proving it at 360
  // and asserting it at 320/390/430 was a gap the re-review named.
  for (const width of [320, 360, 390, 430]) {
  test(`reports a fixed overlay placed over the swept target, and stays silent once it is gone (${width}px)`, async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal()
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/workspace/${urlKey}/`)
    await page.waitForLoadState('networkidle')

    // The dashboard footer is the same target tests/e2e/feedback-widget.spec.js
    // sweeps, so this control exercises the real call shape rather than a
    // synthetic page the other specs never touch.
    const target = '[data-testid="footer-feedback-toggle"]'

    await injectFab(page)
    const withOverlay = await sweepFixedOverlaps(page, target)
    expect(
      withOverlay.candidates,
      `injected overlay must be a candidate; saw: ${withOverlay.candidates.join(', ')}`
    ).toContain('sweep-control-overlay')
    expect(
      withOverlay.hits.length,
      `an overlay in the bottom-right band MUST be reported over the footer toggle — ${describeHits(withOverlay)}`
    ).toBeGreaterThan(0)
    expect(withOverlay.hits.every(h => h.overlay === 'sweep-control-overlay')).toBe(true)

    // And the negative half: remove it and the same sweep goes quiet. Without
    // this, a helper that reported an overlap unconditionally would also pass
    // the assertion above.
    await page.evaluate(() => document.querySelector('[data-testid="sweep-control-overlay"]').remove())
    const without = await sweepFixedOverlaps(page, target)
    expect(without.candidates).not.toContain('sweep-control-overlay')
    expect(
      without.hits.filter(h => h.overlay === 'sweep-control-overlay'),
      'removing the overlay must remove its hits'
    ).toEqual([])
  })
  }

  test('reports EVERY overlay covering the target at an offset, not just the first', async ({ page, seedLocal }) => {
    // The re-review's blocking finding: the sweep used to `break` after the
    // first overlapping overlay in document order. Combined with a call site
    // that filtered a known-benign overlay out of the hits, that made any
    // SECOND overlay at the same offsets invisible — the exact "assertion that
    // cannot fail" this branch keeps arguing against.
    //
    // The Observation acceptance no longer filters anything, so it would fail
    // on the first hit regardless; this is what keeps the helper itself honest
    // if a caller ever does tolerate one overlay again.
    const { urlKey } = await seedLocal()
    await page.setViewportSize({ width: 360, height: 844 })
    await page.goto(`/workspace/${urlKey}/`)
    await page.waitForLoadState('networkidle')

    await page.evaluate(() => {
      for (const id of ['overlay-one', 'overlay-two']) {
        const el = document.createElement('div')
        el.setAttribute('data-testid', id)
        // Same band, so both cover the target at the same scroll offsets.
        el.style.cssText = 'position:fixed;right:16px;bottom:16px;width:120px;height:40px;background:#2563eb;z-index:1000'
        document.body.appendChild(el)
      }
    })

    const result = await sweepFixedOverlaps(page, '[data-testid="footer-feedback-toggle"]')
    const named = new Set(result.hits.map(h => h.overlay))
    expect(
      [...named].sort(),
      `both overlays must be reported, not just the first in document order — ${describeHits(result)}`
    ).toEqual(['overlay-one', 'overlay-two'])
  })

  test('sweeps sticky overlays too, not just fixed ones', async ({ page, seedLocal }) => {
    // `.nav-bar` is `position: sticky; top: 0` and now hosts the feedback
    // trigger (LIN-2298). A sweep blind to sticky would let the prose claim
    // "nothing floats over this content" while the header does exactly that,
    // which is what the review objected to. This pins that sticky is in the
    // candidate vocabulary — the fact the nav is then EXCLUDED by name at the
    // Observation call site is a separate, visible decision.
    const { urlKey } = await seedLocal()
    await page.setViewportSize({ width: 360, height: 844 })
    await page.goto(`/workspace/${urlKey}/`)
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.nav-bar')).toBeVisible()
    const position = await page.evaluate(() => getComputedStyle(document.querySelector('.nav-bar')).position)
    // Guard the guard: if the nav ever stops being sticky this test would
    // silently stop covering the sticky branch.
    expect(position, '.nav-bar is expected to be sticky — see public/style.css').toBe('sticky')

    const result = await sweepFixedOverlaps(page, '[data-testid="footer-feedback-toggle"]')
    expectSweepNotVacuous(expect, result, 'dashboard footer')
    expect(
      result.candidates.some(c => String(c).includes('nav-bar')),
      `sticky .nav-bar must appear as a sweep candidate; saw: ${result.candidates.join(', ')}`
    ).toBe(true)
  })

  test('expectSweepNotVacuous fails when there is nothing to sweep against', async ({ page, seedLocal }) => {
    // The vacuity guard must itself be able to fire, or it is one more
    // assertion that always passes.
    const { urlKey } = await seedLocal()
    await page.goto(`/workspace/${urlKey}/`)
    await page.waitForLoadState('networkidle')

    const empty = { hits: [], candidates: [] }
    expect(() => expectSweepNotVacuous(expect, empty)).toThrow()
    expect(describeHits(empty)).toContain('vacuous')
  })
})
