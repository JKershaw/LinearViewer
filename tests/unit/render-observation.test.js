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

describe('render-observation: rulings-tab limits disclaimer (LIN-2241 criterion 5)', () => {
  const html = () => renderObservationPage(
    { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
    { urlKey: 'ws-a' }
  );

  test('the rulings section states that scan-raised rulings are a backstop, not a guarantee', () => {
    // LIN-2241's "Honest framing": this is an LLM judgement behind a Principle
    // 0 gate. It will miss things and occasionally raise noise, and the ticket
    // requires that be said ON the surface rather than only in the ticket —
    // "it must not be presented, or relied on, as a guarantee that nothing is
    // missed."
    const out = html();
    assert.match(out, /id="obs-rulings-limits"/);
    assert.match(out, /backstop, not a guarantee/);
    assert.match(out, /miss things/);
    assert.match(out, /raise noise/);
  });

  test('the disclaimer sits inside the rulings section, above the feed it qualifies', () => {
    // A limits statement rendered somewhere else on the page would not be the
    // surface stating its own limits.
    const out = html();
    const sectionAt = out.indexOf('id="obs-rulings-section"');
    const limitsAt = out.indexOf('id="obs-rulings-limits"');
    const feedAt = out.indexOf('id="obs-rulings"');
    assert.ok(sectionAt > -1 && limitsAt > sectionAt, 'the disclaimer is inside the rulings section');
    assert.ok(feedAt > limitsAt, 'it is read before the feed, not buried under it');
  });

  test('it names the Principle 0 gate the scan actually runs behind', () => {
    assert.match(html(), /Principle&nbsp;0 gate/);
  });
});
