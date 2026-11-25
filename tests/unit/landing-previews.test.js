/**
 * LIN-3995 outcome 1: a signed-out preview says it is a preview, on the page
 * itself. Its header carries the sample-tasks line, its way back names home as
 * PREVIEW_HOME_LABEL, and nothing says "projects". Signed-in output carries none of it.
 *
 * LIN-4564 (LIN-4342 piece 3): the previews sit in the public frame. The way back is the band's ("← Harbour", to `/`)
 * and the footer is the frame's, the same on every page, so the preview footer row (and its home link) is gone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSwipePage } from '../../lib/render-swipe.js';
import { renderSwimPage } from '../../lib/render-swim.js';
import { PREVIEW_HOME_LABEL, PREVIEW_NOTE } from '../../lib/components/footer.js';
// Side-effect import: registers the Linear provider so the fallback resolves.
import '../../lib/providers/linear/index.js';

const EMPTY = { projectTrees: [], inProgressTrees: [], recentActivityTrees: [] };
const BACK_LINK = `<a class="frame-back frame-public__back" href="/" data-testid="frame-back">← ${PREVIEW_HOME_LABEL}</a>`;

for (const [name, render] of [['swipe', renderSwipePage], ['swim', renderSwimPage]]) {
  test(`signed-out ${name} says it shows sample tasks, under its title`, () => {
    const html = render(EMPTY, { isLanding: true });
    assert.equal(html.split(PREVIEW_NOTE).length - 1, 1, 'the preview line appears once');
    assert.match(html, new RegExp(`<p class="page-header__subtitle[^"]*">${PREVIEW_NOTE}</p>`));
  });

  test(`signed-out ${name} sits in the public frame: "← Harbour" home, the sign-in path, the frame's footer`, () => {
    const html = render(EMPTY, { isLanding: true });
    assert.ok(html.includes(BACK_LINK), 'the way back reads "← Harbour" and goes to /');
    assert.match(html, /data-testid="frame-public-band"/, 'the public band, no rail');
    assert.doesNotMatch(html, /data-testid="frame-rail"/);
    assert.match(html, /data-testid="nav-login-linear"/, 'the preview keeps its sign-in path (its sole one)');
    assert.match(html, /data-testid="frame-footer"/, 'the frame\'s footer, the same on every page');
    assert.ok(!html.includes('footer-label">previews:'), 'no preview footer row');
    assert.match(html, new RegExp(`<title>${name[0].toUpperCase()}${name.slice(1)} · Harbour</title>`));
    assert.doesNotMatch(html, /← projects/);
    assert.doesNotMatch(html, />projects</);
  });

  test(`signed-in ${name} shows no preview line, no "← Harbour" back link, and no preview footer row`, () => {
    const html = render(EMPTY, { urlKey: 'acme', workspaces: [], featureFlags: {}, isLanding: false });
    assert.ok(!html.includes(PREVIEW_NOTE), 'no preview line');
    assert.ok(!html.includes(BACK_LINK), 'no preview back link');
    assert.ok(!html.includes('nav-login-'), 'no sign-in path');
    assert.match(html, /data-testid="frame-rail"/, 'the signed-in frame');
  });
}
