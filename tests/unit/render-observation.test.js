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

  test('the shared tab strip holds Runs and Rulings only', () => {
    const out = html();
    const tabCount = (out.match(/class="tabs__tab( is-active)?"/g) || []).length;
    assert.strictEqual(tabCount, 2, 'Runs and Rulings');
    assert.match(out, /data-tab="runs"[^>]*aria-selected="true"/, 'the runs tab is selected on a bare load');
    assert.match(out, /data-tab="rulings"/);
  });
});

describe('render-observation: bulk select-all checkbox accessible name (LIN-2444 review, Minor — ≤400px a11y nit)', () => {
  // At max-width:400px, public/observation.css hides `.obs-ruling-bulk-select-all-text`
  // via `display:none`, which drops it from the accessible-name computation —
  // the wrapping <label>'s only text was that span, so the checkbox lost its
  // only name at that viewport. An explicit aria-label on the input itself
  // always wins over the implicit wrapping-label association, so the name
  // survives regardless of the span's visibility.
  test('the select-all checkbox carries its own aria-label, independent of the visible label text', () => {
    const html = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a' }
    );
    assert.match(
      html,
      /<input type="checkbox" id="obs-ruling-select-all" aria-label="select all proposed" data-testid="obs-ruling-select-all">/,
      'the select-all checkbox must carry an aria-label so it has a name even when the sibling text span is display:none at ≤400px'
    );
  });
});

// LIN-2757: half the bulk bar's markup carried no pinned assertion at all —
// only the aria-label above. These pin the visible select-all span text and
// the SSR button label, and require the button label to match the client
// runtime's template exactly (public/observation.js's syncRulingsBulkBar),
// since the two had zero shared witness before this.
describe('render-observation: bulk bar markup — visible select-all text + SSR button label (LIN-2757)', () => {
  test('the visible select-all span reads the same kind-neutral text as its aria-label', () => {
    const html = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a' }
    );
    assert.match(
      html,
      /<span class="obs-ruling-bulk-select-all-text">select all proposed<\/span>/,
      'the visible span must carry the same text as the aria-label'
    );
  });

  test('the SSR "0 selected" button label matches the client-rendered template exactly', () => {
    const html = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a' }
    );
    assert.match(
      html,
      /id="obs-ruling-agree-selected" disabled>Apply 0 as proposed<\/button>/,
      'SSR markup and public/observation.js\'s syncRulingsBulkBar must never drift apart on this label'
    );
  });
});

// Review finding B (PR #1453, commit 91286e16): this markup had zero pinned
// render coverage — an M9 mutation stripping aria-live="polite" from the
// progress node left every unit test (and both new e2e tests) green. These
// two assertions pin the accessibility half of LIN-2758's bulk-agree feature
// directly against the rendered markup, so a future regression here fails a
// unit test rather than only a live screen reader.
describe('render-observation: bulk-agree progress node + Stop button markup (LIN-2758)', () => {
  test('the progress node carries aria-live="polite" — a screen reader must hear per-row progress and the completion summary', () => {
    const html = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a' }
    );
    assert.match(
      html,
      /<p class="obs-ruling-bulk-progress" id="obs-ruling-bulk-progress" data-testid="obs-ruling-bulk-progress" aria-live="polite"><\/p>/,
      'stripping aria-live="polite" here would silence the batch progress/summary announcement entirely, with no visible symptom'
    );
  });

  test('the Stop button is hidden until a batch is running', () => {
    const html = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a' }
    );
    assert.match(
      html,
      /<button type="button" class="obs-ruling-bulk-stop" id="obs-ruling-bulk-stop" data-testid="obs-ruling-bulk-stop" hidden>Stop<\/button>/,
      'Stop must render hidden on first paint — syncRulingsBulkBar toggles it visible only while rulingsBulkRunning'
    );
  });
});
