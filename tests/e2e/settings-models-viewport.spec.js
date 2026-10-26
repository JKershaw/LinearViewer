/**
 * E2E for Settings › Models polish (LIN-3952): the pending bar stays in view while a change is staged, at 1280×900 and
 * at 390×844 with the job's panel open; the last field of that panel is not hidden behind the bar; and a job that
 * follows its group names it in words at 390px, with nothing clipped. Seeded through the local harness and selected by
 * SELECTORS, as the ticket's Done-when asks.
 */
import { test, expect } from '../fixtures/test-base.js'
import { settings, SELECTORS } from '../helpers.js'

const DESKTOP = { width: 1280, height: 900 }
const PHONE = { width: 390, height: 844 }

test.describe('Settings › Models: pending bar and follow labels (LIN-3952)', () => {
  let urlKey

  test.beforeEach(async ({ seedLocal, request }) => {
    // A runner is set, so the agent rows apply (LIN-3952 item 6), as in the Models spec.
    ;({ urlKey } = await seedLocal(null, { runnerKey: true }))
    await request.get(`/test/set-workspace-model?urlKey=${urlKey}`)
  })

  const openModels = async (page) => {
    await settings(page).gotoArea(urlKey, 'models')
    await page.waitForLoadState('networkidle')
    // Open every closed fold, as a person would, so a job below the cutoff is on the page.
    const closed = page.locator('details.models-fold:not([open])')
    while (await closed.count()) {
      await closed.first().locator(':scope > summary').click()
    }
  }
  const openRow = async (page, id) => {
    const row = page.locator(SELECTORS.settings.modelsJob(id))
    if (!(await row.evaluate((el) => el.open))) await row.locator(':scope > summary').click()
    return row
  }

  /**
   * Where an element sits in the viewport, and whether the point at its centre is the element itself. A bar that
   * covers a field, or sits off the bottom of the screen, fails this even when its box is on the page.
   */
  const reachable = (locator) => locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return {
      inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
      hitsIt: !!hit && (hit === el || el.contains(hit))
    }
  })

  test('at 1280×900, a staged change keeps the pending bar and its Save inside the viewport', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await openModels(page)
    const row = await openRow(page, 'bug')
    await row.locator('input[data-models-field="model"]').fill('sonnet')

    const bar = page.locator(SELECTORS.settings.modelsBar)
    await expect(page.locator('[data-testid="models-staged"]')).toContainText('1 change')
    expect(await reachable(bar)).toMatchObject({ inViewport: true })
    expect(await reachable(page.locator(SELECTORS.settings.modelsSave))).toEqual({ inViewport: true, hitsIt: true })
  })

  test('at 390×844 with the panel open, the bar and Save are reachable, and the last field is not covered by the bar', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await openModels(page)
    const row = await openRow(page, 'bug')
    await row.locator('input[data-models-field="model"]').fill('sonnet')
    await expect(page.locator('[data-testid="models-staged"]')).toContainText('1 change')

    // The panel's last field is its effort. The open row is the sheet and scrolls itself; a person scrolls it to the end,
    // and the field must then sit above the bar, not under it.
    await row.evaluate((el) => { el.scrollTop = el.scrollHeight })
    const lastField = row.locator('select[data-models-field="effort"]')
    expect(await reachable(lastField)).toEqual({ inViewport: true, hitsIt: true })

    expect(await reachable(page.locator(SELECTORS.settings.modelsSave))).toEqual({ inViewport: true, hitsIt: true })
  })

  test('at 390px a job that follows its group names the group and what it resolves to, without clipping the field', async ({ page, request }) => {
    await request.post('/test/model-routing', {
      data: { urlKey, reason: 'seeded', changes: [{ scope: 'group', surface: 'agent-session', key: 'make', field: 'model', to: 'opus' }] }
    })
    await page.setViewportSize(PHONE)
    await openModels(page)
    const row = await openRow(page, 'bug')

    const model = row.locator('input[data-models-field="model"]')
    await expect(model).toHaveAttribute('placeholder', 'Follow Make')
    const hint = row.locator('[data-decision-hint="model"]')
    await expect(hint).toHaveText('Right now: Claude Opus 5.5, from Make')
    // The hint sits inside the phone's gutter: its right edge is on the screen, and so is the field.
    const box = await hint.boundingBox()
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width)
    expect(await model.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
})
