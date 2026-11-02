/**
 * LIN-4115 (UI round 3 · S3d): the halt banner on Home, as `renderPage` draws it.
 *
 * `renderPage(..., { halt })` draws one banner above the onboarding hint, the copy-first card and the
 * notices, only when `halt.mode` is in HALT_MODES. The owner (`runControls` or `runSetup`, the Dispatch
 * page's rule) gets a link to Dispatch; anyone else reads the same sentence as plain text.
 *
 * Witnesses (each fails on the unimplemented path, except the two no-halt controls, which pin today's
 * output so the change cannot move it):
 *  - pause and stop give the exact sentence, keyed off HALT_MODES;
 *  - the owner with a runner and the owner with no runner (runSetup) get the link to /workspace/<urlKey>/dispatch;
 *  - a member, a missing owner record and an unknown mode get plain text and zero links;
 *  - no halt, null halt and an unknown mode give no banner, and `halt: null` is byte-identical to omitting it;
 *  - the banner sits before the seed-only hint and before the copy-first card, and both still render;
 *  - the wording table covers every HALT_MODES entry.
 *
 * Run: node --test tests/unit/lin-4115-home-halt-banner.test.js
 */
import '../../lib/providers/index.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../../lib/render.js';
import { HALT_MODES } from '../../lib/workspace-halt.js';

const URL_KEY = 'acme';
const DISPATCH_HREF = `/workspace/${URL_KEY}/dispatch`;
const SENTENCE = { pause: 'Runs are paused · cleared on Dispatch ›', stop: 'Runs are stopped · cleared on Dispatch ›' };

const OWNER_WITH_RUNNER = { runControls: true, runSetup: false };
const OWNER_NO_RUNNER = { runControls: false, runSetup: true };
const MEMBER = { runControls: false, runSetup: false };

const haltOf = (mode) => ({ mode, setAt: '2026-11-01T00:00:00.000Z', setBy: 'alice' });

function render({ halt, featureFlags = OWNER_WITH_RUNNER, topTaskOnboarding = false, copyFirstCard = false } = {}) {
  const options = { urlKey: URL_KEY, featureFlags, topTaskOnboarding, copyFirstCard };
  if (halt !== undefined) options.halt = halt;
  return renderPage([], [], [], 'Org', options);
}

// The banner element's inner HTML, or null when no banner is drawn. The banner is a single flat <div>.
function bannerInner(html) {
  const m = html.match(/<div[^>]*data-testid="home-halt-banner"[^>]*>([\s\S]*?)<\/div>/);
  return m ? m[0] : null;
}
const bannerText = (html) => {
  const el = bannerInner(html);
  return el === null ? null : el.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
};

describe('LIN-4115 — Home halt banner: the sentence for each halt mode', () => {
  test('pause: the exact sentence, with the mode on the banner and the owner link', () => {
    const html = render({ halt: haltOf('pause') });
    assert.equal(bannerText(html), SENTENCE.pause);
    const el = bannerInner(html);
    assert.ok(el, 'a banner element is drawn');
    assert.match(el, /data-halt-banner-mode="pause"/);
    assert.match(el, /role="status"/);
    assert.match(el, new RegExp(`<a[^>]*href="${DISPATCH_HREF}"[^>]*data-testid="home-halt-dispatch-link"[^>]*>Dispatch ›</a>`));
  });

  test('stop: the exact sentence, with the mode on the banner and the owner link', () => {
    const html = render({ halt: haltOf('stop') });
    assert.equal(bannerText(html), SENTENCE.stop);
    const el = bannerInner(html);
    assert.ok(el, 'a banner element is drawn');
    assert.match(el, /data-halt-banner-mode="stop"/);
    assert.match(el, new RegExp(`<a[^>]*href="${DISPATCH_HREF}"[^>]*data-testid="home-halt-dispatch-link"`));
  });

  test('the sentence is exactly the ticket wording, middle dot and chevron included', () => {
    assert.equal(SENTENCE.pause, 'Runs are paused · cleared on Dispatch ›');
    assert.equal(SENTENCE.stop, 'Runs are stopped · cleared on Dispatch ›');
    assert.equal(bannerText(render({ halt: haltOf('pause') })), SENTENCE.pause);
  });
});

