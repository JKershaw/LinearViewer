import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, workspaceApiLocalSeed } from '../fixtures/local-harness.js';

/**
 * LIN-3098 S4b — "run on my machine ›" wherever a task opens, on a phone.
 *
 * John: "I don't want to be faffing with links. Either it's a feature or it's
 * not." A signed-in owner who opens a task — in the tree view or on Swipe —
 * sees the link IN THE VIEWPORT of a 390×844 phone without expanding any
 * section, whether or not the workspace has a runner key yet (/runner is where
 * the first one is made), and tapping it reaches /runner. One desktop check too.
 *
 * Phone screenshots land in test-results/runner-link-entry/ (not committed).
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const SHOTS = 'test-results/runner-link-entry';
// "Blocked on external API", the in-progress task of workspaceApiLocalSeed.
const TASK_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// LIN-3849: the link is shown whether or not the workspace has a way to run yet.
const FLAG_STATES = [
  { name: 'no-key', runnerKey: false },
  { name: 'key', runnerKey: true },
];

async function seedOwner(page, key, runnerKey) {
  // append: true makes the session's account the workspace OWNER (LIN-1892).
  const seeded = await seedLocalWorkspace(page, workspaceApiLocalSeed, { urlKey: key, append: true, runnerKey });
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
  for (const { name, runnerKey } of FLAG_STATES) {
    test(`tree view (${name}): ${runnerKey ? 'no runner line for a viewer who can run (LIN-3833)' : 'visible in the viewport as the task opens, and reaches /runner'}`, async ({ page }) => {
      const urlKey = await seedOwner(page, `runner-entry-tree-${name}`, runnerKey);
      const details = await openTreeTask(page, urlKey);
      // Nothing was expanded to reach the control: the state-first task shows its control with the row open.
      await expect(details.locator('[data-content="description"]')).toBeHidden();
      await expect(details.locator('.home-prompt-mount')).toBeVisible();
      const link = details.getByTestId('opened-task-runner-link');
      if (runnerKey) {
        // LIN-3833: a viewer with a runner has no set-up line; the run control is the task's action.
        await expect(link).toHaveCount(0);
        await expect(details.getByTestId('opened-task-run')).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/tree-${name}.png` });
        return;
      }
      await expect(link).toBeVisible();
      await expect(link).toBeInViewport();
      await expect(link).toHaveText('Set up a runner ›');
      await expect(link).toHaveAttribute('href', `/workspace/${urlKey}/runner`);
      await page.screenshot({ path: `${SHOTS}/tree-${name}.png` });
      await link.tap();
      await expect(page).toHaveURL(new RegExp(`/workspace/${urlKey}/runner$`));
      await expect(page.getByTestId('runner-setup-page')).toBeVisible();
    });

    test(`Swipe (${name}): visible in the viewport on the card, and reaches /runner`, async ({ page }) => {
      const urlKey = await seedOwner(page, `runner-entry-swipe-${name}`, runnerKey);
      await page.goto(`/workspace/${urlKey}/swipe`);
      const card = page.locator('#swipe-card');
      const link = card.getByTestId('opened-task-runner-link');
      await expect(link).toBeVisible();
      await expect(link).toBeInViewport();
      await expect(link).toHaveText('Set up a runner ›');
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
    const urlKey = await seedOwner(page, 'runner-entry-swipe-once', true);
    await page.goto(`/workspace/${urlKey}/swipe`);
    await page.locator('.swipe-accordion-header[data-accordion="prompts"]').first().tap();
    await expect(page.locator('.prompt-section').first()).toBeVisible();
    await expect(page.locator('#swipe-card').getByTestId('opened-task-runner-link')).toHaveCount(1);
  });
});

test.describe('run on my machine › on desktop (LIN-3098 S4b)', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

  test('tree view and Swipe, no runner key', async ({ page }) => {
    const urlKey = await seedOwner(page, 'runner-entry-desktop', false);
    await page.goto(`/workspace/${urlKey}/`);
    await page.locator(`.in-progress-items [data-testid="issue-line"][data-id="${TASK_ID}"]`).click();
    const treeLink = page.locator(`.in-progress-items .details[data-details-for="${TASK_ID}"]`).getByTestId('opened-task-runner-link');
    await expect(treeLink).toBeInViewport();
    await page.goto(`/workspace/${urlKey}/swipe`);
    await expect(page.locator('#swipe-card').getByTestId('opened-task-runner-link')).toBeInViewport();
  });
});
