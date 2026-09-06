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

describe('render-observation: scan-due tab (LIN-2649 S4 / LIN-2667)', () => {
  const html = () => renderObservationPage(
    { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
    { urlKey: 'ws-a' }
  );

  test('a fourth tab, Scan-due, renders alongside Autopilot/Sessions/Rulings', () => {
    const out = html();
    assert.match(out, /data-view="due"[^>]*>Scan-due</);
    const tabCount = (out.match(/class="obs-tab( is-active)?"/g) || []).length;
    assert.strictEqual(tabCount, 4);
  });

  test('the due section states its own backstop-not-guarantee disclaimer, distinct from the rulings one', () => {
    const out = html();
    const sectionAt = out.indexOf('id="obs-due-section"');
    const limitsAt = out.indexOf('id="obs-due-limits"');
    assert.ok(sectionAt > -1 && limitsAt > sectionAt, 'the disclaimer is inside the due section');
    assert.match(out, /provider-content fingerprint comparison/);
    assert.match(out, /not an LLM judgement/);
    assert.match(out, /backstop, not a guarantee/);
  });

  test('the due section never shares markup with #obs-session-views', () => {
    const out = html();
    const sessionViewsAt = out.indexOf('id="obs-session-views"');
    const sessionViewsCloseAt = out.indexOf('</div>', sessionViewsAt);
    const dueSectionAt = out.indexOf('id="obs-due-section"');
    assert.ok(dueSectionAt > sessionViewsCloseAt, 'the due section sits outside #obs-session-views entirely');
  });

  test('states the provider-read-vs-LLM-scan cost distinction', () => {
    assert.match(html(), /reads live task content but never calls a model/i);
  });

  test('carries the pagination/readout hooks: feed list, empty state, load-more, progress readout', () => {
    const out = html();
    assert.match(out, /id="obs-due-list"/);
    assert.match(out, /id="obs-due-empty"/);
    assert.match(out, /id="obs-due-more"[^>]*hidden/);
    assert.match(out, /id="obs-due-progress"/);
  });
});

describe('render-observation: bulk-scan script wiring (LIN-2700 / LIN-2651 Phase 2)', () => {
  const html = () => renderObservationPage(
    { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
    { urlKey: 'ws-a' }
  );

  // This guards LIN-2700's single documented deviation from its "public/
  // observation.js and nothing else" scope: the bulk-scan pool calls
  // window.ScanSection.postScan, which public/scan.js defines and which was
  // NOT loaded on this page before LIN-2700 added it to the script list.
  //
  // Nothing else covers that one line. The bulk-scan witnesses
  // (tests/unit/observation-bulk-scan.test.js) stub window.ScanSection inside
  // their vm sandbox, so they can never observe the real page wiring, and no
  // E2E navigates to /observation and touches ScanSection. Removing /scan.js
  // from the list left 82/82 of the related unit tests green (review mutation
  // M8) while the pool would TypeError at runtime in a browser — and that
  // error would be swallowed into classifyBulkScanError's 'other' bucket, so
  // it would not even be loud. Hence this assertion.
  test('the Observation page loads /scan.js, so window.ScanSection exists for the bulk-scan pool', () => {
    assert.match(
      html(),
      /<script src="\/scan\.js"><\/script>/,
      'the bulk-scan pool calls window.ScanSection.postScan, which only exists if /scan.js is in the page script list'
    );
  });

  test('/scan.js loads after /common.js and before /observation.js', () => {
    // Order is load-bearing in both directions, per the justification comment
    // in lib/render-observation.js: scan.js reads window.escapeHtml and
    // window.relativeTime at top level (common.js defines them), and
    // observation.js is the consumer of window.ScanSection.
    const out = html();
    const commonAt = out.indexOf('<script src="/common.js"></script>');
    const scanAt = out.indexOf('<script src="/scan.js"></script>');
    const observationAt = out.indexOf('<script src="/observation.js"></script>');
    assert.ok(commonAt > -1 && scanAt > -1 && observationAt > -1, 'all three scripts are present');
    assert.ok(scanAt > commonAt, '/scan.js must load after /common.js (it reads escapeHtml/relativeTime at top level)');
    assert.ok(scanAt < observationAt, '/scan.js must load before /observation.js (its consumer)');
  });
});

describe('render-observation: scan cost estimate wiring (LIN-2706 §B.1)', () => {
  // window.__OBSERVATION_DATA__ is embedded via embedJson (lib/components/page.js),
  // plain JSON.stringify plus a few XSS-hardening char escapes that don't touch
  // any of these fixtures, so a straight JSON.parse round-trips it.
  function embeddedData(html) {
    const match = html.match(/window\.__OBSERVATION_DATA__ = ([\s\S]*?);<\/script>/);
    assert.ok(match, 'window.__OBSERVATION_DATA__ is embedded in the page');
    return JSON.parse(match[1]);
  }

  test('an unknown estimate reaches the embedded JSON with unknown:true, never collapsed to $0.00 or a number', () => {
    const html = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a', scanCostEstimate: { calls: 0, pricedCalls: 0, meanUsd: null, unknown: true } }
    );
    assert.deepEqual(
      embeddedData(html).scanCostEstimate,
      { calls: 0, pricedCalls: 0, meanUsd: null, unknown: true }
    );
  });

  test('a priced estimate reaches the embedded JSON verbatim, unknown:false', () => {
    const html = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a', scanCostEstimate: { calls: 5, pricedCalls: 5, meanUsd: 0.0123, unknown: false } }
    );
    assert.deepEqual(
      embeddedData(html).scanCostEstimate,
      { calls: 5, pricedCalls: 5, meanUsd: 0.0123, unknown: false }
    );
  });

  test('a priced estimate averaging exactly zero stays unknown:false, distinct from the unknown state', () => {
    const html = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a', scanCostEstimate: { calls: 3, pricedCalls: 3, meanUsd: 0, unknown: false } }
    );
    assert.deepEqual(
      embeddedData(html).scanCostEstimate,
      { calls: 3, pricedCalls: 3, meanUsd: 0, unknown: false }
    );
  });

  test('an absent estimate embeds as null (the route\'s own store-absent/rejected degrade path), not a fabricated number', () => {
    const html = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a' }
    );
    assert.equal(embeddedData(html).scanCostEstimate, null);
  });
});