describe('LIN-4115 — Home halt banner: who gets the Dispatch link', () => {
  test('the owner with a live runner (runControls) gets the link', () => {
    const el = bannerInner(render({ halt: haltOf('pause'), featureFlags: OWNER_WITH_RUNNER }));
    assert.ok(el, 'banner drawn');
    assert.equal((el.match(/<a\b/g) || []).length, 1, 'exactly one link');
  });

  test('the owner with no runner (runSetup, the new user) gets the link too', () => {
    const el = bannerInner(render({ halt: haltOf('stop'), featureFlags: OWNER_NO_RUNNER }));
    assert.ok(el, 'banner drawn');
    assert.equal((el.match(/<a\b/g) || []).length, 1, 'exactly one link');
    assert.match(el, new RegExp(`href="${DISPATCH_HREF}"`));
  });

  test('a member sees the same sentence with no link at all', () => {
    const html = render({ halt: haltOf('pause'), featureFlags: MEMBER });
    assert.equal(bannerText(html), SENTENCE.pause);
    const el = bannerInner(html);
    assert.ok(el, 'banner drawn');
    assert.equal((el.match(/<a\b/g) || []).length, 0, 'no <a> inside the banner');
    assert.ok(!html.includes('home-halt-dispatch-link'), 'no dispatch-link testid anywhere on the page');
    assert.ok(!html.includes(DISPATCH_HREF), 'no link to Dispatch from the banner');
  });

  test('no owner on record (flags absent) is treated as a member: plain text, no link', () => {
    const html = render({ halt: haltOf('stop'), featureFlags: {} });
    assert.equal(bannerText(html), SENTENCE.stop);
    assert.ok(!html.includes('home-halt-dispatch-link'));
    assert.equal((bannerInner(html).match(/<a\b/g) || []).length, 0);
  });
});

describe('LIN-4115 — Home halt banner: no halt means no banner, and no change', () => {
  test('a null halt draws no banner', () => {
    assert.equal(bannerInner(render({ halt: null })), null);
  });

  test('an omitted halt option draws no banner', () => {
    assert.equal(bannerInner(render()), null);
  });

  test('an unknown mode draws no banner (not in HALT_MODES)', () => {
    assert.equal(bannerInner(render({ halt: haltOf('drain') })), null);
  });

  test('halt: null renders byte-identical HTML to omitting the option (no-halt output unchanged)', () => {
    const omitted = render();
    const withNull = render({ halt: null });
    assert.equal(withNull, omitted);
    assert.ok(!withNull.includes('home-halt'), 'no halt markup at all without a halt');
  });

  test('a member with no halt gets no banner and no halt markup', () => {
    const html = render({ halt: null, featureFlags: MEMBER });
    assert.ok(!html.includes('home-halt'));
  });
});

describe('LIN-4115 — Home halt banner: placement beside the onboarding hint and the copy-first card', () => {
  test('the banner sits before the seed-only onboarding hint, and the hint still renders', () => {
    const html = render({ halt: haltOf('pause'), topTaskOnboarding: true });
    const banner = html.indexOf('data-testid="home-halt-banner"');
    const hint = html.indexOf('data-testid="home-top-task-onboarding"');
    assert.ok(banner >= 0, 'banner drawn');
    assert.ok(hint >= 0, 'onboarding hint still drawn');
    assert.ok(banner < hint, 'banner comes before the hint');
  });

  test('the banner sits before the copy-first card, and the card still renders', () => {
    const html = render({ halt: haltOf('stop'), copyFirstCard: true, featureFlags: OWNER_NO_RUNNER });
    const banner = html.indexOf('data-testid="home-halt-banner"');
    const card = html.indexOf('data-testid="home-copy-first-card"');
    assert.ok(banner >= 0, 'banner drawn');
    assert.ok(card >= 0, 'copy-first card still drawn');
    assert.ok(banner < card, 'banner comes before the card');
  });

  test('the banner is above the Home content (before <main>)', () => {
    const html = render({ halt: haltOf('pause') });
    assert.ok(html.indexOf('data-testid="home-halt-banner"') < html.indexOf('<main>'), 'banner is above <main>');
  });
});

describe('LIN-4115 — Home halt banner: the wording table covers every HALT_MODES entry', () => {
  test('each mode in HALT_MODES draws "Runs are <word> · cleared on Dispatch ›" with its own non-empty word', () => {
    const words = new Set();
    for (const mode of HALT_MODES) {
      const text = bannerText(render({ halt: haltOf(mode) }));
      assert.ok(text, `mode "${mode}" has no banner, so it has no wording`);
      const m = text.match(/^Runs are (\w+) · cleared on Dispatch ›$/);
      assert.ok(m, `mode "${mode}" wording is not the ticket's sentence: ${text}`);
      words.add(m[1]);
    }
    assert.equal(words.size, HALT_MODES.length, 'every mode has a distinct word');
  });

  test('HALT_MODES is exactly pause and stop (the set the wording table is keyed from)', () => {
    assert.deepEqual([...HALT_MODES], ['pause', 'stop']);
  });
});
