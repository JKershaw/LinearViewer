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
import { respondToAccountConflict } from '../lib/account-conflict.js';
import { saveSession } from '../lib/workspace.js';
import { applyUserPreferencesToSession, setThemeCookie } from '../lib/user-preferences.js';
import {
  renderEmailSignInPage,
  renderEmailSignedInPage,
  renderEmailCheckInboxPage,
  renderEmailLinkExpiredPage,
  renderEmailConfirmPage,
  renderEmailConfirmSignedInRefusedPage,
  renderEmailConfirmRefusedPage,
  renderEmailSendRefusedPage,
  renderEmailUnavailablePage,
} from '../lib/render-email-auth.js';
import { renderAccountHomePage } from '../lib/render-account-home.js';

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
    const account = await accountStore.getAccount(await canonical(req.session.accountId));
    const emails = (account?.identities || []).filter(i => i.provider === 'email').map(i => i.scope);
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
    if (req.session.accountId) return res.send(renderEmailSignedInPage());

    const emailNorm = normalizeEmail(body.email);
    if (!emailNorm) {
      // About the typed text only, never about whether the address is known.
      const nonce = mintSendNonce(req.session, now());
      await saveSession(req.session);
      return res.status(400).send(renderEmailSignInPage({ nonce, error: 'Enter an email address like you@example.com.' }));
    }

    // One per browser; its hash rides on the token. It only drives the
    // "requested from another device" notice — it proves nothing.
    if (!req.session.emailRequestNonce) {
      req.session.emailRequestNonce = randomBytes(32).toString('base64url');
    }

    try {
      if (await magicLinkStore.recentCountForEmail(emailNorm) < EMAIL_SEND_THROTTLE_MAX) {
        const { token } = await magicLinkStore.issue({
          emailNorm,
          mode: 'signin',
          requestNonceHash: sha256Hex(req.session.emailRequestNonce),
        });
        const url = linkUrl(req, token);
        await transport.send({
          to: emailNorm,
          subject: 'Your Harbour sign-in link',
          text: `Sign in to Harbour:\n\n${url}\n\nThis link works once, for 15 minutes. If you didn't ask for it, ignore this email.`,
          html: `<p><a href="${url}">Sign in to Harbour</a></p><p>This link works once, for 15 minutes. If you didn't ask for it, ignore this email.</p>`,
        });
      }
    } catch (err) {
      // Logged without the address or token; the page below is unchanged.
      console.error('[email-auth] sign-in link issue failed:', err?.name || 'Error');
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
    // S2 issues sign-in tokens only; a link-mode token belongs to S3's flow.
    if (!link || link.mode !== 'signin') return res.status(410).send(renderEmailLinkExpiredPage());

    // Minted even on the N2 refusal page below, so the POST-side guard
    // stands on its own rather than relying on the missing button.
    const nonce = mintConfirmNonce(req.session, t, now());
    await saveSession(req.session);

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

    const liveAccountId = req.session.accountId || null;
    // (b′) N2, before consume: a live account may only re-confirm an address
    //      it already holds. Nothing consumed, attached or offered.
    const link = await magicLinkStore.peek(t);
    if (!link || link.mode !== 'signin') return res.status(410).send(renderEmailLinkExpiredPage());
    if (liveAccountId && !(await emailIsOnLiveAccount(liveAccountId, link.emailNorm))) {
      return res.status(409).send(renderEmailConfirmSignedInRefusedPage({ email: link.emailNorm }));
    }

    // (c) Spend the link: exactly one concurrent confirm wins.
    const consumed = await magicLinkStore.consume(t);
    if (!consumed || consumed.mode !== 'signin') return res.status(410).send(renderEmailLinkExpiredPage());
    const emailNorm = consumed.emailNorm;

    // (c′) N2 again, closing the gap between (b′) and (c). The token is
    //      spent if this refuses, which is harmless: nothing was attached.
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
