/**
 * Pages for the email magic-link door (LIN-1892 S2): the email form, "check
 * your inbox", the confirm page (with the cross-device and signed-in
 * notices), and the refusal/expired/unavailable pages.
 *
 * Imported only by routes/email-auth.js. Same `login-container` /
 * `error-container` shells as the provider sign-in pages in
 * lib/render-pages.js, built directly on the page components so this module
 * stays below the provider/auth import cycle (N6).
 *
 * No page here may depend on whether an address is known: the send result is
 * one page for every address (no enumeration).
 */
import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderPageHeader } from './components/page-header.js';

function shell({ title, testid, container = 'login-container', body }) {
  return renderPage({
    title: `${escapeHtml(title)} - Harbour`,
    stylesheets: ['/style.css'],
    content: `${renderPageHeader({ title: 'Harbour' })}
  <div class="${container}" data-testid="${testid}">
    ${body}
  </div>`,
  });
}

// One click, one POST: a second click while the first submit is in flight
// would arrive with the already-spent confirm nonce and show a refusal even
// though the first click signed the user in (LIN-1892 beat-1 note).
const SUBMIT_ONCE = `onsubmit="var b=this.querySelector('button[type=submit]');if(b.disabled){return false}b.disabled=true"`;

/**
 * The email form.
 * @param {Object} options
 * @param {string} options.nonce - the send nonce for this session
 * @param {string} [options.error] - a message about the typed address itself
 */
export function renderEmailSignInPage({ nonce, error } = {}) {
  const errorHtml = error ? `<p class="error-message" data-testid="email-signin-error">${escapeHtml(error)}</p>` : '';
  return shell({
    title: 'Sign in with email',
    testid: 'email-signin-page',
    body: `<h2 class="error-title">Sign in with email</h2>
    <p>We'll email you a link. It signs you in on the device where you open it, and works once, for 15 minutes.</p>
    ${errorHtml}
    <form action="/auth/email/send" method="POST" class="github-repo-form" data-testid="email-signin-form" ${SUBMIT_ONCE}>
      <input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
      <label class="field-label" for="email-signin-address">Email</label>
      <input type="email" name="email" id="email-signin-address" class="login-input" placeholder="you@example.com" autocomplete="email" data-testid="email-signin-address" required>
      <button type="submit" class="login-button" data-testid="email-signin-submit">Email me a sign-in link</button>
    </form>`,
  });
}

/** Shown instead of the form (and instead of sending) to a signed-in session. */
export function renderEmailSignedInPage() {
  return shell({
    title: "You're signed in",
    testid: 'email-signed-in',
    body: `<h2 class="error-title">You're signed in</h2>
    <p class="error-message">You're signed in. Add an email from Settings, or log out to sign in as someone else.</p>
    <a href="/" class="login-button">Continue</a>
    <a href="/logout" class="error-home-link" data-testid="email-signed-in-logout">Log out</a>`,
  });
}

/**
 * S3: the link-mode "add an email to your account" form. Reachable only from a
 * signed-in session (`GET /auth/email/register`); the hidden `mode=link` makes
 * `POST /auth/email/send` bind the token to the live canonical account.
 *
 * `step` renders the one-time provider-user prompt variant (G3) — the same form
 * with the step's copy and a "Skip for now" exit back to `next`. Settings' "Add
 * email" uses the non-step variant (and still passes `next` to return there).
 * @param {Object} options
 * @param {string} options.nonce - the send nonce for this session
 * @param {string|null} [options.prefill] - an already-stored address (Jira `credentials.email`)
 * @param {string|null} [options.next] - where to land after the link is confirmed
 * @param {boolean} [options.step] - render the provider-user prompt variant
 * @param {string} [options.error] - a message about the typed address itself
 */
export function renderEmailRegisterPage({ nonce, prefill = null, next = null, step = false, error } = {}) {
  const errorHtml = error ? `<p class="error-message" data-testid="email-register-error">${escapeHtml(error)}</p>` : '';
  const heading = step ? 'To register an account, type your email' : 'Add your email';
  const lead = step
    ? "We'll email you a link. Opening it finishes setting up your account, and adds this address to it."
    : "We'll email you a link. Opening it adds this address to the account you're signed in to now.";
  const skip = next
    ? `<a href="${escapeHtml(next)}" class="error-home-link" data-testid="email-register-skip">Skip for now</a>`
    : '';
  return shell({
    title: heading,
    testid: step ? 'email-register-step' : 'email-register-page',
    body: `<h2 class="error-title">${escapeHtml(heading)}</h2>
    <p>${lead}</p>
    ${errorHtml}
    <form action="/auth/email/send" method="POST" class="github-repo-form" data-testid="email-register-form" ${SUBMIT_ONCE}>
      <input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
      <input type="hidden" name="mode" value="link">
      ${next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : ''}
      <label class="field-label" for="email-register-address">Email</label>
      <input type="email" name="email" id="email-register-address" class="login-input" placeholder="you@example.com" autocomplete="email" data-testid="email-register-address"${prefill ? ` value="${escapeHtml(prefill)}"` : ''} required>
      <button type="submit" class="login-button" data-testid="email-register-submit">Email me a link</button>
    </form>
    ${skip}`,
  });
}

