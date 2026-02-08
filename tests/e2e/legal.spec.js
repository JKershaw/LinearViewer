import { test, expect } from '@playwright/test';

test.describe('Legal Pages', () => {

  test.describe('Privacy Policy', () => {
    test('loads without authentication', async ({ page }) => {
      await page.goto('/privacy');
      await expect(page).toHaveTitle(/Privacy Policy/);
      await expect(page.locator('h2')).toHaveText('Privacy Policy');
    });

    test('contains required sections', async ({ page }) => {
      await page.goto('/privacy');
      await expect(page.locator('h3:has-text("Data We Collect")')).toBeVisible();
      await expect(page.locator('h3:has-text("How We Store Data")')).toBeVisible();
      await expect(page.locator('h3:has-text("Cookies")')).toBeVisible();
      await expect(page.locator('h3:has-text("Third-Party Services")')).toBeVisible();
      await expect(page.locator('h3:has-text("Data Sharing")')).toBeVisible();
      await expect(page.locator('h3:has-text("Contact")')).toBeVisible();
    });

    test('has footer with current page highlighted', async ({ page }) => {
      await page.goto('/privacy');
      const footer = page.locator('.page-footer');
      await expect(footer).toBeVisible();

      // "privacy" should be bold (current page)
      await expect(footer.locator('.footer-current')).toHaveText('privacy');

      // "terms" should be a link
      await expect(footer.locator('a.footer-legal[href="/terms"]')).toBeVisible();
    });

    test('does not show authenticated navigation links', async ({ page }) => {
      await page.goto('/privacy');
      await expect(page.locator('.footer-actions')).not.toBeVisible();
    });
  });

  test.describe('Terms of Service', () => {
    test('loads without authentication', async ({ page }) => {
      await page.goto('/terms');
      await expect(page).toHaveTitle(/Terms of Service/);
      await expect(page.locator('h2')).toHaveText('Terms of Service');
    });

    test('contains required sections', async ({ page }) => {
      await page.goto('/terms');
      await expect(page.locator('h3:has-text("Service Description")')).toBeVisible();
      await expect(page.locator('h3:has-text("No Warranty")')).toBeVisible();
      await expect(page.locator('h3:has-text("Your Responsibilities")')).toBeVisible();
      await expect(page.locator('h3:has-text("Limitation of Liability")')).toBeVisible();
      await expect(page.locator('h3:has-text("Changes to Terms")')).toBeVisible();
      await expect(page.locator('h3:has-text("Contact")')).toBeVisible();
    });

    test('has footer with current page highlighted', async ({ page }) => {
      await page.goto('/terms');
      const footer = page.locator('.page-footer');
      await expect(footer).toBeVisible();

      // "terms" should be bold (current page)
      await expect(footer.locator('.footer-current')).toHaveText('terms');

      // "privacy" should be a link
      await expect(footer.locator('a.footer-legal[href="/privacy"]')).toBeVisible();
    });

    test('does not show authenticated navigation links', async ({ page }) => {
      await page.goto('/terms');
      await expect(page.locator('.footer-actions')).not.toBeVisible();
    });
  });

  test.describe('Navigation', () => {
    test('can navigate from privacy to terms', async ({ page }) => {
      await page.goto('/privacy');
      await page.locator('a.footer-legal[href="/terms"]').click();
      await expect(page).toHaveTitle(/Terms of Service/);
    });

    test('can navigate from terms to privacy', async ({ page }) => {
      await page.goto('/terms');
      await page.locator('a.footer-legal[href="/privacy"]').click();
      await expect(page).toHaveTitle(/Privacy Policy/);
    });

    test('header links back to home', async ({ page }) => {
      await page.goto('/privacy');
      await page.locator('h1 a').click();
      await expect(page.locator('h1')).toContainText('Linear Projects Viewer');
    });
  });

  test.describe('Footer Links on Other Pages', () => {
    test('landing page footer has privacy and terms links', async ({ page }) => {
      await page.goto('/');
      const footer = page.locator('.page-footer');
      await expect(footer.locator('a.footer-legal[href="/privacy"]')).toBeVisible();
      await expect(footer.locator('a.footer-legal[href="/terms"]')).toBeVisible();
    });
  });
});
