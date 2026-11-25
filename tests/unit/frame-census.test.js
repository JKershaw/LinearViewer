/**
 * LIN-4562 (LIN-4342 piece 1): the frame census. Every page sits in one frame (lib/components/frame.js renderFrame /
 * renderPublicFrame), which owns the skip link, the rail or public band, the one h1, the footer and the tab title. A
 * file that imports the shell's `renderPage` (lib/components/page.js) assembles its own chrome, so it is "on the old
 * chrome". Pieces 1 to 6 held a ratchet here, an allowance of such files that only fell; LIN-4568 (piece 7) moved the
 * last one (the Project backlog) onto the frame and deleted the allowance with the old bar and footer. Now any file
 * outside the shell, the frame and the one named exception that assembles its own chrome fails.
 *
 * Witness: importing the shell's renderPage into lib/render-proxy.js (on the frame) fails "no file assembles its own chrome".
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/frame-census.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The shell itself and the frame, which are the two places allowed to call it for good. */
const SHELL = new Set(['lib/components/page.js', 'lib/components/frame.js']);

/**
 * LIN-4567 (piece 6): the named exception, allowed for good and not part of the allowance that falls. The landing (`/`)
 * keeps its own hero, whose large wordmark is its h1, and draws no band: the hero is the sign-in surface and already
 * carries the wordmark (LIN-1508 removed the bar from it for that reason). The parent plan (plan-46603cd7) names it.
 */
const NAMED_EXCEPTIONS = new Set(['lib/render-landing.js']);

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
    .filter(rel => !SHELL.has(rel) && !NAMED_EXCEPTIONS.has(rel))
    .filter(rel => {
      const source = readFileSync(join(ROOT, rel), 'utf8');
      return shellImport.test(source) || plainImport.test(source);
    })
    .sort();
}

test('no file assembles its own chrome: every page goes through the frame (LIN-4568: the allowance is gone)', () => {
  const extra = oldChromeFiles();
  assert.deepEqual(extra, [], `render through renderFrame or renderPublicFrame (lib/components/frame.js), not renderPage: ${extra.join(', ')}`);
});

// LIN-4568 (piece 7): the old chrome itself is gone, not just unused: the bar, its view strip, the old footer, the page
// header outside the frame. A source file calling one of them, or the deleted view-nav module coming back, fails here.
const OLD_CHROME_CALL = /\b(?:renderNavBar|renderPageFooter|renderViewNav|getViewNavLinks|renderWorkspaceOptions)\b/;

