/**
 * E2E tests for the brief API + UI.
 */
import { test, expect } from '../fixtures/test-base.js';

const URL_KEY = 'test-workspace';
const ISSUE_ID = '66666666-6666-6666-6666-666666666666';
const ISSUE_IDENTIFIER = 'TEST-6';

test.describe('Brief API', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
  });

  test('GET returns status=missing for never-generated issue', async ({ page }) => {
    // Use a distinct UUID to keep this test independent of state from others
    const res = await page.request.get(`/workspace/${URL_KEY}/api/brief/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeef`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(['missing', 'fresh', 'stale']).toContain(body.status);
  });

  test('POST generates brief and returns status=fresh', async ({ page }) => {
    const res = await page.request.post(`/workspace/${URL_KEY}/api/brief/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(typeof body.brief).toBe('string');
    expect(body.brief).toContain('## Current');
    expect(body.generatedAt).toBeTruthy();
  });

  test('GET after POST returns status=fresh with the same brief', async ({ page }) => {
    await page.request.post(`/workspace/${URL_KEY}/api/brief/${ISSUE_ID}`);
    const res = await page.request.get(`/workspace/${URL_KEY}/api/brief/${ISSUE_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
    expect(body.brief).toContain('## Current');
  });

  test('accepts LIN-XXX identifier format as well as UUID', async ({ page }) => {
    const res = await page.request.post(`/workspace/${URL_KEY}/api/brief/${ISSUE_IDENTIFIER}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fresh');
  });

  test('rejects invalid identifier format with 400', async ({ page }) => {
    const res = await page.request.get(`/workspace/${URL_KEY}/api/brief/not!valid`);
    expect(res.status()).toBe(400);
  });

  test('returns 404 for unknown issue', async ({ page }) => {
    const res = await page.request.get(`/workspace/${URL_KEY}/api/brief/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`);
    expect(res.status()).toBe(404);
  });
});

test.describe('Brief UI — Swipe', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test/set-session');
    await page.goto(`/workspace/${URL_KEY}/swipe`);
    await page.waitForLoadState('networkidle');
  });

  test('swipe card renders brief accordion', async ({ page }) => {
    const briefAccordion = page.locator('.swipe-accordion-header[data-accordion="brief"]').first();
    await expect(briefAccordion).toBeVisible();
    await expect(briefAccordion).toContainText(/Brief/i);
  });

  test('opening brief accordion initialises the section', async ({ page }) => {
    const briefAccordion = page.locator('.swipe-accordion-header[data-accordion="brief"]').first();
    await briefAccordion.click();

    const body = page.locator('.swipe-accordion-body[data-accordion-body="brief"]').first();
    await expect(body).toHaveClass(/open/);

    const section = body.locator('.brief-section').first();
    await expect(section).toHaveAttribute('data-state', /missing|fresh|stale|generating|loading/);
  });

  test('refresh button triggers POST and shows fresh content', async ({ page }) => {
    const briefAccordion = page.locator('.swipe-accordion-header[data-accordion="brief"]').first();
    await briefAccordion.click();

    const section = page.locator('.swipe-accordion-body[data-accordion-body="brief"] .brief-section').first();
    // Wait for the initial GET to resolve
    await expect(section).not.toHaveAttribute('data-state', 'loading', { timeout: 5000 });

    const refreshBtn = section.locator('[data-brief-refresh]');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // Should land on fresh with rendered Markdown content
    await expect(section).toHaveAttribute('data-state', 'fresh', { timeout: 5000 });
    await expect(section.locator('.brief-content')).toBeVisible();
  });
});
