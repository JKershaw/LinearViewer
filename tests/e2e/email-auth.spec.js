/**
 * W2 — the Playwright runtime witness for LIN-1892's leg criterion "A new
 * person can sign in by email" (plan S2 Tests, W2).
 *
 * Real server, real browser. The Playwright webServer runs NODE_ENV=test with
 * EMAIL_TRANSPORT=capture (playwright.config.js), so the sign-in link is read
 * back from the test-only `GET /test/email-outbox`, and "same account" is read
 * from the test-only `GET /test/session-account` rather than assumed.
 *
 * Also the plan's G1 adversarial e2e: a real cross-site auto-submitting form
 * aimed at `POST /auth/email/confirm` is refused (403) in the browser, and the
 * same link still confirms normally afterwards.
 */
import { test, expect } from '../fixtures/test-base.js';

async function outboxLink(request, email) {
  const res = await request.get(`/test/email-outbox?to=${encodeURIComponent(email)}`);
  expect(res.status(), `a captured email for ${email}`).toBe(200);
  const message = await res.json();
  const match = message.text.match(/https?:\/\/[^\s]+\/auth\/email\/confirm\?t=[A-Za-z0-9_-]+/);
  expect(match, 'the email carries a confirm link').toBeTruthy();
  return match[0];
}

async function sessionAccountId(page) {
  const res = await page.request.get('/test/session-account');
  return (await res.json()).accountId;
}

async function requestLinkFromForm(page, email) {
  await page.getByTestId('email-signin-address').fill(email);
  await page.getByTestId('email-signin-submit').click();
  await expect(page.getByTestId('email-check-inbox')).toBeVisible();
}

test.describe('W2: a new person can sign in by email (LIN-1892)', () => {
  test('landing → email → link → confirm → account home; a second browser reaches the same account', async ({ page, browser, request }) => {
    const email = `w2-${Date.now()}@example.test`;
    const baseURL = test.info().project.use.baseURL;

    // From the landing page's "Continue with email".
    await page.goto('/');
    await page.getByTestId('landing-cta-email').click();
    await expect(page).toHaveURL(/\/auth\/email$/);
    await requestLinkFromForm(page, email);

    // Open the emailed link, then confirm.
    await page.goto(await outboxLink(request, email));
    await expect(page.getByTestId('email-confirm-page')).toBeVisible();
    await expect(page.getByTestId('email-confirm-page')).toContainText(email);
    await page.getByTestId('email-confirm-submit').click();

    // The account home, with the address and the C6 line.
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId('account-home')).toBeVisible();
    await expect(page.getByTestId('account-home-email')).toContainText(email);
    await expect(page.getByTestId('account-home-c6')).toBeVisible();
    const firstAccountId = await sessionAccountId(page);
    expect(firstAccountId, 'signed in').toBeTruthy();

    // `/` and the previews now go to the account home.
    for (const path of ['/', '/swipe', '/swim', '/ship']) {
      await page.goto(path);
      await expect(page, `${path} → /account`).toHaveURL(/\/account$/);
    }

    // A second, empty browser context with the same address (mixed case).
    const context2 = await browser.newContext({ baseURL });
    try {
      const page2 = await context2.newPage();
      expect(await sessionAccountId(page2), 'the second browser starts signed out').toBeNull();
      await page2.goto('/auth/email');
      await requestLinkFromForm(page2, email.toUpperCase());
      const link2 = await outboxLink(request, email);

      // G1 adversarial: an attacker page auto-submits a cross-site POST of this
      // token to the confirm endpoint. The browser sends no session cookie
      // (sameSite=lax) and Sec-Fetch-Site: cross-site, so it is refused.
      const t2 = new URL(link2).searchParams.get('t');
      await page2.route('http://attacker.test/**', route => route.fulfill({
        contentType: 'text/html',
        body: `<form id="f" method="POST" action="${baseURL}/auth/email/confirm">
                 <input name="t" value="${t2}"><input name="nonce" value="forged">
               </form><script>document.getElementById('f').submit()</script>`,
      }));
      const forged = page2.waitForResponse(r => r.url() === `${baseURL}/auth/email/confirm` && r.request().method() === 'POST');
      await page2.goto('http://attacker.test/');
      expect((await forged).status(), 'the cross-site confirm is refused').toBe(403);
      await expect(page2.getByTestId('email-confirm-refused')).toBeVisible();
      expect(await sessionAccountId(page2), 'the forged POST signed nobody in').toBeNull();

      // The same link still confirms normally: the refusal consumed nothing.
      await page2.goto(link2);
      await expect(page2.getByTestId('email-confirm-other-device')).toHaveCount(0);
      await page2.getByTestId('email-confirm-submit').click();
      await expect(page2).toHaveURL(/\/account$/);
      await expect(page2.getByTestId('account-home-email')).toContainText(email);
      expect(await sessionAccountId(page2), 'the same account in the second browser').toBe(firstAccountId);
    } finally {
      await context2.close();
    }
  });
});
