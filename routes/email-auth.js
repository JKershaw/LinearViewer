/**
 * Email magic-link sign-in routes (LIN-1892 S2 item 4). Thin HTTP layer over
 * lib/email-auth.js; email is an identity type, not a provider.
 *
 *   GET  /auth/email          → the form (send nonce minted), or "You're signed in"
 *   POST /auth/email/send     → one "check your inbox" page for every address
 *   GET  /auth/email/confirm  → the confirm page (confirm nonce minted); NEVER consumes
 *   POST /auth/email/confirm  → login-CSRF checks, N2 guard, consume, sign in
 *   GET  /account             → the account home for a signed-in, zero-workspace session
 *
 * Every /auth/email* route answers 503 when email sign-in is off
 * (`transport === null`, i.e. `isEmailSignInAvailable()` is false).
 * `/account` does not: it belongs to the account, not to the email door.
 *
 * The login-CSRF defence (plan §G1): the session cookie is `sameSite:'lax'`
 * (lib/session-options.js), so a cross-site POST carries no cookie and so no
 * confirm nonce; the nonce is minted only by this browser's own GET of the
 * confirm page, bound to the token, and single use; `Sec-Fetch-Site` and
 * anti-framing headers are extra layers. All of it is checked BEFORE the
 * token is touched, so a refusal consumes nothing.
 *
 * N2 (revised contract): a sign-in-mode confirm NEVER attaches an email to an
 * already signed-in account. If the session holds a live account P, the
 * confirm proceeds only when the address is already on P (checked before and
 * again after consume). Attaching an email to a live account is S3's link
 * mode, and S2 never offers a merge.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes } from 'node:crypto';
import {
  normalizeEmail,
  EMAIL_SEND_THROTTLE_MAX,
  mintConfirmNonce,
  verifyAndClearConfirmNonce,
  mintSendNonce,
  verifySendNonce,
} from '../lib/email-auth.js';
import { establishAccount } from '../lib/account-session.js';
import { respondToAccountConflict, EMAIL_REPROOF_URL } from '../lib/account-conflict.js';
import { saveSession } from '../lib/workspace.js';
import { applyUserPreferencesToSession, setThemeCookie } from '../lib/user-preferences.js';
import {
  renderEmailSignInPage,
  renderEmailSignedInPage,
  renderEmailRegisterPage,
  renderEmailReproofPage,
  renderEmailCheckInboxPage,
  renderEmailLinkExpiredPage,
  renderEmailConfirmPage,
  renderEmailLinkConfirmPage,
  renderEmailLinkWrongBrowserPage,
  renderEmailConfirmSignedInRefusedPage,
  renderEmailConfirmRefusedPage,
  renderEmailSendRefusedPage,
  renderEmailUnavailablePage,
} from '../lib/render-email-auth.js';
import { renderAccountHomePage } from '../lib/render-account-home.js';
import { getProvider } from '../lib/providers/index.js';

const WELL_FORMED_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * N1 (LIN-1892): a signed-in account with zero workspaces is not a signed-out
 * visitor. `/` and the unauthenticated previews (`/swipe`, `/swim`, `/ship`)
 * call this AFTER their own "has a workspace" redirect; it sends such a
 * session to its account home instead of the sign-in CTAs.
 * @returns {boolean} true when it redirected (the caller returns)
 */
export function accountHomeRedirect(req, res) {
  if (req.session?.accountId && !(req.session.workspaces?.length > 0)) {
    res.redirect('/account');
    return true;
  }
  return false;
}

// Per-IP send limit, the same shape as routes/proxy.js's
// proxyTokenCreationLimiter. Module scope, so its budget is process-global
// across router instances.
export function createEmailSendLimiter({ skip = () => process.env.NODE_ENV === 'test' } = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many sign-in emails requested, please try again later',
    skip,
  });
}
export const emailSendLimiter = createEmailSendLimiter();

