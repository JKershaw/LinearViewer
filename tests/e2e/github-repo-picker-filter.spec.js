import { test, expect } from '@playwright/test';
import { renderGitHubRepoSelectPage } from '../../lib/render-pages.js';

// LIN-2820 review F1: the repo picker's client-side filter toggled the native
// `hidden` attribute, but `.repo-picker-row` carries its own author `display:
// flex` rule with no `[hidden]` override — so `[hidden] { display: none }`
// (the UA stylesheet) never wins, and the filter silently fails in a real
// browser. Every existing assertion on this renderer is an HTML-string match
// (tests/unit/render-pages.test.js, tests/unit/github-auth.test.js, the golden
// fixture) — none of them load the real stylesheet or execute the inline
// filter script, so none could have caught this. This spec renders the real
// picker markup, loads the real /style.css the running server serves, and
// drives the filter through an actual browser layout/paint pass.
test.describe('GitHub repo picker filter (LIN-2820)', () => {
  test('typing in the filter visually hides non-matching rows under the real stylesheet', async ({ page }) => {
    const repos = Array.from({ length: 12 }, (_, i) => ({
      slug: `octocat/repo-${i}`,
      name: `octocat/repo-${i}`,
      private: false,
    }));
    const html = renderGitHubRepoSelectPage(repos, { mode: 'new', login: 'octocat' });

    // Establish the page's origin first so the rendered `<link href="/style.css">`
    // resolves against the running test server, then swap in the picker's own
    // markup — setContent preserves the current URL, only the document content.
    await page.goto('/');
    await page.setContent(html, { waitUntil: 'load' });

    const rows = page.locator('.repo-picker-row');
    await expect(rows).toHaveCount(12);
    await expect(page.locator('.repo-picker-filter')).toBeVisible();

    await page.locator('.repo-picker-filter').fill('repo-7');

    // "repo-7" matches only repo-7 among repo-0..repo-11 (no repo-70..79).
    await expect(page.locator('.repo-picker-row', { hasText: 'repo-7' })).toBeVisible();
    await expect(page.locator('.repo-picker-row', { hasText: 'repo-0' })).toBeHidden();

    const visibleCount = await rows.evaluateAll(
      (nodes) => nodes.filter((n) => n.getBoundingClientRect().height > 0).length
    );
    expect(visibleCount).toBe(1);
  });
});
