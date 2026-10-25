/**
 * LIN-3833 step 3, the C14 pin: `renderDetailsContent` on its `isLanding` branch (render.js, the inline
 * call in renderNodeHtml) keeps today's markup byte for byte. That branch has no production caller since
 * LIN-980 (`/` is renderLandingPage), so it is test-only, and this pin is what keeps it honest while the
 * Home layout changes. The hash was taken from the code before the layout change.
 *
 * The Home layout is opt-in (`layout: 'home'`, used by the lazy detail route), so the default
 * (signed-in, legacy) markup is pinned too, by the existing render tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderDetailsContent } from '../../lib/render.js';

const ISSUE = {
  id: 'issue-uuid-1', identifier: 'LIN-42', title: 'Pin', url: 'https://linear.app/x/issue/LIN-42',
  description: 'A **description**', state: { name: 'In Progress', type: 'started' },
  assignee: { name: 'Ada' }, estimate: 3, dueDate: '2026-11-01', createdAt: '2026-10-01T00:00:00.000Z',
  labels: { nodes: [{ name: 'bug' }] }, comments: { nodes: [] }, children: { nodes: [] }
};

// sha256 of renderDetailsContent(ISSUE, { isLanding: true, section: 'in-progress' }) at origin/main 87a766bc.
const LANDING_SHA256 = '021f9cfb0f5fa2ac59ec9ea85622dba84be8d72a6fdd46413c477672e98dd83a';

test('LIN-3833 C14: the isLanding branch of renderDetailsContent is byte-identical to today', () => {
  const html = renderDetailsContent(ISSUE, { isLanding: true, urlKey: null, featureFlags: {}, provider: null, section: 'in-progress' });
  assert.equal(createHash('sha256').update(html).digest('hex'), LANDING_SHA256);
});
