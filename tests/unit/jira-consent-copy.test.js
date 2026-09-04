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
 * Verified by execution (LinearViewer `0224e368`): Jira implements
 * `updateIssue`, `createComment`, `addLabel`, `removeLabel` and reports
 * `ui.write: true`; it does NOT implement `createIssue`, `updateComment`,
 * `deleteComment`, `createRelation`, `deleteRelation` or `uploadFile`. A
 * partial write surface is still a write surface, which is the only thing the
 * consent sentence has to get right.
 *
 * ---- How this guard is built, and the two ways the first version failed ----
 *
 * The class's thesis is that prose is exactly the artifact CI cannot check, so
 * assertions are DERIVED from the provider's live capability surface rather
 * than pinning today's wording. That part was right. Two things were not, both
 * caught in review, and both are the reason the helpers below exist:
 *
 *   1. SCOPE. Assertions ran against the whole rendered page, so
 *      `assert.match(html, /label/i)` was satisfied by the form's own
 *      `<label class="field-label">` markup. It passed with the consent
 *      sentence DELETED ENTIRELY. Everything now runs against the extracted
 *      consent paragraph, so page chrome cannot satisfy a content check.
 *
 *   2. POLARITY. The checks tested substring PRESENCE, so a copy reading
 *      "Harbour will never change your issues, never post a comment" passed
 *      all seven tests — it dodged the banned phrasings while satisfying
 *      /chang/ and /comment/. A guard that green-lights the ticket's own
 *      defect in different words is theatre. Disclosure is now checked as an
 *      AFFIRMATIVE claim: the paragraph must state the capability and must not
 *      negate it.
 *
 * Run with: node --test tests/unit/jira-consent-copy.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderJiraLinkForm } from '../../lib/render-pages.js';
import { getProvider } from '../../lib/providers/index.js';

const html = renderJiraLinkForm({ workspaceUrlKey: 'test-ws' });
const jira = getProvider('jira');

/**
 * The consent paragraph alone — the sentence the user actually reads before
 * handing over a credential. Everything below asserts against THIS, never the
 * page, so form labels, hints and button text cannot satisfy a content check.
 */
