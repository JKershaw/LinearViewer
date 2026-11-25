/**
 * LIN-3980 outcome 6, as LIN-4568 (LIN-4342 piece 7) left it: the landing draws the footer every page shares
 * (renderFrameFooter, lib/components/frame.js), so a visitor on `/` meets the same Library, Templates, Privacy, Terms and
 * Source as everywhere else. The previews the old landing footer named ("previews: swipe · swim") are links beside the
 * swim glimpse they preview, so `/` still leads to both.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLandingPage } from '../../lib/render-landing.js';
import { renderFrameFooter } from '../../lib/components/frame.js';

const DEPLOY = { version: 'v9', commit: 'abcdef1234567' };

test('the landing footer is the frame footer, byte for byte', () => {
  const html = renderLandingPage({ deployInfo: DEPLOY });
  assert.ok(html.includes(renderFrameFooter(DEPLOY)), 'the shared footer, unchanged');
  assert.equal(html.match(/<footer\b/g).length, 1, 'one footer');
  assert.doesNotMatch(html, /page-footer|footer-actions|previews:/, 'the old footer and its preview row are gone');
});

test('the previews are linked from the swim section, beside the board they preview', () => {
  const html = renderLandingPage({});
  const swim = html.slice(html.indexOf('data-testid="landing-swim"'), html.indexOf('data-testid="landing-prompt"'));
  assert.match(swim, /<a[^>]*href="\/swim"[^>]*data-testid="landing-preview-swim"/);
  assert.match(swim, /<a[^>]*href="\/swipe"[^>]*data-testid="landing-preview-swipe"/);
});

test('the landing loads the frame sheet that styles the footer', () => {
  assert.match(renderLandingPage({}), /href="\/frame\.css"/);
});