test('the old bar, its view strip and the old footer are deleted, and nothing in the app names them (LIN-4568)', () => {
  assert.ok(!existsSync(join(ROOT, 'lib/components/view-nav.js')), 'lib/components/view-nav.js is deleted');
  const named = [...jsFiles('lib'), ...jsFiles('routes'), 'server.js', ...jsFiles('public')]
    .filter(rel => OLD_CHROME_CALL.test(readFileSync(join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
  assert.deepEqual(named, [], `the old chrome is still called from: ${named.join(', ')}`);
  // The page header is the frame's own (its one h1): no page draws a second.
  const headers = [...jsFiles('lib'), ...jsFiles('routes'), 'server.js']
    .filter(rel => rel !== 'lib/components/frame.js' && rel !== 'lib/components/page-header.js')
    .filter(rel => /renderPageHeader\(/.test(readFileSync(join(ROOT, rel), 'utf8')));
  assert.deepEqual(headers, [], `a page draws its own header beside the frame's: ${headers.join(', ')}`);
});

test('the page piece 7 moved is on the frame (LIN-4568: the Project backlog, drilled in under Backlog)', () => {
  const source = readFileSync(join(ROOT, 'lib/render-project-page.js'), 'utf8');
  assert.match(source, /renderFrame\(\{\s*place: 'project'/, 'renders through the frame at project');
  assert.doesNotMatch(source, /renderPage\(|<main/, 'draws no page shell and no second <main> of its own');
});

test('the landing draws the footer every page shares (LIN-4568: the old footer went)', () => {
  const source = readFileSync(join(ROOT, 'lib/render-landing.js'), 'utf8');
  assert.match(source, /renderFrameFooter\(/);
});

// LIN-4567 (piece 6): the public and signed-out pages sit in the public frame: Library, Templates, Privacy and Terms,
// Getting started, the public KPIs, email sign-in, the account home, the shared error and sign-in pages, and the
// styleguide. (The previews moved in piece 3 and the guest task in piece 2.) None draws the old footer or a second
// header; the Plain helper no longer wraps the shell.
const PIECE_6 = [
  'lib/render-library.js', 'lib/render-templates.js', 'lib/render-legal.js', 'routes/getting-started.js', 'lib/render-kpis.js',
  'lib/render-email-auth.js', 'lib/render-account-home.js', 'lib/render-pages.js', 'lib/render-styleguide.js',
];

test('the pages piece 6 moved are on the public frame (LIN-4567: public and signed-out pages)', () => {
  for (const rel of PIECE_6) {
    const source = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(source, /renderPublicFrame\(/, `${rel} renders through the public frame`);
    assert.doesNotMatch(source, /renderNavBar\(|renderPageFooter\(|renderPageHeader\(|renderPlainPage\(|renderPlainDocument\(/, `${rel} draws no old bar, old footer or second header`);
  }
});

test('the landing is the one named exception: its hero and no band (LIN-1508)', () => {
  assert.deepEqual([...NAMED_EXCEPTIONS], ['lib/render-landing.js']);
  // The exception is real: the landing does import the shell (a stale exception would hide nothing and say something).
  assert.match(readFileSync(join(ROOT, 'lib/render-landing.js'), 'utf8'), /import\s*\{[^}]*\brenderPage\b[^}]*\}\s*from\s*'\.\/components\/page\.js'/);
});

// LIN-4566 (piece 5): Settings and the rest of Set up. Settings is one place (every area renders through the one
// renderer, the areas list beside the area in <main>); Run on my machine is drilled in under Settings.
test('the pages piece 5 moved are on the frame (LIN-4566: Settings and Run on my machine)', () => {
  for (const [rel, place] of [['lib/render-settings.js', 'settings'], ['lib/render-runner-setup.js', 'runner']]) {
    const source = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(source, new RegExp(`renderFrame\\(\\{\\s*place: '${place}'`), `${rel} renders through the frame at ${place}`);
    assert.doesNotMatch(source, /renderNavBar\(|renderPageFooter\(|renderPageHeader\(/, `${rel} draws no old bar, old footer or second header`);
  }
});

// LIN-4565 (piece 4): Tools. Dispatch, KPIs and Prompts at their places; Escalation and Effort drilled in under KPIs
// (which links both), Custom prompts under Prompts, Operator audit under Settings.
const PIECE_4 = ['dispatch', 'workspace-kpis', 'escalation-kpis', 'effort-readout', 'prompts', 'custom-prompts', 'audit'];

test('the pages piece 4 moved are on the frame (LIN-4565: Tools)', () => {
  for (const name of PIECE_4) {
    const rel = `lib/render-${name}.js`;
    const source = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(source, /renderFrame\(/, `${rel} renders through the frame`);
    assert.doesNotMatch(source, /renderNavBar\(|renderPageFooter\(|renderPageHeader\(/, `${rel} draws no old bar, old footer or second header`);
  }
});

// LIN-4564 (piece 3): Watch and Views. Runs, the run page and Live; Swipe, Swim and Roadmap; and every flagged view
// (EXPERIMENTAL_VIEWS), each at its own place. Swipe, Swim and Ship draw their signed-out previews in the public frame.
const PIECE_3 = ['observation', 'session', 'live-console', 'swipe', 'swim', 'roadmap', 'collective', 'task-chat', 'ship', 'flight-companion', 'passage-planner', 'ship-biscuit', 'ship-journey'];

test('the pages piece 3 moved are on the frame (LIN-4564: Watch and Views)', () => {
  for (const name of PIECE_3) {
    const rel = `lib/render-${name}.js`;
    const source = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(source, /renderFrame\(/, `${rel} renders through the frame`);
    assert.doesNotMatch(source, /renderNavBar\(|renderPageFooter\(/, `${rel} draws no old bar or old footer`);
  }
  for (const name of ['swipe', 'swim', 'ship']) {
    assert.match(readFileSync(join(ROOT, `lib/render-${name}.js`), 'utf8'), /renderPublicFrame\(/, `${name}'s signed-out preview sits in the public frame`);
  }
});

test('the pages piece 2 moved are on the frame (LIN-4563: Home and Backlog, the task page, edit, new and not found)', () => {
  for (const rel of ['lib/render.js', 'lib/render-task-page.js', 'lib/render-task-edit.js', 'lib/render-task-create.js']) {
    assert.match(readFileSync(join(ROOT, rel), 'utf8'), /renderFrame\(|renderTaskFrame\(/, `${rel} renders through the frame`);
  }
  // The task family maps its options onto the frame once (renderTaskFrame, in the task page's renderer); edit and new go through it.
  assert.match(readFileSync(join(ROOT, 'lib/render-task-page.js'), 'utf8'), /renderFrame\(/, 'renderTaskFrame draws the frame');
  for (const rel of ['lib/render-task-edit.js', 'lib/render-task-create.js']) {
    assert.match(readFileSync(join(ROOT, rel), 'utf8'), /renderTaskFrame\(/, `${rel} goes through the task family's one frame mapping`);
  }
});

test('the pages piece 1 moved are on the frame', () => {
  for (const rel of ['lib/render-proxy.js', 'lib/render-search.js']) {
    assert.match(readFileSync(join(ROOT, rel), 'utf8'), /renderFrame\(/, `${rel} renders through the frame`);
  }
});