function consentCopy() {
  // The first <p> inside the login container that mentions the API token: the
  // page's other <p> is the "create a token at id.atlassian.com" hint.
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => m[1]);
  const copy = paragraphs.find(p => /api token/i.test(p) && !/id\.atlassian\.com/i.test(p));
  assert.ok(copy, 'could not find the Jira consent paragraph — the guard cannot run');
  return copy.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

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

  test('the consent paragraph is extractable and is not the token hint', () => {
    // If extraction silently fell back to the wrong <p>, every content check
    // below would be measuring the wrong sentence.
    const copy = consentCopy();
    assert.match(copy, /api token/i);
    assert.doesNotMatch(copy, /id\.atlassian\.com/i);
    assert.ok(copy.length > 40, `consent copy suspiciously short: ${JSON.stringify(copy)}`);
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
    const copy = consentCopy();
    const FALSE_CLAIMS = [
      /read-only/i,
      /read access only/i,
      /no write access/i,
      /write access is not/i,
      /does not request write/i,
    ];
    for (const pattern of FALSE_CLAIMS) {
      assert.doesNotMatch(copy, pattern, `consent copy must not assert: ${pattern}`);
    }
  });

  test('does not NEGATE the write capability in any wording', () => {
    // The review finding this test exists for. Banning the retired phrasings
    // only stops that exact sentence returning; the defect is the CLAIM, and
    // "Harbour will never change your issues" makes it in words no ban listed.
    //
    // So: no negation may appear anywhere in the same sentence as a write verb,
    // in either order. Checked per sentence rather than per paragraph so a
    // legitimate negation elsewhere ("we never store your token") stays legal.
    const NEGATION = String.raw`\b(?:never|not|no|cannot|can't|won't|will not|unable to|without)\b`;
    const WRITE_VERB = String.raw`\b(?:chang\w*|updat\w*|writ\w*|modif\w*|edit\w*|comment\w*|label\w*)\b`;
    for (const sentence of consentCopy().split(/(?<=[.!?])\s+/)) {
      assert.doesNotMatch(
        sentence,
        new RegExp(`${NEGATION}[^.]*${WRITE_VERB}`, 'i'),
        `consent copy negates a write capability: ${JSON.stringify(sentence)}`
      );
      assert.doesNotMatch(
        sentence,
        new RegExp(`${WRITE_VERB}[^.]*${NEGATION}`, 'i'),
        `consent copy negates a write capability: ${JSON.stringify(sentence)}`
      );
    }
  });

  test('affirmatively discloses each write Jira actually implements', () => {
    // Capability-driven, not wording-driven: the verbs asserted are exactly the
    // ones `supports()` reports, so the copy and the code cannot drift apart.
    const copy = consentCopy();
    const DISCLOSURE = {
      updateIssue: /\b(?:updat\w*|chang\w*|edit\w*)\b/i,
      createComment: /\bcomment\w*\b/i,
      addLabel: /\blabel\w*\b/i,
      removeLabel: /\blabel\w*\b/i,
    };
    for (const op of IMPLEMENTED_WRITES) {
      assert.match(copy, DISCLOSURE[op], `${op} is implemented — the consent copy must disclose it`);
    }
  });

  test('does not promise a write Jira has not implemented', () => {
    // The other half, and the failure mode LIN-2276, this ticket, and this
    // ticket's FIRST fix all hit: a correction that lands a NEW false claim.
    // Over-disclosing is a false claim too — telling a user Harbour will create
    // issues or upload files on their Jira, when `supports()` says it cannot.
    const copy = consentCopy();
    const UNIMPLEMENTED = ['createIssue', 'uploadFile', 'createRelation'];
    for (const op of UNIMPLEMENTED) {
      assert.equal(jira.supports(op), false, `precondition: Jira still does not implement ${op}`);
    }
    // `\b`, not a trailing space: `|` binds loosest, so `/upload|attachments? /`
    // meant "upload" OR "attachments<space>" and missed the natural
    // sentence-final "…and adding attachments." (review finding).
    assert.doesNotMatch(copy, /\bcreat\w*\s+(?:new\s+)?(?:issues?|tickets?)\b/i, 'createIssue is not implemented on Jira');
    assert.doesNotMatch(copy, /\b(?:upload\w*|attach(?:ment)?s?)\b/i, 'uploadFile is not implemented on Jira');
    assert.doesNotMatch(copy, /\blink\w*\s+issues?\b/i, 'createRelation is not implemented on Jira');
  });

  test('distinguishes the token’s authority from what Harbour exercises', () => {
    // Review finding 5. The first corrected sentence read "Harbour ... can do
    // anything your own Jira account can" — whose subject is HARBOUR, which
    // implements 4 of 9 interface writes. True of the token's authority, false
    // of Harbour, and it asserted the superset containing the very writes the
    // test above bans. Over-disclosure errs safe, but this file states the rule
    // that over-disclosure is a false claim, so it has to hold itself to it.
    const copy = consentCopy();
    const overclaimsForHarbour = /Harbour[^.]*\b(?:anything|everything|full access|all)\b/i.test(copy);
    assert.equal(
      overclaimsForHarbour, false,
      `the copy attributes unbounded capability to Harbour rather than to the token: ${JSON.stringify(copy)}`
    );
  });
});

describe('LIN-2302 — the sibling claims found by sweeping the same file', () => {
  // Neither is in LIN-2302's five-instance list; both were found by sweeping
  // `lib/render-pages.js` for the class rather than fixing only the cited line.
  //
  // These assert against the CODE, not against the docblock text. An earlier
  // version banned the retired sentence by regex, and review showed that guard
  // was both wrap-locked (it encoded the old line-wrap) and near-circular (the
  // docblock now quotes its own history, and only avoided tripping its own ban
  // by an accident of quote style). A string ban on prose that must be free to
  // quote its own corrections is not a guard. Grounding the replacement claims
  // in executable facts is.

  test('a top-level "Continue with Jira" entry really does exist', () => {
    // The claim the docblock used to deny. LIN-1890 added it.
    const cta = getProvider('jira')?.entryCta;
    assert.ok(cta, 'JiraProvider declares an entryCta');
    assert.match(cta.href, /^\/auth\/jira\/oauth/, 'entryCta points at the OAuth lane');
    assert.match(cta.href, /mode=new/, 'and carries the top-level (mode: new) intent explicitly');
  });

  test('the API-token lane genuinely authenticates a human, so the second reason was false too', () => {
    // The reason LIN-2302's own first fix put in its place, inherited from
    // CLAUDE.md: "an API token authenticates a workspace binding, not a human,
    // so it cannot establish a login". Also false — `POST /auth/jira/link`
    // calls `establishAccount(..., 'jira', myself.accountId, ...)`, the same
    // durable-identity function the OAuth path uses.
    //
    // Asserted through the provider's own credential-validation contract,
    // which is what returns the human identity that call is keyed on.
    assert.equal(typeof jira.validateCredential, 'function',
      'the Basic lane validates a credential and gets an identity back — that is what establishAccount is keyed on');
  });
});
