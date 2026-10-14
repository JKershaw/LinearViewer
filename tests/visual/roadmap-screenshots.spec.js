/**
 * Roadmap Page Screenshot Maker — VR baseline (LIN-1229).
 *
 * Pins the LIN-1222 roadmap redesign (scannable shipped feed + section rhythm)
 * with a committed visual baseline at the ticket's review matrix:
 *   {1280, 390} x {light, dark}.
 *
 * Run manually: npx playwright test --config=playwright.visual.config.js tests/visual/roadmap-screenshots.spec.js
 * Not part of `npm test` — like every maker in tests/visual/ these WRITE PNGs
 * and do NOT assert. There is no CI gate on this directory today
 * (.github/workflows/test.yml runs only the default e2e config); refresh the
 * reference set by running the command above.
 *
 * Output: tests/screenshots/roadmap/roadmap-{desktop-1280,mobile-390}-{light,dark}.png
 *
 * Data seam (deliberate, and DIFFERENT from pages-screenshots.spec.js): this
 * roadmap capture rides the LOCAL-PROVIDER seed
 * (`seedLocal(workspaceApiLocalSeed, { features: { roadmap: true } })`), the same
 * genuine `provider: 'local'` path the roadmap E2E (tests/e2e/roadmap.spec.js)
 * uses — NOT the `/test/set-session` mock fixture the other page makers are
 * pinned to. The brief (LIN-1229) prefers the local seed here; LIN-409 records
 * both paths return the same TEST-1..27 data, so velocity/by-project derive from
 * identical numbers. A single LONG-TITLE completion is appended to the seed with
 * a run-relative `completedAt` so the redesigned shipped feed renders a real
 * entry and its title wrap/no-truncation is pinned at 390 (the fixture's own
 * completions are dated 2024, outside the ship log's 90-day window).
 *
 * Dark mechanism: the `theme=dark` cookie set pre-paint via `context.addCookies`
 * — the authenticated shell reads the cookie, NOT `prefers-color-scheme`, so
 * `emulateMedia` would not flip it (it only works for the landing showcase). This
 * is the LIN-1221 ship-screenshots "S3 matrix" template, reused verbatim.
 */
import { test } from '../fixtures/test-base.js';
import { workspaceApiLocalSeed } from '../fixtures/local-harness.js';

const SCREENSHOT_DIR = 'tests/screenshots/roadmap';

const sizes = [
  { name: 'desktop-1280', width: 1280, height: 720 },
  { name: 'mobile-390', width: 390, height: 844 }
];
const themes = ['light', 'dark'];

// A completion whose title is deliberately long enough to wrap past the 390
// column, so the LIN-1222 "no truncation at 390" acceptance is pinned by the
// baseline rather than eyeballed. `completedAt` is set run-relative (a few days
// ago) so it always lands inside the ship log's 90-day window whenever the maker
// is run — the fixture's built-in completions are dated 2024 and fall outside it.
const LONG_TITLE =
  'Consolidate the roadmap shipped-feed section rhythm, header meta wrapping, ' +
  'and status-pill accents across light and dark themes without truncating ' +
  'long completion titles at narrow mobile widths';

/**
 * Clone the shared local seed and append one long-title completion. The shared
 * `workspaceApiLocalSeed` is a module-level constant reused by other specs, so
 * it is deep-cloned here rather than mutated. The appended issue reuses an
 * existing project id from the seed so it groups under a real project in the
 * by-project / shipped-feed roll-up.
 */
function roadmapSeed() {
  const seed = structuredClone(workspaceApiLocalSeed);
  const projectId = seed.projects[0]?.id ?? null;
  const completedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  seed.issues.push({
    id: 'lin1229-long-title-completion',
    identifier: 'TEST-1229',
    title: LONG_TITLE,
    description: 'Long-title completion seeded to pin ship-feed wrapping (LIN-1229).',
    projectId,
    sortOrder: 999,
    state: { name: 'Done', type: 'completed' },
    completedAt
  });
  return seed;
}

test.describe.configure({ mode: 'serial' });

test.describe('Roadmap VR baseline (LIN-1229): 1280 + 390, light + dark', () => {
  for (const size of sizes) {
    for (const theme of themes) {
      test(`roadmap ${size.name} ${theme}`, async ({ page, context, baseURL, seedLocal }) => {
        // Pre-paint theme cookie (LIN-1221 template): the authed shell reads it,
        // not prefers-color-scheme.
        await context.addCookies([{ name: 'theme', value: theme, url: baseURL }]);
        await page.setViewportSize({ width: size.width, height: size.height });
        // Genuine provider:'local' session + roadmap feature, seeded with the
        // long-title completion so the shipped feed renders a wrapping entry.
        const { urlKey } = await seedLocal(roadmapSeed(), { features: { roadmap: true } });
        await page.goto(`/workspace/${urlKey}/roadmap`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300); // settle any post-load layout
        await page.screenshot({
          path: `${SCREENSHOT_DIR}/roadmap-${size.name}-${theme}.png`,
          fullPage: true
        });
      });
    }
  }
});
