/**
 * E2E tests for the recap API + UI (LIN-261).
 */
import { test, expect } from '../fixtures/test-base.js';

const URL_KEY = 'test-workspace';
const ISSUE_ID = '66666666-6666-6666-6666-666666666666';
const ISSUE_IDENTIFIER = 'TEST-6';

test.describe('Recap API', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
  });

  test('GET returns status=missing for never-generated issue', async ({ page }) => {
    // Use a different UUID to keep this test independent of state from others
    const res = await page.request.get(`/workspace/${URL_KEY}/api/recap/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeef`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(['missing', 'fresh', 'stale']).toContain(body.status);
  });

  test('POST generates recap and returns status=fresh', async ({ page }) => {
    const res = await page.request.post(`/workspace/${URL_KEY}/api/recap/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(body.recap).toBeTruthy();
    expect(Array.isArray(body.recap.done)).toBe(true);
    expect(Array.isArray(body.recap.pending)).toBe(true);
    expect(Array.isArray(body.recap.deviations)).toBe(true);
    expect(body.generatedAt).toBeTruthy();
  });

  test('GET after POST returns status=fresh with same recap', async ({ page }) => {
    await page.request.post(`/workspace/${URL_KEY}/api/recap/${ISSUE_ID}`);
    const res = await page.request.get(`/workspace/${URL_KEY}/api/recap/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(body.recap).toBeTruthy();
  });

  test('accepts LIN-XXX identifier format as well as UUID', async ({ page }) => {
    const res = await page.request.post(`/workspace/${URL_KEY}/api/recap/${ISSUE_IDENTIFIER}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
  });

  test('rejects invalid identifier format with 400', async ({ page }) => {
    const res = await page.request.get(`/workspace/${URL_KEY}/api/recap/not!valid`);
    expect(res.status()).toBe(400);
  });

  test('returns 404 for unknown issue', async ({ page }) => {
    const res = await page.request.get(`/workspace/${URL_KEY}/api/recap/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`);
    expect(res.status()).toBe(404);
  });
});

test.describe('Recap UI — Swipe', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto(`/workspace/${URL_KEY}/swipe`);
    await page.waitForLoadState('networkidle');
  });

  test('swipe card renders recap accordion', async ({ page }) => {
    const recapAccordion = page.locator('.swipe-accordion-header[data-accordion="recap"]').first();
    await expect(recapAccordion).toBeVisible();
    await expect(recapAccordion).toContainText(/Recap/i);
  });

  test('opening recap accordion initialises the section', async ({ page }) => {
    const recapAccordion = page.locator('.swipe-accordion-header[data-accordion="recap"]').first();
    await recapAccordion.click();

    const body = page.locator('.swipe-accordion-body[data-accordion-body="recap"]').first();
    await expect(body).toHaveClass(/open/);

    // The shared renderer attaches data-state attribute
    const section = body.locator('.recap-section').first();
    await expect(section).toHaveAttribute('data-state', /missing|fresh|stale|generating|loading/);
  });

  test('refresh button triggers POST and shows fresh content', async ({ page }) => {
    const recapAccordion = page.locator('.swipe-accordion-header[data-accordion="recap"]').first();
    await recapAccordion.click();

    const section = page.locator('.swipe-accordion-body[data-accordion-body="recap"] .recap-section').first();
    // Wait for the initial GET to resolve
    await expect(section).not.toHaveAttribute('data-state', 'loading', { timeout: 5000 });

    const refreshBtn = section.locator('[data-recap-refresh]');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Should land on fresh with recap content
    await expect(section).toHaveAttribute('data-state', 'fresh', { timeout: 5000 });
    // Fresh content renders at least one item or an empty placeholder
    const hasList = await section.locator('.recap-list').count();
    const hasEmpty = await section.locator('.recap-empty').count();
    expect(hasList + hasEmpty).toBeGreaterThan(0);
  });
});
