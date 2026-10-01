import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, workspaceApiLocalSeed } from '../fixtures/local-harness.js';

/**
 * LIN-3098 S4b — "run on my machine ›" wherever a task opens, on a phone.
 *
 * John: "I don't want to be faffing with links. Either it's a feature or it's
 * not." A signed-in owner who opens a task — in the tree view or on Swipe —
 * sees the link IN THE VIEWPORT of a 390×844 phone without expanding any
 * section, whatever the proxy/dispatch flags say (/runner explains what to
 * turn on), and tapping it reaches /runner. One desktop check too.
 *
 * Phone screenshots land in test-results/runner-link-entry/ (not committed).
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const SHOTS = 'test-results/runner-link-entry';
// "Blocked on external API", the in-progress task of workspaceApiLocalSeed.
const TASK_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const FLAG_STATES = [
  { name: 'flags-off', features: { proxy: false, dispatch: false } },
  { name: 'flags-on', features: { proxy: true, dispatch: true } },
];

async function seedOwner(page, key, features) {
  // append: true makes the session's account the workspace OWNER (LIN-1892).
  const seeded = await seedLocalWorkspace(page, workspaceApiLocalSeed, { urlKey: key, append: true, features });
  return seeded.urlKey;
}

async function openTreeTask(page, urlKey) {
  await page.goto(`/workspace/${urlKey}/`);
  await page.locator(`.in-progress-items [data-testid="issue-line"][data-id="${TASK_ID}"]`).tap();
  const details = page.locator(`.in-progress-items .details[data-details-for="${TASK_ID}"]`);
  await expect(details).toBeVisible();
  return details;
}

test.describe('run on my machine › wherever a task opens (LIN-3098 S4b, phone)', () => {
  for (const { name, features } of FLAG_STATES) {
    test(`tree view (${name}): visible in the viewport as the task opens, and reaches /runner`, async ({ page }) => {
      const urlKey = await seedOwner(page, `runner-entry-tree-${name}`, features);
      const details = await openTreeTask(page, urlKey);
      const link = details.getByTestId('opened-task-runner-link');
      await expect(link).toBeVisible();
      await expect(link).toBeInViewport();
      await expect(link).toHaveText('run on my machine ›');
      await expect(link).toHaveAttribute('href', `/workspace/${urlKey}/runner`);
      // Nothing was expanded to reach it.
      await expect(details.locator('[data-content="details"]')).toBeHidden();
      await expect(details.locator('[data-content="prompts"]')).toBeHidden();
      await page.screenshot({ path: `${SHOTS}/tree-${name}.png` });
      await link.tap();
      await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/runner$`));
      await expect(page.getByTestId('runner-setup-page')).toBeVisible();
    });

    test(`Swipe (${name}): visible in the viewport on the card, and reaches /runner`, async ({ page }) => {
      const urlKey = await seedOwner(page, `runner-entry-swipe-${name}`, features);
      await page.goto(`/workspace/${urlKey}/swipe`);
      const card = page.locator('#swipe-card');
      const link = card.getByTestId('opened-task-runner-link');
      await expect(link).toBeVisible();
      await expect(link).toBeInViewport();
      await expect(link).toHaveText('run on my machine ›');
      await expect(link).toHaveAttribute('href', `/workspace/${urlKey}/runner`);
      // No accordion was opened to reach it.
      await expect(card.locator('.swipe-accordion-body[data-accordion-body="prompts"]')).toBeHidden();
      await page.screenshot({ path: `${SHOTS}/swipe-${name}.png` });
      await link.tap();
      await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/runner$`));
      await expect(page.getByTestId('runner-setup-page')).toBeVisible();
    });
  }

  test('opening Prompts on Swipe does not add a second link', async ({ page }) => {
    const urlKey = await seedOwner(page, 'runner-entry-swipe-once', { proxy: true, dispatch: true });
    await page.goto(`/workspace/${urlKey}/swipe`);
    await page.locator('.swipe-accordion-header[data-accordion="prompts"]').first().tap();
    await expect(page.locator('.prompt-section').first()).toBeVisible();
    await expect(page.locator('#swipe-card').getByTestId('opened-task-runner-link')).toHaveCount(1);
  });
});

test.describe('run on my machine › on desktop (LIN-3098 S4b)', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

  test('tree view and Swipe, flags off', async ({ page }) => {
    const urlKey = await seedOwner(page, 'runner-entry-desktop', { proxy: false, dispatch: false });
    await page.goto(`/workspace/${urlKey}/`);
    await page.locator(`.in-progress-items [data-testid="issue-line"][data-id="${TASK_ID}"]`).click();
    const treeLink = page.locator(`.in-progress-items .details[data-details-for="${TASK_ID}"]`).getByTestId('opened-task-runner-link');
    await expect(treeLink).toBeInViewport();
    await page.goto(`/workspace/${urlKey}/swipe`);
    await expect(page.locator('#swipe-card').getByTestId('opened-task-runner-link')).toBeInViewport();
  });
});
