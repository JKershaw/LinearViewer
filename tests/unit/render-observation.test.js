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

describe('render-observation: third due-tab disclaimer — bulk-scan (LIN-2706 §B.9)', () => {
  const html = (openRouterSource) => renderObservationPage(
    { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
    { urlKey: 'ws-a', openRouterSource }
  );

  test('the unconditional (dollar-estimate) branch always renders, regardless of tier', () => {
    for (const source of [null, 'oauth', 'env', 'free']) {
      const out = html(source);
      assert.match(out, /id="obs-due-bulk-disclaimer"/, `unconditional disclaimer missing for openRouterSource=${source}`);
      assert.match(out, /Abort stops the queue and releases the browser; scans already sent will finish, bill, and may still raise a ruling/, `verbatim abort text missing for openRouterSource=${source}`);
      assert.match(out, /30-day historical mean/, `dollar-estimate framing missing for openRouterSource=${source}`);
    }
  });

  test('the conditional (quota) branch renders ONLY when isFreeTier (openRouterSource === "free")', () => {
    assert.doesNotMatch(html(null), /id="obs-due-bulk-quota-note"/, 'no session/env/free source: no quota note');
    assert.doesNotMatch(html('oauth'), /id="obs-due-bulk-quota-note"/, 'a paid OAuth key: no quota note');
    assert.doesNotMatch(html('env'), /id="obs-due-bulk-quota-note"/, 'a paid env key: no quota note');
    assert.match(html('free'), /id="obs-due-bulk-quota-note"/, 'free tier: the quota note must render');
    assert.match(html('free'), /daily\/hourly free quota/, 'the quota note must name the quota, not just repeat the dollar disclaimer');
  });

  test('the two budget gates are disclosed as separate sentences, never merged into one', () => {
    const out = html('free');
    const dollarAt = out.indexOf('id="obs-due-bulk-disclaimer"');
    const dollarCloseAt = out.indexOf('</p>', dollarAt);
    const quotaAt = out.indexOf('id="obs-due-bulk-quota-note"');
    assert.ok(dollarAt > -1 && quotaAt > -1, 'both notes are present');
    assert.ok(quotaAt > dollarCloseAt, 'the quota note is its OWN <p>, not appended inside the dollar-estimate paragraph');
  });

  test('mounted inside the due section, alongside the existing #obs-due-limits/#obs-due-cost-note block', () => {
    const out = html('free');
    const sectionAt = out.indexOf('id="obs-due-section"');
    const costNoteAt = out.indexOf('id="obs-due-cost-note"');
    const disclaimerAt = out.indexOf('id="obs-due-bulk-disclaimer"');
    const dueListAt = out.indexOf('id="obs-due-list"');
    assert.ok(sectionAt < costNoteAt, 'inside the due section');
    assert.ok(costNoteAt < disclaimerAt && disclaimerAt < dueListAt, 'alongside the existing limits/cost-note block, above the feed it qualifies');
  });

  test('the disclaimer points at the estimate correctly: "below", never "above" (review finding 2, PR #1424)', () => {
    // This partial mounts BEFORE #obs-due-bulk-bar (the element that actually
    // carries the estimate), so a live render puts the bar visually below
    // this text -- "above" was measured backwards. A mutation flipping the
    // wording back to "above" must turn this red.
    const out = html('free');
    assert.doesNotMatch(out, /estimate above/i, 'must not claim the estimate is above this text');
    assert.match(out, /estimate below/i, 'must claim the estimate is below this text, matching the real mount order');
  });

  test('bounded copy: the disclaimer paragraph does not balloon (review finding 5, §B.5)', () => {
    // §B.5's own rule ("copy length is bounded ... its witness must measure
    // rendered output, not font metrics") was never landed for this partial;
    // the review measured it as the longest paragraph on the tab (361 chars
    // vs #obs-due-limits' 217). Pin a generous but real ceiling on the
    // RENDERED text, both branches.
    for (const source of [null, 'free']) {
      const out = html(source);
      const disclaimerAt = out.indexOf('id="obs-due-bulk-disclaimer"');
      const disclaimerClose = out.indexOf('</p>', disclaimerAt);
      const disclaimerText = out.slice(disclaimerAt, disclaimerClose);
      assert.ok(disclaimerText.length < 500, `dollar-estimate disclaimer too long: ${disclaimerText.length} chars`);
      if (source === 'free') {
        const quotaAt = out.indexOf('id="obs-due-bulk-quota-note"');
        const quotaClose = out.indexOf('</p>', quotaAt);
        const quotaText = out.slice(quotaAt, quotaClose);
        assert.ok(quotaText.length < 400, `quota note too long: ${quotaText.length} chars`);
      }
    }
  });
});

describe('render-observation: the three disclaimers stay textually distinct (LIN-2706 §B.9 no-shared-partial)', () => {
  // A regression guard against a future "helpful" consolidation into one
  // shared partial — the parent ticket's explicit constraint is that these
  // three stay separate, own-wording partials. If someone later merges them,
  // this test (comparing the rendered text of all three) must fail.
  function extractParagraph(html, id) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > -1, `#${id} must be present`);
    const openAt = html.lastIndexOf('<p', at);
    const closeAt = html.indexOf('</p>', at);
    return html.slice(openAt, closeAt + 4);
  }

  test('the rulings, due-tab, and bulk-scan disclaimers are three DIFFERENT strings', () => {
    const out = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a', openRouterSource: 'free' }
    );
    const rulings = extractParagraph(out, 'obs-rulings-limits');
    const dueTab = extractParagraph(out, 'obs-due-limits');
    const bulkScan = extractParagraph(out, 'obs-due-bulk-disclaimer');

    assert.notEqual(rulings, dueTab, 'rulings and due-tab disclaimers must differ');
    assert.notEqual(rulings, bulkScan, 'rulings and bulk-scan disclaimers must differ');
    assert.notEqual(dueTab, bulkScan, 'due-tab and bulk-scan disclaimers must differ');
  });

  test('none of the three disclaimers is a substring of another (guards a partial/prefix-shared merge too)', () => {
    const out = renderObservationPage(
      { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] },
      { urlKey: 'ws-a', openRouterSource: 'free' }
    );
    const rulings = extractParagraph(out, 'obs-rulings-limits');
    const dueTab = extractParagraph(out, 'obs-due-limits');
    const bulkScan = extractParagraph(out, 'obs-due-bulk-disclaimer');
    const texts = [rulings, dueTab, bulkScan];
    for (let i = 0; i < texts.length; i++) {
      for (let j = 0; j < texts.length; j++) {
        if (i === j) continue;
        assert.ok(!texts[i].includes(texts[j]), `disclaimer ${i} must not fully contain disclaimer ${j}`);
      }
    }
  });
});
