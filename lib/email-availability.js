/**
 * Email sign-in availability (LIN-1892 S2 item 1, G2/G3).
 *
 * The ONE predicate behind the email transport, the `/auth/email*` 503s, the
 * landing-hero and navbar CTAs, and the Settings form. Email sign-in is off
 * unless the operator explicitly chose a transport:
 *
 *   - `'resend'`  — `RESEND_API_KEY`, `EMAIL_FROM` and a valid
 *                   `EMAIL_LINK_ORIGIN` all set, and `EMAIL_TRANSPORT` unset
 *                   or `'resend'`. Setting a real provider key is itself the
 *                   explicit choice; the origin is required with it (below).
 *   - `'console'` — `EMAIL_TRANSPORT=console` and `NODE_ENV !== 'production'`.
 *                   The dev opt-in: sign-in links go to the server log.
 *   - `'capture'` — `EMAIL_TRANSPORT=capture` and `NODE_ENV === 'test'`. The
 *                   test harness (Playwright's webServer sets it).
 *   - `null`      — everything else, including a self-hosted server with no
 *                   `NODE_ENV` and no email settings.
 *
 * `NODE_ENV` only refuses (console under production) or scopes (capture under
 * test); it never turns email on by itself.
 *
 * `EMAIL_LINK_ORIGIN` is the server's public origin for the links in sign-in
 * emails, and is REQUIRED for `resend` (LIN-1892, decided in S2 beat 3):
 * building a link from the request's own Host header lets anyone request a
 * link for a victim's address with a forged `Host:`, so the victim receives a
 * genuine, valid token pointing at the attacker's host (reset-link
 * poisoning). Without it the door stays off (fail closed). `console` (dev)
 * and `capture` (test) links only reach the server log or the test outbox,
 * so those fall back to the request origin when it is unset.
 *
 * This module has ZERO imports, deliberately (N6): cycle members such as
 * `lib/components/navbar.js` import it, and a leaf can't close an import
 * cycle. It and `lib/email-transport.js` are the only modules that read the
 * email environment variables (Q15, pinned by
 * tests/unit/email-import-boundary.test.js); `server.js` takes its startup
 * warning from `resolveEmailTransportRefusal` rather than reading them itself.
 */

const EXPLICIT_TRANSPORTS = ['resend', 'console', 'capture'];

// An empty value (`EMAIL_TRANSPORT=` in a .env file) counts as unset.
function read(env, name) {
  const value = env[name];
  return typeof value === 'string' && value !== '' ? value : null;
}

function hasResendKeys(env) {
  return read(env, 'RESEND_API_KEY') !== null && read(env, 'EMAIL_FROM') !== null;
}

/**
 * Which email transport this environment selects, or `null` for "email
 * sign-in is off".
 * @param {Object} [env=process.env]
 * @returns {'resend'|'console'|'capture'|null}
 */
export function resolveEmailTransportKind(env = process.env) {
  const transport = read(env, 'EMAIL_TRANSPORT');
  const nodeEnv = read(env, 'NODE_ENV');

  if (transport === null || transport === 'resend') {
    return hasResendKeys(env) && resolveEmailLinkOrigin(env) !== null ? 'resend' : null;
  }
  if (transport === 'console') return nodeEnv !== 'production' ? 'console' : null;
  if (transport === 'capture') return nodeEnv === 'test' ? 'capture' : null;
  return null;
}

/**
 * Whether email sign-in is available on this server.
 * @param {Object} [env=process.env]
 * @returns {boolean}
 */
export function isEmailSignInAvailable(env = process.env) {
  return resolveEmailTransportKind(env) !== null;
}

/**
 * The S3 "type your email" step's mode (G3). Live by default only where
 * sign-in links actually reach an inbox:
 *   - `'resend'`  → `'on'`;
 *   - `'capture'` → `'opt-in'` (per session, test only);
 *   - `'console'` → `'off'`, unless `EMAIL_PROMPT_STEP=on` (a developer
 *                   testing the step) → `'on'`;
 *   - `null`      → `'off'`.
 * @param {Object} [env=process.env]
 * @returns {'on'|'off'|'opt-in'}
 */
export function resolvePromptStepMode(env = process.env) {
  switch (resolveEmailTransportKind(env)) {
    case 'resend': return 'on';
    case 'capture': return 'opt-in';
    case 'console': return read(env, 'EMAIL_PROMPT_STEP') === 'on' ? 'on' : 'off';
    default: return 'off';
  }
}

/**
 * Why an explicit email configuration was refused, as one line for the
 * startup warning, or `null` when there is nothing to warn about: an
 * `EMAIL_TRANSPORT` that can't be honoured, or Resend keys without a valid
 * `EMAIL_LINK_ORIGIN`. The warning names the variables and never echoes a
 * secret or an unrecognised value. A server with no email configuration never
 * warns: that is the normal "email off" default, not a refused combination.
 * @param {Object} [env=process.env]
 * @returns {string|null}
 */
export function resolveEmailTransportRefusal(env = process.env) {
  if (resolveEmailTransportKind(env) !== null) return null;
  const transport = read(env, 'EMAIL_TRANSPORT');

  // A real provider is configured, but not the origin its links must use.
  if ((transport === null || transport === 'resend') && hasResendKeys(env)) {
    return 'RESEND_API_KEY and EMAIL_FROM are set but EMAIL_LINK_ORIGIN is missing or not an http(s) URL; sign-in links must use this server\'s public origin, not a request\'s Host header; email sign-in is off';
  }
  if (transport === null) return null;

  switch (transport) {
    case 'console':
      return 'EMAIL_TRANSPORT=console is refused when NODE_ENV=production (sign-in links would only reach the server log); email sign-in is off';
    case 'capture':
      return 'EMAIL_TRANSPORT=capture only works under NODE_ENV=test; email sign-in is off';
    case 'resend':
      return 'EMAIL_TRANSPORT=resend needs RESEND_API_KEY, EMAIL_FROM and EMAIL_LINK_ORIGIN; email sign-in is off';
    default:
      return `EMAIL_TRANSPORT has an unrecognised value (expected one of: ${EXPLICIT_TRANSPORTS.join(', ')}); email sign-in is off`;
  }
}

/**
 * The canonical origin (`https://host[:port]`) for links in sign-in emails,
 * from `EMAIL_LINK_ORIGIN`, or `null` when it is unset or not an http(s) URL.
 * Required for `resend`; `console`/`capture` fall back to the request origin.
 * @param {Object} [env=process.env]
 * @returns {string|null}
 */
export function resolveEmailLinkOrigin(env = process.env) {
  const raw = read(env, 'EMAIL_LINK_ORIGIN');
  if (raw === null) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
}

/**
 * A startup warning about the link origin, or `null`: `EMAIL_LINK_ORIGIN` is
 * set but unusable while a dev/test transport is on, so links fall back to
 * the request origin. (With Resend configured, an unusable origin turns the
 * door off instead, and `resolveEmailTransportRefusal` names it.)
 * @param {Object} [env=process.env]
 * @returns {string|null}
 */
export function resolveEmailLinkOriginWarning(env = process.env) {
  if (read(env, 'EMAIL_LINK_ORIGIN') === null || resolveEmailLinkOrigin(env) !== null) return null;
  const kind = resolveEmailTransportKind(env);
  if (kind === 'console' || kind === 'capture') {
    return 'EMAIL_LINK_ORIGIN is not an http(s) URL; sign-in links fall back to each request\'s own origin';
  }
  return null;
}
