/**
 * LIN-975 — Uniform page titles.
 *
 * Pins that the previously non-conforming page renderers emit their page title
 * through the shared `renderPageHeader` primitive (`lib/components/page-header.js`),
 * i.e. inside a `<header class="page-header …"><h1>…</h1>` block, rather than a
 * bespoke hand-rolled `<h1>`. Swipe is included because it previously had no
 * title at all and must now carry one.
 *
 * Run with: node --test tests/unit/page-title-primitive.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { renderSwipePage } from '../../lib/render-swipe.js';
import { renderObservationPage } from '../../lib/render-observation.js';
import { renderRoadmapPage } from '../../lib/render-roadmap.js';
import { renderCollectivePage } from '../../lib/render-collective.js';
import { renderTaskChatPage } from '../../lib/render-task-chat.js';
import { renderNextRunPage } from '../../lib/render-next-run.js';
import { renderFlightCompanionPage } from '../../lib/render-flight-companion.js';
import { renderPassagePlannerPage } from '../../lib/render-passage-planner.js';

// The first <h1> that sits directly inside a `.page-header` header — i.e. the
// title as emitted by renderPageHeader. A page that hand-rolls its own <h1>
// outside the primitive will not match.
function pageHeaderTitle(html) {
  const m = html.match(/<header class="page-header[^"]*">\s*<h1>([\s\S]*?)<\/h1>/);
  return m ? m[1] : null;
}

const CASES = [
  {
    name: 'swipe',
    title: 'Swipe',
    html: () =>
      renderSwipePage(
        { projectTrees: [], inProgressTrees: [], recentActivityTrees: [] },
        { urlKey: 'ws', workspaces: [{ id: 'w1', urlKey: 'ws' }] }
      ),
  },
  {
    name: 'observation',
    title: 'Observation',
    html: () =>
      renderObservationPage(
        { workspaces: [{ urlKey: 'ws', name: 'WS' }] },
        { urlKey: 'ws' }
      ),
  },
  {
    name: 'roadmap',
    title: 'Roadmap',
    html: () => renderRoadmapPage({ roadmapModel: {} }, { urlKey: 'ws' }),
  },
  {
    name: 'collective',
    title: 'Collective',
    html: () =>
      renderCollectivePage(
        { workspaces: [{ urlKey: 'ws', name: 'WS' }], defaultChannel: '#c' },
        { urlKey: 'ws' }
      ),
  },
  {
    name: 'task-chat',
    title: 'Task Chat',
    html: () => renderTaskChatPage({}, { urlKey: 'ws' }),
  },
  {
    name: 'next-run',
    title: 'Suggested Next Run',
    html: () => renderNextRunPage({}, { urlKey: 'ws' }),
  },
  {
    name: 'flight-companion',
    title: 'Flight Companion',
    html: () => renderFlightCompanionPage({}, { urlKey: 'ws' }),
  },
  {
    name: 'passage-planner',
    title: 'Passage Planner',
    html: () => renderPassagePlannerPage({}, { urlKey: 'ws' }),
  },
];

describe('LIN-975: page titles route through renderPageHeader', () => {
  for (const { name, title, html } of CASES) {
    test(`${name} renders its title via the shared page-header primitive`, () => {
      const out = html();
      const rendered = pageHeaderTitle(out);
      assert.ok(
        rendered != null,
        `${name} should emit a <header class="page-header"><h1> block`
      );
      // startsWith (not equals) so observation's fused "● live" indicator, which
      // rides inside the h1 via titleHtml, still passes.
      assert.ok(
        rendered.startsWith(title),
        `${name} page-header title should be "${title}" (got: ${JSON.stringify(rendered)})`
      );
    });
  }

  test('no listed page keeps a bespoke hand-rolled title <h1>', () => {
    // The old per-page title classes must be gone from their rendered output.
    const stale = [
      ['collective', renderCollectivePage({ workspaces: [], defaultChannel: '#c' }, { urlKey: 'ws' }), 'collective-header'],
      ['task-chat', renderTaskChatPage({}, { urlKey: 'ws' }), 'task-chat-header'],
      ['next-run', renderNextRunPage({}, { urlKey: 'ws' }), 'next-run-header'],
      ['flight-companion', renderFlightCompanionPage({}, { urlKey: 'ws' }), 'flight-companion-header'],
      ['passage-planner', renderPassagePlannerPage({}, { urlKey: 'ws' }), 'passage-planner-header'],
      ['roadmap', renderRoadmapPage({ roadmapModel: {} }, { urlKey: 'ws' }), 'roadmap-page-title'],
    ];
    for (const [name, out, cls] of stale) {
      assert.ok(
        !out.includes(cls),
        `${name} should no longer emit the bespoke "${cls}" title class`
      );
    }
  });
});
