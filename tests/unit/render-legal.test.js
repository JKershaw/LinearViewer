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
import { HEARTBEAT_TTL_MS } from '../../lib/consumer-heartbeat-store.js';
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

  test('discloses the consumer heartbeat and its retention (LIN-3637)', () => {
    assert.match(text, /dispatch consumer, it reports its kind, a random per-process id, its platform, uptime, CPU count, load averages, free and total memory, and its active and held session counts about once a minute/);
    assert.match(text, /reports no hostname, username, file path or run content/);
    assert.match(text, new RegExp(`heartbeat is replaced by the next one and expires ${HEARTBEAT_TTL_MS / 60000} minutes after the last`));
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
    // LIN-3409: the runner sentence names what is now owner-only, and still the residual.
    assert.match(text, /halting and resuming, deleting or trimming queued work, and creating or revoking runner credentials/);
    assert.match(text, /runner tokens issued before these checks keep working until they expire or are revoked/);
    assert.match(text, /not swept every path|have not swept every path/);
    assert.doesNotMatch(text, /some controls such as halt and resume, are not covered/);
    // LIN-3414: the page used to say both "revokes" and "does not revoke"; it now
    // says what lib/workspace-removal-revocation.js does, once, and the deletion
    // section points there instead of contradicting it.
    assert.doesNotMatch(text, /does not revoke/);
    // LIN-3421: removing a workspace revokes what the account made for it.
    // Review F3: revokeByCreator deletes grant-bearing rows only where createdBy is
    // the removing account, so the owner's removal revokes the runner credentials
    // *that account made*, not every runner token for the workspace.
    assert.match(text, /Removing a workspace revokes the API tokens, dispatch tokens and task links that you made for it, and revokes the runner credentials you made for it only if you own the workspace/);
    // Review F2: tokens expire (90-day API default, 48h runner, dispatch ttl).
    assert.match(text, /give access to whoever holds them until they expire or you revoke them/);
    assert.doesNotMatch(text, /until you revoke them\. Task links/);
    assert.match(text, /Signing out, a removal you did not make, and unlinking one provider from a workspace revoke none of these/);
    assert.match(text, /Removing a workspace deletes its stored sign-in tokens, not its history\. What else it revokes is set out under &ldquo;Who can see it&rdquo;\./);
  });

  // LIN-3424: the hourly cleanup loop (lib/hourly-cleanup.js) now removes
  // expired session rows, so the page must say that and not the old "can stay
  // in the database until it is next read".
  test('says the hourly cleanup deletes an expired session record', () => {
    assert.match(text, /A session stops working after 30 days, but the expired session record, with its tokens, is deleted by an hourly cleanup\./);
    assert.doesNotMatch(text, /expired session record[^.]*can stay in the database/);
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

describe('terms page', () => {
  test('keeps its headings', () => {
    const terms = renderTermsOfService();
    for (const h of ['Service Description', 'No Warranty', 'Your Responsibilities', 'Limitation of Liability', 'Changes to Terms', 'Contact']) {
      assert.ok(terms.includes(`>${h}<`), h);
    }
  });

  // LIN-3414: the Terms no longer name one backend or tell every user their
  // "Linear account" is the thing they are responsible for.
  test('names the supported backends and email sign-in, not just Linear', () => {
    const terms = renderTermsOfService().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.doesNotMatch(terms, /such as Linear/);
    assert.doesNotMatch(terms, /your Linear account/);
    for (const n of ['Linear', 'GitHub', 'GitHub Projects', 'Jira', 'local', 'email sign-in link']) {
      assert.ok(terms.includes(n), `${n} missing from Terms`);
    }
    // Review F1: GitHub Projects and local workspaces have no sign-in entry point
    // (no entryCta in their providers; lib/components/landing-hero.js offers only
    // Linear, GitHub, Jira and email, the last three config-gated).
    assert.doesNotMatch(terms, /sign in with one of those/);
    assert.match(terms, /you can sign in with Linear, GitHub or Jira, or with an email sign-in link, where this server offers them/);
  });

  test('says the user is responsible for the tokens and share links they create', () => {
    const terms = renderTermsOfService().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.match(terms, /responsible for the API tokens, runner tokens and task share links you create/);
    // Review F2: access lasts until the token expires or is revoked.
    assert.match(terms, /whoever holds one has access until it expires or is revoked/);
    assert.doesNotMatch(terms, /has access until it is revoked/);
  });

  test('links to the Privacy Policy and keeps the GitHub issues contact', () => {
    const terms = renderTermsOfService();
    assert.match(terms, /<a href="\/privacy">Privacy Policy<\/a>/);
    assert.match(terms, /href="https:\/\/github\.com\/JKershaw\/LinearViewer\/issues"/);
  });
});