// The confirm page must not be framed (a framed page could be clicked
// through), cached, or leak its `?t=` URL in a Referer.
function setConfirmPageHeaders(res) {
  res.set({
    'Content-Security-Policy': "frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * @param {Object} options
 * @param {import('../lib/account-store.js').AccountStore} options.accountStore
 * @param {import('../lib/account-workspace-store.js').AccountWorkspaceStore} options.accountWorkspaceStore
 * @param {import('../lib/user-preferences.js').UserPreferencesStore} [options.userPreferencesStore]
 * @param {import('../lib/email-auth.js').MagicLinkStore} options.magicLinkStore
 * @param {Object|null} options.transport - from createEmailTransport; null = email sign-in off
 * @param {string|null} [options.linkOrigin] - canonical origin for links in emails (required for a Resend transport); null = the request's own (console/capture only)
 * @param {Function} [options.sendLimiter] - defaults to the module-scope per-IP limiter
 * @param {() => number} [options.now] - clock for nonce ages (tests)
 * @returns {Router}
 */
export function createEmailAuthRoutes({
  accountStore,
  accountWorkspaceStore,
  userPreferencesStore,
  magicLinkStore,
  transport,
  linkOrigin = null,
  sendLimiter = emailSendLimiter,
  now = Date.now,
}) {
  const router = Router();

  function unavailable(res) {
    return res.status(503).send(renderEmailUnavailablePage());
  }

  async function canonical(accountId) {
    try {
      return await accountStore.resolveCanonicalAccountId(accountId);
    } catch (err) {
      console.error('[email-auth] canonical account resolution failed; continuing with the uncanonicalized id:', err);
      return accountId;
    }
  }

  // N2: is `emailNorm` already on the session's live account? Both sides
  // canonicalised, so an address on an account merged into P counts as P's.
  async function emailIsOnLiveAccount(sessionAccountId, emailNorm) {
    const owner = await accountStore.findAccountByIdentity('email', emailNorm);
    if (!owner) return false;
    return (await canonical(owner._id)) === (await canonical(sessionAccountId));
  }

  // S3 link mode: the confirming session's canonical account must be the
  // account the token was minted for. Reuses `canonical()` (the same helper
  // `emailIsOnLiveAccount` uses), so a resolver failure degrades to the raw
  // ids — a mismatch is refused, never failed open (F16).
  async function sameCanonicalAccount(a, b) {
    if (!a || !b) return false;
    return (await canonical(a)) === (await canonical(b));
  }

  // A post-link destination must be a same-origin absolute path — never an
  // off-site URL and never a protocol-relative `//host` (open-redirect guard).
  function safeNext(next) {
    return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : null;
  }

  // Where to land after a link-mode confirm: the requested `next` when safe,
  // else the session's first workspace, else the account home. No regenerate
  // happens in link mode, so `session.workspaces` is intact.
  function linkCompletionRedirect(req, next) {
    const ws = (req.session.workspaces || [])[0];
    return safeNext(next) || (ws ? `/workspace/${encodeURIComponent(ws.urlKey)}/` : '/account');
  }

  // S3 pre-fill (N7): the address already at rest on the account, never a new
  // provider call and never treated as verified. Jira stores
  // `credentials.email` via linkIdentity; Linear's viewer.email is only ever
  // used if it is already on the session (nothing writes it today).
  async function emailPrefill(accountId) {
    try {
      const account = await accountStore.getAccount(await canonical(accountId));
      const jira = (account?.identities || []).find(i => i.provider === 'jira');
      const fromJira = jira?.credentials?.email;
      return normalizeEmail(fromJira) || null;
    } catch (err) {
      console.error('[email-auth] email pre-fill lookup failed:', err?.name || 'Error');
      return null;
    }
  }

  // S3-4: the address the email re-proof sends its sign-in link to — any email
  // identity already on P (canonical). Never affects who is allowed to sign in:
  // confirming it goes through the N2 guard like any sign-in link.
  async function primaryEmailForAccount(accountId) {
    try {
      const account = await accountStore.getAccount(await canonical(accountId));
      const identity = (account?.identities || []).find(i => i.provider === 'email');
      return identity?.scope || null;
    } catch (err) {
      console.error('[email-auth] re-proof address lookup failed:', err?.name || 'Error');
      return null;
    }
  }

  // F15 (LIN-1892) decision: the account home lists email identities across the
  // WHOLE mergedInto chain — the canonical account plus every account merged
  // into it. `mergeAccounts` is an alias, not a migration: it never moves
  // `identities[]`, so a session that signed in on an account later merged away
  // (a stale phone session on X, merged into P) would otherwise stop seeing the
  // address it signs in with. Reading the alias chain keeps that address
  // visible, and makes a live canonical session and a stale merged session
  // agree on the same set.
  async function emailIdentitiesAcrossMerged(canonicalId) {
    const account = await accountStore.getAccount(canonicalId);
    const merged = await accountStore.listMergedAccounts(canonicalId);
    const scopes = [account, ...merged]
      .filter(Boolean)
      .flatMap(a => a.identities || [])
      .filter(i => i.provider === 'email')
      .map(i => i.scope);
    return [...new Set(scopes)];
  }

  // S3-1/S3-4: the re-auth target for a stale conflict against the live account
  // P. It must re-prove P, never `/auth/email` — navigating a signed-in session
  // to `/auth/email` only shows "You're signed in" and cannot re-stamp freshness.
  // Use P's own provider sign-in when it has one (any provider identity,
  // github-projects included via the `github` identity provider); an email-only
  // (or local-only) P gets the working email re-proof page, which emails a
  // sign-in link to an address already on P. Never returns `/auth/email`.
  async function linkModeReproof(accountId) {
    try {
      const account = await accountStore.getAccount(await canonical(accountId));
      const identity = (account?.identities || []).find(i => i.provider !== 'email' && i.provider !== 'local');
      const href = identity ? getProvider(identity.provider)?.entryCta?.href : null;
      if (href) return { reauthUrl: href, emailOnly: false };
    } catch (err) {
      console.error('[email-auth] re-proof lookup failed:', err?.name || 'Error');
    }
    return { reauthUrl: EMAIL_REPROOF_URL, emailOnly: true };
  }

  // S3 link-mode completion: NO regenerate (it is not a new sign-in). The
  // email identity is linked onto the live account; a conflict (the address
  // already belongs to another account) is the one email path that may offer
  // a merge, via the shared responder with `workspace:null` — never sign-in
  // mode's refusal. The null-workspace confirm branch completes it.
  async function completeLinkMode(req, res, { emailNorm, next }) {
    // Resolve the destination first: the hidden `next` from the confirm form,
    // else the value carried from the register page (cleared below).
    const destination = safeNext(next) || safeNext(req.session.emailLinkNext);
    const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'email', emailNorm, {}, null);
    delete req.session.emailLinkNext;
    if (!established.ok) {
      // The link was consumed before we got here, so a stale conflict must send
      // the user to re-prove P and then request a NEW link (S3-1) — not to
      // `/auth/email`, which cannot re-prove a signed-in session.
      const { reauthUrl, emailOnly } = await linkModeReproof(req.session.accountId);
      const reauthNote = emailOnly
        ? 'The email link you opened has been used. Re-prove your account with a sign-in link to your own address, then request a new link to add the address.'
        : 'The email link you opened has been used. After signing in again, request a new link to add the address.';
      // A conflict (the address already belongs to another account) shows the
      // merge offer when P is fresh, or this re-proof page when stale. A
      // stale/unresolvable session takes the responder's non-mergeable arm.
      await respondToAccountConflict({ req, res, established, workspace: null, mode: 'new', returnUrlKey: null, identityLabel: 'email', reauthUrl, provider: 'email', reauthNote });
      return;
    }
    await saveSession(req.session);
    res.redirect(linkCompletionRedirect(req, destination));
  }

  function linkUrl(req, token) {
    // Resend links reach real inboxes: never from the (forgeable) Host header.
    // lib/email-availability.js already keeps Resend off without an origin;
    // this refuses a mis-wired router too. Console/capture may fall back.
    if (!linkOrigin && transport.kind === 'resend') {
      throw new Error('a configured link origin is required to send Resend sign-in links');
    }
    const origin = linkOrigin || `${req.protocol}://${req.get('host')}`;
    return `${origin}/auth/email/confirm?t=${token}`;
  }

  router.get('/account', async (req, res) => {
    if (!req.session.accountId) return res.redirect('/');
    // Only the zero-workspace state lives here; `/` takes a session with
    // workspaces to its first one (and sends this state back here — no loop,
    // the two conditions are exclusive).
    if (req.session.workspaces?.length > 0) return res.redirect('/');
    const emails = await emailIdentitiesAcrossMerged(await canonical(req.session.accountId));
    res.set('Cache-Control', 'no-store');
    res.send(renderAccountHomePage({ emails }));
  });

  router.get('/auth/email', async (req, res) => {
    if (!transport) return unavailable(res);
    // S2 issues no tokens to a signed-in session (N2); adding an email to a
    // live account is S3's link mode, from Settings.
    if (req.session.accountId) return res.send(renderEmailSignedInPage());
    const nonce = mintSendNonce(req.session, now());
    await saveSession(req.session);
    res.send(renderEmailSignInPage({ nonce }));
  });

  // S3 link mode: the "add an email to this account" form. Sign-in is
  // required, so the token is bound to a live canonical account by the send
  // below. This is the step page and the target of Settings' "Add email".
  router.get('/auth/email/register', async (req, res) => {
    if (!transport) return unavailable(res);
    if (!req.session.accountId) return res.redirect('/');
    const next = safeNext(req.query?.next);
    const nonce = mintSendNonce(req.session, now());
    const prefill = await emailPrefill(req.session.accountId);
    await saveSession(req.session);
    res.send(renderEmailRegisterPage({ nonce, prefill, next }));
  });

  // S3-4: the email-only re-proof page. A stale email-only account must be able
  // to re-prove itself; this emails a SIGN-IN-mode link to an address already on
  // P, which re-stamps P's freshness through the N2 positive control. It is a
  // GET-minted send nonce + POST send (never an unsolicited send from a GET).
  router.get('/auth/email/reproof', async (req, res) => {
    if (!transport) return unavailable(res);
    if (!req.session.accountId) return res.redirect('/');
    const email = await primaryEmailForAccount(req.session.accountId);
    if (!email) return res.redirect('/account');
    const nonce = mintSendNonce(req.session, now());
    await saveSession(req.session);
    res.send(renderEmailReproofPage({ email, nonce }));
  });

  router.post('/auth/email/send', sendLimiter, async (req, res) => {
    if (!transport) return unavailable(res);
    const body = req.body || {};

    // Send nonce first: a refusal stores nothing and leaves the session
    // untouched, so express-session saves nothing and sets no cookie. That
    // stops a cross-site POST from planting a fresh session (and an
    // attacker-chosen request nonce) in the victim's browser.
    if (!verifySendNonce(req.session, body.nonce, now())) {
      return res.status(403).send(renderEmailSendRefusedPage());
    }

    const mode = body.mode === 'link' ? 'link' : (body.mode === 'reproof' ? 'reproof' : 'signin');
    // S3 link mode and S3-4 re-proof: a token may only be minted by a session
    // already holding an account. A signed-out (or cross-site) send can never
    // mint one — it is not bound.
    if ((mode === 'link' || mode === 'reproof') && !req.session.accountId) {
      return res.status(403).send(renderEmailSendRefusedPage());
    }
    // S2 sign-in mode: a live session gets no sign-in token (N2).
    if (mode === 'signin' && req.session.accountId) return res.send(renderEmailSignedInPage());

    const emailNorm = normalizeEmail(body.email);
    if (!emailNorm) {
      // About the typed text only, never about whether the address is known.
      const nonce = mintSendNonce(req.session, now());
      await saveSession(req.session);
      const error = 'Enter an email address like you@example.com.';
      if (mode === 'link') {
        return res.status(400).send(renderEmailRegisterPage({ nonce, prefill: await emailPrefill(req.session.accountId), next: safeNext(body.next), error }));
      }
      if (mode === 'reproof') {
        return res.redirect('/auth/email/reproof');
      }
      return res.status(400).send(renderEmailSignInPage({ nonce, error }));
    }

    // S3-4: the re-proof send may only target an address already on P. It is not
    // an arbitrary-address send from a signed-in session (which would be a
    // stolen-session spam vector), and the confirm still goes through N2.
    if (mode === 'reproof' && !(await emailIsOnLiveAccount(req.session.accountId, emailNorm))) {
      return res.status(403).send(renderEmailSendRefusedPage());
    }

    // One per browser; its hash rides on the token. It only drives the
    // "requested from another device" notice — it proves nothing.
    if (!req.session.emailRequestNonce) {
      req.session.emailRequestNonce = randomBytes(32).toString('base64url');
    }

    // S3: bind a link-mode token to the live session's canonical account. The
    // confirm re-derives canonical on both sides before spending it. A re-proof
    // token is a plain SIGN-IN token (so its consume re-stamps P via N2).
    const linkToAccountId = mode === 'link' ? await canonical(req.session.accountId) : null;
    const issueMode = mode === 'link' ? 'link' : 'signin';
    const next = mode === 'link' ? safeNext(body.next) : null;
    if (mode === 'link') req.session.emailLinkNext = next;

    try {
      if (await magicLinkStore.recentCountForEmail(emailNorm) < EMAIL_SEND_THROTTLE_MAX) {
        const { token } = await magicLinkStore.issue({
          emailNorm,
          mode: issueMode,
          linkToAccountId,
          requestNonceHash: sha256Hex(req.session.emailRequestNonce),
        });
        const url = linkUrl(req, token);
        const lead = mode === 'link' ? 'Confirm this email for your Harbour account' : 'Sign in to Harbour';
        const text = `${lead}:\n\n${url}\n\nThis link works once, for 15 minutes. If you didn't ask for it, ignore this email.`;
        await transport.send({
          to: emailNorm,
          subject: mode === 'link' ? 'Confirm your email for Harbour' : 'Your Harbour sign-in link',
          text,
          html: `<p><a href="${url}">${lead}</a></p><p>This link works once, for 15 minutes. If you didn't ask for it, ignore this email.</p>`,
        });
      }
    } catch (err) {
      // Logged without the address or token; the page below is unchanged.
      console.error('[email-auth] email link issue failed:', err?.name || 'Error');
    }

    await saveSession(req.session);
    // Identical for every address, throttled or not, sent or not.
    res.send(renderEmailCheckInboxPage());
  });

  router.get('/auth/email/confirm', async (req, res) => {
    if (!transport) return unavailable(res);
    setConfirmPageHeaders(res);
    const t = req.query?.t;
    const link = await magicLinkStore.peek(t);
    // Only a well-formed live token has a page; unknown/expired is a 410.
    if (!link) return res.status(410).send(renderEmailLinkExpiredPage());

    // Minted even on the refusal pages below, so the POST-side guards stand on
    // their own rather than relying on a missing button.
    const nonce = mintConfirmNonce(req.session, t, now());
    await saveSession(req.session);

    if (link.mode === 'link') {
      // S3: a link-mode token is bound to the account that requested it; the
      // confirming session must be that same canonical account. A different
      // browser, or a session that switched account, is refused without
      // touching the token.
      if (!(await sameCanonicalAccount(req.session.accountId, link.linkToAccountId))) {
        return res.status(409).send(renderEmailLinkWrongBrowserPage({ token: t, nonce }));
      }
      return res.send(renderEmailLinkConfirmPage({ email: link.emailNorm, token: t, nonce, next: safeNext(req.session.emailLinkNext) }));
    }

    if (req.session.accountId) {
      if (!(await emailIsOnLiveAccount(req.session.accountId, link.emailNorm))) {
        return res.status(409).send(renderEmailConfirmSignedInRefusedPage({ email: link.emailNorm }));
      }
      return res.send(renderEmailConfirmPage({ email: link.emailNorm, token: t, nonce, alreadySignedIn: true }));
    }

    const requestNonce = req.session.emailRequestNonce;
    const otherDevice = !requestNonce || !link.requestNonceHash || sha256Hex(requestNonce) !== link.requestNonceHash;
    res.send(renderEmailConfirmPage({ email: link.emailNorm, token: t, nonce, otherDevice }));
  });

  router.post('/auth/email/confirm', async (req, res) => {
    if (!transport) return unavailable(res);
    setConfirmPageHeaders(res);
    const { t, nonce } = req.body || {};
    const retryUrl = typeof t === 'string' && WELL_FORMED_TOKEN.test(t) ? `/auth/email/confirm?t=${t}` : null;

    // (a) A browser that says this POST came from another site is refused.
    //     Absent (older or non-browser clients) is let through to (b).
    const fetchSite = req.get('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin') {
      return res.status(403).send(renderEmailConfirmRefusedPage({ retryUrl }));
    }
    // (b) This browser's own confirm nonce for this token. No DB call yet.
    if (!verifyAndClearConfirmNonce(req.session, { t, nonce }, now())) {
      return res.status(403).send(renderEmailConfirmRefusedPage({ retryUrl }));
    }

    // (b′) The token's mode decides which guard runs, BEFORE consume — a
    //      refusal consumes nothing.
    const link = await magicLinkStore.peek(t);
    if (!link) return res.status(410).send(renderEmailLinkExpiredPage());

    if (link.mode === 'link') {
      // S3: the confirming session must be the canonical account the token was
      // minted for. A throwing canonical resolver degrades to the raw ids →
      // mismatch → refused (F16), never failed open.
      if (!(await sameCanonicalAccount(req.session.accountId, link.linkToAccountId))) {
        return res.status(409).send(renderEmailLinkWrongBrowserPage({ token: t, nonce }));
      }
    } else {
      // N2: a live account may only re-confirm an address it already holds.
      const liveAccountId = req.session.accountId || null;
      if (liveAccountId && !(await emailIsOnLiveAccount(liveAccountId, link.emailNorm))) {
        return res.status(409).send(renderEmailConfirmSignedInRefusedPage({ email: link.emailNorm }));
      }
    }

    // (c) Spend the link: exactly one concurrent confirm wins.
    const consumed = await magicLinkStore.consume(t);
    if (!consumed) return res.status(410).send(renderEmailLinkExpiredPage());
    const emailNorm = consumed.emailNorm;

    // (c′) Re-check after consume, closing the gap between (b′) and (c). The
    //      token is spent if this refuses, which is harmless: nothing attached.
    if (consumed.mode === 'link') {
      if (!(await sameCanonicalAccount(req.session.accountId, consumed.linkToAccountId))) {
        return res.status(409).send(renderEmailLinkWrongBrowserPage({ token: t, nonce }));
      }
      return await completeLinkMode(req, res, { emailNorm, next: req.body?.next });
    }
    const liveAccountId = req.session.accountId || null;
    if (liveAccountId && !(await emailIsOnLiveAccount(liveAccountId, emailNorm))) {
      return res.status(409).send(renderEmailConfirmSignedInRefusedPage({ email: emailNorm }));
    }

    // Carry manifest across regenerate(), as routes/auth.js's Linear callback does.
    const existingWorkspaces = req.session.workspaces || [];
    const existingAccountId = req.session.accountId;
    const existingIdentityAuthenticatedAt = req.session.identityAuthenticatedAt;

    await new Promise((resolve) => {
      req.session.regenerate(async (regenerateErr) => {
        try {
          if (regenerateErr) {
            console.error('[email-auth] session regeneration error:', regenerateErr);
            res.status(500).send(renderEmailConfirmRefusedPage({ retryUrl: null }));
            return;
          }
          req.session.workspaces = existingWorkspaces;
          if (existingAccountId) req.session.accountId = existingAccountId;
          if (existingIdentityAuthenticatedAt !== undefined) req.session.identityAuthenticatedAt = existingIdentityAuthenticatedAt;

          // Identity-only sign-in: a null workspace writes no edge.
          const established = await establishAccount(req.session, accountStore, accountWorkspaceStore, 'email', emailNorm, {}, null);
          if (!established.ok) {
            if (established.conflict) {
              // Unreachable by construction: (b′)/(c′) admit a live account
              // only when the address is already on it, and with no live
              // account there is nothing to conflict with. S2 never turns a
              // conflict into a merge offer (N2), so refuse.
              console.error('[email-auth] invariant violation: sign-in-mode email confirm returned an account conflict; refused, no merge offered');
              await saveSession(req.session);
              res.status(409).send(renderEmailConfirmSignedInRefusedPage({ email: emailNorm }));
              return;
            }
            // A stale, unresolvable session.accountId: the shared
            // non-mergeable arm clears it and renders the conflict page.
            await respondToAccountConflict({ req, res, established, workspace: null, mode: 'new', returnUrlKey: null, identityLabel: 'email', reauthUrl: '/auth/email', provider: 'email' });
            return;
          }

          // regenerate() wiped the session: rehydrate the durable preferences
          // (OpenRouter key, features, north star, theme) for this account.
          if (userPreferencesStore) {
            const savedPrefs = await userPreferencesStore.getUserPreferences(established.accountId);
            applyUserPreferencesToSession(req.session, savedPrefs);
          }

          const firstWorkspace = req.session.workspaces[0];
          if (firstWorkspace) req.session.activeWorkspaceId = firstWorkspace.id;
          await saveSession(req.session);
          if (req.session.theme) setThemeCookie(res, req.session.theme);
          res.redirect(firstWorkspace ? `/workspace/${encodeURIComponent(firstWorkspace.urlKey)}/` : '/account');
        } catch (err) {
          console.error('[email-auth] confirm failed after regenerate:', err?.name || 'Error');
          if (!res.headersSent) res.status(500).send(renderEmailConfirmRefusedPage({ retryUrl: null }));
        } finally {
          resolve();
        }
      });
    });
  });

  return router;
}
