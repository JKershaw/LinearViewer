import { test, expect } from '../fixtures/test-base.js';
import { featuresParam } from '../helpers.js';
import { sweepFixedOverlaps, describeHits } from '../fixed-overlay-sweep.js';
let URL_KEY, OBSERVATION_URL;
test.beforeEach(({ workerUrlKey }) => { URL_KEY = workerUrlKey; OBSERVATION_URL = `/workspace/${URL_KEY}/observation`; });
for (const width of [320, 360, 390, 430]) {
  test(`does the sticky nav reach the last card @${width}`, async ({ page }) => {
    await page.goto(`/test/set-session?urlKey=${URL_KEY}${featuresParam({ feedbackWidget: true })}`);
    for (const p of ['clear-dispatch-queue','clear-dispatch-history','clear-observation-sessions','clear-sessions-feed-cache']) await page.goto(`/test/${p}?urlKey=${URL_KEY}`);
    const { token } = await (await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${URL_KEY}`)).json();
    for (let i = 0; i < 6; i++) {
      const res = await page.request.post(`/workspace/${URL_KEY}/api/dispatch`, { data: { prompt: 'x', promptName: 'implementation', kind: 'implementation', issueIdentifier: `LIN-229${i}`, issueTitle: `S ${i}`, target: 'cli' } });
      const item = (await res.json()).item;
      await page.request.post(`/api/dispatch/take/${item.id}`, { headers: { Authorization: `Bearer ${token}` } });
    }
    await page.setViewportSize({ width, height: 844 });
    await page.goto(OBSERVATION_URL);
    await page.waitForLoadState('networkidle');
    await page.locator('.obs-tab[data-view="sessions"]').click();
    await expect(page.locator('#obs-active > .obs-session').first()).toBeVisible();
    const card = await sweepFixedOverlaps(page, '#obs-active > .obs-session:last-child');
    const open = await sweepFixedOverlaps(page, '#obs-active > .obs-session:last-child .obs-session-open');
    console.log(`NAVHIT ${width} card=${describeHits(card)} || open=${describeHits(open)}`);
  });
}
