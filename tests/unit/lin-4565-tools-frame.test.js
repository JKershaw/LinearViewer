/**
 * LIN-4565 (LIN-4342 piece 4): Tools on the frame. Dispatch, KPIs, Escalation, Effort, Prompts, Custom prompts and
 * Operator audit render through renderFrame (lib/components/frame.js), each at its key in lib/places.js:
 *   - one h1, the page's name from the registry, and the tab `<Page> · <Workspace>`;
 *   - exactly one rail item marked: the page itself (Dispatch, KPIs, Prompts) or its parent (Escalation and Effort light
 *     KPIs, Custom prompts lights Prompts, Operator audit lights Settings), with one "← <parent>" way back;
 *   - for a new user with no runner the Tools group is not drawn, and a Tools page lights Settings, the place it is
 *     reached from (`reachedFrom`), never a place the rail does not show;
 *   - no old bar, no old footer, and the frame's footer once.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4565-tools-frame.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderDispatchPage } from '../../lib/render-dispatch.js';
import { renderWorkspaceKpisPage } from '../../lib/render-workspace-kpis.js';
import { renderEscalationKpisPage } from '../../lib/render-escalation-kpis.js';
import { renderEffortReadoutPage } from '../../lib/render-effort-readout.js';
import { renderPromptsPage } from '../../lib/render-prompts.js';
import { renderCustomPromptsPage } from '../../lib/render-custom-prompts.js';
import { renderAuditPage } from '../../lib/render-audit.js';
import { computeEffortReadout } from '../../lib/effort-readout.js';
import { NO_REQUEST_RECORDS } from '../fixtures/request-usage-loader.js';
import { placeFor, litPlaceFor } from '../../lib/places.js';

const ASOF = '2026-11-25T00:00:00.000Z';
const WORKSPACES = [{ urlKey: 'acme', name: 'Acme' }];

const KPI_STATS = { generatedAt: ASOF, empty: true, stored: { customPrompts: 0, roadmapReports: 0, roadmapReportsCap: 20 } };
const ESCALATION = {
  escalationRate: { raisedInWindow: 0, perDay: 0, targetPerDay: null, overTarget: false },
  timeToResponse: { count: 0, medianMs: null, maxMs: null },
  falseEscalation: { dismissed: 0, answered: 0, total: 0, rate: null },
  unansweredAge: { count: 0, staleCount: 0, maxAgeMs: null, staleThresholdMs: 86400000 },
};
const readout = await computeEffortReadout({ urlKey: 'acme', requestSource: NO_REQUEST_RECORDS, liveRows: [], historyRows: [], issueContext: new Map(), asOf: ASOF, skipped: 0 });

/** Each Tools page, by its key in lib/places.js, and how to render it for a viewer's flags. */
const PAGES = [
  { key: 'dispatch', render: o => renderDispatchPage('Acme', o) },
  { key: 'kpis', render: o => renderWorkspaceKpisPage('Acme', { ...o, stats: KPI_STATS }) },
  { key: 'escalation', render: o => renderEscalationKpisPage('Acme', { ...o, kpis: ESCALATION, windowDays: 30, generatedAt: ASOF }) },
  { key: 'effort', render: o => renderEffortReadoutPage('Acme', { ...o, readout, generatedAt: ASOF }) },
  { key: 'prompts', render: o => renderPromptsPage('Acme', o) },
  { key: 'custom-prompts', render: o => renderCustomPromptsPage('Acme', { ...o, customPrompts: [] }) },
  { key: 'audit', render: o => renderAuditPage('Acme', o) },
];

const VIEWERS = [
  { name: 'owner with a runner', flags: { runControls: true } },
  { name: 'new user without a runner', flags: { runControls: false, runSetup: true } },
];

