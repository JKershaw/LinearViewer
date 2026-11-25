/**
 * LIN-4562 (LIN-4342 piece 1): the frame census, a ratchet like the classic-loader census. Every page is to sit in one
 * frame (lib/components/frame.js renderFrame / renderPublicFrame), which owns the skip link, the rail or public band,
 * the one h1, the footer and the tab title. A file that imports the shell's `renderPage` (lib/components/page.js)
 * assembles its own chrome, so it is "on the old chrome". The list below is every such file today, written out by name:
 * a new file importing the shell outside the frame fails, and so does a listed file that no longer calls it, until the list is lowered in the same
 * change. The list only falls: each piece that moves pages onto the frame deletes their files here, and piece 7
 * (LIN-4568) empties it and deletes the allowance.
 *
 * Witness: importing the shell's renderPage into lib/render-proxy.js (now on the frame) fails "no file outside the list".
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/frame-census.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The shell itself and the frame, which are the two places allowed to call it for good. */
const SHELL = new Set(['lib/components/page.js', 'lib/components/frame.js']);

/** Files that still assemble their own chrome (the shell's renderPage, or plain-page.js's wrappers of it). Sorted. It only falls. */
export const OLD_CHROME_ALLOWANCE = [
  'lib/components/plain-page.js',
  'lib/render-account-home.js',
  'lib/render-audit.js',
  'lib/render-collective.js',
  'lib/render-custom-prompts.js',
  'lib/render-dispatch.js',
  'lib/render-effort-readout.js',
  'lib/render-email-auth.js',
  'lib/render-escalation-kpis.js',
  'lib/render-flight-companion.js',
  'lib/render-kpis.js',
  'lib/render-landing.js',
  'lib/render-legal.js',
  'lib/render-library.js',
  'lib/render-live-console.js',
  'lib/render-observation.js',
  'lib/render-pages.js',
  'lib/render-passage-planner.js',
  'lib/render-project-page.js',
  'lib/render-prompts.js',
  'lib/render-roadmap.js',
  'lib/render-runner-setup.js',
  'lib/render-session.js',
  'lib/render-settings.js',
  'lib/render-ship-biscuit.js',
  'lib/render-ship-journey.js',
  'lib/render-ship.js',
  'lib/render-styleguide.js',
  'lib/render-swim.js',
  'lib/render-swipe.js',
  'lib/render-task-chat.js',
  'lib/render-templates.js',
  'lib/render-workspace-kpis.js',
  'routes/getting-started.js',
];

function jsFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return jsFiles(rel);
    return name.endsWith('.js') ? [rel] : [];
  });
}

/**
 * The files that assemble their own chrome: those that import the shell's `renderPage` (lib/components/page.js), under
 * any local name, and those that import `renderPlainPage` or `renderPlainDocument` from lib/components/plain-page.js,
 * which wrap the same old chrome (lib/render-legal.js, lib/render-account-home.js). Home's own `renderPage`
 * (lib/render.js) is a page renderer, not the shell: importing it does not count.
 */
export function oldChromeFiles() {
  const shellImport = /import\s*\{[^}]*\brenderPage\b[^}]*\}\s*from\s*'(?:\.\.\/lib\/|\.\/|\.\.\/)?(?:components\/)?page\.js'/;
  const plainImport = /import\s*\{[^}]*\b(?:renderPlainPage|renderPlainDocument)\b[^}]*\}\s*from\s*'[^']*plain-page\.js'/;
  return [...jsFiles('lib'), ...jsFiles('routes'), 'server.js']
    .filter(rel => !SHELL.has(rel))
    .filter(rel => {
      const source = readFileSync(join(ROOT, rel), 'utf8');
      return shellImport.test(source) || plainImport.test(source);
    })
    .sort();
}

test('the allowance is sorted and names no file twice', () => {
  assert.deepEqual([...OLD_CHROME_ALLOWANCE].sort(), OLD_CHROME_ALLOWANCE);
  assert.equal(new Set(OLD_CHROME_ALLOWANCE).size, OLD_CHROME_ALLOWANCE.length);
});

test('no file outside the list assembles its own chrome: a new page goes through the frame', () => {
  const extra = oldChromeFiles().filter(rel => !OLD_CHROME_ALLOWANCE.includes(rel));
  assert.deepEqual(extra, [], `render through renderFrame or renderPublicFrame (lib/components/frame.js), not renderPage: ${extra.join(', ')}`);
});

test('the list only falls: a listed file that moved onto the frame comes off it in the same change', () => {
  const found = new Set(oldChromeFiles());
  const stale = OLD_CHROME_ALLOWANCE.filter(rel => !found.has(rel));
  assert.deepEqual(stale, [], `no longer imports the shell's renderPage; delete from OLD_CHROME_ALLOWANCE: ${stale.join(', ')}`);
});

test('the pages piece 2 moved are on the frame (LIN-4563: Home and Backlog, the task page, edit, new and not found)', () => {
  for (const rel of ['lib/render.js', 'lib/render-task-page.js', 'lib/render-task-edit.js', 'lib/render-task-create.js']) {
    assert.ok(!OLD_CHROME_ALLOWANCE.includes(rel), `${rel} is listed as old chrome`);
    assert.match(readFileSync(join(ROOT, rel), 'utf8'), /renderFrame\(/, `${rel} renders through the frame`);
  }
});

test('the pages piece 1 moved are on the frame', () => {
  for (const rel of ['lib/render-proxy.js', 'lib/render-search.js']) {
    assert.ok(!OLD_CHROME_ALLOWANCE.includes(rel), `${rel} is listed as old chrome`);
    assert.match(readFileSync(join(ROOT, rel), 'utf8'), /renderFrame\(/, `${rel} renders through the frame`);
  }
});
