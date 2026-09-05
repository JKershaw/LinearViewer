/**
 * Unit tests for lib/render-flight-companion.js (LIN-1764).
 *
 * Covers the +proxy toggle affordance: the button and its enabling
 * `data-proxy-feature` body attribute must appear iff `featureFlags.proxy ===
 * true`, and the no-`featureFlags` call path used elsewhere (e.g.
 * tests/unit/page-title-primitive.test.js) must keep rendering cleanly without
 * either.
 *
 * Run with: node --test tests/unit/render-flight-companion.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderFlightCompanionPage } from '../../lib/render-flight-companion.js';

describe('renderFlightCompanionPage — +proxy toggle gating', () => {
  test('renders the +proxy toggle and data-proxy-feature attribute when featureFlags.proxy === true', () => {
    const html = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws', featureFlags: { proxy: true } });
    assert.ok(html.includes('data-proxy-feature="true"'));
    assert.match(html, /<button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">\+proxy<\/button>/);
  });

  test('omits the +proxy toggle and data-proxy-feature attribute when featureFlags.proxy is false', () => {
    const html = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws', featureFlags: { proxy: false } });
    assert.ok(!html.includes('data-proxy-feature'));
    assert.ok(!html.includes('prompt-proxy-toggle'));
  });

  test('the default no-featureFlags call path (page-title-primitive.test.js) renders cleanly with neither', () => {
    const html = renderFlightCompanionPage({}, { urlKey: 'ws' });
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(!html.includes('data-proxy-feature'));
    assert.ok(!html.includes('prompt-proxy-toggle'));
  });
});

describe('renderFlightCompanionPage — LIN-2435 Commit 2: chat-thread render + asset ordering', () => {
  const html = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws' });

  test('renders an empty, hidden chat-thread and a composer (greenfield — no prior thread markup to migrate)', () => {
    assert.match(html, /<ul class="chat-thread" id="flight-companion-thread" hidden><\/ul>/);
    assert.match(html, /id="flight-companion-question"/);
    assert.match(html, /id="flight-companion-send"/);
    assert.match(html, /class="[^"]*\bchat-composer\b[^"]*"/);
  });

  test('loads /chat.css and /chat.js — the shared chat UI this page now consumes', () => {
    assert.match(html, /<link rel="stylesheet" href="\/chat\.css">/);
    assert.match(html, /<script src="\/chat\.js"/);
  });

  test('/chat.js loads BEFORE /flight-companion.js — the proposal control calls window.ChatUI', () => {
    const chatJsIdx = html.indexOf('src="/chat.js"');
    const fcJsIdx = html.indexOf('src="/flight-companion.js"');
    assert.ok(chatJsIdx > -1 && fcJsIdx > -1, 'expected both scripts to be present');
    assert.ok(chatJsIdx < fcJsIdx, 'chat.js must load before flight-companion.js');
  });

  test('every pre-existing +proxy gating assertion still passes unchanged (re-run against the extended markup)', () => {
    const onHtml = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws', featureFlags: { proxy: true } });
    assert.ok(onHtml.includes('data-proxy-feature="true"'));
    assert.match(onHtml, /<button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">\+proxy<\/button>/);

    const offHtml = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws', featureFlags: { proxy: false } });
    assert.ok(!offHtml.includes('data-proxy-feature'));
    assert.ok(!offHtml.includes('prompt-proxy-toggle'));
  });

  test('the narrowed freeze holds: the live e2e contract selectors are untouched', () => {
    assert.match(html, /id="flight-companion-prompt"/);
    assert.match(html, /id="flight-companion-copy"/);
    assert.match(html, /id="flight-companion-copy-feedback"/);
  });
});

describe('renderFlightCompanionPage — LIN-2435 Commit 4: on-page copy sync', () => {
  test('the stale "paste it into a fresh Claude Code session" / "hand this kickoff prompt to a real Claude Code session" copy is gone from the page', () => {
    const html = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws' });
    assert.doesNotMatch(html, /paste it into a fresh Claude Code session/i);
    assert.doesNotMatch(html, /hand this kickoff prompt to a real Claude Code session/i);
  });

  test('the intro copy and subtitle now describe the live chat, not a copy/paste-only workflow', () => {
    const html = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws' });
    assert.match(html, /checks in with you/);
    assert.match(html, /Approve/);
    assert.match(html, /Dismiss/);
  });
});

describe('renderFlightCompanionPage — LIN-2443: section order, prompt collapse, check-in mount', () => {
  const html = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws' });

  test('section order is Chat -> How to use -> Kickoff prompt -> observer report', () => {
    const chatIdx = html.indexOf('>Chat<');
    const howToIdx = html.indexOf('>How to use<');
    const promptHeadingIdx = html.indexOf('>Kickoff prompt<');
    const observerIdx = html.indexOf('>Latest observer report (read-only)<');
    assert.ok(chatIdx > -1 && howToIdx > -1 && promptHeadingIdx > -1 && observerIdx > -1, 'expected all four section headings to render');
    assert.ok(chatIdx < howToIdx, 'Chat must render before How to use');
    assert.ok(howToIdx < promptHeadingIdx, 'How to use must render before Kickoff prompt');
    assert.ok(promptHeadingIdx < observerIdx, 'Kickoff prompt must render before the observer report');
  });

  test('the kickoff prompt <pre> is wrapped in a <details> disclosure rendered without `open`', () => {
    const detailsOpenIdx = html.indexOf('<details class="disclosure"');
    const detailsTagEnd = html.indexOf('>', detailsOpenIdx);
    const detailsCloseIdx = html.indexOf('</details>');
    const preIdx = html.indexOf('id="flight-companion-prompt"');
    assert.ok(detailsOpenIdx > -1 && detailsCloseIdx > -1, 'expected a <details class="disclosure"> wrapper');
    assert.ok(preIdx > detailsOpenIdx && preIdx < detailsCloseIdx, 'the prompt <pre> must render inside the <details>');
    assert.doesNotMatch(html.slice(detailsOpenIdx, detailsTagEnd + 1), /\bopen\b/, 'the disclosure must render collapsed by default (no `open` attribute)');
  });

  test('#flight-companion-copy / #flight-companion-copy-feedback / .prompt-proxy-toggle render outside the <details>', () => {
    const detailsOpenIdx = html.indexOf('<details class="disclosure"');
    const copyIdx = html.indexOf('id="flight-companion-copy"');
    const feedbackIdx = html.indexOf('id="flight-companion-copy-feedback"');
    assert.ok(copyIdx > -1 && copyIdx < detailsOpenIdx, '#flight-companion-copy must render before the <details>');
    assert.ok(feedbackIdx > -1 && feedbackIdx < detailsOpenIdx, '#flight-companion-copy-feedback must render before the <details>');

    const proxyHtml = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws', featureFlags: { proxy: true } });
    const proxyDetailsOpenIdx = proxyHtml.indexOf('<details class="disclosure"');
    const toggleIdx = proxyHtml.indexOf('prompt-proxy-toggle');
    assert.ok(toggleIdx > -1 && toggleIdx < proxyDetailsOpenIdx, '.prompt-proxy-toggle must render before the <details>');
  });

  test('renders the check-in status mount: present, empty, hidden, aria-live="polite"', () => {
    assert.match(html, /<p class="fc-checkin-status" id="flight-companion-checkin" aria-live="polite" hidden><\/p>/);
  });
});

describe('renderFlightCompanionPage — LIN-2622: start button + re-orient affordance', () => {
  const html = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws' });

  test('renders the start button, visible by default (empty state is the initial state)', () => {
    assert.match(html, /<button type="button" id="flight-companion-start" class="[^"]*\baction-btn\b[^"]*\bsave\b[^"]*">start<\/button>/);
    // No `hidden` class server-side — the empty state is the true initial
    // state, exactly like #flight-companion-chat-empty itself.
    const startIdx = html.indexOf('id="flight-companion-start"');
    const tagStart = html.lastIndexOf('<button', startIdx);
    const tagEnd = html.indexOf('>', startIdx);
    assert.doesNotMatch(html.slice(tagStart, tagEnd), /\bhidden\b/);
  });

  test('renders the re-orient button, hidden by default — the complementary half of the start/reorient pair', () => {
    assert.match(html, /<button type="button" id="flight-companion-reorient" class="[^"]*\bhidden\b[^"]*"[^>]*>reorient<\/button>/);
  });

  // LIN-2621 beat 2 replaces the LIN-2622 negative test that used to live
  // here ("no `.fc-status-strip`/`status-strip` selector exists anywhere") —
  // that pinned the honest state of the world BEFORE this ticket built the
  // real strip, and this ticket is the one that lands it, so keeping the
  // negative assertion would now be pinning a regression. Deliberately
  // replaced, not silently deleted (LIN-2621 beat 2 instruction 4).
  test('the status strip now exists, as a real element (not deleted, replaced)', () => {
    assert.match(html, /<div class="fc-status-strip" id="flight-companion-strip">/);
  });

  // LIN-2622 close-out finding F1 / LIN-2621 beat 2: `#flight-companion-
  // reorient` used to carry `action-btn` with NO colour variant class —
  // transparent, borderless, indistinguishable from body text at rest.
  // `toBeVisible()` (an e2e computed-style check) passes for that anyway, so
  // the fix must be catchable WITHOUT a browser: assert the button now
  // carries a real, existing colour-variant class (`.action-btn.connect`,
  // reused verbatim from public/common-actions.css — not forked/invented).
  test('F1 fixed: the re-orient button now carries a real colour-variant class, not bare action-btn', () => {
    const reorientIdx = html.indexOf('id="flight-companion-reorient"');
    const tagStart = html.lastIndexOf('<button', reorientIdx);
    const tagEnd = html.indexOf('>', reorientIdx);
    const tag = html.slice(tagStart, tagEnd);
    assert.match(tag, /\bclass="[^"]*\baction-btn\b[^"]*\bconnect\b[^"]*"/, 'expected the reorient button to carry .action-btn.connect');
  });

  test('the start button and the re-orient button are direct siblings of the thread/empty-state/check-in/composer — never wrapped', () => {
    // Load-bearing for flight-companion.css's phone-shape media query,
    // which sizes these elements as direct flex children of
    // .flight-companion-chat-section by selector (see that file's header
    // comment) — a wrapper div here would silently break it. The status
    // strip (LIN-2621) is a NEW sibling prepended before the thread — it
    // does not disturb this relative order, so this assertion is unchanged.
    const stripIdx = html.indexOf('id="flight-companion-strip"');
    const threadIdx = html.indexOf('id="flight-companion-thread"');
    const emptyIdx = html.indexOf('id="flight-companion-chat-empty"');
    const startIdx = html.indexOf('id="flight-companion-start"');
    const checkinIdx = html.indexOf('id="flight-companion-checkin"');
    const reorientIdx = html.indexOf('id="flight-companion-reorient"');
    const composerIdx = html.indexOf('flight-companion-question');
    assert.ok(
      stripIdx > -1 && stripIdx < threadIdx
        && threadIdx < emptyIdx && emptyIdx < startIdx && startIdx < checkinIdx && checkinIdx < reorientIdx && reorientIdx < composerIdx,
      'expected strip -> thread -> empty-state -> start -> check-in -> reorient -> composer, in that order'
    );
  });
});

describe('renderFlightCompanionPage — LIN-2621: the status strip', () => {
  test('renders every strip field from the supplied data, verbatim', () => {
    const strip = {
      model: 'openai/gpt-5.4-mini',
      toolsOn: true,
      lastCheckInAt: '2026-09-05T12:00:00.000Z',
      nextCheckInAt: null,
      sweepStatus: 'alive',
      sweepLastSeenAt: '2026-09-05T11:59:00.000Z',
      mode: 'read-only · proposes, never acts · rung 1 of 3',
    };
    const html = renderFlightCompanionPage({ prompt: 'kickoff', strip }, { urlKey: 'ws' });
    assert.match(html, /fc-strip-model">model: <code>openai\/gpt-5\.4-mini<\/code>/);
    assert.match(html, /fc-strip-tools">tools: on</);
    assert.match(html, /fc-strip-checkin">last check-in: <time datetime="2026-09-05T12:00:00\.000Z">/);
    assert.match(html, /fc-strip-mode">mode: read-only · proposes, never acts · rung 1 of 3</);
    assert.match(html, /sweep alive · last seen/);
  });

  test('an uncurated model renders tools off', () => {
    const html = renderFlightCompanionPage(
      { prompt: 'kickoff', strip: { model: 'not-curated', toolsOn: false, mode: 'read-only · proposes, never acts · rung 1 of 3' } },
      { urlKey: 'ws' }
    );
    assert.match(html, /fc-strip-tools">tools: off</);
  });

  test('no census (or no strip data at all) renders LIN-2487\'s own "no fleet scan yet" wording, never a fabricated status', () => {
    const withNoCensus = renderFlightCompanionPage(
      { prompt: 'kickoff', strip: { model: 'openai/gpt-5.4-mini', toolsOn: true, sweepStatus: 'no-census', mode: 'x' } },
      { urlKey: 'ws' }
    );
    assert.match(withNoCensus, /no fleet scan yet/);

    const withNoStripAtAll = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws' });
    assert.match(withNoStripAtAll, /no fleet scan yet/);
    assert.doesNotMatch(withNoStripAtAll, /sweep stale/);
  });

  test('the next check-in mount is present, server-rendered empty, filled in client-side (same house pattern as #flight-companion-checkin)', () => {
    const html = renderFlightCompanionPage({ prompt: 'kickoff' }, { urlKey: 'ws' });
    assert.match(html, /<span class="fc-strip-next-checkin" id="flight-companion-strip-next">next check-in: —<\/span>/);
  });
});