/** The marked rail items' places, in order. */
const marked = html => [...html.matchAll(/class="frame-rail__item[^"]*"[^>]*data-place="([^"]+)" aria-current="(page|true)"/g)].map(m => ({ place: m[1], current: m[2] }));

for (const viewer of VIEWERS) {
  describe(`the Tools pages in the frame, ${viewer.name}`, () => {
    for (const { key, render } of PAGES) {
      test(`${key}: one h1 and the tab name the page; one item is marked; one way back when drilled in`, () => {
        const html = render({ urlKey: 'acme', workspaces: WORKSPACES, featureFlags: viewer.flags });
        const name = placeFor(key).label;
        assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'one h1');
        assert.match(html, new RegExp(`<h1>${name}</h1>`));
        assert.match(html, new RegExp(`<title>${name} · Acme</title>`));
        assert.match(html, new RegExp(`<body class="frame-body" data-place="${key}"`));

        const lit = litPlaceFor(key, { flags: viewer.flags });
        assert.deepEqual(marked(html), [{ place: lit.key, current: lit.key === key ? 'page' : 'true' }], 'exactly one marked item');
        const backs = [...html.matchAll(/data-testid="frame-back">← ([^<]+)</g)].map(m => m[1]);
        assert.deepEqual(backs, lit.key === key ? [] : [lit.label], 'the way back goes to the lit place');

        assert.doesNotMatch(html, /class="nav-bar|data-testid="nav-view-|class="page-footer/, 'no old bar or old footer');
        assert.equal((html.match(/data-testid="frame-footer"/g) || []).length, 1, 'the frame footer, once');
        if (viewer.flags.runControls) assert.match(html, /data-group="tools"/, 'the owner sees the Tools group');
        else assert.doesNotMatch(html, /data-group="tools"/, 'a new user without a runner sees no Tools group');
      });
    }
  });
}

test('for the owner, the drilled-in pages light their parent: Escalation and Effort → KPIs, Custom prompts → Prompts, Operator audit → Settings', () => {
  const flags = { runControls: true };
  const parents = { escalation: 'kpis', effort: 'kpis', 'custom-prompts': 'prompts', audit: 'settings' };
  for (const [key, parent] of Object.entries(parents)) {
    const html = PAGES.find(p => p.key === key).render({ urlKey: 'acme', workspaces: WORKSPACES, featureFlags: flags });
    assert.deepEqual(marked(html), [{ place: parent, current: 'true' }], key);
    assert.match(html, new RegExp(`<a class="frame-back" href="/workspace/acme${placeFor(parent).path}" data-testid="frame-back">← ${placeFor(parent).label}</a>`), key);
  }
});

test('the queue count is the frame\'s, on the Dispatch rail item, and no page here draws a second one', () => {
  for (const { key, render } of PAGES) {
    const html = render({ urlKey: 'acme', workspaces: WORKSPACES, featureFlags: { runControls: true } });
    assert.equal((html.match(/data-queue-badge/g) || []).length, 1, `${key}: one queue count`);
    assert.match(html, /data-testid="rail-place-dispatch"[^>]*>.*?data-testid="rail-queued"/s, `${key}: it is on the Dispatch item`);
  }
});

test('the footer and rail status take the route\'s deploy stamp and AI source (KPIs, Escalation and Effort had none)', () => {
  const deployInfo = { version: 'v9.9.9', commit: 'abcdef1234567' };
  for (const key of ['kpis', 'escalation', 'effort']) {
    const html = PAGES.find(p => p.key === key).render({ urlKey: 'acme', workspaces: WORKSPACES, featureFlags: { runControls: true }, deployInfo, openRouterSource: 'env' });
    assert.match(html, /data-testid="frame-footer-stamp"/, `${key}: the deploy stamp`);
    assert.match(html, /data-testid="footer-ai-status"[^>]*title="OpenRouter: [^"]*"/, `${key}: the AI status`);
    assert.doesNotMatch(html, /title="OpenRouter: off"/, `${key}: the source reached the rail`);
  }
});
