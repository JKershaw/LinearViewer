/**
 * LIN-4568 (LIN-4342 piece 7): the old bar, its view strip, the old footer and their client code and CSS are deleted,
 * not left dead for the stylesheet rebuild (LIN-4017). tests/unit/frame-census.test.js pins the renderers; this pins the
 * rest: no stylesheet keeps a rule for an old-chrome class that no markup emits, the old bar's client is gone from
 * public/common.js and public/app.js, and the sticky-header tokens stay defined (page-level fixed controls and
 * tests/fixed-overlay-sweep.js read them) without the old bar's measured height behind them.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4568-old-chrome-gone.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
// Comments that open a line (a `/* … */` or `/** … */` block, a `//` line): a string holding `*/*` or a URL is not one.
const stripJs = (js) => js.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/[^\n]*/gm, '');

function files(dir, ext) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return files(rel, ext);
    return name.endsWith(ext) ? [rel] : [];
  });
}

const SHEETS = readdirSync(join(ROOT, 'public')).filter(n => n.endsWith('.css')).map(n => `public/${n}`);

/** Every class name the app can emit: the server renderers and the browser scripts, comments stripped. */
function markupSource() {
  return [...files('lib', '.js'), ...files('routes', '.js'), 'server.js', ...files('public', '.js')]
    .map(rel => stripJs(read(rel))).join('\n');
}

describe('the old chrome\'s CSS is gone (LIN-4568)', () => {
  // The families the old bar and footer used. A class in one of them that a sheet still styles must be one that live
  // markup emits: the filter line keeps the bar's selector markup (.nav-item, .nav-value, .nav-option…), the rail's foot
  // the AI status (.footer-ai-status) and the footer stamp its commit link (.footer-link).
  const FAMILY = /^(?:nav-|footer-|page-footer|queue-badge|queue-panel|wordmark-)/;
  // Built at runtime, so no source holds the literal: `wordmark-${context}` (lib/components/wordmark.js).
  const BUILT = new Set(['wordmark-rail']);

  test('no stylesheet styles an old-chrome class that no markup emits', () => {
    const source = markupSource();
    const dead = [];
    for (const sheet of SHEETS) {
      const classes = new Set([...stripCss(read(sheet)).matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(m => m[1]).filter(c => FAMILY.test(c)));
      for (const c of classes) {
        if (BUILT.has(c)) continue;
        if (!new RegExp(`(?<![\\w-])${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(source)) dead.push(`${sheet}: .${c}`);
      }
    }
    assert.deepEqual(dead, [], `rules left for old-chrome classes nothing draws:\n${dead.join('\n')}`);
  });

  test('the old bar\'s own classes have no rule anywhere', () => {
    for (const sheet of SHEETS) {
      assert.doesNotMatch(stripCss(read(sheet)), /\.(?:nav-bar|nav-views?|nav-actions?|nav-primary-row|nav-more-toggle|page-footer|queue-panel|queue-badge)(?![\w-])/, sheet);
    }
  });
});

describe('the old bar\'s client is gone (LIN-4568)', () => {
  test('public/common.js: the filter line\'s client remains, the bar\'s overflow and height measure do not', () => {
    const common = stripJs(read('public/common.js'));
    assert.match(common, /function initFilterLine\(\)/);
    assert.match(common, /initFilterLine\(\);/);
    assert.doesNotMatch(common, /initNavBar|setupNavViewsOverflow|setupNavStickyHeight|\.nav-bar|nav-views|--nav-bar-h|workspace-toggle/);
  });

  test('public/app.js: the old bar\'s queue popover and its poll are gone (the rail\'s count is common.js\'s)', () => {
    const app = stripJs(read('public/app.js'));
    assert.doesNotMatch(app, /initQueuePanel|showQueuePanel|queue-panel|button\[data-queue-badge\]|startQueuePolling|stopQueuePolling/);
    assert.match(stripJs(read('public/common.js')), /function initQueueBadge\(\)/);
  });
});

describe('the sticky-header tokens stay defined, with no old bar behind them (LIN-984, LIN-4037, LIN-4562)', () => {
  const style = stripCss(read('public/style.css'));

  test('--nav-sticky-h is declared once, and the floor once: no per-breakpoint bar offsets are left', () => {
    assert.equal(style.match(/--nav-sticky-h\s*:/g)?.length, 1);
    assert.match(style, /--nav-sticky-h:\s*max\(var\(--nav-sticky-min\),\s*var\(--nav-bar-h,\s*0px\)\);/);
    assert.equal(style.match(/--nav-sticky-min\s*:/g)?.length, 1, 'one floor: the old bar\'s 7.75rem and 13rem phone offsets are gone');
    assert.match(style, /--nav-sticky-min:\s*0px;/, 'outside the frame no header is pinned');
  });

  test('the frame sets the tokens on its pages: the band\'s height on a phone, 0 on desktop', () => {
    const frame = stripCss(read('public/frame.css'));
    assert.match(frame, /:root:has\(> body\.frame-body\)\s*\{[^}]*--nav-sticky-min:\s*0px;[^}]*--nav-bar-h:\s*0px;/);
    assert.match(frame, /--nav-bar-h:\s*var\(--frame-band-h\)/);
  });

  test('the per-interaction clearance still rides on scroll-margin, never scroll-padding (LIN-984)', () => {
    assert.match(style, /:where\(a, button, input, select, textarea, summary, label, \[role="button"\], \[tabindex\]\)\s*\{\s*scroll-margin-top:\s*var\(--nav-sticky-h\);/);
    assert.doesNotMatch(style, /scroll-padding-top:/);
  });
});
