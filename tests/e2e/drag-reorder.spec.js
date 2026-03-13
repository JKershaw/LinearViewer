import { test, expect } from '@playwright/test';

const TEST_WORKSPACE_URL_KEY = 'test-workspace';
const WORKSPACE_URL = `/workspace/${TEST_WORKSPACE_URL_KEY}/`;

test.describe('Drag-and-drop project reordering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto('/test/clear-tile-order');
    await page.evaluate(() => localStorage.clear());
    await page.goto(WORKSPACE_URL);
  });

  test('projects are draggable', async ({ page }) => {
    const projects = page.locator('.project');
    const count = await projects.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // All projects should have draggable attribute
    for (let i = 0; i < count; i++) {
      await expect(projects.nth(i)).toHaveAttribute('draggable', 'true');
    }
  });

  test('drag-and-drop reorders projects in the DOM', async ({ page }) => {
    const projects = page.locator('section[aria-label="Projects"] > .project');

    // Get initial order
    const firstId = await projects.nth(0).getAttribute('data-id');
    const secondId = await projects.nth(1).getAttribute('data-id');

    // Simulate drag-and-drop via JavaScript events (more reliable than Playwright's dragTo)
    await page.evaluate(({ sourceId, targetId }) => {
      const container = document.querySelector('section[role="region"][aria-label="Projects"]');
      const source = container.querySelector(`.project[data-id="${sourceId}"]`);
      const target = container.querySelector(`.project[data-id="${targetId}"]`);
      const targetRect = target.getBoundingClientRect();

      // dragstart on source
      const dt = new DataTransfer();
      dt.setData('text/plain', sourceId);
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));

      // dragover on target (below midpoint = insert after)
      const overEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientY: targetRect.top + targetRect.height * 0.75
      });
      target.dispatchEvent(overEvent);

      // drop on target
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientY: targetRect.top + targetRect.height * 0.75
      });
      target.dispatchEvent(dropEvent);

      // dragend on source
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    }, { sourceId: firstId, targetId: secondId });

    // After drag, the order should be swapped
    const newFirstId = await projects.nth(0).getAttribute('data-id');
    const newSecondId = await projects.nth(1).getAttribute('data-id');

    expect(newFirstId).toBe(secondId);
    expect(newSecondId).toBe(firstId);
  });

  test('reorder persists via API and survives page reload', async ({ page }) => {
    const projects = page.locator('section[aria-label="Projects"] > .project');

    const firstId = await projects.nth(0).getAttribute('data-id');
    const secondId = await projects.nth(1).getAttribute('data-id');

    // Simulate drag-and-drop
    await page.evaluate(({ sourceId, targetId }) => {
      const container = document.querySelector('section[role="region"][aria-label="Projects"]');
      const source = container.querySelector(`.project[data-id="${sourceId}"]`);
      const target = container.querySelector(`.project[data-id="${targetId}"]`);
      const targetRect = target.getBoundingClientRect();

      const dt = new DataTransfer();
      dt.setData('text/plain', sourceId);
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));

      const overEvent = new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientY: targetRect.top + targetRect.height * 0.75
      });
      target.dispatchEvent(overEvent);

      const dropEvent = new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientY: targetRect.top + targetRect.height * 0.75
      });
      target.dispatchEvent(dropEvent);

      source.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    }, { sourceId: firstId, targetId: secondId });

    // Wait for API call to complete
    await page.waitForTimeout(500);

    // Verify the API persisted the order
    const response = await page.request.get(`/workspace/${TEST_WORKSPACE_URL_KEY}/api/preferences`);
    const data = await response.json();
    expect(data.tileOrder).toBeDefined();
    expect(data.tileOrder.length).toBeGreaterThan(0);
    expect(data.tileOrder[0]).toBe(secondId);
    expect(data.tileOrder[1]).toBe(firstId);

    // Reload page and verify order is preserved
    await page.reload();
    await page.waitForSelector('.project');
    // Give time for the order to be applied from API
    await page.waitForTimeout(500);

    const reloadedFirstId = await page.locator('section[aria-label="Projects"] > .project').nth(0).getAttribute('data-id');
    expect(reloadedFirstId).toBe(secondId);
  });

  test('PUT /api/tile-order returns 400 for non-array body', async ({ page }) => {
    const response = await page.request.put(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/tile-order`,
      { data: { not: 'an array' } }
    );
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('array');
  });

  test('PUT /api/tile-order returns 400 for array with non-string elements', async ({ page }) => {
    const response = await page.request.put(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/tile-order`,
      { data: ['valid', 123, 'also-valid'] }
    );
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('non-empty string');
  });

  test('PUT /api/tile-order returns 400 for array with empty strings', async ({ page }) => {
    const response = await page.request.put(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/tile-order`,
      { data: ['valid', '', 'also-valid'] }
    );
    expect(response.status()).toBe(400);
  });

  test('PUT /api/tile-order returns 200 for valid array', async ({ page }) => {
    const response = await page.request.put(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/tile-order`,
      { data: ['proj-beta', 'proj-alpha'] }
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  test('GET /api/preferences includes tileOrder', async ({ page }) => {
    // First set an order
    await page.request.put(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/tile-order`,
      { data: ['proj-beta', 'proj-alpha'] }
    );

    // Then retrieve it
    const response = await page.request.get(
      `/workspace/${TEST_WORKSPACE_URL_KEY}/api/preferences`
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.tileOrder).toEqual(['proj-beta', 'proj-alpha']);
  });

  test('landing page projects are not draggable', async ({ page }) => {
    await page.goto('/test/clear-session');
    await page.goto('/');

    const projects = page.locator('.project');
    const count = await projects.count();
    if (count > 0) {
      await expect(projects.nth(0)).not.toHaveAttribute('draggable', 'true');
    }
  });

  test('dragging class is applied and removed', async ({ page }) => {
    const firstProject = page.locator('.project').nth(0);

    // Dispatch dragstart and verify .dragging class appears
    const hasDraggingClass = await page.evaluate(() => {
      return new Promise(resolve => {
        const project = document.querySelector('.project');
        const dt = new DataTransfer();
        dt.setData('text/plain', project.dataset.id);

        project.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));

        // requestAnimationFrame is used to add the class
        requestAnimationFrame(() => {
          resolve(project.classList.contains('dragging'));
        });
      });
    });

    expect(hasDraggingClass).toBe(true);

    // Dispatch dragend and verify .dragging class is removed
    await page.evaluate(() => {
      const project = document.querySelector('.project');
      project.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    });

    await expect(firstProject).not.toHaveClass(/dragging/);
  });
});
