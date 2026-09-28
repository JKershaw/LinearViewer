/**
 * Email magic-link sign-in: the link store and the nonce helpers
 * (LIN-1892 S2 item 3).
 *
 * Email is an IDENTITY TYPE (`provider: 'email'`, `scope: <normalised
 * address>` on `accounts.identities[]`), not a workspace provider: there is no
 * `lib/providers/email`. This module holds the logic; `routes/email-auth.js`
 * is the thin HTTP layer over it.
 *
 * `MagicLinkStore` follows the single-use hashed-token precedent
 * `lib/harbour-feedback-tokens.js`: 32 random bytes, base64url, stored ONLY as
 * its SHA-256; a hard `expiresAt`; an atomic `findOneAndUpdate` consume. The
 * `_id` IS the token hash, so a lookup is a point read. Expired and consumed
 * links are removed by the TTL index on `expiresAt` (lib/db-indexes.js); the
 * TTL is cleanup only — expiry is enforced by every query here.
 *
 * Schema (collection: email-magic-links):
 * {
 *   _id: string,                  // sha256(token), hex — the token is never stored
 *   emailNorm: string,            // normalizeEmail() output
 *   mode: 'signin'|'link',        // 'link' (S3) attaches the email to linkToAccountId
 *   linkToAccountId: string|null, // set iff mode === 'link'
 *   requestNonceHash: string|null,// the requesting browser's nonce hash (cross-device notice only)
 *   createdAt: Date,
 *   expiresAt: Date,              // createdAt + 15 minutes
 *   consumedAt: Date|null
 * }
 *
 * The nonce helpers are pure over the session object (G1, login-CSRF):
 *   - the CONFIRM nonce is minted by `GET /auth/email/confirm`, bound to the
 *     token, and is single use — cleared on every verify, pass or fail;
 *   - the SEND nonce is minted by `GET /auth/email` and checked by
 *     `POST /auth/email/send` before anything is stored.
 *
 * Imports only `node:crypto` (N6).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const MAGIC_LINK_COLLECTION = 'email-magic-links';
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const EMAIL_SEND_THROTTLE_MAX = 3;
export const EMAIL_SEND_THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const EMAIL_NONCE_MAX_AGE_MS = 15 * 60 * 1000;

const MODES = ['signin', 'link'];
// 32 random bytes → exactly 43 base64url characters, no padding.
const RANDOM_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function randomToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * The hash a magic-link token is stored and looked up under.
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  return sha256Hex(token);
}

/**
 * Trim + lowercase, with a basic shape check. The result is the identity
 * `scope` and the throttle key, so `' A@X.io '` and `'a@x.io'` are one human.
 * @param {unknown} raw
 * @returns {string|null} the normalised address, or null if it isn't one
 */
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE_RE.test(email)) return null;
  return email;
}

function isWellFormedToken(value) {
  return typeof value === 'string' && RANDOM_TOKEN_RE.test(value);
}

// Constant-time comparison of two hex digests.
function hashesEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function isFreshNonce(issuedAt, now) {
  return Number.isFinite(issuedAt) && now - issuedAt >= 0 && now - issuedAt <= EMAIL_NONCE_MAX_AGE_MS;
}

