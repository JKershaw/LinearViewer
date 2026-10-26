/**
 * LIN-3995 outcome 1: a signed-out preview says it is a preview, on the page
 * itself. Its header carries the sample-tasks line, its back link and footer
 * name the way home the same way (PREVIEW_HOME_LABEL), and nothing says
 * "projects". Signed-in output carries none of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSwipePage } from '../../lib/render-swipe.js';
import { renderSwimPage } from '../../lib/render-swim.js';
import { PREVIEW_HOME_LABEL, PREVIEW_NOTE } from '../../lib/components/footer.js';
// Side-effect import: registers the Linear provider so the fallback resolves.
import '../../lib/providers/linear/index.js';

const EMPTY = { projectTrees: [], inProgressTrees: [], recentActivityTrees: [] };
const BACK_LINK = `<a href="/" class="nav-action">← ${PREVIEW_HOME_LABEL}</a>`;
const HOME_FOOTER_LINK = `<a href="/" class="footer-action" data-testid="footer-link-landing">${PREVIEW_HOME_LABEL}</a>`;

for (const [name, render] of [['swipe', renderSwipePage], ['swim', renderSwimPage]]) {
  test(`signed-out ${name} says it shows sample tasks, under its title`, () => {
    const html = render(EMPTY, { isLanding: true });
    assert.equal(html.split(PREVIEW_NOTE).length - 1, 1, 'the preview line appears once');
    assert.match(html, new RegExp(`<p class="page-header__subtitle[^"]*">${PREVIEW_NOTE}</p>`));
  });

  test(`signed-out ${name} names the way home the same in its back link and its footer row`, () => {
    const html = render(EMPTY, { isLanding: true });
    assert.ok(html.includes(BACK_LINK), 'the back link reads "← Harbour" and goes to /');
    assert.ok(html.includes(HOME_FOOTER_LINK), 'the footer home link reads the same name');
    assert.ok(html.includes('<span class="footer-label">previews:</span>'), 'the footer row names the previews');
    assert.doesNotMatch(html, /← projects/);
    assert.doesNotMatch(html, />projects</);
  });

  test(`signed-in ${name} shows no preview line, no "← Harbour" back link, and no preview footer row`, () => {
    const html = render(EMPTY, { urlKey: 'acme', workspaces: [], featureFlags: {}, isLanding: false });
    assert.ok(!html.includes(PREVIEW_NOTE), 'no preview line');
    assert.ok(!html.includes(BACK_LINK), 'no preview back link');
    assert.ok(!html.includes('footer-label">previews:'), 'no preview footer row');
  });
}
