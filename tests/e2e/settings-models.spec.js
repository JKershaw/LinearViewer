/**
 * E2E for Settings › Models (LIN-3855): every job, its spend and its model; a job or a group moved in one
 * edit with a reason; undo; the retired forms gone. Seeded through the store (`/test/model-routing`) and
 * selected by data-testid, as the ticket's Done-when asks.
 */
import { test, expect } from '../fixtures/test-base.js'
import { settings } from '../helpers.js'

const CLAUDE_OPTIONS = 4 // haiku, sonnet, opus, fable: the Claude Code search list (LIN-3962: the model is an input now)

test.describe('Settings › Models (LIN-3855)', () => {
  let urlKey

  test.beforeEach(async ({ seedLocal, request }) => {
    // A runner is set, as in a workspace that runs agents: the agent rows apply (LIN-3952 item 6).
    ;({ urlKey } = await seedLocal(null, { runnerKey: true }))
    // A clean routing table, log and presets for this workspace.
    await request.get(`/test/set-workspace-model?urlKey=${urlKey}`)
  })

  const seed = (request, changes, reason = 'seeded') => request.post('/test/model-routing', {
    data: { urlKey, reason, changes }
  })
  const openModels = async (page, query = '') => {
    await settings(page).gotoArea(urlKey, 'models')
    if (query) await page.goto(`/workspace/${urlKey}/settings/models${query}`)
    await page.waitForLoadState('networkidle')
    // Jobs with no runs sit behind the "Show N more" fold (LIN-3952 item 1): open each closed fold, as a person would.
    // Each click opens one fold, so the next closed fold is always the first one left.
    const closed = page.locator('details.models-fold:not([open])')
    while (await closed.count()) {
      await closed.first().locator(':scope > summary').click()
    }
  }
  const jobRow = (page, id) => page.locator(`[data-testid="models-job-${id}"]`)
  const openRow = async (page, id) => {
    const row = jobRow(page, id)
    if (!(await row.evaluate((el) => el.open))) await row.locator(':scope > summary').click()
    return row
  }
  const reasonBox = (page) => page.locator('[data-testid="models-reason"]')
  const saveButton = (page) => page.locator('[data-testid="models-save"]')
  // The log's rows are the static rows; the group's own title also starts `models-log-`, so it is not counted.
  const logEntries = (page) => page.locator('.settings-row-static[data-testid^="models-log-"]:not([data-testid="models-log-empty"])')
  const stateOf = (page) => page.locator('[data-testid="settings-state-models"]')

  test('a job, moved in one edit with a reason, reads "set here" and the log has the entry', async ({ page, request }) => {
    await openModels(page)
    const row = await openRow(page, 'bug')
    await row.locator('select[data-models-field="harness"]').selectOption('claude-code')
    await row.locator('input[data-models-field="model"]').fill('sonnet')
    await reasonBox(page).fill('Bugs get the cheaper model')
    await saveButton(page).click()

    await expect(page.locator('[data-testid="models-notice"]')).toContainText('Saved.')
    await expect(jobRow(page, 'bug').locator(':scope > summary')).toContainText('set here')
    await expect(logEntries(page)).toHaveCount(1)
    await expect(logEntries(page).first()).toContainText('Bugs get the cheaper model')
  })

  test('"Follow the group" puts the row back to "from <Group>"', async ({ page, request }) => {
    await seed(request, [
      { scope: 'group', surface: 'agent-session', key: 'make', field: 'model', to: 'opus' },
      { scope: 'job', surface: 'agent-session', key: 'bug', field: 'model', to: 'sonnet' }
    ])
    await openModels(page)
    const row = await openRow(page, 'bug')
    await row.locator('input[data-models-field="model"]').fill('')
    await reasonBox(page).fill('Follow Make again')
    await saveButton(page).click()

    await expect(page.locator('[data-testid="models-notice"]')).toContainText('Saved.')
    await expect(jobRow(page, 'bug').locator(':scope > summary')).toContainText('from Make')
  })

  test('a group moved once shows its new value on every job that follows it', async ({ page, request }) => {
    await openModels(page)
    const groupRow = page.locator('[data-testid="models-group-agent-session-make"]')
    await groupRow.locator(':scope > summary').click()
    await groupRow.locator('input[data-models-field="model"]').fill('sonnet')
    await reasonBox(page).fill('Make on sonnet')
    await saveButton(page).click()

    await expect(page.locator('[data-testid="models-notice"]')).toContainText('Saved.')
    await expect(jobRow(page, 'implementation').locator(':scope > summary')).toContainText('from Make')
    await expect(jobRow(page, 'implementation').locator(':scope > summary')).toContainText('sonnet')
  })

  test('picking an OpenRouter-only model switches the harness to opencode and hides effort', async ({ page }) => {
    await openModels(page)
    const row = await openRow(page, 'implementation')
    const model = row.locator('input[data-models-field="model"]')
    await model.fill('openai/gpt-5.5')
    await model.dispatchEvent('change')
    await expect(row.locator('select[data-models-field="harness"]')).toHaveValue('opencode')
    await expect(row.locator('[data-models-effort]')).toBeHidden()
  })

  test('a Claude Code row offers only Claude models; an OpenCode row offers the OpenRouter list', async ({ page }) => {
    await openModels(page)
    const row = await openRow(page, 'implementation')
    const harness = row.locator('select[data-models-field="harness"]')
    const model = row.locator('input[data-models-field="model"]')
    const searchList = (key) => row.locator(`datalist[data-decision-list="${key}"] option`)

    await harness.selectOption('claude-code')
    await expect(model).toHaveAttribute('list', /-list-claude-code$/)
    await expect(searchList('claude-code')).toHaveCount(CLAUDE_OPTIONS)
    await expect(searchList('claude-code').and(row.locator('[value^="openai/"]'))).toHaveCount(0)

    await harness.selectOption('opencode')
    await expect(model).toHaveAttribute('list', /-list-opencode$/)
    await expect(searchList('opencode').and(row.locator('[value="openai/gpt-5.5"]'))).toHaveCount(1)
  })

  test('two edits saved together are one save with one reason', async ({ page }) => {
    await openModels(page)
    const bug = await openRow(page, 'bug')
    await bug.locator('input[data-models-field="model"]').fill('sonnet')
    const plan = await openRow(page, 'plan')
    await plan.locator('input[data-models-field="model"]').fill('opus')
    await reasonBox(page).fill('two at once')
    await saveButton(page).click()

    await expect(page.locator('[data-testid="models-notice"]')).toContainText('Saved.')
    await expect(logEntries(page)).toHaveCount(1)
    await expect(logEntries(page).first()).toContainText('two at once')
  })

  test('undo from the log restores the earlier value', async ({ page, request }) => {
    await seed(request, [{ scope: 'job', surface: 'agent-session', key: 'bug', field: 'model', to: 'sonnet' }])
    await openModels(page)
    const row = await openRow(page, 'bug')
    await row.locator('input[data-models-field="model"]').fill('opus')
    await reasonBox(page).fill('try opus')
    await saveButton(page).click()
    await expect(page.locator('[data-testid="models-notice"]')).toContainText('Saved.')

    const undo = logEntries(page).filter({ hasText: 'try opus' }).locator('[data-testid^="models-undo-"]').first()
    await undo.locator(':scope > summary').click()
    await undo.locator('[data-testid$="-reason"]').fill('back to sonnet')
    await undo.locator('[data-testid$="-confirm"]').click()

    await openModels(page)
    await expect(jobRow(page, 'bug').locator(':scope > summary')).toContainText('sonnet')
  })

  test('at phone width the open row is a full-screen sheet and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openModels(page)
    const row = await openRow(page, 'implementation')
    await expect(row).toHaveCSS('position', 'fixed')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('at phone width Tab stays inside the open sheet, and Escape closes it and returns focus to its row', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openModels(page)
    const row = await openRow(page, 'implementation')
    const focusInRow = () => page.evaluate(() => !!document.activeElement.closest('[data-testid="models-job-implementation"]'))

    // Shift+Tab from the first control (the row's own summary) wraps to the last field inside the sheet.
    await page.keyboard.press('Shift+Tab')
    expect(await focusInRow()).toBe(true)
    // Tab through the sheet and past its last field, several times round: focus never leaves it.
    const stayed = []
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      stayed.push(await focusInRow())
    }
    expect(stayed.every(Boolean)).toBe(true)

    await page.keyboard.press('Escape')
    expect(await row.evaluate((el) => el.open)).toBe(false)
    expect(await page.evaluate(() => document.activeElement.matches('[data-testid="models-job-implementation"] > summary'))).toBe(true)
  })

  // Off Models the sidebar's state is spend-free (LIN-3952 item 5): one model in use names it, several read as a count.
  test('off Models the sidebar names the one model every job runs on, and a group move changes it', async ({ page, request }) => {
    await settings(page).gotoArea(urlKey, 'sources')
    const before = await stateOf(page).textContent()
    // Every agent group on one model: the agent jobs then all run on it. Harbour calls keep their own model, so two in use.
    const groups = ['judge', 'plan', 'make', 'steer', 'sort', 'tell']
    await seed(request, groups.map((key) => ({ scope: 'group', surface: 'agent-session', key, field: 'model', to: 'anthropic/claude-sonnet-5' })), 'all agent groups')
    await settings(page).gotoArea(urlKey, 'sources')
    const after = await stateOf(page).textContent()
    expect(after).not.toBe(before)
    expect(after.trim()).toMatch(/^2 models$/)
  })

  // On Models the sidebar names the model carrying the most priced spend (LIN-3952 item 5). With no runs there is no priced spend.
  test('on Models the sidebar reads "No priced runs" until a job has priced spend', async ({ page }) => {
    await openModels(page)
    await expect(stateOf(page)).toHaveText('No priced runs')
  })

  test('the retired forms are gone, the Dispatch presets section stays, and the old POSTs write nothing', async ({ page, request }) => {
    await openModels(page)
    await expect(page.locator('[data-testid="settings-section-ai-model"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="settings-section-dispatch-defaults"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="settings-section-dispatch-presets"]')).toBeVisible()

    for (const path of ['settings/model', 'settings/dispatch-defaults', 'settings/ai-model-overrides']) {
      const res = await request.post(`/workspace/${urlKey}/${path}`, { form: { modelId: 'anthropic/claude-opus-5', defaultModel: 'x' }, maxRedirects: 0 })
      expect(res.status()).toBe(404)
    }
    await openModels(page)
    await expect(logEntries(page)).toHaveCount(0)
  })

  // LIN-3952: the No job suggestion moved to the Dispatch page (its own spec: dispatch-no-job.spec.js). Models no longer has it.
  test('Models no longer carries the No job row: it is on the Dispatch page', async ({ page }) => {
    await openModels(page)
    await expect(page.locator('[data-testid="models-default-agent"]')).toHaveCount(0)
  })
})
