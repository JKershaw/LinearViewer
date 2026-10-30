/**
 * Dangling-referent guard for dispatch creation (LIN-1948, fix 2).
 *
 * A dispatch that NAMES an `issueIdentifier` which resolves to no issue is
 * almost always a mistake — a test fixture, a typo, or an agent probing an
 * endpoint. Twelve such rows reached production (LIN-1946: `TEST-14`, `LIN-1`)
 * and a thirteenth landed on 2026-08-10 while this fix was parked. Format
 * checking alone cannot catch them: `ISSUE_ID_REGEX` (`lib/workspace.js`) is
 * `/^[A-Za-z0-9-]{1,100}$/`, which `TEST-14`, `LIN-1` and `LIN-99999` all pass.
 *
 * WHY THIS MODULE EXISTS RATHER THAN A ROUTE-LOCAL HELPER: two independent
 * routers create dispatches on two different credential lanes — the proxy-token
 * lane (`routes/proxy.js`) and the session-cookie lane (`routes/dispatch.js`).
 * A copy per router is exactly where the fail-open rules below could be
 * inverted on one lane only and stay invisible.
 *
 * ── FAILS OPEN, ALWAYS ────────────────────────────────────────────────────
 * Dispatch requires no provider access today and MUST keep requiring none as a
 * floor: a Linear outage must never become a dispatch outage. So this returns
 * `false` (allow) on every non-definitive outcome, and `true` (refuse) ONLY on
 * a definitive null from the provider's own lookup:
 *
 *   - no `issueIdentifier` supplied      -> allow (identifier-less wakes/customs are legal)
 *   - no credential resolves             -> allow
 *   - provider not in GUARDED_PROVIDERS  -> allow
 *   - provider lacks `issueWriteGuard`   -> allow
 *   - the probe throws                   -> allow
 *
 * A THROWN AUTH ERROR IS STILL A FAIL-OPEN allow, but it is no longer silent
 * (LIN-3186). The catch below classifies the error; when the category is
 * `auth` it emits one `[dispatch-referent-auth-swallowed]` line carrying the
 * provider, issue identifier, and the credential DIGEST (never token bytes),
 * so a dead credential that turns every named-referent dispatch probe into a
 * swallowed 401 is visible in the log stream. The logging is wrapped so it can
 * never throw, and the function still returns `false` in every non-definitive
 * case (LIN-1948: fails open, always). Fingerprints are computed HERE, so
 * callers need no change.
 *
 * DO NOT reimplement the capability check with `denyIfMissingRead`
 * (`routes/proxy.js`). That helper FAILS CLOSED — it sends a 422 when the named
 * method is absent, which is the exact inverse of what this guard requires. A
 * diff that reuses the sibling faithfully would silently turn every dispatch on
 * a `github-projects`-backed workspace into a refusal.
 */
import { classifyUpstreamError } from './errors.js';
import { fingerprintCredential } from './credential-diagnostics.js';

/** Machine-readable discriminator on the 422 both routers send. */
export const ISSUE_NOT_FOUND_CODE = 'ISSUE_NOT_FOUND';

/**
 * Providers whose `issueWriteGuard` resolves the SAME identifier string a
 * dispatch carries, so a null return genuinely means "no such issue".
 *
 * Deliberately an allowlist, not "everyone who implements the method".
 * GitHub's `issueWriteGuard` resolves by issue NUMBER, so it would return null
 * for a perfectly valid `LIN-`-style identifier and refuse a legitimate
 * dispatch. Null is not portable across providers; opt each one in only once
 * its lookup is known to speak identifiers.
 */
export const GUARDED_PROVIDERS = new Set(['linear', 'local']);

/**
 * The guard's probe, answering the issue as well as the verdict (LIN-4034). The
 * entrance already makes this read for the referent check, so the dispatch row's
 * title rides on it instead of costing a second tracker read.
 *
 * Fails open exactly as `isDanglingReferent` does: every non-definitive outcome
 * answers `{ dangling: false, issue: null }`, so a throw, a missing token or an
 * unguarded provider yields no title and never a refusal.
 *
 * @param {Object} args - as `isDanglingReferent`
 * @returns {Promise<{dangling: boolean, issue: Object|null}>} `issue` is the provider's
 *   own read when it resolved the referent, else null
 */
export async function probeDanglingReferent({ provider, token, issueIdentifier }) {
  const allow = () => ({ dangling: false, issue: null });
  // Only fires when the caller SUPPLIED a referent. An inherited follow-up
  // anchor or an identifier-less wake was never caller input and is not checked.
  if (!issueIdentifier || typeof issueIdentifier !== 'string') return allow();
  if (!token) return allow();
  if (!provider || !GUARDED_PROVIDERS.has(provider.name)) return allow();
  if (typeof provider.issueWriteGuard !== 'function') return allow();

  try {
    const issue = await provider.issueWriteGuard(token, issueIdentifier);
    // Definitive absence is the ONLY refusal. `undefined` is treated as a
    // malformed provider response, not an answer, and allows.
    if (issue === null) return { dangling: true, issue: null };
    return { dangling: false, issue: issue ?? null };
  } catch (err) {
    // Outage, rate limit, auth failure, malformed response — never a refusal.
    // LIN-3186: surface a swallowed AUTH failure (digest only) without ever
    // letting the logging itself throw or change the fail-open return.
    try {
      const classification = classifyUpstreamError(err, provider.ui?.displayName ?? null);
      if (classification.category === 'auth') {
        console.warn('[dispatch-referent-auth-swallowed]', {
          provider: provider.name,
          issueIdentifier,
          credentialFingerprint: fingerprintCredential(token),
        });
      }
    } catch {
      // Logging must never become the failure. Swallow and keep failing open.
    }
    return allow();
  }
}

/**
 * Does this dispatch name a referent that definitively does not exist?
 *
 * @param {Object} args
 * @param {Object|null} args.provider  - resolved provider instance (may be null)
 * @param {*} args.token               - resolved credential / call scope (may be falsy)
 * @param {string|null} args.issueIdentifier - the identifier the CALLER supplied
 * @returns {Promise<boolean>} true only when the referent is definitively absent
 */
export async function isDanglingReferent(args) {
  return (await probeDanglingReferent(args)).dangling;
}

/**
 * The refusal message, shared so the two lanes cannot drift into answering
 * differently for the same condition.
 *
 * 422 rather than 404 is deliberate and recorded: the POST body is well-formed,
 * it just names a referent that does not resolve. `recommend-and-dispatch`
 * already answers 404 for this condition because it resolves the referent in
 * order to READ it ("the resource you named to read is absent"); that endpoint
 * is unchanged. The divergence is documented in `/api/proxy/instructions`.
 */
export const DANGLING_REFERENT_MESSAGE =
  'Issue not found; refusing to dispatch against a referent that does not resolve';

/**
 * The 422 body, built in one place. `routes/proxy.js` reaches the same shape
 * through its `jsonError(res, 422, message, extra)` idiom; this is the
 * ready-made object for callers that spread it into `jsonError(res, 422, error, rest)`.
 */
export function danglingReferentBody(issueIdentifier) {
  return {
    error: DANGLING_REFERENT_MESSAGE,
    code: ISSUE_NOT_FOUND_CODE,
    issueIdentifier,
  };
}
