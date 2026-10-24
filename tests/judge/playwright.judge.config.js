/**
 * Playwright config for the visual replay judge (LIN-3887). Run it through
 * `node tests/judge/visual-replay.mjs`, not directly: the driver starts one server per side
 * and passes their URLs in the environment.
 *
 * Kept apart from playwright.config.js (testDir ./tests/e2e) and playwright.visual.config.js
 * (./tests/visual), so neither `npm test` nor the screenshot generators ever see it. No
 * reference image is committed: the base screenshot is written to the OS temp dir for the
 * comparator to read, per run.
 */
import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 300000,
  reporter: 'dot',
  outputDir: path.join(process.env.JUDGE_SNAP_DIR || os.tmpdir(), 'judge-output'),
  snapshotPathTemplate: `${process.env.JUDGE_SNAP_DIR || os.tmpdir()}/judge-snapshots/{arg}{ext}`,
  use: {
    launchOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--font-render-hinting=none', '--disable-lcd-text'],
    },
  },
});
