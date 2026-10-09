/**
 * LIN-3390: pins the privacy page to the data it is built from, so the facts that
 * can drift mechanically (cookie lifetimes, processors, token handling) cannot.
 *
 * Run with: node --test tests/unit/render-legal.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  renderPrivacyPolicy,
  renderTermsOfService,
  PRIVACY_COOKIES,
  PRIVACY_PROCESSORS,
  PRIVACY_CONTACT_EMAIL
} from '../../lib/render-legal.js';
import { SESSION_TTL_SECONDS } from '../../lib/session-options.js';
import { THEME_COOKIE_MAX_AGE_MS } from '../../lib/user-preferences.js';

const html = renderPrivacyPolicy();
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('privacy page', () => {
  test('names every processor', () => {
    const names = PRIVACY_PROCESSORS.map((p) => p.name).join(' | ');
    for (const n of ['Linear', 'GitHub', 'Jira', 'Railway', 'OpenRouter', 'Resend', 'Yap', 'Claude Code']) {
      assert.ok(names.includes(n) || PRIVACY_PROCESSORS.some((p) => p.role.includes(n)), `processor ${n} missing from list`);
      assert.ok(text.includes(n), `${n} missing from rendered page`);
    }
  });

  test('lists exactly the two cookies, with lifetimes derived from the constants', () => {
    assert.deepStrictEqual(PRIVACY_COOKIES.map((c) => c.name), ['connect.sid', 'theme']);
    assert.strictEqual(PRIVACY_COOKIES[0].lifetimeSeconds, SESSION_TTL_SECONDS);
    assert.strictEqual(PRIVACY_COOKIES[1].lifetimeSeconds * 1000, THEME_COOKIE_MAX_AGE_MS);
    assert.match(text, /connect\.sid : keeps you signed in\. Lasts 30 days/);
    assert.match(text, /theme : remembers light or dark mode\. Lasts 1 year/);
  });

  test('labels unencrypted tokens and says own tokens are hashed', () => {
    const unencrypted = html.match(/<strong>(?:Stored )?unencrypted<\/strong>/gi) || [];
    assert.strictEqual(unencrypted.length, 3, 'Linear/Jira OAuth, Jira API token, OpenRouter key');
    assert.match(text, /own tokens .* one-way hash/);
  });

  test('makes no absolute claims the code does not support', () => {
    assert.doesNotMatch(text, /nobody else/i);
    assert.doesNotMatch(text, /only the (workspace's|workspace&rsquo;s|owner)[^.]* can (drive|start)/i);
    assert.doesNotMatch(text, /deleted after 30 days/i);
    assert.match(text, /not yet airtight/);
    assert.match(text, /does not revoke/);
  });

  test('does not use the public issues tracker as the deletion contact', () => {
    assert.doesNotMatch(html, /github\.com\/JKershaw\/LinearViewer\/issues/);
  });

  test('shows a visible placeholder while no contact is set', () => {
    if (!PRIVACY_CONTACT_EMAIL) assert.match(text, /\[private contact address to be confirmed\]/);
  });

  // MERGE BLOCKER (LIN-3390 K5): red until John supplies the private address.
  test('a private deletion-contact address is set', () => {
    assert.match(PRIVACY_CONTACT_EMAIL, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    assert.ok(text.includes(PRIVACY_CONTACT_EMAIL));
  });

  test('keeps header, wrapper and footer behaviour', () => {
    assert.match(html, /<h2>Privacy Policy<\/h2>/);
    assert.match(html, /class="legal-content"/);
    assert.match(html, /footer-current[^>]*>\s*privacy/);
  });
});

describe('terms page is unchanged', () => {
  test('keeps its headings', () => {
    const terms = renderTermsOfService();
    for (const h of ['Service Description', 'No Warranty', 'Your Responsibilities', 'Limitation of Liability', 'Changes to Terms', 'Contact']) {
      assert.ok(terms.includes(`>${h}<`), h);
    }
  });
});
