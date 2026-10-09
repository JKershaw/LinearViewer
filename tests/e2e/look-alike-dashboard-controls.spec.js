import { test, expect } from '../fixtures/test-base.js';

// LIN-3401: ticket text must never act as one of the dashboard's or the swipe
// page's controls (copy / download / dispatch / queue remove / +proxy), nor as
// the opened-task component's buttons. Ticket text is formatted onto both pages
// after load and keeps `class` and `data-*`, so the look-alikes below are put in
// the DOM AFTER the page's own scripts have run, exactly as a description or
// comment expanded by the user would be, covering the whole viewport. Every
// click must be silent. That the real controls still act is covered elsewhere:
// copy/download/dispatch in periodicals.spec.js, queue remove in dispatch.spec.js,
// +proxy in dispatch-page.spec.js, the settings toggle in feature-toggles.spec.js.

let URL_KEY;
const PROXY_FEAT = encodeURIComponent(JSON.stringify({ proxy: true }));
const SENTINEL = '__SENTINEL__';

test.beforeEach(({ workerUrlKey }) => {
  URL_KEY = workerUrlKey;
});

const FORBIDDEN = [/\/api\/dispatch(\/|$|\?)/, /\/settings\//, /\/api\/proxy\/tokens/];

function watchForbidden(page, current) {
  const seen = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    const p = u.pathname + u.search;
    if (FORBIDDEN.some((re) => re.test(p))) seen.push(`[${current.label}] ${r.method()} ${p}`);
  });
  return seen;
}

const fill = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%';
// One look-alike at a time (they would otherwise cover each other), each shaped
// like the real thing's neighbourhood: same classes, same data-*. (A native <form>
// is not among them: renderMarkdown forbids it, LIN-3385.)
const lookAlikes = (key) => ({
  copy: `<div class="prompt-container" data-url-key="${key}" data-proxy-force="true"><div class="prompt-actions"><button class="prompt-copy" style="${fill}">copy</button></div><div class="prompt-text">hostile prompt</div></div>`,
  download: `<div class="prompt-container" data-url-key="${key}"><div class="prompt-actions"><button class="prompt-download" style="${fill}">download</button></div><div class="prompt-text">hostile prompt</div></div>`,
  dispatch: `<div class="prompt-container" data-url-key="${key}" data-proxy-force="true"><div class="prompt-actions"><button class="prompt-dispatch" data-target="cli" style="${fill}">cli</button></div><div class="prompt-text">hostile prompt</div></div>`,
  proxyToggle: `<div class="prompt-actions"><button class="prompt-proxy-toggle" style="${fill}">+proxy</button></div>`,
  queueRemove: `<div class="queue-item"><button class="queue-item-remove" data-item-id="11111111-2222-3333-4444-555555555555" data-url-key="${key}" style="${fill}">remove</button></div>`,
  promptSectionGo: `<div class="swipe-prompt-actions"><button data-action="go" style="${fill}">go</button></div>`,
  promptSectionCopy: `<div class="swipe-prompt-actions"><button data-action="copy" style="${fill}">copy</button></div>`,
  promptSectionFetch: `<div class="swipe-prompt-actions"><button data-prompt="__autopilot__" style="${fill}">autopilot</button></div>`,
});

/** Put one look-alike where rendered ticket text lands (after load), covering the viewport. */
async function injectLookAlike(page, html) {
  await page.evaluate((markup) => {
    document.querySelectorAll('[data-testid="hostile-cover"]').forEach((e) => e.remove());
    const cover = document.createElement('div');
    cover.setAttribute('data-testid', 'hostile-cover');
    cover.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(255,0,0,0.2)';
    cover.innerHTML = markup;
    document.body.appendChild(cover);
  }, html);
}

async function clickAround(page) {
  const { width, height } = page.viewportSize();
  for (const [x, y] of [[width / 2, height / 2], [10, 10], [width - 10, height - 10], [width / 2, 40]]) {
    await page.mouse.click(x, y);
  }
}

test.describe('Look-alike dashboard / swipe controls answer nothing (LIN-3401)', () => {
  for (const [name, path] of [['dashboard', '/'], ['swipe', '/swipe']]) {
    test(`${name}: look-alike copy, download, dispatch, remove, +proxy and prompt-section buttons drive nothing`, async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto(`/test/set-session?features=${PROXY_FEAT}&urlKey=${URL_KEY}&proxyDefault=false`);
      await page.goto(`/workspace/${URL_KEY}${path}`);
      await page.waitForLoadState('networkidle');

      const current = { label: '' };
      const seen = watchForbidden(page, current);
      const navigations = [];
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });
      await page.evaluate((s) => navigator.clipboard.writeText(s), SENTINEL);
      for (const [label, html] of Object.entries(lookAlikes(URL_KEY))) {
        current.label = label;
        await injectLookAlike(page, html);
        await expect(page.locator('[data-testid="hostile-cover"]'), label).toBeVisible();
        await clickAround(page);
      }
      await page.waitForTimeout(500);

      expect(seen, 'a look-alike drove a Harbour control').toEqual([]);
      expect(await page.evaluate(() => navigator.clipboard.readText()), 'clipboard untouched').toBe(SENTINEL);
      await expect(page.locator('body')).toHaveAttribute('data-proxy-active', 'false');
      expect(navigations, 'no native form submit / navigation').toEqual([]);
    });
  }
});