function publicView(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

export class MagicLinkStore {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB `email-magic-links` collection
   * @param {() => Date} [options.now] - clock, injectable for tests
   */
  constructor({ collection, now = () => new Date() } = {}) {
    this.collection = collection;
    this.now = now;
  }

  /**
   * Mints a single-use link. Only `sha256(token)` is stored.
   * @param {Object} options
   * @param {string} options.emailNorm - an already-normalised address
   * @param {'signin'|'link'} [options.mode='signin']
   * @param {string|null} [options.linkToAccountId=null] - required iff mode is 'link'
   * @param {string|null} [options.requestNonceHash=null]
   * @returns {Promise<{token: string, expiresAt: Date}>}
   */
  async issue({ emailNorm, mode = 'signin', linkToAccountId = null, requestNonceHash = null }) {
    if (typeof emailNorm !== 'string' || normalizeEmail(emailNorm) !== emailNorm) {
      throw new Error('emailNorm must be a normalised email address');
    }
    if (!MODES.includes(mode)) throw new Error(`unknown magic-link mode: ${mode}`);
    if ((mode === 'link') !== (linkToAccountId != null)) {
      throw new Error('linkToAccountId is required for a link-mode token and forbidden otherwise');
    }

    const token = randomToken();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + MAGIC_LINK_TTL_MS);
    await this.collection.insertOne({
      _id: hashToken(token),
      emailNorm,
      mode,
      linkToAccountId,
      requestNonceHash,
      createdAt,
      expiresAt,
      consumedAt: null,
    });
    return { token, expiresAt };
  }

  /**
   * Reads a live (unconsumed, unexpired) link WITHOUT consuming it — the GET
   * confirm page and the N2 pre-consume check use this, so opening a link
   * (or a mail scanner prefetching it) never spends it.
   * @param {unknown} token
   * @returns {Promise<Object|null>} the stored fields (minus `_id`), or null
   */
  async peek(token) {
    if (!isWellFormedToken(token)) return null;
    const doc = await this.collection.findOne({
      _id: hashToken(token),
      consumedAt: null,
      expiresAt: { $gt: this.now() },
    });
    return publicView(doc);
  }

  /**
   * Atomically spends a live link: exactly one concurrent caller wins.
   * @param {unknown} token
   * @returns {Promise<Object|null>} the consumed link's fields, or null
   */
  async consume(token) {
    if (!isWellFormedToken(token)) return null;
    const now = this.now();
    const doc = await this.collection.findOneAndUpdate(
      { _id: hashToken(token), consumedAt: null, expiresAt: { $gt: now } },
      { $set: { consumedAt: now } },
      { returnDocument: 'after' }
    );
    return publicView(doc);
  }

  /**
   * Links issued for one address inside the window: the per-email send
   * throttle (`EMAIL_SEND_THROTTLE_MAX` per `EMAIL_SEND_THROTTLE_WINDOW_MS`).
   * @param {string} emailNorm
   * @param {number} [windowMs]
   * @returns {Promise<number>}
   */
  async recentCountForEmail(emailNorm, windowMs = EMAIL_SEND_THROTTLE_WINDOW_MS) {
    const since = new Date(this.now().getTime() - windowMs);
    return this.collection.countDocuments({ emailNorm, createdAt: { $gte: since } });
  }
}

/**
 * Mints the confirm nonce for the GET confirm page, bound to this session
 * and to `token`. Replaces any earlier one. Only hashes are kept.
 * @param {Object} session - `req.session` (mutated)
 * @param {string} token - the magic-link token being confirmed
 * @param {number} [now=Date.now()]
 * @returns {string} the plain nonce, for the page's hidden field
 */
export function mintConfirmNonce(session, token, now = Date.now()) {
  const nonce = randomToken();
  session.emailConfirm = { nonceHash: sha256Hex(nonce), tokenHash: hashToken(token), issuedAt: now };
  return nonce;
}

/**
 * Checks a confirm POST's `{t, nonce}` against the session: the nonce hash
 * and the token hash must both match (constant-time), and the nonce must be
 * at most 15 minutes old. `session.emailConfirm` is deleted on EVERY call,
 * pass or fail, so a nonce is single use.
 * @param {Object} session - `req.session` (mutated)
 * @param {{t: unknown, nonce: unknown}} input
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function verifyAndClearConfirmNonce(session, { t, nonce } = {}, now = Date.now()) {
  const minted = session?.emailConfirm;
  if (session && 'emailConfirm' in session) delete session.emailConfirm;
  if (!minted || !isWellFormedToken(nonce) || !isWellFormedToken(t)) return false;
  const nonceOk = hashesEqual(sha256Hex(nonce), minted.nonceHash);
  const tokenOk = hashesEqual(hashToken(t), minted.tokenHash);
  return nonceOk && tokenOk && isFreshNonce(minted.issuedAt, now);
}

/**
 * Mints the send nonce for the email form. Replaces any earlier one.
 * @param {Object} session - `req.session` (mutated)
 * @param {number} [now=Date.now()]
 * @returns {string} the plain nonce, for the form's hidden field
 */
export function mintSendNonce(session, now = Date.now()) {
  const nonce = randomToken();
  session.emailSend = { nonceHash: sha256Hex(nonce), issuedAt: now };
  return nonce;
}

/**
 * Checks a send POST's nonce against the session. Unlike the confirm nonce it
 * is NOT cleared:
 *   - a refusal must leave the session untouched, so express-session doesn't
 *     save it or set a cookie on a refused send;
 *   - it stays valid for its 15 minutes, so a double-submitted form isn't
 *     refused. Repeat sends from one browser are bounded by the per-email
 *     throttle and the route's rate limit, not by the nonce.
 * @param {Object} session - `req.session` (not mutated)
 * @param {unknown} nonce
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function verifySendNonce(session, nonce, now = Date.now()) {
  const minted = session?.emailSend;
  if (!minted || !isWellFormedToken(nonce)) return false;
  return hashesEqual(sha256Hex(nonce), minted.nonceHash) && isFreshNonce(minted.issuedAt, now);
}
