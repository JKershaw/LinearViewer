/**
 * Harbour credential token format (LIN-3795).
 *
 * The only representation of the format: a fixed kind prefix + 32 random bytes
 * as base64url (43 chars). The prefix makes a bare token recognisable, so the
 * secret-scan rule `harbour-bootstrap-token` can mask it without context
 * (an unprefixed 43-char token is indistinguishable from a /t/ share token).
 *
 * Auth treats tokens as opaque (the whole string is hashed), and the prefix is
 * not secret. Tokens minted before LIN-3795 are unprefixed 43-char strings and
 * stay valid; they are masked only in context (Bearer, *_token, "token": ").
 *
 * lib/secret-scan.js deliberately does NOT import this module (it must stay a
 * leaf); its rule carries a literal `hb[pdf]_` pinned to these prefixes by
 * tests/unit/harbour-token-format.test.js.
 */

import crypto from 'crypto';

export const HARBOUR_TOKEN_PREFIXES = Object.freeze({
  proxy: 'hbp_',
  dispatch: 'hbd_',
  feedback: 'hbf_'
});

/**
 * @param {'proxy'|'dispatch'|'feedback'} kind
 * @returns {string} prefix + 43-char base64url (32 random bytes)
 */
export function mintHarbourToken(kind) {
  const prefix = Object.hasOwn(HARBOUR_TOKEN_PREFIXES, kind) ? HARBOUR_TOKEN_PREFIXES[kind] : null;
  if (!prefix) throw new Error(`Unknown Harbour token kind: ${String(kind)}`);
  return prefix + crypto.randomBytes(32).toString('base64url');
}
