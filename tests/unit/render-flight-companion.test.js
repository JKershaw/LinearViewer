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