/**
 * S3: the confirm page for a link-mode token, opened in the browser that asked
 * for it. Confirming attaches the email identity to the live account; it does
 * not sign anyone in and does not regenerate the session.
 * @param {Object} options
 * @param {string} options.email
 * @param {string} options.token
 * @param {string} options.nonce
 * @param {string|null} [options.next]
 */
export function renderEmailLinkConfirmPage({ email, token, nonce, next = null }) {
  const safeEmail = escapeHtml(email);
  return shell({
    title: 'Confirm your email',
    testid: 'email-link-confirm-page',
    body: `<h2 class="error-title">Add ${safeEmail} to this account?</h2>
    <p>Opening this link in the browser you asked from adds the address to the account you're signed in to.</p>
    <form action="/auth/email/confirm" method="POST" class="github-repo-form" data-testid="email-link-confirm-form" ${SUBMIT_ONCE}>
      <input type="hidden" name="t" value="${escapeHtml(token)}">
      <input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
      ${next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : ''}
      <button type="submit" class="login-button" data-testid="email-link-confirm-submit">Add this email</button>
    </form>`,
  });
}

/**
 * S3: a link-mode token was opened in a different browser, or in a session
 * that has since switched account. Nothing is consumed — open it in the
 * browser the link was requested from.
 *
 * The confirm nonce is included as hidden fields even though this page has no
 * form: it was minted for THIS session before the refusal, and carrying it in
 * the page keeps the POST-side same-account guard exercisable on its own
 * (mirrors the S2 sign-in refusal design). `consumed` is true on the
 * post-consume refusal, where the token has in fact been spent.
 * @param {Object} [options]
 * @param {string|null} [options.token]
 * @param {string|null} [options.nonce]
 * @param {boolean} [options.consumed]
 */
export function renderEmailLinkWrongBrowserPage({ token = null, nonce = null, consumed = false } = {}) {
  // The hidden `t`/`nonce` carry the minted confirm nonce to the POST guard.
  const carry = token && nonce
    ? `<input type="hidden" name="t" value="${escapeHtml(token)}"><input type="hidden" name="nonce" value="${escapeHtml(nonce)}">`
    : '';
  const message = consumed
    ? "Adding an email to your account has to be confirmed from the browser that requested the link. This link has already been used — request a new one below."
    : "Adding an email to your account has to be confirmed from the browser that requested the link. It hasn't been used — open it there.";
  return shell({
    title: 'Open it in the same browser',
    testid: 'email-link-wrong-browser',
    container: 'error-container',
    body: `<h2 class="error-title">Open this link in the browser where you asked for it</h2>
    <p class="error-message">${message}</p>
    ${carry}
    <a href="/auth/email/register" class="login-button" data-testid="email-link-wrong-browser-register">Request a link in this browser</a>
    <a href="/" class="error-home-link">Go to homepage</a>`,
  });
}

/**
 * S3-4: the email-only re-proof page. A stale email-only account P needs a
 * re-proof that actually works; this page emails a SIGN-IN-mode magic link to
 * an address already on P, which re-stamps P's freshness through the N2
 * positive control. Deliberately not `/auth/email`, which cannot re-prove a
 * signed-in session.
 * @param {Object} options
 * @param {string} options.email - P's own address (the link's destination)
 * @param {string} options.nonce - the send nonce for this session
 */
export function renderEmailReproofPage({ email, nonce } = {}) {
  const safeEmail = escapeHtml(email);
  return shell({
    title: 'Sign in again to confirm',
    testid: 'email-reproof-page',
    body: `<h2 class="error-title">Sign in again to confirm</h2>
    <p>To re-prove this account, we'll email a sign-in link to ${safeEmail}. Open it in this browser — it signs you back in as the same account — then reconnect your source.</p>
    <form action="/auth/email/send" method="POST" class="github-repo-form" data-testid="email-reproof-form" ${SUBMIT_ONCE}>
      <input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
      <input type="hidden" name="mode" value="reproof">
      <input type="hidden" name="email" value="${safeEmail}">
      <button type="submit" class="login-button" data-testid="email-reproof-submit">Email me a sign-in link</button>
    </form>
    <a href="/account" class="error-home-link">Back to your account</a>`,
  });
}

/** The one send result, whatever the address (known, unknown, throttled, or a failed send). */
export function renderEmailCheckInboxPage() {
  return shell({
    title: 'Check your inbox',
    testid: 'email-check-inbox',
    body: `<h2 class="error-title">Check your inbox</h2>
    <p class="error-message">If that address can receive email, a link is on its way. It works once, for 15 minutes.</p>
    <a href="/auth/email" class="error-home-link" data-testid="email-send-another">Send another link</a>`,
  });
}

