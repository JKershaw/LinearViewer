/**
 * Email sign-in availability (LIN-1892 S2 item 1, G2/G3).
 *
 * The ONE predicate behind the email transport, the `/auth/email*` 503s, the
 * landing-hero and navbar CTAs, and the Settings form. Email sign-in is off
 * unless the operator explicitly chose a transport:
 *
 *   - `'resend'`  — `RESEND_API_KEY` and `EMAIL_FROM` both set, and
 *                   `EMAIL_TRANSPORT` unset or `'resend'`. Setting a real
 *                   provider key is itself the explicit choice.
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
 * `EMAIL_LINK_ORIGIN` (optional) is the server's public origin for the links
 * in sign-in emails. Unset, links are built from each request's own Host
 * header, which a direct (non-proxied) request can forge: the link would then
 * point the recipient's token at another host. See `resolveEmailLinkOrigin`.
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
    return read(env, 'RESEND_API_KEY') && read(env, 'EMAIL_FROM') ? 'resend' : null;
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
 * Why an explicitly set `EMAIL_TRANSPORT` was refused, as one line for the
 * startup warning, or `null` when there is nothing to warn about. The warning
 * names the variable and never echoes a secret or an unrecognised value.
 * Unset `EMAIL_TRANSPORT` never warns: an unconfigured server is the normal
 * "email off" default, not a refused combination.
 * @param {Object} [env=process.env]
 * @returns {string|null}
 */
export function resolveEmailTransportRefusal(env = process.env) {
  const transport = read(env, 'EMAIL_TRANSPORT');
  if (transport === null || resolveEmailTransportKind(env) !== null) return null;

  switch (transport) {
    case 'console':
      return 'EMAIL_TRANSPORT=console is refused when NODE_ENV=production (sign-in links would only reach the server log); email sign-in is off';
    case 'capture':
      return 'EMAIL_TRANSPORT=capture only works under NODE_ENV=test; email sign-in is off';
    case 'resend':
      return 'EMAIL_TRANSPORT=resend needs both RESEND_API_KEY and EMAIL_FROM; email sign-in is off';
    default:
      return `EMAIL_TRANSPORT has an unrecognised value (expected one of: ${EXPLICIT_TRANSPORTS.join(', ')}); email sign-in is off`;
  }
}

/**
 * The canonical origin (`https://host[:port]`) for links in sign-in emails,
 * from `EMAIL_LINK_ORIGIN`, or `null` when it is unset or not an http(s) URL
 * (the routes then fall back to the request's own origin).
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
 * A startup warning about the link origin, or `null`. Warns when email goes to
 * real inboxes (`resend`) with no canonical origin, and whenever
 * `EMAIL_LINK_ORIGIN` is set but unusable.
 * @param {Object} [env=process.env]
 * @returns {string|null}
 */
export function resolveEmailLinkOriginWarning(env = process.env) {
  const origin = resolveEmailLinkOrigin(env);
  if (read(env, 'EMAIL_LINK_ORIGIN') !== null && origin === null) {
    return 'EMAIL_LINK_ORIGIN is not an http(s) URL; sign-in links fall back to each request\'s Host header';
  }
  if (origin === null && resolveEmailTransportKind(env) === 'resend') {
    return 'EMAIL_LINK_ORIGIN is not set; sign-in links are built from each request\'s Host header. Set it to this server\'s public origin';
  }
  return null;
}
