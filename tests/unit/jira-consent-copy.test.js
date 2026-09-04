/**
 * LIN-2302 instance 1 — the Jira API-token consent copy must not misdescribe
 * what the credential can do.
 *
 * The shipped sentence read: "Enter your Jira Cloud site and an API token
 * (read-only Phase 1 — no write access is requested)." That was false. Of the
 * whole LIN-2302 class this is the one instance whose falsehood costs the user
 * something rather than misleading the next reader: it is CONSENT COPY, a user
 * makes a trust decision on it, and it told them a capability was not requested
 * while it was in fact available.
 *
 * Why the guard is written this way. The class's own thesis is that prose is
 * exactly the artifact CI cannot check — so a test that hard-codes the new
 * sentence would only pin today's wording and would go stale the same way the
 * old one did. Instead the assertions are DERIVED from the provider's live
 * capability surface (`provider.supports(...)`, `provider.ui.write`): the copy
 * is checked against what Jira can actually do, right now, by execution. If
 * Jira's write surface ever genuinely changes in either direction, this test
 * fails and names the sentence that has to move with it.
 *
 * Verified by execution at the time of writing (LinearViewer `0224e368`):
 * Jira implements `updateIssue`, `createComment`, `addLabel`, `removeLabel`
 * and reports `ui.write: true`; it does NOT implement `createIssue`,
 * `updateComment`, `deleteComment`, `createRelation`, `deleteRelation` or
 * `uploadFile`. Four of those six ARE implemented by both other writable
 * providers, so the gap is real rather than a nobody-has-it carve-out — but a
 * partial write surface is still a write surface, which is the only thing the
 * consent sentence has to get right.
 *
 * Run with: node --test tests/unit/jira-consent-copy.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderJiraLinkForm } from '../../lib/render-pages.js';
import { getProvider } from '../../lib/providers/index.js';

const html = renderJiraLinkForm({ workspaceUrlKey: 'test-ws' });
const jira = getProvider('jira');

/** The writes Jira actually implements, asked of the provider rather than assumed. */
const IMPLEMENTED_WRITES = ['updateIssue', 'createComment', 'addLabel', 'removeLabel']
  .filter((op) => jira.supports(op));

describe('LIN-2302 instance 1 — Jira API-token consent copy', () => {
  test('the page under test is the one that collects the credential', () => {
    // Guard the guard: every assertion below is vacuous if this is not the
    // form that actually takes an API token.
    assert.match(html, /data-testid="jira-link-page"/);
    assert.match(html, /data-testid="jira-link-token"/);
    assert.match(html, /name="apiToken"/);
  });

  test('Jira really is write-capable, so the copy has something to disclose', () => {
    // The precondition the whole test rests on. If this ever fails, the old
    // "no write access is requested" sentence would have become TRUE and the
    // assertions below would be wrong rather than the copy.
    assert.equal(jira.ui.write, true, 'JiraProvider.ui.write');
    assert.ok(
      IMPLEMENTED_WRITES.length > 0,
      'expected at least one implemented Jira write; if this is now zero, the consent copy must be revisited, not this test'
    );
  });

  test('does not claim the credential is read-only or write-free', () => {
    // The exact shape of the retired claim, plus the near-misses a re-write
    // could plausibly reintroduce. Matched case-insensitively against the
    // rendered page, not against the source line, so a claim moved into a
    // helper or a template still trips it.
    const FALSE_CLAIMS = [
      /read-only/i,
      /no write access/i,
      /write access is not/i,
      /does not request write/i,
      /cannot (?:make )?chang/i,
      /read access only/i,
    ];
    for (const pattern of FALSE_CLAIMS) {
      assert.doesNotMatch(html, pattern, `consent copy must not assert: ${pattern}`);
    }
  });

  test('discloses that the credential can change things', () => {
    // Deliberately a capability check rather than a wording check: the copy has
    // to convey that writes are possible, in whatever words, and the specific
    // verbs are the ones the provider genuinely implements.
    assert.match(
      html,
      /updating them|update|chang/i,
      'consent copy must disclose that Harbour can change issues with this credential'
    );
    assert.match(html, /comment/i, 'createComment is implemented — say so');
    assert.match(html, /label/i, 'addLabel/removeLabel are implemented — say so');
  });

  test('does not promise a write Jira has not implemented', () => {
    // The other half, and the failure mode LIN-2276 and this ticket both hit:
    // a correction that lands a NEW false claim. Over-disclosing is a false
    // claim too — telling a user Harbour will create issues or upload files on
    // their Jira, when `supports()` says it cannot.
    const UNIMPLEMENTED = ['createIssue', 'uploadFile', 'createRelation'];
    for (const op of UNIMPLEMENTED) {
      assert.equal(jira.supports(op), false, `precondition: Jira still does not implement ${op}`);
    }
    assert.doesNotMatch(html, /creat(?:e|ing) (?:new )?(?:issues|tickets)/i, 'createIssue is not implemented on Jira');
    assert.doesNotMatch(html, /upload|attach(?:ment)?s? /i, 'uploadFile is not implemented on Jira');
  });
});

describe('LIN-2302 — the sibling claim found by sweeping the same file', () => {
  test('does not deny the top-level "Continue with Jira" entry that LIN-1890 added', () => {
    // Not in LIN-2302's five-instance list; found by sweeping
    // `lib/render-pages.js` for the class rather than fixing only the cited
    // line. The docblock said the form is add-source only "because there is no
    // top-level 'Continue with Jira' entry point". The conclusion is right and
    // the reason was false: LIN-1890 added exactly that entry.
    //
    // Asserted against the SOURCE, since a docblock never reaches the rendered
    // page — which is precisely why the stale claim survived a page-level
    // review in the first place.
    const src = readSource();
    assert.doesNotMatch(
      src,
      /there is no\s*\n?\s*\*?\s*top-level "Continue with Jira" entry point/,
      'LIN-1890 added a top-level Jira entry (landing-cta-jira / nav-login-jira)'
    );
  });

  test('the entry point it used to deny genuinely exists', () => {
    // Grounding, so the assertion above is not just a string ban: the CTA the
    // old comment said did not exist is rendered by the shared hero when Jira
    // OAuth is configured, and its href comes from the provider registry.
    const cta = getProvider('jira')?.entryCta;
    assert.ok(cta, 'JiraProvider declares an entryCta');
    assert.equal(typeof cta.href, 'string');
    assert.ok(cta.href.length > 0, 'entryCta.href is a real path');
    assert.equal(typeof cta.isConfigured, 'function');
  });
});

function readSource() {
  return readFileSync(new URL('../../lib/render-pages.js', import.meta.url), 'utf8');
}