/** An unknown, expired or already-used link. */
export function renderEmailLinkExpiredPage() {
  return shell({
    title: 'Link expired',
    testid: 'email-link-expired',
    container: 'error-container',
    body: `<h2 class="error-title">This link has expired</h2>
    <p class="error-message">Sign-in links work once, for 15 minutes. If you already used this one, you're signed in where you opened it.</p>
    <a href="/auth/email" class="login-button" data-testid="email-send-another">Send another link</a>
    <a href="/" class="error-home-link">Go to homepage</a>`,
  });
}

/**
 * The confirm page: names the address and asks for one POST.
 * @param {Object} options
 * @param {string} options.email
 * @param {string} options.token - the link token, echoed as a hidden field
 * @param {string} options.nonce - the confirm nonce minted for this session
 * @param {boolean} [options.otherDevice] - the link was requested from another browser
 * @param {boolean} [options.alreadySignedIn] - this session's account already holds the address
 */
export function renderEmailConfirmPage({ email, token, nonce, otherDevice = false, alreadySignedIn = false }) {
  const safeEmail = escapeHtml(email);
  const notice = alreadySignedIn
    ? `<p class="error-message" data-testid="email-confirm-already-signed-in">You're already signed in as ${safeEmail}.</p>`
    : otherDevice
      ? `<p class="error-message" data-testid="email-confirm-other-device">You asked for this link from another browser or device. Continue to sign in on this device as ${safeEmail}.</p>`
      : '';
  return shell({
    title: 'Confirm sign-in',
    testid: 'email-confirm-page',
    body: `<h2 class="error-title">Sign in as ${safeEmail}?</h2>
    ${notice}
    <form action="/auth/email/confirm" method="POST" class="github-repo-form" data-testid="email-confirm-form" ${SUBMIT_ONCE}>
      <input type="hidden" name="t" value="${escapeHtml(token)}">
      <input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
      <button type="submit" class="login-button" data-testid="email-confirm-submit">Sign in as ${safeEmail}</button>
    </form>`,
  });
}

/**
 * N2: a signed-in session opened a sign-in link for an address its account
 * doesn't hold. No confirm button; a sign-in link never attaches an email to
 * a live account.
 * @param {Object} options
 * @param {string} options.email
 */
export function renderEmailConfirmSignedInRefusedPage({ email }) {
  const safeEmail = escapeHtml(email);
  return shell({
    title: 'Signed in to a different account',
    testid: 'email-confirm-signed-in-refused',
    container: 'error-container',
    body: `<h2 class="error-title">You're signed in to a different account</h2>
    <p class="error-message">You're signed in to a different account. To add ${safeEmail} to it, use Settings → Add email. To sign in as ${safeEmail}, log out, then open this link again.</p>
    <a href="/logout" class="login-button" data-testid="email-confirm-signed-in-refused-logout">Log out</a>
    <a href="/" class="error-home-link">Go to homepage</a>`,
  });
}

/**
 * A confirm POST that failed the login-CSRF checks (cross-site, or no valid
 * confirm nonce for this browser). The link was not used; opening it again
 * re-mints a nonce, because the GET page never consumes.
 * @param {Object} options
 * @param {string|null} options.retryUrl - the GET confirm URL, when the token is well-formed
 */
export function renderEmailConfirmRefusedPage({ retryUrl }) {
  const retry = retryUrl
    ? `<a href="${escapeHtml(retryUrl)}" class="login-button" data-testid="email-confirm-retry">Open the link again</a>`
    : `<a href="/auth/email" class="login-button" data-testid="email-send-another">Send another link</a>`;
  return shell({
    title: "Couldn't confirm sign-in",
    testid: 'email-confirm-refused',
    container: 'error-container',
    body: `<h2 class="error-title">We couldn't confirm this sign-in</h2>
    <p class="error-message">This sign-in has to be confirmed from the page the link opens, in the same browser. Your link hasn't been used.</p>
    ${retry}
    <a href="/" class="error-home-link">Go to homepage</a>`,
  });
}

/** A send POST without this browser's form nonce. Nothing was sent. */
export function renderEmailSendRefusedPage() {
  return shell({
    title: 'Start again',
    testid: 'email-send-refused',
    container: 'error-container',
    body: `<h2 class="error-title">Please start again</h2>
    <p class="error-message">This form has expired or didn't come from this site. Nothing was sent.</p>
    <a href="/auth/email" class="login-button">Start again</a>`,
  });
}

/** Email sign-in is off on this server. */
export function renderEmailUnavailablePage() {
  return shell({
    title: 'Email sign-in unavailable',
    testid: 'email-unavailable',
    container: 'error-container',
    body: `<h2 class="error-title">Email sign-in isn't available</h2>
    <p class="error-message">Email sign-in isn't available on this server.</p>
    <a href="/" class="error-home-link">Go to homepage</a>`,
  });
}
