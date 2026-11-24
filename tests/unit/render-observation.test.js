import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderObservationPage } from '../../lib/render-observation.js';

describe('render-observation: poll-status banner', () => {
  test('initial banner placeholder is "loading…", not "connecting…" (LIN-617)', () => {
    const html = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a' }
    );
    // There is no socket to "connect" — the feed is polled — so the honest
    // initial state is that the first /sessions poll is in flight.
    assert.match(html, /id="obs-poll-status"[^>]*>loading…</);
    assert.ok(!html.includes('connecting…'), 'the misleading "connecting…" placeholder is gone');
  });
});

describe('render-observation: Active-section eyebrow count (LIN-929)', () => {
  test('eyebrow reads "Active · N running" with a client-updatable count hook, not a static "Active"', () => {
    const html = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a' }
    );
    // Design §3.4/§8: the Active eyebrow carries the live running count. The
    // number lives in a dedicated hook the client keeps in sync per poll, and
    // the server seeds it at 0 (no feed data is rendered server-side).
    assert.match(
      html,
      /Active<span class="obs-active-count" id="obs-active-count"[^>]*> · <span class="obs-active-count-n">0<\/span> running<\/span>/,
      'Active eyebrow renders the "· N running" count hook seeded at 0'
    );
    // Guard against the old static title regressing back.
    assert.ok(
      !/obs-eyebrow"[^>]*>Active<\/h2>/.test(html),
      'the eyebrow is no longer the static "Active"'
    );
  });
});

describe('render-observation: rulings-tab copy', () => {
  const html = () => renderObservationPage(
    { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
    { urlKey: 'ws-a' }
  );

  // LIN-4540: the disclaimer that some questions are raised by a model reading a task was the scan's own (LIN-2241). The scan
  // is gone, so every question on the tab was asked by a run, and the sentence would be untrue.
  test('the rulings section no longer carries the scan\'s limits disclaimer (LIN-4540)', () => {
    const out = html();
    assert.doesNotMatch(out, /id="obs-rulings-limits"/);
    assert.doesNotMatch(out, /raised automatically by a model reading a task/);
  });

  test('no Rulings copy names the internal Principle 0 gate (LIN-3983 PR 2)', () => {
    const out = html();
    const rulingsAt = out.indexOf('id="obs-rulings-section"');
    const rulings = out.slice(rulingsAt, out.indexOf('</main>'));
    assert.ok(rulingsAt > -1);
    assert.doesNotMatch(rulings, /Principle(&nbsp;| )0/);
    assert.doesNotMatch(rulings, /BASIS_VERSION|fingerprint/i);
  });
});

describe('render-observation: the view strip (LIN-3983, LIN-4540)', () => {
  const html = () => renderObservationPage(
    { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
    { urlKey: 'ws-a' }
  );

  test('the shared tab strip holds Runs and Questions only (LIN-4553: the second tab is named for questions)', () => {
    const out = html();
    const tabCount = (out.match(/class="tabs__tab( is-active)?"/g) || []).length;
    assert.strictEqual(tabCount, 2, 'Runs and Questions');
    assert.match(out, /data-tab="runs"[^>]*aria-selected="true"/, 'the runs tab is selected on a bare load');
    assert.match(out, /data-tab="questions"[^>]*>[\s\S]*?Questions/);
    assert.doesNotMatch(out, />\s*Rulings\s*</, 'no label reads "Rulings"');
  });

  test('the waiting line is one line of two links and holds no card list (LIN-4553)', () => {
    const out = html();
    const line = out.match(/<p class="obs-waiting"[\s\S]*?<\/p>/);
    assert.ok(line, 'the waiting line renders as one paragraph');
    assert.match(line[0], /data-testid="obs-waiting-questions" href="\?view=questions"/);
    assert.match(line[0], /data-testid="obs-waiting-runs"/);
    assert.doesNotMatch(out, /obs-waiting-rulings|obs-waiting-more|obs-waiting-count/, 'the old block\'s card list, count and "more" link are gone');
  });
});

describe('render-observation: the bulk-agree bar is gone with proposed answers (LIN-4541)', () => {
  test('no bulk bar, select-all, progress line or Stop renders, and the page loads no chat.js', () => {
    const out = renderObservationPage({ workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] }, { urlKey: 'ws-a' });
    assert.doesNotMatch(out, /obs-ruling-bulk|obs-ruling-select-all|obs-ruling-agree-selected/);
    assert.doesNotMatch(out, /\/chat\.js/);
    assert.match(out, /id="obs-rulings"/, 'the rulings list stays');
  });
});
