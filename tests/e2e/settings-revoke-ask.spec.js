/**
 * LIN-3890 — key revoke asks in place. Cancel closes the ask and sends nothing; Confirm sends exactly
 * one DELETE to the key's own route (the existing owner-checked route, through the script transport).
 * Seeding goes through `tests/fixtures/local-harness.js`.
 */
import { test, expect } from '../fixtures/test-base.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';
import { settings, SELECTORS } from '../helpers.js';

test.describe('Settings: key revoke asks in place (LIN-3890)', () => {
  test('Cancel sends no DELETE; Confirm sends exactly one', async ({ page, seedLocal }) => {
    const { urlKey } = await seedLocal();
    await seedWorkspaceOwnership(page, urlKey);
    await settings(page).gotoArea(urlKey, 'agent-access');

    await page.getByTestId('settings-newkey').locator(':scope > summary').click();
    await page.locator(SELECTORS.settings.newKeyLabel).fill('revoke-witness');
    await page.getByTestId('settings-newkey-submit').click();
    await expect(page.getByTestId('settings-newkey-secret')).toContainText('shown once');
    await page.reload();

    const deletes = [];
    page.on('request', (req) => { if (req.method() === 'DELETE') deletes.push(req.url()); });

    const key = page.getByTestId('settings-key-proxy').filter({ hasText: 'revoke-witness' });
    await key.locator(':scope > summary').click();
    const revoke = key.getByTestId('settings-key-revoke');
    await revoke.locator(':scope > summary').click();
    await expect(key.getByTestId('settings-key-revoke-confirm')).toBeVisible();

    await key.getByTestId('settings-key-revoke-cancel').click();
    await expect(key.getByTestId('settings-key-revoke-confirm')).toBeHidden();
    expect(deletes, 'Cancel sends no DELETE').toEqual([]);

    await revoke.locator(':scope > summary').click();
    await key.getByTestId('settings-key-revoke-confirm').click();
    await expect(page.getByTestId('settings-key-proxy').filter({ hasText: 'revoke-witness' })).toHaveCount(0);
    expect(deletes, 'Confirm sends one DELETE').toHaveLength(1);
    expect(deletes[0]).toMatch(/\/api\/proxy\/tokens\//);
  });
});
